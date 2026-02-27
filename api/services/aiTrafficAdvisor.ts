export type AiAdvice = {
  green: number
}

export type AiContext = {
  intersectionId: string
  stats: Record<string, unknown>
}

export type Constraints = {
  minGreen: number
  maxGreen: number
  minYellow: number
  maxYellow: number
  cycleMax: number
}

const provider = (process.env.AI_PROVIDER ?? "lmstudio").toLowerCase()
const lmBase = process.env.LMSTUDIO_BASE_URL ?? "http://127.0.0.1:1234"
const lmModel = process.env.LMSTUDIO_MODEL ?? "qwen/qwen3-14b"

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function clampAdvice(advice: AiAdvice, c: Constraints): AiAdvice {
  const green = clamp(Math.round(advice.green), c.minGreen, c.maxGreen)
  return { green }
}

export async function getAdvice(
  ctx: AiContext,
  constraints: Constraints,
  abortSignal?: AbortSignal
): Promise<AiAdvice> {
  const url = `${lmBase}/v1/chat/completions`
  const stats = ctx.stats as any
  const fmt = stats.formattedStats || {}
  const directions = ['North', 'South', 'East', 'West']
  
  const dataDesc = directions.map(dir => {
    const d = fmt[dir] || { straight: 0, left: 0 }
    const sStatus = d.straightStatus
    const lStatus = d.leftStatus
    
    const sText = sStatus 
      ? (sStatus.current_status === 2 ? `直行绿灯剩余${sStatus.remaining_time}秒` : (sStatus.current_status === 1 ? '直行黄灯' : '直行红灯'))
      : '直行未知'
      
    const lText = lStatus
      ? (lStatus.current_status === 2 ? `左转绿灯剩余${lStatus.remaining_time}秒` : (lStatus.current_status === 1 ? '左转黄灯' : '左转红灯'))
      : '左转未知'

    return `   ${dir}：直行${d.straight}辆，左转${d.left}辆，${sText}，${lText}`
  }).join("\n")

  const userPrompt = [
    "数据：",
    dataDesc,
    "/no_think"
  ].join("\n")

  console.log("============== [AI Request] ==============")
  console.log(`[AI] intersection=${ctx.intersectionId}`)
  console.log("==========================================")

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const messages = [
    { role: "user", content: userPrompt }
  ]

  const timeoutMs = parseInt(process.env.AI_TIMEOUT_MS || "12000")
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()
  if (abortSignal) {
    try {
      abortSignal.addEventListener('abort', () => controller.abort(), { once: true } as any)
    } catch {}
  }
  const signal = controller.signal

  let res: Response
  try {
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: lmModel,
          messages,
          temperature: 0.2,
          max_tokens: 64,
          stream: false
        }),
        signal
      })
    } catch (e: any) {
      if (controller.signal.aborted) {
        throw new Error(`AI请求超时(${timeoutMs}ms)`)
      }
      throw e
    }
  } finally {
    clearTimeout(timeout)
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`AI ${res.status}: ${text}`)
  }
  const data: any = await res.json()
  let content: string = data?.choices?.[0]?.message?.content ?? "{}"
  
  console.log("============== [AI Response] =============")
  console.log(`[AI] elapsed=${Date.now() - startedAt}ms`)
  console.log(content)
  console.log("==========================================")

  content = content
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```json|```/g, "")
    .trim()
  let rawGreen: { green: number | string }
  try {
    rawGreen = JSON.parse(content)
  } catch {
    const m = content.match(/\{[\s\S]*\}/)
    if (m) {
      try {
        rawGreen = JSON.parse(m[0])
      } catch {
        throw new Error("AI返回非JSON")
      }
    } else {
      throw new Error("AI返回非JSON")
    }
  }
  
  const greenRaw = rawGreen?.green
  const greenText = String(greenRaw ?? '').trim()
  if (greenText === '-1') {
    throw new Error('AI建议不调整')
  }
  const normalized = greenText.toLowerCase().endsWith('s')
    ? greenText.slice(0, -1).trim()
    : greenText
  const greenVal = Number.parseInt(normalized, 10)
  if (!Number.isFinite(greenVal)) {
    throw new Error('AI返回的 green 非数值')
  }
  if (greenVal === -1) {
    throw new Error('AI建议不调整')
  }
  return clampAdvice({ green: greenVal }, constraints)
}

export const aiTrafficAdvisor = { getAdvice }
export const clampAdviceForTest = clampAdvice
