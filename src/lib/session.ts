import { ApiError, isApiError } from './errors'
import { rawRequest } from './http'
import type { TokenPair } from './types'
import { backoff, sleep } from './util'

/**
 * Sesión.
 * - El access token vive SOLO en memoria (esta variable). Nunca en storage ni cookies.
 * - El refresh token (de un solo uso) se persiste en localStorage para restaurar la sesión.
 * - Refresh coordinado:
 *     · dentro de la pestaña, todas las requests que reciben TOKEN_EXPIRED comparten una sola promesa;
 *     · entre pestañas, el refresh corre dentro de un Web Lock exclusivo y siempre lee el refresh token
 *       MÁS RECIENTE de localStorage, así ninguna pestaña presenta uno ya usado (REFRESH_REUSED).
 * - La pestaña que refresca difunde el access token nuevo por BroadcastChannel para que las demás
 *   no tengan que refrescar otra vez.
 * - Logout / revocación se difunden a todas las pestañas (BroadcastChannel + evento `storage`).
 */

const RT_KEY = 'lumon.refreshToken'
const CHANNEL = 'lumon-session'

export type EndReason = 'LOGOUT' | 'REFRESH_REUSED' | 'SESSION_REVOKED' | 'REFRESH_INVALID' | 'TOKEN_INVALID'

type SessionMessage =
  | { type: 'access'; accessToken: string }
  | { type: 'ended'; reason: EndReason }
  | { type: 'login' }

let accessToken: string | null = null
let refreshing: Promise<string> | null = null
const endListeners = new Set<(reason: EndReason) => void>()
const loginListeners = new Set<() => void>()

const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null

channel?.addEventListener('message', (ev: MessageEvent<SessionMessage>) => {
  const msg = ev.data
  if (msg.type === 'access') accessToken = msg.accessToken
  else if (msg.type === 'ended') localEnd(msg.reason)
  else if (msg.type === 'login') loginListeners.forEach((l) => l())
})

// Respaldo: si otra pestaña borra el refresh token, esta sesión terminó.
window.addEventListener('storage', (ev) => {
  if (ev.key === RT_KEY && ev.newValue === null && accessToken !== null) localEnd('LOGOUT')
})

function readRefreshToken(): string | null {
  try {
    return localStorage.getItem(RT_KEY)
  } catch {
    return null
  }
}

function writeRefreshToken(rt: string | null): void {
  try {
    if (rt) localStorage.setItem(RT_KEY, rt)
    else localStorage.removeItem(RT_KEY)
  } catch {
    // storage bloqueado: la sesión dura lo que dure la pestaña
  }
}

function localEnd(reason: EndReason): void {
  accessToken = null
  refreshing = null
  endListeners.forEach((l) => l(reason))
}

export function getAccessToken(): string | null {
  return accessToken
}

export function hasStoredSession(): boolean {
  return readRefreshToken() !== null
}

export function startSession(pair: TokenPair): void {
  accessToken = pair.accessToken
  writeRefreshToken(pair.refreshToken)
  channel?.postMessage({ type: 'access', accessToken: pair.accessToken } satisfies SessionMessage)
  channel?.postMessage({ type: 'login' } satisfies SessionMessage)
}

/** Termina la sesión en esta pestaña y en todas las demás. */
export function endSession(reason: EndReason): void {
  writeRefreshToken(null)
  channel?.postMessage({ type: 'ended', reason } satisfies SessionMessage)
  localEnd(reason)
}

export function onSessionEnded(listener: (reason: EndReason) => void): () => void {
  endListeners.add(listener)
  return () => endListeners.delete(listener)
}

export function onLoginElsewhere(listener: () => void): () => void {
  loginListeners.add(listener)
  return () => loginListeners.delete(listener)
}

export class SessionEndedError extends Error {
  readonly reason: EndReason
  constructor(reason: EndReason) {
    super('La sesión terminó')
    this.reason = reason
  }
}

const FATAL_REFRESH: Record<string, EndReason> = {
  REFRESH_REUSED: 'REFRESH_REUSED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  REFRESH_INVALID: 'REFRESH_INVALID',
}

/**
 * Devuelve un access token nuevo. Si ya hay un refresh en curso en esta pestaña, se reutiliza.
 * `staleToken` es el token que falló: si al entrar al lock ya tenemos otro, alguien más refrescó.
 */
export function refreshAccessToken(staleToken: string | null = accessToken): Promise<string> {
  if (refreshing) return refreshing
  const run = async (): Promise<string> => {
    if (accessToken && accessToken !== staleToken) return accessToken
    for (let attempt = 0; ; attempt++) {
      const rt = readRefreshToken()
      if (!rt) {
        localEnd('REFRESH_INVALID')
        throw new SessionEndedError('REFRESH_INVALID')
      }
      try {
        const { data } = await rawRequest<TokenPair>('/auth/refresh', {
          method: 'POST',
          body: { refreshToken: rt },
        })
        accessToken = data.accessToken
        writeRefreshToken(data.refreshToken)
        channel?.postMessage({ type: 'access', accessToken: data.accessToken } satisfies SessionMessage)
        return data.accessToken
      } catch (e) {
        if (isApiError(e)) {
          const fatal = FATAL_REFRESH[e.code]
          if (fatal) {
            endSession(fatal)
            throw new SessionEndedError(fatal)
          }
          // 503 / 429: el servidor declaró que no procesó la request → mismo refresh token, con espera.
          if ((e.status === 503 || e.status === 429) && attempt < 4) {
            await sleep(e.retryAfterMs ?? backoff(attempt))
            continue
          }
        }
        throw e
      }
    }
  }
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  refreshing = (locks ? locks.request('lumon-refresh', run) : run()).finally(() => {
    refreshing = null
  })
  return refreshing
}

/** Cierra la sesión en el servidor (revoca el refresh token) y en todas las pestañas. */
export async function logout(): Promise<void> {
  const rt = readRefreshToken()
  try {
    if (rt) await rawRequest<void>('/auth/logout', { method: 'POST', body: { refreshToken: rt } })
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
  } finally {
    endSession('LOGOUT')
  }
}
