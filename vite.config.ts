import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const mcpServerUrl = env.VITE_MCP_SERVER_URL

  if (!mcpServerUrl) {
    console.warn('⚠️  VITE_MCP_SERVER_URL is not set in .env — MCP proxy will not work')
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      proxy: mcpServerUrl ? {
        '/api/mcp': {
          target: mcpServerUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/mcp/, '/mcp'),
          secure: true,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('Proxy error:', err);
            });
            proxy.on('proxyReq', (_proxyReq, req) => {
              console.log('Sending Request to the Target:', req.method, req.url);
            });
            proxy.on('proxyRes', (proxyRes, req) => {
              console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
              // Add CORS headers to resolve connectivity issues
              proxyRes.headers['access-control-allow-origin'] = '*';
              proxyRes.headers['access-control-allow-methods'] = 'GET,PUT,POST,DELETE,OPTIONS';
              proxyRes.headers['access-control-allow-headers'] = 'Content-Type, Authorization, Content-Length, X-Requested-With';
            });
          }
        }
      } : undefined
    },
    build: {
      outDir: 'dist',
      sourcemap: true
    }
  }
})
