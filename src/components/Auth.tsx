import { useState } from 'react'

export function Auth({
  actionText,
  onSubmit,
  status,
  afterSubmit,
}: {
  actionText: string
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  status: 'pending' | 'idle' | 'success' | 'error'
  afterSubmit?: React.ReactNode
}) {
  const [showPassword, setShowPassword] = useState(false)

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center p-8">
      <div className="bg-gray-900 p-8 rounded-lg shadow-lg w-full max-w-md text-white">
        <h1 className="text-2xl font-bold mb-6">{actionText}</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit(e)
          }}
          className="space-y-4"
        >
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1">
              Username
            </label>
            <input
              type="email"
              name="email"
              id="email"
              className="px-3 py-2 w-full rounded border border-gray-700 bg-gray-800 text-white focus:outline-none focus:border-cyan-500 transition-colors"
              placeholder="name@example.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                id="password"
                className="px-3 py-2 w-full rounded border border-gray-700 bg-gray-800 text-white focus:outline-none focus:border-cyan-500 transition-colors pr-10"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-200"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <span className="text-xl">{showPassword ? '👁️' : '🔒'}</span>
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="w-full bg-cyan-600 hover:bg-cyan-700 text-white rounded py-2 font-bold uppercase transition-colors mt-2"
            disabled={status === 'pending'}
          >
            {status === 'pending' ? '...' : actionText}
          </button>

          {actionText === 'Login' && (
            <div className="flex justify-between items-center text-sm mt-4">
              <a href="#" className="text-gray-400 hover:text-white transition-colors ml-auto">
                Forgot your password?
              </a>
            </div>
          )}

          {afterSubmit ? afterSubmit : null}
        </form>
      </div>
    </div>
  )
}