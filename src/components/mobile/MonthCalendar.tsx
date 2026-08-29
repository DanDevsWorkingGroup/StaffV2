import { useState } from 'react'

export type CalItem = {
  key: string | number
  label: string
  /** Hex colour for the left border (grid) / dot (agenda). */
  color?: string
  onClick?: () => void
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function buildGrid(monthDate: Date): (number | null)[] {
  const year = monthDate.getFullYear()
  const month = monthDate.getMonth()
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  return cells
}

/**
 * Month calendar with two layouts sharing one data source:
 *
 * - **Agenda** (default on phones): a vertical list of the days that have
 *   something on them — readable in a 320 px column where a 7-column grid is not.
 * - **Grid** (default on `sm` and up): the familiar month grid, with `min-h`
 *   cells instead of `aspect-square` so a day can hold a couple of chips.
 *
 * A segmented control lets either layout be forced at any width.
 */
export function MonthCalendar({
  monthDate,
  getItems,
  onDayClick,
  readOnly = false,
  accentClass = 'text-orange-600',
  todayRingClass = 'border-orange-500 bg-orange-50',
}: {
  monthDate: Date
  getItems: (day: number) => CalItem[]
  onDayClick?: (day: number) => void
  readOnly?: boolean
  accentClass?: string
  todayRingClass?: string
}) {
  const [view, setView] = useState<'auto' | 'agenda' | 'grid'>('auto')

  const cells = buildGrid(monthDate)
  const year = monthDate.getFullYear()
  const month = monthDate.getMonth()
  const now = new Date()
  const isToday = (day: number) =>
    day === now.getDate() && month === now.getMonth() && year === now.getFullYear()

  const daysWithItems = cells
    .filter((d): d is number => d !== null)
    .map((day) => ({ day, items: getItems(day) }))
    .filter((d) => d.items.length > 0)

  const handleDay = (day: number) => {
    if (!readOnly && onDayClick) onDayClick(day)
  }

  const agendaVisible = view === 'agenda' ? '' : view === 'grid' ? 'hidden' : 'sm:hidden'
  const gridVisible = view === 'grid' ? '' : view === 'agenda' ? 'hidden' : 'hidden sm:block'

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-600">
          {monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-xs font-semibold">
          {(['agenda', 'grid'] as const).map((v) => {
            const active =
              (view === 'auto' && v === 'agenda') || view === v
                ? 'bg-gray-800 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            return (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-3 py-1.5 capitalize ${active}`}
                aria-pressed={view === v}
              >
                {v}
              </button>
            )
          })}
        </div>
      </div>

      {/* Agenda */}
      <div className={agendaVisible}>
        {daysWithItems.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">Nothing scheduled this month.</p>
        ) : (
          <ol className="divide-y divide-gray-100">
            {daysWithItems.map(({ day, items }) => {
              const date = new Date(year, month, day)
              return (
                <li key={day} className="flex gap-3 py-3">
                  <button
                    type="button"
                    onClick={() => handleDay(day)}
                    disabled={readOnly || !onDayClick}
                    className={`flex w-12 shrink-0 flex-col items-center rounded-lg py-1 ${
                      isToday(day) ? todayRingClass + ' border' : ''
                    } ${!readOnly && onDayClick ? 'hover:bg-gray-100' : ''}`}
                  >
                    <span className="text-[11px] uppercase text-gray-500">
                      {date.toLocaleDateString('en-US', { weekday: 'short' })}
                    </span>
                    <span className={`text-lg font-bold ${isToday(day) ? accentClass : 'text-gray-900'}`}>
                      {day}
                    </span>
                  </button>
                  <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
                    {items.map((item) => (
                      <li key={item.key}>
                        <button
                          type="button"
                          onClick={() => (item.onClick ?? (() => handleDay(day)))()}
                          className="flex w-full min-w-0 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-left text-sm hover:bg-gray-50"
                          style={item.color ? { borderLeftColor: item.color, borderLeftWidth: 3 } : undefined}
                        >
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ol>
        )}

        {!readOnly && onDayClick ? (
          <label className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3 text-sm text-gray-600">
            <span className="shrink-0">Open another date:</span>
            <input
              type="date"
              className="min-h-11 flex-1 rounded-lg border border-gray-300 px-3 text-base"
              min={`${year}-${String(month + 1).padStart(2, '0')}-01`}
              max={`${year}-${String(month + 1).padStart(2, '0')}-${String(
                new Date(year, month + 1, 0).getDate(),
              ).padStart(2, '0')}`}
              onChange={(e) => {
                const d = e.target.value ? Number(e.target.value.slice(8, 10)) : 0
                if (d) handleDay(d)
              }}
            />
          </label>
        ) : null}
      </div>

      {/* Grid */}
      <div className={gridVisible}>
        <div className="mb-2 grid grid-cols-7 gap-1 sm:gap-2">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2 text-center text-xs font-semibold text-gray-600">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {cells.map((day, idx) => {
            if (day === null) return <div key={`e-${idx}`} className="min-h-[76px]" />
            const items = getItems(day)
            return (
              <button
                key={day}
                type="button"
                onClick={() => handleDay(day)}
                disabled={readOnly || !onDayClick}
                className={`flex min-h-[76px] flex-col rounded-lg border-2 p-1.5 text-left transition sm:min-h-[104px] sm:p-2 ${
                  isToday(day) ? todayRingClass : 'border-gray-200 bg-white'
                } ${!readOnly && onDayClick ? 'hover:border-orange-400 hover:shadow-sm' : 'cursor-default'}`}
              >
                <span className={`text-sm font-semibold ${isToday(day) ? accentClass : 'text-gray-900'}`}>
                  {day}
                </span>
                <span className="mt-1 flex flex-col gap-1 overflow-hidden">
                  {items.slice(0, 3).map((item) => (
                    <span
                      key={item.key}
                      className="truncate rounded bg-gray-100 px-1 py-0.5 text-[11px] text-gray-700"
                      style={item.color ? { borderLeft: `3px solid ${item.color}` } : undefined}
                    >
                      {item.label}
                    </span>
                  ))}
                  {items.length > 3 ? (
                    <span className="text-[11px] font-medium text-gray-500">+{items.length - 3} more</span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
