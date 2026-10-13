/**
 * 数值平衡模拟器。
 *
 *   pnpm simulate                每个专业 × 每种风格 200 局
 *   pnpm simulate -- --games 1000
 *
 * 它会用几种「决策风格」各跑大量对局，然后**按专业**输出：
 *   1. 结局 × 风格的命中率矩阵
 *   2. 每种风格的终局平均属性
 *   3. 从来没被触发过的结局  ← 最重要的输出
 *   4. 内容健康度：跨局重复度、死事件、冷热事件排行
 *
 * 第 3 点特别关键：一个「永远触发不到的结局」就是一段死代码。
 * 人肉试玩几十局是发现不了的，但跑几千局一眼就能看出来。
 *
 * 为什么必须**按专业**统计（阶段 2 之后）：
 *   内容现在带 `majors` 标签。如果只跑全局统计，文科的专属事件会被别的专业
 *   触发的次数掩盖 —— 一个「只有计算机能触发」的事件在全局统计里看着很正常，
 *   但它对文科来说就是死内容。所以统计口径必须降到专业维度：
 *   **每个专业只统计自己看得见的内容，并且这些内容必须自己都能触发到。**
 *
 * 整个模拟是「种子确定」的 —— 同样的 --games 永远得到同样的结果，
 * 所以这个逻辑可以直接被单元测试断言（见 tests/engine.test.ts）。
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'

import { GAME_DATA } from '../data/index'
import { GameEngine } from '../engine/engine'
import { matchesMajor } from '../engine/majors'
import { STAT_LABELS, STAT_ORDER } from '../engine/effects'
import { mulberry32, pickOne, pickWeighted } from '../engine/rng'
import { padEndWidth, padStartWidth } from './text'
import type {
  ActionDef,
  Effect,
  Ending,
  GameData,
  GameEvent,
  ProjectDef,
  Stats,
  SummaryRule,
} from '../engine/types'

// STAT_ORDER 现在从 engine/effects 统一导出（CLI 和 Web 共用一份顺序）

/**
 * 决策风格：给每个行动一个偏好权重（没列出的默认 1，填 0 表示不会主动选）。
 * 这几种风格覆盖了现实中大学生的主要「玩法」。
 *
 * 同一个风格对两个专业的行动各给一份权重：这样「学霸」在文科里是
 * 「多读书多写」，在计算机里是「多自习多写代码」，风格语义是连续的。
 * 注意**风格名不要改** —— 金标指纹（tests/golden-fingerprint.ts）是按名字索引的，
 * 改名会让历史对局失去参照。
 */
export const STRATEGIES: Record<string, Record<string, number>> = {
  均衡派: {
    study: 4, socialize: 4, exercise: 3, rest: 3, parttime: 3, code: 4, job_hunt: 3,
    write: 3, read_lit: 4,
    // 「不花钱的社交」：只是没钱时的退路，不该成为主力（数值被 simulate 打回过一次）
    hangout: 2,
    __project: 0,
  },
  学霸: {
    study: 9, socialize: 1, exercise: 2, rest: 2, parttime: 2, code: 3, job_hunt: 2,
    write: 3, read_lit: 5,
    // 约人打球要占一下午学业，学霸最不情愿
    hangout: 1,
    __project: 0,
  },
  技术宅: {
    study: 3, socialize: 1, exercise: 2, rest: 2, parttime: 2, code: 9, job_hunt: 4,
    write: 9, read_lit: 2,
    // 权重 0：这个风格**主动避开人群**。
    //
    // 这条不是随手填的：加了「约同学打球」（不花钱的社交）之后，
    // 「大部分时间都是一个人过的」（social ≤ 30）在两个专业都变成了死规则 ——
    // 因为从此再穷也能涨社交，谁都不会落到 30 以下。
    // 而「孤僻的技术宅」是这个项目一开始就刻意保留的设定
    //（README 的坑列表里记着：当年「投简历」白送社交 +2 就把这个设定堵死过一次）。
    // 所以让这个风格继续不社交，是在保护那条人设，而不是为了把规则「调活」。
    hangout: 0,
    __project: 0,
  },
  社交达人: {
    study: 2, socialize: 9, exercise: 2, rest: 2, parttime: 2, code: 2, job_hunt: 1,
    write: 2, read_lit: 2,
    // 这个风格以前会被「钱包见底就交不到朋友」卡死（聚餐要 ¥40），
    // 现在它有了不花钱的那条路。但权重不能给高：一个真·社交达人穷到没钱时
    // 也总得去兼职（每周还要 −100 生活费），否则会一路穷到「为钱所困」
    //（实测给到 6 时，社交达人风格的为钱所困从 18.5% 涨到 31.5%）
    hangout: 3,
    __project: 0,
  },
  躺平: {
    study: 1, socialize: 3, exercise: 2, rest: 9, parttime: 2, code: 1, job_hunt: 1,
    // 文科的两个专属行动权重是 0（= 这个风格不会主动选）。
    //
    // 这不是为了把结局「调出来」，而是因为原来的 躺平 在文科身上**根本不是躺平**：
    // 它会主动读书、主动写稿，于是学业一路保在 70 分以上，
    // 「学业崩塌」这条对文科生完全真实的失败路线就没人代表了。
    // 摆烂的文科生就是既不读书也不动笔 —— 这个风格必须存在。
    write: 0, read_lit: 0,
    // 躺平就是躺着：不主动约人
    hangout: 1,
    __project: 0,
  },
  随机: { __project: 0 },

  /**
   * 作品派：这学期就是想做出点东西来。
   *
   * 为什么单独加一个风格，而不是给上面 6 个风格都加上项目权重：
   *   项目是**新机制**。让老风格继续完全不投项目（`__project: 0`），
   *   金标指纹就能继续证明「加机制没有扰动原有平衡」——
   *   上面 6 行的收益分布至今和引入项目之前逐位一致。
   *   而项目的可达性、平衡影响与「完成 flag 能不能被结局消费」，
   *   全部由这一个风格来覆盖。
   *
   * `__project` 是**opt-in** 的：没写这个 key 的风格一律不投项目
   *（默认值是 0，见 playOne），所以新增风格不会意外改变老风格的随机流。
   */
  作品派: {
    study: 3, socialize: 2, exercise: 2, rest: 3, parttime: 2, code: 4, job_hunt: 1,
    write: 5, read_lit: 3,
    hangout: 1,
    __project: 6,
  },
}

/* ---------------- 单个专业的可见内容 ---------------- */

/** 某个专业看得见的那份内容切片（死内容检查的判据就是它） */
export interface MajorContent {
  actions: ActionDef[]
  events: GameEvent[]
  endings: Ending[]
  projects: ProjectDef[]
  summaryRules: SummaryRule[]
  /**
   * 每周固定衰减/结算。
   *
   * 必须算进「内容切片」：它是**会写 flag 的**（比如 `穷困周数` 就是在这里 +1 的）。
   * 少收集这一处，flag 审计就会把 `穷困周数` 误报成「读了却没人写」——
   * 这个假警报真的出现过一次。
   */
  weeklyEffects: Effect[]
}

export function contentFor(majorId: string): MajorContent {
  return {
    actions: GAME_DATA.actions.filter((item) => matchesMajor(item.majors, majorId)),
    events: GAME_DATA.events.filter((item) => matchesMajor(item.majors, majorId)),
    endings: GAME_DATA.endings.filter((item) => matchesMajor(item.majors, majorId)),
    projects: GAME_DATA.projects.filter((item) => matchesMajor(item.majors, majorId)),
    summaryRules: GAME_DATA.summary.rules.filter((item) => matchesMajor(item.majors, majorId)),
    // 每周固定结算不区分专业（它是全专业共通的生活成本），所以原样带过来
    weeklyEffects: GAME_DATA.config.weeklyEffects,
  }
}

/* ---------------- 单局模拟 ---------------- */

export interface SimOutcome {
  majorId: string
  endingId: string
  stats: Stats
  /** 本局触发过的事件 id —— 用于度量内容覆盖和跨局重复度 */
  seenEvents: string[]
  /** 本局结算回顾的文案（渲染后，`{n}` 已替换）—— 用于检查回顾规则有没有死规则 */
  summaryLines: string[]
  /** 本局完成的项目 id —— 用于检查有没有「死项目」 */
  completedProjects: string[]
  /**
   * 本局里**曾经可点**的选项，key 形如 `ev_gym_card#0`。
   *
   * 为什么记这个而不是「玩家实际选了什么」：
   * 模拟器是随机选选项的，所以「没被选中」可能只是运气；
   * 而「**从来没能点**」才是真正的问题 —— 说明那个 `requires` 严到
   * 条件永远凑不齐，玩家一辈子看不到这个选项（比如钱永远攒不够）。
   * 这条不变量是加「花钱换属性」时补的：那些选项靠 `money >= X` 把关，
   * 而钱在这个游戏里是紧的，很容易写出一个永远点不起的门槛。
   */
  enabledChoices: string[]
  /**
   * 本局里**曾经出现在行动菜单上**的行动 id。
   *
   * 为什么不直接记「选过哪些」：模拟器按权重随机选，「没被选中」可能只是运气；
   * 而「从来没出现在菜单里」说明它的 `requires` 永远不满足 —— 玩家看不到它。
   * 行动是内容里最常被写的一类，却是最后一个被纳入「死内容」检查的：
   * 加「约同学打球（钱 < 40 才出现）」时正好需要它来验证门槛真的会被触发。
   */
  enabledActions: string[]
}

/** playOne 的一个候选动作：一次行动，或者向某个项目投一次 */
interface Candidate {
  /** 仅用于调试与权重查表，如 `code` / `project:proj_poetry` */
  label: string
  weight: number
  run: () => void
}

/**
 * 用指定决策风格跑一局。seed 固定则结果固定。不传 majorId 则用默认专业。
 *
 * `data` 默认就是 GAME_DATA；传别的内容集只为一件事：
 * 「把一个专业单独拎出来跑，结果必须和它在完整数据集里一模一样」——
 * 这是「加专业只写数据」最直接的判据（见 tests 里的差分不变量）。
 */
export function playOne(
  seed: number,
  weights: Record<string, number>,
  majorId?: string,
  data: GameData = GAME_DATA,
): SimOutcome {
  const engine = new GameEngine(data, majorId === undefined ? { seed } : { seed, majorId })
  const rng = mulberry32(seed * 7919 + 13)
  // 项目投入是 opt-in：没写 __project 的风格完全不投项目。
  // 这样「老风格」的候选列表里连项目都不会出现，它们的随机流保持逐位不变。
  const projectWeight = weights['__project'] ?? 0
  const enabledChoices = new Set<string>()
  const enabledActions = new Set<string>()
  let guard = 0

  while (!engine.isEnded() && guard++ < 5000) {
    const pending = engine.getPending()
    if (pending) {
      const enabled = engine
        .getPendingChoices()
        .map((view, index) => ({ view, index }))
        .filter((item) => item.view.enabled)
      for (const item of enabled) enabledChoices.add(`${pending.id}#${item.index}`)
      const picked = pickOne(enabled, rng)
      engine.choose(picked ? picked.index : 0)
      continue
    }

    const candidates: Candidate[] = engine.availableActions().map((action) => ({
      label: action.id,
      weight: weights[action.id] ?? 1,
      run: () => {
        engine.takeAction(action.id)
      },
    }))
    for (const candidate of candidates) enabledActions.add(candidate.label)

    if (projectWeight > 0) {
      const actionPoints = engine.getState().actionPoints
      for (const view of engine.getProjects()) {
        if (!view.unlocked || view.completed) continue
        if ((view.project.cost ?? 1) > actionPoints) continue
        candidates.push({
          label: `project:${view.project.id}`,
          weight: weights[`project:${view.project.id}`] ?? projectWeight,
          run: () => {
            engine.investProject(view.project.id)
          },
        })
      }
    }

    // 权重随机：避免机械化的唯一最优解，同时让每种风格有稳定倾向
    const picked = pickWeighted(candidates, (candidate) => candidate.weight, rng)
    if (!picked) break
    picked.run()
  }

  return {
    majorId: engine.getState().majorId,
    endingId: engine.getEnding()?.id ?? '(无结局)',
    stats: engine.getState().stats,
    // 去重：可重复事件每触发一次就往 seenEvents 里 push 一次，
    // 但我们关心的是「遇到哪些事件」，不是「触发了几次」
    seenEvents: [...new Set(engine.getState().seenEvents)],
    summaryLines: engine.getSummary().lines.map((line) => line.text),
    completedProjects: engine
      .getProjects()
      .filter((view) => view.completed)
      .map((view) => view.project.id),
    enabledChoices: [...enabledChoices],
    enabledActions: [...enabledActions],
  }
}

/** 把某个专业的内容单独拎出来，拼成一份「只有它」的数据集（差分不变量用） */
export function isolateMajor(majorId: string): GameData {
  const visible = contentFor(majorId)
  return {
    ...GAME_DATA,
    majors: GAME_DATA.majors.filter((major) => major.id === majorId),
    actions: visible.actions,
    events: visible.events,
    endings: visible.endings,
    projects: visible.projects,
    summary: { ...GAME_DATA.summary, rules: visible.summaryRules },
  }
}

/* ---------------- 汇总 ---------------- */

/** 内容健康度：不只关心结局，也关心「玩家会不会玩两局就腻」 */
export interface ContentMetrics {
  /** 事件 id → 出现局数 */
  eventCounts: Map<string, number>
  /** 总局数 */
  games: number
  /** 从未被触发的随机池事件（死事件，和「死结局」一个道理） */
  deadEvents: { id: string; title: string }[]
  /**
   * 从未被**完成**过的项目（死项目）。
   *
   * 和死事件同构：一个写了却永远做不出来的项目，玩家永远看不到它的完成奖励
   * 和那句完成文案 —— 它只是白占着代码，还让人以为「这条路能走」。
   */
  deadProjects: { id: string; name: string }[]
  /**
   * 从来没**能被点过**的事件选项。
   *
   * 判据是「曾经 enabled 过」，不是「被选过」：模拟器随机选选项，
   * 「没被选中」可能只是运气；而「连点都点不了」说明那个 `requires`
   * 严到条件永远凑不齐 —— 玩家一辈子看不到这个选项。
   * 典型场景就是「花钱换属性」的选项被 `money >= X` 卡死。
   */
  deadChoices: { eventId: string; title: string; label: string }[]
  /**
   * 从来没出现在行动菜单上的行动。
   * 「行动」是内容里写得最多的一类，容易被忘掉检查 —— 一个 `requires`
   * 永远凑不齐的行动，玩家根本看不到它，和死事件一样是死内容。
   */
  deadActions: { id: string; label: string }[]
  /** 单事件最高出现率（0~1）。太高 = 每局必见 = 重复感的来源 */
  maxEventRate: number
  hottestEventId: string
  /** 同风格相邻两局的平均重复度（0~1）。阶段 1 验收标准是 ≤ 0.30 */
  repetition: number
  /** 平均每局遇到的不重复事件数 */
  avgDistinct: number
  /**
   * 结算回顾里实际出现过的文案。用来检查回顾规则有没有「死规则」
   * （写了却永远触发不到，和死结局、死事件一个道理）。
   */
  summaryTexts: Set<string>
}

/** 单个专业的模拟结果 */
export interface MajorReport {
  majorId: string
  majorName: string
  /** 风格 → (结局 id → 次数) */
  counts: Map<string, Map<string, number>>
  /** 风格 → (属性 key → 总和) */
  statTotals: Map<string, Record<string, number>>
  /** 本专业触发过的结局 id */
  triggered: Set<string>
  /** 本专业可见、但从未被触发的结局 */
  deadEndings: { id: string; title: string }[]
  content: ContentMetrics
}

export interface SimReport {
  gamesPerStrategy: number
  strategyNames: string[]
  majors: MajorReport[]
}

/** 跑完一个专业的全部风格 */
function simulateMajor(
  majorId: string,
  majorName: string,
  gamesPerStrategy: number,
  strategyNames: string[],
): MajorReport {
  const counts = new Map<string, Map<string, number>>()
  const statTotals = new Map<string, Record<string, number>>()
  const triggered = new Set<string>()

  // 内容度量用
  const eventCounts = new Map<string, number>()
  const completedProjects = new Set<string>()
  const enabledChoices = new Set<string>()
  const seenPerGame: string[][] = []
  const gameStrategy: string[] = []
  const summaryTexts = new Set<string>()
  const enabledActionsAll = new Set<string>()
  let totalDistinct = 0

  for (const name of strategyNames) {
    const weights = STRATEGIES[name] ?? {}
    const tally = new Map<string, number>()
    const totals: Record<string, number> = {}
    counts.set(name, tally)

    for (let i = 0; i < gamesPerStrategy; i++) {
      const outcome = playOne(i + 1, weights, majorId)
      tally.set(outcome.endingId, (tally.get(outcome.endingId) ?? 0) + 1)
      triggered.add(outcome.endingId)
      for (const key of STAT_ORDER) {
        totals[key] = (totals[key] ?? 0) + outcome.stats[key]
      }

      seenPerGame.push(outcome.seenEvents)
      gameStrategy.push(name)
      totalDistinct += outcome.seenEvents.length
      for (const id of outcome.seenEvents) {
        eventCounts.set(id, (eventCounts.get(id) ?? 0) + 1)
      }
      for (const text of outcome.summaryLines) summaryTexts.add(text)
      for (const id of outcome.completedProjects) completedProjects.add(id)
      for (const key of outcome.enabledChoices) enabledChoices.add(key)
      for (const id of outcome.enabledActions) enabledActionsAll.add(id)
    }

    statTotals.set(name, totals)
  }

  const visible = contentFor(majorId)

  const deadEndings = visible.endings
    .filter((ending) => !triggered.has(ending.id))
    .map((ending) => ({ id: ending.id, title: ending.title }))

  // 只比较「同一风格内」的相邻两局 —— 不同风格是不同玩家，不该算重复
  let overlapSum = 0
  let overlapPairs = 0
  for (let i = 1; i < seenPerGame.length; i++) {
    if (gameStrategy[i] !== gameStrategy[i - 1]) continue
    const prev = new Set(seenPerGame[i - 1])
    const current = seenPerGame[i]!
    if (current.length === 0) continue
    const shared = current.filter((id) => prev.has(id)).length
    overlapSum += shared / current.length
    overlapPairs++
  }

  const totalGames = seenPerGame.length
  let maxEventRate = 0
  let hottestEventId = ''
  for (const [id, count] of eventCounts) {
    const rate = count / totalGames
    if (rate > maxEventRate) {
      maxEventRate = rate
      hottestEventId = id
    }
  }

  // 死事件必须**只在本专业可见的事件里**找：专属事件对别的专业来说是
  // 「不该出现」，而不是「死了」
  const deadEvents = visible.events
    .filter((event) => event.category === 'random')
    .filter((event) => !eventCounts.has(event.id))
    .map((event) => ({ id: event.id, title: event.title }))

  // 死项目同理：只在本专业可见的项目里找
  const deadProjects = visible.projects
    .filter((project) => !completedProjects.has(project.id))
    .map((project) => ({ id: project.id, name: project.name }))

  // 死选项：本专业可见、**而且真的触发过**的事件里，有哪个选项从来没被启用过。
  //
  // 只查「触发过」的事件是刻意的：一个根本没出现过的事件，它的所有选项当然
  // 都没被启用过 —— 但那是「死事件」的判据，不是这一条的。
  // 混在一起会让报告里出现一堆重复的下游噪音（一个死事件带出 2–3 条假死选项）。
  const deadChoices: { eventId: string; title: string; label: string }[] = []
  for (const event of visible.events) {
    if (!eventCounts.has(event.id)) continue
    const choices = event.choices ?? []
    choices.forEach((choice, index) => {
      if (!enabledChoices.has(`${event.id}#${index}`)) {
        deadChoices.push({ eventId: event.id, title: event.title, label: choice.label })
      }
    })
  }

  const deadActions = visible.actions
    .filter((action) => !enabledActionsAll.has(action.id))
    .map((action) => ({ id: action.id, label: action.label }))

  const content: ContentMetrics = {
    eventCounts,
    games: totalGames,
    deadEvents,
    deadProjects,
    deadChoices,
    deadActions,
    maxEventRate,
    hottestEventId,
    repetition: overlapPairs > 0 ? overlapSum / overlapPairs : 0,
    avgDistinct: totalGames > 0 ? totalDistinct / totalGames : 0,
    summaryTexts,
  }

  return { majorId, majorName, counts, statTotals, triggered, deadEndings, content }
}

export function simulate(gamesPerStrategy: number, majorIds?: string[]): SimReport {
  const strategyNames = Object.keys(STRATEGIES)
  const chosen = majorIds ?? GAME_DATA.majors.map((major) => major.id)

  const majors = chosen.map((majorId) => {
    const def = GAME_DATA.majors.find((major) => major.id === majorId)
    if (!def) throw new Error(`未知专业: ${majorId}`)
    return simulateMajor(majorId, def.name, gamesPerStrategy, strategyNames)
  })

  return { gamesPerStrategy, strategyNames, majors }
}

/**
 * 结算回顾里「从来没被触发过的规则」—— 和死结局、死事件同一个道理。
 *
 * 规则的文案可能带 `{n}` 占位（渲染后变成具体数字，如「投出去了 3 份简历」），
 * 所以匹配要用「前缀 + 后缀」而不是全等比较。
 *
 * `majorId` 传了就只看该专业可见的规则：否则一条「只有文科会说的话」
 * 会因为计算机的对局没触发它而被误报成死规则。
 */
export function deadSummaryRules(fired: Set<string>, majorId?: string): { text: string }[] {
  const rules =
    majorId === undefined
      ? GAME_DATA.summary.rules
      : contentFor(majorId).summaryRules

  return rules
    .filter((rule) => {
      const [prefix, suffix] = rule.text.split('{n}')
      if (suffix === undefined) return !fired.has(rule.text)
      return ![...fired].some((text) => text.startsWith(prefix!) && text.endsWith(suffix))
    })
    .map((rule) => ({ text: rule.text }))
}

/* ---------------- 渲染 ---------------- */

export function renderReport(report: SimReport): void {
  const { strategyNames, gamesPerStrategy } = report

  console.log(
    `\n每个专业 × 每种风格 ${gamesPerStrategy} 局，` +
      `共 ${gamesPerStrategy * strategyNames.length * report.majors.length} 局\n`,
  )

  for (const major of report.majors) {
    console.log(`\n═══ 专业：${major.majorName}（${major.majorId}） ═══`)
    renderMajorMatrix(major, strategyNames, gamesPerStrategy)
    renderContentHealth(major)
  }
  console.log('')
}

function renderMajorMatrix(
  major: MajorReport,
  strategyNames: string[],
  gamesPerStrategy: number,
): void {
  const labelWidth = 18
  const cellWidth = 10
  const visible = contentFor(major.majorId)
  const ordered = [...visible.endings].sort((a, b) => a.priority - b.priority)

  console.log(
    padEndWidth('结局', labelWidth) +
      strategyNames.map((name) => padStartWidth(name, cellWidth)).join(''),
  )
  console.log('─'.repeat(labelWidth + cellWidth * strategyNames.length))

  for (const ending of ordered) {
    const cells = strategyNames.map((name) =>
      padStartWidth(
        `${(((major.counts.get(name)?.get(ending.id) ?? 0) / gamesPerStrategy) * 100).toFixed(1)}%`,
        cellWidth,
      ),
    )
    const never = strategyNames.every((name) => (major.counts.get(name)?.get(ending.id) ?? 0) === 0)
    console.log(padEndWidth(ending.title, labelWidth) + cells.join('') + (never ? '  ⚠ 从未触发' : ''))
  }

  console.log('─'.repeat(labelWidth + cellWidth * strategyNames.length))
  console.log(
    padEndWidth('平均终局属性', labelWidth) +
      strategyNames.map(() => padStartWidth('', cellWidth)).join(''),
  )

  for (const key of STAT_ORDER) {
    const cells = strategyNames.map((name) => {
      const avg = (major.statTotals.get(name)?.[key] ?? 0) / gamesPerStrategy
      return padStartWidth(key === 'money' ? `¥${Math.round(avg)}` : avg.toFixed(0), cellWidth)
    })
    console.log(padEndWidth(`  ${STAT_LABELS[key]}`, labelWidth) + cells.join(''))
  }

  console.log('')
  if (major.deadEndings.length === 0) {
    console.log(`✅ ${ordered.length} 个可见结局都至少被触发过一次。`)
  } else {
    console.log(
      `⚠  有 ${major.deadEndings.length} 个结局在本专业所有风格下都没触发过，很可能是「死结局」：`,
    )
    for (const ending of major.deadEndings) {
      console.log(`     - ${ending.title}  (${ending.id})`)
    }
    console.log('   要么放宽触发条件，要么确认这条路线真的走得通。')
  }
}

/** 内容健康度：重复度、死事件、冷热排行。这是「玩家会不会玩两局就腻」的量化答案 */
function renderContentHealth(major: MajorReport): void {
  const { content } = major
  const visible = contentFor(major.majorId)
  const eventTitleOf = new Map(GAME_DATA.events.map((e) => [e.id, e.title]))

  console.log('\n── 内容健康度 ─────────────────────────────')
  console.log(
    `  每局遇到的不重复事件:  ${content.avgDistinct.toFixed(1)} / ${visible.events.length}`,
  )
  console.log(
    `  跨局重复度:            ${(content.repetition * 100).toFixed(0)}%  ` +
      `(${content.repetition <= 0.3 ? '✅ ≤30%' : '⚠ 超过 30%，重复感偏强'})`,
  )
  console.log(
    `  单事件最高出现率:      ${(content.maxEventRate * 100).toFixed(0)}%  ` +
      `(${eventTitleOf.get(content.hottestEventId) ?? content.hottestEventId})` +
      `${content.maxEventRate > 0.35 ? '  ⚠ 每局几乎必见' : ''}`,
  )

  if (content.deadEvents.length === 0) {
    console.log('  死事件:                ✅ 无（本专业可见的每个事件都被触发过）')
  } else {
    console.log(`  死事件:                ⚠ 有 ${content.deadEvents.length} 个从未触发：`)
    for (const event of content.deadEvents) {
      console.log(`                             - ${event.title} (${event.id})`)
    }
  }

  const totalRules = visible.summaryRules.length
  const deadRules = deadSummaryRules(content.summaryTexts, major.majorId)
  if (deadRules.length === 0) {
    console.log(`  结算回顾规则:          ✅ ${totalRules}/${totalRules} 条都被触发过`)
  } else {
    console.log(`  结算回顾规则:          ⚠ ${totalRules - deadRules.length}/${totalRules}，以下从未触发：`)
    for (const rule of deadRules) {
      console.log(`                             - ${rule.text}`)
    }
  }

  if (visible.projects.length > 0) {
    if (content.deadProjects.length === 0) {
      console.log(`  死项目:                ✅ 无（${visible.projects.length} 个项目都被完成过）`)
    } else {
      console.log(`  死项目:                ⚠ 有 ${content.deadProjects.length} 个从未被完成：`)
      for (const project of content.deadProjects) {
        console.log(`                             - ${project.name} (${project.id})`)
      }
    }
  }

  if (content.deadChoices.length === 0) {
    console.log('  死选项:                ✅ 无（每个事件的每个选项都至少可点过一次）')
  } else {
    console.log(`  死选项:                ⚠ 有 ${content.deadChoices.length} 个从来没被启用过：`)
    for (const choice of content.deadChoices) {
      console.log(`                             - ${choice.title}：${choice.label} (${choice.eventId})`)
    }
    console.log('                             多半是 requires 太严（比如要的钱永远攒不够）')
  }

  if (content.deadActions.length === 0) {
    console.log(`  死行动:                ✅ 无（${visible.actions.length} 个行动都上过菜单）`)
  } else {
    console.log(`  死行动:                ⚠ 有 ${content.deadActions.length} 个从未出现在菜单上：`)
    for (const action of content.deadActions) {
      console.log(`                             - ${action.label} (${action.id})`)
    }
  }

  // 冷热排行：最热的几个就是「重复感」的直接来源
  const ranked = [...content.eventCounts.entries()]
    .map(([id, count]) => ({ id, count, rate: count / content.games }))
    .sort((a, b) => b.rate - a.rate)
  console.log('  最热 5 个:')
  for (const r of ranked.slice(0, 5)) {
    console.log(
      `    ${(eventTitleOf.get(r.id) ?? r.id).padEnd(16, '　')} ${(r.rate * 100).toFixed(0)}%`,
    )
  }
  console.log('  最冷 5 个:')
  for (const r of ranked.slice(-5).reverse()) {
    console.log(
      `    ${(eventTitleOf.get(r.id) ?? r.id).padEnd(16, '　')} ${(r.rate * 100).toFixed(0)}%`,
    )
  }
}

/* ---------------- CLI 入口（被 import 时不执行） ---------------- */

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const gamesFlagIndex = process.argv.indexOf('--games')
  const parsed = Number.parseInt(process.argv[gamesFlagIndex + 1] ?? '', 10)
  renderReport(simulate(Number.isFinite(parsed) && parsed > 0 ? parsed : 200))
}
