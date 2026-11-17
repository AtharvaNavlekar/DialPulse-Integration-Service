import { and, eq, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  activityLogs,
  automations,
  forms,
  tenantMemberships,
  tenants,
  users,
  workspaceOrgConfigs,
} from './schema.ts';
import { evaluateDemoProvisioningPolicy } from '../shared/auth-policy.ts';
import {
  createDefaultOrgConfig,
  STARTER_ENQUIRY_FIELDS,
} from '../shared/defaults.ts';
import type { RoleKey, TenantMembershipSummary } from '../shared/types.ts';
import { AuthorizationError } from '../server/middleware/tenant-guard.ts';
import { seedTenantAppInstallations } from '../server/services/app-management-service.ts';
import { seedTenantRolePermissions } from '../server/services/rbac-service.ts';

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName?: string
) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        displayName: displayName || email.split('@')[0] || 'Workspace User',
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          ...(displayName ? { displayName } : {}),
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0]!;
  } catch (error) {
    console.error('Failed to upsert user:', error);
    throw new Error('Database operation failed while loading user profile.', {
      cause: error,
    });
  }
}

async function seedTenantStarterData(
  tenantId: number,
  tenantSlug: string,
  actorUid: string,
  actorLabel: string
) {
  const defaultOrg = createDefaultOrgConfig();
  await db
    .insert(workspaceOrgConfigs)
    .values({
      tenantId,
      config: defaultOrg,
    })
    .onConflictDoNothing();
  await seedTenantRolePermissions(tenantId, actorUid);
  await seedTenantAppInstallations(tenantId, actorUid);

  const starterSlug = `${tenantSlug}-loan-enquiry`;
  const existingForm = await db
    .select()
    .from(forms)
    .where(eq(forms.slug, starterSlug))
    .limit(1);

  if (existingForm.length === 0) {
    const [createdForm] = await db
      .insert(forms)
      .values({
        tenantId,
        slug: starterSlug,
        title: 'Synthetic Loan Enquiry Intake',
        description:
          'Collects non-sensitive customer enquiry preferences for automated lead assignment and callback scheduling.',
        category: 'Lead Intake',
        status: 'published',
        fields: STARTER_ENQUIRY_FIELDS,
        submitButtonLabel: 'Submit Synthetic Enquiry',
        successMessage:
          'Thank you. Your synthetic enquiry has been recorded and routed to our demo team.',
        createdByUid: actorUid,
        publishedAt: new Date(),
      })
      .returning();

    if (createdForm) {
      await db.insert(automations).values({
        tenantId,
        name: 'Route Loan Enquiry -> Assign Demo RM & Create Callback Task',
        description:
          'Triggers when a customer submits the Loan Enquiry form, assigns the lead to Ananya Deshmukh (Inbound Queue), creates a follow-up task, and logs workspace activity.',
        triggerType: 'form_submitted',
        triggerFormId: createdForm.id,
        conditions: [
          {
            id: 'cond-1',
            fieldKey: 'full_name',
            operator: 'is_present',
          },
        ],
        actions: [
          {
            id: 'act-1',
            type: 'assign_lead_queue',
            config: { queueId: 'queue-inbound-dsa' },
          },
          {
            id: 'act-2',
            type: 'assign_lead_employee',
            config: { employeeId: 'emp-ananya' },
          },
          {
            id: 'act-3',
            type: 'create_follow_up_task',
            config: {
              taskTitle: 'Initial qualification callback',
              taskPriority: 'high',
              dueHours: 4,
            },
          },
          {
            id: 'act-4',
            type: 'send_notification',
            config: {
              notificationTitle: 'New enquiry assigned',
              notificationMessage:
                'A synthetic loan enquiry has been routed to Inbound Loan Enquiry Queue.',
            },
          },
          {
            id: 'act-5',
            type: 'record_activity',
            config: {
              activitySummary:
                'Automated intake routing completed for synthetic loan enquiry.',
            },
          },
        ],
        active: true,
        createdByUid: actorUid,
      });

      await db.insert(activityLogs).values({
        tenantId,
        actorUid,
        actorLabel,
        module: 'workspace',
        action: 'workspace.initialized',
        entityType: 'tenant',
        entityId: String(tenantId),
        summary:
          'Provisioned DialPulse Workspace starter form and Automation Lite workflow.',
        metadata: { starterFormId: createdForm.id },
      });
    }
  }
}

export interface UserRecordSummary {
  uid: string;
  email: string;
  displayName: string | null;
  activeTenantId: number | null;
}

export interface MembershipResolutionDeps<TUser extends UserRecordSummary> {
  upsertUser: (uid: string, email: string, displayName?: string) => Promise<TUser>;
  findActiveMemberships: (uid: string) => Promise<TenantMembershipSummary[]>;
  countAllMemberships: (uid: string) => Promise<number>;
  updateActiveTenant: (uid: string, tenantId: number) => Promise<void>;
  provisionDemoTenants: (user: TUser, email: string) => Promise<{
    memberships: TenantMembershipSummary[];
    activeTenantId: number;
  }>;
}

export async function resolveOrProvisionMemberships<TUser extends UserRecordSummary>(
  input: {
    uid: string;
    email: string;
    displayName?: string;
    nodeEnv?: string;
    demoProvisioningFlag?: string;
  },
  deps: MembershipResolutionDeps<TUser>
): Promise<{
  user: TUser;
  memberships: TenantMembershipSummary[];
  activeTenantId: number;
}> {
  const user = await deps.upsertUser(input.uid, input.email, input.displayName);
  const existingRows = await deps.findActiveMemberships(input.uid);

  if (existingRows.length > 0) {
    const memberships: TenantMembershipSummary[] = existingRows.map((row) => ({
      ...row,
      roleKey: (row.roleKey as RoleKey) || 'viewer',
    }));
    const validActive =
      user.activeTenantId &&
      memberships.some((m) => m.tenantId === user.activeTenantId)
        ? user.activeTenantId
        : memberships[0]!.tenantId;

    if (validActive !== user.activeTenantId) {
      await deps.updateActiveTenant(input.uid, validActive);
    }

    return { user, memberships, activeTenantId: validActive };
  }

  // Fail closed when user has inactive/revoked membership rows so deactivated users
  // never receive fresh demo admin workspaces.
  const totalMembershipCount = await deps.countAllMemberships(input.uid);
  if (totalMembershipCount > 0) {
    throw new AuthorizationError(
      403,
      'Workspace access denied: your tenant membership is inactive. Contact an administrator.'
    );
  }

  const policy = evaluateDemoProvisioningPolicy({
    nodeEnv: input.nodeEnv,
    demoProvisioningFlag: input.demoProvisioningFlag,
  });

  if (!policy.allowed) {
    throw new AuthorizationError(
      403,
      'Workspace access denied: no active tenant membership exists for this account. Access must be provisioned by Central CRM or a tenant administrator.'
    );
  }

  const provisioned = await deps.provisionDemoTenants(user, input.email);
  return {
    user,
    memberships: provisioned.memberships,
    activeTenantId: provisioned.activeTenantId,
  };
}

export async function ensureUserMemberships(
  uid: string,
  email: string,
  displayName?: string
): Promise<{
  user: typeof users.$inferSelect;
  memberships: TenantMembershipSummary[];
  activeTenantId: number;
}> {
  try {
    return await resolveOrProvisionMemberships(
      {
        uid,
        email,
        displayName,
        nodeEnv: process.env.NODE_ENV,
        demoProvisioningFlag: process.env.WORKSPACE_DEMO_PROVISIONING_ENABLED,
      },
      {
        upsertUser: getOrCreateUser,
        findActiveMemberships: async (userUid) => {
          const rows = await db
            .select({
              tenantId: tenants.id,
              tenantSlug: tenants.slug,
              tenantName: tenants.name,
              industry: tenants.industry,
              roleKey: tenantMemberships.roleKey,
              departmentName: tenantMemberships.departmentName,
            })
            .from(tenantMemberships)
            .innerJoin(tenants, eq(tenantMemberships.tenantId, tenants.id))
            .where(
              and(
                eq(tenantMemberships.userUid, userUid),
                eq(tenantMemberships.status, 'active')
              )
            );
          return rows.map((row) => ({
            ...row,
            roleKey: (row.roleKey as RoleKey) || 'viewer',
          }));
        },
        countAllMemberships: async (userUid) => {
          const rows = await db
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(tenantMemberships)
            .where(eq(tenantMemberships.userUid, userUid));
          return Number(rows[0]?.count ?? 0);
        },
        updateActiveTenant: async (userUid, tenantId) => {
          await db
            .update(users)
            .set({ activeTenantId: tenantId, updatedAt: new Date() })
            .where(eq(users.uid, userUid));
        },
        provisionDemoTenants: async (user, userEmail) => {
          // Development-only demo workspace creation when WORKSPACE_DEMO_PROVISIONING_ENABLED=true
          const shortSuffix = user.uid
            .slice(0, 6)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, 'x');
          const primarySlug = `dialpulse-dsa-${shortSuffix}`;
          const secondarySlug = `dialpulse-branch-${shortSuffix}`;

          const [primaryTenant] = await db
            .insert(tenants)
            .values({
              slug: primarySlug,
              name: 'DialPulse Capital DSA (Demo)',
              industry: 'Financial Services & Loan DSA',
            })
            .onConflictDoUpdate({
              target: tenants.slug,
              set: { name: 'DialPulse Capital DSA (Demo)' },
            })
            .returning();

          const [secondaryTenant] = await db
            .insert(tenants)
            .values({
              slug: secondarySlug,
              name: 'DialPulse Regional Branch B (Demo)',
              industry: 'Financial Services & Loan DSA',
            })
            .onConflictDoUpdate({
              target: tenants.slug,
              set: { name: 'DialPulse Regional Branch B (Demo)' },
            })
            .returning();

          await db
            .insert(tenantMemberships)
            .values([
              {
                tenantId: primaryTenant!.id,
                userUid: user.uid,
                roleKey: 'admin',
                departmentName: 'Backend Operations & Login',
                status: 'active',
              },
              {
                tenantId: secondaryTenant!.id,
                userUid: user.uid,
                roleKey: 'manager',
                departmentName: 'Partner Relationship (PRM)',
                status: 'active',
              },
            ])
            .onConflictDoNothing();

          await seedTenantStarterData(
            primaryTenant!.id,
            primarySlug,
            user.uid,
            user.displayName || userEmail
          );
          await db
            .insert(workspaceOrgConfigs)
            .values({
              tenantId: secondaryTenant!.id,
              config: createDefaultOrgConfig(),
            })
            .onConflictDoNothing();
          await seedTenantRolePermissions(secondaryTenant!.id, user.uid);
          await seedTenantAppInstallations(secondaryTenant!.id, user.uid);

          await db
            .update(users)
            .set({ activeTenantId: primaryTenant!.id, updatedAt: new Date() })
            .where(eq(users.uid, user.uid));

          const memberships: TenantMembershipSummary[] = [
            {
              tenantId: primaryTenant!.id,
              tenantSlug: primaryTenant!.slug,
              tenantName: primaryTenant!.name,
              industry: primaryTenant!.industry,
              roleKey: 'admin',
              departmentName: 'Backend Operations & Login',
            },
            {
              tenantId: secondaryTenant!.id,
              tenantSlug: secondaryTenant!.slug,
              tenantName: secondaryTenant!.name,
              industry: secondaryTenant!.industry,
              roleKey: 'manager',
              departmentName: 'Partner Relationship (PRM)',
            },
          ];

          return { memberships, activeTenantId: primaryTenant!.id };
        },
      }
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      throw error;
    }
    console.error('Failed to ensure user memberships:', error);
    throw new Error('Failed to load workspace memberships.', { cause: error });
  }
}
