import type { Idea } from './models';

export function boardRegion(tags: string): string {
  return tags.split(/[,，;；\n]+/).map(tag => tag.trim().normalize('NFKC')).find(tag => tag.startsWith('分区:'))?.slice(3).trim() ?? '';
}

export function withBoardRegion(tags: string, region: string): string {
  const other = tags.split(/[,，;；\n]+/).map(tag => tag.trim()).filter(tag => tag && !tag.normalize('NFKC').startsWith('分区:'));
  return [...other, ...(region.trim() ? [`分区:${region.trim()}`] : [])].join(', ');
}

export function boardRegions(ideas: Idea[]) {
  const names = [...new Set(ideas.map(idea => boardRegion(idea.tags)).filter(Boolean))];
  return names.map(name => {
    const members = ideas.filter(idea => boardRegion(idea.tags) === name);
    const x = Math.min(...members.map(idea => idea.x)) - 25;
    const y = Math.min(...members.map(idea => idea.y)) - 45;
    return { name, x, y, width: Math.max(...members.map(idea => idea.x + (idea.kind === 'mood' ? 225 : 195))) - x + 25, height: Math.max(...members.map(idea => idea.y + 290)) - y + 25 };
  });
}
