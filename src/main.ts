import { app, BrowserWindow, dialog, ipcMain, nativeImage, net, protocol, safeStorage, type WebContents } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { addCandidate, addIdea, addShot, appendDraftShots, attachIdeaAsset, cleanupPartialAssets, connectIdeas, createProject, deleteAsset, deleteIdea, deleteShot, disconnectIdeas, importAsset, linkAsset, linkAudio, moveIdea, moveShot, readProject, relinkAsset, removeCandidate, renameProject, updateAssetTags, updateIdea, updateShot, updateTrim, type Project } from './project';
import { openAIProvider } from './ai';
import { projectStorageRoot, relocatedProjectPath } from './paths';
import { z } from 'zod';

protocol.registerSchemesAsPrivileged([{ scheme: 'watercut-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
const mediaPaths = new Map<string, string>();
const activeImports = new Map<number, AbortController>();
const cleanedProjects = new Set<string>();
const closeApproved = new Set<number>();
function projectsRoot() { return projectStorageRoot(app.getAppPath(), app.getPath('exe'), app.getPath('documents')); }
const aiModel = z.string().trim().min(1).max(100);
function aiSettingsFile() { return path.join(app.getPath('userData'), 'ai-settings.json'); }
function readAISettings(): { model: string; encryptedKey: string } {
  try { return JSON.parse(readFileSync(aiSettingsFile(), 'utf8')) as { model: string; encryptedKey: string }; }
  catch { return { model: '', encryptedKey: '' }; }
}
function openProject(directory: string): Project {
  directory = relocatedProjectPath(directory, projectsRoot(), app.getPath('documents'));
  if (!cleanedProjects.has(directory)) { cleanupPartialAssets(directory); cleanedProjects.add(directory); }
  return registerMedia(readProject(directory));
}
async function generateThumbnail(project: Project, asset: Project['assets'][number]): Promise<boolean> {
  if (asset.missing || asset.kind === 'audio') return false;
  const folder = path.join(project.directory, 'thumbnails');
  const file = path.join(folder, `${asset.id}.png`);
  if (existsSync(file)) return true;
  try {
    const image = await nativeImage.createThumbnailFromPath(path.join(project.directory, asset.relativePath), { width: 256, height: 144 });
    if (image.isEmpty()) return false;
    if (!readProject(project.directory).assets.some(item => item.id === asset.id)) return false;
    mkdirSync(folder, { recursive: true });
    const temporary = `${file}.partial`;
    writeFileSync(temporary, image.toPNG());
    renameSync(temporary, file);
    mediaPaths.set(`thumb-${asset.id}`, file);
    return true;
  } catch { rmSync(`${file}.partial`, { force: true }); return false; }
}
async function generateProjectThumbnails(project: Project, sender: WebContents) {
  for (const asset of project.assets) {
    if (asset.thumbnail || asset.missing || asset.kind === 'audio') continue;
    if (await generateThumbnail(project, asset) && !sender.isDestroyed()) sender.send('asset:thumbnail-ready', asset.id);
  }
}
function registerMedia(project: Project): Project {
  for (const asset of project.assets) {
    mediaPaths.set(asset.id, path.join(project.directory, asset.relativePath));
    if (asset.thumbnail) mediaPaths.set(`thumb-${asset.id}`, path.join(project.directory, 'thumbnails', `${asset.id}.png`));
  }
  return project;
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.on('close', event => {
    if (closeApproved.delete(mainWindow.id)) return;
    event.preventDefault();
    mainWindow.webContents.send('app:close-request');
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  ipcMain.on('app:close-ready', (event, ok: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && ok) { closeApproved.add(window.id); window.close(); }
  });
  protocol.handle('watercut-media', request => {
    const url = new URL(request.url);
    const id = url.hostname === 'asset' ? url.pathname.slice(1) : '';
    const file = mediaPaths.get(id);
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Not found', { status: 404 });
  });
  ipcMain.handle('project:root', () => projectsRoot());
  ipcMain.handle('project:create', (_event, name: unknown) => createProject(projectsRoot(), name));
  ipcMain.handle('project:open', async event => {
    mkdirSync(projectsRoot(), { recursive: true });
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'], title: '选择 .watercut 项目文件夹', defaultPath: projectsRoot() });
    if (result.canceled) return null;
    const project = openProject(result.filePaths[0]);
    void generateProjectThumbnails(project, event.sender);
    return project;
  });
  ipcMain.handle('project:read', (event, directory: string) => {
    const project = openProject(directory);
    void generateProjectThumbnails(project, event.sender);
    return project;
  });
  ipcMain.handle('project:rename', (_event, directory: string, name: unknown) => renameProject(directory, name));
  ipcMain.handle('shot:add', (_event, directory: string, shot: unknown) => addShot(directory, shot));
  ipcMain.handle('shot:update', (_event, directory: string, id: string, shot: unknown) => updateShot(directory, id, shot));
  ipcMain.handle('shot:delete', (_event, directory: string, id: string) => deleteShot(directory, id));
  ipcMain.handle('shot:move', (_event, directory: string, id: string, offset: -1 | 1) => moveShot(directory, id, offset));
  ipcMain.handle('idea:add', (_event, directory: string, text: unknown) => addIdea(directory, text));
  ipcMain.handle('idea:update', (_event, directory: string, id: string, idea: unknown) => updateIdea(directory, id, idea));
  ipcMain.handle('idea:delete', (_event, directory: string, id: string) => deleteIdea(directory, id));
  ipcMain.handle('idea:attach', (_event, directory: string, assetId: string) => attachIdeaAsset(directory, assetId));
  ipcMain.handle('board:move', (_event, directory: string, id: string, x: unknown, y: unknown) => moveIdea(directory, id, x, y));
  ipcMain.handle('board:connect', (_event, directory: string, source: string, target: string, sourceHandle: unknown, targetHandle: unknown) => connectIdeas(directory, source, target, sourceHandle, targetHandle));
  ipcMain.handle('board:disconnect', (_event, directory: string, id: string) => disconnectIdeas(directory, id));
  ipcMain.handle('ai:settings', () => ({ model: readAISettings().model, hasKey: !!readAISettings().encryptedKey }));
  ipcMain.handle('ai:save-settings', (_event, modelInput: unknown, keyInput: unknown) => {
    const model = aiModel.parse(modelInput);
    const key = z.string().max(500).parse(keyInput);
    const previous = readAISettings();
    if (key && !safeStorage.isEncryptionAvailable()) throw new Error('此系统无法安全存储密钥，请先启用操作系统加密功能');
    const encryptedKey = key ? safeStorage.encryptString(key).toString('base64') : previous.encryptedKey;
    mkdirSync(app.getPath('userData'), { recursive: true });
    const temporary = `${aiSettingsFile()}.partial`;
    writeFileSync(temporary, JSON.stringify({ model, encryptedKey }), { mode: 0o600 });
    renameSync(temporary, aiSettingsFile());
    return { model, hasKey: !!encryptedKey };
  });
  ipcMain.handle('ai:clear-key', () => {
    const previous = readAISettings();
    const temporary = `${aiSettingsFile()}.partial`;
    writeFileSync(temporary, JSON.stringify({ model: previous.model, encryptedKey: '' }), { mode: 0o600 });
    renameSync(temporary, aiSettingsFile());
    return { model: previous.model, hasKey: false };
  });
  ipcMain.handle('ai:generate', async (_event, directory: string, idsInput: unknown) => {
    const ids = z.array(z.string().uuid()).min(1).max(30).parse(idsInput);
    const selected = readProject(directory).ideas.filter(idea => ids.includes(idea.id));
    if (selected.length !== new Set(ids).size) throw new Error('所选灵感已不存在，请重新选择');
    const settings = readAISettings();
    if (!settings.encryptedKey) throw new Error('请先保存 AI 密钥');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('无法解密本机 AI 密钥');
    const key = safeStorage.decryptString(Buffer.from(settings.encryptedKey, 'base64'));
    return openAIProvider.generateDraft(selected, settings.model, key);
  });
  ipcMain.handle('ai:append-draft', (_event, directory: string, shots: unknown) => appendDraftShots(directory, shots));
  ipcMain.handle('asset:tags', (_event, directory: string, assetId: string, tags: unknown) => updateAssetTags(directory, assetId, tags));
  ipcMain.handle('asset:delete', (_event, directory: string, assetId: string) => {
    const result = deleteAsset(directory, assetId);
    mediaPaths.delete(assetId);
    mediaPaths.delete(`thumb-${assetId}`);
    return result;
  });
  ipcMain.handle('asset:import', async (event, directory: string) => {
    readProject(directory);
    const result = await dialog.showOpenDialog({ properties: ['openFile'], title: '选择要导入的图片、视频或音频' });
    if (result.canceled) return null;
    if (activeImports.has(event.sender.id)) throw new Error('已有素材正在导入');
    const controller = new AbortController();
    activeImports.set(event.sender.id, controller);
    try {
      const project = await importAsset(directory, result.filePaths[0], {
        signal: controller.signal,
        onProgress: (copied, total) => { if (!event.sender.isDestroyed()) event.sender.send('asset:progress', { copied, total }); },
      });
      await generateThumbnail(project, project.assets.at(-1)!);
      return registerMedia(readProject(directory));
    } catch (error) {
      if (controller.signal.aborted) return null;
      throw error;
    } finally { activeImports.delete(event.sender.id); }
  });
  ipcMain.handle('asset:cancel', event => {
    const controller = activeImports.get(event.sender.id);
    if (!controller) return false;
    controller.abort();
    return true;
  });
  ipcMain.handle('asset:relink', async (event, directory: string, assetId: string) => {
    const asset = readProject(directory).assets.find(item => item.id === assetId);
    if (!asset?.missing) throw new Error('素材不存在或并未缺失');
    const result = await dialog.showOpenDialog({ properties: ['openFile'], title: `重新定位 ${asset.name}` });
    if (result.canceled) return null;
    if (activeImports.has(event.sender.id)) throw new Error('已有素材正在导入');
    const controller = new AbortController();
    activeImports.set(event.sender.id, controller);
    try {
      const project = await relinkAsset(directory, assetId, result.filePaths[0], {
        signal: controller.signal,
        onProgress: (copied, total) => { if (!event.sender.isDestroyed()) event.sender.send('asset:progress', { copied, total }); },
      });
      await generateThumbnail(project, project.assets.find(item => item.id === assetId)!);
      return registerMedia(readProject(directory));
    } catch (error) { if (controller.signal.aborted) return null; throw error; }
    finally { activeImports.delete(event.sender.id); }
  });
  ipcMain.handle('asset:link', (_event, directory: string, shotId: string, assetId: string) => linkAsset(directory, shotId, assetId));
  ipcMain.handle('asset:candidate-add', (_event, directory: string, shotId: string, assetId: string) => addCandidate(directory, shotId, assetId));
  ipcMain.handle('asset:candidate-remove', (_event, directory: string, shotId: string, assetId: string) => removeCandidate(directory, shotId, assetId));
  ipcMain.handle('asset:link-audio', (_event, directory: string, shotId: string, assetId: string) => linkAudio(directory, shotId, assetId));
  ipcMain.handle('shot:trim', (_event, directory: string, shotId: string, inMs: unknown, outMs: unknown) => updateTrim(directory, shotId, inMs, outMs));
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
