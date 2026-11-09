/**
 * Procesamiento de imágenes en el navegador, sin librerías:
 * recortar / redimensionar con <canvas>, codificar a WebP, quitar metadatos (EXIF/XMP/ICC) y SHA-256.
 */

export class WebpUnsupportedError extends Error {
  constructor() {
    super('Tu navegador no puede generar imágenes WebP. Usa un navegador reciente (Chrome, Edge o Firefox).')
  }
}

export interface ProcessedImage {
  blob: Blob
  bytes: Uint8Array
  width: number
  height: number
  sha256: string
}

export async function loadBitmap(file: Blob): Promise<ImageBitmap> {
  if (!file.type.startsWith('image/')) throw new Error('El archivo no es una imagen.')
  try {
    // Respeta la orientación EXIF al decodificar; la salida no conserva EXIF.
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('No se pudo leer la imagen.')
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
}

/** Codifica a WebP bajando la calidad hasta entrar en `maxBytes`. */
async function encodeWebp(canvas: HTMLCanvasElement, maxBytes: number): Promise<Uint8Array> {
  for (const q of [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42, 0.34, 0.26, 0.18]) {
    const blob = await toBlob(canvas, q)
    if (!blob || blob.type !== 'image/webp') throw new WebpUnsupportedError()
    if (blob.size <= maxBytes) return stripWebpMetadata(new Uint8Array(await blob.arrayBuffer()))
  }
  throw new Error(`No se pudo comprimir la imagen por debajo de ${Math.round(maxBytes / 1024)} KB.`)
}

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0)
const u32 = (b: Uint8Array, at: number) => ((b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16) | ((b[at + 3] ?? 0) << 24)) >>> 0

/**
 * Elimina los chunks EXIF, XMP e ICCP de un WebP (contenedor RIFF) y limpia sus flags en VP8X.
 * El canvas ya no suele escribirlos; esto lo garantiza.
 */
export function stripWebpMetadata(input: Uint8Array): Uint8Array {
  if (ascii(input, 0) !== 'RIFF' || ascii(input, 8) !== 'WEBP') return input
  const chunks: Uint8Array[] = []
  let pos = 12
  while (pos + 8 <= input.length) {
    const id = ascii(input, pos)
    const size = u32(input, pos + 4)
    const total = 8 + size + (size % 2)
    const chunk = input.slice(pos, Math.min(input.length, pos + total))
    if (id !== 'EXIF' && id !== 'XMP ' && id !== 'ICCP') {
      if (id === 'VP8X' && chunk.length > 8) chunk[8] = (chunk[8] ?? 0) & ~(0x20 | 0x08 | 0x04) // ICC, EXIF, XMP
      chunks.push(chunk)
    }
    pos += total
  }
  const bodyLen = chunks.reduce((a, c) => a + c.length, 0)
  const out = new Uint8Array(12 + bodyLen)
  out.set(input.subarray(0, 12), 0)
  const riffSize = 4 + bodyLen
  out[4] = riffSize & 0xff
  out[5] = (riffSize >> 8) & 0xff
  out[6] = (riffSize >> 16) & 0xff
  out[7] = (riffSize >> 24) & 0xff
  let o = 12
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function finish(canvas: HTMLCanvasElement, maxBytes: number): Promise<ProcessedImage> {
  const bytes = await encodeWebp(canvas, maxBytes)
  return {
    bytes,
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/webp' }),
    width: canvas.width,
    height: canvas.height,
    sha256: await sha256Hex(bytes),
  }
}

export interface Crop {
  sx: number
  sy: number
  size: number
}

/** Fotocheck: exactamente 512 × 512, WebP, ≤ 120 KB. */
export async function makeBadge(bitmap: ImageBitmap, crop: Crop): Promise<ProcessedImage> {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas no disponible')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, crop.sx, crop.sy, crop.size, crop.size, 0, 0, 512, 512)
  return finish(canvas, 120 * 1024)
}

/** Foto de incidencia: lado mayor entre 800 y 1600, WebP, ≤ 300 KB. */
export async function makeIncidentPhoto(bitmap: ImageBitmap): Promise<ProcessedImage> {
  const long = Math.max(bitmap.width, bitmap.height)
  const target = Math.min(1600, Math.max(800, long))
  const scale = target / long
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  // asegurar que el lado mayor quede exactamente en rango tras redondear
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas no disponible')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return finish(canvas, 300 * 1024)
}
