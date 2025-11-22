import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          charts: ['chart.js', 'react-chartjs-2'],
          motion: ['framer-motion'],
          pdf: ['jspdf'],
          utils: ['html2canvas', 'dompurify'],
          icons: ['react-icons'],
        },
      },
    },
    sourcemap: false,
  },
})
