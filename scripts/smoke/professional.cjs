// Synthetic data only. Never opens the user's library or an existing Jianying draft.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..'),
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'watercut-ui-')),
  userData = path.join(temporary, 'user'),
  settings = {
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
app.commandLine.appendSwitch('mute-audio');
const output = path.join(root, 'out', 'review-professional');
fs.mkdirSync(output, { recursive: true });
const checks = [],
  errors = [];
let finished = false,
  openTarget = '',
  saveTarget = '',
  folderTarget = output;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const {
  installPreviewDiagnostics,
  previewDiagnostics,
} = require('./playback-diagnostics.cjs');
let lastPlayback = null;
async function playbackState(wc) {
  lastPlayback = await evaluate(wc, `(${previewDiagnostics.toString()})()`);
  const text = JSON.stringify(lastPlayback, null, 2);
  fs.writeFileSync(path.join(output, 'playback-diagnostics.json'), text);
  fs.writeFileSync(
    path.join(
      output,
      `playback-${process.env.WATERCUT_BGM_SCENARIO || 'normal'}${process.argv.includes('--bgm-only') ? '-repeat' : ''}.json`,
    ),
    text,
  );
  return lastPlayback;
}
function assert(value, label) {
  if (!value) throw new Error(label);
  checks.push(label);
  console.log('PASS ' + label);
}
async function evaluate(wc, source) {
  return wc.executeJavaScript(`(async()=>(${source}))()`, true);
}
async function waitFor(wc, source, label, timeout = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(wc, source)) return;
    await delay(100);
  }
  const playback = await playbackState(wc);
  console.error('PLAYBACK_DIAGNOSTICS ' + JSON.stringify(playback));
  throw new Error(
    'Timeout: ' +
      label +
      ' ' +
      (await evaluate(
        wc,
        "document.querySelector('.app-status')?.textContent",
      )) +
      ' ' +
      errors.join('\n'),
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
    `(()=>{[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click();return true})()`,
  );
}
async function input(wc, selector, value) {
  await waitFor(
    wc,
    `!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`,
    'input ' + selector,
  );
  await evaluate(
    wc,
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing '+${JSON.stringify(selector)});const proto=e instanceof HTMLSelectElement?HTMLSelectElement.prototype:e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`,
  );
  await delay(80);
}
async function idle(wc) {
  await waitFor(
    wc,
    "!document.querySelector('.app-status')?.textContent.includes('处理中')",
    'save complete',
  );
  await delay(120);
}
async function capture(wc, name) {
  fs.writeFileSync(path.join(output, name), (await wc.capturePage()).toPNG());
}
async function finish(code, error) {
  if (finished) return;
  finished = true;
  clearTimeout(watchdog);
  if (error) errors.push(String(error.stack || error));
  const text = JSON.stringify(
    {
      checks,
      errors,
      temporary,
      playback: lastPlayback,
      nativeJianyingImport:
        'NOT RUN BY SMOKE: see separate native acceptance record',
      electron: process.versions.electron,
    },
    null,
    2,
  );
  fs.writeFileSync(path.join(output, 'report.json'), text);
  fs.writeFileSync(
    path.join(
      output,
      `report-${process.env.WATERCUT_BGM_SCENARIO || 'normal'}${process.argv.includes('--bgm-only') ? '-repeat' : ''}.json`,
    ),
    text,
  );
  if (error) console.error(error);
  app.exit(code);
}
const watchdog = setTimeout(
  () => void finish(1, new Error('Stage 4A smoke timed out')),
  230000,
);
dialog.showOpenDialog = async (options) => ({
  canceled: false,
  filePaths: [
    options.properties.includes('openDirectory') ? folderTarget : openTarget,
  ],
});
dialog.showSaveDialog = async () => ({ canceled: false, filePath: saveTarget });
dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
let aiMode = 'valid';
const aiRequests = [],
  realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url) !== 'https://api.openai.com/v1/responses')
    return realFetch(url, options);
  if (options.headers.Authorization !== 'Bearer stage4a-fake-key')
    throw new Error('Unexpected key in isolated mock');
  const body = JSON.parse(options.body);
  aiRequests.push(body);
  if (options.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (aiMode === 'slow')
    await new Promise((_resolve, reject) =>
      options.signal.addEventListener(
        'abort',
        () => reject(new DOMException('Cancelled', 'AbortError')),
        { once: true },
      ),
    );
  const kind = body.text.format.name.replace('watercut_', ''),
    input = JSON.parse(body.input[1].content);
  let value =
    aiMode === 'invalid'
      ? { invalid: true }
      : kind === 'outline'
        ? {
            routes: [1, 2].map((n) => ({
              title: '合成路线' + n,
              summary: '待确认路线',
              shots: Array.from({ length: 3 }, () => ({
                description: '路线画面' + n,
                actionDialogue: '',
                durationMs: 1000,
              })),
            })),
          }
        : kind === 'visual'
          ? {
              suggestions: input.shots.map((s) => ({
                shotKey: s.key,
                description: 'AI 画面草案·雨夜',
                shotSize: '特写',
                movement: '推',
                reason: '合成验收建议，不调用外部服务',
              })),
            }
          : {
              issues: [
                {
                  shotKey: input.shots[0].key,
                  issueType: 'logic',
                  explanation: '衔接待检查',
                  suggestedAction: '检查镜头转场',
                  insertShot: {
                    description: '可选补镜',
                    actionDialogue: '',
                    durationMs: 1000,
                  },
                },
              ],
            };
  return Response.json({
    output: [
      { content: [{ type: 'output_text', text: JSON.stringify(value) }] },
    ],
  });
};
function wav(file) {
  const n = 8000 * 8,
    bytes = Buffer.alloc(44 + n * 2);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    bytes.writeInt16LE(
      Math.round(
        Math.sin((i * 2 * Math.PI * 220) / 8000) *
          1000 *
          [
            0.25, 0.8, 0.45, 1, 0.65, 0.35, 0.9, 0.55, 0.7, 0.3, 0.95, 0.5, 0.6,
            0.4, 0.85, 0.2,
          ][Math.floor(i / 4000)],
      ),
      44 + i * 2,
    );
  fs.writeFileSync(file, bytes);
}
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
      await input(
        wc,
        '[aria-label="新项目名称"]',
        process.env.WATERCUT_JIANYING_FIXTURE_ROOT
          ? '4A 原生验收 v1.4.1'
          : '4A 合成验收',
      );
      await click(wc, '.home-intro button', '新建项目');
      await waitFor(wc, "!!document.querySelector('.workspace')", 'studio');
      await evaluate(
        wc,
        '(async()=>{window.confirm=()=>true;const page=await window.watercut.readLibrary();window.__dir=page.projects[0].directory;return true})()',
      );
      const video = path.join(temporary, '恒帧率合成.mp4');
      fs.writeFileSync(
        video,
        Buffer.from(
          fs
            .readFileSync(
              path.join(root, 'scripts/fixtures/test-pattern-av.mp4.base64'),
              'utf8',
            )
            .trim(),
          'base64',
        ),
      );
      openTarget = video;
      await evaluate(
        wc,
        "(async()=>{const page=await window.watercut.importLibraryAssets();window.__video=page.assets.find(a=>a.kind==='video');await window.watercut.updateLibraryAsset(window.__video.id,{tags:'雨夜'});return true})()",
      );
      assert(
        await evaluate(
          wc,
          "window.__video.metadata.status==='ready'&&window.__video.durationMs>1000",
        ),
        'real synthetic video is probed before selects are offered',
      );
      await click(wc, '.rail button', '◈总库');
      await click(wc, '.library-browser>.segmented button', '素材');
      await waitFor(
        wc,
        "document.querySelectorAll('.resource-card').length===1",
        'video card',
      );
      await click(wc, '.resource-card button', '详情');
      await waitFor(
        wc,
        "!!document.querySelector('.select-editor')",
        'video inspector',
      );
      await click(wc, '.select-editor button', '+ 标记精华');
      await input(wc, '[aria-label="精华片段名称"]', '回头笑');
      await input(wc, '[aria-label="精华片段入点"]', '.1');
      await input(wc, '[aria-label="精华片段出点"]', '.9');
      await click(wc, '.select-range-form button', '保存精华片段');
      await waitFor(
        wc,
        "document.querySelector('.select-list-row')?.textContent.includes('回头笑')",
        'saved select',
      );
      await evaluate(
        wc,
        '(async()=>{window.__select=(await window.watercut.listAssetSelects(window.__video.id))[0];return true})()',
      );
      assert(
        await evaluate(
          wc,
          'window.__select.inMs===100&&window.__select.outMs===900',
        ),
        'select editor saves the named original interval',
      );
      await waitFor(
        wc,
        "!document.querySelector('.library-browser').textContent.includes('正在检索')",
        'library reload',
      );
      await delay(150);
      await capture(wc, '01-selects-1440.png');
      await evaluate(
        wc,
        "(async()=>{for(const text of ['雨夜镜头','文字占位','待拍镜头'])await window.watercut.addShot(window.__dir,{description:text,durationMs:2500});return true})()",
      );
      const audio = path.join(temporary, '本地合成BGM.wav');
      wav(audio);
      openTarget = audio;
      await evaluate(wc, 'window.watercut.importAsset(window.__dir)');
      await click(wc, '.rail button', '▦项目');
      await click(wc, '.project-tile button', '进入工作室');
      await click(wc, '.workflow button', '分镜');
      await waitFor(
        wc,
        "document.querySelectorAll('.shot-tile').length===3",
        'three shots',
      );
      await click(wc, '.resources-sidebar>.segmented button', '全局总库');
      await click(
        wc,
        '.resources-sidebar .library-browser>.segmented button',
        '素材',
      );
      await waitFor(
        wc,
        "!!document.querySelector('.resources-sidebar .resource-select')",
        'select in studio',
      );
      await evaluate(
        wc,
        "(()=>{const source=document.querySelector('.resources-sidebar .resource-select'),target=document.querySelector('.shot-tile'),data=new DataTransfer();source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data}));return true})()",
      );
      await idle(wc);
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readProject(window.__dir)).shotAssets[0]?.sourceSelectId===window.__select.id',
        ),
        'dragging a global select creates a primary binding with source identity',
      );
      await evaluate(
        wc,
        '(async()=>{window.__p=await window.watercut.readProject(window.__dir);await window.watercut.saveAssetSelect({...window.__select,inMs:200,outMs:700,expectedVersion:1});return true})()',
      );
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readProject(window.__dir)).shotAssets[0].outMs===900',
        ),
        'editing the global select leaves project trim unchanged',
      );
      assert(
        await evaluate(
          wc,
          "(await window.watercut.libraryUsage(window.__video.id,{inMs:100,outMs:900})).some(u=>u.role==='main'&&u.shotNumber===1&&!u.stale)",
        ),
        'overlap usage displays the actual registered project and shot number',
      );
      await click(wc, '.workflow button', '粗剪');
      await waitFor(
        wc,
        "!!document.querySelector('.preview-screen video')",
        'video preview',
      );
      await evaluate(
        wc,
        `(${installPreviewDiagnostics.toString()})(${JSON.stringify(process.env.WATERCUT_BGM_SCENARIO || 'normal')})`,
      );
      // Re-mount after instrumentation because the video may already have created a context.
      await click(wc, '.workflow button', '分镜');
      await click(wc, '.workflow button', '粗剪');
      await evaluate(
        wc,
        "(()=>{document.querySelector('.bgm-panel').open=true;return true})()",
      );
      await click(wc, '.bgm-panel button', '+ BGM 片段');
      await input(wc, '[aria-label="时间线起点（秒）"]', '0');
      await input(wc, '[aria-label="原片入点（秒）"]', '.25');
      await input(wc, '[aria-label="原片出点（秒）"]', '4.25');
      await input(wc, '[aria-label="淡入（秒）"]', '.2');
      await input(wc, '[aria-label="淡出（秒）"]', '.5');
      await input(wc, '[aria-label="BGM片段音量"]', '60');
      await click(wc, '.bgm-editor button', '保存 BGM');
      await waitFor(
        wc,
        "document.querySelectorAll('.bgm-row').length===1",
        'BGM row',
      );
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readProject(window.__dir)).audioClips[0].fadeOutMs===500',
        ),
        'BGM UI persists source trim, gain and fades',
      );
      await input(wc, '[aria-label="视频原声音量"]', '.4');
      await input(wc, '[aria-label="BGM总音量"]', '.3');
      await click(wc, '.mix-controls button', '应用音量');
      await idle(wc);
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readProject(window.__dir)).timelineSettings.bgmGain===.3',
        ),
        'original and music gain settings persist separately',
      );
      assert(
        await evaluate(
          wc,
          'window.__audio.gains.some(g=>Math.abs(g.gain.value-.3)<.001)&&window.__audio.gains.some(g=>Math.abs(g.gain.value-.4)<.001)',
        ),
        'native Web Audio applies distinct original and BGM gain nodes',
      );
      await evaluate(
        wc,
        '(()=>{window.__fetch=window.fetch;window.fetch=async(...args)=>{await new Promise(r=>setTimeout(r,600));return window.__fetch(...args)};return true})()',
      );
      await click(wc, '.transport button', '播放');
      await delay(200);
      assert(
        await evaluate(
          wc,
          'Number(document.querySelector(\'[aria-label="预览进度"]\').value)<100',
        ),
        'late music loading holds the picture clock instead of running ahead',
      );
      await click(wc, '.transport button', '暂停');
      await delay(650);
      assert(
        await evaluate(
          wc,
          'window.__audio.starts.length===0&&Number(document.querySelector(\'[aria-label="预览进度"]\').value)<100',
        ),
        'cancelling during delayed loading never starts ghost music',
      );
      await click(wc, '.transport button', '播放');
      await waitFor(
        wc,
        'window.__audio.starts.length>0&&Number(document.querySelector(\'[aria-label="预览进度"]\').value)>200',
        'shared music clock',
      );
      await playbackState(wc);
      assert(
        lastPlayback.audio.contexts.at(-1).state === 'running',
        'the music clock starts only after the real audio output is running',
      );
      if (process.env.WATERCUT_BGM_SCENARIO === 'paused-video-position')
        assert(
          lastPlayback.audio.events.filter((e) => e.event === 'video:seeking')
            .length < 20,
          'held video does not repeatedly seek and cancel BGM loading',
        );
      if (process.env.WATERCUT_BGM_SCENARIO === 'suspend-during-load')
        assert(
          lastPlayback.audio.events.some(
            (e) => e.event === 'injected:suspend-after-decode',
          ) &&
            lastPlayback.audio.events.some(
              (e) =>
                e.event === 'audio:resumed' &&
                e.at >=
                  lastPlayback.audio.events.find(
                    (e) => e.event === 'injected:suspend-after-decode',
                  ).at,
            ),
          'a real context suspension during decode resumes before synchronized playback',
        );
      assert(
        await evaluate(
          wc,
          'window.__audio.starts[0][1]>=.25&&window.__audio.starts[0][1]<.5',
        ),
        'native Web Audio starts at the trimmed BGM source offset',
      );
      await evaluate(
        wc,
        "(()=>{document.querySelector('.preview-screen video').dispatchEvent(new Event('waiting'));return true})()",
      );
      await delay(100);
      const waitingPosition = await evaluate(
        wc,
        'Number(document.querySelector(\'[aria-label="预览进度"]\').value)',
      );
      await delay(180);
      assert(
        Math.abs(
          (await evaluate(
            wc,
            'Number(document.querySelector(\'[aria-label="预览进度"]\').value)',
          )) - waitingPosition,
        ) < 40,
        'video buffering holds the same BGM and picture clock',
      );
      await evaluate(
        wc,
        "(()=>{document.querySelector('.preview-screen video').dispatchEvent(new Event('canplay'));return true})()",
      );
      await waitFor(
        wc,
        `Number(document.querySelector('[aria-label="预览进度"]').value)>${waitingPosition + 80}`,
        'picture and BGM resume after buffering',
      );
      assert(true, 'picture and BGM advance again after video buffering ends');
      await click(wc, '.transport button', '暂停');
      await idle(wc);
      const paused = await evaluate(
        wc,
        'Number(document.querySelector(\'[aria-label="预览进度"]\').value)',
      );
      await delay(350);
      assert(
        Math.abs(
          (await evaluate(
            wc,
            'Number(document.querySelector(\'[aria-label="预览进度"]\').value)',
          )) - paused,
        ) < 20,
        'pause stops both music scheduling and picture position',
      );
      await input(wc, '[aria-label="预览进度"]', '1600');
      await evaluate(wc, '(()=>{window.fetch=window.__fetch;return true})()');
      await click(wc, '.transport button', '播放');
      await waitFor(
        wc,
        'window.__audio.starts.at(-1)?.[1]>1.8',
        'seeked music',
      );
      assert(
        await evaluate(wc, 'window.__audio.starts.at(-1)[1]>1.8'),
        'seeking starts music from the corresponding source offset',
      );
      await evaluate(
        wc,
        "(()=>{navigator.mediaDevices.dispatchEvent(new Event('devicechange'));return true})()",
      );
      await waitFor(
        wc,
        "document.querySelector('.transport button').textContent==='播放'",
        'device pause',
      );
      assert(
        await evaluate(wc, 'window.__audio.stops>=2'),
        'audio-device changes stop active sources',
      );
      await click(wc, '.transport button', '播放');
      await waitFor(
        wc,
        "document.querySelector('.transport button').textContent==='暂停'",
        'resume',
      );
      await evaluate(
        wc,
        "(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;return true})()",
      );
      await waitFor(
        wc,
        "document.querySelector('.transport button').textContent==='播放'",
        'background pause',
      );
      assert(true, 'backgrounding pauses preview and BGM together');
      await evaluate(
        wc,
        "(()=>{document.querySelector('.bgm-panel').scrollIntoView({block:'end'});return true})()",
      );
      await delay(200);
      await capture(wc, '02-bgm-1440.png');
      await playbackState(wc);
      if (process.argv.includes('--bgm-only')) {
        assert(
          errors.length === 0,
          'BGM recovery interactions have no renderer errors',
        );
        await finish(0);
        return;
      }
      await click(wc, '.workflow button', '分镜');
      await evaluate(
        wc,
        "(()=>{document.querySelectorAll('.shot-tile')[1].click();return true})()",
      );
      await input(wc, '[aria-label="镜头道具"]', '耳机');
      await input(wc, '[aria-label="拍摄准备状态"]', 'pickup');
      await idle(wc);
      await click(wc, '.workflow button', '清单');
      await input(wc, '[aria-label="清单道具"]', '耳机');
      await waitFor(
        wc,
        "document.querySelectorAll('.shot-tile').length===1",
        'prop filter',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelector('.shot-tile').textContent.includes('文字占位')",
        ),
        'shot list filters by production props',
      );
      saveTarget = path.join(output, 'filtered-shot-list.csv');
      await click(wc, '.storyboard-view button', '导出 CSV');
      await idle(wc);
      const csv = fs.readFileSync(saveTarget, 'utf8');
      assert(
        csv.includes('文字占位') && !csv.includes('待拍镜头'),
        'CSV contains exactly the currently filtered shot',
      );
      saveTarget = path.join(output, 'filtered-shot-list.pdf');
      await click(wc, '.storyboard-view button', '导出当前筛选 PDF');
      await idle(wc);
      assert(
        fs.readFileSync(saveTarget).subarray(0, 5).toString() === '%PDF-',
        'filtered PDF exports through the native packaged application',
      );
      await capture(wc, '03-shot-list-1440.png');
      const state = await evaluate(
          wc,
          'window.watercut.readProject(window.__dir)',
        ),
        base = state.shots[0];
      await evaluate(
        wc,
        "(async()=>{const input={kind:'scene',text:'雨夜中的旧回忆',tags:'雨夜',notes:'',payload:{colors:[],rhythm:'',timeOfDay:'',weather:'',environment:'',props:'',location:''},occurredAt:null};await window.watercut.saveLibraryIdea(input);await window.watercut.createIdea(window.__dir,{...input,text:'雨夜思路'});return true})()",
      );
      await click(wc, '.rail button', '▦项目');
      await click(wc, '.project-tile button', '进入工作室');
      await click(wc, '.workflow button', '分镜');
      await waitFor(wc, "!!document.querySelector('.shot-tile')", 'shots');
      await evaluate(
        wc,
        "(()=>{document.querySelector('.shot-tile').click();document.querySelector('.ai-toggle').click();document.querySelector('.ai-configuration').open=true;return true})()",
      );
      assert(
        await evaluate(
          wc,
          "document.querySelector('.ai-suggestions button').disabled",
        ),
        'AI generation is optional without a configured key',
      );
      await input(wc, '[aria-label="AI 模型 ID"]', 'mock-model');
      await input(wc, '[aria-label="AI API Key"]', 'stage4a-fake-key');
      await click(wc, '.ai-settings button', '保存设置');
      await waitFor(
        wc,
        '!document.querySelector(\'[aria-label="AI API Key"]\').value',
        'saved fake key',
      );
      await click(wc, '.ai-suggestions button', '配画面建议');
      await waitFor(
        wc,
        "!!document.querySelector('.visual-suggestion')",
        'generated visual proposal',
      );
      await idle(wc);
      assert(
        aiRequests.length === 1 &&
          !JSON.stringify(aiRequests[0].input).includes(state.directory),
        'native suggestion requests send only aliased text to a mocked provider',
      );
      await click(wc, '.rail button', '▦项目');
      await click(wc, '.project-tile button', '进入工作室');
      await click(wc, '.workflow button', '分镜');
      await waitFor(
        wc,
        "!!document.querySelector('.shot-tile')",
        'reopen shots',
      );
      await evaluate(
        wc,
        "(()=>{document.querySelector('.shot-tile').click();document.querySelector('.ai-toggle').click();return true})()",
      );
      await waitFor(
        wc,
        "!!document.querySelector('.visual-suggestion')",
        'saved AI proposal',
      );
      assert(
        await evaluate(
          wc,
          "document.querySelector('.visual-suggestion textarea').value==='AI 画面草案·雨夜'",
        ),
        'pending AI suggestions survive project reopen',
      );
      await input(wc, '.visual-suggestion textarea', '创作者确认画面·雨夜');
      await click(wc, '.visual-suggestion button', '采纳这条画面建议');
      await idle(wc);
      assert(
        await evaluate(
          wc,
          "(await window.watercut.readProject(window.__dir)).shots[0].description==='创作者确认画面·雨夜'",
        ),
        'visual suggestions are editable and apply only after explicit adoption',
      );
      assert(
        await evaluate(
          wc,
          `(await window.watercut.readProject(window.__dir)).shots[0].actionDialogue===${JSON.stringify(base.actionDialogue)}`,
        ),
        'adoption preserves original dialogue',
      );
      await waitFor(
        wc,
        "document.querySelector('.local-echoes').textContent.includes('雨夜中的旧回忆')",
        'local echoes',
      );
      assert(
        aiRequests.length === 1,
        'local echoes retrieve matching cards without calling the remote provider',
      );
      await evaluate(
        wc,
        "(()=>{document.querySelector('.ai-toggle').scrollIntoView({block:'start'});return true})()",
      );
      await capture(wc, '04-ai-1440.png');
      const revisionBeforeCancel = await evaluate(
        wc,
        '(await window.watercut.readProject(window.__dir)).revision',
      );
      aiMode = 'slow';
      await click(wc, '.ai-suggestions button', '分镜体检');
      await waitFor(
        wc,
        "!![...document.querySelectorAll('.ai-suggestions button')].find(e=>e.textContent==='取消生成')",
        'cancel control',
      );
      await click(wc, '.ai-suggestions button', '取消生成');
      await idle(wc);
      assert(
        (await evaluate(
          wc,
          '(await window.watercut.readProject(window.__dir)).revision',
        )) === revisionBeforeCancel,
        'cancelling a live mocked request preserves the formal draft',
      );
      aiMode = 'invalid';
      await click(wc, '.ai-suggestions button', '分镜体检');
      await waitFor(
        wc,
        "!document.querySelector('.app-status').textContent.includes('处理中')&&document.querySelector('.app-status').textContent.includes('结构')",
        'bad structured response',
      );
      assert(
        (await evaluate(
          wc,
          '(await window.watercut.readProject(window.__dir)).revision',
        )) === revisionBeforeCancel,
        'invalid structured AI output does not modify the draft',
      );
      aiMode = 'valid';
      await click(wc, '.ai-suggestions button', '分镜体检');
      await waitFor(
        wc,
        "!!document.querySelector('.proposal-issue')",
        'review proposal',
      );
      await idle(wc);
      await click(wc, '.proposal-issue button', '采纳为待优化标注');
      await idle(wc);
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readProject(window.__dir)).shots[0].needsReview',
        ),
        'review adoption adds a note without replacing the shot',
      );
      await click(wc, '.resources-sidebar>.segmented button', '当前项目');
      await waitFor(
        wc,
        "!!document.querySelector('.resources-sidebar .resource-card input[type=checkbox]')",
        'idea choice',
      );
      await evaluate(
        wc,
        "(()=>{document.querySelector('.resources-sidebar .resource-card input[type=checkbox]').click();return true})()",
      );
      await click(wc, '.ai-suggestions button', '理出 2～3 条故事路线');
      await waitFor(
        wc,
        "document.querySelectorAll('.proposal-route').length===2",
        'outline routes',
      );
      await idle(wc);
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readProject(window.__dir)).shots.length===3',
        ),
        'two outline routes remain proposals before adoption',
      );
      await click(wc, '.proposal-route button', '选用这条路线，追加镜头');
      await idle(wc);
      assert(
        await evaluate(
          wc,
          '(await window.watercut.readProject(window.__dir)).shots.length===6',
        ),
        'choosing one route appends only its three shots',
      );
      await evaluate(
        wc,
        "(()=>{document.querySelector('.ai-toggle').scrollIntoView({block:'start'});return true})()",
      );
      await delay(200);
      await capture(wc, '04-ai-1440.png');
      window.setSize(1000, 800);
      await delay(200);
      await evaluate(
        wc,
        "(()=>{document.querySelector('.ai-toggle').scrollIntoView({block:'start'});return true})()",
      );
      await delay(200);
      await capture(wc, '05-ai-1000.png');
      assert(
        await evaluate(
          wc,
          'document.documentElement.scrollWidth<=window.innerWidth+1',
        ),
        '4A workbench fits the supported 1000-pixel window',
      );
      window.setSize(1440, 940);
      await click(wc, '.delivery-toggle', '版本与交付');
      folderTarget =
        process.env.WATERCUT_JIANYING_FIXTURE_ROOT ||
        path.resolve(root, '..', 'WaterCut 4A 验收', '剪映交接样例');
      if (!path.isAbsolute(folderTarget))
        throw new Error('Native fixture output must be absolute');
      fs.mkdirSync(folderTarget, { recursive: true });
      await click(wc, '.delivery-panel button', '导出剪映草稿文件夹');
      await waitFor(
        wc,
        "document.querySelector('.delivery-panel').textContent.includes('草稿已导出')",
        'Jianying export',
        45000,
      );
      await idle(wc);
      const folder = readdirLatest(folderTarget),
        draft = JSON.parse(
          fs.readFileSync(path.join(folder, 'draft_content.json'), 'utf8'),
        ),
        timeline = JSON.parse(
          fs.readFileSync(path.join(folder, 'timeline.json'), 'utf8'),
        ),
        manifest = JSON.parse(
          fs.readFileSync(path.join(folder, 'watercut-handoff.json'), 'utf8'),
        );
      assert(
        draft.tracks[0].segments.length === 6 &&
          draft.tracks.some((t) => t.type === 'audio'),
        'draft contains all video shots plus the BGM track',
      );
      assert(
        draft.tracks[0].segments[0].source_timerange.start === 100000,
        'draft retains the original select source in-point',
      );
      assert(
        draft.materials.videos
          .filter((v) => v.type === 'photo')
          .every(
            (v) => fs.readFileSync(v.path).subarray(1, 4).toString() === 'PNG',
          ),
        'missing shots export as actual rendered PNG placeholders',
      );
      assert(
        timeline.video.every(
          (c, i) =>
            i === 0 ||
            c.startUs ===
              timeline.video[i - 1].startUs + timeline.video[i - 1].durationUs,
        ),
        'exported timeline preserves continuous absolute frame boundaries',
      );
      for (const item of manifest.files)
        assert(
          createHash('sha256')
            .update(fs.readFileSync(path.join(folder, item.path)))
            .digest('hex') === item.sha256,
          'handoff fingerprint ' + item.path,
        );
      await capture(wc, '06-delivery-1440.png');
      assert(errors.length === 0, 'stage 4A has no renderer errors');
      await finish(0);
    } catch (error) {
      try {
        await capture(wc, 'failure.png');
      } catch {}
      await finish(1, error);
    }
  });
});
function readdirLatest(folder) {
  return fs
    .readdirSync(folder)
    .filter((n) => n.endsWith('.jianying'))
    .map((n) => path.join(folder, n))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}
require(
  process.argv.includes('--packaged')
    ? path.join(
        root,
        process.env.WATERCUT_SMOKE_OUT || 'out',
        'WaterCut-win32-x64/resources/app.asar/.vite/build/main.cjs',
      )
    : path.join(root, '.vite/build/main.cjs'),
);
