# strm-manager

`strm-manager` 是一个基于 OpenList 服务生成 STRM 文件的管理后台。它会通过 OpenList API 扫描网盘目录，生成 Jellyfin、Emby 等媒体服务器可识别的 `.strm` 文件，让媒体库可以直接播放云盘视频。

适用场景：

- 管理多个 OpenList 服务连接
- 手动或定时扫描 OpenList 目录并生成 `.strm` 文件
- 支持字幕文件下载
- 查看任务运行记录、实时日志和历史日志
- 管理生成后的 STRM 文件，并在线查看 `.strm` 内容
- 导出/导入配置备份，快速恢复环境

技术栈：`React + Vite + Ant Design` 前端，`Express + SQLite` 后端。

## 功能

- OpenList 服务管理，支持批量启用/禁用
- STRM 生成任务管理，支持手动任务和 Cron 定时任务
- 定时任务支持批量启用/禁用
- 任务运行记录、独立详情页和 WebSocket 实时日志
- 运行日志使用独立 `run_logs` 表存储，并兼容旧版 `runs.details` 数据
- 文件管理支持目录浏览、批量删除、双击查看 `.strm` 内容和复制内容
- 系统配置支持修改端口、默认输出目录、日志清理策略和时区
- 配置备份导出/导入
- Docker 镜像内置 `/api/health` 健康检查

## 运行环境

推荐：

- Node.js 24
- npm 11+

项目依赖 Vite 8，最低 Node 版本要求为 `>=20.19`。由于 `better-sqlite3` 是原生模块，本地安装依赖时可能需要 Python 和 C++ 编译工具。Docker 构建环境已经内置所需编译工具。

## Docker 部署

```bash
docker run -d \
  --name strm-manager \
  -p 4173:4173 \
  -e DATABASE_PATH=/app/data/database.sqlite \
  -e STRM_TARGET_PATH=/media/strm \
  -e TZ=Asia/Shanghai \
  -v strm-manager-data:/app/data \
  ghcr.io/sola614/strm-manager:latest
```

使用 Docker Compose：

```bash
docker compose pull
docker compose up -d
```

如果任务需要把 STRM 文件写入宿主机目录，需要额外挂载目标目录，并把 `STRM_TARGET_PATH` 设置为容器内路径：

```yaml
environment:
  STRM_TARGET_PATH: /media/strm
  TZ: Asia/Shanghai
volumes:
  - ./data:/app/data
  - D:/media/strm:/media/strm
```

容器内置健康检查，请求地址：

```text
http://127.0.0.1:4173/api/health
```

## Node.js 部署

```bash
npm install
npm run build
npm run start
```

默认访问地址：

```text
http://localhost:4173
```

## 系统配置

系统配置可在管理后台修改，主要包括：

- `PORT`：Web 服务端口。运行中修改后需要重启应用才会按新端口监听。
- `defaultStrmTargetPath`：新建任务时默认填入的 STRM 输出目录。
- `timezone`：任务调度和时间显示使用的时区，例如 `Asia/Shanghai`。
- `logCleanupEnabled` / `logRetentionDays`：运行日志自动清理策略。

Docker 部署时，数据库位于 `DATABASE_PATH` 指向的位置。只要 `/app/data` 已持久化挂载，后台修改的系统配置、服务、任务和日志都会保存在 SQLite 数据库里，容器重建后仍然保留。

## 管理员登录

- 用户名：`admin`

首次进入系统时，登录页会直接展示管理员密码设置表单。设置完成后即可进入管理后台。

## 忘记密码

如果忘记管理员密码，可以临时设置 `RESET_ADMIN_PASSWORD` 重置登录状态。

Docker Compose 示例：

```yaml
environment:
  RESET_ADMIN_PASSWORD: true
```

然后重启容器：

```bash
docker compose up -d
```

重启后进入登录页，系统会要求重新设置管理员密码。设置完成后，请删除或注释 `RESET_ADMIN_PASSWORD`，再重启容器，避免每次启动都进入重置流程。

## 本地开发

安装依赖：

```bash
npm install
```

同时启动前后端：

```bash
npm run dev
```

只启动前端：

```bash
npm run dev:client
```

只启动后端：

```bash
npm run dev:server
```

运行测试：

```bash
npm run test
```

生产构建：

```bash
npm run build
```

## 后端结构

后端入口保持在根目录 `server.js`，只负责创建服务并监听端口。业务代码拆分在 `server/` 目录：

- `server/bootstrap.js`：创建 Express、数据库、配置、调度器和运行上下文
- `server/routes/`：API 路由
- `server/stores/`：SQLite 数据访问
- `server/services/`：任务执行、文件管理、备份恢复、OpenList URL 处理
- `server/ws/`：运行日志 WebSocket
- `server/utils/`：通用工具

STRM 下载链接生成逻辑位于 `server/services/openlistUrl.js`，并通过 `server/services/openlistUrl.test.js` 覆盖中文路径、`/d/` 下载路径和 `sign` 参数编码。

## 文档

- 技术文档：[TECHNICAL.md](./TECHNICAL.md)
