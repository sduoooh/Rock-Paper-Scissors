import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // 相对路径：GitHub Pages 部署在子路径 /Rock-Paper-Scissors/ 下，
  // 用 ./ 确保 index.html 引用的 assets 能正确解析为项目子路径而非域名根
  base: './',
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5173
  }
})
