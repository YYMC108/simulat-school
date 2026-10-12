/**
 * 引擎的核心类型定义。
 *
 * 这里没有任何浏览器 / DOM / 框架的依赖，所以引擎既能在命令行跑，
 * 也能在浏览器跑，还能被单元测试直接调用。
 */

/** 随机数发生器：返回 [0, 1) 的浮点数。注入它就能让测试完全可复现。 */
export type RNG = () => number

/* ============================================================
 * 1. 属性系统
 * ========================================================== */

/** 玩家的六项属性 */
export interface Stats {
  /** 学业：绩点、成绩 */
  academic: number
  /** 社交：人脉、朋友 */
  social: number
  /** 健康：体能、睡眠 */
  health: number
  /** 心情：情绪状态 */
  mood: number
  /** 金钱：元 */
  money: number
  /** 技能：编程、英语等硬实力 */
  skill: number
}

export type StatKey = keyof Stats

/** 每项属性的取值范围（防止数值溢出到失控） */
export type StatRange = Record<StatKey, { min: number; max: number }>

/* ============================================================
 * 2. Flag 系统
 *    用于记录「发生过什么」：是否加入社团、欠债几次……
 * ========================================================== */

export type FlagValue = number | boolean
export type Flags = Record<string, FlagValue>

/* ============================================================
 * 3. 条件 DSL（用数据描述「什么情况下触发」）
 *    这是整个项目最巧妙的地方：策划改数值不用碰代码。
 * ========================================================== */

export type CompareOp = '>=' | '<=' | '>' | '<' | '==' | '!='

/**
 * 判别联合（discriminated union）：TS 能根据 type 字段自动推断出
 * 每个分支有哪些字段，写错字段名会直接编译报错。
 */
export type Condition =
  /** 属性比较，如：学业 >= 80 */
  | { type: 'stat'; key: StatKey; op: CompareOp; value: number }
  /** flag 为真（true 或非 0 数字） */
  | { type: 'flag'; key: string }
  /** flag 等于某个值 */
  | { type: 'flagEq'; key: string; value: FlagValue }
  /** 数值型 flag >= 某值，如：欠债次数 >= 3 */
  | { type: 'flagAtLeast'; key: string; value: number }
  /** 周数比较，如：week >= 10（考期/期末） */
  | { type: 'week'; op: CompareOp; value: number }
  /** 取反 */
  | { type: 'not'; condition: Condition }
  /** 全部满足（空数组 = 恒真，用作兜底结局） */
  | { type: 'all'; conditions: Condition[] }
  /** 任一满足（空数组 = 恒假） */
  | { type: 'any'; conditions: Condition[] }
  /** 概率命中，如：30% 概率触发 */
  | { type: 'chance'; probability: number }

/** 条件求值需要的全部上下文 */
export interface EvalContext {
  state: GameState
  config: GameConfig
  rng: RNG
}

/* ============================================================
 * 4. 效果系统（用数据描述「结果是什么」）
 * ========================================================== */

export type Effect =
  /** 属性增减 */
  | { type: 'stat'; key: StatKey; delta: number }
  /** 设置 flag */
  | { type: 'setFlag'; key: string; value: FlagValue }
  /** 数值型 flag 累加 */
  | { type: 'addFlag'; key: string; delta: number }
  /** 往日志里写一条消息 */
  | { type: 'log'; text: string }
  /** 条件效果：满足条件才生效（可嵌套） */
  | { type: 'if'; requires: Condition; effects: Effect[] }
  /**
   * 概率分支：按权重随机挑一个分支执行，必定命中且只命中一个。
   *
   * 为什么需要它？因为「if + 50% chance / if + not chance」这种写法是错的
   * ——那是两次独立的随机，可能两个分支都不中。概率分支才是唯一正确解。
   */
  | { type: 'branch'; options: { weight: number; effects: Effect[] }[] }
  /** 直接结束游戏并指定结局 */
  | { type: 'end'; endingId: string }

/* ============================================================
 * 5. 内容定义：行动 / 事件 / 结局
 * ========================================================== */

/** 玩家每周可以执行的行动 */
export interface ActionDef {
  id: string
  label: string
  description: string
  /** 消耗的行动点 */
  cost: number
  /** 可选条件（不满足则不出现在列表里） */
  requires?: Condition
  effects: Effect[]
}

/** 事件里的一个选项 */
export interface Choice {
  label: string
  /** 不满足条件时该选项变灰、不可点 */
  requires?: Condition
  effects: Effect[]
}

export type EventCategory = 'random'

export interface GameEvent {
  id: string
  title: string
  text: string
  category: EventCategory
  /** 随机池中的权重，默认 1 */
  weight?: number
  /** 是否允许一局内重复触发，默认 false（只触发一次） */
  repeatable?: boolean
  /** 触发前置条件 */
  requires?: Condition
  /** 有选项就等玩家选，没有就直接结算 effects */
  choices?: Choice[]
  effects?: Effect[]
  tags?: string[]
}

export interface Ending {
  id: string
  title: string
  text: string
  /** 判定顺序，数字小的先判 */
  priority: number
  requires: Condition
}

/* ============================================================
 * 6. 游戏状态与配置
 * ========================================================== */

export interface GameConfig {
  /** 总周数（一个学期） */
  totalWeeks: number
  /** 每周行动点 */
  actionPointsPerWeek: number
  initialStats: Stats
  statRanges: StatRange
  /** 每周结束时的固定结算（生活费、压力累积……） */
  weeklyEffects: Effect[]
  /** 每周触发随机事件的概率 */
  weeklyEventChance: number
}

export interface LogEntry {
  week: number
  kind: 'action' | 'event' | 'system' | 'ending'
  text: string
}

/** 完整存档状态：一个纯 JSON 对象，可以直接丢进 localStorage */
export interface GameState {
  week: number
  actionPoints: number
  stats: Stats
  flags: Flags
  /** 已经触发过的非重复事件 id */
  seenEvents: string[]
  log: LogEntry[]
  endingId: string | null
}

/** 一次操作的返回值，UI 只需要看这个 */
export interface TurnResult {
  /** 这次操作新产生的日志 */
  logs: LogEntry[]
  /** 需要玩家做选择的事件（没有则为 null） */
  pending: GameEvent | null
  ended: boolean
}

/** 一整套游戏内容，由数据层提供，注入给引擎 */
export interface GameData {
  config: GameConfig
  actions: ActionDef[]
  events: GameEvent[]
  endings: Ending[]
}
