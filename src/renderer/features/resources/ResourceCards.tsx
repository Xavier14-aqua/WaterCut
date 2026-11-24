import type {
  Asset,
  Idea,
  LibraryAsset,
  LibraryIdea,
  AssetSelect,
} from '../../../shared/models';

import { tagsOf } from '../../../shared/schemas';

import { startResourceDrag } from '../../platform/resource-drag';

import { kindLabel } from './kinds';

import { mediaUrl } from '../../platform/media-url';

import { MediaPreview } from './MediaPreview';

export function ResourceCards({
  ideas,
  assets,
  scope,
  scopeId,
  tab,
  onPick,
  onAdd,
  onToggle,
  selected = [],
  onDuration,
  onTag,
  assetSelects = [],
}: {
  ideas: Array<Idea | LibraryIdea>;
  assets: Array<Asset | LibraryAsset>;
  scope: 'library' | 'project';
  scopeId: string;
  tab: 'ideas' | 'assets';
  onPick: (kind: 'idea' | 'asset', id: string) => void;
  onAdd?: (kind: 'idea' | 'asset', id: string, copy?: boolean) => void;
  onToggle?: (id: string) => void;
  selected?: string[];
  onDuration?: (id: string, duration: number) => void;
  onTag?: (tag: string) => void;
  assetSelects?: AssetSelect[];
}) {
  return (
    <div className="resource-cards">
      {tab === 'ideas'
        ? ideas.map((idea) => (
            <article
              key={idea.id}
              className={`resource-card ${selected.includes(idea.id) ? 'selected' : ''}`}
              data-kind={idea.kind}
              draggable
              onDragStart={(e) =>
                startResourceDrag(e, {
                  scope,
                  scopeId,
                  kind: 'idea',
                  id: idea.id,
                })
              }
            >
              <div className="palette">
                {idea.payload.colors.map((c) => (
                  <i
                    key={c}
                    style={{
                      background: c,
                    }}
                  />
                ))}
              </div>
              <div
                className="resource-card-body"
                onClick={() => onPick('idea', idea.id)}
              >
                <span className="kind-label">{kindLabel[idea.kind]}</span>
                <strong>{idea.text}</strong>
                {idea.media.find((m) => m.role === 'image') && (
                  <img
                    className="idea-reference"
                    loading="lazy"
                    src={mediaUrl(
                      scopeId,
                      idea.media.find((m) => m.role === 'image')!.assetId,
                    )}
                    alt="灵感参考图"
                  />
                )}
                <div className="tag-chips">
                  {tagsOf(idea.tags).map((tag) => (
                    <button
                      className="quiet"
                      key={tag}
                      onClick={(e) => {
                        e.stopPropagation();
                        onTag?.(tag);
                      }}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
                <small>
                  {idea.occurredAt
                    ? new Date(idea.occurredAt).toLocaleDateString('zh-CN')
                    : idea.recordedAt
                      ? new Date(idea.recordedAt).toLocaleDateString('zh-CN')
                      : '原始记录时间未知'}
                </small>
                {'sourceIdeaId' in idea && idea.sourceIdeaId && (
                  <small>来自全局库 · 项目独立编辑</small>
                )}
              </div>
              <div className="card-actions">
                {onToggle && (
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(idea.id)}
                      onChange={() => onToggle(idea.id)}
                    />
                    选择
                  </label>
                )}
                <button
                  className="quiet"
                  onClick={() => onPick('idea', idea.id)}
                >
                  详情
                </button>
                {onAdd && (
                  <button
                    className="quiet"
                    onClick={() => onAdd('idea', idea.id)}
                  >
                    引用 / 定位
                  </button>
                )}
                {onAdd && (
                  <button
                    className="quiet"
                    onClick={() => onAdd('idea', idea.id, true)}
                  >
                    再建实例
                  </button>
                )}
              </div>
            </article>
          ))
        : assets.map((asset) => (
            <article
              key={asset.id}
              className="resource-card"
              draggable
              onDragStart={(e) =>
                startResourceDrag(e, {
                  scope,
                  scopeId,
                  kind: 'asset',
                  id: asset.id,
                })
              }
            >
              <div onClick={() => onPick('asset', asset.id)}>
                <MediaPreview
                  asset={asset}
                  scope={scopeId}
                  onDuration={onDuration}
                />
                <div className="resource-card-body">
                  <strong>{asset.name}</strong>
                  <small>
                    {asset.kind} · {(asset.size / 1048576).toFixed(1)} MB
                    {asset.durationMs
                      ? ` · ${(asset.durationMs / 1000).toFixed(1)} 秒`
                      : ''}
                  </small>
                  <small>
                    {asset.tags}
                    {'usageCount' in asset
                      ? ` · 主画面已用 ${asset.usageCount} 次`
                      : ''}
                  </small>
                </div>
              </div>
              <div className="card-actions">
                <button
                  className="quiet"
                  onClick={() => onPick('asset', asset.id)}
                >
                  详情
                </button>
                {onAdd && (
                  <button
                    className="quiet"
                    onClick={() => onAdd('asset', asset.id)}
                  >
                    加入项目
                  </button>
                )}
              </div>
              {asset.kind === 'video' &&
                assetSelects.some(
                  (s) => (s.projectAssetId ?? s.assetId) === asset.id,
                ) && (
                  <details className="resource-selects">
                    <summary>
                      精华子片段 ·{' '}
                      {
                        assetSelects.filter(
                          (s) => (s.projectAssetId ?? s.assetId) === asset.id,
                        ).length
                      }
                    </summary>
                    {assetSelects
                      .filter(
                        (s) => (s.projectAssetId ?? s.assetId) === asset.id,
                      )
                      .map((s) => (
                        <button
                          key={s.id}
                          className="resource-select quiet"
                          draggable
                          title={`已知主画面重叠区间：${s.usageCount ?? 0} 次\n${s.usageHint ?? ''}\n拖到分镜设为主画面；使用足迹以详情核对为准。`}
                          onClick={() => onPick('asset', asset.id)}
                          onDragStart={(event) => {
                            event.stopPropagation();
                            startResourceDrag(event, {
                              scope: 'library',
                              scopeId: s.libraryId,
                              kind: 'select',
                              id: s.id,
                            });
                          }}
                        >
                          <strong>{s.name}</strong>
                          <small>
                            {(s.inMs / 1000).toFixed(2)}–
                            {(s.outMs / 1000).toFixed(2)}s · 已知重叠已用{' '}
                            {s.usageCount ?? 0} 次
                          </small>
                        </button>
                      ))}
                  </details>
                )}
            </article>
          ))}
    </div>
  );
}
