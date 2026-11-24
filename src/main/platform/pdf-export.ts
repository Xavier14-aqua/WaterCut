import { BrowserWindow, nativeImage } from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { storyboardHTML, escapeHTML } from '../../shared/print';
import type { PDFOptions, Project } from '../../shared/models';
import { checkCancelled, containedFile, type JobOptions } from '../../infrastructure/jobs/file-jobs';
export async function writeStoryboardPDF(project: Project, files: Array<{
  id: string;
  file: string | null;
  thumbnail: string;
  root: string;
}>, target: string, options: PDFOptions, job: JobOptions = {}) {
  checkCancelled(job.signal);
  const images: Record<string, string> = {};
  for (const item of files) {
    checkCancelled(job.signal);
    const asset = project.assets.find(a => a.id === item.id);
    if (!asset || asset.kind === 'audio' || !item.file || !existsSync(item.file)) continue;
    try {
      containedFile(item.root, item.file);
      const image = existsSync(item.thumbnail) ? nativeImage.createFromBuffer(readFileSync(containedFile(item.root, item.thumbnail))) : await nativeImage.createThumbnailFromPath(item.file, {
        width: 480,
        height: 270
      });
      if (!image.isEmpty()) images[item.id] = image.resize({
        width: 480
      }).toDataURL();
    } catch {/* Missing or unsupported images are printed as placeholders. */}
  }
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  window.webContents.setWindowOpenHandler(() => ({
    action: 'deny'
  }));
  const temporary = path.join(path.dirname(target), `.watercut-pdf-${randomUUID()}.partial`);
  const abort = () => {
    if (!window.isDestroyed()) window.destroy();
  };
  job.signal?.addEventListener('abort', abort, {
    once: true
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const output = (async () => {
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(storyboardHTML(project, options, images))}`);
      await window.webContents.executeJavaScript("Promise.all([document.fonts.ready,...[...document.images].map(image=>image.complete?Promise.resolve():new Promise(resolve=>{image.onload=image.onerror=resolve}))]).then(()=>true)");
      checkCancelled(job.signal);
      const bytes = await window.webContents.printToPDF({
        pageSize: 'A4',
        landscape: options.landscape,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: `<div style="font-family:'Microsoft YaHei',sans-serif;font-size:8px;width:100%;padding:0 12mm;color:#5c6d72">${escapeHTML(project.name)}</div>`,
        footerTemplate: '<div style="font-family:sans-serif;font-size:8px;width:100%;padding:0 12mm;color:#5c6d72;display:flex;justify-content:space-between"><span>WaterCut</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
        margins: {
          top: .5,
          bottom: .5,
          left: .4,
          right: .4
        }
      });
      checkCancelled(job.signal);
      if (bytes.length > 100 * 1024 * 1024) throw new Error('PDF 超过 100 MB，请分批导出');
      writeFileSync(temporary, bytes, {
        flag: 'wx'
      });
      checkCancelled(job.signal);
      renameSync(temporary, target);
      return target;
    })();
    return await Promise.race([output, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        abort();
        reject(new Error('PDF 生成超过 45 秒，请减少导出内容后重试'));
      }, 45000);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
    job.signal?.removeEventListener('abort', abort);
    abort();
    rmSync(temporary, {
      force: true
    });
  }
}
