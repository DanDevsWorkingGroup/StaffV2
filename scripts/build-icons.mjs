// Generates the PWA / favicon icon set from public/abpm-logo.png.
// Run: node scripts/build-icons.mjs
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const pub = join(here, '..', 'public')
const SRC = join(pub, 'abpm-logo.png')

const BRAND = { r: 0xc2, g: 0x41, b: 0x0c } // orange-700

/** Square icon: brand ground, logo contained with `pad` fraction of margin. */
async function icon(size, out, { pad = 0.14, bg = BRAND } = {}) {
  const inner = Math.round(size * (1 - pad * 2))
  const logo = await sharp(SRC)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer()
  await sharp({
    create: { width: size, height: size, channels: 4, background: { ...bg, alpha: 1 } },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(join(pub, out))
  console.log('wrote', out)
}

await icon(16, 'favicon-16x16.png', { pad: 0.06 })
await icon(32, 'favicon-32x32.png', { pad: 0.06 })
await icon(180, 'apple-touch-icon.png', { pad: 0.1 })
await icon(192, 'icon-192.png', { pad: 0.12 })
await icon(512, 'icon-512.png', { pad: 0.12 })
await icon(512, 'icon-maskable-512.png', { pad: 0.2 }) // extra safe area for masking
