# NPC 行动累计影响反馈 — 技术设计

## Goals

- **一眼知总冲击**：玩家在「天下动静」面板顶部即可看到本回合所有 NPC 行动对自身的累计影响，无需逐条心算。
- **落实设计规则**：将 `game-design.md:571` 的"NPC 行动 effects 累计影响玩家属性"从设计标注转为可用功能。
- **与 T2.8 互补不冲突**：T2.8 = 单条明细（谁对我做了什么）；本设计 = 聚合总览（我被总共影响了多少），两者共存。
- **零重复造轮子**：聚合展示复用 `EFFECT_LABELS` + `formatEffects` 着色体系，文案入 `copywriting.ts`，符合 `game-design.md:520/522` 治理约束。

## Non-Goals

- **不做**：修改后端 NPC 决策逻辑或 `effects` 生成（仅前端读取既有数据）
- **不做**：改变 `effects` 是否真正应用到玩家属性（那是 `useGameState.applyEffects` 职责，本设计只读展示）
- **不做**：态势预测 / 未来回合推演（仅展示已发生本回合的累计）
- **不做**：按势力分组聚合（首版按全量累计；势力分组可作为后续增强）

## Architecture

### 数据流

```
useTurn.ts → npcActions: NpcAction[]
                    │ （每个 action.effects: Partial<Attributes & Resources>）
                    ▼
game-main/index.vue → <NpcActionList :actions="npcActions" />
                    │
                    ▼
NpcActionList.vue
  ├─ computed: cumulative = aggregate(actions)   // 新增
  ├─ computed: cumulativeList = sortByAbsDesc(cumulative)  // 新增
  ├─ formatCumulativeEffects(cumulativeList)    // 复用 formatEffects 着色
  ├─ 顶部汇总卡片（新增）
  └─ 逐条明细（既有 T2.8，不动）
```

### 聚合算法（伪码）

```ts
function aggregate(actions: NpcAction[]): Partial<Attributes & Resources> {
  const acc: Record<string, number> = {}
  for (const a of actions) {
    if (!a.effects) continue
    for (const [k, v] of Object.entries(a.effects)) {
      if (typeof v === 'number') acc[k] = (acc[k] ?? 0) + v
    }
  }
  return acc
}

// 按绝对值降序重建有序对象（0 值过滤交给 formatEffects），最受影响维度在前
// 重建后直接传入既有 formatEffects，复用其 0 值过滤 + EFFECT_LABELS + 红/绿着色
function sortByAbsDesc(effs: Record<string, number>): Partial<Attributes & Resources> {
  const sorted = Object.entries(effs)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  return Object.fromEntries(sorted)
}
```

## Decisions

### D1：汇总放在顶部 vs 底部 vs 独立抽屉

**决策：放在「天下动静」面板顶部（header 下方、列表项上方）**

理由：
- 顶部符合"先总后分"的阅读习惯，玩家进面板先看到本回合总冲击，再决定是否细看明细。
- 不新增独立抽屉/弹层，改动面最小，不增加交互层级。
- 与 T2.8 明细在视觉上自然形成"总—分"结构。

### D2：聚合范围是否含"决策失败"NPC

**决策：仅聚合带 `effects` 的 `actions` 条目，决策失败项（`T3.4`）不计入**

理由：
- 决策失败卡片语义是"该势力本回合没行动"，其无 `effects`，自然不会进入 `aggregate`（循环内 `if (!a.effects) continue`）。
- 避免玩家误以为"决策失败"也是一种影响。UI 上汇总卡片与失败卡片分区明显，不混淆。

### D3：复用 formatEffects 着色 vs 新写

**决策：不新增独立着色函数；对 `cumulative` 按绝对值降序重建有序对象后，直接喂给现有 `formatEffects`**

理由：
- `game-design.md:520` 强制统一从 `EFFECT_LABELS` 取标签，禁止局部硬编码。
- 着色规则（负红正绿）是全局视觉语言，聚合版必须一致，否则玩家认知割裂。
- 现有 `formatEffects`（`NpcActionList.vue:144-158`）已封装"过滤 0 值 + `EFFECT_LABELS` 取标签 + 红/绿着色"，返回 `{key, text, cls}[]`，但**不携带原始数值**，无法对其结果按绝对值排序。故采用"先排序后格式化"路径：对 `cumulative` 的 entries 按绝对值降序排序、重建为有序对象（`sortByAbsDesc`），再传入 `formatEffects`——`formatEffects` 零改动，彻底复用，杜绝复制着色逻辑。
- 通过复用而非复制，降低后续维护成本（标签/着色改一处即全生效）。

### D4：文案硬编码 vs copywriting.ts

**决策：标题与空态文案入 `copywriting.ts`（新增常量），组件引用**

理由：
- `game-design.md:522-526` 集中管理原则：所有面向玩家文案必须集中在 `copywriting.ts`。
- 便于后续统一调性（古风措辞）、多端复用、避免散落硬编码。

### D5：空态处理

**决策：汇总卡内累计值全 0 或 `formatEffects` 返回空数组时，显示 `本回合各方按兵不动，暂无累计影响`**

理由：
- 避免展示一个全 0 的空汇总卡片（视觉噪音）。
- 给玩家明确正向反馈（本回合没被外部冲击），符合"反馈闭环"体验。

### D6：汇总卡显示前提（避免与既有空态重复 / 与失败卡片语义冲突）

**决策：汇总卡仅在 `props.actions.length > 0`（本回合有成功生成的 NPC 行动）时渲染**

理由：
- 组件已有 `totalCount === 0` 时的整面板空态 `EMPTY_TEXT.npcActions`（"本回合各方暂无行动"，`NpcActionList.vue:16-19`）。若 `actions` 为空仍渲染汇总卡，会与既有空态同时出现两条近义文案，语义冗余。
- 更隐蔽的冲突：`actions` 为空但 `failedFactionIds` 非空（全部 NPC 决策失败）时，`totalCount > 0` 会渲染"决策失败"卡片，此时若再叠加"本回合各方按兵不动"累计空态，语义矛盾（明明是决策失败，却说按兵不动）。
- 故汇总卡的**显示前提**为 `props.actions.length > 0`；卡内再判断累计值是否全 0 以决定显示 chips 还是 D5 空态。

## 多端兼容方案

| 能力 | H5 | 微信小程序 | App |
| --- | --- | --- | --- |
| Vue `computed` 聚合 | ✅ | ✅ | ✅ |
| `EFFECT_LABELS` 标签 | ✅ | ✅ | ✅ |
| rpx 着色样式 | ✅ | ✅ | ✅ |
| `copywriting.ts` 常量 | ✅ | ✅ | ✅ |

> 纯前端展示逻辑 + rpx，无浏览器独有 API，不影响小程序/App 构建。

## 视觉规格（建议）

- 汇总卡片：浅色背景块（`#f5e6c8` 系，与 T2.8 impact 区呼应），圆角，内联展示维度 chips。
- 维度 chip：负 = 红字（`#c62828` 系，与 `formatEffects` `--negative` 一致）/ 正 = 绿字（`#2e7d32` 系，与 `--positive` 一致），格式 `军事 -3`。
- 排序：绝对值降序，最受影响维度在左。
- 标题：小字 + 分隔，不与"天下动静"主标题抢视觉层级。
- 平板端（`sm:`）：rpx 自适应缩放，chips 容器 `flex-wrap` 自动换行，无需额外断点样式。

## 验证方案

- **单元（建议新增）**：`aggregate` 多行动相加正确、`sortByAbsDesc` 0 值过滤 + 降序、决策失败项（无 effects）不计入。
- **组件（lint）**：`cd game-web && pnpm lint`（含 stylelint，无报错）。
- **交互（Playwright）**：进入对局，触发含多 NPC 行动的回合，截图确认顶部汇总卡片展示累计值、着色正确、与逐条明细一致；空回合确认空态文案。
- **文档**：落地后回标 `game-design.md:571` 对应条目标注"已落地"。
