// Run after a production build with Electron; all data is synthetic and temporary.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'watercut-ui-'));
const userData = path.join(temporary, 'user');
fs.mkdirSync(userData);
const settings = {
  configVersion: 1,
  projectsRoot: path.join(temporary, 'projects'),
  libraryRoot: path.join(temporary, 'library'),
};
fs.writeFileSync(
  path.join(userData, 'storage-settings.json'),
  JSON.stringify(settings),
);
app.disableHardwareAcceleration();
app.setPath('userData', userData);
app.commandLine.appendSwitch('watercut-smoke');
const output = path.join(root, 'out', 'review-core');
fs.mkdirSync(output, { recursive: true });
const checks = [],
  errors = [];
let finished = false;
function assert(value, message) {
  if (!value) throw new Error(message);
  checks.push(message);
  console.log('PASS ' + message);
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function evaluate(wc, source) {
  const expression = source.replace(/;+$/, '');
  const result = await wc.executeJavaScript(
    `(async()=>{try{const result=await (${expression});return result instanceof Node?true:result;}catch(e){return {__evaluationError:e.message,stack:e.stack};}})()`,
    true,
  );
  if (result && result.__evaluationError)
    throw new Error(result.__evaluationError + '\n' + result.stack);
  return result;
}
async function waitFor(wc, source, label, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await evaluate(wc, source)) return;
    } catch {}
    await delay(120);
  }
  const diagnostic = await evaluate(
    wc,
    "JSON.stringify({status:document.querySelector('.app-status')?.textContent,nodes:document.querySelectorAll('.react-flow__node-idea').length,title:document.querySelector('.header-title input')?.value,selected:document.querySelector('.incubate-bar')?.textContent})",
  );
  throw new Error('Timeout: ' + label + ' ' + diagnostic);
}
async function click(wc, selector, text) {
  await waitFor(
    wc,
    `[...document.querySelectorAll(${JSON.stringify(selector)})].some(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled)`,
    'enabled button ' + text,
  );
  await evaluate(
    wc,
    `(()=>{const element=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!element)throw new Error('Missing button: '+${JSON.stringify(text)});element.click();})()`,
  );
}
async function input(wc, selector, value) {
  await evaluate(
    wc,
    `(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw new Error('Missing input: '+${JSON.stringify(selector)});const proto=element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:element instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
}
async function capture(window, name) {
  fs.writeFileSync(
    path.join(output, name),
    (await window.webContents.capturePage()).toPNG(),
  );
}
async function finish(code, error) {
  if (finished) return;
  finished = true;
  if (error) errors.push(String(error.stack || error));
  fs.writeFileSync(
    path.join(output, 'report.json'),
    JSON.stringify(
      {
        checks,
        errors,
        temporary,
        node: process.versions.node,
        electron: process.versions.electron,
      },
      null,
      2,
    ),
  );
  if (error) console.error(error);
  app.exit(code);
}
const watchdog = setTimeout(
  () => void finish(1, new Error('UI smoke timed out')),
  150000,
);
app.on('web-contents-created', (_event, wc) => {
  wc.on('console-message', (event) => {
    if (
      event.level === 'error' &&
      event.message &&
      !event.message.includes('net::ERR')
    )
      errors.push(event.message);
  });
  wc.once('did-finish-load', async () => {
    if (!wc.getURL().includes('main_window')) return;
    try {
      const window = BrowserWindow.fromWebContents(wc);
      await waitFor(
        wc,
        "!!document.querySelector('.home-intro')",
        'project hall',
      );
      assert(
        await evaluate(wc, "typeof window.watercut.readLibrary==='function'"),
        'preload API is available with context isolation',
      );
      const actual = await evaluate(wc, 'window.watercut.getStorageSettings()');
      assert(
        actual.projectsRoot === settings.projectsRoot,
        'smoke uses isolated project storage',
      );
      await click(wc, '.home-intro button', '用官方示例体验一条故事 →');
      await waitFor(
        wc,
        "!!document.querySelector('.preview-screen')&&!document.querySelector('.app-status').textContent.includes('处理中')",
        'example preview',
        20000,
      );
      await evaluate(
        wc,
        '(async()=>{window.__catalog=await window.watercut.readLibrary();window.__dir=window.__catalog.projects[0].directory;window.__project=await window.watercut.readProject(window.__dir)})()',
      );
      assert(
        await evaluate(
          wc,
          'window.__project.shots.length===5&&window.__project.assets.length===3',
        ),
        'official example has five shots and three generated reference images',
      );
      assert(
        await evaluate(
          wc,
          "(await window.watercut.getPalette(window.__project.id+':'+window.__project.assets[0].id)).length>0",
        ),
        'reference image palette is extracted locally',
      );
      await capture(window, '01-preview.png');
      await click(wc, '.workflow button', '白板');
      await waitFor(
        wc,
        "document.querySelectorAll('.react-flow__node-idea').length===3",
        'board',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelectorAll('.react-flow__edge').length===1",
        ),
        'referenced idea graph renders in the project board',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelectorAll('.react-flow__node-region').length===2",
        ),
        'board regions render separately from selectable idea nodes',
      );
      await capture(window, '02-board.png');
      await click(wc, '.workflow button', '脚本');
      await click(wc, '.script-view .toolbar button', '+ 正文段落');
      await waitFor(
        wc,
        "document.querySelectorAll('.script-block').length===6",
        'script draft',
      );
      await input(
        wc,
        '.script-block:last-child textarea',
        '界面验收：新的旁白段落',
      );
      await delay(900);
      await click(wc, '.script-view .toolbar button', '正文转为镜头');
      await waitFor(
        wc,
        "document.querySelectorAll('.script-block-caption span')[5]?.textContent.includes('镜头')",
        'script conversion',
      );
      await input(
        wc,
        '.script-block:last-child textarea',
        '界面验收：修改后的对白',
      );
      await delay(900);
      assert(
        await evaluate(
          wc,
          "(await window.watercut.readProject(window.__dir)).shots[5].actionDialogue==='界面验收：修改后的对白'",
        ),
        'script editing persists to the canonical storyboard dialogue',
      );
      await click(wc, '.workflow button', '分镜');
      await waitFor(
        wc,
        "document.querySelectorAll('.shot-tile').length===6",
        'storyboard',
      );
      await evaluate(
        wc,
        "document.querySelector('.shot-tile:last-child').click()",
      );
      await waitFor(
        wc,
        "document.querySelector('.inspector h2')?.textContent==='镜头 6'",
        'shot inspector',
      );
      await evaluate(
        wc,
        "window.__status=document.querySelector('.inspector select');",
      );
      await input(wc, '.inspector select', 'to_shoot');
      await delay(900);
      assert(
        await evaluate(
          wc,
          "(await window.watercut.readProject(window.__dir)).shots[5].status==='to_shoot'",
        ),
        'production status auto-saves independently of media health',
      );
      await capture(window, '03-storyboard.png');
      await click(wc, '.workflow button', '清单');
      await waitFor(
        wc,
        "document.querySelector('.storyboard-view h1')?.textContent.includes('拍摄')",
        'shot list',
      );
      assert(
        await evaluate(
          wc,
          "[...document.querySelectorAll('.shot-tile')].some(e=>e.textContent.includes('标记待拍'))",
        ),
        'shot list includes marked and missing-media shots',
      );
      await click(wc, '.workflow button', '粗剪');
      await waitFor(wc, "!!document.querySelector('.transport')", 'preview');
      await click(wc, '.transport button', '播放');
      // Wait for the observable clock instead of assuming audio starts within 650 ms.
      await waitFor(
        wc,
        `Number(document.querySelector('[aria-label="预览进度"]').value)>200`,
        'preview clock advance',
      );
      await click(wc, '.transport button', '暂停');
      const cursor = await evaluate(
        wc,
        'Number(document.querySelector(\'[aria-label="预览进度"]\').value)',
      );
      assert(cursor > 200, 'preview playback advances the shared timeline');
      await delay(350);
      const paused = await evaluate(
        wc,
        'Number(document.querySelector(\'[aria-label="预览进度"]\').value)',
      );
      assert(
        Math.abs(cursor - paused) < 50,
        'paused image/placeholder playback does not continue timing',
      );
      await evaluate(
        wc,
        "document.querySelector('.timeline-scroll').scrollIntoView({block:'center'})",
      );
      await delay(180);
      const bounds = await evaluate(
        wc,
        "(()=>{const r=document.querySelector('.timeline-clip .resize-handle.right').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()",
      );
      wc.sendInputEvent({ type: 'mouseMove', x: bounds.x, y: bounds.y });
      wc.sendInputEvent({
        type: 'mouseDown',
        x: bounds.x,
        y: bounds.y,
        button: 'left',
        clickCount: 1,
      });
      await delay(120);
      for (let n = 1; n <= 4; n++) {
        wc.sendInputEvent({
          type: 'mouseMove',
          x: bounds.x + 10 * n,
          y: bounds.y,
          button: 'left',
        });
        await delay(50);
      }
      wc.sendInputEvent({
        type: 'mouseUp',
        x: bounds.x + 40,
        y: bounds.y,
        button: 'left',
        clickCount: 1,
      });
      await delay(800);
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readProject(window.__dir)).shots[0].durationMs>3500',
        ),
        'timeline edge drag persists the image shot duration',
      );
      await click(wc, '.rail button', '◈总库');
      await waitFor(
        wc,
        "!!document.querySelector('.library-main')",
        'global library',
      );
      await click(wc, '.library-main .section-heading button', '+ 记录灵感');
      await waitFor(
        wc,
        "!!document.querySelector('.modal .idea-form')",
        'new idea form',
      );
      await input(wc, '.modal .idea-form textarea', '界面验收：全局情绪卡');
      await input(wc, '.modal .idea-form select', 'mood');
      await click(wc, '.modal .form-actions button', '保存编辑');
      await waitFor(
        wc,
        "!document.querySelector('.modal .idea-form')",
        'global idea save',
      );
      assert(
        await evaluate(
          wc,
          "(await window.watercut.readLibrary({search:'界面验收：全局情绪卡'})).totalIdeas===1",
        ),
        'global mood card can be created without a project',
      );
      await capture(window, '04-library.png');
      await waitFor(
        wc,
        "document.querySelectorAll('.library-main .resource-card input[type=checkbox]').length>=2",
        'library selection',
      );
      await evaluate(
        wc,
        "(()=>{const boxes=document.querySelectorAll('.library-main .resource-card input[type=checkbox]');boxes[0].click();boxes[1].click()})()",
      );
      await input(wc, '[aria-label="关系备注"]', '跨卡片的手动关系');
      await click(wc, '.incubate-bar button', '建立关联');
      await waitFor(
        wc,
        "(await window.watercut.readLibrary()).relations.some(r=>r.note==='跨卡片的手动关系')",
        'manual global relationship',
      );
      await input(wc, '[aria-label="孵化项目名称"]', '孵化验收');
      await click(wc, '.incubate-bar button', '孵化为项目');
      await waitFor(
        wc,
        "document.querySelectorAll('.react-flow__node-idea').length===2",
        'incubated project',
      );
      assert(
        await evaluate(
          wc,
          "(await window.watercut.readLibrary()).projects.some(p=>p.name==='孵化验收')",
        ),
        'selected global cards and their relation incubate a project',
      );
      const fixture = path.join(temporary, 'test-pattern.webm');
      fs.writeFileSync(
        fixture,
        Buffer.from(
          fs
            .readFileSync(
              path.join(
                root,
                'scripts',
                'fixtures',
                'test-pattern.webm.base64',
              ),
              'utf8',
            )
            .trim(),
          'base64',
        ),
      );
      const originalDialog = dialog.showOpenDialog;
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [fixture],
      });
      await evaluate(
        wc,
        "(async()=>{const page=await window.watercut.importLibraryAssets();const asset=page.assets.find(a=>a.kind==='video');const image=page.assets.find(a=>a.kind==='image');let p=await window.watercut.createProject('视频播放验收');p=await window.watercut.attachLibraryAssets(p.directory,[asset.id,image.id]);for(const text of ['视频测试','图片测试','文字测试'])p=await window.watercut.addShot(p.directory,{description:text,durationMs:1200});p=await window.watercut.linkAsset(p.directory,p.shots[0].id,p.assets.find(a=>a.kind==='video').id);p=await window.watercut.updateTrim(p.directory,p.shots[0].id,1000,3000);p=await window.watercut.linkAsset(p.directory,p.shots[1].id,p.assets.find(a=>a.kind==='image').id);window.__videoDir=p.directory;window.__videoShot=p.shots[0].id;})()",
      );
      dialog.showOpenDialog = originalDialog;
      await click(wc, '.rail button', '▦项目');
      await click(wc, '.home-page .section-heading button', '核对项目索引');
      await waitFor(
        wc,
        "[...document.querySelectorAll('.project-tile')].some(e=>e.textContent.includes('视频播放验收'))",
        'video project catalog',
      );
      await evaluate(
        wc,
        "[...document.querySelectorAll('.project-tile')].find(e=>e.textContent.includes('视频播放验收')).querySelector('button').click()",
      );
      await waitFor(
        wc,
        "document.querySelector('.header-title input')?.value==='视频播放验收'",
        'open video project',
      );
      await click(wc, '.workflow button', '粗剪');
      await waitFor(
        wc,
        "document.querySelector('.preview-screen video')?.readyState>=2",
        'video decoding',
        15000,
      );
      await delay(300);
      assert(
        await evaluate(
          wc,
          "Math.abs(document.querySelector('.preview-screen video').currentTime-1)<.3",
        ),
        'video begins at its source in-point',
      );
      await click(wc, '.transport button', '播放');
      await delay(2450);
      await click(wc, '.transport button', '暂停');
      assert(
        await evaluate(
          wc,
          "Number(document.querySelector('[aria-label=\"预览进度\"]').value)>=2000&&!document.querySelector('.preview-screen video')",
        ),
        'video switches at the out-point into the next image shot',
      );
      await input(wc, '[aria-label="预览进度"]', '500');
      await waitFor(
        wc,
        "document.querySelector('.preview-screen video')?.readyState>=2",
        'seek back to video',
      );
      await delay(150);
      assert(
        await evaluate(
          wc,
          "Math.abs(document.querySelector('.preview-screen video').currentTime-1.5)<.3",
        ),
        'timeline seek maps global time to source in-point plus offset',
      );
      await evaluate(
        wc,
        "(()=>{const clips=document.querySelectorAll('.timeline-clip'),transfer=new DataTransfer();clips[0].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));clips[2].dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));})()",
      );
      await waitFor(
        wc,
        '(await window.watercut.readProject(window.__videoDir)).shots[2].id===window.__videoShot',
        'timeline reorder',
      );
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readProject(window.__videoDir)).scriptBlocks[2].shotId===window.__videoShot',
        ),
        'timeline reorder persists the canonical shot and script order',
      );
      await capture(window, '05-video-timeline.png');
      assert(
        !errors.some((e) => /Uncaught|TypeError|ReferenceError/.test(e)),
        'renderer has no uncaught JavaScript errors',
      );
      clearTimeout(watchdog);
      await finish(0);
    } catch (error) {
      try {
        const window = BrowserWindow.fromWebContents(wc);
        if (window) await capture(window, 'failure.png');
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
    : path.join(root, '.vite', 'build', 'main.cjs'),
);
