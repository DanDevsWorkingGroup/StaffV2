/**
 * Email bodies for the password-reset flow.
 *
 * Deliberately plain: no reset *link* anywhere, only a code the user types back
 * into the page they already have open. A token in a URL leaks through Referer
 * headers and gets silently "clicked" by mail-scanning gateways — a real concern
 * for the @bomba.gov.my and @abpm.gov.my recipients in this system.
 *
 * Copy is English-only for now; the User Guide is dwi bahasa, so a Bahasa
 * Malaysia version is likely wanted. Flagged for Dan.
 */
import type { OutboundEmail } from './email'

const APP_NAME = 'ABPM Trainer System'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Group the digits for readability: 481902 -> 481 902. */
function groupDigits(code: string): string {
  const half = Math.ceil(code.length / 2)
  return `${code.slice(0, half)} ${code.slice(half)}`
}

function shell(bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;">
      <h1 style="margin:0 0 20px;font-size:18px;font-weight:700;">${APP_NAME}</h1>
      ${bodyHtml}
    </div>
  </body>
</html>`
}

export function resetCodeEmail(
  to: string,
  code: string,
  expiryMinutes: number,
): OutboundEmail {
  const grouped = groupDigits(code)

  return {
    to,
    subject: `Your ${APP_NAME} password reset code`,
    text: [
      `Your ${APP_NAME} password reset code is ${grouped}.`,
      ``,
      `It expires in ${expiryMinutes} minutes and can be used once.`,
      ``,
      `If you did not request this, you can ignore this email — your password has`,
      `not been changed.`,
    ].join('\n'),
    html: shell(`
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
        Use this code to reset your password:
      </p>
      <p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
        ${escapeHtml(grouped)}
      </p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#444;">
        It expires in ${expiryMinutes} minutes and can be used once.
      </p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#666;">
        If you did not request this, you can ignore this email — your password has
        not been changed.
      </p>
    `),
  }
}

export function passwordChangedEmail(to: string): OutboundEmail {
  return {
    to,
    subject: `Your ${APP_NAME} password was changed`,
    text: [
      `Your ${APP_NAME} password was just changed, and you have been signed out`,
      `on all devices.`,
      ``,
      `If this was not you, contact your system administrator immediately.`,
    ].join('\n'),
    html: shell(`
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
        Your password was just changed, and you have been signed out on all devices.
      </p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#666;">
        If this was not you, contact your system administrator immediately.
      </p>
    `),
  }
}
