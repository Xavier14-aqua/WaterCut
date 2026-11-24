import type { ImportProgress } from '../../shared/models';

interface JobOwner {
  id: number;
  isDestroyed(): boolean;
  send(channel: 'asset:progress', progress: ImportProgress): void;
}

// File tasks are exclusive per sending window; cancellation settles before cleanup.
export function createFileJobs() {
  const activeImports = new Map<number, AbortController>();
  async function importJob<T>(
    sender: JobOwner,
    action: (options: {
      signal: AbortSignal;
      onProgress: (progress: ImportProgress) => void;
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
  return { activeImports, importJob };
}
