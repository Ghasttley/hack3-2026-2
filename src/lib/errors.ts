export interface ApiErrorBody {
  error: string
  message: string
  details: unknown
  timestamp?: string
  path?: string
  requestId?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown
  readonly retryAfterMs: number | null
  readonly headers: Headers | null

  constructor(status: number, code: string, message: string, details: unknown, headers: Headers | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.headers = headers
    const ra = headers?.get('Retry-After')
    const n = ra ? Number(ra) : NaN
    this.retryAfterMs = Number.isFinite(n) && n >= 0 ? n * 1000 : null
  }

  get isNetwork(): boolean {
    return this.status === 0
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Lee un campo de `details` de forma segura. */
export function detail(e: ApiError, key: string): unknown {
  return isRecord(e.details) ? e.details[key] : undefined
}

/** Errores de validación del backend: `details.fields` = { campo: mensaje }. */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!isApiError(e)) return {}
  const fields = detail(e, 'fields')
  if (!isRecord(fields)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields)) if (typeof v === 'string') out[k] = v
  return out
}

const FRIENDLY: Record<string, string> = {
  NETWORK_ERROR: 'No se pudo contactar a Lumon. Revisa tu conexión e inténtalo de nuevo.',
  SERVICE_UNAVAILABLE: 'Lumon no está disponible en este momento. Inténtalo de nuevo en unos segundos.',
  RATE_LIMITED: 'Demasiadas solicitudes. Espera unos segundos.',
  FORBIDDEN: 'No tienes permiso para esta acción.',
  CLEARANCE_REQUIRED: 'El Piso de Pruebas todavía no está abierto para tu equipo.',
  NOT_FOUND: 'No se encontró el recurso.',
  STORAGE_NOT_VERIFIED: 'El storage de imágenes aún no está verificado (ver /estado).',
}

export function errorMessage(e: unknown): string {
  if (isApiError(e)) return FRIENDLY[e.code] ?? e.message ?? `Error ${e.status}`
  if (e instanceof Error) return e.message
  return 'Ocurrió un error inesperado.'
}
