import type {
  Asset,
  LibraryAsset,
  Project,
  Usage,
} from '../../../shared/models';
import { MediaPreview } from '../resources';
import { mediaUrl } from '../../platform/media-url';
import { MediaSelectPanel } from './MediaSelectPanel';
import { UsageList } from './UsageList';
export function AssetInspector({
  scope,
  scopeId,
  asset,
  project,
  usage,
  busy,
  onClose,
  onRun,
  onNotice,
  onRefresh,
  onDuration,
  setGlobalAsset,
}: {
  scope: 'library' | 'project';
  scopeId: string;
  asset: Asset | LibraryAsset;
  project: Project | null;
  usage: Usage[];
  busy: boolean;
  onClose: () => void;
  onRun: (action: () => Promise<unknown>) => Promise<boolean>;
  onNotice: (text: string) => void;
  onRefresh: () => void;
  onDuration: (
    scope: 'library' | 'project',
    id: string,
    duration: number,
  ) => void;
  setGlobalAsset: (asset: LibraryAsset) => void;
}) {
  return (
    <>
      <h2>{asset.name}</h2>
      <MediaPreview
        key={asset.id}
        asset={asset}
        scope={scopeId}
        onDuration={(id, d) => onDuration(scope, id, d)}
      />
      {asset.kind === 'video' && !asset.missing && (
        <video
          className="inspector-video"
          controls
          src={mediaUrl(scopeId, asset.id)}
        />
      )}
      <div className="media-metadata">
        <strong>
          媒体参数 ·{' '}
          {asset.metadata?.status === 'ready'
            ? '已探测'
            : asset.metadata?.status === 'failed'
              ? '探测失败'
              : '尚未探测'}
        </strong>
        {asset.metadata?.status === 'ready' && (
          <>
            <p>
              {asset.metadata.format ?? '未知容器'} ·{' '}
              {asset.metadata.width && asset.metadata.height
                ? `${asset.metadata.width} × ${asset.metadata.height}`
                : '尺寸未知'}
              {asset.metadata.durationMs
                ? ` · ${(asset.metadata.durationMs / 1000).toFixed(3)} 秒`
                : ''}
            </p>
            {asset.metadata.streams.map((stream, index) => (
              <small key={index}>
                {stream.type} · {stream.codec ?? '编码未知'}
                {stream.frameRate
                  ? ` · ${stream.frameRate.numerator}/${stream.frameRate.denominator} fps`
                  : ''}
                {stream.variableFrameRate ? ' · 可变帧率' : ''}
                {stream.sampleRate ? ` · ${stream.sampleRate} Hz` : ''}
              </small>
            ))}
          </>
        )}
        {asset.metadata?.error && <p>{asset.metadata.error}</p>}
        <button
          className="quiet"
          disabled={busy}
          onClick={() =>
            void onRun(async () => {
              if (scope === 'library') {
                const page = await window.watercut.probeLibraryAsset(asset.id);
                if (page)
                  setGlobalAsset(
                    await window.watercut.getLibraryAsset(asset.id),
                  );
                onRefresh();
                return page;
              }
              return window.watercut.probeProject(project!.directory);
            })
          }
        >
          重新探测参数
        </button>
      </div>
      {scope === 'library' && asset.kind === 'video' && (
        <MediaSelectPanel
          key={asset.id}
          asset={asset as LibraryAsset}
          busy={busy}
          onRun={onRun}
          onNotice={onNotice}
        />
      )}
      <label>
        标签
        <input
          key={asset.id + asset.tags}
          defaultValue={asset.tags}
          onBlur={(e) => {
            const tags = e.currentTarget.value;
            if (tags !== asset.tags)
              void onRun(() =>
                scope === 'library'
                  ? window.watercut.updateLibraryAsset(asset.id, {
                      tags,
                    })
                  : window.watercut.updateAssetTags(
                      project!.directory,
                      asset.id,
                      tags,
                    ),
              ).then(onRefresh);
          }}
        />
      </label>
      {scope === 'library' && asset.missing && (
        <button
          disabled={busy}
          onClick={() =>
            void onRun(async () => {
              const restored = await window.watercut.relinkLibraryAsset(
                asset.id,
              );
              if (restored) setGlobalAsset(restored);
              onRefresh();
              return restored;
            })
          }
        >
          重新定位原件
        </button>
      )}
      {scope === 'library' && (
        <div className="toolbar">
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void onRun(async () => {
                const updated = await window.watercut.updateLibraryAsset(
                  asset.id,
                  {
                    starred: !asset.starred,
                  },
                );
                setGlobalAsset(updated);
                onRefresh();
              })
            }
          >
            {asset.starred ? '取消星标' : '☆ 星标'}
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void onRun(async () => {
                await window.watercut.hideLibraryItem(
                  'asset',
                  asset.id,
                  !(asset as LibraryAsset).hidden,
                );
                onRefresh();
                onClose();
              })
            }
          >
            {(asset as LibraryAsset).hidden ? '恢复到总库' : '在总库隐藏'}
          </button>
        </div>
      )}
      {scope === 'project' && (
        <>
          <small className="muted">
            {'storageKind' in asset && asset.storageKind === 'library'
              ? '此素材引用全局原件。移除本项目引用不会删除原件。'
              : '这是项目独有副本。'}
          </small>
          {asset.missing &&
            'storageKind' in asset &&
            asset.storageKind === 'local' && (
              <button
                disabled={busy}
                onClick={() =>
                  void onRun(() =>
                    window.watercut.relinkAsset(project!.directory, asset.id),
                  )
                }
              >
                重新定位
              </button>
            )}
          <button
            className="danger"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  '移除此项目素材及关联？全局原件和导入前文件保留。',
                )
              )
                void onRun(() =>
                  window.watercut.deleteAsset(project!.directory, asset.id),
                ).then((ok) => {
                  if (ok) onClose();
                });
            }}
          >
            移除项目素材
          </button>
        </>
      )}
      <h3>已知项目使用足迹</h3>
      <UsageList usage={usage} />
    </>
  );
}
