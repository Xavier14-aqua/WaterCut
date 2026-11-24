import { z } from 'zod';

export const nameSchema = z.string().trim().min(1).max(100);

export const shotSchema = z.object({
  description: z.string().trim().min(1).max(4000),
  actionDialogue: z.string().max(4000).default(''),
  durationMs: z.number().int().min(100).max(600000),
});
