import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';

import { deflateSync } from 'node:zlib';

import path from 'node:path';

import { randomUUID } from 'node:crypto';

import * as projects from '../project/index';

import * as library from '../library/index';

import type { LibraryAsset, Project } from '../../shared/models';

import { attachAssets, attachIdeas } from './project-library';

export function examplePng(seed: number): Buffer {
  const width = 640,
    height = 360,
    pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const offset = y * (width * 4 + 1);
    for (let x = 0; x < width; x++) {
      const p = offset + 1 + x * 4,
        light = Math.max(
          0,
          1 - Math.hypot(x - width * 0.65, y - height * 0.3) / width,
        ),
        street = y > height * 0.7;
      pixels[p] = Math.round(
        (seed === 1 ? 120 : 32) + light * 50 + (street ? 20 : 0),
      );
      pixels[p + 1] = Math.round((seed === 2 ? 90 : 65) + light * 55);
      pixels[p + 2] = Math.round((seed === 1 ? 80 : 95) + light * 40);
      pixels[p + 3] = 255;
    }
  }
  function crc32(bytes: Buffer) {
    let crc = 0xffffffff;
    for (const b of bytes) {
      crc ^= b;
      for (let n = 0; n < 8; n++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type: string, content: Buffer) {
    const name = Buffer.from(type),
      length = Buffer.alloc(4),
      crc = Buffer.alloc(4);
    length.writeUInt32BE(content.length);
    crc.writeUInt32BE(crc32(Buffer.concat([name, content])));
    return Buffer.concat([length, name, content, crc]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function createExample(
  projectsRoot: string,
  root: string,
): Promise<Project> {
  const previous = library.operationMapping(root, 'example:v1');
  if (
    previous.directory &&
    existsSync(path.join(previous.directory, 'project.sqlite'))
  )
    return projects.readProject(previous.directory);
  const project = projects.createProject(
    projectsRoot,
    'WaterCut 示例 · 雨后散步',
  );
  const cardContents = [
    {
      kind: 'mood' as const,
      text: '雨停之后的松弛与一点孤独',
      tags: '雨后，松弛，分区:开场',
      notes: '给全片定调',
      payload: {
        colors: ['#497b88', '#e7bd84'],
        rhythm: '先静后动',
        timeOfDay: '黄昏',
        weather: '雨后',
        environment: '街道',
        location: '',
        props: '',
      },
      occurredAt: null,
    },
    {
      kind: 'scene' as const,
      text: '脚步掠过水洼，霓虹在反光中摇动',
      tags: '雨后，街道，分区:开场',
      notes: '用细节过渡到人物',
      payload: {
        colors: [],
        rhythm: '',
        timeOfDay: '黄昏',
        weather: '雨后',
        environment: '街道',
        location: '路口',
        props: '水洼',
      },
      occurredAt: null,
    },
    {
      kind: 'scene' as const,
      text: '走进便利店买一杯热饮，故事落回日常',
      tags: '街道，温暖，分区:落幕',
      notes: '结尾留两秒空白',
      payload: {
        colors: [],
        rhythm: '',
        timeOfDay: '夜晚',
        weather: '',
        environment: '便利店',
        location: '',
        props: '纸杯',
      },
      occurredAt: null,
    },
  ];
  const ids = cardContents.map(
    (data) => library.saveLibraryIdea(root, data).id,
  );
  library.connectLibraryIdeas(root, ids[1], ids[2], 'sequence', '声音先入');
  attachIdeas(project.directory, root, ids);
  const p = projects.readProject(project.directory);
  projects.createShotsFromIdeas(
    project.directory,
    p.ideas.map((i) => i.id),
    randomUUID(),
    [
      {
        description: '雨后街道远景，行人稀疏',
        actionDialogue: '雨终于停了。',
        durationMs: 3500,
      },
      {
        description: '脚步掠过水洼，霓虹轻晃',
        actionDialogue: '只想慢慢走一会儿。',
        durationMs: 2500,
      },
      {
        description: '手推开便利店的玻璃门',
        actionDialogue: '（门铃声）',
        durationMs: 2000,
      },
      {
        description: '热饮杯口的蒸汽，近景',
        actionDialogue: '一杯热的。',
        durationMs: 3000,
      },
      {
        description: '背影继续走进夜色，渐静',
        actionDialogue: '明天的事，明天再说。',
        durationMs: 4000,
      },
    ],
  );
  const images: LibraryAsset[] = [];
  mkdirSync(path.join(root, 'jobs'), {
    recursive: true,
  });
  for (let index = 0; index < 3; index++) {
    const file = path.join(root, 'jobs', `example-${randomUUID()}.png`);
    try {
      writeFileSync(file, examplePng(index));
      images.push(await library.importLibraryAsset(root, file));
    } finally {
      rmSync(file, {
        force: true,
      });
    }
  }
  attachAssets(
    project.directory,
    root,
    images.map((a) => a.id),
  );
  const completed = projects.readProject(project.directory);
  for (const index of [0, 1, 3])
    projects.linkAsset(
      project.directory,
      completed.shots[index].id,
      completed.assets[index === 3 ? 2 : index].id,
    );
  library.saveOperation(
    root,
    'example:v1',
    {
      directory: project.directory,
    },
    'done',
  );
  return projects.readProject(project.directory);
}
