import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';

interface VehicleFlowRow {
  id: number;
  intersection_id: number;
  direction: string;
  vehicle_count: number;
  average_speed: number;
  timestamp: string;
}

interface TrafficAnalytics {
  peak_hours: Array<{ hour: number; total_flow: number }>;
  direction_distribution: Array<{ direction: string; percentage: number; count: number }>;
  speed_analysis: {
    avg_speed: number;
    max_speed: number;
    min_speed: number;
    speed_distribution: Array<{ range: string; count: number }>;
  };
}

const FlowAnalytics: React.FC = () => {
  const [vehicleFlows, setVehicleFlows] = useState<VehicleFlowRow[]>([]);
  const [analytics, setAnalytics] = useState<TrafficAnalytics | null>(null);
  const [timeRange, setTimeRange] = useState<'hour' | 'day' | 'week'>('day');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchVehicleFlows();
    fetchAnalytics();
  }, [timeRange]);

  const fetchVehicleFlows = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`http://localhost:3001/api/vehicle-flows?time_range=${timeRange}`);
      const json = await response.json();
      setVehicleFlows(json.data || []);
    } catch (error) {
      console.error('获取车流量数据失败:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const response = await fetch(`http://localhost:3001/api/vehicle-flows/analytics?time_range=${timeRange}`);
      const json = await response.json();
      const byHour = (json.data?.byHour || []) as Array<{ hour: number; total_vehicles: number; avg_speed: number }>;
      const byDirection = (json.data?.byDirection || []) as Array<{ direction: string; total_vehicles: number }>;
      const overall = json.data?.overall || { avg_speed: 0 };

      const peak_hours = byHour.map(h => ({ hour: h.hour, total_flow: h.total_vehicles }));
      const totalVehiclesAll = byDirection.reduce((s, d) => s + (d.total_vehicles || 0), 0) || 1;
      const direction_distribution = byDirection.map(d => ({
        direction: d.direction,
        count: d.total_vehicles || 0,
        percentage: ((d.total_vehicles || 0) / totalVehiclesAll) * 100,
      }));

      const speeds = (vehicleFlows || []).map(v => v.average_speed || 0);
      const max_speed = speeds.length ? Math.max(...speeds) : 0;
      const min_speed = speeds.length ? Math.min(...speeds) : 0;
      const speed_distribution = bucketSpeeds(speeds);

      const normalized: TrafficAnalytics = {
        peak_hours,
        direction_distribution,
        speed_analysis: {
          avg_speed: Number(overall.avg_speed || 0),
          max_speed,
          min_speed,
          speed_distribution,
        },
      };
      setAnalytics(normalized);
    } catch (error) {
      console.error('获取分析数据失败:', error);
    }
  };

  // 准备图表数据
  const flowTrendData = vehicleFlows.map(flow => ({
    time: new Date(flow.timestamp).toLocaleTimeString(),
    vehicleCount: flow.vehicle_count,
    avgSpeed: flow.average_speed,
    direction: flow.direction
  }));

  const pieChartData = (analytics?.direction_distribution || []).map(item => ({
    name: getDirectionText(item.direction),
    value: item.count,
    color: '#3B82F6',
  }));

  const getDirectionText = (direction: string) => {
    switch (direction) {
      case 'north': return '北向';
      case 'south': return '南向';
      case 'east': return '东向';
      case 'west': return '西向';
      default: return direction;
    }
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">车流量分析</h1>
          <p className="text-gray-600">实时车流量统计和趋势分析</p>
        </div>
        
        {/* 时间范围选择器 */}
        <div className="flex space-x-2">
          {[{ value: 'hour', label: '近1小时' }, { value: 'day', label: '近1天' }, { value: 'week', label: '近7天' }].map((option) => (
            <button
              key={option.value}
              onClick={() => setTimeRange(option.value as any)}
              className={`px-4 py-2 rounded-lg font-medium ${
                timeRange === option.value
                  ? 'bg-blue-500 text-white'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* 统计概览 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-blue-100 text-blue-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
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
            <div className="p-3 rounded-full bg-green-100 text-green-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">平均速度</p>
              <p className="text-2xl font-semibold text-gray-900">
                {analytics?.speed_analysis?.avg_speed?.toFixed(1) || 0} km/h
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
              <p className="text-sm font-medium text-gray-600">高峰时段</p>
              <p className="text-2xl font-semibold text-gray-900">
                {analytics?.peak_hours?.[0]?.hour || 0}:00
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-purple-100 text-purple-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">主要方向</p>
              <p className="text-2xl font-semibold text-gray-900">
                {analytics?.direction_distribution?.[0]?.direction || '北向'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* 车流量趋势 */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">车流量趋势</h2>
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={flowTrendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="vehicleCount" stroke="#3B82F6" name="车辆数量" strokeWidth={2} />
                <Line type="monotone" dataKey="avgSpeed" stroke="#10B981" name="平均速度" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 车辆类型分布 */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">方向占比</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={pieChartData}
                cx="50%"
                cy="50%"
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {pieChartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 方向分布 */}
      {analytics && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">方向流量分布</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={analytics.direction_distribution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="direction" tickFormatter={getDirectionText} />
              <YAxis />
              <Tooltip formatter={(value, name) => [value, '车辆数量']} />
              <Bar dataKey="count" fill="#3B82F6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 高峰时段分析 */}
      {analytics && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">高峰时段分析</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={analytics.peak_hours}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" tickFormatter={(hour) => `${hour}:00`} />
              <YAxis />
              <Tooltip formatter={(value, name) => [value, '车流量']} />
              <Bar dataKey="total_flow" fill="#10B981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 速度分析 */}
      {analytics && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">速度分析</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600">{analytics?.speed_analysis?.avg_speed?.toFixed(1) || 0}</div>
              <div className="text-sm text-gray-600">平均速度 (km/h)</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-600">{analytics?.speed_analysis?.max_speed?.toFixed(1) || 0}</div>
              <div className="text-sm text-gray-600">最高速度 (km/h)</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-red-600">{analytics?.speed_analysis?.min_speed?.toFixed(1) || 0}</div>
              <div className="text-sm text-gray-600">最低速度 (km/h)</div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={analytics?.speed_analysis?.speed_distribution || []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="range" />
              <YAxis />
              <Tooltip formatter={(value, name) => [value, '车辆数量']} />
              <Bar dataKey="count" fill="#F59E0B" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

function bucketSpeeds(speeds: number[]) {
  const buckets = [
    { range: '0-20', count: 0 },
    { range: '20-40', count: 0 },
    { range: '40-60', count: 0 },
    { range: '60-80', count: 0 },
    { range: '80+', count: 0 },
  ];
  speeds.forEach((s) => {
    if (s < 20) buckets[0].count++;
    else if (s < 40) buckets[1].count++;
    else if (s < 60) buckets[2].count++;
    else if (s < 80) buckets[3].count++;
    else buckets[4].count++;
  });
  return buckets;
}

export default FlowAnalytics;
