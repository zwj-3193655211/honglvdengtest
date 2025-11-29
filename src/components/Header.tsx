import React, { useState, useEffect } from 'react';
import { Bell, User, AlertTriangle, Clock } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

const Header: React.FC = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [notifications, setNotifications] = useState(0);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    // 更新时间
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    // 连接WebSocket
    const newSocket = io('http://localhost:3001');
    setSocket(newSocket);

    newSocket.on('emergencyModeChanged', (data) => {
      setEmergencyMode(data.enabled);
    });

    newSocket.on('newNotification', () => {
      setNotifications(prev => prev + 1);
    });

    return () => {
      clearInterval(timer);
      newSocket.close();
    };
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <header className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        {/* 左侧标题 */}
        <div className="flex items-center space-x-4">
          <h1 className="text-2xl font-bold text-gray-900">智能交通管理系统</h1>
          {emergencyMode && (
            <div className="flex items-center px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-medium">
              <AlertTriangle className="h-4 w-4 mr-1" />
              紧急模式
            </div>
          )}
        </div>

        {/* 右侧信息 */}
        <div className="flex items-center space-x-6">
          {/* 系统时间 */}
          <div className="flex items-center text-gray-600">
            <Clock className="h-5 w-5 mr-2" />
            <span className="text-sm font-medium">{formatTime(currentTime)}</span>
          </div>

          {/* 通知 */}
          <div className="relative">
            <button className="p-2 text-gray-400 hover:text-gray-600 transition-colors relative">
              <Bell className="h-5 w-5" />
              {notifications > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {notifications > 99 ? '99+' : notifications}
                </span>
              )}
            </button>
          </div>

          {/* 用户菜单 */}
          <div className="flex items-center space-x-3">
            <div className="text-right">
              <div className="text-sm font-medium text-gray-900">管理员</div>
              <div className="text-xs text-gray-500">在线</div>
            </div>
            <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
              <User className="h-4 w-4 text-white" />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;