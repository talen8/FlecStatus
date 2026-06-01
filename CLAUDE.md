# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

FlecStatus 是一个轻量级服务状态监控系统，基于 Cloudflare Workers + D1 构建。包含 HTTP/TCP 端点监控、事件管理、维护窗口、Webhook 通知和公开状态页面。源自 [Uptimer](https://github.com/VrianCao/Uptimer)。

## 常用命令

```bash
# 前端构建（Vue SPA → web/dist/）
npm run build:web

# 完整部署（前端构建 + wrangler deploy）
npm run deploy

# Lint
npm run lint

# 类型检查（后端 tsc + 前端 vue-tsc）
npm run typecheck

# 本地开发（需要 .dev.vars 配置 secrets）
wrangler dev
```

**注意**：项目没有测试框架，无 `test` 脚本。Node 版本要求 `>=22.14.0`。

## 架构概览

### 前后端分离，单仓库结构

- **后端** (`src/`) — Cloudflare Worker，Hono 框架，Drizzle ORM
- **前端** (`web/`) — Vue 3 SPA，Pinia 状态管理，TanStack Vue Query，SCSS 样式

### 后端请求处理流程

1. `src/index.ts` — Worker 入口，导出 `fetch` 和 `scheduled` 两个处理器
2. `src/fetch-handler.ts` — 热路径路由器，处理 `/api/homepage`、`/api/status` 等公开路径，带 D1 快照缓存和 Cloudflare Cache API
3. `src/hono-app.ts` — Hono 应用，管理后台路由（懒加载，减少冷启动 CPU 消耗）
4. 内部服务请求（hostname `internal`）通过 `SELF` binding 自调用，用于批量检查和分片快照组装

### 定时任务 (`scheduled` handler)

Cron 触发器 `* * * * *`（每分钟）：
- `runScheduledTick()` — 获取分布式租约，列出到期监控器，分批执行健康检查，持久化结果，刷新快照
- `runDailyRollup()` — UTC 00:00 聚合每日统计
- `runRetention()` — UTC 00:30 清理过期数据

### 关键目录

| 目录 | 职责 |
|---|---|
| `src/db/` | Drizzle ORM schema 定义、D1 客户端工厂、JSON 序列化辅助 |
| `src/monitor/` | HTTP/TCP 健康检查执行，状态机（up/down/maintenance 转换） |
| `src/scheduler/` | 定时调度、分布式锁、租约守卫、通知分发 |
| `src/routes/` | API 路由：admin CRUD 和 public 只读查询 |
| `src/snapshots/` | 预渲染公开快照，分片组装（适配 Free Plan CPU 限制） |
| `src/internal/` | 内部服务端点（通过 SELF binding 自调用） |
| `src/schemas/` | Zod 验证 schema |
| `src/middleware/` | Auth（Cloudflare Access）、缓存、限流、错误处理 |
| `web/src/api/` | 前端 API 客户端，带内存 + localStorage 缓存 |
| `web/src/stores/` | Pinia stores：auth、i18n、theme、query |

### 数据库

Cloudflare D1（SQLite），通过 Drizzle ORM 访问。Schema 在 `src/db/schema.ts`，迁移在 `src/migrate.ts`（版本化，首次请求时自动执行）。当前版本 1，约 17 张表。

### 认证

管理后台通过 Cloudflare Zero Trust 保护，检查 `Cf-Access-Authenticated-User-Email` 头。

## 代码风格

- **Prettier**: 100 字符行宽、单引号、尾逗号、2 空格缩进、LF 换行
- **ESLint**: TypeScript 严格模式（禁止 `any`、禁止非空断言）；Vue 推荐配置 + 自定义规则（`vue/block-order` script-template-style 顺序）
- **TypeScript**: `strict: true`、`noUncheckedIndexedAccess: true`、`exactOptionalPropertyTypes: true`、`verbatimModuleSyntax: true`
- 后端 globals 为 `serviceworker`，前端为 `browser`

## 部署

Wrangler 配置在 `wrangler.toml`：
- 静态资产从 `web/dist/` 提供，SPA fallback
- D1 binding 名为 `DB`
- `SELF` binding 为可选服务绑定（CI 中配置，不在 wrangler.toml 中）
- 开发时 secrets 通过 `.dev.vars` 加载
