type Direction = 'North' | 'South' | 'East' | 'West'
type Movement = 'straight' | 'left'

export type RuleTimingInput = {
  intersectionId: number
  phaseNumber: number
  movementType: Movement
  queuesByDirection: Partial<Record<Direction, number>>
  minGreen: number
  maxGreen: number
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function pickPair(phaseNumber: number): Direction[] {
  if (phaseNumber === 3 || phaseNumber === 4) return ['North', 'South']
  return ['East', 'West']
}

function splitMovement(total: number, movementType: Movement) {
  const straight = Math.round(total * 0.7)
  const left = Math.max(0, total - straight)
  return movementType === 'straight' ? straight : left
}

function bucketGreenSeconds(movementType: Movement, q: number) {
  if (movementType === 'left') {
    if (q <= 5) return 12
    if (q <= 20) return 18
    return 25
  }
  if (q <= 10) return 20
  if (q <= 40) return 35
  return 50
}

export function getRuleGreenSeconds(input: RuleTimingInput): number {
  const pair = pickPair(input.phaseNumber)
  const q = pair.reduce((acc, d) => acc + splitMovement(Number(input.queuesByDirection[d] ?? 0), input.movementType), 0)
  const proposed = bucketGreenSeconds(input.movementType, q)
  return clamp(proposed, input.minGreen, input.maxGreen)
}

