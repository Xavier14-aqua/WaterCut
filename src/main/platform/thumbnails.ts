import { nativeImage, type WebContents } from 'electron';
import path from 'node:path';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import type { Project } from '../../shared/models';

export async function thumbnail(
  file: string,
  target: string,
): Promise<string[]> {
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

export async function thumbnails(
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
