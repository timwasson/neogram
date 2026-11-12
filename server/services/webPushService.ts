import fs from 'fs';
import path from 'path';
import { generateVAPIDKeys, setVapidDetails, sendNotification } from 'web-push';
import { config } from '../config';
import { query } from '../db';
import { encryptCredentials, decryptCredentials } from '../utils/crypto';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

const VAPID_SETTINGS_KEY = 'vapid_keys_v1';

let cachedKeys: VapidKeys | null = null;
let isVapidConfigured = false;
let initPromise: Promise<VapidKeys> | null = null;

function readLocalOrGenerateVapidKeys(): VapidKeys {
  const keyFilePath = path.resolve(process.cwd(), '.vapid-keys.json');
  if (fs.existsSync(keyFilePath)) {
    try {
      const raw = fs.readFileSync(keyFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.publicKey && parsed.privateKey) {
        return {
          publicKey: String(parsed.publicKey).trim(),
          privateKey: String(parsed.privateKey).trim(),
        };
      }
    } catch (err) {
      console.warn('[:> WEB PUSH] Could not read existing .vapid-keys.json:', err);
    }
  }

  const generated = generateVAPIDKeys();
  const keys: VapidKeys = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
  };
  try {
    fs.writeFileSync(keyFilePath, JSON.stringify(keys, null, 2), { mode: 0o600 });
    console.log('[:> WEB PUSH] Generated new persistent VAPID keypair in .vapid-keys.json');
  } catch (writeErr) {
    console.warn('[:> WEB PUSH WARNING] Could not persist .vapid-keys.json to disk:', writeErr);
  }
  return keys;
}

async function persistVapidKeysToDatabase(keys: VapidKeys): Promise<VapidKeys> {
  try {
    const encryptedPayload = encryptCredentials(keys).toString('base64');
    await query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO NOTHING`,
      [VAPID_SETTINGS_KEY, encryptedPayload]
    );

    const res = await query(
      `SELECT value FROM system_settings WHERE key = $1 LIMIT 1`,
      [VAPID_SETTINGS_KEY]
    );
    if (res.rows.length > 0 && res.rows[0].value) {
      const stored = decryptCredentials<VapidKeys>(res.rows[0].value);
      if (stored && stored.publicKey && stored.privateKey) {
        return {
          publicKey: String(stored.publicKey).trim(),
          privateKey: String(stored.privateKey).trim(),
        };
      }
    }
  } catch (err) {
    console.warn('[:> WEB PUSH WARNING] Could not persist VAPID keys in system_settings:', err);
  }
  return keys;
}

/**
 * Asynchronously initializes and retrieves the VAPID keypair, persisting
 * auto-generated keys in PostgreSQL (system_settings) so they survive
 * stateless Docker container rebuilds and redeployments.
 *
 * Priority:
 *  1. Environment variables (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)
 *  2. PostgreSQL system_settings ('vapid_keys_v1', AES-256-GCM encrypted)
 *  3. Local cache (.vapid-keys.json) or auto-generated keypair -> saved to PostgreSQL
 */
export async function ensureVapidKeys(): Promise<VapidKeys> {
  if (cachedKeys) {
    return cachedKeys;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      // 1. Environment variables
      if (config.vapidPublicKey && config.vapidPrivateKey) {
        cachedKeys = {
          publicKey: config.vapidPublicKey.trim(),
          privateKey: config.vapidPrivateKey.trim(),
        };
        initWebPush(cachedKeys);
        return cachedKeys;
      }

      // 2. PostgreSQL persistent system_settings ledger
      try {
        const res = await query(
          `SELECT value FROM system_settings WHERE key = $1 LIMIT 1`,
          [VAPID_SETTINGS_KEY]
        );
        if (res.rows.length > 0 && res.rows[0].value) {
          const decrypted = decryptCredentials<VapidKeys>(res.rows[0].value);
          if (decrypted && decrypted.publicKey && decrypted.privateKey) {
            cachedKeys = {
              publicKey: String(decrypted.publicKey).trim(),
              privateKey: String(decrypted.privateKey).trim(),
            };
            initWebPush(cachedKeys);
            console.log('[:> WEB PUSH] Loaded persistent VAPID keypair from PostgreSQL system_settings');
            return cachedKeys;
          }
        }
      } catch (dbReadErr) {
        console.warn('[:> WEB PUSH] Could not read VAPID keys from system_settings:', dbReadErr);
      }

      // 3. Fallback to local file or generate new, then persist into PostgreSQL
      const fallbackKeys = readLocalOrGenerateVapidKeys();
      const canonicalKeys = await persistVapidKeysToDatabase(fallbackKeys);
      cachedKeys = canonicalKeys;
      initWebPush(cachedKeys);
      console.log('[:> WEB PUSH] Persisted VAPID keypair to PostgreSQL system_settings');
      return cachedKeys;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

/**
 * Synchronously retrieves the active VAPID keypair.
 * In production, ensureVapidKeys() is awaited at server boot so cachedKeys is already populated.
 */
export function getVapidKeys(): VapidKeys {
  if (cachedKeys) {
    return cachedKeys;
  }

  // 1. Environment variables
  if (config.vapidPublicKey && config.vapidPrivateKey) {
    cachedKeys = {
      publicKey: config.vapidPublicKey.trim(),
      privateKey: config.vapidPrivateKey.trim(),
    };
    initWebPush(cachedKeys);
    return cachedKeys;
  }

  // 2. Synchronous fallback (e.g. unit tests creating app without full bootstrap)
  try {
    const keys = readLocalOrGenerateVapidKeys();
    cachedKeys = keys;
    initWebPush(cachedKeys);
    void persistVapidKeysToDatabase(keys).then((canonical) => {
      if (canonical.publicKey !== keys.publicKey) {
        cachedKeys = canonical;
        isVapidConfigured = false;
        initWebPush(cachedKeys);
      }
    });
    return cachedKeys;
  } catch (genErr) {
    console.error('[:> WEB PUSH FATAL] Failed to generate VAPID keys:', genErr);
    throw genErr;
  }
}

/**
 * Returns the VAPID public key string for client pushManager subscription.
 */
export function getVapidPublicKey(): string {
  return getVapidKeys().publicKey;
}

function initWebPush(keys: VapidKeys) {
  if (isVapidConfigured) return;
  try {
    setVapidDetails(config.vapidSubject, keys.publicKey, keys.privateKey);
    isVapidConfigured = true;
    console.log(`[:> WEB PUSH] VAPID details registered (Subject: ${config.vapidSubject})`);
  } catch (err) {
    console.error('[:> WEB PUSH ERROR] Failed to set VAPID details:', err);
  }
}

export interface PushSubscriptionPayload {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
}

const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 20;

// The server POSTs to subscription endpoints (test-push, every notification). Restricting them to the
// real browser push services keeps that from becoming an SSRF / internal port-scanning primitive.
const PUSH_SERVICE_HOST_SUFFIXES = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
];

export function isAllowedPushEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    const host = u.hostname.toLowerCase();
    return PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

/**
 * Saves or updates a user's push subscription in PostgreSQL.
 */
export async function savePushSubscription(
  userId: string,
  sub: PushSubscriptionPayload
): Promise<boolean> {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    throw new Error('Invalid push subscription payload: missing endpoint, p256dh, or auth key.');
  }
  if (!isAllowedPushEndpoint(sub.endpoint)) {
    throw new Error('Invalid push subscription endpoint: must be an https URL on a known browser push service.');
  }
  if (typeof sub.keys.p256dh !== 'string' || sub.keys.p256dh.length > 256 || typeof sub.keys.auth !== 'string' || sub.keys.auth.length > 128) {
    throw new Error('Invalid push subscription keys.');
  }
  const countRes = await query('SELECT COUNT(*) as count FROM push_subscriptions WHERE user_id = $1 AND endpoint <> $2', [userId, sub.endpoint]);
  if (parseInt(countRes.rows[0]?.count || '0', 10) >= MAX_PUSH_SUBSCRIPTIONS_PER_USER) {
    throw new Error('Too many registered push devices. Remove an old device first.');
  }

  // Ensure VAPID is initialized
  await ensureVapidKeys();

  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent,
       updated_at = NOW()`,
    [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, sub.userAgent || null]
  );

  // Enable desktop_push preference flag for this user
  await query(
    `INSERT INTO notification_preferences (user_id, desktop_push, updated_at)
     VALUES ($1, TRUE, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       desktop_push = TRUE,
       updated_at = NOW()`,
    [userId]
  );

  console.log(`[:> WEB PUSH] Stored push subscription for user ${userId} (${sub.endpoint.slice(0, 45)}...)`);
  return true;
}

/**
 * Deletes a push subscription by endpoint.
 */
export async function removePushSubscription(endpoint: string, userId?: string): Promise<boolean> {
  if (!endpoint) return false;
  if (userId) {
    const res = await query(
      `DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`,
      [endpoint, userId]
    );
    return (res.rowCount ?? 0) > 0;
  }
  const res = await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
  return (res.rowCount ?? 0) > 0;
}

export interface WebPushNotificationData {
  title: string;
  body?: string | null;
  icon?: string | null;
  badge?: string | null;
  linkUrl?: string | null;
  tag?: string | null;
  data?: Record<string, any>;
}

/**
 * Dispatches a native Web Push payload to all active push subscriptions registered by the user.
 * Prunes expired or deactivated subscriptions (HTTP 404 / 410 Gone).
 */
export async function sendPushNotificationToUser(
  userId: string,
  data: WebPushNotificationData
): Promise<{ sentCount: number; failedCount: number; prunedCount: number }> {
  try {
    await ensureVapidKeys();
  } catch (err) {
    console.warn('[:> WEB PUSH] Skipping push dispatch: VAPID keys unconfigured.', err);
    return { sentCount: 0, failedCount: 0, prunedCount: 0 };
  }

  const res = await query(
    `SELECT endpoint, p256dh, auth
     FROM push_subscriptions
     WHERE user_id = $1`,
    [userId]
  );

  if (res.rows.length === 0) {
    return { sentCount: 0, failedCount: 0, prunedCount: 0 };
  }

  const payloadString = JSON.stringify({
    title: data.title,
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    linkUrl: data.linkUrl || '/',
    tag: data.tag || `neogram-${Date.now()}`,
    data: {
      url: data.linkUrl || '/',
      ...(data.data || {}),
    },
  });

  let sentCount = 0;
  let failedCount = 0;
  let prunedCount = 0;

  const pushPromises = res.rows.map(async (row) => {
    const pushSubscription = {
      endpoint: row.endpoint,
      keys: {
        p256dh: row.p256dh,
        auth: row.auth,
      },
    };

    try {
      await sendNotification(pushSubscription, payloadString, {
        TTL: 86400, // 24 hours store-and-forward in APNs / FCM
        urgency: 'high',
      });
      sentCount++;
      console.log(`[:> WEB PUSH SUCCESS] Delivered push packet to endpoint ${row.endpoint.slice(0, 45)}...`);
    } catch (err: any) {
      failedCount++;
      const statusCode = err.statusCode || err.status;
      const errBody = typeof err.body === 'string' ? err.body : '';
      const isVapidMismatch =
        statusCode === 401 ||
        statusCode === 403 ||
        errBody.includes('VapidPkHashMismatch') ||
        errBody.includes('BadJwtToken');
      // HTTP 404/410 (expired) or 401/403/VapidPkHashMismatch (bound to rotated VAPID key) are permanently invalid
      if (statusCode === 404 || statusCode === 410 || isVapidMismatch) {
        console.log(`[:> WEB PUSH PRUNE] Subscription invalid (HTTP ${statusCode}). Removing endpoint: ${row.endpoint.slice(0, 45)}...`);
        try {
          await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [row.endpoint]);
          prunedCount++;
        } catch (dbErr) {
          console.warn('[:> WEB PUSH PRUNE ERROR] Could not delete expired subscription:', dbErr);
        }
      } else {
        console.warn(`[:> WEB PUSH WARN] Delivery failed for endpoint ${row.endpoint.slice(0, 45)}...:`, err.message || err);
      }
    }
  });

  await Promise.all(pushPromises);
  return { sentCount, failedCount, prunedCount };
}
