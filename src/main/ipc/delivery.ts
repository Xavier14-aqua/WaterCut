import { dialog, ipcMain } from 'electron';
import path from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { writePlaceholders } from '../platform/placeholder-images';
import { buildTimelineDocument } from '../../shared/timeline';
import { removeJobDirectory } from '../../infrastructure/jobs/file-jobs';
import { shotListFilterSchema } from '../../shared/creative';
import { assertExternalDataRoot } from '../platform/storage-settings';
import { writeStoryboardPDF } from '../platform/pdf-export';
import { exportRows, shotListCSV } from '../../shared/print';
import { z } from 'zod';

import type { ApplicationContext } from '../services/application-context';

export function registerDeliveryIPC(context: ApplicationContext) {
  const {
    data,
    allowedProject,
    importJob,
    activeLibraryRoot,
    projectResult,
    activeProjectsRoot,
    knownProjects,
  } = context;
  ipcMain.handle('revision:list', async (_event, directory) =>
    data.call('revisions', 'listRevisions', [await allowedProject(directory)]),
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

  ipcMain.handle('project:export-package', async (event, directory, input) => {
    const dir = await allowedProject(directory),
      settings = z
        .object({
          includeHistory: z.boolean(),
          includeMedia: z.boolean(),
        })
        .parse(input);
    const project = await data.call('project', 'readProject', [dir]);
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
  });

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
      const p = await data.call(
        'packages',
        'importPackage',
        [choice.filePaths[0], activeProjectsRoot()],
        options,
      );
      knownProjects.add(path.resolve(p.directory).toLowerCase());
      return projectResult(p.directory, event.sender);
    });
  });

  ipcMain.handle('export:storyboard-pdf', async (event, directory, input) => {
    const dir = await allowedProject(directory),
      settings = z
        .object({
          landscape: z.boolean(),
          checklist: z.boolean(),
          filter: shotListFilterSchema.optional(),
        })
        .parse(input),
      root = activeLibraryRoot();
    const envelope = await data.call('workspace', 'projectEnvelope', [
      dir,
      root,
    ]);
    const rows = exportRows(
        envelope.project,
        settings.checklist,
        settings.filter,
      ),
      issues = rows
        .filter((r) => r.missing || r.warning)
        .map((r) => `镜头 ${r.number}：${r.missing ? '素材缺失' : r.warning}`);
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
  });

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
      const project = await data.call('workspace', 'hydrateProject', [
          dir,
          root,
        ]),
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
        project = await data.call('workspace', 'hydrateProject', [
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
}
