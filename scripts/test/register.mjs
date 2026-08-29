/** Registers the loader that stubs `cloudflare:workers` for tests. */
import { register } from 'node:module'
register('./loader.mjs', import.meta.url)
