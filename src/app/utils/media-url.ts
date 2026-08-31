const R2_ORIGIN = 'https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev';

export function cachedMediaUrl(url: string): string {
  if (!url || !url.startsWith(`${R2_ORIGIN}/`)) return url;
  return `/api/media?url=${encodeURIComponent(url)}`;
}
