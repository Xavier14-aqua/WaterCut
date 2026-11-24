import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Build and audit must hash exactly the same code, tests and configurations. */
export function sourceFingerprint(root) {
  const files = [];
  function visit(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(file);
      else files.push(path.relative(root, file).replaceAll('\\', '/'));
    }
  }
  for (const folder of ['src', 'scripts', 'tests', 'licenses'])
    visit(path.join(root, folder));
  files.push(
    'package.json',
    'package-lock.json',
    'forge.config.mts',
    'vitest.config.mts',
    'vite.main.config.mts',
    'vite.preload.config.mts',
    'vite.renderer.config.mts',
    'tsconfig.json',
    '.gitattributes',
    '.oxfmtrc.json',
    '.oxlintrc.json',
    'index.html',
    'LICENSE',
  );
  const tree = createHash('sha256');
  for (const name of files.sort()) {
    const content = createHash('sha256')
      .update(fs.readFileSync(path.join(root, name)))
      .digest('hex');
    tree.update(name + '\0' + content + '\n');
  }
  return tree.digest('hex');
}
