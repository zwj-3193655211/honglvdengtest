import { clampAdviceForTest, type Constraints, type AiAdvice } from "../api/services/aiTrafficAdvisor.ts"

const c: Constraints = { minGreen: 5, maxGreen: 120, minYellow: 1, maxYellow: 10, cycleMax: 120 }
const cases: AiAdvice[] = [
  { green: 3 },
  { green: 200 },
  { green: 60 },
  { green: 45 }
]

for (const advice of cases) {
  const out = clampAdviceForTest(advice, c)
  console.log(JSON.stringify({ in: advice, out }, null, 2))
}
