import type { ScriptBlock } from './models';
export type ScriptSection = {
  id: string;
  heading: ScriptBlock | null;
  blocks: ScriptBlock[];
};
export function scriptSections(blocks: ScriptBlock[]): ScriptSection[] {
  const sections: ScriptSection[] = [];
  let current: ScriptSection | null = null;
  for (const block of blocks) {
    if (block.kind === 'heading') {
      current = {
        id: block.id,
        heading: block,
        blocks: []
      };
      sections.push(current);
    } else {
      if (!current) {
        current = {
          id: 'unsectioned',
          heading: null,
          blocks: []
        };
        sections.push(current);
      }
      current.blocks.push(block);
    }
  }
  return sections;
}
export function moveScriptItems(blocks: ScriptBlock[], moving: string[], target: string, after = false): string[] {
  const ids = blocks.map(b => b.id),
    set = new Set(moving);
  if (!moving.length || set.has(target) || !ids.includes(target) || moving.some(id => !ids.includes(id))) return ids;
  const rest = ids.filter(id => !set.has(id)),
    at = rest.indexOf(target);
  rest.splice(at + (after ? 1 : 0), 0, ...ids.filter(id => set.has(id)));
  return rest;
}
