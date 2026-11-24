import { expect, test, vi } from 'vitest';
import { createFileJobs } from './file-job-registry';

test('cancelled file work retains window ownership until the operation settles', async () => {
  const jobs = createFileJobs(),
    owner = { id: 1, isDestroyed: () => false, send: vi.fn() };
  let reject!: (error: Error) => void;
  let cancelled = false;
  const result = jobs.importJob(owner, (options) => {
    options.signal.addEventListener('abort', () => {
      cancelled = true;
    });
    return new Promise((_resolve, no) => {
      reject = no;
    });
  });
  await expect(jobs.importJob(owner, async () => 'second')).rejects.toThrow(
    '已有导入任务',
  );
  jobs.activeImports.get(owner.id)!.abort();
  expect(cancelled).toBe(true);
  await expect(jobs.importJob(owner, async () => 'early')).rejects.toThrow(
    '已有导入任务',
  );
  reject(new Error('stream closed after cancellation'));
  await expect(result).resolves.toBeNull();
  await expect(jobs.importJob(owner, async () => 'next')).resolves.toBe('next');
});

test('a failed file operation releases ownership and preserves the failure', async () => {
  const jobs = createFileJobs(),
    owner = { id: 2, isDestroyed: () => false, send: vi.fn() };
  await expect(
    jobs.importJob(owner, async () => {
      throw new Error('disk full');
    }),
  ).rejects.toThrow('disk full');
  await expect(jobs.importJob(owner, async () => 'retry')).resolves.toBe(
    'retry',
  );
});

test('progress is not sent to a destroyed window', async () => {
  const jobs = createFileJobs(),
    owner = { id: 3, isDestroyed: () => true, send: vi.fn() };
  await jobs.importJob(owner, async (options) => {
    options.onProgress({ copied: 1, total: 1 });
    return 'done';
  });
  expect(owner.send).not.toHaveBeenCalled();
});
