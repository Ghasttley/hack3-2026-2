import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { ErrorBox, PageTitle, Pagination, Spinner } from '../components/ui'
import { BadgeImage } from '../components/BadgeImage'
import { api, qs } from '../lib/api'
import { onEvent } from '../lib/events'
import { getRefiner, upsertRefiners, useRefinersVersion } from '../lib/refiners'
import type { Department, Page, Refiner } from '../lib/types'
import { useApiQuery } from '../lib/useApiQuery'
import { parseIntParam } from '../lib/util'

const SIZES = [10, 25, 50]

interface Q {
  page: number
  size: number
  departmentId: number | null
  q: string
}

function readQ(sp: URLSearchParams): Q {
  const size = parseIntParam(sp.get('size'), 10, 10, 50)
  const dep = sp.get('departmentId')
  return {
    page: parseIntParam(sp.get('page'), 0, 0, 100_000),
    size: SIZES.includes(size) ? size : 10,
    departmentId: dep && /^\d+$/.test(dep) && Number(dep) >= 1 ? Number(dep) : null,
    q: (sp.get('q') ?? '').slice(0, 60),
  }
}

function toParams(q: Q): Record<string, string> {
  const out: Record<string, string> = {}
  if (q.page) out.page = String(q.page)
  if (q.size !== 10) out.size = String(q.size)
  if (q.departmentId) out.departmentId = String(q.departmentId)
  if (q.q) out.q = q.q
  return out
}

/** Directorio paginado, filtro por departamento y búsqueda; todo en la URL. */
export default function RefinersPage() {
  const { can } = useAuth()
  const [sp, setSp] = useSearchParams()
  const query = readQ(sp)
  const canonical = new URLSearchParams(toParams(query)).toString()
  const [search, setSearch] = useState(query.q)
  useRefinersVersion() // re-render cuando llega refiner.updated

  useEffect(() => {
    if (canonical !== sp.toString()) setSp(new URLSearchParams(canonical), { replace: true })
  }, [canonical, sp, setSp])
  useEffect(() => {
    setSearch((cur) => (cur.trim() === query.q ? cur : query.q))
  }, [query.q])
  useEffect(() => {
    if (search.trim() === query.q) return
    const t = window.setTimeout(() => setSp(new URLSearchParams(toParams({ ...query, q: search.trim(), page: 0 })), { replace: true }), 350)
    return () => window.clearTimeout(t)
  }, [search, query, setSp])

  const departments = useApiQuery<Department[]>('departments', (signal) => api('/departments', { signal }))
  const list = useApiQuery<Page<Refiner>>(canonical, async (signal) => {
    const page = await api<Page<Refiner>>(
      `/refiners${qs({ page: query.page, size: query.size, departmentId: query.departmentId, q: query.q })}`,
      { signal },
    )
    upsertRefiners(page.content)
    return page
  })
  useEffect(() => onEvent('stream.reset', list.reload), [list.reload])

  return (
    <section>
      <PageTitle>Expedientes del personal</PageTitle>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="rq" className="label">
            Buscar
          </label>
          <input id="rq" type="search" className="input" maxLength={60} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div>
          <label htmlFor="dep" className="label">
            Departamento
          </label>
          <select
            id="dep"
            className="input"
            value={query.departmentId ?? ''}
            onChange={(e) => setSp(new URLSearchParams(toParams({ ...query, page: 0, departmentId: e.target.value ? Number(e.target.value) : null })))}
          >
            <option value="">Todos</option>
            {departments.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rsize" className="label">
            Por página
          </label>
          <select id="rsize" className="input" value={query.size} onChange={(e) => setSp(new URLSearchParams(toParams({ ...query, page: 0, size: Number(e.target.value) })))}>
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
      {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data && <Spinner />}
      {list.data && (
        <div aria-busy={list.loading}>
          {list.data.content.length === 0 && <p className="text-slate-300">No hay expedientes con esos filtros.</p>}
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.data.content.map((item) => {
              const r = getRefiner(item.id) ?? item
              return (
                <li key={r.id} className="flex gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3">
                  <BadgeImage badge={r.badge} name={r.fullName} size={72} />
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">
                      <Link to={`/refiners/${r.id}`} className="text-sky-300 underline">
                        {r.fullName}
                      </Link>
                    </h2>
                    <p className="truncate text-sm text-slate-300">{r.title}</p>
                    <p className="text-xs text-slate-400">
                      {r.department.name} · ext. {r.extension}
                    </p>
                    {can('refiners:write') && (
                      <p className="mt-1 flex gap-3 text-xs">
                        <Link to={`/refiners/${r.id}/edit`} className="text-sky-300 underline">
                          Editar
                        </Link>
                        {can('media:upload') && (
                          <Link to={`/refiners/${r.id}/badge`} className="text-sky-300 underline">
                            Fotocheck
                          </Link>
                        )}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          <Pagination page={query.page} totalPages={list.data.totalPages} onPage={(page) => setSp(new URLSearchParams(toParams({ ...query, page })))} />
        </div>
      )}
    </section>
  )
}
