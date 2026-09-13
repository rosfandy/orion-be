import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DocumentVersionService } from '../document-version.service.js';
import { getNeo4jSession } from '../../config/neo4j.js';
import { prisma } from '../../config/database.js';
import { DocumentService } from '../document.service.js';

const TEST_GRAPH_ID = 'dv-test-graph-' + Math.random().toString(36).slice(2, 8);
const TEST_WORKSPACE_ID = 'dv-ws-' + Math.random().toString(36).slice(2, 8);
const TEST_USER_ID = 'dv-user-' + Math.random().toString(36).slice(2, 8);
const TEST_EMAIL = `test+${TEST_USER_ID}@orion.local`;

async function seedTestGraph() {
  const session = getNeo4jSession();
  try {
    await session.run(
      'MERGE (w:Workspace {id: $graphId}) SET w.name = "DV Test Workspace"',
      { graphId: TEST_WORKSPACE_ID },
    );
    await session.run(
      'MATCH (w:Workspace {id: $wsGraphId}) CREATE (w)-[:HAS_DOCUMENT]->(d:Document {id: $docGraphId})',
      { wsGraphId: TEST_WORKSPACE_ID, docGraphId: TEST_GRAPH_ID },
    ).catch(() => {});
  } finally {
    await session.close();
  }
}

async function seedTestWorkspaceMember() {
  await prisma.user.upsert({
    where: { id: TEST_USER_ID },
    create: { id: TEST_USER_ID, name: 'DV Test User', email: TEST_EMAIL },
    update: {},
  });
  await prisma.workspace.upsert({
    where: { id: TEST_WORKSPACE_ID },
    create: {
      id: TEST_WORKSPACE_ID,
      name: 'DV Test Workspace',
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
    create: {
      graphId: TEST_GRAPH_ID,
      content: { blocks: [{ type: 'paragraph', children: [{ text: 'v' + version }] }] },
      plainText: 'v' + version,
      version,
    },
    update: {
      content: { blocks: [{ type: 'paragraph', children: [{ text: 'v' + version }] }] },
      plainText: 'v' + version,
      version,
    },
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
  await prisma.documentVersion.deleteMany({ where: { graphId: TEST_GRAPH_ID } }).catch(() => {});
  await prisma.document.deleteMany({ where: { graphId: TEST_GRAPH_ID } }).catch(() => {});
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: TEST_WORKSPACE_ID } }).catch(() => {});
  await prisma.workspace.deleteMany({ where: { id: TEST_WORKSPACE_ID } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: TEST_USER_ID } }).catch(() => {});
}

describe('DocumentVersionService', () => {
  let service: DocumentVersionService;
  let docService: DocumentService;

  beforeEach(async () => {
    await cleanup();
    service = new DocumentVersionService();
    docService = new DocumentService();
    await seedTestGraph();
    await seedTestWorkspaceMember();
    await seedTestDocumentRow(1);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('returns empty list when no versions exist', async () => {
    const versions = await service.listVersions(TEST_GRAPH_ID, TEST_USER_ID);
    expect(versions).toEqual([]);
  });

  it('creates manual snapshot and returns it', async () => {
    const result = await service.createManualSnapshot(TEST_GRAPH_ID, TEST_USER_ID);
    expect(result.id).toBeDefined();
    expect(result.is_manual).toBe(true);
    expect(result.source_version).toBe(1);
    expect(result.created_by).toBe(TEST_USER_ID);
  });

  it('lists versions newest-first', async () => {
    await service.createManualSnapshot(TEST_GRAPH_ID, TEST_USER_ID);
    await seedTestDocumentRow(2);
    await service.createManualSnapshot(TEST_GRAPH_ID, TEST_USER_ID);

    const versions = await service.listVersions(TEST_GRAPH_ID, TEST_USER_ID);
    expect(versions).toHaveLength(2);
    expect(versions[0].source_version).toBe(2);
    expect(versions[1].source_version).toBe(1);
  });

  it('gets a specific version snapshot', async () => {
    const created = await service.createManualSnapshot(TEST_GRAPH_ID, TEST_USER_ID);
    const detail = await service.getVersion(TEST_GRAPH_ID, TEST_USER_ID, created.id);
    expect(detail.id).toBe(created.id);
    expect(detail.source_version).toBe(1);
    expect(detail.content).toEqual({ blocks: [{ type: 'paragraph', children: [{ text: 'v1' }] }] });
  });

  it('quota full with 9 automatic snapshots allows 10th automatic (deletes oldest)', async () => {
    for (let i = 0; i < 9; i++) {
      await service.createAutomaticCheckpoint(TEST_GRAPH_ID);
      await seedTestDocumentRow(i + 2);
    }

    await seedTestDocumentRow(11);
    const result = await service.createAutomaticCheckpoint(TEST_GRAPH_ID);
    expect(result).toBeDefined();

    const versions = await service.listVersions(TEST_GRAPH_ID, TEST_USER_ID);
    expect(versions).toHaveLength(10);
  });

  it('quota full with mixed manual/automatic deletes oldest automatic', async () => {
    // Create 5 manual
    for (let i = 0; i < 5; i++) {
      await service.createManualSnapshot(TEST_GRAPH_ID, TEST_USER_ID);
      await seedTestDocumentRow(i + 2);
    }
    // Create 5 automatic
    for (let i = 0; i < 5; i++) {
      await service.createAutomaticCheckpoint(TEST_GRAPH_ID);
      await seedTestDocumentRow(i + 7);
    }

    await seedTestDocumentRow(12);
    const result = await service.createAutomaticCheckpoint(TEST_GRAPH_ID);
    expect(result).toBeDefined();

    const versions = await service.listVersions(TEST_GRAPH_ID, TEST_USER_ID);
    expect(versions).toHaveLength(10);
    // Oldest automatic should be gone, all 5 manual remain
    const manualCount = versions.filter(v => v.is_manual).length;
    expect(manualCount).toBe(5);
  });

  it('10 manual snapshots -> automatic checkpoint is skipped non-fatally', async () => {
    for (let i = 0; i < 10; i++) {
      await service.createManualSnapshot(TEST_GRAPH_ID, TEST_USER_ID);
      if (i < 9) await seedTestDocumentRow(i + 2);
    }

    const result = await service.createAutomaticCheckpoint(TEST_GRAPH_ID);
    expect(result.skipped).toBe(true);

    // Current document persistence still works
    const saved = await docService.save(TEST_GRAPH_ID, TEST_USER_ID, { baseVersion: 10, content: { blocks: [] }, plainText: '' });
    expect(saved.version).toBe(11);
  }, 15000);

  it('10 manual snapshots -> manual create is rejected with 409', async () => {
    for (let i = 0; i < 10; i++) {
      await service.createManualSnapshot(TEST_GRAPH_ID, TEST_USER_ID);
      if (i < 9) await seedTestDocumentRow(i + 2);
    }

    await expect(service.createManualSnapshot(TEST_GRAPH_ID, TEST_USER_ID))
      .rejects.toThrow('VERSION_HISTORY_FULL');
  }, 15000);

  it('explicit deletion opens capacity for new snapshots', async () => {
    for (let i = 0; i < 10; i++) {
      await service.createManualSnapshot(TEST_GRAPH_ID, TEST_USER_ID);
      if (i < 9) await seedTestDocumentRow(i + 2);
    }

    const versions = await service.listVersions(TEST_GRAPH_ID, TEST_USER_ID);
    const oldestId = versions[9].id; // oldest (newest-first, so index 9)
    await service.deleteVersion(TEST_GRAPH_ID, TEST_USER_ID, oldestId);

    await seedTestDocumentRow(12);
    const result = await service.createAutomaticCheckpoint(TEST_GRAPH_ID);
    expect(result).toBeDefined();

    const after = await service.listVersions(TEST_GRAPH_ID, TEST_USER_ID);
    expect(after).toHaveLength(10);
  }, 15000);

  it('cannot delete a manual snapshot via automatic cleanup', async () => {
    for (let i = 0; i < 10; i++) {
      await service.createManualSnapshot(TEST_GRAPH_ID, TEST_USER_ID);
      if (i < 9) await seedTestDocumentRow(i + 2);
    }

    // All 10 are manual - automatic should skip, not delete any
    const result = await service.createAutomaticCheckpoint(TEST_GRAPH_ID);
    expect(result.skipped).toBe(true);

    const versions = await service.listVersions(TEST_GRAPH_ID, TEST_USER_ID);
    expect(versions).toHaveLength(10);
    expect(versions.every(v => v.is_manual)).toBe(true);
  }, 15000);

  it('version detail includes base64 yjs state when present', async () => {
    const testYjs = Buffer.from([1, 2, 3, 4]);
    await prisma.document.update({
      where: { graphId: TEST_GRAPH_ID },
      data: { yjsState: testYjs as never, version: 2 },
    });
    await seedTestDocumentRow(2);

    const result = await service.createManualSnapshot(TEST_GRAPH_ID, TEST_USER_ID);
    const detail = await service.getVersion(TEST_GRAPH_ID, TEST_USER_ID, result.id);
    expect(detail.yjs_state).toBeDefined();
    expect(detail.yjs_state).toBe(Buffer.from([1, 2, 3, 4]).toString('base64'));
  });

  it('concurrent snapshot requests preserve quota invariant', async () => {
    // Pre-populate exactly 8 automatic versions
    for (let i = 0; i < 8; i++) {
      await service.createAutomaticCheckpoint(TEST_GRAPH_ID);
      await seedTestDocumentRow(i + 2);
    }

    // Fire 5 concurrent automatic checkpoints.
    // Under ReadCommitted the count check has a small race window, but the
    // hard invariant (total <= 10) must hold regardless.
    const results = await Promise.all([
      service.createAutomaticCheckpoint(TEST_GRAPH_ID),
      service.createAutomaticCheckpoint(TEST_GRAPH_ID),
      service.createAutomaticCheckpoint(TEST_GRAPH_ID),
      service.createAutomaticCheckpoint(TEST_GRAPH_ID),
      service.createAutomaticCheckpoint(TEST_GRAPH_ID),
    ]);

    const succeeded = results.filter(r => !r.skipped);
    expect(succeeded.length).toBeLessThanOrEqual(5); // bounded by concurrent callers

    // Hard invariant: total versions must never exceed 10
    const versions = await service.listVersions(TEST_GRAPH_ID, TEST_USER_ID);
    expect(versions.length).toBeLessThanOrEqual(10);
  }, 15000);

  it('reuses document service save without blocking on history-full state', async () => {
    for (let i = 0; i < 10; i++) {
      await service.createManualSnapshot(TEST_GRAPH_ID, TEST_USER_ID);
      if (i < 9) await seedTestDocumentRow(i + 2);
    }

    // Save should still work even though history is full
    const saved = await docService.save(TEST_GRAPH_ID, TEST_USER_ID, { baseVersion: 10, content: { blocks: [] }, plainText: 'still works' });
    expect(saved.version).toBe(11);
  }, 15000);
});
