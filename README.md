# 智能交通管理系统（React + TypeScript + Vite）

## 运行环境要求
- Node.js ≥ 18（建议 18/20）
- npm ≥ 9
- MySQL ≥ 8（本地或远程）
- Redis ≥ 5（本地或远程）
- Windows/macOS/Linux 均可

## 项目结构简述
- 前端：React 18 + TypeScript + Vite + TailwindCSS
- 后端：Express（ESM/TS 混合），Socket.IO 实时通信
- 数据库：MySQL（自动建库建表）
- 缓存与消息：Redis（Pub/Sub、缓存）

## 克隆与安装依赖
```bash
git clone <repo_url>
cd honglvdengtest
npm install
```

## 环境变量配置
在项目根目录 `.env` 文件中按需修改：
- 数据库配置：
  - `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD`
- Redis 配置：
  - `REDIS_HOST`、`REDIS_PORT`、`REDIS_PASSWORD`
- 服务端端口：
  - `PORT=3001`（HTTP + Socket.IO）
  - `WS_PORT=3002`（仅旧版 server.js 使用）
- 低队列快速切绿默认参数（后端调度器）：
  - `LOW_FLOW_WINDOW_SECONDS`、`LOW_FLOW_THRESHOLD`、`MIN_GREEN_FLOOR_SECONDS`
- 前端演示调参（Vite 只识别以 `VITE_` 开头的变量）：
  - `VITE_LOW_FLOW_WINDOW_SECONDS`、`VITE_LOW_FLOW_THRESHOLD`、`VITE_MIN_GREEN_FLOOR_SECONDS`
  - `VITE_DEMO_ARRIVAL_SCALE_STRAIGHT`、`VITE_DEMO_ARRIVAL_SCALE_LEFT`
  - `VITE_DEMO_RELEASE_STRAIGHT_SCALE`、`VITE_DEMO_RELEASE_LEFT_SCALE`

## 初始化数据库与缓存
- 确保 MySQL 与 Redis 服务已启动，账号与端口与 `.env` 一致。
- 首次启动时，后端会自动创建数据库与表（`api/config/database.js` 的 `initializeDatabase`）。

## 开发模式运行
```bash
# 前后端同时启动（推荐）
npm run dev

# 仅后端（nodemon + tsx 运行 api/server.ts）
npm run server:dev

# 仅前端（Vite 默认端口 5173）
npm run client:dev
```
前端默认访问地址：`http://localhost:5173`，后端 API 地址：`http://localhost:3001`。

## 常用脚本
```bash
npm run build       # 前端构建
npm run preview     # 前端本地预览（构建产物）
npm run lint        # 代码检查
npm run check       # TypeScript 类型检查
```

## 功能概览
- 仪表盘与流量分析（实时/历史）
- 路口与红绿灯管理（状态、模式、紧急操作）
- 紧急车辆处理（优先通行与恢复）
- 自适应时序算法（按车流动态调整）
- 功能演示（虚拟路口、秒级调度、可视化可调参数）

## 常见问题
- 端口占用 `EADDRINUSE: :::3001`
  - 原因：已有进程占用 3001 或重复启动 server.js 与 server.ts
  - 解决：结束占用进程或修改 `.env` 的 `PORT` 后重启
- 无法连接数据库或缓存
  - 检查 `.env` 配置与服务是否已启动
  - MySQL 需具备建库建表权限
- 前端未读取环境变量
  - Vite 仅识别以 `VITE_` 开头的变量；修改 `.env` 后需重启前端开发服务

## 备注
- 开发时只保留一个后端入口（建议 `npm run server:dev` 的 `api/server.ts`），避免与旧版 `api/server.js` 同时运行导致端口冲突。

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config({
  extends: [
    // Remove ...tseslint.configs.recommended and replace with this
    ...tseslint.configs.recommendedTypeChecked,
    // Alternatively, use this for stricter rules
    ...tseslint.configs.strictTypeChecked,
    // Optionally, add this for stylistic rules
    ...tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config({
  extends: [
    // other configs...
    // Enable lint rules for React
    reactX.configs['recommended-typescript'],
    // Enable lint rules for React DOM
    reactDom.configs.recommended,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```
