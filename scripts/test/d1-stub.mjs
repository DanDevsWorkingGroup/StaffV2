/**
 * Minimal D1Database implementation over node:sqlite, so the PostgREST shim can
 * be exercised against real SQLite (and the real schema) without a Worker.
 */
import { DatabaseSync } from 'node:sqlite'

export function createStubD1(sqlFiles = []) {
  const sqlite = new DatabaseSync(':memory:')
  for (const sql of sqlFiles) sqlite.exec(sql)

  const prepare = (query) => ({
    bind(...params) {
      const bound = params.map((p) =>
        typeof p === 'boolean' ? (p ? 1 : 0) : p === undefined ? null : p,
      )
      return {
        async all() {
          const stmt = sqlite.prepare(query)
          return { results: stmt.all(...bound), success: true, meta: {} }
        },
        async first() {
          const stmt = sqlite.prepare(query)
          return stmt.get(...bound) ?? null
        },
        async run() {
          const stmt = sqlite.prepare(query)
          const info = stmt.run(...bound)
          return { success: true, meta: { changes: info.changes } }
        },
      }
    },
    async all() {
      return { results: sqlite.prepare(query).all(), success: true, meta: {} }
    },
  })

  return { database: { prepare }, sqlite }
}
