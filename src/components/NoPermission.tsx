import { Link } from 'react-router'

export function NoPermission({ missing }: { missing: string[] }) {
  return (
    <section className="mx-auto max-w-lg py-16 text-center">
      <h1 className="mb-3 text-2xl font-semibold">Sin permiso</h1>
      <p className="text-slate-300">
        Tu rol en este workspace no incluye{' '}
        {missing.map((m, i) => (
          <span key={m}>
            {i > 0 && ', '}
            <code className="rounded bg-slate-800 px-1">{m}</code>
          </span>
        ))}
        .
      </p>
      <Link to="/files" className="btn-primary mt-6 inline-block">
        Volver al inicio
      </Link>
    </section>
  )
}
