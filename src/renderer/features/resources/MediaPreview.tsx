import { useRef, useState } from 'react';

import type { Asset, LibraryAsset } from '../../../shared/models';

import { mediaUrl } from '../../platform/media-url';

export function MediaPreview({
  asset,
  scope,
  onDuration,
}: {
  asset: Asset | LibraryAsset;
  scope: string;
  onDuration?: (id: string, duration: number) => void;
}) {
  const [failed, setFailed] = useState(false),
    reported = useRef(false);
  const source = mediaUrl(scope, asset.id),
    thumb = mediaUrl(scope, asset.id, true);
  function metadata(player: HTMLMediaElement) {
    if (
      !reported.current &&
      Number.isFinite(player.duration) &&
      player.duration > 0
    ) {
      reported.current = true;
      onDuration?.(asset.id, Math.round(player.duration * 1000));
    }
  }
  if (asset.missing) return <div className="asset-thumb missing">素材缺失</div>;
  return (
    <div className="asset-thumb">
      {asset.kind === 'audio' ? (
        <audio
          controls
          preload="metadata"
          src={source}
          onLoadedMetadata={(e) => metadata(e.currentTarget)}
        />
      ) : asset.kind === 'image' ? (
        <img
          loading="lazy"
          src={asset.thumbnail && !failed ? thumb : source}
          alt={asset.name}
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <video
            muted
            preload="metadata"
            src={source}
            onLoadedMetadata={(e) => metadata(e.currentTarget)}
            onLoadedData={(e) => {
              e.currentTarget.currentTime = Math.min(
                0.1,
                e.currentTarget.duration || 0.1,
              );
            }}
            onError={() => setFailed(true)}
          />
          {failed && <span className="media-error">格式暂不能预览</span>}
        </>
      )}
    </div>
  );
}
