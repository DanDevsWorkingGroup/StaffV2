/**
 * Test-only module loader:
 *  - resolves `cloudflare:workers` to a stub, and
 *  - appends `.ts` to extensionless relative imports (the app uses bundler-style
 *    resolution, which plain Node does not do).
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') {
    return {
      url: new URL('./cloudflare-workers-stub.mjs', import.meta.url).href,
      shortCircuit: true,
    }
  }

  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return await nextResolve(`${specifier}.ts`, context)
    }
    throw error
  }
}
