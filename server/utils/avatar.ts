/**
 * Neogram Profile Avatar Resolution Utility
 * ==========================================
 * Enforces the Zero-Retention Profile Avatar Contract:
 *   1. Headless users (users not configured with remote static site publishing)
 *      ALWAYS receive a deterministic colored retro CRT default profile image.
 *   2. Users with a remote static site setup upload `avatar.webp` directly to
 *      their static host, and their canonical static image URL (`https://...`)
 *      is referenced everywhere across Neogram.
 *   3. Local `/uploads/avatars/...` paths are never served as custom avatars.
 */

export const DEFAULT_AVATAR_VARIANTS = [
  '/icons/default-avatar.svg',         // Classic Green Phosphor (#00ff66)
  '/icons/default-avatar-cyan.svg',    // Cyber Cyan (#00e5ff)
  '/icons/default-avatar-magenta.svg', // Synthwave Magenta (#ff00aa)
  '/icons/default-avatar-amber.svg',   // Vintage Amber CRT (#ffb000)
  '/icons/default-avatar-violet.svg',  // Electric Violet (#b366ff)
  '/icons/default-avatar-coral.svg',   // Arcade Coral (#ff4d6d)
] as const;

/**
 * Deterministically selects one of the colored retro CRT monitor avatars
 * based on the user's UIN, handle, or ID so different headless users have
 * visually distinct default profile images.
 */
export function getDefaultAvatarPath(seed?: string | number | null): string {
  if (seed === null || seed === undefined || seed === '') {
    return DEFAULT_AVATAR_VARIANTS[0];
  }

  if (typeof seed === 'number' && Number.isFinite(seed)) {
    const idx = Math.abs(Math.trunc(seed)) % DEFAULT_AVATAR_VARIANTS.length;
    return DEFAULT_AVATAR_VARIANTS[idx];
  }

  const str = String(seed).trim().toLowerCase();
  if (!str) return DEFAULT_AVATAR_VARIANTS[0];

  // If purely numeric string (e.g. UIN "100105"), use numeric modulo
  if (/^\d+$/.test(str)) {
    const num = parseInt(str, 10);
    if (Number.isFinite(num)) {
      return DEFAULT_AVATAR_VARIANTS[Math.abs(num) % DEFAULT_AVATAR_VARIANTS.length];
    }
  }

  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return DEFAULT_AVATAR_VARIANTS[hash % DEFAULT_AVATAR_VARIANTS.length];
}

/**
 * Returns true if the given path is one of the built-in default avatar SVGs.
 */
export function isDefaultAvatarPath(avatarPath?: string | null): boolean {
  if (!avatarPath || typeof avatarPath !== 'string') return true;
  const clean = avatarPath.trim();
  if (!clean) return true;
  return clean.includes('/icons/default-avatar');
}

/**
 * Returns true strictly if `avatarPath` is a remote static host URL (`http://` or `https://`)
 * and does NOT point to local Neogram `/uploads/avatars/` storage or a default SVG icon.
 */
export function isRemoteAvatarUrl(avatarPath?: string | null): boolean {
  if (!avatarPath || typeof avatarPath !== 'string') return false;
  const clean = avatarPath.trim();
  if (!/^https?:\/\//i.test(clean)) return false;
  if (clean.includes('/uploads/avatars/')) return false;
  if (clean.includes('/icons/default-avatar')) return false;
  return true;
}

export interface AvatarResolutionInput {
  avatarPath?: string | null;
  deploymentType?: string | null;
  hasRemotePublishing?: boolean;
  siteUrl?: string | null;
  uin?: number | string | null;
  handle?: string | null;
}

/**
 * Resolves the canonical avatar path for a user:
 * - If the user is headless / not configured for remote publishing, ALWAYS returns their colored default avatar.
 * - If the user has a remote site setup and a remote static avatar URL (`https://.../avatar.webp`), returns it.
 * - Otherwise returns their deterministic colored default avatar.
 */
export function resolveAvatarPath(input: AvatarResolutionInput): string {
  const seed = input.uin ?? input.handle ?? null;
  const defaultAvatar = getDefaultAvatarPath(seed);

  // If explicitly marked as not having remote publishing or deploymentType === 'none'
  if (input.hasRemotePublishing === false) {
    return defaultAvatar;
  }
  if (input.deploymentType && input.deploymentType === 'none') {
    return defaultAvatar;
  }
  if (input.siteUrl && input.siteUrl.includes('/user/')) {
    return defaultAvatar;
  }

  if (isRemoteAvatarUrl(input.avatarPath)) {
    return input.avatarPath!.trim();
  }

  return defaultAvatar;
}

