import type { MediaMetadata } from './models';
export const MEDIAINFO_VERSION = '0.3.9';
export const MEDIAINFO_WASM_SHA256 =
  '8849ed8de015e78349a262f08ea9995ae67aa2af5678f80c011cb7e8117c46bd';
export function normalizeMediaInfo(result: unknown): MediaMetadata {
  const tracks: any[] = (result as any)?.media?.track ?? [];
  const general = tracks.find((t) => t['@type'] === 'General') ?? {};
  const number = (v: unknown) => {
    const n = Number(v);
    return v != null && Number.isFinite(n) && n > 0 ? n : null;
  };
  const rational = (n: unknown, d: unknown) => {
    const a = number(n),
      b = number(d);
    return a && b && Number.isInteger(a) && Number.isInteger(b)
      ? {
          numerator: a,
          denominator: b,
        }
      : null;
  };
  const streams = tracks
    .filter((t) => ['Video', 'Audio', 'Image'].includes(t['@type']))
    .map((t) => {
      let fps = rational(t.FrameRate_Num, t.FrameRate_Den);
      if (!fps && /^\d+(?:\.\d{1,6})?$/.test(String(t.FrameRate ?? ''))) {
        const decimal = String(t.FrameRate),
          places = decimal.split('.')[1]?.length ?? 0,
          denominator = 10 ** places,
          numerator = Math.round(Number(decimal) * denominator);
        const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
        const divisor = gcd(numerator, denominator);
        if (numerator > 0)
          fps = {
            numerator: numerator / divisor,
            denominator: denominator / divisor,
          };
      }
      const base =
        typeof t.TimeBase === 'string'
          ? t.TimeBase.match(/^(\d+)\s*\/\s*(\d+)$/)
          : null;
      return {
        type: t['@type'].toLowerCase() as 'video' | 'audio' | 'image',
        codec: String(t.CodecID ?? t.Format ?? '').slice(0, 256) || null,
        frameRate: fps,
        timeBase: base ? rational(base[1], base[2]) : null,
        variableFrameRate: t.FrameRate_Mode === 'VFR',
        sampleRate: number(t.SamplingRate),
        channels: number(t.Channels),
      };
    });
  const visual =
    tracks.find((t) => ['Video', 'Image'].includes(t['@type'])) ?? {};
  const duration =
    number(general.Duration) ??
    number(visual.Duration) ??
    number(tracks.find((t) => t['@type'] === 'Audio')?.Duration);
  return {
    probe: 'mediainfo',
    version: MEDIAINFO_VERSION,
    status: streams.length ? 'ready' : 'failed',
    probedAt: new Date().toISOString(),
    durationMs:
      duration && duration <= 7 * 86400 ? Math.round(duration * 1000) : null,
    width: number(visual.Width),
    height: number(visual.Height),
    format: String(general.Format ?? visual.Format ?? '').slice(0, 256) || null,
    streams,
    error: streams.length ? null : '未识别出可用的音视频或图像流，原件仍保留',
  };
}
export function failedMedia(error: unknown): MediaMetadata {
  return {
    probe: 'mediainfo',
    version: MEDIAINFO_VERSION,
    status: 'failed',
    probedAt: new Date().toISOString(),
    durationMs: null,
    width: null,
    height: null,
    format: null,
    streams: [],
    error: String(error instanceof Error ? error.message : error).slice(
      0,
      2000,
    ),
  };
}
