import React, { useEffect, useMemo, useRef, useState } from 'react'

type Direction = 'North' | 'South' | 'East' | 'West'
type Phase = 'EW_STRAIGHT' | 'EW_LEFT' | 'NS_STRAIGHT' | 'NS_LEFT'
type Step = 'ACTIVE' | 'YELLOW' | 'ALL_RED'

interface MovementState {
  status: 0 | 1 | 2
  remainingTime: number
  defaultGreenTime: number
}

interface LightState {
  direction: Direction
  straight: MovementState
  left: MovementState
}

interface WeatherInfo {
  condition: '晴' | '多云' | '小雨' | '大雨' | '阴'
  temperature: number
}

const directions: Direction[] = ['North', 'South', 'East', 'West']
const flowSchedule: Array<{ label: string; duration: number; rates: Record<Direction, number> }> = [
  { label: '早高峰东西向', duration: 90, rates: { North: 0.4, South: 0.5, East: 1.2, West: 1.1 } },
  { label: '平峰均衡', duration: 90, rates: { North: 0.6, South: 0.6, East: 0.6, West: 0.6 } },
  { label: '午高峰南北向', duration: 90, rates: { North: 1.1, South: 1.2, East: 0.4, West: 0.3 } },
  { label: '晚间低流量', duration: 90, rates: { North: 0.2, South: 0.2, East: 0.3, West: 0.3 } },
]

const Demo: React.FC = () => {
  const [queuesStraight, setQueuesStraight] = useState<Record<Direction, number>>({
    North: 0,
    South: 0,
    East: 0,
    West: 0,
  })
  const [queuesLeft, setQueuesLeft] = useState<Record<Direction, number>>({
    North: 0,
    South: 0,
    East: 0,
    West: 0,
  })
  const [lights, setLights] = useState<Record<Direction, LightState>>(() => {
    const init: Record<Direction, LightState> = {
      North: { direction: 'North', straight: { status: 0, remainingTime: 0, defaultGreenTime: 30 }, left: { status: 0, remainingTime: 0, defaultGreenTime: 20 } },
      South: { direction: 'South', straight: { status: 0, remainingTime: 0, defaultGreenTime: 30 }, left: { status: 0, remainingTime: 0, defaultGreenTime: 20 } },
      East: { direction: 'East', straight: { status: 2, remainingTime: 40, defaultGreenTime: 40 }, left: { status: 0, remainingTime: 0, defaultGreenTime: 20 } },
      West: { direction: 'West', straight: { status: 2, remainingTime: 40, defaultGreenTime: 40 }, left: { status: 0, remainingTime: 0, defaultGreenTime: 20 } },
    }
    return init
  })
  const [phase, setPhase] = useState<Phase>('EW_STRAIGHT')
  const [step, setStep] = useState<Step>('ACTIVE')
  const [weather, setWeather] = useState<WeatherInfo>({ condition: '晴', temperature: 22 })
  const tickRef = useRef<number | null>(null)
  const [slotIdx, setSlotIdx] = useState(0)
  const [slotLeft, setSlotLeft] = useState(flowSchedule[0].duration)
  const queuesStraightRef = useRef<Record<Direction, number>>({ North: 0, South: 0, East: 0, West: 0 })
  const queuesLeftRef = useRef<Record<Direction, number>>({ North: 0, South: 0, East: 0, West: 0 })

  const slotIdxRef = useRef(slotIdx)
  const stepRef = useRef(step)
  const greenElapsedRef = useRef<number>(0)
  const phaseRef = useRef(phase)
  const [arrivalStraightScale, setArrivalStraightScale] = useState<number>(parseFloat(((import.meta as any).env?.VITE_DEMO_ARRIVAL_SCALE_STRAIGHT) || '0.3'))
  const [arrivalLeftScale, setArrivalLeftScale] = useState<number>(parseFloat(((import.meta as any).env?.VITE_DEMO_ARRIVAL_SCALE_LEFT) || '0.2'))
  const [releaseStraightScale, setReleaseStraightScale] = useState<number>(parseFloat(((import.meta as any).env?.VITE_DEMO_RELEASE_STRAIGHT_SCALE) || '0.8'))
  const [releaseLeftScale, setReleaseLeftScale] = useState<number>(parseFloat(((import.meta as any).env?.VITE_DEMO_RELEASE_LEFT_SCALE) || '0.7'))
  useEffect(() => { slotIdxRef.current = slotIdx }, [slotIdx])
  useEffect(() => { stepRef.current = step }, [step])
  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { queuesStraightRef.current = queuesStraight }, [queuesStraight])
  useEffect(() => { queuesLeftRef.current = queuesLeft }, [queuesLeft])

  const onSpawnTick = () => {
    setSlotLeft((n) => {
      const v = n - 1
      if (v > 0) return v
      const nextIdx = (slotIdxRef.current + 1) % flowSchedule.length
      setSlotIdx(nextIdx)
      return flowSchedule[nextIdx].duration
    })
    setQueuesStraight((q) => {
      const next = { ...q }
      const rates = flowSchedule[slotIdxRef.current].rates
      directions.forEach((d) => {
        const lambda = Math.max(0, rates[d] * arrivalStraightScale)
        const add = samplePoisson(lambda)
        next[d] = Math.min(999, next[d] + add)
      })
      return next
    })
    setQueuesLeft((q) => {
      const next = { ...q }
      const rates = flowSchedule[slotIdxRef.current].rates
      directions.forEach((d) => {
        const lambda = Math.max(0, rates[d] * arrivalLeftScale)
        const add = samplePoisson(lambda)
        next[d] = Math.min(999, next[d] + add)
      })
      return next
    })
  }

  // 天气每分钟更新一次
  useEffect(() => {
    const weatherTimer = setInterval(() => {
      const conds: WeatherInfo['condition'][] = ['晴', '多云', '小雨', '阴']
      const next: WeatherInfo = {
        condition: conds[Math.floor(Math.random() * conds.length)],
        temperature: Math.floor(18 + Math.random() * 12),
      }
      setWeather(next)
    }, 60_000)
    return () => clearInterval(weatherTimer)
  }, [])

  // 每秒 tick：灯剩余时间与车辆通过
  const onLightsTick = () => {
      setLights((prev) => {
        const next = { ...prev }
        directions.forEach((d) => {
          next[d] = {
            direction: d,
            straight: { ...next[d].straight, remainingTime: Math.max(0, next[d].straight.remainingTime - 1) },
            left: { ...next[d].left, remainingTime: Math.max(0, next[d].left.remainingTime - 1) },
          }
        })
        if (stepRef.current === 'ACTIVE') {
          if (phaseRef.current === 'EW_STRAIGHT') {
            const g = (next.East.straight.defaultGreenTime || 0) - next.East.straight.remainingTime
            greenElapsedRef.current = Math.max(0, g)
          } else if (phaseRef.current === 'EW_LEFT') {
            const g = (next.East.left.defaultGreenTime || 0) - next.East.left.remainingTime
            greenElapsedRef.current = Math.max(0, g)
          } else if (phaseRef.current === 'NS_STRAIGHT') {
            const g = (next.North.straight.defaultGreenTime || 0) - next.North.straight.remainingTime
            greenElapsedRef.current = Math.max(0, g)
          } else if (phaseRef.current === 'NS_LEFT') {
            const g = (next.North.left.defaultGreenTime || 0) - next.North.left.remainingTime
            greenElapsedRef.current = Math.max(0, g)
          }
        } else {
          greenElapsedRef.current = 0
        }
        const threshold = parseInt((import.meta as any).env?.VITE_LOW_FLOW_THRESHOLD || '8')
        const minGreen = parseInt((import.meta as any).env?.VITE_MIN_GREEN_FLOOR_SECONDS || '5')
        if (stepRef.current === 'ACTIVE') {
          if (phaseRef.current === 'EW_STRAIGHT') {
            const group = (queuesStraightRef.current.East || 0) + (queuesStraightRef.current.West || 0)
            if (group <= threshold) {
              next.East.straight.remainingTime = Math.min(next.East.straight.remainingTime, minGreen)
              next.West.straight.remainingTime = Math.min(next.West.straight.remainingTime, minGreen)
            }
          } else if (phaseRef.current === 'EW_LEFT') {
            const group = (queuesLeftRef.current.East || 0) + (queuesLeftRef.current.West || 0)
            if (group <= threshold) {
              next.East.left.remainingTime = Math.min(next.East.left.remainingTime, minGreen)
              next.West.left.remainingTime = Math.min(next.West.left.remainingTime, minGreen)
            }
          } else if (phaseRef.current === 'NS_STRAIGHT') {
            const group = (queuesStraightRef.current.North || 0) + (queuesStraightRef.current.South || 0)
            if (group <= threshold) {
              next.North.straight.remainingTime = Math.min(next.North.straight.remainingTime, minGreen)
              next.South.straight.remainingTime = Math.min(next.South.straight.remainingTime, minGreen)
            }
          } else if (phaseRef.current === 'NS_LEFT') {
            const group = (queuesLeftRef.current.North || 0) + (queuesLeftRef.current.South || 0)
            if (group <= threshold) {
              next.North.left.remainingTime = Math.min(next.North.left.remainingTime, minGreen)
              next.South.left.remainingTime = Math.min(next.South.left.remainingTime, minGreen)
            }
          }
        }
        return next
      })

      if (stepRef.current === 'ACTIVE') {
        if (phaseRef.current === 'EW_STRAIGHT') {
          setQueuesStraight((q) => {
            const next = { ...q }
            const passE = calcPass(next.East, greenElapsedRef.current, 'straight', releaseStraightScale)
            const passW = calcPass(next.West, greenElapsedRef.current, 'straight', releaseStraightScale)
            next.East = Math.max(0, next.East - passE)
            next.West = Math.max(0, next.West - passW)
            return next
          })
        }
        if (phaseRef.current === 'EW_LEFT') {
          setQueuesLeft((q) => {
            const next = { ...q }
            const passE = calcPass(next.East, greenElapsedRef.current, 'left', releaseLeftScale)
            const passW = calcPass(next.West, greenElapsedRef.current, 'left', releaseLeftScale)
            next.East = Math.max(0, next.East - passE)
            next.West = Math.max(0, next.West - passW)
            return next
          })
        }
        if (phaseRef.current === 'NS_STRAIGHT') {
          setQueuesStraight((q) => {
            const next = { ...q }
            const passN = calcPass(next.North, greenElapsedRef.current, 'straight', releaseStraightScale)
            const passS = calcPass(next.South, greenElapsedRef.current, 'straight', releaseStraightScale)
            next.North = Math.max(0, next.North - passN)
            next.South = Math.max(0, next.South - passS)
            return next
          })
        }
        if (phaseRef.current === 'NS_LEFT') {
          setQueuesLeft((q) => {
            const next = { ...q }
            const passN = calcPass(next.North, greenElapsedRef.current, 'left', releaseLeftScale)
            const passS = calcPass(next.South, greenElapsedRef.current, 'left', releaseLeftScale)
            next.North = Math.max(0, next.North - passN)
            next.South = Math.max(0, next.South - passS)
            return next
          })
        }
      }
      setLights((prev) => {
        const isActiveEnded = (() => {
          if (stepRef.current !== 'ACTIVE') return false
          if (phaseRef.current === 'EW_STRAIGHT') return prev.East.straight.remainingTime === 0 && prev.West.straight.remainingTime === 0
          if (phaseRef.current === 'EW_LEFT') return prev.East.left.remainingTime === 0 && prev.West.left.remainingTime === 0
          if (phaseRef.current === 'NS_STRAIGHT') return prev.North.straight.remainingTime === 0 && prev.South.straight.remainingTime === 0
          return prev.North.left.remainingTime === 0 && prev.South.left.remainingTime === 0
        })()
        if (stepRef.current === 'ACTIVE' && isActiveEnded) {
          const next = applyYellow(prev, phaseRef.current)
          setStep('YELLOW')
          return next
        }

        const isYellowEnded = stepRef.current === 'YELLOW' && directions.every((d) => prev[d].straight.remainingTime === 0 && prev[d].left.remainingTime === 0)
        if (isYellowEnded) {
          const next = applyAllRed(prev)
          setStep('ALL_RED')
          return next
        }

        const isAllRedEnded = stepRef.current === 'ALL_RED' && directions.every((d) => prev[d].straight.remainingTime === 0 && prev[d].left.remainingTime === 0)
        if (isAllRedEnded) {
          const nextPhase = nextPhaseOf(phaseRef.current)
          const next = applyActive(nextPhase, prev, queuesStraight, queuesLeft)
          setPhase(nextPhase)
          setStep('ACTIVE')
          return next
        }

        return prev
      })
  }

  useEffect(() => {
    const w = new Worker(new URL('../workers/timerWorker.ts', import.meta.url), { type: 'module' })
    w.onmessage = () => {
      // 先处理通过车辆，再生成到达，避免“绿灯下队列只增不减”的视觉效果
      onLightsTick()
      onSpawnTick()
    }
    w.postMessage({ type: 'START', interval: 1000 })
    return () => {
      w.postMessage({ type: 'STOP' })
      w.terminate()
    }
  }, [])

  const now = useMemo(() => new Date(), [weather])

  const getLightClass = (status: 0 | 1 | 2) => {
    switch (status) {
      case 0:
        return 'bg-red-500'
      case 1:
        return 'bg-yellow-500'
      case 2:
        return 'bg-green-500'
      default:
        return 'bg-gray-400'
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">功能演示：虚拟十字路口</h1>
          <p className="text-gray-500">随机车流与自适应红绿灯时长演示</p>
        </div>
        <div className="flex items-center space-x-6">
          <div className="text-sm text-gray-700">
            时间：{new Date().toLocaleString()}
          </div>
          <div className="text-sm text-gray-700">
            天气：{weather.condition}，{weather.temperature}℃
          </div>
          <div className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700">
            当前相位：{phaseLabel(phase)}（{stepLabel(step)}）
          </div>
          <div className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">
            模拟时段：{flowSchedule[slotIdx].label} 剩余 {slotLeft}s
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 十字路口可视化 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">路口状态</h2>
          <div className="grid grid-cols-2 gap-4">
            {directions.map((d) => (
              <div key={d} className="border rounded-lg p-4">
                <div className="font-medium text-gray-900 mb-2">
                  {d === 'North' ? '北向' : d === 'South' ? '南向' : d === 'East' ? '东向' : '西向'}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">直行</span>
                    <div className={`w-4 h-4 rounded-full ${getLightClass(lights[d].straight.status)}`}></div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">左转</span>
                    <div className={`w-4 h-4 rounded-full ${getLightClass(lights[d].left.status)}`}></div>
                  </div>
                </div>
                <div className="mt-2 text-xs text-gray-700 grid grid-cols-2 gap-2">
                  <div>直行队列：{queuesStraight[d]}</div>
                  <div>左转队列：{queuesLeft[d]}</div>
                  <div>直行剩余：{lights[d].straight.remainingTime}s</div>
                  <div>左转剩余：{lights[d].left.remainingTime}s</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 简要说明与控制 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">说明</h2>
          <ul className="text-sm text-gray-700 list-disc pl-5 space-y-2">
            <li>四相位控制：东西直行→东西左转→南北直行→南北左转</li>
            <li>起步慢后续快：绿灯前3秒释放极慢，随后加速提升</li>
            <li>低队列快速切绿：同向对队列和≤阈值时将剩余绿灯压至5秒</li>
            <li>秒级稳定：独立线程驱动倒计时与调度</li>
            <li>可调参数：直行/左达到达强度、直行/左转释放强度滑杆</li>
            <li>时段到达率：依据时段各向速率，泊松到达生成</li>
            <li>时序分配：直行30–60秒、左转15–30秒，按队列适配</li>
            <li>过渡时长：黄灯3秒、全红2秒</li>
          </ul>
          <div className="mt-4 flex space-x-3">
            <button
              onClick={() => {
                setQueuesStraight({ North: 0, South: 0, East: 0, West: 0 })
                setQueuesLeft({ North: 0, South: 0, East: 0, West: 0 })
              }}
              className="px-3 py-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-800"
            >
              清空队列
            </button>
            <button
              onClick={() => {
                setStep('ACTIVE')
                const next = nextPhaseOf(phase)
                setLights((prev) => applyActive(next, prev, queuesStraight, queuesLeft))
                setPhase(next)
              }}
              className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white"
            >
              立即切换相位
            </button>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-700">直行到达缩放</span>
                <span className="text-sm text-gray-900">{arrivalStraightScale.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={10}
                step={0.05}
                value={arrivalStraightScale}
                onChange={(e) => setArrivalStraightScale(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-700">左达到达缩放</span>
                <span className="text-sm text-gray-900">{arrivalLeftScale.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={5}
                step={0.05}
                value={arrivalLeftScale}
                onChange={(e) => setArrivalLeftScale(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-700">直行释放强度缩放</span>
                <span className="text-sm text-gray-900">{releaseStraightScale.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.05}
                max={4}
                step={0.05}
                value={releaseStraightScale}
                onChange={(e) => setReleaseStraightScale(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-700">左转释放强度缩放</span>
                <span className="text-sm text-gray-900">{releaseLeftScale.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.05}
                max={4}
                step={0.05}
                value={releaseLeftScale}
                onChange={(e) => setReleaseLeftScale(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function straightGreen(groupFlow: number): number {
  if (groupFlow < 10) return 30
  if (groupFlow < 30) return 40
  if (groupFlow < 60) return 50
  return 60
}

function leftGreen(groupFlow: number): number {
  if (groupFlow < 5) return 15
  if (groupFlow < 20) return 20
  if (groupFlow < 40) return 25
  return 30
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function samplePoisson(lambda: number): number {
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= Math.random()
  } while (p > L)
  return k - 1
}

function calcPass(queueLen: number, elapsedGreen: number, movement: 'straight' | 'left', releaseScale: number): number {
  const ramp = movement === 'straight'
    ? (elapsedGreen < 3 ? 0 : elapsedGreen < 8 ? 2 : 4)
    : (elapsedGreen < 3 ? 0 : elapsedGreen < 8 ? 1 : 3)
  const surge = Math.min(5, Math.floor(queueLen * 0.02))
  const noise = 0
  const total = ramp + surge + noise
  return Math.max(0, Math.floor(total * releaseScale))
}

function nextPhaseOf(p: Phase): Phase {
  if (p === 'EW_STRAIGHT') return 'EW_LEFT'
  if (p === 'EW_LEFT') return 'NS_STRAIGHT'
  if (p === 'NS_STRAIGHT') return 'NS_LEFT'
  return 'EW_STRAIGHT'
}

function phaseLabel(p: Phase): string {
  if (p === 'EW_STRAIGHT') return '东西直行'
  if (p === 'EW_LEFT') return '东西左转'
  if (p === 'NS_STRAIGHT') return '南北直行'
  return '南北左转'
}

function stepLabel(s: Step): string {
  if (s === 'ACTIVE') return '运行中'
  if (s === 'YELLOW') return '黄灯过渡'
  return '全红过渡'
}

function applyActive(nextPhase: Phase, prev: Record<Direction, LightState>, qs: Record<Direction, number>, ql: Record<Direction, number>) {
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

function applyYellow(prev: Record<Direction, LightState>, p: Phase) {
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

function applyAllRed(prev: Record<Direction, LightState>) {
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

export default Demo
