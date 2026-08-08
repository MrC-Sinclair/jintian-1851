# character-creation Specification

## Purpose
开局身份选择（文官/武将/商贾/士绅/宗室，各有 5 维属性偏移）与 AI 动态生成可选势力列表（含推荐势力高亮）。是每局角色的起点，决定初始属性分布与势力关系矩阵。
## Requirements
### Requirement: 身份选择

玩家开局 MUST 从 5 类近代身份中选择 1 类：文官、武将、商贾、士绅、宗室。每类身份有初始属性偏移。

#### Scenario: 玩家进入开局页面看到 5 类身份卡片

WHEN 玩家从首页点击「开始游戏」进入 `pages/character-create/index.vue`
THEN 页面展示 5 张身份卡片：文官、武将、商贾、士绅、宗室
AND 每张卡片显示身份名称、简介、初始属性偏移（如文官 `politics +10, diplomacy +5`）
AND 卡片可点击，触摸目标 ≥ 96px 高度

#### Scenario: 玩家选定身份后高亮显示

WHEN 玩家点击身份卡片
THEN 该卡片高亮（边框变朱红 `#8B1A1A` + 轻微 scale-105）
AND 其他卡片恢复正常样式
AND 底部「下一步」按钮从 disabled 变为 enabled

### Requirement: AI 动态生成可选势力列表

玩家选定身份后，前端 MUST 调用 `POST /api/game/init-factions`，服务端基于玩家身份 + 近代历史调用 LLM 生成 6-8 个可选势力。

#### Scenario: 服务端调用 LLM 生成势力

WHEN 前端发送 `POST /api/game/init-factions` body 为 `{ "background": "文官" }`
THEN 服务端使用 `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B` 模型调用 `generateObject()`
AND 提示词包含玩家身份、近代 1851-1912 历史背景、要求生成 6-8 个势力
AND 返回结构 `{ "factions": Faction[] }`，每个 Faction 含 `id, name, summary, initialPower, initialRelationship`
AND 势力名称符合近代历史（如湘军、淮军、太平天国、清廷、北洋、革命党等）

#### Scenario: AI 调用失败时降级返回预置势力

WHEN LLM 调用失败或超时（30 秒）
THEN 服务端从 `server/runtime/fallback-factions.ts` 返回 6 个预置势力
AND 预置势力按玩家身份调整（如文官开局默认推荐「清廷」、武将推荐「湘军」等）
AND 返回 `{ "factions": Faction[], "fallback": true }` 标识降级

#### Scenario: 参数校验失败返回 400

WHEN 前端发送 body 缺少 `background` 字段或 `background` 不在 5 类中
THEN 服务端返回 HTTP 400 + `{ "ok": false, "error": { "code": "INVALID_PARAMS", "message": "..." } }`

### Requirement: 势力选择与游戏状态初始化

玩家从 AI 生成的势力列表中选定 1 个后，前端 MUST 初始化 `GameSave` 对象并写入本地存储。

#### Scenario: 玩家选定势力后进入游戏主界面

WHEN 玩家在势力列表中点击某势力卡片
AND 弹出 `useConfirmDialog` 确认「确定选择 XX 势力吗？此选择不可更改」
AND 玩家点击「确认」
THEN 前端构建 `GameSave` 对象：
  - `saveId` = `crypto.randomUUID()` 或 `uni.getStorageSync('device_id') + Date.now()`
  - `saveVersion` = 1
  - `character.background` = 玩家所选身份
  - `character.factionId/name/summary` = 玩家所选势力
  - `state.turn` = 1
  - `state.date` = `{ year: 1851, month: 1 }`
  - `state.attributes` = 起始 50 ± 身份偏移
  - `state.resources` = `{ silver: 1000, troops: 500, food: 800, reputation: 10 }`
  - `factions` = AI 生成的其他势力（玩家所选势力除外）作为 NPC
  - `events` = `[]`、`advisorMessages` = `[]`
AND 写入 `uni.setStorage('game_save', save)`
AND `uni.navigateTo` 到 `pages/game-main/index.vue`

#### Scenario: 已有存档时提示覆盖

WHEN 玩家在首页点击「开始游戏」
AND 本地已有存档（`uni.getStorage('game_save')` 存在）
THEN 弹出 `useConfirmDialog`「检测到现有存档，开始新游戏将覆盖现有存档，是否继续？」
AND 玩家点击「确认」后进入身份选择
AND 玩家点击「取消」后返回首页

### Requirement: 势力卡片视觉规范

势力卡片 MUST 包含势力名称、简介、初始实力、与玩家关系初始值，并满足触摸目标尺寸。

#### Scenario: 势力卡片显示完整信息

WHEN 玩家进入势力选择页面
THEN 每张势力卡片显示：
  - 势力名称（思源宋体大号字）
  - 1-2 句简介（≤ 80 字）
  - 初始实力进度条（0-100）
  - 与玩家初始关系（-100 到 100，文官开局默认偏正面）
AND 卡片最小高度 96px
AND 卡片可点击，hover/active 时 `scale-95` 反馈

