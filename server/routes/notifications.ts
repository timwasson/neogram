import { Router, Request, Response, NextFunction } from 'express';
import { extractToken, verifySessionToken } from '../auth/jwt';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../services/notificationService';
import {
  getVapidPublicKey,
  savePushSubscription,
  removePushSubscription,
  sendPushNotificationToUser,
} from '../services/webPushService';

export const notificationsRouter = Router();

/**
 * Authentication middleware for notification endpoints
 */
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ ok: false, error: 'Authentication required. Please connect your Cyber-Pass.' });
    return;
  }
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ ok: false, error: 'Session expired. Please log in again.' });
    return;
  }
  (req as any).user = payload;
  next();
}

notificationsRouter.use(['/notifications', '/settings/notifications'], requireAuth);

/**
 * 1. GET /api/notifications - List recent notifications and unread count
 */
notificationsRouter.get('/notifications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 30, 100);
    const data = await getNotifications(userId, limit);

    res.json({
      ok: true,
      notifications: data.notifications,
      unreadCount: data.unreadCount,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. POST /api/notifications/:id/read - Mark single notification as read
 */
notificationsRouter.post('/notifications/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;
    const updated = await markNotificationRead(userId, id);

    res.json({ ok: true, read: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * 3. POST /api/notifications/read-all - Mark all notifications as read
 */
notificationsRouter.post('/notifications/read-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const count = await markAllNotificationsRead(userId);

    res.json({ ok: true, markedCount: count });
  } catch (err) {
    next(err);
  }
});

/**
 * 4. GET /api/settings/notifications - Get station notification preferences
 */
notificationsRouter.get('/settings/notifications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const preferences = await getNotificationPreferences(userId);

    res.json({ ok: true, preferences });
  } catch (err) {
    next(err);
  }
});

/**
 * 5. PUT /api/settings/notifications - Update station notification preferences
 */
notificationsRouter.put('/settings/notifications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const {
      notifyNim,
      notifyFollow,
      notifyCommentOwn,
      notifyCommentThread,
      notifyGuestbook,
      notifyLike,
      notifyFriendPost,
      notifyDeploy,
      soundEnabled,
      desktopPush,
      allowAnonChat,
      allowAnonGuestbook,
      chatWidgetEnabled,
    } = req.body;

    const updated = await updateNotificationPreferences(userId, {
      notifyNim: typeof notifyNim === 'boolean' ? notifyNim : undefined,
      notifyFollow: typeof notifyFollow === 'boolean' ? notifyFollow : undefined,
      notifyCommentOwn: typeof notifyCommentOwn === 'boolean' ? notifyCommentOwn : undefined,
      notifyCommentThread: typeof notifyCommentThread === 'boolean' ? notifyCommentThread : undefined,
      notifyGuestbook: typeof notifyGuestbook === 'boolean' ? notifyGuestbook : undefined,
      notifyLike: typeof notifyLike === 'boolean' ? notifyLike : undefined,
      notifyFriendPost: typeof notifyFriendPost === 'boolean' ? notifyFriendPost : undefined,
      notifyDeploy: typeof notifyDeploy === 'boolean' ? notifyDeploy : undefined,
      soundEnabled: typeof soundEnabled === 'boolean' ? soundEnabled : undefined,
      desktopPush: typeof desktopPush === 'boolean' ? desktopPush : undefined,
      allowAnonChat: typeof allowAnonChat === 'boolean' ? allowAnonChat : undefined,
      allowAnonGuestbook: typeof allowAnonGuestbook === 'boolean' ? allowAnonGuestbook : undefined,
      chatWidgetEnabled: typeof chatWidgetEnabled === 'boolean' ? chatWidgetEnabled : undefined,
    });

    console.log(`[:> NOTIFY PREFS] Updated notification protocols for user ${userId}`);

    res.json({
      ok: true,
      message: 'Notification protocols saved successfully.',
      preferences: updated,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 6. GET /api/notifications/vapid-public-key - Retrieve public VAPID key for PushManager
 */
notificationsRouter.get('/notifications/vapid-public-key', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const publicKey = getVapidPublicKey();
    res.json({ ok: true, publicKey });
  } catch (err) {
    next(err);
  }
});

/**
 * 7. POST /api/notifications/push-subscription - Register/update device Web Push subscription
 */
notificationsRouter.post('/notifications/push-subscription', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { endpoint, keys, userAgent } = req.body;

    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      res.status(400).json({
        ok: false,
        error: 'Invalid push subscription payload: missing endpoint, p256dh, or auth.',
      });
      return;
    }

    await savePushSubscription(userId, {
      endpoint,
      keys,
      userAgent: userAgent || req.headers['user-agent'] || undefined,
    });

    res.json({
      ok: true,
      message: 'Web Push subscription registered successfully. Background alerts enabled.',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 8. DELETE /api/notifications/push-subscription - Unregister device Web Push subscription
 */
notificationsRouter.delete('/notifications/push-subscription', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { endpoint } = req.body;

    if (!endpoint) {
      res.status(400).json({ ok: false, error: 'Subscription endpoint is required.' });
      return;
    }

    const removed = await removePushSubscription(endpoint, userId);
    res.json({ ok: true, removed });
  } catch (err) {
    next(err);
  }
});

/**
 * 9. POST /api/notifications/test-push - Send a test push notification to user's registered devices
 */
notificationsRouter.post('/notifications/test-push', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const result = await sendPushNotificationToUser(userId, {
      title: '[:> NEOGRAM CYBERSPACE TEST]',
      body: 'Web Push handshake verified! Background push alert delivered via APNs.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      linkUrl: '/#settings',
      tag: `neogram-test-${Date.now()}`,
    });

    res.json({
      ok: true,
      sentCount: result.sentCount,
      failedCount: result.failedCount,
      prunedCount: result.prunedCount,
      message: result.sentCount > 0
        ? `Test alert dispatched to ${result.sentCount} registered device(s)! Lock your phone to test background delivery.`
        : 'No active device push subscriptions found for this station. Click "PERMIT BROWSER" on your device first.',
    });
  } catch (err) {
    next(err);
  }
});
