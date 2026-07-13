// Gera resources/trayTemplate.png (16x16) e @2x (32x32): barras de waveform
// pretas em fundo transparente (template image; o macOS pinta conforme o tema)
import { deflateSync } from 'zlib'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '../resources')
mkdirSync(outDir, { recursive: true })

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function makePng(size, bars) {
  // bars: [{x, w, h}] em coordenadas relativas 0..1 (h centrado verticalmente)
  const px = Buffer.alloc(size * size * 4) // RGBA transparente
  for (const bar of bars) {
    const x0 = Math.round(bar.x * size)
    const x1 = Math.round((bar.x + bar.w) * size)
    const barH = Math.round(bar.h * size)
    const y0 = Math.round((size - barH) / 2)
    for (let y = y0; y < y0 + barH; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * size + x) * 4
        px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 255
      }
    }
  }
  // scanlines com filtro 0
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// 5 barras estilo waveform (eco do ícone do Wispr, sem copiar)
const bars = [
  { x: 0.10, w: 0.12, h: 0.45 },
  { x: 0.28, w: 0.12, h: 0.80 },
  { x: 0.46, w: 0.12, h: 0.55 },
  { x: 0.64, w: 0.12, h: 0.95 },
  { x: 0.82, w: 0.12, h: 0.35 }
]

writeFileSync(join(outDir, 'trayTemplate.png'), makePng(16, bars))
writeFileSync(join(outDir, 'trayTemplate@2x.png'), makePng(32, bars))
console.log('ícones gerados em', outDir)
