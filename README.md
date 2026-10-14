# Broker Blog

技术社区 MVP。产品范围见 [产品设计](docs/MVP产品设计文档.md)，实施结构见 [系统架构](docs/系统架构设计.md)，任务安排见 [开发规划](docs/开发规划.md)。当前实现为 A1 开发环境与连接验证入口，业务功能从 A2 起逐项开发。

## Windows 开发

使用 Node.js **22.23.2**、pnpm **12.4.2**，数据库为原生 PostgreSQL **17.11**。具体依赖由 `package.json` 和 `pnpm-lock.yaml` 固定。

首次准备，在项目根目录运行：

```powershell
pnpm install --frozen-lockfile --offline=false
pnpm env:setup
pnpm db:install
pnpm db:start
pnpm browser:install
pnpm db:check
```

`db:install` 从 PostgreSQL 官方指定的 EDB 分发站下载 Windows x64 二进制包，按发布方 SHA-256 校验后解压到 `.tools`，不注册系统服务。需要 Windows 自带 `tar`，若原生程序提示缺少 VC++ 运行库，安装微软 Visual C++ x64 Redistributable 后重试。Linux 原生开发可以安装同版本数据库并修改 `PG_BIN`，Linux 完整验证使用下述 Compose 配置。

`env:setup` 自动生成随机数据库密码与密钥，已有文件会保留。`.env.local`、`.env.test.local`、`.env.compose.local`、数据库、图片、浏览器和下载包均不提交 Git。数据库仅监听 `127.0.0.1:55432`，开发库 `broker_blog`、测试库 `broker_blog_test` 分离，应用账号不是超级管理员。已有同名账号和数据库不会被重建或重置密码。

日常运行：

```powershell
pnpm db:start
pnpm dev
```

访问 [本地开发入口](http://127.0.0.1:3000)。另开终端运行 `pnpm worker`，当前 worker 验证数据库连接并更新心跳；持久任务消费在 A2/C4 实现。停止网页和 worker 使用 Ctrl+C；数据库用 `pnpm db:stop` 安全停止，数据保留。

## 检查与测试

```powershell
pnpm env:check
pnpm db:check
pnpm check
pnpm build
pnpm verify:environment
```

`check` 生成 Next.js 路由类型后执行类型检查和配置规则测试；`verify:environment` 继续运行真实 PostgreSQL 接口检查与桌面/移动 Chromium 冒烟。浏览器测试独立启动 `127.0.0.1:3100`，要求测试库可连接且该端口空闲。接口检查包括真实事务回滚和非超级管理员权限；浏览器检查入口、键盘导航、视口溢出和健康检查跳转。报告在 `playwright-report`、`test-results`，均为本地运行产物。`next-env.d.ts` 按框架要求自动生成并忽略，Next.js 自动维护的 AGENTS.md 指引随项目保留。

`/api/health/live` 仅检查 Web 进程存活；`/api/health/ready` 检查数据库和图片目录，失败返回 503，不返回连接凭证。浏览器安装使用 Playwright 锁定版本对应的 Chromium，保存在 `.local/playwright`。

Drizzle 配置和 `db:generate`、`db:migrate` 入口已准备；业务 schema 与首批版本化迁移属于 A2，当前不需要执行 migrate。禁止用 `push` 或手工改库代替后续迁移。

## Linux 容器验证

先启动 Docker Desktop 的 Linux 引擎或在 Linux 主机安装 Docker Engine 与 Compose。配置仅提供隔离开发/验收环境，不开放数据库端口。

```powershell
pnpm compose:check
pnpm compose:up
pnpm compose:test
pnpm compose:stop
```

镜像在 Linux 内重新安装依赖和构建；Web、worker 使用相同代码，数据库及媒体分别持久化。Compose 的 `test` 服务等待 Web 和 worker 就绪后执行接口及两种视口测试。测试配置使用独立的 `broker_blog_test` 库和非超级管理员角色。`compose:stop` 保留数据；首次初始化脚本只在新数据库卷执行，改密码不会自动更新旧数据库卷。

若 Docker Hub 网络不可达，可从 [Google 官方公共镜像缓存](https://docs.cloud.google.com/artifact-registry/docs/pull-cached-dockerhub-images) 预取相同固定版本并添加本地标签，然后执行以上命令。本机初始化使用过以下入口：

```powershell
docker pull mirror.gcr.io/library/node:22.23.2-bookworm-slim
docker tag mirror.gcr.io/library/node:22.23.2-bookworm-slim node:22.23.2-bookworm-slim
docker pull mirror.gcr.io/library/postgres:17.11-bookworm
docker tag mirror.gcr.io/library/postgres:17.11-bookworm postgres:17.11-bookworm
```

未来两轮独立全量验收的运行隔离、清理与完整报告由 A2/E 继续实现；当前冒烟通过只证明基础环境可运行，不能替代 MVP 全量 P0 验收。

## 项目结构

`src/app` 为页面与接口，`src/config` 为环境校验，`src/infrastructure/db` 为数据库入口，`src/worker` 为独立进程，`scripts` 为跨平台工具，`tests` 为规则/接口/浏览器验证，`deploy` 为 Linux 容器配置。`prototype` 保留独立静态参考稿。

版本来源与本机验证记录见 [开发环境说明](docs/开发环境说明.md)。每次完成改动需创建 Git commit。
