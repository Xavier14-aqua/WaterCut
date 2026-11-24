import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalText,
  counts,
  hash,
  sqlFingerprints,
} from './source-invariants.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const baseline = JSON.parse(
  fs.readFileSync(
    path.join(root, 'tests/fixtures/source-invariants.json'),
    'utf8',
  ),
);
const errors = [];
for (const file of baseline.files) {
  const actual = hash(
    canonicalText(fs.readFileSync(path.join(root, file.path), 'utf8')),
  );
  if (actual !== file.sha256)
    errors.push(`Reference template/fixture changed: ${file.path}`);
}
const fingerprints = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.tsx?$/.test(file) && !/\.test\./.test(file))
      fingerprints.push(
        ...sqlFingerprints(fs.readFileSync(file, 'utf8'), file),
      );
  }
}
walk(path.join(root, 'src'));
const actualSQL = counts(fingerprints);
if (JSON.stringify(actualSQL) !== JSON.stringify(baseline.sql)) {
  const missing = Object.keys(baseline.sql).filter(
    (key) => baseline.sql[key] !== actualSQL[key],
  );
  const added = Object.keys(actualSQL).filter(
    (key) => actualSQL[key] !== baseline.sql[key],
  );
  errors.push(
    `SQL statements changed from the refactor baseline: ${missing.length} missing/different, ${added.length} added/different`,
  );
}
const report = {
  sourceCommit: baseline.sourceCommit,
  referenceFiles: baseline.files.length,
  sqlStatements: fingerprints.length,
  errors,
};
const output = path.join(root, 'out/review-architecture');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(
  path.join(output, 'integrity.json'),
  JSON.stringify(report, null, 2) + '\n',
);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Source integrity passed: ${report.referenceFiles} reference files and ${report.sqlStatements} SQL values match the baseline.`,
  );
