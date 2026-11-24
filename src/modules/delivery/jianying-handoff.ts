import { existsSync,mkdirSync,mkdtempSync,renameSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { hydrateProject,resolveProjectAsset } from '../workspace/index';
import { buildTimelineDocument } from '../../shared/timeline';
import { jianyingDocuments } from './jianying-adapter';
import { assertSpace,checkCancelled,containedFile,copyWithHash,hashFile,removeJobDirectory,type JobOptions } from '../../infrastructure/jobs/file-jobs';
import { shotListCSV } from '../../shared/print';
import { readProject } from '../project/index';
import { jianyingCompatibility,jianyingHandoffInstructions } from '../../shared/jianying-compatibility';
export async function exportJianying(directory:string,root:string,parent:string,input:unknown,placeholderFiles:Record<string,string>,options:JobOptions={}){
  const settings=z.object({placeholders:z.boolean(),baseRevision:z.number().int().nonnegative()}).parse(input),project=hydrateProject(directory,root);
  if(project.revision!==settings.baseRevision)throw new Error('项目在交接准备期间有更新，请重新导出');
  const timeline=buildTimelineDocument(project,settings.placeholders);jianyingDocuments(timeline,path.resolve(parent)); // Fail unsupported rates before copying.
  const target=path.resolve(parent),name=`${project.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,70)}-${randomUUID().slice(0,8)}.jianying`,final=path.join(target,name);
  assertSpace(target,project.assets.filter(a=>timeline.media.some(m=>m.sourceAssetId===a.id)).reduce((n,a)=>n+a.size,0)+8*1024**2);
  const stage=mkdtempSync(path.join(target,'.watercut-handoff-'));let published=false;
  try{mkdirSync(path.join(stage,'media'));const files:Array<{path:string;size:number;sha256:string}>=[],known=new Map<string,string>();let completed=0;
    for(const item of timeline.media){checkCancelled(options.signal);let source:string|null=null,expected:string|null=null;
      if(item.sourceAssetId){const asset=project.assets.find(a=>a.id===item.sourceAssetId)!;source=resolveProjectAsset(directory,asset,root);expected=asset.sha256;if(source)source=containedFile(asset.storageKind==='library'?root:directory,source);}
      else source=placeholderFiles[item.id]??null;
      if(!source||!existsSync(source))throw new Error(`交接原件缺失：${item.name}`);
      const temporary=path.join(stage,'media',`${randomUUID()}.partial`),copied=await copyWithHash(source,temporary,{signal:options.signal});
      if(expected&&copied.sha256!==expected)throw new Error(`原件指纹变化：${item.name}`);
      const existing=known.get(copied.sha256),relative=existing??`media/${copied.sha256}${path.extname(item.relativePath)}`;
      if(existing){const {unlinkSync}=await import('node:fs');unlinkSync(temporary);}else{renameSync(temporary,path.join(stage,...relative.split('/')));known.set(copied.sha256,relative);files.push({path:relative,size:copied.size,sha256:copied.sha256});}
      item.relativePath=relative;options.onProgress?.(++completed,timeline.media.length);
    }
    const documents=jianyingDocuments(timeline,final),data:Record<string,string>={
      'draft_content.json':JSON.stringify(documents.content),
      'draft_meta_info.json':JSON.stringify(documents.meta),
      'timeline.json':JSON.stringify(timeline,null,2),
      '分镜清单.csv':shotListCSV(project,{onlyGaps:false}),
      '使用说明.txt':jianyingHandoffInstructions.replace(/\r?\n/g,'\r\n')
    };
    for(const [relative,text] of Object.entries(data)){checkCancelled(options.signal);const file=path.join(stage,relative);writeFileSync(file,text);files.push({path:relative,size:Buffer.byteLength(text),sha256:await hashFile(file,options.signal)});}
    writeFileSync(path.join(stage,'watercut-handoff.json'),JSON.stringify({format:'WaterCutJianying',version:1,compatibility:jianyingCompatibility,createdAt:new Date().toISOString(),projectRevision:project.revision,videoClips:timeline.video.length,audioClips:timeline.audio.length,durationFrames:timeline.durationFrames,fps:{numerator:timeline.settings.fpsNum,denominator:timeline.settings.fpsDen},files},null,2));
    checkCancelled(options.signal);if(readProject(directory,true).revision!==settings.baseRevision)throw new Error('项目在交接期间被其他窗口修改，请重新导出');renameSync(stage,final);published=true;return{directory:final,videoClips:timeline.video.length,audioClips:timeline.audio.length,durationUs:timeline.durationUs,placeholders:timeline.media.filter(m=>!m.sourceAssetId).length};
  }finally{if(!published)removeJobDirectory(stage,target,'.watercut-handoff-');}
}
