import { beforeEach } from 'vitest';
import {
  checkCancelled,
  type JobOptions,
} from '../../src/infrastructure/jobs/file-jobs';

// Timed-out async tests keep executing until their I/O observes cancellation.
// Track the whole operation, including its finally, before deleting fixtures.
export function testFileJobs() {
  let controller: AbortController;
  let testSignal: AbortSignal;
  const pending = new Set<Promise<unknown>>();
  beforeEach(({ signal }) => {
    controller = new AbortController();
    testSignal = signal;
  });
  return {
    wrap<Args extends unknown[], Result>(
      operation: (...args: Args) => Promise<Result>,
      optionsIndex: number,
    ) {
      return (...args: Args): Promise<Result> => {
        const options = (args[optionsIndex] ?? {}) as JobOptions;
        const signal = AbortSignal.any([
          controller.signal,
          testSignal,
          ...(options.signal ? [options.signal] : []),
        ]);
        args[optionsIndex] = { ...options, signal };
        const task = Promise.resolve().then(() => {
          checkCancelled(signal);
          return operation(...args);
        });
        pending.add(task);
        void task.then(
          () => pending.delete(task),
          () => pending.delete(task),
        );
        return task;
      };
    },
    async stop() {
      controller.abort();
      while (pending.size) await Promise.allSettled([...pending]);
    },
  };
}
