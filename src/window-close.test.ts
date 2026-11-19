import { afterEach, expect, test, vi } from 'vitest';
import { WindowCloseGuard } from './window-close';

afterEach(() => vi.useRealTimers());

function fixture() {
  vi.useFakeTimers();
  const requestSave = vi.fn(), confirmExit = vi.fn(async () => false), close = vi.fn(), forceClose = vi.fn();
  const guard = new WindowCloseGuard({ requestSave, confirmExit, close, forceClose });
  return { guard, requestSave, confirmExit, close, forceClose };
}

test('normal close waits for saved edits and permits exactly the approved close', async () => {
  const f = fixture();
  expect(f.guard.allowClose()).toBe(false);
  expect(f.requestSave).toHaveBeenCalledWith(1);
  f.guard.acknowledge(1, true);
  expect(f.close).toHaveBeenCalledOnce();
  expect(f.guard.allowClose()).toBe(true);
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.confirmExit).not.toHaveBeenCalled();
});

test('a silent renderer offers native exit but never exits without confirmation', async () => {
  const f = fixture();
  f.guard.allowClose();
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.confirmExit).toHaveBeenCalledOnce();
  expect(f.forceClose).not.toHaveBeenCalled();
  f.guard.acknowledge(1, true);
  expect(f.close).toHaveBeenCalledOnce();
  f.guard.dispose();
});

test('confirmed exit releases a close request even when the renderer never replies', async () => {
  const f = fixture();
  f.confirmExit.mockResolvedValue(true);
  f.guard.allowClose();
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.forceClose).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(15000);
  expect(f.confirmExit).toHaveBeenCalledOnce();
});

test('a crashed renderer offers native exit immediately', async () => {
  const f = fixture();
  f.confirmExit.mockResolvedValue(true);
  f.guard.markUnavailable();
  expect(f.guard.allowClose()).toBe(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.requestSave).not.toHaveBeenCalled();
  expect(f.forceClose).toHaveBeenCalledOnce();
});

test('late replies from a cancelled request cannot close a newer request', () => {
  const f = fixture();
  f.guard.allowClose();
  f.guard.acknowledge(1, false);
  f.guard.allowClose();
  f.guard.acknowledge(1, true);
  expect(f.close).not.toHaveBeenCalled();
  f.guard.acknowledge(2, true);
  expect(f.close).toHaveBeenCalledOnce();
  f.guard.dispose();
});

test('repeated close clicks cannot open duplicate dialogs', async () => {
  const f = fixture();
  let answer!: (value: boolean) => void;
  f.confirmExit.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
  f.guard.allowClose();
  f.guard.allowClose();
  f.guard.allowClose();
  expect(f.confirmExit).toHaveBeenCalledOnce();
  answer(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.forceClose).not.toHaveBeenCalled();
  f.guard.dispose();
});

test('completed saves invalidate an outstanding force-exit dialog', async () => {
  const f = fixture();
  let answer!: (value: boolean) => void;
  f.confirmExit.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
  f.guard.allowClose();
  f.guard.allowClose();
  f.guard.acknowledge(1, true);
  answer(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.close).toHaveBeenCalledOnce();
  expect(f.forceClose).not.toHaveBeenCalled();
  f.guard.dispose();
});

test('destroying a window clears its timeout and ignores late approvals', async () => {
  const f = fixture();
  f.guard.allowClose();
  f.guard.dispose();
  f.guard.acknowledge(1, true);
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.confirmExit).not.toHaveBeenCalled();
  expect(f.close).not.toHaveBeenCalled();
});
