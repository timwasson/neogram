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
}

// In-memory active presence map keyed by userId
export const activeSockets = new Map<string, ActiveSession>();

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
  const wss = new WebSocketServer({ server, path: '/ws/chat' });

  console.log('[:> WEBSOCKET] Chat & Presence engine initialized at /ws/chat');

  wss.on('connection', async (ws: WebSocket, req: http.IncomingMessage) => {
    let authenticatedUser: any = null;

    try {
      // 0. Verify Origin to prevent Cross-Site WebSocket Hijacking (CSWSH)
      const origin = req.headers.origin;
      if (origin) {
        const { config } = await import('../config');
        const isAllowedOrigin =
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
      if (!authenticatedUser && req.url) {
        const urlObj = new URL(req.url, 'http://localhost');
        const tokenQuery = urlObj.searchParams.get('token');
        if (tokenQuery) {
          const payload = verifySessionToken(tokenQuery);
          if (payload) {
            authenticatedUser = await getUserById(payload.userId);
          }
        }
      }
    } catch (err) {
      console.warn('[:> WEBSOCKET AUTH ERROR]', err);
    }

    if (!authenticatedUser) {
      // Send error packet and terminate
      ws.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Authentication required' }));
      ws.close(4001, 'Unauthorized');
      return;
    }

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

    ws.send(JSON.stringify({
      type: 'init_state',
      buddies,
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
      `SELECT q.id, q.body, q.created_at, 
              COALESCE(u.handle, split_part(u.email, '@', 1)) as "fromHandle",
              u.id as "fromId"
       FROM ephemeral_chat_queue q
       JOIN users u ON q.sender_id = u.id
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
        fromId: msg.fromId,
        text: msg.body,
        timestamp: msg.created_at,
        wasQueued: true,
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

// Rate limiting map for direct messages: max 30 messages per minute per user
const chatMsgLimits = new Map<string, number[]>();
const CHAT_MSG_WINDOW_MS = 60 * 1000;
const MAX_CHAT_MSGS = 30;

function checkChatRateLimit(userId: string): boolean {
  const now = Date.now();
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

      const trimmedText = text.trim().slice(0, 2000);
      const msgId = id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const timestamp = new Date().toISOString();

      // Find recipient user in DB or in-memory
      const recipientRes = await query(
        `SELECT id, COALESCE(handle, split_part(email, '@', 1)) as handle
         FROM users
         WHERE handle = $1 OR split_part(email, '@', 1) = $1 OR id::text = $1`,
        [to]
      );

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
          fromId: sender.userId,
          to: recipient.handle,
          text: trimmedText,
          timestamp,
          wasQueued: false,
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
        await query(
          `INSERT INTO ephemeral_chat_queue (sender_id, receiver_id, body)
           VALUES ($1, $2, $3)`,
          [sender.userId, recipient.id, trimmedText]
        );

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
          actorId: sender.userId,
          type: 'nim',
          title: `New transmission from @${sender.handle}`,
          body: 'Sent you an instant message via NIM.',
          linkUrl: `/#nim?user=${sender.handle}`,
          icon: '🗨️',
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
