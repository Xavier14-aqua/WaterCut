import { DatabaseSync } from 'node:sqlite';

export const CURRENT_VERSION = 11;

export const additions = `CREATE TABLE ideas (id TEXT PRIMARY KEY, text TEXT NOT NULL);
  CREATE TABLE assets (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, relative_path TEXT NOT NULL, size INTEGER NOT NULL);
  CREATE TABLE shot_assets (shot_id TEXT PRIMARY KEY REFERENCES shots(id), asset_id TEXT NOT NULL REFERENCES assets(id));`;

export const additionsV4 = `ALTER TABLE shots ADD COLUMN action_dialogue TEXT NOT NULL DEFAULT '';
  ALTER TABLE ideas ADD COLUMN tags TEXT NOT NULL DEFAULT '';
  ALTER TABLE ideas ADD COLUMN notes TEXT NOT NULL DEFAULT '';
  ALTER TABLE ideas ADD COLUMN source_asset_id TEXT;
  ALTER TABLE assets ADD COLUMN tags TEXT NOT NULL DEFAULT '';
  CREATE TABLE shot_audio (shot_id TEXT PRIMARY KEY REFERENCES shots(id), asset_id TEXT NOT NULL REFERENCES assets(id));`;

export const additionsV5 = `CREATE TABLE shot_candidates (shot_id TEXT NOT NULL, asset_id TEXT NOT NULL, PRIMARY KEY (shot_id, asset_id));
  INSERT INTO shot_candidates (shot_id, asset_id) SELECT shot_id, asset_id FROM shot_assets;`;

export const additionsV6 = `ALTER TABLE ideas ADD COLUMN x REAL NOT NULL DEFAULT 0;
  ALTER TABLE ideas ADD COLUMN y REAL NOT NULL DEFAULT 0;
  UPDATE ideas SET x = ((rowid - 1) % 4) * 230, y = CAST((rowid - 1) / 4 AS INTEGER) * 150;
  CREATE TABLE board_edges (id TEXT PRIMARY KEY, source TEXT NOT NULL REFERENCES ideas(id), target TEXT NOT NULL REFERENCES ideas(id), UNIQUE(source, target));`;

export const additionsV7 = `ALTER TABLE board_edges ADD COLUMN source_handle TEXT NOT NULL DEFAULT 'bottom';
  ALTER TABLE board_edges ADD COLUMN target_handle TEXT NOT NULL DEFAULT 'top';`;

export const additionsV8 = `ALTER TABLE project ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE project ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE assets ADD COLUMN storage_kind TEXT NOT NULL DEFAULT 'local';
  ALTER TABLE assets ADD COLUMN source_library_id TEXT;
  ALTER TABLE assets ADD COLUMN source_asset_id TEXT;
  ALTER TABLE assets ADD COLUMN sha256 TEXT;
  ALTER TABLE assets ADD COLUMN duration_ms INTEGER;
  ALTER TABLE assets ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE assets ADD COLUMN imported_at TEXT;
  ALTER TABLE ideas ADD COLUMN kind TEXT NOT NULL DEFAULT 'note';
  ALTER TABLE ideas ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{"colors":[],"rhythm":"","timeOfDay":"","weather":"","environment":"","location":"","props":""}';
  ALTER TABLE ideas ADD COLUMN recorded_at TEXT;
  ALTER TABLE ideas ADD COLUMN occurred_at TEXT;
  ALTER TABLE ideas ADD COLUMN source_library_id TEXT;
  ALTER TABLE ideas ADD COLUMN source_idea_id TEXT;
  ALTER TABLE ideas ADD COLUMN source_version INTEGER;
  ALTER TABLE board_edges ADD COLUMN label TEXT NOT NULL DEFAULT '';
  ALTER TABLE board_edges ADD COLUMN relation_kind TEXT NOT NULL DEFAULT 'sequence';
  ALTER TABLE shots ADD COLUMN scene TEXT NOT NULL DEFAULT '';
  ALTER TABLE shots ADD COLUMN time_of_day TEXT NOT NULL DEFAULT '';
  ALTER TABLE shots ADD COLUMN shot_size TEXT NOT NULL DEFAULT '';
  ALTER TABLE shots ADD COLUMN movement TEXT NOT NULL DEFAULT '';
  ALTER TABLE shots ADD COLUMN status TEXT NOT NULL DEFAULT 'idea';
  ALTER TABLE shots ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE shots ADD COLUMN review_note TEXT NOT NULL DEFAULT '';
  CREATE TABLE idea_media(idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,asset_id TEXT NOT NULL REFERENCES assets(id),role TEXT NOT NULL,position INTEGER NOT NULL,in_ms INTEGER NOT NULL,out_ms INTEGER,PRIMARY KEY(idea_id,asset_id,role));
  INSERT INTO idea_media SELECT i.id,a.id,a.kind,0,0,NULL FROM ideas i JOIN assets a ON a.id=i.source_asset_id;
  CREATE TABLE shot_sources(id TEXT PRIMARY KEY,shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,idea_id TEXT REFERENCES ideas(id) ON DELETE SET NULL,excerpt TEXT NOT NULL);
  CREATE TABLE script_blocks(id TEXT PRIMARY KEY,position INTEGER NOT NULL,kind TEXT NOT NULL DEFAULT 'body',draft_text TEXT,shot_id TEXT UNIQUE REFERENCES shots(id) ON DELETE CASCADE);
  INSERT INTO script_blocks(id,position,shot_id) SELECT id,position,id FROM shots;
  CREATE TRIGGER shot_script AFTER INSERT ON shots BEGIN INSERT INTO script_blocks(id,position,shot_id) VALUES (NEW.id,(SELECT COALESCE(MAX(position),-1)+1 FROM script_blocks),NEW.id); END;
  CREATE TABLE outbox(event_id TEXT PRIMARY KEY,project_revision INTEGER NOT NULL);
  CREATE TABLE commands(command_id TEXT PRIMARY KEY,result_json TEXT NOT NULL);
  PRAGMA user_version=8;`;

export const additionsV9 = `
  CREATE TABLE revisions(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL,document_version INTEGER NOT NULL,content_revision INTEGER NOT NULL,payload_json TEXT NOT NULL,automatic INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE revision_media_refs(revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,asset_id TEXT NOT NULL,blob_sha256 TEXT,locator_snapshot TEXT NOT NULL,PRIMARY KEY(revision_id,asset_id));
  CREATE INDEX revision_media_asset ON revision_media_refs(asset_id);
  CREATE TABLE asset_metadata(asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,payload_json TEXT NOT NULL);
  CREATE TABLE project_origin(source_project_id TEXT NOT NULL,package_sha256 TEXT NOT NULL,imported_at TEXT NOT NULL);
  PRAGMA user_version=9;`;

export const additionsV11 = `
  CREATE TABLE IF NOT EXISTS audio_clips(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,timeline_start_ms INTEGER NOT NULL,in_ms INTEGER NOT NULL,out_ms INTEGER NOT NULL,gain REAL NOT NULL,fade_in_ms INTEGER NOT NULL,fade_out_ms INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS timeline_settings(id INTEGER PRIMARY KEY CHECK(id=1),width INTEGER NOT NULL,height INTEGER NOT NULL,fps_num INTEGER NOT NULL,fps_den INTEGER NOT NULL,video_gain REAL NOT NULL,bgm_gain REAL NOT NULL);
  INSERT OR IGNORE INTO timeline_settings VALUES(1,1920,1080,30,1,1,1);
  CREATE TABLE IF NOT EXISTS ai_proposals(id TEXT PRIMARY KEY,kind TEXT NOT NULL,base_revision INTEGER NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL,payload_json TEXT NOT NULL);
  PRAGMA user_version=11;`;

export function installChangeTriggers(db: DatabaseSync) {
  for (const table of [
    'shots',
    'ideas',
    'assets',
    'board_edges',
    'shot_assets',
    'shot_candidates',
    'shot_audio',
    'idea_media',
    'shot_sources',
    'script_blocks',
    'idea_boxes',
    'idea_box_items',
    'audio_clips',
    'timeline_settings',
  ])
    for (const event of ['INSERT', 'UPDATE', 'DELETE'])
      db.exec(
        `CREATE TRIGGER IF NOT EXISTS change_${table}_${event} AFTER ${event} ON ${table} BEGIN UPDATE project SET revision=revision+1; DELETE FROM outbox WHERE event_id='usage'; INSERT INTO outbox SELECT 'usage',revision FROM project; END;`,
      );
  db.exec(
    "CREATE TRIGGER IF NOT EXISTS change_project AFTER UPDATE OF name,archived ON project BEGIN UPDATE project SET revision=revision+1; DELETE FROM outbox WHERE event_id='usage'; INSERT INTO outbox SELECT 'usage',revision FROM project; END;",
  );
}

export function installV11(db: DatabaseSync) {
  for (const [table, definitions] of [
    [
      'shots',
      [
        "props TEXT NOT NULL DEFAULT ''",
        "production_state TEXT NOT NULL DEFAULT 'planned'",
      ],
    ],
    [
      'shot_assets',
      [
        'source_select_id TEXT',
        'source_select_version INTEGER',
        'source_select_name TEXT',
      ],
    ],
  ] as const) {
    const columns = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(
        (c) => c.name,
      ),
    );
    for (const definition of definitions)
      if (!columns.has(definition.split(' ')[0]))
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
  db.exec(additionsV11);
}
