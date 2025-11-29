const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { setCache, getCache, publishMessage } = require('../config/redis');

// 获取实时流量数据
router.get('/realtime/:intersectionId', async (req, res) => {
    try {
        const { intersectionId } = req.params;
        const cacheKey = `vehicle_flows:realtime:${intersectionId}`;
        
        // 尝试从缓存获取
        const cachedData = await getCache(cacheKey);
        if (cachedData) {
            return res.json({
                success: true,
                data: cachedData,
                fromCache: true
            });
        }
        
        // 获取最近5分钟的流量数据
        const [flowRows] = await pool.execute(`
            SELECT 
                id,
                direction,
                vehicle_count,
                average_speed,
                timestamp,
                created_at
            FROM vehicle_flows
            WHERE intersection_id = ? AND timestamp >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
            ORDER BY timestamp DESC
        `, [intersectionId]);
        
        // 计算汇总统计
        const summary = calculateFlowSummary(flowRows);
        
        const result = {
            flows: flowRows,
            summary: summary
        };
        
        // 缓存结果（30秒）
        await setCache(cacheKey, result, 30);
        
        res.json({
            success: true,
            data: result,
            fromCache: false
        });
    } catch (error) {
        console.error('获取实时流量失败:', error);
        res.status(500).json({
            success: false,
            message: '获取实时流量失败',
            error: error.message
        });
    }
});

// 获取历史流量统计
router.get('/statistics', async (req, res) => {
    try {
        const { intersectionId, period = 'hour' } = req.query;
        
        if (!intersectionId) {
            return res.status(400).json({
                success: false,
                message: '缺少路口ID参数'
            });
        }
        
        let timeCondition;
        let interval;
        switch (period) {
            case 'hour':
                timeCondition = "timestamp >= DATE_SUB(NOW(), INTERVAL 1 HOUR)";
                interval = "MINUTE";
                break;
            case 'day':
                timeCondition = "timestamp >= DATE_SUB(NOW(), INTERVAL 1 DAY)";
                interval = "HOUR";
                break;
            case 'week':
                timeCondition = "timestamp >= DATE_SUB(NOW(), INTERVAL 1 WEEK)";
                interval = "DAY";
                break;
            default:
                timeCondition = "timestamp >= DATE_SUB(NOW(), INTERVAL 1 HOUR)";
                interval = "MINUTE";
        }
        
        const [rows] = await pool.execute(`
            SELECT 
                direction,
                DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:00') as time_bucket,
                AVG(vehicle_count) as avg_vehicle_count,
                MAX(vehicle_count) as max_vehicle_count,
                MIN(vehicle_count) as min_vehicle_count,
                AVG(average_speed) as avg_speed,
                COUNT(*) as record_count
            FROM vehicle_flows
            WHERE intersection_id = ? AND ${timeCondition}
            GROUP BY direction, DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:00')
            ORDER BY time_bucket DESC, direction
        `, [intersectionId]);
        
        // 按时间段分组
        const statistics = groupStatisticsByTime(rows);
        
        res.json({
            success: true,
            data: {
                period: period,
                interval: interval,
                statistics: statistics
            }
        });
    } catch (error) {
        console.error('获取流量统计失败:', error);
        res.status(500).json({
            success: false,
            message: '获取流量统计失败',
            error: error.message
        });
    }
});

// 添加流量数据（模拟传感器数据）
router.post('/', async (req, res) => {
    try {
        const { intersectionId, direction, vehicleCount, averageSpeed } = req.body;
        
        if (!intersectionId || !direction || vehicleCount === undefined) {
            return res.status(400).json({
                success: false,
                message: '缺少必要参数'
            });
        }
        
        if (!['North', 'South', 'East', 'West'].includes(direction)) {
            return res.status(400).json({
                success: false,
                message: '无效的方向参数'
            });
        }
        
        const [result] = await pool.execute(`
            INSERT INTO vehicle_flows (intersection_id, direction, vehicle_count, average_speed)
            VALUES (?, ?, ?, ?)
        `, [intersectionId, direction, vehicleCount, averageSpeed || 0]);
        
        const flowData = {
            id: result.insertId,
            intersectionId,
            direction,
            vehicleCount,
            averageSpeed: averageSpeed || 0,
            timestamp: new Date()
        };
        
        // 发布实时数据到Redis
        await publishMessage('sensor:data', {
            sensorId: `sensor_${intersectionId}_${direction}`,
            intersectionId: intersectionId,
            direction: direction,
            vehicleCount: vehicleCount,
            averageSpeed: averageSpeed || 0,
            timestamp: new Date()
        });
        
        // 清除相关缓存
        await setCache(`vehicle_flows:realtime:${intersectionId}`, null, 0);
        
        res.json({
            success: true,
            data: flowData,
            message: '流量数据添加成功'
        });
    } catch (error) {
        console.error('添加流量数据失败:', error);
        res.status(500).json({
            success: false,
            message: '添加流量数据失败',
            error: error.message
        });
    }
});

// 批量添加流量数据
router.post('/batch', async (req, res) => {
    try {
        const { intersectionId, flowData } = req.body;
        
        if (!intersectionId || !Array.isArray(flowData) || flowData.length === 0) {
            return res.status(400).json({
                success: false,
                message: '缺少必要参数或参数格式错误'
            });
        }
        
        const insertPromises = flowData.map(async (data) => {
            const { direction, vehicleCount, averageSpeed } = data;
            
            if (!direction || vehicleCount === undefined) {
                throw new Error('流量数据缺少必要字段');
            }
            
            return pool.execute(`
                INSERT INTO vehicle_flows (intersection_id, direction, vehicle_count, average_speed)
                VALUES (?, ?, ?, ?)
            `, [intersectionId, direction, vehicleCount, averageSpeed || 0]);
        });
        
        const results = await Promise.all(insertPromises);
        
        // 发布批量数据到Redis
        const batchData = flowData.map((data, index) => ({
            sensorId: `sensor_${intersectionId}_${data.direction}`,
            intersectionId: intersectionId,
            direction: data.direction,
            vehicleCount: data.vehicleCount,
            averageSpeed: data.averageSpeed || 0,
            timestamp: new Date()
        }));
        
        await publishMessage('sensor:batch_data', {
            intersectionId: intersectionId,
            batchData: batchData,
            timestamp: new Date()
        });
        
        // 清除相关缓存
        await setCache(`vehicle_flows:realtime:${intersectionId}`, null, 0);
        
        res.json({
            success: true,
            message: '批量流量数据添加成功',
            data: {
                insertedCount: results.length,
                intersectionId: intersectionId
            }
        });
    } catch (error) {
        console.error('批量添加流量数据失败:', error);
        res.status(500).json({
            success: false,
            message: '批量添加流量数据失败',
            error: error.message
        });
    }
});

// 获取流量趋势分析
router.get('/trends/:intersectionId', async (req, res) => {
    try {
        const { intersectionId } = req.params;
        const { days = 7 } = req.query;
        
        const [rows] = await pool.execute(`
            SELECT 
                DATE(timestamp) as date,
                direction,
                COUNT(*) as record_count,
                SUM(vehicle_count) as total_vehicles,
                AVG(vehicle_count) as avg_vehicles,
                MAX(vehicle_count) as peak_vehicles,
                MIN(vehicle_count) as min_vehicles,
                AVG(average_speed) as avg_speed
            FROM vehicle_flows
            WHERE intersection_id = ? AND timestamp >= DATE_SUB(NOW(), INTERVAL ? DAY)
            GROUP BY DATE(timestamp), direction
            ORDER BY date DESC, direction
        `, [intersectionId, days]);
        
        // 按日期分组
        const trends = groupTrendsByDate(rows);
        
        res.json({
            success: true,
            data: {
                intersectionId: intersectionId,
                days: days,
                trends: trends
            }
        });
    } catch (error) {
        console.error('获取流量趋势失败:', error);
        res.status(500).json({
            success: false,
            message: '获取流量趋势失败',
            error: error.message
        });
    }
});

// 获取高峰时段分析
router.get('/peak-hours/:intersectionId', async (req, res) => {
    try {
        const { intersectionId } = req.params;
        const { days = 7 } = req.query;
        
        const [rows] = await pool.execute(`
            SELECT 
                HOUR(timestamp) as hour,
                direction,
                COUNT(*) as record_count,
                SUM(vehicle_count) as total_vehicles,
                AVG(vehicle_count) as avg_vehicles,
                MAX(vehicle_count) as peak_vehicles
            FROM vehicle_flows
            WHERE intersection_id = ? AND timestamp >= DATE_SUB(NOW(), INTERVAL ? DAY)
            GROUP BY HOUR(timestamp), direction
            ORDER BY hour, direction
        `, [intersectionId, days]);
        
        // 分析高峰时段
        const peakHours = analyzePeakHours(rows);
        
        res.json({
            success: true,
            data: {
                intersectionId: intersectionId,
                days: days,
                peakHours: peakHours
            }
        });
    } catch (error) {
        console.error('获取高峰时段分析失败:', error);
        res.status(500).json({
            success: false,
            message: '获取高峰时段分析失败',
            error: error.message
        });
    }
});

// 辅助函数：计算流量汇总
function calculateFlowSummary(flowRows) {
    if (flowRows.length === 0) {
        return {
            totalVehicles: 0,
            averageSpeed: 0,
            peakDirection: null,
            directionStats: {}
        };
    }
    
    const directionStats = {};
    let totalVehicles = 0;
    let totalSpeed = 0;
    let maxFlow = 0;
    let peakDirection = null;
    
    flowRows.forEach(row => {
        const { direction, vehicle_count, average_speed } = row;
        
        if (!directionStats[direction]) {
            directionStats[direction] = {
                totalVehicles: 0,
                recordCount: 0,
                avgSpeed: 0
            };
        }
        
        directionStats[direction].totalVehicles += vehicle_count;
        directionStats[direction].recordCount += 1;
        directionStats[direction].avgSpeed = (
            (directionStats[direction].avgSpeed * (directionStats[direction].recordCount - 1) + average_speed) /
            directionStats[direction].recordCount
        );
        
        totalVehicles += vehicle_count;
        totalSpeed += average_speed;
        
        if (vehicle_count > maxFlow) {
            maxFlow = vehicle_count;
            peakDirection = direction;
        }
    });
    
    return {
        totalVehicles,
        averageSpeed: totalSpeed / flowRows.length,
        peakDirection,
        directionStats
    };
}

// 辅助函数：按时间分组统计
function groupStatisticsByTime(rows) {
    const statistics = {};
    
    rows.forEach(row => {
        const timeKey = row.time_bucket;
        if (!statistics[timeKey]) {
            statistics[timeKey] = {};
        }
        
        statistics[timeKey][row.direction] = {
            avgVehicleCount: row.avg_vehicle_count,
            maxVehicleCount: row.max_vehicle_count,
            minVehicleCount: row.min_vehicle_count,
            avgSpeed: row.avg_speed,
            recordCount: row.record_count
        };
    });
    
    return statistics;
}

// 辅助函数：按日期分组趋势
function groupTrendsByDate(rows) {
    const trends = {};
    
    rows.forEach(row => {
        const dateKey = row.date;
        if (!trends[dateKey]) {
            trends[dateKey] = {};
        }
        
        trends[dateKey][row.direction] = {
            totalVehicles: row.total_vehicles,
            avgVehicles: row.avg_vehicles,
            peakVehicles: row.peak_vehicles,
            minVehicles: row.min_vehicles,
            avgSpeed: row.avg_speed,
            recordCount: row.record_count
        };
    });
    
    return trends;
}

// 辅助函数：分析高峰时段
function analyzePeakHours(rows) {
    const peakHours = {};
    
    rows.forEach(row => {
        const hour = row.hour;
        if (!peakHours[hour]) {
            peakHours[hour] = {};
        }
        
        peakHours[hour][row.direction] = {
            totalVehicles: row.total_vehicles,
            avgVehicles: row.avg_vehicles,
            peakVehicles: row.peak_vehicles,
            recordCount: row.record_count
        };
    });
    
    // 找出总体高峰时段
    const hourlyTotals = {};
    Object.keys(peakHours).forEach(hour => {
        hourlyTotals[hour] = Object.values(peakHours[hour])
            .reduce((sum, direction) => sum + direction.totalVehicles, 0);
    });
    
    const sortedHours = Object.entries(hourlyTotals)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3); // 前3个高峰时段
    
    return {
        hourlyStats: peakHours,
        peakHours: sortedHours.map(([hour, total]) => ({ hour: parseInt(hour), totalVehicles: total }))
    };
}

// 获取流量数据（带时间范围）
router.get('/', async (req, res) => {
    try {
        const { time_range = 'day', intersection_id } = req.query;
        
        let timeCondition;
        switch (time_range) {
            case 'hour':
                timeCondition = "timestamp >= DATE_SUB(NOW(), INTERVAL 1 HOUR)";
                break;
            case 'day':
                timeCondition = "timestamp >= DATE_SUB(NOW(), INTERVAL 1 DAY)";
                break;
            case 'week':
                timeCondition = "timestamp >= DATE_SUB(NOW(), INTERVAL 1 WEEK)";
                break;
            case 'month':
                timeCondition = "timestamp >= DATE_SUB(NOW(), INTERVAL 1 MONTH)";
                break;
            default:
                timeCondition = "timestamp >= DATE_SUB(NOW(), INTERVAL 1 DAY)";
        }
        
        let whereClause = `WHERE ${timeCondition}`;
        let queryParams = [];
        
        if (intersection_id) {
            whereClause += ' AND intersection_id = ?';
            queryParams.push(intersection_id);
        }
        
        const [rows] = await pool.execute(`
            SELECT 
                id,
                intersection_id,
                direction,
                vehicle_count,
                average_speed,
                timestamp,
                created_at
            FROM vehicle_flows
            ${whereClause}
            ORDER BY timestamp DESC
        `, queryParams);
        
        res.json({
            success: true,
            data: rows,
            count: rows.length,
            time_range: time_range
        });
    } catch (error) {
        console.error('获取流量数据失败:', error);
        res.status(500).json({
            success: false,
            message: '获取流量数据失败',
            error: error.message
        });
    }
});

// 获取流量分析数据
router.get('/analytics', async (req, res) => {
    try {
        const { time_range = 'day', intersection_id } = req.query;
        
        let timeCondition;
        switch (time_range) {
            case 'hour':
                timeCondition = "timestamp >= DATE_SUB(NOW(), INTERVAL 1 HOUR)";
                break;
            case 'day':
                timeCondition = "timestamp >= DATE_SUB(NOW(), INTERVAL 1 DAY)";
                break;
            case 'week':
                timeCondition = "timestamp >= DATE_SUB(NOW(), INTERVAL 1 WEEK)";
                break;
            case 'month':
                timeCondition = "timestamp >= DATE_SUB(NOW(), INTERVAL 1 MONTH)";
                break;
            default:
                timeCondition = "timestamp >= DATE_SUB(NOW(), INTERVAL 1 DAY)";
        }
        
        let whereClause = `WHERE ${timeCondition}`;
        let queryParams = [];
        
        if (intersection_id) {
            whereClause += ' AND intersection_id = ?';
            queryParams.push(intersection_id);
        }
        
        // 总体统计
        const [overallStats] = await pool.execute(`
            SELECT 
                COUNT(*) as total_records,
                SUM(vehicle_count) as total_vehicles,
                AVG(vehicle_count) as avg_vehicles,
                MAX(vehicle_count) as max_vehicles,
                MIN(vehicle_count) as min_vehicles,
                AVG(average_speed) as avg_speed
            FROM vehicle_flows
            ${whereClause}
        `, queryParams);
        
        // 按方向统计
        const [directionStats] = await pool.execute(`
            SELECT 
                direction,
                COUNT(*) as record_count,
                SUM(vehicle_count) as total_vehicles,
                AVG(vehicle_count) as avg_vehicles,
                MAX(vehicle_count) as max_vehicles,
                MIN(vehicle_count) as min_vehicles,
                AVG(average_speed) as avg_speed
            FROM vehicle_flows
            ${whereClause}
            GROUP BY direction
            ORDER BY total_vehicles DESC
        `, queryParams);
        
        // 按小时统计
        const [hourlyStats] = await pool.execute(`
            SELECT 
                HOUR(timestamp) as hour,
                COUNT(*) as record_count,
                SUM(vehicle_count) as total_vehicles,
                AVG(vehicle_count) as avg_vehicles,
                AVG(average_speed) as avg_speed
            FROM vehicle_flows
            ${whereClause}
            GROUP BY HOUR(timestamp)
            ORDER BY hour
        `, queryParams);
        
        res.json({
            success: true,
            data: {
                time_range: time_range,
                overall: overallStats[0],
                byDirection: directionStats,
                byHour: hourlyStats
            }
        });
    } catch (error) {
        console.error('获取流量分析失败:', error);
        res.status(500).json({
            success: false,
            message: '获取流量分析失败',
            error: error.message
        });
    }
});

// 获取指定路口的流量数据
router.get('/intersection/:intersectionId', async (req, res) => {
    try {
        const { intersectionId } = req.params;
        const { limit = 100 } = req.query;
        
        const [rows] = await pool.execute(`
            SELECT 
                id,
                intersection_id,
                direction,
                vehicle_count,
                average_speed,
                timestamp,
                created_at
            FROM vehicle_flows
            WHERE intersection_id = ?
            ORDER BY timestamp DESC
            LIMIT ?
        `, [intersectionId, parseInt(limit)]);
        
        res.json({
            success: true,
            data: rows,
            count: rows.length,
            intersectionId: intersectionId
        });
    } catch (error) {
        console.error('获取路口流量数据失败:', error);
        res.status(500).json({
            success: false,
            message: '获取路口流量数据失败',
            error: error.message
        });
    }
});

module.exports = router;