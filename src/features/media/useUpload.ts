import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage, isApiError } from '../../lib/errors'
import type { Media, MediaPurpose, MediaTicket } from '../../lib/types'
import type { ProcessedImage } from './image'
import { confirmTicket, requestTicket, UploadAbortedError, uploadToStorage } from './upload'

export type UploadPhase = 'idle' | 'ticket' | 'uploading' | 'confirming' | 'done' | 'error' | 'cancelled'

export interface UploadState {
  phase: UploadPhase
  progress: number
  error: string | null
  media: Media | null
}

/**
 * Máquina de estados de una subida: ticket → storage → confirmación.
 * Reintentar retoma desde el paso que falló (reutiliza el ticket si sigue vigente).
 */
export function useUpload(purpose: MediaPurpose) {
  const [state, setState] = useState<UploadState>({ phase: 'idle', progress: 0, error: null, media: null })
  const ticketRef = useRef<MediaTicket | null>(null)
  const urlRef = useRef<string | null>(null)
  const imgRef = useRef<ProcessedImage | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const run = useCallback(async (): Promise<Media | undefined> => {
    const img = imgRef.current
    if (!img) return undefined
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const current = () => abortRef.current === controller && !controller.signal.aborted
    const update = (next: UploadState | ((s: UploadState) => UploadState)) => {
      if (abortRef.current === controller) setState(next)
    }
    try {
      const t = ticketRef.current
      if (!t || new Date(t.expiresAt).getTime() - Date.now() < 30_000) {
        ticketRef.current = null
        urlRef.current = null
        update({ phase: 'ticket', progress: 0, error: null, media: null })
        const fresh = await requestTicket(purpose, img)
        if (!current()) throw new UploadAbortedError()
        ticketRef.current = fresh
      }
      const ticket = ticketRef.current
      if (!ticket) throw new Error('Sin ticket')
      if (!urlRef.current) {
        update({ phase: 'uploading', progress: 0, error: null, media: null })
        const url = await uploadToStorage(
          ticket,
          img.blob,
          (p) => update((s) => (s.phase === 'uploading' ? { ...s, progress: p } : s)),
          controller.signal,
        )
        if (!current()) throw new UploadAbortedError()
        urlRef.current = url
      }
      update({ phase: 'confirming', progress: 1, error: null, media: null })
      const media = await confirmTicket(ticket.ticketId, urlRef.current)
      if (!current()) throw new UploadAbortedError()
      update({ phase: 'done', progress: 1, error: null, media })
      return media
    } catch (e) {
      if (e instanceof UploadAbortedError || controller.signal.aborted) {
        update((s) => ({ ...s, phase: 'cancelled', error: null }))
        return undefined
      }
      // Ticket vencido o verificación fallida: el próximo intento empieza con ticket nuevo.
      // Si falló la subida al storage, se reutiliza el ticket vigente.
      const msg = errorMessage(e)
      if (isApiError(e) && (e.code === 'TICKET_EXPIRED' || e.code === 'MEDIA_VERIFICATION_FAILED' || e.code === 'NOT_FOUND')) {
        ticketRef.current = null
        urlRef.current = null
      }
      update((s) => ({ ...s, phase: 'error', error: msg }))
      return undefined
    }
  }, [purpose])

  const start = useCallback(
    (img: ProcessedImage) => {
      imgRef.current = img
      ticketRef.current = null
      urlRef.current = null
      return run()
    },
    [run],
  )

  const retry = useCallback(() => run(), [run])
  const cancel = useCallback(() => abortRef.current?.abort(), [])

  return { state, start, retry, cancel }
}

export type Uploader = ReturnType<typeof useUpload>
