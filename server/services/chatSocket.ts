import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cookie from 'cookie';
import { COOKIE_NAME, verifySessionToken } from '../auth/jwt';
import { getUserById } from '../auth/service';
import { query } from '../db';

export interface ActiveSession {
  userId: string;
  handle: string;
  email: string;
  ws: WebSocket;
  isAlive: boolean;
  status: 'online' | 'away';
  awayMessage: string;
  connectedAt: Date;
  isAnonymous?: boolean;
  targetStationId?: string;
  targetStationHandle?: string;
}

// In-memory active presence map keyed by userId
export const activeSockets = new Map<string, ActiveSession>();
// In-memory active anonymous pager sockets map keyed by anonHandle
export const activeAnonSockets = new Map<string, ActiveSession>();

/**
 * Broadcasts a presence or network event to all connected sockets
 */
export function broadcast(payload: any, excludeUserId?: string) {
  const json = JSON.stringify(payload);
  for (const [userId, session] of activeSockets.entries()) {
    if (excludeUserId && userId === excludeUserId) continue;
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(json);
    }
  }
}

/**
 * Initializes the WebSocket server attached to the HTTP server
 */
export function initChatWebSocketServer(server: http.Server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws/chat',
    maxPayload: 64 * 1024, // 64KB max WebSocket frame size to prevent DoS memory attacks
  });

  console.log('[:> WEBSOCKET] Chat & Presence engine initialized at /ws/chat');

  wss.on('connection', async (ws: WebSocket, req: http.IncomingMessage) => {
    let authenticatedUser: any = null;
    let isAnonymousPager = false;
    let anonHandle = '';
    let targetStation: any = null;

    try {
      const urlObj = req.url ? new URL(req.url, 'http://localhost') : null;
      const isPagerParam = urlObj?.searchParams.get('pager') === 'true';
      const stationParam = urlObj?.searchParams.get('station');

      // 0. Verify Origin to prevent Cross-Site WebSocket Hijacking (CSWSH)
      const origin = req.headers.origin;
      if (origin) {
        const { config } = await import('../config');
        const isAllowedOrigin =
          isPagerParam ||
          origin === config.appUrl ||
          origin.startsWith('http://localhost:') ||
          origin.startsWith('http://127.0.0.1:') ||
          origin.startsWith('https://localhost:') ||
          origin.startsWith('https://127.0.0.1:') ||
          origin.startsWith('chrome-extension://') ||
          origin.startsWith('moz-extension://');

        if (!isAllowedOrigin) {
          console.warn(`[:> WEBSOCKET CSWSH BLOCKED] Rejected connection from unauthorized origin: ${origin}`);
          ws.send(JSON.stringify({ type: 'error', code: 'FORBIDDEN_ORIGIN', message: 'Cross-site WebSocket connection rejected' }));
          ws.close(4003, 'Forbidden origin');
          return;
        }
      }

      // Check if this is an embedded pager connection targeted to a station
      if (isPagerParam && stationParam) {
        const { findUserByHandleOrId } = await import('../routes/embeds');
        targetStation = await findUserByHandleOrId(stationParam);
        if (!targetStation) {
          ws.send(JSON.stringify({ type: 'error', code: 'STATION_NOT_FOUND', message: 'Station node not found.' }));
          ws.close(4004, 'Station not found');
          return;
        }
      }

      // 1. Authenticate via Session Cookie or Token Query
      const cookieHeader = req.headers.cookie || '';
      const parsedCookies = cookie.parse(cookieHeader);
      const sessionToken = parsedCookies[COOKIE_NAME];

      if (sessionToken) {
        const payload = verifySessionToken(sessionToken);
        if (payload) {
          authenticatedUser = await getUserById(payload.userId);
        }
      }

      // Fallback: Check url query params (e.g. ?token=... or ?handle=...)
      if (!authenticatedUser && urlObj) {
        const tokenQuery = urlObj.searchParams.get('token');
        if (tokenQuery) {
          const payload = verifySessionToken(tokenQuery);
          if (payload) {
            authenticatedUser = await getUserById(payload.userId);
          }
        }
      }

      // If unauthenticated and pager connection requested, check anonymous permissions
      if (!authenticatedUser && isPagerParam && targetStation) {
        const { getNotificationPreferences } = await import('./notificationService');
        const prefs = await getNotificationPreferences(targetStation.id);

        if (prefs.chatWidgetEnabled === false) {
          ws.send(JSON.stringify({ type: 'error', code: 'WIDGET_DISABLED', message: 'Chat widget is disabled on this station.' }));
          ws.close(4003, 'Widget disabled');
          return;
        }

        if (prefs.allowAnonChat === false) {
          ws.send(JSON.stringify({ type: 'error', code: 'ANON_CHAT_DISABLED', message: 'This station only accepts transmissions from verified Cyber-Pass members.' }));
          ws.close(4003, 'Anonymous chat disabled');
          return;
        }

        const rawAnon = urlObj.searchParams.get('anonHandle') || '';
        const cleanAnon = rawAnon.trim().replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20);
        anonHandle = cleanAnon || `guest_${Math.floor(1000 + Math.random() * 9000)}`;
        isAnonymousPager = true;
      }
    } catch (err) {
      console.warn('[:> WEBSOCKET AUTH ERROR]', err);
    }

    if (!authenticatedUser && !isAnonymousPager) {
      // Send error packet and terminate
      ws.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Authentication required' }));
      ws.close(4001, 'Unauthorized');
      return;
    }

    // A: Anonymous Pager Session
    if (isAnonymousPager && targetStation) {
      const anonUserId = `anon_${anonHandle}`;
      const session: ActiveSession = {
        userId: anonUserId,
        handle: anonHandle,
        email: `${anonHandle}@pager.local`,
        ws,
        isAlive: true,
        status: 'online',
        awayMessage: 'Browsing static site',
        connectedAt: new Date(),
        isAnonymous: true,
        targetStationId: targetStation.id,
        targetStationHandle: targetStation.handle || targetStation.email.split('@')[0],
      };

      activeAnonSockets.set(anonHandle, session);
      console.log(`[:> PAGER // CONNECTED] Anonymous visitor @${anonHandle} paging @${session.targetStationHandle}`);

      // Notify station owner if currently online
      const stationOwnerSession = activeSockets.get(targetStation.id);
      if (stationOwnerSession && stationOwnerSession.ws.readyState === WebSocket.OPEN) {
        stationOwnerSession.ws.send(JSON.stringify({
          type: 'visitor_presence',
          handle: anonHandle,
          status: 'online',
          isVisitor: true,
          connectedAt: session.connectedAt,
        }));
      }

      ws.on('pong', () => {
        session.isAlive = true;
      });

      // Send initial pager handshake with target station status
      const targetActive = activeSockets.get(targetStation.id);
      const targetStatus = targetActive ? targetActive.status : 'offline';
      const targetAwayMsg = targetActive ? targetActive.awayMessage : (targetStation.status_message || 'Offline');

      ws.send(JSON.stringify({
        type: 'pager_init',
        station: session.targetStationHandle,
        uin: targetStation.uin,
        status: targetStatus,
        awayMessage: targetAwayMsg,
        anonHandle,
      }));

      // Flush any queued offline messages sent to this anonymous visitor
      await flushOfflineQueueForAnon(ws, anonHandle);

      ws.on('message', async (data: Buffer | string) => {
        try {
          const parsed = JSON.parse(data.toString());
          await handleClientMessage(session, parsed);
        } catch (err: any) {
          console.error('[:> WEBSOCKET PAGER PARSE ERROR]', err);
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON payload' }));
        }
      });

      ws.on('close', (code) => {
        activeAnonSockets.delete(anonHandle);
        console.log(`[:> PAGER // DISCONNECT] Anonymous visitor @${anonHandle} closed session. Code: ${code}`);

        const ownerSession = activeSockets.get(targetStation.id);
        if (ownerSession && ownerSession.ws.readyState === WebSocket.OPEN) {
          ownerSession.ws.send(JSON.stringify({
            type: 'visitor_presence',
            handle: anonHandle,
            status: 'offline',
            isVisitor: true,
          }));
        }
      });

      ws.on('error', (err) => {
        console.error(`[:> PAGER ERROR @${anonHandle}]`, err);
      });

      return;
    }

    // B: Authenticated User Session
    const userId = authenticatedUser.id;
    const handle = authenticatedUser.handle || authenticatedUser.email.split('@')[0];

    // Close any previous open socket for the same user
    const existing = activeSockets.get(userId);
    if (existing && existing.ws !== ws && existing.ws.readyState === WebSocket.OPEN) {
      existing.ws.close(4000, 'Replaced by new connection');
    }

    // Register active user session in memory
    const session: ActiveSession = {
      userId,
      handle,
      email: authenticatedUser.email,
      ws,
      isAlive: true,
      status: authenticatedUser.is_away ? 'away' : 'online',
      awayMessage: authenticatedUser.status_message || 'Online',
      connectedAt: new Date(),
    };
    activeSockets.set(userId, session);

    console.log(`[:> CHAT // CONNECTED] User @${handle} (${userId}) signed on. Total active: ${activeSockets.size}`);

    // Heartbeat pong listener
    ws.on('pong', () => {
      session.isAlive = true;
    });

    // 2. Broadcast presence: User signed on
    broadcast({
      type: 'presence_update',
      userId,
      handle,
      status: session.status,
      awayMessage: session.awayMessage,
      action: 'online',
    }, userId);

    // 3. Send initial connected payload & buddy list to client
    await sendInitialState(ws, userId);

    // 4. Flush any pending offline messages from ephemeral queue
    await flushOfflineQueue(ws, userId);

    // 5. Handle incoming WebSocket messages
    ws.on('message', async (data: Buffer | string) => {
      try {
        const parsed = JSON.parse(data.toString());
        await handleClientMessage(session, parsed);
      } catch (err: any) {
        console.error('[:> WEBSOCKET PARSE ERROR]', err);
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON payload' }));
      }
    });

    // 6. Handle client disconnect
    ws.on('close', (code, reason) => {
      activeSockets.delete(userId);
      console.log(`[:> CHAT // DISCONNECT] User @${handle} signed off. Code: ${code}. Total active: ${activeSockets.size}`);

      // Broadcast sign-off event
      broadcast({
        type: 'presence_update',
        userId,
        handle,
        status: 'offline',
        action: 'offline',
      });
    });

    ws.on('error', (err) => {
      console.error(`[:> WEBSOCKET ERROR @${handle}]`, err);
    });
  });

  // Keep-alive heartbeat interval every 30s
  const heartbeatInterval = setInterval(() => {
    for (const [userId, session] of activeSockets.entries()) {
      if (!session.isAlive) {
        console.log(`[:> WEBSOCKET HEARTBEAT] Terminating dead connection for @${session.handle}`);
        session.ws.terminate();
        activeSockets.delete(userId);
        broadcast({
          type: 'presence_update',
          userId,
          handle: session.handle,
          status: 'offline',
          action: 'offline',
        });
        continue;
      }
      session.isAlive = false;
      session.ws.ping();
    }

    // Ping active anonymous pager sockets
    for (const [anonHandle, session] of activeAnonSockets.entries()) {
      if (!session.isAlive) {
        session.ws.terminate();
        activeAnonSockets.delete(anonHandle);
        continue;
      }
      session.isAlive = false;
      session.ws.ping();
    }
  }, 30000);

  // Auto-prune expired offline messages every 15 minutes
  const pruneInterval = setInterval(async () => {
    try {
      const res = await query('DELETE FROM ephemeral_chat_queue WHERE expires_at < CURRENT_TIMESTAMP');
      if (res.rowCount && res.rowCount > 0) {
        console.log(`[:> CHAT QUEUE] Auto-purged ${res.rowCount} expired offline messages.`);
      }
    } catch (e) {
      console.warn('[:> CHAT PRUNE ERROR]', e);
    }
  }, 15 * 60 * 1000);

  server.on('close', () => {
    clearInterval(heartbeatInterval);
    clearInterval(pruneInterval);
  });
}

/**
 * Sends initial handshake packet with online buddy states, user profile, and friend status
 */
async function sendInitialState(ws: WebSocket, currentUserId: string) {
  try {
    // Query users that currentUserId follows (Friends)
    const friendsRes = await query(
      'SELECT following_id FROM follows WHERE follower_id = $1',
      [currentUserId]
    );
    const friendSet = new Set<string>(friendsRes.rows.map((r: any) => r.following_id));

    // Query all users
    const allUsers = await query(`
      SELECT 
        u.id, 
        u.email, 
        COALESCE(u.handle, split_part(u.email, '@', 1)) as handle,
        u.status_message as "statusMessage",
        u.is_away as "isAway",
        (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) as "postCount"
      FROM users u
      ORDER BY u.created_at ASC
    `);

    const buddies = allUsers.rows.map((u) => {
      const active = activeSockets.get(u.id);
      return {
        id: u.id,
        handle: u.handle,
        email: u.email,
        isOnline: !!active,
        status: active ? active.status : 'offline',
        awayMessage: active ? active.awayMessage : (u.statusMessage || ''),
        isSelf: u.id === currentUserId,
        isFriend: friendSet.has(u.id),
      };
    });

    // Query active anonymous visitors paging this station
    const activeVisitors: Array<{ handle: string; status: string; connectedAt: string }> = [];
    for (const [anonHandle, anonSession] of activeAnonSockets.entries()) {
      if (anonSession.targetStationId === currentUserId && anonSession.ws.readyState === WebSocket.OPEN) {
        activeVisitors.push({
          handle: anonHandle,
          status: 'online',
          connectedAt: anonSession.connectedAt.toISOString(),
        });
      }
    }

    ws.send(JSON.stringify({
      type: 'init_state',
      buddies,
      activeVisitors,
      activeCount: activeSockets.size,
    }));
  } catch (err: any) {
    console.error('[:> INIT STATE ERROR]', err);
  }
}

/**
 * Pushes updated buddy list packet to an active user socket
 */
export async function refreshUserBuddyList(userId: string) {
  const session = activeSockets.get(userId);
  if (session && session.ws.readyState === WebSocket.OPEN) {
    await sendInitialState(session.ws, userId);
  }
}

/**
 * Flushes any pending messages from ephemeral holding table to recipient,
 * and immediately hard-deletes them upon transmission!
 */
async function flushOfflineQueue(ws: WebSocket, userId: string) {
  try {
    const queueRes = await query(
      `SELECT q.id, q.body, q.created_at, q.sender_handle, q.is_anonymous,
              COALESCE(u.handle, split_part(u.email, '@', 1), q.sender_handle, 'Anonymous') as "fromHandle",
              u.id as "fromId"
       FROM ephemeral_chat_queue q
       LEFT JOIN users u ON q.sender_id = u.id
       WHERE q.receiver_id = $1 AND q.expires_at > CURRENT_TIMESTAMP
       ORDER BY q.created_at ASC`,
      [userId]
    );

    if (queueRes.rows.length === 0) return;

    console.log(`[:> CHAT QUEUE] Delivering ${queueRes.rows.length} pending offline messages to user ${userId}`);

    const deliveredIds: string[] = [];

    for (const msg of queueRes.rows) {
      ws.send(JSON.stringify({
        type: 'direct_message',
        id: msg.id,
        from: msg.fromHandle,
        fromId: msg.fromId || null,
        text: msg.body,
        timestamp: msg.created_at,
        wasQueued: true,
        isAnonymous: !!msg.is_anonymous || !msg.fromId,
        isPager: !!msg.is_anonymous,
      }));
      deliveredIds.push(msg.id);
    }

    // Immediately delete delivered messages from database! Zero permanent storage.
    if (deliveredIds.length > 0) {
      await query(
        'DELETE FROM ephemeral_chat_queue WHERE id = ANY($1::uuid[])',
        [deliveredIds]
      );
      console.log(`[:> CHAT QUEUE] Cleaned up ${deliveredIds.length} delivered messages from database.`);
    }
  } catch (err: any) {
    console.error('[:> FLUSH QUEUE ERROR]', err);
  }
}

/**
 * Flushes any pending messages from ephemeral holding table to an anonymous visitor,
 * and immediately hard-deletes them upon transmission!
 */
async function flushOfflineQueueForAnon(ws: WebSocket, anonHandle: string) {
  try {
    const queueRes = await query(
      `SELECT q.id, q.body, q.created_at, q.sender_handle,
              COALESCE(u.handle, split_part(u.email, '@', 1), q.sender_handle, 'Station Operator') as "fromHandle",
              u.id as "fromId"
       FROM ephemeral_chat_queue q
       LEFT JOIN users u ON q.sender_id = u.id
       WHERE q.receiver_handle = $1 AND q.expires_at > CURRENT_TIMESTAMP
       ORDER BY q.created_at ASC`,
      [anonHandle]
    );

    if (queueRes.rows.length === 0) return;

    console.log(`[:> CHAT QUEUE] Delivering ${queueRes.rows.length} pending offline messages to visitor @${anonHandle}`);

    const deliveredIds: string[] = [];

    for (const msg of queueRes.rows) {
      ws.send(JSON.stringify({
        type: 'direct_message',
        id: msg.id,
        from: msg.fromHandle,
        fromId: msg.fromId || null,
        text: msg.body,
        timestamp: msg.created_at,
        wasQueued: true,
        isPager: true,
      }));
      deliveredIds.push(msg.id);
    }

    if (deliveredIds.length > 0) {
      await query(
        'DELETE FROM ephemeral_chat_queue WHERE id = ANY($1::uuid[])',
        [deliveredIds]
      );
      console.log(`[:> CHAT QUEUE] Cleaned up ${deliveredIds.length} delivered visitor messages from database.`);
    }
  } catch (err: any) {
    console.error('[:> FLUSH ANON QUEUE ERROR]', err);
  }
}

// Rate limiting map for direct messages: max 30 messages per minute per user
const chatMsgLimits = new Map<string, number[]>();
const CHAT_MSG_WINDOW_MS = 60 * 1000;
const MAX_CHAT_MSGS = 30;

function checkChatRateLimit(userId: string): boolean {
  const now = Date.now();
  if (chatMsgLimits.size > 2000) {
    for (const [key, ts] of chatMsgLimits.entries()) {
      if (!ts.some((t) => now - t < CHAT_MSG_WINDOW_MS)) {
        chatMsgLimits.delete(key);
      }
    }
  }
  const timestamps = (chatMsgLimits.get(userId) || []).filter((ts) => now - ts < CHAT_MSG_WINDOW_MS);
  if (timestamps.length >= MAX_CHAT_MSGS) return false;
  timestamps.push(now);
  chatMsgLimits.set(userId, timestamps);
  return true;
}

/**
 * Handles incoming messages from WebSocket clients
 */
async function handleClientMessage(sender: ActiveSession, msg: any) {
  switch (msg.type) {
    case 'direct_message': {
      if (!checkChatRateLimit(sender.userId)) {
        sender.ws.send(JSON.stringify({
          type: 'message_error',
          error: 'Rate limit exceeded: You are transmitting messages too quickly. Please wait a moment.',
        }));
        return;
      }

      const { to, text, id } = msg;
      if (!to || !text || !text.trim()) return;

      // Restrict anonymous pager sender to only transmitting to their target station
      if (sender.isAnonymous && sender.targetStationHandle && to !== sender.targetStationHandle) {
        sender.ws.send(JSON.stringify({
          type: 'message_error',
          id,
          error: `Transmissions from this widget may only be sent to @${sender.targetStationHandle}.`,
        }));
        return;
      }

      const maxLen = sender.isAnonymous ? 500 : 2000;
      const trimmedText = text.trim().slice(0, maxLen);
      const msgId = id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const timestamp = new Date().toISOString();

      // Check if recipient is an active anonymous session (e.g. station owner replying to visitor)
      const anonRecipient = activeAnonSockets.get(to);
      if (anonRecipient && anonRecipient.ws.readyState === WebSocket.OPEN) {
        anonRecipient.ws.send(JSON.stringify({
          type: 'direct_message',
          id: msgId,
          from: sender.handle,
          fromId: sender.userId,
          to: to,
          text: trimmedText,
          timestamp,
          wasQueued: false,
          isPager: true,
        }));

        sender.ws.send(JSON.stringify({
          type: 'message_status',
          id: msgId,
          to: to,
          status: 'delivered',
          timestamp,
        }));
        return;
      }

      // Find recipient user in DB
      const recipientRes = await query(
        `SELECT id, COALESCE(handle, split_part(email, '@', 1)) as handle
         FROM users
         WHERE handle = $1 OR split_part(email, '@', 1) = $1 OR id::text = $1`,
        [to]
      );

      // Check if target is an anonymous handle (guest_..., surfer_..., cyber_..., etc.)
      const isAnonTarget = to.startsWith('guest_') ||
                           to.startsWith('surfer_') ||
                           to.startsWith('cyber_') ||
                           to.startsWith('dialup_') ||
                           to.startsWith('node_') ||
                           to.startsWith('netizen_') ||
                           to.startsWith('anon_');

      if (isAnonTarget) {
        // Recipient visitor is currently navigating or away. Place into 24-hour store-and-forward queue!
        await query(
          `INSERT INTO ephemeral_chat_queue (sender_id, sender_handle, receiver_id, receiver_handle, is_anonymous, body)
           VALUES ($1, $2, NULL, $3, FALSE, $4)`,
          [sender.userId, sender.handle, to, trimmedText]
        );

        sender.ws.send(JSON.stringify({
          type: 'message_status',
          id: msgId,
          to: to,
          status: 'queued_offline',
          timestamp,
        }));
        return;
      }

      if (recipientRes.rows.length === 0) {
        sender.ws.send(JSON.stringify({
          type: 'message_error',
          id: msgId,
          error: `User @${to} not found on Neogram network.`,
        }));
        return;
      }

      const recipient = recipientRes.rows[0];
      const recipientSession = activeSockets.get(recipient.id);

      if (recipientSession && recipientSession.ws.readyState === WebSocket.OPEN) {
        // Recipient is online! Deliver directly in memory over WebSocket (NEVER TOUCHES DB!)
        recipientSession.ws.send(JSON.stringify({
          type: 'direct_message',
          id: msgId,
          from: sender.handle,
          fromId: sender.isAnonymous ? null : sender.userId,
          to: recipient.handle,
          text: trimmedText,
          timestamp,
          wasQueued: false,
          isAnonymous: !!sender.isAnonymous,
          isPager: !!sender.isAnonymous,
        }));

        // Send delivery confirmation back to sender
        sender.ws.send(JSON.stringify({
          type: 'message_status',
          id: msgId,
          to: recipient.handle,
          status: 'delivered',
          timestamp,
        }));
      } else {
        // Recipient is offline: Place into ephemeral 24-hour holding queue
        if (sender.isAnonymous) {
          await query(
            `INSERT INTO ephemeral_chat_queue (sender_id, sender_handle, is_anonymous, receiver_id, body)
             VALUES (NULL, $1, TRUE, $2, $3)`,
            [sender.handle, recipient.id, trimmedText]
          );
        } else {
          await query(
            `INSERT INTO ephemeral_chat_queue (sender_id, sender_handle, is_anonymous, receiver_id, body)
             VALUES ($1, $2, FALSE, $3, $4)`,
            [sender.userId, sender.handle, recipient.id, trimmedText]
          );
        }

        sender.ws.send(JSON.stringify({
          type: 'message_status',
          id: msgId,
          to: recipient.handle,
          status: 'queued_offline',
          timestamp,
        }));
      }

      // Trigger notification for recipient (Zero-retention: text is never stored in DB)
      import('./notificationService').then((m) => {
        m.dispatchNotification({
          userId: recipient.id,
          actorId: sender.isAnonymous ? null : sender.userId,
          type: 'nim',
          title: sender.isAnonymous ? `📟 Pager transmission from @${sender.handle}` : `New transmission from @${sender.handle}`,
          body: sender.isAnonymous ? trimmedText.slice(0, 100) : 'Sent you an instant message via NIM.',
          linkUrl: `/#nim?user=${sender.handle}`,
          icon: sender.isAnonymous ? '📟' : '🗨️',
        }).catch(() => {});
      }).catch(() => {});

      break;
    }

    case 'set_status': {
      const { status, awayMessage } = msg;
      if (status === 'online' || status === 'away') {
        sender.status = status;
        if (awayMessage !== undefined) {
          sender.awayMessage = String(awayMessage).slice(0, 150);
        }

        // Persist to user record
        await query(
          `UPDATE users 
           SET is_away = $1, status_message = $2
           WHERE id = $3`,
          [status === 'away', sender.awayMessage, sender.userId]
        );

        // Broadcast to buddies
        broadcast({
          type: 'presence_update',
          userId: sender.userId,
          handle: sender.handle,
          status: sender.status,
          awayMessage: sender.awayMessage,
          action: 'status_changed',
        });
      }
      break;
    }

    case 'typing': {
      const { to } = msg;
      if (!to) return;
      const recipientRes = await query(
        `SELECT id FROM users WHERE handle = $1 OR split_part(email, '@', 1) = $1 OR id::text = $1`,
        [to]
      );
      if (recipientRes.rows.length > 0) {
        const targetSession = activeSockets.get(recipientRes.rows[0].id);
        if (targetSession && targetSession.ws.readyState === WebSocket.OPEN) {
          targetSession.ws.send(JSON.stringify({
            type: 'typing',
            from: sender.handle,
          }));
        }
      }
      break;
    }

    case 'request_buddies': {
      await sendInitialState(sender.ws, sender.userId);
      break;
    }

    default:
      console.warn(`[:> UNKNOWN CHAT PACKET]`, msg.type);
  }
}
