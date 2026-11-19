import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const packages = Object.entries(lock.packages)
  .filter(([location, data]) => location.startsWith('node_modules/') && !data.dev)
  .sort(([a], [b]) => a.localeCompare(b));

const notices = ['WaterCut third-party notices', '', 'Runtime JavaScript dependencies bundled with WaterCut:', ''];
for (const [location, data] of packages) {
  const folder = path.join(root, location);
  const metadata = JSON.parse(readFileSync(path.join(folder, 'package.json'), 'utf8'));
  const files = readdirSync(folder);
  const licenseFile = files.find(name => /^licen[sc]e(?:[.-]|$)/i.test(name) && !name.endsWith('.json'));
  // This React subpackage declares MIT but omits a separate notice in its npm archive.
  const source = licenseFile ? path.join(folder, licenseFile)
    : metadata.name === 'react-compiler-runtime' ? path.join(root, 'node_modules/react/LICENSE')
      : null;
  if (!source) throw new Error(`Missing license text for ${metadata.name}`);
  notices.push('='.repeat(72), `${metadata.name} ${metadata.version} (${data.license || metadata.license})`, '', readFileSync(source, 'utf8').trim(), '');
}
notices.push('='.repeat(72), 'pyJianYingDraft draft templates (Apache-2.0)', 'Copyright 2024 Gary Guan', 'https://github.com/GuanYixuan/pyJianYingDraft', '', readFileSync(path.join(root,'licenses/pyJianYingDraft-APACHE-2.0.txt'),'utf8').trim(), '');
notices.push('Electron and Chromium notices are distributed separately as LICENSE and LICENSES.chromium.html in the application archive.', '');
writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n'), 'utf8');
console.log(`Wrote notices for ${packages.length} runtime packages.`);
