import type { Project } from '../../../shared/models';
import type { SaveTask } from './types';

interface SaveHandlers {
  currentProjectId: () => string | undefined;
  apply: (project: Project) => void;
  notify: (message: string) => void;
  formatError: (error: unknown) => string;
}

/** One serial queue owns debouncing, retries and the save barrier for a workbench. */
export class SaveCoordinator {
  private pending = new Map<string, SaveTask>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private handlers: SaveHandlers,
    private delayMs = 500,
  ) {}

  updateHandlers(handlers: SaveHandlers) {
    this.handlers = handlers;
  }

  private taskKey(projectId: string, key: string) {
    return `${projectId}:${key}`;
  }

  hasPending(projectId: string, key: string) {
    return this.pending.has(this.taskKey(projectId, key));
  }

  schedule(projectId: string, key: string, action: () => Promise<Project>) {
    const id = this.taskKey(projectId, key);
    const previous = this.timers.get(id);
    if (previous) clearTimeout(previous);
    this.pending.set(id, { projectId, key, action });
    this.handlers.notify('未保存');
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        const task = this.pending.get(id);
        this.pending.delete(id);
        if (task) void this.enqueue(task).catch(() => undefined);
      }, this.delayMs),
    );
  }

  private enqueue(task: SaveTask) {
    this.chain = this.chain
      .catch(() => undefined)
      .then(async () => {
        this.handlers.notify('保存中…');
        try {
          const project = await task.action();
          // A late response belongs to the project that created the task. It must
          // never reopen an old project after the workbench has moved elsewhere.
          if (
            this.handlers.currentProjectId() === task.projectId &&
            project.id === task.projectId
          ) {
            this.handlers.apply(project);
          }
          if (!this.pending.size) this.handlers.notify('已保存');
        } catch (error) {
          const id = this.taskKey(task.projectId, task.key);
          // Preserve a newer edit for the same field when an older write fails.
          if (!this.pending.has(id)) this.pending.set(id, task);
          this.handlers.notify(
            `保存失败，请重试：${this.handlers.formatError(error)}`,
          );
          throw error;
        }
      });
    return this.chain;
  }

  async flush() {
    this.clearTimers();
    const tasks = [...this.pending.values()];
    this.pending.clear();
    const outcomes = await Promise.allSettled(
      tasks.map((task) => this.enqueue(task)),
    );
    await this.chain.catch(() => undefined);
    if (
      outcomes.some((result) => result.status === 'rejected') ||
      this.pending.size
    ) {
      throw new Error('部分编辑尚未保存，请检查失败提示后重试');
    }
  }

  clearTimers() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
