import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from "vite-plugin-cesium";

// https://vite.dev/config/
export default defineConfig({
    server: {
    host: true, 
  },
  plugins: [react(), cesium()],
})
