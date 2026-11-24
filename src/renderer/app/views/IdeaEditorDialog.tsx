import { IdeaForm } from '../../features/inspiration/IdeaForm';
import type { AppModel } from '../useAppController';

export function IdeaEditorDialog({ model }: { model: AppModel }) {
  const { busy, editor, library, project, run, setEditor } = model;
  return (
    editor && (
      <div className="modal-backdrop">
        <section className="modal">
          <IdeaForm
            key={editor}
            libraryMode={editor === 'library'}
            mediaScopeId={editor === 'library' ? library?.id : project?.id}
            assets={
              editor === 'library'
                ? (library?.assets ?? [])
                : (project?.assets ?? [])
            }
            heading={
              editor === 'library' ? '记录到全局灵感库' : '记录到当前项目'
            }
            busy={busy}
            onCancel={() => setEditor(null)}
            onSave={async (input) => {
              const ok = await run(() =>
                editor === 'library'
                  ? window.watercut.saveLibraryIdea(input)
                  : window.watercut.createIdea(project!.directory, input),
              );
              if (ok) setEditor(null);
              return ok;
            }}
          />
        </section>
      </div>
    )
  );
}
