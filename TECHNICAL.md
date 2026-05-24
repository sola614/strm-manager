# TECHNICAL

这份文档面向后续开发、维护和功能迭代。

## 运行环境

- 推荐 Node.js：24
- 最低 Node.js：`>=20.19`
- 包管理器：npm，锁文件为 `package-lock.json`
- Docker 基础镜像：`node:24-alpine`

说明：

- Vite 8 要求 Node `^20.19.0 || >=22.12.0`。
- `better-sqlite3` 是原生模块。本机安装时可能需要 Python 和 C++ Build Tools；Docker 构建阶段已经安装 `python3 make g++`。

## 技术栈

### 前端

- React 19
- TypeScript 6
- Vite 8
- Ant Design 6
- 入口：`src/main.tsx`
- 主应用：`src/App.tsx`

主要职责：

- 登录态恢复
- Hash 菜单路由切换
- 页面级状态管理
- 表单抽屉与日志弹窗接线
- 运行中任务的运行记录自动刷新

### 后端

- Node.js
- Express 5
- SQLite
- `better-sqlite3`
- `node-cron`
- 入口：`server.js`

主要职责：

- 认证与会话
- OpenList 服务 CRUD
- 定时任务 CRUD
- 任务调度
- STRM 执行器
- 运行记录写入与更新
- 备份导出 / 恢复

## 目录分层

- `src/modules/admin/layout`：后台壳布局
- `src/modules/admin/pages`：页面模块
- `src/modules/admin/forms`：抽屉表单 / 密码弹窗
- `src/modules/admin/components`：通用组件，如运行日志弹窗
- `src/modules/admin/utils.ts`：页面工具函数
- `src/lib/api.ts`：前端 API 客户端
- `src/lib/cron.ts`：Cron 表达式解析工具

## 前端路由

前端通过 `location.hash` 维护当前模块：

- `#/dashboard`
- `#/services`
- `#/tasks`
- `#/runs`
- `#/backup`

刷新后会保留当前模块。

## API

### 认证

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `PUT /api/auth/password`

### OpenList 服务

- `GET /api/services`
- `POST /api/services`
- `PUT /api/services/:id`
- `DELETE /api/services/:id`

### 定时任务

- `GET /api/tasks`
- `POST /api/tasks`
- `PUT /api/tasks/:id`
- `DELETE /api/tasks/:id`
- `POST /api/tasks/:id/trigger`
- `GET /api/tasks/:id/runs`

### 运行记录

- `GET /api/runs`

### 备份

- `GET /api/backup/export`
- `POST /api/backup/import`

## 数据库

### 表：`services`

字段：

- `id`
- `name`
- `url`
- `token`
- `base_url`
- `created_at`
- `updated_at`

说明：

- `id` 是 SQLite 自增主键
- 前端不允许手填

### 表：`tasks`

字段：

- `id`
- `name`
- `service_id`
- `source_path`
- `target_path`
- `cron`
- `max_concurrency`
- `download_extensions`
- `download_subtitles`
- `request_delay_seconds`
- `overwrite_existing`
- `notify_enabled`
- `callback_url`
- `created_at`
- `updated_at`
- `last_run_at`

说明：

- `source_path` 是相对服务 `base_url` 的路径
- 实际执行时通过 `buildServiceSourcePath(baseUrl, sourcePath)` 拼出完整源目录

### 表：`runs`

字段：

- `id`
- `task_id`
- `task_name`
- `service_id`
- `service_name`
- `trigger_type`
- `started_at`
- `completed_at`
- `status`
- `message`
- `details`
- `processed_count`
- `subtitle_count`
- `skipped_count`
- `failure_count`

说明：

- `details` 是 JSON 数组，保存逐条执行明细
- 任务开始时插入 `running` 记录
- 任务完成后更新同一条记录的状态、结束时间、统计数量和日志详情

## 执行器

执行逻辑参考 `example/alist2strm.js`，当前已扩展为任务级可配置版本。

核心流程：

1. 通过 `/api/fs/list` 递归列目录
2. 单文件路径通过 `/api/fs/get`
3. 对符合后缀的媒体文件生成 `.strm`
4. 可选下载字幕文件
5. 将临时目录同步到目标目录
6. 可选触发通知回调
7. 更新运行记录和任务最近运行时间

任务级配置项：

- `max_concurrency`
- `download_extensions`
- `download_subtitles`
- `request_delay_seconds`
- `overwrite_existing`
- `notify_enabled`
- `callback_url`

关键函数：

- `normalizeTaskPayload`
- `executeTaskRun`
- `handleGetList`
- `saveRemoteItem`
- `triggerCallback`

## 运行记录

运行日志保存在 `runs.details` 中，支持逐条明细展示。

前端支持：

- 任务列表查看最新一条日志
- 从日志弹窗跳到该任务历史运行记录
- 运行记录页点击任务名查看完整日志详情
- 存在 `running` 记录时自动轮询刷新运行记录和任务列表

## 分页与状态持久化

当前通过 `localStorage` 持久化：

- 服务管理每页条数
- 任务管理每页条数
- 运行记录每页条数

当前尚未持久化：

- 当前页码
- 服务筛选条件
- 任务筛选条件

## 备份恢复

### 导出

- `GET /api/backup/export`
- 返回：
  - `version`
  - `exportedAt`
  - `services`
  - `tasks`

### 恢复

- `POST /api/backup/import`
- 上传 JSON 文件
- 恢复流程：
  1. 停掉当前调度
  2. 清空 `services / tasks / runs`
  3. 重建服务
  4. 映射旧服务 ID 到新服务 ID
  5. 重建任务
  6. 重新注册调度

说明：

- 恢复是覆盖式恢复，不是 merge

## Docker

Dockerfile 使用多阶段构建：

1. `deps`：基于 `node:24-alpine` 安装依赖和原生模块编译工具
2. `build`：执行 `npm run build` 并裁剪开发依赖
3. `runner`：只复制生产依赖、`server.js` 和 `dist`

运行时默认：

- `PORT=4173`
- `DATABASE_PATH=/app/data/database.sqlite`
- `/app/data` 用于持久化 SQLite 数据库

如果任务要写入宿主机媒体目录，需要额外挂载目录，并在任务中使用容器内路径。

## 迭代建议

结构层面：

1. 拆分后端：
   - `routes`
   - `services`
   - `storage`
   - `scheduler`
   - `executor`

功能层面：

1. 运行记录分页
2. 日志导出 / 复制
3. 将页码和筛选同步到 URL
4. 通知回调测试按钮
5. 更细粒度的执行统计

质量保障：

1. API 单测
2. 执行器行为测试
3. 关键表单交互测试

## 建议阅读顺序

1. `README.md`
2. `src/App.tsx`
3. `src/modules/admin`
4. `server.js`
5. `example/alist2strm.js`
