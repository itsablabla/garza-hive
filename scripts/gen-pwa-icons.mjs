// Regenerates the PWA raster icons (favicon, app icons, apple-touch, maskable)
// from the master mark in logo.svg, using a headless Chromium to rasterize.
//
// The logo.svg master is produced by gen-logo-assets.mjs (the GarzaHive hive-
// geometry bee, adaptive light/dark). Those PNG/ICO outputs are NOT covered by
// gen-logo-assets.mjs, so after any logo change run BOTH:
//   bun scripts/gen-logo-assets.mjs && bun scripts/gen-pwa-icons.mjs
//
// Outputs (all under src/client/public/):
//   garzahive.svg                 vector master copy (transparent, adaptive)
//   favicon.ico                  16/32/48 frames (transparent)
//   garzahive-192.png             "any" app icon, dark bg
//   garzahive-512.png             "any" app icon, dark bg
//   garzahive-maskable-512.png    "maskable" icon, extra safe-zone padding
//   apple-touch-icon.png         iOS home screen (opaque dark bg)
// Plus copies of favicon.ico / apple-touch-icon.png / garzahive.svg into
// site/public/ (the marketing site shares the app favicon set).
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { chromium } from 'playwright'

const root = new URL('..', import.meta.url)
const pub = new URL('./src/client/public/', root)

// Dark brand surface (brand "Ink"), matches manifest background_color.
const BG = '#171614'

const masterSvg = readFileSync(new URL('./logo.svg', root), 'utf8')
  // Drop the baked width/height so CSS can size it to fill its container.
  .replace(/\s(width|height)="\d+"/g, '')

function pageHtml(size, mark, bg) {
  // mark = fraction of the canvas the logomark occupies (the rest is padding).
  const markPx = Math.round(size * mark)
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0}
    .canvas{width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${bg}}
    .mark{width:${markPx}px;height:${markPx}px}
    .mark svg{width:100%;height:100%;display:block}
  </style></head><body>
    <div class="canvas"><div class="mark">${masterSvg}</div></div>
  </body></html>`
}

async function render(page, size, mark, { transparent, colorScheme = 'dark' } = {}) {
  await page.emulateMedia({ colorScheme })
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(pageHtml(size, mark, transparent ? 'transparent' : BG), {
    waitUntil: 'load',
  })
  return page.screenshot({
    clip: { x: 0, y: 0, width: size, height: size },
    omitBackground: !!transparent,
    type: 'png',
  })
}

// Minimal ICO container holding PNG-encoded frames (every modern browser reads
// PNG-in-ICO). Header + one 16-byte directory entry per frame, then the data.
function buildIco(frames) {
  const count = frames.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)

  const dir = Buffer.alloc(count * 16)
  let offset = 6 + count * 16
  frames.forEach((f, i) => {
    const e = i * 16
    dir.writeUInt8(f.size >= 256 ? 0 : f.size, e + 0) // width (0 => 256)
    dir.writeUInt8(f.size >= 256 ? 0 : f.size, e + 1) // height
    dir.writeUInt8(0, e + 2) // palette
    dir.writeUInt8(0, e + 3) // reserved
    dir.writeUInt16LE(1, e + 4) // color planes
    dir.writeUInt16LE(32, e + 6) // bits per pixel
    dir.writeUInt32LE(f.data.length, e + 8) // bytes in resource
    dir.writeUInt32LE(offset, e + 12) // offset
    offset += f.data.length
  })

  return Buffer.concat([header, dir, ...frames.map((f) => f.data)])
}

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })

// App icons on the dark brand surface ("Ink") use the reversed colourway
// (white bands + amber), forced via a dark colour scheme on the adaptive
// master. "any" icons fill more; the maskable variant keeps the mark inside
// the ~80% safe circle the platform may crop to.
const APP_ICONS = [
  { file: 'garzahive-192.png', size: 192, mark: 0.86 },
  { file: 'garzahive-512.png', size: 512, mark: 0.86 },
  { file: 'garzahive-maskable-512.png', size: 512, mark: 0.62 },
  { file: 'apple-touch-icon.png', size: 180, mark: 0.82 },
]
for (const { file, size, mark } of APP_ICONS) {
  const png = await render(page, size, mark)
  writeFileSync(new URL(file, pub), png)
}

// Favicon: transparent frames so the mark sits on any tab background. Light
// scheme (charcoal bands + amber) — the adaptive garzahive.svg takes
// precedence in browsers that support SVG favicons.
const FAVICON_SIZES = [16, 32, 48]
const frames = []
for (const size of FAVICON_SIZES) {
  const data = await render(page, size, 0.96, { transparent: true, colorScheme: 'light' })
  frames.push({ size, data })
}
writeFileSync(new URL('favicon.ico', pub), buildIco(frames))

// Social/OG card for the marketing site: reversed lockup on the Ink surface
// over a faint honeycomb grid. The GARZAHIVE wordmark is drawn from the
// outlined brand paths, so no font install is required.
const { icon, wordmark, colors } = JSON.parse(
  readFileSync(new URL('./scripts/logo-paths.json', root), 'utf8'),
)
const OG_W = 1200
const OG_H = 630
const ogHexes = (() => {
  const s = 46
  const out = []
  for (let row = -1; row * s * Math.sqrt(3) < OG_H + s * 2; row++) {
    for (let col = -1; col * 1.5 * s < OG_W + s * 2; col++) {
      const cx = col * 1.5 * s
      const cy = row * s * Math.sqrt(3) + (col % 2 ? (s * Math.sqrt(3)) / 2 : 0)
      const pts = Array.from({ length: 6 }, (_, k) => {
        const a = (Math.PI / 180) * (60 * k)
        return `${(cx + s * Math.cos(a)).toFixed(1)},${(cy + s * Math.sin(a)).toFixed(1)}`
      }).join(' ')
      out.push(`<polygon points="${pts}" fill="none" stroke="rgba(247,246,242,.05)" stroke-width="1"/>`)
    }
  }
  return out.join('')
})()
const ogMark = `<svg width="230" viewBox="0 0 ${icon.width} ${icon.height}" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(${icon.width / 2},${icon.height / 2})">
    ${icon.wings.map((d) => `<path d="${d}" fill="none" stroke="${colors.amber}" stroke-width="${icon.wingStroke}" stroke-linejoin="round"/>`).join('')}
    ${icon.bands.map((d, i) => `<path d="${d}" fill="${i === icon.accentBand ? colors.amber : colors.white}"/>`).join('')}
  </g>
</svg>`
const ogWordmark = `<svg height="34" viewBox="0 0 ${wordmark.width} ${wordmark.capHeight}" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(0,${wordmark.capHeight})">
    ${wordmark.glyphs.map((g) => `<path d="${g.d}" fill="${colors.white}" transform="translate(${g.x},0) scale(1,-1)"/>`).join('')}
  </g>
</svg>`
const ogHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0}
  .card{position:relative;width:${OG_W}px;height:${OG_H}px;background:${colors.ink};overflow:hidden;
    font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:${colors.combWhite}}
  .grid{position:absolute;inset:0}
  .inner{position:relative;padding:84px 96px;display:flex;flex-direction:column;height:100%;box-sizing:border-box}
  .brand{display:flex;align-items:center;gap:40px}
  .eyebrow{margin-top:52px;font-size:21px;letter-spacing:.32em;font-weight:600;color:rgba(247,246,242,.55);text-transform:uppercase}
  h1{margin:18px 0 0;font-size:88px;line-height:1.06;font-weight:800;letter-spacing:-0.02em}
  h1 .amber{color:${colors.amber}}
  .sub{margin-top:26px;font-size:30px;line-height:1.4;color:rgba(247,246,242,.78);max-width:820px}
</style></head><body>
  <div class="card">
    <svg class="grid" width="${OG_W}" height="${OG_H}" xmlns="http://www.w3.org/2000/svg">${ogHexes}</svg>
    <div class="inner">
      <div class="brand">${ogMark}${ogWordmark}</div>
      <div class="eyebrow">A hive of autonomous agents</div>
      <h1>Your AI team.<br><span class="amber">At home.</span></h1>
      <div class="sub">Agents that remember, collaborate, and build their own tools — entirely on your server.</div>
    </div>
  </div>
</body></html>`
await page.setViewportSize({ width: OG_W, height: OG_H })
await page.setContent(ogHtml, { waitUntil: 'load' })
const ogPng = await page.screenshot({
  clip: { x: 0, y: 0, width: OG_W, height: OG_H },
  type: 'png',
})
writeFileSync(new URL('./site/public/og-image.png', root), ogPng)

await browser.close()

// Vector master used by <link rel="icon" type="image/svg+xml"> and other
// plain <img> contexts.
copyFileSync(new URL('./logo.svg', root), new URL('garzahive.svg', pub))

// The marketing site shares the app favicon set (see site/src/layouts/Base.astro).
for (const file of ['favicon.ico', 'apple-touch-icon.png', 'garzahive.svg']) {
  copyFileSync(new URL(file, pub), new URL(`./site/public/${file}`, root))
}

console.log(
  `regenerated ${APP_ICONS.length} app icons + favicon.ico (${FAVICON_SIZES.join('/')}) + garzahive.svg + og-image.png (+ site copies)`,
)
