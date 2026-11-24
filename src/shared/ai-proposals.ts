import { z } from 'zod';
import { uuid } from './schemas';
import type { DraftShot } from './models';
const shot = z.object({
  description: z.string().trim().min(1).max(4000),
  actionDialogue: z.string().max(4000),
  durationMs: z.number().int().min(100).max(600000),
});
export const outlineResponse = z.object({
  routes: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        summary: z.string().max(2000),
        shots: z.array(shot).min(3).max(10),
      }),
    )
    .min(2)
    .max(3),
});
export const visualResponse = z.object({
  suggestions: z
    .array(
      z.object({
        shotKey: z.string().max(50),
        description: z.string().trim().min(1).max(4000),
        shotSize: z.string().max(100),
        movement: z.string().max(100),
        reason: z.string().max(2000),
      }),
    )
    .min(1)
    .max(30),
});
export const reviewResponse = z.object({
  issues: z
    .array(
      z.object({
        shotKey: z.string().max(50),
        issueType: z.enum(['logic', 'shot-size', 'pace', 'missing']),
        explanation: z.string().max(2000),
        suggestedAction: z.string().max(2000),
        insertShot: shot.nullable(),
      }),
    )
    .max(100),
});
export type ProposalKind = 'outline' | 'visual' | 'review';
export type SuggestionState = 'pending' | 'applied' | 'dismissed' | 'stale';
export type AITextInput = {
  ideas: Array<{ key: string; text: string; tags: string; notes: string }>;
  shots: Array<{
    key: string;
    description: string;
    actionDialogue: string;
    durationMs: number;
    shotSize: string;
    movement: string;
  }>;
};
export type AIRequest = {
  kind: ProposalKind;
  ideaIds: string[];
  shotIds: string[];
};
export const requestSchema = z
  .object({
    kind: z.enum(['outline', 'visual', 'review']),
    ideaIds: z.array(uuid).max(30).default([]),
    shotIds: z.array(uuid).max(100).default([]),
  })
  .refine(
    (v) => (v.kind === 'outline' ? v.ideaIds.length > 0 : v.shotIds.length > 0),
    '请选择灵感或目标镜头',
  );
export type AIProposal = {
  id: string;
  kind: ProposalKind;
  baseRevision: number;
  createdAt: string;
  status: SuggestionState;
  sourceIdeaIds: string[];
  baseline: Array<{
    id: string;
    description: string;
    actionDialogue: string;
    shotSize: string;
    movement: string;
  }>;
  routes?: Array<{ title: string; summary: string; shots: DraftShot[] }>;
  suggestions?: Array<{
    shotId: string;
    description: string;
    shotSize: string;
    movement: string;
    reason: string;
    state: SuggestionState;
  }>;
  issues?: Array<{
    shotId: string;
    issueType: string;
    explanation: string;
    suggestedAction: string;
    insertShot: DraftShot | null;
    state: SuggestionState;
  }>;
};
export function responseSchema(kind: ProposalKind) {
  return kind === 'outline'
    ? outlineResponse
    : kind === 'visual'
      ? visualResponse
      : reviewResponse;
}
export function proposalIsPending(proposal: AIProposal) {
  return proposal.status === 'pending';
}
const state = z.enum(['pending', 'applied', 'dismissed', 'stale']);
export const storedProposalSchema = z
  .object({
    id: uuid,
    kind: z.enum(['outline', 'visual', 'review']),
    baseRevision: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    status: state,
    sourceIdeaIds: z.array(uuid).max(30),
    baseline: z
      .array(
        z.object({
          id: uuid,
          description: z.string().max(4000),
          actionDialogue: z.string().max(4000),
          shotSize: z.string().max(100),
          movement: z.string().max(100),
        }),
      )
      .max(100),
    routes: outlineResponse.shape.routes.optional(),
    suggestions: z
      .array(
        visualResponse.shape.suggestions.element
          .omit({ shotKey: true })
          .extend({ shotId: uuid, state }),
      )
      .max(30)
      .optional(),
    issues: z
      .array(
        reviewResponse.shape.issues.element
          .omit({ shotKey: true })
          .extend({ shotId: uuid, state }),
      )
      .max(100)
      .optional(),
  })
  .refine(
    (p) =>
      p.kind === 'outline'
        ? !!p.routes
        : p.kind === 'visual'
          ? !!p.suggestions
          : !!p.issues,
    '建议记录内容不完整',
  );
