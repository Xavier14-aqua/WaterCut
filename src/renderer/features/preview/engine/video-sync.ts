// Initial positioning belongs to metadata/jump. Drift correction must never
// seek a paused picture while music is still preparing: seeking would cancel
// that preparation through the video's buffering handlers on every frame.
export function correctPlayingVideo(
  player: Pick<HTMLMediaElement, 'currentTime' | 'paused' | 'seeking' | 'readyState'>,
  targetSeconds: number,
  clockRunning: boolean,
) {
  if (!clockRunning || player.paused || player.seeking || player.readyState < 2) return;
  // A rough-cut preview tolerates decoder timestamp rounding at startup. Tiny
  // discrepancies must not turn into repeated seek/wait/resume cycles.
  if (Math.abs(player.currentTime - targetSeconds) > .25) player.currentTime = targetSeconds;
}
