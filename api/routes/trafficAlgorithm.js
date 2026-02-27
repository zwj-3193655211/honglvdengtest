import express from 'express';
const router = express.Router();
import * as db from '../config/database.js';
import * as redisCfg from '../config/redis.js';

// 动态红绿灯算法类
class AdaptiveTrafficAlgorithm {
    constructor() {
        this.MIN_GREEN_TIME = 15;
        this.MAX_GREEN_TIME = 120;
        this.FLOW_WEIGHT = 0.7;
        this.SPEED_WEIGHT = 0.3;
        this.YELLOW_TIME = 3;
    }

    // 计算最优时序
    calculateOptimalTiming(flowData) {
        if (!flowData || flowData.length === 0) {
            return this.getDefaultTiming();
        }

        // 1. 计算各方向权重
        const weights = this.calculateDirectionWeights(flowData);
        
        // 2. 基于权重分配绿灯时间
        const totalGreenTime = this.calculateTotalGreenTime(flowData);
        const greenTimes = this.allocateGreenTime(weights, totalGreenTime);
        
        // 3. 计算红灯时间（基于对向绿灯时间）
        const redTimes = this.calculateRedTime(greenTimes);
        
        return {
            greenTimes,
            redTimes,
            yellowTime: this.YELLOW_TIME,
            totalCycleTime: this.calculateTotalCycleTime(greenTimes, redTimes)
        };
    }

    // 计算方向权重
    calculateDirectionWeights(flowData) {
        const weights = {};
        let totalWeightedScore = 0;

        flowData.forEach(data => {
            const flowScore = data.vehicleCount * this.FLOW_WEIGHT;
            const speedScore = (data.averageSpeed / 60) * this.SPEED_WEIGHT;
            weights[data.direction] = flowScore + speedScore;
            totalWeightedScore += weights[data.direction];
        });

        // 归一化权重
        Object.keys(weights).forEach(direction => {
            weights[direction] = weights[direction] / totalWeightedScore;
        });

        return weights;
    }

    // 计算总绿灯时间
    calculateTotalGreenTime(flowData) {
        const totalFlow = flowData.reduce((sum, data) => sum + data.vehicleCount, 0);
        
        if (totalFlow < 10) return 60;  // 低流量
        if (totalFlow < 30) return 90;  // 中等流量
        if (totalFlow < 60) return 120; // 高流量
        return 150; // 极高流量
    }

    // 分配绿灯时间
    allocateGreenTime(weights, totalTime) {
        const greenTimes = {};
        
        Object.keys(weights).forEach(direction => {
            greenTimes[direction] = Math.round(totalTime * weights[direction]);
            // 确保在最小和最大范围内
            greenTimes[direction] = Math.max(this.MIN_GREEN_TIME, 
                Math.min(this.MAX_GREEN_TIME, greenTimes[direction]));
        });

        return greenTimes;
    }

    // 计算红灯时间
    calculateRedTime(greenTimes) {
        const redTimes = {};
        const directions = ['North', 'South', 'East', 'West'];
        
        directions.forEach(direction => {
            const oppositeDirection = this.getOppositeDirection(direction);
            redTimes[direction] = (greenTimes[oppositeDirection] || 0) + this.YELLOW_TIME;
        });

        return redTimes;
    }

    // 获取对向方向
    getOppositeDirection(direction) {
        const opposites = {
            'North': 'South',
            'South': 'North',
            'East': 'West',
            'West': 'East'
        };
        return opposites[direction] || direction;
    }

    // 计算总周期时间
    calculateTotalCycleTime(greenTimes, redTimes) {
        const maxGreenTime = Math.max(...Object.values(greenTimes));
        const maxRedTime = Math.max(...Object.values(redTimes));
        return maxGreenTime + maxRedTime + this.YELLOW_TIME;
    }

    // 获取默认时序
    getDefaultTiming() {
        return {
            greenTimes: {
                'North': 30,
                'South': 30,
                'East': 30,
                'West': 30
            },
            redTimes: {
                'North': 33,
                'South': 33,
                'East': 33,
                'West': 33
            },
            yellowTime: this.YELLOW_TIME,
            totalCycleTime: 66
        };
    }
}

// 创建算法实例
const algorithm = new AdaptiveTrafficAlgorithm();

// 获取当前时序建议
router.get('/current-timing/:intersectionId', async (req, res) => {
    try {
        const { intersectionId } = req.params;
        const cacheKey = `algorithm:timing:${intersectionId}`;
        
        // 尝试从缓存获取
        const cachedData = await redisCfg.getCache(cacheKey);
        if (cachedData) {
            return res.json({
                success: true,
                data: cachedData,
                fromCache: true
            });
        }
        
        // 获取最近5分钟的流量数据
        const [flowRows] = await db.pool.execute(`
            SELECT direction, vehicle_count, average_speed, timestamp
            FROM vehicle_flows
            WHERE intersection_id = ? AND timestamp >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
            ORDER BY timestamp DESC
        `, [intersectionId]);
        
        if (flowRows.length === 0) {
            const defaultTiming = algorithm.getDefaultTiming();
            return res.json({
                success: true,
                data: {
                    timing: defaultTiming,
                    basedOnFlow: false,
                    flowData: [],
                    lastUpdate: new Date()
                }
            });
        }
        
        // 按方向聚合数据
        const directionData = aggregateFlowData(flowRows);
        
        // 计算最优时序
        const optimalTiming = algorithm.calculateOptimalTiming(directionData);
        
        const result = {
            timing: optimalTiming,
            basedOnFlow: true,
            flowData: directionData,
            lastUpdate: new Date()
        };
        
        // 缓存结果（2分钟）
        await redisCfg.setCache(cacheKey, result, 120);
        
        res.json({
            success: true,
            data: result,
            fromCache: false
        });
    } catch (error) {
        console.error('获取当前时序建议失败:', error);
        res.status(500).json({
            success: false,
            message: '获取当前时序建议失败',
            error: error.message
        });
    }
});

// 应用时序建议
router.post('/apply-timing/:intersectionId', async (req, res) => {
    try {
        const { intersectionId } = req.params;
        const { timing, timingType = 'dynamic' } = req.body;
        
        if (!timing || !timing.greenTimes) {
            return res.status(400).json({
                success: false,
                message: '缺少时序数据'
            });
        }
        
        // 获取当前红绿灯配置
        const [currentLights] = await db.pool.execute(`
            SELECT id, direction, current_status, remaining_time
            FROM traffic_lights
            WHERE intersection_id = ?
        `, [intersectionId]);
        
        if (currentLights.length === 0) {
            return res.status(404).json({
                success: false,
                message: '路口红绿灯配置不存在'
            });
        }
        
        // 应用新的时序配置
        const updatePromises = currentLights.map(async (light) => {
            const direction = light.direction;
            const greenTime = timing.greenTimes[direction] || 30;
            const redTime = timing.redTimes[direction] || 30;
            const yellowTime = timing.yellowTime || 3;
            
            // 记录时序变更
            return db.pool.execute(`
                INSERT INTO light_timings (traffic_light_id, green_time, red_time, yellow_time, timing_type)
                VALUES (?, ?, ?, ?, ?)
            `, [light.id, greenTime, redTime, yellowTime, timingType]);
        });
        
        await Promise.all(updatePromises);
        
        // 更新当前红绿灯的默认时序（可选）
        if (timingType === 'dynamic') {
            const defaultUpdatePromises = currentLights.map(async (light) => {
                const direction = light.direction;
                const greenTime = timing.greenTimes[direction] || 30;
                const redTime = timing.redTimes[direction] || 30;
                const yellowTime = timing.yellowTime || 3;
                
                return db.pool.execute(`
                    UPDATE traffic_lights 
                    SET default_green_time = ?, default_red_time = ?, default_yellow_time = ?
                    WHERE id = ?
                `, [greenTime, redTime, yellowTime, light.id]);
            });
            
            await Promise.all(defaultUpdatePromises);
        }
        
        // 发布时序更新消息
        await redisCfg.publishMessage('traffic_algorithm:timing_update', {
            intersectionId,
            timing,
            timingType,
            timestamp: new Date()
        });
        
        // 清除相关缓存
        await redisCfg.setCache(`algorithm:timing:${intersectionId}`, null, 0);
        await redisCfg.setCache(`traffic_lights:${intersectionId}`, null, 0);
        
        res.json({
            success: true,
            message: '时序应用成功',
            data: {
                intersectionId,
                timing,
                timingType,
                appliedAt: new Date()
            }
        });
    } catch (error) {
        console.error('应用时序建议失败:', error);
        res.status(500).json({
            success: false,
            message: '应用时序建议失败',
            error: error.message
        });
    }
});

// 获取算法参数
router.get('/parameters', (req, res) => {
    try {
        const parameters = {
            minGreenTime: algorithm.MIN_GREEN_TIME,
            maxGreenTime: algorithm.MAX_GREEN_TIME,
            flowWeight: algorithm.FLOW_WEIGHT,
            speedWeight: algorithm.SPEED_WEIGHT,
            yellowTime: algorithm.YELLOW_TIME
        };
        
        res.json({
            success: true,
            data: parameters
        });
    } catch (error) {
        console.error('获取算法参数失败:', error);
        res.status(500).json({
            success: false,
            message: '获取算法参数失败',
            error: error.message
        });
    }
});

// 更新算法参数
router.put('/parameters', (req, res) => {
    try {
        const { minGreenTime, maxGreenTime, flowWeight, speedWeight, yellowTime } = req.body;
        
        // 验证参数
        if (minGreenTime !== undefined && (minGreenTime < 5 || minGreenTime > 60)) {
            return res.status(400).json({
                success: false,
                message: '最小绿灯时间必须在5-60秒之间'
            });
        }
        
        if (maxGreenTime !== undefined && (maxGreenTime < 30 || maxGreenTime > 300)) {
            return res.status(400).json({
                success: false,
                message: '最大绿灯时间必须在30-300秒之间'
            });
        }
        
        if (flowWeight !== undefined && (flowWeight < 0 || flowWeight > 1)) {
            return res.status(400).json({
                success: false,
                message: '流量权重必须在0-1之间'
            });
        }
        
        if (speedWeight !== undefined && (speedWeight < 0 || speedWeight > 1)) {
            return res.status(400).json({
                success: false,
                message: '速度权重必须在0-1之间'
            });
        }
        
        if (yellowTime !== undefined && (yellowTime < 2 || yellowTime > 10)) {
            return res.status(400).json({
                success: false,
                message: '黄灯时间必须在2-10秒之间'
            });
        }
        
        // 更新参数
        if (minGreenTime !== undefined) algorithm.MIN_GREEN_TIME = minGreenTime;
        if (maxGreenTime !== undefined) algorithm.MAX_GREEN_TIME = maxGreenTime;
        if (flowWeight !== undefined) algorithm.FLOW_WEIGHT = flowWeight;
        if (speedWeight !== undefined) algorithm.SPEED_WEIGHT = speedWeight;
        if (yellowTime !== undefined) algorithm.YELLOW_TIME = yellowTime;
        
        // 发布参数更新消息
        redisCfg.publishMessage('traffic_algorithm:parameters_updated', {
            parameters: {
                minGreenTime: algorithm.MIN_GREEN_TIME,
                maxGreenTime: algorithm.MAX_GREEN_TIME,
                flowWeight: algorithm.FLOW_WEIGHT,
                speedWeight: algorithm.SPEED_WEIGHT,
                yellowTime: algorithm.YELLOW_TIME
            },
            timestamp: new Date()
        });
        
        res.json({
            success: true,
            message: '算法参数更新成功',
            data: {
                minGreenTime: algorithm.MIN_GREEN_TIME,
                maxGreenTime: algorithm.MAX_GREEN_TIME,
                flowWeight: algorithm.FLOW_WEIGHT,
                speedWeight: algorithm.SPEED_WEIGHT,
                yellowTime: algorithm.YELLOW_TIME
            }
        });
    } catch (error) {
        console.error('更新算法参数失败:', error);
        res.status(500).json({
            success: false,
            message: '更新算法参数失败',
            error: error.message
        });
    }
});

// 获取算法历史表现
router.get('/performance/:intersectionId', async (req, res) => {
    try {
        const { intersectionId } = req.params;
        const { days = 7 } = req.query;
        
        // 获取时序历史数据
        const [timingHistory] = await db.pool.execute(`
            SELECT 
                lt.created_at,
                lt.green_time,
                lt.red_time,
                lt.yellow_time,
                lt.timing_type,
                tl.direction
            FROM light_timings lt
            JOIN traffic_lights tl ON lt.traffic_light_id = tl.id
            WHERE tl.intersection_id = ? AND lt.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
            ORDER BY lt.created_at DESC
        `, [intersectionId, days]);
        
        // 获取流量数据
        const [flowData] = await db.pool.execute(`
            SELECT 
                DATE(timestamp) as date,
                direction,
                AVG(vehicle_count) as avg_vehicles,
                MAX(vehicle_count) as max_vehicles,
                AVG(average_speed) as avg_speed
            FROM vehicle_flows
            WHERE intersection_id = ? AND timestamp >= DATE_SUB(NOW(), INTERVAL ? DAY)
            GROUP BY DATE(timestamp), direction
            ORDER BY date DESC
        `, [intersectionId, days]);
        
        // 计算性能指标
        const performance = calculatePerformanceMetrics(timingHistory, flowData);
        
        res.json({
            success: true,
            data: {
                intersectionId,
                period: `${days} days`,
                performance
            }
        });
    } catch (error) {
        console.error('获取算法性能失败:', error);
        res.status(500).json({
            success: false,
            message: '获取算法性能失败',
            error: error.message
        });
    }
});

// 辅助函数：聚合流量数据
function aggregateFlowData(flowRows) {
    const directionData = {};
    
    flowRows.forEach(row => {
        if (!directionData[row.direction]) {
            directionData[row.direction] = {
                direction: row.direction,
                vehicleCount: 0,
                averageSpeed: 0,
                recordCount: 0
            };
        }
        
        directionData[row.direction].vehicleCount += row.vehicle_count;
        directionData[row.direction].averageSpeed += row.average_speed;
        directionData[row.direction].recordCount += 1;
    });
    
    // 计算平均值
    Object.keys(directionData).forEach(direction => {
        const data = directionData[direction];
        data.averageSpeed = data.recordCount > 0 ? data.averageSpeed / data.recordCount : 0;
    });
    
    return Object.values(directionData);
}

// 辅助函数：计算性能指标
function calculatePerformanceMetrics(timingHistory, flowData) {
    if (timingHistory.length === 0) {
        return {
            totalAdjustments: 0,
            avgGreenTime: 0,
            efficiency: 0,
            adaptationRate: 0
        };
    }
    
    const totalAdjustments = timingHistory.length;
    const dynamicAdjustments = timingHistory.filter(t => t.timing_type === 'dynamic').length;
    const avgGreenTime = timingHistory.reduce((sum, t) => sum + t.green_time, 0) / totalAdjustments;
    
    // 简单的效率计算（基于绿灯时间利用率）
    const efficiency = Math.min(100, (avgGreenTime / 60) * 100); // 以60秒为基准
    
    // 自适应率（动态调整占比）
    const adaptationRate = totalAdjustments > 0 ? (dynamicAdjustments / totalAdjustments) * 100 : 0;
    
    return {
        totalAdjustments,
        dynamicAdjustments,
        manualAdjustments: timingHistory.filter(t => t.timing_type === 'manual').length,
        emergencyAdjustments: timingHistory.filter(t => t.timing_type === 'emergency').length,
        avgGreenTime: Math.round(avgGreenTime * 100) / 100,
        efficiency: Math.round(efficiency * 100) / 100,
        adaptationRate: Math.round(adaptationRate * 100) / 100
    };
}

export default router;
