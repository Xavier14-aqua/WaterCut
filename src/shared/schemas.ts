import { z } from 'zod';
export const uuid = z.string().uuid();
export const payloadSchema = z.object({
  colors: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).max(6).default([]),
  rhythm: z.string().max(1000).default(''),
  timeOfDay: z.string().max(100).default(''),
  weather: z.string().max(100).default(''),
  environment: z.string().max(200).default(''),
  location: z.string().max(200).default(''),
  props: z.string().max(500).default('')
});
export const mediaSchema = z.object({
  assetId: uuid,
  role: z.enum(['image', 'video', 'audio']),
  position: z.number().int().min(0).max(50),
  inMs: z.number().int().min(0),
  outMs: z.number().int().positive().nullable()
}).refine(v => v.outMs === null || v.outMs > v.inMs, '参考片段出点必须晚于入点');
export const ideaSchema = z.object({
  kind: z.enum(['note', 'mood', 'scene']).default('note'),
  text: z.string().trim().min(1).max(4000),
  tags: z.string().max(500).default(''),
  notes: z.string().max(4000).default(''),
  payload: payloadSchema.default({
    colors: [],
    rhythm: '',
    timeOfDay: '',
    weather: '',
    environment: '',
    location: '',
    props: ''
  }),
  occurredAt: z.string().datetime({
    offset: true
  }).nullable().default(null).transform(value => value ? new Date(value).toISOString() : null),
  media: z.array(mediaSchema).max(20).default([])
}).refine(v => v.kind !== 'mood' || v.media.filter(m => m.role === 'image').length <= 3, '情绪卡最多关联三张参考图');
export const shotMetadataSchema = z.object({
  props:z.string().max(500).default(''),
  productionState:z.enum(['planned','filmed','pickup']).default('planned'),
  scene: z.string().max(200),
  timeOfDay: z.string().max(100),
  shotSize: z.string().max(100),
  movement: z.string().max(100),
  status: z.enum(['idea', 'written', 'to_shoot', 'ready', 'locked']),
  needsReview: z.boolean(),
  reviewNote: z.string().max(2000)
});
export function tagsOf(text: string): string[] {
  return [...new Set(text.normalize('NFKC').split(/[,，;；\n#]+/).map(t => t.trim().toLocaleLowerCase()).filter(Boolean))];
}
