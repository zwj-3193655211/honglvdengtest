import 'dotenv/config'

async function main() {
  const provider = (process.env.AI_PROVIDER ?? "lmstudio").toLowerCase()
  const url =
    provider === "zhipu"
      ? "https://open.bigmodel.cn/api/paas/v4/chat/completions"
      : `${process.env.LMSTUDIO_BASE_URL ?? "http://127.0.0.1:1234"}/v1/chat/completions`
  const model =
    provider === "zhipu"
      ? (process.env.GLM_MODEL ?? "glm-4.7")
      : (process.env.LMSTUDIO_MODEL ?? "qwen/qwen3-14b")
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (provider === "zhipu") {
    const key = (process.env.GLM_API_KEY ?? "").trim()
    if (!key) {
      console.error("缺少 GLM_API_KEY")
      process.exit(1)
    }
    headers["Authorization"] = `Bearer ${key}`
  }
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "你是交通信号优化助手" },
          { role: "user", content: "请用一句话回答：你好/no_think" }
        ]
      })
    })
    if (!res.ok) {
      const text = await res.text()
      console.error("HTTP", res.status, text)
      process.exit(1)
    }
    const data: any = await res.json()
    let msg: string = data?.choices?.[0]?.message?.content ?? ""
    msg = msg.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
    const elapsed = Date.now() - t0
    console.log(JSON.stringify({ ok: true, provider, model, elapsed_ms: elapsed, reply: msg }, null, 2))
    process.exit(0)
  } catch (e: any) {
    console.error("SMOKE_ERROR", e?.message ?? String(e))
    process.exit(1)
  }
}

main();
