import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Change base to match your GitHub Pages repo name, e.g. '/my-repo-name/'
export default defineConfig({
  plugins: [react()],
  base: '/Master_Tool_Data/',
})
