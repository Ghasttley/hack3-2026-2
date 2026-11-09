import { useCallback, useEffect, useRef, useState } from 'react'
import { isAbortError } from './util'

export interface QueryState<T> {
  data: T | null
  error: unknown
  loading: boolean
  reload: () => void
}

/**
 * Carga datos con fetch y garantiza que una respuesta vieja nunca pise a una nueva:
 * cada cambio de `key` aborta la request anterior y descarta su resultado.
 * (No se usa React Query / SWR: están prohibidos.)
 */
export function useApiQuery<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
): QueryState<T> {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean; key: string | null }>({
    data: null,
    error: null,
    loading: key !== null,
    key: null,
  })
  const [nonce, setNonce] = useState(0)
  const seq = useRef(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    if (key === null) return
    const id = ++seq.current
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))
    fetcherRef
      .current(controller.signal)
      .then((data) => {
        if (id === seq.current) setState({ data, error: null, loading: false, key })
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || id !== seq.current) return
        setState((s) => ({ ...s, error, loading: false }))
      })
    return () => controller.abort()
  }, [key, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data: state.data, error: state.error, loading: state.loading, reload }
}
