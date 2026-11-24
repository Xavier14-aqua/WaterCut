import { useEffect, useRef, useState } from 'react';
import type {
  Asset,
  Idea,
  IdeaInput,
  LibraryAsset,
  LibraryIdea,
  LibraryPage,
  LibraryQuery,
  ResourceDrag,
  AssetSelect,
} from '../../../shared/models';
import { emptyPayload } from '../../../shared/models';
import { tagsOf } from '../../../shared/schemas';
import { boardRegion, withBoardRegion } from '../../../shared/board';
import { dateTimeLocalValue, dateTimeLocalToISO } from '../../../shared/dates';
import { colorFamilies, type ColorFamily } from '../../../shared/colors';
import { PaletteEditor } from '../inspiration/PaletteEditor';
import {
  IdeaBoxOrganizer,
  IdeaLayoutSwitch,
  useIdeaBoxView,
} from '../inspiration/IdeaBoxOrganizer';
export const kindLabel = {
  note: '随手记',
  mood: '情绪卡',
  scene: '场景记录',
};
export function mediaUrl(scope: string, id: string, thumb = false) {
  return `watercut-media://asset/${encodeURIComponent(`${thumb ? 'thumb:' : ''}${scope}:${id}`)}`;
}
export function startResourceDrag(
  event: React.DragEvent,
  resource: ResourceDrag,
) {
  event.dataTransfer.setData(
    'application/x-watercut',
    JSON.stringify(resource),
  );
  event.dataTransfer.effectAllowed = 'copy';
}
export function readResourceDrag(event: React.DragEvent): ResourceDrag | null {
  try {
    const data = JSON.parse(
      event.dataTransfer.getData('application/x-watercut'),
    );
    return ['library', 'project'].includes(data.scope) &&
      ['idea', 'asset', 'select'].includes(data.kind) &&
      typeof data.id === 'string'
      ? data
      : null;
  } catch {
    return null;
  }
}
export function MediaPreview({
  asset,
  scope,
  onDuration,
}: {
  asset: Asset | LibraryAsset;
  scope: string;
  onDuration?: (id: string, duration: number) => void;
}) {
  const [failed, setFailed] = useState(false),
    reported = useRef(false);
  const source = mediaUrl(scope, asset.id),
    thumb = mediaUrl(scope, asset.id, true);
  function metadata(player: HTMLMediaElement) {
    if (
      !reported.current &&
      Number.isFinite(player.duration) &&
      player.duration > 0
    ) {
      reported.current = true;
      onDuration?.(asset.id, Math.round(player.duration * 1000));
    }
  }
  if (asset.missing) return <div className="asset-thumb missing">素材缺失</div>;
  return (
    <div className="asset-thumb">
      {asset.kind === 'audio' ? (
        <audio
          controls
          preload="metadata"
          src={source}
          onLoadedMetadata={(e) => metadata(e.currentTarget)}
        />
      ) : asset.kind === 'image' ? (
        <img
          loading="lazy"
          src={asset.thumbnail && !failed ? thumb : source}
          alt={asset.name}
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <video
            muted
            preload="metadata"
            src={source}
            onLoadedMetadata={(e) => metadata(e.currentTarget)}
            onLoadedData={(e) => {
              e.currentTarget.currentTime = Math.min(
                0.1,
                e.currentTarget.duration || 0.1,
              );
            }}
            onError={() => setFailed(true)}
          />
          {failed && <span className="media-error">格式暂不能预览</span>}
        </>
      )}
    </div>
  );
}
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
export function LibraryBrowser({
  refresh,
  compact = false,
  onPick,
  onAdd,
  onCreate,
  onImport,
  onToggle,
  selected = [],
  onError,
  onDuration,
  onRun,
  busy = false,
}: {
  refresh: number;
  compact?: boolean;
  onPick: (kind: 'idea' | 'asset', id: string) => void;
  onAdd?: (kind: 'idea' | 'asset', id: string, copy?: boolean) => void;
  onCreate: () => void;
  onImport: () => void;
  onToggle?: (id: string) => void;
  selected?: string[];
  onError: (message: string) => void;
  onDuration?: (id: string, duration: number) => void;
  onRun?: (action: () => Promise<unknown>) => Promise<boolean>;
  busy?: boolean;
}) {
  const [tab, setTab] = useState<'ideas' | 'assets'>('ideas'),
    [query, setQuery] = useState<LibraryQuery>({}),
    [page, setPage] = useState<LibraryPage | null>(null),
    [loading, setLoading] = useState(false),
    [group, setGroup] = useState('none');
  const boxView = useIdeaBoxView(`library:${page?.id ?? ''}`);
  const boxFilter =
    tab === 'ideas' && !compact && boxView.layout === 'boxed'
      ? boxView.openedBox
      : undefined;
  useEffect(() => {
    let live = true;
    setLoading(true);
    const timer = setTimeout(() => {
      window.watercut
        .readLibrary({
          ...query,
          boxId: boxFilter,
          limit: compact ? 20 : 30,
        })
        .then((value) => {
          if (live) setPage(value);
        })
        .catch((e) => {
          if (live) onError(String(e));
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, refresh, compact, boxFilter]);
  useEffect(() => {
    if (
      page &&
      boxView.openedBox &&
      !page.ideaBoxes.some((b) => b.id === boxView.openedBox)
    )
      boxView.openBox(null);
  }, [page?.ideaBoxes]);
  async function organize(action: () => Promise<unknown>) {
    return onRun ? onRun(action) : false;
  }
  function change(patch: LibraryQuery) {
    setQuery((old) => ({
      ...old,
      ...patch,
      offset: patch.offset ?? 0,
    }));
  }
  const ideas = page?.ideas ?? [],
    assets = page?.assets ?? [],
    limit = compact ? 20 : 30,
    total =
      tab === 'ideas' ? (page?.totalIdeas ?? 0) : (page?.totalAssets ?? 0);
  function groupLabel(iso: string | null) {
    if (!iso) return '时间未知';
    const date = new Date(iso);
    if (group === 'year') return `${date.getFullYear()} 年`;
    if (group === 'week') {
      const first = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
      );
      first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
      return `${first.toLocaleDateString('zh-CN')} 起的一周`;
    }
    return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
  }
  const groupNames =
    group === 'none'
      ? ['全部']
      : [
          ...new Set(
            (tab === 'ideas'
              ? ideas.map((i) => i.occurredAt ?? i.recordedAt)
              : assets.map((a) => a.importedAt)
            ).map(groupLabel),
          ),
        ];
  return (
    <section
      className={`library-browser ${compact ? 'compact' : ''}`}
      aria-label="全局资源库"
    >
      <div className="section-heading">
        <h2>全局总库</h2>
        <button
          className="quiet"
          onClick={tab === 'ideas' ? onCreate : onImport}
        >
          {tab === 'ideas' ? '+ 记录灵感' : '+ 导入素材'}
        </button>
      </div>
      <div className="segmented">
        <button
          className={tab === 'ideas' ? 'active' : ''}
          onClick={() => {
            setTab('ideas');
            setQuery({});
          }}
        >
          灵感
        </button>
        <button
          className={tab === 'assets' ? 'active' : ''}
          onClick={() => {
            setTab('assets');
            setQuery({});
          }}
        >
          素材
        </button>
      </div>
      {tab === 'ideas' && !compact && page && (
        <IdeaLayoutSwitch
          layout={boxView.layout}
          busy={busy || loading}
          onLayout={(layout) => {
            boxView.setLayout(layout);
            change({
              offset: 0,
            });
          }}
        />
      )}
      <input
        className="search"
        aria-label="搜索全局库"
        placeholder="文字、文件名或标签…"
        value={query.search ?? ''}
        onChange={(e) =>
          change({
            search: e.target.value,
          })
        }
      />
      <div className="filter-row">
        <select
          aria-label="资源分类"
          value={query.kind ?? ''}
          onChange={(e) =>
            change({
              kind: e.target.value,
            })
          }
        >
          <option value="">全部类型</option>
          {(tab === 'ideas'
            ? Object.entries(kindLabel)
            : [
                ['video', '视频'],
                ['image', '图片'],
                ['audio', '音频'],
              ]
          ).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="时间分组"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
        >
          <option value="none">普通列表</option>
          <option value="week">按周</option>
          <option value="month">按月</option>
          <option value="year">按年</option>
        </select>
      </div>
      {tab === 'ideas' && (
        <label className="color-family-filter">
          主色色系
          <select
            aria-label="灵感颜色筛选"
            value={query.color ?? ''}
            onChange={(e) =>
              change({
                color: (e.target.value as ColorFamily) || undefined,
              })
            }
          >
            <option value="">全部颜色</option>
            {colorFamilies.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {!compact && (
        <div className="filter-row">
          <input
            aria-label="精确标签"
            placeholder="精确标签，如：雨后"
            value={query.tag ?? ''}
            onChange={(e) =>
              change({
                tag: e.target.value,
              })
            }
          />
          <input
            aria-label="起始日期"
            type="date"
            onChange={(e) =>
              change({
                after: e.target.value
                  ? new Date(`${e.target.value}T00:00:00`).toISOString()
                  : undefined,
              })
            }
          />
          <input
            aria-label="结束日期"
            type="date"
            onChange={(e) => {
              const d = e.target.value
                ? new Date(`${e.target.value}T00:00:00`)
                : null;
              d?.setDate(d.getDate() + 1);
              change({
                before: d?.toISOString(),
              });
            }}
          />
        </div>
      )}
      <div className="filter-chips">
        <label>
          <input
            type="checkbox"
            checked={!!query.hidden}
            onChange={(e) =>
              change({
                hidden: e.target.checked,
              })
            }
          />
          已隐藏
        </label>
        {tab === 'assets' && (
          <>
            <label>
              <input
                type="checkbox"
                checked={!!query.starred}
                onChange={(e) =>
                  change({
                    starred: e.target.checked,
                  })
                }
              />
              星标
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!query.unused}
                onChange={(e) =>
                  change({
                    unused: e.target.checked,
                  })
                }
              />
              未作主画面
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!query.missing}
                onChange={(e) =>
                  change({
                    missing: e.target.checked,
                  })
                }
              />
              缺失
            </label>
          </>
        )}
      </div>
      {tab === 'ideas' && !compact && page && (
        <IdeaBoxOrganizer
          key={page.id}
          scope="library"
          scopeId={page.id}
          boxes={page.ideaBoxes}
          counts={page.ideaBoxCounts}
          layout={boxView.layout}
          openedBox={boxView.openedBox}
          selected={selected}
          busy={busy || loading}
          onOpen={(id) => {
            boxView.openBox(id);
            change({
              offset: 0,
            });
          }}
          onSave={(input) =>
            organize(() => window.watercut.saveLibraryIdeaBox(input))
          }
          onDelete={(id) =>
            organize(() => window.watercut.deleteLibraryIdeaBox(id))
          }
          onMove={(ids, id) =>
            organize(() => window.watercut.moveLibraryIdeasToBox(ids, id))
          }
          onClear={() => {
            for (const id of selected) onToggle?.(id);
          }}
        />
      )}
      {loading && <small className="muted">正在检索…</small>}
      {!loading && total === 0 && (
        <div className="empty-state">
          {tab === 'ideas'
            ? boxView.layout === 'boxed' && !compact
              ? '这里没有符合筛选的灵感，可以调整筛选或从全部平铺收纳卡片。'
              : '把一句想法留在这里。'
            : '导入你的第一份素材。'}
        </div>
      )}
      {page &&
        !loading &&
        groupNames.map((name) => (
          <details
            key={name}
            open
            className={group === 'none' ? 'group-all' : 'time-group-details'}
          >
            <summary>
              {group === 'none' ? '全部' : name}
              <small> · 本页</small>
            </summary>
            <ResourceCards
              assetSelects={page.assetSelects}
              ideas={
                group === 'none'
                  ? ideas
                  : ideas.filter(
                      (i) => groupLabel(i.occurredAt ?? i.recordedAt) === name,
                    )
              }
              assets={
                group === 'none'
                  ? assets
                  : assets.filter((a) => groupLabel(a.importedAt) === name)
              }
              scope="library"
              scopeId={page.id}
              tab={tab}
              onPick={onPick}
              onAdd={onAdd}
              onToggle={onToggle}
              selected={selected}
              onDuration={onDuration}
              onTag={(tag) =>
                change({
                  tag,
                })
              }
            />
          </details>
        ))}
      <div className="pagination">
        <button
          className="quiet"
          disabled={loading || !(query.offset ?? 0)}
          onClick={() =>
            change({
              offset: Math.max(0, (query.offset ?? 0) - limit),
            })
          }
        >
          上一页
        </button>
        <small>
          {total} 项 · 第 {Math.floor((query.offset ?? 0) / limit) + 1} 页
        </small>
        <button
          className="quiet"
          disabled={loading || (query.offset ?? 0) + limit >= total}
          onClick={() =>
            change({
              offset: (query.offset ?? 0) + limit,
            })
          }
        >
          下一页
        </button>
      </div>
    </section>
  );
}
export function IdeaForm({
  value,
  assets,
  onSave,
  onCancel,
  busy = false,
  heading = '编辑灵感',
  onDraft,
  libraryMode = false,
  mediaScopeId,
}: {
  value?: Idea | LibraryIdea;
  assets: Array<Asset | LibraryAsset>;
  onSave: (input: IdeaInput) => Promise<boolean>;
  onCancel: () => void;
  busy?: boolean;
  heading?: string;
  onDraft?: (input: IdeaInput) => void;
  libraryMode?: boolean;
  mediaScopeId?: string;
}) {
  const [form, setForm] = useState<IdeaInput>(() =>
      value
        ? {
            ...value,
            id: value.id,
            expectedVersion: 'version' in value ? value.version : undefined,
          }
        : {
            kind: 'note',
            text: '',
            tags: '',
            notes: '',
            payload: {
              ...emptyPayload,
            },
            occurredAt: null,
            media: [],
          },
    ),
    [dirty, setDirty] = useState(false);
  const formRef = useRef(form),
    mounted = useRef(true);
  formRef.current = form;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [assetSearch, setAssetSearch] = useState(''),
    [lookupAssets, setLookupAssets] = useState<LibraryAsset[]>([]);
  useEffect(() => {
    if (!libraryMode) return;
    let live = true;
    const timer = setTimeout(() => {
      void window.watercut
        .readLibrary({
          search: assetSearch,
          limit: 100,
        })
        .then((page) => {
          if (live) setLookupAssets(page.assets);
        })
        .catch(() => undefined);
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [libraryMode, assetSearch]);
  const assetOptions = [
    ...new Map([...assets, ...lookupAssets].map((a) => [a.id, a])).values(),
  ];
  function edit(patch: Partial<IdeaInput>) {
    setDirty(true);
    const next = {
      ...form,
      ...patch,
    };
    setForm(next);
    onDraft?.(next);
  }
  function chooseMedia(
    asset: Asset | LibraryAsset,
    next: NonNullable<IdeaInput['media']>,
  ) {
    edit({
      media: next,
    });
    if (form.kind !== 'mood' || asset.kind !== 'image') return;
    if ('palette' in asset && asset.palette.length) {
      edit({
        payload: {
          ...form.payload,
          colors: asset.palette.slice(0, 4),
        },
        media: next,
      });
      return;
    }
    const scope = 'libraryId' in asset ? asset.libraryId : mediaScopeId;
    if (!scope) return;
    void window.watercut
      .getPalette(`${scope}:${asset.id}`)
      .then((colors) => {
        const latest = formRef.current;
        if (
          !mounted.current ||
          !colors.length ||
          latest.kind !== 'mood' ||
          !latest.media?.some((m) => m.assetId === asset.id) ||
          latest.payload.colors.join() !== form.payload.colors.join()
        )
          return;
        const updated = {
          ...latest,
          payload: {
            ...latest.payload,
            colors,
          },
        };
        setForm(updated);
        onDraft?.(updated);
      })
      .catch(() => undefined);
  }
  function payload(key: keyof typeof emptyPayload, text: string) {
    edit({
      payload: {
        ...form.payload,
        [key]: text,
      },
    });
  }
  const media = form.media ?? [];
  return (
    <form
      className="idea-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSave(form)) setDirty(false);
      }}
    >
      <fieldset className="idea-fields" disabled={busy}>
        <h2>{heading}</h2>
        <label>
          类型
          <select
            value={form.kind}
            onChange={(e) =>
              edit({
                kind: e.target.value as IdeaInput['kind'],
              })
            }
          >
            {Object.entries(kindLabel).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label>
          一句话 / 核心画面
          <textarea
            autoFocus
            value={form.text}
            maxLength={4000}
            onChange={(e) =>
              edit({
                text: e.target.value,
              })
            }
            placeholder="先记下来，细节可以以后补。"
          />
        </label>
        <label>
          标签
          <input
            value={form.tags}
            maxLength={500}
            onChange={(e) =>
              edit({
                tags: e.target.value,
              })
            }
            placeholder="雨后，孤独，便利店"
          />
        </label>
        <label>
          备注
          <textarea
            value={form.notes}
            onChange={(e) =>
              edit({
                notes: e.target.value,
              })
            }
          />
        </label>
        {form.kind === 'mood' && (
          <>
            <label>
              节奏直觉
              <input
                value={form.payload.rhythm}
                onChange={(e) => payload('rhythm', e.target.value)}
                placeholder="先静后动，副歌加快"
              />
            </label>
            <PaletteEditor
              colors={form.payload.colors}
              disabled={busy}
              onChange={(colors) =>
                edit({
                  payload: {
                    ...form.payload,
                    colors,
                  },
                })
              }
            />
          </>
        )}
        {form.kind === 'scene' && (
          <div className="form-grid">
            {(
              [
                ['timeOfDay', '昼夜'],
                ['weather', '天气'],
                ['environment', '环境'],
                ['location', '地点'],
                ['props', '关键道具'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  value={form.payload[key]}
                  onChange={(e) => payload(key, e.target.value)}
                />
              </label>
            ))}
          </div>
        )}
        <label>
          白板分区
          <input
            aria-label="白板分区"
            placeholder="例如：开场、第二幕"
            value={boardRegion(form.tags)}
            onChange={(e) =>
              edit({
                tags: withBoardRegion(form.tags, e.target.value),
              })
            }
          />
        </label>
        <label>
          事情发生的时间（可留空）
          <input
            type="datetime-local"
            value={dateTimeLocalValue(form.occurredAt)}
            onChange={(e) =>
              edit({
                occurredAt: dateTimeLocalToISO(e.target.value),
              })
            }
          />
        </label>
        <label>
          搜索参考素材
          <input
            aria-label="搜索参考素材"
            placeholder="输入文件名或标签…"
            value={assetSearch}
            onChange={(e) => setAssetSearch(e.target.value)}
          />
        </label>
        <label>
          参考图片 / 音频 / 视频
          <select
            value=""
            onChange={(e) => {
              const asset = assetOptions.find((a) => a.id === e.target.value);
              if (!asset) return;
              const next = [
                ...media,
                {
                  assetId: asset.id,
                  role: asset.kind,
                  position: media.length,
                  inMs: 0,
                  outMs: null,
                },
              ];
              chooseMedia(asset, next);
            }}
          >
            <option value="">选择已导入素材…</option>
            {assetOptions
              .filter(
                (a) =>
                  !media.some((m) => m.assetId === a.id) &&
                  `${a.name} ${a.tags}`
                    .toLowerCase()
                    .includes(assetSearch.toLowerCase()),
              )
              .map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <div className="attachment-list">
          {media.map((m, index) => (
            <div key={m.assetId}>
              <span>
                {assetOptions.find((a) => a.id === m.assetId)?.name ??
                  '已关联参考素材'}{' '}
                · {m.role}
              </span>
              {m.role !== 'image' && (
                <div className="filter-row">
                  <input
                    aria-label="参考入点"
                    type="number"
                    min="0"
                    step=".1"
                    value={m.inMs / 1000}
                    onChange={(e) =>
                      edit({
                        media: media.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                inMs: Math.round(Number(e.target.value) * 1000),
                              }
                            : item,
                        ),
                      })
                    }
                  />
                  <input
                    aria-label="参考出点"
                    type="number"
                    min=".1"
                    step=".1"
                    placeholder="片尾"
                    value={m.outMs === null ? '' : m.outMs / 1000}
                    onChange={(e) =>
                      edit({
                        media: media.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                outMs: e.target.value
                                  ? Math.round(Number(e.target.value) * 1000)
                                  : null,
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </div>
              )}
              <button
                type="button"
                className="quiet"
                onClick={() =>
                  edit({
                    media: media.filter((_, i) => i !== index),
                  })
                }
              >
                移除引用
              </button>
            </div>
          ))}
        </div>
        <div className="form-actions">
          <button disabled={busy || !form.text.trim()} type="submit">
            {onDraft ? '立即保存' : '保存'}
            {dirty && !onDraft ? '编辑' : ''}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (
                onDraft ||
                !dirty ||
                window.confirm('放弃尚未保存的灵感编辑？')
              )
                onCancel();
            }}
          >
            关闭
          </button>
        </div>
        <small className="muted">
          {onDraft
            ? '项目编辑自动保存；保存状态见顶栏。'
            : value && 'sourceIdeaId' in value
              ? '这里的编辑仅保存到所选项目，点击“保存”生效。'
              : '参考图可选；情绪卡最多三张。'}
        </small>
      </fieldset>
    </form>
  );
}
