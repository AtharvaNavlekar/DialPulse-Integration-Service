import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db } from '../../db/index.ts';
import type * as schema from '../../db/schema.ts';
import { externalIdMappings, integrationConnections } from '../../db/schema.ts';
import type {
  ExternalIdMappingRecord,
  ExternalIdMappingService,
} from './contracts.ts';

type DbExecutor = NodePgDatabase<typeof schema>;

export class ExternalMappingConflictError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = 'ExternalMappingConflictError';
  }
}

export interface UpsertConnectionMappingInput {
  tenantId: number;
  connectionId: number;
  providerId: string;
  internalEntityType: string;
  internalEntityId: string;
  externalEntityType: string;
  externalEntityId: string;
  mappingStatus?: 'active' | 'stale' | 'unlinked';
  metadata?: Record<string, unknown>;
  lastSyncedAt?: Date;
}

export type ExternalMappingRow = typeof externalIdMappings.$inferSelect;

export interface ExternalMappingWithConnectionRow extends ExternalMappingRow {
  connectionName: string | null;
}

export class DbExternalIdMappingService implements ExternalIdMappingService {
  async resolveByInternal(options: {
    tenantId: number;
    connectionId: number;
    internalEntityType: string;
    internalEntityId: string;
  }): Promise<ExternalMappingRow | null> {
    const rows = await db
      .select()
      .from(externalIdMappings)
      .where(
        and(
          eq(externalIdMappings.tenantId, options.tenantId),
          eq(externalIdMappings.connectionId, options.connectionId),
          eq(externalIdMappings.internalEntityType, options.internalEntityType),
          eq(externalIdMappings.internalEntityId, options.internalEntityId)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async resolveByExternal(options: {
    tenantId: number;
    connectionId: number;
    externalEntityType: string;
    externalEntityId: string;
  }): Promise<ExternalMappingRow | null> {
    const rows = await db
      .select()
      .from(externalIdMappings)
      .where(
        and(
          eq(externalIdMappings.tenantId, options.tenantId),
          eq(externalIdMappings.connectionId, options.connectionId),
          eq(externalIdMappings.externalEntityType, options.externalEntityType),
          eq(externalIdMappings.externalEntityId, options.externalEntityId)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Creates or safely updates a bidirectional mapping inside a connection scope.
   * Refuses to silently reassign an external ID that is already bound to a different
   * internal entity, or an internal entity already bound to a different external ID.
   */
  async upsertConnectionMapping(
    input: UpsertConnectionMappingInput,
    executor: DbExecutor = db
  ): Promise<ExternalMappingRow> {
    const now = new Date();

    const byInternal = await executor
      .select()
      .from(externalIdMappings)
      .where(
        and(
          eq(externalIdMappings.tenantId, input.tenantId),
          eq(externalIdMappings.connectionId, input.connectionId),
          eq(externalIdMappings.internalEntityType, input.internalEntityType),
          eq(externalIdMappings.internalEntityId, input.internalEntityId)
        )
      )
      .limit(1);

    if (byInternal[0]) {
      const existing = byInternal[0];
      if (
        existing.externalEntityId !== input.externalEntityId ||
        existing.externalEntityType !== input.externalEntityType
      ) {
        throw new ExternalMappingConflictError(
          `Internal entity ${input.internalEntityType}:${input.internalEntityId} is already mapped to external ${existing.externalEntityType}:${existing.externalEntityId} on connection #${input.connectionId}.`
        );
      }

      const [updated] = await executor
        .update(externalIdMappings)
        .set({
          mappingStatus: input.mappingStatus ?? existing.mappingStatus,
          metadata: input.metadata ?? existing.metadata,
          lastSyncedAt: input.lastSyncedAt ?? now,
          updatedAt: now,
        })
        .where(
          and(
            eq(externalIdMappings.id, existing.id),
            eq(externalIdMappings.tenantId, input.tenantId)
          )
        )
        .returning();
      return updated!;
    }

    const byExternal = await executor
      .select()
      .from(externalIdMappings)
      .where(
        and(
          eq(externalIdMappings.tenantId, input.tenantId),
          eq(externalIdMappings.connectionId, input.connectionId),
          eq(externalIdMappings.externalEntityType, input.externalEntityType),
          eq(externalIdMappings.externalEntityId, input.externalEntityId)
        )
      )
      .limit(1);

    if (byExternal[0]) {
      throw new ExternalMappingConflictError(
        `External entity ${input.externalEntityType}:${input.externalEntityId} is already mapped to internal ${byExternal[0].internalEntityType}:${byExternal[0].internalEntityId} on connection #${input.connectionId}.`
      );
    }

    try {
      const [inserted] = await executor
        .insert(externalIdMappings)
        .values({
          tenantId: input.tenantId,
          connectionId: input.connectionId,
          providerId: input.providerId,
          internalEntityType: input.internalEntityType,
          internalEntityId: input.internalEntityId,
          externalEntityType: input.externalEntityType,
          externalEntityId: input.externalEntityId,
          mappingStatus: input.mappingStatus ?? 'active',
          metadata: input.metadata ?? {},
          lastSyncedAt: input.lastSyncedAt ?? now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return inserted!;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        (error as { code?: string }).code === '23505'
      ) {
        throw new ExternalMappingConflictError(
          `Duplicate external mapping conflict for ${input.internalEntityType}:${input.internalEntityId} <-> ${input.externalEntityType}:${input.externalEntityId}.`
        );
      }
      throw error;
    }
  }

  async listMappingsByTenant(
    tenantId: number,
    filters: {
      providerId?: string;
      connectionId?: number;
      internalEntityType?: string;
      internalEntityId?: string;
      externalEntityType?: string;
      externalEntityId?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<ExternalMappingRow[]> {
    const result = await this.queryMappingsByTenant(tenantId, filters);
    return result.mappings;
  }

  async queryMappingsByTenant(
    tenantId: number,
    filters: {
      providerId?: string;
      connectionId?: number;
      internalEntityType?: string;
      internalEntityId?: string;
      externalEntityType?: string;
      externalEntityId?: string;
      entityType?: string;
      search?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ mappings: ExternalMappingWithConnectionRow[]; total: number }> {
    const limit = Math.max(1, Math.min(100, filters.limit ?? 50));
    const offset = Math.max(0, filters.offset ?? 0);
    const conditions = [eq(externalIdMappings.tenantId, tenantId)];

    if (filters.providerId) {
      conditions.push(eq(externalIdMappings.providerId, filters.providerId));
    }
    if (filters.connectionId) {
      conditions.push(eq(externalIdMappings.connectionId, filters.connectionId));
    }
    if (filters.internalEntityType) {
      conditions.push(
        eq(externalIdMappings.internalEntityType, filters.internalEntityType)
      );
    }
    if (filters.internalEntityId) {
      conditions.push(
        eq(externalIdMappings.internalEntityId, filters.internalEntityId)
      );
    }
    if (filters.externalEntityType) {
      conditions.push(
        eq(externalIdMappings.externalEntityType, filters.externalEntityType)
      );
    }
    if (filters.externalEntityId) {
      conditions.push(
        eq(externalIdMappings.externalEntityId, filters.externalEntityId)
      );
    }
    if (filters.entityType) {
      const entityOr = or(
        eq(externalIdMappings.internalEntityType, filters.entityType),
        eq(externalIdMappings.externalEntityType, filters.entityType)
      );
      if (entityOr) conditions.push(entityOr);
    }
    if (filters.search && filters.search.trim()) {
      const pattern = `%${filters.search.trim()}%`;
      const searchOr = or(
        ilike(externalIdMappings.internalEntityId, pattern),
        ilike(externalIdMappings.externalEntityId, pattern),
        ilike(externalIdMappings.internalEntityType, pattern),
        ilike(externalIdMappings.externalEntityType, pattern),
        ilike(externalIdMappings.providerId, pattern)
      );
      if (searchOr) conditions.push(searchOr);
    }

    const whereExpr = and(...conditions);

    const [countRows, rows] = await Promise.all([
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(externalIdMappings)
        .where(whereExpr),
      db
        .select({
          id: externalIdMappings.id,
          tenantId: externalIdMappings.tenantId,
          connectionId: externalIdMappings.connectionId,
          connectionName: integrationConnections.connectionName,
          providerId: externalIdMappings.providerId,
          internalEntityType: externalIdMappings.internalEntityType,
          internalEntityId: externalIdMappings.internalEntityId,
          externalEntityType: externalIdMappings.externalEntityType,
          externalEntityId: externalIdMappings.externalEntityId,
          mappingStatus: externalIdMappings.mappingStatus,
          metadata: externalIdMappings.metadata,
          lastSyncedAt: externalIdMappings.lastSyncedAt,
          createdAt: externalIdMappings.createdAt,
          updatedAt: externalIdMappings.updatedAt,
        })
        .from(externalIdMappings)
        .leftJoin(
          integrationConnections,
          and(
            eq(externalIdMappings.connectionId, integrationConnections.id),
            eq(externalIdMappings.tenantId, integrationConnections.tenantId)
          )
        )
        .where(whereExpr)
        .orderBy(desc(externalIdMappings.updatedAt))
        .limit(limit)
        .offset(offset),
    ]);

    return {
      mappings: rows,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async getExternalId(
    tenantId: number,
    localEntityType: string,
    localEntityId: string,
    providerId: string
  ): Promise<string | null> {
    const rows = await db
      .select()
      .from(externalIdMappings)
      .where(
        and(
          eq(externalIdMappings.tenantId, tenantId),
          eq(externalIdMappings.providerId, providerId),
          eq(externalIdMappings.internalEntityType, localEntityType),
          eq(externalIdMappings.internalEntityId, localEntityId),
          eq(externalIdMappings.mappingStatus, 'active')
        )
      )
      .limit(1);
    return rows[0]?.externalEntityId ?? null;
  }

  async upsertMapping(record: ExternalIdMappingRecord): Promise<void> {
    const connections = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.tenantId, record.tenantId),
          eq(integrationConnections.providerId, record.providerId),
          eq(integrationConnections.status, 'active')
        )
      )
      .limit(1);

    if (!connections[0]) {
      throw new Error(
        `No active connection exists for tenant ${record.tenantId} and provider "${record.providerId}".`
      );
    }

    await this.upsertConnectionMapping({
      tenantId: record.tenantId,
      connectionId: connections[0].id,
      providerId: record.providerId,
      internalEntityType: record.localEntityType,
      internalEntityId: record.localEntityId,
      externalEntityType: record.localEntityType,
      externalEntityId: record.externalEntityId,
    });
  }
}

export const externalIdMappingService = new DbExternalIdMappingService();
