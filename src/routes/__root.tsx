/// <reference types="vite/client" />
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { createServerFn } from '@tanstack/react-start'
import * as React from 'react'
import { DefaultCatchBoundary } from '../components/DefaultCatchBoundary'
import { NotFound } from '../components/NotFound'
import appCss from '../styles/app.css?url'
import { seo } from '../utils/seo'
import { getSupabaseServerClient } from '../utils/supabase'

const fetchUser = createServerFn({ method: 'GET' }).handler(async () => {
  const supabase = getSupabaseServerClient()
  const { data, error: _error } = await supabase.auth.getUser()

  if (!data.user?.email) {
    return null
  }

  return {
    email: data.user.email,
  }
})

export const Route = createRootRoute({
  beforeLoad: async () => {
    const user = await fetchUser()

    return {
      user,
    }
  },
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      ...seo({
        title: 'ABPM Trainer System - Manage Training Activities',
        description: 'ABPM Trainer Management System for tracking schedules, events, dormitory, and activities',
      }),
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/apple-touch-icon.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: '/favicon-32x32.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        href: '/favicon-16x16.png',
      },
      { rel: 'manifest', href: '/site.webmanifest', color: '#fffff' },
      { rel: 'icon', href: '/favicon.ico' },
    ],
  }),
  errorComponent: (props) => {
    return (
      <RootDocument>
        <DefaultCatchBoundary {...props} />
      </RootDocument>
    )
  },
  notFoundComponent: () => <NotFound />,
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const { user } = Route.useRouteContext()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false)

  return (
    <html>
      <head>
        <HeadContent />
      </head>
      <body className="bg-gray-50">
        {/* Top Navigation Bar */}
        <nav className="bg-gradient-to-r from-orange-600 to-red-700 text-white shadow-lg">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex justify-between items-center h-16">
              {/* Logo and Title */}
              <div className="flex items-center space-x-3">
                <span className="text-2xl">🔥</span>
                <div>
                  <h1 className="text-xl font-bold">ABPM Trainer System</h1>
                  <p className="text-xs text-orange-100">Akademi Bomba dan Penyelamat Malaysia</p>
                </div>
              </div>

              {/* Desktop Navigation */}
              <div className="hidden md:flex items-center space-x-1">
                <NavLink to="/" label="Home" icon="🏠" />
                <NavLink to="/schedule" label="Schedule" icon="📅" />
                <NavLink to="/events" label="Events" icon="📋" />
                <NavLink to="/dormitory" label="Dormitory" icon="🏢" />
                <NavLink to="/physical-training" label="PT" icon="💪" />
                <NavLink to="/religious-activity" label="Religious" icon="📖" />
                <NavLink to="/trainer-overview" label="Overview" icon="👥" />
              </div>

              {/* User Menu */}
              <div className="flex items-center space-x-4">
                {user ? (
                  <>
                    <span className="hidden sm:inline text-sm">{user.email}</span>
                    <Link 
                      to="/logout" 
                      className="bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded text-sm"
                    >
                      Logout
                    </Link>
                  </>
                ) : (
                  <Link 
                    to="/login" 
                    className="bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded text-sm"
                  >
                    Login
                  </Link>
                )}
                
                {/* Mobile Menu Button */}
                <button
                  className="md:hidden p-2"
                  onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Mobile Menu */}
            {isMobileMenuOpen && (
              <div className="md:hidden py-4 border-t border-red-800">
                <div className="flex flex-col space-y-2">
                  <MobileNavLink to="/" label="Home" icon="🏠" />
                  <MobileNavLink to="/schedule" label="Schedule" icon="📅" />
                  <MobileNavLink to="/events" label="Events" icon="📋" />
                  <MobileNavLink to="/dormitory" label="Dormitory" icon="🏢" />
                  <MobileNavLink to="/physical-training" label="Physical Training" icon="💪" />
                  <MobileNavLink to="/religious-activity" label="Religious Activity" icon="📖" />
                  <MobileNavLink to="/trainer-overview" label="Trainer Overview" icon="👥" />
                </div>
              </div>
            )}
          </div>
        </nav>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 py-6">
          {children}
        </main>

        <TanStackRouterDevtools position="bottom-right" />
        <Scripts />
      </body>
    </html>
  )
}

// Desktop Navigation Link Component
function NavLink({ to, label, icon }: { to: string; label: string; icon: string }) {
  return (
    <Link
      to={to}
      activeProps={{
        className: 'bg-red-800 text-white',
      }}
      activeOptions={{ exact: to === '/' }}
      className="px-3 py-2 rounded hover:bg-red-800 transition flex items-center space-x-2 text-sm"
    >
      <span>{icon}</span>
      <span>{label}</span>
    </Link>
  )
}

// Mobile Navigation Link Component
function MobileNavLink({ to, label, icon }: { to: string; label: string; icon: string }) {
  return (
    <Link
      to={to}
      activeProps={{
        className: 'bg-blue-700 text-white',
      }}
      activeOptions={{ exact: to === '/' }}
      className="px-4 py-3 rounded hover:bg-blue-800 transition flex items-center space-x-3"
    >
      <span className="text-xl">{icon}</span>
      <span>{label}</span>
    </Link>
  )
}