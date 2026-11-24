import { afterEach,expect,test,vi } from 'vitest';
import { AudioTransport } from './audio-transport';
import { defaultTimelineSettings } from '../../../../shared/creative';
import type { Asset,AudioClip } from '../../../../shared/models';
class Param{value=1;events:any[]=[];setValueAtTime(value:number,time:number){this.value=value;this.events.push(['set',value,time]);}linearRampToValueAtTime(value:number,time:number){this.events.push(['ramp',value,time]);}}
class Node{gain=new Param();onended:any;buffer:any;connections:any[]=[];stopped=false;startArgs:number[]=[];connect(node:any){this.connections.push(node);}disconnect(){this.connections=[];}stop(){this.stopped=true;}start(...args:number[]){this.startArgs=args;}}
class Context{state='running';currentTime=0;destination={};gains:Node[]=[];sources:Node[]=[];media:Node[]=[];listeners:Record<string,()=>void>={};createGain(){const n=new Node();this.gains.push(n);return n;}createBufferSource(){const n=new Node();this.sources.push(n);return n;}createMediaElementSource(){const n=new Node();this.media.push(n);return n;}addEventListener(type:string,cb:()=>void){this.listeners[type]=cb;}async resume(){this.state='running';}async close(){this.state='closed';}async decodeAudioData(_bytes:ArrayBuffer){return{duration:8,length:8000,numberOfChannels:1};}}
const asset={id:'audio',kind:'audio',name:'音乐',size:100,durationMs:8000,metadata:null,missing:false} as Asset;
const clip:AudioClip={id:'clip',assetId:asset.id,timelineStartMs:1000,inMs:500,outMs:4500,gain:.8,fadeInMs:1000,fadeOutMs:1000};
function fixture(){const context=new Context(),warn=vi.fn(),interrupted=vi.fn(),engine=new AudioTransport(defaultTimelineSettings,id=>`test://${id}`,warn,interrupted,()=>context as unknown as AudioContext);vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(new Uint8Array([1,2,3])));return{context,warn,interrupted,engine};}
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
test('audio loading holds the shared clock; scheduled offset/gain/fades resume correctly after seeking',async()=>{const f=fixture();let release!:()=>void;f.context.decodeAudioData=async()=>{await new Promise<void>(resolve=>release=resolve);return{duration:8,length:8000,numberOfChannels:1};};const playing=f.engine.play(1500,[clip],[asset],6000);await vi.waitFor(()=>expect(release).toBeDefined());f.context.currentTime=10;expect(f.engine.position()).toBe(1500);expect(f.engine.playing).toBe(false);release();expect(await playing).toBe(true);expect(f.context.sources[0].startArgs).toEqual([10,1,3.5]);expect(f.context.gains[1].gain.events).toEqual([['set',.4,10],['ramp',.8,10.5],['set',.8,12.5],['ramp',0,13.5]]);f.context.currentTime=10.7;expect(f.engine.position()).toBeCloseTo(2200);f.engine.pause();expect(f.context.sources[0].stopped).toBe(true);f.context.currentTime=30;expect(f.engine.position()).toBeCloseTo(2200);await f.engine.dispose();});
test('future music starts on sequence time, live mix settings affect both original and music',async()=>{const f=fixture(),video={} as HTMLMediaElement;f.engine.attachVideo(video);f.engine.setSettings({...defaultTimelineSettings,videoGain:.4,bgmGain:.2});expect(f.context.gains[0].gain.value).toBe(.2);expect(f.context.gains[1].gain.value).toBe(.4);f.context.currentTime=5;await f.engine.play(0,[clip],[asset],6000);expect(f.context.sources[0].startArgs).toEqual([6,.5,4]);f.engine.detachVideo(video);f.engine.attachVideo(video);expect(f.context.media).toHaveLength(1);expect(f.context.media[0].connections).toHaveLength(1);await f.engine.dispose();});
test('cancel during decoding invalidates the old generation and never schedules ghost music',async()=>{const f=fixture();let release!:()=>void;f.context.decodeAudioData=async()=>{await new Promise<void>(resolve=>release=resolve);return{duration:8,length:8000,numberOfChannels:1};};const pending=f.engine.play(0,[clip],[asset],6000);await vi.waitFor(()=>expect(release).toBeDefined());f.engine.pause(2500);release();expect(await pending).toBe(false);expect(f.engine.position()).toBe(2500);expect(f.context.sources).toEqual([]);await f.engine.dispose();});
test('device suspension stops every source and keeps restart position',async()=>{const f=fixture();await f.engine.play(2000,[clip],[asset],6000);f.context.currentTime=.5;f.context.state='suspended';f.context.listeners.statechange();expect(f.interrupted).toHaveBeenCalledOnce();expect(f.engine.position()).toBe(2500);expect(f.context.sources.every(s=>s.stopped)).toBe(true);await f.engine.dispose();});
test('missing and oversized audio warns while sequence clock remains usable',async()=>{const f=fixture();await f.engine.play(0,[clip],[{...asset,missing:true}],6000);expect(f.warn).toHaveBeenCalledWith(expect.stringContaining('离线'));expect(f.engine.playing).toBe(true);await f.engine.play(0,[clip],[{...asset,size:65*1024**2}],6000);expect(f.warn).toHaveBeenCalledWith(expect.stringContaining('64 MB'));expect(f.context.sources).toEqual([]);await f.engine.dispose();});

test('a context suspended while audio loads is resumed before the clock and sources start',async()=>{
  const f=fixture();
  f.context.decodeAudioData=async()=>{f.context.state='suspended';f.context.listeners.statechange();return{duration:8,length:8000,numberOfChannels:1};};
  expect(await f.engine.play(0,[clip],[asset],6000)).toBe(true);
  expect(f.context.state).toBe('running');
  // The browser may deliver the suspension event after decode's promise settles.
  f.context.listeners.statechange();
  expect(f.interrupted).not.toHaveBeenCalled();
  expect(f.engine.playing).toBe(true);
  f.context.currentTime=.25;expect(f.engine.position()).toBe(250);
  await f.engine.dispose();
});

test('pausing while resume is pending settles the old request without ghost music',async()=>{
  const f=fixture();f.context.state='suspended';let release!:()=>void;
  f.context.resume=async()=>{await new Promise<void>(resolve=>release=resolve);f.context.state='running';};
  const playing=f.engine.play(500,[clip],[asset],6000);
  await vi.waitFor(()=>expect(release).toBeDefined());
  f.engine.pause(1200);
  const settled=await Promise.race([playing,new Promise(resolve=>setTimeout(()=>resolve('still waiting'),50))]);
  expect(settled).toBe(false);
  release();await playing;expect(f.context.sources).toEqual([]);expect(f.engine.position()).toBe(1200);
  await f.engine.dispose();
});

test('closing the output during decoding cannot leave a running silent transport',async()=>{
  const f=fixture();
  f.context.decodeAudioData=async()=>{f.context.state='closed';return{duration:8,length:8000,numberOfChannels:1};};
  await expect(f.engine.play(0,[clip],[asset],6000)).rejects.toThrow('音频');
  expect(f.engine.playing).toBe(false);expect(f.context.sources).toEqual([]);
  await f.engine.dispose();
});

test('an unavailable audio device times out without a running clock or scheduled music',async()=>{
  vi.useFakeTimers();const f=fixture();f.context.state='suspended';f.context.resume=()=>new Promise<void>(()=>{});
  const failure=expect(f.engine.play(0,[clip],[asset],6000)).rejects.toThrow('音频');
  await vi.advanceTimersByTimeAsync(5000);await failure;
  expect(f.engine.playing).toBe(false);expect(f.context.sources).toEqual([]);
  await f.engine.dispose();
});
