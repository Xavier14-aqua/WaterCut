import { IdeaForm } from '../../features/inspiration';
import type { AppModel } from '../useAppController';
import { Modal } from '../../ui/Modal';

export function IdeaEditorDialog({ model }: { model: AppModel }) {
  const { busy, editor, library, project, run, setEditor } = model;
  return (
    editor && (
      <Modal
        label={editor === 'library' ? '记录到全局灵感库' : '记录到当前项目'}
        onClose={() => setEditor(null)}
        canDismiss={!busy}
      >
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
      </Modal>
    )
  );
}
