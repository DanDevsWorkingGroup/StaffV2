import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { ForgotPassword } from '../components/ForgotPassword'
import {
  completePasswordReset,
  requestPasswordResetOtp,
  verifyPasswordResetOtp,
  type ResetOutcome,
} from '../utils/passwordReset'

/**
 * Public, unauthenticated route. It lives at the top level of `src/routes/`
 * rather than under `_authed/` precisely because the whole point is that the
 * user cannot sign in. No RBAC guard from `src/middleware/rbac.ts` applies.
 */

/** Best-effort client IP, for rate limiting. Missing header is its own bucket. */
function clientIp(): string {
  try {
    return getRequest().headers.get('CF-Connecting-IP') ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Step 1. Always returns `{ ok: true }`, always HTTP 200, always after the same
 * floor delay — for registered addresses, unregistered ones, throttled ones and
 * malformed input alike. Any deviation here reintroduces user enumeration.
 */
export const requestPasswordResetFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { email: string }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    return await requestPasswordResetOtp(data.email, clientIp())
  })

/**
 * Step 2. One generic failure message for every reason a code can be rejected.
 * On success, sets the short-lived httpOnly reset-ticket cookie.
 */
export const verifyPasswordResetOtpFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { email: string; code: string }) => d)
  .handler(async ({ data }): Promise<ResetOutcome> => {
    return await verifyPasswordResetOtp(data.email, data.code, clientIp())
  })

/**
 * Step 3. Reads the ticket cookie — the client sends no identifier at all — then
 * sets the password and deletes every session row for that user.
 */
export const resetPasswordFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { password: string; confirmPassword: string }) => d)
  .handler(async ({ data }): Promise<ResetOutcome> => {
    return await completePasswordReset(data.password, data.confirmPassword)
  })

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordComp,
})

function ForgotPasswordComp() {
  return <ForgotPassword />
}
