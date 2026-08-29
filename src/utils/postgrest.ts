/**
 * A PostgREST-compatible query builder backed by Cloudflare D1.
 *
 * The application was written against `@supabase/ssr`, so rather than rewriting
 * ~85 call sites (and risking behavioural drift in each one), this reproduces
 * the slice of the PostgREST client the app actually uses and translates it to
 * SQLite. Every builder resolves to the familiar `{ data, error }` envelope.
 *
 * Supported: select (incl. embedded to-one resources), eq/gte/lte/in/ilike/or/
 * contains, order, limit, single, insert, update, delete.
 */
import { db } from './db'
import {
  BOOLEAN_COLUMNS,
  EMBED_FOREIGN_KEYS,
  JSON_ARRAY_COLUMNS,
  JSON_OBJECT_COLUMNS,
  TABLE_COLUMNS,
  type TableName,
  hasColumn,
  isTable,
} from './schema'

export type PostgrestError = {
  message: string
  details: string | null
  hint: string | null
  code: string
}

export type PostgrestResponse<T> = {
  data: T | null
  error: PostgrestError | null
}

/** A builder narrowed by `.single()`, which resolves to one row, not a list. */
export interface SingleQueryBuilder<TRow>
  extends PromiseLike<PostgrestResponse<TRow>> {}

const err = (message: string, code = 'PGRST100'): PostgrestError => ({
  message,
  details: null,
  hint: null,
  code,
})

/** Mirrors Postgres' "column does not exist" so callers behave as they did. */
const undefinedColumn = (table: string, column: string): PostgrestError => ({
  message: `column ${table}.${column} does not exist`,
  details: null,
  hint: null,
  code: '42703',
})

// ---------------------------------------------------------------------------
// Value coding
// ---------------------------------------------------------------------------

function decodeRow(table: TableName, row: Record<string, unknown>): Record<string, unknown> {
  const jsonArrays = JSON_ARRAY_COLUMNS[table] ?? []
  const booleans = BOOLEAN_COLUMNS[table] ?? []
  const jsonObjects = JSON_OBJECT_COLUMNS[table] ?? []

  for (const key of jsonArrays) {
    if (key in row) {
      const raw = row[key]
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw)
          row[key] = Array.isArray(parsed) ? parsed : []
        } catch {
          row[key] = []
        }
      } else if (raw == null) {
        row[key] = []
      }
    }
  }

  for (const key of booleans) {
    if (key in row && row[key] != null) row[key] = Boolean(row[key])
  }

  for (const key of jsonObjects) {
    if (key in row && typeof row[key] === 'string') {
      try {
        row[key] = JSON.parse(row[key] as string)
      } catch {
        /* leave as-is */
      }
    }
  }

  return row
}

function encodeValue(table: TableName, column: string, value: unknown): unknown {
  if (value === undefined) return null
  if ((JSON_ARRAY_COLUMNS[table] ?? []).includes(column)) {
    return JSON.stringify(Array.isArray(value) ? value : [])
  }
  if ((JSON_OBJECT_COLUMNS[table] ?? []).includes(column)) {
    return typeof value === 'string' ? value : JSON.stringify(value ?? {})
  }
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value !== null && typeof value === 'object') return JSON.stringify(value)
  return value as never
}

// ---------------------------------------------------------------------------
// select() parsing — top-level columns plus embedded to-one resources
// ---------------------------------------------------------------------------

type Embed = { alias: string; table: string; columns: Array<string> }
type ParsedSelect = { columns: Array<string>; embeds: Array<Embed> }

/** Split on commas that are not nested inside parentheses. */
function splitTopLevel(input: string): Array<string> {
  const parts: Array<string> = []
  let depth = 0
  let current = ''
  for (const ch of input) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim() !== '') parts.push(current)
  return parts.map((p) => p.trim()).filter(Boolean)
}

function parseSelect(select: string): ParsedSelect {
  const columns: Array<string> = []
  const embeds: Array<Embed> = []

  for (const part of splitTopLevel(select)) {
    const open = part.indexOf('(')
    if (open === -1) {
      columns.push(part.trim())
      continue
    }

    // `alias:table ( a, b )` or `table ( a, b )`
    const head = part.slice(0, open).trim()
    const body = part.slice(open + 1, part.lastIndexOf(')'))
    const [aliasPart, tablePart] = head.includes(':')
      ? head.split(':').map((s) => s.trim())
      : [head, head]

    embeds.push({
      alias: aliasPart,
      table: tablePart,
      columns: splitTopLevel(body),
    })
  }

  return { columns, embeds }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

type Filter =
  | { kind: 'cmp'; column: string; op: string; value: unknown }
  | { kind: 'in'; column: string; values: Array<unknown> }
  | { kind: 'contains'; column: string; values: Array<unknown> }
  | { kind: 'ilike'; column: string; pattern: string }
  | { kind: 'or'; clauses: Array<{ column: string; op: string; value: string }> }

const SQL_OPS: Record<string, string> = {
  eq: '=',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
}

class QueryBuilder<TRow = any> implements PromiseLike<PostgrestResponse<Array<TRow>>> {
  private selectClause = '*'
  private filters: Array<Filter> = []
  private orderBy: Array<{ column: string; ascending: boolean }> = []
  private limitCount: number | null = null
  private singleRow = false
  private mode: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private payload: Array<Record<string, unknown>> = []
  private returning = false

  private readonly table: string

  constructor(table: string) {
    this.table = table
  }

  // -- shaping ---------------------------------------------------------------

  select(columns = '*'): this {
    if (this.mode === 'select') {
      this.selectClause = columns || '*'
    } else {
      // `.insert(...).select()` / `.delete().select()` — ask for the rows back
      this.returning = true
      if (columns && columns !== '*') this.selectClause = columns
    }
    return this
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ kind: 'cmp', column, op: 'eq', value })
    return this
  }

  neq(column: string, value: unknown): this {
    this.filters.push({ kind: 'cmp', column, op: 'neq', value })
    return this
  }

  gt(column: string, value: unknown): this {
    this.filters.push({ kind: 'cmp', column, op: 'gt', value })
    return this
  }

  gte(column: string, value: unknown): this {
    this.filters.push({ kind: 'cmp', column, op: 'gte', value })
    return this
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ kind: 'cmp', column, op: 'lt', value })
    return this
  }

  lte(column: string, value: unknown): this {
    this.filters.push({ kind: 'cmp', column, op: 'lte', value })
    return this
  }

  in(column: string, values: Array<unknown>): this {
    this.filters.push({ kind: 'in', column, values: values ?? [] })
    return this
  }

  ilike(column: string, pattern: string): this {
    this.filters.push({ kind: 'ilike', column, pattern })
    return this
  }

  /** Postgres array containment; the column holds a JSON array in D1. */
  contains(column: string, values: Array<unknown>): this {
    this.filters.push({ kind: 'contains', column, values: values ?? [] })
    return this
  }

  /** Only the `col.op.value,col.op.value` form the app uses is supported. */
  or(expression: string): this {
    const clauses = expression
      .split(',')
      .map((clause) => {
        const [column, op, ...rest] = clause.split('.')
        return { column, op, value: rest.join('.') }
      })
      .filter((c) => c.column && c.op)
    this.filters.push({ kind: 'or', clauses })
    return this
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBy.push({ column, ascending: opts?.ascending !== false })
    return this
  }

  limit(count: number): this {
    this.limitCount = count
    return this
  }

  single(): SingleQueryBuilder<TRow> {
    this.singleRow = true
    return this as unknown as SingleQueryBuilder<TRow>
  }

  maybeSingle(): SingleQueryBuilder<TRow> {
    this.singleRow = true
    return this as unknown as SingleQueryBuilder<TRow>
  }

  // -- mutations -------------------------------------------------------------

  insert(rows: Record<string, unknown> | Array<Record<string, unknown>>): this {
    this.mode = 'insert'
    this.payload = Array.isArray(rows) ? rows : [rows]
    return this
  }

  update(values: Record<string, unknown>): this {
    this.mode = 'update'
    this.payload = [values]
    return this
  }

  delete(): this {
    this.mode = 'delete'
    return this
  }

  // -- execution -------------------------------------------------------------

  then<TResult1 = PostgrestResponse<Array<TRow>>, TResult2 = never>(
    onfulfilled?:
      | ((value: PostgrestResponse<Array<TRow>>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled as any, onrejected)
  }

  private buildWhere(
    table: TableName,
  ): { sql: string; params: Array<unknown>; error?: PostgrestError } {
    const conditions: Array<string> = []
    const params: Array<unknown> = []

    for (const filter of this.filters) {
      if (filter.kind === 'or') {
        const parts: Array<string> = []
        for (const clause of filter.clauses) {
          if (!hasColumn(table, clause.column)) {
            return { sql: '', params: [], error: undefinedColumn(table, clause.column) }
          }
          const op = SQL_OPS[clause.op]
          if (!op) {
            return { sql: '', params: [], error: err(`unsupported operator "${clause.op}"`) }
          }
          parts.push(`"${clause.column}" ${op} ?`)
          params.push(clause.value)
        }
        if (parts.length) conditions.push(`(${parts.join(' OR ')})`)
        continue
      }

      if (!hasColumn(table, filter.column)) {
        return { sql: '', params: [], error: undefinedColumn(table, filter.column) }
      }

      switch (filter.kind) {
        case 'cmp': {
          const op = SQL_OPS[filter.op]
          if (filter.value === null) {
            conditions.push(`"${filter.column}" IS ${filter.op === 'neq' ? 'NOT ' : ''}NULL`)
          } else {
            conditions.push(`"${filter.column}" ${op} ?`)
            params.push(encodeValue(table, filter.column, filter.value))
          }
          break
        }
        case 'in': {
          if (!filter.values.length) {
            conditions.push('0 = 1')
          } else {
            conditions.push(
              `"${filter.column}" IN (${filter.values.map(() => '?').join(', ')})`,
            )
            params.push(...filter.values.map((v) => encodeValue(table, filter.column, v)))
          }
          break
        }
        case 'ilike': {
          // SQLite LIKE is already case-insensitive for ASCII.
          conditions.push(`"${filter.column}" LIKE ?`)
          params.push(filter.pattern)
          break
        }
        case 'contains': {
          // Array containment against the stored JSON array.
          for (const value of filter.values) {
            conditions.push(
              `EXISTS (SELECT 1 FROM json_each("${filter.column}") WHERE json_each.value = ?)`,
            )
            params.push(value)
          }
          break
        }
      }
    }

    return {
      sql: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '',
      params,
    }
  }

  private buildOrderLimit(table: TableName): { sql: string; error?: PostgrestError } {
    let sql = ''
    if (this.orderBy.length) {
      for (const o of this.orderBy) {
        if (!hasColumn(table, o.column)) {
          return { sql: '', error: undefinedColumn(table, o.column) }
        }
      }
      sql += ` ORDER BY ${this.orderBy
        .map((o) => `"${o.column}" ${o.ascending ? 'ASC' : 'DESC'}`)
        .join(', ')}`
    }
    if (this.limitCount !== null) sql += ` LIMIT ${Number(this.limitCount)}`
    else if (this.singleRow) sql += ' LIMIT 1'
    return { sql }
  }

  private async execute(): Promise<PostgrestResponse<any>> {
    if (!isTable(this.table)) {
      return { data: null, error: err(`relation "${this.table}" does not exist`, '42P01') }
    }
    const table = this.table

    try {
      switch (this.mode) {
        case 'select':
          return await this.runSelect(table)
        case 'insert':
          return await this.runInsert(table)
        case 'update':
          return await this.runUpdate(table)
        case 'delete':
          return await this.runDelete(table)
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      return { data: null, error: err(message, 'D1_ERROR') }
    }
  }

  private async runSelect(table: TableName): Promise<PostgrestResponse<any>> {
    const parsed = parseSelect(this.selectClause)

    const baseColumns = parsed.columns.includes('*')
      ? TABLE_COLUMNS[table]
      : parsed.columns

    for (const column of baseColumns) {
      if (!hasColumn(table, column)) return { data: null, error: undefinedColumn(table, column) }
    }

    // Embedded resources need their foreign key present even when not selected.
    const fkColumns: Array<string> = []
    for (const embed of parsed.embeds) {
      const fk = EMBED_FOREIGN_KEYS[`${table}:${embed.table}`]
      if (!fk) {
        return {
          data: null,
          error: err(
            `could not find a relationship between "${table}" and "${embed.table}"`,
            'PGRST200',
          ),
        }
      }
      fkColumns.push(fk)
    }

    const projection = [...new Set([...baseColumns, ...fkColumns])]
    const where = this.buildWhere(table)
    if (where.error) return { data: null, error: where.error }
    const tail = this.buildOrderLimit(table)
    if (tail.error) return { data: null, error: tail.error }

    const sql =
      `SELECT ${projection.map((c) => `"${c}"`).join(', ')} FROM "${table}"` +
      where.sql +
      tail.sql

    const { results } = await db().prepare(sql).bind(...where.params).all<Record<string, unknown>>()
    const rows = (results ?? []).map((row) => decodeRow(table, { ...row }))

    await this.attachEmbeds(table, rows, parsed.embeds)

    // Drop foreign keys that were only fetched to satisfy an embed.
    if (!parsed.columns.includes('*')) {
      const keep = new Set([...parsed.columns, ...parsed.embeds.map((e) => e.alias)])
      for (const row of rows) {
        for (const key of Object.keys(row)) if (!keep.has(key)) delete row[key]
      }
    }

    if (this.singleRow) {
      if (rows.length === 0) {
        return {
          data: null,
          error: err('JSON object requested, multiple (or no) rows returned', 'PGRST116'),
        }
      }
      return { data: rows[0], error: null }
    }

    return { data: rows, error: null }
  }

  /** Resolve to-one embedded resources with one extra query per relationship. */
  private async attachEmbeds(
    table: TableName,
    rows: Array<Record<string, unknown>>,
    embeds: Array<Embed>,
  ): Promise<void> {
    for (const embed of embeds) {
      const fk = EMBED_FOREIGN_KEYS[`${table}:${embed.table}`]
      const target = embed.table
      if (!fk || !isTable(target)) continue

      const ids = [...new Set(rows.map((r) => r[fk]).filter((v) => v !== null && v !== undefined))]

      if (!ids.length) {
        for (const row of rows) row[embed.alias] = null
        continue
      }

      const cols = embed.columns.includes('*') ? TABLE_COLUMNS[target] : embed.columns
      const projection = [...new Set([...cols, 'id'])]

      const { results } = await db()
        .prepare(
          `SELECT ${projection.map((c) => `"${c}"`).join(', ')} FROM "${target}" ` +
            `WHERE "id" IN (${ids.map(() => '?').join(', ')})`,
        )
        .bind(...ids)
        .all<Record<string, unknown>>()

      const byId = new Map<unknown, Record<string, unknown>>()
      for (const related of results ?? []) {
        const decoded = decodeRow(target, { ...related })
        const id = decoded.id
        if (!cols.includes('id')) delete decoded.id
        byId.set(id, decoded)
      }

      for (const row of rows) row[embed.alias] = byId.get(row[fk]) ?? null
    }
  }

  private async runInsert(table: TableName): Promise<PostgrestResponse<any>> {
    if (!this.payload.length) return { data: null, error: null }

    const columns = [...new Set(this.payload.flatMap((row) => Object.keys(row)))]
    for (const column of columns) {
      if (!hasColumn(table, column)) return { data: null, error: undefinedColumn(table, column) }
    }

    const inserted: Array<Record<string, unknown>> = []

    // D1 caps bound parameters per statement, so insert in batches.
    const perRow = columns.length
    const batchSize = Math.max(1, Math.floor(90 / Math.max(perRow, 1)))

    for (let i = 0; i < this.payload.length; i += batchSize) {
      const slice = this.payload.slice(i, i + batchSize)
      const values = slice.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ')
      const params = slice.flatMap((row) =>
        columns.map((column) => encodeValue(table, column, row[column])),
      )

      const sql =
        `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) ` +
        `VALUES ${values} RETURNING *`

      const { results } = await db().prepare(sql).bind(...params).all<Record<string, unknown>>()
      inserted.push(...(results ?? []).map((row) => decodeRow(table, { ...row })))
    }

    if (!this.returning) return { data: null, error: null }
    if (this.singleRow) return { data: inserted[0] ?? null, error: null }
    return { data: inserted, error: null }
  }

  private async runUpdate(table: TableName): Promise<PostgrestResponse<any>> {
    const values = this.payload[0] ?? {}
    const columns = Object.keys(values)
    if (!columns.length) return { data: null, error: null }

    for (const column of columns) {
      if (!hasColumn(table, column)) return { data: null, error: undefinedColumn(table, column) }
    }

    const where = this.buildWhere(table)
    if (where.error) return { data: null, error: where.error }

    const sql =
      `UPDATE "${table}" SET ${columns.map((c) => `"${c}" = ?`).join(', ')}` +
      where.sql +
      ' RETURNING *'

    const params = [
      ...columns.map((column) => encodeValue(table, column, values[column])),
      ...where.params,
    ]

    const { results } = await db().prepare(sql).bind(...params).all<Record<string, unknown>>()
    const rows = (results ?? []).map((row) => decodeRow(table, { ...row }))

    if (this.singleRow) {
      if (!rows.length) {
        return {
          data: null,
          error: err('JSON object requested, multiple (or no) rows returned', 'PGRST116'),
        }
      }
      return { data: rows[0], error: null }
    }
    return { data: this.returning ? rows : null, error: null }
  }

  private async runDelete(table: TableName): Promise<PostgrestResponse<any>> {
    const where = this.buildWhere(table)
    if (where.error) return { data: null, error: where.error }

    const { results } = await db()
      .prepare(`DELETE FROM "${table}"${where.sql} RETURNING *`)
      .bind(...where.params)
      .all<Record<string, unknown>>()

    const rows = (results ?? []).map((row) => decodeRow(table, { ...row }))
    if (this.singleRow) return { data: rows[0] ?? null, error: null }
    return { data: this.returning ? rows : null, error: null }
  }
}

export function from<TRow = any>(table: string): QueryBuilder<TRow> {
  return new QueryBuilder<TRow>(table)
}
