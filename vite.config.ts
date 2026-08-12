import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const frameProtectionHeaders = {
  'Content-Security-Policy': "frame-ancestors 'none'",
}

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'graph-engine', test: /node_modules[\\/](@xyflow|d3-)/, priority: 3 },
            { name: 'react-runtime', test: /node_modules[\\/](react|react-dom|scheduler)/, priority: 2 },
          ],
        },
      },
    },
  },
  server: {
    port: 4173,
    strictPort: true,
    headers: frameProtectionHeaders,
  },
  preview: { headers: frameProtectionHeaders },
})
