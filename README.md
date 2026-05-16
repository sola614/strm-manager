# strm-manager

一个基于 `React + Node.js + SQLite` 的 STRM 任务管理后台，用来管理 OpenList 服务、定时任务、运行日志，以及配置备份恢复。

## Features

- OpenList 服务管理
- 定时任务管理
- 手动触发任务
- 运行日志查看
- 配置备份与恢复
- 首次登录强制修改默认密码

## Default Login

- 用户名：`admin`
- 初始密码：`admin`

首次登录后必须修改密码。

## Service Config

每个 OpenList 服务配置：

- `name`
- `url`
- `token`
- `baseUrl`

说明：

- `url`：OpenList 服务地址
- `token`：OpenList API Token
- `baseUrl`：播放链接与源目录拼接时使用的前缀，默认 `/`

## Task Config

每个定时任务配置：

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
- `targetPath`：本地 `strm` 文件存放目录；Docker 部署时请确保目录已正确映射
- `cron`：支持“每小时 / 每天 / 每周 / 每月 / 自定义”
- `callbackUrl`：通知开启后必填；任务有生成文件或下载字幕时自动回调

## Run

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

生产构建：

```bash
npm run build
npm run start
```

## Docker

```bash
docker build -t strm-manager .
docker run -p 4173:4173 -e ADMIN_PASSWORD=admin strm-manager
```

或：

```bash
docker compose up -d --build
```

## Backup

后台提供独立“备份管理”页面，支持：

- 导出当前服务与任务配置为 JSON
- 上传 JSON 备份文件恢复配置

恢复是覆盖式恢复，会清空当前服务、任务和运行记录后再重建。

## Docs

- 技术文档：[TECHNICAL.md](./TECHNICAL.md)
- 开源说明：[OPEN_SOURCE.md](./OPEN_SOURCE.md)
- 贡献指南：[CONTRIBUTING.md](./CONTRIBUTING.md)

## Project Structure

- `server.js`：后端 API、认证、调度和任务执行器
- `src/modules/admin`：后台页面、表单和组件
- `src/lib/api.ts`：前端 API 客户端
- `example/alist2strm.js`：执行逻辑参考实现
