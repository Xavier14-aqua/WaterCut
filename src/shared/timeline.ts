import type { Project, TimelineSettings } from './models';
import { buildPreviewSequence } from './duration';
import { knownDuration, timelineSettingsSchema } from './creative';
export type TimelineMedia = {
  id: string;
  sourceAssetId: string | null;
  kind: 'video' | 'image' | 'audio';
  name: string;
  relativePath: string;
  durationMs: number | null;
  width: number;
  height: number;
  placeholderText?: string;
};
export type TimelineSegment = {
  id: string;
  mediaId: string;
  startFrame: number;
  endFrame: number;
  startUs: number;
  durationUs: number;
  sourceInUs: number;
  volume: number;
  label: string;
  track: number;
  fadeInUs?: number;
  fadeOutUs?: number;
};
export type TimelineDocument = {
  format: 'WaterCutTimeline';
  version: 1;
  name: string;
  settings: TimelineSettings;
  durationFrames: number;
  durationUs: number;
  media: TimelineMedia[];
  video: TimelineSegment[];
  audio: TimelineSegment[];
};
export function msToFrame(ms: number, fps: { fpsNum: number; fpsDen: number }) {
  return Math.round((ms * fps.fpsNum) / (1000 * fps.fpsDen));
}
export function frameToUs(
  frame: number,
  fps: { fpsNum: number; fpsDen: number },
) {
  return Math.round((frame * 1000000 * fps.fpsDen) / fps.fpsNum);
}
export function buildTimelineDocument(
  project: Project,
  placeholders = true,
): TimelineDocument {
  const settings = timelineSettingsSchema.parse(project.timelineSettings),
    clips = buildPreviewSequence(project);
  if (!clips.length) throw new Error('请先添加镜头，再导出时间线');
  const media = new Map<string, TimelineMedia>(),
    video: TimelineSegment[] = [],
    audio: TimelineSegment[] = [];
  function addAsset(id: string) {
    const asset = project.assets.find((a) => a.id === id);
    if (!asset) throw new Error('时间线引用的素材不存在');
    if (media.has(id)) return media.get(id)!;
    const ext =
      asset.kind === 'image'
        ? (/\.(png|jpe?g|gif|webp)$/i.exec(asset.name)?.[0] ?? '.png')
        : asset.kind === 'audio'
          ? (/\.(mp3|wav|m4a)$/i.exec(asset.name)?.[0] ?? '.wav')
          : (/\.(mp4|mov|webm)$/i.exec(asset.name)?.[0] ?? '.mp4');
    const item: TimelineMedia = {
      id,
      sourceAssetId: id,
      kind: asset.kind,
      name: asset.name,
      relativePath: `media/${id}${ext.toLowerCase()}`,
      durationMs: knownDuration(asset),
      width: asset.metadata?.width ?? settings.width,
      height: asset.metadata?.height ?? settings.height,
    };
    media.set(id, item);
    return item;
  }
  for (const clip of clips) {
    const startFrame = msToFrame(clip.startMs, settings),
      endFrame = msToFrame(clip.startMs + clip.durationMs, settings);
    if (endFrame <= startFrame)
      throw new Error(
        `镜头 ${clip.shot.position + 1} 短于一帧，请调整时长或序列帧率`,
      );
    let item: TimelineMedia;
    if (!clip.asset || clip.asset.missing) {
      if (!placeholders)
        throw new Error(
          `镜头 ${clip.shot.position + 1} 缺少原件，请重新定位或启用占位图`,
        );
      const id = `placeholder-${clip.shot.id}`;
      item = {
        id,
        sourceAssetId: null,
        kind: 'image',
        name: `镜头${clip.shot.position + 1}-占位.png`,
        relativePath: `media/${id}.png`,
        durationMs: null,
        width: settings.width,
        height: settings.height,
        placeholderText: `镜头 ${clip.shot.position + 1}\n${clip.shot.description || '画面待创作'}\n\n${clip.shot.actionDialogue}`,
      };
      media.set(id, item);
    } else {
      item = addAsset(clip.asset.id);
      if (item.kind === 'video') {
        if (!clip.playable || !item.durationMs)
          throw new Error(
            `镜头 ${clip.shot.position + 1} 的视频区间未知或无效，请先探测媒体参数`,
          );
        if (
          clip.asset.metadata?.status !== 'ready' ||
          !clip.asset.metadata.streams.some(
            (s) => s.type === 'video' && s.frameRate,
          )
        )
          throw new Error(
            `镜头 ${clip.shot.position + 1} 的帧率未知，请先完成媒体探测`,
          );
        if (
          clip.asset.metadata?.streams.some(
            (s) => s.type === 'video' && s.variableFrameRate,
          )
        )
          throw new Error(
            `镜头 ${clip.shot.position + 1} 为变帧率视频，本轮交接请先转换为恒帧率`,
          );
      }
    }
    const durationUs =
        frameToUs(endFrame, settings) - frameToUs(startFrame, settings),
      sourceInUs = item.kind === 'video' ? clip.sourceStartMs * 1000 : 0;
    if (
      item.kind === 'video' &&
      sourceInUs + durationUs > item.durationMs! * 1000 + 1000
    )
      throw new Error(
        `镜头 ${clip.shot.position + 1} 按序列帧率量化后越过原片末尾，请缩短一帧`,
      );
    video.push({
      id: clip.shot.id,
      mediaId: item.id,
      startFrame,
      endFrame,
      startUs: frameToUs(startFrame, settings),
      durationUs,
      sourceInUs,
      volume: settings.videoGain,
      label: clip.shot.description,
      track: 0,
    });
  }
  const durationFrames = video.at(-1)!.endFrame,
    durationUs = frameToUs(durationFrames, settings),
    trackEnds: number[] = [];
  for (const clip of [...project.audioClips].sort(
    (a, b) => a.timelineStartMs - b.timelineStartMs || a.id.localeCompare(b.id),
  )) {
    const asset = project.assets.find((a) => a.id === clip.assetId);
    if (!asset || asset.missing)
      throw new Error('有 BGM 原件离线，请重新定位或移除该音乐后交接');
    const item = addAsset(clip.assetId);
    if (item.kind !== 'audio' || !item.durationMs)
      throw new Error('BGM 音频时长未知，请先探测');
    const startFrame = msToFrame(clip.timelineStartMs, settings),
      endFrame = Math.min(
        durationFrames,
        msToFrame(clip.timelineStartMs + clip.outMs - clip.inMs, settings),
      );
    if (startFrame >= durationFrames)
      throw new Error(`BGM「${item.name}」位于画面结束之后，请调整起点`);
    if (endFrame <= startFrame) throw new Error('BGM 片段短于一帧');
    let track = trackEnds.findIndex((end) => end <= startFrame);
    if (track < 0) track = trackEnds.length;
    if (track >= 16)
      throw new Error('本轮剪映交接最多支持 16 条同时重叠的音频轨');
    trackEnds[track] = endFrame;
    const length =
      frameToUs(endFrame, settings) - frameToUs(startFrame, settings);
    if (clip.inMs * 1000 + length > item.durationMs * 1000 + 1000)
      throw new Error('BGM 量化后的区间越过原片末尾，请缩短一帧');
    if (
      (clip.fadeInMs || clip.fadeOutMs) &&
      length + 1000 < (clip.outMs - clip.inMs) * 1000
    )
      throw new Error(
        '带淡入淡出的 BGM 越过画面结尾，请先把音频出点裁到片尾，保持交接与预览一致',
      );
    if ((clip.fadeInMs + clip.fadeOutMs) * 1000 > length + 1000)
      throw new Error('按帧量化后淡入淡出超过音乐长度，请缩短淡入淡出');
    audio.push({
      id: clip.id,
      mediaId: item.id,
      startFrame,
      endFrame,
      startUs: frameToUs(startFrame, settings),
      durationUs: length,
      sourceInUs: clip.inMs * 1000,
      volume: clip.gain * settings.bgmGain,
      label: item.name,
      track,
      fadeInUs: Math.min(length, clip.fadeInMs * 1000),
      fadeOutUs: Math.min(length, clip.fadeOutMs * 1000),
    });
  }
  return {
    format: 'WaterCutTimeline',
    version: 1,
    name: project.name,
    settings,
    durationFrames,
    durationUs,
    media: [...media.values()],
    video,
    audio,
  };
}
