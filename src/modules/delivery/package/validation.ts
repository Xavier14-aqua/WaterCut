import { DatabaseSync } from 'node:sqlite';

export function validateDatabaseBounds(db: DatabaseSync, version: number) {
  const limits: Record<string, number> = {
    project: 1,
    shots: 10000,
    ideas: 10000,
    assets: 10000,
    board_edges: 50000,
    shot_assets: 10000,
    shot_audio: 10000,
    shot_candidates: 100000,
    script_blocks: 30000,
    shot_sources: 100000,
    revisions: 500,
    revision_media_refs: 500000,
    asset_metadata: 10000,
    project_origin: 10,
    commands: 100000,
    outbox: 100000,
  };
  if (version >= 10) {
    limits.idea_boxes = 1000;
    limits.idea_box_items = 10000;
  }
  if (version >= 11) {
    limits.audio_clips = 128;
    limits.timeline_settings = 1;
    limits.ai_proposals = 100;
  }
  for (const [table, limit] of Object.entries(limits)) {
    const schema = db
      .prepare('SELECT type,sql FROM sqlite_master WHERE name=?')
      .get(table) as any;
    if (
      schema?.type !== 'table' ||
      /CREATE\s+VIRTUAL\s+TABLE/i.test(schema.sql ?? '')
    )
      throw new Error('项目包数据表结构不受支持');
    if (
      (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as any).n > limit
    )
      throw new Error('项目包对象数量超过限制');
  }
  const history = db
    .prepare(
      'SELECT coalesce(sum(length(CAST(payload_json AS BLOB))),0) AS total,coalesce(max(length(CAST(payload_json AS BLOB))),0) AS largest FROM revisions',
    )
    .get() as any;
  if (history.total > 96 * 1024 ** 2 || history.largest > 20 * 1024 ** 2)
    throw new Error('项目包快照内容超过限制');
  for (const [table, limit] of [
    ['ideas', 32768],
    ['asset_metadata', 65536],
  ] as const)
    if (
      (
        db
          .prepare(
            `SELECT coalesce(max(length(payload_json)),0) AS n FROM ${table}`,
          )
          .get() as any
      ).n > limit
    )
      throw new Error('项目包元数据超过限制');
  for (const table of ['ideas', 'shots', 'script_blocks', 'shot_sources']) {
    const columns =
      table === 'ideas'
        ? ['text', 'notes', 'tags']
        : table === 'shots'
          ? [
              'description',
              'action_dialogue',
              'review_note',
              'scene',
              'time_of_day',
              'shot_size',
              'movement',
            ]
          : table === 'script_blocks'
            ? ['draft_text']
            : ['excerpt'];
    for (const column of columns)
      if (
        (
          db
            .prepare(
              `SELECT coalesce(max(length(${column})),0) AS n FROM ${table}`,
            )
            .get() as any
        ).n > 4000
      )
        throw new Error('项目包文本超过限制');
  }
}
