# suntao-expression-api

表达训练工作台「简单复述」的后端（Cloudflare Worker）。源码 `src/index.ts`，与前端共用 `../shared/materials.ts`。

接口（都要 `POST`，带 `X-Access-Code`，`Origin` 必须在白名单）：

| 路径 | 入参 | 出参 |
| --- | --- | --- |
| `/check` | 无 | `{ ok: true }` |
| `/transcribe` | multipart：`file`（WAV，≤1,000,000 字节，≤30 秒）、`prompt`（前文，≤500 字）、`materialId` | `{ text, seconds, model }` |
| `/feedback` | JSON：`materialId`、`attempt`(1/2)、`transcript`（≤4000 字）、第二遍另带 `previousTranscript` | `{ attempt, understood, issues:[{quote,comment}], improved:{quote,comment}\|null, premises:[{id,label,covered}], model }` |
| `/report` | JSON：`materialId`、`transcript` | `{ match, logic, fluency, model }`，每维 `score`、`summary`、`quotes:[{quote,note}]` |

错误统一 `{ error, message }`：401 `bad_code`、403 `forbidden_origin`、413 `too_large`/`too_long`、429 `rate_limited`、503 `not_configured`/`asr_unavailable`、502 `upstream`。

- 模型：转写 `glm-asr-2512`；反馈和报告 `glm-5.3`（`reasoning_effort: low`）。
- 引用校验：`quote` 去掉空白后必须是逐字稿的连续片段，不是的丢掉；丢了就带提醒重试一次。
- 限流（每 IP、每分钟）：口令错误 10 次、转写 30 段、反馈+报告 12 次。两层：Cloudflare 限流绑定（按机房、最终一致）+ 实例内计数（立即生效）。分布到多个实例时实际上限会略高。
- Secret：`GLM_API_KEY`（智谱）、`ACCESS_CODE_SHA256`（访问口令的 SHA-256 hex）。都不进仓库。
- 不存录音，不存逐字稿，不打日志内容。

构建：`npx esbuild worker/src/index.ts --bundle --format=esm --target=es2022 --outfile=worker-build/worker.js`，再通过 Cloudflare API 上传（metadata 里 `keep_bindings: ["secret_text"]` 保留 secret）。
