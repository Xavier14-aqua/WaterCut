// Draft templates/layout reference: GuanYixuan/pyJianYingDraft (Apache-2.0).
// WaterCut's adapter and bounded internal timeline mapping are maintained here.
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import contentTemplate from './templates/draft_content_template.json';
import metaTemplate from './templates/draft_meta_info.json';
import type { TimelineDocument,TimelineSegment } from '../../shared/timeline';
const id=()=>randomUUID().replaceAll('-','');
export function jianyingDocuments(timeline:TimelineDocument,folder:string){
  const fps=timeline.settings.fpsNum/timeline.settings.fpsDen;if(!Number.isInteger(fps))throw new Error('本轮剪映草稿交接仅支持整数序列帧率，请选择 25 / 30 / 60 fps');
  for(const media of timeline.media){const extension=path.extname(media.relativePath).toLowerCase(),allowed=media.kind==='video'?['.mp4','.mov']:media.kind==='image'?['.png','.jpg','.jpeg']:['.wav','.mp3','.m4a'];if(!allowed.includes(extension))throw new Error(`本轮剪映交接暂不支持 ${extension}：${media.name}。请先转换为 ${allowed.join(' / ')}；原件不会被修改。`);}
  const draft:any=structuredClone(contentTemplate),meta:any=structuredClone(metaTemplate),draftId=randomUUID().toUpperCase(),now=Date.now()*1000;
  Object.assign(draft,{id:draftId,name:timeline.name,fps,duration:timeline.durationUs,create_time:now,update_time:now,canvas_config:{width:timeline.settings.width,height:timeline.settings.height,ratio:'original'}});
  const materials=new Map<string,string>(),all=draft.materials;
  for(const media of timeline.media){const materialId=id(),file=path.resolve(folder,...media.relativePath.split('/')).replaceAll('\\','/');materials.set(media.id,materialId);
    if(media.kind==='audio')all.audios.push({app_id:0,category_id:'',category_name:'local',check_flag:3,copyright_limit_type:'none',duration:(media.durationMs??0)*1000,effect_id:'',formula_id:'',id:materialId,local_material_id:materialId,music_id:materialId,name:media.name,path:file,source_platform:0,type:'extract_music',wave_points:[]});
    else all.videos.push({audio_fade:null,category_id:'',category_name:'local',check_flag:63487,crop:{upper_left_x:0,upper_left_y:0,upper_right_x:1,upper_right_y:0,lower_left_x:0,lower_left_y:1,lower_right_x:1,lower_right_y:1},crop_ratio:'free',crop_scale:1,duration:media.kind==='image'?10800000000:(media.durationMs??0)*1000,height:media.height,id:materialId,local_material_id:materialId,material_id:materialId,material_name:media.name,media_path:'',path:file,type:media.kind==='image'?'photo':'video',width:media.width});
  }
  function segment(clip:TimelineSegment,visual:boolean){const speedId=id(),refs=[speedId];all.speeds.push({curve_speed:null,id:speedId,mode:0,speed:1,type:'speed'});
    if(!visual&&((clip.fadeInUs??0)||(clip.fadeOutUs??0))){const fadeId=id();all.audio_fades.push({id:fadeId,fade_in_duration:clip.fadeInUs??0,fade_out_duration:clip.fadeOutUs??0,fade_type:0,type:'audio_fade'});refs.push(fadeId);}
    return{enable_adjust:true,enable_color_correct_adjust:false,enable_color_curves:true,enable_color_match_adjust:false,enable_color_wheels:true,enable_lut:true,enable_smart_color_adjust:false,last_nonzero_volume:clip.volume||1,reverse:false,track_attribute:0,track_render_index:visual?0:clip.track+1,visible:true,id:id(),material_id:materials.get(clip.mediaId),target_timerange:{start:clip.startUs,duration:clip.durationUs},source_timerange:{start:clip.sourceInUs,duration:clip.durationUs},speed:1,volume:clip.volume,extra_material_refs:refs,is_tone_modify:false,common_keyframes:[],keyframe_refs:[],clip:visual?{alpha:1,flip:{horizontal:false,vertical:false},rotation:0,scale:{x:1,y:1},transform:{x:0,y:0}}:null,uniform_scale:visual?{on:true,value:1}:null,hdr_settings:visual?{intensity:1,mode:1,nits:1000}:null};
  }
  draft.tracks=[{attribute:0,flag:0,id:id(),is_default_name:false,name:'WaterCut 主画面',segments:timeline.video.map(c=>segment(c,true)),type:'video'},...[...new Set(timeline.audio.map(c=>c.track))].sort((a,b)=>a-b).map(track=>({attribute:0,flag:0,id:id(),is_default_name:false,name:`WaterCut BGM ${track+1}`,segments:timeline.audio.filter(c=>c.track===track).map(c=>segment(c,false)),type:'audio'}))];
  Object.assign(meta,{draft_id:draftId,draft_name:timeline.name,draft_fold_path:path.resolve(folder).replaceAll('\\','/'),draft_root_path:path.dirname(path.resolve(folder)).replaceAll('\\','/'),tm_duration:timeline.durationUs,tm_draft_cloud_modified:now,draft_new_version:draft.new_version});
  return{content:draft,meta};
}
