import { execSync } from 'node:child_process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * SHA corto (7 caracteres) del commit con el que se construye la app.
 * - `vite` (dev): siempre "dev".
 * - `vite build`: lo toma de la variable que expone el hosting y, si no existe, de git.
 * Nunca se escribe a mano: se inyecta en tiempo de build como constante global.
 */
function resolveBuildSha(command: 'build' | 'serve'): string {
  if (command === 'serve') return 'dev'
  const fromEnv =
    process.env.VERCEL_GIT_COMMIT_SHA ?? // Vercel
    process.env.CF_PAGES_COMMIT_SHA ?? // Cloudflare Pages
    process.env.COMMIT_REF ?? // Netlify
    process.env.GITHUB_SHA
  if (fromEnv && /^[0-9a-f]{7,40}$/i.test(fromEnv)) return fromEnv.slice(0, 7).toLowerCase()
  try {
    const sha = execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    if (/^[0-9a-f]{7}$/.test(sha)) return sha
  } catch {
    // sin git disponible
  }
  return 'dev'
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  define: {
    __BUILD_SHA__: JSON.stringify(resolveBuildSha(command)),
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
}))
