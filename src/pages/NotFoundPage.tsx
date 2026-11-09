import { Link } from 'react-router'

export default function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-4 text-center text-slate-100">
      <div>
        <p className="font-mono text-6xl text-sky-300">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Esta sala no existe</h1>
        <p className="mt-2 text-slate-300">La ruta que buscas no está en el piso separado.</p>
        <Link to="/files" className="btn-primary mt-6 inline-block">
          Volver a los archivos
        </Link>
      </div>
    </main>
  )
}
