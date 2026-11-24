import type { Project, Shot } from '../../../shared/models';
import { statusLabel } from './StoryboardView';
import { kindLabel } from '../resources';
export function ShotInspector({
  shot,
  project,
  busy,
  onRun,
  onPatchShot,
  onPatchMeta,
  onPatchTrim,
}: {
  shot: Shot;
  project: Project;
  busy: boolean;
  onRun: (action: () => Promise<unknown>) => Promise<boolean>;
  onPatchShot: (shot: Shot, patch: Partial<Shot>) => void;
  onPatchMeta: (shot: Shot, patch: Partial<Shot>) => void;
  onPatchTrim: (
    id: string,
    patch: { inMs?: number; outMs?: number | null },
  ) => void;
}) {
  const binding = project.shotAssets.find((b) => b.shotId === shot.id);
  const primary = project.assets.find((a) => a.id === binding?.assetId);
  return (
    <>
      <h2>镜头 {shot.position + 1}</h2>
      <label>
        画面
        <textarea
          disabled={busy}
          value={shot.description}
          onChange={(e) =>
            onPatchShot(shot, {
              description: e.target.value,
            })
          }
        />
      </label>
      <label>
        动作 / 对白
        <textarea
          disabled={busy}
          value={shot.actionDialogue}
          onChange={(e) =>
            onPatchShot(shot, {
              actionDialogue: e.target.value,
            })
          }
        />
      </label>
      <label>
        预计时长（秒）
        <input
          type="number"
          min=".1"
          max="600"
          step=".1"
          value={shot.durationMs / 1000}
          onChange={(e) =>
            onPatchShot(shot, {
              durationMs: Math.round(Number(e.target.value) * 1000),
            })
          }
        />
      </label>
      <div className="form-grid">
        {(
          [
            ['scene', '场景'],
            ['timeOfDay', '昼夜'],
            ['shotSize', '景别'],
            ['movement', '运镜'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              disabled={busy}
              value={shot[key]}
              onChange={(e) =>
                onPatchMeta(shot, {
                  [key]: e.target.value,
                })
              }
            />
          </label>
        ))}
      </div>
      <label>
        创作 / 拍摄状态
        <select
          disabled={busy}
          value={shot.status}
          onChange={(e) =>
            onPatchMeta(shot, {
              status: e.target.value as Shot['status'],
            })
          }
        >
          {Object.entries(statusLabel).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        关键道具
        <input
          aria-label="镜头道具"
          value={shot.props}
          maxLength={500}
          disabled={busy}
          onChange={(e) => onPatchMeta(shot, { props: e.target.value })}
        />
      </label>
      <label>
        拍摄准备
        <select
          aria-label="拍摄准备状态"
          disabled={busy}
          value={shot.productionState}
          onChange={(e) =>
            onPatchMeta(shot, {
              productionState: e.target.value as Shot['productionState'],
            })
          }
        >
          <option value="planned">计划中</option>
          <option value="filmed">已拍 / 已备齐</option>
          <option value="pickup">需要补拍</option>
        </select>
      </label>
      <label>
        添加候选画面
        <select
          disabled={busy}
          value=""
          onChange={(e) => {
            const id = e.target.value;
            if (id)
              void onRun(() =>
                window.watercut.addCandidate(project.directory, shot.id, id),
              );
          }}
        >
          <option value="">选择项目素材</option>
          {project.assets
            .filter(
              (a) =>
                a.kind !== 'audio' &&
                !project.shotCandidates.some(
                  (c) => c.shotId === shot.id && c.assetId === a.id,
                ),
            )
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        主画面
        <select
          aria-label="主画面"
          disabled={busy}
          value={binding?.assetId ?? ''}
          onChange={(e) => {
            const assetId = e.currentTarget.value;
            void onRun(() =>
              assetId
                ? window.watercut.linkAsset(project.directory, shot.id, assetId)
                : window.watercut.clearShotPrimary(project.directory, shot.id),
            );
          }}
        >
          <option value="">尚未选择</option>
          <optgroup label="候选画面">
            {project.shotCandidates
              .filter((c) => c.shotId === shot.id)
              .map((c) => (
                <option key={c.assetId} value={c.assetId}>
                  {project.assets.find((a) => a.id === c.assetId)?.name}
                </option>
              ))}
          </optgroup>
          <optgroup label="其他项目素材">
            {project.assets
              .filter(
                (a) =>
                  a.kind !== 'audio' &&
                  !project.shotCandidates.some(
                    (c) => c.shotId === shot.id && c.assetId === a.id,
                  ),
              )
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </optgroup>
        </select>
      </label>
      <div className="candidate-chips">
        {project.shotCandidates
          .filter((c) => c.shotId === shot.id)
          .map((c) => (
            <span key={c.assetId}>
              {project.assets.find((a) => a.id === c.assetId)?.name}
              <button
                disabled={busy || c.assetId === binding?.assetId}
                className="quiet"
                onClick={() =>
                  void onRun(() =>
                    window.watercut.removeCandidate(
                      project.directory,
                      shot.id,
                      c.assetId,
                    ),
                  )
                }
              >
                ×
              </button>
            </span>
          ))}
      </div>
      {binding?.sourceSelectName && (
        <div className="source-panel">
          <strong>精华来源：{binding.sourceSelectName}</strong>
          <small>
            引用版本 v{binding.sourceSelectVersion ?? '历史'} ·
            本项目裁剪独立保存
          </small>
          {project.availableSelects?.find(
            (s) =>
              s.id === binding.sourceSelectId &&
              s.version !== binding.sourceSelectVersion,
          ) && <small>总库片段已更新；拖入新版后才会替换本项目区间。</small>}
        </div>
      )}
      {primary?.kind === 'video' && binding && (
        <div className="form-grid">
          <label>
            入点（秒）
            <input
              type="number"
              min="0"
              step=".1"
              value={binding.inMs / 1000}
              onChange={(e) =>
                onPatchTrim(shot.id, {
                  inMs: Math.round(Number(e.target.value) * 1000),
                })
              }
            />
          </label>
          <label>
            出点（空为片尾）
            <input
              type="number"
              min=".1"
              step=".1"
              value={binding.outMs === null ? '' : binding.outMs / 1000}
              onChange={(e) =>
                onPatchTrim(shot.id, {
                  outMs: e.target.value
                    ? Math.round(Number(e.target.value) * 1000)
                    : null,
                })
              }
            />
          </label>
        </div>
      )}
      <label>
        参考音频
        <select
          disabled={busy}
          value={
            project.shotAudio.find((a) => a.shotId === shot.id)?.assetId ?? ''
          }
          onChange={(e) => {
            const assetId = e.currentTarget.value;
            if (assetId)
              void onRun(() =>
                window.watercut.linkAudio(project.directory, shot.id, assetId),
              );
          }}
        >
          <option value="">尚未关联</option>
          {project.assets
            .filter((a) => a.kind === 'audio')
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </label>
      <small className="muted">参考音频可单独听，不参与连续粗剪混音。</small>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={shot.needsReview}
          onChange={(e) =>
            onPatchMeta(shot, {
              needsReview: e.target.checked,
            })
          }
        />
        待优化标记
      </label>
      <label>
        优化备注
        <textarea
          value={shot.reviewNote}
          onChange={(e) =>
            onPatchMeta(shot, {
              reviewNote: e.target.value,
            })
          }
        />
      </label>
      <h3>灵感来源</h3>
      <label>
        添加项目灵感
        <select
          aria-label="添加灵感来源"
          value=""
          disabled={busy}
          onChange={(e) => {
            const ideaId = e.currentTarget.value;
            if (ideaId)
              void onRun(() =>
                window.watercut.addShotSource(
                  project.directory,
                  shot.id,
                  ideaId,
                ),
              );
          }}
        >
          <option value="">选择灵感卡片…</option>
          {project.ideas
            .filter(
              (i) =>
                !project.shotSources.some(
                  (s) => s.shotId === shot.id && s.ideaId === i.id,
                ),
            )
            .map((i) => (
              <option key={i.id} value={i.id}>
                {kindLabel[i.kind]} · {i.text.slice(0, 80)}
              </option>
            ))}
        </select>
      </label>
      <small className="muted">
        从项目灵感中选择；需要时可先从总库引用卡片。
      </small>
      {project.shotSources
        .filter((s) => s.shotId === shot.id)
        .map((s, i) => (
          <div className="source-panel" key={s.id ?? i}>
            <p>{s.excerpt}</p>
            {!s.ideaId && <small>原项目卡片已移除，保留来源摘录</small>}
            {s.id && (
              <button
                className="quiet"
                disabled={busy}
                onClick={() =>
                  void onRun(() =>
                    window.watercut.removeShotSource(
                      project.directory,
                      shot.id,
                      s.id!,
                    ),
                  )
                }
              >
                移除来源
              </button>
            )}
          </div>
        ))}
    </>
  );
}
