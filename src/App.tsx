import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { AuthProvider } from './auth/AuthContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { HealthGate } from './components/HealthGate'
import { Layout } from './components/Layout'
import { PublicOnly, RequireAuth, RequirePermission } from './components/RouteGuards'
import { Splash } from './components/Splash'
import type { Permission } from './lib/types'

// Code splitting: cada página es un chunk aparte. La grilla y el cliente del storage
// no están en el bundle inicial.
const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
const FilesPage = lazy(() => import('./pages/FilesPage'))
const RefinePage = lazy(() => import('./features/refine/RefinePage'))
const EstadoPage = lazy(() => import('./pages/EstadoPage'))
const RefinersPage = lazy(() => import('./pages/RefinersPage'))
const RefinerDetailPage = lazy(() => import('./pages/RefinerDetailPage'))
const RefinerEditPage = lazy(() => import('./pages/RefinerEditPage'))
const BadgePage = lazy(() => import('./features/media/BadgePage'))
const IncidentsPage = lazy(() => import('./pages/IncidentsPage'))
const IncidentNewPage = lazy(() => import('./features/media/IncidentNewPage'))

function guard(permission: Permission | Permission[], el: ReactNode) {
  return <RequirePermission permission={permission}>{el}</RequirePermission>
}

function Public({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary resetKey="public">
      <Suspense fallback={<Splash message="Cargando…" />}>
        <PublicOnly>{children}</PublicOnly>
      </Suspense>
    </ErrorBoundary>
  )
}

const router = createBrowserRouter([
  { path: '/login', element: <Public><LoginPage /></Public> },
  { path: '/register', element: <Public><RegisterPage /></Public> },
  {
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [
      { path: '/', element: <Navigate to="/files" replace /> },
      { path: '/estado', element: <EstadoPage /> },
      { path: '/files', element: guard('files:read', <FilesPage />) },
      { path: '/files/:id/refine', element: guard('files:read', <RefinePage />) },
      { path: '/refiners', element: guard('refiners:read', <RefinersPage />) },
      { path: '/refiners/:id', element: guard('refiners:read', <RefinerDetailPage />) },
      { path: '/refiners/:id/edit', element: guard(['refiners:read', 'refiners:write'], <RefinerEditPage />) },
      { path: '/refiners/:id/badge', element: guard(['refiners:read', 'refiners:write', 'media:upload'], <BadgePage />) },
      { path: '/incidents', element: guard('incidents:read', <IncidentsPage />) },
      { path: '/incidents/new', element: guard(['incidents:create', 'media:upload'], <IncidentNewPage />) },
    ],
  },
  {
    path: '*',
    element: (
      <Suspense fallback={<Splash message="Cargando…" />}>
        <NotFoundPage />
      </Suspense>
    ),
  },
])

export default function App() {
  return (
    <HealthGate>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </HealthGate>
  )
}
