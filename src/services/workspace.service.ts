import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { getNeo4jSession } from '../config/neo4j.js';
import { prisma } from '../config/database.js';
import { AppError } from '../errors/app-error.js';
import type {
  AddWorkspaceMemberDto,
  CreateWorkspaceDto,
  SearchUserResult,
  UpdateWorkspaceDto,
} from '../dtos/workspace.dto.js';

const workspaceInclude = {
  members: { include: { user: { select: { id: true, name: true, email: true } } } },
} as const;

function toWorkspaceResponse<T extends { graphId: string }>(workspace: T): Omit<T, 'graphId'> & { graph_id: string } {
  const { graphId, ...data } = workspace;
  return { ...data, graph_id: graphId };
}

async function createWorkspaceGraph(name: string, description: string | null): Promise<string> {
  const graphId = crypto.randomBytes(9).toString('base64url');
  const session = getNeo4jSession();
  try {
    const result = await session.run(
      'CREATE (workspace:Workspace {id: $graphId, name: $name, description: $description, createdAt: datetime()}) RETURN workspace.id AS graphId',
      { graphId, name, description },
    );
    return result.records[0].get('graphId') as string;
  } finally {
    await session.close();
  }
}

async function deleteWorkspaceGraph(graphId: string): Promise<void> {
  const session = getNeo4jSession();
  try {
    await session.run(
      'MATCH (workspace:Workspace {id: $graphId}) DETACH DELETE workspace',
      { graphId },
    );
  } finally {
    await session.close();
  }
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new AppError(`${field} is required`, 400);
  return value.trim();
}

export class WorkspaceService {
  async list(userId: string) {
    const workspaces = await prisma.workspace.findMany({
      // where: { members: { some: { userId } } },
      include: workspaceInclude,
      orderBy: { createdAt: 'desc' },
    });
    return workspaces.map(toWorkspaceResponse);
  }

  async get(userId: string, workspaceIdOrGraphId: string) {
    const workspace = await prisma.workspace.findFirst({
      where: { OR: [
        // { id: workspaceIdOrGraphId, members: { some: { userId } } },
        { graphId: workspaceIdOrGraphId },
      ]},
      include: workspaceInclude,
    });
    if (!workspace) throw new AppError('Workspace not found', 404);
    return toWorkspaceResponse(workspace);
  }

  async create(userId: string, input: unknown) {
    const data = input as Partial<CreateWorkspaceDto>;
    const name = requireText(data.name, 'Workspace name');
    const description = data.description === undefined ? null : data.description?.trim() || null;
    const graphId = await createWorkspaceGraph(name, description);

    try {
      const workspace = await prisma.workspace.create({
        data: {
          name,
          description,
          graphId,
          members: { create: { userId, role: 'creator' } },
        },
        include: workspaceInclude,
      });
      return toWorkspaceResponse(workspace);
    } catch (error) {
      await deleteWorkspaceGraph(graphId);
      throw error;
    }
  }

  async update(userId: string, workspaceId: string, input: unknown) {
    await this.requireAdmin(userId, workspaceId);
    const data = input as Partial<UpdateWorkspaceDto>;
    const updateData: Prisma.WorkspaceUpdateInput = {};
    if (data.name !== undefined) updateData.name = requireText(data.name, 'Workspace name');
    if (data.description !== undefined) updateData.description = data.description?.trim() || null;
    if (!Object.keys(updateData).length) throw new AppError('No workspace fields to update', 400);
    const workspace = await prisma.workspace.update({ where: { id: workspaceId }, data: updateData, include: workspaceInclude });
    return toWorkspaceResponse(workspace);
  }

  async remove(userId: string, workspaceIdOrGraphId: string): Promise<void> {
    const workspace = await prisma.workspace.findFirst({
      where: { OR: [{ id: workspaceIdOrGraphId }, { graphId: workspaceIdOrGraphId }] },
    });
    if (!workspace) throw new AppError('Workspace not found', 404);
    const creator = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
    });
    if (creator?.role !== 'creator') throw new AppError('Only the creator can delete a workspace', 403);
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await deleteWorkspaceGraph(workspace.graphId);
  }

  async addMember(userId: string, workspaceId: string, input: unknown) {
    await this.requireCreator(userId, workspaceId);
    const data = input as { email?: string };
    const email = requireText(data.email, 'Email').toLowerCase();
    const member = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true } });
    if (!member) throw new AppError('User not found', 404);
    try {
      return await prisma.workspaceMember.create({
        data: { workspaceId, userId: member.id, role: 'member' },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError('User is already a workspace member', 409);
      }
      throw error;
    }
  }

  async searchUsersByEmail(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const users = await prisma.user.findMany({
      where: { email: normalizedEmail },
      select: { id: true, name: true, email: true },
    });
    return users as SearchUserResult[];
  }

  async removeMember(userId: string, workspaceId: string, targetUserId: string): Promise<void> {
    await this.requireCreator(userId, workspaceId);
    if (userId === targetUserId) {
      throw new AppError('Workspace creator cannot remove themselves', 403);
    }
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!membership) throw new AppError('User is not a workspace member', 404);
    await prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
  }

  private async requireAdmin(userId: string, workspaceId: string): Promise<void> {
    const membership = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
    if (!membership) throw new AppError('Workspace not found', 404);
    if (membership.role !== 'creator' && membership.role !== 'admin') throw new AppError('Workspace admin access required', 403);
  }

  private async requireCreator(userId: string, workspaceId: string): Promise<void> {
    const membership = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
    if (!membership) throw new AppError('Workspace not found', 404);
    if (membership.role !== 'creator') throw new AppError('Only the workspace creator can manage members', 403);
  }
}
