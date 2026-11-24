import { useState } from 'react';
import type {
  Project,
  ResourceDrag,
  Shot,
  ShotListFilter,
} from '../../../shared/models';
import { filterShotList } from '../../../shared/creative';
import { mediaUrl } from '../../platform/media-url';
import { readResourceDrag } from '../../platform/resource-drag';
import { effectiveDurationMs } from '../../../shared/duration';
import { FrameGuide } from '../../ui/BlueprintArt';
export const statusLabel = {
  idea: '想法',
  written: '文案已定',
  to_shoot: '待拍',
  ready: '可用',
  locked: '定稿',
};
export function StoryboardView({
  project,
  busy,
  selected,
  onSelect,
  onAdd,
  onPatch,
  onDrop,
  onMove,
  onDelete,
  checklist = false,
  onExport,
  filter = { onlyGaps: true },
  onFilter,
  onPDF,
}: {
  project: Project;
  busy: boolean;
  selected?: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onPatch: (shot: Shot, patch: Partial<Shot>) => void;
  onDrop: (shotId: string, resource: ResourceDrag) => void;
  onMove: (id: string, offset: -1 | 1) => void;
  onDelete: (id: string) => void;
  checklist?: boolean;
  onExport?: () => void;
  filter?: ShotListFilter;
  onFilter?: (filter: ShotListFilter) => void;
  onPDF?: () => void;
}) {
  const [mode, setMode] = useState('board');
  const rows = checklist ? filterShotList(project, filter) : project.shots;
  const groups = checklist
    ? [
        ...new Set(
          rows.map(
            (s) => `${s.scene || '未分场景'} · ${s.timeOfDay || '昼夜待定'}`,
          ),
        ),
      ]
    : ['全部'];
  return (
    <section className="storyboard-view">
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            {checklist ? 'SHOT LIST' : 'STORYBOARD'}{' '}
            <span>{checklist ? '// 05_PRODUCTION' : '// 03_FRAMES'}</span>
          </p>
          <h1>{checklist ? '下一次拍摄，从这里开始' : '把画面排成故事'}</h1>
        </div>
        {checklist ? (
          <button disabled={busy} onClick={onExport}>
            导出 CSV
          </button>
        ) : (
          <div className="segmented">
            <button
              className={mode === 'board' ? 'active' : ''}
              onClick={() => setMode('board')}
            >
              故事板
            </button>
            <button
              className={mode === 'list' ? 'active' : ''}
              onClick={() => setMode('list')}
            >
              清单
            </button>
          </div>
        )}
      </div>
      {checklist && (
        <div className="shot-list-filters">
          <label>
            场景
            <select
              aria-label="清单场景"
              value={filter.scene ?? ''}
              onChange={(e) => onFilter?.({ ...filter, scene: e.target.value })}
            >
              <option value="">全部场景</option>
              {[
                ...new Set(project.shots.map((s) => s.scene).filter(Boolean)),
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            昼夜
            <select
              aria-label="清单昼夜"
              value={filter.timeOfDay ?? ''}
              onChange={(e) =>
                onFilter?.({ ...filter, timeOfDay: e.target.value })
              }
            >
              <option value="">全部昼夜</option>
              {[
                ...new Set(
                  project.shots.map((s) => s.timeOfDay).filter(Boolean),
                ),
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            道具
            <input
              aria-label="清单道具"
              placeholder="搜索道具"
              value={filter.props ?? ''}
              onChange={(e) => onFilter?.({ ...filter, props: e.target.value })}
            />
          </label>
          <label>
            拍摄准备
            <select
              aria-label="清单拍摄准备"
              value={filter.productionState ?? ''}
              onChange={(e) =>
                onFilter?.({
                  ...filter,
                  productionState: (e.target.value ||
                    undefined) as ShotListFilter['productionState'],
                })
              }
            >
              <option value="">全部状态</option>
              <option value="planned">计划中</option>
              <option value="filmed">已拍 / 已备齐</option>
              <option value="pickup">需要补拍</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={filter.onlyGaps !== false}
              onChange={(e) =>
                onFilter?.({ ...filter, onlyGaps: e.target.checked })
              }
            />
            仅待拍 / 缺口
          </label>
          <button className="secondary" disabled={busy} onClick={onPDF}>
            导出当前筛选 PDF
          </button>
          <small className="muted">
            {rows.length} / {project.shots.length} 个镜头。CSV 和 PDF
            使用当前筛选。
          </small>
        </div>
      )}
      {!checklist && (
        <div className="toolbar">
          <button disabled={busy} onClick={onAdd}>
            + 镜头
          </button>
          <small className="muted">
            从资源栏拖入素材作为候选；在检查器中指定主画面。
          </small>
        </div>
      )}
      {!rows.length && (
        <div className="empty-state">
          {checklist
            ? '当前没有待拍或缺少主画面的镜头。'
            : '从白板转入一组卡片，或手工添加镜头。'}
        </div>
      )}
      {groups.map((group) => (
        <div key={group}>
          {checklist && <h3>{group}</h3>}
          <div
            className={
              mode === 'list' || checklist ? 'shots-table' : 'shots-grid'
            }
          >
            {rows
              .filter(
                (s) =>
                  !checklist ||
                  `${s.scene || '未分场景'} · ${s.timeOfDay || '昼夜待定'}` ===
                    group,
              )
              .map((shot) => {
                const binding = project.shotAssets.find(
                    (b) => b.shotId === shot.id,
                  ),
                  asset = project.assets.find((a) => a.id === binding?.assetId),
                  sources = project.shotSources.filter(
                    (s) => s.shotId === shot.id,
                  ),
                  duration = effectiveDurationMs(shot, asset, binding);
                return (
                  <article
                    className={`shot-tile ${selected === shot.id ? 'selected' : ''} ${shot.needsReview ? 'needs-review' : ''}`}
                    key={shot.id}
                    onClick={() => onSelect(shot.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const resource = readResourceDrag(e);
                      if (resource && !busy) onDrop(shot.id, resource);
                    }}
                  >
                    <div className="shot-tile-header">
                      <strong>
                        {String(shot.position + 1).padStart(2, '0')}
                      </strong>
                      <span>{statusLabel[shot.status]}</span>
                      <small>{(duration / 1000).toFixed(1)}s</small>
                    </div>
                    <div className="shot-picture">
                      {asset && !asset.missing && asset.kind === 'image' ? (
                        <img
                          loading="lazy"
                          src={mediaUrl(project.id, asset.id)}
                          alt={asset.name}
                        />
                      ) : asset?.thumbnail && !asset.missing ? (
                        <img
                          src={mediaUrl(project.id, asset.id, true)}
                          alt={asset.name}
                        />
                      ) : (
                        <span>
                          <FrameGuide cross />
                          {asset?.missing
                            ? '素材缺失'
                            : asset?.kind === 'video'
                              ? '视频主画面'
                              : '拖入图片或视频'}
                          <small>{shot.description || '画面待填写'}</small>
                        </span>
                      )}
                    </div>
                    <div className="shot-tile-body">
                      <textarea
                        aria-label={`镜头${shot.position + 1}画面`}
                        disabled={busy}
                        placeholder="画面描述"
                        value={shot.description}
                        onChange={(e) =>
                          onPatch(shot, {
                            description: e.target.value,
                          })
                        }
                      />
                      <textarea
                        aria-label={`镜头${shot.position + 1}动作对白`}
                        disabled={busy}
                        placeholder="动作 / 对白"
                        value={shot.actionDialogue}
                        onChange={(e) =>
                          onPatch(shot, {
                            actionDialogue: e.target.value,
                          })
                        }
                      />
                      <small
                        className="source-badge"
                        title={sources.map((s) => s.excerpt).join('\n')}
                      >
                        {sources.length
                          ? `↗ ${sources.length} 条来源`
                          : '手工镜头'}
                        {shot.needsReview ? ' · ⚑ 待优化' : ''}
                      </small>
                      {checklist && (
                        <small className="warning">
                          {shot.status === 'to_shoot' ? '标记待拍 · ' : ''}
                          {!asset
                            ? '缺少主画面'
                            : asset.missing
                              ? '素材离线'
                              : '请核对拍摄计划'}
                        </small>
                      )}
                    </div>
                    <div className="shot-tile-footer">
                      <button
                        className="quiet"
                        disabled={busy || shot.position === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          onMove(shot.id, -1);
                        }}
                      >
                        ←
                      </button>
                      <button
                        className="quiet"
                        disabled={
                          busy || shot.position === project.shots.length - 1
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          onMove(shot.id, 1);
                        }}
                      >
                        →
                      </button>
                      <button
                        className="quiet danger-text"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (
                            window.confirm(
                              '删除此镜头和关联脚本段落？原素材保留。',
                            )
                          )
                            onDelete(shot.id);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </article>
                );
              })}
          </div>
        </div>
      ))}
    </section>
  );
}
