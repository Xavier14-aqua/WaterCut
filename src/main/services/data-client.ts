import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
export class DataClient {
  private worker: Worker;
  private failure: Error | null = null;
  private pending = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    progress?: (data: any) => void;
  }>();
  constructor() {
    this.worker = new Worker(path.join(__dirname, 'data-worker.cjs'));
    this.worker.on('message', message => {
      const request = this.pending.get(message.id);
      if (!request) return;
      if (message.progress) {
        request.progress?.(message.progress);
        return;
      }
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error));else request.resolve(message.result);
    });
    this.worker.on('error', error => {
      this.failure = error;
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    });
    this.worker.on('exit', code => {
      this.failure = new Error(`数据服务退出（${code}），请重启应用`);
      for (const request of this.pending.values()) request.reject(this.failure);
      this.pending.clear();
    });
  }
  call<T = any>(module: string, method: string, args: unknown[] = [], options?: {
    signal?: AbortSignal;
    onProgress?: (data: any) => void;
  }): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = () => this.worker.postMessage({
        cancel: id
      });
      if (options?.signal?.aborted) {
        reject(new Error('任务已取消'));
        return;
      }
      options?.signal?.addEventListener('abort', cancel, {
        once: true
      });
      this.pending.set(id, {
        resolve: value => {
          options?.signal?.removeEventListener('abort', cancel);
          resolve(value);
        },
        reject: error => {
          options?.signal?.removeEventListener('abort', cancel);
          reject(error);
        },
        progress: options?.onProgress
      });
      this.worker.postMessage({
        id,
        module,
        method,
        args,
        job: !!options
      });
    });
  }
  close() {
    return this.worker.terminate();
  }
}
