import { useEffect, useRef, useState } from 'react';
import type { CatalogProject, Project } from '../../../shared/models';
import {
  colorFamilies,
  paletteMatches,
  type ColorFamily,
} from '../../../shared/colors';
import { ResourceCards } from '../resources';
import { kindLabel } from '../resources';
import {
  IdeaBoxOrganizer,
  IdeaLayoutSwitch,
  useIdeaBoxView,
} from '../inspiration';
export function ProjectLibraryBrowser({
  projects,
  project: loadedProject,
  preferredDirectory,
  refresh,
  onProject,
  onPick,
  onOpen,
  onError,
  busy,
  onRun,
}: {
  projects: CatalogProject[];
  project: Project | null;
  preferredDirectory?: string;
  refresh: number;
  onProject: (project: Project | null) => void;
  onPick: (kind: 'idea' | 'asset', id: string) => void;
  onOpen: () => void;
  onError: (text: string) => void;
  busy: boolean;
  onRun: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [directory, setDirectory] = useState(preferredDirectory ?? ''),
    [tab, setTab] = useState<'ideas' | 'assets'>('ideas'),
    [search, setSearch] = useState(''),
    [kind, setKind] = useState(''),
    [color, setColor] = useState<ColorFamily | ''>(''),
    [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(false);
  const project = loadedProject?.directory === directory ? loadedProject : null;
  const boxView = useIdeaBoxView(`project:${directory}`),
    [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    setSelected([]);
  }, [directory]);
  useEffect(() => {
    if (project) {
      setSelected((old) => {
        const kept = old.filter((id) => project.ideas.some((i) => i.id === id));
        return kept.length === old.length ? old : kept;
      });
      if (
        boxView.openedBox &&
        !project.ideaBoxes.some((b) => b.id === boxView.openedBox)
      )
        boxView.openBox(null);
    }
  }, [project?.ideas, project?.ideaBoxes]);
  const callbacks = useRef({
    onProject,
    onError,
  });
  callbacks.current = {
    onProject,
    onError,
  };
  useEffect(() => {
    if (!projects.some((p) => p.directory === directory && p.available))
      setDirectory(projects.find((p) => p.available)?.directory ?? '');
  }, [projects, directory]);
  useEffect(() => {
    let live = true;
    callbacks.current.onProject(null);
    setOffset(0);
    if (!directory) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void window.watercut
      .readProject(directory)
      .then((p) => {
        if (live) callbacks.current.onProject(p);
      })
      .catch((e) => {
        if (live) callbacks.current.onError(String(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [directory, refresh]);
  const term = search.normalize('NFKC').toLowerCase(),
    match = (text: string) =>
      text.normalize('NFKC').toLowerCase().includes(term),
    ideas =
      project?.ideas.filter(
        (i) =>
          (!kind || i.kind === kind) &&
          match(`${i.text} ${i.tags} ${i.notes}`) &&
          paletteMatches(i.payload.colors, color || undefined),
      ) ?? [],
    assets =
      project?.assets.filter(
        (a) => (!kind || a.kind === kind) && match(`${a.name} ${a.tags}`),
      ) ?? [],
    counts = ideas.reduce<Record<string, number>>((counts, i) => {
      const key = i.boxId ?? 'unfiled';
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
    visibleIdeas =
      boxView.layout === 'boxed'
        ? ideas.filter((i) => i.boxId === boxView.openedBox)
        : ideas,
    total = tab === 'ideas' ? visibleIdeas.length : assets.length;
  return (
    <section className="project-library-browser" aria-label="项目资源库">
      <div className="project-library-choice">
        <label>
          选择项目
          <select
            aria-label="选择项目库"
            value={directory}
            disabled={busy || !projects.some((p) => p.available)}
            onChange={(e) => {
              setDirectory(e.target.value);
              setSearch('');
              setKind('');
              setColor('');
            }}
          >
            {!projects.length && <option value="">暂无已登记项目</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.directory} disabled={!p.available}>
                {p.name}
                {p.archived ? '（已归档）' : ''}
                {!p.available ? '（离线）' : ''}
              </option>
            ))}
          </select>
        </label>
        {project && (
          <button className="secondary" disabled={busy} onClick={onOpen}>
            进入工作室
          </button>
        )}
      </div>
      <div className="segmented">
        <button
          className={tab === 'ideas' ? 'active' : ''}
          onClick={() => {
            setTab('ideas');
            setKind('');
            setOffset(0);
          }}
        >
          灵感
        </button>
        <button
          className={tab === 'assets' ? 'active' : ''}
          onClick={() => {
            setTab('assets');
            setKind('');
            setOffset(0);
          }}
        >
          素材
        </button>
      </div>
      {tab === 'ideas' && project && (
        <IdeaLayoutSwitch
          layout={boxView.layout}
          busy={busy || loading}
          onLayout={(layout) => {
            boxView.setLayout(layout);
            setOffset(0);
          }}
        />
      )}
      <input
        className="search"
        aria-label="搜索项目库"
        placeholder="搜索此项目的灵感或素材…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOffset(0);
        }}
      />
      <div className="filter-row">
        <label>
          类型
          <select
            aria-label="项目资源分类"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">全部类型</option>
            {(tab === 'ideas'
              ? Object.entries(kindLabel)
              : [
                  ['video', '视频'],
                  ['image', '图片'],
                  ['audio', '音频'],
                ]
            ).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
        {tab === 'ideas' && (
          <label>
            主色色系
            <select
              aria-label="项目灵感颜色筛选"
              value={color}
              onChange={(e) => {
                setColor(e.target.value as ColorFamily | '');
                setOffset(0);
              }}
            >
              <option value="">全部颜色</option>
              {colorFamilies.map((f) => (
                <option value={f.id} key={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {loading ? (
        <p className="muted" role="status">
          正在读取项目资源…
        </p>
      ) : !project ? (
        <div className="empty-state">
          选择一个本地项目，查看它的灵感与素材。
        </div>
      ) : (
        <>
          <h2>{project.name}</h2>
          {tab === 'ideas' && (
            <IdeaBoxOrganizer
              key={project.id}
              scope="project"
              scopeId={project.id}
              boxes={project.ideaBoxes}
              counts={counts}
              layout={boxView.layout}
              openedBox={boxView.openedBox}
              selected={selected}
              busy={busy}
              onOpen={(id) => {
                boxView.openBox(id);
                setOffset(0);
              }}
              onSave={(input) =>
                onRun(() =>
                  window.watercut.saveIdeaBox(project.directory, input),
                )
              }
              onDelete={(id) =>
                onRun(() =>
                  window.watercut.deleteIdeaBox(project.directory, id),
                )
              }
              onMove={(ids, id) =>
                onRun(() =>
                  window.watercut.moveIdeasToBox(project.directory, ids, id),
                )
              }
              onClear={() => setSelected([])}
            />
          )}
          <ResourceCards
            assetSelects={project.availableSelects}
            ideas={visibleIdeas.slice(offset, offset + 30)}
            assets={assets.slice(offset, offset + 30)}
            scope="project"
            scopeId={project.id}
            tab={tab}
            onPick={onPick}
            selected={selected}
            onToggle={(id) =>
              setSelected((old) =>
                old.includes(id) ? old.filter((i) => i !== id) : [...old, id],
              )
            }
            onTag={(tag) => {
              setSearch(tag);
              setOffset(0);
            }}
          />
          {!total && (
            <div className="empty-state">
              没有符合筛选的{tab === 'ideas' ? '灵感' : '素材'}
              ，可以调整搜索或分类。
            </div>
          )}
          <div className="pagination">
            <button
              className="quiet"
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 30))}
            >
              上一页
            </button>
            <small>{total} 项</small>
            <button
              className="quiet"
              disabled={offset + 30 >= total}
              onClick={() => setOffset(offset + 30)}
            >
              下一页
            </button>
          </div>
        </>
      )}
    </section>
  );
}
