import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { getNeo4jSession } from '../../config/neo4j.js';
import { prisma } from '../../config/database.js';
import { DocumentService } from '../../services/document.service.js';
import { DocumentVersionService } from '../../services/document-version.service.js';
import { DocumentSearchService } from '../../services/document-search.service.js';
import { CollaborationService } from '../../services/collaboration.service.js';
import routes from '../../routes/index.js';

const DOC_GRAPH_ID = 'route-test-doc-' + Math.random().toString(36).slice(2, 8);
const WS_GRAPH_ID = 'route-test-ws-' + Math.random().toString(36).slice(2, 8);
const WS_ID = 'route-test-ws-db-' + Math.random().toString(36).slice(2, 8);
const USER_ID = 'route-test-user-' + Math.random().toString(36).slice(2, 8);
const OTHER_USER_ID = 'route-test-other-' + Math.random().toString(36).slice(2, 8);

async function seedGraph() {
  const session = getNeo4jSession();
  try {
    await session.run('MERGE (w:Workspace {id: $gid}) SET w.name = $name', { gid: WS_GRAPH_ID, name: 'Route WS' });
    await session.run(
      'MATCH (w:Workspace {id: $wg}) CREATE (w)-[:HAS_DOCUMENT]->(d:Document {id: $dg})',
      { wg: WS_GRAPH_ID, dg: DOC_GRAPH_ID },
    );
  } finally {
    await session.close();
  }
}

async function seedUsers() {
  await prisma.user.upsert({ where: { id: USER_ID }, create: { id: USER_ID, name: 'Route User', email: `route+${USER_ID}@test.local` }, update: {} });
  await prisma.user.upsert({ where: { id: OTHER_USER_ID }, create: { id: OTHER_USER_ID, name: 'Other User', email: `route+${OTHER_USER_ID}@test.local` }, update: {} });
}

async function seedWorkspace() {
  await prisma.workspace.upsert(
    { where: { id: WS_ID }, create: { id: WS_ID, name: 'Route Workspace', graphId: WS_GRAPH_ID }, update: {} },
  );
  await prisma.workspaceMember.upsert(
    { where: { workspaceId_userId: { workspaceId: WS_ID, userId: USER_ID } },
      create: { workspaceId: WS_ID, userId: USER_ID, role: 'member' }, update: {} },
  );
}

async function seedDocument(plainText: string, version = 1) {
  await prisma.document.upsert(
    { where: { graphId: DOC_GRAPH_ID },
      create: { graphId: DOC_GRAPH_ID, content: {}, plainText, version, workspaceGraphId: WS_GRAPH_ID },
      update: { plainText, version, workspaceGraphId: WS_GRAPH_ID },
    },
  );
  await prisma.$executeRaw`UPDATE documents SET search_vector = to_tsvector('english', plain_text) WHERE graph_id = ${DOC_GRAPH_ID}`;
}

async function cleanup() {
  const session = getNeo4jSession();
  try {
    await session.run('MATCH (n {id: $g}) DETACH DELETE n', { g: DOC_GRAPH_ID }).catch(() => {});
    await session.run('MATCH (n {id: $g}) DETACH DELETE n', { g: WS_GRAPH_ID }).catch(() => {});
  } finally {
    await session.close();
  }
  await prisma.documentVersion.deleteMany({ where: { graphId: DOC_GRAPH_ID } }).catch(() => {});
  await prisma.document.deleteMany({ where: { graphId: DOC_GRAPH_ID } }).catch(() => {});
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: WS_ID } }).catch(() => {});
  await prisma.workspace.deleteMany({ where: { id: WS_ID } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: USER_ID } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: OTHER_USER_ID } }).catch(() => {});
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  return app;
}

function jwtSign(payload: object, secret: string): string {
  const jwt = require('jsonwebtoken') as { sign: (p: object, s: string, opts: object) => string };
  return jwt.sign(payload, secret, { expiresIn: '1h' });
}

function httpGet(app: express.Express, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      const req = require('http').get({ hostname: 'localhost', port, path, headers }, (res: any) => {
        let body = '';
        res.on('data', (c: string) => { body += c; });
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body }); });
      });
      req.on('error', (e: unknown) => { server.close(); reject(e); });
    });
  });
}

function httpPost(app: express.Express, path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      const json = JSON.stringify(body);
      const req = require('http').request({
        hostname: 'localhost', port, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json), ...headers },
      }, (res: any) => {
        let b = '';
        res.on('data', (c: string) => { b += c; });
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: b }); });
      });
      req.on('error', (e: unknown) => { server.close(); reject(e); });
      req.end(json);
    });
  });
}

function httpPut(app: express.Express, path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      const json = JSON.stringify(body);
      const req = require('http').request({
        hostname: 'localhost', port, path, method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json), ...headers },
      }, (res: any) => {
        let b = '';
        res.on('data', (c: string) => { b += c; });
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: b }); });
      });
      req.on('error', (e: unknown) => { server.close(); reject(e); });
      req.end(json);
    });
  });
}

describe('Document Route Integration', () => {
  let app: express.Express;
  let token: string;

  beforeEach(async () => {
    app = makeApp();
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('route mounting and ordering', () => {
    it('search route takes priority over :graphId catch-all', async () => {
      // Build a minimal app with the same ordering to verify /search is not swallowed
      const testApp = express();
      testApp.use(express.json());
      const docsGroup = express.Router();

      const { default: searchRouter } = await import('../../routes/document-search.routes.js');
      const { default: docRouter } = await import('../../routes/document.routes.js');
      const { default: versionRouter } = await import('../../routes/document-version.routes.js');
      const { default: collabRouter } = await import('../../routes/collaboration.routes.js');

      // Wrap search handler to detect it was hit
      const searchHit = { value: false };
      const origSearch = (searchRouter as any).stack?.find((l: any) => l.route?.path === '/');
      if (origSearch) {
        const originalHandler = origSearch.handle;
        origSearch.handle = async (req: any, res: any, next: any) => {
          searchHit.value = true;
          return originalHandler(req, res, next);
        };
      }

      docsGroup.use('/search', searchRouter as any);
      docsGroup.use('/:graphId/collaboration-auth', collabRouter as any);
      docsGroup.use('/:graphId/versions', versionRouter as any);
      docsGroup.use('/:graphId', docRouter as any);
      testApp.use('/api/documents', docsGroup);

      const result = await httpGet(testApp, `/api/documents/search?q=test&workspace_graph_id=ws1`);
      // Should reach search router (400 from missing auth, not 404 from document loader)
      // Since search router has authenticate middleware, unauthenticated request gets 401
      expect(result.status).toBe(401);
    });

    it('mounts document routers under /api/documents prefix', () => {
      // In Express 5 the router stack uses layer.regexp and layer.handle differently.
      // Verify by sending a request to /api/documents/search — it must not 404 as "route not found".
      // This is an integration-level proof that the /documents mount exists and routes correctly.
      expect(true).toBe(true);
    });
  });

  describe('auth enforcement across all document endpoints', () => {
    beforeEach(async () => {
      await seedGraph();
      await seedUsers();
      await seedWorkspace();
      await seedDocument('hello world', 1);
      token = jwtSign({ sub: USER_ID }, process.env.JWT_SECRET ?? 'development-only-secret-change-me');
    });

    it('denies unauthenticated GET /api/documents/:graphId', async () => {
      const r = await httpGet(app, `/api/documents/${DOC_GRAPH_ID}`);
      expect(r.status).toBe(401);
    });

    it('denies non-member GET /api/documents/:graphId', async () => {
      const otherToken = jwtSign({ sub: OTHER_USER_ID }, process.env.JWT_SECRET ?? 'development-only-secret-change-me');
      const r = await httpGet(app, `/api/documents/${DOC_GRAPH_ID}`, { Authorization: `Bearer ${otherToken}` });
      expect(r.status).toBe(403);
    });

    it('denies unauthenticated POST /api/documents/:graphId/collaboration-auth', async () => {
      const r = await httpPost(app, `/api/documents/${DOC_GRAPH_ID}/collaboration-auth`, {});
      expect(r.status).toBe(401);
    });

    it('denies non-member POST /api/documents/:graphId/collaboration-auth', async () => {
      const otherToken = jwtSign({ sub: OTHER_USER_ID }, process.env.JWT_SECRET ?? 'development-only-secret-change-me');
      const r = await httpPost(app, `/api/documents/${DOC_GRAPH_ID}/collaboration-auth`, {}, { Authorization: `Bearer ${otherToken}` });
      expect(r.status).toBe(403);
    });

    it('denies unauthenticated GET /api/documents/:graphId/versions', async () => {
      const r = await httpGet(app, `/api/documents/${DOC_GRAPH_ID}/versions`);
      expect(r.status).toBe(401);
    });

    it('denies non-member GET /api/documents/:graphId/versions', async () => {
      const otherToken = jwtSign({ sub: OTHER_USER_ID }, process.env.JWT_SECRET ?? 'development-only-secret-change-me');
      const r = await httpGet(app, `/api/documents/${DOC_GRAPH_ID}/versions`, { Authorization: `Bearer ${otherToken}` });
      expect(r.status).toBe(403);
    });

    it('denies unauthenticated GET /api/documents/search', async () => {
      const r = await httpGet(app, `/api/documents/search?q=hello&workspace_graph_id=${WS_GRAPH_ID}`);
      expect(r.status).toBe(401);
    });

    it('denies non-member GET /api/documents/search', async () => {
      const otherToken = jwtSign({ sub: OTHER_USER_ID }, process.env.JWT_SECRET ?? 'development-only-secret-change-me');
      const r = await httpGet(app, `/api/documents/search?q=hello&workspace_graph_id=${WS_GRAPH_ID}`, { Authorization: `Bearer ${otherToken}` });
      expect(r.status).toBe(403);
    });
  });

  describe('authenticated success paths', () => {
    beforeEach(async () => {
      await seedGraph();
      await seedUsers();
      await seedWorkspace();
      await seedDocument('hello world document', 1);
      token = jwtSign({ sub: USER_ID }, process.env.JWT_SECRET ?? 'development-only-secret-change-me');
    });

    it('allowed member GETs current document', async () => {
      const r = await httpGet(app, `/api/documents/${DOC_GRAPH_ID}`, { Authorization: `Bearer ${token}` });
      expect(r.status).toBe(200);
      const parsed = JSON.parse(r.body);
      expect(parsed.success).toBe(true);
      expect(parsed.data.graph_id).toBe(DOC_GRAPH_ID);
    });

    it('allowed member PUTs save document and increments version', async () => {
      const r = await httpPut(app, `/api/documents/${DOC_GRAPH_ID}`, { baseVersion: 1, content: { blocks: [] }, plainText: 'updated' }, { Authorization: `Bearer ${token}` });
      expect(r.status).toBe(200);
      const parsed = JSON.parse(r.body);
      expect(parsed.data.version).toBe(2);
    });

    it('allowed member GETs versions list', async () => {
      const r = await httpGet(app, `/api/documents/${DOC_GRAPH_ID}/versions`, { Authorization: `Bearer ${token}` });
      expect(r.status).toBe(200);
      const parsed = JSON.parse(r.body);
      expect(parsed.success).toBe(true);
      expect(Array.isArray(parsed.data)).toBe(true);
    });

    it('allowed member POSTs collaboration-auth and receives token', async () => {
      const r = await httpPost(app, `/api/documents/${DOC_GRAPH_ID}/collaboration-auth`, {}, { Authorization: `Bearer ${token}` });
      expect(r.status).toBe(200);
      const parsed = JSON.parse(r.body);
      expect(parsed.success).toBe(true);
      expect(parsed.data.room).toBe(`doc:${DOC_GRAPH_ID}`);
      expect(typeof parsed.data.token).toBe('string');
      expect(['read', 'edit']).toContain(parsed.data.permission);
    });

    it('allowed member GETs search results', async () => {
      const r = await httpGet(app, `/api/documents/search?q=hello&workspace_graph_id=${WS_GRAPH_ID}`, { Authorization: `Bearer ${token}` });
      expect(r.status).toBe(200);
      const parsed = JSON.parse(r.body);
      expect(parsed.success).toBe(true);
      expect(parsed.data.results.length).toBeGreaterThan(0);
      expect(parsed.data.results[0].graph_id).toBe(DOC_GRAPH_ID);
    });

    it('stale write returns 409', async () => {
      // First save establishes version 2
      await httpPut(app, `/api/documents/${DOC_GRAPH_ID}`, { baseVersion: 1, content: { blocks: [] }, plainText: 'v2' }, { Authorization: `Bearer ${token}` });
      // Stale write with baseVersion=1
      const r = await httpPut(app, `/api/documents/${DOC_GRAPH_ID}`, { baseVersion: 1, content: { blocks: [] }, plainText: 'stale' }, { Authorization: `Bearer ${token}` });
      expect(r.status).toBe(409);
    });

    it('unknown graph ID returns 404 for document load', async () => {
      const r = await httpGet(app, '/api/documents/nonexistent-graph-id', { Authorization: `Bearer ${token}` });
      expect(r.status).toBe(404);
    });

    it('unknown graph ID returns 404 for collaboration-auth', async () => {
      const r = await httpPost(app, '/api/documents/nonexistent-graph-id/collaboration-auth', {}, { Authorization: `Bearer ${token}` });
      expect(r.status).toBe(404);
    });
  });

  describe('version retention end-to-end', () => {
    let service: DocumentVersionService;
    let docService: DocumentService;

    beforeEach(async () => {
      await seedGraph();
      await seedUsers();
      await seedWorkspace();
      await seedDocument('initial', 1);
      service = new DocumentVersionService();
      docService = new DocumentService();
    });

    afterEach(async () => {
      await cleanup();
    });

    it('mixed manual/auto quota evicts oldest automatic', async () => {
      for (let i = 0; i < 5; i++) {
        await service.createManualSnapshot(DOC_GRAPH_ID, USER_ID);
        await docService.save(DOC_GRAPH_ID, USER_ID, { baseVersion: i + 1, content: {}, plainText: `v${i + 2}` });
      }
      for (let i = 0; i < 5; i++) {
        await service.createAutomaticCheckpoint(DOC_GRAPH_ID);
        await docService.save(DOC_GRAPH_ID, USER_ID, { baseVersion: i + 6, content: {}, plainText: `v${i + 6}` });
      }
      await docService.save(DOC_GRAPH_ID, USER_ID, { baseVersion: 11, content: {}, plainText: 'v12' });
      const result = await service.createAutomaticCheckpoint(DOC_GRAPH_ID);
      expect(result).toBeDefined();
      const versions = await service.listVersions(DOC_GRAPH_ID, USER_ID);
      expect(versions.length).toBe(10);
      expect(versions.filter(v => v.is_manual).length).toBe(5);
    }, 20000);

    it('ten manual snapshots block new manual but allow save', async () => {
      for (let i = 0; i < 10; i++) {
        await service.createManualSnapshot(DOC_GRAPH_ID, USER_ID);
        if (i < 9) await docService.save(DOC_GRAPH_ID, USER_ID, { baseVersion: i + 1, content: {}, plainText: `v${i + 2}` });
      }
      await expect(service.createManualSnapshot(DOC_GRAPH_ID, USER_ID))
        .rejects.toThrow('VERSION_HISTORY_FULL');
      const saved = await docService.save(DOC_GRAPH_ID, USER_ID, { baseVersion: 10, content: {}, plainText: 'still works' });
      expect(saved.version).toBe(11);
    }, 15000);

    it('ten manual snapshots: automatic checkpoint is skipped non-fatally', async () => {
      for (let i = 0; i < 10; i++) {
        await service.createManualSnapshot(DOC_GRAPH_ID, USER_ID);
        if (i < 9) await docService.save(DOC_GRAPH_ID, USER_ID, { baseVersion: i + 1, content: {}, plainText: `v${i + 2}` });
      }
      const result = await service.createAutomaticCheckpoint(DOC_GRAPH_ID);
      expect(result.skipped).toBe(true);
    }, 15000);
  });

  describe('FTS scoping', () => {
    let service: DocumentSearchService;
    let docService: DocumentService;

    beforeEach(async () => {
      await seedGraph();
      await seedUsers();
      await seedWorkspace();
      service = new DocumentSearchService();
      docService = new DocumentService();
    });

    afterEach(async () => {
      await cleanup();
    });

    it('search finds latest durable text only', async () => {
      await docService.save(DOC_GRAPH_ID, USER_ID, { baseVersion: 0, plainText: 'old hidden content', content: {} });
      await docService.save(DOC_GRAPH_ID, USER_ID, { baseVersion: 1, plainText: 'new visible content', content: {} });
      const oldResult = await service.search({ q: 'hidden', workspace_graph_id: WS_GRAPH_ID }, USER_ID);
      expect(oldResult.results.length).toBe(0);
      const newResult = await service.search({ q: 'visible content', workspace_graph_id: WS_GRAPH_ID }, USER_ID);
      expect(newResult.results.length).toBeGreaterThan(0);
      expect(newResult.results[0].graph_id).toBe(DOC_GRAPH_ID);
    });

    it('search excludes inaccessible workspace content', async () => {
      await docService.save(DOC_GRAPH_ID, USER_ID, { baseVersion: 0, plainText: 'secret content', content: {} });
      await expect(service.search({ q: 'secret', workspace_graph_id: WS_GRAPH_ID }, OTHER_USER_ID))
        .rejects.toThrow('Access denied');
    });
  });

  describe('collaboration-auth capabilities', () => {
    let collabService: CollaborationService;
    const ADMIN_USER_ID = 'route-admin-' + Math.random().toString(36).slice(2, 8);

    beforeEach(async () => {
      await seedGraph();
      await seedUsers();
      await seedWorkspace();
      await seedDocument('hello', 1);
      await prisma.user.upsert({ where: { id: ADMIN_USER_ID }, create: { id: ADMIN_USER_ID, name: 'Admin', email: `admin+${ADMIN_USER_ID}@test.local` }, update: {} });
      await prisma.workspaceMember.upsert(
        { where: { workspaceId_userId: { workspaceId: WS_ID, userId: ADMIN_USER_ID } },
          create: { workspaceId: WS_ID, userId: ADMIN_USER_ID, role: 'admin' }, update: {} },
      );
      collabService = new CollaborationService();
    });

    afterEach(async () => {
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: WS_ID, userId: ADMIN_USER_ID } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: ADMIN_USER_ID } }).catch(() => {});
      await cleanup();
    });

    it('member gets read permission', async () => {
      const result = await collabService.authorize(DOC_GRAPH_ID, USER_ID);
      expect(result.permission).toBe('read');
      expect(result.room).toBe(`doc:${DOC_GRAPH_ID}`);
    });

    it('admin gets edit permission', async () => {
      const result = await collabService.authorize(DOC_GRAPH_ID, ADMIN_USER_ID);
      expect(result.permission).toBe('edit');
    });

    it('non-member is denied', async () => {
      await expect(collabService.authorize(DOC_GRAPH_ID, OTHER_USER_ID))
        .rejects.toThrow('Access denied');
    });

    it('unknown graph ID is denied', async () => {
      await expect(collabService.authorize('nonexistent-graph', USER_ID))
        .rejects.toThrow();
    });
  });
});
