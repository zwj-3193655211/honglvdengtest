import React from 'react'
import type { Direction, LightState, Phase, Step } from '../sim/core'
import { formatDurationSeconds } from '../lib/utils'

const directions: Direction[] = ['North', 'South', 'East', 'West']

function getLightClass(status: 0 | 1 | 2) {
  switch (status) {
    case 0: return 'bg-red-500'
    case 1: return 'bg-yellow-500'
    case 2: return 'bg-green-500'
    default: return 'bg-gray-400'
  }
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

export default function IntersectionMonitor({
  lights,
  queuesStraight,
  queuesLeft,
  phase,
  step,
  periodLabel,
  periodLeft,
  greenLeft,
}: {
  lights: Record<Direction, LightState>
  queuesStraight: Record<Direction, number>
  queuesLeft: Record<Direction, number>
  phase: Phase
  step: Step
  periodLabel: string
  periodLeft: number
  greenLeft: number
}) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700">
          当前相位：{phaseLabel(phase)}（{stepLabel(step)}）
        </div>
        <div className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">
          交通时段：{periodLabel}（剩余 {formatDurationSeconds(periodLeft)}）
        </div>
        <div className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">
          当前绿灯剩余：{greenLeft}s
        </div>
      </div>
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
              {lights[d].straight.status === 2 && (
                <div>直行绿灯剩余：{lights[d].straight.remainingTime}s</div>
              )}
              {lights[d].left.status === 2 && (
                <div>左转绿灯剩余：{lights[d].left.remainingTime}s</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
