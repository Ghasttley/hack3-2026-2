import { config } from '../config'
import { ApiError, isRecord } from './errors'

export interface RawRequest {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
  token?: string | null
}

export interface RawResponse<T> {
  data: T
  status: number
  headers: Headers
}

/**
 * Una sola request HTTP a la API, sin lógica de sesión.
 * Siempre agrega X-Lumon-Build (inyectado en build: "dev" en local, SHA en producción).
 * Lanza ApiError con el `error` del cuerpo; status 0 = fallo de red.
 */
export async function rawRequest<T>(path: string, req: RawRequest = {}): Promise<RawResponse<T>> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Lumon-Build': config.buildSha,
    ...req.headers,
  }
  if (req.token) headers.Authorization = `Bearer ${req.token}`
  let body: string | undefined
  if (req.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(req.body)
  }

  let res: Response
  try {
    res = await fetch(`${config.apiBaseUrl}${path}`, {
      method: req.method ?? 'GET',
      headers,
      body,
      signal: req.signal,
      cache: 'no-store',
      credentials: 'omit',
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, 'NETWORK_ERROR', 'Fallo de red', null, null)
  }

  const text = res.status === 204 ? '' : await res.text().catch(() => '')
  let parsed: unknown = undefined
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      parsed = text
    }
  }

  if (!res.ok) {
    const code = isRecord(parsed) && typeof parsed.error === 'string' ? parsed.error : `HTTP_${res.status}`
    const message =
      isRecord(parsed) && typeof parsed.message === 'string' ? parsed.message : `Error ${res.status}`
    const details = isRecord(parsed) ? (parsed.details ?? null) : null
    throw new ApiError(res.status, code, message, details, res.headers)
  }

  return { data: parsed as T, status: res.status, headers: res.headers }
}
