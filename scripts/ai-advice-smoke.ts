import 'dotenv/config'
import { aiTrafficAdvisor, type Constraints } from "../api/services/aiTrafficAdvisor.ts"

async function main() {
  const constraints: Constraints = {
    minGreen: parseInt(process.env.MIN_GREEN_FLOOR_SECONDS || "5"),
    maxGreen: parseInt(process.env.MAX_GREEN_SECONDS || "120"),
    minYellow: parseInt(process.env.MIN_YELLOW_SECONDS || "1"),
    maxYellow: parseInt(process.env.MAX_YELLOW_SECONDS || "10"),
    cycleMax: parseInt(process.env.CYCLE_MAX_SECONDS || "120"),
  }
  const stats = {
    window: 10,
    formattedStats: {
      North: { straight: 12, left: 6, straightStatus: { current_status: 2, remaining_time: 15 }, leftStatus: { current_status: 0 } },
      South: { straight: 8, left: 4, straightStatus: { current_status: 2, remaining_time: 15 }, leftStatus: { current_status: 0 } },
      East: { straight: 18, left: 7, straightStatus: { current_status: 0 }, leftStatus: { current_status: 0 } },
      West: { straight: 6, left: 3, straightStatus: { current_status: 0 }, leftStatus: { current_status: 0 } }
    },
    counts: [
      { direction: "North", cnt: 18 },
      { direction: "South", cnt: 12 },
      { direction: "East", cnt: 25 },
      { direction: "West", cnt: 9 }
    ]
  }
  const count = parseInt(process.env.RUN_COUNT || "10")
  const results: Array<{ ok: boolean; ms: number; error?: string }> = []
  for (let i = 0; i < count; i++) {
    const t0 = Date.now()
    try {
      const advice = await aiTrafficAdvisor.getAdvice(
        { intersectionId: String(i + 1), stats },
        constraints
      )
      const ms = Date.now() - t0
      results.push({ ok: true, ms })
      console.log(JSON.stringify({ seq: i + 1, ok: true, elapsed_ms: ms, advice }, null, 2))
    } catch (e: any) {
      const ms = Date.now() - t0
      const err = e?.message ?? String(e)
      results.push({ ok: false, ms, error: err })
      console.log(JSON.stringify({ seq: i + 1, ok: false, elapsed_ms: ms, error: err }, null, 2))
    }
  }
  const oks = results.filter(r => r.ok)
  const avg = oks.length ? Math.round(oks.reduce((s, r) => s + r.ms, 0) / oks.length) : 0
  const max = oks.length ? Math.max(...oks.map(r => r.ms)) : 0
  const min = oks.length ? Math.min(...oks.map(r => r.ms)) : 0
  const recommend = oks.length ? Math.max(10000, Math.round(max * 1.5)) : 10000
  console.log(JSON.stringify({ summary: { runs: count, success: oks.length, avg_ms: avg, min_ms: min, max_ms: max, recommend_interval_ms: recommend } }, null, 2))
  process.exit(oks.length ? 0 : 1)
}

main()
