import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { openDatabase, readProject, mutateProject } from '../project/index';
import {
  requestSchema,
  responseSchema,
  storedProposalSchema,
  type AIProposal,
  type AIRequest,
  type AITextInput,
} from '../../shared/ai-proposals';
import type { Project } from '../../shared/models';
import { uuid } from '../../shared/schemas';
import {
  checkCancelled,
  type JobOptions,
} from '../../infrastructure/jobs/file-jobs';

export function prepareAIRequest(directory: string, input: unknown) {
  const request = requestSchema.parse(input),
    project = readProject(directory);
  const ideaIds = [...new Set(request.ideaIds)],
    shotIds = [...new Set(request.shotIds)];
  const ideas = ideaIds.map((id) => project.ideas.find((i) => i.id === id)),
    shots = shotIds.map((id) => project.shots.find((s) => s.id === id));
  if (ideas.some((i) => !i) || shots.some((s) => !s))
    throw new Error('所选对象已不存在');
  const text: AITextInput = {
    ideas: ideas.map((i, index) => ({
      key: `idea-${index + 1}`,
      text: i!.text,
      tags: i!.tags,
      notes: i!.notes,
    })),
    shots: shots.map((s, index) => ({
      key: `shot-${index + 1}`,
      description: s!.description,
      actionDialogue: s!.actionDialogue,
      durationMs: s!.durationMs,
      shotSize: s!.shotSize,
      movement: s!.movement,
    })),
  };
  return { request: { ...request, ideaIds, shotIds }, project, text };
}
export function storeAIProposal(
  directory: string,
  base: Project,
  request: AIRequest,
  response: unknown,
  options: JobOptions = {},
): AIProposal {
  checkCancelled(options.signal);
  const parsed: any = responseSchema(request.kind).parse(response),
    current = readProject(directory);
  if (current.id !== base.id) throw new Error('项目身份已改变，请重新生成');
  const baseline = request.shotIds.map((id) => {
    const s = base.shots.find((s) => s.id === id);
    if (!s) throw new Error('基准镜头不存在');
    return {
      id: s.id,
      description: s.description,
      actionDialogue: s.actionDialogue,
      shotSize: s.shotSize,
      movement: s.movement,
    };
  });
  const proposal: AIProposal = {
    id: randomUUID(),
    kind: request.kind,
    baseRevision: base.revision,
    createdAt: new Date().toISOString(),
    status: 'pending',
    sourceIdeaIds: request.ideaIds,
    baseline,
  };
  function shotId(key: string) {
    const match = /^shot-([1-9]\d*)$/.exec(key),
      id = match ? request.shotIds[Number(match[1]) - 1] : undefined;
    if (!id) throw new Error('AI 返回了输入范围外的镜头');
    return id;
  }
  if (request.kind === 'outline') proposal.routes = parsed.routes;
  if (request.kind === 'visual') {
    const used = new Set<string>();
    proposal.suggestions = parsed.suggestions.map((s: any) => {
      const id = shotId(s.shotKey);
      if (used.has(id)) throw new Error('AI 对同一镜头返回了重复建议');
      used.add(id);
      return {
        shotId: id,
        description: s.description,
        shotSize: s.shotSize,
        movement: s.movement,
        reason: s.reason,
        state: 'pending',
      };
    });
  }
  if (request.kind === 'review')
    proposal.issues = parsed.issues.map((s: any) => ({
      shotId: shotId(s.shotKey),
      issueType: s.issueType,
      explanation: s.explanation,
      suggestedAction: s.suggestedAction,
      insertShot: s.insertShot,
      state: 'pending',
    }));
  const payload = JSON.stringify(proposal);
  if (Buffer.byteLength(payload) > 256 * 1024)
    throw new Error('AI 建议内容超过 256 KB，请缩小输入范围');
  const db = openDatabase(directory);
  try {
    if (
      (db.prepare('SELECT count(*) AS n FROM ai_proposals').get() as any).n >=
      100
    )
      throw new Error('建议历史已达 100 条，请先清理旧建议');
    db.prepare('INSERT INTO ai_proposals VALUES (?,?,?,?,?,?)').run(
      proposal.id,
      proposal.kind,
      proposal.baseRevision,
      proposal.createdAt,
      proposal.status,
      payload,
    );
  } finally {
    db.close();
  }
  return proposal;
}
export function listAIProposals(directory: string): AIProposal[] {
  const db = openDatabase(directory);
  try {
    return (
      db
        .prepare(
          'SELECT payload_json FROM ai_proposals WHERE length(CAST(payload_json AS BLOB))<=262144 ORDER BY created_at DESC,id DESC LIMIT 100',
        )
        .all() as any[]
    ).flatMap((r) => {
      try {
        const result = storedProposalSchema.safeParse(
          JSON.parse(r.payload_json),
        );
        return result.success ? [result.data as AIProposal] : [];
      } catch {
        return [];
      }
    });
  } finally {
    db.close();
  }
}
export function deleteAIProposal(directory: string, id: string): void {
  const db = openDatabase(directory);
  try {
    db.prepare('DELETE FROM ai_proposals WHERE id=?').run(uuid.parse(id));
  } finally {
    db.close();
  }
}
export function applyAIProposal(
  directory: string,
  id: string,
  input: unknown,
): Project {
  uuid.parse(id);
  const action = z
    .object({
      mode: z.enum(['route', 'visual', 'mark', 'insert', 'dismiss']),
      index: z.number().int().min(0).max(100).default(0),
      description: z.string().trim().min(1).max(4000).optional(),
      shotSize: z.string().max(100).optional(),
      movement: z.string().max(100).optional(),
    })
    .parse(input);
  return mutateProject(directory, (db) => {
    const row = db
      .prepare('SELECT payload_json FROM ai_proposals WHERE id=?')
      .get(id) as any;
    if (!row) throw new Error('AI 建议已不存在');
    let p: AIProposal;
    try {
      p = storedProposalSchema.parse(
        JSON.parse(row.payload_json),
      ) as AIProposal;
    } catch {
      throw new Error('AI 建议记录已损坏，请重新生成；正式项目未修改');
    }
    if (p.status !== 'pending') throw new Error('这份建议已处理，请重新生成');
    const save = () =>
      db
        .prepare('UPDATE ai_proposals SET status=?,payload_json=? WHERE id=?')
        .run(p.status, JSON.stringify(p), p.id);
    if (action.mode === 'dismiss') {
      p.status = 'dismissed';
      save();
      return;
    }
    if (action.mode === 'route') {
      if (p.kind !== 'outline' || !p.routes?.[action.index])
        throw new Error('路线不存在');
      const revision = (db.prepare('SELECT revision FROM project').get() as any)
        .revision;
      if (revision !== p.baseRevision) {
        p.status = 'stale';
        save();
        return;
      }
      let position = (
        db
          .prepare('SELECT coalesce(max(position),-1)+1 AS n FROM shots')
          .get() as any
      ).n;
      for (const shot of p.routes[action.index].shots) {
        const shotId = randomUUID();
        db.prepare(
          'INSERT INTO shots(id,position,description,action_dialogue,duration_ms) VALUES (?,?,?,?,?)',
        ).run(
          shotId,
          position++,
          shot.description,
          shot.actionDialogue,
          shot.durationMs,
        );
        for (const sourceId of p.sourceIdeaIds) {
          const source = db
            .prepare('SELECT text FROM ideas WHERE id=?')
            .get(sourceId) as any;
          if (source)
            db.prepare('INSERT INTO shot_sources VALUES (?,?,?,?)').run(
              randomUUID(),
              shotId,
              sourceId,
              source.text,
            );
        }
      }
      p.status = 'applied';
      save();
      return;
    }
    const item =
      action.mode === 'visual'
        ? p.suggestions?.[action.index]
        : p.issues?.[action.index];
    if (!item || item.state !== 'pending')
      throw new Error('此条建议已处理或不存在');
    const baseline = p.baseline.find((s) => s.id === item.shotId),
      current = db
        .prepare(
          'SELECT description,action_dialogue,shot_size,movement,position FROM shots WHERE id=?',
        )
        .get(item.shotId) as any;
    if (
      !current ||
      !baseline ||
      current.description !== baseline.description ||
      current.action_dialogue !== baseline.actionDialogue ||
      current.shot_size !== baseline.shotSize ||
      current.movement !== baseline.movement
    ) {
      item.state = 'stale';
      if (
        [...(p.suggestions ?? []), ...(p.issues ?? [])].every(
          (s) => s.state !== 'pending',
        )
      )
        p.status = 'stale';
      save();
      return;
    }
    if (action.mode === 'visual') {
      const s = p.suggestions![action.index];
      db.prepare(
        'UPDATE shots SET description=?,shot_size=?,movement=? WHERE id=?',
      ).run(
        action.description ?? s.description,
        action.shotSize ?? s.shotSize,
        action.movement ?? s.movement,
        s.shotId,
      );
    } else if (action.mode === 'mark') {
      const issue = p.issues![action.index];
      const old = (
        db
          .prepare('SELECT review_note FROM shots WHERE id=?')
          .get(issue.shotId) as any
      ).review_note;
      db.prepare(
        'UPDATE shots SET needs_review=1,review_note=? WHERE id=?',
      ).run(
        `${old ? old + '\n' : ''}${issue.explanation}\n建议：${issue.suggestedAction}`.slice(
          0,
          2000,
        ),
        issue.shotId,
      );
    } else if (action.mode === 'insert') {
      const issue = p.issues![action.index];
      if (!issue.insertShot) throw new Error('此条检查没有补镜草案');
      const shotId = randomUUID(),
        shot = issue.insertShot;
      db.prepare('UPDATE shots SET position=position+1 WHERE position>?').run(
        current.position,
      );
      db.prepare(
        'INSERT INTO shots(id,position,description,action_dialogue,duration_ms,needs_review,review_note) VALUES (?,?,?,?,?,1,?)',
      ).run(
        shotId,
        current.position + 1,
        shot.description,
        shot.actionDialogue,
        shot.durationMs,
        'AI 补镜草案，待创作者检查',
      );
      for (const source of db
        .prepare('SELECT idea_id,excerpt FROM shot_sources WHERE shot_id=?')
        .all(issue.shotId) as any[])
        db.prepare('INSERT INTO shot_sources VALUES (?,?,?,?)').run(
          randomUUID(),
          shotId,
          source.idea_id,
          source.excerpt,
        );
      const sourceBlock = db
        .prepare('SELECT position FROM script_blocks WHERE shot_id=?')
        .get(issue.shotId) as any;
      if (sourceBlock) {
        db.prepare(
          'UPDATE script_blocks SET position=position+1 WHERE position>? AND (shot_id IS NULL OR shot_id<>?)',
        ).run(sourceBlock.position, shotId);
        db.prepare('UPDATE script_blocks SET position=? WHERE shot_id=?').run(
          sourceBlock.position + 1,
          shotId,
        );
      }
    }
    item.state = 'applied';
    if (
      [...(p.suggestions ?? []), ...(p.issues ?? [])].every(
        (s) => s.state !== 'pending',
      )
    )
      p.status = 'applied';
    save();
  });
}
