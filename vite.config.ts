import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      proxy: {
        '/api-proxy': {
          target: 'https://api-comexstat.mdic.gov.br',
          changeOrigin: true,
          secure: false, // Permite conexões mesmo se o certificado falhar
          rewrite: (path) => path.replace(/^\/api-proxy/, '')
        }
      }
    },
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});