import { config } from '../../config'
import { apiRequest } from '../../lib/api'
import { errorMessage, isApiError, isRecord } from '../../lib/errors'
import { SessionEndedError } from '../../lib/session'
import type { Cell, Ticket } from '../../lib/types'
import { backoff, uuid } from '../../lib/util'

/**
 * Piso compartido: WebSocket NATIVO (no Socket.IO) con ticket de un solo uso.
 * - Presencia, cursores y reservas de grupos.
 * - Detecta saltos de `seq` y pide `resync`; tras reconectar el estado se reconstruye desde `snapshot`.
 * - Latido con `ping` cada 15 s; dos `pong` sin llegar = conexión muerta → se cierra y reconecta.
 * - Reconexión según el código de cierre: los definitivos no reconectan.
 * - Cursores: máximo 10 mensajes por segundo y ninguno con la pestaña oculta.
 * - Cursores y estado tienen suscripciones separadas: mover cursores no re-renderiza la grilla.
 */

export type FloorStatus = 'connecting' | 'open' | 'reconnecting' | 'failed' | 'closed'

export interface FloorMember {
  userId: number
  displayName: string
}

export interface FloorClaim {
  claimId: string
  userId: number
  displayName: string
  cells: Cell[]
  expiresAt: string
}

export interface FloorState {
  status: FloorStatus
  message: string | null
  members: FloorMember[]
  claims: FloorClaim[]
}

export type ClaimResult =
  | { ok: true; claim: FloorClaim }
  | { ok: false; reason: 'HELD' | 'NOT_A_GROUP' | 'TIMEOUT' | 'UNAVAILABLE'; holder?: string }

const FATAL: Record<number, string> = {
  4400: 'Mensaje inválido enviado al piso (error de la app).',
  4403: 'Origen no verificado o sin permiso para el piso.',
  4404: 'El archivo no existe en el piso.',
  4423: 'El Piso de Pruebas aún no está abierto: el piso compartido no está disponible.',
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}
function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null
}
function cellsOf(v: unknown): Cell[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is Cell => isRecord(x) && typeof x.r === 'number' && typeof x.c === 'number')
}
function claimOf(m: Record<string, unknown>): FloorClaim | null {
  const claimId = m.claimId
  const userId = num(m.userId)
  if ((typeof claimId !== 'string' && typeof claimId !== 'number') || userId === null) return null
  return {
    claimId: String(claimId),
    userId,
    displayName: str(m.displayName, 'Refinador'),
    cells: cellsOf(m.cells),
    expiresAt: str(m.expiresAt),
  }
}

export class FloorClient {
  private ws: WebSocket | null = null
  private fileId: number
  private myUserId: number
  private disposed = false
  private attempt = 0
  private ticketFailures = 0
  private lastSeq: number | null = null
  private pingTimer: number | null = null
  private renewTimer: number | null = null
  private reconnectTimer: number | null = null
  private missedPongs = 0
  private cursorTimer: number | null = null
  private pendingCursor: Cell | null = null
  private lastCursorSent = 0
  private pendingClaims = new Map<string, (r: ClaimResult) => void>()
  myClaimId: string | null = null

  private members = new Map<number, FloorMember>()
  private claims = new Map<string, FloorClaim>()
  readonly cursors = new Map<number, Cell & { displayName: string }>()

  private state: FloorState = { status: 'connecting', message: null, members: [], claims: [] }
  private stateListeners = new Set<() => void>()
  private cursorListeners = new Set<() => void>()
  private cursorVersion = 0

  constructor(fileId: number, myUserId: number) {
    this.fileId = fileId
    this.myUserId = myUserId
    void this.connect()
  }

  // --- suscripciones ---
  subscribeState = (l: () => void) => {
    this.stateListeners.add(l)
    return () => this.stateListeners.delete(l)
  }
  getState = () => this.state
  subscribeCursors = (l: () => void) => {
    this.cursorListeners.add(l)
    return () => this.cursorListeners.delete(l)
  }
  getCursorVersion = () => this.cursorVersion

  private emitState(patch: Partial<FloorState> = {}) {
    this.state = {
      ...this.state,
      ...patch,
      members: [...this.members.values()],
      claims: [...this.claims.values()],
    }
    this.stateListeners.forEach((l) => l())
  }
  private emitCursors() {
    this.cursorVersion++
    this.cursorListeners.forEach((l) => l())
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  // --- conexión ---
  private async connect() {
    if (this.disposed) return
    this.emitState({ status: this.attempt === 0 ? 'connecting' : 'reconnecting', message: null })
    let ticket: Ticket
    try {
      ticket = (await apiRequest<Ticket>('/floor/tickets', { method: 'POST', body: { fileId: this.fileId }, retries: 2 })).data
    } catch (e) {
      if (this.disposed || e instanceof SessionEndedError) return
      if (isApiError(e) && (e.code === 'CLEARANCE_REQUIRED' || e.status === 403 || e.status === 404)) {
        this.emitState({ status: 'failed', message: FATAL[e.status === 423 ? 4423 : e.status === 404 ? 4404 : 4403] ?? errorMessage(e) })
        return
      }
      this.scheduleReconnect(backoff(this.attempt++, 1000))
      return
    }
    if (this.disposed) return

    const ws = new WebSocket(`${config.wsBaseUrl}/floor/ws?ticket=${encodeURIComponent(ticket.ticket)}`)
    this.ws = ws
    ws.onopen = () => {
      this.attempt = 0
      this.ticketFailures = 0
      this.missedPongs = 0
      this.emitState({ status: 'open', message: null })
      this.pingTimer = window.setInterval(() => this.ping(), 15_000)
    }
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') return
      let msg: unknown
      try {
        msg = JSON.parse(ev.data) as unknown
      } catch {
        return
      }
      if (isRecord(msg)) this.handle(msg)
    }
    ws.onclose = (ev: CloseEvent) => this.onClose(ev)
  }

  private onClose(ev: CloseEvent) {
    this.ws = null
    this.stopTimers()
    // Las reservas del servidor se liberan al cortar: limpiamos todo, no quedan fantasmas.
    this.members.clear()
    this.claims.clear()
    this.cursors.clear()
    this.lastSeq = null
    this.myClaimId = null
    for (const resolve of this.pendingClaims.values()) resolve({ ok: false, reason: 'UNAVAILABLE' })
    this.pendingClaims.clear()
    this.emitCursors()
    if (this.disposed) {
      this.emitState({ status: 'closed' })
      return
    }
    const fatal = FATAL[ev.code]
    if (fatal) {
      this.emitState({ status: 'failed', message: `${fatal} (${ev.code}${ev.reason ? ` ${ev.reason}` : ''})` })
      return
    }
    if (ev.code === 4401) {
      // Ticket inválido / vencido / usado: pedir uno nuevo; si vuelve a fallar, no insistir.
      if (++this.ticketFailures >= 2) {
        this.emitState({ status: 'failed', message: 'El piso rechazó el ticket dos veces seguidas.' })
        return
      }
      this.scheduleReconnect(0)
      return
    }
    if (ev.code === 4408) {
      this.scheduleReconnect(0)
      return
    }
    if (ev.code === 4429) {
      this.scheduleReconnect(10_000 + backoff(this.attempt++, 500, 5000))
      return
    }
    this.scheduleReconnect(backoff(this.attempt++, 1000, 30_000))
  }

  private scheduleReconnect(ms: number) {
    this.emitState({ status: 'reconnecting', message: null })
    this.reconnectTimer = window.setTimeout(() => void this.connect(), ms)
  }

  private stopTimers() {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer)
    if (this.renewTimer !== null) window.clearInterval(this.renewTimer)
    if (this.cursorTimer !== null) window.clearTimeout(this.cursorTimer)
    this.pingTimer = this.renewTimer = this.cursorTimer = null
  }

  private send(msg: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(msg))
    return true
  }

  private ping() {
    if (this.missedPongs >= 2) {
      // conexión muerta
      this.ws?.close(4000, 'sin pong')
      return
    }
    this.missedPongs++
    this.send({ type: 'ping', t: Date.now() })
  }

  /** seq crece de uno en uno: si hay salto, se perdió algo → resync. */
  private checkSeq(m: Record<string, unknown>): boolean {
    const seq = num(m.seq)
    if (seq === null) return true
    if (this.lastSeq !== null && seq <= this.lastSeq) return false // duplicado o viejo
    if (this.lastSeq !== null && seq !== this.lastSeq + 1) {
      this.send({ type: 'resync' })
    }
    this.lastSeq = seq
    return true
  }

  private handle(m: Record<string, unknown>) {
    const type = m.type
    switch (type) {
      case 'snapshot': {
        this.members.clear()
        this.claims.clear()
        this.cursors.clear()
        this.lastSeq = num(m.seq)
        if (Array.isArray(m.members)) {
          for (const raw of m.members) {
            if (!isRecord(raw)) continue
            const userId = num(raw.userId)
            if (userId === null) continue
            const displayName = str(raw.displayName, 'Refinador')
            this.members.set(userId, { userId, displayName })
            const r = num(raw.r)
            const c = num(raw.c)
            if (userId !== this.myUserId && r !== null && c !== null) this.cursors.set(userId, { r, c, displayName })
          }
        }
        let mine: string | null = null
        if (Array.isArray(m.claims)) {
          for (const raw of m.claims) {
            if (!isRecord(raw)) continue
            const claim = claimOf(raw)
            if (!claim) continue
            this.claims.set(claim.claimId, claim)
            if (claim.claimId === this.myClaimId) mine = claim.claimId
          }
        }
        if (this.myClaimId && !mine) this.setMyClaim(null)
        this.emitCursors()
        this.emitState()
        return
      }
      case 'member.joined':
      case 'member.left': {
        if (!this.checkSeq(m)) return
        const userId = num(m.userId)
        if (userId === null) return
        if (type === 'member.joined') this.members.set(userId, { userId, displayName: str(m.displayName, 'Refinador') })
        else {
          this.members.delete(userId)
          this.cursors.delete(userId)
          this.emitCursors()
        }
        this.emitState()
        return
      }
      case 'cursor': {
        const userId = num(m.userId)
        const r = num(m.r)
        const c = num(m.c)
        if (userId === null || r === null || c === null || userId === this.myUserId) return
        const name = this.members.get(userId)?.displayName ?? 'Refinador'
        this.cursors.set(userId, { r, c, displayName: name })
        this.emitCursors()
        return
      }
      case 'claim.granted': {
        if (!this.checkSeq(m)) return
        const claim = claimOf(m)
        if (!claim) return
        this.claims.set(claim.claimId, claim)
        const requestId = str(m.requestId)
        const resolve = this.pendingClaims.get(requestId)
        if (resolve) {
          this.pendingClaims.delete(requestId)
          this.setMyClaim(claim.claimId)
          resolve({ ok: true, claim })
        }
        this.emitState()
        return
      }
      case 'claim.denied': {
        const requestId = str(m.requestId)
        const resolve = this.pendingClaims.get(requestId)
        if (!resolve) return
        this.pendingClaims.delete(requestId)
        const holder = isRecord(m.holder) ? str(m.holder.displayName) : undefined
        resolve({ ok: false, reason: m.reason === 'NOT_A_GROUP' ? 'NOT_A_GROUP' : 'HELD', holder })
        return
      }
      case 'claim.updated': {
        if (!this.checkSeq(m)) return
        const claim = claimOf(m)
        if (claim) this.claims.set(claim.claimId, claim)
        this.emitState()
        return
      }
      case 'claim.released': {
        if (!this.checkSeq(m)) return
        const claimId = m.claimId
        if (typeof claimId === 'string' || typeof claimId === 'number') {
          this.claims.delete(String(claimId))
          if (String(claimId) === this.myClaimId) this.setMyClaim(null)
        }
        this.emitState()
        return
      }
      case 'pong':
        this.missedPongs = 0
        return
      default:
        return
    }
  }

  private setMyClaim(claimId: string | null) {
    this.myClaimId = claimId
    if (this.renewTimer !== null) window.clearInterval(this.renewTimer)
    this.renewTimer = null
    if (claimId) {
      // La reserva vence a los 15 s: se renueva cada 5 s mientras dure.
      this.renewTimer = window.setInterval(() => {
        if (this.myClaimId) this.send({ type: 'renew', claimId: this.myClaimId })
      }, 5_000)
    }
  }

  // --- API pública ---

  /** Cursor: máximo 10 por segundo (100 ms) y nada si la pestaña está oculta. */
  sendCursor(cell: Cell) {
    if (document.hidden) return
    this.pendingCursor = cell
    const elapsed = Date.now() - this.lastCursorSent
    const flush = () => {
      this.cursorTimer = null
      if (!this.pendingCursor || document.hidden) return
      if (this.send({ type: 'cursor', r: this.pendingCursor.r, c: this.pendingCursor.c })) this.lastCursorSent = Date.now()
      this.pendingCursor = null
    }
    if (elapsed >= 100) flush()
    else if (this.cursorTimer === null) this.cursorTimer = window.setTimeout(flush, 100 - elapsed)
  }

  /** Reserva el grupo de esa celda. Si el WebSocket no está, se sigue sin reserva (UNAVAILABLE). */
  claim(cell: Cell): Promise<ClaimResult> {
    if (!this.isOpen) return Promise.resolve({ ok: false, reason: 'UNAVAILABLE' })
    const requestId = uuid()
    return new Promise<ClaimResult>((resolve) => {
      this.pendingClaims.set(requestId, resolve)
      this.send({ type: 'claim', requestId, r: cell.r, c: cell.c })
      window.setTimeout(() => {
        if (this.pendingClaims.delete(requestId)) resolve({ ok: false, reason: 'TIMEOUT' })
      }, 4_000)
    })
  }

  release() {
    if (this.myClaimId) this.send({ type: 'release', claimId: this.myClaimId })
    this.setMyClaim(null)
  }

  /** Celdas reservadas por OTROS usuarios: "r,c" → nombre. */
  othersClaimedCells(): Map<string, string> {
    const out = new Map<string, string>()
    for (const claim of this.claims.values()) {
      if (claim.userId === this.myUserId) continue
      for (const cell of claim.cells) out.set(`${cell.r},${cell.c}`, claim.displayName)
    }
    return out
  }

  dispose() {
    this.disposed = true
    this.release()
    this.stopTimers()
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    this.ws?.close(1000, 'salida de la grilla')
    this.ws = null
  }
}
