#!/usr/bin/env python3
"""生成给 Cloudflare 连接器（user-Cloudflare → execute）用的部署脚本：上传 worker-build/worker.js
（已内嵌前端），保留已有 secret（keep_bindings），绑定限流。不绑定 Workers AI（转写在浏览器本地）。脚本里不含任何 secret。
用法：python3 worker/make-deploy-script.py > worker-build/deploy.js"""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
code = (root / "worker-build" / "worker.js").read_text(encoding="utf-8")
meta = {"main_module": "worker.js", "compatibility_date": "2026-11-01", "keep_bindings": ["secret_text"],
 "bindings": [
  {"type": "ratelimit", "name": "RL_AUTH", "namespace_id": "74101", "simple": {"limit": 10, "period": 60}},
  {"type": "ratelimit", "name": "RL_LLM", "namespace_id": "74103", "simple": {"limit": 12, "period": 60}}]}
print("""async () => {
  const code = %s;
  const metadata = %s;
  const base = `/accounts/${accountId}/workers/scripts/suntao-expression-api`;
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("worker.js", new Blob([code], { type: "application/javascript+module" }), "worker.js");
  const up = await cloudflare.request({ method: "PUT", path: base, body: form });
  const s = await cloudflare.request({ method: "GET", path: `${base}/settings` });
  return { ok: up.success, etag: up.result && up.result.etag, bindings: (s.result.bindings || []).map(b => b.type + ":" + b.name) };
}""" % (json.dumps(code), json.dumps(meta)))
