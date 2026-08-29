# Mobile responsiveness kit

Shared primitives introduced to fix the phone-layout problems catalogued in the
mobile audit. Import from `~/components/mobile`.

| Export | What it does |
| --- | --- |
| `Modal` | Responsive dialog. Bottom sheet below `sm` (slides up, `max-h-[90dvh]`, internal scroll, sticky footer for actions); centred card at `sm`+. Esc / backdrop close, background scroll lock, `prefers-reduced-motion` aware, focus moved into the dialog (`initialFocus` to target a field). |
| `DataList<T>` | One data set, two layouts: a real `<table>` at `md`+, a stacked list of `label → value` cards below it. Column config via `columns`, per-row buttons via `actions`. Used for the trainer directory. |
| `MonthCalendar` | Month calendar with an **agenda** list (default on phones — only days that have items) and the familiar **grid** (default at `sm`+). A segmented control forces either view. `getItems(day)` maps domain objects to `CalItem`s; `onDayClick` opens whatever the page uses for a day. Used by schedule, physical-training, religious-activity and the trainer-overview dashboard. |
| `PageHeader` | Title / subtitle / actions row that stacks under `sm`. |
| `useMediaQuery`, `useIsMobile` | SSR-safe media-query hooks (`false` on the server and first client render). |

## Global changes that go with the kit

- `src/styles/app.css` — `:focus-visible` ring (replaces the old blanket
  `outline: none`), 16px form controls on phones (stops iOS focus-zoom),
  `prefers-reduced-motion` damping, `modal-in` keyframes, `pt-safe` / `pb-safe`
  utilities.
- `src/routes/__root.tsx` — `<html lang>`, `viewport-fit=cover`, `theme-color`,
  Apple web-app meta, safe-area padding on the nav, responsive `<main>` padding,
  the profile menu is now tap-to-open with outside-click close, long emails
  truncate, router devtools are dev-only.
- `public/site.webmanifest` + `public/icon-*.png` / `favicon-*.png` /
  `apple-touch-icon.png` — regenerate with `npm run build:icons` (needs `sharp`).

## Not yet done (from the audit backlog)

- The schedule "My Schedule" month matrix (~30 columns) still scrolls
  horizontally; needs a per-trainer accordion on mobile.
- Bottom tab bar for the five primary sections under `md`.
- Playwright mobile project + Lighthouse-CI mobile budget.
- Offline shell / service worker for the Schedule screen.
