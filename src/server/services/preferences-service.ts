import { eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { userPreferences, users } from '../../db/schema.ts';
import {
  DEFAULT_USER_PREFERENCES,
  UserPreferencesUpdateSchema,
  mergePreferencePatch,
  sanitizeStoredUserPreferences,
  type ValidatedUserPreferencesPatch,
} from '../../shared/preferences.ts';
import type { UserPreferencesPayload } from '../../shared/types.ts';

export class PreferencesValidationError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'PreferencesValidationError';
  }
}

export interface PreferencesRepository {
  findUserIdByUid: (uid: string) => Promise<number | null>;
  findByUserId: (userId: number) => Promise<typeof userPreferences.$inferSelect | null>;
  upsertByUserId: (
    userId: number,
    patch: ValidatedUserPreferencesPatch
  ) => Promise<typeof userPreferences.$inferSelect>;
}

const defaultPreferencesRepository: PreferencesRepository = {
  async findUserIdByUid(uid: string) {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.uid, uid))
      .limit(1);
    return rows[0]?.id ?? null;
  },

  async findByUserId(userId: number) {
    const rows = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  },

  async upsertByUserId(userId: number, patch: ValidatedUserPreferencesPatch) {
    const now = new Date();
    const defaultsWithPatch = mergePreferencePatch(
      { ...DEFAULT_USER_PREFERENCES },
      patch
    );

    const updateSet: Partial<typeof userPreferences.$inferInsert> = {
      updatedAt: now,
    };
    if (patch.theme !== undefined) updateSet.theme = patch.theme;
    if (patch.density !== undefined) updateSet.density = patch.density;
    if (patch.timezone !== undefined) updateSet.timezone = patch.timezone;
    if (patch.dateFormat !== undefined) updateSet.dateFormat = patch.dateFormat;

    const [saved] = await db
      .insert(userPreferences)
      .values({
        userId,
        theme: defaultsWithPatch.theme,
        density: defaultsWithPatch.density,
        timezone: defaultsWithPatch.timezone,
        dateFormat: defaultsWithPatch.dateFormat,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: updateSet,
      })
      .returning();

    if (!saved) {
      throw new Error('Failed to persist user preferences row.');
    }
    return saved;
  },
};

export function rowToPayload(
  row: typeof userPreferences.$inferSelect | null
): UserPreferencesPayload {
  if (!row) {
    return {
      preferences: { ...DEFAULT_USER_PREFERENCES },
      persisted: false,
      updatedAt: null,
    };
  }
  return {
    preferences: sanitizeStoredUserPreferences({
      theme: row.theme,
      density: row.density,
      timezone: row.timezone,
      dateFormat: row.dateFormat,
    }),
    persisted: true,
    updatedAt: row.updatedAt instanceof Date
      ? row.updatedAt.toISOString()
      : new Date(row.updatedAt).toISOString(),
  };
}

export function createPreferencesService(
  repo: PreferencesRepository = defaultPreferencesRepository
) {
  async function resolveUserId(authUser: { id?: number; uid: string }): Promise<number> {
    if (typeof authUser.id === 'number' && Number.isInteger(authUser.id) && authUser.id > 0) {
      return authUser.id;
    }
    const foundId = await repo.findUserIdByUid(authUser.uid);
    if (!foundId) {
      throw new Error(`Authenticated user record not found for uid "${authUser.uid}".`);
    }
    return foundId;
  }

  async function getUserPreferences(
    authUser: { id?: number; uid: string }
  ): Promise<UserPreferencesPayload> {
    const userId = await resolveUserId(authUser);
    const row = await repo.findByUserId(userId);
    return rowToPayload(row);
  }

  async function updateUserPreferences(
    authUser: { id?: number; uid: string },
    rawPatch: unknown
  ): Promise<UserPreferencesPayload> {
    const parsed = UserPreferencesUpdateSchema.safeParse(rawPatch);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      throw new PreferencesValidationError(
        firstIssue?.message || 'Invalid workspace preferences payload.'
      );
    }
    const userId = await resolveUserId(authUser);
    const saved = await repo.upsertByUserId(userId, parsed.data);
    return rowToPayload(saved);
  }

  return {
    getUserPreferences,
    updateUserPreferences,
  };
}

export const preferencesService = createPreferencesService();
