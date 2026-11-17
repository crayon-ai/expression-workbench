// 把前端构建产物（dist/）内嵌进 Worker 脚本，打成单个 ES 模块：worker-build/worker.js
// 用法：npm run build && node worker/build.mjs [输出路径]
import { build } from "esbuild"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, extname } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const dist = join(root, "dist")
const out = process.argv[2] ?? join(root, "worker-build", "worker.js")
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const assets = {}
for (const file of walk(dist)) {
  const type = TYPES[extname(file)]
  if (!type) continue
  assets["/" + relative(dist, file).split("\\").join("/")] = { type, b64: readFileSync(file).toString("base64") }
}
if (!assets["/index.html"]) throw new Error("dist/index.html 不存在，先 npm run build")

await build({
  entryPoints: [join(root, "worker", "src", "index.ts")],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: out,
  logLevel: "warning",
  plugins: [
    {
      name: "virtual-assets",
      setup(b) {
        b.onResolve({ filter: /^virtual:assets$/ }, () => ({ path: "assets", namespace: "virtual" }))
        b.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({
          contents: `export default ${JSON.stringify(assets)}`,
          loader: "js",
        }))
      },
    },
  ],
})
const size = statSync(out).size
console.log(`worker: ${out} ${(size / 1024).toFixed(0)} KB, ${Object.keys(assets).length} 个静态文件`)
