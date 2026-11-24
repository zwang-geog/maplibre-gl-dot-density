import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Project GitHub Pages live at /maplibre-gl-dot-density/
  base: process.env.GITHUB_PAGES === '1' ? '/maplibre-gl-dot-density/' : '/',
})
