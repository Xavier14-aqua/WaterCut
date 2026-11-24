import { parentPort, workerData } from 'node:worker_threads';
import { open, stat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import mediaInfoFactory from 'mediainfo.js';
import { MEDIAINFO_WASM_SHA256, normalizeMediaInfo } from '../shared/media';
async function run() {
  const { file, wasm } = workerData as {
    file: string;
    wasm: string;
  };
  if (
    createHash('sha256')
      .update(await readFile(wasm))
      .digest('hex') !== MEDIAINFO_WASM_SHA256
  )
    throw new Error('媒体探测组件校验失败，请重新解压官方便携包');
  const info = await mediaInfoFactory({
    format: 'object',
    full: true,
    coverData: false,
    chunkSize: 256 * 1024,
    locateFile: () => wasm,
  });
  const handle = await open(file, 'r');
  try {
    const size = (await stat(file)).size;
    const result = await info.analyzeData(size, async (length, offset) => {
      if (length > 4 * 1024 * 1024 || offset < 0)
        throw new Error('媒体探测读取范围异常');
      const bytes = Buffer.alloc(Math.min(length, Math.max(0, size - offset)));
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset);
      return bytes.subarray(0, bytesRead);
    });
    parentPort!.postMessage({
      result: normalizeMediaInfo(result),
    });
  } finally {
    await handle.close();
    info.close();
  }
}
void run()
  .catch((error) =>
    parentPort!.postMessage({
      error: String(error.message ?? error),
    }),
  )
  .finally(() => parentPort!.close());
