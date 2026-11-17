# suntao-expression-api

表达训练工作台「简单复述」：同一个 Cloudflare Worker 提供前端静态文件（构建时内嵌，`dist/`）和同源接口 `/api/*`。源码 `src/index.ts`，与前端共用 `../shared/materials.ts`。网址：https://suntao-expression-api.suntao-preview.workers.dev/

接口（都要 `POST`，带 `X-Access-Code`；只接受同源请求，本地开发另放行 `localhost:4731` / `127.0.0.1:4731`）：

| 路径 | 入参 | 出参 |
| --- | --- | --- |
| `/api/check` | 无 | `{ ok: true }` |
| `/api/feedback` | JSON：`materialId`、`attempt`(1/2)、`transcript`（≤4000 字）、第二遍另带 `previousTranscript` | `{ attempt, understood, issues:[{quote,comment}], improved:{quote,comment}\|null, premises:[{id,label,covered}], model }` |
| `/api/report` | JSON：`materialId`、`transcript` | `{ match, logic, fluency, model }`，每维 `score`、`summary`、`quotes:[{quote,note}]` |

错误统一 `{ error, message }`：401 `bad_code`、403 `forbidden_origin`、413 `too_large`/`too_long`、429 `rate_limited`、503 `not_configured`、502 `upstream`。

- 语音转写不经过后端：在浏览器里本地识别（见根目录 README），录音不上传。后端没有转写接口、不绑定 Workers AI。
- 模型：反馈和报告 智谱 `glm-5.3`（`reasoning_effort: low`）。
- CSP 的 `connect-src` 只额外放行识别运行时和模型的下载地址（jsDelivr、npmmirror、ModelScope、Hugging Face、hf-mirror），`script-src` 加了 `'wasm-unsafe-eval'` 以便运行 WebAssembly。
- 引用校验：`quote` 去掉空白后必须是逐字稿的连续片段，不是的丢掉；丢了就带提醒重试一次。
- 限流（每 IP、每分钟）：口令错误 10 次、反馈+报告 12 次。两层：Cloudflare 限流绑定（按机房、最终一致）+ 实例内计数（立即生效）。分布到多个实例时实际上限会略高。
- 绑定：`RL_AUTH`/`RL_LLM`（限流）。前端文件在构建时内嵌进脚本（`worker/build.mjs`）。
- Secret：`GLM_API_KEY`（智谱，只给反馈和报告用；没配时这两个接口返回 503 `not_configured`）、`ACCESS_CODE_SHA256`（访问口令的 SHA-256 hex）。都不进仓库。
- 不收录音，不存逐字稿，不打日志内容。

构建：`npm run build:worker`（前端到 `dist/`，再内嵌进 `worker-build/worker.js`）。部署：`python3 worker/make-deploy-script.py > worker-build/deploy.js`，用 Cloudflare 连接器执行（PUT 脚本，`keep_bindings: ["secret_text"]` 保留 secret）。
