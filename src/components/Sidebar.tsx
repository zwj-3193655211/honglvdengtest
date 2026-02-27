import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  TrafficCone, 
  Car, 
  Activity, 
  AlertTriangle, 
  Settings,
  MapPin,
  BarChart3
} from 'lucide-react';

const menuItems = [
  {
    path: '/',
    icon: LayoutDashboard,
    label: '仪表盘',
    description: '系统概览'
  },
  {
    path: '/intersections',
    icon: MapPin,
    label: '路口管理',
    description: '路口配置'
  },
  {
    path: '/traffic-control',
    icon: TrafficCone,
    label: '交通控制',
    description: '手动控制'
  },
  {
    path: '/emergency',
    icon: AlertTriangle,
    label: '紧急管理',
    description: '应急处理'
  },
  {
    path: '/demo',
    icon: Activity,
    label: '功能演示',
    description: '虚拟路口'
  },
  {
    path: '/settings',
    icon: Settings,
    label: '系统设置',
    description: '配置参数'
  }
];

const Sidebar: React.FC = () => {
  return (
    <div className="w-64 bg-gray-900 text-white flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-gray-800">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Car className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold">智能交通</h2>
            <p className="text-xs text-gray-400">管理系统</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  className={({ isActive }) => `
                    flex items-center p-3 rounded-lg transition-all duration-200
                    ${isActive 
                      ? 'bg-blue-600 text-white shadow-lg' 
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    }
                  `}
                >
                  <Icon className="h-5 w-5 mr-3" />
                  <div className="flex-1">
                    <div className="font-medium">{item.label}</div>
                    <div className="text-xs opacity-75">{item.description}</div>
                  </div>
                  {item.path === '/emergency' && (
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* System Status */}
      <div className="p-4 border-t border-gray-800">
        <div className="bg-gray-800 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">系统状态</span>
            <div className="flex items-center">
              <div className="w-2 h-2 bg-green-500 rounded-full mr-1 animate-pulse"></div>
              <span className="text-xs text-green-400">运行中</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">连接状态</span>
            <div className="flex items-center">
              <div className="w-2 h-2 bg-blue-500 rounded-full mr-1"></div>
              <span className="text-xs text-blue-400">已连接</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
