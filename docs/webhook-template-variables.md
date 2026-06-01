# Webhook 通知模板变量

配置通知渠道时，负载模板（`payload_template`）和消息模板（`message_template`）支持以下变量。

不同事件类型的 payload 不同，事件特定字段在其他事件下为空。建议用 `{{default_message}}` 作为详情区，它会根据事件类型自动生成对应内容。

## 通用变量（所有事件可用）

| 变量 | 说明 |
|---|---|
| `{{event}}` | 事件类型，如 `monitor.down`、`incident.created` |
| `{{event_id}}` | 事件唯一键 |
| `{{timestamp}}` | Unix 秒级时间戳 |
| `{{message}}` | 消息内容（受「消息模板」字段影响） |
| `{{default_message}}` | 系统默认消息（根据事件类型自动生成） |
| `{{channel.id}}` | 通知渠道 ID |
| `{{channel.name}}` | 通知渠道名称 |
| `{{payload}}` | 原始 payload 整体 |

## monitor.down / monitor.up

| 变量 | 说明 |
|---|---|
| `{{monitor.id}}` | 监控器 ID |
| `{{monitor.name}}` | 监控器名称 |
| `{{monitor.type}}` | 监控器类型（`http` / `tcp`） |
| `{{monitor.target}}` | 监控目标地址 |
| `{{state.status}}` | 检查结果状态（`up` / `down`） |
| `{{state.latency_ms}}` | 响应延迟（毫秒） |
| `{{state.http_status}}` | HTTP 状态码（TCP 监控为 null） |
| `{{state.error}}` | 错误信息 |

## incident.created / incident.updated / incident.resolved

| 变量 | 说明 |
|---|---|
| `{{incident.id}}` | 事件 ID |
| `{{incident.title}}` | 事件标题 |
| `{{incident.status}}` | 事件状态（`investigating` / `identified` / `monitoring` / `resolved`） |
| `{{incident.impact}}` | 影响等级（`none` / `minor` / `major` / `critical`） |
| `{{incident.message}}` | 事件描述 |
| `{{incident.started_at}}` | 开始时间 |
| `{{incident.resolved_at}}` | 解决时间（未解决为 null） |
| `{{incident.monitor_ids}}` | 关联监控器 ID 列表 |

### incident.updated 额外变量

| 变量 | 说明 |
|---|---|
| `{{update.id}}` | 更新记录 ID |
| `{{update.status}}` | 更新状态 |
| `{{update.message}}` | 更新内容 |
| `{{update.created_at}}` | 更新时间 |

## maintenance.started / maintenance.ended

| 变量 | 说明 |
|---|---|
| `{{maintenance.id}}` | 维护窗口 ID |
| `{{maintenance.title}}` | 维护标题 |
| `{{maintenance.message}}` | 维护描述 |
| `{{maintenance.starts_at}}` | 开始时间 |
| `{{maintenance.ends_at}}` | 结束时间 |
| `{{maintenance.monitor_ids}}` | 关联监控器 ID 列表 |

## default_message 生成规则

`{{default_message}}` 根据事件类型自动生成对应内容，格式如下：

| 事件 | 生成内容示例 |
|---|---|
| `monitor.down` | 监控离线：Example Monitor (https://example.com) |
| `monitor.up` | 监控恢复：Example Monitor (https://example.com) |
| `incident.created` | 事件创建：API 异常（影响：major） |
| `incident.updated` | 事件更新：API 异常 |
| `incident.resolved` | 事件已解决：API 异常 |
| `maintenance.started` | 维护开始：数据库升级 |
| `maintenance.ended` | 维护结束：数据库升级 |
| `test.ping` | FlecStatus 测试通知 |

消息语言取决于通知渠道配置中的「语言」设置，支持简体中文、繁体中文、English。
