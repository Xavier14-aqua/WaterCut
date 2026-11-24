import type { AppModel } from '../useAppController';
import { BlueprintArt } from '../../ui/BlueprintArt';
import { Icon } from '../../ui/Icon';

export function ProjectHome({ model }: { model: AppModel }) {
  const {
    busy,
    library,
    mode,
    name,
    readRecent,
    run,
    setMode,
    setName,
    setShowArchived,
    setShowDelivery,
    setView,
    showArchived,
  } = model;
  return (
    mode === 'home' && (
      <main className="home-page">
        <div className="home-intro">
          <BlueprintArt className="home-orbit" />
          <p className="eyebrow">
            FROM A SPARK TO A STORY <span>// 001_GENESIS</span>
            <span className="reference-star" aria-hidden="true">
              ✦
            </span>
          </p>
          <h1>
            给下一个故事，
            <br />
            留一个开始。
          </h1>
          <p>收集零散灵感，整理画面，在拍齐素材之前看见全片。</p>
          <div className="toolbar">
            <input
              aria-label="新项目名称"
              placeholder="项目名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              disabled={busy || !name.trim()}
              onClick={() =>
                void run(async () => {
                  const p = await window.watercut.createProject(name);
                  setMode('project');
                  setView('board');
                  setName('');
                  return p;
                })
              }
            >
              <Icon name="plus" />
              新建项目
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const p = await window.watercut.openProject();
                  if (p) setMode('project');
                  return p;
                })
              }
            >
              打开项目文件夹
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const p = await window.watercut.importProjectPackage();
                  if (p) {
                    setMode('project');
                    setView('board');
                    setShowDelivery(false);
                  }
                  return p;
                })
              }
            >
              导入项目包
            </button>
          </div>
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const p = await window.watercut.createExample();
                setMode('project');
                setView('preview');
                return p;
              })
            }
          >
            用官方示例体验一条故事 →
          </button>
        </div>
        <div className="section-heading">
          <h2>
            项目大厅{' '}
            <span className="collection-code">// INDEX: ALL_PROJECTS</span>
          </h2>
          <div className="toolbar">
            <label>
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              查看归档
            </label>
            <button
              className="quiet"
              disabled={busy}
              onClick={() => void run(() => window.watercut.reconcileLibrary())}
            >
              核对项目索引
            </button>
          </div>
        </div>
        <div className="project-grid">
          {library?.projects
            .filter((p) => (showArchived ? p.archived : !p.archived))
            .map((item, index) => (
              <article key={item.id} className="project-tile">
                <div className="project-cover" aria-hidden="true">
                  <BlueprintArt
                    variant={
                      index % 3 === 1
                        ? 'tunnel'
                        : index % 3 === 2
                          ? 'film'
                          : 'orbit'
                    }
                  />
                  {index % 3 === 0 && (
                    <strong className="cover-title">{item.name}</strong>
                  )}
                  <i className="cover-point" />
                </div>
                <h3>{item.name}</h3>
                <small>
                  {item.available ? '本地项目' : '项目位置离线'} ·{' '}
                  {new Date(item.lastSeen).toLocaleDateString('zh-CN')}
                </small>
                <p className="path">{item.directory}</p>
                <div className="project-actions">
                  <button
                    className="project-open"
                    disabled={busy || !item.available}
                    onClick={() =>
                      void run(async () => {
                        const p = await window.watercut.readProject(
                          item.directory,
                        );
                        setMode('project');
                        return p;
                      })
                    }
                  >
                    进入工作室 <Icon name="arrow" />
                  </button>
                  <button
                    className="project-archive secondary"
                    disabled={busy || !item.available}
                    onClick={() =>
                      void run(() =>
                        window.watercut.archiveProject(
                          item.directory,
                          !item.archived,
                        ),
                      )
                    }
                  >
                    {item.archived ? '恢复归档' : '归档'}
                  </button>
                </div>
              </article>
            ))}
        </div>
        {!library?.projects.length && (
          <div className="empty-state">
            还没有已登记项目。可以新建，或打开现有 .watercut 文件夹。
          </div>
        )}
        <details>
          <summary>旧版最近项目</summary>
          {readRecent().map((dir) => (
            <button
              key={dir}
              className="recent-path"
              onClick={() =>
                void run(async () => {
                  const p = await window.watercut.readProject(dir);
                  setMode('project');
                  return p;
                })
              }
            >
              {dir}
            </button>
          ))}
        </details>
      </main>
    )
  );
}
