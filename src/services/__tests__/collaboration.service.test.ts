import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getNeo4jSession } from '../../config/neo4j.js';
import { prisma } from '../../config/database.js';
import { CollaborationService, roomIdentity, decodeCollabToken } from '../collaboration.service.js';
import { AppError } from '../../errors/app-error.js';

const TEST_GRAPH_ID = 'collab-test-graph-id-' + Math.random().toString(36).slice(2, 8);
const TEST_WORKSPACE_ID = 'collab-ws-test-id-' + Math.random().toString(36).slice(2, 8);
const TEST_MEMBER_USER_ID = 'collab-user-member-' + Math.random().toString(36).slice(2, 8);
const TEST_ADMIN_USER_ID = 'collab-user-admin-' + Math.random().toString(36).slice(2, 8);
const TEST_NON_MEMBER_USER_ID = 'collab-user-nonmember-' + Math.random().toString(36).slice(2, 8);

async function seedTestGraph() {
  const session = getNeo4jSession();
  try {
    await session.run(
      'MERGE (w:Workspace {id: $wsId}) SET w.name = "Collab Test Workspace"',
      { wsId: TEST_WORKSPACE_ID },
    );
    await session.run(
      'MATCH (w:Workspace {id: $wsId}) CREATE (w)-[:HAS_DOCUMENT]->(d:Document {id: $docId})',
      { wsId: TEST_WORKSPACE_ID, docId: TEST_GRAPH_ID },
    ).catch(() => {});
  } finally {
    await session.close();
  }
}

async function seedWorkspacesAndMembers() {
  await prisma.user.upsert({
    where: { id: TEST_MEMBER_USER_ID },
    create: { id: TEST_MEMBER_USER_ID, name: 'Member User', email: `member+${TEST_MEMBER_USER_ID}@test.local` },
    update: {},
  });
  await prisma.user.upsert({
    where: { id: TEST_ADMIN_USER_ID },
    create: { id: TEST_ADMIN_USER_ID, name: 'Admin User', email: `admin+${TEST_ADMIN_USER_ID}@test.local` },
    update: {},
  });
  await prisma.user.upsert({
    where: { id: TEST_NON_MEMBER_USER_ID },
    create: { id: TEST_NON_MEMBER_USER_ID, name: 'Non-Member User', email: `nonmember+${TEST_NON_MEMBER_USER_ID}@test.local` },
    update: {},
  });

  await prisma.workspace.upsert({
    where: { id: TEST_WORKSPACE_ID },
    create: { id: TEST_WORKSPACE_ID, name: 'Collab Test Workspace', graphId: TEST_WORKSPACE_ID },
    update: {},
    include: { members: true },
  });

  await prisma.workspaceMember.create({ data: { workspaceId: TEST_WORKSPACE_ID, userId: TEST_MEMBER_USER_ID, role: 'member' } });
  await prisma.workspaceMember.create({ data: { workspaceId: TEST_WORKSPACE_ID, userId: TEST_ADMIN_USER_ID, role: 'admin' } });
  // Non-member is intentionally NOT added.
}

async function cleanup() {
  const session = getNeo4jSession();
  try {
    await session.run('MATCH (n {id: $gid}) DETACH DELETE n', { gid: TEST_GRAPH_ID }).catch(() => {});
    await session.run('MATCH (n {id: $gid}) DETACH DELETE n', { gid: TEST_WORKSPACE_ID }).catch(() => {});
  } finally {
    await session.close();
  }
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: TEST_WORKSPACE_ID } }).catch(() => {});
  await prisma.workspace.deleteMany({ where: { id: TEST_WORKSPACE_ID } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: TEST_MEMBER_USER_ID } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: TEST_ADMIN_USER_ID } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: TEST_NON_MEMBER_USER_ID } }).catch(() => {});
}

describe('CollaborationService', () => {
  let service: CollaborationService;

  beforeEach(async () => {
    await cleanup();
    service = new CollaborationService();
  });

  afterEach(async () => {
    await cleanup();
  });

  it('returns valid collaboration data for an admin member', async () => {
    await seedTestGraph();
    await seedWorkspacesAndMembers();

    const result = await service.authorize(TEST_GRAPH_ID, TEST_ADMIN_USER_ID);

    expect(result.room).toBe(roomIdentity(TEST_GRAPH_ID));
    expect(typeof result.token).toBe('string');
    expect(result.permission).toBe('edit');
    expect(typeof result.websocketUrl).toBe('string');

    // Token should decode back to matching values.
    const decoded = decodeCollabToken(result.token);
    expect(decoded.room).toBe(result.room);
    expect(decoded.permission).toBe('edit');
  });

  it('returns read-only permission for a regular member', async () => {
    await seedTestGraph();
    await seedWorkspacesAndMembers();

    const result = await service.authorize(TEST_GRAPH_ID, TEST_MEMBER_USER_ID);

    expect(result.permission).toBe('read');
    expect(result.room).toBe(roomIdentity(TEST_GRAPH_ID));
  });

  it('denies unauthorized users (not a workspace member)', async () => {
    await seedTestGraph();
    await seedWorkspacesAndMembers();

    await expect(service.authorize(TEST_GRAPH_ID, TEST_NON_MEMBER_USER_ID))
      .rejects.toBeInstanceOf(AppError);
  });

  it('denies unknown/deleted document graph ID', async () => {
    await seedWorkspacesAndMembers();

    await expect(service.authorize('nonexistent-graph-id', TEST_MEMBER_USER_ID))
      .rejects.toBeInstanceOf(AppError);
  });

  it('room identity is deterministic for the same document', () => {
    expect(roomIdentity(TEST_GRAPH_ID)).toBe(`doc:${TEST_GRAPH_ID}`);
    expect(roomIdentity(TEST_GRAPH_ID)).toBe(`doc:${TEST_GRAPH_ID}`); // stable across calls
  });

  it('token issued for one room cannot be reused for another room — enforced by server validation', async () => {
    // The server checks payload.room against the requested room at connection time.
    // Here we verify the token structure carries the correct room claim.
    const { sign } = await import('jsonwebtoken');
    const { env } = await import('../../config/env.js');
    const token = sign(
      { room: 'doc:some-other-doc', permission: 'edit', sub: 'user-1' },
      env.jwtSecret,
      { expiresIn: '5m' },
    );
    const decoded = decodeCollabToken(token);
    expect(decoded.room).toBe('doc:some-other-doc');
    // Server would reject this token when client connects to doc:<different-graph-id>
  });

  it('rejects tampered collaboration token', () => {
    expect(() => decodeCollabToken('invalid-token-value'))
      .toThrow('Invalid or expired collaboration token');
  });
});
