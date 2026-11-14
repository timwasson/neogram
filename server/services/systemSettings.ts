import { query } from '../db';

const DEFAULT_MARQUEE_TICKER =
  ':> NEOGRAM UNIX WORKSTATION // HYBRID MAC-SYSTEM7 + BSD-X11 // RETRO PHOTO PUBLISHING FOR NEOCITIES & PERSONAL SITES // 28.8K V.34 DIAL-UP OK // SYSTEM PROMPT READY_';

let cachedTicker: string | null = null;
let lastCacheUpdate: number = 0;
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

/**
 * Retrieves the active marquee announcement ticker.
 * Uses an in-memory cache to ensure zero latency overhead on normal page loads.
 */
export async function getTickerAnnouncement(): Promise<string> {
  const now = Date.now();
  if (cachedTicker !== null && now - lastCacheUpdate < CACHE_TTL_MS) {
    return cachedTicker;
  }

  try {
    const res = await query(
      "SELECT value FROM system_settings WHERE key = 'ticker_announcement' LIMIT 1"
    );
    if (res.rows.length > 0 && res.rows[0].value) {
      cachedTicker = String(res.rows[0].value).trim();
    } else {
      cachedTicker = DEFAULT_MARQUEE_TICKER;
    }
  } catch (_err) {
    // If table doesn't exist yet or DB issue, fall back to default
    cachedTicker = cachedTicker || DEFAULT_MARQUEE_TICKER;
  }

  lastCacheUpdate = now;
  return cachedTicker;
}

/**
 * Updates the marquee announcement ticker and logs the action to the audit ledger.
 */
export async function setTickerAnnouncement(
  newText: string,
  adminUser: { id: string; email: string },
  ipAddress?: string
): Promise<string> {
  const sanitized = newText.trim() || DEFAULT_MARQUEE_TICKER;

  await query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ('ticker_announcement', $1, NOW())
     ON CONFLICT (key) DO UPDATE
     SET value = EXCLUDED.value,
         updated_at = NOW()`,
    [sanitized]
  );

  cachedTicker = sanitized;
  lastCacheUpdate = Date.now();

  // Record audit log
  await logAdminAction({
    adminId: adminUser.id,
    adminEmail: adminUser.email,
    action: 'UPDATE_MARQUEE_TICKER',
    targetId: 'ticker_announcement',
    details: { newText: sanitized },
    ipAddress,
  });

  console.log(`[:> SYSOP] Marquee ticker updated by ${adminUser.email}: "${sanitized.slice(0, 60)}..."`);
  return sanitized;
}

export interface AdminAuditEntry {
  adminId?: string;
  adminEmail: string;
  action: string;
  targetId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
}

/**
 * Writes an entry into the immutable SysOp audit ledger.
 */
export async function logAdminAction(entry: AdminAuditEntry): Promise<void> {
  try {
    await query(
      `INSERT INTO admin_audit_logs (admin_id, admin_email, action, target_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.adminId || null,
        entry.adminEmail,
        entry.action,
        entry.targetId || null,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.ipAddress || null,
      ]
    );
  } catch (err) {
    console.error('[:> SYSOP AUDIT ERROR] Failed to record audit log:', err);
  }
}
