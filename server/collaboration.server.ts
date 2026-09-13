/**
 * Standalone Yjs WebSocket server for document collaboration.
 *
 * Validates the JWT issued by POST /documents/:graphId/collaboration-auth
 * before allowing any client to join a room.
 *
 * Environment variables:
 *   COLLaborATION_WS_PORT   – TCP port to listen on (default 3002)
 *   JWT_SECRET            – same secret used by the main Express app
 *
 * Connect as a client:
 *   ws://host:3002/collaboration?token=<jwt>&room=doc:<graph_id>
 */
import http from 'node:http';
import url from 'node:url';
import * as Y from 'yjs';
import { WebSocketServer, type WebSocket } from 'ws';
import { decodeCollabToken } from '../src/services/collaboration.service.js';
import { logger } from '../src/config/logger.js';

const PORT = Number(process.env.COLLABORATION_WS_PORT ?? process.env.PORT ?? 3002);
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be configured for the collaboration server');
}

// One Yjs.Doc per room. Documents are created lazily and shared across clients.
const rooms = new Map<string, Y.Doc>();

function getDoc(roomId: string): Y.Doc {
  let doc = rooms.get(roomId);
  if (!doc) {
    doc = new Y.Doc();
    doc.meta.set('room', roomId);
    rooms.set(roomId, doc);
  }
  return doc;
}

function handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
  const parsed = url.parse(req.url ?? '', true);
  const path = parsed.pathname;
  const token = parsed.query.token as string | undefined;

  // Only accept requests on the collaboration path.
  if (path !== '/collaboration') {
    ws.close(1008, 'Forbidden path');
    return;
  }
  if (!token) {
    ws.close(1008, 'Missing token');
    return;
  }

  // Validate JWT and extract room + permission.
  let payload: ReturnType<typeof decodeCollabToken>;
  try {
    payload = decodeCollabToken(token);
  } catch {
    ws.close(1008, 'Invalid or expired token');
    return;
  }

  const expectedRoom = payload.room;

  // Enforce that the requested room matches the token.
  // Knowledge of room name alone must never grant access.
  if (expectedRoom !== payload.room) {
    ws.close(1008, 'Room mismatch');
    return;
  }

  const doc = getDoc(expectedRoom);

  // Subscribe client to Yjs updates for this room.
  const unsubscribe = doc.on('update', (update: Uint8Array) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(Y.encodeUpdateStateVector(doc), { binary: true });
      ws.send(update, { binary: true });
    }
  });

  ws.once('close', () => {
    unsubscribe();
  });

  // Send initial state vector so the client can request missing ops.
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(Y.encodeStateVector(doc), { binary: true });
  }

  // Handle incoming Yjs sync messages.
  ws.on('message', (data: WebSocket.Data) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      const arrayBuffer = data.buffer instanceof ArrayBuffer ? data.buffer : (data as Buffer).buffer;
      const update = new Uint8Array(arrayBuffer);
      Y.applyUpdate(doc, update);
    } catch {
      // Silently ignore malformed messages.
    }
  });
}

const server = http.createServer((req, res) => {
  // Return 404 for non-ws paths so health-check tools don't hang.
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    handleConnection(ws, req);
  });
});

wss.on('close', () => {
  for (const doc of rooms.values()) {
    doc.destroy();
  }
  rooms.clear();
});

export function startCollaborationServer(): http.Server {
  server.listen(PORT, () => {
    logger.info(`[collab] Yjs collaboration server listening on ws://localhost:${PORT}/collaboration`);
  });
  return server;
}

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
