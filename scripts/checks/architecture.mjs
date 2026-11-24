import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { parse } from '@babel/parser';

const root = path.resolve(import.meta.dirname, '../..');
const sourceRoot = path.join(root, 'src');
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.tsx?$/.test(file) && !/\.test\./.test(file)) files.push(file);
  }
}
walk(sourceRoot);
const relative = (file) => path.relative(root, file).replaceAll('\\', '/');
const errors = [];
const graph = new Map();
const nodeModules = new Set(
  builtinModules.map((name) => name.replace(/^node:/, '')),
);
const allowed = {
  main: new Set(['main', 'contracts', 'shared', 'infrastructure']),
  preload: new Set(['preload', 'contracts', 'shared']),
  renderer: new Set(['renderer', 'contracts', 'shared']),
  workers: new Set([
    'workers',
    'modules',
    'contracts',
    'shared',
    'infrastructure',
  ]),
  modules: new Set(['modules', 'contracts', 'shared', 'infrastructure']),
  infrastructure: new Set(['infrastructure', 'contracts', 'shared']),
  contracts: new Set(['contracts', 'shared']),
  shared: new Set(['shared']),
};

function visit(node, callback, parent) {
  if (!node || typeof node !== 'object') return;
  if (node.type) callback(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'comments', 'tokens', 'extra'].includes(key)) continue;
    if (Array.isArray(value))
      value.forEach((child) => visit(child, callback, node));
    else if (value && typeof value === 'object') visit(value, callback, node);
  }
}

function resolveImport(file, request) {
  const base = path.resolve(path.dirname(file), request);
  return [
    base,
    base + '.ts',
    base + '.tsx',
    base + '.d.ts',
    base + '.json',
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ].find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
}

const invokes = new Set(),
  handlers = new Set();
const forbiddenDOM = new Set([
  'window',
  'document',
  'navigator',
  'localStorage',
  'AudioContext',
  'HTMLMediaElement',
  'HTMLVideoElement',
  'HTMLElement',
]);
for (const file of files) {
  const name = relative(file),
    layer = name.split('/')[1];
  const text = fs.readFileSync(file, 'utf8');
  const ast = parse(text, {
    sourceType: 'module',
    plugins: ['typescript', ...(file.endsWith('.tsx') ? ['jsx'] : [])],
  });
  const edges = [];
  graph.set(file, edges);
  const declared = new Set();
  function bindings(node) {
    if (!node) return;
    if (node.type === 'Identifier') declared.add(node.name);
    else if (node.type === 'ObjectPattern')
      node.properties.forEach((property) =>
        bindings(property.value || property.argument),
      );
    else if (node.type === 'ArrayPattern') node.elements.forEach(bindings);
    else if (node.type === 'AssignmentPattern') bindings(node.left);
  }
  visit(ast, (node) => {
    if (node.type === 'VariableDeclarator') bindings(node.id);
    if (node.params) node.params.forEach(bindings);
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration')
      bindings(node.id);
  });
  visit(ast, (node, parent) => {
    let request,
      runtime = true;
    if (
      [
        'ImportDeclaration',
        'ExportNamedDeclaration',
        'ExportAllDeclaration',
      ].includes(node.type) &&
      node.source
    ) {
      request = node.source.value;
      runtime =
        node.importKind !== 'type' &&
        node.exportKind !== 'type' &&
        !(
          node.specifiers?.length &&
          node.specifiers.every(
            (specifier) =>
              specifier.importKind === 'type' ||
              specifier.exportKind === 'type',
          )
        );
    } else if (node.type === 'TSImportType') {
      request = node.argument.value;
      runtime = false;
    } else if (
      node.type === 'CallExpression' &&
      (node.callee.type === 'Import' || node.callee.name === 'require')
    )
      request = node.arguments[0]?.value;
    if (typeof request === 'string') {
      if (request.startsWith('.')) {
        const target = resolveImport(file, request);
        if (!target) {
          errors.push(`${name}: unresolved import ${request}`);
          return;
        }
        const targetName = relative(target),
          targetLayer = targetName.split('/')[1];
        if (targetName.startsWith('src/')) {
          const workerType =
            name === 'src/contracts/worker.ts' &&
            !runtime &&
            targetLayer === 'modules';
          if (!allowed[layer]?.has(targetLayer) && !workerType)
            errors.push(`${name}: ${layer} cannot depend on ${targetName}`);
          if (runtime) edges.push(target);
          const targetFeature = targetName.match(
            /^src\/renderer\/features\/([^/]+)\//,
          );
          if (
            targetFeature &&
            !name.startsWith(`src/renderer/features/${targetFeature[1]}/`) &&
            !targetName.endsWith(`/${targetFeature[1]}/index.ts`)
          )
            errors.push(
              `${name}: use the public ${targetFeature[1]} feature entry`,
            );
          const targetModule = targetName.match(/^src\/modules\/([^/]+)\//);
          if (
            targetModule &&
            !name.startsWith(`src/modules/${targetModule[1]}/`) &&
            !targetName.endsWith(`/${targetModule[1]}/index.ts`)
          )
            errors.push(
              `${name}: use the public ${targetModule[1]} module entry`,
            );
        } else if (targetName !== 'package.json')
          errors.push(
            `${name}: unexpected source dependency outside src: ${targetName}`,
          );
      } else if (
        (request === 'electron' ||
          request.startsWith('electron/') ||
          request.startsWith('node:') ||
          nodeModules.has(request)) &&
        ['renderer', 'shared', 'contracts'].includes(layer)
      )
        errors.push(`${name}: ${layer} cannot import ${request}`);
      if (layer === 'modules' && request.startsWith('electron'))
        errors.push(`${name}: business modules cannot import Electron`);
    }
    if (
      layer === 'shared' &&
      node.type === 'Identifier' &&
      forbiddenDOM.has(node.name) &&
      !declared.has(node.name)
    ) {
      const property =
        (parent?.type === 'MemberExpression' &&
          parent.property === node &&
          !parent.computed) ||
        (['ObjectProperty', 'TSPropertySignature'].includes(parent?.type) &&
          parent.key === node);
      if (!property)
        errors.push(`${name}: shared code cannot access ${node.name}`);
    }
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression'
    ) {
      const object = node.callee.object.name,
        method = node.callee.property.name,
        channel = node.arguments[0]?.value;
      if (
        object === 'ipcRenderer' &&
        method === 'invoke' &&
        typeof channel === 'string'
      )
        invokes.add(channel);
      if (
        object === 'ipcMain' &&
        method === 'handle' &&
        typeof channel === 'string'
      )
        handlers.add(channel);
    }
    if (node.type === 'VariableDeclarator' && node.id.name === 'mutations')
      for (const property of node.init.properties)
        if (typeof property.key.value === 'string')
          handlers.add(property.key.value);
  });
}

const done = new Set(),
  active = new Set();
function checkCycle(file, stack = []) {
  if (active.has(file)) {
    errors.push(
      'Runtime dependency cycle: ' +
        [...stack, file].map(relative).join(' -> '),
    );
    return;
  }
  if (done.has(file)) return;
  active.add(file);
  for (const target of graph.get(file) || [])
    if (graph.has(target)) checkCycle(target, [...stack, file]);
  active.delete(file);
  done.add(file);
}
files.forEach((file) => checkCycle(file));
for (const channel of invokes)
  if (!handlers.has(channel))
    errors.push(`Preload invokes an unregistered IPC channel: ${channel}`);
for (const file of files)
  if (path.dirname(file) === sourceRoot && path.basename(file) !== 'env.d.ts')
    errors.push(`Unexpected root source file: ${relative(file)}`);

const forge = fs.readFileSync(path.join(root, 'forge.config.mts'), 'utf8');
const entries = [...forge.matchAll(/entry:\s*['"]([^'"]+)['"]/g)].map(
  (match) => match[1],
);
const expected = [
  'src/main/main.ts',
  'src/preload/preload.ts',
  'src/workers/data-worker.ts',
  'src/workers/probe-worker.ts',
];
if (
  entries.length !== 4 ||
  expected.some((entry) => !entries.includes(entry)) ||
  new Set(entries.map((entry) => path.basename(entry))).size !== 4
)
  errors.push(
    'The four runtime entries and their unique output names must remain explicit.',
  );
const report = {
  files: files.length,
  runtimeEdges: [...graph.values()].reduce(
    (sum, edges) => sum + edges.length,
    0,
  ),
  invokeChannels: invokes.size,
  registeredChannels: handlers.size,
  errors: [...new Set(errors)],
};
const output = path.join(root, 'out/review-architecture');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(
  path.join(output, 'report.json'),
  JSON.stringify(report, null, 2) + '\n',
);
if (report.errors.length) {
  console.error(report.errors.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Architecture passed: ${report.files} files, ${report.runtimeEdges} runtime imports, ${report.invokeChannels} IPC calls.`,
  );
