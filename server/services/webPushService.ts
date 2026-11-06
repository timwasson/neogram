import fs from 'fs';
import path from 'path';
import { generateVAPIDKeys, setVapidDetails, sendNotification } from 'web-push';
import { config } from '../config';
import { query } from '../db';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let cachedKeys: VapidKeys | null = null;
let isVapidConfigured = false;

/**
 * Initializes and retrieves the VAPID keypair for Web Push.
 * Priority:
 *  1. Environment variables (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)
 *  2. Local persistent cache (.vapid-keys.json)
 *  3. Auto-generated new keypair (written to .vapid-keys.json)
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

  // 2. Persistent file cache
  const keyFilePath = path.resolve(process.cwd(), '.vapid-keys.json');
  if (fs.existsSync(keyFilePath)) {
    try {
      const raw = fs.readFileSync(keyFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.publicKey && parsed.privateKey) {
        cachedKeys = {
          publicKey: parsed.publicKey,
          privateKey: parsed.privateKey,
        };
        initWebPush(cachedKeys);
        return cachedKeys;
      }
    } catch (err) {
      console.warn('[:> WEB PUSH] Could not read existing .vapid-keys.json:', err);
    }
  }

  // 3. Auto-generate new VAPID keys
  try {
    const generated = generateVAPIDKeys();
    cachedKeys = {
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
    };
    try {
      fs.writeFileSync(keyFilePath, JSON.stringify(cachedKeys, null, 2), { mode: 0o600 });
      console.log('[:> WEB PUSH] Generated new persistent VAPID keypair in .vapid-keys.json');
    } catch (writeErr) {
      console.warn('[:> WEB PUSH WARNING] Could not persist .vapid-keys.json to disk:', writeErr);
    }
    initWebPush(cachedKeys);
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

  // Ensure VAPID is initialized
  getVapidKeys();

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
    getVapidKeys();
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
      // HTTP 404 Not Found or 410 Gone means the subscription is permanently invalid
      if (statusCode === 404 || statusCode === 410) {
        console.log(`[:> WEB PUSH PRUNE] Subscription expired (HTTP ${statusCode}). Removing endpoint: ${row.endpoint.slice(0, 45)}...`);
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
