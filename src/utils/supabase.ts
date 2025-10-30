import { getCookies, setCookie } from '@tanstack/react-start/server'
import { createServerClient } from '@supabase/ssr'

export function getSupabaseServerClient() {
  // Define the headers for Cloudflare Access
  const headers: Record<string, string> = {
    'CF-Access-Client-Id': '1318c1f29cc77d28797c144b97fc3bdf.access',
    'CF-Access-Client-Secret': 'aaa0c6140c72bc069b9e7356e67b61ea206d16bc15923c2d8f537cf6bcf32239',
  }

  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return Object.entries(getCookies()).map(([name, value]) => ({
            name,
            value,
          }))
        },
        setAll(cookies) {
          cookies.forEach((cookie) => {
            setCookie(cookie.name, cookie.value)
          })
        },
      },
      // Pass the Cloudflare headers to all requests
      global: {
        headers: headers,
      },
    },
  )
}