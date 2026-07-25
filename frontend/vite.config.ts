import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Lets a single tunnel (e.g. `ngrok http 5173`) reach both the app and
    // the API: the browser calls same-origin `/api/...`, and Vite forwards
    // it to the backend dev server. See VITE_API_BASE_URL in api.ts for the
    // override when frontend and backend are hosted separately.
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
})
