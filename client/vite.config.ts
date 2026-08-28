import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 开发时把 /api 和 /media 请求代理到后端
      '/api': 'http://localhost:3001',
      '/media': 'http://localhost:3001',
    },
  },
});
