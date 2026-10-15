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

/**
 * 一次结算里某项属性的**实际**变化量。
 *
 * 注意这是「回执」，不是「预告」：它记录真正发生的变化，
 * 而不是效果里声明的意图。两者会不一致 —— 属性触顶时声明 `+4` 而实际只 `+2`，
 * 这时 `capped: 'max'` 告诉 UI 原因（不要显示成 +4 骗玩家）。
 */
export interface StatChange {
  key: StatKey
  delta: number
  /** 被上限/下限截断了：'max' = 已满，'min' = 见底 */
  capped?: 'min' | 'max'
}

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
  /**
   * 本局是否遇到过某个事件（按事件 id）。
   *
   * 为什么需要它：结算是「回顾这一局」，而 62 个事件里有很多值得提一句、
   * 却没有（也不该）单独设 flag 的——期中考试、体测、进实验室、开源 PR……
   * 靠 `flag` 表达这些会给 flag 命名空间塞进一堆纯叙事的东西。
   */
  | { type: 'seenEvent'; id: string }

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
 * 5. 内容定义：专业 / 行动 / 事件 / 结局
 * ========================================================== */

/**
 * 专业定义 —— 回答「你是谁」。
 *
 * 关键设计：专业**不是引擎里的一个分支**，而是内容上的一层可选标签。
 * 引擎只学会一句话：「凡是被 `majors` 标记过的内容，只有对应专业看得见；
 * 没标记的，所有专业共享。」除此之外它对专业一无所知 ——
 * 所以加第 3 个专业只需要写数据，引擎一行都不用改。
 */
export interface MajorDef {
  id: string
  /** 显示名，如「计算机」 */
  name: string
  /** 一句话身份，如「计算机专业大三学生」。开局日志与结算回顾共用这一处 */
  identity: string
  /** 开局选择界面上的介绍文案 */
  description: string
  /**
   * 相对 `config.initialStats` 的属性偏移。
   *
   * 刻意用「偏移」而不是每个专业重抄一份完整属性：基准数值只留一处，
   * 调平衡时改基准就能同时作用于所有专业，专业之间的差异也一眼看得清。
   */
  statBonus?: Partial<Stats>
}

/**
 * 内容归属的专业标签。
 *
 * `undefined` = 所有专业共享（绝大多数内容都是这样：宿舍矛盾、下雨、
 * 生病……这些事跟专业没关系）；写了 = 只有列出的专业能看见。
 */
export type MajorTags = string[] | undefined

/** 玩家每周可以执行的行动 */
export interface ActionDef {
  id: string
  label: string
  description: string
  /** 消耗的行动点 */
  cost: number
  /**
   * 可选条件（不满足则**不出现在列表里**）。
   *
   * ⚠️ **不要用 `chance`**：界面每次快照都会调 `availableActions()` 重新求值它，
   * 于是「渲染了几次」就等于「多消耗了几个随机数」—— 同种子复现和存档都会坏掉。
   * 概率请写进 `effects`（用 `if` + `chance`，或 `branch`）。
   * 这条规矩有静态检查守着（`engine.test.ts`「渲染求值的 requires 不许用 chance」）。
   */
  requires?: Condition
  effects: Effect[]
  /** 专属专业；不写 = 全专业共享 */
  majors?: MajorTags
}

/** 事件里的一个选项 */
export interface Choice {
  label: string
  /**
   * 不满足条件时该选项变灰、不可点。
   *
   * ⚠️ **不要用 `chance`**：理由同 `ActionDef.requires` ——
   * 界面每次快照都会调 `getPendingChoices()` 重新求值，渲染次数会变成随机数消耗次数。
   */
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
  /** 专属专业；不写 = 全专业共享 */
  majors?: MajorTags
}

export interface Ending {
  id: string
  title: string
  text: string
  /** 判定顺序，数字小的先判 */
  priority: number
  requires: Condition
  /** 专属专业；不写 = 全专业共享。兜底结局必须共享，否则会有专业没有结局 */
  majors?: MajorTags
}

/**
 * 一个「作品 / 项目」—— 需要多周持续投入，攒够进度才算做出来。
 *
 * ── 为什么它是一个机制而不是一堆普通行动 ──
 * 「多周投入 → 攒进度 → 完成 → 产出 flag」这套节奏和「一次行动、立刻结算」
 * 是两种不同的东西：进度必须被记住，而且是**跨周、可见**的。
 * 所以引擎提供一次这个机制（`getProjects()` / `investProject()`），
 * 各专业只写「有哪些项目」——引擎里没有任何一个具体项目的影子。
 *
 * ── 进度为什么存在 flags 里 ──
 * 刻意**不新增 `GameState` 字段**：`flags` 本来就是「记录发生过什么」的
 * 纯 JSON 容器，进度就是一个数值 flag。这样存档约束（I8）零成本满足，
 * 而进度 flag / 完成 flag 的 key 由数据声明（见下面两个字段），
 * 引擎不需要任何命名约定。
 *
 * ⚠️ `requires` 里**不要用 `chance`**：引擎每次渲染项目列表都会求值它，
 * 用 chance 会让「打开面板」这件事消耗随机数，破坏同种子复现。
 */
export interface ProjectDef {
  id: string
  name: string
  description: string
  /** 专属专业；不写 = 全专业共享（当前数据里项目都是各专业专属） */
  majors?: MajorTags
  /**
   * 解锁条件（不满足则显示为「未解锁」）。
   *
   * ⚠️ **不要用 `chance`**：界面每次快照都会调 `getProjects()` 重新求值，
   * 于是「打开面板」这件事本身就会消耗随机数，破坏同种子复现。
   */
  requires?: Condition
  /** 每次投入消耗的行动力，默认 1 */
  cost?: number
  /** 需要投入几次才算完成 */
  requiredInvestments: number
  /** 每次投入的效果（通常是小幅属性收益） */
  perInvest: Effect[]
  /** 完成时的一次性效果（奖励 + 产出 flag） */
  onComplete: Effect[]
  /**
   * 进度存放的数值 flag key。
   * 由**引擎**写入（每次投入 +1），所以静态「死 flag」审计要把它算作「已写入」。
   */
  progressFlag: string
  /** 完成标志 flag key（由引擎写入），供结局 / 回顾消费 */
  completionFlag: string
}

/** 一个项目在当前状态下的样子，UI 只需要看这个 */
export interface ProjectView {
  project: ProjectDef
  /** 已投入次数 */
  progress: number
  /** 需要投入几次 */
  required: number
  completed: boolean
  /** 解锁条件是否满足（false → UI 应该置灰） */
  unlocked: boolean
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
  /**
   * 这条日志造成的**实际**属性变化。没有属性变化时该字段不存在。
   *
   * 挂在日志上（而不是给 TurnResult 新增一个字段）的好处：
   * TurnResult 那个「稳定契约」不用改；而且 UI 天然按时间顺序同时拿到
   * 「发生了什么」和「后果是什么」，不需要自己配对。
   */
  changes?: StatChange[]
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
  /**
   * 本局所选专业 id。
   *
   * 为什么必须存进 state：存档（阶段 2.5）读回来时要能还原「你是谁」——
   * 专业决定了哪些事件/行动/结局/回顾可见，丢了它这局就还原不了。
   */
  majorId: string
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
  /** 可选专业。**至少一个**；不指定 majorId 时用第一个当默认 */
  majors: MajorDef[]
  actions: ActionDef[]
  events: GameEvent[]
  endings: Ending[]
  /** 可以多周投入做出来的作品 / 项目 */
  projects: ProjectDef[]
  /** 结算回顾的规则与文案（见 §7） */
  summary: SummaryContent
}

/* ============================================================
 * 7. 结算回顾：把 flag 和数字翻译成叙述
 *
 *    学期结束时给玩家一份「这 16 周你做了什么」，
 *    而不是只丢一个结局标题过去。数字要能变成故事。
 * ========================================================== */

/** 回顾要点的分类 —— UI 用它分组、上色、配图标 */
export type SummaryKind =
  | 'club' // 社团
  | 'academic' // 学业
  | 'skill' // 技能 / 作品
  | 'social' // 人际
  | 'love' // 情感
  | 'health' // 健康
  | 'money' // 经济
  | 'career' // 前途 / 求职
  | 'setback' // 挫折
  | 'notable' // 其他值得一提的

/**
 * 一条回顾规则：条件满足就产出一句叙述。
 *
 * 复用条件 DSL 而不是另写一套判断是刻意的 ——
 * 「什么情况该说这句话」和「什么情况该触发那个事件」本来就是同一件事，
 * 没必要有两套语义。所以在回顾规则里 `seenEvent` / `flag` / `stat` 全都能用。
 *
 * ⚠️ 规则里**不要用 `chance`**：回顾必须是确定的，
 * 否则同一局结算两次可能给出不同说法（而且会消耗 RNG，影响复现）。
 */
export interface SummaryRule {
  requires: Condition
  /** 叙述文案；`{n}` 会被 countFrom 指定的数值 flag 替换 */
  text: string
  kind: SummaryKind
  /** 取值来源：一个数值 flag 的 key，用于「投了 {n} 份简历」这种 */
  countFrom?: string
  /** 同一次结算内的排序，小的在前，默认 0 */
  order?: number
  /** 专属专业；不写 = 全专业共享 */
  majors?: MajorTags
}

export interface SummaryLine {
  kind: SummaryKind
  text: string
}

/**
 * 学期结算回顾。**由引擎产出**，CLI 和 Web 渲染同一份。
 *
 * 为什么不交给 UI 自己算：
 *  - 回顾要读 `flags` / `seenEvents` / `stats` 的全部语义，UI 拿不到
 *  - 命令行和浏览器必须给出同一份回顾（同种子同结果）
 *  - 这样它是**可测试的**：给一个状态，断言该出现哪几句
 */
export interface RunSummary {
  /** 一句话身份，如「计算机专业大三学生」 */
  identity: string
  /** 叙述要点（已按 order 排好序） */
  lines: SummaryLine[]
  /** 终局属性 */
  stats: Stats
  endingTitle: string
  /** 一句话总评，由**归一化后**最高的属性决定 */
  verdict: string
  seed: number
}

/** 结算回顾的内容（纯数据，由 data 层提供） */
export interface SummaryContent {
  /**
   * 注意这里**没有** `identity`：「你是谁」是专业决定的（`MajorDef.identity`），
   * 而回顾规则是全专业共用的一份。身份留在这里就会出现「专业改了、
   * 结算页还写着旧专业」的二源问题。
   */
  rules: SummaryRule[]
  /**
   * 主导属性 → 一句话总评。
   *
   * 注意是「归一化后」最高：六项属性的量纲不同
   * （金钱可以上万，其余是 0–100），直接比大小的话金钱永远第一。
   * 所以比较的是 `值 / 该项上限`。
   */
  verdicts: Record<StatKey, string>
}
