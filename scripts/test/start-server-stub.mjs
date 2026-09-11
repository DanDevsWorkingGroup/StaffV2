/**
 * Stands in for `@tanstack/react-start/server` outside a Worker.
 *
 * The real module reads and writes cookies on an ambient request context that
 * only exists inside a request. Tests need `getCookie`/`setCookie`/`deleteCookie`
 * to behave like one browser talking to one server, so this is a plain in-memory
 * jar. `__reset()` clears it between tests.
 */
const jar = new Map()
const optsJar = new Map() // last-set options per cookie, so tests can assert path/httpOnly/etc.

export function getCookie(name) {
  return jar.get(name)
}

export function setCookie(name, value, opts) {
  jar.set(name, value)
  optsJar.set(name, opts ?? {})
}

export function deleteCookie(name) {
  jar.delete(name)
  optsJar.delete(name)
}

export function getRequest() {
  return new Request('https://test.invalid/', {
    headers: { 'CF-Connecting-IP': '1.2.3.4' },
  })
}

// --- test helpers -----------------------------------------------------------

export function __reset() {
  jar.clear()
  optsJar.clear()
}

export function __get(name) {
  return jar.get(name)
}

export function __getOpts(name) {
  return optsJar.get(name)
}
