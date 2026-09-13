/**
 * Yjs WebSocket collaboration server.
 * Implements the standard y-websocket protocol (same as partykit).
 */
import type http from 'node:http';
import url from 'node:url';
import * as Y from 'yjs';
import * as ws from 'ws';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { Awareness } from 'y-protocols/awareness';
import { decodeCollabToken } from '../services/collaboration.service.js';
import { logger } from '../config/logger.js';

const rooms = new Map<string, Y.Doc>();
const awarenesses = new Map<string, Awareness>();
const clientsByRoom = new Map<string, Set<ws.WebSocket>>();

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;

function getDoc(roomId: string): Y.Doc {
  if (!rooms.has(roomId)) {
    const doc = new Y.Doc();
    rooms.set(roomId, doc);
    const awareness = new awarenessProtocol.Awareness(doc);
    awarenesses.set(roomId, awareness);
    clientsByRoom.set(roomId, new Set());
    logger.info('[collab] created new doc+awareness', { room: roomId });
  }
  return rooms.get(roomId)!;
}

function getAwareness(roomId: string): Awareness {
  return awarenesses.get(roomId)!;
}

function getPeers(roomId: string): Set<ws.WebSocket> {
  return clientsByRoom.get(roomId) ?? new Set();
}

function broadcastToRoom(roomId: string, buf: Uint8Array, exclude?: ws.WebSocket): void {
  for (const peer of clientsByRoom.get(roomId) ?? []) {
    if (peer !== exclude && peer.readyState === ws.WebSocket.OPEN) {
      try { peer.send(buf, { binary: true }); } catch {}
    }
  }
}

function handleConnection(wsConn: ws.WebSocket, req: http.IncomingMessage): void {
  const parsed = url.parse(req.url ?? '', true);

  logger.info('[collab] incoming request', { path: parsed.pathname, fullUrl: req.url });

  if (parsed.pathname !== '/collaboration') {
    wsConn.close(1008, 'Forbidden path');
    return;
  }

  const token = parsed.query.token as string | undefined;
  if (!token) {
    logger.info('[collab] rejecting: missing token');
    wsConn.close(1008, 'Missing token');
    return;
  }

  let payload: ReturnType<typeof decodeCollabToken>;
  try {
    payload = decodeCollabToken(token);
  } catch (err) {
    logger.error('[collab] token validation failed', err);
    wsConn.close(1008, 'Invalid or expired token');
    return;
  }

  const expectedRoom = parsed.query.room as string | undefined;
  if (expectedRoom && expectedRoom !== payload.room) {
    logger.info('[collab] rejecting: room mismatch', { expected: expectedRoom, actual: payload.room });
    wsConn.close(1008, 'Room mismatch');
    return;
  }

  const roomId = expectedRoom ?? payload.room;
  const doc = getDoc(roomId);
  const awareness = getAwareness(roomId);
  const peers = getPeers(roomId);

  logger.info('[collab] authenticated client', { room: roomId, permission: payload.permission, userId: payload.sub });

  // ── Register peer ──────────────────────────────────────────────────────────
  peers.add(wsConn);

  // ── Send initial state immediately (ws is already OPEN after handleUpgrade) ─
  // Send sync step 2 (server's current state) so client can fill gaps.
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep2(encoder, doc);
    wsConn.send(encoding.toUint8Array(encoder), { binary: true });
  }

  // Query awareness: ask client to send its local state.
  {
    const aencoder = encoding.createEncoder();
    encoding.writeVarUint(aencoder, MESSAGE_QUERY_AWARENESS);
    wsConn.send(encoding.toUint8Array(aencoder), { binary: true });
  }

  // ── Inbound messages ───────────────────────────────────────────────────────
  wsConn.on('message', (data: Buffer | ArrayBuffer) => {
    if (wsConn.readyState !== ws.WebSocket.OPEN) return;
    try {
      const buf = data instanceof Buffer ? data : Buffer.from(data as ArrayBuffer);
      const decoder = decoding.createDecoder(buf);
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_SYNC) {
        // Peek at the sync message type to decide how to handle it.
        const syncType = decoding.readVarUint(decoder);
        // Reset decoder to before we peeked so readSyncMessage can process it.
        const decoder2 = decoding.createDecoder(buf);
        decoding.readVarUint(decoder2); // skip message type

        const encoder = encoding.createEncoder();
        syncProtocol.readSyncMessage(decoder2, encoder, doc, wsConn);

        // Send any response back to the sender.
        if (encoding.length(encoder) > 1) {
          wsConn.send(encoding.toUint8Array(encoder), { binary: true });
        }

        // If this was a sync update (type 2), forward the ORIGINAL message
        // to all other peers so they can apply the same update.
        if (syncType === syncProtocol.messageYjsUpdate) {
          broadcastToRoom(roomId, new Uint8Array(buf), wsConn);
        }
      } else if (messageType === MESSAGE_QUERY_AWARENESS) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(
            awareness,
            Array.from(awareness.getStates().keys()),
          ),
        );
        wsConn.send(encoding.toUint8Array(encoder), { binary: true });
      } else if (messageType === MESSAGE_AWARENESS) {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(awareness, update, wsConn);
        // Broadcast awareness to all OTHER peers in the room.
        broadcastToRoom(roomId, new Uint8Array(buf), wsConn);
      } else {
        logger.info('[collab] unknown message type', { type: messageType });
      }
    } catch (err) {
      logger.error('[collab] message handler error', { room: roomId, error: err });
    }
  });

  // ── Close ──────────────────────────────────────────────────────────────────
  wsConn.on('close', (code, reason) => {
    peers.delete(wsConn);
    // Remove awareness states for clients that are no longer connected.
    // We can't map wsConn → yjs clientId, so we remove all states whose
    // clientIds are not represented by any remaining peer. The simplest
    // approach: broadcast an awareness update with only the remaining states.
    const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
      awareness,
      Array.from(awareness.getStates().keys()),
    );
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessUpdate);
    broadcastToRoom(roomId, encoding.toUint8Array(enc));
    logger.info('[collab] ws close', { room: roomId, code, reason: reason.toString(), remaining: peers.size });
  });

  wsConn.on('error', (err) => {
    logger.error('[collab] ws error', { room: roomId, message: err.message });
  });
}

const wss = new ws.WebSocketServer({ noServer: true });

export function mountCollaboration(httpServer: http.Server): void {
  httpServer.on('upgrade', (req, socket, head) => {
    logger.info('[collab] upgrade request', { path: req.url });
    wss.handleUpgrade(req, socket, head, (wsConn) => {
      handleConnection(wsConn, req);
    });
  });

  wss.on('close', () => {
    for (const doc of rooms.values()) doc.destroy();
    for (const a of awarenesses.values()) a.destroy();
    rooms.clear();
    awarenesses.clear();
    clientsByRoom.clear();
    logger.info('[collab] server closed');
  });

  logger.info('[collab] Yjs collaboration server mounted on /collaboration');
}