import { apiRequest } from './api'
import { upsertRefiner } from './refiners'
import type { Refiner, RefinerPatch } from './types'

export interface RefinerWithEtag {
  refiner: Refiner
  etag: string
}

function etagOf(headers: Headers, r: Refiner): string {
  return headers.get('ETag') ?? `"${r.version}"`
}

/** GET /refiners/{id}: devuelve el expediente y su ETag (Regla de Milchick). */
export async function fetchRefiner(id: number, signal?: AbortSignal): Promise<RefinerWithEtag> {
  const { data, headers } = await apiRequest<Refiner>(`/refiners/${id}`, { signal })
  const current = upsertRefiner(data)
  return { refiner: current, etag: current === data ? etagOf(headers, data) : `"${current.version}"` }
}

/** PATCH con If-Match exacto (nunca "*"). 412 → el llamador decide; nunca se sobrescribe en silencio. */
export async function patchRefiner(id: number, etag: string, patch: RefinerPatch): Promise<RefinerWithEtag> {
  const { data, headers } = await apiRequest<Refiner>(`/refiners/${id}`, {
    method: 'PATCH',
    body: patch,
    headers: { 'If-Match': etag },
    retries: 0,
  })
  upsertRefiner(data)
  return { refiner: data, etag: etagOf(headers, data) }
}
