import crypto from 'node:crypto';
import neo4j, { type Node, type Relationship } from 'neo4j-driver';
import { getNeo4jSession } from '../config/neo4j.js';
import { AppError } from '../errors/app-error.js';
import type { CreateGraphDto, UpdateGraphDto } from '../dtos/graph.dto.js';

type GraphNode = {
  id: string;
  labels: string[];
  props: Record<string, unknown>;
};

type StructuredGraph = {
  data: Record<string, unknown>;
  [relation: string]: unknown;
};

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
    throw new AppError(`${field} must be a valid graph identifier`, 400);
  }
  return value;
}

function properties(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AppError('Graph props must be an object', 400);
  }
  return value as Record<string, unknown>;
}

function normalizeValue(value: unknown): unknown {
  if (neo4j.isInt(value)) return value.toNumber();

  if (value && typeof value === 'object') {
    const temporal = value as { year?: unknown; month?: unknown; day?: unknown; toString?: () => string };
    if (temporal.year !== undefined && temporal.month !== undefined && temporal.day !== undefined && temporal.toString) {
      return temporal.toString();
    }

    if (Array.isArray(value)) return value.map(normalizeValue);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeValue(item)]));
  }

  return value;
}

function toGraphNode(node: Node): GraphNode {
  return {
    id: node.properties.id as string,
    labels: node.labels,
    props: normalizeValue(node.properties) as Record<string, unknown>,
  };
}

function nodeId(node: Node): string {
  return node.properties.id as string;
}

function structuredNode(
  node: Node,
  relationships: Relationship[],
  nodesByElementId: Map<string, Node>,
  visited: Set<string>,
): StructuredGraph {
  const id = nodeId(node);
  const result: StructuredGraph = {
    data: {
      ...(normalizeValue(node.properties) as Record<string, unknown>),
      labels: node.labels,
    },
  };
  if (visited.has(id)) return result;

  const nextVisited = new Set(visited).add(id);
  for (const relationship of relationships) {
    if (relationship.startNodeElementId !== node.elementId) continue;
    const childId = relationship.endNodeElementId;
    const child = nodesByElementId.get(childId);
    if (!child) continue;
    const relation = relationship.type;
    const childGraph = structuredNode(child, relationships, nodesByElementId, nextVisited);
    const childData = {
      relation_id: relationship.properties.relation_id ?? relationship.elementId,
      ...childGraph,
    };
    const children = (result[relation] as unknown[] | undefined) ?? [];
    children.push(childData);
    result[relation] = children;
  }
  return result;
}

function toStructuredGraph(root: Node, nodes: Node[], relationships: Relationship[]): Record<string, unknown> {
  const structured = structuredNode(root, relationships, new Map(nodes.map((node) => [node.elementId, node])), new Set());
  const { data, ...relations } = structured;
  return { meta: data, ...relations };
}

export class GraphService {
  async create(input: unknown): Promise<GraphNode> {
    const data = input as Partial<CreateGraphDto>;
    const label = identifier(data.label, 'Label');
    const props = properties(data.props);
    if (data.children !== undefined && !Array.isArray(data.children)) {
      throw new AppError('Children must be an array', 400);
    }
    const children = (data.children ?? []).map((child) => ({
      relation: identifier(child.relation, 'Relation'),
      label: identifier(child.label, 'Label'),
      props: properties(child.props),
    }));
    const id = crypto.randomBytes(9).toString('base64url');
    const session = getNeo4jSession();

    try {
      const result = await session.run(
        `CREATE (graph:\`${label}\` {id: $id}) SET graph += $props RETURN graph`,
        { id, props },
      );
      for (const child of children) {
        const childId = crypto.randomBytes(9).toString('base64url');
        const relationId = crypto.randomBytes(9).toString('base64url');
        await session.run(
          `MATCH (parent {id: $parentId}) CREATE (parent)-[:\`${child.relation}\` {relation_id: $relationId}]->(child:\`${child.label}\` {id: $childId}) SET child += $props`,
          { parentId: id, childId, relationId, props: child.props },
        );
      }
      return toGraphNode(result.records[0].get('graph'));
    } catch (error) {
      await session.run('MATCH (graph {id: $id}) DETACH DELETE graph', { id });
      throw error;
    } finally {
      await session.close();
    }
  }

  async get(id: string): Promise<Record<string, unknown>> {
    const session = getNeo4jSession();
    try {
      const result = await session.run(
        `MATCH (root {id: $id})
         CALL apoc.path.subgraphAll(root, {relationshipFilter: '>'})
         YIELD nodes, relationships
         RETURN root, nodes, relationships`,
        { id },
      );
      if (!result.records.length) throw new AppError('Graph not found', 404);
      const record = result.records[0];
      const root = record.get('root') as Node;
      const nodes = record.get('nodes') as Node[];
      const relationships = record.get('relationships') as Relationship[];
      return toStructuredGraph(root, nodes, relationships);
    } finally {
      await session.close();
    }
  }

  async getByLabel(labelInput: string, props: unknown): Promise<Record<string, unknown>[]> {
    identifier(labelInput, 'Label');
    const filters = properties(props);
    const session = getNeo4jSession();

    try {
      const result = await session.run(
        `MATCH (graph)
         WHERE any(nodeLabel IN labels(graph) WHERE toLower(nodeLabel) = toLower($label))
           AND all(key IN keys($props) WHERE graph[key] = $props[key])
         CALL apoc.path.subgraphAll(graph, {relationshipFilter: '>'})
         YIELD nodes, relationships
         RETURN graph AS root, nodes, relationships`,
        { label: labelInput, props: filters },
      );
      return result.records.map((record) => toStructuredGraph(
        record.get('root') as Node,
        record.get('nodes') as Node[],
        record.get('relationships') as Relationship[],
      ));
    } finally {
      await session.close();
    }
  }

  async update(id: string, input: unknown): Promise<GraphNode> {
    const data = input as Partial<UpdateGraphDto>;
    const props = properties(data.props);
    const label = data.label === undefined ? undefined : identifier(data.label, 'Label');
    if (data.children !== undefined && !Array.isArray(data.children)) {
      throw new AppError('Children must be an array', 400);
    }
    const children = (data.children ?? []).map((child) => ({
      id: child.id,
      relation: identifier(child.relation, 'Relation'),
      label: identifier(child.label, 'Label'),
      props: properties(child.props),
    }));
    const session = getNeo4jSession();

    try {
      const result = await session.run(
        `MATCH (graph {id: $id})${label ? ` SET graph:\`${label}\`` : ''} SET graph += $props RETURN graph`,
        { id, props },
      );
      if (!result.records.length) throw new AppError('Graph not found', 404);

      for (const child of children) {
        if (child.id) {
          const childResult = await session.run(
            `MATCH (graph {id: $parentId}), (child {id: $childId})
             SET child:\`${child.label}\` SET child += $props
             MERGE (graph)-[:\`${child.relation}\`]->(child)
             RETURN child`,
            { parentId: id, childId: child.id, props: child.props },
          );
          if (!childResult.records.length) throw new AppError(`Child graph not found: ${child.id}`, 404);
        } else {
          const childId = crypto.randomBytes(9).toString('base64url');
          const relationId = crypto.randomBytes(9).toString('base64url');
          await session.run(
            `MATCH (graph {id: $parentId})
             CREATE (graph)-[:\`${child.relation}\` {relation_id: $relationId}]->(child:\`${child.label}\` {id: $childId})
             SET child += $props`,
            { parentId: id, childId, relationId, props: child.props },
          );
        }
      }

      return toGraphNode(result.records[0].get('graph'));
    } finally {
      await session.close();
    }
  }

  async remove(id: string): Promise<void> {
    const session = getNeo4jSession();
    try {
      const result = await session.run('MATCH (graph {id: $id}) DETACH DELETE graph RETURN count(graph) AS deleted', { id });
      if (result.records[0].get('deleted').toNumber() === 0) throw new AppError('Graph not found', 404);
    } finally {
      await session.close();
    }
  }

  async hierarchy(id: string): Promise<{ root: GraphNode; nodes: GraphNode[]; relationships: Array<Record<string, unknown>> }> {
    const session = getNeo4jSession();
    try {
      const nodesResult = await session.run(
        'MATCH p=(root {id: $id})-[*0..]->(node) UNWIND nodes(p) AS item RETURN DISTINCT item',
        { id },
      );
      if (!nodesResult.records.length) throw new AppError('Graph not found', 404);

      const relationshipsResult = await session.run(
        `MATCH p=(root {id: $id})-[*0..]->(node)
         UNWIND relationships(p) AS relation
         RETURN DISTINCT type(relation) AS type, startNode(relation).id AS from, endNode(relation).id AS to`,
        { id },
      );
      const nodes = nodesResult.records.map((record) => toGraphNode(record.get('item')));
      return {
        root: nodes.find((node) => node.id === id) ?? nodes[0],
        nodes,
        relationships: relationshipsResult.records.map((record) => record.toObject()),
      };
    } finally {
      await session.close();
    }
  }
}
