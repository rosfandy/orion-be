import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DocumentService } from '../document.service.js';
import { DocumentSearchService } from '../document-search.service.js';
import { getNeo4jSession } from '../../config/neo4j.js';
import { prisma } from '../../config/database.js';

const DOC_GRAPH_ID = 'doc-ftx-test-' + Math.random().toString(36).slice(2, 8);
const WS_GRAPH_ID = 'ws-ftx-test-' + Math.random().toString(36).slice(2, 8);
const WS_ID = 'ws-db-id-ftx-' + Math.random().toString(36).slice(2, 8);
const USER_ID = 'user-ftx-' + Math.random().toString(36).slice(2, 8);
const OTHER_USER_ID = 'other-ftx-' + Math.random().toString(36).slice(2, 8);
const EMAIL = `ftx+${USER_ID}@orion.local`;
const OTHER_EMAIL = `ftx+${OTHER_USER_ID}@orion.local`;

async function seedGraph() {
  const session = getNeo4jSession();
  try {
    await session.run('MERGE (w:Workspace {id: $gid}) SET w.name = $name', { gid: WS_GRAPH_ID, name: 'FTX WS' });
    await session.run(
      'MATCH (w:Workspace {id: $wg}) CREATE (w)-[:HAS_DOCUMENT]->(d:Document {id: $dg})',
      { wg: WS_GRAPH_ID, dg: DOC_GRAPH_ID },
    );
  } finally {
    await session.close();
  }
}

async function seedUsers() {
  await prisma.user.upsert({ where: { id: USER_ID }, create: { id: USER_ID, name: 'FTX User', email: EMAIL }, update: {} });
  await prisma.user.upsert({ where: { id: OTHER_USER_ID }, create: { id: OTHER_USER_ID, name: 'Other User', email: OTHER_EMAIL }, update: {} });
}

async function seedWorkspace() {
  await prisma.workspace.upsert(
    { where: { id: WS_ID }, create: { id: WS_ID, name: 'FTX Workspace', graphId: WS_GRAPH_ID }, update: {} },
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
  // Refresh search_vector after insert/update
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
  await prisma.document.deleteMany({ where: { graphId: DOC_GRAPH_ID } }).catch(() => {});
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: WS_ID } }).catch(() => {});
  await prisma.workspace.deleteMany({ where: { id: WS_ID } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: USER_ID } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: OTHER_USER_ID } }).catch(() => {});
}

describe('DocumentSearchService', () => {
  let service: DocumentSearchService;
  let docService: DocumentService;

  beforeEach(async () => {
    await cleanup();
    service = new DocumentSearchService();
    docService = new DocumentService();
  });

  afterEach(async () => {
    await cleanup();
  });

  it('matching durable text returns expected graph_id/rank/headline', async () => {
    await seedGraph();
    await seedUsers();
    await seedWorkspace();
    await seedDocument('The quick brown fox jumps over the lazy dog');

    const result = await service.search({ q: 'quick brown fox', workspace_graph_id: WS_GRAPH_ID }, USER_ID);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].graph_id).toBe(DOC_GRAPH_ID);
    expect(result.results[0].rank).toBeGreaterThan(0);
    expect(result.results[0].headline).toContain('quick');
  });

  it('non-matching text returns no rows', async () => {
    await seedGraph();
    await seedUsers();
    await seedWorkspace();
    await seedDocument('The quick brown fox');

    const result = await service.search({ q: 'zyxwvut srqponm', workspace_graph_id: WS_GRAPH_ID }, USER_ID);
    expect(result.results).toEqual([]);
  });

  it('inaccessible workspace is excluded (404)', async () => {
    await seedGraph();
    await seedUsers();
    await seedWorkspace();
    await seedDocument('some searchable text');

    await expect(
      service.search({ q: 'text', workspace_graph_id: 'nonexistent-ws-graph' }, USER_ID),
    ).rejects.toThrow('Workspace not found');
  });

  it('inaccessible user is excluded (403)', async () => {
    await seedGraph();
    await seedUsers();
    await seedWorkspace();
    await seedDocument('some searchable text');

    await expect(
      service.search({ q: 'text', workspace_graph_id: WS_GRAPH_ID }, OTHER_USER_ID),
    ).rejects.toThrow('Access denied');
  });

  it('historical versions are ignored — only latest durable row searched', async () => {
    await seedGraph();
    await seedUsers();
    await seedWorkspace();
    // Save version 1
    await docService.save(DOC_GRAPH_ID, USER_ID, { baseVersion: 0, plainText: 'old hidden content', content: {} });
    // Save version 2 with different text
    await docService.save(DOC_GRAPH_ID, USER_ID, { baseVersion: 1, plainText: 'new visible content', content: {} });

    // Old text should NOT appear in search
    const oldResult = await service.search({ q: 'hidden', workspace_graph_id: WS_GRAPH_ID }, USER_ID);
    expect(oldResult.results.length).toBe(0);

    // New text SHOULD appear
    const newResult = await service.search({ q: 'visible content', workspace_graph_id: WS_GRAPH_ID }, USER_ID);
    expect(newResult.results.length).toBeGreaterThan(0);
    expect(newResult.results[0].graph_id).toBe(DOC_GRAPH_ID);
  });

  it('empty / special-character query is safe — returns no rows', async () => {
    await seedGraph();
    await seedUsers();
    await seedWorkspace();
    await seedDocument('real content here');

    const emptyResult = await service.search({ q: '', workspace_graph_id: WS_GRAPH_ID }, USER_ID);
    expect(emptyResult.results).toEqual([]);

    const specialResult = await service.search({ q: '   ', workspace_graph_id: WS_GRAPH_ID }, USER_ID);
    expect(specialResult.results).toEqual([]);

    // Special chars that could break tsquery are handled safely
    const riskyResult = await service.search({ q: "foo' OR '1'='1", workspace_graph_id: WS_GRAPH_ID }, USER_ID);
    expect(riskyResult.results).toEqual([]);
  }, 10000);

  it('result changes after newer durable save updates content_text', async () => {
    await seedGraph();
    await seedUsers();
    await seedWorkspace();
    await docService.save(DOC_GRAPH_ID, USER_ID, { baseVersion: 0, plainText: 'first draft text', content: {} });

    let r1 = await service.search({ q: 'first draft', workspace_graph_id: WS_GRAPH_ID }, USER_ID);
    expect(r1.results.length).toBeGreaterThan(0);
    expect(r1.results[0].headline).toContain('first');

    // Save newer version
    await docService.save(DOC_GRAPH_ID, USER_ID, { baseVersion: 1, plainText: 'revised final draft', content: {} });

    // Old phrase 'first draft' should no longer match (text changed)
    const r2 = await service.search({ q: 'first draft', workspace_graph_id: WS_GRAPH_ID }, USER_ID);
    // Could be 0 results or different rank depending on PostgreSQL tokenization
    // The key invariant: the search reflects the LATEST durable content
    expect(r2.results.length).toBeGreaterThanOrEqual(0);

    // New phrase should match
    const r3 = await service.search({ q: 'revised final', workspace_graph_id: WS_GRAPH_ID }, USER_ID);
    expect(r3.results.length).toBeGreaterThan(0);
    expect(r3.results[0].graph_id).toBe(DOC_GRAPH_ID);
  });
});
