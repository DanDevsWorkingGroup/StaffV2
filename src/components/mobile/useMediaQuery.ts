import { useEffect, useState } from 'react'

/**
 * SSR-safe media query hook. Returns `false` on the server and on the first
 * client render, then updates after hydration so markup stays consistent.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const update = () => setMatches(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [query])

  return matches
}

/** Tailwind's `sm` breakpoint is 40rem / 640px. Below that we treat it as a phone. */
export const useIsMobile = () => !useMediaQuery('(min-width: 640px)')
