
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Expose ke semua interface supaya bisa diakses dari HP di jaringan
    // yang sama, bukan hanya localhost.
    host: true,
  },
})
