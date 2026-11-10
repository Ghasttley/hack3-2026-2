import { ApiError, isApiError } from './errors'
import { rawRequest, type RawResponse } from './http'
import { endSession, getAccessToken, hasStoredSession, refreshAccessToken, SessionEndedError } from './session'
import { backoff, sleep } from './util'

export interface ApiOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
  /** Reintentos ante 503 / 429 / fallo de red (respetando Retry-After). Por defecto: 3 en GET, 0 en el resto. */
  retries?: number
}

/**
 * Request autenticada.
 * - Solo `TOKEN_EXPIRED` dispara un refresh; la request se reintenta UNA sola vez con el token nuevo.
 * - `SESSION_REVOKED` / `TOKEN_INVALID` cierran la sesión (todas las pestañas vuelven al login).
 * - 503 y 429 se reintentan con espera creciente o Retry-After (solo si `retries` > 0).
 */
export async function apiRequest<T>(path: string, opts: ApiOptions = {}): Promise<RawResponse<T>> {
  const method = opts.method ?? 'GET'
  const maxRetries = opts.retries ?? (method === 'GET' ? 3 : 0)
  let refreshed = false
  let attempt = 0

  let token = getAccessToken()
  if (!token && hasStoredSession()) token = await refreshAccessToken(null)

  for (;;) {
    try {
      return await rawRequest<T>(path, { ...opts, method, token })
    } catch (e) {
      if (!isApiError(e)) throw e
      if (e.status === 401) {
        if (e.code === 'TOKEN_EXPIRED' && !refreshed) {
          refreshed = true
          token = await refreshAccessToken(token)
          continue
        }
        if (e.code === 'SESSION_REVOKED' || e.code === 'TOKEN_INVALID') {
          endSession(e.code)
          throw new SessionEndedError(e.code)
        }
        throw e
      }
      const transient = e.status === 503 || e.status === 429 || e.isNetwork
      if (transient && attempt < maxRetries) {
        await sleep(e.retryAfterMs ?? backoff(attempt), opts.signal)
        attempt++
        continue
      }
      throw e
    }
  }
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  return (await apiRequest<T>(path, opts)).data
}

export function qs(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export { ApiError }
