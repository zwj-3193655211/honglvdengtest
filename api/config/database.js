const mysql = require('mysql2/promise');
require('dotenv').config();

// 创建数据库连接池
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'traffic_light_system',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// 测试数据库连接
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('数据库连接成功');
        connection.release();
        return true;
    } catch (error) {
        console.error('数据库连接失败:', error);
        return false;
    }
}

// 初始化数据库表
async function initializeDatabase() {
    try {
        // 创建数据库（如果不存在）
        const createDbSQL = `
            CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME || 'traffic_light_system'}
            CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        `;
        
        const tempPool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 3306,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || 'password'
        });

        await tempPool.execute(createDbSQL);
        await tempPool.end();

        await createTables();
        await ensureSchema();
        console.log('数据库初始化完成');
        return true;
    } catch (error) {
        console.error('数据库初始化失败:', error);
        return false;
    }
}

// 创建数据表
async function createTables() {
    const createIntersectionsTable = `
        CREATE TABLE IF NOT EXISTS intersections (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(100) NOT NULL,
            latitude DECIMAL(10, 8) NOT NULL,
            longitude DECIMAL(11, 8) NOT NULL,
            status TINYINT DEFAULT 1 COMMENT '1-正常, 0-维护中',
            auto_mode TINYINT DEFAULT 1 COMMENT '1-自动, 0-手动',
            current_phase TINYINT DEFAULT 1,
            cycle_length INT DEFAULT 120,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_status (status),
            INDEX idx_location (latitude, longitude)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    const createTrafficLightsTable = `
        CREATE TABLE IF NOT EXISTS traffic_lights (
            id INT PRIMARY KEY AUTO_INCREMENT,
            intersection_id INT NOT NULL,
            direction VARCHAR(20) NOT NULL COMMENT 'N/S/E/W',
            phase_number TINYINT NOT NULL COMMENT '相位号',
            current_status TINYINT DEFAULT 0 COMMENT '0-红, 1-黄, 2-绿',
            default_green_time INT DEFAULT 30,
            default_red_time INT DEFAULT 30,
            default_yellow_time INT DEFAULT 3,
            remaining_time INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (intersection_id) REFERENCES intersections(id) ON DELETE CASCADE,
            INDEX idx_intersection (intersection_id),
            INDEX idx_status (current_status),
            UNIQUE KEY uniq_light (intersection_id, direction)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    const createVehicleFlowsTable = `
        CREATE TABLE IF NOT EXISTS vehicle_flows (
            id INT PRIMARY KEY AUTO_INCREMENT,
            intersection_id INT NOT NULL,
            direction VARCHAR(20) NOT NULL,
            vehicle_count INT NOT NULL,
            average_speed DECIMAL(5,2) DEFAULT 0.00,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (intersection_id) REFERENCES intersections(id) ON DELETE CASCADE,
            INDEX idx_intersection_time (intersection_id, timestamp),
            INDEX idx_timestamp (timestamp)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    const createLightTimingsTable = `
        CREATE TABLE IF NOT EXISTS light_timings (
            id INT PRIMARY KEY AUTO_INCREMENT,
            traffic_light_id INT NOT NULL,
            green_time INT NOT NULL,
            red_time INT NOT NULL,
            yellow_time INT NOT NULL DEFAULT 3,
            timing_type VARCHAR(20) DEFAULT 'dynamic' COMMENT 'static/dynamic/emergency',
            effective_from TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (traffic_light_id) REFERENCES traffic_lights(id) ON DELETE CASCADE,
            INDEX idx_traffic_light (traffic_light_id),
            INDEX idx_effective_time (effective_from)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

  const createEmergencyVehiclesTable = `
        CREATE TABLE IF NOT EXISTS emergency_vehicles (
            id INT PRIMARY KEY AUTO_INCREMENT,
            intersection_id INT NOT NULL,
            vehicle_type VARCHAR(50) NOT NULL COMMENT '救护车/消防车/警车',
            vehicle_id VARCHAR(50) NOT NULL,
            latitude DECIMAL(10, 8) NOT NULL,
            longitude DECIMAL(11, 8) NOT NULL,
            priority_level TINYINT DEFAULT 1 COMMENT '1-5, 5最高',
            estimated_arrival TIMESTAMP,
            status TINYINT DEFAULT 0 COMMENT '0-等待, 1-已通过',
            direction VARCHAR(20) NOT NULL DEFAULT 'North',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (intersection_id) REFERENCES intersections(id) ON DELETE CASCADE,
            INDEX idx_intersection (intersection_id),
            INDEX idx_status (status),
            INDEX idx_arrival_time (estimated_arrival)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    const createSystemSettingsTable = `
        CREATE TABLE IF NOT EXISTS system_settings (
            id INT PRIMARY KEY AUTO_INCREMENT,
            system_name VARCHAR(100) NOT NULL,
            auto_mode TINYINT DEFAULT 1,
            emergency_priority TINYINT DEFAULT 1,
            max_cycle_length INT DEFAULT 180,
            min_cycle_length INT DEFAULT 60,
            yellow_light_duration INT DEFAULT 3,
            detection_radius INT DEFAULT 100,
            update_interval INT DEFAULT 5,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    const createIntersectionParamsTable = `
        CREATE TABLE IF NOT EXISTS intersection_params (
            intersection_id INT PRIMARY KEY,
            window_seconds INT DEFAULT 10,
            low_flow_threshold INT DEFAULT 5,
            min_green_floor INT DEFAULT 5,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (intersection_id) REFERENCES intersections(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    try {
        await pool.execute(createIntersectionsTable);
        await pool.execute(createTrafficLightsTable);
        await pool.execute(createVehicleFlowsTable);
        await pool.execute(createLightTimingsTable);
        await pool.execute(createEmergencyVehiclesTable);
        await pool.execute(createSystemSettingsTable);
        await pool.execute(createIntersectionParamsTable);
        
        console.log('所有数据表创建成功');
        return true;
    } catch (error) {
        console.error('创建数据表失败:', error);
        return false;
    }
}

module.exports = {
    pool,
    testConnection,
    initializeDatabase,
    createTables
};

async function ensureSchema() {
    try {
        const dbName = process.env.DB_NAME || 'traffic_light_system';
        // emergency_vehicles: add direction column if missing
        const [dirCols] = await pool.execute(
            `SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = ? AND table_name = 'emergency_vehicles' AND COLUMN_NAME = 'direction'`,
            [dbName]
        );
        if (!Array.isArray(dirCols) || dirCols.length === 0) {
            await pool.execute(`ALTER TABLE emergency_vehicles ADD COLUMN direction VARCHAR(20) NOT NULL DEFAULT 'North'`);
        }

        // emergency_vehicles: add updated_at column if missing
        const [updCols] = await pool.execute(
            `SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = ? AND table_name = 'emergency_vehicles' AND COLUMN_NAME = 'updated_at'`,
            [dbName]
        );
        if (!Array.isArray(updCols) || updCols.length === 0) {
            await pool.execute(`ALTER TABLE emergency_vehicles ADD COLUMN updated_at TIMESTAMP NULL DEFAULT NULL`);
            // ensure default on update current timestamp
            await pool.execute(`ALTER TABLE emergency_vehicles MODIFY COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
        }

        // intersections: add auto_mode/current_phase/cycle_length if missing
        const needCols = [
            { name: 'auto_mode', ddl: `ALTER TABLE intersections ADD COLUMN auto_mode TINYINT DEFAULT 1` },
            { name: 'current_phase', ddl: `ALTER TABLE intersections ADD COLUMN current_phase TINYINT DEFAULT 1` },
            { name: 'cycle_length', ddl: `ALTER TABLE intersections ADD COLUMN cycle_length INT DEFAULT 120` },
        ];
        for (const col of needCols) {
            const [rows] = await pool.execute(
                `SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = ? AND table_name = 'intersections' AND COLUMN_NAME = ?`,
                [dbName, col.name]
            );
            if (!Array.isArray(rows) || rows.length === 0) {
                await pool.execute(col.ddl);
            }
        }

        return true;
    } catch (error) {
        console.error('校验/更新表结构失败:', error);
        return false;
    }
}
