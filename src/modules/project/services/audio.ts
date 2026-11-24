import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { uuid } from '../../../shared/schemas';

import {
  audioClipSchema,
  timelineSettingsSchema,
  validateMediaRange,
} from '../../../shared/creative';

import type { Project } from '../../../shared/models';

import { readProject } from '../repositories/read-project';

import { mutateProject } from '../transaction';

export function saveAudioClip(directory: string, input: unknown): Project {
  const raw = z
    .object({
      id: uuid.optional(),
      assetId: uuid,
      timelineStartMs: z.number(),
      inMs: z.number(),
      outMs: z.number(),
      gain: z.number(),
      fadeInMs: z.number(),
      fadeOutMs: z.number(),
    })
    .parse(input);
  const value = audioClipSchema.parse({ ...raw, id: raw.id ?? randomUUID() }),
    project = readProject(directory),
    asset = project.assets.find((a) => a.id === value.assetId);
  if (!asset) throw new Error('音频素材不存在');
  validateMediaRange(asset, value.inMs, value.outMs, 'audio');
  return mutateProject(directory, (db) => {
    if (
      raw.id &&
      !db.prepare('SELECT 1 FROM audio_clips WHERE id=?').get(raw.id)
    )
      throw new Error('BGM 片段已不存在');
    if (
      !raw.id &&
      (db.prepare('SELECT count(*) AS n FROM audio_clips').get() as any).n >=
        128
    )
      throw new Error('BGM 片段最多 128 条');
    db.prepare(
      'INSERT INTO audio_clips VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET asset_id=excluded.asset_id,timeline_start_ms=excluded.timeline_start_ms,in_ms=excluded.in_ms,out_ms=excluded.out_ms,gain=excluded.gain,fade_in_ms=excluded.fade_in_ms,fade_out_ms=excluded.fade_out_ms',
    ).run(
      value.id,
      value.assetId,
      value.timelineStartMs,
      value.inMs,
      value.outMs,
      value.gain,
      value.fadeInMs,
      value.fadeOutMs,
    );
  });
}

export function deleteAudioClip(directory: string, id: string): Project {
  return mutateProject(directory, (db) => {
    if (
      !db.prepare('DELETE FROM audio_clips WHERE id=?').run(uuid.parse(id))
        .changes
    )
      throw new Error('BGM 片段已不存在');
  });
}

export function saveTimelineSettings(
  directory: string,
  input: unknown,
): Project {
  const v = timelineSettingsSchema.parse(input);
  return mutateProject(directory, (db) => {
    db.prepare(
      'UPDATE timeline_settings SET width=?,height=?,fps_num=?,fps_den=?,video_gain=?,bgm_gain=? WHERE id=1',
    ).run(v.width, v.height, v.fpsNum, v.fpsDen, v.videoGain, v.bgmGain);
  });
}
