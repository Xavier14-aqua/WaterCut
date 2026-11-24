import { LibraryBrowser } from '../../features/library';
import { Inspector } from '../Inspector';
import { UIErrorBoundary } from '../../ui/UIErrorBoundary';
import { ProjectLibraryBrowser } from '../../features/library';
import type { AppModel } from '../useAppController';

export function GlobalLibrary({ model }: { model: AppModel }) {
  const {
    applyLibraryProject,
    applyProject,
    attach,
    browseDuration,
    busy,
    duration,
    globalSelection,
    library,
    libraryProject,
    libraryProjectRef,
    libraryView,
    mode,
    name,
    patchIdea,
    patchMeta,
    patchShot,
    patchTrim,
    project,
    refresh,
    refreshed,
    relationNote,
    run,
    select,
    selection,
    setEditor,
    setGlobalSelection,
    setLibraryView,
    setMessage,
    setMode,
    setName,
    setRelationNote,
    setSelection,
    setView,
    toggleGlobal,
  } = model;
  return (
    mode === 'library' && (
      <div className="global-library-layout">
        <main className="library-main">
          <div className="section-heading">
            <div>
              <p className="eyebrow">LIBRARY</p>
              <h1>平时囤下，创作时找到</h1>
            </div>
          </div>
          <div
            className="library-scope-switch segmented"
            aria-label="资源库范围"
          >
            <button
              className={libraryView === 'global' ? 'active' : ''}
              disabled={busy}
              onClick={() => {
                setLibraryView('global');
                setSelection(null);
              }}
            >
              全局总库
            </button>
            <button
              className={libraryView === 'project' ? 'active' : ''}
              disabled={busy}
              onClick={() => {
                setLibraryView('project');
                setSelection(null);
              }}
            >
              项目库
            </button>
          </div>
          {libraryView === 'global' ? (
            <>
              <div className="incubate-bar">
                <span>{globalSelection.length} 张卡片已选</span>
                <input
                  aria-label="关系备注"
                  value={relationNote}
                  onChange={(e) => setRelationNote(e.target.value)}
                  placeholder="两张卡片的关系备注"
                />
                <button
                  className="secondary"
                  disabled={busy || globalSelection.length !== 2}
                  onClick={() =>
                    void run(async () => {
                      await window.watercut.connectLibraryIdeas(
                        globalSelection[0],
                        globalSelection[1],
                        'related',
                        relationNote,
                      );
                      return true;
                    })
                  }
                >
                  建立关联
                </button>
                <input
                  aria-label="孵化项目名称"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="新项目名称"
                />
                <button
                  disabled={busy || !globalSelection.length}
                  onClick={() =>
                    void run(async () => {
                      const p = await window.watercut.createProject(
                        name.trim() || '灵感项目',
                      );
                      const result = await window.watercut.attachLibraryIdeas(
                        p.directory,
                        globalSelection,
                      );
                      setMode('project');
                      setView('board');
                      setGlobalSelection([]);
                      return result;
                    })
                  }
                >
                  孵化为项目
                </button>
              </div>
              <LibraryBrowser
                key={library?.id}
                refresh={refresh}
                busy={busy}
                onRun={run}
                onPick={(kind, id) => select('library', kind, id)}
                onAdd={project ? attach : undefined}
                onCreate={() => setEditor('library')}
                onImport={() =>
                  void run(() => window.watercut.importLibraryAssets())
                }
                onToggle={toggleGlobal}
                selected={globalSelection}
                onError={setMessage}
                onDuration={(id, d) => duration('library', id, d)}
              />
            </>
          ) : (
            <ProjectLibraryBrowser
              projects={library?.projects ?? []}
              project={libraryProject}
              preferredDirectory={
                libraryProject?.directory ?? project?.directory
              }
              refresh={refresh}
              onRun={(action) => run(action, applyLibraryProject)}
              onProject={applyLibraryProject}
              onPick={(kind, id) => select('project', kind, id)}
              onOpen={() =>
                void run(async () => {
                  const p = libraryProjectRef.current;
                  if (!p) return null;
                  setMode('project');
                  setView('board');
                  return window.watercut.readProject(p.directory);
                })
              }
              onError={setMessage}
              busy={busy}
            />
          )}
        </main>
        <UIErrorBoundary
          scope="inspector"
          resetKey={`${selection?.scope}:${selection?.kind}:${selection?.id}`}
          onReset={() => setSelection(null)}
        >
          <Inspector
            selection={selection}
            project={libraryView === 'project' ? libraryProject : project}
            library={library}
            busy={busy}
            onClose={() => setSelection(null)}
            onNotice={setMessage}
            onRun={(action) =>
              run(
                action,
                libraryView === 'project' ? applyLibraryProject : applyProject,
              )
            }
            onPatchShot={patchShot}
            onPatchMeta={patchMeta}
            onPatchTrim={patchTrim}
            onPatchIdea={patchIdea}
            onRefresh={refreshed}
            onDuration={libraryView === 'project' ? browseDuration : duration}
            autoSaveIdeas={libraryView !== 'project'}
            onNavigateIdea={(id) => select('library', 'idea', id)}
          />
        </UIErrorBoundary>
      </div>
    )
  );
}
