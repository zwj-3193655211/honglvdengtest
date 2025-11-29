import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import IntersectionList from './pages/IntersectionList';
import IntersectionDetail from './pages/IntersectionDetail';
import TrafficControl from './pages/TrafficControl';
import FlowAnalytics from './pages/FlowAnalytics';
import EmergencyManagement from './pages/EmergencyManagement';
import Settings from './pages/Settings';
import Demo from './pages/Demo';

function App() {
  return (
    <Router>
      <div className="App flex h-screen bg-gray-100">
        <Toaster position="top-right" richColors />
        <Sidebar />
        <div className="flex-1 flex flex-col">
          <Header />
          <main className="flex-1 overflow-y-auto p-4">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/intersections" element={<IntersectionList />} />
              <Route path="/intersections/:id" element={<IntersectionDetail />} />
              <Route path="/traffic-control" element={<TrafficControl />} />
              <Route path="/flow-analytics" element={<FlowAnalytics />} />
              <Route path="/emergency" element={<EmergencyManagement />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/demo" element={<Demo />} />
            </Routes>
          </main>
        </div>
      </div>
    </Router>
  );
}

export default App;
