import { sourceFingerprint } from './source-inputs.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '../..'),
  target = path.join(root, '.build-resources');
fs.mkdirSync(target, { recursive: true });
const hash = (file) =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const wasm = path.join(
  root,
  'node_modules/mediainfo.js/dist/MediaInfoModule.wasm',
);
const digest = hash(wasm);
if (
  digest !== '8849ed8de015e78349a262f08ea9995ae67aa2af5678f80c011cb7e8117c46bd'
)
  throw new Error(
    'Unexpected MediaInfo WASM build; review its version/license/hash before changing the pin.',
  );
fs.copyFileSync(wasm, path.join(target, 'MediaInfoModule.wasm'));
let sourceCommit = null,
  dirty = true;
try {
  sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  dirty = !!execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
} catch {}
const info = {
  version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    .version,
  sourceCommit,
  dirty,
  sourceTreeSha256: sourceFingerprint(root),
  lockSha256: hash(path.join(root, 'package-lock.json')),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  mediaProbe: {
    package: 'mediainfo.js',
    version: '0.3.9',
    license: 'BSD-2-Clause',
    wasmSha256: digest,
  },
  builtAt: new Date().toISOString(),
};
fs.writeFileSync(
  path.join(target, 'build-info.json'),
  JSON.stringify(info, null, 2) + '\n',
);
console.log('Pinned MediaInfo WASM and build provenance prepared.');
