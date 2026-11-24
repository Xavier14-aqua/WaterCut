import { expect, test } from 'vitest';
import { correctPlayingVideo } from './video-sync';

test('a held picture never seeks while delayed music is preparing', () => {
  const writes: number[] = [];
  const player = {
    paused: true,
    seeking: false,
    readyState: 4,
    get currentTime() {
      return 0;
    },
    set currentTime(value) {
      writes.push(value);
    },
  };
  for (let frame = 0; frame < 60; frame++)
    correctPlayingVideo(player, 0.1, false);
  expect(writes).toEqual([]);
  player.paused = false;
  correctPlayingVideo(player, 1, false);
  expect(writes).toEqual([]);
});

test('paused, seeking or undecoded video cannot restart buffering through drift correction', () => {
  for (const state of [
    { paused: true, seeking: false, readyState: 4 },
    { paused: false, seeking: true, readyState: 4 },
    { paused: false, seeking: false, readyState: 1 },
  ]) {
    const player = { ...state, currentTime: 0 };
    correctPlayingVideo(player, 2, true);
    expect(player.currentTime).toBe(0);
  }
});

test('decoder timestamp rounding is tolerated and large running drift is corrected once', () => {
  const player = {
    paused: false,
    seeking: false,
    readyState: 4,
    currentTime: 0,
  };
  correctPlayingVideo(player, 0.1, true);
  expect(player.currentTime).toBe(0);
  correctPlayingVideo(player, 1.5, true);
  expect(player.currentTime).toBe(1.5);
});
