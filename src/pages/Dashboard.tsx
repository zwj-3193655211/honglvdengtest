import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import io from 'socket.io-client';
import IntersectionMonitor from '../components/IntersectionMonitor';
import FlowDots from '../components/FlowDots';
import type { Direction, LightState, Phase, Step } from '../sim/core';
import { useTrendEngine } from '../stores/trendEngine';
import { getTrafficPeriod } from '../lib/utils';

interface TrafficLight {
  id: number;
  intersection_id: number;
  direction: string;
  movement_type?: string;
  current_status: number; // 0:red,1:yellow,2:green
  remaining_time: number;
  default_green_time: number;
  default_red_time: number;
  default_yellow_time: number;
}

interface VehicleFlow {
  id: number;
  intersection_id: number;
  direction: string;
  vehicle_count: number;
  straight_count?: number;
  left_count?: number;
  average_speed: number;
  timestamp: string;
}

interface Intersection {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  status: number | string;
  created_at: string;
  updated_at: string;
  next_north_id?: number | null;
  next_south_id?: number | null;
  next_east_id?: number | null;
  next_west_id?: number | null;
}

const Dashboard: React.FC = () => {
  const [trafficLights, setTrafficLights] = useState<TrafficLight[]>([]);
  const [displayLights, setDisplayLights] = useState<TrafficLight[]>([]);
  const [vehicleFlows, setVehicleFlows] = useState<VehicleFlow[]>([]);
  const [trendData, setTrendData] = useState<Array<{ ts: number; time: string; North: number; South: number; East: number; West: number }>>([]);
  const trendTimerRef = useRef<any>(null);
  const trendFallbackRef = useRef<any>(null);
  const [intersections, setIntersections] = useState<Intersection[]>([]);
  const [selectedIntersectionId, setSelectedIntersectionId] = useState<number | null>(null);
  const selectedIntersectionIdRef = useRef<number | null>(null);
  const [socket, setSocket] = useState<any>(null);
  const [emergencyStatus, setEmergencyStatus] = useState<string>('normal');
  const workerRef = useRef<Worker | null>(null);
  const trendStoreData = useTrendEngine(s => s.trendData)
  const trendStart = useTrendEngine(s => s.start)
  const trendSetIntersection = useTrendEngine(s => s.setIntersection)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [lastAiAdvice, setLastAiAdvice] = useState<{ intersectionId: number; green: number } | null>(null)
  const aiEnabledRef = useRef(aiEnabled)
  const [queueSnapshot, setQueueSnapshot] = useState<Record<Direction, number>>({ North: 0, South: 0, East: 0, West: 0 })
  const [queueSnapshotSplit, setQueueSnapshotSplit] = useState<{ straight: Record<Direction, number>; left: Record<Direction, number> } | null>(null)

  useEffect(() => {
    selectedIntersectionIdRef.current = selectedIntersectionId
  }, [selectedIntersectionId])
  useEffect(() => {
    aiEnabledRef.current = aiEnabled
    if (!aiEnabled) setLastAiAdvice(null)
  }, [aiEnabled])

  useEffect(() => {
    // 初始化WebSocket连接
    const newSocket = io('http://localhost:3001');
    setSocket(newSocket);

    // 监听红绿灯状态更新
    newSocket.on('trafficLightUpdate', (data: TrafficLight[]) => {
      const selected = selectedIntersectionIdRef.current
      if (selected != null && Array.isArray(data) && data.length > 0 && data[0].intersection_id !== selected) {
        return
      }
      setTrafficLights(data);
      setDisplayLights(data);
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'INIT', lights: data });
      }
    });

    newSocket.on('light_status_update', (data: any) => {
      setTrafficLights(prev => prev.map(l => l.id === data.lightId ? {
        ...l,
        current_status: data.status,
        remaining_time: data.remainingTime
      } : l));
      if (workerRef.current) {
        workerRef.current.postMessage({
          type: 'UPDATE_LIGHT',
          light: { id: data.lightId, remaining_time: data.remainingTime, current_status: data.status },
        });
      }
    });

    // 监听车流量更新（实时追加到趋势）
    newSocket.on('vehicleFlowUpdate', (data: any) => {
      const normalized: VehicleFlow[] = Array.isArray(data)
        ? data
        : (Array.isArray(data?.batchData)
          ? data.batchData.map((it: any, idx: number) => ({
              id: (it?.id ?? idx) as number,
              intersection_id: Number(it?.intersectionId ?? data?.intersectionId) as number,
              direction: it?.direction as any,
              vehicle_count: Number(it?.vehicleCount ?? it?.vehicle_count ?? 0),
              straight_count: it?.straightCount ?? it?.straight_count,
              left_count: it?.leftCount ?? it?.left_count,
              average_speed: Number(it?.averageSpeed ?? it?.average_speed ?? 0),
              timestamp: (it?.timestamp ?? data?.timestamp ?? new Date().toISOString()) as string,
            }))
          : []);

      setVehicleFlows(normalized);
      const selected = selectedIntersectionIdRef.current
      if (selected == null) return;
      const items = normalized.filter(d => d.intersection_id === selected);
      if (items.length === 0) return;
      const hasSplit = items.some((it: any) => it?.straight_count != null || it?.left_count != null)
      if (hasSplit) {
        setQueueSnapshotSplit(prev => {
          const next = prev ?? { straight: { North: 0, South: 0, East: 0, West: 0 }, left: { North: 0, South: 0, East: 0, West: 0 } }
          const straight = { ...next.straight }
          const left = { ...next.left }
          for (const it of items as any[]) {
            if (it.direction === 'North' || it.direction === 'South' || it.direction === 'East' || it.direction === 'West') {
              if (it.straight_count != null) (straight as any)[it.direction] = Number(it.straight_count ?? 0)
              if (it.left_count != null) (left as any)[it.direction] = Number(it.left_count ?? 0)
            }
          }
          return { straight, left }
        })
      }
      setQueueSnapshot(prev => {
        const next = { ...prev }
        for (const it of items) {
          if (it.direction === 'North' || it.direction === 'South' || it.direction === 'East' || it.direction === 'West') {
            ;(next as any)[it.direction] = it.vehicle_count
          }
        }
        return next
      })
      setTrendData(prev => {
        const next = [...prev];
        for (const it of items) {
          const ts = Math.floor(new Date(it.timestamp).getTime() / 10000) * 10000; // 10s 桶
          const idx = next.findIndex(p => p.ts === ts);
          const time = new Date(ts).toLocaleTimeString();
          if (idx === -1) {
            const row = { ts, time, North: 0, South: 0, East: 0, West: 0 };
            (row as any)[it.direction as 'North'|'South'|'East'|'West'] = it.vehicle_count;
            next.push(row);
          } else {
            const row = next[idx];
            (row as any)[it.direction as 'North'|'South'|'East'|'West'] += it.vehicle_count;
          }
        }
        // 限制窗口长度
        return next.slice(Math.max(0, next.length - 300));
      });
    });

    // 监听紧急情况
    newSocket.on('emergencyMode', (status: string) => {
      setEmergencyStatus(status);
    });
    newSocket.on('trafficTimingUpdate', (data: any) => {
      if (aiEnabledRef.current && data?.source === 'ai') {
        setLastAiAdvice({
          intersectionId: data.intersectionId,
          green: data.advice?.green,
        })
      }
    })

    fetchInitialIntersections();
    trendStart();

    // 订阅路口管理事件，收到后触发重新拉取
    const bc = new BroadcastChannel('intersections_update');
    bc.onmessage = () => {
      fetchInitialIntersections();
      if (selectedIntersectionId != null) {
        setSelectedIntersectionId(prev => prev) // 触发依赖 effect 重新拉取当前路口数据
      }
    }
    newSocket.on('intersections:changed', () => {
      fetchInitialIntersections();
      if (selectedIntersectionId != null) setSelectedIntersectionId(prev => prev)
    })

    return () => {
      newSocket.close();
      bc.close();
    };
  }, []);

  const fetchInitialIntersections = async () => {
    try {
      const [intersectionsRes, selectedRes] = await Promise.all([
        fetch('http://localhost:3001/api/intersections'),
        fetch('http://localhost:3001/api/settings/selected-intersection').catch(() => null as any),
      ]);
      const intersectionsJson = await intersectionsRes.json();
      const list: Intersection[] = intersectionsJson.data || [];
      setIntersections(list);

      let backendSelectedId: number | null = null;
      try {
        if (selectedRes) {
          const selectedJson = await selectedRes.json();
          const v = Number(selectedJson?.data ?? 0);
          backendSelectedId = v > 0 ? v : null;
        }
      } catch {}

      const current = selectedIntersectionIdRef.current;
      const hasId = (id: number | null | undefined) => id != null && list.some(i => Number(i.id) === Number(id));
      const nextSelected =
        hasId(backendSelectedId)
          ? (backendSelectedId as number)
          : hasId(current)
            ? (current as number)
            : (list.length > 0 ? Number(list[0].id) : null);

      if (nextSelected !== current) {
        setSelectedIntersectionId(nextSelected);
      }
    } catch (error) {
      console.error('获取初始数据失败:', error);
    }
  };

  const fetchAiMode = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/settings/ai-mode');
      const json = await response.json();
      setAiEnabled(!!json.data);
    } catch {}
  };
  useEffect(() => { fetchAiMode() }, [])

  const updateAiMode = async (enabled: boolean) => {
    try {
      const response = await fetch('http://localhost:3001/api/settings/ai-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      const json = await response.json();
      setAiEnabled(!!json.data);
    } catch {}
  };

  useEffect(() => {
    if (selectedIntersectionId == null) return;
    const loadByIntersection = async () => {
      try {
        const tlRes = await fetch(`http://localhost:3001/api/traffic-lights?intersection_id=${selectedIntersectionId}`);
        const tlJson = await tlRes.json();
        setTrafficLights(tlJson.data || []);
        setDisplayLights(tlJson.data || []);
        if (workerRef.current) {
          workerRef.current.postMessage({ type: 'INIT', lights: tlJson.data || [] });
        }
        const flowsRes = await fetch(`http://localhost:3001/api/vehicle-flows?intersection_id=${selectedIntersectionId}&time_range=hour`);
        const flowsJson = await flowsRes.json();
        const flows = Array.isArray(flowsJson.data) ? flowsJson.data : []
        setVehicleFlows(flows);
        const nextSnapshot: Record<Direction, number> = { North: 0, South: 0, East: 0, West: 0 }
        const seen = new Set<string>()
        for (const it of flows) {
          const dir = it?.direction
          if ((dir === 'North' || dir === 'South' || dir === 'East' || dir === 'West') && !seen.has(dir)) {
            seen.add(dir)
            nextSnapshot[dir] = Number(it?.vehicle_count ?? 0)
          }
        }
        setQueueSnapshot(nextSnapshot)
        try {
          const splitRes = await fetch(`http://localhost:3001/api/vehicle-flows/realtime-split?intersection_id=${selectedIntersectionId}`)
          const splitJson = await splitRes.json()
          const v = splitJson?.data
          if (v && typeof v === 'object') {
            const straight: Record<Direction, number> = { North: 0, South: 0, East: 0, West: 0 }
            const left: Record<Direction, number> = { North: 0, South: 0, East: 0, West: 0 }
            for (const dir of ['North', 'South', 'East', 'West'] as Direction[]) {
              straight[dir] = Number(v?.[dir]?.straight ?? 0)
              left[dir] = Number(v?.[dir]?.left ?? 0)
            }
            setQueueSnapshotSplit({ straight, left })
            setQueueSnapshot({ North: straight.North + left.North, South: straight.South + left.South, East: straight.East + left.East, West: straight.West + left.West })
          } else {
            setQueueSnapshotSplit(null)
          }
        } catch {
          setQueueSnapshotSplit(null)
        }
      } catch (e) {
        console.error('按路口加载数据失败:', e);
      }
    }
    loadByIntersection();
    fetch('http://localhost:3001/api/settings/selected-intersection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intersectionId: selectedIntersectionId })
    }).catch(() => {})
    trendSetIntersection(selectedIntersectionId)
  }, [selectedIntersectionId]);

  const getTrafficLightColor = (status: number) => {
    switch (status) {
      case 0: return 'bg-red-500';
      case 1: return 'bg-yellow-500';
      case 2: return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const getTrafficLightText = (status: number) => {
    switch (status) {
      case 0: return '红灯';
      case 1: return '黄灯';
      case 2: return '绿灯';
      default: return '未知';
    }
  };

  const selectedLights = selectedIntersectionId == null
    ? []
    : trafficLights.filter(l => l.intersection_id === selectedIntersectionId)

  const monitorLights: Record<Direction, LightState> = (['North', 'South', 'East', 'West'] as Direction[]).reduce((acc, dir) => {
    const pick = (movement: 'straight' | 'left') =>
      selectedLights.find(l => l.direction === dir && (l.movement_type ?? 'straight') === movement)
      ?? selectedLights.find(l => l.direction === dir)

    const s = pick('straight')
    const l = pick('left')

    acc[dir] = {
      direction: dir,
      straight: {
        status: (s?.current_status ?? 0) as 0 | 1 | 2,
        remainingTime: Number(s?.remaining_time ?? 0),
        defaultGreenTime: Number(s?.default_green_time ?? 30),
      },
      left: {
        status: (l?.current_status ?? 0) as 0 | 1 | 2,
        remainingTime: Number(l?.remaining_time ?? 0),
        defaultGreenTime: Number(l?.default_green_time ?? 20),
      },
    }
    return acc
  }, {} as Record<Direction, LightState>)

  const queuesStraight: Record<Direction, number> = queueSnapshotSplit?.straight ?? {
    North: Math.round((queueSnapshot.North || 0) * 0.7),
    South: Math.round((queueSnapshot.South || 0) * 0.7),
    East: Math.round((queueSnapshot.East || 0) * 0.7),
    West: Math.round((queueSnapshot.West || 0) * 0.7),
  }
  const queuesLeft: Record<Direction, number> = queueSnapshotSplit?.left ?? {
    North: Math.round((queueSnapshot.North || 0) * 0.3),
    South: Math.round((queueSnapshot.South || 0) * 0.3),
    East: Math.round((queueSnapshot.East || 0) * 0.3),
    West: Math.round((queueSnapshot.West || 0) * 0.3),
  }

  const step: Step = selectedLights.some(l => l.current_status === 2)
    ? 'ACTIVE'
    : selectedLights.some(l => l.current_status === 1)
      ? 'YELLOW'
      : 'ALL_RED'

  const phase: Phase = (() => {
    const greens = selectedLights.filter(l => l.current_status === 2)
    const active = greens.length > 0 ? greens : selectedLights.filter(l => l.current_status === 1)
    const has = (dirs: Direction[], movement: 'straight' | 'left') =>
      active.some(l => (l.direction === dirs[0] || l.direction === dirs[1]) && (l.movement_type ?? 'straight') === movement)

    if (has(['East', 'West'], 'straight')) return 'EW_STRAIGHT'
    if (has(['East', 'West'], 'left')) return 'EW_LEFT'
    if (has(['North', 'South'], 'straight')) return 'NS_STRAIGHT'
    if (has(['North', 'South'], 'left')) return 'NS_LEFT'
    return 'EW_STRAIGHT'
  })()

  const greenLeft = Math.max(0, ...selectedLights.filter(l => l.current_status === 2).map(l => Number(l.remaining_time ?? 0)))
  const period = getTrafficPeriod()
  const periodLabel = period.label
  const periodLeft = Math.max(0, Math.floor((period.endsAt - Date.now()) / 1000))

  const greenDirs = {
    straight: step === 'ACTIVE' && phase === 'EW_STRAIGHT' ? (['East', 'West'] as Direction[]) :
      step === 'ACTIVE' && phase === 'NS_STRAIGHT' ? (['North', 'South'] as Direction[]) : ([] as Direction[]),
    left: step === 'ACTIVE' && phase === 'EW_LEFT' ? (['East', 'West'] as Direction[]) :
      step === 'ACTIVE' && phase === 'NS_LEFT' ? (['North', 'South'] as Direction[]) : ([] as Direction[]),
  }

  useEffect(() => {
    const w = new Worker(new URL('../workers/countdownWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onmessage = (e: MessageEvent) => {
      setDisplayLights(e.data.lights || []);
    };
    w.postMessage({ type: 'INIT', lights: trafficLights });
    w.postMessage({ type: 'TICK_START' });
    return () => {
      w.postMessage({ type: 'STOP' });
      w.terminate();
      workerRef.current = null;
    };
  }, []);

  // 趋势数据供折线图使用（总车流 = 四向之和）
  const baseData = trendStoreData
  const lineData = baseData.map(d => ({
    ...d,
    total: (d.North || 0) + (d.South || 0) + (d.East || 0) + (d.West || 0),
  }));

  const TrendTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const p = payload[0].payload as any;
    return (
      <div className="bg-white border border-gray-200 rounded-md p-3 shadow">
        <div className="text-sm font-medium text-gray-900 mb-1">{p.time}</div>
        <div className="text-xs text-gray-700 space-y-1">
          <div>总车流：{p.total}</div>
          <div>北向：{p.North}</div>
          <div>南向：{p.South}</div>
          <div>东向：{p.East}</div>
          <div>西向：{p.West}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">交通监控系统</h1>
        <div className="flex items-center space-x-4">
          <div className={`px-3 py-1 rounded-full text-sm font-medium ${
            emergencyStatus === 'normal' ? 'bg-green-100 text-green-800' :
            emergencyStatus === 'emergency' ? 'bg-red-100 text-red-800' :
            'bg-yellow-100 text-yellow-800'
          }`}>
            {emergencyStatus === 'normal' ? '正常运行' :
             emergencyStatus === 'emergency' ? '紧急模式' : '维护模式'}
          </div>
          <div className="text-sm text-gray-600">
            最后更新: {new Date().toLocaleTimeString()}
          </div>
        </div>
        <div className="mt-4 flex items-center space-x-3">
          <label className="text-sm text-gray-700">选择路口</label>
          <select
            value={selectedIntersectionId ?? ''}
            onChange={(e) => setSelectedIntersectionId(e.target.value ? Number(e.target.value) : null)}
            className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
          >
            {intersections.map(i => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          <label className="ml-4 flex items-center">
            <input
              type="checkbox"
              checked={aiEnabled}
              onChange={(e) => updateAiMode(e.target.checked)}
              className="mr-2"
            />
            <span className="text-sm text-gray-700">开启AI动态红绿灯</span>
          </label>
          {lastAiAdvice && (
            <div className="text-xs text-gray-600">
              AI建议: G {lastAiAdvice.green}s
            </div>
          )}
        </div>
        {selectedIntersectionId && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            {(() => {
              const current = intersections.find(i => i.id === selectedIntersectionId)
              const items = [
                { label: '北向下一路口', id: current?.next_north_id },
                { label: '南向下一路口', id: current?.next_south_id },
                { label: '东向下一路口', id: current?.next_east_id },
                { label: '西向下一路口', id: current?.next_west_id },
              ]
              return items.map((it, idx) => (
                <div key={idx} className="bg-white rounded-lg shadow p-3 flex items-center justify-between">
                  <span className="text-sm text-gray-700">{it.label}</span>
                  {it.id ? (
                    <button
                      onClick={() => setSelectedIntersectionId(it.id!)}
                      className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200"
                    >
                      跳转
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400">无</span>
                  )}
                </div>
              ))
            })()}
          </div>
        )}
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-blue-100 text-blue-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">活跃路口</p>
              <p className="text-2xl font-semibold text-gray-900">
                {intersections.filter(i => i.status === 1 || i.status === 'active').length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-green-100 text-green-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">总车流量</p>
              <p className="text-2xl font-semibold text-gray-900">
                {vehicleFlows.reduce((sum, flow) => sum + flow.vehicle_count, 0)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-yellow-100 text-yellow-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">平均等待时间</p>
              <p className="text-2xl font-semibold text-gray-900">{(() => {
                const Y = 3, R = 2
                const phaseOrder = ['EW_STRAIGHT','EW_LEFT','NS_STRAIGHT','NS_LEFT'] as const
                const idx = phaseOrder.indexOf(phase)
                const durations: Record<string, number> = {
                  EW_STRAIGHT: Math.max(monitorLights.East?.straight?.defaultGreenTime || 30, monitorLights.West?.straight?.defaultGreenTime || 30),
                  EW_LEFT: Math.max(monitorLights.East?.left?.defaultGreenTime || 20, monitorLights.West?.left?.defaultGreenTime || 20),
                  NS_STRAIGHT: Math.max(monitorLights.North?.straight?.defaultGreenTime || 30, monitorLights.South?.straight?.defaultGreenTime || 30),
                  NS_LEFT: Math.max(monitorLights.North?.left?.defaultGreenTime || 20, monitorLights.South?.left?.defaultGreenTime || 20),
                }
                const remActive = (() => {
                  if (step === 'ACTIVE') {
                    if (phase === 'EW_STRAIGHT') return Math.max(monitorLights.East?.straight?.remainingTime || 0, monitorLights.West?.straight?.remainingTime || 0)
                    if (phase === 'EW_LEFT') return Math.max(monitorLights.East?.left?.remainingTime || 0, monitorLights.West?.left?.remainingTime || 0)
                    if (phase === 'NS_STRAIGHT') return Math.max(monitorLights.North?.straight?.remainingTime || 0, monitorLights.South?.straight?.remainingTime || 0)
                    return Math.max(monitorLights.North?.left?.remainingTime || 0, monitorLights.South?.left?.remainingTime || 0)
                  }
                  const yRem = Math.max(
                    monitorLights.East?.straight?.status === 1 ? (monitorLights.East?.straight?.remainingTime || 0) : 0,
                    monitorLights.West?.straight?.status === 1 ? (monitorLights.West?.straight?.remainingTime || 0) : 0,
                    monitorLights.North?.straight?.status === 1 ? (monitorLights.North?.straight?.remainingTime || 0) : 0,
                    monitorLights.South?.straight?.status === 1 ? (monitorLights.South?.straight?.remainingTime || 0) : 0,
                    monitorLights.East?.left?.status === 1 ? (monitorLights.East?.left?.remainingTime || 0) : 0,
                    monitorLights.West?.left?.status === 1 ? (monitorLights.West?.left?.remainingTime || 0) : 0,
                    monitorLights.North?.left?.status === 1 ? (monitorLights.North?.left?.remainingTime || 0) : 0,
                    monitorLights.South?.left?.status === 1 ? (monitorLights.South?.left?.remainingTime || 0) : 0,
                  )
                  const rRem = Math.max(
                    monitorLights.East?.straight?.status === 0 ? (monitorLights.East?.straight?.remainingTime || 0) : 0,
                    monitorLights.West?.straight?.status === 0 ? (monitorLights.West?.straight?.remainingTime || 0) : 0,
                    monitorLights.North?.straight?.status === 0 ? (monitorLights.North?.straight?.remainingTime || 0) : 0,
                    monitorLights.South?.straight?.status === 0 ? (monitorLights.South?.straight?.remainingTime || 0) : 0,
                    monitorLights.East?.left?.status === 0 ? (monitorLights.East?.left?.remainingTime || 0) : 0,
                    monitorLights.West?.left?.status === 0 ? (monitorLights.West?.left?.remainingTime || 0) : 0,
                    monitorLights.North?.left?.status === 0 ? (monitorLights.North?.left?.remainingTime || 0) : 0,
                    monitorLights.South?.left?.status === 0 ? (monitorLights.South?.left?.remainingTime || 0) : 0,
                  )
                  if (step === 'YELLOW') return (yRem || Y) + R
                  if (step === 'ALL_RED') return (rRem || R)
                  return 0
                })()
                const timeToPhase = (target: string) => {
                  if (target === phase && step === 'ACTIVE') return 0
                  let total = remActive
                  let p = idx
                  while (true) {
                    // transition to next phase
                    total += Y + R
                    p = (p + 1) % phaseOrder.length
                    const ph = phaseOrder[p] as unknown as string
                    total += durations[ph]
                    if (ph === target) break
                  }
                  return total
                }
                const qNS_straight = (queuesStraight.North || 0) + (queuesStraight.South || 0)
                const qEW_straight = (queuesStraight.East || 0) + (queuesStraight.West || 0)
                const qNS_left = (queuesLeft.North || 0) + (queuesLeft.South || 0)
                const qEW_left = (queuesLeft.East || 0) + (queuesLeft.West || 0)
                const sumQ = qNS_straight + qEW_straight + qNS_left + qEW_left
                if (sumQ === 0) return '0s'
                const wNS = timeToPhase('NS_STRAIGHT') * qNS_straight
                const wEW = timeToPhase('EW_STRAIGHT') * qEW_straight
                const wNSL = timeToPhase('NS_LEFT') * qNS_left
                const wEWL = timeToPhase('EW_LEFT') * qEW_left
                const avg = (wNS + wEW + wNSL + wEWL) / sumQ
                return `${Math.round(avg)}s`
              })()}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-red-100 text-red-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">紧急事件</p>
              <p className="text-2xl font-semibold text-gray-900">0</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <IntersectionMonitor
          lights={monitorLights as any}
          queuesStraight={queuesStraight}
          queuesLeft={queuesLeft}
          phase={phase as any}
          step={step as any}
          periodLabel={periodLabel}
          periodLeft={periodLeft}
          greenLeft={greenLeft}
        />
        <FlowDots
          queuesStraight={queuesStraight}
          queuesLeft={queuesLeft}
          greenDirs={greenDirs as any}
          step={step as any}
        />
      </div>

      {/* 实时流量趋势 */}
      <div className="mt-8 bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">实时流量趋势</h2>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={lineData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip content={<TrendTooltip />} />
            <Line type="monotone" dataKey="total" stroke="#1f2937" name="总车流" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default Dashboard;
