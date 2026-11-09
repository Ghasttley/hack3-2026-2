import { onEvent } from './events'
import { isRecord } from './errors'
import { createStore } from './store'

export interface Contingency {
  id: number
  userId: number
  message: string
  createdAt: string
}

/** Contingencias activas dirigidas al usuario actual (llegan a todas las pestañas por el stream). */
export const contingencies = createStore<Contingency[]>([])

let currentUserId: number | null = null
export function setContingencyUser(id: number | null): void {
  currentUserId = id
  if (id === null) contingencies.set([])
}

export function resolveContingency(id: number): void {
  contingencies.set((list) => list.filter((c) => c.id !== id))
}

const ackChannel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lumon-contingency') : null
ackChannel?.addEventListener('message', (ev: MessageEvent<{ acked: number }>) => resolveContingency(ev.data.acked))

export function broadcastAck(id: number): void {
  resolveContingency(id)
  ackChannel?.postMessage({ acked: id })
}

onEvent('contingency.activated', (ev) => {
  const d = ev.data
  if (!isRecord(d) || typeof d.id !== 'number' || typeof d.userId !== 'number' || d.userId !== currentUserId) return
  const item: Contingency = {
    id: d.id,
    userId: d.userId,
    message: typeof d.message === 'string' ? d.message : 'Contingencia de horas extra activada.',
    createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date().toISOString(),
  }
  contingencies.set((list) => (list.some((c) => c.id === item.id) ? list : [...list, item]))
})

onEvent('contingency.resolved', (ev) => {
  if (isRecord(ev.data) && typeof ev.data.id === 'number') resolveContingency(ev.data.id)
})
