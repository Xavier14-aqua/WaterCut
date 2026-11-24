import { LibraryBrowser } from '../../features/library';
import { ResourceCards } from '../../features/resources';
import type { AppModel } from '../useAppController';

export function ResourceSidebar({ model }: { model: AppModel }) {
  const {
    attach,
    busy,
    duration,
    filteredAssets,
    filteredIdeas,
    project,
    refresh,
    resourceScope,
    resourceSearch,
    resourceTab,
    run,
    select,
    selectedIdeas,
    setEditor,
    setMessage,
    setResourceScope,
    setResourceSearch,
    setResourceTab,
    setSelectedIdeas,
  } = model;
  if (!project) return null;
  return (
    <aside className="resources-sidebar">
      <div className="segmented">
        <button
          className={resourceScope === 'project' ? 'active' : ''}
          onClick={() => setResourceScope('project')}
        >
          当前项目
        </button>
        <button
          className={resourceScope === 'library' ? 'active' : ''}
          onClick={() => setResourceScope('library')}
        >
          全局总库
        </button>
      </div>
      {resourceScope === 'library' ? (
        <LibraryBrowser
          compact
          refresh={refresh}
          onPick={(kind, id) => select('library', kind, id)}
          onAdd={attach}
          onCreate={() => setEditor('library')}
          onImport={() => void run(() => window.watercut.importLibraryAssets())}
          onError={setMessage}
          onDuration={(id, d) => duration('library', id, d)}
        />
      ) : (
        <>
          <div className="section-heading">
            <h2>项目原料</h2>
            <button
              className="quiet"
              disabled={busy}
              onClick={() => setEditor('project')}
            >
              + 灵感
            </button>
          </div>
          <div className="segmented">
            <button
              className={resourceTab === 'ideas' ? 'active' : ''}
              onClick={() => setResourceTab('ideas')}
            >
              灵感 {project.ideas.length}
            </button>
            <button
              className={resourceTab === 'assets' ? 'active' : ''}
              onClick={() => setResourceTab('assets')}
            >
              素材 {project.assets.length}
            </button>
          </div>
          <input
            className="search"
            aria-label="搜索项目资源"
            value={resourceSearch}
            placeholder="搜索本项目…"
            onChange={(e) => setResourceSearch(e.target.value)}
          />
          {resourceTab === 'assets' && (
            <button
              className="secondary full-width"
              disabled={busy}
              onClick={() =>
                void run(() => window.watercut.importAsset(project.directory))
              }
            >
              导入项目独有副本
            </button>
          )}
          <ResourceCards
            assetSelects={project.availableSelects}
            ideas={filteredIdeas}
            assets={filteredAssets}
            scope="project"
            scopeId={project.id}
            tab={resourceTab}
            onPick={(kind, id) => select('project', kind, id)}
            selected={selectedIdeas}
            onTag={(tag) => setResourceSearch(tag)}
            onToggle={(id) =>
              setSelectedIdeas((old) =>
                old.includes(id) ? old.filter((v) => v !== id) : [...old, id],
              )
            }
            onDuration={(id, d) => duration('project', id, d)}
          />
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              void run(() => window.watercut.promoteProject(project.directory))
            }
          >
            将项目内容加入全局库 ↗
          </button>
          <small className="muted">原项目副本会保留；取消后可继续。</small>
        </>
      )}
    </aside>
  );
}
