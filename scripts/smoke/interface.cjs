// Native visual acceptance: only synthetic data in an isolated storage root.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'out/review-interface');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'watercut-ui-'));
const userData = path.join(temporary, 'user');
fs.mkdirSync(userData);
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(
  path.join(userData, 'storage-settings.json'),
  JSON.stringify({
    configVersion: 1,
    projectsRoot: path.join(temporary, 'projects'),
    libraryRoot: path.join(temporary, 'library'),
  }),
);
app.setPath('userData', userData);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('watercut-smoke');
const checks = [],
  errors = [],
  screens = [];
let finished = false;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(value, message) {
  if (!value) throw Error(message);
  checks.push(message);
  console.log('PASS ' + message);
}
async function evaluate(wc, source) {
  const result = await wc.executeJavaScript(
    `(async()=>{try{return await (${source});}catch(error){return {__error:error.message,stack:error.stack};}})()`,
    true,
  );
  if (result?.__error) throw Error(result.__error + '\n' + result.stack);
  return result;
}
async function waitFor(wc, source, label) {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    if (await evaluate(wc, source)) return;
    await delay(100);
  }
  throw Error('Timeout: ' + label);
}
async function click(wc, selector, text) {
  await waitFor(
    wc,
    `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.matches(':disabled'));if(!e)return false;e.click();return true;})()`,
    text,
  );
}
async function settled(wc) {
  await evaluate(
    wc,
    `(async()=>{
      await document.fonts.ready;
      await Promise.all([...document.images].filter(e=>e.getClientRects().length).map(e=>e.decode().catch(()=>{})));
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));
      return true;
    })()`,
  );
}
async function capture(wc, name) {
  await settled(wc);
  const measurements = await evaluate(
    wc,
    `(()=>{
    const selectors=['.app-shell','.global-header','.home-page','.resources-sidebar','.workspace-main','.inspector','.library-main','.modal'];
    const overflow=selectors.flatMap(selector=>[...document.querySelectorAll(selector)].filter(e=>e.getClientRects().length&&e.scrollWidth>e.clientWidth+2).map(e=>({selector,client:e.clientWidth,scroll:e.scrollWidth})));
    const rgb=text=>(text.match(/[0-9.]+/g)||[]).map(Number);
    const luminance=c=>c.slice(0,3).map(n=>{n/=255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4}).reduce((sum,n,i)=>sum+n*[0.2126,0.7152,0.0722][i],0);
    const contrastFailures=[];let minimumTextContrast=21,measuredTextCount=0;
    for(const e of document.querySelectorAll('h1,h2,p.muted,.kind-label,.resource-card-body strong,.workflow button,.segmented button,.save-state,.preview-placeholder small')){
      if(!e.getClientRects().length||e.matches(':disabled'))continue;
      let parent=e,bg;
      while(parent){const c=rgb(getComputedStyle(parent).backgroundColor);if(c.length===3||c[3]===1){bg=c;break;}parent=parent.parentElement;}
      if(!bg)continue;
      measuredTextCount++;
      const fg=rgb(getComputedStyle(e).color),a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      minimumTextContrast=Math.min(minimumTextContrast,ratio);
      if(ratio<4.5)contrastFailures.push({text:e.textContent.trim().slice(0,50),ratio});
    }
    const main=document.querySelector('.workspace-main');
    const details=main&&overflow.length?[...main.querySelectorAll('*')].filter(e=>!e.closest('.idea-board,.timeline-scroll')&&e.getBoundingClientRect().right>main.getBoundingClientRect().right).slice(0,12).map(e=>({tag:e.tagName,classes:typeof e.className==='string'?e.className:'svg',right:e.getBoundingClientRect().right,scroll:e.scrollWidth,client:e.clientWidth})):[];
    const header=document.querySelector('.global-header').getBoundingClientRect();
    const clipped=[...document.querySelectorAll('.workflow button,.delivery-toggle,.rail button')].filter(e=>{const r=e.getBoundingClientRect();return r.width&& (r.left<0||r.right>innerWidth+1||r.bottom>innerHeight+1||(e.closest('.global-header')&&r.bottom>header.bottom+1));}).map(e=>e.textContent.trim());
    return {width:innerWidth,height:innerHeight,overflow,clipped,details,contrastFailures,minimumTextContrast,measuredTextCount,activeStage:document.querySelector('.workflow .active')?.textContent.trim(),failedImages:[...document.images].filter(e=>e.getClientRects().length&&!e.naturalWidth).map(e=>e.alt),theme:getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()};
  })()`,
  );
  const image = await wc.capturePage();
  fs.writeFileSync(path.join(output, name + '.png'), image.toPNG());
  screens.push({ name, ...measurements });
  if (measurements.overflow.length || measurements.clipped.length)
    console.error(JSON.stringify(measurements));
  assert(
    !measurements.overflow.length && !measurements.clipped.length,
    name + ' keeps content and controls within their own columns',
  );
  if (measurements.contrastFailures.length)
    console.error(JSON.stringify(measurements.contrastFailures));
  assert(
    measurements.measuredTextCount > 0 && !measurements.contrastFailures.length,
    name + ' keeps representative text contrast at least 4.5:1',
  );
}
async function finish(code, error) {
  if (finished) return;
  finished = true;
  if (error) {
    errors.push(String(error.stack || error));
    console.error(error);
  }
  fs.writeFileSync(
    path.join(output, 'report.json'),
    JSON.stringify(
      {
        checks,
        errors,
        screens,
        temporary,
        fixtures:
          'Official example plus two synthetic projects; no personal data',
        electron: process.versions.electron,
      },
      null,
      2,
    ),
  );
  app.exit(code);
}
const watchdog = setTimeout(
  () => void finish(1, Error('Interface acceptance timed out')),
  180000,
);
app.on('web-contents-created', (_event, wc) => {
  wc.on('console-message', (event) => {
    if (event.level === 'error' && !event.message.includes('net::ERR'))
      errors.push(event.message);
  });
  wc.once('did-finish-load', async () => {
    if (!wc.getURL().includes('main_window')) return;
    try {
      const window = BrowserWindow.fromWebContents(wc);
      await waitFor(wc, "!!document.querySelector('.home-intro')", 'home');
      await evaluate(
        wc,
        `(async()=>{
        window.confirm=()=>true;
        let p=await window.watercut.createExample();
        const paragraphs=p.scriptBlocks.filter(b=>b.kind==='body');
        if(paragraphs.length){p=await window.watercut.createScriptSection(p.directory,{title:'第一章 · 雨后的城市',beforeId:paragraphs[0].id});}
        if(paragraphs.length>2){p=await window.watercut.createScriptSection(p.directory,{title:'第二章 · 回到日常',beforeId:paragraphs[2].id});}
        window.__interfaceProject=p;
        await window.watercut.createProject('城市光线 · 画面练习');
        await window.watercut.createProject('一段散步的时间');
      })()`,
      );
      await click(wc, '.home-page .section-heading button', '核对项目索引');
      await waitFor(
        wc,
        "document.querySelectorAll('.project-tile').length===3",
        'three synthetic project cards',
      );
      assert(
        await evaluate(
          wc,
          "[...document.querySelectorAll('.project-cover svg')].length===3",
        ),
        'project covers are generated without private imagery',
      );
      for (const width of [1440, 1280, 1000]) {
        window.setContentSize(width, 900);
        await waitFor(wc, `innerWidth===${width}`, 'viewport ' + width);
        await click(wc, '.rail button', '项目');
        await waitFor(
          wc,
          "!!document.querySelector('.home-intro')",
          'project hall',
        );
        await capture(wc, 'home-' + width);
        await waitFor(
          wc,
          `(()=>{const card=[...document.querySelectorAll('.project-tile')].find(e=>e.querySelector('h3').textContent===window.__interfaceProject.name);const button=card?.querySelector('.project-open');if(!button||button.disabled)return false;button.click();return true;})()`,
          'open example project',
        );
        await waitFor(
          wc,
          "!!document.querySelector('.workflow')&&!document.querySelector('.workflow button').disabled",
          'studio ready',
        );
        for (const [stage, label] of [
          ['board', '白板'],
          ['script', '脚本'],
          ['storyboard', '分镜'],
          ['preview', '粗剪'],
          ['checklist', '清单'],
        ]) {
          await click(wc, '.workflow button', label);
          await waitFor(
            wc,
            `!!document.querySelector('.workspace-main[data-stage="${stage}"]')`,
            stage,
          );
          await waitFor(
            wc,
            `document.querySelector('.workflow .active')?.textContent.trim()===${JSON.stringify(label)}&&![...document.querySelectorAll('.workflow button')].some(b=>b.disabled)`,
            'settled workflow ' + label,
          );
          if (stage === 'board')
            await waitFor(
              wc,
              "document.querySelectorAll('.react-flow__node-idea').length===3",
              'board nodes',
            );
          const close = await evaluate(
            wc,
            "document.querySelector('.inspector > .section-heading button')?.textContent.trim()",
          );
          if (close === '关闭')
            await click(wc, '.inspector > .section-heading button', '关闭');
          await capture(wc, stage + '-' + width);
        }
        await evaluate(
          wc,
          "document.querySelector('.workflow button').focus()",
        );
        assert(
          await evaluate(
            wc,
            'parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2',
          ),
          'keyboard focus remains visible at ' + width + ' pixels',
        );
        await click(wc, '.workflow button', '分镜');
        await waitFor(
          wc,
          "!!document.querySelector('.shot-tile')",
          'shot details',
        );
        await evaluate(wc, "document.querySelector('.shot-tile').click()");
        await waitFor(
          wc,
          "!!document.querySelector('.inspector textarea')",
          'inspector fields',
        );
        await capture(wc, 'inspector-' + width);
        await click(wc, '.rail button', '总库');
        await waitFor(
          wc,
          "!!document.querySelector('.global-library-layout')",
          'global library',
        );
        await waitFor(
          wc,
          "document.querySelectorAll('.library-main .resource-card').length>0&&!document.querySelector('.library-main').textContent.includes('正在检索')",
          'populated global library',
        );
        await capture(wc, 'library-' + width);
        await click(wc, '.rail button', '存储');
        await waitFor(
          wc,
          "!!document.querySelector('.modal')",
          'storage dialog',
        );
        await capture(wc, 'storage-' + width);
        await click(wc, '.modal button', '关闭');
      }
      assert(
        await evaluate(
          wc,
          'document.querySelectorAll(\'link[href^="http"]\').length===0&&document.querySelectorAll(\'img[src^="http"]\').length===0',
        ),
        'the visual theme adds no remote font or image dependency',
      );
      assert(
        screens.every((screen) => !screen.failedImages.length),
        'reference media have decoded in every captured viewport',
      );
      assert(
        !errors.length,
        'all reference screens render without uncaught errors',
      );
      clearTimeout(watchdog);
      await finish(0);
    } catch (error) {
      try {
        fs.writeFileSync(
          path.join(output, 'failure.png'),
          (await wc.capturePage()).toPNG(),
        );
      } catch {}
      await finish(1, error);
    }
  });
});
require(
  process.argv.includes('--packaged')
    ? path.join(
        root,
        process.env.WATERCUT_SMOKE_OUT || 'out',
        'WaterCut-win32-x64',
        'resources',
        'app.asar',
        '.vite',
        'build',
        'main.cjs',
      )
    : path.join(root, '.vite/build/main.cjs'),
);
