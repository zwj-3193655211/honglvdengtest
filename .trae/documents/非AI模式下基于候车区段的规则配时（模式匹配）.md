## 需求理解
- AI 关闭时，不再依赖 AI 配时；而是根据“候车量区段（bucket）→ 对应绿灯时长”的规则做配时（模式匹配）。
- 规则需要预设（可稳定复现），并且能随着候车量变化自适应。

## 现状复盘（关键点）
- 红绿灯调度主逻辑在 [server.ts](file:///c:/Users/31936/Desktop/honglvdengtest/api/server.ts#L46-L219)：当相位开始绿灯时使用 `light.default_green_time` 作为绿灯时长。
- 车流/候车快照来自 `vehicle_flows`（我们现在由后端虚拟车流生成器持续写入）。

## 实现方案
### 1) 新增“规则配时”模块
- 新增 `api/services/ruleBasedTiming.ts`，提供函数：
  - `getRuleGreenSeconds({ intersectionId, phaseNumber, movementType, queuesByDirection, constraints }) => number`
- 内置一套“候车量区段 → 绿灯秒数”的默认表（可后续再做配置化）。
  - 直行相位示例（可调）：
    - 0–10：20s
    - 11–40：35s
    - 41+：50s
  - 左转相位示例（可调）：
    - 0–5：12s
    - 6–20：18s
    - 21+：25s
  - 候车量计算：从方向总队列拆分为直行 70% / 左转 30%（与现有展示口径一致）。
  - 最终输出会 clamp 到 [minGreen, maxGreen]。

### 2) 在调度器中接入规则配时（仅非AI模式）
- 修改 `startTrafficLightScheduler()`：
  - 每秒 tick 里读取一次 `system:ai_mode`（Redis），得到是否启用 AI。
  - 仅当 `ai_mode=0` 且“当前相位刚开始进入绿灯”（即 `forcedGreenThisTick`）时：
    1) 查询该路口最新的 `vehicle_flows`（四方向最新一条）作为候车快照。
    2) 计算当前相位的 movementType（phase 1/3=straight，2/4=left）。
    3) 用 `ruleBasedTiming.getRuleGreenSeconds(...)` 得到 `ruleGreenSeconds`。
    4) 对本相位所有灯：
       - 把 `remaining_time` 设为 `ruleGreenSeconds`
       - 同时把 `default_green_time` 更新为 `ruleGreenSeconds`（便于前端展示与后续相位复用）
  - AI 开启时：保持现状（AI loop 更新 default_green_time，然后调度器照常使用）。

### 3) 兼容与边界
- 若该路口短期内没有 `vehicle_flows`：回退到 `default_green_time`。
- 低流量压缩逻辑（min_green_floor）保留：在极低车流时仍可将剩余绿灯压到下限。

## 验证方式
- 关闭 AI：观察相位开始绿灯时 `remaining_time` 会按候车量区段切换到预设值。
- 调大/调小虚拟车流（到达缩放滑杆）后：候车量上升时绿灯时长进入更大区段，下降时进入更小区段。
- 开启 AI：规则配时不再生效（以 AI 为准）。

如果你确认这套 bucket 与秒数范围，我就按上述方案落地代码并跑通本地验证。