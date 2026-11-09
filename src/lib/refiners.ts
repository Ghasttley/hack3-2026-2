import { useSyncExternalStore } from 'react'
import { onEvent } from './events'
import { isRecord } from './errors'
import type { Refiner } from './types'

/**
 * Caché de expedientes con control de versión.
 * Regla del Tablero: una versión más vieja nunca pisa a una más nueva,
 * llegue por el stream (refiner.updated) o por una respuesta HTTP.
 */
const refiners = new Map<number, Refiner>()
const listeners = new Set<() => void>()
let version = 0

function notify() {
  version++
  listeners.forEach((l) => l())
}

/** Inserta si es más nuevo. Devuelve el expediente vigente (el guardado o el recibido). */
export function upsertRefiner(r: Refiner): Refiner {
  const current = refiners.get(r.id)
  if (current && current.version > r.version) return current
  if (current && current.version === r.version && current.updatedAt === r.updatedAt) return current
  refiners.set(r.id, r)
  notify()
  return r
}

export function upsertRefiners(list: Refiner[]): void {
  for (const r of list) {
    const current = refiners.get(r.id)
    if (!current || current.version < r.version) refiners.set(r.id, r)
  }
  notify()
}

export function getRefiner(id: number): Refiner | undefined {
  return refiners.get(id)
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useRefiner(id: number): Refiner | undefined {
  return useSyncExternalStore(subscribe, () => refiners.get(id))
}

/** Re-renderiza cuando cambia cualquier expediente (para listas). */
export function useRefinersVersion(): number {
  return useSyncExternalStore(subscribe, () => version)
}

function isRefiner(v: unknown): v is Refiner {
  return isRecord(v) && typeof v.id === 'number' && typeof v.version === 'number' && typeof v.fullName === 'string'
}

onEvent('refiner.updated', (ev) => {
  if (isRecord(ev.data) && isRefiner(ev.data.refiner)) upsertRefiner(ev.data.refiner)
})
