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
import { Icon } from '../ui/Icon';

export function AppShell({ model }: { model: AppModel }) {
  const {
    busy,
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
    <div className="app-shell" data-mode={mode}>
      <nav className="rail" aria-label="主导航">
        <strong className="rail-brand">
          W<span>WaterCut</span>
        </strong>
        <button
          className={mode === 'home' ? 'active' : ''}
          aria-current={mode === 'home' ? 'page' : undefined}
          onClick={() => void changeMode('home')}
        >
          <Icon name="projects" />
          <span>项目</span>
        </button>
        <button
          className={mode === 'library' ? 'active' : ''}
          aria-current={mode === 'library' ? 'page' : undefined}
          onClick={() => void changeMode('library')}
        >
          <Icon name="library" />
          <span>总库</span>
        </button>
        {project && (
          <button
            className={mode === 'project' ? 'active' : ''}
            aria-current={mode === 'project' ? 'page' : undefined}
            onClick={() => void changeMode('project')}
          >
            <Icon name="studio" />
            <span>工作室</span>
          </button>
        )}
        <button className="rail-settings" onClick={() => setShowSettings(true)}>
          <Icon name="settings" />
          <span>存储</span>
        </button>
        <small>v{appVersion}</small>
      </nav>
      <div className="app-content">
        <GlobalHeader model={model} />
        <ProjectHome model={model} />
        <GlobalLibrary model={model} />
        <StudioWorkspace model={model} />
        <footer className="app-status" role="status">
          <span className="status-code" aria-hidden="true">
            STATUS //{' '}
            {busy
              ? 'WORKING'
              : message.includes('失败')
                ? 'ERROR'
                : message === '已保存'
                  ? 'SAVED'
                  : 'READY'}{' '}
            /
          </span>
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
