import { BrowserWindow } from 'electron';
import { mkdirSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkCancelled } from '../../infrastructure/jobs/file-jobs';
import type { TimelineDocument } from '../../shared/timeline';
export async function writePlaceholders(timeline:TimelineDocument,directory:string,signal?:AbortSignal):Promise<Record<string,string>>{
  const items=timeline.media.filter(m=>!m.sourceAssetId),result:Record<string,string>={};if(!items.length)return result;
  if(timeline.settings.width*timeline.settings.height>16777216)throw new Error('占位图画布最多 1600 万像素，请降低序列分辨率');
  mkdirSync(directory,{recursive:true});const window=new BrowserWindow({show:false,width:800,height:600,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const abort=()=>{if(!window.isDestroyed())window.destroy();};signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,30000);
  try{
    checkCancelled(signal);
    await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'"><canvas id="canvas"></canvas>'));
    for(const media of items){checkCancelled(signal);const data={width:timeline.settings.width,height:timeline.settings.height,text:media.placeholderText??'画面待创作'};
      const value=await window.webContents.executeJavaScript(`(()=>{const data=${JSON.stringify(data)},canvas=document.getElementById('canvas');canvas.width=data.width;canvas.height=data.height;const c=canvas.getContext('2d');c.fillStyle='#10181c';c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle='#eaf0f2';const font=Math.max(20,Math.round(data.width*.025)),lineHeight=font*1.6;c.font=font+'px "Microsoft YaHei",sans-serif';c.textAlign='center';const width=data.width*.80,lines=[];for(const line of data.text.split('\\n')){let current='';for(const ch of Array.from(line)){if(c.measureText(current+ch).width>width){lines.push(current);current=ch;}else current+=ch;}lines.push(current);}const maximum=Math.max(2,Math.floor(data.height*.72/lineHeight)),visible=lines.slice(0,maximum);if(lines.length>maximum)visible[maximum-1]='… 完整文字见分镜清单';let y=(data.height-visible.length*lineHeight)/2+font;for(const line of visible){c.fillText(line,data.width/2,y,width);y+=lineHeight;}return canvas.toDataURL('image/png').split(',')[1];})()`);
      checkCancelled(signal);if(typeof value!=='string'||value.length>32*1024**2)throw new Error('占位图生成失败或体积过大');const file=path.join(directory,`${media.id}.png`);writeFileSync(file,Buffer.from(value,'base64'));result[media.id]=file;
    }
    return result;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);abort();}
}
