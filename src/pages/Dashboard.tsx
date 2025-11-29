import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import io from 'socket.io-client';

interface TrafficLight {
  id: number;
  intersection_id: number;
  direction: string;
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
}

const Dashboard: React.FC = () => {
  const [trafficLights, setTrafficLights] = useState<TrafficLight[]>([]);
  const [displayLights, setDisplayLights] = useState<TrafficLight[]>([]);
  const [vehicleFlows, setVehicleFlows] = useState<VehicleFlow[]>([]);
  const [intersections, setIntersections] = useState<Intersection[]>([]);
  const [socket, setSocket] = useState<any>(null);
  const [emergencyStatus, setEmergencyStatus] = useState<string>('normal');
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    // 初始化WebSocket连接
    const newSocket = io('http://localhost:3001');
    setSocket(newSocket);

    // 监听红绿灯状态更新
    newSocket.on('trafficLightUpdate', (data: TrafficLight[]) => {
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

    // 监听车流量更新
    newSocket.on('vehicleFlowUpdate', (data: VehicleFlow[]) => {
      setVehicleFlows(data);
    });

    // 监听紧急情况
    newSocket.on('emergencyMode', (status: string) => {
      setEmergencyStatus(status);
    });

    // 获取初始数据
    fetchInitialData();

    return () => {
      newSocket.close();
    };
  }, []);

  const fetchInitialData = async () => {
    try {
      const intersectionsRes = await fetch('http://localhost:3001/api/intersections');
      const intersectionsJson = await intersectionsRes.json();
      setIntersections(intersectionsJson.data || []);

      const trafficLightsRes = await fetch('http://localhost:3001/api/traffic-lights');
      const trafficLightsJson = await trafficLightsRes.json();
      setTrafficLights(trafficLightsJson.data || []);
      setDisplayLights(trafficLightsJson.data || []);
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'INIT', lights: trafficLightsJson.data || [] });
      }

      const flowsRes = await fetch('http://localhost:3001/api/vehicle-flows');
      const flowsJson = await flowsRes.json();
      setVehicleFlows(flowsJson.data || []);
    } catch (error) {
      console.error('获取初始数据失败:', error);
    }
  };

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

  // 准备图表数据
  const flowChartData = vehicleFlows.map(flow => ({
    direction: flow.direction,
    vehicleCount: flow.vehicle_count,
    avgSpeed: flow.average_speed,
    time: new Date(flow.timestamp).toLocaleTimeString()
  }));

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
              <p className="text-2xl font-semibold text-gray-900">45s</p>
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
        {/* 红绿灯状态监控 */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">红绿灯状态监控</h2>
          <div className="grid grid-cols-2 gap-4">
            {displayLights.map((light) => (
              <div key={light.id} className="border rounded-lg p-4 bg-gray-50">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-700">{light.direction}</span>
                  <div className={`w-4 h-4 rounded-full ${getTrafficLightColor(light.current_status)}`}></div>
                </div>
                <div className="text-sm text-gray-600">
                  <div>状态: {getTrafficLightText(light.current_status)}</div>
                  <div>剩余时间: {light.remaining_time}s</div>
                  <div>默认绿灯: {light.default_green_time}s</div>
                  <div>默认红灯: {light.default_red_time}s</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 车流量实时监控 */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">车流量实时监控</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={flowChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="direction" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="vehicleCount" fill="#3B82F6" name="车辆数量" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 实时流量趋势 */}
      <div className="mt-8 bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">实时流量趋势</h2>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={flowChartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="vehicleCount" stroke="#3B82F6" name="车辆数量" strokeWidth={2} />
            <Line type="monotone" dataKey="avgSpeed" stroke="#10B981" name="平均速度" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default Dashboard;
