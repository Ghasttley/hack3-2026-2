import { config } from '../../config'
import { api } from '../../lib/api'
import type { Media, MediaPurpose, MediaTicket } from '../../lib/types'
import type { ProcessedImage } from './image'

/**
 * Flujo de subida (siempre con permiso):
 *   1. POST /media/tickets  → ruta exacta y vencimiento
 *   2. subida directa del navegador al storage (XMLHttpRequest, con progreso real y cancelable)
 *   3. POST /media/tickets/{id}/confirm → el backend descarga y comprueba → mediaId
 * Solo se usan la clave publicable de Supabase o el preset unsigned de Cloudinary.
 */

export async function requestTicket(purpose: MediaPurpose, img: ProcessedImage): Promise<MediaTicket> {
  return api<MediaTicket>('/media/tickets', {
    method: 'POST',
    body: {
      purpose,
      contentType: 'image/webp',
      bytes: img.bytes.byteLength,
      sha256: img.sha256,
      width: img.width,
      height: img.height,
    },
    retries: 2,
  })
}

export async function confirmTicket(ticketId: string, url: string): Promise<Media> {
  return api<Media>(`/media/tickets/${encodeURIComponent(ticketId)}/confirm`, { method: 'POST', body: { url }, retries: 2 })
}

export class UploadAbortedError extends Error {
  constructor() {
    super('Subida cancelada')
  }
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/** Sube al storage con XHR (progreso de subida real). Devuelve la URL pública. */
export function uploadToStorage(
  ticket: MediaTicket,
  blob: Blob,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new UploadAbortedError())
      return
    }
    const xhr = new XMLHttpRequest()
    let publicUrl = ''
    let body: XMLHttpRequestBodyInit

    if (ticket.provider === 'SUPABASE') {
      const base = config.supabase.url
      const bucket = ticket.bucket ?? config.supabase.bucket
      const path = ticket.objectPath
      if (!base || !path) {
        reject(new Error('Falta la configuración de Supabase o la ruta del ticket.'))
        return
      }
      xhr.open('POST', `${base}/storage/v1/object/${encodeURIComponent(bucket)}/${encodePath(path)}`)
      const key = config.supabase.publishableKey
      xhr.setRequestHeader('apikey', key)
      // Las claves anon (JWT) también van como Bearer; las sb_publishable_ solo en apikey.
      if (!key.startsWith('sb_publishable_')) xhr.setRequestHeader('Authorization', `Bearer ${key}`)
      xhr.setRequestHeader('Content-Type', 'image/webp')
      xhr.setRequestHeader('x-upsert', 'false')
      publicUrl = `${base}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodePath(path)}`
      body = blob
    } else {
      const cloud = config.cloudinary.cloudName
      const preset = config.cloudinary.uploadPreset
      if (!cloud || !preset || !ticket.uploadPublicId) {
        reject(new Error('Falta la configuración de Cloudinary o el public_id del ticket.'))
        return
      }
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`)
      const form = new FormData()
      form.append('file', blob, 'image.webp')
      form.append('upload_preset', preset)
      form.append('public_id', ticket.uploadPublicId)
      body = form
    }

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(ev.loaded / ev.total)
    }
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let msg = `El storage respondió ${xhr.status}`
        try {
          const parsed = JSON.parse(xhr.responseText) as { message?: string; error?: { message?: string } | string }
          const m = typeof parsed.error === 'object' ? parsed.error.message : (parsed.message ?? parsed.error)
          if (m) msg += `: ${m}`
        } catch {
          // sin JSON
        }
        reject(new Error(msg))
        return
      }
      onProgress(1)
      if (ticket.provider === 'CLOUDINARY') {
        try {
          const parsed = JSON.parse(xhr.responseText) as { secure_url?: string }
          if (!parsed.secure_url) throw new Error('sin URL')
          resolve(parsed.secure_url)
        } catch {
          reject(new Error('Cloudinary no devolvió la URL de la imagen.'))
        }
      } else resolve(publicUrl)
    }
    xhr.onerror = () => reject(new Error('Fallo de red durante la subida.'))
    xhr.onabort = () => reject(new UploadAbortedError())
    signal.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(body)
  })
}
