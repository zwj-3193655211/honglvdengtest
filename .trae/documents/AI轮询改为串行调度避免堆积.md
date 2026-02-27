## 你反馈的两点问题
- 轮询堆积：上一轮 AI 未返回时不应触发下一轮。
- Prompt 预设：LMStudio 里你已配置系统预设，因此代码里不应再注入 system prompt；且输出格式应兼容 `{"green":"23s"}` / `{"green":"-1"}`。

## 改造目标
1) AI 轮询严格串行：上一轮未结束（含超时/异常），下一轮不启动。
2) `aiTrafficAdvisor.ts` 不再写入 system prompt；仅发送 user 内容。
3) AI 输出解析与业务对齐：只读取 `green` 字段（字符串），支持 `"23s"`、`"23"`、`"-1"`；超出范围进行 clamp。

## 实施步骤
### 1) 串行轮询（后端）
- 修改 [server.ts](file:///c:/Users/31936/Desktop/honglvdengtest/api/server.ts) 的 `startAiAdvisorLoop()`：
  - 用递归 `setTimeout` 替代 `setInterval`。
  - 结构为 `async tick(){ try{...} finally { setTimeout(tick, AI_ADVICE_INTERVAL_MS) } }`。
  - 当 `system:ai_mode != 1` 时：不调用 AI，仅安排下一轮 tick。
  - 这样天然保证不会并发/堆积（不会出现多条 AI Request 叠在一起）。

### 2) 只使用预设提示词（服务端）
- 修改 [aiTrafficAdvisor.ts](file:///c:/Users/31936/Desktop/honglvdengtest/api/services/aiTrafficAdvisor.ts)：
  - 删除/置空 `systemPrompt` 段落（你提供的预设已经覆盖该内容）。
  - `messages` 只传入 user 一条。
  - userPrompt 末尾补回 `/no_think`（如果模型支持，可显著降低思考延迟；如果不支持也通常会被当作普通文本忽略）。

### 3) 输出格式与解析（服务端）
- 仍然严格要求 AI 输出为 JSON（否则报错）。
- 解析 `green`：
  - 如果 `green` 是 `"-1"` 或 `-1`：视为“不调整”，直接在 `server.ts` 里跳过更新。
  - 如果是 `"23s"`：去掉结尾 `s` 再转数字。
  - clamp 到 [minGreen, maxGreen]。
- 后端广播 `trafficTimingUpdate` 仅携带 `{ green: <number> }`，前端显示也保持只展示 G。

### 4) 验证
- 开启 AI：观察日志同一时刻只会有一条 AI Request，且必然要么出现 AI Response（含耗时），要么出现“AI请求超时”。
- 关闭 AI：不再出现 AI Request/Response。
- LMStudio 返回 `{"green":"23s"}`：后端能正常解析并应用。

确认后我会按以上步骤修改代码并本地跑通验证。