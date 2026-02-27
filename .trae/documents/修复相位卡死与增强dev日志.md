## 问题定位
- 目前调度器通过“是否存在绿/黄灯”来推断当前相位（[server.ts](file:///c:/Users/31936/Desktop/honglvdengtest/api/server.ts#L86-L121)）。
- 当东西直行经历 绿→黄→红 后，所有相位在某一时刻都会变成“全红”，此时 currentGreenPhase 会变成 -1，然后代码会把相位重置为 phases[0]（通常就是东西直行），导致你看到“黄灯之后又回到东西直行绿灯”，表现为卡死。
- 同时，代码每秒都会把非当前相位强制设为红并重置 remaining_time（[server.ts](file:///c:/Users/31936/Desktop/honglvdengtest/api/server.ts#L148-L152)），这会让“新相位”即便被切换，也可能因为红灯计时被反复重置而无法自然走到变绿的时刻。

## 修复思路
- 不再用灯色“推断当前相位”，改用数据库里已经存在的 `intersections.current_phase` 作为权威相位状态（表结构在 [database.js](file:///c:/Users/31936/Desktop/honglvdengtest/api/config/database.js#L61-L83)）。
- 将相位控制改成“路口级状态机”：
  - 读取 intersection.current_phase（不合法就回退到最小相位并写回）。
  - 只对当前相位做倒计时与状态流转（绿→黄→红）。
  - 当当前相位进入“全红”（黄结束后的下一秒），立刻把 current_phase 切到下一相位，并强制下一相位变绿（写入 status=2、remaining=default_green_time）。
  - 非当前相位保持红灯，但不再每秒把 remaining_time 反复重置（避免干扰切相位）。
- 将低车流缩短逻辑从“每盏灯一次SQL”改为“当前相位一次SQL/一次判断”，避免重复查询造成抖动。

## 控制台日志（npm run dev 一眼能看到）
- 增加清晰的相位切换日志（默认仅在 development 输出）：
  - `[PHASE] intersection=2 1(EW_STRAIGHT) GREEN->YELLOW`
  - `[PHASE] intersection=2 1(EW_STRAIGHT) YELLOW->ALL_RED`
  - `[PHASE] intersection=2 switch 1->2 (EW_LEFT)`
- 保留并增强 AI 日志（你已要求的 [AI输入]/[AI Request]/[AI Response]/[AI建议]），确保在 `npm run dev` 的同一控制台中可见。
- 同时把 `npm run dev` 的输出加上 `[client]`/`[server]` 前缀，便于定位（如果你希望更干净，也可以加一个 `dev:server` 单独只跑后端）。

## 验证方式
- 启动 `npm run dev` 后：
  - 观察控制台是否持续出现 `[PHASE] ... switch ...`，且相位序列按 1→2→3→4 循环，不再回到 1 卡住。
  - 观察 `[AI输入]` 中同一时刻仅有一个相位为绿（不会出现直行与左转同时绿）。
  - 前端页面相位展示与后端日志一致。

如果你确认这个方案，我会按上述思路修改 `api/server.ts`（调度器重构 + 相位日志）并补充必要的小范围配置/脚本输出，最后用 `npm run dev` 跑起来给你截取一段“系统↔AI”实时对话与相位切换日志作为验收依据。