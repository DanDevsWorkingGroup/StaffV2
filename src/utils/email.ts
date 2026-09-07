/**
 * Outbound email, behind one function.
 *
 * Cloudflare Workers cannot open raw SMTP sockets, so sending is either an HTTP
 * API or a native binding. This module is deliberately the only place that knows
 * which — swapping providers means editing `deliver()` below and nothing else.
 *
 * Current provider: Resend (`POST https://api.resend.com/emails`).
 *
 * Two decisions are still open (see docs/plans/password-reset-otp.md §8):
 *   1. the sending domain and who controls its DNS, and
 *   2. whether the account is on Workers Paid, which would allow Cloudflare
 *      Email Service's native `send_email` binding instead. If it is, replace
 *      the body of `deliver()` with:
 *
 *        await (env as Env & { EMAIL: { send(m: unknown): Promise<void> } })
 *          .EMAIL.send({ to, from, subject, html, text })
 *
 *      ...add a `send_email` binding to wrangler.jsonc, and drop RESEND_API_KEY.
 *
 * Until a key is configured this degrades to a no-op that logs that it would
 * have sent, so the whole reset flow is exercisable locally. It never throws for
 * a missing key: a password-reset request must not 500 because mail is
 * unconfigured, and it must not behave differently for a registered address than
 * for an unregistered one.
 */
import { env } from 'cloudflare:workers'

export type OutboundEmail = {
  to: string
  subject: string
  html: string
  text: string
}

type EmailEnv = {
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
}

const DEFAULT_FROM = 'ABPM Trainer System <noreply@example.invalid>'

function emailEnv(): EmailEnv {
  return env as unknown as EmailEnv
}

/** True when a provider is actually configured. */
export function isEmailConfigured(): boolean {
  return Boolean(emailEnv().RESEND_API_KEY)
}

async function deliver(msg: OutboundEmail, apiKey: string): Promise<void> {
  const from = emailEnv().EMAIL_FROM || DEFAULT_FROM

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  })

  if (!response.ok) {
    // Body may carry a provider error description. It must never be surfaced to
    // the caller of the reset flow, only logged.
    const detail = await response.text().catch(() => '')
    throw new Error(`Email provider returned ${response.status}: ${detail.slice(0, 300)}`)
  }
}

/**
 * Send an email. Resolves to `true` when the provider accepted it.
 *
 * Never throws: every failure path is logged and reported as `false`. Callers in
 * the password-reset flow must not vary their response based on the result, so
 * there is nothing useful they could do with an exception anyway.
 *
 * Note the log lines carry the subject and a coarse status only — never the
 * recipient, and never the OTP itself. `observability` is enabled in
 * wrangler.jsonc, so anything logged here is retained and readable in the
 * Cloudflare dashboard.
 */
export async function sendEmail(msg: OutboundEmail): Promise<boolean> {
  const apiKey = emailEnv().RESEND_API_KEY

  if (!apiKey) {
    console.warn(
      `[email] no RESEND_API_KEY configured — would have sent "${msg.subject}"`,
    )
    return false
  }

  try {
    await deliver(msg, apiKey)
    return true
  } catch (error) {
    console.error(
      `[email] failed to send "${msg.subject}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return false
  }
}
