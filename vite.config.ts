import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],

  // 用相对路径而不是 '/'：这样构建产物能部署到任意子路径
  // （GitHub Pages 的项目页就是 https://user.github.io/repo/，绝对路径会 404）
  base: './',

  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },

  server: {
    // 允许手机在同一个局域网里访问开发服务器，方便真机试
    host: true,
  },
})
