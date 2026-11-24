import type { AppModel } from '../useAppController';

export function IncubationDialog({ model }: { model: AppModel }) {
  const { busy, order, orderWarning, project, run, setOrder, setView } = model;
  return (
    order &&
    project && (
      <div className="modal-backdrop">
        <section className="modal">
          <h2>确认分镜顺序</h2>
          <p>
            {orderWarning
              ? '所选连线含分叉、环路或断开，请手动确认顺序。'
              : '已按单链方向排列，可在写入前调整。'}
          </p>
          {order.map((id, index) => (
            <div className="order-row" key={id}>
              <strong>{index + 1}</strong>
              <span>{project.ideas.find((i) => i.id === id)?.text}</span>
              <button
                className="quiet"
                disabled={!index}
                onClick={() =>
                  setOrder((old) => {
                    const next = [...old!];
                    [next[index - 1], next[index]] = [
                      next[index],
                      next[index - 1],
                    ];
                    return next;
                  })
                }
              >
                ↑
              </button>
              <button
                className="quiet"
                disabled={index === order.length - 1}
                onClick={() =>
                  setOrder((old) => {
                    const next = [...old!];
                    [next[index + 1], next[index]] = [
                      next[index],
                      next[index + 1],
                    ];
                    return next;
                  })
                }
              >
                ↓
              </button>
            </div>
          ))}
          <div className="toolbar">
            <button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  window.watercut.createShotsFromIdeas(
                    project.directory,
                    order,
                    crypto.randomUUID(),
                  ),
                ).then((ok) => {
                  if (ok) {
                    setOrder(null);
                    setView('storyboard');
                  }
                })
              }
            >
              创建镜头骨架
            </button>
            <button className="secondary" onClick={() => setOrder(null)}>
              取消
            </button>
          </div>
        </section>
      </div>
    )
  );
}
