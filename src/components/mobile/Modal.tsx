import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'

type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZES: Record<ModalSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
}

/**
 * Responsive dialog.
 *
 * - Below `sm` it is a bottom sheet: full-width, pinned to the bottom, rounded
 *   top, and it slides up. The body scrolls inside `max-h-[90dvh]` so the
 *   on-screen keyboard can never hide the footer actions.
 * - At `sm` and up it is a centred card.
 *
 * Backdrop click and Escape close it; background scroll is locked while open;
 * the slide-up animation is dropped under `prefers-reduced-motion`.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  initialFocus,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: ModalSize
  /** Ref to the control that should receive focus when the dialog opens. */
  initialFocus?: React.RefObject<HTMLElement | null>
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement as HTMLElement | null
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    // Move focus into the dialog.
    const target = initialFocus?.current ?? panelRef.current
    target?.focus?.()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
      previouslyFocused?.focus?.()
    }
  }, [open, onClose, initialFocus])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl outline-none motion-safe:animate-[modal-in_.18s_ease-out] sm:rounded-xl ${SIZES[size]}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <h2 id={titleId} className="text-lg font-bold text-gray-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 flex h-10 w-10 items-center justify-center rounded-lg text-2xl leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            &times;
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>

        {footer ? (
          <div className="flex flex-wrap justify-end gap-3 border-t border-gray-200 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}
