const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const { initializeDatabase } = require('./config/database');
const { initializeRedis, closeRedis } = require('./config/redis');

// 路由导入
const intersectionRoutes = require('./routes/intersections');
const trafficLightRoutes = require('./routes/trafficLights');
const vehicleFlowRoutes = require('./routes/vehicleFlows');
const emergencyVehicleRoutes = require('./routes/emergencyVehicles');
const trafficAlgorithmRoutes = require('./routes/trafficAlgorithm');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: process.env.NODE_ENV === 'production' ? false : ["http://localhost:3000"],
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3001;
const WS_PORT = process.env.WS_PORT || 3002;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 全局错误处理
app.use((err, req, res, next) => {
    console.error('全局错误处理:', err);
    res.status(500).json({
        success: false,
        message: '服务器内部错误',
        error: process.env.NODE_ENV === 'development' ? err.message : 'Internal Server Error'
    });
});

// 路由注册
app.use('/api/intersections', intersectionRoutes);
app.use('/api/traffic-lights', trafficLightRoutes);
app.use('/api/vehicle-flows', vehicleFlowRoutes);
app.use('/api/emergency-vehicles', emergencyVehicleRoutes);
app.use('/api/traffic-algorithm', trafficAlgorithmRoutes);

// 健康检查接口
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: '服务器运行正常',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// WebSocket连接处理
io.on('connection', (socket) => {
    console.log('客户端已连接:', socket.id);
    
    // 加入路口房间
    socket.on('join_intersection', (intersectionId) => {
        socket.join(`intersection_${intersectionId}`);
        console.log(`客户端 ${socket.id} 加入路口 ${intersectionId}`);
    });
    
    // 离开路口房间
    socket.on('leave_intersection', (intersectionId) => {
        socket.leave(`intersection_${intersectionId}`);
        console.log(`客户端 ${socket.id} 离开路口 ${intersectionId}`);
    });
    
    // 紧急情况报告
    socket.on('emergency_report', (data) => {
        console.log('收到紧急情况报告:', data);
        // 广播给所有客户端
        io.emit('emergency_update', data);
    });
    
    socket.on('disconnect', () => {
        console.log('客户端已断开连接:', socket.id);
    });
});

// 定时任务：更新红绿灯状态
let trafficLightInterval;
  function startTrafficLightScheduler() {
    trafficLightInterval = setInterval(async () => {
      try {
            const [paramsRows] = await pool.execute(
                `SELECT intersection_id, window_seconds, low_flow_threshold, min_green_floor FROM intersection_params`
            );
            const defaultWindow = parseInt(process.env.LOW_FLOW_WINDOW_SECONDS || '10');
            const defaultThreshold = parseInt(process.env.LOW_FLOW_THRESHOLD || '5');
            const defaultMinGreen = parseInt(process.env.MIN_GREEN_FLOOR_SECONDS || '5');
            const paramsMap = new Map();
            for (const r of paramsRows) {
                paramsMap.set(r.intersection_id, {
                    window: r.window_seconds ?? defaultWindow,
                    threshold: r.low_flow_threshold ?? defaultThreshold,
                    minGreen: r.min_green_floor ?? defaultMinGreen,
                });
            }
        // 这里可以添加红绿灯状态更新逻辑
        // 例如：减少剩余时间，切换状态等
        const { pool } = require('./config/database');
            
            // 获取所有需要更新的红绿灯
            const [lights] = await pool.execute(`
                SELECT id, intersection_id, direction, current_status, remaining_time 
                FROM traffic_lights 
                WHERE remaining_time > 0
            `);
            
            for (const light of lights) {
                let newRemainingTime = light.remaining_time - 1;
                let newStatus = light.current_status;

                if (newStatus === 2) {
                    const pair = (light.direction === 'North' || light.direction === 'South') ? ['North', 'South'] : ['East', 'West'];
                    const cfg = paramsMap.get(light.intersection_id) || { window: defaultWindow, threshold: defaultThreshold, minGreen: defaultMinGreen };
                    const [flowSumRows] = await pool.execute(
                        `SELECT COALESCE(SUM(vehicle_count),0) AS cnt 
                         FROM vehicle_flows 
                         WHERE intersection_id = ? AND direction IN (?, ?) 
                         AND timestamp >= DATE_SUB(NOW(), INTERVAL ? SECOND)`,
                        [light.intersection_id, pair[0], pair[1], cfg.window]
                    );
                    const lowFlow = (flowSumRows[0]?.cnt ?? 0) < cfg.threshold;
                    if (lowFlow && newRemainingTime > cfg.minGreen) {
                        newRemainingTime = cfg.minGreen;
                    }
                }
                
                if (newRemainingTime <= 0) {
                    // 需要切换状态
                    newRemainingTime = 0;
                    
                    switch (newStatus) {
                        case 0: // 红灯 -> 绿灯
                            newStatus = 2;
                            newRemainingTime = light.default_green_time || 30; // 默认绿灯时间
                            break;
                        case 1: // 黄灯 -> 红灯
                            newStatus = 0;
                            newRemainingTime = light.default_red_time || 30; // 默认红灯时间
                            break;
                        case 2: // 绿灯 -> 黄灯
                            newStatus = 1;
                            newRemainingTime = 3; // 黄灯时间
                            break;
                    }
                    
                    await pool.execute(`
                        UPDATE traffic_lights 
                        SET current_status = ?, remaining_time = ?, updated_at = NOW()
                        WHERE id = ?
                    `, [newStatus, newRemainingTime, light.id]);
                    
                    // 发送WebSocket更新（房间 + 全局）
                    io.to(`intersection_${light.intersection_id}`).emit('light_status_update', {
                        lightId: light.id,
                        status: newStatus,
                        remainingTime: newRemainingTime,
                        direction: light.direction
                    });
                    io.emit('light_status_update', {
                        lightId: light.id,
                        status: newStatus,
                        remainingTime: newRemainingTime,
                        direction: light.direction
                    });
                } else {
                    // 只更新时间
                    await pool.execute(`
                        UPDATE traffic_lights 
                        SET remaining_time = ?, updated_at = NOW()
                        WHERE id = ?
                    `, [newRemainingTime, light.id]);
                    
                    // 发送WebSocket更新（房间 + 全局）
                    io.to(`intersection_${light.intersection_id}`).emit('light_status_update', {
                        lightId: light.id,
                        status: newStatus,
                        remainingTime: newRemainingTime,
                        direction: light.direction
                    });
                    io.emit('light_status_update', {
                        lightId: light.id,
                        status: newStatus,
                        remainingTime: newRemainingTime,
                        direction: light.direction
                    });
                }
            }

            // 聚合并广播每个路口的最新状态（全局）
            const updatedIntersections = [...new Set(lights.map(l => l.intersection_id))];
            for (const intersectionId of updatedIntersections) {
                const [updated] = await pool.execute(
                    `SELECT id, intersection_id, direction, current_status, remaining_time, default_green_time, default_red_time, default_yellow_time FROM traffic_lights WHERE intersection_id = ? ORDER BY phase_number, direction`,
                    [intersectionId]
                );
                io.emit('trafficLightUpdate', updated);
            }
            
        } catch (error) {
            console.error('更新红绿灯状态失败:', error);
        }
    }, 1000); // 每秒更新一次
}

// 初始化服务
async function initializeServices() {
    try {
        console.log('正在初始化服务...');
        
        // 初始化数据库
        const dbInitialized = await initializeDatabase();
        if (!dbInitialized) {
            throw new Error('数据库初始化失败');
        }
        
        // 初始化Redis
        const redisInitialized = await initializeRedis();
        if (!redisInitialized) {
            console.warn('Redis初始化失败，继续启动服务...');
        }
        
        // 启动红绿灯调度器
        startTrafficLightScheduler();
        
        console.log('服务初始化完成');
        return true;
    } catch (error) {
        console.error('服务初始化失败:', error);
        return false;
    }
}

// 优雅关闭
async function gracefulShutdown() {
    console.log('正在关闭服务...');
    
    // 停止定时器
    if (trafficLightInterval) {
        clearInterval(trafficLightInterval);
    }
    
    // 关闭WebSocket服务器
    io.close();
    
    // 关闭Redis连接
    await closeRedis();
    
    console.log('服务已关闭');
    process.exit(0);
}

// 启动服务器
async function startServer() {
    try {
        // 初始化服务
        const initialized = await initializeServices();
        if (!initialized) {
            console.error('服务初始化失败，退出程序');
            process.exit(1);
        }
        
        // 启动HTTP服务器
        server.listen(PORT, () => {
            console.log(`服务器运行在端口 ${PORT}`);
            console.log(`WebSocket服务器运行在端口 ${WS_PORT}`);
        });
        
        // 注册信号处理
        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGINT', gracefulShutdown);
        
    } catch (error) {
        console.error('启动服务器失败:', error);
        process.exit(1);
    }
}

// 启动服务
startServer();
