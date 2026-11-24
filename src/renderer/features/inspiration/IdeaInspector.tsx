import type {
  Asset,
  Idea,
  IdeaInput,
  LibraryAsset,
  LibraryIdea,
  LibraryPage,
  Project,
  RelatedIdea,
} from '../../../shared/models';
import { IdeaForm } from './IdeaForm';
export function IdeaInspector({
  scope,
  idea,
  assets,
  project,
  library,
  source,
  related,
  relationIdeas,
  relationNote,
  setRelationNote,
  busy,
  onClose,
  onRun,
  onPatchIdea,
  onRefresh,
  autoSaveIdeas,
  onNavigateIdea,
}: {
  scope: 'library' | 'project';
  idea: Idea | LibraryIdea;
  assets: Array<Asset | LibraryAsset>;
  project: Project | null;
  library: LibraryPage | null;
  source: LibraryIdea | null;
  related: RelatedIdea[];
  relationIdeas: Record<string, LibraryIdea | null>;
  relationNote: string;
  setRelationNote: (text: string) => void;
  busy: boolean;
  onClose: () => void;
  onRun: (action: () => Promise<unknown>) => Promise<boolean>;
  onPatchIdea: (id: string, input: IdeaInput) => void;
  onRefresh: () => void;
  autoSaveIdeas: boolean;
  onNavigateIdea?: (id: string) => void;
}) {
  return (
    <>
      <IdeaForm
        key={scope + idea.id}
        libraryMode={scope === 'library'}
        mediaScopeId={scope === 'library' ? library?.id : project?.id}
        value={idea}
        assets={assets}
        busy={busy}
        onCancel={onClose}
        onDraft={
          scope === 'project' && autoSaveIdeas
            ? (input) => onPatchIdea(idea.id, input)
            : undefined
        }
        onSave={async (input) => {
          const ok = await onRun(() =>
            scope === 'library'
              ? window.watercut.saveLibraryIdea(input)
              : window.watercut.updateIdea(project!.directory, idea.id, input),
          );
          if (ok) {
            onRefresh();
            onClose();
          }
          return ok;
        }}
      />
      {source && 'sourceVersion' in idea && (
        <div className="source-panel">
          <strong>
            全局来源 v{source.version} · 引用 v{idea.sourceVersion}
          </strong>
          <p>{source.text}</p>
          {source.version !== idea.sourceVersion && (
            <>
              <small>
                来源已更新。应用后会替换本项目卡片的文字、标签和参考素材；位置与镜头来源保留。
              </small>
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      '使用当前全局内容更新本项目卡片？项目内的文字修改会被替换。',
                    )
                  )
                    void onRun(() =>
                      window.watercut.refreshLibraryIdea(
                        project!.directory,
                        idea.id,
                      ),
                    );
                }}
              >
                使用来源更新
              </button>
            </>
          )}
        </div>
      )}
      <div className="inspector-actions">
        {scope === 'library' ? (
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void onRun(async () => {
                await window.watercut.hideLibraryItem(
                  'idea',
                  idea.id,
                  !(idea as LibraryIdea).hidden,
                );
                onRefresh();
                onClose();
              })
            }
          >
            {'hidden' in idea && idea.hidden ? '恢复到总库' : '在总库隐藏'}
          </button>
        ) : (
          <button
            className="danger"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  '删除本项目卡片和白板连线？总库来源和素材原件保留。',
                )
              )
                void onRun(() =>
                  window.watercut.deleteIdea(project!.directory, idea.id),
                ).then((ok) => {
                  if (ok) onClose();
                });
            }}
          >
            删除项目卡片
          </button>
        )}
      </div>
      {scope === 'library' && library && (
        <div className="related-drawer">
          <h3>已手动关联</h3>
          {library.relations
            .filter((r) => r.source === idea.id || r.target === idea.id)
            .map((r) => (
              <div className="related-item" key={r.id}>
                <small>
                  {
                    {
                      related: '关联',
                      sequence: '顺序',
                      contrast: '对照',
                    }[r.kind]
                  }{' '}
                  · {r.note || '未填写关系备注'}
                </small>
                <button
                  className="related-title quiet"
                  title={
                    relationIdeas[r.source === idea.id ? r.target : r.source]
                      ?.text
                  }
                  disabled={
                    busy ||
                    !relationIdeas[r.source === idea.id ? r.target : r.source]
                  }
                  onClick={() =>
                    onNavigateIdea?.(r.source === idea.id ? r.target : r.source)
                  }
                >
                  {relationIdeas[r.source === idea.id ? r.target : r.source]
                    ?.text ??
                    (r.source in relationIdeas || r.target in relationIdeas
                      ? '关联卡片暂不可用'
                      : '正在读取卡片标题…')}
                </button>
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() =>
                    void onRun(async () => {
                      await window.watercut.disconnectLibraryIdeas(r.id);
                      onRefresh();
                    })
                  }
                >
                  移除关系
                </button>
              </div>
            ))}
          <h3>同时间 / 同标签发现</h3>
          <input
            aria-label="关联备注"
            placeholder="建立关系时的备注（可选）"
            value={relationNote}
            onChange={(e) => setRelationNote(e.target.value)}
          />
          <small className="muted">这些是候选，确认后才建立关系。</small>
          {related.map((item) => (
            <div className="related-item" key={item.idea.id}>
              <strong>{item.idea.text}</strong>
              <small>{item.reasons.join(' · ')}</small>
              <button
                className="quiet"
                onClick={() => {
                  void onRun(async () => {
                    await window.watercut.connectLibraryIdeas(
                      idea.id,
                      item.idea.id,
                      'related',
                      relationNote,
                    );
                    onRefresh();
                  });
                }}
              >
                确认关联
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
