# local-save Specification

## Purpose
定义 `GameSave` 结构与版本化（`saveVersion`），基于 `uni.getStorage` 的本地持久化与读取。存档含角色、状态、势力、事件、军师对话、结局标志等全部字段，是离线可玩与同步上传的数据载体。
## Requirements
### Requirement: 存档结构与版本化

本地存档 MUST 遵循 `GameSave` 接口定义，含 `saveVersion` 字段便于后续迁移。

#### Scenario: 存档结构完整

WHEN 检查 `uni.getStorage('game_save')`
THEN 返回对象含以下字段：
  - `saveVersion: 1`
  - `saveId: string (UUID)`
  - `deviceId: string`
  - `createdAt: number (timestamp)`
  - `updatedAt: number (timestamp)`
  - `character: { background, backgroundPerks, factionId, factionName, factionSummary }`
  - `state: { turn, date: { year, month }, attributes: {...}, resources: {...} }`
  - `factions: Array<{ id, name, summary, power, relationship, status, lastAction? }>`
  - `events: Array<{ turn, eventType, title, description, playerChoice, effects }>`（最近 50 条，`eventType` ∈ `民生|军事|外交|随机|历史剧情|npc`）
  - `advisorMessages: Array<{ role, content, turn, timestamp }>`（最近 20 条）
  - `ended: boolean`（结局标志，初始 false）
  - `endedAt: number (timestamp, 可选)`（仅 ended=true 时存在）
  - `endedReason: string (可选)`（仅 ended=true 时存在，如「太平天国占领北京」「1900 年八国联军」等）

#### Scenario: 存档大小可控

WHEN 检查存档 JSON 字符串大小
THEN 大小 ≤ 30 KB
AND 不超过 `uni.setStorage` 单 key 1MB 上限

### Requirement: 存档读写封装

所有存档读写 MUST 通过 `utils/storage.ts` 封装，禁止直接调用 `uni.setStorage`。

#### Scenario: 封装 save 方法

WHEN 调用 `useSaveSync().save(save)`
THEN 内部调用 `uni.setStorage({ key: 'game_save', data: save })`
AND 更新 `save.updatedAt = Date.now()`
AND 触发 Pinia store 中的 `currentSave` 状态更新

#### Scenario: 封装 load 方法

WHEN 调用 `useSaveSync().load()`
THEN 内部调用 `uni.getStorage('game_save')`
AND 返回 `GameSave | null`（不存在时 null）
AND 同步更新 Pinia store `currentSave`

#### Scenario: 封装 clear 方法

WHEN 调用 `useSaveSync().clear()`
THEN 内部调用 `uni.removeStorage('game_save')`
AND 清空 Pinia store `currentSave`

### Requirement: 历史事件截断

存档 `events` 数组超过 50 条时 MUST 自动截断。

#### Scenario: 事件超过 50 条截断

WHEN 玩家完成第 51 个事件
THEN `save.events` 数组只保留最近 50 条
AND 截断的旧事件不可恢复

### Requirement: 军师对话截断

存档 `advisorMessages` 数组超过 20 条时 MUST 自动截断。

#### Scenario: 对话超过 20 条截断

WHEN 玩家发送第 21 条军师消息
THEN `save.advisorMessages` 数组只保留最近 20 条
AND 截断的旧对话不可恢复

### Requirement: 存档迁移预留

`saveVersion` 字段 MUST 存在，未来版本变更时通过迁移函数处理。

#### Scenario: 加载旧版本存档时迁移

WHEN `load()` 读出的存档 `saveVersion < CURRENT_SAVE_VERSION`
THEN 调用 `migrateSave(oldSave)` 函数链式迁移到最新版本
AND 迁移成功后写回存储并更新 `saveVersion`
AND 迁移失败时抛错并提示用户「存档损坏，无法继续」

#### Scenario: MVP 版本仅支持 v1

WHEN 检查 `CURRENT_SAVE_VERSION`
THEN 等于 1
AND `migrateSave` 函数为空实现（仅返回原对象）

### Requirement: 存档标记结局

游戏结束时存档 MUST 标记 `ended: true` 防止继续操作。

#### Scenario: 触发结局后写入 ended

WHEN 任一结局触发（胜利/失败/时光尽头）
THEN `save.ended = true`
AND `save.endedAt = Date.now()`
AND `save.endedReason = 'military_collapse' | 'economy_collapse' | ... | 'time_up' | 'victory'`
AND 写入存储

#### Scenario: 已结束存档禁止继续

WHEN 玩家在已结束存档上尝试操作（如点击「下一回合」）
THEN 前端检测 `save.ended === true`
AND 拦截操作并提示「本局已结束，请返回首页开始新游戏」
AND 不发送任何 AI 请求

