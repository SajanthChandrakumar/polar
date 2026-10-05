import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'jsdom', setupFiles: './src/test-setup.ts' },
  server: { host: '127.0.0.1', proxy: { '/api': 'http://localhost:5000', '/oauth2_callback': 'http://localhost:5000' } },
  preview: { host: '127.0.0.1' },
});
