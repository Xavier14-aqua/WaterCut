import type { Project, PDFOptions, ShotListFilter } from './models';
import { buildPreviewSequence } from './duration';
import { filterShotList } from './creative';
const statuses = {
  idea: '想法',
  written: '文案已定',
  to_shoot: '待拍',
  ready: '可用',
  locked: '定稿',
};
export function exportRows(
  project: Project,
  checklist = false,
  filter: ShotListFilter = {},
) {
  const ids = new Set(
    filterShotList(project, { onlyGaps: checklist, ...filter }).map(
      (s) => s.id,
    ),
  );
  return buildPreviewSequence(project)
    .filter((c) => ids.has(c.shot.id))
    .map((c) => ({
      id: c.shot.id,
      number: c.shot.position + 1,
      description: c.shot.description,
      dialogue: c.shot.actionDialogue,
      scene: c.shot.scene || '未分场景',
      timeOfDay: c.shot.timeOfDay || '昼夜待定',
      props: c.shot.props,
      productionState: {
        planned: '计划中',
        filmed: '已拍 / 已备齐',
        pickup: '需要补拍',
      }[c.shot.productionState],
      size: c.shot.shotSize || '未定',
      movement: c.shot.movement || '未定',
      durationMs: c.durationMs,
      status: statuses[c.shot.status],
      review: c.shot.needsReview ? c.shot.reviewNote || '待优化' : '',
      assetId: c.asset?.id ?? null,
      assetName: c.asset?.name ?? '暂无主画面',
      missing: !!c.asset?.missing,
      sources: project.shotSources
        .filter((s) => s.shotId === c.shot.id)
        .map((s) => s.excerpt)
        .join('\n'),
      warning: c.warning,
    }));
}
export function escapeHTML(value: unknown) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]!,
  );
}
export function textParts(text: string, max = 200): string[] {
  const result: string[] = [];
  let chunk = '',
    lines = 0;
  for (const c of text) {
    if (Array.from(chunk).length >= max || lines >= 6) {
      result.push(chunk);
      chunk = '';
      lines = 0;
    }
    chunk += c;
    if (c === '\n') lines++;
  }
  if (chunk || !result.length) result.push(chunk);
  return result;
}
export function storyboardHTML(
  project: Project,
  options: PDFOptions,
  images: Record<string, string>,
) {
  const rows = exportRows(project, options.checklist, options.filter),
    e = escapeHTML;
  let group = '';
  if (options.checklist)
    rows.sort(
      (a, b) =>
        a.scene.localeCompare(b.scene, 'zh-CN') ||
        a.timeOfDay.localeCompare(b.timeOfDay, 'zh-CN') ||
        a.number - b.number,
    );
  const body = rows
    .map((row) => {
      const metadata = `${row.size} · ${row.movement}\n${row.scene} / ${row.timeOfDay}\n${row.productionState}${row.props ? ' · 道具：' + row.props : ''}\n${(row.durationMs / 1000).toFixed(1)} 秒 · ${row.status}${row.warning ? '\n' + row.warning : ''}${row.review ? '\n待优化：' + row.review : ''}`;
      const sections = [
        textParts(row.description, options.landscape ? 220 : 150),
        textParts(row.dialogue, options.landscape ? 250 : 160),
        textParts(row.sources, options.landscape ? 180 : 120),
        textParts(metadata, options.landscape ? 120 : 90),
      ];
      const count = Math.max(...sections.map((parts) => parts.length));
      const heading =
        options.checklist && group !== `${row.scene} · ${row.timeOfDay}`
          ? `<tr class="group"><th colspan="6">${e((group = `${row.scene} · ${row.timeOfDay}`))}</th></tr>`
          : '';
      return (
        heading +
        Array.from(
          {
            length: count,
          },
          (_, index) =>
            `<tr><td class="number">${e(row.number)}${index ? '<small>续</small>' : ''}</td><td class="visual">${index ? '' : row.assetId && images[row.assetId] ? `<img src="${e(images[row.assetId])}" alt="主画面"/>` : `<div class="placeholder">${row.missing ? '素材缺失' : '暂无缩略图'}</div>`}${index ? '' : `<small>${e(Array.from(row.assetName).slice(0, 120).join(''))}</small>`}</td><td class="prose">${e(sections[0][index] ?? '')}</td><td class="prose">${e(sections[1][index] ?? '')}</td><td class="prose">${e(sections[3][index] ?? '')}</td><td class="prose source">${e(sections[2][index] ?? '')}</td></tr>`,
        ).join('')
      );
    })
    .join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; script-src 'none'"><title>${e(project.name)}</title><style>
    *{box-sizing:border-box}body{font-family:'Microsoft YaHei','Noto Sans CJK SC',sans-serif;color:#163039;font-size:${options.landscape ? '9' : '8.5'}pt;margin:0}h1{font-size:21pt;margin:0 0 7mm;overflow-wrap:anywhere}header{border-bottom:2px solid #357b79;margin-bottom:6mm;padding-bottom:3mm}.kicker{font-size:8pt;color:#357b79;letter-spacing:2px}header p{font-size:8pt;color:#53666d;margin:2mm 0}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}th{text-align:left;background:#e4f0ee;font-size:8pt}th,td{border:0.25mm solid #bccdce;padding:2.4mm;vertical-align:top;overflow-wrap:anywhere}tr{break-inside:avoid}p{margin:0 0 2mm}.prose{white-space:pre-wrap;line-height:1.7}.number{width:6%;font-weight:bold}.visual{width:18%}.visual img{width:100%;max-height:30mm;object-fit:contain}.visual small,td small{display:block;font-size:7pt;color:#64757a;overflow-wrap:anywhere;margin-top:1mm}.placeholder{height:18mm;display:flex;align-items:center;justify-content:center;background:#f0f3f3;color:#718185;font-size:8pt}.source{font-size:7.5pt;color:#52676b}.review{color:#9e4e2b}.group th{background:#d8eae5;font-size:10pt;padding:3mm}.empty{padding:15mm;border:1px solid #b7caca}
  </style></head><body><header><p class="kicker">WATERCUT · ${options.checklist ? 'SHOT LIST' : 'STORYBOARD'}</p><h1>${e(project.name)}</h1><p>${options.checklist ? '待拍 / 素材缺口清单' : '分镜脚本表'} · ${rows.length} 个镜头 · ${e(new Date().toLocaleDateString('zh-CN'))}</p><p>时长按当前剪辑区间或预计时长显示；长内容以续行完整保留。</p></header>${rows.length ? `<table><colgroup><col style="width:6%"><col style="width:18%"><col style="width:22%"><col style="width:25%"><col style="width:17%"><col style="width:12%"></colgroup><thead><tr><th>镜号</th><th>主画面</th><th>画面描述</th><th>动作 / 对白</th><th>拍摄信息</th><th>灵感来源</th></tr></thead><tbody>${body}</tbody></table>` : '<p class="empty">当前清单为空。</p>'}</body></html>`;
}
export function shotListCSV(
  project: Project,
  filter: ShotListFilter = { onlyGaps: true },
) {
  const rows = [
    [
      '镜头',
      '场景',
      '昼夜',
      '画面',
      '动作/对白',
      '时长（秒）',
      '状态',
      '缺口原因',
      '道具',
      '拍摄准备',
    ],
    ...exportRows(project, true, filter)
      .sort(
        (a, b) =>
          a.scene.localeCompare(b.scene, 'zh-CN') ||
          a.timeOfDay.localeCompare(b.timeOfDay, 'zh-CN') ||
          a.number - b.number,
      )
      .map((r) => [
        String(r.number),
        r.scene,
        r.timeOfDay,
        r.description,
        r.dialogue,
        (r.durationMs / 1000).toFixed(1),
        r.status,
        r.productionState === '需要补拍'
          ? '需要补拍'
          : r.status === '待拍'
            ? '标记待拍'
            : r.missing || r.assetId === null || r.warning
              ? '缺少可用主画面'
              : '',
        r.props,
        r.productionState,
      ]),
  ];
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map(
            (value) =>
              '"' +
              (/^[=+@\-\t\r]/.test(value) ? "'" : '') +
              value.replace(/"/g, '""') +
              '"',
          )
          .join(','),
      )
      .join('\r\n')
  );
}
