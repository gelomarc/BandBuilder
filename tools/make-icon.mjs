// Generates build/icon.ico — a 256×256 targeting reticle in the app's colours.
// Written by hand so the repository needs no image tooling: an ICO is a small header plus a
// bottom-up BGRA bitmap and a (here empty) 1-bit mask.
import fs from 'node:fs'
import path from 'node:path'

const SIZE = 256
const OUT = 'build/icon.ico'

const BG = [0x1a, 0x16, 0x14] // #14161a as B,G,R
const GOLD = [0x27, 0xa2, 0xc9] // #c9a227 as B,G,R

const c = (SIZE - 1) / 2
const ring = { outer: 112, inner: 98 }
const hub = 15
const tick = { from: 60, to: 124, half: 7 }

/** Coverage of the reticle at one pixel, supersampled 3×3 so the curves are not jagged. */
function coverage(px, py) {
  let hits = 0
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const x = px + (sx + 0.5) / 3 - c
      const y = py + (sy + 0.5) / 3 - c
      const r = Math.hypot(x, y)
      const inRing = r <= ring.outer && r >= ring.inner
      const inHub = r <= hub
      const inTick =
        (Math.abs(y) <= tick.half && Math.abs(x) >= tick.from && Math.abs(x) <= tick.to) ||
        (Math.abs(x) <= tick.half && Math.abs(y) >= tick.from && Math.abs(y) <= tick.to)
      if (inRing || inHub || inTick) hits++
    }
  }
  return hits / 9
}

const pixels = Buffer.alloc(SIZE * SIZE * 4)
for (let y = 0; y < SIZE; y++) {
  // ICO bitmaps are stored bottom-up.
  const row = SIZE - 1 - y
  for (let x = 0; x < SIZE; x++) {
    const a = coverage(x, y)
    const o = (row * SIZE + x) * 4
    for (let ch = 0; ch < 3; ch++) pixels[o + ch] = Math.round(BG[ch] * (1 - a) + GOLD[ch] * a)
    pixels[o + 3] = 0xff
  }
}

const header = Buffer.alloc(40)
header.writeUInt32LE(40, 0) // biSize
header.writeInt32LE(SIZE, 4) // biWidth
header.writeInt32LE(SIZE * 2, 8) // biHeight: image plus mask
header.writeUInt16LE(1, 12) // biPlanes
header.writeUInt16LE(32, 14) // biBitCount
header.writeUInt32LE(pixels.length, 20) // biSizeImage

const mask = Buffer.alloc((SIZE / 8) * SIZE) // fully opaque, so all zero
const image = Buffer.concat([header, pixels, mask])

const dir = Buffer.alloc(22)
dir.writeUInt16LE(0, 0) // reserved
dir.writeUInt16LE(1, 2) // type: icon
dir.writeUInt16LE(1, 4) // one image
dir.writeUInt8(0, 6) // width 0 means 256
dir.writeUInt8(0, 7) // height 0 means 256
dir.writeUInt16LE(1, 10) // planes
dir.writeUInt16LE(32, 12) // bit count
dir.writeUInt32LE(image.length, 14)
dir.writeUInt32LE(22, 18) // offset of the image data

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, Buffer.concat([dir, image]))
console.log(`${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`)
