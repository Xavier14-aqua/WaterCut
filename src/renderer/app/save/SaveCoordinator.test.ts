import { afterEach, expect, test, vi } from 'vitest';
import type { Project } from '../../../shared/models';
import { SaveCoordinator } from './SaveCoordinator';

afterEach(() => {
  vi.useRealTimers();
});
const project = (id: string) => ({ id }) as Project;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup() {
  let current = 'a';
  const apply = vi.fn();
  const notify = vi.fn();
  const queue = new SaveCoordinator({
    currentProjectId: () => current,
    apply,
    notify,
    formatError: String,
  });
  return {
    queue,
    apply,
    notify,
    select: (id: string) => {
      current = id;
    },
  };
}

test('coalesces a field within its project without dropping another project write', async () => {
  const { queue, apply } = setup();
  const old = vi.fn(async () => project('a'));
  const latest = vi.fn(async () => project('a'));
  const other = vi.fn(async () => project('b'));
  queue.schedule('a', 'shot:1', old);
  queue.schedule('a', 'shot:1', latest);
  queue.schedule('b', 'shot:1', other);
  await queue.flush();
  expect(old).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledOnce();
  expect(other).toHaveBeenCalledOnce();
  expect(apply).toHaveBeenCalledExactlyOnceWith(project('a'));
});

test('flush waits for an active write before saving pending changes', async () => {
  vi.useFakeTimers();
  const { queue } = setup(),
    first = deferred<Project>(),
    order: string[] = [];
  queue.schedule('a', 'first', async () => {
    order.push('first');
    return first.promise;
  });
  await vi.advanceTimersByTimeAsync(500);
  queue.schedule('a', 'second', async () => {
    order.push('second');
    return project('a');
  });
  let flushed = false;
  const barrier = queue.flush().then(() => {
    flushed = true;
  });
  await Promise.resolve();
  expect(order).toEqual(['first']);
  expect(flushed).toBe(false);
  first.resolve(project('a'));
  await barrier;
  expect(order).toEqual(['first', 'second']);
  expect(flushed).toBe(true);
});

test('failed writes remain retryable and block the save barrier', async () => {
  const { queue, apply } = setup();
  const write = vi
    .fn()
    .mockRejectedValueOnce(new Error('disk full'))
    .mockResolvedValue(project('a'));
  queue.schedule('a', 'field', write);
  await expect(queue.flush()).rejects.toThrow('部分编辑尚未保存');
  expect(queue.hasPending('a', 'field')).toBe(true);
  await queue.flush();
  expect(write).toHaveBeenCalledTimes(2);
  expect(apply).toHaveBeenCalledOnce();
  expect(queue.hasPending('a', 'field')).toBe(false);
});

test('late responses do not replace the newly selected project', async () => {
  const { queue, apply, select } = setup(),
    pending = deferred<Project>();
  queue.schedule('a', 'field', () => pending.promise);
  const barrier = queue.flush();
  select('b');
  pending.resolve(project('a'));
  await barrier;
  expect(apply).not.toHaveBeenCalled();
});

test('an old failure cannot overwrite a newer pending edit', async () => {
  vi.useFakeTimers();
  const { queue, apply } = setup(),
    older = deferred<Project>();
  const newest = { ...project('a'), revision: 9 };
  queue.schedule('a', 'field', () => older.promise);
  await vi.advanceTimersByTimeAsync(500);
  queue.schedule('a', 'field', async () => newest);
  older.reject(new Error('old write failed'));
  await vi.advanceTimersByTimeAsync(0);
  await queue.flush();
  expect(apply).toHaveBeenCalledExactlyOnceWith(newest);
});
