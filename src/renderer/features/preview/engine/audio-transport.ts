import type { AudioClip,Asset,TimelineSettings } from '../../../../shared/models';
import { audioGainAt,knownDuration } from '../../../../shared/creative';

// The AudioContext clock owns sequence time; HTML video follows this clock.
export class AudioTransport {
  private context:AudioContext|null=null;
  private master:GainNode|null=null;
  private sources:AudioBufferSourceNode[]=[];
  private buffers=new Map<string,AudioBuffer>();
  private videoNodes=new WeakMap<HTMLMediaElement,{source:MediaElementAudioSourceNode;gain:GainNode;active:boolean}>();
  private mediaGains=new Set<GainNode>();
  private controller:AbortController|null=null;
  private generation=0;
  private epoch=0;
  private baseMs=0;
  private running=false;
  private disposed=false;
  private settings:TimelineSettings;
  constructor(settings:TimelineSettings,private url:(assetId:string)=>string,private warn:(message:string)=>void,private interrupted:()=>void,private factory:()=>AudioContext=()=>new AudioContext()){this.settings=settings;}
  private ensure(){
    if(!this.context){this.context=this.factory();this.master=this.context.createGain();this.master.connect(this.context.destination);this.master.gain.value=this.settings.bgmGain;
      this.context.addEventListener('statechange',()=>{if(this.running&&this.context?.state!=='running'){this.pause(this.position());this.interrupted();}});
    }
    return this.context;
  }
  get state(){return this.context?.state??'closed';}
  get playing(){return this.running;}
  wake(){void this.ensure().resume().catch(error=>this.warn(String(error)));}
  private wait<T>(task:Promise<T>,signal:AbortSignal,timeoutMs=10000):Promise<T>{
    return new Promise<T>((resolve,reject)=>{
      let settled=false;
      const finish=(action:()=>void)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);action();};
      const cancel=()=>finish(()=>reject(new Error('音频播放准备已取消')));
      const timer=setTimeout(()=>finish(()=>reject(new Error('音频输出或解码超时，请检查设备和素材后重新播放'))),timeoutMs);
      signal.addEventListener('abort',cancel,{once:true});
      task.then(value=>finish(()=>resolve(value)),error=>finish(()=>reject(error)));
      if(signal.aborted)cancel();
    });
  }
  private async resume(ctx:AudioContext,signal:AbortSignal){
    if(ctx.state==='closed')throw new Error('音频输出已关闭，请重新打开粗剪预览');
    if(ctx.state!=='running')await this.wait(ctx.resume(),signal,5000);
    if(ctx.state!=='running')throw new Error('音频输出尚未恢复，请检查设备后重新播放');
  }
  position(){return this.running&&this.context?this.baseMs+Math.max(0,this.context.currentTime-this.epoch)*1000:this.baseMs;}
  setSettings(settings:TimelineSettings){this.settings=settings;if(this.context){this.master?.gain.setValueAtTime(settings.bgmGain,this.context.currentTime);for(const gain of this.mediaGains)gain.gain.setValueAtTime(settings.videoGain,this.context.currentTime);}}
  attachVideo(player:HTMLMediaElement){const ctx=this.ensure();let nodes=this.videoNodes.get(player);if(!nodes){nodes={source:ctx.createMediaElementSource(player),gain:ctx.createGain(),active:false};this.videoNodes.set(player,nodes);}if(!nodes.active){nodes.source.connect(nodes.gain);nodes.gain.connect(ctx.destination);nodes.active=true;this.mediaGains.add(nodes.gain);}nodes.gain.gain.setValueAtTime(this.settings.videoGain,ctx.currentTime);player.volume=1;}
  detachVideo(player:HTMLMediaElement){const nodes=this.videoNodes.get(player);if(nodes?.active){nodes.source.disconnect();nodes.gain.disconnect();nodes.active=false;this.mediaGains.delete(nodes.gain);}}
  pause(atMs=this.position()){
    this.generation++;this.running=false;this.baseMs=Math.max(0,atMs);
    this.controller?.abort();this.controller=null;
    for(const source of this.sources){try{source.stop();}catch{}source.disconnect();}this.sources=[];
  }
  async play(atMs:number,clips:AudioClip[],assets:Asset[],totalMs:number){
    this.pause(atMs);const token=this.generation,ctx=this.ensure(),controller=new AbortController();this.controller=controller;
    try{
    // resume() starts in the user's click handler before asynchronous decoding.
    await this.resume(ctx,controller.signal);
    const relevant=clips.filter(c=>c.timelineStartMs<totalMs&&c.timelineStartMs+c.outMs-c.inMs>atMs),ids=[...new Set(relevant.map(c=>c.assetId))];
    let decodedBytes=0;
    const ready=new Set<string>();
    for(const id of ids){
      if(token!==this.generation||this.disposed)return false;
      const asset=assets.find(a=>a.id===id);if(!asset||asset.missing){this.warn('有 BGM 原件离线，当前预览跳过该音频');continue;}
      const duration=knownDuration(asset);
      if(asset.size>64*1024**2||!duration||duration>600000){this.warn('实时 BGM 预览支持每份原件不超过 64 MB、10 分钟；请先截成较短音频，原件仍可交接');continue;}
      try{
        let buffer=this.buffers.get(id);
        if(!buffer){const response=await fetch(this.url(id),{signal:controller.signal});if(!response.ok)throw new Error('原件读取失败');const reader=response.body?.getReader();if(!reader)throw new Error('原件无法读取');let bytes=0;const chunks:Uint8Array[]=[];while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>64*1024**2){await reader.cancel();throw new Error('音频超过预览内存限制');}chunks.push(part.value);}const encoded=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){encoded.set(chunk,offset);offset+=chunk.length;}buffer=await this.wait(ctx.decodeAudioData(encoded.buffer),controller.signal);}
        const size=buffer.length*buffer.numberOfChannels*4;
        if(decodedBytes+size>256*1024**2)throw new Error('BGM 解码缓存超过 256 MB，请减少同时使用的音频');
        if(token!==this.generation||this.disposed)return false;
        decodedBytes+=size;this.buffers.set(id,buffer);ready.add(id);
      }catch(error){if(controller.signal.aborted||token!==this.generation)return false;this.warn(`BGM「${asset.name}」未参与预览：${error instanceof Error?error.message:String(error)}`);}
    }
    for(const id of this.buffers.keys())if(!ready.has(id))this.buffers.delete(id);
    if(token!==this.generation||this.disposed)return false;
    // The device may have suspended while fetch/decode was in flight. Resume
    // again before establishing the epoch; never schedule on a frozen clock.
    await this.resume(ctx,controller.signal);
    if(token!==this.generation||this.disposed)return false;
    // Epoch is established after all required audio has loaded. Loading never
    // advances a hidden independent music player ahead of the picture.
    this.baseMs=atMs;this.epoch=ctx.currentTime;this.running=true;
    for(const clip of relevant){const buffer=this.buffers.get(clip.assetId);if(!buffer||!ready.has(clip.assetId))continue;
      const local=Math.max(0,atMs-clip.timelineStartMs),duration=clip.outMs-clip.inMs,end=Math.min(duration,totalMs-clip.timelineStartMs),remaining=end-local;if(remaining<=0)continue;
      const when=this.epoch+Math.max(0,clip.timelineStartMs-atMs)/1000,source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;source.connect(gain);gain.connect(this.master!);
      gain.gain.setValueAtTime(audioGainAt(clip,local),when);
      if(local<clip.fadeInMs)gain.gain.linearRampToValueAtTime(clip.gain,when+(clip.fadeInMs-local)/1000);
      const fadeOutStart=duration-clip.fadeOutMs;
      if(clip.fadeOutMs&&fadeOutStart>local&&fadeOutStart<end)gain.gain.setValueAtTime(clip.gain,when+(fadeOutStart-local)/1000);
      if(clip.fadeOutMs&&end>fadeOutStart)gain.gain.linearRampToValueAtTime(end===duration?0:audioGainAt(clip,end),when+remaining/1000);
      const offset=(clip.inMs+local)/1000,available=buffer.duration-offset;
      if(available<=0){gain.disconnect();source.disconnect();this.warn('BGM 入点超出实际解码时长，跳过该片段');continue;}
      source.onended=()=>{source.disconnect();gain.disconnect();};source.start(when,offset,Math.min(remaining/1000,available));this.sources.push(source);
    }
    return true;
    }catch(error){
      if(controller.signal.aborted||token!==this.generation||this.disposed)return false;
      this.pause();throw error;
    }
  }
  async dispose(){if(this.disposed)return;this.disposed=true;this.pause();this.buffers.clear();for(const gain of this.mediaGains)gain.disconnect();this.mediaGains.clear();if(this.context&&this.context.state!=='closed')await this.context.close();this.context=null;}
}
