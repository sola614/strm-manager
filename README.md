# strm-manager

基于 `React + Node.js + SQLite` 的 STRM 任务管理后台，用来管理 OpenList 服务、定时任务、运行记录，以及配置备份恢复。

## 功能

- OpenList 服务管理
- 定时任务管理
- 手动触发任务
- 运行记录与日志详情查看
- 配置备份与恢复
- 首次登录强制修改默认密码

## 运行环境

推荐使用：

- Node.js 24
- npm 11+

项目依赖 Vite 8，最低 Node 版本要求为 `>=20.19`。由于 `better-sqlite3` 是原生模块，Windows 本机安装最新依赖时可能需要 Python 和 Visual Studio C++ Build Tools。Docker 构建环境已经内置所需编译工具。

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

生产构建与启动：

```bash
npm run build
npm run start
```

默认访问地址：

```text
http://localhost:4173
```

## Docker

使用已发布镜像运行：

```bash
docker run -d \
  --name strm-manager \
  -p 4173:4173 \
  -e ADMIN_PASSWORD=admin \
  -e DATABASE_PATH=/app/data/database.sqlite \
  -e STRM_TARGET_PATH=/media/strm \
  -v strm-manager-data:/app/data \
  ghcr.io/sola614/strm-manager:latest
```

使用 Docker Compose：

```bash
docker compose pull
docker compose up -d
```

更新到最新镜像：

```bash
docker compose pull
docker compose up -d
```

如需本地构建镜像：

```bash
docker build -t strm-manager .
```

如果任务需要把 STRM 文件写入宿主机目录，请额外挂载目标目录，并把 `STRM_TARGET_PATH` 设置为容器内路径，例如：

```yaml
environment:
  STRM_TARGET_PATH: /media/strm
volumes:
  - strm-manager-data:/app/data
  - D:/media/strm:/media/strm
```

新增任务时，STRM 文件存放目录会默认填入：

```text
/media/strm
```

## 默认登录

- 用户名：`admin`
- 初始密码：`admin`

首次登录后必须修改密码。Docker 部署时建议通过 `ADMIN_PASSWORD` 设置初始管理员密码。

## 忘记密码

如果忘记管理员密码，可以临时设置 `RESET_ADMIN_PASSWORD` 重置密码。

Docker Compose 示例：

```yaml
environment:
  RESET_ADMIN_PASSWORD: admin123456
```

然后重启容器：

```bash
docker compose up -d
```

使用新密码登录后，系统会要求再次修改密码。修改完成后，请删除 `RESET_ADMIN_PASSWORD` 并再次重启容器，避免每次启动都把密码重置回该值。

## OpenList 服务配置

每个 OpenList 服务包含：

- `name`
- `url`
- `token`
- `baseUrl`

说明：

- `url`：OpenList 服务地址
- `token`：OpenList API Token
- `baseUrl`：播放链接与源目录拼接时使用的前缀，默认 `/`

## 定时任务配置

每个定时任务包含：

- `name`
- `serviceId`
- `sourcePath`
- `targetPath`
- `cron`
- `maxConcurrency`
- `downloadExtensions`
- `downloadSubtitles`
- `requestDelaySeconds`
- `overwriteExisting`
- `notifyEnabled`
- `callbackUrl`

说明：

- `sourcePath`：相对服务 `baseUrl` 的视频源目录或单文件路径
- `targetPath`：本地 STRM 文件存放目录；Docker 部署时请填写容器内已映射目录
- `cron`：支持每小时、每天、每周、每月和自定义 Cron
- `callbackUrl`：通知开启后必填；任务有生成文件或下载字幕时自动回调

## 备份恢复

后台提供“备份管理”页面，支持：

- 导出当前服务与任务配置为 JSON
- 上传 JSON 备份文件恢复配置

恢复是覆盖式恢复，会清空当前服务、任务和运行记录后再重建。

## 项目结构

- `server.js`：后端 API、认证、调度和任务执行器
- `src/modules/admin`：后台页面、表单和组件
- `src/lib/api.ts`：前端 API 客户端
- `src/lib/cron.ts`：Cron 表达式解析工具
- `example/alist2strm.js`：执行逻辑参考实现

## 文档

- 技术文档：[TECHNICAL.md](./TECHNICAL.md)
- 贡献指南：[CONTRIBUTING.md](./CONTRIBUTING.md)
