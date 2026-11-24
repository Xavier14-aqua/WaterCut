import { z } from 'zod';
import type { Project } from './models';
import { payloadSchema, uuid } from './schemas';
import {
  audioClipSchema,
  timelineSettingsSchema,
  defaultTimelineSettings,
  knownDuration,
} from './creative';
const text = z.string().max(4000);
const time = z
  .number()
  .int()
  .nonnegative()
  .max(7 * 86400000);
const rational = z
  .object({
    numerator: z.number().int().positive(),
    denominator: z.number().int().positive(),
  })
  .nullable();
export const metadataSchema = z.object({
  probe: z.literal('mediainfo'),
  version: z.string().max(100),
  status: z.enum(['ready', 'failed']),
  probedAt: z.string().max(100),
  durationMs: time.nullable(),
  width: z.number().int().positive().max(100000).nullable(),
  height: z.number().int().positive().max(100000).nullable(),
  format: z.string().max(256).nullable(),
  streams: z
    .array(
      z.object({
        type: z.enum(['video', 'audio', 'image']),
        codec: z.string().max(256).nullable(),
        frameRate: rational,
        timeBase: rational,
        variableFrameRate: z.boolean(),
        sampleRate: z.number().positive().nullable(),
        channels: z.number().positive().nullable(),
      }),
    )
    .max(256),
  error: z.string().max(2000).nullable(),
});
const media = z.object({
  assetId: uuid,
  role: z.enum(['image', 'video', 'audio']),
  position: z.number().int().nonnegative(),
  inMs: time,
  outMs: time.nullable(),
});
const asset = z.object({
  id: uuid,
  name: z.string().max(1024),
  kind: z.enum(['video', 'image', 'audio']),
  relativePath: z.string().max(2048),
  size: z
    .number()
    .int()
    .nonnegative()
    .max(10 * 1024 ** 3),
  tags: z.string().max(500),
  storageKind: z.enum(['local', 'library']),
  sourceLibraryId: uuid.nullable(),
  sourceAssetId: uuid.nullable(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  durationMs: time.nullable(),
  starred: z.boolean(),
  importedAt: z.string().max(100).nullable(),
  missing: z.boolean(),
  thumbnail: z.boolean(),
  metadata: metadataSchema.nullable().optional(),
});
const doc = z.object({
  audioClips: z.array(audioClipSchema).max(128).default([]),
  timelineSettings: timelineSettingsSchema.default(defaultTimelineSettings),
  ideaBoxes: z
    .array(
      z.object({
        id: uuid,
        name: z.string().trim().min(1).max(80),
        position: z.number().int().nonnegative(),
      }),
    )
    .max(1000)
    .default([]),
  name: z.string().trim().min(1).max(100),
  archived: z.boolean(),
  shots: z
    .array(
      z.object({
        props: z.string().max(500).default(''),
        productionState: z
          .enum(['planned', 'filmed', 'pickup'])
          .default('planned'),
        id: uuid,
        position: z.number().int().nonnegative(),
        description: text,
        actionDialogue: text,
        durationMs: z.number().int().min(100).max(600000),
        scene: z.string().max(200),
        timeOfDay: z.string().max(100),
        shotSize: z.string().max(100),
        movement: z.string().max(100),
        status: z.enum(['idea', 'written', 'to_shoot', 'ready', 'locked']),
        needsReview: z.boolean(),
        reviewNote: z.string().max(2000),
      }),
    )
    .max(10000),
  assets: z.array(asset).max(10000),
  ideas: z
    .array(
      z.object({
        boxId: uuid.nullable().default(null),
        id: uuid,
        kind: z.enum(['note', 'mood', 'scene']),
        text,
        tags: z.string().max(500),
        notes: text,
        payload: payloadSchema,
        occurredAt: z.string().max(100).nullable(),
        recordedAt: z.string().max(100).nullable(),
        sourceAssetId: uuid.nullable(),
        sourceLibraryId: uuid.nullable(),
        sourceIdeaId: uuid.nullable(),
        sourceVersion: z.number().int().positive().nullable(),
        x: z.number().finite().min(-1e7).max(1e7),
        y: z.number().finite().min(-1e7).max(1e7),
        media: z.array(media).max(50),
      }),
    )
    .max(10000),
  boardEdges: z
    .array(
      z.object({
        id: uuid,
        source: uuid,
        target: uuid,
        sourceHandle: z.enum(['top', 'right', 'bottom', 'left']),
        targetHandle: z.enum(['top', 'right', 'bottom', 'left']),
        label: z.string().max(1000),
        kind: z.enum(['related', 'sequence', 'contrast']),
      }),
    )
    .max(50000),
  shotAssets: z
    .array(
      z.object({
        sourceSelectId: uuid.nullable().default(null),
        sourceSelectVersion: z
          .number()
          .int()
          .positive()
          .nullable()
          .default(null),
        sourceSelectName: z.string().max(100).nullable().default(null),
        shotId: uuid,
        assetId: uuid,
        inMs: time,
        outMs: time.nullable(),
      }),
    )
    .max(10000),
  shotAudio: z
    .array(
      z.object({
        shotId: uuid,
        assetId: uuid,
      }),
    )
    .max(10000),
  shotCandidates: z
    .array(
      z.object({
        shotId: uuid,
        assetId: uuid,
      }),
    )
    .max(100000),
  scriptBlocks: z
    .array(
      z.object({
        id: uuid,
        position: z.number().int().nonnegative(),
        kind: z.enum(['body', 'heading', 'note']),
        text,
        shotId: uuid.nullable(),
      }),
    )
    .max(30000),
  shotSources: z
    .array(
      z.object({
        shotId: uuid,
        ideaId: uuid.nullable(),
        excerpt: text,
      }),
    )
    .max(100000),
});
export type ProjectDocument = Omit<Project, 'id' | 'revision' | 'directory'>;
export function validateDocument(input: unknown): ProjectDocument {
  const value = doc.parse(input);
  const sets = [
    value.shots,
    value.assets,
    value.ideas,
    value.scriptBlocks,
    value.boardEdges,
    value.ideaBoxes,
  ].map((rows) => {
    const ids = new Set(rows.map((r) => r.id));
    if (ids.size !== rows.length) throw new Error('项目中存在重复对象 ID');
    return ids;
  });
  const [shots, assets, ideas] = sets;
  function requireRef(valid: boolean) {
    if (!valid) throw new Error('项目引用不完整');
  }
  const visual = new Set(
    value.assets.filter((a) => a.kind !== 'audio').map((a) => a.id),
  );
  for (const s of value.shots) requireRef(s.position < value.shots.length);
  requireRef(
    new Set(value.shots.map((s) => s.position)).size === value.shots.length,
  );
  for (const b of [...value.shotCandidates, ...value.shotAssets])
    requireRef(shots.has(b.shotId) && visual.has(b.assetId));
  for (const b of value.shotAssets)
    requireRef(
      (b.outMs === null || b.outMs > b.inMs) &&
        value.shotCandidates.some(
          (c) => c.shotId === b.shotId && c.assetId === b.assetId,
        ),
    );
  requireRef(
    new Set(value.audioClips.map((c) => c.id)).size === value.audioClips.length,
  );
  for (const clip of value.audioClips) {
    const a = value.assets.find((a) => a.id === clip.assetId),
      duration = a ? knownDuration(a) : null;
    requireRef(
      !!a && a.kind === 'audio' && !!duration && clip.outMs <= duration,
    );
  }
  for (const b of value.shotAssets)
    requireRef(!!b.sourceSelectId === !!b.sourceSelectVersion);
  for (const b of value.shotAudio)
    requireRef(
      shots.has(b.shotId) &&
        value.assets.some((a) => a.id === b.assetId && a.kind === 'audio'),
    );
  for (const idea of value.ideas) {
    requireRef(!idea.boxId || sets[5].has(idea.boxId));
    requireRef(!idea.sourceAssetId || assets.has(idea.sourceAssetId));
    for (const m of idea.media)
      requireRef(
        value.assets.some((a) => a.id === m.assetId && a.kind === m.role) &&
          (m.outMs === null || m.outMs > m.inMs),
      );
  }
  for (const e of value.boardEdges)
    requireRef(
      ideas.has(e.source) && ideas.has(e.target) && e.source !== e.target,
    );
  for (const s of value.shotSources)
    requireRef(shots.has(s.shotId) && (!s.ideaId || ideas.has(s.ideaId)));
  for (const b of value.scriptBlocks)
    requireRef(!b.shotId || shots.has(b.shotId));
  const linked = value.scriptBlocks
    .filter((b) => b.shotId)
    .map((b) => b.shotId);
  requireRef(
    new Set(value.ideaBoxes.map((b) => b.name.normalize('NFKC').toLowerCase()))
      .size === value.ideaBoxes.length,
  );
  requireRef(
    new Set(linked).size === linked.length &&
      value.shots.every((s) => linked.includes(s.id)),
  );
  return value;
}
export function projectDocument(project: Project): ProjectDocument {
  return validateDocument(project);
}
