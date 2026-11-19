// Native Electron regression: isolated data, real card clicks, and window close.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'watercut-ui-'));
const settings = { configVersion: 1, projectsRoot: path.join(temporary, 'projects'), libraryRoot: path.join(temporary, 'library') };
const userData = path.join(temporary, 'user');
fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'storage-settings.json'), JSON.stringify(settings));
app.setPath('userData', userData);
if (!process.argv.includes('--onscreen')) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('watercut-smoke');
}
const output = path.join(root, 'out', 'review-idea-close');
fs.mkdirSync(output, { recursive: true });
const checks = [], errors = [], expectedErrors = [];
let finished = false, stage = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function assert(value, message) {
  if (!value) throw new Error(message);
  checks.push(message);
  console.log('PASS ' + message);
}
async function evaluate(wc, code) { return wc.executeJavaScript(`(async()=>(${code}))()`, true); }
async function waitFor(check, label, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error('Timeout: ' + label + '\n' + errors.join('\n'));
}
async function click(wc, selector, text) {
  await waitFor(() => evaluate(wc, `[...document.querySelectorAll(${JSON.stringify(selector)})].some(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled)`), text);
  await evaluate(wc, `(()=>{[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click();return true})()`);
}
async function finish(code, error) {
  if (finished) return;
  finished = true;
  if (error) { errors.push(String(error.stack || error)); console.error(error); }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ checks, errors, expectedErrors, temporary }, null, 2));
  app.exit(code);
}
const watchdog = setTimeout(() => void finish(1, new Error('Card regression timed out')), 60000);
app.on('before-quit', event => { if (!finished) event.preventDefault(); });
app.on('web-contents-created', (_event, wc) => {
  wc.on('console-message', event => {
    if (event.level === 'error' && !event.message.includes('net::ERR')) (event.message.includes('Injected inspector failure') ? expectedErrors : errors).push(event.message);
  });
  wc.once('did-finish-load', async () => {
    if (!wc.getURL().includes('main_window')) return;
    const window = BrowserWindow.fromWebContents(wc);
    try {
      await waitFor(() => evaluate(wc, "!!document.querySelector('.home-intro')"), 'home');
      if (stage === 1) {
        const gone = new Promise(resolve => wc.once('render-process-gone', resolve));
        wc.forcefullyCrashRenderer();
        await gone;
        dialog.showMessageBox = async (_window, options) => {
          assert(options.buttons[0] === '继续等待' && options.defaultId === 0, 'crashed renderer offers a native dialog with a safe default');
          return { response: 1, checkboxChecked: false };
        };
        window.close();
        await waitFor(() => window.isDestroyed(), 'close after renderer crash');
        assert(window.isDestroyed(), 'native confirmed exit works after renderer failure');
        assert(fs.readFileSync(path.join(userData, 'renderer-errors.log'), 'utf8').includes('renderer'), 'renderer failure is recorded locally');
        clearTimeout(watchdog);
        await finish(0);
        return;
      }
      let localCopy;
      if (process.env.WATERCUT_REGRESSION_PROJECT) {
        // Optional local diagnosis. Never modify the original project.
        localCopy = path.join(settings.projectsRoot, 'copy.watercut');
        fs.cpSync(process.env.WATERCUT_REGRESSION_PROJECT, localCopy, { recursive: true });
      }
      const projectPath = await evaluate(wc, `(async()=>{let p=${localCopy ? `await window.watercut.readProject(${JSON.stringify(localCopy)})` : "await window.watercut.createProject('卡片回归')"};${localCopy ? '' : "for(const text of ['普通灵感一','普通灵感二','普通灵感三']) p=await window.watercut.addIdea(p.directory,text);"} p=await window.watercut.updateIdea(p.directory,p.ideas[0].id,{...p.ideas[0],occurredAt:'2026-11-19T00:00:00.000Z'}); window.__ideaDir=p.directory; return p.directory;})()`);
      await click(wc, '.home-page .section-heading button', '核对项目索引');
      await waitFor(() => evaluate(wc, "!!document.querySelector('.project-tile button')"), 'project tile');
      await evaluate(wc, "(()=>{document.querySelector('.project-tile button').click();return true})()");
      await waitFor(() => evaluate(wc, "document.querySelectorAll('.react-flow__node-idea').length===3"), 'three board cards');
      for (let i = 0; i < 3; i++) {
        const text = await evaluate(wc, `document.querySelectorAll('.resources-sidebar .resource-card-body strong')[${i}].textContent`);
        await evaluate(wc, `(()=>{document.querySelectorAll('.resources-sidebar .resource-card-body')[${i}].click();return true})()`);
        await waitFor(() => evaluate(wc, `document.querySelector('.inspector .idea-form textarea')?.value===${JSON.stringify(text)}`), 'resource sidebar editor ' + i);
        await delay(150);
        assert(await evaluate(wc, "!!document.querySelector('.workflow')&&!!document.querySelector('.inspector .idea-form')"), 'left resource card ' + (i + 1) + ' opens without blanking the workspace');
      }
      await click(wc, '.inspector .section-heading button', '关闭');
      for (let i = 0; i < 3; i++) {
        const point = await evaluate(wc, `(()=>{const r=document.querySelectorAll('.react-flow__node-idea .idea-node span')[${i}].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
        wc.sendInputEvent({ type: 'mouseMove', ...point });
        wc.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
        wc.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
        await waitFor(() => evaluate(wc, "!!document.querySelector('.inspector .idea-form')"), 'board card editor ' + i);
        await delay(500);
        assert(await evaluate(wc, "!!document.querySelector('.workflow')&&!!document.querySelector('.inspector .idea-form')"), 'board card ' + (i + 1) + ' remains usable after clicking');
        await click(wc, '.inspector .section-heading button', '关闭');
      }
      await click(wc, '.rail button', '◈总库');
      await evaluate(wc, "window.watercut.saveLibraryIdea({kind:'note',text:'总库测试',tags:'',notes:'',payload:{colors:[],rhythm:'',timeOfDay:'',weather:'',environment:'',location:'',props:''},occurredAt:null,media:[]})");
      await click(wc, '.rail button', '▦项目');
      await click(wc, '.rail button', '◈总库');
      await waitFor(() => evaluate(wc, "!!document.querySelector('.library-main .resource-card-body')"), 'library card');
      await evaluate(wc, "(()=>{document.querySelector('.library-main .resource-card-body').click();return true})()");
      await waitFor(() => evaluate(wc, "!!document.querySelector('.inspector .idea-form')"), 'library editor');
      assert(await evaluate(wc, "!!document.querySelector('.library-main')"), 'library card opens without a blank page');
      fs.writeFileSync(path.join(output, 'idea-editor.png'), (await wc.capturePage()).toPNG());
      assert(!errors.some(e => /Uncaught|TypeError|ReferenceError|Maximum update/.test(e)), 'card navigation produces no renderer errors');
      await click(wc, '.rail button', '▤工作室');
      await waitFor(() => evaluate(wc, "document.querySelectorAll('.react-flow__node-idea').length===3"), 'return to selected board');
      await delay(300);
      assert(await evaluate(wc, "document.querySelector('.board-view .section-heading button')?.textContent.includes('所选 1 张')"), 'returning to the studio preserves selection without an update loop');
      await evaluate(wc, "(()=>{document.querySelector('.resources-sidebar .resource-card input[type=checkbox]').click();return true})()");
      await waitFor(() => evaluate(wc, "document.querySelectorAll('.react-flow__node-idea.selected').length===2"), 'sidebar selection synchronizes to board');
      assert(await evaluate(wc, "document.querySelector('.board-view .section-heading button')?.textContent.includes('所选 2 张')"), 'sidebar selection and board selection stay consistent');
      await evaluate(wc, "(()=>{window.__originalISO=Date.prototype.toISOString;Date.prototype.toISOString=function(){throw new Error('Injected inspector failure')};document.querySelector('.resources-sidebar .resource-card-body').click();return true})()");
      await waitFor(() => evaluate(wc, "!!document.querySelector('.inspector .error-recovery')"), 'inspector recovery panel');
      assert(await evaluate(wc, "!!document.querySelector('.workflow')&&document.querySelectorAll('.resources-sidebar .resource-card').length===3"), 'an inspector rendering failure preserves the surrounding workspace');
      fs.writeFileSync(path.join(output, 'idea-recovery.png'), (await wc.capturePage()).toPNG());
      await evaluate(wc, "(()=>{Date.prototype.toISOString=window.__originalISO;return true})()");
      await click(wc, '.inspector .error-recovery button', '关闭详情');
      await evaluate(wc, "(()=>{document.querySelector('.resources-sidebar .resource-card-body').click();return true})()");
      await waitFor(() => evaluate(wc, "!!document.querySelector('.inspector .idea-form')"), 'edit before close');
      assert(await evaluate(wc, "!!document.querySelector('.inspector .idea-form')"), 'the same sidebar card can be reopened after recovery');
      await waitFor(() => fs.existsSync(path.join(userData, 'renderer-errors.log')) && fs.readFileSync(path.join(userData, 'renderer-errors.log'), 'utf8').includes('Injected inspector failure'), 'local error log');
      const savedNote = '关闭前的最后一次编辑';
      await evaluate(wc, `(()=>{const e=document.querySelectorAll('.inspector .idea-form textarea')[1];Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(savedNote)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
      window.close();
      await waitFor(() => window.isDestroyed(), 'native window close', 5000);
      assert(window.isDestroyed(), 'native close works after opening an idea card');
      assert(fs.existsSync(path.join(projectPath, 'project.sqlite')), 'project remains on disk after closing');
      const db = new DatabaseSync(path.join(projectPath, 'project.sqlite'), { readOnly: true });
      try { assert(db.prepare('SELECT count(*) AS n FROM ideas WHERE notes=?').get(savedNote).n === 1, 'closing flushes the last card edit before the debounce timer'); }
      finally { db.close(); }
      stage = 1;
      app.emit('activate');
    } catch (error) {
      if (!window.isDestroyed()) try { fs.writeFileSync(path.join(output, 'failure.png'), (await wc.capturePage()).toPNG()); } catch {}
      await finish(1, error);
    }
  });
});
require(process.argv.includes('--packaged') ? path.join(root, process.env.WATERCUT_SMOKE_OUT || 'out', 'WaterCut-win32-x64', 'resources', 'app.asar', '.vite', 'build', 'main.cjs') : path.join(root, '.vite', 'build', 'main.cjs'));
