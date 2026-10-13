# ai-advisor 规格变更（局势简报超时预算与非阻塞）

## MODIFIED Requirements

### Requirement: 新回合军师主动局势简报

每回合开始时，游戏 MUST 调用 `POST /api/game/advisor-briefing` 获取军师主动生成的局势简报（60 字内），在 `FocusPanel` 与 `AdvisorDrawer` 中展示，让玩家无需主动提问即可获得当前局势分析与建议。该请求 MUST NOT 阻塞回合首屏：事件就绪即交还玩家，简报异步落地；且 MUST 有乱序保护，旧回合的迟到响应不得覆盖新回合简报。

#### Scenario: 回合开始触发简报

WHEN `useTurn.startTurn()` 执行
THEN 发起 `POST /api/game/advisor-briefing`，body 为 `{ saveId, turn, stateSnapshot }`
AND **不 await** 该请求 —— 事件生成完成即交还玩家，简报不参与首屏的关键路径
AND 简报返回后触发 `onBriefing(briefing)` 落地展示
AND 失败/超时降级为 `null`，不抛错、不阻断回合开始

#### Scenario: 迟到的旧回合简报被丢弃

WHEN 上一回合的简报响应晚于本回合的简报返回
THEN 按请求序号（`briefingSeq`）比对，序号不是当前回合的响应 MUST 丢弃
AND 理由：不 await 之后响应顺序不再可信，不保护就会出现「新回合显示旧建议」

#### Scenario: 简报超时不得伪装成成功

WHEN 简报调用超过 `BRIEFING_TIMEOUT_MS`（现值 20s）
THEN 返回 200 + `{ summary:'', suggestion:'' }` + `X-Fallback: true`
AND 该响应 MUST 可被监控与成本报表区分（`X-Fallback` 或 `fallback` 标记），
    不允许"空内容 + 200 + 无标记"——修复前正是这种形态让 8/8 超时在线上隐身

#### Scenario: 简报展示在 FocusPanel

WHEN 简报返回非空 `suggestion`
THEN `FocusPanel` 建议行显示"💡 {suggestion}"
AND 覆盖规则生成的建议

WHEN 简报返回非空 `summary`
THEN `FocusPanel` 可选展示 `summary`（如危机行下方）

#### Scenario: 简报展示在 AdvisorDrawer

WHEN 玩家打开 `AdvisorDrawer` 且本回合简报未展示过
THEN 消息列表顶部自动插入一条 assistant 消息（标签"局势简报"）

### Requirement: 局势简报 API 规格

`POST /api/game/advisor-briefing` MUST 接受局势快照，返回结构化的局势简报与建议，遵循统一响应格式与错误处理。超时预算 MUST 依据实测延迟分布设定，MUST NOT 画在中位数上（那等于把一半请求判死）。

#### Scenario: 正常请求

WHEN 客户端 POST `{ saveId, turn, stateSnapshot }` 且参数合法
THEN 服务端调用 `Qwen/Qwen3-8B` + `generateObject()` + `createSiliconFlowFetch(false)`（`enable_thinking:false`）
AND zod schema `{ summary: z.string().max(60), suggestion: z.string().max(60) }` 约束输出
AND 返回 200 `{ ok: true, data: { summary, suggestion } }`

#### Scenario: 超时预算取 20 秒

WHEN 服务端为简报设置 `AbortSignal.timeout`
THEN 预算 MUST 为 `BRIEFING_TIMEOUT_MS = 20_000`
AND 依据：原值 10s 画在实测延迟分布的中位数上，线上连续 8 次调用 8/8 卡在 10.09s
AND 不重试 —— 简报是纯增益信息，重试等于再花一次调用成本换一条建议，
    还会把首屏不确定地拉长到 40 秒；宁可降级为空

#### Scenario: 参数校验失败

WHEN body 缺失字段或类型错误（如 `saveId` 非 UUID、`turn` 非正整数）
THEN 返回 400 `{ ok: false, error: { code: 'INVALID_PARAMS', message: '参数错误' } }`
AND 不调用 LLM

#### Scenario: LLM 调用失败降级

WHEN LLM 调用抛异常或返回非法 JSON
THEN 返回 200 `{ ok: true, data: { summary: '', suggestion: '' }, fallback: true }` + header `X-Fallback: true`
AND 不 throw `createError`（避免阻断游戏）
AND `console.error` 记录错误

#### Scenario: 限流归属不变

WHEN 简报请求进入中间件
THEN 归入 `ai` 桶（10 次/分钟），MUST NOT 为它单开桶
AND 理由：它与其它 AI 端点成本同量级，单开桶只会稀释限流的意义
