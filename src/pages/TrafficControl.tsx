import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

interface TrafficLightRow {
  id: number;
  intersection_id: number;
  direction: string;
  current_status: number; // 0:red,1:yellow,2:green
  remaining_time: number;
  default_green_time: number;
  default_red_time: number;
  default_yellow_time: number;
}

interface IntersectionRow {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  status: number | string;
}

const TrafficControl: React.FC = () => {
  const [trafficLights, setTrafficLights] = useState<TrafficLightRow[]>([]);
  const [displayLights, setDisplayLights] = useState<TrafficLightRow[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const [intersections, setIntersections] = useState<IntersectionRow[]>([]);
  const [selectedIntersection, setSelectedIntersection] = useState<number>(1);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchIntersections();
    fetchTrafficLights();
  }, []);

  useEffect(() => {
    const s = io('http://localhost:3001');
    s.on('trafficLightUpdate', (data: any) => {
      setTrafficLights(data);
      setDisplayLights(data);
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'INIT', lights: data });
      }
    });
    s.on('light_status_update', (data: any) => {
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
    return () => { s.close(); };
  }, []);

  useEffect(() => {
    if (selectedIntersection) {
      fetchTrafficLights();
    }
  }, [selectedIntersection]);

  const fetchIntersections = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/intersections');
      const json = await response.json();
      setIntersections(json.data || []);
    } catch (error) {
      console.error('获取路口信息失败:', error);
    }
  };

  const fetchTrafficLights = async () => {
    try {
      const response = await fetch(`http://localhost:3001/api/traffic-lights?intersection_id=${selectedIntersection}`);
      const json = await response.json();
      setTrafficLights(json.data || []);
      setDisplayLights(json.data || []);
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'INIT', lights: json.data || [] });
      }
    } catch (error) {
      console.error('获取红绿灯信息失败:', error);
    }
  };

  const updateTrafficLight = async (lightId: number, newState: 'red' | 'yellow' | 'green') => {
    setIsLoading(true);
    try {
      const response = await fetch(`http://localhost:3001/api/traffic-lights/${lightId}/state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newState }),
      });

      if (response.ok) {
        setMessage('红绿灯状态更新成功');
        fetchTrafficLights(); // 刷新数据
        setTimeout(() => setMessage(''), 3000);
      } else {
        const error = await response.json();
        setMessage(`更新失败: ${error.message}`);
        setTimeout(() => setMessage(''), 5000);
      }
    } catch (error) {
      setMessage('网络错误，请稍后重试');
      setTimeout(() => setMessage(''), 5000);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleAutomaticMode = async (lightId: number, isAutomatic: boolean) => {
    setIsLoading(true);
    try {
      const response = await fetch(`http://localhost:3001/api/traffic-lights/${lightId}/mode`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode: isAutomatic ? 'auto' : 'manual' }),
      });

      if (response.ok) {
        setMessage(`已切换到${isAutomatic ? '自动' : '手动'}模式`);
        fetchTrafficLights();
        setTimeout(() => setMessage(''), 3000);
      } else {
        const error = await response.json();
        setMessage(`模式切换失败: ${error.message}`);
        setTimeout(() => setMessage(''), 5000);
      }
    } catch (error) {
      setMessage('网络错误，请稍后重试');
      setTimeout(() => setMessage(''), 5000);
    } finally {
      setIsLoading(false);
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

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">交通灯控制面板</h1>
        <p className="text-gray-600">手动控制红绿灯状态和切换模式</p>
      </div>

      {/* 消息提示 */}
      {message && (
        <div className={`mb-4 p-4 rounded-lg ${
          message.includes('成功') || message.includes('已切换') 
            ? 'bg-green-100 text-green-800 border border-green-200' 
            : 'bg-red-100 text-red-800 border border-red-200'
        }`}>
          {message}
        </div>
      )}

      {/* 路口选择 */}
      <div className="mb-6 bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">选择路口</h2>
        <select 
          value={selectedIntersection} 
          onChange={(e) => setSelectedIntersection(Number(e.target.value))}
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          {(intersections || []).map((intersection) => (
            <option key={intersection.id} value={intersection.id}>
              {intersection.name} - {intersection.latitude},{intersection.longitude}
            </option>
          ))}
        </select>
      </div>

      {/* 红绿灯控制面板 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {(displayLights || []).map((light) => (
          <div key={light.id} className="bg-white rounded-lg shadow-md p-6">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-800">{light.direction}</h3>
              <div className="flex items-center mt-2">
                <div className={`w-4 h-4 rounded-full ${getTrafficLightColor(light.current_status)} mr-2`}></div>
                <span className="text-sm text-gray-600">
                  {getTrafficLightText(light.current_status)} - {light.remaining_time}s
                </span>
              </div>
            </div>

            {/* 模式切换 */}
            <div className="mb-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={(e) => toggleAutomaticMode(light.id, e.target.checked)}
                  disabled={isLoading}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700">自动模式</span>
              </label>
            </div>

            {/* 手动控制按钮 */}
            {true && (
              <div className="space-y-2">
                <button
                  onClick={() => updateTrafficLight(light.id, 'red')}
                  disabled={isLoading || light.current_status === 0}
                  className={`w-full py-2 px-4 rounded-lg font-medium ${
                    light.current_status === 0
                      ? 'bg-red-500 text-white cursor-not-allowed'
                      : 'bg-red-100 text-red-700 hover:bg-red-200'
                  }`}
                >
                  红灯
                </button>
                <button
                  onClick={() => updateTrafficLight(light.id, 'yellow')}
                  disabled={isLoading || light.current_status === 1}
                  className={`w-full py-2 px-4 rounded-lg font-medium ${
                    light.current_status === 1
                      ? 'bg-yellow-500 text-white cursor-not-allowed'
                      : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                  }`}
                >
                  黄灯
                </button>
                <button
                  onClick={() => updateTrafficLight(light.id, 'green')}
                  disabled={isLoading || light.current_status === 2}
                  className={`w-full py-2 px-4 rounded-lg font-medium ${
                    light.current_status === 2
                      ? 'bg-green-500 text-white cursor-not-allowed'
                      : 'bg-green-100 text-green-700 hover:bg-green-200'
                  }`}
                >
                  绿灯
                </button>
              </div>
            )}

            {/* 自动模式提示 */}
            {false && (
              <div className="text-center py-2 px-4 bg-blue-100 text-blue-700 rounded-lg">
                自动运行中...
              </div>
            )}

            {/* 时序信息 */}
            <div className="mt-4 text-xs text-gray-500">
              <div>默认绿灯: {light.default_green_time}s</div>
              <div>默认黄灯: {light.default_yellow_time}s</div>
              <div>默认红灯: {light.default_red_time}s</div>
            </div>
          </div>
        ))}
      </div>

      {/* 批量操作 */}
      <div className="mt-8 bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">批量操作</h2>
        <div className="flex space-x-4">
          <button
            onClick={async () => {
              setIsLoading(true);
              try {
                const response = await fetch('http://localhost:3001/api/traffic-lights/emergency/all-red', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                });
                if (response.ok) {
                  setMessage('所有方向已设置为红灯');
                  fetchTrafficLights();
                  setTimeout(() => setMessage(''), 3000);
                }
              } catch (error) {
                setMessage('操作失败，请稍后重试');
                setTimeout(() => setMessage(''), 5000);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
          >
            全红灯模式
          </button>
          <button
            onClick={async () => {
              setIsLoading(true);
              try {
                const response = await fetch('http://localhost:3001/api/traffic-lights/emergency/flash-yellow', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                });
                if (response.ok) {
                  setMessage('已切换到黄闪模式');
                  fetchTrafficLights();
                  setTimeout(() => setMessage(''), 3000);
                }
              } catch (error) {
                setMessage('操作失败，请稍后重试');
                setTimeout(() => setMessage(''), 5000);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            className="px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50"
          >
            黄闪模式
          </button>
          <button
            onClick={async () => {
              setIsLoading(true);
              try {
                const response = await fetch('http://localhost:3001/api/traffic-lights/restore-normal', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                });
                if (response.ok) {
                  setMessage('已恢复正常运行模式');
                  fetchTrafficLights();
                  setTimeout(() => setMessage(''), 3000);
                }
              } catch (error) {
                setMessage('操作失败，请稍后重试');
                setTimeout(() => setMessage(''), 5000);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
          >
            恢复正常
          </button>
        </div>
      </div>
    </div>
  );
};

export default TrafficControl;
