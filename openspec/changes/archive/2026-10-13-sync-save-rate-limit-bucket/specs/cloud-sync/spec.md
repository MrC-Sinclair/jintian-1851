# cloud-sync 规格变更（写端点限流分桶）

## ADDED Requirements

### Requirement: 写端点必须有频率上限且按端点分桶
所有会产生写入的端点 MUST 落在某个限流桶里，MUST NOT 存在"默认不限流"的写路径。
桶按 `deviceId` 独立计数、窗口 60 秒，当前配额：`ai` 10 次/分钟、`save` 30 次/分钟。
判定函数 MUST 返回桶标识而非布尔值（`getRateBucket(path): RateBucket | null`），
因为中间件需要知道请求进哪个桶。

#### Scenario: sync-save 走独立的 save 桶
- **WHEN** 客户端连续请求 `POST /api/game/sync-save`
- **THEN** 同一 `deviceId` 在 60 秒内第 31 次起返回 429 + `RATE_LIMITED`
- **AND** 线上实测：连打 32 次为 30×400（参数错误）后两发 429
- **AND** 理由：此前 sync-save 被 `shouldRateLimit` 显式排除，是所有写端点里唯一无上限的
      —— 每次带一个新 `saveId` 就插一行，可被用来把系统盘写满

#### Scenario: 桶之间互不影响
- **WHEN** 某设备的 `save` 桶已被打满
- **THEN** 同设备的 `GET /api/game/saves` 与 AI 端点仍按 `ai` 桶独立计数，不因 save 桶耗尽而 429
- **AND** 线上实测：save 桶打满后同设备 `GET /api/game/saves` 返回 400 参数错误而非 429

#### Scenario: 正常回合流不得被限死
- **WHEN** 玩家正常推进一个回合（`generate-event` + `advisor-briefing` + `npc-actions` +
      `resolve-decision` + `sync-save` 共 4-5 个请求）
- **THEN** `sync-save` MUST NOT 与 AI 端点共用同一个 10 次/分钟计数器
- **AND** 理由：并桶会让手快的玩家两三个回合就被 429 卡住，等于为堵一个滥用口
      把正常玩法限死 —— 这正是分桶存在的原因

#### Scenario: 新增写端点必须显式归桶
- **WHEN** 新增任何写端点
- **THEN** 它 MUST 在 `getRateBucket` 里被显式归类（新语义需新桶时要同时定义配额与理由）
- **AND** MUST NOT 依赖"未匹配即不限流"的默认行为
- **AND** 已知限制：计数是进程内 Map，多实例部署下各算各的，横向扩容前必须换共享存储
