import { query } from '../db';
import { activeSockets } from './chatSocket';
import { WebSocket } from 'ws';

export type NotificationType =
  | 'nim'
  | 'follow'
  | 'comment_own'
  | 'comment_thread'
  | 'guestbook'
  | 'like'
  | 'friend_post'
  | 'deploy';

export interface NotificationPreferences {
  userId: string;
  notifyNim: boolean;
  notifyFollow: boolean;
  notifyCommentOwn: boolean;
  notifyCommentThread: boolean;
  notifyGuestbook: boolean;
  notifyLike: boolean;
  notifyFriendPost: boolean;
  notifyDeploy: boolean;
  soundEnabled: boolean;
  desktopPush: boolean;
  allowAnonChat: boolean;
  chatWidgetEnabled: boolean;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  actorId?: string | null;
  actorHandle?: string | null;
  actorAvatar?: string | null;
  type: NotificationType;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
  icon: string;
  isRead: boolean;
  createdAt: string;
}

export const DEFAULT_PREFERENCES: Omit<NotificationPreferences, 'userId'> = {
  notifyNim: true,
  notifyFollow: true,
  notifyCommentOwn: true,
  notifyCommentThread: true,
  notifyGuestbook: true,
  notifyLike: true,
  notifyFriendPost: true,
  notifyDeploy: true,
  soundEnabled: true,
  desktopPush: false,
  allowAnonChat: true,
  chatWidgetEnabled: true,
};

/**
 * Maps a NotificationType to the corresponding boolean preference key.
 */
function getPreferenceKey(type: NotificationType): keyof Omit<NotificationPreferences, 'userId' | 'soundEnabled' | 'desktopPush' | 'allowAnonChat' | 'chatWidgetEnabled'> {
  switch (type) {
    case 'nim':
      return 'notifyNim';
    case 'follow':
      return 'notifyFollow';
    case 'comment_own':
      return 'notifyCommentOwn';
    case 'comment_thread':
      return 'notifyCommentThread';
    case 'guestbook':
      return 'notifyGuestbook';
    case 'like':
      return 'notifyLike';
    case 'friend_post':
      return 'notifyFriendPost';
    case 'deploy':
      return 'notifyDeploy';
  }
}

/**
 * Retrieves the notification preferences for a station, provisioning defaults if needed.
 */
export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const res = await query(
    `SELECT user_id as "userId",
            notify_nim as "notifyNim",
            notify_follow as "notifyFollow",
            notify_comment_own as "notifyCommentOwn",
            notify_comment_thread as "notifyCommentThread",
            notify_guestbook as "notifyGuestbook",
            notify_like as "notifyLike",
            notify_friend_post as "notifyFriendPost",
            notify_deploy as "notifyDeploy",
            sound_enabled as "soundEnabled",
            desktop_push as "desktopPush",
            allow_anon_chat as "allowAnonChat",
            chat_widget_enabled as "chatWidgetEnabled"
     FROM notification_preferences
     WHERE user_id = $1`,
    [userId]
  );

  if (res.rows.length > 0) {
    const row = res.rows[0];
    return {
      userId,
      notifyNim: !!row.notifyNim,
      notifyFollow: !!row.notifyFollow,
      notifyCommentOwn: !!row.notifyCommentOwn,
      notifyCommentThread: !!row.notifyCommentThread,
      notifyGuestbook: !!row.notifyGuestbook,
      notifyLike: !!row.notifyLike,
      notifyFriendPost: !!row.notifyFriendPost,
      notifyDeploy: !!row.notifyDeploy,
      soundEnabled: !!row.soundEnabled,
      desktopPush: !!row.desktopPush,
      allowAnonChat: row.allowAnonChat !== false,
      chatWidgetEnabled: row.chatWidgetEnabled !== false,
    };
  }

  // Provision default preferences row
  await query(
    `INSERT INTO notification_preferences (
       user_id, notify_nim, notify_follow, notify_comment_own, notify_comment_thread,
       notify_guestbook, notify_like, notify_friend_post, notify_deploy, sound_enabled, desktop_push,
       allow_anon_chat, chat_widget_enabled
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (user_id) DO NOTHING`,
    [
      userId,
      DEFAULT_PREFERENCES.notifyNim,
      DEFAULT_PREFERENCES.notifyFollow,
      DEFAULT_PREFERENCES.notifyCommentOwn,
      DEFAULT_PREFERENCES.notifyCommentThread,
      DEFAULT_PREFERENCES.notifyGuestbook,
      DEFAULT_PREFERENCES.notifyLike,
      DEFAULT_PREFERENCES.notifyFriendPost,
      DEFAULT_PREFERENCES.notifyDeploy,
      DEFAULT_PREFERENCES.soundEnabled,
      DEFAULT_PREFERENCES.desktopPush,
      DEFAULT_PREFERENCES.allowAnonChat,
      DEFAULT_PREFERENCES.chatWidgetEnabled,
    ]
  );

  return { userId, ...DEFAULT_PREFERENCES };
}

/**
 * Updates a user's notification preferences.
 */
export async function updateNotificationPreferences(
  userId: string,
  updates: Partial<Omit<NotificationPreferences, 'userId'>>
): Promise<NotificationPreferences> {
  const current = await getNotificationPreferences(userId);

  const updated: NotificationPreferences = {
    userId,
    notifyNim: updates.notifyNim !== undefined ? updates.notifyNim : current.notifyNim,
    notifyFollow: updates.notifyFollow !== undefined ? updates.notifyFollow : current.notifyFollow,
    notifyCommentOwn: updates.notifyCommentOwn !== undefined ? updates.notifyCommentOwn : current.notifyCommentOwn,
    notifyCommentThread: updates.notifyCommentThread !== undefined ? updates.notifyCommentThread : current.notifyCommentThread,
    notifyGuestbook: updates.notifyGuestbook !== undefined ? updates.notifyGuestbook : current.notifyGuestbook,
    notifyLike: updates.notifyLike !== undefined ? updates.notifyLike : current.notifyLike,
    notifyFriendPost: updates.notifyFriendPost !== undefined ? updates.notifyFriendPost : current.notifyFriendPost,
    notifyDeploy: updates.notifyDeploy !== undefined ? updates.notifyDeploy : current.notifyDeploy,
    soundEnabled: updates.soundEnabled !== undefined ? updates.soundEnabled : current.soundEnabled,
    desktopPush: updates.desktopPush !== undefined ? updates.desktopPush : current.desktopPush,
    allowAnonChat: updates.allowAnonChat !== undefined ? updates.allowAnonChat : current.allowAnonChat,
    chatWidgetEnabled: updates.chatWidgetEnabled !== undefined ? updates.chatWidgetEnabled : current.chatWidgetEnabled,
  };

  await query(
    `INSERT INTO notification_preferences (
       user_id, notify_nim, notify_follow, notify_comment_own, notify_comment_thread,
       notify_guestbook, notify_like, notify_friend_post, notify_deploy, sound_enabled, desktop_push,
       allow_anon_chat, chat_widget_enabled, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       notify_nim = EXCLUDED.notify_nim,
       notify_follow = EXCLUDED.notify_follow,
       notify_comment_own = EXCLUDED.notify_comment_own,
       notify_comment_thread = EXCLUDED.notify_comment_thread,
       notify_guestbook = EXCLUDED.notify_guestbook,
       notify_like = EXCLUDED.notify_like,
       notify_friend_post = EXCLUDED.notify_friend_post,
       notify_deploy = EXCLUDED.notify_deploy,
       sound_enabled = EXCLUDED.sound_enabled,
       desktop_push = EXCLUDED.desktop_push,
       allow_anon_chat = EXCLUDED.allow_anon_chat,
       chat_widget_enabled = EXCLUDED.chat_widget_enabled,
       updated_at = NOW()`,
    [
      userId,
      updated.notifyNim,
      updated.notifyFollow,
      updated.notifyCommentOwn,
      updated.notifyCommentThread,
      updated.notifyGuestbook,
      updated.notifyLike,
      updated.notifyFriendPost,
      updated.notifyDeploy,
      updated.soundEnabled,
      updated.desktopPush,
      updated.allowAnonChat,
      updated.chatWidgetEnabled,
    ]
  );

  return updated;
}

/**
 * Dispatches an in-app notification if the recipient's preference allows it.
 * Persists to PostgreSQL inbox and broadcasts via WebSocket.
 */
export async function dispatchNotification(params: {
  userId: string;
  actorId?: string | null;
  type: NotificationType;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
  icon?: string;
}): Promise<NotificationRecord | null> {
  try {
    const prefs = await getNotificationPreferences(params.userId);
    const prefKey = getPreferenceKey(params.type);

    // If user has toggled off notifications for this event type
    if (!prefs[prefKey]) {
      console.log(`[:> NOTIFY MUTED] Suppressed ${params.type} notification for user ${params.userId} per settings.`);
      return null;
    }

    const icon = params.icon || defaultIconForType(params.type);

    // Insert persistent notification into database
    const insertRes = await query(
      `INSERT INTO notifications (user_id, actor_id, type, title, body, link_url, icon)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id as "userId", actor_id as "actorId", type, title, body, link_url as "linkUrl", icon, is_read as "isRead", created_at as "createdAt"`,
      [params.userId, params.actorId || null, params.type, params.title, params.body || null, params.linkUrl || null, icon]
    );

    const inserted = insertRes.rows[0];

    // Fetch actor details if actorId is supplied
    let actorHandle: string | null = null;
    let actorAvatar: string | null = null;
    if (params.actorId) {
      const actorRes = await query(
        `SELECT COALESCE(handle, split_part(email, '@', 1)) as handle, avatar_path as "avatarPath"
         FROM users WHERE id = $1`,
        [params.actorId]
      );
      if (actorRes.rows.length > 0) {
        actorHandle = actorRes.rows[0].handle;
        actorAvatar = actorRes.rows[0].avatarPath;
      }
    }

    const record: NotificationRecord = {
      id: inserted.id,
      userId: inserted.userId,
      actorId: inserted.actorId,
      actorHandle,
      actorAvatar,
      type: inserted.type,
      title: inserted.title,
      body: inserted.body,
      linkUrl: inserted.linkUrl,
      icon: inserted.icon,
      isRead: !!inserted.isRead,
      createdAt: inserted.createdAt,
    };

    // Query unread count for user
    const unreadCountRes = await query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = FALSE',
      [params.userId]
    );
    const unreadCount = parseInt(unreadCountRes.rows[0]?.count || '0', 10);

    // Push real-time WebSocket packet to active user session
    const session = activeSockets.get(params.userId);
    if (session && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(
        JSON.stringify({
          type: 'notification',
          notification: record,
          unreadCount,
          soundEnabled: prefs.soundEnabled,
          desktopPush: prefs.desktopPush,
        })
      );
      console.log(`[:> NOTIFY WS SENT] Pushed ${params.type} notification to user @${session.handle}`);
    }

    return record;
  } catch (err) {
    console.error('[:> NOTIFICATION DISPATCH ERROR]', err);
    return null;
  }
}

/**
 * Returns a default retro emoji icon for each notification type.
 */
function defaultIconForType(type: NotificationType): string {
  switch (type) {
    case 'nim':
      return '🗨️';
    case 'follow':
      return '🤝';
    case 'comment_own':
      return '💬';
    case 'comment_thread':
      return '🧵';
    case 'guestbook':
      return '📖';
    case 'like':
      return '⚡';
    case 'friend_post':
      return '📸';
    case 'deploy':
      return '🚀';
  }
}

/**
 * Fetches recent notifications for a user station.
 */
export async function getNotifications(
  userId: string,
  limit = 30
): Promise<{ notifications: NotificationRecord[]; unreadCount: number }> {
  const listRes = await query(
    `SELECT n.id,
            n.user_id as "userId",
            n.actor_id as "actorId",
            n.type,
            n.title,
            n.body,
            n.link_url as "linkUrl",
            n.icon,
            n.is_read as "isRead",
            n.created_at as "createdAt",
            COALESCE(u.handle, split_part(u.email, '@', 1)) as "actorHandle",
            u.avatar_path as "actorAvatar"
     FROM notifications n
     LEFT JOIN users u ON n.actor_id = u.id
     WHERE n.user_id = $1
     ORDER BY n.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  const unreadRes = await query(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = FALSE',
    [userId]
  );

  const notifications: NotificationRecord[] = listRes.rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    actorId: row.actorId,
    actorHandle: row.actorHandle,
    actorAvatar: row.actorAvatar,
    type: row.type,
    title: row.title,
    body: row.body,
    linkUrl: row.linkUrl,
    icon: row.icon || defaultIconForType(row.type),
    isRead: !!row.isRead,
    createdAt: row.createdAt,
  }));

  const unreadCount = parseInt(unreadRes.rows[0]?.count || '0', 10);

  return { notifications, unreadCount };
}

/**
 * Marks a specific notification as read.
 */
export async function markNotificationRead(userId: string, notificationId: string): Promise<boolean> {
  const res = await query(
    'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2',
    [notificationId, userId]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Marks all notifications as read for a user.
 */
export async function markAllNotificationsRead(userId: string): Promise<number> {
  const res = await query(
    'UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE',
    [userId]
  );
  return res.rowCount ?? 0;
}
