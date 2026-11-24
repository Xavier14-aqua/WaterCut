import type { AppModel } from '../useAppController';
import { Modal } from '../../ui/Modal';

export function StorageDialog({ model }: { model: AppModel }) {
  const {
    busy,
    projectRef,
    run,
    setSelection,
    setSettings,
    setShowSettings,
    settings,
    showSettings,
  } = model;
  return (
    showSettings && (
      <Modal label="本地存储" onClose={() => setShowSettings(false)}>
        <section className="modal">
          <div className="section-heading">
            <h2>本地存储</h2>
            <button className="quiet" onClick={() => setShowSettings(false)}>
              关闭
            </button>
          </div>
          <p>
            项目与总库保存在程序外。修改项目目录只影响以后新建的项目；切换总库会打开另一库，不自动搬移原件。
          </p>
          {settings &&
            (['projectsRoot', 'libraryRoot'] as const).map((field) => (
              <div className="storage-row" key={field}>
                <strong>
                  {field === 'projectsRoot' ? '新项目保存位置' : '全局库位置'}
                </strong>
                <p className="path">{settings[field]}</p>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const next =
                        await window.watercut.chooseStorageRoot(field);
                      if (next) {
                        setSettings(next);
                        setSelection(null);
                        if (projectRef.current)
                          return window.watercut.readProject(
                            projectRef.current.directory,
                          );
                      }
                      return next;
                    })
                  }
                >
                  选择位置
                </button>
              </div>
            ))}
        </section>
      </Modal>
    )
  );
}
