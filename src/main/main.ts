import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  net,
  protocol,
  safeStorage,
  type WebContents,
} from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { writePlaceholders } from './platform/placeholder-images';
import { buildTimelineDocument } from '../shared/timeline';
import { removeJobDirectory } from '../infrastructure/jobs/file-jobs';
import { shotListFilterSchema } from '../shared/creative';
import {
  projectStorageRoot,
  relocatedProjectPath,
} from './platform/storage-paths';
import {
  readStorageSettings,
  writeStorageSettings,
  assertExternalDataRoot,
} from './platform/storage-settings';
import { DataClient } from './services/data-client';
import { WindowCloseGuard } from './windows/window-close';
import { writeStoryboardPDF } from './platform/pdf-export';
import { exportRows, shotListCSV } from '../shared/print';
import { openAIProvider } from './platform/ai-provider';
import { z } from 'zod';
import type {
  LibraryAsset,
  LibraryPage,
  Project,
  StorageSettings,
} from '../shared/models';
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'watercut-media',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
const mediaPaths = new Map<
  string,
  {
    file: string;
    root: string;
  }
>();
const activeImports = new Map<number, AbortController>();
const activeAI = new Map<
  string,
  { sender: number; controller: AbortController }
>();
const knownProjects = new Set<string>();
const closeGuards = new Map<number, WindowCloseGuard>();
let data: DataClient;
function logUIError(scope: string, message: string, stack = '') {
  try {
    const directory = app.getPath('userData');
    mkdirSync(directory, {
      recursive: true,
    });
    const file = path.join(directory, 'renderer-errors.log');
    if (existsSync(file) && statSync(file).size > 1024 * 1024)
      writeFileSync(file, '');
    appendFileSync(
      file,
      `${new Date().toISOString()} [${app.getVersion()}] [${scope}] ${message.slice(0, 4000)}\n${stack.slice(0, 16000)}\n`,
    );
  } catch {
    /* Logging must never prevent recovery or exit. */
  }
}
function storage(): StorageSettings {
  return readStorageSettings(
    app.getPath('userData'),
    projectStorageRoot(
      app.getAppPath(),
      app.getPath('exe'),
      app.getPath('documents'),
    ),
  );
}
function activeLibraryRoot() {
  const root = storage().libraryRoot;
  assertExternalDataRoot(root);
  return root;
}
function activeProjectsRoot() {
  const root = storage().projectsRoot;
  assertExternalDataRoot(root);
  return root;
}
function aiFile() {
  return path.join(app.getPath('userData'), 'ai-settings.json');
}
function readAISettings(): {
  model: string;
  encryptedKey: string;
} {
  try {
    return JSON.parse(readFileSync(aiFile(), 'utf8'));
  } catch {
    return {
      model: '',
      encryptedKey: '',
    };
  }
}
function registerFile(id: string, file: string | null, root: string) {
  if (file)
    mediaPaths.set(id, {
      file,
      root,
    });
}
async function projectResult(
  directory: string,
  sender?: WebContents,
): Promise<Project> {
  const root = activeLibraryRoot();
  const envelope = await data.call<{
    project: Project;
    files: Array<{
      id: string;
      file: string | null;
      thumbnail: string;
    }>;
  }>('workspace', 'projectEnvelope', [directory, root]);
  knownProjects.add(path.resolve(directory).toLowerCase());
  for (const file of envelope.files) {
    const fileRoot =
      envelope.project.assets.find((a) => a.id === file.id)?.storageKind ===
      'library'
        ? root
        : directory;
    registerFile(`${envelope.project.id}:${file.id}`, file.file, fileRoot);
    registerFile(
      `thumb:${envelope.project.id}:${file.id}`,
      file.thumbnail,
      fileRoot,
    );
  }
  if (sender)
    void thumbnails(envelope.project, sender, envelope.files).catch(
      () => undefined,
    );
  return envelope.project;
}
async function allowedProject(input: unknown): Promise<string> {
  let directory = z.string().min(1).parse(input);
  directory = relocatedProjectPath(
    directory,
    activeProjectsRoot(),
    app.getPath('documents'),
  );
  const resolved = path.resolve(directory),
    key = resolved.toLowerCase();
  const underProjectRoot =
    path.dirname(resolved).toLowerCase() ===
    path.resolve(activeProjectsRoot()).toLowerCase();
  if (!knownProjects.has(key) && !underProjectRoot) {
    const catalog = await data.call<LibraryPage>('library', 'readLibrary', [
      activeLibraryRoot(),
      {
        limit: 1,
      },
    ]);
    if (
      !catalog.projects.some(
        (p) => path.resolve(p.directory).toLowerCase() === key,
      )
    )
      throw new Error('请先通过“打开项目文件夹”选择此项目');
  }
  return directory;
}
async function changeProject(
  method: string,
  directory: unknown,
  args: unknown[],
  sender: WebContents,
) {
  const dir = await allowedProject(directory);
  await data.call('project', method, [dir, ...args]);
  return projectResult(dir, sender);
}
function registerLibraryAsset(asset: LibraryAsset, root: string) {
  registerFile(
    `${asset.libraryId}:${asset.id}`,
    path.resolve(root, asset.relativePath),
    root,
  );
  registerFile(
    `thumb:${asset.libraryId}:${asset.id}`,
    path.join(root, 'thumbnails', `${asset.id}.png`),
    root,
  );
}
async function libraryResult(query: unknown = {}): Promise<LibraryPage> {
  const root = activeLibraryRoot(),
    page = await data.call<LibraryPage>('library', 'readLibrary', [
      root,
      query,
    ]);
  for (const asset of [...page.assets, ...page.referenceAssets])
    registerLibraryAsset(asset, root);
  return page;
}
async function thumbnail(file: string, target: string): Promise<string[]> {
  try {
    const image = await nativeImage.createThumbnailFromPath(file, {
      width: 256,
      height: 144,
    });
    if (image.isEmpty()) return [];
    mkdirSync(path.dirname(target), {
      recursive: true,
    });
    const temp = `${target}.partial`;
    writeFileSync(temp, image.toPNG());
    renameSync(temp, target);
    const small = image
        .resize({
          width: 24,
          height: 24,
        })
        .toBitmap(),
      counts = new Map<string, number>();
    for (let i = 0; i < small.length; i += 4) {
      if (small[i + 3] < 128) continue;
      const color =
        '#' +
        [small[i + 2], small[i + 1], small[i]]
          .map((v) =>
            Math.min(255, Math.round(v / 32) * 32)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('');
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    return [...counts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map((v) => v[0]);
  } catch {
    return [];
  }
}
async function thumbnails(
  project: Project,
  sender: WebContents,
  files: Array<{
    id: string;
    file: string | null;
    thumbnail: string;
  }>,
) {
  for (const item of files) {
    const asset = project.assets.find((a) => a.id === item.id);
    if (
      !asset ||
      asset.kind === 'audio' ||
      !item.file ||
      existsSync(item.thumbnail)
    )
      continue;
    await thumbnail(item.file, item.thumbnail);
    if (!sender.isDestroyed()) sender.send('asset:thumbnail-ready', item.id);
  }
}
async function importJob<T>(
  sender: WebContents,
  action: (options: {
    signal: AbortSignal;
    onProgress: (progress: any) => void;
  }) => Promise<T>,
): Promise<T | null> {
  if (activeImports.has(sender.id)) throw new Error('已有导入任务正在进行');
  const controller = new AbortController();
  activeImports.set(sender.id, controller);
  try {
    return await action({
      signal: controller.signal,
      onProgress: (progress) => {
        if (!sender.isDestroyed()) sender.send('asset:progress', progress);
      },
    });
  } catch (error) {
    if (controller.signal.aborted) return null;
    throw error;
  } finally {
    activeImports.delete(sender.id);
  }
}
function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1000,
    minHeight: 680,
    show: !app.commandLine.hasSwitch('watercut-smoke'),
    backgroundColor: '#101c22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: app.commandLine.hasSwitch('watercut-smoke'),
      backgroundThrottling: !app.commandLine.hasSwitch('watercut-smoke'),
    },
  });
  const guard = new WindowCloseGuard({
    requestSave: (requestId) =>
      window.webContents.send('app:close-request', requestId),
    confirmExit: async () => {
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        title: '退出 WaterCut',
        message: '页面暂时没有响应',
        detail:
          '无法确认最近的编辑是否已保存。可以继续等待，或退出程序后重新打开。',
        buttons: ['继续等待', '退出程序'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
    close: () => {
      activeImports.get(window.webContents.id)?.abort();
      window.close();
    },
    forceClose: () => {
      activeImports.get(window.webContents.id)?.abort();
      window.destroy();
    },
  });
  closeGuards.set(window.id, guard);
  window.on('close', (event) => {
    if (!guard.allowClose()) event.preventDefault();
  });
  window.on('closed', () => {
    guard.dispose();
    closeGuards.delete(window.id);
  });
  window.on('unresponsive', () => guard.markUnavailable());
  window.on('responsive', () => guard.markResponsive());
  window.webContents.on('did-finish-load', () => guard.markResponsive());
  window.webContents.on('render-process-gone', (_event, details) => {
    guard.markUnavailable();
    logUIError(
      'renderer',
      `渲染进程退出：${details.reason} (${details.exitCode})`,
    );
  });
  window.webContents.on(
    'did-fail-load',
    (_event, code, description, _url, mainFrame) => {
      if (mainFrame) {
        guard.markUnavailable();
        logUIError('load', `${code}: ${description}`);
      }
    },
  );
  window.webContents.setWindowOpenHandler(() => ({
    action: 'deny',
  }));
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL)
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else
    void window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
}
if (!app.requestSingleInstanceLock()) app.quit();
else
  app
    .whenReady()
    .then(async () => {
      data = new DataClient();
      const packagedWasm = path.resolve(
        __dirname,
        '../../../MediaInfoModule.wasm',
      );
      await data.call('media', 'configureMedia', [
        existsSync(packagedWasm)
          ? packagedWasm
          : path.resolve(
              __dirname,
              '../../node_modules/mediainfo.js/dist/MediaInfoModule.wasm',
            ),
      ]);
      if (
        !existsSync(path.join(app.getPath('userData'), 'storage-settings.json'))
      )
        writeStorageSettings(app.getPath('userData'), storage());
      protocol.handle('watercut-media', (request) => {
        try {
          const url = new URL(request.url),
            id = decodeURIComponent(url.pathname.slice(1)),
            entry = url.hostname === 'asset' ? mediaPaths.get(id) : undefined;
          if (!entry)
            return new Response('Not found', {
              status: 404,
            });
          const real = realpathSync(entry.file),
            root = realpathSync(entry.root) + path.sep;
          if (!real.toLowerCase().startsWith(root.toLowerCase()))
            return new Response('Forbidden', {
              status: 403,
            });
          return net.fetch(pathToFileURL(real).toString()).then((response) => {
            const headers = new Headers(response.headers);
            headers.set('Access-Control-Allow-Origin', '*');
            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers,
            });
          });
        } catch {
          return new Response('Not found', {
            status: 404,
          });
        }
      });
      ipcMain.on(
        'app:close-ready',
        (event, requestId: unknown, ok: unknown) => {
          const window = BrowserWindow.fromWebContents(event.sender);
          if (
            window &&
            Number.isSafeInteger(requestId) &&
            typeof ok === 'boolean'
          )
            closeGuards.get(window.id)?.acknowledge(requestId as number, ok);
        },
      );
      ipcMain.on('app:request-close', (event) =>
        BrowserWindow.fromWebContents(event.sender)?.close(),
      );
      ipcMain.on('app:ui-error', (event, input) => {
        const parsed = z
          .object({
            scope: z.enum(['app', 'inspector']),
            message: z.string().max(4000),
            stack: z.string().max(20000),
          })
          .safeParse(input);
        if (!parsed.success) return;
        logUIError(parsed.data.scope, parsed.data.message, parsed.data.stack);
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window && parsed.data.scope === 'app')
          closeGuards.get(window.id)?.markUnavailable();
      });
      ipcMain.handle('settings:get', () => storage());
      ipcMain.handle('settings:choose-root', async (_event, kind: unknown) => {
        const field = z.enum(['projectsRoot', 'libraryRoot']).parse(kind),
          previous = storage();
        const result = await dialog.showOpenDialog({
          title:
            field === 'projectsRoot'
              ? '选择以后新项目的保存位置'
              : '打开或新建 WaterCut 全局库（不会移动旧库）',
          properties: ['openDirectory', 'createDirectory'],
          defaultPath: previous[field],
        });
        if (result.canceled) return null;
        assertExternalDataRoot(result.filePaths[0]);
        if (field === 'libraryRoot') {
          await data.call('library', 'libraryId', [result.filePaths[0]]);
          await data.call('library', 'recoverLibraryJobs', [
            result.filePaths[0],
          ]);
        }
        const saved = writeStorageSettings(app.getPath('userData'), {
          ...previous,
          [field]: result.filePaths[0],
        });
        if (field === 'libraryRoot') mediaPaths.clear();
        return saved;
      });
      ipcMain.handle('project:root', () => activeProjectsRoot());
      ipcMain.handle('project:create', async (event, name) => {
        const project = await data.call<Project>('project', 'createProject', [
          activeProjectsRoot(),
          name,
        ]);
        return projectResult(project.directory, event.sender);
      });
      ipcMain.handle('project:open', async (event) => {
        const result = await dialog.showOpenDialog({
          title: '打开 .watercut 项目',
          properties: ['openDirectory'],
          defaultPath: activeProjectsRoot(),
        });
        if (result.canceled) return null;
        const dir = result.filePaths[0];
        knownProjects.add(path.resolve(dir).toLowerCase());
        try {
          return await projectResult(dir, event.sender);
        } catch (error) {
          if (error instanceof Error && error.message.includes('相同项目 ID')) {
            const choice = await dialog.showMessageBox({
              type: 'question',
              message: '此文件夹是已登记项目的另一份副本',
              detail: '为此副本创建独立身份后，两个项目的内容将分别保存。',
              buttons: ['作为副本打开', '取消'],
              cancelId: 1,
            });
            if (choice.response === 0) {
              await data.call('project', 'forkProjectIdentity', [dir]);
              return projectResult(dir, event.sender);
            }
            return null;
          }
          throw error;
        }
      });
      ipcMain.handle('project:read', async (event, directory) =>
        projectResult(await allowedProject(directory), event.sender),
      );
      ipcMain.handle('revision:list', async (_event, directory) =>
        data.call('revisions', 'listRevisions', [
          await allowedProject(directory),
        ]),
      );
      ipcMain.handle('revision:create', async (event, directory, name) => {
        const dir = await allowedProject(directory);
        return importJob(event.sender, (options) =>
          data.call(
            'revisions',
            'createRevision',
            [dir, activeLibraryRoot(), name],
            options,
          ),
        );
      });
      ipcMain.handle('revision:delete', async (_event, directory, id) =>
        data.call('revisions', 'deleteRevision', [
          await allowedProject(directory),
          id,
        ]),
      );
      ipcMain.handle('revision:restore', async (event, directory, id) => {
        const dir = await allowedProject(directory);
        return importJob(event.sender, async (options) => {
          await data.call(
            'revisions',
            'restoreRevision',
            [dir, activeLibraryRoot(), id],
            options,
          );
          return projectResult(dir, event.sender);
        });
      });
      ipcMain.handle(
        'project:export-package',
        async (event, directory, input) => {
          const dir = await allowedProject(directory),
            settings = z
              .object({
                includeHistory: z.boolean(),
                includeMedia: z.boolean(),
              })
              .parse(input);
          const project = await data.call<Project>('project', 'readProject', [
            dir,
          ]);
          const target = await dialog.showSaveDialog({
            title: '导出独立项目包',
            defaultPath: `${project.name.replace(/[<>:"/\\|?*]/g, '_')}.watercut.zip`,
            filters: [
              {
                name: 'WaterCut 项目包',
                extensions: ['zip'],
              },
            ],
          });
          if (target.canceled || !target.filePath) return null;
          return importJob(event.sender, (options) =>
            data.call(
              'packages',
              'exportPackage',
              [dir, activeLibraryRoot(), target.filePath, settings],
              options,
            ),
          );
        },
      );
      ipcMain.handle('project:import-package', async (event) => {
        const choice = await dialog.showOpenDialog({
          title: '导入 WaterCut 项目包（创建独立副本）',
          properties: ['openFile'],
          filters: [
            {
              name: 'WaterCut 项目包',
              extensions: ['zip'],
            },
          ],
        });
        if (choice.canceled) return null;
        return importJob(event.sender, async (options) => {
          const p = await data.call<Project>(
            'packages',
            'importPackage',
            [choice.filePaths[0], activeProjectsRoot()],
            options,
          );
          knownProjects.add(path.resolve(p.directory).toLowerCase());
          return projectResult(p.directory, event.sender);
        });
      });
      ipcMain.handle('media:probe-project', async (event, directory) => {
        const dir = await allowedProject(directory);
        return importJob(event.sender, async (options) => {
          await data.call(
            'media',
            'probeProject',
            [dir, activeLibraryRoot()],
            options,
          );
          return projectResult(dir, event.sender);
        });
      });
      ipcMain.handle('media:probe-library', async (event, id) =>
        importJob(event.sender, async (options) => {
          await data.call(
            'media',
            'probeLibraryAsset',
            [activeLibraryRoot(), z.string().uuid().parse(id)],
            options,
          );
          return libraryResult();
        }),
      );
      ipcMain.handle(
        'export:storyboard-pdf',
        async (event, directory, input) => {
          const dir = await allowedProject(directory),
            settings = z
              .object({
                landscape: z.boolean(),
                checklist: z.boolean(),
                filter: shotListFilterSchema.optional(),
              })
              .parse(input),
            root = activeLibraryRoot();
          const envelope = await data.call<{
            project: Project;
            files: Array<{
              id: string;
              file: string | null;
              thumbnail: string;
            }>;
          }>('workspace', 'projectEnvelope', [dir, root]);
          const rows = exportRows(
              envelope.project,
              settings.checklist,
              settings.filter,
            ),
            issues = rows
              .filter((r) => r.missing || r.warning)
              .map(
                (r) =>
                  `镜头 ${r.number}：${r.missing ? '素材缺失' : r.warning}`,
              );
          if (issues.length) {
            const answer = await dialog.showMessageBox({
              type: 'warning',
              message: '部分镜头将使用占位或预计时长导出',
              detail: issues.slice(0, 25).join('\n'),
              buttons: ['继续导出', '取消'],
              defaultId: 1,
              cancelId: 1,
            });
            if (answer.response !== 0) return null;
          }
          const target = await dialog.showSaveDialog({
            title: settings.checklist ? '导出待拍清单 PDF' : '导出分镜脚本 PDF',
            defaultPath: `${envelope.project.name.replace(/[<>:"/\\|?*]/g, '_')}-${settings.checklist ? '待拍清单' : '分镜'}.pdf`,
            filters: [
              {
                name: 'PDF',
                extensions: ['pdf'],
              },
            ],
          });
          if (target.canceled || !target.filePath) return null;
          return importJob(event.sender, (options) =>
            writeStoryboardPDF(
              envelope.project,
              envelope.files.map((file) => ({
                ...file,
                root:
                  envelope.project.assets.find((a) => a.id === file.id)
                    ?.storageKind === 'library'
                    ? root
                    : dir,
              })),
              target.filePath!,
              settings,
              options,
            ),
          );
        },
      );
      const mutations: Record<string, string> = {
        'project:rename': 'renameProject',
        'project:archive': 'archiveProject',
        'shot:add': 'addShot',
        'shot:update': 'updateShot',
        'shot:delete': 'deleteShot',
        'shot:move': 'moveShot',
        'shot:reorder': 'reorderShots',
        'shot:metadata': 'updateShotMetadata',
        'shot:trim': 'updateTrim',
        'shot:from-ideas': 'createShotsFromIdeas',
        'idea:add': 'addIdea',
        'idea:create': 'createIdea',
        'audio:save': 'saveAudioClip',
        'audio:delete': 'deleteAudioClip',
        'timeline:settings': 'saveTimelineSettings',
        'idea-box:save': 'saveIdeaBox',
        'idea-box:delete': 'deleteIdeaBox',
        'idea-box:move': 'moveIdeasToBox',
        'idea:update': 'updateIdea',
        'idea:delete': 'deleteIdea',
        'idea:attach': 'attachIdeaAsset',
        'board:move': 'moveIdea',
        'board:connect': 'connectIdeas',
        'board:disconnect': 'disconnectIdeas',
        'board:label': 'updateEdgeLabel',
        'script:save': 'saveScriptBlock',
        'script:section': 'createScriptSection',
        'script:paragraph': 'addScriptParagraph',
        'script:reorder': 'reorderScriptBlocks',
        'shot:source-add': 'addShotSource',
        'shot:source-remove': 'removeShotSource',
        'shot:clear-primary': 'clearShotPrimary',
        'script:convert': 'convertScriptBlocks',
        'script:delete': 'deleteScriptBlock',
        'script:split': 'splitScriptBlock',
        'script:merge': 'mergeScriptBlocks',
        'ai:append-draft': 'appendDraftShots',
        'asset:tags': 'updateAssetTags',
        'asset:delete': 'deleteAsset',
        'asset:link': 'linkAsset',
        'asset:candidate-add': 'addCandidate',
        'asset:candidate-remove': 'removeCandidate',
        'asset:link-audio': 'linkAudio',
        'asset:duration': 'updateAssetDuration',
      };
      for (const [channel, method] of Object.entries(mutations))
        ipcMain.handle(channel, (event, directory, ...args) =>
          changeProject(method, directory, args, event.sender),
        );
      ipcMain.handle('project:attach-assets', async (event, directory, ids) => {
        const dir = await allowedProject(directory);
        await data.call('workspace', 'attachAssets', [
          dir,
          activeLibraryRoot(),
          z.array(z.string().uuid()).min(1).max(100).parse(ids),
        ]);
        return projectResult(dir, event.sender);
      });
      ipcMain.handle(
        'project:attach-ideas',
        async (event, directory, ids, copy = false) => {
          const dir = await allowedProject(directory);
          await data.call('workspace', 'attachIdeas', [
            dir,
            activeLibraryRoot(),
            z.array(z.string().uuid()).min(1).max(100).parse(ids),
            z.boolean().parse(copy),
          ]);
          return projectResult(dir, event.sender);
        },
      );
      ipcMain.handle('project:refresh-idea', async (event, directory, id) => {
        const dir = await allowedProject(directory);
        await data.call('workspace', 'refreshIdea', [
          dir,
          activeLibraryRoot(),
          id,
        ]);
        return projectResult(dir, event.sender);
      });
      ipcMain.handle('project:promote', async (event, directory) => {
        const dir = await allowedProject(directory);
        return importJob(event.sender, async (options) => {
          await data.call(
            'workspace',
            'promoteProject',
            [dir, activeLibraryRoot()],
            options,
          );
          return projectResult(dir, event.sender);
        });
      });
      ipcMain.handle('project:example', async (event) => {
        const project = await data.call<Project>('workspace', 'createExample', [
          activeProjectsRoot(),
          activeLibraryRoot(),
        ]);
        return projectResult(project.directory, event.sender);
      });
      ipcMain.handle('library:read', (_event, query) => libraryResult(query));
      ipcMain.handle('library:save-idea', async (_event, input) =>
        data.call('library', 'saveLibraryIdea', [activeLibraryRoot(), input]),
      );
      ipcMain.handle('library:box-save', (_event, input) =>
        data.call('library', 'saveLibraryIdeaBox', [
          activeLibraryRoot(),
          input,
        ]),
      );
      ipcMain.handle('library:box-delete', (_event, id) =>
        data.call('library', 'deleteLibraryIdeaBox', [activeLibraryRoot(), id]),
      );
      ipcMain.handle('library:box-move', (_event, ids, boxId) =>
        data.call('library', 'moveLibraryIdeasToBox', [
          activeLibraryRoot(),
          ids,
          boxId,
        ]),
      );
      ipcMain.handle('library:get-idea', async (_event, id) => {
        const root = activeLibraryRoot(),
          idea = await data.call<any>('library', 'getLibraryIdea', [root, id]);
        for (const media of idea.media) {
          const asset = await data.call<LibraryAsset>(
            'library',
            'getLibraryAsset',
            [root, media.assetId],
          );
          registerLibraryAsset(asset, root);
        }
        return idea;
      });
      ipcMain.handle('library:get-asset', async (_event, id) => {
        const asset = await data.call<LibraryAsset>(
          'library',
          'getLibraryAsset',
          [activeLibraryRoot(), id],
        );
        registerLibraryAsset(asset, activeLibraryRoot());
        return asset;
      });
      ipcMain.handle('library:related', (_event, id) =>
        data.call('library', 'relatedIdeas', [activeLibraryRoot(), id]),
      );
      ipcMain.handle('library:usage', (_event, id, range) =>
        data.call('library', 'listUsage', [activeLibraryRoot(), id, range]),
      );
      ipcMain.handle('select:list', (_event, id) =>
        data.call('library', 'listAssetSelects', [activeLibraryRoot(), id]),
      );
      ipcMain.handle('select:save', (_event, input) =>
        data.call('library', 'saveAssetSelect', [activeLibraryRoot(), input]),
      );
      ipcMain.handle('select:hide', (_event, id) =>
        data.call('library', 'hideAssetSelect', [activeLibraryRoot(), id]),
      );
      ipcMain.handle(
        'select:bind',
        async (event, directory, shotId, selectId) => {
          const dir = await allowedProject(directory);
          await data.call('workspace', 'bindSelect', [
            dir,
            activeLibraryRoot(),
            shotId,
            selectId,
          ]);
          return projectResult(dir, event.sender);
        },
      );
      ipcMain.handle('library:hide', (_event, kind, id, hidden) =>
        data.call('library', 'setLibraryHidden', [
          activeLibraryRoot(),
          z.enum(['idea', 'asset']).parse(kind),
          id,
          z.boolean().parse(hidden),
        ]),
      );
      ipcMain.handle('library:asset-update', (_event, id, input) =>
        data.call('library', 'updateLibraryAsset', [
          activeLibraryRoot(),
          id,
          input,
        ]),
      );
      ipcMain.handle('library:connect', (_event, source, target, kind, note) =>
        data.call('library', 'connectLibraryIdeas', [
          activeLibraryRoot(),
          source,
          target,
          kind,
          note,
        ]),
      );
      ipcMain.handle('library:disconnect', (_event, id) =>
        data.call('library', 'disconnectLibraryIdeas', [
          activeLibraryRoot(),
          id,
        ]),
      );
      ipcMain.handle('library:reconcile', async () => {
        await data.call('workspace', 'reconcileCatalog', [activeLibraryRoot()]);
        return libraryResult();
      });
      ipcMain.handle('media:palette', async (_event, token) => {
        const key = z.string().max(200).parse(token),
          entry = mediaPaths.get(key);
        if (!entry) throw new Error('请先打开该素材');
        const id = z.string().uuid().parse(key.split(':').at(-1));
        const real = realpathSync(entry.file),
          root = realpathSync(entry.root) + path.sep;
        if (!real.toLowerCase().startsWith(root.toLowerCase()))
          throw new Error('素材路径不合法');
        return thumbnail(
          real,
          path.join(entry.root, 'thumbnails', `${id}.png`),
        );
      });
      ipcMain.handle('library:import', async (event) => {
        const choice = await dialog.showOpenDialog({
          title: '导入图片、视频或音频到全局库',
          properties: ['openFile', 'multiSelections'],
        });
        if (choice.canceled) return null;
        return importJob(event.sender, async (options) => {
          const root = activeLibraryRoot();
          for (let index = 0; index < choice.filePaths.length; index++) {
            if (options.signal.aborted) throw new Error('导入已取消');
            const asset = await data.call<LibraryAsset>(
              'library',
              'importLibraryAsset',
              [root, choice.filePaths[index]],
              {
                ...options,
                onProgress: (p) =>
                  options.onProgress({
                    ...p,
                    phase: `${index + 1}/${choice.filePaths.length}`,
                  }),
              },
            );
            registerLibraryAsset(asset, root);
            await data.call(
              'media',
              'probeLibraryAsset',
              [root, asset.id],
              options,
            );
            if (asset.kind !== 'audio') {
              const palette = await thumbnail(
                path.resolve(root, asset.relativePath),
                path.join(root, 'thumbnails', `${asset.id}.png`),
              );
              if (palette.length)
                await data.call('library', 'updateLibraryAsset', [
                  root,
                  asset.id,
                  {
                    palette,
                  },
                ]);
            }
          }
          return libraryResult();
        });
      });
      ipcMain.handle('library:relink', async (event, id) => {
        const choice = await dialog.showOpenDialog({
          title: '重新定位全局库原件（内容需与原件一致）',
          properties: ['openFile'],
        });
        if (choice.canceled) return null;
        return importJob(event.sender, async (options) => {
          const asset = await data.call<LibraryAsset>(
            'library',
            'relinkLibraryAsset',
            [activeLibraryRoot(), id, choice.filePaths[0]],
            options,
          );
          registerLibraryAsset(asset, activeLibraryRoot());
          return asset;
        });
      });
      ipcMain.handle('asset:import', async (event, directory) => {
        const dir = await allowedProject(directory),
          choice = await dialog.showOpenDialog({
            title: '导入项目独有素材副本',
            properties: ['openFile'],
          });
        if (choice.canceled) return null;
        return importJob(event.sender, async (options) => {
          await data.call(
            'project',
            'importAsset',
            [dir, choice.filePaths[0]],
            options,
          );
          await data.call(
            'media',
            'probeProject',
            [dir, activeLibraryRoot()],
            options,
          );
          return projectResult(dir, event.sender);
        });
      });
      ipcMain.handle('asset:relink', async (event, directory, id) => {
        const dir = await allowedProject(directory),
          choice = await dialog.showOpenDialog({
            title: '重新定位项目缺失素材',
            properties: ['openFile'],
          });
        if (choice.canceled) return null;
        return importJob(event.sender, async (options) => {
          await data.call(
            'project',
            'relinkAsset',
            [dir, id, choice.filePaths[0]],
            options,
          );
          return projectResult(dir, event.sender);
        });
      });
      ipcMain.handle('asset:cancel', (event) => {
        const controller = activeImports.get(event.sender.id);
        controller?.abort();
        return !!controller;
      });
      ipcMain.handle('ai:settings', () => ({
        model: readAISettings().model,
        hasKey: !!readAISettings().encryptedKey,
      }));
      ipcMain.handle('ai:save-settings', (_event, modelInput, keyInput) => {
        const model = z.string().trim().min(1).max(100).parse(modelInput),
          key = z.string().max(500).parse(keyInput),
          old = readAISettings();
        if (key && !safeStorage.isEncryptionAvailable())
          throw new Error('当前系统不能安全保存密钥');
        const encryptedKey = key
          ? safeStorage.encryptString(key).toString('base64')
          : old.encryptedKey;
        mkdirSync(app.getPath('userData'), {
          recursive: true,
        });
        writeFileSync(
          `${aiFile()}.partial`,
          JSON.stringify({
            model,
            encryptedKey,
          }),
        );
        renameSync(`${aiFile()}.partial`, aiFile());
        return {
          model,
          hasKey: !!encryptedKey,
        };
      });
      ipcMain.handle('ai:clear-key', () => {
        const old = readAISettings();
        mkdirSync(app.getPath('userData'), {
          recursive: true,
        });
        writeFileSync(
          `${aiFile()}.partial`,
          JSON.stringify({
            model: old.model,
            encryptedKey: '',
          }),
        );
        renameSync(`${aiFile()}.partial`, aiFile());
        return {
          model: old.model,
          hasKey: false,
        };
      });
      ipcMain.handle('ai:generate', async (_event, directory, input) => {
        const dir = await allowedProject(directory),
          ids = z.array(z.string().uuid()).min(1).max(30).parse(input),
          project = await data.call<Project>('project', 'readProject', [dir]),
          selected = ids.map((id) => project.ideas.find((i) => i.id === id));
        if (selected.some((i) => !i)) throw new Error('所选灵感已不存在');
        const settings = readAISettings();
        if (!settings.encryptedKey || !safeStorage.isEncryptionAvailable())
          throw new Error('请先保存有效的 AI 密钥');
        return openAIProvider.generateDraft(
          selected as any,
          settings.model,
          safeStorage.decryptString(
            Buffer.from(settings.encryptedKey, 'base64'),
          ),
        );
      });
      ipcMain.handle('ai:proposals', async (_event, directory) =>
        data.call('proposals', 'listAIProposals', [
          await allowedProject(directory),
        ]),
      );
      ipcMain.handle('library:echoes', async (_event, input) =>
        data.call('library', 'ideaEchoes', [activeLibraryRoot(), input]),
      );
      ipcMain.handle('ai:proposal-delete', async (_event, directory, id) =>
        data.call('proposals', 'deleteAIProposal', [
          await allowedProject(directory),
          id,
        ]),
      );
      ipcMain.handle(
        'ai:proposal-apply',
        async (event, directory, id, input) => {
          const dir = await allowedProject(directory);
          await data.call('proposals', 'applyAIProposal', [dir, id, input]);
          return projectResult(dir, event.sender);
        },
      );
      ipcMain.handle('ai:cancel', async (event, requestId) => {
        const id = z.string().uuid().parse(requestId),
          job = activeAI.get(id);
        if (job?.sender === event.sender.id) job.controller.abort();
      });
      ipcMain.handle(
        'ai:suggest',
        async (event, directory, input, requestId) => {
          const id = z.string().uuid().parse(requestId);
          if (
            activeAI.has(id) ||
            [...activeAI.values()].some((job) => job.sender === event.sender.id)
          )
            throw new Error('已有 AI 建议正在生成，请等待或取消');
          const controller = new AbortController(),
            abort = () => controller.abort();
          activeAI.set(id, { sender: event.sender.id, controller });
          event.sender.once('destroyed', abort);
          try {
            const dir = await allowedProject(directory);
            if (controller.signal.aborted) throw new Error('AI 请求已取消');
            const prepared = await data.call<any>(
                'proposals',
                'prepareAIRequest',
                [dir, input],
              ),
              settings = readAISettings();
            if (controller.signal.aborted) throw new Error('AI 请求已取消');
            if (!settings.encryptedKey || !safeStorage.isEncryptionAvailable())
              throw new Error('请先保存有效的 AI 密钥');
            if (!openAIProvider.suggest)
              throw new Error('当前 AI 提供商不支持建议任务');
            const response = await openAIProvider.suggest(
              prepared.request.kind,
              prepared.text,
              settings.model,
              safeStorage.decryptString(
                Buffer.from(settings.encryptedKey, 'base64'),
              ),
              controller.signal,
            );
            if (controller.signal.aborted || event.sender.isDestroyed())
              throw new Error('AI 请求已取消');
            return await data.call(
              'proposals',
              'storeAIProposal',
              [dir, prepared.project, prepared.request, response],
              { signal: controller.signal },
            );
          } finally {
            activeAI.delete(id);
            if (!event.sender.isDestroyed())
              event.sender.removeListener('destroyed', abort);
          }
        },
      );
      ipcMain.handle('export:jianying', async (event, directory, input) => {
        const dir = await allowedProject(directory),
          settings = z.object({ placeholders: z.boolean() }).parse(input),
          root = activeLibraryRoot();
        const choice = await dialog.showOpenDialog({
          title: '选择剪映交接文件夹的保存位置',
          properties: ['openDirectory', 'createDirectory'],
        });
        if (choice.canceled || !choice.filePaths[0]) return null;
        const parent = choice.filePaths[0];
        assertExternalDataRoot(parent);
        return importJob(event.sender, async (options) => {
          await data.call('media', 'probeProject', [dir, root], options);
          const project = await data.call<Project>(
              'workspace',
              'hydrateProject',
              [dir, root],
            ),
            timeline = buildTimelineDocument(project, settings.placeholders);
          const temporary = mkdtempSync(
            path.join(tmpdir(), 'watercut-handoff-images-'),
          );
          try {
            const images = await writePlaceholders(
              timeline,
              temporary,
              options.signal,
            );
            return await data.call(
              'handoff',
              'exportJianying',
              [
                dir,
                root,
                parent,
                { ...settings, baseRevision: project.revision },
                images,
              ],
              options,
            );
          } finally {
            removeJobDirectory(temporary, tmpdir(), 'watercut-handoff-images-');
          }
        });
      });
      ipcMain.handle(
        'export:shot-list',
        async (_event, directory, input = { onlyGaps: true }) => {
          const filter = shotListFilterSchema.parse(input);
          const dir = await allowedProject(directory),
            project = await data.call<Project>('workspace', 'hydrateProject', [
              dir,
              activeLibraryRoot(),
            ]);
          const target = await dialog.showSaveDialog({
            title: '导出待拍清单',
            defaultPath: `${project.name}-待拍清单.csv`,
            filters: [
              {
                name: 'CSV',
                extensions: ['csv'],
              },
            ],
          });
          if (target.canceled || !target.filePath) return null;
          writeFileSync(target.filePath, shotListCSV(project, filter));
          return target.filePath;
        },
      );
      try {
        await data.call('library', 'recoverLibraryJobs', [activeLibraryRoot()]);
        await data.call('workspace', 'reconcileCatalog', [activeLibraryRoot()]);
      } catch {
        /* The UI can show the failure and offer storage settings. */
      }
      createWindow();
      app.on('activate', () => {
        if (!BrowserWindow.getAllWindows().length) createWindow();
      });
      app.on('second-instance', () => {
        const window = BrowserWindow.getAllWindows()[0];
        window?.restore();
        window?.focus();
      });
    })
    .catch((error) => {
      dialog.showErrorBox('WaterCut 启动失败', String(error));
      app.quit();
    });
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('will-quit', () => {
  for (const controller of activeImports.values()) controller.abort();
  void data?.close();
});
