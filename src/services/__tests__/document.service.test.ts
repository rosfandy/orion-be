import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DocumentService } from '../document.service.js';
import { getNeo4jSession } from '../../config/neo4j.js';
import { prisma } from '../../config/database.js';

const TEST_GRAPH_ID = 'doc-test-graph-id-' + Math.random().toString(36).slice(2, 8);
const TEST_WORKSPACE_ID = 'ws-test-id-' + Math.random().toString(36).slice(2, 8);
const TEST_USER_ID = 'user-test-id-' + Math.random().toString(36).slice(2, 8);
const TEST_EMAIL = `test+${TEST_USER_ID}@orion.local`;

async function seedTestGraph() {
  const session = getNeo4jSession();
  try {
    await session.run(
      'MERGE (w:Workspace {id: $graphId}) SET w.name = "Test Workspace"',
      { graphId: TEST_WORKSPACE_ID },
    );
    await session.run(
      'MATCH (w:Workspace {id: $wsGraphId}) CREATE (w)-[:HAS_DOCUMENT]->(d:Document {id: $docGraphId})',
      { wsGraphId: TEST_WORKSPACE_ID, docGraphId: TEST_GRAPH_ID },
    ).catch(() => {}); // ignore if already exists
  } finally {
    await session.close();
  }
}

async function seedTestWorkspaceMember() {
  await prisma.user.upsert({
    where: { id: TEST_USER_ID },
    create: { id: TEST_USER_ID, name: 'Test User', email: TEST_EMAIL },
    update: {},
  });
  await prisma.workspace.upsert({
    where: { id: TEST_WORKSPACE_ID },
    create: {
      id: TEST_WORKSPACE_ID,
      name: 'Test Workspace',
      graphId: TEST_WORKSPACE_ID,
      members: { create: { userId: TEST_USER_ID, role: 'member' } },
    },
    update: {},
    include: { members: true },
  });
}

async function seedTestDocumentRow(version = 1) {
  await prisma.document.upsert({
    where: { graphId: TEST_GRAPH_ID },
    create: { graphId: TEST_GRAPH_ID, content: { blocks: [] }, plainText: '', version },
    update: { version },
  });
}

async function cleanup() {
  const session = getNeo4jSession();
  try {
    await session.run('MATCH (n {id: $gid}) DETACH DELETE n', { gid: TEST_GRAPH_ID }).catch(() => {});
    await session.run('MATCH (n {id: $gid}) DETACH DELETE n', { gid: TEST_WORKSPACE_ID }).catch(() => {});
  } finally {
    await session.close();
  }
  await prisma.document.deleteMany({ where: { graphId: TEST_GRAPH_ID } }).catch(() => {});
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: TEST_WORKSPACE_ID } }).catch(() => {});
  await prisma.workspace.deleteMany({ where: { id: TEST_WORKSPACE_ID } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: TEST_USER_ID } }).catch(() => {});
}

describe('DocumentService', () => {
  let service: DocumentService;

  beforeEach(async () => {
    await cleanup();
    service = new DocumentService();
  });

  afterEach(async () => {
    await cleanup();
  });

  it('returns empty initial state when graph Document exists but no PostgreSQL row', async () => {
    await seedTestGraph();
    await seedTestWorkspaceMember();
    const result = await service.load(TEST_GRAPH_ID, TEST_USER_ID);
    expect(result.graph_id).toBe(TEST_GRAPH_ID);
    expect(result.content).toEqual({});
    expect(result.plain_text).toBe('');
    expect(result.version).toBe(0);
    expect(result.has_content).toBe(false);
  });

  it('first save creates the row and returns version 1', async () => {
    await seedTestGraph();
    await seedTestWorkspaceMember();
    const saveInput = { baseVersion: 0, content: { blocks: [{ type: 'heading', text: 'Hello' }] }, plainText: 'Hello' };
    const result = await service.save(TEST_GRAPH_ID, TEST_USER_ID, saveInput);
    expect(result.version).toBe(1);
    expect(result.has_content).toBe(true);
    expect(result.content).toEqual(saveInput.content);
    expect(result.plain_text).toBe(saveInput.plainText);
  });

  it('subsequent saves increment version on the same row', async () => {
    await seedTestGraph();
    await seedTestWorkspaceMember();
    await seedTestDocumentRow(1);

    const saveInput = { baseVersion: 1, content: { blocks: [{ type: 'paragraph' }] }, plainText: 'Updated' };
    const result = await service.save(TEST_GRAPH_ID, TEST_USER_ID, saveInput);
    expect(result.version).toBe(2);
  });

  it('returns 404 for unknown graph ID', async () => {
    await seedTestWorkspaceMember();
    await expect(service.load('unknown-graph-id', TEST_USER_ID))
      .rejects.toThrow('Document not found');
  });

  it('returns 403 when user has no workspace membership', async () => {
    await seedTestGraph();
    // Seed workspace in DB so Neo4j traversal succeeds, but do NOT add the target user as member
    await prisma.workspace.upsert({
      where: { id: TEST_WORKSPACE_ID },
      create: { id: TEST_WORKSPACE_ID, name: 'Test Workspace', graphId: TEST_WORKSPACE_ID },
      update: {},
    });
    await seedTestDocumentRow();
    await expect(service.load(TEST_GRAPH_ID, 'other-user-id'))
      .rejects.toThrow('Access denied');
  });

  it('rejects stale base_version with 409', async () => {
    await seedTestGraph();
    await seedTestWorkspaceMember();
    await seedTestDocumentRow(3); // DB has version 3

    const saveInput = { baseVersion: 1, content: { blocks: [] }, plainText: 'stale' };
    await expect(service.save(TEST_GRAPH_ID, TEST_USER_ID, saveInput))
      .rejects.toThrow('Document was modified by another session');
  });

  it('requires authentication via workspace membership', async () => {
    await seedTestGraph();
    await seedTestWorkspaceMember();
    await expect(service.save(TEST_GRAPH_ID, 'unauthorized-user', { baseVersion: 0 }))
      .rejects.toThrow('Access denied');
  });
});
