import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getTrafficPeriod(now: Date = new Date()): { label: string; level: '高峰' | '平峰' | '低谷'; endsAt: number } {
  const minutes = now.getHours() * 60 + now.getMinutes()
  const toTs = (m: number, dayOffset: number = 0) => {
    const d = new Date(now)
    d.setDate(d.getDate() + dayOffset)
    d.setHours(Math.floor(m / 60), m % 60, 0, 0)
    return d.getTime()
  }

  if (minutes >= 7 * 60 && minutes < 9 * 60) return { label: '早高峰', level: '高峰', endsAt: toTs(9 * 60) }
  if (minutes >= 11 * 60 + 30 && minutes < 13 * 60 + 30) return { label: '午高峰', level: '高峰', endsAt: toTs(13 * 60 + 30) }
  if (minutes >= 17 * 60 && minutes < 19 * 60) return { label: '晚高峰', level: '高峰', endsAt: toTs(19 * 60) }

  if (minutes >= 22 * 60 || minutes < 7 * 60) {
    return { label: '低谷', level: '低谷', endsAt: minutes >= 22 * 60 ? toTs(7 * 60, 1) : toTs(7 * 60) }
  }

  return { label: '平峰', level: '平峰', endsAt: minutes < 11 * 60 + 30 ? toTs(11 * 60 + 30) : (minutes < 17 * 60 ? toTs(17 * 60) : toTs(22 * 60)) }
}

export function formatDurationSeconds(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}h${m}m`
  if (m > 0) return `${m}m${r}s`
  return `${r}s`
}
