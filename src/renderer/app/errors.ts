export function friendly(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .replace(/^Error invoking remote method '[^']+': Error: /, '')
    .replace(/ENOSPC.*/, '磁盘空间不足，请清理后重试');
}
