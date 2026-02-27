export type Direction = 'North' | 'South' | 'East' | 'West'
export type Phase = 'EW_STRAIGHT' | 'EW_LEFT' | 'NS_STRAIGHT' | 'NS_LEFT'
export type Step = 'ACTIVE' | 'YELLOW' | 'ALL_RED'

export interface MovementState {
  status: 0 | 1 | 2
  remainingTime: number
  defaultGreenTime: number
}

export interface LightState {
  direction: Direction
  straight: MovementState
  left: MovementState
}

export const directions: Direction[] = ['North', 'South', 'East', 'West']

export function straightGreen(groupFlow: number): number {
  if (groupFlow < 10) return 30
  if (groupFlow < 30) return 60
  if (groupFlow < 60) return 90
  return 120
}

export function leftGreen(groupFlow: number): number {
  if (groupFlow < 5) return 15
  if (groupFlow < 20) return 25
  if (groupFlow < 40) return 35
  return 45
}

export function samplePoisson(lambda: number): number {
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= Math.random()
  } while (p > L)
  return k - 1
}

export function calcPass(queueLen: number, elapsedGreen: number, movement: 'straight' | 'left', releaseScale: number): number {
  const baseProb = movement === 'straight'
    ? (elapsedGreen < 3 ? 0 : elapsedGreen < 8 ? 0.35 : 0.6)
    : (elapsedGreen < 3 ? 0 : elapsedGreen < 8 ? 0.28 : 0.5)
  const queueFactor = queueLen >= 12 ? 1.15 : queueLen >= 6 ? 1.0 : 0.7
  let p = baseProb * queueFactor * Math.min(1, releaseScale)
  p = Math.max(0, Math.min(0.95, p))
  const capMult = movement === 'left' ? 2 : 1
  const cap = Math.max(1, Math.floor(releaseScale * capMult))
  let pass = 0
  for (let i = 0; i < cap; i++) {
    if (Math.random() < p) pass++
  }
  return Math.min(pass, queueLen)
}

export function nextPhaseOf(p: Phase): Phase {
  if (p === 'EW_STRAIGHT') return 'EW_LEFT'
  if (p === 'EW_LEFT') return 'NS_STRAIGHT'
  if (p === 'NS_STRAIGHT') return 'NS_LEFT'
  return 'EW_STRAIGHT'
}

export function applyActive(nextPhase: Phase, prev: Record<Direction, LightState>, qs: Record<Direction, number>, ql: Record<Direction, number>) {
  const next = { ...prev }
  directions.forEach((d) => {
    next[d] = {
      direction: d,
      straight: { ...next[d].straight, status: 0, remainingTime: 0 },
      left: { ...next[d].left, status: 0, remainingTime: 0 },
    }
  })
  if (nextPhase === 'EW_STRAIGHT') {
    const flow = qs.East + qs.West
    const g = straightGreen(flow)
    next.East.straight = { ...next.East.straight, status: 2, remainingTime: g, defaultGreenTime: g }
    next.West.straight = { ...next.West.straight, status: 2, remainingTime: g, defaultGreenTime: g }
  }
  if (nextPhase === 'EW_LEFT') {
    const flow = ql.East + ql.West
    const g = leftGreen(flow)
    next.East.left = { ...next.East.left, status: 2, remainingTime: g, defaultGreenTime: g }
    next.West.left = { ...next.West.left, status: 2, remainingTime: g, defaultGreenTime: g }
  }
  if (nextPhase === 'NS_STRAIGHT') {
    const flow = qs.North + qs.South
    const g = straightGreen(flow)
    next.North.straight = { ...next.North.straight, status: 2, remainingTime: g, defaultGreenTime: g }
    next.South.straight = { ...next.South.straight, status: 2, remainingTime: g, defaultGreenTime: g }
  }
  if (nextPhase === 'NS_LEFT') {
    const flow = ql.North + ql.South
    const g = leftGreen(flow)
    next.North.left = { ...next.North.left, status: 2, remainingTime: g, defaultGreenTime: g }
    next.South.left = { ...next.South.left, status: 2, remainingTime: g, defaultGreenTime: g }
  }
  return next
}

export function applyYellow(prev: Record<Direction, LightState>, p: Phase) {
  const next = { ...prev }
  const y = 3
  if (p === 'EW_STRAIGHT') {
    next.East.straight = { ...next.East.straight, status: 1, remainingTime: y }
    next.West.straight = { ...next.West.straight, status: 1, remainingTime: y }
  } else if (p === 'EW_LEFT') {
    next.East.left = { ...next.East.left, status: 1, remainingTime: y }
    next.West.left = { ...next.West.left, status: 1, remainingTime: y }
  } else if (p === 'NS_STRAIGHT') {
    next.North.straight = { ...next.North.straight, status: 1, remainingTime: y }
    next.South.straight = { ...next.South.straight, status: 1, remainingTime: y }
  } else {
    next.North.left = { ...next.North.left, status: 1, remainingTime: y }
    next.South.left = { ...next.South.left, status: 1, remainingTime: y }
  }
  return next
}

export function applyAllRed(prev: Record<Direction, LightState>) {
  const next = { ...prev }
  const r = 2
  directions.forEach((d) => {
    next[d] = {
      direction: d,
      straight: { ...next[d].straight, status: 0, remainingTime: r },
      left: { ...next[d].left, status: 0, remainingTime: r },
    }
  })
  return next
}
