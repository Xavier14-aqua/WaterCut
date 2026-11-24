import { z } from 'zod';

import { PACKAGE_LIMITS } from '../../../infrastructure/files/package-zip';

export const fileSchema = z.object({
  path: z.string().max(240),
  size: z.number().int().nonnegative().max(PACKAGE_LIMITS.fileBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const manifestSchema = z.object({
  format: z.literal('WaterCutProject'),
  packageVersion: z.literal(1),
  projectFormatVersion: z.union([z.literal(9), z.literal(10), z.literal(11)]),
  projectId: z.string().uuid(),
  createdAt: z.string().datetime(),
  includeHistory: z.boolean(),
  includeMedia: z.boolean(),
  complete: z.boolean(),
  files: z.array(fileSchema).max(PACKAGE_LIMITS.entries - 1),
  missing: z
    .array(
      z.object({
        assetId: z.string().uuid(),
        name: z.string().max(1024),
        reason: z.string().max(256),
        path: z.string().max(240),
      }),
    )
    .max(50000),
});

export type Missing = z.infer<typeof manifestSchema>['missing'][number];
