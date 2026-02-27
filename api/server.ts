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
import { aiTrafficAdvisor, type Constraints } from './services/aiTrafficAdvisor.ts';
import { startVirtualFlowGenerator } from './services/virtualFlowGenerator.ts';
import { getRuleGreenSeconds } from './services/ruleBasedTiming.ts';

/**
 * start server with port
 */
const PORT = process.env.PORT || 3001;
let aiModeEnabled = false;
const AI_ADVICE_INTERVAL_MS = parseInt(process.env.AI_ADVICE_INTERVAL_MS || '10000');
const AI_DEV_AUTOSTART = (process.env.AI_DEV_AUTOSTART ?? '0') === '1' && process.env.NODE_ENV !== 'production';
let aiDevAutostartLogged = false;

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
  const schedulerStartedAt = Date.now();
  setInterval(async () => {
    try {
      let aiEnabledNow = false;
      try {
        const cached = await (redis.getCache ? redis.getCache('system:ai_mode') : Promise.resolve(null));
        aiEnabledNow = String(cached ?? '0') === '1';
      } catch {}

      const latestQueueCache = new Map<number, Record<string, number>>();
      const getLatestQueuesByDirection = async (intersectionId: number) => {
        if (latestQueueCache.has(intersectionId)) return latestQueueCache.get(intersectionId)!;
        const out: Record<string, number> = { North: 0, South: 0, East: 0, West: 0 };
        try {
          const [counts]: any = await db.pool.execute(
            `SELECT v1.direction, v1.vehicle_count as cnt 
             FROM vehicle_flows v1
             INNER JOIN (
                 SELECT direction, MAX(id) as max_id
                 FROM vehicle_flows
                 WHERE intersection_id = ?
                 GROUP BY direction
             ) v2 ON v1.direction = v2.direction AND v1.id = v2.max_id
             WHERE v1.intersection_id = ?`,
            [intersectionId, intersectionId]
          );
          if (Array.isArray(counts)) {
            for (const c of counts) {
              const dir = String(c.direction);
              if (dir === 'North' || dir === 'South' || dir === 'East' || dir === 'West') out[dir] = Number(c.cnt ?? 0);
            }
          }
        } catch {}
        latestQueueCache.set(intersectionId, out);
        return out;
      };

      const latestSplitQueueCache = new Map<number, any>();
      const getLatestSplitQueues = async (intersectionId: number) => {
        if (latestSplitQueueCache.has(intersectionId)) return latestSplitQueueCache.get(intersectionId);
        let out: any = null;
        try {
          const key = `virtual:queue_split:${intersectionId}`;
          const cached = await (redis.getCache ? redis.getCache(key) : Promise.resolve(null));
          if (cached && typeof cached === 'object') out = cached;
        } catch {}
        latestSplitQueueCache.set(intersectionId, out);
        return out;
      };

      const [paramsRows]: any = await db.pool.execute(
        `SELECT intersection_id, window_seconds, low_flow_threshold, min_green_floor FROM intersection_params`
      );
      const defaultWindow = parseInt(process.env.LOW_FLOW_WINDOW_SECONDS || '10');
      const defaultThreshold = parseInt(process.env.LOW_FLOW_THRESHOLD || '15');
      const defaultMinGreen = parseInt(process.env.MIN_GREEN_FLOOR_SECONDS || '10');
      const defaultMaxGreen = parseInt(process.env.MAX_GREEN_SECONDS || '120');
      const paramsMap = new Map<number, { window: number; threshold: number; minGreen: number }>();
      for (const r of paramsRows) {
        paramsMap.set(r.intersection_id, {
          window: r.window_seconds ?? defaultWindow,
          threshold: r.low_flow_threshold ?? defaultThreshold,
          minGreen: r.min_green_floor ?? defaultMinGreen,
        });
      }
      const [lights]: any = await db.pool.execute(
        `SELECT id, intersection_id, direction, movement_type, current_status, remaining_time, default_green_time, default_red_time, default_yellow_time, phase_number FROM traffic_lights`
      );
      const [intersectionRows]: any = await db.pool.execute(
        `SELECT id, current_phase, auto_mode FROM intersections`
      );
      const intersectionPhase = new Map<number, number>();
      const intersectionAuto = new Map<number, boolean>();
      for (const r of intersectionRows || []) {
        intersectionPhase.set(Number(r.id), Number(r.current_phase ?? 1));
        intersectionAuto.set(Number(r.id), Number(r.auto_mode ?? 1) !== 0);
      }

      const updatedIntersections = new Set<number>();
      
      // 按路口和相位分组
      const intersectionsMap = new Map<number, Map<number, any[]>>();
      for (const light of lights) {
        if (!intersectionsMap.has(light.intersection_id)) {
          intersectionsMap.set(light.intersection_id, new Map());
        }
        const phaseMap = intersectionsMap.get(light.intersection_id)!;
        if (!phaseMap.has(light.phase_number)) {
          phaseMap.set(light.phase_number, []);
        }
        phaseMap.get(light.phase_number)!.push(light);
      }

      // 按路口处理每个相位
      for (const [intersectionId, phaseMap] of intersectionsMap) {
        if (intersectionAuto.get(intersectionId) === false) {
          updatedIntersections.add(intersectionId);
          continue;
        }
        const phases = Array.from(phaseMap.keys()).sort((a, b) => a - b);
        if (phases.length === 0) continue;

        let activePhase = intersectionPhase.get(intersectionId) ?? phases[0];
        if (!phases.includes(activePhase)) {
          activePhase = phases[0];
          await db.pool.execute(
            `UPDATE intersections SET current_phase = ?, updated_at = NOW() WHERE id = ?`,
            [activePhase, intersectionId]
          );
        }

        const activeLights = phaseMap.get(activePhase) || [];
        const hasGreen = activeLights.some((l: any) => l.current_status === 2);
        const hasYellow = activeLights.some((l: any) => l.current_status === 1);

        let forcedGreenThisTick = false;
        if (!hasGreen && !hasYellow) {
          const hasRedCountdown = activeLights.some((l: any) => l.current_status === 0 && Number(l.remaining_time ?? 0) > 0);
          forcedGreenThisTick = true;
          if (hasRedCountdown) {
            console.log(`[PHASE] intersection=${intersectionId} phase=${activePhase} start GREEN (recover from RED countdown)`);
          } else {
            console.log(`[PHASE] intersection=${intersectionId} phase=${activePhase} start GREEN`);
          }
        }

          let capGreenTo10 = false;
        const cfg = paramsMap.get(intersectionId) || { window: defaultWindow, threshold: defaultThreshold, minGreen: defaultMinGreen };
        if (!forcedGreenThisTick && hasGreen && (Date.now() - schedulerStartedAt) > 5000) {
          const activeGreenMax = Math.max(0, ...activeLights.filter((l: any) => l.current_status === 2).map((l: any) => Number(l.remaining_time ?? 0)));
          if (activeGreenMax > 10) {
            const pair = activePhase === 3 || activePhase === 4 ? ['North', 'South'] : ['East', 'West'];
            const movementType = (activePhase === 1 || activePhase === 3) ? 'straight' : 'left';
            const split = await getLatestSplitQueues(intersectionId);
            if (split) {
              const a = Number(split?.[pair[0]]?.[movementType] ?? 0);
              const b = Number(split?.[pair[1]]?.[movementType] ?? 0);
              capGreenTo10 = (a + b) < cfg.threshold;
            } else {
              const q = await getLatestQueuesByDirection(intersectionId);
              const phaseTotal = Number(q[pair[0]] ?? 0) + Number(q[pair[1]] ?? 0);
              capGreenTo10 = phaseTotal < cfg.threshold;
            }
          }
        }

        let ruleGreenSeconds: number | null = null;
        if (!aiEnabledNow && forcedGreenThisTick) {
          try {
            const [counts]: any = await db.pool.execute(
              `SELECT v1.direction, v1.vehicle_count as cnt 
               FROM vehicle_flows v1
               INNER JOIN (
                   SELECT direction, MAX(id) as max_id
                   FROM vehicle_flows
                   WHERE intersection_id = ?
                   GROUP BY direction
               ) v2 ON v1.direction = v2.direction AND v1.id = v2.max_id
               WHERE v1.intersection_id = ?`,
              [intersectionId, intersectionId]
            );
            const queuesByDirection: any = {};
            if (Array.isArray(counts)) {
              for (const c of counts) {
                queuesByDirection[c.direction] = Number(c.cnt ?? 0);
              }
            }
            const movementType = (activePhase === 1 || activePhase === 3) ? 'straight' : 'left';
            const cfg = paramsMap.get(intersectionId) || { window: defaultWindow, threshold: defaultThreshold, minGreen: defaultMinGreen };
            ruleGreenSeconds = getRuleGreenSeconds({
              intersectionId,
              phaseNumber: activePhase,
              movementType,
              queuesByDirection,
              minGreen: cfg.minGreen,
              maxGreen: defaultMaxGreen,
            });
          } catch {}
        }

        let lowFlow = false;
        if (!forcedGreenThisTick && hasGreen) {
          const pair = activePhase === 3 || activePhase === 4 ? ['North', 'South'] : ['East', 'West'];
          const [rows]: any = await db.pool.execute(
            `SELECT COUNT(*) AS samples, COALESCE(SUM(vehicle_count),0) AS cnt FROM vehicle_flows WHERE intersection_id = ? AND direction IN (?, ?) AND timestamp >= DATE_SUB(NOW(), INTERVAL ? SECOND)`,
            [intersectionId, pair[0], pair[1], cfg.window]
          );
          const samples = Number(rows[0]?.samples ?? 0);
          const cnt = Number(rows[0]?.cnt ?? 0);
          lowFlow = samples > 0 && cnt < cfg.threshold;
        }

        let phaseToYellow = false;
        let phaseToAllRed = false;

        for (const [phaseNum, phaseLights] of phaseMap) {
          const isActive = phaseNum === activePhase;
          for (const light of phaseLights) {
            const oldStatus = light.current_status;
            let newStatus = light.current_status;
            let newRemaining = light.remaining_time;

            if (!isActive) {
              newStatus = 0;
              newRemaining = 0;
            } else if (forcedGreenThisTick) {
              newStatus = 2;
              newRemaining = ruleGreenSeconds ?? (light.default_green_time || 30);
            } else {
              if (newStatus === 2 && lowFlow && newRemaining > cfg.minGreen) {
                newRemaining = cfg.minGreen;
              }

              if (newRemaining > 0) {
                newRemaining = newRemaining - 1;
              } else {
                if (newStatus === 0) {
                  newStatus = 2;
                  newRemaining = light.default_green_time || 30;
                } else if (newStatus === 2) {
                  newStatus = 1;
                  newRemaining = light.default_yellow_time || 3;
                } else if (newStatus === 1) {
                  newStatus = 0;
                  newRemaining = 0;
                }
              }
            }

          if (capGreenTo10 && newStatus === 2 && newRemaining > 10) {
            newRemaining = 10;
            console.log(`[LOWFLOW10] intersection=${intersectionId} phase=${activePhase} green_remaining->10`);
          }

            if (isActive && !forcedGreenThisTick) {
              if (oldStatus === 2 && newStatus === 1) phaseToYellow = true;
              if (oldStatus === 1 && newStatus === 0) phaseToAllRed = true;
            }

            await db.pool.execute(
              `UPDATE traffic_lights
               SET current_status = ?,
                   remaining_time = ?,
                   default_green_time = COALESCE(?, default_green_time),
                   updated_at = NOW()
               WHERE id = ?`,
              [newStatus, newRemaining, (forcedGreenThisTick && isActive && ruleGreenSeconds != null) ? ruleGreenSeconds : null, light.id]
            );

            updatedIntersections.add(intersectionId);
            io.emit('light_status_update', {
              lightId: light.id,
              status: newStatus,
              remainingTime: newRemaining,
              direction: light.direction,
            });
          }
        }

        if (phaseToYellow) console.log(`[PHASE] intersection=${intersectionId} phase=${activePhase} GREEN -> YELLOW`);
        if (phaseToAllRed) {
          console.log(`[PHASE] intersection=${intersectionId} phase=${activePhase} YELLOW -> ALL_RED`);
          if (phases.length > 1) {
            const currentIndex = phases.indexOf(activePhase);
            const nextPhase = phases[(currentIndex + 1) % phases.length];
            await db.pool.execute(
              `UPDATE intersections SET current_phase = ?, updated_at = NOW() WHERE id = ?`,
              [nextPhase, intersectionId]
            );
            console.log(`[PHASE] intersection=${intersectionId} switch ${activePhase} -> ${nextPhase}`);
          }
        }
      }

      for (const intersectionId of Array.from(updatedIntersections)) {
        const [updated]: any = await db.pool.execute(
          `SELECT id, intersection_id, direction, movement_type, current_status, remaining_time, default_green_time, default_red_time, default_yellow_time FROM traffic_lights WHERE intersection_id = ? ORDER BY phase_number, direction, movement_type`,
          [intersectionId]
        );
        io.emit('trafficLightUpdate', updated);
      }
    } catch {}
  }, 1000);
}

async function startAiAdvisorLoop() {
  if (AI_DEV_AUTOSTART && !aiDevAutostartLogged) {
    aiDevAutostartLogged = true;
    console.log(`[AI] dev自动启动已开启：轮询间隔=${Math.ceil(AI_ADVICE_INTERVAL_MS / 1000)}秒（可用 AI_DEV_AUTOSTART=0 关闭）`);
  }
  
  // 记录每个路口的当前相位和轮询次数
  // Map<intersectionId, { phase: number, count: number }>
  const aiPhaseTracker = new Map<number, { phase: number, count: number }>();

  const schedule = () => setTimeout(() => { tick().catch(() => {}) }, AI_ADVICE_INTERVAL_MS);
  const tick = async () => {
    try {
      try {
        const cached = await (redis.getCache ? redis.getCache('system:ai_mode') : Promise.resolve(null));
        if (cached !== null) aiModeEnabled = String(cached) === '1';
      } catch {}
      if (!aiModeEnabled) return;

      const defaultWindow = parseInt(process.env.LOW_FLOW_WINDOW_SECONDS || '10');
      const defaultMinGreen = parseInt(process.env.MIN_GREEN_FLOOR_SECONDS || '5');
      const maxGreen = parseInt(process.env.MAX_GREEN_SECONDS || '120');
      const [sysRows]: any = await db.pool.execute(
        `SELECT max_cycle_length, yellow_light_duration FROM system_settings ORDER BY id DESC LIMIT 1`
      );
      const sys = sysRows[0] || {};
      const minYellow = parseInt(process.env.MIN_YELLOW_SECONDS || '1');
      const maxYellow = parseInt(process.env.MAX_YELLOW_SECONDS || '10');
      const cycleMax = parseInt((sys?.max_cycle_length ?? process.env.CYCLE_MAX_SECONDS) || '120');
      const constraints: Constraints = {
        minGreen: defaultMinGreen,
        maxGreen,
        minYellow,
        maxYellow,
        cycleMax
      };
      const yellowFixed = Math.max(minYellow, Math.min(maxYellow, parseInt(String(sys?.yellow_light_duration ?? 3))));
      
      const [ids]: any = await db.pool.execute(
        `SELECT DISTINCT intersection_id FROM traffic_lights ORDER BY intersection_id`
      );
      
      let selectedIntersectionId: number | null = null;
      try {
        const cached = await (redis.getCache ? redis.getCache('system:selected_intersection') : Promise.resolve(null));
        if (cached !== null && cached !== '0') {
          selectedIntersectionId = parseInt(cached);
        }
      } catch {}
      
      // 如果没有选定路口，则不执行任何 AI 逻辑
      if (selectedIntersectionId === null) {
        if (AI_DEV_AUTOSTART && Array.isArray(ids) && ids.length > 0) {
          selectedIntersectionId = Number(ids[0].intersection_id);
          try {
            await (redis.setCache ? redis.setCache('system:selected_intersection', String(selectedIntersectionId), 86400) : Promise.resolve());
          } catch {}
          console.log(`[AI] dev自动选择路口: system:selected_intersection=${selectedIntersectionId}`);
        } else {
          console.log('[AI] 未选择路口，跳过（打开前端选择路口，或调用 POST /api/settings/selected-intersection）');
          return;
        }
      }

      if (selectedIntersectionId === null) {
        return;
      }

      for (const row of ids) {
        const intersectionId = row.intersection_id;
        
        if (selectedIntersectionId !== null && intersectionId !== selectedIntersectionId) {
          continue;
        }
        try {
          // 获取各个方向的当前候车数 (取最新的一条记录作为当前排队快照)
          const [counts]: any = await db.pool.execute(
            `SELECT v1.direction, v1.vehicle_count as cnt 
             FROM vehicle_flows v1
             INNER JOIN (
                 SELECT direction, MAX(id) as max_id
                 FROM vehicle_flows
                 WHERE intersection_id = ?
                 GROUP BY direction
             ) v2 ON v1.direction = v2.direction AND v1.id = v2.max_id
             WHERE v1.intersection_id = ?`,
            [intersectionId, intersectionId]
          );
          
          // 获取当前红绿灯状态，包括当前通行方向和剩余时间
          const [lightsStatus]: any = await db.pool.execute(
            `SELECT direction, movement_type, current_status, remaining_time, phase_number 
             FROM traffic_lights 
             WHERE intersection_id = ? 
             ORDER BY current_status DESC, remaining_time DESC`,
            [intersectionId]
          );
          
          // 找出当前绿灯方向和剩余时间
          const currentGreen = lightsStatus.find((light: any) => light.current_status === 2);
          const currentGreenDirection = currentGreen?.direction || 'Unknown';
          const currentGreenMovementType = currentGreen?.movement_type || 'straight';
          const currentGreenRemaining = currentGreen?.remaining_time || 0;
          const currentPhase = Number(currentGreen?.phase_number || 0);

          const intervalSeconds = Math.ceil(AI_ADVICE_INTERVAL_MS / 1000);
          if (!currentGreen || currentGreenRemaining <= 0) {
            continue;
          }
          if (currentGreenRemaining < intervalSeconds) {
            console.log(`[AI跳过] 路口 ${intersectionId}：绿灯剩余${currentGreenRemaining}秒 < 轮询间隔${intervalSeconds}秒`);
            continue;
          }

          // 检查轮询次数限制
          let tracker = aiPhaseTracker.get(intersectionId);
          if (!tracker || tracker.phase !== currentPhase) {
            // 如果是新相位，重置计数
            tracker = { phase: currentPhase, count: 0 };
            aiPhaseTracker.set(intersectionId, tracker);
          }

          if (tracker.count >= 3) {
            console.log(`[AI跳过] 路口 ${intersectionId}：当前相位 ${currentPhase} 已轮询 ${tracker.count} 次，达到上限`);
            continue;
          }
          
          // 按照用户要求的格式组织数据：每个方向显示直行和左转车辆数
          const directionMap = new Map<string, number>();
          counts.forEach((count: any) => {
            directionMap.set(count.direction, count.cnt);
          });

          // 尝试从 Redis 获取真实的直行/左转分流数据 (与前端显示保持一致)
          let splitData: any = null;
          try {
            const cachedSplit = await (redis.getCache ? redis.getCache(`virtual:queue_split:${intersectionId}`) : Promise.resolve(null));
             if (cachedSplit && typeof cachedSplit === 'object') {
               splitData = cachedSplit;
             }
          } catch {}

          const getCounts = (dir: string) => {
             if (splitData && splitData[dir]) {
                 return {
                     straight: Number(splitData[dir].straight ?? 0),
                     left: Number(splitData[dir].left ?? 0)
                 };
             }
             // Fallback: use total count from DB and estimate 70/30 split
             const total = directionMap.get(dir) || 0;
             return {
                 straight: Math.round(total * 0.7),
                 left: Math.round(total * 0.3)
             };
          };

          const countsNorth = getCounts('North');
          const countsSouth = getCounts('South');
          const countsEast = getCounts('East');
          const countsWest = getCounts('West');

          // 计算规则模式的基础建议时长 (Base Rule-Based Timing)
          // 即使在 AI 模式下，也先用规则算一个“保底值”，AI 可以在此基础上微调
          // 这样如果 AI 挂了或者返回 -1，我们至少有一个合理的动态值，而不是死板的默认值
          let baseRuleGreen = 30;
          try {
              const pair = (currentPhase === 3 || currentPhase === 4) ? ['North', 'South'] : ['East', 'West'];
              const movement = (currentPhase === 1 || currentPhase === 3) ? 'straight' : 'left';
              
              // 构造 queuesByDirection 供 getRuleGreenSeconds 使用
              // 注意：getRuleGreenSeconds 内部目前的 splitMovement 逻辑是估算 0.7/0.3
              // 为了复用现有逻辑，我们这里传入总数 (straight + left) 让它去切分
              // 或者更优的做法：直接修改 getRuleGreenSeconds 支持 split 输入，但为了不破坏旧代码，
              // 我们这里手动适配一下：
              const qRule: any = {};
              ['North', 'South', 'East', 'West'].forEach(d => {
                  const c = getCounts(d);
                  qRule[d] = c.straight + c.left; // 传总数
              });
              
              // 也可以考虑直接重写一段简单的逻辑，用真实的 split 数据
              const qReal = Number(getCounts(pair[0] as any)[movement as 'straight'|'left']) + 
                            Number(getCounts(pair[1] as any)[movement as 'straight'|'left']);
                            
              // 简单的分段函数 (类似 ruleBasedTiming.ts 的 bucketGreenSeconds)
              if (movement === 'left') {
                  if (qReal <= 5) baseRuleGreen = 12;
                  else if (qReal <= 20) baseRuleGreen = 18;
                  else baseRuleGreen = 25;
              } else {
                  if (qReal <= 10) baseRuleGreen = 20;
                  else if (qReal <= 40) baseRuleGreen = 35;
                  else baseRuleGreen = 50;
              }
              baseRuleGreen = Math.max(defaultMinGreen, Math.min(maxGreen, baseRuleGreen));
              // console.log(`[AI-Base] 路口 ${intersectionId} 规则保底值: ${baseRuleGreen}s (Q=${qReal})`);
          } catch {}

          
          // 为每个方向构建数据格式
          const formattedStats = {
            North: {
              straight: countsNorth.straight,
              left: countsNorth.left,
              straightStatus: lightsStatus.find((l: any) => l.direction === 'North' && l.movement_type === 'straight'),
              leftStatus: lightsStatus.find((l: any) => l.direction === 'North' && l.movement_type === 'left')
            },
            South: {
              straight: countsSouth.straight,
              left: countsSouth.left,
              straightStatus: lightsStatus.find((l: any) => l.direction === 'South' && l.movement_type === 'straight'),
              leftStatus: lightsStatus.find((l: any) => l.direction === 'South' && l.movement_type === 'left')
            },
            East: {
              straight: countsEast.straight,
              left: countsEast.left,
              straightStatus: lightsStatus.find((l: any) => l.direction === 'East' && l.movement_type === 'straight'),
              leftStatus: lightsStatus.find((l: any) => l.direction === 'East' && l.movement_type === 'left')
            },
            West: {
              straight: countsWest.straight,
              left: countsWest.left,
              straightStatus: lightsStatus.find((l: any) => l.direction === 'West' && l.movement_type === 'straight'),
              leftStatus: lightsStatus.find((l: any) => l.direction === 'West' && l.movement_type === 'left')
            },
            currentGreenDirection,
            currentGreenMovementType,
            currentGreenRemaining
          };
          
          // 构建完整的统计数据，包括当前绿灯状态
          const stats = {
            window: defaultWindow,
            formattedStats,
            currentGreenDirection,
            currentGreenMovementType,
            currentGreenRemaining,
            allLights: lightsStatus
          };
          
          // 按照用户要求的格式记录统计数据
          console.log(`[AI输入] 路口 ${intersectionId}：`);
          const directions = ['North', 'South', 'East', 'West'];
          directions.forEach(dir => {
            const data = formattedStats[dir as keyof typeof formattedStats];
            const straightStatus = data.straightStatus;
            const leftStatus = data.leftStatus;
            
            const straightStatusText = straightStatus ? (['红灯', '黄灯', '绿灯'][straightStatus.current_status]) : '未知';
            const leftStatusText = leftStatus ? (['红灯', '黄灯', '绿灯'][leftStatus.current_status]) : '未知';
            
            const straightRemainingText = straightStatus && straightStatus.current_status === 2 ? `，绿灯剩余${straightStatus.remaining_time}秒` : '';
            const leftRemainingText = leftStatus && leftStatus.current_status === 2 ? `，绿灯剩余${leftStatus.remaining_time}秒` : '';
            
            console.log(`  ${dir}：直行${data.straight}辆，${straightStatusText}${straightRemainingText}；左转${data.left}辆，${leftStatusText}${leftRemainingText}`);
          });
          let advice: { green: number } | null = null
          try {
            advice = await aiTrafficAdvisor.getAdvice(
              { intersectionId: String(intersectionId), stats },
              constraints
            );
          } catch (e: any) {
            const msg = String(e?.message || '')
            // 如果 AI 显式返回“不调整” (-1)，或者调用出错
            // 此时我们回退到 Rule-Based 计算出的 baseRuleGreen，而不是什么都不做
            // 这样能保证即使 AI 觉得“不需要变”，我们依然有一个基于排队长度的基础动态值
            // 除非 baseRuleGreen 与当前 remaining 差别不大，那就不改了
            
            if (msg.includes('AI建议不调整')) {
               // AI 认为无需调整，但如果当前剩余时间与规则计算值偏差过大，还是应用规则值
               if (Math.abs(currentGreenRemaining - baseRuleGreen) > 10) {
                   console.log(`[AI建议不调整] 但规则建议差异大，采用规则值: ${baseRuleGreen}s (当前: ${currentGreenRemaining}s)`);
                   advice = { green: baseRuleGreen };
               } else {
                   console.log(`[AI建议] 路口 ${intersectionId}：当前绿灯时长不需要调整 (规则值 ${baseRuleGreen}s 与当前接近)`)
                   continue
               }
            } else {
                console.warn(`[AI异常] 路口 ${intersectionId}：${msg || 'unknown'} -> 降级为规则模式: ${baseRuleGreen}s`);
                advice = { green: baseRuleGreen };
            }
          }

          console.log(`[AI建议] 路口 ${intersectionId}：当前绿灯建议调整为 ${advice.green}秒`)

          const green = advice.green
          const yellow = yellowFixed
          const red = Math.max(0, cycleMax - green - yellow)

          // 1. 仅更新当前处于绿灯状态的灯的“默认时长” (default_green_time)
          // 这样可以避免将当前相位的建议时长误应用到其他等待中的相位
          const [updateResult] = await db.pool.execute(
            `UPDATE traffic_lights 
             SET default_green_time = ?, default_red_time = ?, default_yellow_time = ?
             WHERE intersection_id = ? AND current_status = 2`,
            [green, red, yellow, intersectionId]
          );
          
          // 2. 将非绿灯状态的灯重置为安全默认值 (30秒)
          // 确保当它们转为绿灯时，不会继承上一个相位留下的时长（例如上个相位只有15秒，而当前相位需要更多时间）
          await db.pool.execute(
            `UPDATE traffic_lights 
             SET default_green_time = 30
             WHERE intersection_id = ? AND current_status != 2`,
            [intersectionId]
          );
          
          // 记录数据库更新结果
          console.log(`[AI应用] 路口 ${intersectionId}：已更新当前绿灯时长为 ${green}秒 (受影响行数: ${updateResult.affectedRows})`);
          
          // 3. 立即更新当前正在倒计时的绿灯剩余时间
          await db.pool.execute(
            `UPDATE traffic_lights
             SET remaining_time = CASE current_status 
               WHEN 2 THEN ? 
               WHEN 1 THEN ? 
               WHEN 0 THEN ? 
             END
             WHERE intersection_id = ?`,
            [green, yellow, red, intersectionId]
          );
          const [updatedNow]: any = await db.pool.execute(
            `SELECT id, intersection_id, direction, movement_type, current_status, remaining_time, default_green_time, default_red_time, default_yellow_time 
             FROM traffic_lights WHERE intersection_id = ? ORDER BY phase_number, direction, movement_type`,
            [intersectionId]
          );
          
          // 成功应用 AI 建议后，增加轮询计数
          if (tracker) {
            tracker.count++;
            console.log(`[AI计数] 路口 ${intersectionId}：相位 ${currentPhase} 轮询次数已更新为 ${tracker.count}/3`);
          }

          io.emit('trafficTimingUpdate', {
            intersectionId,
            source: 'ai',
            advice: { green }
          });
          io.emit('trafficLightUpdate', updatedNow);
        } catch {
          continue
        }
      }
    } catch {} finally {
      schedule();
    }
  };
  tick().catch(() => schedule());
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



let loopsStarted = false;
const server = httpServer;
const startLoopsOnce = () => {
  if (loopsStarted) return;
  loopsStarted = true;
  startTrafficLightScheduler();
  startAiAdvisorLoop();
  startVirtualFlowGenerator();
};

server.on('listening', () => {
  console.log(`Server ready on port ${PORT}`);
  startLoopsOnce();
});

const startListening = () => {
  try {
    if (!server.listening) {
      server.listen(PORT);
    }
  } catch {}
};

server.on('error', (err: any) => {
  if (err?.code === 'EADDRINUSE') {
    setTimeout(() => {
      try {
        server.close(() => startListening());
      } catch {
        startListening();
      }
    }, 500);
    return;
  }
  console.error('Server error:', err);
  process.exit(1);
});

startListening();

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

process.once('SIGUSR2', () => {
  server.close(() => {
    process.kill(process.pid, 'SIGUSR2');
  });
});

export default app;
