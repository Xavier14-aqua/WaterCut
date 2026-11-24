import { afterEach, expect, test } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writePackageZip as writePackageZipJob } from './package-zip';
import { testFileJobs } from '../../../tests/support/file-jobs';

const roots: string[] = [];
const jobs = testFileJobs();
const writePackageZip = jobs.wrap(writePackageZipJob, 3);
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-zip-'));
  roots.push(root);
  const file = path.join(root, 'source.bin'),
    target = path.join(root, 'package.partial');
  writeFileSync(file, Buffer.alloc(1024 * 1024, 65));
  return { root, file, target };
}
afterEach(async () => {
  await jobs.stop();
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith('watercut-zip-')
    )
      throw new Error('Unsafe fixture cleanup');
    rmSync(root, { recursive: true, force: true });
  }
});

test.each(['unsafe', 'missing'] as const)(
  'ZIP preflight %s failure leaves no output task or partial file',
  async (kind) => {
    const f = fixture();
    await expect(
      writePackageZip(
        [
          { path: 'assets/first.bin', file: f.file },
          {
            path: kind === 'unsafe' ? '../escape.bin' : 'assets/missing.bin',
            file: kind === 'missing' ? f.file + '.absent' : f.file,
          },
        ],
        Buffer.from('{}'),
        f.target,
      ),
    ).rejects.toThrow();
    expect(existsSync(f.target)).toBe(false);
    expect(() => renameSync(f.file, f.file + '.moved')).not.toThrow();
  },
);

test('ZIP setup failure after opening the target settles the output before returning', async () => {
  const f = fixture();
  await expect(
    writePackageZip(
      [{ path: 'assets/source.bin', file: f.file }],
      null as unknown as Buffer,
      f.target,
    ),
  ).rejects.toThrow();
  await jobs.stop();
  // Replacing the failed output is safe immediately after the rejected job.
  if (existsSync(f.target)) rmSync(f.target);
  writeFileSync(f.target, 'replacement', { flag: 'wx' });
  expect(readFileSync(f.target, 'utf8')).toBe('replacement');
});

test('a source that disappears after preflight rejects the observed output task', async () => {
  const f = fixture();
  const task = writePackageZipJob(
    [{ path: 'assets/source.bin', file: f.file }],
    Buffer.from('{}'),
    f.target,
  );
  const rejected = expect(task).rejects.toThrow();
  rmSync(f.file);
  await rejected;
  if (existsSync(f.target))
    expect(() => renameSync(f.target, f.target + '.failed')).not.toThrow();
});

test('an existing output stays unchanged when ZIP output creation fails', async () => {
  const f = fixture();
  writeFileSync(f.target, 'existing output');
  await expect(
    writePackageZip(
      [{ path: 'assets/source.bin', file: f.file }],
      Buffer.from('{}'),
      f.target,
    ),
  ).rejects.toThrow();
  expect(readFileSync(f.target, 'utf8')).toBe('existing output');
  expect(() => renameSync(f.file, f.file + '.moved')).not.toThrow();
});

test('fixture shutdown cancels and drains an unfinished ZIP before removing its files', async () => {
  const f = fixture();
  writeFileSync(f.file, Buffer.alloc(16 * 1024 * 1024, 65));
  const task = writePackageZip(
    [{ path: 'source.bin', file: f.file }],
    Buffer.from('{}'),
    f.target,
  );
  const rejected = expect(task).rejects.toThrow();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await jobs.stop();
  await rejected;
  expect(() => renameSync(f.file, f.file + '.moved')).not.toThrow();
  if (existsSync(f.target))
    expect(() => renameSync(f.target, f.target + '.cancelled')).not.toThrow();
});
