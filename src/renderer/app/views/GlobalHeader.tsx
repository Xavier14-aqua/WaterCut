import { views, View } from '../navigation';
import type { AppModel } from '../useAppController';

export function GlobalHeader({ model }: { model: AppModel }) {
  const {
    busy,
    changeView,
    message,
    mode,
    name,
    project,
    run,
    setShowDelivery,
    view,
  } = model;
  const activeProject = mode === 'project' && project;
  return (
    <header className="global-header">
      <div className="header-title">
        {activeProject ? (
          <input
            key={project.id + project.name}
            aria-label="项目名称"
            defaultValue={project.name}
            disabled={busy}
            onBlur={(e) => {
              if (e.target.value.trim() && e.target.value !== project.name)
                void run(() =>
                  window.watercut.renameProject(
                    project.directory,
                    e.target.value,
                  ),
                );
            }}
          />
        ) : (
          <strong>
            {mode === 'library' ? '你的灵感，总会用得上' : 'WaterCut 创作空间'}
          </strong>
        )}
      </div>
      {activeProject && (
        <nav className="workflow" aria-label="创作流程">
          {(Object.entries(views) as Array<[View, string]>).map(
            ([key, label]) => (
              <button
                key={key}
                className={view === key ? 'active' : ''}
                onClick={() => void changeView(key)}
              >
                {label}
              </button>
            ),
          )}
        </nav>
      )}
      {activeProject && (
        <button
          className="secondary delivery-toggle"
          disabled={busy}
          onClick={() => setShowDelivery(true)}
        >
          版本与交付
        </button>
      )}
      <span className={`save-state ${message.includes('失败') ? 'error' : ''}`}>
        {busy
          ? '处理中…'
          : message.startsWith('保存失败')
            ? '保存失败'
            : message === '未保存'
              ? '未保存'
              : message === '保存中…'
                ? '保存中…'
                : '本地保存'}
      </span>
    </header>
  );
}
