import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ErrorBox, PageTitle, Pagination, Spinner } from '../components/ui'
import { api, qs } from '../lib/api'
import { onEvent } from '../lib/events'
import type { DataFile, Page } from '../lib/types'
import { useApiQuery } from '../lib/useApiQuery'
import { formatDate, parseIntParam, percent } from '../lib/util'

const SIZES = [10, 25, 50] as const
const STATUSES = ['', 'ACTIVE', 'COMPLETE'] as const
const SORTS = [
  { value: 'updatedAt,desc', label: 'Actualizados recientemente' },
  { value: 'progress,desc', label: 'Mayor progreso' },
  { value: 'name,asc', label: 'Nombre (A–Z)' },
] as const

interface FileQuery {
  page: number
  size: number
  status: string
  q: string
  sort: string
}

/** Lee y valida la URL: una URL inválida cae a valores por defecto en vez de romper la vista. */
function readQuery(sp: URLSearchParams): FileQuery {
  const size = parseIntParam(sp.get('size'), 10, 10, 50)
  const status = sp.get('status') ?? ''
  const sort = sp.get('sort') ?? 'updatedAt,desc'
  return {
    page: parseIntParam(sp.get('page'), 0, 0, 100_000),
    size: (SIZES as readonly number[]).includes(size) ? size : 10,
    status: (STATUSES as readonly string[]).includes(status) ? status : '',
    q: (sp.get('q') ?? '').slice(0, 60),
    sort: SORTS.some((s) => s.value === sort) ? sort : 'updatedAt,desc',
  }
}

function toParams(q: FileQuery): Record<string, string> {
  const out: Record<string, string> = {}
  if (q.page) out.page = String(q.page)
  if (q.size !== 10) out.size = String(q.size)
  if (q.status) out.status = q.status
  if (q.q) out.q = q.q
  if (q.sort !== 'updatedAt,desc') out.sort = q.sort
  return out
}

export default function FilesPage() {
  const [sp, setSp] = useSearchParams()
  const query = readQuery(sp)
  const canonical = new URLSearchParams(toParams(query)).toString()
  const [search, setSearch] = useState(query.q)

  // Normaliza URLs inválidas sin agregar una entrada al historial.
  useEffect(() => {
    if (canonical !== sp.toString()) setSp(new URLSearchParams(canonical), { replace: true })
  }, [canonical, sp, setSp])

  // Atrás/adelante: el input refleja la URL (sin pisar lo que se está escribiendo).
  useEffect(() => {
    setSearch((current) => (current.trim() === query.q ? current : query.q))
  }, [query.q])

  // Búsqueda sin una request por tecla: debounce de 350 ms.
  useEffect(() => {
    if (search.trim() === query.q) return
    const t = window.setTimeout(() => {
      setSp(new URLSearchParams(toParams({ ...query, q: search.trim(), page: 0 })), { replace: true })
    }, 350)
    return () => window.clearTimeout(t)
  }, [search, query, setSp])

  const update = (patch: Partial<FileQuery>) => setSp(new URLSearchParams(toParams({ ...query, page: 0, ...patch })))

  const { data, error, loading, reload } = useApiQuery<Page<DataFile>>(canonical, (signal) =>
    api(
      `/files${qs({ page: query.page, size: query.size, status: query.status, q: query.q, sort: query.sort })}`,
      { signal },
    ),
  )

  useEffect(() => onEvent('stream.reset', reload), [reload])
  useEffect(() => onEvent('file.completed', reload), [reload])

  return (
    <section>
      <PageTitle>Archivos de datos</PageTitle>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="q" className="label">
            Buscar
          </label>
          <input id="q" type="search" className="input" value={search} maxLength={60} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div>
          <label htmlFor="status" className="label">
            Estado
          </label>
          <select id="status" className="input" value={query.status} onChange={(e) => update({ status: e.target.value })}>
            <option value="">Todos</option>
            <option value="ACTIVE">Activos</option>
            <option value="COMPLETE">Completados</option>
          </select>
        </div>
        <div>
          <label htmlFor="sort" className="label">
            Orden
          </label>
          <select id="sort" className="input" value={query.sort} onChange={(e) => update({ sort: e.target.value })}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="size" className="label">
            Por página
          </label>
          <select id="size" className="input" value={query.size} onChange={(e) => update({ size: Number(e.target.value) })}>
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {loading && !data && <Spinner />}
      {data && (
        <div aria-busy={loading} className={loading ? 'opacity-60' : ''}>
          {data.content.length === 0 ? (
            <p className="text-slate-300">No hay archivos con esos filtros.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Archivos de datos</caption>
                <thead className="border-b border-slate-700 text-slate-300">
                  <tr>
                    <th scope="col" className="py-2 pr-3">
                      Nombre
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Estado
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Progreso
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Grupos
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Errores
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Tamaño
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Actualizado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.content.map((f) => (
                    <tr key={f.id} className="border-b border-slate-800">
                      <td className="py-2 pr-3">
                        <Link to={`/files/${f.id}/refine`} className="text-sky-300 underline">
                          {f.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">{f.status === 'COMPLETE' ? 'Completado' : 'Activo'}</td>
                      <td className="py-2 pr-3">{percent(f.progress.overall)}</td>
                      <td className="py-2 pr-3">
                        {f.refinedGroups}/{f.totalGroups}
                      </td>
                      <td className="py-2 pr-3">{f.mistakes}</td>
                      <td className="py-2 pr-3">
                        {f.rows}×{f.cols}
                      </td>
                      <td className="py-2 pr-3">{formatDate(f.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            page={query.page}
            totalPages={data.totalPages}
            onPage={(page) => setSp(new URLSearchParams(toParams({ ...query, page })))}
          />
        </div>
      )}
    </section>
  )
}
