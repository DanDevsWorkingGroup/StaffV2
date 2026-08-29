import { createServerFn } from '@tanstack/react-start'
import { all, first } from '~/utils/db'
import { getSessionUser } from '~/utils/auth'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

// UPDATED: Added 4 new specialized coordinator roles
export type UserRole =
  | 'ADMIN'
  | 'COORDINATOR'
  | 'EVENT COORDINATOR'      // Events module admin
  | 'PT COORDINATOR'         // Physical Training module admin
  | 'RA COORDINATOR'         // Religious Activities module admin
  | 'DORMITORY COORDINATOR'  // Dormitory module admin
  | 'TRAINER'

export type Permission = {
  resource: string
  action: 'create' | 'read' | 'update' | 'delete'
}

export type UserRoleData = {
  userId: string
  // `trainers.id` is an integer, and callers compare it against the integer ids
  // inside `participants` arrays, so this must stay numeric.
  trainerId: number
  email: string
  name: string
  role: UserRole
  roleLevel: number
  rank?: string
  permissions: Permission[]
}

// ============================================================================
// SERVER-SIDE FUNCTIONS
// ============================================================================

/**
 * Get current user's role and permissions
 */
export const getCurrentUserRole = createServerFn({ method: 'GET' }).handler(
  async (): Promise<UserRoleData | null> => {
    const user = await getSessionUser()

    if (!user) {
      return null
    }

    // Trainer profile joined to its role in one round trip
    const profile = await first<{
      trainer_id: number
      name: string
      rank: string | null
      role_id: string | null
      role_name: string | null
      role_level: number | null
    }>(
      `SELECT t.id AS trainer_id, t.name AS name, t.rank AS rank,
              t.role_id AS role_id, r.name AS role_name, r.level AS role_level
         FROM trainers t
         LEFT JOIN roles r ON r.id = t.role_id
        WHERE t.user_id = ?`,
      user.id,
    )

    if (!profile) {
      console.error('No trainer profile for user', user.id)
      return null
    }

    if (!profile.role_id || !profile.role_name) {
      console.error('No role assigned to trainer', profile.trainer_id)
      return null
    }

    const permissionRows = await all<{ resource: string; action: Permission['action'] }>(
      `SELECT p.resource AS resource, p.action AS action
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = ?`,
      profile.role_id,
    )

    return {
      userId: user.id,
      trainerId: profile.trainer_id,
      email: user.email,
      name: profile.name,
      role: profile.role_name as UserRole,
      roleLevel: profile.role_level ?? 0,
      rank: profile.rank ?? undefined,
      permissions: permissionRows.map((p) => ({
        resource: p.resource,
        action: p.action,
      })),
    }
  },
)

/**
 * Check if current user has required role
 */
export const requireRole = createServerFn({ method: 'GET' })
  .inputValidator((allowedRoles: UserRole[]) => allowedRoles)
  .handler(async ({ data: allowedRoles }): Promise<boolean> => {
    const userData = await getCurrentUserRole()

    if (!userData) {
      throw new Error('Not authenticated')
    }

    if (!allowedRoles.includes(userData.role)) {
      throw new Error(`Insufficient permissions. Required role: ${allowedRoles.join(' or ')}`)
    }

    return true
  })

/**
 * Check if current user has specific permission
 */
export const hasPermission = createServerFn({ method: 'GET' })
  .inputValidator((data: { resource: string; action: Permission['action'] }) => data)
  .handler(async ({ data }): Promise<boolean> => {
    const userData = await getCurrentUserRole()

    if (!userData) {
      return false
    }

    // ADMIN has all permissions
    if (userData.role === 'ADMIN') {
      return true
    }

    // Check specific permission
    return userData.permissions.some(
      (p) => p.resource === data.resource && p.action === data.action,
    )
  })

/**
 * Require specific permission (throws error if not allowed)
 */
export const requirePermission = createServerFn({ method: 'GET' })
  .inputValidator((data: { resource: string; action: Permission['action'] }) => data)
  .handler(async ({ data }): Promise<boolean> => {
    const allowed = await hasPermission({ data })

    if (!allowed) {
      throw new Error(`Insufficient permissions to ${data.action} ${data.resource}`)
    }

    return true
  })

/**
 * Check if current user is ADMIN
 */
export const isAdmin = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => {
    const userData = await getCurrentUserRole()
    return userData?.role === 'ADMIN' || false
  },
)

/**
 * Check if current user is COORDINATOR or above
 */
export const isCoordinatorOrAbove = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => {
    const userData = await getCurrentUserRole()
    if (!userData) return false
    return userData.role === 'ADMIN' || userData.role === 'COORDINATOR'
  },
)

/**
 * Check if current user is TRAINER
 */
export const isTrainer = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => {
    const userData = await getCurrentUserRole()
    return userData?.role === 'TRAINER' || false
  },
)

// ============================================================================
// CLIENT-SIDE HELPER FUNCTIONS FOR UI RENDERING
// These functions are used in components to show/hide UI elements
// ============================================================================

/**
 * CRITICAL: Check if user can access dormitory module
 * Only ADMIN, COORDINATOR, and DORMITORY COORDINATOR should have access
 * EVENT, PT, and RA coordinators must NOT have access
 */
export function canAccessDormitoryClient(role: UserRole): boolean {
  return ['ADMIN', 'COORDINATOR', 'DORMITORY COORDINATOR'].includes(role)
}

/**
 * Check if user can access events module
 * Available to: ADMIN, COORDINATOR, EVENT COORDINATOR
 */
export function canAccessEventsClient(role: UserRole): boolean {
  return ['ADMIN', 'COORDINATOR', 'EVENT COORDINATOR'].includes(role)
}

/**
 * Check if user can access physical training module
 * Available to: ADMIN, COORDINATOR, PT COORDINATOR
 */
export function canAccessPTClient(role: UserRole): boolean {
  return ['ADMIN', 'COORDINATOR', 'PT COORDINATOR'].includes(role)
}

/**
 * Check if user can access religious activities module
 * Available to: ADMIN, COORDINATOR, RA COORDINATOR
 */
export function canAccessReligiousClient(role: UserRole): boolean {
  return ['ADMIN', 'COORDINATOR', 'RA COORDINATOR'].includes(role)
}

/**
 * Generic function to check module access
 * Used for dynamic role checking
 */
export function canManageModuleClient(role: UserRole, module: string): boolean {
  switch (module) {
    case 'events':
      return canAccessEventsClient(role)
    case 'pt':
    case 'physical-training':
      return canAccessPTClient(role)
    case 'religious':
    case 'religious-activity':
      return canAccessReligiousClient(role)
    case 'dormitory':
      return canAccessDormitoryClient(role)
    default:
      return false
  }
}

/**
 * Check if user can access trainer overview
 * Typically only ADMIN and COORDINATOR (not specialized coordinators)
 */
export function canAccessOverviewClient(role: UserRole): boolean {
  return ['ADMIN', 'COORDINATOR'].includes(role)
}

// ============================================================================
// SERVER-SIDE SECURITY FUNCTIONS FOR API PROTECTION
// These functions are used in API routes to verify access
// ============================================================================

/**
 * Server-side: Check if user can access dormitory module
 * CRITICAL: This enforces dormitory access at the API level
 */
export const canAccessDormitory = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => {
    const userData = await getCurrentUserRole()
    if (!userData) return false
    return canAccessDormitoryClient(userData.role)
  },
)

/**
 * Server-side: Check if user can access events module
 */
export const canAccessEvents = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => {
    const userData = await getCurrentUserRole()
    if (!userData) return false
    return canAccessEventsClient(userData.role)
  },
)

/**
 * Server-side: Check if user can access PT module
 */
export const canAccessPT = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => {
    const userData = await getCurrentUserRole()
    if (!userData) return false
    return canAccessPTClient(userData.role)
  },
)

/**
 * Server-side: Check if user can access Religious Activities module
 */
export const canAccessReligious = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => {
    const userData = await getCurrentUserRole()
    if (!userData) return false
    return canAccessReligiousClient(userData.role)
  },
)

/**
 * Server-side: Check if user can access trainer overview
 */
export const canAccessOverview = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => {
    const userData = await getCurrentUserRole()
    if (!userData) return false
    return canAccessOverviewClient(userData.role)
  },
)

/**
 * Server-side: Generic module access check
 */
export const canManageModule = createServerFn({ method: 'GET' })
  .inputValidator((module: string) => module)
  .handler(async ({ data: module }): Promise<boolean> => {
    const userData = await getCurrentUserRole()
    if (!userData) return false
    return canManageModuleClient(userData.role, module)
  })

// ============================================================================
// SPECIALIZED COORDINATOR CHECK FUNCTIONS
// ============================================================================

/**
 * Check if current user is EVENT COORDINATOR or above
 */
export const isEventCoordinator = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => {
    const userData = await getCurrentUserRole()
    if (!userData) return false
    return ['ADMIN', 'COORDINATOR', 'EVENT COORDINATOR'].includes(userData.role)
  },
)

/**
 * Check if current user is PT COORDINATOR or above
 */
export const isPTCoordinator = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => {
    const userData = await getCurrentUserRole()
    if (!userData) return false
    return ['ADMIN', 'COORDINATOR', 'PT COORDINATOR'].includes(userData.role)
  },
)

/**
 * Check if current user is RA COORDINATOR or above
 */
export const isRACoordinator = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => {
    const userData = await getCurrentUserRole()
    if (!userData) return false
    return ['ADMIN', 'COORDINATOR', 'RA COORDINATOR'].includes(userData.role)
  },
)

/**
 * Check if current user is DORMITORY COORDINATOR or above
 */
export const isDormitoryCoordinator = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => {
    const userData = await getCurrentUserRole()
    if (!userData) return false
    return ['ADMIN', 'COORDINATOR', 'DORMITORY COORDINATOR'].includes(userData.role)
  },
)
