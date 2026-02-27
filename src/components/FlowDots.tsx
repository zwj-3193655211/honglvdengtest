import React, { useEffect, useRef, useState } from 'react'
import type { Direction, Step } from '../sim/core'

type PathFn = (t: number) => { x: number, y: number }
type Dot = { id: number, t: number, speed: number, path: PathFn, lane: 'straight' | 'left' }

function pathStraight(dir: Direction): PathFn {
  if (dir === 'North') return (t) => ({ x: 50, y: 5 + 90 * t })
  if (dir === 'South') return (t) => ({ x: 50, y: 95 - 90 * t })
  if (dir === 'East') return (t) => ({ x: 95 - 90 * t, y: 50 })
  return (t) => ({ x: 5 + 90 * t, y: 50 })
}

// 左转采用两段直线（L 形），在路口中心折线直角转弯
function pathLeft(dir: Direction): PathFn {
  if (dir === 'North') return (t) => {
    if (t < 0.5) { // 向下直行到中心
      const tt = t / 0.5
      return { x: 56, y: 5 + (50 - 5) * tt }
    } else { // 水平向左直行到西向出线
      const tt = (t - 0.5) / 0.5
      return { x: 56 - (56 - 5) * tt, y: 50 }
    }
  }
  if (dir === 'South') return (t) => {
    if (t < 0.5) {
      const tt = t / 0.5
      return { x: 44, y: 95 - (95 - 50) * tt }
    } else {
      const tt = (t - 0.5) / 0.5
      return { x: 44 + (95 - 44) * tt, y: 50 }
    }
  }
  if (dir === 'East') return (t) => {
    if (t < 0.5) {
      const tt = t / 0.5
      return { x: 95 - (95 - 50) * tt, y: 56 }
    } else {
      const tt = (t - 0.5) / 0.5
      return { x: 50, y: 56 - (56 - 5) * tt }
    }
  }
  // West
  return (t) => {
    if (t < 0.5) {
      const tt = t / 0.5
      return { x: 5 + (50 - 5) * tt, y: 44 }
    } else {
      const tt = (t - 0.5) / 0.5
      return { x: 50, y: 44 + (95 - 44) * tt }
    }
  }
}

// 生成排队点位置（不移动），按方向与车道在停止线前排队
function queuePositions(dir: Direction, lane: 'straight' | 'left', count: number): Array<{x:number,y:number}> {
  const cap = Math.min(10, count)
  const res: Array<{x:number,y:number}> = []
  const gap = 4
  for (let i = 0; i < cap; i++) {
    if (dir === 'North') res.push({ x: lane === 'straight' ? 50 : 56, y: 38 - i * gap })
    else if (dir === 'South') res.push({ x: lane === 'straight' ? 50 : 44, y: 62 + i * gap })
    else if (dir === 'East') res.push({ x: 62 + i * gap, y: lane === 'straight' ? 50 : 56 })
    else res.push({ x: 38 - i * gap, y: lane === 'straight' ? 50 : 44 })
  }
  return res
}

export default function FlowDots({ queuesStraight, queuesLeft, greenDirs, step }: {
  queuesStraight: Record<Direction, number>
  queuesLeft: Record<Direction, number>
  greenDirs: { straight: Direction[]; left: Direction[] }
  step: Step
}) {
  const [dots, setDots] = useState<Dot[]>([])
  const nextId = useRef(1)

  useEffect(() => {
    const raf = { id: 0 }
    const tick = () => {
      setDots((prev) => prev
        .map(d => ({ ...d, t: d.t + d.speed }))
        .filter(d => d.t <= 1)
      )
      raf.id = requestAnimationFrame(tick)
    }
    raf.id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.id)
  }, [])

  useEffect(() => {
    const spawn = () => {
      if (step !== 'ACTIVE') return
      greenDirs.straight.forEach((dir) => {
        const cap = Math.min(2, Math.floor((queuesStraight[dir] || 0) / 10) + 1)
        for (let i = 0; i < cap; i++) {
          setDots((prev) => prev.length < 80 ? [...prev, { id: nextId.current++, t: 0, speed: 0.010, path: pathStraight(dir), lane: 'straight' }] : prev)
        }
      })
      greenDirs.left.forEach((dir) => {
        const cap = Math.min(2, Math.floor((queuesLeft[dir] || 0) / 12) + 1)
        for (let i = 0; i < cap; i++) {
          setDots((prev) => prev.length < 80 ? [...prev, { id: nextId.current++, t: 0, speed: 0.012, path: pathLeft(dir), lane: 'left' }] : prev)
        }
      })
    }
    const timer = setInterval(spawn, 700)
    return () => clearInterval(timer)
  }, [queuesStraight, queuesLeft, greenDirs, step])

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">车流动画</h2>
      <div className="relative w-full" style={{height: 380, overflow: 'hidden'}}>
        {/* SVG 十字路口背景与车辆渲染（统一坐标系） */}
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
          {/* 横向道路 */}
          <rect x="0" y="40" width="100" height="20" fill="#374151" />
          {/* 纵向道路 */}
          <rect x="40" y="0" width="20" height="100" fill="#374151" />
          {/* 车道虚线 */}
          <line x1="0" y1="50" x2="100" y2="50" stroke="#f9fafb" strokeWidth="1.5" strokeDasharray="4 3" />
          <line x1="50" y1="0" x2="50" y2="100" stroke="#f9fafb" strokeWidth="1.5" strokeDasharray="4 3" />
          {/* 停止线 */}
          <line x1="45" y1="38" x2="55" y2="38" stroke="#fef3c7" strokeWidth="1.5" />
          <line x1="45" y1="62" x2="55" y2="62" stroke="#fef3c7" strokeWidth="1.5" />
          <line x1="38" y1="45" x2="38" y2="55" stroke="#fef3c7" strokeWidth="1.5" />
          <line x1="62" y1="45" x2="62" y2="55" stroke="#fef3c7" strokeWidth="1.5" />

          {/* 排队静态点（基于队列，停止线前）*/}
          {(['North','South','East','West'] as Direction[]).flatMap(dir => (
            [
              ...queuePositions(dir, 'straight', Math.floor((queuesStraight[dir] || 0) / 3)).map((p, idx) => (
                <circle key={`qs-${dir}-${idx}`} cx={p.x} cy={p.y} r={1.2} fill="#9ca3af" opacity={0.85} />
              )),
              ...queuePositions(dir, 'left', Math.floor((queuesLeft[dir] || 0) / 3)).map((p, idx) => (
                <circle key={`ql-${dir}-${idx}`} cx={p.x} cy={p.y} r={1.2} fill="#9ca3af" opacity={0.85} />
              )),
            ]
          ))}

          {/* 运动车辆点 */}
          {dots.map(d => {
            const { x, y } = d.path(d.t)
            return (
              <circle key={d.id} cx={x} cy={y} r={1.5} fill={d.lane === 'straight' ? '#3B82F6' : '#10B981'} />
            )
          })}
        </svg>
      </div>
    </div>
  )
}
