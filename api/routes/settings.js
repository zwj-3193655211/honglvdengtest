const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { setCache, getCache, delCache } = require('../config/redis');

// 获取系统设置
router.get('/', async (req, res) => {
    try {
        const cacheKey = 'system:settings';
        
        // 尝试从缓存获取
        const cachedData = await getCache(cacheKey);
        if (cachedData) {
            return res.json({
                success: true,
                data: cachedData,
                fromCache: true
            });
        }
        
        // 从数据库获取
        const [rows] = await pool.execute('SELECT * FROM system_settings ORDER BY id DESC LIMIT 1');
        
        if (rows.length === 0) {
            // 如果没有设置，创建默认设置
            const defaultSettings = {
                system_name: '智能交通管理系统',
                auto_mode: true,
                emergency_priority: true,
                max_cycle_length: 180,
                min_cycle_length: 60,
                yellow_light_duration: 3,
                detection_radius: 100,
                update_interval: 5
            };
            
            const [result] = await pool.execute(
                `INSERT INTO system_settings (system_name, auto_mode, emergency_priority, max_cycle_length, 
                 min_cycle_length, yellow_light_duration, detection_radius, update_interval) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    defaultSettings.system_name,
                    defaultSettings.auto_mode,
                    defaultSettings.emergency_priority,
                    defaultSettings.max_cycle_length,
                    defaultSettings.min_cycle_length,
                    defaultSettings.yellow_light_duration,
                    defaultSettings.detection_radius,
                    defaultSettings.update_interval
                ]
            );
            
            defaultSettings.id = result.insertId;
            defaultSettings.created_at = new Date();
            defaultSettings.updated_at = new Date();
            
            // 缓存结果（1小时）
            await setCache(cacheKey, defaultSettings, 3600);
            
            return res.json({
                success: true,
                data: defaultSettings,
                fromCache: false
            });
        }
        
        const settings = rows[0];
        
        // 缓存结果（1小时）
        await setCache(cacheKey, settings, 3600);
        
        res.json({
            success: true,
            data: settings,
            fromCache: false
        });
    } catch (error) {
        console.error('获取系统设置失败:', error);
        res.status(500).json({
            success: false,
            message: '获取系统设置失败',
            error: error.message
        });
    }
});

// 更新系统设置
router.put('/', async (req, res) => {
    try {
        const {
            system_name,
            auto_mode,
            emergency_priority,
            max_cycle_length,
            min_cycle_length,
            yellow_light_duration,
            detection_radius,
            update_interval
        } = req.body;
        
        // 验证输入
        if (!system_name || max_cycle_length < min_cycle_length) {
            return res.status(400).json({
                success: false,
                message: '参数验证失败'
            });
        }
        
        // 获取当前设置
        const [currentRows] = await pool.execute('SELECT id FROM system_settings ORDER BY id DESC LIMIT 1');
        
        if (currentRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '系统设置不存在'
            });
        }
        
        const settingsId = currentRows[0].id;
        
        // 更新设置
        await pool.execute(
            `UPDATE system_settings SET 
             system_name = ?, auto_mode = ?, emergency_priority = ?, max_cycle_length = ?, 
             min_cycle_length = ?, yellow_light_duration = ?, detection_radius = ?, 
             update_interval = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [
                system_name,
                auto_mode,
                emergency_priority,
                max_cycle_length,
                min_cycle_length,
                yellow_light_duration,
                detection_radius,
                update_interval,
                settingsId
            ]
        );
        
        // 获取更新后的设置
        const [updatedRows] = await pool.execute('SELECT * FROM system_settings WHERE id = ?', [settingsId]);
        const updatedSettings = updatedRows[0];
        
        // 清除缓存
        await delCache('system:settings');
        
        res.json({
            success: true,
            message: '系统设置更新成功',
            data: updatedSettings
        });
    } catch (error) {
        console.error('更新系统设置失败:', error);
        res.status(500).json({
            success: false,
            message: '更新系统设置失败',
            error: error.message
        });
    }
});

// 重置系统设置为默认值
router.post('/reset', async (req, res) => {
    try {
        // 获取当前设置ID
        const [currentRows] = await pool.execute('SELECT id FROM system_settings ORDER BY id DESC LIMIT 1');
        
        if (currentRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '系统设置不存在'
            });
        }
        
        const settingsId = currentRows[0].id;
        
        // 默认设置
        const defaultSettings = {
            system_name: '智能交通管理系统',
            auto_mode: true,
            emergency_priority: true,
            max_cycle_length: 180,
            min_cycle_length: 60,
            yellow_light_duration: 3,
            detection_radius: 100,
            update_interval: 5
        };
        
        // 重置为默认值
        await pool.execute(
            `UPDATE system_settings SET 
             system_name = ?, auto_mode = ?, emergency_priority = ?, max_cycle_length = ?, 
             min_cycle_length = ?, yellow_light_duration = ?, detection_radius = ?, 
             update_interval = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [
                defaultSettings.system_name,
                defaultSettings.auto_mode,
                defaultSettings.emergency_priority,
                defaultSettings.max_cycle_length,
                defaultSettings.min_cycle_length,
                defaultSettings.yellow_light_duration,
                defaultSettings.detection_radius,
                defaultSettings.update_interval,
                settingsId
            ]
        );
        
        // 获取重置后的设置
        const [resetRows] = await pool.execute('SELECT * FROM system_settings WHERE id = ?', [settingsId]);
        const resetSettings = resetRows[0];
        
        // 清除缓存
        await delCache('system:settings');
        
        res.json({
            success: true,
            message: '系统设置已重置为默认值',
            data: resetSettings
        });
    } catch (error) {
        console.error('重置系统设置失败:', error);
        res.status(500).json({
            success: false,
            message: '重置系统设置失败',
            error: error.message
        });
    }
});

module.exports = router;
router.get('/intersection-params/:intersectionId', async (req, res) => {
    try {
        const { intersectionId } = req.params;
        const [rows] = await pool.execute(
            `SELECT intersection_id, window_seconds, low_flow_threshold, min_green_floor FROM intersection_params WHERE intersection_id = ?`,
            [intersectionId]
        );
        if (rows.length === 0) {
            const defaults = {
                intersection_id: parseInt(intersectionId),
                window_seconds: parseInt(process.env.LOW_FLOW_WINDOW_SECONDS || '10'),
                low_flow_threshold: parseInt(process.env.LOW_FLOW_THRESHOLD || '5'),
                min_green_floor: parseInt(process.env.MIN_GREEN_FLOOR_SECONDS || '5'),
            };
            return res.json({ success: true, data: defaults });
        }
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: '获取路口参数失败', error: error.message });
    }
});

router.put('/intersection-params/:intersectionId', async (req, res) => {
    try {
        const { intersectionId } = req.params;
        const { window_seconds, low_flow_threshold, min_green_floor } = req.body;
        const [exists] = await pool.execute(
            `SELECT intersection_id FROM intersection_params WHERE intersection_id = ?`,
            [intersectionId]
        );
        if (exists.length === 0) {
            await pool.execute(
                `INSERT INTO intersection_params (intersection_id, window_seconds, low_flow_threshold, min_green_floor) VALUES (?, ?, ?, ?)`,
                [intersectionId, window_seconds, low_flow_threshold, min_green_floor]
            );
        } else {
            await pool.execute(
                `UPDATE intersection_params SET window_seconds = ?, low_flow_threshold = ?, min_green_floor = ?, updated_at = NOW() WHERE intersection_id = ?`,
                [window_seconds, low_flow_threshold, min_green_floor, intersectionId]
            );
        }
        const [rows] = await pool.execute(
            `SELECT intersection_id, window_seconds, low_flow_threshold, min_green_floor FROM intersection_params WHERE intersection_id = ?`,
            [intersectionId]
        );
        res.json({ success: true, message: '路口参数已更新', data: rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: '更新路口参数失败', error: error.message });
    }
});
