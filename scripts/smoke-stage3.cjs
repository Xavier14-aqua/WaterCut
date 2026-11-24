const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const root = path.resolve(__dirname, '..'),
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'watercut-ui-'));
const settings = {
  configVersion: 1,
  projectsRoot: path.join(temporary, 'machine-a-projects'),
  libraryRoot: path.join(temporary, 'machine-a-library'),
};
const userData = path.join(temporary, 'user');
fs.mkdirSync(userData);
fs.writeFileSync(
  path.join(userData, 'storage-settings.json'),
  JSON.stringify(settings),
);
app.setPath('userData', userData);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('watercut-smoke');
const output = path.join(root, 'out', 'review-stage3');
fs.mkdirSync(output, { recursive: true });
const checks = [],
  errors = [];
let finished = false,
  saveTarget = '',
  openTarget = '',
  folderTarget = '';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(value, label) {
  if (!value) throw new Error(label);
  checks.push(label);
  console.log('PASS ' + label);
}
async function evaluate(wc, code) {
  return wc.executeJavaScript(`(async()=>(${code}))()`, true);
}
async function waitFor(wc, code, label, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(wc, code)) return;
    await delay(120);
  }
  throw new Error('Timeout: ' + label + '\n' + errors.join('\n'));
}
async function click(wc, selector, text) {
  await waitFor(
    wc,
    `[...document.querySelectorAll(${JSON.stringify(selector)})].some(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled)`,
    'button ' + text,
  );
  await evaluate(
    wc,
    `(()=>{[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click();return true})()`,
  );
}
async function input(wc, selector, value) {
  await evaluate(
    wc,
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input '+${JSON.stringify(selector)});const proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`,
  );
}
async function capture(wc, name) {
  fs.writeFileSync(path.join(output, name), (await wc.capturePage()).toPNG());
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
        temporary,
        electron: process.versions.electron,
        node: process.versions.node,
      },
      null,
      2,
    ),
  );
  app.exit(code);
}
const watchdog = setTimeout(
  () => void finish(1, new Error('Stage 3 smoke timed out')),
  180000,
);
dialog.showSaveDialog = async () => ({
  canceled: !saveTarget,
  filePath: saveTarget || undefined,
});
dialog.showOpenDialog = async (options) => ({
  canceled: false,
  filePaths: [
    options.properties?.includes('openDirectory') ? folderTarget : openTarget,
  ],
});
dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
app.on('web-contents-created', (_event, wc) => {
  wc.on('console-message', (event) => {
    if (event.level === 'error' && !event.message.includes('net::ERR'))
      errors.push(event.message);
  });
  wc.once('did-finish-load', async () => {
    if (!wc.getURL().includes('main_window')) return;
    try {
      await waitFor(wc, "!!document.querySelector('.home-intro')", 'home');
      await click(wc, '.home-intro button', '用官方示例体验一条故事 →');
      await waitFor(
        wc,
        "!!document.querySelector('.preview-screen')&&!document.querySelector('.app-status').textContent.includes('处理中')",
        'example',
      );
      await evaluate(
        wc,
        '(async()=>{window.confirm=()=>true;const page=await window.watercut.readLibrary();window.__original=await window.watercut.readProject(page.projects[0].directory);window.__dir=window.__original.directory;return true})()',
      );
      await click(wc, '.delivery-toggle', '版本与交付');
      await input(wc, '[aria-label="快照名称"]', 'V1 原始版');
      await click(wc, '.delivery-panel button', '创建快照');
      await waitFor(
        wc,
        "document.querySelectorAll('.revision-row').length===1",
        'first snapshot',
      );
      assert(
        await evaluate(
          wc,
          "(await window.watercut.listRevisions(window.__dir))[0].name==='V1 原始版'",
        ),
        'snapshot can be created from the delivery panel',
      );
      const fixture = path.join(temporary, 'probe-pattern.webm');
      fs.writeFileSync(
        fixture,
        Buffer.from(
          fs
            .readFileSync(
              path.join(root, 'scripts/fixtures/test-pattern.webm.base64'),
              'utf8',
            )
            .trim(),
          'base64',
        ),
      );
      openTarget = fixture;
      await evaluate(
        wc,
        "(async()=>{const page=await window.watercut.importLibraryAssets();window.__video=page.assets.find(a=>a.kind==='video');await window.watercut.attachLibraryAssets(window.__dir,[window.__video.id]);return true})()",
      );
      const metadata = await evaluate(wc, 'window.__video.metadata');
      if (metadata?.status !== 'ready')
        console.error('Probe diagnostic: ' + JSON.stringify(metadata));
      assert(
        await evaluate(
          wc,
          "window.__video.metadata?.status==='ready'&&window.__video.metadata.streams.some(s=>s.type==='video')&&window.__video.metadata.durationMs>1000",
        ),
        'bundled MediaInfo probes real video offline from app.asar',
      );
      await evaluate(
        wc,
        "(async()=>{const p=await window.watercut.readProject(window.__dir);await window.watercut.updateShot(p.directory,p.shots[0].id,{...p.shots[0],actionDialogue:'长对白验收。'.repeat(180)+'结尾校验-END',description:'安全文本 <script>unexpected()</script> & 参考画面'});return true})()",
      );
      await click(wc, '.delivery-panel button', '探测项目素材');
      await waitFor(
        wc,
        "!document.querySelector('.delivery-task')",
        'project metadata',
        40000,
      );
      assert(
        await evaluate(
          wc,
          "(await window.watercut.readProject(window.__dir)).assets.filter(a=>a.kind==='image').every(a=>a.metadata?.status==='ready'&&a.metadata.width===640&&a.metadata.height===360)",
        ),
        'image dimensions and probe status persist to the project',
      );
      await input(wc, '[aria-label="快照名称"]', 'V2 长对白');
      await click(wc, '.delivery-panel button', '创建快照');
      await waitFor(
        wc,
        "document.querySelectorAll('.revision-row').length===2",
        'second snapshot',
      );
      await evaluate(
        wc,
        "(()=>{[...document.querySelectorAll('.revision-row')].find(e=>e.textContent.includes('V1 原始版')).querySelector('button').click();return true})()",
      );
      await waitFor(
        wc,
        "document.querySelectorAll('.revision-row').length===3&&!document.querySelector('.delivery-task')",
        'snapshot restore',
      );
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readProject(window.__dir)).shots[0].actionDialogue===window.__original.shots[0].actionDialogue',
        ),
        'restoring a snapshot replaces the editing state',
      );
      assert(
        await evaluate(
          wc,
          '(await window.watercut.listRevisions(window.__dir)).some(r=>r.automatic)',
        ),
        'restore automatically saves the previous state',
      );
      await evaluate(
        wc,
        "(()=>{[...document.querySelectorAll('.revision-row')].find(e=>e.textContent.includes('V2 长对白')).querySelector('button').click();return true})()",
      );
      await waitFor(
        wc,
        "document.querySelectorAll('.revision-row').length===4&&!document.querySelector('.delivery-task')",
        'restore long version',
      );
      saveTarget = path.join(temporary, 'shared.watercut.zip');
      await click(wc, '.delivery-panel button', '导出项目包 ZIP');
      await waitFor(
        wc,
        "document.querySelector('.delivery-success')?.textContent.includes('完整项目包已导出')",
        'complete package',
        40000,
      );
      assert(
        fs.existsSync(saveTarget) && fs.statSync(saveTarget).size > 1000,
        'full project package exports through the native save dialog',
      );
      await capture(wc, '01-delivery.png');
      saveTarget = path.join(output, 'storyboard-landscape.pdf');
      await click(wc, '.delivery-panel button', '导出 PDF');
      await waitFor(
        wc,
        "[...document.querySelectorAll('.delivery-success')].some(e=>e.textContent.includes('storyboard-landscape.pdf'))",
        'landscape PDF',
        50000,
      );
      assert(
        fs.readFileSync(saveTarget).subarray(0, 5).toString() === '%PDF-',
        'landscape PDF is generated by the packaged application',
      );
      await evaluate(
        wc,
        "(()=>{const labels=[...document.querySelectorAll('.delivery-panel label')];labels.find(e=>e.textContent.includes('A4 横版')).querySelector('input').click();return true})()",
      );
      await delay(150);
      saveTarget = path.join(output, 'storyboard-portrait.pdf');
      await click(wc, '.delivery-panel button', '导出 PDF');
      await waitFor(
        wc,
        "[...document.querySelectorAll('.delivery-success')].some(e=>e.textContent.includes('storyboard-portrait.pdf'))",
        'portrait PDF',
        50000,
      );
      assert(
        fs.statSync(saveTarget).size > 10000,
        'portrait PDF exports long Chinese dialogue',
      );
      await evaluate(
        wc,
        "(()=>{[...document.querySelectorAll('.delivery-panel label')].find(e=>e.textContent.includes('仅导出待拍')).querySelector('input').click();return true})()",
      );
      await delay(150);
      saveTarget = path.join(output, 'shot-list.pdf');
      await click(wc, '.delivery-panel button', '导出 PDF');
      await waitFor(
        wc,
        "[...document.querySelectorAll('.delivery-success')].some(e=>e.textContent.includes('shot-list.pdf'))",
        'shot list PDF',
        50000,
      );
      assert(
        fs.statSync(saveTarget).size > 10000,
        'shot list PDF shares the storyboard export data',
      );
      await click(wc, '.delivery-panel .section-heading button', '关闭');
      await click(wc, '.rail button', '⚙存储');
      folderTarget = path.join(temporary, 'machine-b-projects');
      fs.mkdirSync(folderTarget);
      await evaluate(
        wc,
        "(()=>{document.querySelectorAll('.storage-row button')[0].click();return true})()",
      );
      await waitFor(
        wc,
        `(await window.watercut.getStorageSettings()).projectsRoot===${JSON.stringify(folderTarget)}`,
        'new project root',
      );
      folderTarget = path.join(temporary, 'machine-b-empty-library');
      fs.mkdirSync(folderTarget);
      await waitFor(
        wc,
        "!document.querySelector('.app-status').textContent.includes('处理中')",
        'settings save',
      );
      await evaluate(
        wc,
        "(()=>{document.querySelectorAll('.storage-row button')[1].click();return true})()",
      );
      await waitFor(
        wc,
        `(await window.watercut.getStorageSettings()).libraryRoot===${JSON.stringify(folderTarget)}`,
        'empty library root',
      );
      await waitFor(
        wc,
        "!document.querySelector('.app-status').textContent.includes('处理中')",
        'library switch',
      );
      await click(wc, '.modal .section-heading button', '关闭');
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readLibrary()).totalAssets===0',
        ),
        'destination environment has an empty independent library',
      );
      await click(wc, '.rail button', '▦项目');
      openTarget = path.join(temporary, 'shared.watercut.zip');
      await click(wc, '.home-intro button', '导入项目包');
      await waitFor(
        wc,
        "document.querySelectorAll('.react-flow__node-idea').length===3&&!document.querySelector('.app-status').textContent.includes('处理中')",
        'independent import',
        40000,
      );
      await evaluate(
        wc,
        '(async()=>{const page=await window.watercut.readLibrary();window.__imported=await window.watercut.readProject(page.projects[0].directory);return true})()',
      );
      assert(
        await evaluate(
          wc,
          "window.__imported.id!==window.__original.id&&window.__imported.assets.every(a=>a.storageKind==='local'&&!a.sourceLibraryId&&!a.missing)",
        ),
        'import creates a new identity and all media resolve locally',
      );
      assert(
        await evaluate(
          wc,
          '(await window.watercut.listRevisions(window.__imported.directory)).length===4',
        ),
        'project history travels with the independent package',
      );
      await click(wc, '.workflow button', '粗剪');
      await waitFor(
        wc,
        "document.querySelector('.preview-screen img')?.naturalWidth>0",
        'independent image preview',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelector('.preview-screen img').naturalWidth===640",
        ),
        'imported project previews media without the source library',
      );
      await capture(wc, '02-independent-preview.png');
      assert(
        errors.length === 0,
        'stage 3 interactions have no renderer errors',
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
        'WaterCut-win32-x64/resources/app.asar/.vite/build/main.cjs',
      )
    : path.join(root, '.vite/build/main.cjs'),
);
