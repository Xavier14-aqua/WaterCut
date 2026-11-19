import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project, Shot } from '../shared/models';
import { buildPreviewSequence } from '../shared/duration';
import { mediaUrl } from './Resources';
import { AudioTransport } from '../shared/audio-transport';
import { BGMPanel } from './BGMPanel';
type Resize = {
  id: string;
  side: 'left' | 'right';
  x: number;
  start: number;
  end: number;
  duration: number;
  delta: number;
  video: boolean;
  maximum: number;
};
export function PreviewView({
  project,
  busy,
  onSelect,
  onReorder,
  onTrim,
  onPatch,
  onDuration,
  onRun
}: {
  project: Project;
  busy: boolean;
  onSelect: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onTrim: (id: string, inMs: number, outMs: number | null) => void;
  onPatch: (shot: Shot, patch: Partial<Shot>) => void;
  onDuration: (id: string, duration: number) => void;
  onRun:(action:()=>Promise<unknown>)=>Promise<boolean>;
}) {
  const clips = useMemo(() => buildPreviewSequence(project), [project]),
    total = clips.reduce((n, c) => n + c.durationMs, 0);
  const [cursor, setCursor] = useState(0),
    [playing, setPlaying] = useState(false),
    [ready, setReady] = useState(false),
    [readyId,setReadyId]=useState<string|null>(null),
    [buffering,setBuffering]=useState(false),
    [failed, setFailed] = useState<string[]>([]),
    [notice, setNotice] = useState(''),
    [zoom, setZoom] = useState(38),
    [resize, setResize] = useState<Resize | null>(null);
  const video = useRef<HTMLVideoElement>(null),
    playingRef = useRef(playing),
    cursorRef = useRef(cursor),
    clipsRef = useRef(clips),
    signature = clips.map(c => `${c.shot.id}:${c.asset?.id}:${c.sourceStartMs}:${c.durationMs}`).join('|');
  const transport=useRef<AudioTransport|null>(null);
  function sound(){return transport.current??=(new AudioTransport(project.timelineSettings,id=>mediaUrl(project.id,id),setNotice,()=>{setPlaying(false);setNotice('音频输出被挂起，预览已暂停；请再次点击播放');}));}
  const audioSignature=JSON.stringify(project.audioClips);
  useEffect(()=>{const engine=sound();return()=>{void engine.dispose();if(transport.current===engine)transport.current=null;};},[project.id]);
  useEffect(()=>{sound().setSettings(project.timelineSettings);},[project.timelineSettings]);
  const audioPrior=useRef(audioSignature);
  useEffect(()=>{if(audioPrior.current!==audioSignature){audioPrior.current=audioSignature;sound().pause(cursorRef.current);setPlaying(false);setNotice('BGM 配置已更新，预览已暂停');}},[audioSignature]);
  useEffect(()=>{const pause=()=>{if(playingRef.current){sound().pause(cursorRef.current);setPlaying(false);setNotice('切换到后台或音频设备变化，预览已暂停');}},visibility=()=>{if(document.hidden)pause();};document.addEventListener('visibilitychange',visibility);navigator.mediaDevices?.addEventListener('devicechange',pause);return()=>{document.removeEventListener('visibilitychange',visibility);navigator.mediaDevices?.removeEventListener('devicechange',pause);};},[]);
  const clip = clips.find(c => cursor >= c.startMs && cursor < c.startMs + c.durationMs) ?? clips.at(-1);
  const playableVideo = clip?.asset?.kind === 'video' && !clip.asset.missing && !failed.includes(clip.shot.id) && (clip.playable || clip.asset.durationMs === null);
  playingRef.current = playing;
  cursorRef.current = cursor;
  clipsRef.current = clips;
  const prior = useRef(signature);
  useEffect(() => {
    if (prior.current !== signature) {
      prior.current = signature;
      setPlaying(false);
      setCursor(Math.min(cursorRef.current, Math.max(0, total - 1)));
      setNotice('镜头序列已更新，预览已暂停');
    }
  }, [signature, total]);
  useEffect(() => {
    setReady(false);
    setReadyId(null);setBuffering(false);
  }, [clip?.shot.id]);
  useEffect(()=>{const player=video.current,engine=sound();return()=>{if(player)engine.detachVideo(player);};},[clip?.shot.id,clip?.asset?.id]);
  useEffect(() => {
    if (!clip || !playableVideo || ready) return;
    const timer = setTimeout(() => {
      setFailed(old => [...old, clip.shot.id]);
      setNotice('视频加载超时，按该镜头时长显示文字');
    }, 10000);
    return () => clearTimeout(timer);
  }, [clip?.shot.id, playableVideo, ready]);
  useEffect(()=>{
    const engine=sound(),player=video.current;
    if(!playing){engine.pause(cursorRef.current);player?.pause();return;}
    if(playableVideo&&(!ready||readyId!==clip?.shot.id||buffering)){engine.pause(cursorRef.current);player?.pause();return;}
    let live=true;
    void engine.play(cursorRef.current,project.audioClips,project.assets,total).then(ok=>{if(ok&&live&&player&&playableVideo){const target=(clip!.sourceStartMs+Math.max(0,cursorRef.current-clip!.startMs))/1000;if(Math.abs(player.currentTime-target)>.06)player.currentTime=target;void player.play().catch(()=>{if(live){setPlaying(false);setNotice('媒体无法播放，请检查格式后重试');}});}}).catch(e=>{if(live){setPlaying(false);setNotice(String(e));}});
    return()=>{live=false;engine.pause(cursorRef.current);player?.pause();};
  },[playing,clip?.shot.id,clip?.asset?.id,ready,readyId,buffering,playableVideo,total,audioSignature]);
  useEffect(()=>{
    if(!playing||!clip)return;let handle=0;
    function tick(){const engine=sound(),active=clipsRef.current.find(c=>cursorRef.current>=c.startMs&&cursorRef.current<c.startMs+c.durationMs);if(!active){engine.pause(total);setPlaying(false);return;}
      let next=Math.min(total,active.startMs+active.durationMs,engine.playing?engine.position():cursorRef.current);
      const player=video.current;if(playableVideo&&ready&&readyId===active.shot.id&&player&&!player.seeking&&!buffering){const target=(active.sourceStartMs+Math.max(0,next-active.startMs))/1000;if(Math.abs(player.currentTime-target)>.09)player.currentTime=target;}
      cursorRef.current=next;setCursor(next);if(next>=total){engine.pause(total);setPlaying(false);return;}handle=requestAnimationFrame(tick);
    }
    handle=requestAnimationFrame(tick);return()=>cancelAnimationFrame(handle);
  },[playing,clip?.shot.id,playableVideo,ready,readyId,buffering,total]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (event.code === 'Space') {
        event.preventDefault();
        toggle();
      }
      if (event.key.toLowerCase() === 'm' && clip && !busy) onPatch(clip.shot, {
        needsReview: !clip.shot.needsReview
      });
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [clip?.shot.id, clip?.shot.needsReview, playing, busy, total]);
  function toggle() {
    if (!total) return;
    if (cursor >= total) {
      setCursor(0);
      cursorRef.current = 0;
      if (video.current) video.current.currentTime = (clips[0]?.sourceStartMs ?? 0) / 1000;
    }
    if(playing)sound().pause(cursorRef.current);else sound().wake();
    setPlaying(old => !old);
  }
  function jump(time: number) {
    sound().pause(time);
    setPlaying(false);
    const next = Math.max(0, Math.min(time, Math.max(0, total - 1))),
      target = clips.find(c => next >= c.startMs && next < c.startMs + c.durationMs);
    setCursor(next);
    cursorRef.current = next;
    if (target) {
      onSelect(target.shot.id);
      if (target.shot.id === clip?.shot.id && video.current) video.current.currentTime = (target.sourceStartMs + next - target.startMs) / 1000;
    }
  }
  function startResize(event: React.PointerEvent, id: string, side: 'left' | 'right') {
    event.stopPropagation();
    event.preventDefault();
    if (busy) return;
    setPlaying(false);
    const c = clips.find(c => c.shot.id === id)!;
    event.currentTarget.setPointerCapture(event.pointerId);
    setResize({
      id,
      side,
      x: event.clientX,
      start: c.sourceStartMs,
      end: c.sourceStartMs + c.durationMs,
      duration: c.durationMs,
      delta: 0,
      video: c.asset?.kind === 'video',
      maximum: c.asset?.durationMs ?? 86400000
    });
  }
  function movement(event: React.PointerEvent) {
    if (!resize) return;
    const raw = Math.round((event.clientX - resize.x) / zoom * 1000 / 100) * 100;
    let delta = raw;
    if (resize.video) delta = resize.side === 'right' ? Math.max(100 - resize.duration, Math.min(raw, resize.maximum - resize.end)) : Math.max(-resize.start, Math.min(raw, resize.duration - 100));else delta = resize.side === 'right' ? Math.max(100 - resize.duration, Math.min(raw, 600000 - resize.duration)) : Math.max(resize.duration - 600000, Math.min(raw, resize.duration - 100));
    setResize({
      ...resize,
      delta
    });
  }
  function finishResize() {
    if (!resize) return;
    const c = clips.find(c => c.shot.id === resize.id);
    if (c) {
      if (resize.video) onTrim(resize.id, resize.start + (resize.side === 'left' ? resize.delta : 0), resize.end + (resize.side === 'right' ? resize.delta : 0));else onPatch(c.shot, {
        durationMs: resize.duration + (resize.side === 'right' ? resize.delta : -resize.delta)
      });
    }
    setResize(null);
  }
  const seconds = (ms: number) => `${Math.floor(ms / 60000)}:${(ms % 60000 / 1000).toFixed(1).padStart(4, '0')}`;
  return <section className="preview-view"><div className="section-heading"><div><p className="eyebrow">ROUGH CUT</p><h1>先看见整条故事</h1></div><span className="muted">{clips.length} 镜头 · {seconds(total)}</span></div>
    {!clip ? <div className="empty-state">添加镜头后即可预览。</div> : <><div className="preview-screen" key={clip.shot.id}>
      {playableVideo ? <video key={clip.asset!.id} crossOrigin="anonymous" ref={video} src={mediaUrl(project.id, clip.asset!.id)} preload="auto" onLoadedMetadata={event => {
          const player = event.currentTarget,
            duration = Math.round(player.duration * 1000);
          if (Number.isFinite(duration) && duration > 0 && clip.asset!.durationMs !== duration) onDuration(clip.asset!.id, duration);
          const offset = clip.sourceStartMs + Math.max(0, cursorRef.current - clip.startMs);
          if (offset >= duration) {
            setFailed(old => [...old, clip.shot.id]);
            setNotice('视频入点超过片尾，显示文字占位');
            return;
          }
          player.currentTime = offset / 1000;
          try{sound().attachVideo(player);}catch{setNotice('原声混音暂不可用，请检查媒体格式');}
          setReadyId(clip.shot.id);
          setReady(true);
        }} onSeeked={() => {
          setBuffering(false);
        }} onSeeking={()=>setBuffering(true)} onWaiting={()=>setBuffering(true)} onCanPlay={()=>setBuffering(false)} onEnded={()=>{
          if(playingRef.current){const end=clip.startMs+clip.durationMs;sound().pause(end);cursorRef.current=end;setCursor(end);setBuffering(false);}
        }} onError={() => {
          setFailed(old => [...old, clip.shot.id]);
          setNotice('视频无法播放，继续以文字占位');
        }} /> : clip.asset?.kind === 'image' && !clip.asset.missing && !failed.includes(clip.shot.id) ? <img src={mediaUrl(project.id, clip.asset.id)} alt={clip.shot.description} onError={() => setFailed(old => [...old, clip.shot.id])} /> : <div className="preview-placeholder"><small>镜头 {clip.shot.position + 1} · 文字占位</small><h2>{clip.shot.description || '画面待创作'}</h2><p>{clip.shot.actionDialogue || '动作 / 对白待填写'}</p></div>}
      <span className="preview-counter">{clip.shot.position + 1} / {clips.length}</span>
    </div><div className="preview-caption"><strong>{clip.shot.description || '画面待填写'}</strong><p>{clip.shot.actionDialogue}</p></div>
    <div className="transport"><button disabled={busy} onClick={toggle}>{playing ? '暂停' : '播放'}</button><button className="secondary" onClick={() => jump(0)}>从头</button><span>{seconds(cursor)} / {seconds(total)}</span><input aria-label="预览进度" type="range" min="0" max={Math.max(1, total - 1)} value={Math.min(cursor, total - 1)} onChange={e => jump(Number(e.target.value))} /><button className={clip.shot.needsReview ? 'marked' : 'secondary'} disabled={busy} onClick={() => onPatch(clip.shot, {
          needsReview: !clip.shot.needsReview
        })}>⚑ 待优化 · M</button></div>
    <small className="muted" role="status">{notice || clip.warning || '空格播放 / 暂停。拖动色块换序，拖动边缘调整时长。视频为粗剪预览。'}</small></>}
    <div className="timeline-heading"><h3>镜头时间轴</h3><label>缩放<input aria-label="时间轴缩放" type="range" min="12" max="100" value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label></div>
    <div className="timeline-scroll"><div className="timeline-track" style={{
        width: Math.max(600, total / 1000 * zoom)
      }}>
      {clips.map(c => {
          const delta = resize?.id === c.shot.id ? resize.side === 'right' ? resize.delta : -resize.delta : 0;
          return <div key={c.shot.id} className={`timeline-clip ${clip?.shot.id === c.shot.id ? 'selected' : ''} ${c.shot.needsReview ? 'needs-review' : ''}`} style={{
            width: Math.max(12, (c.durationMs + delta) / 1000 * zoom)
          }} draggable={!resize && !busy} onClick={() => jump(c.startMs)} onDragStart={e => {
            setPlaying(false);
            e.dataTransfer.setData('application/x-watercut-shot', c.shot.id);
          }} onDragOver={e => e.preventDefault()} onDrop={e => {
            e.preventDefault();
            const id = e.dataTransfer.getData('application/x-watercut-shot');
            if (!id || id === c.shot.id || busy) return;
            const ids = project.shots.map(s => s.id),
              from = ids.indexOf(id),
              to = ids.indexOf(c.shot.id);
            if (from < 0) return;
            ids.splice(from, 1);
            ids.splice(to, 0, id);
            setPlaying(false);
            onReorder(ids);
          }}>
        <span className="resize-handle left" onPointerDown={e => startResize(e, c.shot.id, 'left')} onPointerMove={movement} onPointerUp={finishResize} onPointerCancel={() => setResize(null)} /><span className="clip-label">{c.shot.position + 1} · {c.shot.description || '待创作'}</span><small>{((c.durationMs + delta) / 1000).toFixed(1)}s</small><span className="resize-handle right" onPointerDown={e => startResize(e, c.shot.id, 'right')} onPointerMove={movement} onPointerUp={finishResize} onPointerCancel={() => setResize(null)} />
      </div>;
        })}<div className="playhead" style={{
          left: cursor / 1000 * zoom
        }} />
    </div></div>
    <BGMPanel project={project} busy={busy} onRun={onRun}/>
  </section>;
}
