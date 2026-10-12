/**
 * @file 名望档位表（后端副本，供 NPC 决策 prompt 注入）
 *
 * 为什么这里有一份拷贝：game-web/ 与 server/ 是两个独立 pnpm 子项目，无法互相 import。
 * 真值来源是 `game-web/src/utils/constants.ts` 的 `HISTORY_RATINGS`，本表逐字段镜像它，
 * 由 `game-web/tests/unit/mirror-consistency.test.ts` 直接 import 本模块做深比较防漂移——
 * 所以**表结构必须与前端完全一致**（含前端用不到的 remark），少一个字段就退化成注释约定。
 *
 * 语义：只偏置 NPC 的意图与文案，不改任何数值结算（与 faction 记忆的 D8 处理方式一致）。
 *
 * 划线数值随「1 回合 = 1 年」的时钟重标过一次（旧 85/65/40/20 在年钟下会把五档压成两档），
 * 改动必须同时改前端那张表，否则 mirror-consistency 测试直接红。
 */

/** 名望档位（与前端 HistoryRating 同构） */
export interface ReputationBand {
  /** 该档下限（名望 ≥ 此值即入档） */
  min: number
  label: string
  remark: string
  /** 注入 NPC system prompt 的态度倾向提示 */
  npcStance: string
}

export const REPUTATION_BANDS: ReputationBand[] = [
  {
    min: 78,
    label: '天下归心',
    remark: '口碑载道，四方望风而归。',
    npcStance: '玩家名望天下归心，你轻举妄动会招清议围攻，宜先示好或观望'
  },
  {
    min: 60,
    label: '朝野称望',
    remark: '名动京师，士民称贤。',
    npcStance: '玩家名望朝野称望，你须给它三分面子，挑衅代价高'
  },
  {
    min: 42,
    label: '声名平平',
    remark: '无功无过，时人评价不一。',
    npcStance: '玩家名望平平，你的行动不受舆论掣肘，按自身利益决断即可'
  },
  {
    min: 22,
    label: '物议沸然',
    remark: '非议四起，信誉渐失。',
    npcStance: '玩家物议沸然、信誉低落，你可公开藐视、趁机施压'
  },
  {
    min: -Infinity,
    label: '身败名裂',
    remark: '口碑崩坏，为天下笑。',
    npcStance: '玩家身败名裂为天下笑，你可毫不顾忌地进逼吞并'
  }
]

/**
 * 取名望所属档位（表按 min 降序，最后一档 min=-Infinity 兜底）
 * @param reputation 玩家名望（0-100，超过 100 由前端 applyEffects 封顶）
 */
export function getReputationBand(reputation: number): ReputationBand {
  return (
    REPUTATION_BANDS.find((b) => reputation >= b.min) ??
    REPUTATION_BANDS[REPUTATION_BANDS.length - 1]
  )
}
