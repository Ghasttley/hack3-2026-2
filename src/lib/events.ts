import { config } from '../config'
import { apiRequest } from './api'
import { isApiError } from './errors'
import { endSession, SessionEndedError } from './session'
import { createStore } from './store'
import type { Ticket } from './types'
import { backoff, isAbortError, sleep } from './util'

/**
 * Stream de eventos (SSE) compartido por todas las pestañas del navegador.
 *
 * - Una sola conexión por navegador: la pestaña que obtiene el Web Lock "lumon-sse-leader" es la líder y
 *   abre el stream. Las demás reciben los eventos por BroadcastChannel. Si la líder se cierra, el lock se
 *   libera y otra pestaña lo toma automáticamente.
 * - Autenticación con ticket de un solo uso (POST /events/tickets): un ticket nuevo en cada conexión.
 * - El stream se lee con fetch + ReadableStream (sin librerías), así también vemos los comentarios de
 *   heartbeat. Sin datos ni heartbeat por 45 s → conexión muerta → se reconecta.
 * - Reconexión con espera creciente y `lastEventId` para recuperar lo perdido.
 * - Cada evento se aplica una sola vez (deduplicación por id en cada pestaña).
 */

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'locked' | 'superseded' | 'stopped'

export interface LumonEvent {
  id: number | null
  type: string
  data: unknown
}

type ChannelMessage =
  | { kind: 'event'; event: LumonEvent }
  | { kind: 'status'; status: StreamStatus }
  | { kind: 'status?' }

export const streamStatus = createStore<StreamStatus>('idle')

const listeners = new Map<string, Set<(event: LumonEvent) => void>>()
const seen = new Set<number>()
const seenOrder: number[] = []
let lastEventId: number | null = null

const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lumon-events') : null
let isLeader = false

channel?.addEventListener('message', (ev: MessageEvent<ChannelMessage>) => {
  const msg = ev.data
  if (msg.kind === 'event') deliver(msg.event)
  else if (msg.kind === 'status' && !isLeader) streamStatus.set(msg.status)
  else if (msg.kind === 'status?' && isLeader) channel?.postMessage({ kind: 'status', status: streamStatus.get() })
})

/** Suscribirse a un tipo de evento ('*' para todos). */
export function onEvent(type: string, handler: (event: LumonEvent) => void): () => void {
  let set = listeners.get(type)
  if (!set) {
    set = new Set()
    listeners.set(type, set)
  }
  set.add(handler)
  return () => set.delete(handler)
}

function deliver(event: LumonEvent): void {
  if (event.id !== null) {
    if (seen.has(event.id)) return // duplicado
    seen.add(event.id)
    seenOrder.push(event.id)
    if (seenOrder.length > 5000) {
      const old = seenOrder.shift()
      if (old !== undefined) seen.delete(old)
    }
    if (lastEventId === null || event.id > lastEventId) lastEventId = event.id
  }
  listeners.get(event.type)?.forEach((h) => h(event))
  listeners.get('*')?.forEach((h) => h(event))
}

function setStatus(status: StreamStatus): void {
  streamStatus.set(status)
  if (isLeader) channel?.postMessage({ kind: 'status', status } satisfies ChannelMessage)
}

let stopController: AbortController | null = null

/** Arranca el stream (idempotente). Llamar cuando hay sesión. */
export function startEvents(): void {
  if (stopController) return
  stopController = new AbortController()
  const signal = stopController.signal
  channel?.postMessage({ kind: 'status?' } satisfies ChannelMessage)
  const locks = navigator.locks
  if (locks) {
    locks
      .request('lumon-sse-leader', { signal }, async () => {
        isLeader = true
        try {
          await runLeader(signal)
        } finally {
          isLeader = false
        }
      })
      .catch(() => {
        // abortado al cerrar sesión
      })
  } else {
    isLeader = true
    void runLeader(signal)
  }
}

export function stopEvents(): void {
  stopController?.abort()
  stopController = null
  streamStatus.set('stopped')
}

/** Reconexión manual (por ejemplo tras `stream.superseded`). */
export function restartEvents(): void {
  stopEvents()
  startEvents()
}

async function runLeader(signal: AbortSignal): Promise<void> {
  let attempt = 0
  while (!signal.aborted) {
    setStatus(attempt === 0 ? 'connecting' : 'reconnecting')
    let result: StreamEnd
    try {
      const { data: ticket } = await apiRequest<Ticket>('/events/tickets', { method: 'POST', signal, retries: 2 })
      result = await readStream(ticket.ticket, signal, () => {
        attempt = 0
        setStatus('open')
      })
    } catch (e) {
      if (isAbortError(e) || signal.aborted || e instanceof SessionEndedError) return
      if (isApiError(e) && e.code === 'CLEARANCE_REQUIRED') {
        setStatus('locked')
        await sleep(30_000, signal).catch(() => undefined)
        continue
      }
      if (isApiError(e) && e.code === 'SESSION_REVOKED') {
        endSession('SESSION_REVOKED')
        return
      }
      result = 'ended'
    }
    if (result === 'superseded') {
      setStatus('superseded')
      return
    }
    if (result === 'locked') {
      setStatus('locked')
      await sleep(30_000, signal).catch(() => undefined)
      continue
    }
    setStatus('reconnecting')
    await sleep(backoff(attempt++, 1000, 30_000), signal).catch(() => undefined)
  }
}

/** Lee el stream hasta que se corta. Devuelve 'superseded' si el servidor nos reemplazó. */
type StreamEnd = 'ended' | 'superseded' | 'locked'

async function readStream(ticket: string, outer: AbortSignal, onOpen: () => void): Promise<StreamEnd> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  outer.addEventListener('abort', abort, { once: true })
  let lastActivity = Date.now()
  const watchdog = window.setInterval(() => {
    if (Date.now() - lastActivity > 45_000) controller.abort() // conexión muerta
  }, 5_000)

  try {
    const params = new URLSearchParams({ ticket })
    if (lastEventId !== null) params.set('lastEventId', String(lastEventId))
    const res = await fetch(`${config.apiBaseUrl}/events/stream?${params.toString()}`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
    })
    if (!res.ok || !res.body) {
      if (res.status === 423) return 'locked'
      let code = ''
      try {
        const body = (await res.json()) as { error?: string }
        code = body.error ?? ''
      } catch {
        // sin cuerpo
      }
      if (code === 'SESSION_REVOKED') endSession('SESSION_REVOKED')
      return 'ended'
    }
    onOpen()
    lastActivity = Date.now()

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    let evId: string | null = null
    let evType = 'message'
    let dataLines: string[] = []

    for (;;) {
      const { value, done } = await reader.read()
      if (done) return 'ended'
      lastActivity = Date.now()
      buffer += value
      let nl: number
      while ((nl = buffer.search(/\r\n|\r|\n/)) >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + (buffer[nl] === '\r' && buffer[nl + 1] === '\n' ? 2 : 1))
        if (line === '') {
          // fin de evento
          if (dataLines.length > 0) {
            const raw = dataLines.join('\n')
            let data: unknown = raw
            try {
              data = JSON.parse(raw) as unknown
            } catch {
              // texto plano
            }
            const idNum = evId !== null && /^\d+$/.test(evId) ? Number(evId) : null
            const event: LumonEvent = { id: idNum, type: evType, data }
            deliver(event)
            channel?.postMessage({ kind: 'event', event } satisfies ChannelMessage)
            if (evType === 'stream.superseded') return 'superseded'
          }
          evId = null
          evType = 'message'
          dataLines = []
          continue
        }
        if (line.startsWith(':')) continue // comentario / heartbeat
        const colon = line.indexOf(':')
        const field = colon >= 0 ? line.slice(0, colon) : line
        let val = colon >= 0 ? line.slice(colon + 1) : ''
        if (val.startsWith(' ')) val = val.slice(1)
        if (field === 'data') dataLines.push(val)
        else if (field === 'event') evType = val
        else if (field === 'id') evId = val
      }
    }
  } catch (e) {
    if (outer.aborted) throw e
    return 'ended'
  } finally {
    window.clearInterval(watchdog)
    outer.removeEventListener('abort', abort)
  }
}
