import { z } from 'zod';
import { uuid } from './schemas';
import type { Asset, AudioClip, Project, Shot, ShotListFilter } from './models';
import { buildPreviewSequence } from './duration';
export const timelineSettingsSchema=z.object({width:z.number().int().min(64).max(8192),height:z.number().int().min(64).max(8192),fpsNum:z.number().int().min(1).max(120000),fpsDen:z.number().int().min(1).max(10000),videoGain:z.number().min(0).max(2),bgmGain:z.number().min(0).max(2)}).refine(v=>v.fpsNum/v.fpsDen>=1&&v.fpsNum/v.fpsDen<=120,'序列帧率需在 1～120 fps 之间');
export const defaultTimelineSettings={width:1920,height:1080,fpsNum:30,fpsDen:1,videoGain:1,bgmGain:1};
export const audioClipSchema=z.object({id:uuid,assetId:uuid,timelineStartMs:z.number().int().min(0).max(86400000),inMs:z.number().int().min(0),outMs:z.number().int().min(1),gain:z.number().min(0).max(2),fadeInMs:z.number().int().min(0),fadeOutMs:z.number().int().min(0)}).refine(v=>v.outMs>v.inMs&&v.fadeInMs+v.fadeOutMs<=v.outMs-v.inMs,'音频区间或淡入淡出长度无效');
export const selectInputSchema=z.object({id:uuid.optional(),assetId:uuid,name:z.string().trim().min(1).max(100),inMs:z.number().int().min(0),outMs:z.number().int().positive(),note:z.string().max(2000).default(''),expectedVersion:z.number().int().positive().optional()}).refine(v=>v.outMs>v.inMs,'出点必须晚于入点');
export function knownDuration(asset:Pick<Asset,'durationMs'|'metadata'>):number|null{return asset.metadata?.status==='ready'&&asset.metadata.durationMs?asset.metadata.durationMs:asset.durationMs;}
export function validateMediaRange(asset:Pick<Asset,'kind'|'durationMs'|'metadata'>,inMs:number,outMs:number,kind:'video'|'audio'){
  const duration=knownDuration(asset);if(asset.kind!==kind)throw new Error(kind==='video'?'精华片段需要视频素材':'BGM 需要音频素材');
  if(!duration)throw new Error('素材时长未知，请先完成媒体参数探测');
  if(!(Number.isInteger(inMs)&&Number.isInteger(outMs)&&inMs>=0&&outMs>inMs&&outMs<=duration))throw new Error('区间需满足 0 ≤ 入点 < 出点 ≤ 素材时长');
}
export function rangesOverlap(a:{inMs:number;outMs:number|null},b:{inMs:number;outMs:number|null}){return (a.outMs??Infinity)>b.inMs&&(b.outMs??Infinity)>a.inMs;}
export function audioGainAt(clip:AudioClip,relativeMs:number):number{const duration=clip.outMs-clip.inMs;if(relativeMs<0||relativeMs>=duration)return 0;return clip.gain*Math.min(1,clip.fadeInMs?relativeMs/clip.fadeInMs:1,clip.fadeOutMs?(duration-relativeMs)/clip.fadeOutMs:1);}
export function shotHasGap(project:Project,shot:Shot){const c=buildPreviewSequence(project).find(c=>c.shot.id===shot.id);return shot.status==='to_shoot'||shot.productionState==='pickup'||!c?.asset||!c.playable;}
export const shotListFilterSchema=z.object({scene:z.string().max(200).optional(),timeOfDay:z.string().max(100).optional(),props:z.string().max(500).optional(),productionState:z.enum(['planned','filmed','pickup']).optional(),onlyGaps:z.boolean().optional()});
export function filterShotList(project:Project,filter:ShotListFilter={}):Shot[]{const q=shotListFilterSchema.parse(filter),prop=q.props?.normalize('NFKC').toLowerCase(),clips=new Map(buildPreviewSequence(project).map(c=>[c.shot.id,c]));return project.shots.filter(s=>{const c=clips.get(s.id),gap=s.status==='to_shoot'||s.productionState==='pickup'||!c?.asset||!c.playable;return(q.onlyGaps===false||gap)&&(!q.scene||s.scene===q.scene)&&(!q.timeOfDay||s.timeOfDay===q.timeOfDay)&&(!q.productionState||s.productionState===q.productionState)&&(!prop||s.props.normalize('NFKC').toLowerCase().includes(prop));});}
