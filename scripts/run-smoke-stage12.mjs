import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const root=path.resolve(import.meta.dirname,'..');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const outputFlag=process.argv.find(arg=>arg.startsWith('--out='));if(outputFlag)env.WATERCUT_SMOKE_OUT=outputFlag.slice('--out='.length);
// Electron resolves (and, on a clean checkout, installs) its pinned runtime.
// Do not assume npm ci has populated node_modules/electron/dist already.
const electron=createRequire(import.meta.url)('electron');
const ideaRegression=process.argv.includes('--ideas');
const stage3=process.argv.includes('--stage3');
const patch131=process.argv.includes('--patch131');
const stage4a=process.argv.includes('--stage4a');
const ideaBoxes=process.argv.includes('--boxes');
const child=spawn(electron,[path.join(root,'scripts',stage4a?'smoke-stage4a.cjs':ideaBoxes?'smoke-idea-boxes.cjs':patch131?'smoke-patch131.cjs':stage3?'smoke-stage3.cjs':ideaRegression?'regression-idea-close.cjs':'smoke-stage12.cjs'),...process.argv.slice(2)],{cwd:root,env,windowsHide:true,stdio:'inherit'});
child.on('error',error=>{console.error(error);process.exitCode=1;});
child.on('exit',code=>{
  process.exitCode=code??1;
  const reportFile=path.join(root,'out',stage4a?'review-stage4a':ideaBoxes?'review-idea-boxes':patch131?'review-patch131':stage3?'review-stage3':ideaRegression?'review-idea-close':'review-stage12','report.json');
  if(fs.existsSync(reportFile)){
    const report=JSON.parse(fs.readFileSync(reportFile,'utf8')),temporary=path.resolve(report.temporary??'');
    if(path.dirname(temporary)===path.resolve(os.tmpdir())&&path.basename(temporary).startsWith('watercut-ui-')){
      try{fs.rmSync(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:200});}catch(error){console.error('Temporary test directory retained:',error.message);}
    }
  }
});
