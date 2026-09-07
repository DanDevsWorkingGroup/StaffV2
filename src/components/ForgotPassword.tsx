import { Link, useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useMutation } from '../hooks/useMutation'
import {
  requestPasswordResetFn,
  resetPasswordFn,
  verifyPasswordResetOtpFn,
} from '../routes/forgot-password'

/**
 * Three-step forgot-password form, styled to match `./Auth.tsx`.
 *
 * Notes that matter for security, not just layout:
 *  - The step-2 and step-3 screens never display the email address. Showing it
 *    back would confirm to a shoulder-surfer that the address is registered.
 *  - Step 1 always advances to step 2, whatever the server did, and says "if an
 *    account exists". The client genuinely does not know, because the server
 *    never tells it.
 *  - The email is held in component state only so step 2 can post it again; it
 *    is never put in the URL.
 *  - The resend countdown is driven by the browser's own clock and is never told
 *    anything by the server, so it leaks nothing about whether the account
 *    exists. See RESEND_COOLDOWN_SECONDS below.
 */

const MIN_PASSWORD_LENGTH = 10

/**
 * Mirrors RESEND_COOLDOWN_MS in `~/utils/passwordReset`.
 *
 * The server silently refuses to issue a second code within this window — it
 * still answers `{ ok: true }`, because saying otherwise would leak whether the
 * address is registered. Without a matching client-side guard the user can press
 * "resend", be told a code is on its way, and receive nothing. Disabling the
 * control for the same duration keeps the UI honest.
 *
 * Keep the two values in step. If they ever drift, the client value should be
 * the LARGER one: over-waiting is a small annoyance, under-waiting reintroduces
 * the false claim.
 */
const RESEND_COOLDOWN_SECONDS = 60

type Step = 'email' | 'code' | 'password' | 'done'

const shell =
  'fixed inset-0 bg-black flex items-center justify-center p-8 overflow-y-auto'
const card = 'bg-gray-900 p-8 rounded-lg shadow-lg w-full max-w-md text-white'
const label = 'block text-sm font-medium text-gray-300 mb-1'
const input =
  'px-3 py-2 w-full rounded border border-gray-700 bg-gray-800 text-white focus:outline-none focus:border-cyan-500 transition-colors'
const button =
  'w-full bg-cyan-600 hover:bg-cyan-700 text-white rounded py-2 font-bold uppercase transition-colors mt-2 disabled:opacity-60'

/**
 * Eye / eye-off icons, matching `./Auth.tsx` so the two dark auth cards behave
 * identically: the crossed-out eye shows while the password is VISIBLE, meaning
 * "click to hide".
 */
function EyeIcon({ crossedOut }: { crossedOut: boolean }) {
  const common = {
    xmlns: 'http://www.w3.org/2000/svg',
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  return crossedOut ? (
    <svg {...common}>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  ) : (
    <svg {...common}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

/**
 * A password input with its own show/hide toggle.
 *
 * Local to this file on purpose. Step 3 has two password fields, and inlining
 * the icon markup twice in the same component would be worse than a small local
 * helper. Extracting a shared `PasswordInput` across `Auth.tsx` and the admin
 * "Add Trainer" modal is a separate refactor that has not been asked for.
 *
 * Each field owns its own visibility state, so revealing the new password does
 * not also reveal the confirmation.
 */
function PasswordField({
  id,
  name,
  labelText,
  disabled,
}: {
  id: string
  name: string
  labelText: string
  disabled?: boolean
}) {
  const [visible, setVisible] = useState(false)

  return (
    <div>
      <label htmlFor={id} className={label}>
        {labelText}
      </label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          name={name}
          id={id}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          disabled={disabled}
          className={`${input} pr-10`}
          placeholder="••••••••••"
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-200"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          <EyeIcon crossedOut={visible} />
        </button>
      </div>
    </div>
  )
}

/**
 * Counts down from `RESEND_COOLDOWN_SECONDS` using the browser clock only.
 *
 * `start()` is called when a code request is submitted — not when the server
 * responds — so the timer never encodes anything the server said.
 */
function useResendCooldown() {
  const [secondsLeft, setSecondsLeft] = useState(0)
  const deadlineRef = useRef(0)

  useEffect(() => {
    if (secondsLeft <= 0) return
    const id = setInterval(() => {
      const remaining = Math.ceil((deadlineRef.current - Date.now()) / 1000)
      setSecondsLeft(remaining > 0 ? remaining : 0)
    }, 250)
    return () => clearInterval(id)
  }, [secondsLeft > 0])

  const start = () => {
    deadlineRef.current = Date.now() + RESEND_COOLDOWN_SECONDS * 1000
    setSecondsLeft(RESEND_COOLDOWN_SECONDS)
  }

  return { secondsLeft, start }
}

export function ForgotPassword() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const cooldown = useResendCooldown()

  const requestMutation = useMutation({
    fn: requestPasswordResetFn,
    onSuccess: () => {
      // Deliberately unconditional: the response carries no signal to branch on.
      setMessage(null)
      setStep('code')
    },
  })

  /**
   * Submit a code request and start the local cooldown.
   *
   * The timer starts here, on submit, rather than in `onSuccess` — the server's
   * reply is deliberately identical in every case, so there is nothing in it to
   * key off, and starting from the response would only add network jitter.
   */
  const requestCode = (address: string) => {
    cooldown.start()
    requestMutation.mutate({ data: { email: address } })
  }

  const verifyMutation = useMutation({
    fn: verifyPasswordResetOtpFn,
    onSuccess: (ctx) => {
      if (ctx.data?.ok) {
        setMessage(null)
        setStep('password')
      } else {
        setMessage(ctx.data?.message ?? 'Invalid or expired code.')
      }
    },
  })

  const resetMutation = useMutation({
    fn: resetPasswordFn,
    onSuccess: (ctx) => {
      if (ctx.data?.ok) {
        setMessage(null)
        setStep('done')
      } else {
        setMessage(ctx.data?.message ?? 'Something went wrong.')
      }
    },
  })

  const pending =
    requestMutation.status === 'pending' ||
    verifyMutation.status === 'pending' ||
    resetMutation.status === 'pending'

  return (
    <div className={shell}>
      <div className={card}>
        {step === 'email' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Reset your password</h1>
            <p className="text-sm text-gray-400 mb-6">
              Enter your email address and we&apos;ll send you a{' '}
              {6}-digit code.
            </p>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                const form = new FormData(e.target as HTMLFormElement)
                const value = ((form.get('email') as string) ?? '').trim()
                setEmail(value)
                requestCode(value)
              }}
            >
              <div>
                <label htmlFor="email" className={label}>
                  Email
                </label>
                <input
                  type="email"
                  name="email"
                  id="email"
                  autoComplete="email"
                  required
                  className={input}
                  placeholder="name@example.com"
                />
              </div>
              <button type="submit" className={button} disabled={pending}>
                {pending ? '...' : 'Send code'}
              </button>
            </form>
          </>
        )}

        {step === 'code' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Enter your code</h1>
            <p className="text-sm text-gray-400 mb-6">
              If an account exists for that address, we&apos;ve sent a 6-digit
              code. It expires in 20 minutes.
            </p>
            <p className="text-xs text-gray-500 mb-6">
              Government mail systems can delay the first message by several
              minutes. Check your spam folder before requesting another code.
            </p>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                const form = new FormData(e.target as HTMLFormElement)
                verifyMutation.mutate({
                  data: { email, code: (form.get('code') as string) ?? '' },
                })
              }}
            >
              <div>
                <label htmlFor="code" className={label}>
                  6-digit code
                </label>
                <input
                  type="text"
                  name="code"
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]*"
                  maxLength={7}
                  required
                  className={`${input} tracking-[0.4em] text-lg font-mono`}
                  placeholder="000000"
                />
              </div>
              <button type="submit" className={button} disabled={pending}>
                {pending ? '...' : 'Verify code'}
              </button>

              {/*
                Resend, gated by the local countdown. While the cooldown is
                running the server would silently refuse to issue a new code, so
                the control stays disabled rather than letting the UI promise a
                message that will never arrive.
              */}
              <button
                type="button"
                className="w-full text-sm text-gray-400 hover:text-white transition-colors disabled:text-gray-600 disabled:hover:text-gray-600"
                disabled={pending || cooldown.secondsLeft > 0}
                onClick={() => {
                  setMessage(null)
                  requestCode(email)
                }}
              >
                {cooldown.secondsLeft > 0
                  ? `Resend code in ${cooldown.secondsLeft}s`
                  : 'Resend code'}
              </button>

              <button
                type="button"
                className="w-full text-sm text-gray-400 hover:text-white transition-colors"
                disabled={pending}
                onClick={() => {
                  setMessage(null)
                  setStep('email')
                }}
              >
                Use a different email address
              </button>
            </form>
          </>
        )}

        {step === 'password' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Choose a new password</h1>
            <p className="text-sm text-gray-400 mb-6">
              At least {MIN_PASSWORD_LENGTH} characters. You&apos;ll be signed
              out on all devices.
            </p>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                const form = new FormData(e.target as HTMLFormElement)
                resetMutation.mutate({
                  data: {
                    password: (form.get('password') as string) ?? '',
                    confirmPassword:
                      (form.get('confirmPassword') as string) ?? '',
                  },
                })
              }}
            >
              <PasswordField
                id="password"
                name="password"
                labelText="New password"
                disabled={pending}
              />
              <PasswordField
                id="confirmPassword"
                name="confirmPassword"
                labelText="Confirm new password"
                disabled={pending}
              />
              <button type="submit" className={button} disabled={pending}>
                {pending ? '...' : 'Set new password'}
              </button>
            </form>
          </>
        )}

        {step === 'done' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Password updated</h1>
            <p className="text-sm text-gray-400 mb-6">
              You&apos;ve been signed out everywhere. Sign in with your new
              password.
            </p>
            <button
              type="button"
              className={button}
              onClick={() => {
                router.navigate({ to: '/login' })
              }}
            >
              Go to login
            </button>
          </>
        )}

        {message && (
          <div className="text-red-400 text-sm mt-4" role="alert">
            {message}
          </div>
        )}

        {step !== 'done' && (
          <div className="text-sm mt-6">
            <Link
              to="/login"
              className="text-gray-400 hover:text-white transition-colors"
            >
              Back to login
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
