export function mediaUrl(scope: string, id: string, thumb = false) {
  return `watercut-media://asset/${encodeURIComponent(`${thumb ? 'thumb:' : ''}${scope}:${id}`)}`;
}
