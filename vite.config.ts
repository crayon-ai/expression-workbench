import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import type { Plugin } from "vite"

// onnxruntime-web 的打包版会把 ort-wasm-simd-threaded.wasm 当静态文件带出来。
// 我们不从自己的服务器发这个 14 MB 的文件：运行时从免费 CDN 下载并缓存在用户浏览器里（src/asr/assets.ts）。
function dropOrtWasm(): Plugin {
  return {
    name: "drop-ort-wasm",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) if (name.endsWith(".wasm")) delete bundle[name]
    },
  }
}

export default defineConfig({
  plugins: [react(), dropOrtWasm()],
  worker: { format: "es" },
  base: "./",
  server: {
    host: "0.0.0.0",
    port: 4731,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 4731,
    strictPort: true,
  },
})
