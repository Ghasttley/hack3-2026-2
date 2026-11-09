import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  resetKey: string
}

interface State {
  error: Error | null
}

/** Un error de render en una ruta no deja la app en blanco: muestra un error con opción de volver. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Error de render', error, info.componentStack)
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <section role="alert" className="mx-auto max-w-lg py-16 text-center">
        <h1 className="mb-3 text-2xl font-semibold">Algo falló en esta vista</h1>
        <p className="mb-6 text-slate-300">{this.state.error.message}</p>
        <div className="flex justify-center gap-3">
          <button type="button" className="btn-secondary" onClick={() => window.history.back()}>
            Volver
          </button>
          <button type="button" className="btn-primary" onClick={() => this.setState({ error: null })}>
            Reintentar
          </button>
          <a href="/files" className="btn-secondary">
            Ir al inicio
          </a>
        </div>
      </section>
    )
  }
}
