/**
 * 识别要用的两个文件：onnxruntime-web 的 wasm 运行时、中文识别模型。
 * 都是免费公开的地址，第一次下载后按 sha256 校验，存进 Cache Storage，之后不再下载。
 * 排在前面的地址先试；失败（网络、CORS、校验不过）再换下一个。
 */
export type Asset = {
  key: string
  label: string
  bytes: number
  sha256: string
  urls: string[]
}

export const ORT_VERSION = "1.31.1"

export const ORT_WASM: Asset = {
  key: `ort-wasm-simd-threaded-${ORT_VERSION}.wasm`,
  label: "识别运行时",
  bytes: 14848852,
  sha256: "4b884c203b0fa48d057be3332c65513ff85aa3c5bddd6946acc0fab7ecda001d",
  urls: [
    `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.wasm`,
    `https://registry.npmmirror.com/onnxruntime-web/${ORT_VERSION}/files/dist/ort-wasm-simd-threaded.wasm`,
  ],
}

const MODEL_REPO = "csukuangfj/sherpa-onnx-zipformer-ctc-small-zh-int8-2025-07-16"

/** k2-fsa 的 Zipformer CTC 中文小模型（int8，Apache-2.0），ModelScope 与 Hugging Face 上是同一份文件。 */
export const ASR_MODEL: Asset = {
  key: "zipformer-ctc-small-zh-int8-2025-07-16.onnx",
  label: "中文识别模型",
  bytes: 62666860,
  sha256: "32e5f17cc9a77d480f8d94bda97b7cc7a40965b6651b35385813f561a74129c8",
  urls: [
    `https://modelscope.cn/models/${MODEL_REPO}/resolve/master/model.int8.onnx`,
    `https://huggingface.co/${MODEL_REPO}/resolve/main/model.int8.onnx`,
    `https://hf-mirror.com/${MODEL_REPO}/resolve/main/model.int8.onnx`,
  ],
}

export const ASSETS = [ORT_WASM, ASR_MODEL]
export const TOTAL_BYTES = ASSETS.reduce((sum, asset) => sum + asset.bytes, 0)

const CACHE_NAME = "expr-asr-v1"

function cacheUrl(asset: Asset): string {
  return new URL(`/__asr-cache/${asset.key}`, self.location.origin).toString()
}

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === "undefined" ? null : await caches.open(CACHE_NAME)
  } catch {
    return null
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

export async function readCached(asset: Asset): Promise<ArrayBuffer | null> {
  const cache = await openCache()
  if (!cache) return null
  try {
    const hit = await cache.match(cacheUrl(asset))
    if (!hit) return null
    const buf = await hit.arrayBuffer()
    if (buf.byteLength === asset.bytes) return buf
    await cache.delete(cacheUrl(asset))
  } catch {
    // 读缓存出错就当没有缓存
  }
  return null
}

async function downloadFrom(url: string, asset: Asset, onBytes: (n: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const controller = new AbortController()
  // 30 秒没有新数据就放弃这个地址
  let idle = setTimeout(() => controller.abort(), 30000)
  const bump = () => {
    clearTimeout(idle)
    idle = setTimeout(() => controller.abort(), 30000)
  }
  try {
    const res = await fetch(url, { signal: controller.signal, mode: "cors", credentials: "omit", cache: "no-store" })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const out = new Uint8Array(asset.bytes)
    let at = 0
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bump()
      if (at + value.length > out.length) throw new Error("文件比预期大")
      out.set(value, at)
      at += value.length
      onBytes(value.length)
    }
    if (at !== asset.bytes) throw new Error("文件不完整")
    if ((await sha256Hex(out)) !== asset.sha256) throw new Error("文件校验没通过")
    return out
  } finally {
    clearTimeout(idle)
  }
}

/** 先读缓存；没有就按顺序试各个地址下载，校验通过后写入缓存。onBytes 报告新增字节（换地址时会先退回）。 */
export async function loadAsset(
  asset: Asset,
  onBytes: (delta: number) => void,
): Promise<{ data: ArrayBuffer; fromCache: boolean; source: string }> {
  const cached = await readCached(asset)
  if (cached) {
    onBytes(asset.bytes)
    return { data: cached, fromCache: true, source: "cache" }
  }
  const errors: string[] = []
  for (const url of asset.urls) {
    let got = 0
    try {
      const bytes = await downloadFrom(url, asset, (n) => {
        got += n
        onBytes(n)
      })
      const cache = await openCache()
      if (cache) {
        try {
          await cache.put(
            cacheUrl(asset),
            new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }),
          )
        } catch {
          // 存不进去（空间不够、隐私模式）也照样能用，只是下次还要下载
        }
      }
      return { data: bytes.buffer, fromCache: false, source: new URL(url).host }
    } catch (error) {
      onBytes(-got)
      errors.push(`${new URL(url).host}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`${asset.label}下载失败（${errors.join("；")}）`)
}
