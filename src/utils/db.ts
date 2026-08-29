import { env } from 'cloudflare:workers'

/** The D1 binding declared in wrangler.jsonc. */
export function db(): D1Database {
  const binding = (env as Env).DB
  if (!binding) {
    throw new Error('D1 binding "DB" is not available in this environment')
  }
  return binding
}

export async function all<T = Record<string, unknown>>(
  sql: string,
  ...params: Array<unknown>
): Promise<Array<T>> {
  const { results } = await db()
    .prepare(sql)
    .bind(...params)
    .all<T>()
  return results ?? []
}

export async function first<T = Record<string, unknown>>(
  sql: string,
  ...params: Array<unknown>
): Promise<T | null> {
  return await db()
    .prepare(sql)
    .bind(...params)
    .first<T>()
}

export async function run(
  sql: string,
  ...params: Array<unknown>
): Promise<D1Result> {
  return await db()
    .prepare(sql)
    .bind(...params)
    .run()
}

/**
 * Postgres array columns became TEXT holding JSON in D1. Rows must therefore be
 * decoded on the way out so components keep receiving real arrays.
 */
export function decodeJsonArray<T>(value: unknown): Array<T> {
  if (Array.isArray(value)) return value as Array<T>
  if (typeof value !== 'string' || value === '') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as Array<T>) : []
  } catch {
    return []
  }
}

/** Encode an array for storage in one of those TEXT columns. */
export function encodeJsonArray(value: unknown): string {
  return JSON.stringify(Array.isArray(value) ? value : [])
}

/** Build `IN (?, ?, ...)` placeholders for a variable-length list. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}
