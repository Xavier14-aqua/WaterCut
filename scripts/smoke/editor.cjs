// Patch regressions run against native Electron with synthetic, isolated data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'watercut-ui-'));
const userData = path.join(temporary, 'user');
const settings = {
  configVersion: 1,
  projectsRoot: path.join(temporary, 'projects'),
  libraryRoot: path.join(temporary, 'library'),
};
fs.mkdirSync(userData);
fs.writeFileSync(
  path.join(userData, 'storage-settings.json'),
  JSON.stringify(settings),
);
app.setPath('userData', userData);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('watercut-smoke');
const output = path.join(root, 'out', 'review-editor');
fs.mkdirSync(output, { recursive: true });
const checks = [],
  errors = [];
let finished = false;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(value, message) {
  if (!value) throw new Error(message);
  checks.push(message);
  console.log('PASS ' + message);
}
async function evaluate(wc, source) {
  const result = await wc.executeJavaScript(
    `(async()=>{try{const result=await (${source});return result instanceof Node?true:result;}catch(e){return {__evaluationError:e.message,stack:e.stack};}})()`,
    true,
  );
  if (result?.__evaluationError)
    throw new Error(result.__evaluationError + '\n' + result.stack);
  return result;
}
async function waitFor(wc, source, label, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(wc, source)) return;
    await delay(100);
  }
  throw new Error(
    'Timeout: ' +
      label +
      ' ' +
      (await evaluate(
        wc,
        'document.querySelector(".app-status")?.textContent',
      )),
  );
}
async function click(wc, selector, text) {
  await waitFor(
    wc,
    `[...document.querySelectorAll(${JSON.stringify(selector)})].some(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled)`,
    'button ' + text,
  );
  await evaluate(
    wc,
    `(()=>{[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click();})()`,
  );
}
async function input(wc, selector, value) {
  await waitFor(
    wc,
    `!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).matches(':disabled')`,
    'enabled input ' + selector,
  );
  await evaluate(
    wc,
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Input missing: '+${JSON.stringify(selector)});const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
}
async function drag(wc, sourceSelector, targetSelector) {
  // A reorder renders its result before App.run finishes reloading the library.
  // Wait for the current handle to be enabled, just as a real user must do.
  await waitFor(
    wc,
    `document.querySelector(${JSON.stringify(sourceSelector)})?.matches('[draggable="true"]:not(:disabled)')&&!!document.querySelector(${JSON.stringify(targetSelector)})`,
    'enabled drag handle',
  );
  await evaluate(
    wc,
    `(()=>{const from=document.querySelector(${JSON.stringify(sourceSelector)}),target=document.querySelector(${JSON.stringify(targetSelector)}),dt=new DataTransfer();from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));if(!dt.getData('application/x-watercut-script'))throw Error('Drag did not start from an enabled handle');target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt,clientY:target.getBoundingClientRect().top}));from.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));})()`,
  );
}
async function capture(wc, name) {
  fs.writeFileSync(path.join(output, name), (await wc.capturePage()).toPNG());
}
async function idle(wc) {
  await waitFor(
    wc,
    "!document.querySelector('.app-status').textContent.includes('处理中')",
    'idle',
  );
  await delay(120);
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
    JSON.stringify({ checks, errors, temporary }, null, 2),
  );
  app.exit(code);
}
const watchdog = setTimeout(
  () => void finish(1, new Error('Patch regression timed out')),
  150000,
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
      await click(wc, '.home-intro button', '用官方示例体验一条故事 →');
      await waitFor(
        wc,
        "!!document.querySelector('.preview-screen')",
        'example',
      );
      await idle(wc);
      await evaluate(
        wc,
        `(async()=>{
        const api=window.watercut,library=await api.readLibrary();
        const a=await api.readProject(library.projects[0].directory);
        window.__a=a;window.__dir=a.directory;
        let b=await api.createProject('另一个项目：独立资源');
        b=await api.addIdea(b.directory,'B 项目专属灵感');
        b=await api.attachLibraryAssets(b.directory,[library.assets[0].id]);
        window.__b=b;
        const payload={colors:[],rhythm:'',timeOfDay:'',weather:'',environment:'',location:'',props:''};
        const target=await api.saveLibraryIdea({kind:'note',text:'分页之外的关联标题：雨夜便利店与旧时光',tags:'',notes:'',payload,occurredAt:null,media:[]});
        window.__target=target;
        for(let i=0;i<101;i++)await api.saveLibraryIdea({kind:'note',text:'分页测试 '+i,tags:'',notes:'',payload,occurredAt:null,media:[]});
        window.__anchor=await api.saveLibraryIdea({kind:'note',text:'关联标题验收入口',tags:'',notes:'',payload,occurredAt:null,media:[]});
        await api.connectLibraryIdeas(window.__anchor.id,target.id,'related','跨分页关系');
      })()`,
      );
      await click(wc, '.rail button', '▦项目');
      await click(wc, '.home-page .section-heading button', '核对项目索引');
      await idle(wc);
      await click(wc, '.rail button', '◈总库');
      await waitFor(
        wc,
        "!!document.querySelector('.library-browser')",
        'global library',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelector('.library-scope-switch button.active')?.textContent==='全局总库'",
        ),
        'the library opens with an explicit global scope',
      );
      await input(wc, '[aria-label="搜索全局库"]', '关联标题验收入口');
      await waitFor(
        wc,
        "document.querySelector('.library-main .resource-card-body strong')?.textContent==='关联标题验收入口'",
        'anchor card',
      );
      await evaluate(
        wc,
        "document.querySelector('.library-main .resource-card-body').click()",
      );
      await waitFor(
        wc,
        "document.querySelector('.related-title')?.textContent===window.__target.text",
        'off-page relation title',
      );
      assert(
        await evaluate(
          wc,
          "!(await window.watercut.readLibrary({limit:100})).ideas.some(i=>i.id===window.__target.id)&&document.querySelector('.related-title').textContent===window.__target.text",
        ),
        'confirmed relations show titles even when the related card is outside the loaded page',
      );
      await evaluate(
        wc,
        "document.querySelector('.related-title').scrollIntoView({block:'center'})",
      );
      await capture(wc, '01-relation-title.png');
      await evaluate(wc, "document.querySelector('.related-title').click()");
      await waitFor(
        wc,
        "document.querySelector('.inspector .idea-form textarea')?.value===window.__target.text",
        'navigate related title',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelector('.inspector .idea-form textarea').value===window.__target.text",
        ),
        'a confirmed relation title opens the linked card',
      );
      await click(wc, '.inspector .section-heading button', '关闭');
      await click(wc, '.library-main .section-heading button', '+ 记录灵感');
      await input(wc, '.modal .idea-form textarea', '色环验收：蓝色情绪');
      await input(wc, '.modal .idea-form select', 'mood');
      await waitFor(
        wc,
        "!!document.querySelector('.modal .color-wheel')",
        'color wheel',
      );
      await evaluate(
        wc,
        "(()=>{const e=document.querySelector('.modal .color-wheel');e.scrollIntoView({block:'center'});e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Home'}));})()",
      );
      await waitFor(
        wc,
        "document.querySelector('.modal .color-wheel').getAttribute('aria-valuenow')==='0'",
        'keyboard Home',
      );
      await evaluate(
        wc,
        "document.querySelector('.modal .color-wheel').dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'ArrowRight',shiftKey:true}))",
      );
      await waitFor(
        wc,
        "document.querySelector('.modal .color-wheel').getAttribute('aria-valuenow')==='10'",
        'keyboard step',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelector('.modal .color-wheel').getAttribute('aria-valuenow')==='10'",
        ),
        'color hue supports keyboard selection with a ten-degree shift step',
      );
      const point = await evaluate(
        wc,
        "(()=>{const r=document.querySelector('.modal .color-wheel').getBoundingClientRect();return{x:Math.round(r.x+r.width*.92),y:Math.round(r.y+r.height/2)}})()",
      );
      wc.sendInputEvent({ type: 'mouseMove', ...point });
      wc.sendInputEvent({
        type: 'mouseDown',
        ...point,
        button: 'left',
        clickCount: 1,
      });
      await waitFor(
        wc,
        "Math.abs(Number(document.querySelector('.modal .color-wheel').getAttribute('aria-valuenow'))-90)<3",
        'native pointer hue',
      );
      assert(true, 'the color wheel accepts a native pointer selection');
      await evaluate(
        wc,
        "(()=>{const e=document.querySelector('.modal .color-wheel');e.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}));window.dispatchEvent(new Event('blur'));window.__cancelHue=e.getAttribute('aria-valuenow');})()",
      );
      wc.sendInputEvent({
        type: 'mouseMove',
        x: point.x - 40,
        y: point.y + 35,
      });
      wc.sendInputEvent({
        type: 'mouseUp',
        x: point.x - 40,
        y: point.y + 35,
        button: 'left',
        clickCount: 1,
      });
      await delay(100);
      assert(
        await evaluate(
          wc,
          "document.querySelector('.modal .color-wheel').getAttribute('aria-valuenow')===window.__cancelHue",
        ),
        'canceling or blurring a color drag releases its captured interaction',
      );
      await input(wc, '.modal [aria-label="颜色值"]', '#3388ee');
      await click(wc, '.modal .palette-editor button', '加入主色条');
      assert(
        await evaluate(
          wc,
          "document.querySelectorAll('.modal .palette-swatch').length===1",
        ),
        'the selected color is added to the mood palette',
      );
      await capture(wc, '02-color-wheel.png');
      await click(wc, '.modal .form-actions button', '保存编辑');
      await waitFor(
        wc,
        "!document.querySelector('.modal .idea-form')",
        'save palette',
      );
      await input(wc, '[aria-label="搜索全局库"]', '色环验收');
      await input(wc, '[aria-label="灵感颜色筛选"]', 'red');
      await waitFor(
        wc,
        "document.querySelector('.library-browser .pagination small')?.textContent.startsWith('0 项')",
        'red excludes blue',
      );
      await input(wc, '[aria-label="灵感颜色筛选"]', 'blue');
      await waitFor(
        wc,
        "document.querySelector('.library-main .resource-card-body strong')?.textContent==='色环验收：蓝色情绪'",
        'blue filter',
      );
      assert(
        await evaluate(
          wc,
          "(await window.watercut.readLibrary({color:'blue',search:'色环验收'})).ideas[0]?.payload.colors[0]==='#3388ee'",
        ),
        'grouped color filtering uses the saved palette and excludes other hues',
      );
      await evaluate(
        wc,
        "document.querySelector('.library-main .resource-card-body').click()",
      );
      await waitFor(
        wc,
        "!!document.querySelector('.inspector .color-wheel')",
        'inspector color wheel',
      );
      window.setSize(1000, 800);
      await evaluate(
        wc,
        "document.querySelector('.inspector .color-wheel').scrollIntoView({block:'center'})",
      );
      await delay(160);
      await capture(wc, '02b-color-wheel-inspector-1000.png');
      assert(
        await evaluate(
          wc,
          "document.querySelector('.inspector .palette-editor').scrollWidth<=document.querySelector('.inspector .palette-editor').clientWidth+1",
        ),
        'the color editor fits the narrow inspector without horizontal clipping',
      );
      window.setSize(1440, 940);
      await click(wc, '.inspector .section-heading button', '关闭');
      await click(wc, '.library-browser .segmented button', '素材');
      await waitFor(
        wc,
        "document.querySelectorAll('.library-main .resource-card').length===3",
        'global assets',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelectorAll('.library-main .resource-card').length===3",
        ),
        'global scope shows the global media collection',
      );

      await click(wc, '.library-scope-switch button', '项目库');
      await waitFor(
        wc,
        '!!document.querySelector(\'[aria-label="选择项目库"]\')',
        'project selector',
      );
      await input(
        wc,
        '[aria-label="选择项目库"]',
        await evaluate(wc, 'window.__b.directory'),
      );
      await waitFor(
        wc,
        "document.querySelector('.project-library-browser .resource-card strong')?.textContent==='B 项目专属灵感'",
        'B library',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelectorAll('.project-library-browser .resource-card').length===1",
        ),
        'project scope displays only the selected project ideas',
      );
      await evaluate(
        wc,
        "document.querySelector('.project-library-browser .resource-card-body').click()",
      );
      await waitFor(
        wc,
        "document.querySelector('.inspector .idea-form textarea')?.value==='B 项目专属灵感'",
        'B inspector',
      );
      await input(
        wc,
        '.inspector .idea-form textarea',
        'B 项目专属灵感：修改后',
      );
      await click(wc, '.inspector .form-actions button', '保存编辑');
      await idle(wc);
      assert(
        await evaluate(
          wc,
          "(await window.watercut.readProject(window.__b.directory)).ideas[0].text==='B 项目专属灵感：修改后'&&(await window.watercut.readProject(window.__dir)).ideas.every(i=>!i.text.includes('B 项目'))",
        ),
        'saving a browsed project changes that project without modifying the active studio',
      );
      await click(wc, '.project-library-browser .segmented button', '素材');
      await waitFor(
        wc,
        "document.querySelectorAll('.project-library-browser .resource-card').length===1",
        'B media',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelectorAll('.project-library-browser .resource-card').length===1",
        ),
        'project scope displays only the selected project media',
      );
      await capture(wc, '03-project-library.png');
      await input(
        wc,
        '[aria-label="选择项目库"]',
        await evaluate(wc, 'window.__dir'),
      );
      await waitFor(
        wc,
        "document.querySelectorAll('.project-library-browser .resource-card').length===3",
        'A media',
      );
      await click(wc, '.project-library-browser .segmented button', '灵感');
      await waitFor(
        wc,
        "document.querySelectorAll('.project-library-browser .resource-card').length===3",
        'A ideas',
      );
      await evaluate(
        wc,
        "document.querySelector('.project-library-browser .resource-card-body').click()",
      );
      await waitFor(
        wc,
        "!!document.querySelector('.inspector .idea-form textarea')",
        'A edit',
      );
      await input(
        wc,
        '.inspector .idea-form textarea',
        '工作室当前项目：总库内更新',
      );
      await click(wc, '.inspector .form-actions button', '保存编辑');
      await idle(wc);
      await click(wc, '.rail button', '▤工作室');
      await waitFor(
        wc,
        "document.querySelector('.header-title input')?.value===window.__a.name",
        'return A studio',
      );
      assert(
        await evaluate(
          wc,
          "[...document.querySelectorAll('.resources-sidebar .resource-card strong')].some(e=>e.textContent==='工作室当前项目：总库内更新')",
        ),
        'returning to the studio keeps the active project and refreshes its edits made in project-library browsing',
      );

      await click(wc, '.workflow button', '脚本');
      await click(wc, '.script-view .toolbar button', '+ 标题');
      await waitFor(
        wc,
        "document.querySelectorAll('.script-section-heading input').length===1&&document.querySelectorAll('.script-block').length===6",
        'new script section',
      );
      await input(
        wc,
        '.script-section-heading input',
        '第一组：开场的三个备选草稿',
      );
      await input(
        wc,
        '.script-section:last-child .script-block textarea',
        '草稿甲',
      );
      await click(
        wc,
        '.script-section:last-child .add-section-paragraph',
        '+ 草稿段落',
      );
      await waitFor(
        wc,
        "document.querySelectorAll('.script-section:last-child .script-block').length===2",
        'second draft',
      );
      await input(
        wc,
        '.script-section:last-child .script-block:last-child textarea',
        '草稿乙',
      );
      await evaluate(
        wc,
        'document.querySelector(\'.script-section:last-child .script-block:last-child [aria-label="上移段落"]\').click()',
      );
      await waitFor(
        wc,
        "document.querySelector('.script-section:last-child .script-block:first-child textarea')?.value==='草稿乙'",
        'move up paragraph',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelectorAll('.script-section:last-child .script-block').length===2&&document.querySelector('.script-section:last-child .script-block:first-child textarea').value==='草稿乙'",
        ),
        'a titled block owns multiple drafts, and paragraph buttons persist their order',
      );
      await click(wc, '.script-view .toolbar button', '+ 标题');
      await waitFor(
        wc,
        "document.querySelectorAll('.script-section-heading input').length===2",
        'second section',
      );
      await input(
        wc,
        '.script-section:last-child .script-section-heading input',
        '第二组：收尾',
      );
      await input(
        wc,
        '.script-section:last-child .script-block textarea',
        '结尾草稿',
      );
      await drag(
        wc,
        '.script-section:nth-child(2) .script-block [aria-label="拖动段落"]',
        '.script-section:nth-child(3) .script-block',
      );
      await waitFor(
        wc,
        "document.querySelectorAll('.script-section:last-child .script-block').length===2",
        'cross section drag',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelector('.script-section:last-child .script-block:first-child textarea')?.value==='草稿乙'",
        ),
        'dragging a paragraph between titled blocks changes its group without losing text',
      );
      await drag(
        wc,
        '.script-section:nth-child(3) .script-section-heading [draggable]',
        '.script-section:nth-child(2) .script-section-heading',
      );
      await waitFor(
        wc,
        "document.querySelector('.script-section-heading input')?.value==='第二组：收尾'",
        'section drag',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelectorAll('.script-section')[1].querySelectorAll('.script-block').length===2",
        ),
        'dragging a title moves its whole section with all drafts',
      );
      await capture(wc, '04-script-sections.png');
      window.setSize(1000, 800);
      await delay(200);
      await evaluate(
        wc,
        "document.querySelector('.script-section:last-child').scrollIntoView({block:'center'})",
      );
      await capture(wc, '05-script-sections-1000.png');
      assert(
        await evaluate(
          wc,
          "[...document.querySelectorAll('.script-section')].every(e=>e.scrollWidth<=e.clientWidth+1)",
        ),
        'script sections and reorder controls fit the supported narrow window',
      );
      window.setSize(1440, 940);
      await click(wc, '.workflow button', '分镜');
      await waitFor(
        wc,
        "document.querySelectorAll('.shot-tile').length===5",
        'storyboard',
      );
      await click(wc, '.resources-sidebar .section-heading button', '+ 灵感');
      await input(wc, '.modal .idea-form textarea', '手动挑选的另一张灵感');
      await click(wc, '.modal .form-actions button', '保存编辑');
      await waitFor(
        wc,
        "!document.querySelector('.modal .idea-form')",
        'new project inspiration',
      );
      await evaluate(wc, "document.querySelectorAll('.shot-tile')[4].click()");
      await waitFor(
        wc,
        '!!document.querySelector(\'[aria-label="添加灵感来源"]\')',
        'source select',
      );
      const sourceCount = await evaluate(
        wc,
        "document.querySelectorAll('.inspector .source-panel').length",
      );
      const ideaId = await evaluate(
        wc,
        'document.querySelector(\'[aria-label="添加灵感来源"] option:not([value=""])\')?.value',
      );
      assert(
        Boolean(ideaId),
        'unlinked project ideas are available as manual shot sources',
      );
      await input(wc, '[aria-label="添加灵感来源"]', ideaId);
      await waitFor(
        wc,
        `document.querySelectorAll('.inspector .source-panel').length===${sourceCount + 1}`,
        'added source',
      );
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readProject(window.__dir)).shotSources.some(s=>s.shotId===window.__a.shots[4].id&&s.ideaId===' +
            JSON.stringify(ideaId) +
            ')',
        ),
        'a shot can be manually linked to an inspiration card',
      );
      await evaluate(
        wc,
        "[...document.querySelectorAll('.inspector .source-panel')].find(e=>e.textContent.includes('手动挑选的另一张灵感')).querySelector('button').click()",
      );
      await waitFor(
        wc,
        `document.querySelectorAll('.inspector .source-panel').length===${sourceCount}`,
        'removed source',
      );
      assert(
        await evaluate(
          wc,
          '!(await window.watercut.readProject(window.__dir)).shotSources.some(s=>s.shotId===window.__a.shots[4].id&&s.ideaId===' +
            JSON.stringify(ideaId) +
            ')',
        ),
        'removing a manual source does not remove its inspiration card',
      );

      const assetIds = await evaluate(wc, 'window.__a.assets.map(a=>a.id)');
      // A pending dialogue edit makes onRun flush and rerender the controlled select.
      await input(wc, '.inspector textarea', '选择主画面前尚未保存的文字');
      await input(wc, '[aria-label="主画面"]', assetIds[0]);
      await waitFor(
        wc,
        `(await window.watercut.readProject(window.__dir)).shotAssets.some(b=>b.shotId===window.__a.shots[4].id&&b.assetId===${JSON.stringify(assetIds[0])})`,
        'first primary',
      );
      await waitFor(
        wc,
        `document.querySelector('[aria-label="主画面"]')?.value===${JSON.stringify(assetIds[0])}`,
        'primary selection rendered after save',
      );
      assert(
        await evaluate(
          wc,
          `document.querySelector('[aria-label="主画面"]').value===${JSON.stringify(assetIds[0])}`,
        ),
        'primary selection survives a pending automatic save and controlled-select rerender',
      );
      await input(wc, '[aria-label="主画面"]', assetIds[1]);
      await waitFor(
        wc,
        `(await window.watercut.readProject(window.__dir)).shotAssets.some(b=>b.shotId===window.__a.shots[4].id&&b.assetId===${JSON.stringify(assetIds[1])})`,
        'change primary',
      );
      assert(
        await evaluate(
          wc,
          `(await window.watercut.readProject(window.__dir)).shotCandidates.filter(c=>c.shotId===window.__a.shots[4].id).length===2`,
        ),
        'choosing other project media changes the primary and retains both candidates',
      );
      await idle(wc);
      await evaluate(
        wc,
        "document.querySelector('[aria-label=\"主画面\"]').scrollIntoView({block:'center'})",
      );
      await capture(wc, '06-primary-and-sources.png');
      await input(wc, '[aria-label="主画面"]', '');
      await waitFor(
        wc,
        '!(await window.watercut.readProject(window.__dir)).shotAssets.some(b=>b.shotId===window.__a.shots[4].id)',
        'clear primary',
      );
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readProject(window.__dir)).shotCandidates.filter(c=>c.shotId===window.__a.shots[4].id).length===2',
        ),
        'clearing the primary preserves candidates and media originals',
      );
      await input(wc, '[aria-label="主画面"]', assetIds[1]);
      await idle(wc);
      await click(wc, '.workflow button', '粗剪');
      const seek = await evaluate(
        wc,
        '(await window.watercut.readProject(window.__dir)).shots.slice(0,4).reduce((n,s)=>n+s.durationMs,0)',
      );
      await input(wc, '[aria-label="预览进度"]', String(seek));
      await waitFor(
        wc,
        'document.querySelector(".preview-screen img")?.src.includes(' +
          JSON.stringify(assetIds[1]) +
          ')',
        'updated image in preview',
      );
      assert(
        await evaluate(
          wc,
          'document.querySelector(".preview-screen img").src.includes(' +
            JSON.stringify(assetIds[1]) +
            ')',
        ),
        'rough-cut preview uses the newly selected primary image',
      );
      await click(wc, '.rail button', '▦项目');
      await click(wc, '.home-page .section-heading button', '核对项目索引');
      await idle(wc);
      await evaluate(
        wc,
        "[...document.querySelectorAll('.project-tile')].find(e=>e.querySelector('h3')?.textContent===window.__a.name).querySelector('button').click()",
      );
      await waitFor(wc, "!!document.querySelector('.workflow')", 'reopen');
      await click(wc, '.workflow button', '脚本');
      await waitFor(
        wc,
        "document.querySelectorAll('.script-section-heading input').length===2",
        'persisted groups',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelector('.script-section-heading input').value==='第二组：收尾'&&document.querySelectorAll('.script-section')[1].querySelector('.script-block textarea').value==='草稿乙'",
        ),
        'title, paragraph content and group order survive closing and reopening the project',
      );
      assert(
        !errors.some((e) =>
          /Uncaught|TypeError|ReferenceError|Maximum update/.test(e),
        ),
        'the patch workflow produces no renderer exceptions or update loops',
      );
      clearTimeout(watchdog);
      await finish(0);
    } catch (error) {
      try {
        await capture(wc, 'failure.png');
        const state = await evaluate(
          wc,
          `(async()=>({
          activeView:document.querySelector('.workflow button.active')?.textContent,
          project:document.querySelector('.header-title input')?.value,
          busy:document.querySelector('.header-title input')?.disabled,
          status:document.querySelector('.app-status')?.textContent,
          visibleHeadings:[...document.querySelectorAll('.script-section-heading input')].map(e=>e.value),
          storedHeadings:window.__dir?(await window.watercut.readProject(window.__dir)).scriptBlocks.filter(b=>b.kind==='heading').map(b=>b.text):[]
        }))()`,
        );
        fs.writeFileSync(
          path.join(output, 'failure-state.json'),
          JSON.stringify(state, null, 2),
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
    : path.join(root, '.vite', 'build', 'main.cjs'),
);
