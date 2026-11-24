// Native regression for v1.3.2; no user projects or libraries are opened.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const root = path.resolve(__dirname, '../..'),
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'watercut-ui-')),
  userData = path.join(temporary, 'user');
fs.mkdirSync(userData);
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
const output = path.join(root, 'out', 'review-organization');
fs.mkdirSync(output, { recursive: true });
const checks = [],
  errors = [];
let finished = false;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(value, message) {
  if (!value) throw Error(message);
  checks.push(message);
  console.log('PASS ' + message);
}
async function evaluate(wc, source) {
  const result = await wc.executeJavaScript(
    `(async()=>{try{const r=await (${source});return r instanceof Node?true:r;}catch(e){return{__error:e.message,stack:e.stack};}})()`,
    true,
  );
  if (result?.__error) throw Error(result.__error + '\n' + result.stack);
  return result;
}
async function waitFor(wc, source, label, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(wc, source)) return;
    await delay(100);
  }
  throw Error(
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
    `[...document.querySelectorAll(${JSON.stringify(selector)})].some(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.matches(':disabled'))`,
    'button ' + text,
  );
  await evaluate(
    wc,
    `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`,
  );
}
async function input(wc, selector, value) {
  await waitFor(
    wc,
    `!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).matches(':disabled')`,
    'input ' + selector,
  );
  await evaluate(
    wc,
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),proto=e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
}
async function selectCard(wc, scope, text) {
  await waitFor(
    wc,
    `[...document.querySelectorAll(${JSON.stringify(scope + ' .resource-card')})].some(e=>e.querySelector('strong')?.textContent===${JSON.stringify(text)})`,
    'card ' + text,
  );
  await evaluate(
    wc,
    `[...document.querySelectorAll(${JSON.stringify(scope + ' .resource-card')})].find(e=>e.querySelector('strong')?.textContent===${JSON.stringify(text)}).querySelector('input[type=checkbox]').click()`,
  );
}
async function openBox(wc, id) {
  await waitFor(
    wc,
    `!!document.querySelector('[data-box-id="${id}"]')&&!document.querySelector('[data-box-id="${id}"]').disabled`,
    'box ' + id,
  );
  await evaluate(wc, `document.querySelector('[data-box-id="${id}"]').click()`);
}
async function capture(wc, name) {
  fs.writeFileSync(path.join(output, name), (await wc.capturePage()).toPNG());
}
async function finish(code, error) {
  if (finished) return;
  finished = true;
  if (error) {
    console.error(error);
    errors.push(String(error.stack || error));
  }
  fs.writeFileSync(
    path.join(output, 'report.json'),
    JSON.stringify({ checks, errors, temporary }, null, 2),
  );
  app.exit(code);
}
const watchdog = setTimeout(
  () => void finish(1, Error('Idea boxes regression timed out')),
  150000,
);
app.on('web-contents-created', (_event, wc) => {
  wc.on('console-message', (e) => {
    if (e.level === 'error' && !e.message.includes('net::ERR'))
      errors.push(e.message);
  });
  wc.once('did-finish-load', async () => {
    if (!wc.getURL().includes('main_window')) return;
    try {
      const window = BrowserWindow.fromWebContents(wc);
      await waitFor(wc, "!!document.querySelector('.home-intro')", 'home');
      await evaluate(
        wc,
        `(async()=>{window.confirm=()=>true;const api=window.watercut,payload={colors:[],rhythm:'',timeOfDay:'',weather:'',environment:'',location:'',props:''};const make=(text,kind)=>({text,kind,tags:'收纳验收',notes:'',payload:{...payload,colors:kind==='mood'?['#3388ee']:[]},occurredAt:null,media:[]});
    let a=await api.createProject('项目 A：收纳验收');for(const kind of ['note','mood','scene'])a=await api.createIdea(a.directory,make('项目 '+kind,kind));window.__a=a;
    let b=await api.createProject('项目 B：隔离验证');b=await api.createIdea(b.directory,make('其他项目卡片','note'));window.__b=b;
    window.__global=[];for(const kind of ['note','mood','scene'])window.__global.push(await api.saveLibraryIdea(make('全局 '+kind,kind)));
   })()`,
      );
      await click(wc, '.home-page .section-heading button', '核对项目索引');
      await waitFor(
        wc,
        "[...document.querySelectorAll('.project-tile')].some(e=>e.querySelector('h3')?.textContent===window.__a.name&&!e.querySelector('button').disabled)",
        'A catalog',
      );
      await evaluate(
        wc,
        "[...document.querySelectorAll('.project-tile')].find(e=>e.querySelector('h3')?.textContent===window.__a.name).querySelector('button').click()",
      );
      await waitFor(
        wc,
        "document.querySelectorAll('.react-flow__node-idea').length===3",
        'A board',
      );
      await click(wc, '.rail button', '◈总库');
      await waitFor(
        wc,
        "!!document.querySelector('.idea-layout-switch')",
        'layout controls',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelector('.idea-layout-switch button.active')?.textContent==='全部平铺'",
        ),
        'global library initially offers a flat list of all card types',
      );
      await click(wc, '.idea-layout-switch button', '收纳盒与未收纳');
      await input(wc, '[aria-label="新收纳盒名称"]', '全局盒一');
      await click(wc, '.idea-box-form button', '新建收纳盒');
      await waitFor(
        wc,
        "document.querySelectorAll('.idea-box').length===1",
        'first box',
      );
      await input(wc, '[aria-label="新收纳盒名称"]', '全局盒二');
      await click(wc, '.idea-box-form button', '新建收纳盒');
      await waitFor(
        wc,
        "document.querySelectorAll('.idea-box').length===2",
        'second box',
      );
      const boxIds = await evaluate(
        wc,
        '(await window.watercut.readLibrary()).ideaBoxes.map(b=>b.id)',
      );
      assert(
        boxIds.length === 2,
        'global idea boxes can be created from the library interface',
      );
      await selectCard(wc, '.library-main', '全局 note');
      await selectCard(wc, '.library-main', '全局 mood');
      await input(wc, '[aria-label="所选灵感收纳到"]', boxIds[0]);
      await click(wc, '.idea-box-batch button', '收纳所选');
      await waitFor(
        wc,
        "document.querySelectorAll('.library-main .resource-card').length===1",
        'remaining unfiled card',
      );
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readLibrary()).ideas.filter(i=>i.boxId).length===2',
        ),
        'notes and mood cards can be manually boxed together',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelector('.library-main .resource-card strong')?.textContent==='全局 scene'",
        ),
        'boxed overview displays only cards that are still unfiled',
      );
      await evaluate(
        wc,
        `(()=>{const from=document.querySelector('.library-main .resource-card'),to=document.querySelector('[data-box-id="${boxIds[1]}"]'),dt=new DataTransfer();from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));to.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));from.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));})()`,
      );
      await waitFor(
        wc,
        "document.querySelectorAll('.library-main .resource-card').length===0",
        'scene drag',
      );
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readLibrary()).ideas.every(i=>i.boxId!==null)',
        ),
        'dragging a scene card into a box persists its membership',
      );
      await openBox(wc, boxIds[0]);
      await waitFor(
        wc,
        "document.querySelectorAll('.library-main .resource-card').length===2",
        'box contents',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelector('.idea-box-breadcrumb strong')?.textContent==='全局盒一'",
        ),
        'opening a box shows its own cards and a return path',
      );
      await input(wc, '[aria-label="搜索全局库"]', '全局 note');
      await waitFor(
        wc,
        "document.querySelectorAll('.library-main .resource-card').length===1",
        'search inside box',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelector('.library-main .resource-card strong')?.textContent==='全局 note'",
        ),
        'search continues to filter inside the opened box',
      );
      await input(wc, '[aria-label="搜索全局库"]', '');
      await input(wc, '[aria-label="灵感颜色筛选"]', 'blue');
      await waitFor(
        wc,
        "document.querySelector('.library-main .resource-card strong')?.textContent==='全局 mood'&&document.querySelectorAll('.library-main .resource-card').length===1",
        'color inside box',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelector('.idea-box-breadcrumb small')?.textContent.startsWith('1 张')",
        ),
        'color filtering updates the box count before pagination',
      );
      await input(wc, '[aria-label="灵感颜色筛选"]', '');
      await click(wc, '.idea-layout-switch button', '全部平铺');
      await waitFor(
        wc,
        "document.querySelectorAll('.library-main .resource-card').length===3",
        'all flat cards',
      );
      assert(
        true,
        'flat view includes every card regardless of its box membership',
      );
      await selectCard(wc, '.library-main', '全局 note');
      await input(wc, '[aria-label="所选灵感收纳到"]', boxIds[1]);
      await click(wc, '.idea-box-batch button', '收纳所选');
      await waitFor(
        wc,
        `(await window.watercut.readLibrary({boxId:${JSON.stringify(boxIds[1])}})).totalIdeas===2`,
        'move between boxes',
      );
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readLibrary()).ideas.length===3',
        ),
        'moving a card to another box preserves one card and one membership',
      );
      await click(wc, '.idea-layout-switch button', '收纳盒与未收纳');
      await openBox(wc, boxIds[1]);
      await waitFor(
        wc,
        "document.querySelectorAll('.library-main .resource-card').length===2",
        'second box content',
      );
      await selectCard(wc, '.library-main', '全局 note');
      await click(wc, '.idea-box-batch button', '移出收纳盒');
      await waitFor(
        wc,
        "document.querySelectorAll('.library-main .resource-card').length===1",
        'unfile note',
      );
      assert(
        await evaluate(
          wc,
          "(await window.watercut.readLibrary({boxId:null})).ideas[0]?.text==='全局 note'",
        ),
        'a card can be moved out of a box without deleting it',
      );
      await click(wc, '.idea-box-form button', '删除收纳盒');
      await waitFor(
        wc,
        "document.querySelectorAll('.idea-box').length===1",
        'delete second box',
      );
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readLibrary({boxId:null})).totalIdeas===2&&(await window.watercut.readLibrary()).totalIdeas===3',
        ),
        'deleting a global box releases its cards into the unfiled list',
      );
      await openBox(wc, boxIds[0]);
      const longName = '雨夜｜开场的几种可能性，等有空再来挑选（2026）';
      await input(wc, '[aria-label="收纳盒名称"]', longName);
      await click(wc, '.idea-box-form button', '重命名');
      await waitFor(
        wc,
        `document.querySelector('.idea-box-breadcrumb strong')?.textContent===${JSON.stringify(longName)}`,
        'renamed box',
      );
      assert(
        await evaluate(
          wc,
          `(await window.watercut.readLibrary()).ideaBoxes[0].name===${JSON.stringify(longName)}`,
        ),
        'box renaming persists long Chinese titles',
      );
      await click(wc, '.idea-box-breadcrumb button', '全部收纳盒');
      await waitFor(
        wc,
        "document.querySelectorAll('.library-main .resource-card').length===2&&!document.querySelector('.idea-layout-switch button.active').disabled",
        'settled overview',
      );
      await evaluate(
        wc,
        "document.querySelector('.idea-organization').scrollIntoView({block:'start'})",
      );
      await delay(160);
      await capture(wc, '01-global-boxes.png');
      window.setSize(1000, 800);
      await delay(160);
      await capture(wc, '02-global-boxes-1000.png');
      assert(
        await evaluate(
          wc,
          "document.querySelector('.idea-organization').scrollWidth<=document.querySelector('.idea-organization').clientWidth+1",
        ),
        'box names and collection controls fit a 1000-pixel window',
      );
      window.setSize(1440, 940);

      await click(wc, '.library-scope-switch button', '项目库');
      await input(
        wc,
        '[aria-label="选择项目库"]',
        await evaluate(wc, 'window.__a.directory'),
      );
      await waitFor(
        wc,
        "document.querySelectorAll('.project-library-browser .resource-card').length===3",
        'project cards',
      );
      await click(wc, '.idea-layout-switch button', '收纳盒与未收纳');
      assert(
        await evaluate(wc, "document.querySelectorAll('.idea-box').length===0"),
        'project scope has its own boxes separate from the global library',
      );
      await input(wc, '[aria-label="新收纳盒名称"]', '项目盒');
      await click(wc, '.idea-box-form button', '新建收纳盒');
      await waitFor(
        wc,
        "document.querySelectorAll('.idea-box').length===1",
        'project box',
      );
      const projectBox = await evaluate(
        wc,
        '(await window.watercut.readProject(window.__a.directory)).ideaBoxes[0].id',
      );
      await selectCard(wc, '.project-library-browser', '项目 note');
      await selectCard(wc, '.project-library-browser', '项目 mood');
      await input(wc, '[aria-label="所选灵感收纳到"]', projectBox);
      await click(wc, '.idea-box-batch button', '收纳所选');
      await waitFor(
        wc,
        "document.querySelectorAll('.project-library-browser .resource-card').length===1",
        'project unfiled',
      );
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readProject(window.__a.directory)).ideas.filter(i=>i.boxId).length===2',
        ),
        'project cards support the same mixed-type batch collection',
      );
      await evaluate(
        wc,
        `(()=>{const from=document.querySelector('.project-library-browser .resource-card'),to=document.querySelector('[data-box-id="${projectBox}"]'),dt=new DataTransfer();from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));to.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));})()`,
      );
      await waitFor(
        wc,
        "document.querySelectorAll('.project-library-browser .resource-card').length===0",
        'project drag',
      );
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readProject(window.__a.directory)).ideas.every(i=>i.boxId!==null)&&(await window.watercut.readLibrary()).ideas.filter(i=>i.boxId).length===1',
        ),
        'project drag collection does not alter global memberships',
      );
      await evaluate(
        wc,
        `(()=>{const to=document.querySelector('[data-box-id="${projectBox}"]'),dt=new DataTransfer();dt.setData('application/x-watercut',JSON.stringify({scope:'project',scopeId:window.__b.id,kind:'idea',id:window.__b.ideas[0].id}));to.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));})()`,
      );
      await delay(150);
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readProject(window.__b.directory)).ideas[0].boxId===null',
        ),
        'a drag from another project cannot move a foreign card',
      );
      await openBox(wc, projectBox);
      await waitFor(
        wc,
        "document.querySelectorAll('.project-library-browser .resource-card').length===3",
        'project box contents',
      );
      await evaluate(
        wc,
        `(()=>{const from=[...document.querySelectorAll('.project-library-browser .resource-card')].find(e=>e.querySelector('strong').textContent==='项目 note'),to=document.querySelector('.unfiled-heading'),dt=new DataTransfer();from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));to.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));})()`,
      );
      await waitFor(
        wc,
        "document.querySelectorAll('.project-library-browser .resource-card').length===2",
        'project drag out',
      );
      assert(
        await evaluate(
          wc,
          "!!document.querySelector('.idea-box-breadcrumb')&&(await window.watercut.readProject(window.__a.directory)).ideas.find(i=>i.text==='项目 note').boxId===null",
        ),
        'dragging a card out of a project box saves its membership and keeps the opened box',
      );
      await capture(wc, '03-project-box-content.png');
      await click(wc, '.idea-box-form button', '删除收纳盒');
      await waitFor(
        wc,
        "document.querySelectorAll('.project-library-browser .resource-card').length===3",
        'delete project box',
      );
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readProject(window.__a.directory)).ideas.every(i=>i.boxId===null)',
        ),
        'deleting a project box keeps every inspiration card',
      );
      await input(wc, '[aria-label="新收纳盒名称"]', '持久化收纳盒');
      await click(wc, '.idea-box-form button', '新建收纳盒');
      await waitFor(
        wc,
        "document.querySelectorAll('.idea-box').length===1",
        'persistent box',
      );
      const persistent = await evaluate(
        wc,
        '(await window.watercut.readProject(window.__a.directory)).ideaBoxes[0].id',
      );
      await selectCard(wc, '.project-library-browser', '项目 mood');
      await input(wc, '[aria-label="所选灵感收纳到"]', persistent);
      await click(wc, '.idea-box-batch button', '收纳所选');
      await waitFor(
        wc,
        "document.querySelectorAll('.project-library-browser .resource-card').length===2",
        'persistent membership',
      );
      await input(
        wc,
        '[aria-label="选择项目库"]',
        await evaluate(wc, 'window.__b.directory'),
      );
      await waitFor(
        wc,
        "document.querySelector('.project-library-browser .resource-card strong')?.textContent==='其他项目卡片'",
        'B browse',
      );
      assert(
        await evaluate(wc, "document.querySelectorAll('.idea-box').length===0"),
        'switching project libraries does not carry boxes into another project',
      );
      await click(wc, '.rail button', '▤工作室');
      await waitFor(
        wc,
        "document.querySelectorAll('.react-flow__node-idea').length===3",
        'unchanged board',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelector('.header-title input')?.value===window.__a.name",
        ),
        'organizing another project library keeps the current studio and board intact',
      );
      const savedDirectory = await evaluate(wc, 'window.__a.directory');
      await new Promise((resolve) => {
        wc.once('did-finish-load', resolve);
        wc.reload();
      });
      await waitFor(
        wc,
        "!!document.querySelector('.home-intro')",
        'reloaded home',
      );
      await evaluate(wc, '(()=>{window.confirm=()=>true;return true;})()');
      await click(wc, '.rail button', '◈总库');
      await waitFor(
        wc,
        "document.querySelector('.idea-layout-switch button.active')?.textContent==='收纳盒与未收纳'&&document.querySelectorAll('.idea-box').length===1",
        'remembered global mode',
      );
      assert(
        await evaluate(
          wc,
          `document.querySelector('.idea-box span')?.textContent===${JSON.stringify(longName)}`,
        ),
        'global boxes, names and display mode survive an application reload',
      );
      await click(wc, '.library-scope-switch button', '项目库');
      await input(wc, '[aria-label="选择项目库"]', savedDirectory);
      await waitFor(
        wc,
        "document.querySelector('.idea-layout-switch button.active')?.textContent==='收纳盒与未收纳'&&document.querySelectorAll('.project-library-browser .resource-card').length===2",
        'remembered project mode',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelector('.idea-box span')?.textContent==='持久化收纳盒'",
        ),
        'project boxes, memberships and display mode also survive a reload',
      );
      assert(
        !errors.length,
        'collection navigation and rendering produce no renderer errors',
      );
      clearTimeout(watchdog);
      await finish(0);
    } catch (error) {
      try {
        await capture(wc, 'failure.png');
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
