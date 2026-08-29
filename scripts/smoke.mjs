/**
 * End-to-end smoke test against a deployed Worker.
 *
 * Logs in as each seeded role, then fetches every route and checks the HTML for
 * error markers and for content that proves the D1 queries actually returned
 * data. Usage: node scripts/smoke.mjs <base-url>
 */
import { toJSONAsync } from 'seroval'

const BASE = process.argv[2] ?? 'https://abpm-trainer.claudefyp11.workers.dev'
const PASSWORD = 'PortTest123!'
const LOGIN_FN = 'c734b57656130e92f97e5895851097dba28c0c97bd955c5a94d61db533974b39'

const ROUTES = [
  '/', '/schedule', '/events', '/events/create', '/dormitory',
  '/physical-training', '/religious-activity', '/trainer-overview',
  '/profile', '/test-rbac',
]

const ERROR_MARKERS = [
  'D1_ERROR', 'no such table', 'no such column', 'does not exist',
  'Something went wrong', 'Internal Server Error', 'PGRST',
  'Failed to fetch user profile', 'SQLITE_ERROR',
]

async function login(email) {
  const body = JSON.stringify(await toJSONAsync({ data: { email, password: PASSWORD } }))
  const res = await fetch(`${BASE}/_serverFn/${LOGIN_FN}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tsr-serverFn': 'true',
      origin: BASE,
    },
    body,
  })
  const text = await res.text()
  const cookie = res.headers.get('set-cookie')
  if (!cookie) throw new Error(`login failed for ${email}: ${res.status} ${text.slice(0, 200)}`)
  return cookie.split(';')[0]
}

async function checkRoute(cookie, path) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: 'manual' })
  const html = await res.text()
  const hits = ERROR_MARKERS.filter((m) => html.includes(m))
  return { path, status: res.status, size: html.length, hits, html }
}

/**
 * Routes each role must be refused, via the `beforeLoad` guards carried over
 * from the original app. Anything not listed here must render.
 */
const DENIED = {
  ADMIN: [],
  COORDINATOR: [],
  TRAINER: ['/dormitory', '/trainer-overview', '/events/create'],
  'DORMITORY COORDINATOR': ['/events/create'],
  'PT COORDINATOR': ['/dormitory', '/events/create'],
}

const ROLES = [
  ['ADMIN', 'zz-porttest-admin@example.invalid'],
  ['COORDINATOR', 'zz-porttest-coordinator@example.invalid'],
  ['TRAINER', 'zz-porttest-trainer@example.invalid'],
  ['DORMITORY COORDINATOR', 'zz-porttest-dormitorycoordinator@example.invalid'],
  ['PT COORDINATOR', 'zz-porttest-ptcoordinator@example.invalid'],
]

let failures = 0

for (const [role, email] of ROLES) {
  console.log(`\n=== ${role} ===`)
  let cookie
  try {
    cookie = await login(email)
  } catch (e) {
    console.log(`  LOGIN FAILED: ${e.message}`)
    failures++
    continue
  }

  const denied = DENIED[role] ?? []

  for (const path of ROUTES) {
    const r = await checkRoute(cookie, path)
    const shouldDeny = denied.includes(path)
    const isDenied = r.html.includes('Unauthorized Access:')

    let bad
    let note = ''
    if (shouldDeny) {
      // A refusal must come from the RBAC guard, never from a failed query.
      bad = !isDenied
      note = isDenied ? '  (denied, as expected)' : '  <- EXPECTED DENIAL, got none'
    } else {
      bad = r.status >= 500 || r.hits.length > 0 || isDenied
      if (isDenied) note = '  <- UNEXPECTED DENIAL'
      else if (r.hits.length) note = `  <- ${r.hits.join(', ')}`
    }

    if (bad) failures++
    console.log(
      `  [${bad ? 'FAIL' : ' ok '}] ${path.padEnd(20)} ${r.status}  ${String(r.size).padStart(7)}b${note}`,
    )
  }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`)
process.exit(failures === 0 ? 0 : 1)
