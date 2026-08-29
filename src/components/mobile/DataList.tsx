import type { ReactNode } from 'react'

export type Column<T> = {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  /** Rendered as the card heading on mobile, with no label. Use for the name column. */
  primary?: boolean
  thClassName?: string
  tdClassName?: string
}

/**
 * One data set, two presentations:
 *
 * - `md` and up: a normal table wrapped in a horizontal-scroll container.
 * - below `md`: a stacked list of cards, each cell shown as a `label → value`
 *   row so nothing is hidden off the right edge of a phone.
 */
export function DataList<T>({
  rows,
  columns,
  getKey,
  actions,
  empty = 'Nothing to show.',
}: {
  rows: T[]
  columns: Column<T>[]
  getKey: (row: T) => string | number
  actions?: (row: T) => ReactNode
  empty?: ReactNode
}) {
  if (rows.length === 0) {
    return <div className="px-4 py-10 text-center text-sm text-gray-500">{empty}</div>
  }

  const primary = columns.find((c) => c.primary) ?? columns[0]
  const rest = columns.filter((c) => c !== primary)

  return (
    <>
      {/* Mobile: cards */}
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li
            key={getKey(row)}
            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
          >
            <div className="font-semibold text-gray-900">{primary.cell(row)}</div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {rest.map((col) => (
                <div key={col.key} className="contents">
                  <dt className="text-gray-500">{col.header}</dt>
                  <dd className="text-gray-900">{col.cell(row)}</dd>
                </div>
              ))}
            </dl>
            {actions ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                {actions(row)}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full">
          <thead className="border-b-2 border-gray-200 bg-gray-50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-700 ${col.thClassName ?? ''}`}
                >
                  {col.header}
                </th>
              ))}
              {actions ? (
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-700">
                  Actions
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rows.map((row) => (
              <tr key={getKey(row)} className="transition hover:bg-gray-50">
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-4 text-sm text-gray-900 ${col.tdClassName ?? ''}`}>
                    {col.cell(row)}
                  </td>
                ))}
                {actions ? (
                  <td className="px-4 py-4 text-sm">
                    <div className="flex items-center gap-2">{actions(row)}</div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
