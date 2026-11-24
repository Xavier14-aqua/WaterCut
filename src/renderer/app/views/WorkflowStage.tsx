import { IdeaBoard } from '../../features/board';
import { ScriptView } from '../../features/script';
import { StoryboardView } from '../../features/storyboard';
import { PreviewView } from '../../features/preview';
import { AIDrawer } from '../../features/ai';
import type { AppModel } from '../useAppController';
import { BlueprintArt } from '../../ui/BlueprintArt';

export function WorkflowStage({ model }: { model: AppModel }) {
  const {
    busy,
    dropResource,
    duration,
    patchBlock,
    patchMeta,
    patchShot,
    prepareOrder,
    project,
    run,
    select,
    selectedIdeas,
    selection,
    setMessage,
    setSelectedIdeas,
    setShotListFilter,
    shotListFilter,
    view,
  } = model;
  if (!project) return null;
  return (
    <main className="workspace-main" data-stage={view}>
      {view === 'script' && <BlueprintArt className="workflow-orbit" />}
      {view === 'board' && (
        <section className="board-view">
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                IDEA BOARD <span>// 01_CANVAS</span>
              </p>
              <h1>先让想法连起来</h1>
            </div>
            <button
              className="secondary"
              disabled={busy || !selectedIdeas.length}
              onClick={prepareOrder}
            >
              所选 {selectedIdeas.length} 张 → 分镜
            </button>
          </div>
          <p className="muted">
            框选或 Ctrl 多选。从资源栏拖入卡片；从连接点拉线，写下衔接想法。
          </p>
          <IdeaBoard
            project={project}
            busy={busy}
            selectedIds={selectedIdeas}
            onSelection={(ids) =>
              setSelectedIdeas((old) =>
                old.length === ids.length && old.every((id) => ids.includes(id))
                  ? old
                  : ids,
              )
            }
            onPick={(id) => select('project', 'idea', id)}
            onMove={(id, x, y) =>
              void run(() =>
                window.watercut.moveIdea(project.directory, id, x, y),
              )
            }
            onConnect={(source, target, sourceHandle, targetHandle) =>
              void run(() =>
                window.watercut.connectIdeas(
                  project.directory,
                  source,
                  target,
                  sourceHandle,
                  targetHandle,
                ),
              )
            }
            onDisconnect={(id) =>
              void run(() =>
                window.watercut.disconnectIdeas(project.directory, id),
              )
            }
            onLabel={(id, label) =>
              void run(() =>
                window.watercut.updateEdgeLabel(project.directory, id, label),
              )
            }
            onDropResource={(resource, x, y) =>
              void dropResource(resource, undefined, {
                x,
                y,
              })
            }
          />
        </section>
      )}
      {view === 'script' && (
        <ScriptView
          project={project}
          busy={busy}
          onSection={(beforeId) =>
            void run(() =>
              window.watercut.createScriptSection(project.directory, {
                title: '新标题',
                beforeId,
              }),
            )
          }
          onParagraph={(id) =>
            void run(() =>
              window.watercut.addScriptParagraph(project.directory, id),
            )
          }
          onReorder={(ids) =>
            void run(() =>
              window.watercut.reorderScriptBlocks(project.directory, ids),
            )
          }
          onAdd={(kind) =>
            void run(() =>
              window.watercut.saveScriptBlock(project.directory, {
                kind,
                text: '',
              }),
            )
          }
          onPatchBlock={patchBlock}
          onPatchShot={patchShot}
          onConvert={(ids) =>
            void run(() =>
              window.watercut.convertScriptBlocks(
                project.directory,
                ids,
                crypto.randomUUID(),
              ),
            )
          }
          onSplit={(id, offset) => {
            if (!offset) {
              setMessage('请先把光标放在正文中间，再点拆分');
              return;
            }
            if (
              window.confirm(
                '在光标处拆分正文？已关联镜头会拆成两个：第一镜保留主画面，新镜头留空并标记待检查。',
              )
            )
              void run(() =>
                window.watercut.splitScriptBlock(project.directory, id, offset),
              );
          }}
          onMerge={(first, second) => {
            if (
              window.confirm(
                '合并相邻段落？若已关联镜头，将保留第一镜的主画面，其他候选和来源合并，第二镜移除。',
              )
            )
              void run(() =>
                window.watercut.mergeScriptBlocks(
                  project.directory,
                  first,
                  second,
                ),
              );
          }}
          onDelete={(id) =>
            void run(() =>
              window.watercut.deleteScriptBlock(project.directory, id),
            )
          }
        />
      )}
      {(view === 'storyboard' || view === 'checklist') && (
        <StoryboardView
          key={view}
          checklist={view === 'checklist'}
          project={project}
          busy={busy}
          selected={selection?.kind === 'shot' ? selection.id : undefined}
          onSelect={(id) => select('project', 'shot', id)}
          onAdd={() =>
            void run(() =>
              window.watercut.addShot(project.directory, {
                description: '新镜头',
                durationMs: 3000,
              }),
            )
          }
          onPatch={patchShot}
          onDrop={(id, resource) => void dropResource(resource, id)}
          onMove={(id, offset) =>
            void run(() =>
              window.watercut.moveShot(project.directory, id, offset),
            )
          }
          onDelete={(id) =>
            void run(() => window.watercut.deleteShot(project.directory, id))
          }
          filter={shotListFilter}
          onFilter={setShotListFilter}
          onPDF={() =>
            void run(() =>
              window.watercut.exportStoryboardPDF(project.directory, {
                landscape: true,
                checklist: true,
                filter: shotListFilter,
              }),
            )
          }
          onExport={() =>
            void run(() =>
              window.watercut.exportShotList(project.directory, shotListFilter),
            )
          }
        />
      )}
      {view === 'preview' && (
        <PreviewView
          project={project}
          busy={busy}
          onRun={run}
          onSelect={(id) => select('project', 'shot', id)}
          onReorder={(ids) =>
            void run(() => window.watercut.reorderShots(project.directory, ids))
          }
          onTrim={(id, inMs, outMs) =>
            void run(() =>
              window.watercut.updateTrim(project.directory, id, inMs, outMs),
            )
          }
          onPatch={(shot, patch) =>
            'needsReview' in patch
              ? patchMeta(shot, patch)
              : patchShot(shot, patch)
          }
          onDuration={(id, d) => duration('project', id, d)}
        />
      )}
      <AIDrawer
        key={project.id}
        project={project}
        selected={selectedIdeas}
        busy={busy}
        onNotice={setMessage}
        selectedShot={selection?.kind === 'shot' ? selection.id : undefined}
        onRun={run}
      />
    </main>
  );
}
