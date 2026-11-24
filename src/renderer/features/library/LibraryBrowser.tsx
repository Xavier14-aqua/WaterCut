import { useEffect, useState } from 'react';

import type { LibraryPage, LibraryQuery } from '../../../shared/models';

import { colorFamilies, type ColorFamily } from '../../../shared/colors';

import {
  IdeaBoxOrganizer,
  IdeaLayoutSwitch,
  useIdeaBoxView,
} from '../inspiration/IdeaBoxOrganizer';

import { kindLabel } from '../resources/kinds';

import { ResourceCards } from '../resources/ResourceCards';

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
