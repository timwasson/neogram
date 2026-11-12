/**
 * Non-destructive invariant for REMOTE deletions on a member's static host (Neocities, Nekoweb,
 * GitHub Pages): Neogram may only ever delete its own generated assets, i.e.
 *
 *   <deploy_path>/uploads/**   (images, thumbnails, comment ledgers)
 *   <deploy_path>/photos/**    (photo detail pages)
 *   <deploy_path>/avatar.webp
 *
 * Paths are checked segment by segment, never by substring: `neogram/uploads/../../index.html`
 * contains "uploads/" but resolves to the member's own homepage. Dot segments, empty segments,
 * backslashes, NUL bytes and percent-encoded separators/dots are refused outright.
 */
export function isSafeRemoteDeletePath(remotePath: unknown, deployPath: string): boolean {
  if (typeof remotePath !== 'string' || !remotePath || remotePath.length > 512) return false;
  if (/[\\\0]|%2e|%2f|%5c|%00/i.test(remotePath)) return false;

  const segments = remotePath.replace(/^\/+/, '').split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return false;

  const base = String(deployPath || '').replace(/^\/+|\/+$/g, '');
  const baseSegments = base ? base.split('/') : [];
  if (baseSegments.some((b, i) => segments[i] !== b)) return false;

  const rest = segments.slice(baseSegments.length);
  if (rest.length === 1 && rest[0] === 'avatar.webp') return true;
  return rest.length >= 2 && (rest[0] === 'uploads' || rest[0] === 'photos');
}
