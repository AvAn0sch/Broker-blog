# Broker Blog

技术社区 MVP。产品范围见 [产品设计](docs/MVP产品设计文档.md)，实施结构见 [系统架构](docs/系统架构设计.md)，任务安排见 [开发规划](docs/开发规划.md)。当前已实现 A1 环境、A2 数据库/事务/任务基础、A3 账号认证与 A4 页面骨架及角色入口；下一步是 B1 草稿与受控媒体。

## Windows 开发

使用 Node.js **22.23.2**、pnpm **12.4.2**，数据库为原生 PostgreSQL **17.11**。具体依赖由 `package.json` 和 `pnpm-lock.yaml` 固定。

首次准备，在项目根目录运行：

```powershell
pnpm install --frozen-lockfile --offline=false
pnpm env:setup
pnpm db:install
pnpm db:start
pnpm db:migrate
pnpm db:seed
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

访问 [本地开发入口](http://127.0.0.1:3000)、[注册](http://127.0.0.1:3000/register)或[登录](http://127.0.0.1:3000/login)。请使用配置中的 `127.0.0.1`，不要混用 `localhost`，因为写请求校验精确 Origin。开发服务器显式采用 Webpack，避免本机 Turbopack 开发监听导致反复重载；生产构建仍使用 Turbopack。

另开终端运行 `pnpm worker`，当前 worker 消费持久任务并更新心跳；可以先 `pnpm jobs:probe` 再用 `pnpm worker:once` 验证单轮消费，`pnpm jobs:status` 查询结果。停止网页和 worker 使用 Ctrl+C；数据库用 `pnpm db:stop` 安全停止，数据保留。

管理员初始化与测试密码重置使用受限脚本，操作与参数见 [A3 账号与认证说明](docs/A3账号与认证实施说明.md)。不提供默认密码；注册只能创建普通用户。

## 检查与测试

```powershell
pnpm env:check
pnpm db:check
pnpm check
pnpm build
pnpm verify:environment
pnpm verify:foundation
pnpm verify:auth
```

`check` 生成路由类型后执行类型和规则检查；三个 verify 入口均执行当前完整回归。测试自动在测试数据库创建独立命名空间、应用迁移，结束后清理本轮数据和媒体。浏览器独立启动 `127.0.0.1:3100`，要求端口空闲，并且需要先停止日常 `pnpm dev`：同一目录下 Next.js 只允许一个开发服务器实例，第二个实例会拒绝启动。报告在 `.local/test-runs/<运行标识>/reports/`，保留用例结果、commit 和清理状态。骨架用例 `tests/e2e/shell.spec.ts` 覆盖游客、成员、封禁与管理员入口，账号 fixtures 在 `tests/fixtures/`。认证测试关闭敏感轨迹与页面快照，预览截图遮罩验证码。`next-env.d.ts` 按框架要求自动生成并忽略，Next.js 自动维护的 AGENTS.md 指引随项目保留。

`/api/health/live` 检查 Web 存活；`/api/health/ready` 检查迁移后的基础表和图片目录，失败返回 503。`/api/v1/health` 使用统一的 data/error/requestId 协议。浏览器安装使用 Playwright 锁定版本对应的 Chromium，保存在 `.local/playwright`。

首批业务结构和迁移已提交，启动应用前执行 `db:migrate`；它验证历史 hash，拒绝修改过的已应用迁移。后续变更用 `pnpm db:generate --name change_name` 创建新迁移并审查，禁止用 push 或手工改库替代。A2 设计与脚本说明见 [基础设施实施说明](docs/A2基础设施实施说明.md)。

## Linux 容器验证

先启动 Docker Desktop 的 Linux 引擎或在 Linux 主机安装 Docker Engine 与 Compose。配置仅提供隔离开发/验收环境，不开放数据库端口。

```powershell
pnpm compose:check
pnpm compose:up
pnpm compose:test
pnpm compose:stop
```

镜像在 Linux 内重新安装依赖和构建；迁移服务成功退出后 Web、worker 才能启动。test 服务等待它们就绪，再为本轮 schema 启动独立生产应用，执行规则、接口、持久化和双视口测试，报告写回宿主机 `.local/test-runs`。测试使用 `broker_blog_test` 库和非超级管理员角色，拒绝外部测试地址。`compose:stop` 保留数据；首次初始化脚本只在新数据库卷执行，改密码不会自动更新旧数据库卷。

若 Docker Hub 网络不可达，可从 [Google 官方公共镜像缓存](https://docs.cloud.google.com/artifact-registry/docs/pull-cached-dockerhub-images) 预取相同固定版本并添加本地标签，然后执行以上命令。本机初始化使用过以下入口：

```powershell
docker pull mirror.gcr.io/library/node:22.23.2-bookworm-slim
docker tag mirror.gcr.io/library/node:22.23.2-bookworm-slim node:22.23.2-bookworm-slim
docker pull mirror.gcr.io/library/postgres:17.11-bookworm
docker tag mirror.gcr.io/library/postgres:17.11-bookworm postgres:17.11-bookworm
```

运行隔离、清理及报告基础已落地；两轮完整业务验收仍由 E 阶段完成，当前测试不替代 MVP 全量 P0 验收。

## 项目结构

`src/app` 为页面与接口，`src/config` 为环境校验，`src/infrastructure/db` 为数据库入口，`src/worker` 为独立进程，`scripts` 为跨平台工具，`tests` 为规则/接口/浏览器验证与基础 fixtures，`deploy` 为 Linux 容器配置。`prototype` 保留独立静态参考稿。

版本来源与本机验证记录见 [开发环境说明](docs/开发环境说明.md)。每次完成改动需创建 Git commit。
