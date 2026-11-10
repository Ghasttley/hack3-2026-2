export function Splash({ message }: { message: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 text-slate-200">
      <div role="status" className="flex flex-col items-center gap-3">
        <span className="spinner" aria-hidden="true" />
        <p>{message}</p>
      </div>
    </main>
  )
}
