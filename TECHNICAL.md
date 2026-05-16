# TECHNICAL

这份文档面向后续开发、维护和功能迭代。

## 架构

### 前端

- 技术栈：React 18 + TypeScript + Vite + Ant Design
- 入口：`src/App.tsx`
- 主要职责：
  - 登录态恢复
  - 菜单 hash 路由切换
  - 页面级状态管理
  - 表单抽屉与日志弹窗接线

### 后端

- 技术栈：Node.js + Express + SQLite
- 入口：`server.js`
- 主要职责：
  - 认证与会话
  - OpenList 服务 CRUD
  - 定时任务 CRUD
  - 任务调度
  - STRM 执行器
  - 运行日志记录
  - 备份导出 / 恢复

### 当前目录分层

- `src/modules/admin/layout`
  后台壳布局
- `src/modules/admin/pages`
  页面模块
- `src/modules/admin/forms`
  抽屉表单 / 密码弹窗
- `src/modules/admin/components`
  通用组件，如运行日志弹窗
- `src/modules/admin/utils.ts`
  页面工具函数

## 路由

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

- `id` 为 SQLite 自增主键
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

- `source_path` 为相对服务 `base_url` 的路径
- 实际执行时通过 `buildServiceSourcePath(baseUrl, sourcePath)` 拼完整源目录

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

- `details` 为 JSON 数组，保存逐条执行明细

## 执行器

执行逻辑参考 `example/alist2strm.js`，但当前已扩展为任务级可配置版本。

### 核心流程

1. 通过 `/api/fs/list` 递归列目录
2. 单文件路径通过 `/api/fs/get`
3. 对符合后缀的媒体文件生成 `.strm`
4. 可选下载字幕文件
5. 将临时目录同步到目标目录
6. 可选触发通知回调

### 当前任务级可配置项

- `max_concurrency`
- `download_extensions`
- `download_subtitles`
- `request_delay_seconds`
- `overwrite_existing`
- `notify_enabled`
- `callback_url`

### 关键函数

- `normalizeTaskPayload`
- `executeTaskRun`
- `handleGetList`
- `saveRemoteItem`
- `triggerCallback`

## 日志

运行日志保存在 `runs.details` 中，支持逐条明细展示。

示例：

- `欢迎来到实力至上主义的教室 S04E10.strm 创建成功`
- `xxx.ass 字幕下载成功`
- `xxx.strm 已存在，跳过创建`
- `回调通知已发送到 https://example.com/callback`

前端当前支持：

- 任务列表查看最新一条日志
- 从日志弹窗跳到该任务历史运行记录
- 运行记录页点击任务名查看完整日志详情

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

- 恢复为覆盖式恢复，不是 merge

## 已知问题

- 打包后主包较大，Vite 会提示 chunk size warning
- `server.js` 仍为单文件，继续演进会越来越难维护
- 某些 Windows 控制台查看 UTF-8 中文会乱码，但文件本身是 UTF-8

## 迭代建议

### 结构层面

1. 拆分后端：
   - `routes`
   - `services`
   - `storage`
   - `scheduler`
   - `executor`

### 功能层面

1. 运行记录分页
2. 日志导出 / 复制
3. 将页码和筛选同步到 URL
4. 通知回调测试按钮
5. 更细粒度的执行统计

### 质量保障

1. API 单测
2. 执行器行为测试
3. 关键表单交互测试

## 建议阅读顺序

1. `TECHNICAL.md`
2. `src/App.tsx`
3. `src/modules/admin`
4. `server.js`
5. `example/alist2strm.js`
