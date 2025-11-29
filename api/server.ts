/**
 * local server entry file, for local development
 */
import app from './app.js';
import http from 'http';
import { Server as IOServer } from 'socket.io';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const db = require('./config/database.js');
const redis = require('./config/redis.js');

/**
 * start server with port
 */
const PORT = process.env.PORT || 3001;

async function bootstrap() {
  try {
    await redis.initializeRedis();
  } catch {
    console.warn('Redis 初始化失败，继续启动（将退回无缓存模式）');
  }

  try {
    await db.initializeDatabase();
  } catch {
    console.warn('数据库初始化失败，请确认 MySQL 配置与权限');
  }
}

await bootstrap();
const httpServer = http.createServer(app);
const io = new IOServer(httpServer, {
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  socket.emit('connected', { ts: Date.now() });
});

async function startTrafficLightScheduler() {
  setInterval(async () => {
    try {
      const [paramsRows]: any = await db.pool.execute(
        `SELECT intersection_id, window_seconds, low_flow_threshold, min_green_floor FROM intersection_params`
      );
      const defaultWindow = parseInt(process.env.LOW_FLOW_WINDOW_SECONDS || '10');
      const defaultThreshold = parseInt(process.env.LOW_FLOW_THRESHOLD || '5');
      const defaultMinGreen = parseInt(process.env.MIN_GREEN_FLOOR_SECONDS || '5');
      const paramsMap = new Map<number, { window: number; threshold: number; minGreen: number }>();
      for (const r of paramsRows) {
        paramsMap.set(r.intersection_id, {
          window: r.window_seconds ?? defaultWindow,
          threshold: r.low_flow_threshold ?? defaultThreshold,
          minGreen: r.min_green_floor ?? defaultMinGreen,
        });
      }
      const [lights]: any = await db.pool.execute(
        `SELECT id, intersection_id, direction, current_status, remaining_time, default_green_time, default_red_time, default_yellow_time FROM traffic_lights`
      );

      const updatedIntersections = new Set<number>();

      for (const light of lights) {
        let newStatus = light.current_status;
        let newRemaining = light.remaining_time;

        if (newStatus === 2) {
          const pair = (light.direction === 'North' || light.direction === 'South') ? ['North', 'South'] : ['East', 'West'];
          const cfg = paramsMap.get(light.intersection_id) || { window: defaultWindow, threshold: defaultThreshold, minGreen: defaultMinGreen };
          const [rows]: any = await db.pool.execute(
            `SELECT COALESCE(SUM(vehicle_count),0) AS cnt FROM vehicle_flows WHERE intersection_id = ? AND direction IN (?, ?) AND timestamp >= DATE_SUB(NOW(), INTERVAL ? SECOND)`,
            [light.intersection_id, pair[0], pair[1], cfg.window]
          );
          const lowFlow = (rows[0]?.cnt ?? 0) < cfg.threshold;
          if (lowFlow && newRemaining > cfg.minGreen) {
            newRemaining = cfg.minGreen;
          }
        }

        if (newRemaining > 0) {
          newRemaining = newRemaining - 1;
        } else {
          if (newStatus === 0) {
            newStatus = 2;
            newRemaining = light.default_green_time || 30;
          } else if (newStatus === 2) {
            newStatus = 1;
            newRemaining = 3;
          } else if (newStatus === 1) {
            newStatus = 0;
            newRemaining = light.default_red_time || 30;
          }
        }

        await db.pool.execute(
          `UPDATE traffic_lights SET current_status = ?, remaining_time = ?, updated_at = NOW() WHERE id = ?`,
          [newStatus, newRemaining, light.id]
        );

        updatedIntersections.add(light.intersection_id);
        io.emit('light_status_update', {
          lightId: light.id,
          status: newStatus,
          remainingTime: newRemaining,
          direction: light.direction,
        });
      }

      for (const intersectionId of Array.from(updatedIntersections)) {
        const [updated]: any = await db.pool.execute(
          `SELECT id, intersection_id, direction, current_status, remaining_time, default_green_time, default_red_time, default_yellow_time FROM traffic_lights WHERE intersection_id = ? ORDER BY phase_number, direction`,
          [intersectionId]
        );
        io.emit('trafficLightUpdate', updated);
      }
    } catch {}
  }, 1000);
}

try {
  await redis.subscribeMessage('sensor:data', (msg: any) => {
    io.emit('vehicleFlowUpdate', msg);
  });
  await redis.subscribeMessage('sensor:batch_data', (msg: any) => {
    io.emit('vehicleFlowUpdate', msg);
  });
  await redis.subscribeMessage('traffic_light:control', (msg: any) => {
    io.emit('trafficLightUpdate', msg);
  });
  await redis.subscribeMessage('traffic_light:state_changed', (msg: any) => {
    io.emit('trafficLightUpdate', msg);
  });
  await redis.subscribeMessage('traffic_light:emergency', (msg: any) => {
    io.emit('emergencyMode', 'emergency');
  });
  await redis.subscribeMessage('traffic_light:restore_normal', (msg: any) => {
    io.emit('emergencyMode', 'normal');
  });
  await redis.subscribeMessage('traffic_light:emergency_sync', (msg: any) => {
    io.emit('trafficLightUpdate', msg);
  });
  await redis.subscribeMessage('traffic_algorithm:timing_update', (msg: any) => {
    io.emit('trafficTimingUpdate', msg);
  });
} catch {}

startTrafficLightScheduler();

const server = httpServer.listen(PORT, () => {
  console.log(`Server ready on port ${PORT}`);
});

/**
 * close server
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;
