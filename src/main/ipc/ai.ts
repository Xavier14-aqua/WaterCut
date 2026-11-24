import { app, ipcMain, safeStorage } from 'electron';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { openAIProvider } from '../platform/ai-provider';
import { z } from 'zod';
import type { Project } from '../../shared/models';
import { readAISettings, aiFile } from '../platform/ai-settings';
import type { ApplicationContext } from '../services/application-context';

export function registerAiIPC(context: ApplicationContext) {
  const {
    readAISettings,
    aiFile,
    allowedProject,
    data,
    projectResult,
    activeAI,
  } = context;
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
      safeStorage.decryptString(Buffer.from(settings.encryptedKey, 'base64')),
    );
  });

  ipcMain.handle('ai:proposals', async (_event, directory) =>
    data.call('proposals', 'listAIProposals', [
      await allowedProject(directory),
    ]),
  );

  ipcMain.handle('ai:proposal-delete', async (_event, directory, id) =>
    data.call('proposals', 'deleteAIProposal', [
      await allowedProject(directory),
      id,
    ]),
  );

  ipcMain.handle('ai:proposal-apply', async (event, directory, id, input) => {
    const dir = await allowedProject(directory);
    await data.call('proposals', 'applyAIProposal', [dir, id, input]);
    return projectResult(dir, event.sender);
  });

  ipcMain.handle('ai:cancel', async (event, requestId) => {
    const id = z.string().uuid().parse(requestId),
      job = activeAI.get(id);
    if (job?.sender === event.sender.id) job.controller.abort();
  });

  ipcMain.handle('ai:suggest', async (event, directory, input, requestId) => {
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
      const prepared = await data.call<any>('proposals', 'prepareAIRequest', [
          dir,
          input,
        ]),
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
        safeStorage.decryptString(Buffer.from(settings.encryptedKey, 'base64')),
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
  });
}
