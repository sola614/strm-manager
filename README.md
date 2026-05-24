# strm-manager

`strm-manager` 是一个基于 OpenList 服务生成 STRM 文件的管理后台。它通过 OpenList 提供的 WebDAV 获取网盘视频播放链接，并生成可被 Jellyfin、Emby 等影音媒体服务器识别的 `.strm` 文件，实现云盘视频直接播放。

适用场景：

- 管理多个 OpenList 服务连接
- 通过 WebDAV 获取网盘视频播放链接并生成 `.strm` 文件
- 定义和执行 STRM 生成任务
- 通过 Cron 定时扫描并生成 `.strm` 文件
- 查看运行结果、日志详情和任务状态
- 导出/导入配置备份，快速恢复环境

技术栈：`React + Vite` 前端，`Express + SQLite` 后端

## 功能

- OpenList 服务管理
- 定时任务管理
- 手动触发任务
- 运行记录与独立日志详情页查看
- 配置备份与恢复
- 首次登录设置管理员密码

## 运行环境

推荐使用：

- Node.js 24
- npm 11+

项目依赖 Vite 8，最低 Node 版本要求为 `>=20.19`。由于 `better-sqlite3` 是原生模块，Windows 本机安装最新依赖时可能需要 Python 和 Visual Studio C++ Build Tools。Docker 构建环境已经内置所需编译工具，推荐使用。

## 部署方式
### Docker部署
```bash
docker run -d \
  --name strm-manager \
  -p 4173:4173 \
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

### nodejs部署
```bash
npm run build
npm run start
```

## 管理员登录

- 用户名：`admin`

首次进入系统时，登录页会直接展示管理员密码设置表单。设置完成后即可进入管理面板。

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

重启后进入登录页，系统会直接展示管理员密码设置表单。设置完成后，请删除 `RESET_ADMIN_PASSWORD` 并再次重启容器，避免每次启动都进入重置流程。

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

## 文档

- 技术文档：[TECHNICAL.md](./TECHNICAL.md)
