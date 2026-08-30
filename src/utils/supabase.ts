/**
 * Drop-in replacement for the `@supabase/ssr` server client, backed by
 * Cloudflare D1.
 *
 * The module keeps its original name and exports so the ~20 route files that
 * import `getSupabaseServerClient()` continue to work untouched. Everything
 * underneath is now D1: `.from()` goes through the PostgREST-compatible query
 * builder in `./postgrest`, and `.auth` is served by the session/password code
 * in `./auth`.
 */
import {
  adminCreateUser,
  adminGetUserById,
  getSessionUser,
  signIn,
  signOut,
} from './auth'
import { from } from './postgrest'
import type { PostgrestError } from './postgrest'

export type AuthUser = {
  id: string
  email: string
}

const authError = (message: string): PostgrestError => ({
  message,
  details: null,
  hint: null,
  code: 'AUTH_ERROR',
})

const auth = {
  async getUser(): Promise<{ data: { user: AuthUser | null }; error: PostgrestError | null }> {
    const user = await getSessionUser()
    if (!user) {
      return { data: { user: null }, error: authError('Auth session missing!') }
    }
    return { data: { user }, error: null }
  },

  async signInWithPassword(credentials: { email: string; password: string }) {
    const result = await signIn(credentials.email, credentials.password)
    if (result.error) {
      return { data: { user: null, session: null }, error: authError(result.message) }
    }
    const { data } = await auth.getUser()
    return { data: { user: data.user, session: {} }, error: null }
  },

  async signOut(): Promise<{ error: PostgrestError | null }> {
    await signOut()
    return { error: null }
  },

  admin: {
    async getUserById(userId: string) {
      const user = await adminGetUserById(userId)
      if (!user) {
        return { data: { user: null }, error: authError('User not found') }
      }
      return { data: { user }, error: null }
    },

    async createUser(input: { email: string; password: string; email_confirm?: boolean }) {
      const result = await adminCreateUser(input.email, input.password)
      if ('error' in result) {
        return { data: { user: null }, error: authError(result.error) }
      }
      return { data: { user: result.user }, error: null }
    },
  },
}

/**
 * `get_trainer_profile` was never created in the production database, so the
 * RPC always failed and callers fell through to their manual-query fallback.
 * Returning the same error preserves that behaviour exactly.
 */
async function rpc(name: string, _params?: Record<string, unknown>) {
  return {
    data: null,
    error: {
      message: `Could not find the function public.${name} in the schema cache`,
      details: null,
      hint: null,
      code: 'PGRST202',
    } satisfies PostgrestError,
  }
}

export function getSupabaseServerClient() {
  return { from, auth, rpc }
}

/**
 * Previously gated on SUPABASE_SERVICE_ROLE_KEY. There is no separate
 * privileged connection with D1 — the Worker binding is already trusted — so
 * this returns the same client. Callers keep their `if (!client) return` guard.
 */
export function getSupabaseAdminClient() {
  return getSupabaseServerClient()
}
