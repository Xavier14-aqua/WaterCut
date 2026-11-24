import { version as appVersion } from '../../../package.json';
import { friendly } from './errors';
import type { AppModel } from './useAppController';
import { ProjectHome } from './views/ProjectHome';
import { GlobalLibrary } from './views/GlobalLibrary';
import { GlobalHeader } from './views/GlobalHeader';
import { StudioWorkspace } from './views/StudioWorkspace';
import { DeliveryDialog } from './views/DeliveryDialog';
import { StorageDialog } from './views/StorageDialog';
import { IdeaEditorDialog } from './views/IdeaEditorDialog';
import { IncubationDialog } from './views/IncubationDialog';

export function AppShell({ model }: { model: AppModel }) {
  const {
    changeMode,
    flush,
    message,
    mode,
    progress,
    project,
    setMessage,
    setShowSettings,
  } = model;

  return (
    <div className="app-shell">
      <nav className="rail" aria-label="主导航">
        <strong className="rail-brand">
          W<span>WaterCut</span>
        </strong>
        <button
          className={mode === 'home' ? 'active' : ''}
          onClick={() => void changeMode('home')}
        >
          ▦<span>项目</span>
        </button>
        <button
          className={mode === 'library' ? 'active' : ''}
          onClick={() => void changeMode('library')}
        >
          ◈<span>总库</span>
        </button>
        {project && (
          <button
            className={mode === 'project' ? 'active' : ''}
            onClick={() => void changeMode('project')}
          >
            ▤<span>工作室</span>
          </button>
        )}
        <button className="rail-settings" onClick={() => setShowSettings(true)}>
          ⚙<span>存储</span>
        </button>
        <small>v{appVersion}</small>
      </nav>
      <div className="app-content">
        <GlobalHeader model={model} />
        <ProjectHome model={model} />
        <GlobalLibrary model={model} />
        <StudioWorkspace model={model} />
        <footer className="app-status" role="status">
          <span>{message}</span>
          {message.includes('保存失败') && (
            <button
              className="quiet"
              onClick={() => void flush().catch((e) => setMessage(friendly(e)))}
            >
              重试保存
            </button>
          )}
          {progress && (
            <div className="import-progress">
              <progress
                value={progress.copied}
                max={Math.max(1, progress.total)}
              />
              <span>
                {progress.phase ?? ''}{' '}
                {Math.floor(
                  (progress.copied / Math.max(1, progress.total)) * 100,
                )}
                %
              </span>
              <button
                className="quiet"
                onClick={() => void window.watercut.cancelImport()}
              >
                取消任务
              </button>
            </div>
          )}
        </footer>
      </div>
      <DeliveryDialog model={model} />
      <StorageDialog model={model} />
      <IdeaEditorDialog model={model} />
      <IncubationDialog model={model} />
    </div>
  );
}
