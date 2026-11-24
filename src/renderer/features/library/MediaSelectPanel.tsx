import { useEffect, useState } from 'react';
import type { AssetSelect, LibraryAsset, Usage } from '../../../shared/models';
import { knownDuration, rangesOverlap } from '../../../shared/creative';
import { UsageList } from './UsageList';
type Draft = {
  id?: string;
  assetId: string;
  name: string;
  inMs: number;
  outMs: number;
  note: string;
  expectedVersion?: number;
};
export function MediaSelectPanel({
  asset,
  busy,
  onRun,
  onNotice,
}: {
  asset: LibraryAsset;
  busy: boolean;
  onRun: (action: () => Promise<unknown>) => Promise<boolean>;
  onNotice: (message: string) => void;
}) {
  const [selects, setSelects] = useState<AssetSelect[]>([]),
    [draft, setDraft] = useState<Draft | null>(null),
    [usage, setUsage] = useState<Usage[]>([]),
    [viewing, setViewing] = useState<AssetSelect | null>(null);
  const duration = knownDuration(asset);
  async function load() {
    setSelects(await window.watercut.listAssetSelects(asset.id));
  }
  useEffect(() => {
    let live = true;
    void window.watercut
      .listAssetSelects(asset.id)
      .then((s) => {
        if (live) setSelects(s);
      })
      .catch((e) => onNotice(String(e)));
    return () => {
      live = false;
    };
  }, [asset.id]);
  useEffect(() => {
    let live = true;
    setUsage([]);
    if (viewing)
      void window.watercut
        .libraryUsage(asset.id, { inMs: viewing.inMs, outMs: viewing.outMs })
        .then((u) => {
          if (live) setUsage(u);
        })
        .catch((e) => onNotice(String(e)));
    return () => {
      live = false;
    };
  }, [viewing?.id, viewing?.version]);
  const overlaps = draft
    ? selects.filter((s) => s.id !== draft.id && rangesOverlap(s, draft))
    : [];
  function playhead(event: React.MouseEvent, key: 'inMs' | 'outMs') {
    const player = event.currentTarget
      .closest('.inspector')
      ?.querySelector('.inspector-video') as HTMLVideoElement | null;
    if (player && draft)
      setDraft({ ...draft, [key]: Math.round(player.currentTime * 1000) });
  }
  return (
    <section className="select-editor">
      <h3>精华子片段</h3>
      <p className="muted">
        只记录原片区间。拖到分镜后，项目保存独立裁剪；以后修改这里不改变旧项目。
      </p>
      <button
        className="secondary"
        disabled={busy || !duration || asset.missing}
        onClick={() =>
          setDraft({
            assetId: asset.id,
            name: '新的精华片段',
            inMs: 0,
            outMs: Math.min(duration!, 5000),
            note: '',
          })
        }
      >
        + 标记精华
      </button>
      {!duration && (
        <small className="warning">先点击“重新探测参数”，得到原片时长。</small>
      )}
      {selects.map((s) => (
        <div className="select-list-row" key={s.id}>
          <button
            className="quiet"
            disabled={busy}
            onClick={() => setViewing(s)}
          >
            <strong>{s.name}</strong>
            <small>
              {(s.inMs / 1000).toFixed(2)}–{(s.outMs / 1000).toFixed(2)}s · v
              {s.version}
            </small>
          </button>
          <div>
            <button
              className="quiet"
              disabled={busy}
              onClick={() =>
                setDraft({
                  id: s.id,
                  assetId: s.assetId,
                  name: s.name,
                  inMs: s.inMs,
                  outMs: s.outMs,
                  note: s.note,
                  expectedVersion: s.version,
                })
              }
            >
              编辑片段
            </button>
            <button
              className="quiet danger-text"
              disabled={busy}
              onClick={async () => {
                if (await onRun(() => window.watercut.hideAssetSelect(s.id))) {
                  setViewing(null);
                  setDraft(null);
                  await load();
                }
              }}
            >
              隐藏片段
            </button>
          </div>
        </div>
      ))}
      {draft && (
        <form
          className="select-range-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onRun(() => window.watercut.saveAssetSelect(draft))) {
              setDraft(null);
              setViewing(null);
              await load();
            }
          }}
        >
          <label>
            片段名称
            <input
              aria-label="精华片段名称"
              maxLength={100}
              value={draft.name}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <div className="form-grid">
            <label>
              入点（秒）
              <input
                aria-label="精华片段入点"
                type="number"
                min="0"
                step=".01"
                disabled={busy}
                value={draft.inMs / 1000}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    inMs: Math.round(Number(e.target.value) * 1000),
                  })
                }
              />
            </label>
            <label>
              出点（秒）
              <input
                aria-label="精华片段出点"
                type="number"
                min=".01"
                step=".01"
                disabled={busy}
                value={draft.outMs / 1000}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    outMs: Math.round(Number(e.target.value) * 1000),
                  })
                }
              />
            </label>
          </div>
          <div className="toolbar">
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={(e) => playhead(e, 'inMs')}
            >
              播放位置作入点
            </button>
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={(e) => playhead(e, 'outMs')}
            >
              播放位置作出点
            </button>
          </div>
          <label>
            备注
            <textarea
              disabled={busy}
              value={draft.note}
              maxLength={2000}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
          {!!overlaps.length && (
            <p className="warning">
              与「{overlaps.map((s) => s.name).join('、')}
              」区间重叠；仍可按需要保存。
            </p>
          )}
          <div className="toolbar">
            <button type="submit" disabled={busy || !draft.name.trim()}>
              保存精华片段
            </button>
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              取消标记
            </button>
          </div>
        </form>
      )}
      {viewing && (
        <div className="select-usage">
          <h3>「{viewing.name}」区间使用足迹</h3>
          <UsageList usage={usage} />
        </div>
      )}
    </section>
  );
}
