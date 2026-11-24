import { parentPort } from 'node:worker_threads';
import * as project from '../modules/project/index';
import * as library from '../modules/library/index';
import * as workspace from '../modules/workspace/index';
import * as revisions from '../modules/delivery/revisions';
import * as packages from '../modules/delivery/project-package';
import * as media from '../modules/media/media';
import * as proposals from '../modules/ai/proposals';
import * as handoff from '../modules/delivery/jianying-handoff';
const modules: Record<string, Record<string, unknown>> = {
  project,
  library,
  workspace, revisions, packages, media,proposals,handoff
};
const controllers = new Map<string, AbortController>();
let queue: Promise<unknown> = Promise.resolve();
parentPort!.on('message', message => {
  if (message.cancel) {
    controllers.get(message.cancel)?.abort();
    return;
  }
  const {
    id,
    module,
    method,
    args,
    job
  } = message;
  const controller = job ? new AbortController() : undefined;
  if (controller) controllers.set(id,controller);
  queue = queue.catch(()=>undefined).then(async()=>{try {
    const fn = modules[module]?.[method];
    if (typeof fn !== 'function') throw new Error('未知数据操作');
    const values = [...args];
    if (job) {
      values.push({
        signal: controller!.signal,
        onProgress: (copied: number, total: number) => parentPort!.postMessage({
          id,
          progress: {
            copied,
            total,
            jobId: id
          }
        })
      });
    }
    const result = await fn(...values);
    parentPort!.postMessage({
      id,
      result
    });
  } catch (error) {
    parentPort!.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    controllers.delete(id);
  }});
});
