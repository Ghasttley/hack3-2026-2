export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Abortado', 'AbortError'))
      return
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      window.clearTimeout(timer)
      reject(new DOMException('Abortado', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Espera creciente con jitter: 0.5s, 1s, 2s, 4s… hasta `max`. */
export function backoff(attempt: number, baseMs = 500, maxMs = 30_000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt)
  return Math.round(exp / 2 + Math.random() * (exp / 2))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function parseIntParam(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || !/^\d+$/.test(value)) return fallback
  const n = Number(value)
  return n >= min && n <= max ? n : fallback
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-PE')
}

export function percent(value: number): string {
  return `${Math.round(clamp(value, 0, 1) * 100)} %`
}

export function uuid(): string {
  return crypto.randomUUID()
}

export function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
