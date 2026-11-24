import { sourceFingerprint } from '../build/source-inputs.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as asar from '@electron/asar';
import yauzl from 'yauzl';
const root = path.resolve(import.meta.dirname, '../..'),
  version = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  ).version;
const out = path.resolve(root, process.env.WATERCUT_BUILD_OUT || 'out');
const resources = path.join(out, 'WaterCut-win32-x64', 'resources'),
  appFile = path.join(resources, 'app.asar'),
  zipFile = path.join(
    out,
    'make',
    'zip',
    'win32',
    'x64',
    `WaterCut-win32-x64-${version}.zip`,
  );
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const forbidden =
  /\.(sqlite|watercut)(\.|\/|$)|(?:^|\/)(?:storage-settings|ai-settings)\.json$|renderer-errors\.log$|\/(?:projects|node_modules|src|tests|docs|scripts|\.git)\//i;
const entries = asar.listPackage(appFile).map((p) => p.replaceAll('\\', '/'));
if (entries.some((p) => forbidden.test(p)))
  throw new Error('Private/development files inside app.asar');
const required = [
  '.vite/build/main.cjs',
  '.vite/build/preload.cjs',
  '.vite/build/data-worker.cjs',
  '.vite/build/probe-worker.cjs',
  '.vite/renderer/main_window/index.html',
];
for (const file of required)
  if (!entries.includes('/' + file)) throw new Error('Missing runtime ' + file);
if (
  JSON.parse(asar.extractFile(appFile, 'package.json').toString()).version !==
  version
)
  throw new Error('Stale application version');
if (
  !fs
    .readFileSync(path.join(resources, 'THIRD_PARTY_NOTICES.txt'), 'utf8')
    .includes('Copyright 2024 Gary Guan')
)
  throw new Error('Missing draft template attribution');
const info = JSON.parse(
  fs.readFileSync(path.join(resources, 'build-info.json'), 'utf8'),
);
const lockSha = await hashFile(path.join(root, 'package-lock.json'));
if (info.version !== version || info.lockSha256 !== lockSha)
  throw new Error('Build provenance does not match version/lockfile');
if (sourceFingerprint(root) !== info.sourceTreeSha256)
  throw new Error('Runtime was built from a different source tree');
if (
  (await hashFile(path.join(resources, 'MediaInfoModule.wasm'))) !==
  info.mediaProbe.wasmSha256
)
  throw new Error('Probe binary integrity mismatch');
const zip = await new Promise((resolve, reject) =>
  yauzl.open(zipFile, { lazyEntries: true, autoClose: false }, (error, zip) =>
    error ? reject(error) : resolve(zip),
  ),
);
const archive = [];
try {
  await new Promise((resolve, reject) => {
    zip.on('error', reject);
    zip.on('entry', (entry) => {
      archive.push(entry);
      zip.readEntry();
    });
    zip.once('end', resolve);
    zip.readEntry();
  });
  const names = archive.map((e) => e.fileName.replaceAll('\\', '/'));
  if (names.some((p) => forbidden.test('/' + p)))
    throw new Error('Private/development files inside application ZIP');
  for (const file of [
    'LICENSE',
    'THIRD_PARTY_NOTICES.txt',
    'MediaInfoModule.wasm',
    'build-info.json',
    'app.asar',
  ]) {
    const entry = archive.find(
      (e) =>
        e.fileName.replaceAll('\\', '/').endsWith('/resources/' + file) ||
        e.fileName.replaceAll('\\', '/') === 'resources/' + file,
    );
    if (!entry) throw new Error('ZIP is missing ' + file);
    const stream = await new Promise((resolve, reject) =>
        zip.openReadStream(entry, (e, s) => (e ? reject(e) : resolve(s))),
      ),
      hash = createHash('sha256');
    for await (const chunk of stream) hash.update(chunk);
    if (hash.digest('hex') !== (await hashFile(path.join(resources, file))))
      throw new Error('ZIP differs from verified application: ' + file);
  }
} finally {
  zip.close();
}
const sha256 = await hashFile(zipFile);
fs.writeFileSync(
  path.join(path.dirname(zipFile), 'SHA256SUMS.txt'),
  `${sha256}  ${path.basename(zipFile)}\n`,
);
const output = path.join(out, 'review-distribution');
fs.mkdirSync(output, { recursive: true });
const report = {
  version,
  zip: zipFile,
  bytes: fs.statSync(zipFile).size,
  sha256,
  asarEntries: entries.length,
  zipEntries: archive.length,
  privatePaths: 0,
  verifiedRuntimeMatchesZip: true,
  build: info,
};
fs.writeFileSync(
  path.join(output, 'distribution-audit.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
