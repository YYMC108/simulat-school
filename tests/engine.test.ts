import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { STRATEGIES, deadSummaryRules, isolateMajor, playOne, simulate } from '../src/cli/simulate'
import type { MajorContent } from '../src/cli/simulate'
import { auditFlags, auditFlagsOf, flagUsageOf } from '../src/cli/audit'
import { GAME_DATA } from '../src/data/index'
import { GameEngine } from '../src/engine/engine'
import { evaluate } from '../src/engine/conditions'
import { STAT_ORDER, applyEffects } from '../src/engine/effects'
import { mulberry32 } from '../src/engine/rng'
import { createInitialState } from '../src/engine/state'
import type { EvalContext, GameData, GameState, MajorDef, StatKey } from '../src/engine/types'
import { GOLDEN_FINGERPRINT } from './golden-fingerprint'

/** 默认专业 id（不指定 majorId 时引擎用的就是它） */
const DEFAULT_MAJOR = GAME_DATA.majors[0]!.id

function makeContext(overrides: Partial<GameState> = {}, seed = 1): EvalContext {
  const state = {
    ...createInitialState(GAME_DATA.config, DEFAULT_MAJOR, GAME_DATA.config.initialStats),
    ...overrides,
  }
  return { state, config: GAME_DATA.config, rng: mulberry32(seed) }
}

/**
 * 挑第一个「条件满足」的选项。
 *
 * 注意这里体现的接口约定：引擎在传入一个条件不满足的选项时会直接抛错
 * （fail fast，方便尽早暴露 bug），所以调用方必须先用 enabled 过滤。
 * 以后的 UI 就是靠这个字段把按钮变灰的。
 */
function chooseFirstEnabled(engine: GameEngine): void {
  const views = engine.getPendingChoices()
  const index = views.findIndex((view) => view.enabled)
  engine.choose(index === -1 ? 0 : index)
}

/**
 * 一整轮完整模拟（6 种风格 × 120 局 × 每个专业）的结果。
 *
 * 三个「死 XX」不变量（死结局 / 死事件 / 死规则）吃的都是同一份结果，
 * 所以缓存起来只跑一次 —— 否则测试时间白翻几倍。
 * `simulate` 是种子确定的，缓存不影响正确性，也不会有 flaky。
 */
let fullReport: ReturnType<typeof simulate> | null = null
function runFullSimulation(): ReturnType<typeof simulate> {
  fullReport ??= simulate(120)
  return fullReport
}

/**
 * 把「按专业的死内容」摊平成人能读的清单。
 *
 * 为什么要摊平：死内容的第一手信息是「哪个专业 + 哪条内容」。
 * 只看一条全局的「有 3 个事件从未触发」是查不出问题的 ——
 * 因为一个计算机专属事件对文科来说本来就该是死的，反之亦然。
 */
function deadContentOf(report: ReturnType<typeof simulate>) {
  const deadEndings: string[] = []
  const deadEvents: string[] = []
  const deadRules: string[] = []
  const deadChoices: string[] = []

  for (const major of report.majors) {
    for (const ending of major.deadEndings) {
      deadEndings.push(`${major.majorId}: ${ending.title}(${ending.id})`)
    }
    for (const event of major.content.deadEvents) {
      deadEvents.push(`${major.majorId}: ${event.title}(${event.id})`)
    }
    for (const rule of deadSummaryRules(major.content.summaryTexts, major.majorId)) {
      deadRules.push(`${major.majorId}: ${rule.text}`)
    }
    for (const choice of major.content.deadChoices) {
      deadChoices.push(`${major.majorId}: ${choice.title} → 「${choice.label}」(${choice.eventId})`)
    }
  }
  const deadActions: string[] = []
  for (const major of report.majors) {
    for (const action of major.content.deadActions) {
      deadActions.push(`${major.majorId}: ${action.label}(${action.id})`)
    }
  }
  return { deadEndings, deadEvents, deadRules, deadChoices, deadActions }
}

/* ============================================================
 * 条件求值
 * ========================================================== */
describe('条件求值', () => {
  it('undefined 条件视为恒真', () => {
    expect(evaluate(undefined, makeContext())).toBe(true)
  })

  it('属性比较', () => {
    const ctx = makeContext({ stats: { ...GAME_DATA.config.initialStats, academic: 80 } })
    expect(evaluate({ type: 'stat', key: 'academic', op: '>=', value: 80 }, ctx)).toBe(true)
    expect(evaluate({ type: 'stat', key: 'academic', op: '>', value: 80 }, ctx)).toBe(false)
  })

  it('空 all 恒真、空 any 恒假（兜底结局靠这个）', () => {
    expect(evaluate({ type: 'all', conditions: [] }, makeContext())).toBe(true)
    expect(evaluate({ type: 'any', conditions: [] }, makeContext())).toBe(false)
  })

  it('not / any / all 可以嵌套', () => {
    const ctx = makeContext({ stats: { ...GAME_DATA.config.initialStats, mood: 30 } })
    const condition = {
      type: 'all' as const,
      conditions: [
        { type: 'not' as const, condition: { type: 'stat' as const, key: 'mood' as const, op: '>=' as const, value: 50 } },
        { type: 'any' as const, conditions: [
          { type: 'stat' as const, key: 'mood' as const, op: '<' as const, value: 40 },
          { type: 'stat' as const, key: 'health' as const, op: '<' as const, value: 10 },
        ] },
      ],
    }
    expect(evaluate(condition, ctx)).toBe(true)
  })

  it('chance 用注入的 rng，完全可复现', () => {
    const condition = { type: 'chance' as const, probability: 0.5 }
    const a = evaluate(condition, makeContext({}, 42))
    const b = evaluate(condition, makeContext({}, 42))
    expect(a).toBe(b)
  })
})

/* ============================================================
 * 属性边界
 * ========================================================== */
describe('属性边界', () => {
  it('属性被夹在 [min, max] 之间，不会溢出', () => {
    const engine = new GameEngine(GAME_DATA, { seed: 1 })
    // 连续写 30 次代码，技能应该顶到 100 而不是无限增长
    for (let week = 0; week < 30 && !engine.isEnded(); week++) {
      while (engine.getState().actionPoints > 0 && !engine.isEnded() && !engine.getPending()) {
        engine.takeAction('code')
      }
      if (engine.getPending()) chooseFirstEnabled(engine)
    }
    expect(engine.getState().stats.skill).toBeLessThanOrEqual(100)
  })

  it('金钱不会变成负数', () => {
    const engine = new GameEngine(GAME_DATA, { seed: 7 })
    let guard = 0
    while (!engine.isEnded() && guard++ < 500) {
      if (engine.getPending()) {
        chooseFirstEnabled(engine)
        continue
      }
      engine.takeAction('study')
    }
    expect(engine.getState().stats.money).toBeGreaterThanOrEqual(0)
  })
})

/* ============================================================
 * 引擎流程
 * ========================================================== */
describe('引擎流程', () => {
  it('行动消耗行动力，耗尽后进入下一周', () => {
    const engine = new GameEngine(GAME_DATA, { seed: 2 })
    expect(engine.getState().week).toBe(1)
    expect(engine.getState().actionPoints).toBe(GAME_DATA.config.actionPointsPerWeek)

    const total = GAME_DATA.config.actionPointsPerWeek
    for (let i = 0; i < total; i++) {
      if (engine.getPending()) chooseFirstEnabled(engine)
      engine.takeAction('study')
    }
    if (engine.getPending()) chooseFirstEnabled(engine)

    expect(engine.getState().week).toBe(2)
    expect(engine.getState().actionPoints).toBe(GAME_DATA.config.actionPointsPerWeek)
  })

  it('有待处理事件时，不能继续行动', () => {
    // 造一个必定触发事件的环境
    const data = {
      ...GAME_DATA,
      config: { ...GAME_DATA.config, weeklyEventChance: 1 },
    }
    const engine = new GameEngine(data, { seed: 3 })

    while (engine.getState().actionPoints > 0 && !engine.getPending()) {
      engine.takeAction('study')
    }

    expect(engine.getPending()).not.toBeNull()
    expect(() => engine.takeAction('study')).toThrow(/未处理的事件/)
  })

  it('周数只会单调递增，且不超过学期总周数', () => {
    const engine = new GameEngine(GAME_DATA, { seed: 11 })
    let lastWeek = 0
    let guard = 0
    while (!engine.isEnded() && guard++ < 5000) {
      if (engine.getPending()) {
        chooseFirstEnabled(engine)
        continue
      }
      const actions = engine.availableActions()
      engine.takeAction(actions[0]!.id)
      const week = engine.getState().week
      expect(week).toBeGreaterThanOrEqual(lastWeek)
      expect(week).toBeLessThanOrEqual(GAME_DATA.config.totalWeeks)
      lastWeek = week
    }
  })

  it('同一随机种子必然得到同一结局（可复现性）', () => {
    /** 用固定种子做一套固定的决策，整局结果就应该完全相同 */
    const play = (seed: number): string => {
      const engine = new GameEngine(GAME_DATA, { seed })
      const rng = mulberry32(seed)

      const pickIndex = (length: number): number => Math.floor(rng() * length)

      let guard = 0
      while (!engine.isEnded() && guard++ < 5000) {
        const pending = engine.getPending()
        if (pending) {
          const enabled = engine
            .getPendingChoices()
            .map((view, index) => ({ view, index }))
            .filter((item) => item.view.enabled)
          engine.choose(enabled.length > 0 ? enabled[pickIndex(enabled.length)]!.index : 0)
          continue
        }
        const actions = engine.availableActions()
        engine.takeAction(actions[pickIndex(actions.length)]!.id)
      }
      return engine.getEnding()?.id ?? 'none'
    }

    for (const seed of [1, 2, 3, 100, 2025]) {
      expect(play(seed), `seed=${seed}`).toBe(play(seed))
    }
  })
})

/* ============================================================
 * 结算回执：applyEffects 返回的「实际变化量」
 * ========================================================== */
describe('结算回执（实际变化量）', () => {
  it('返回真实变化量；触顶时报告实际值并标记 capped', () => {
    const ctx = makeContext({
      stats: { ...GAME_DATA.config.initialStats, academic: 98 },
    })
    const changes = applyEffects(ctx, [{ type: 'stat', key: 'academic', delta: 4 }])

    expect(ctx.state.stats.academic).toBe(100) // 被夹到上限
    // 声明的是 +4，实际只有 +2 —— 回执必须说真话
    expect(changes).toEqual([{ key: 'academic', delta: 2, capped: 'max' }])
  })

  it('完全触顶时返回 +0 且保留 capped 标记（重要反馈，不能当噪声过滤掉）', () => {
    const ctx = makeContext({
      stats: { ...GAME_DATA.config.initialStats, academic: 100 },
    })
    const changes = applyEffects(ctx, [{ type: 'stat', key: 'academic', delta: 4 }])
    expect(changes).toEqual([{ key: 'academic', delta: 0, capped: 'max' }])
  })

  it('同一次结算里对同一属性的多次变化汇总成净值', () => {
    const ctx = makeContext()
    const changes = applyEffects(ctx, [
      { type: 'stat', key: 'academic', delta: 4 },
      { type: 'stat', key: 'academic', delta: -1 },
    ])
    expect(changes).toEqual([{ key: 'academic', delta: 3 }])
  })

  it('净变化为 0 且没触顶的属性不出现（避免 +0 噪声）', () => {
    const ctx = makeContext()
    const changes = applyEffects(ctx, [
      { type: 'stat', key: 'academic', delta: 4 },
      { type: 'stat', key: 'academic', delta: -4 },
    ])
    expect(changes).toEqual([])
  })

  it('金钱撞到下限时报 capped: min', () => {
    const ctx = makeContext({
      stats: { ...GAME_DATA.config.initialStats, money: 50 },
    })
    const changes = applyEffects(ctx, [{ type: 'stat', key: 'money', delta: -100 }])

    expect(ctx.state.stats.money).toBe(0)
    expect(changes).toEqual([{ key: 'money', delta: -50, capped: 'min' }])
  })

  it('只统计 if 真正命中的分支，没走到的分支一点都不算', () => {
    const ctx = makeContext({ flags: { 测试开关: true } })
    const changes = applyEffects(ctx, [
      {
        type: 'if',
        requires: { type: 'flag', key: '测试开关' },
        effects: [{ type: 'stat', key: 'mood', delta: 5 }],
      },
      {
        type: 'if',
        requires: { type: 'not', condition: { type: 'flag', key: '测试开关' } },
        effects: [{ type: 'stat', key: 'mood', delta: -100 }],
      },
    ])
    expect(changes).toEqual([{ key: 'mood', delta: 5 }])
    expect(ctx.state.stats.mood).toBe(GAME_DATA.config.initialStats.mood + 5)
  })

  it('行动与每周固定衰减都把自己的实际变化量挂在对应日志上', () => {
    const engine = new GameEngine(GAME_DATA, { seed: 3 })

    // ① 行动日志带着这一次行动的实际效果
    const first = engine.takeAction('study')
    const actionLog = first.logs.find((entry) => entry.kind === 'action')
    expect(actionLog?.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'academic', delta: 4 })]),
    )

    // ② 把本周行动力用完 → 必须出现一条带 changes 的「周结算」日志
    while (engine.getState().actionPoints > 0 && !engine.getPending() && !engine.isEnded()) {
      engine.takeAction('study')
    }

    const settlement = engine.getState().log.find((entry) => entry.text.includes('固定衰减'))
    expect(settlement, '应该有一条「每周固定衰减」日志').toBeDefined()
    expect(settlement!.changes, '每周固定衰减必须带上实际变化量').toBeDefined()

    // 每周固定支出 100 元；只做自习不花钱，所以是干净的 −100
    expect(settlement!.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'money', delta: -100 })]),
    )
    // 每周固定衰减：学业 −1
    expect(settlement!.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'academic', delta: -1 })]),
    )
  })

  /**
   * 回执机制的后置条件：**报告出来的变化量之和，必须等于状态的真实变化**。
   *
   * 这条不变量才是「回执可信」的根本保证 —— 它不关心引擎内部怎么算的，
   * 只要求「你说变了多少」和「实际变了多少」永远一致。
   *
   * 它的实战价值：玩家曾经反馈「每周衰减与实际不符」，我先跑这个检查，
   * 得到 839 次对比 0 处不一致，才确认回执没问题、是文案歧义 ——
   * 否则我可能会去乱改一份本来正确的代码。
   */
  it('回执报告的变化量之和必须等于属性的真实变化', () => {
    for (const seed of [1, 2, 3, 2025]) {
      const engine = new GameEngine(GAME_DATA, { seed })
      let guard = 0

      while (!engine.isEnded() && guard++ < 500) {
        const before = engine.getState().stats

        let result
        if (engine.getPending()) {
          const enabledIndex = engine.getPendingChoices().findIndex((view) => view.enabled)
          result = engine.choose(enabledIndex === -1 ? 0 : enabledIndex)
        } else {
          result = engine.takeAction('study')
        }

        const after = engine.getState().stats

        // 把这次操作里所有日志报告的变化量加起来
        const said = new Map<StatKey, number>()
        for (const log of result.logs) {
          for (const change of log.changes ?? []) {
            said.set(change.key, (said.get(change.key) ?? 0) + change.delta)
          }
        }

        for (const key of STAT_ORDER) {
          const reported = said.get(key) ?? 0
          const actual = after[key] - before[key]
          expect(
            reported,
            `seed=${seed} 第${engine.getState().week}周 ${key}: 回执说 ${reported}，实际变了 ${actual}`,
          ).toBe(actual)
        }
      }

      expect(engine.isEnded(), `seed=${seed} 没走到结局`).toBe(true)
    }
  })
})

/* ============================================================
 * 内容数据合法性（这类测试最省事，也最能防低级错误）
 * ========================================================== */
describe('内容数据合法性', () => {
  it('所有事件 / 行动 / 结局的 id 唯一', () => {
    const ids = [
      ...GAME_DATA.events.map((e) => e.id),
      ...GAME_DATA.actions.map((a) => a.id),
      ...GAME_DATA.endings.map((e) => e.id),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('存在一个恒真的兜底结局，保证游戏永远不会卡死', () => {
    const always = GAME_DATA.endings.filter(
      (ending) => ending.requires.type === 'all' && ending.requires.conditions.length === 0,
    )
    expect(always.length).toBeGreaterThanOrEqual(1)
  })

  it('每个行动都有非空 id / label / description', () => {
    for (const action of GAME_DATA.actions) {
      expect(action.id).toBeTruthy()
      expect(action.label).toBeTruthy()
      expect(action.description).toBeTruthy()
      expect(action.cost).toBeGreaterThan(0)
    }
  })

  it('每个事件都有标题和正文', () => {
    for (const event of GAME_DATA.events) {
      expect(event.title, event.id).toBeTruthy()
      expect(event.text, event.id).toBeTruthy()
    }
  })

  /**
   * 防卡死：如果某个事件的**每一个**选项都带条件，一旦条件全不满足，
   * 玩家就永远无法推进（引擎会冻结时间，等一个不存在的合法选择）。
   *
   * 当前数据是安全的，但这份安全性只来自「写事件时恰好留了退路」。
   * 写这条测试是为了让规则的违反者在 `pnpm test` 阶段就暴露，
   * 而不是等玩家真的卡在某个事件上。
   */
  it('每个带选项的事件都至少有一个「无条件选项」，保证玩家不会卡死', () => {
    const stuck = GAME_DATA.events
      .filter((event) => (event.choices?.length ?? 0) > 0)
      .filter((event) => event.choices!.every((choice) => choice.requires !== undefined))
      .map((event) => event.id)

    expect(
      stuck,
      `以下事件的全部选项都带条件，条件全不满足时玩家会卡死：${stuck.join(', ')}`,
    ).toEqual([])
  })

  it('实战中不会出现「有待处理事件但一个选项都点不了」的状态', () => {
    for (const seed of [1, 2, 3, 100, 2025]) {
      const engine = new GameEngine(GAME_DATA, { seed })
      const rng = mulberry32(seed)
      let guard = 0

      while (!engine.isEnded() && guard++ < 5000) {
        const pending = engine.getPending()
        if (pending) {
          const views = engine.getPendingChoices()
          const usableIndexes = views
            .map((view, index) => ({ view, index }))
            .filter((item) => item.view.enabled)
            .map((item) => item.index)

          expect(usableIndexes.length, `seed=${seed} 事件 ${pending.id} 没有任何可用选项`).toBeGreaterThan(0)

          const pick = usableIndexes[Math.floor(rng() * usableIndexes.length)]!
          engine.choose(pick)
          continue
        }
        engine.takeAction('rest')
      }
      expect(engine.isEnded(), `seed=${seed} 没走到结局`).toBe(true)
    }
  })

  it('一局游戏必定走到某个结局', () => {
    for (const seed of [1, 5, 9, 13, 42, 777]) {
      const engine = new GameEngine(GAME_DATA, { seed })
      let guard = 0
      while (!engine.isEnded() && guard++ < 5000) {
        if (engine.getPending()) {
          chooseFirstEnabled(engine)
          continue
        }
        engine.takeAction('rest')
      }
      expect(engine.isEnded(), `seed=${seed} 没有走到结局`).toBe(true)
    }
  })

  /**
   * 这条测试把「设计不变量」固化下来了：每个结局都必须真的能被玩出来。
   * 一个永远触发不到的结局就是死代码 —— 而且它藏得很深，
   * 人肉试玩几十局根本发现不了（这个项目里就真的踩过一次）。
   *
   * 阶段 2 起这条不变量**按专业**成立：每个专业自己看得见的那些结局
   * 都必须被玩出来。专属结局被通用结局「饿死」是这里最容易犯的错 ——
   * 优先级排在别人后面，就永远轮不到它。
   *
   * 因为整个模拟是种子确定的，所以这条测试不会 flaky；
   * 反过来，如果调整数值导致某个结局变得不可达，它会立刻告诉你。
   */
  it('所有结局都能被玩出来（没有死结局，且按专业成立）', () => {
    const report = runFullSimulation()
    const { deadEndings } = deadContentOf(report)

    // 先保证这条测试不是在空转：模拟必须真的覆盖了每一个专业
    expect(
      report.majors.map((major) => major.majorId).sort(),
      '模拟没有覆盖全部专业，下面的「无死结局」就是空转',
    ).toEqual(GAME_DATA.majors.map((major) => major.id).sort())

    expect(
      deadEndings,
      '以下「专业 + 结局」在所有决策风格下都从未触发，检查它们的触发条件是否过严',
    ).toEqual([])
  })

  /**
   * 和「没有死结局」同构的不变量，只是对象换成事件。
   * 一个写进数据里却永远触发不到的事件，跟一段死代码没有区别 ——
   * 它只会平白占着权重、让别的本可以出现的事件更难出现。
   *
   * 同样按专业：共享事件必须在**每个**专业里都能触发到，
   * 专属事件必须在**它自己那个**专业里能触发到。
   */
  it('所有随机事件都能被触发（没有死事件，且按专业成立）', () => {
    const report = runFullSimulation()
    const { deadEvents } = deadContentOf(report)

    expect(
      deadEvents,
      '以下「专业 + 事件」在所有决策风格下都从未触发，检查触发条件是否过严（或状态触发事件的阈值是否根本达不到）',
    ).toEqual([])
  })

  /**
   * 第三个同构的不变量，对象换成结算回顾的规则。
   * 一条写了却永远触发不到的回顾就是一段死文案 ——
   * 玩家看不到它，而它却占着「本可以放别的话」的位置。
   */
  it('结算回顾的每条规则都可能被触发（没有死规则，且按专业成立）', () => {
    const report = runFullSimulation()
    const { deadRules } = deadContentOf(report)

    expect(
      deadRules,
      '以下「专业 + 回顾规则」在所有决策风格下都从未触发，检查条件是否过严（尤其是属性阈值类规则）',
    ).toEqual([])
  })

  /**
   * 第六个「死 XX」不变量：**事件选项**。
   *
   * 判据是「曾经可点（enabled）过」，不是「被选过」—— 模拟器随机挑选项，
   * 「没被选中」可能只是运气；而「连点都点不了」说明那个 `requires` 严到
   * 条件永远凑不齐，玩家一辈子看不到这个选项。
   *
   * 这条是加「花钱换属性」时补的：那些选项靠 `money >= X` 把关，
   * 而钱在这个游戏里是紧的（每周固定 −100），很容易写出一个永远付不起的门槛。
   * 只查**触发过**的事件：根本没出现过的事件，它的选项当然没被启用过，
   * 但那是「死事件」的判据，混进来只会产生一堆下游噪音。
   */
  it('每个事件选项都至少可点过一次（没有死选项，且按专业成立）', () => {
    const report = runFullSimulation()
    const { deadChoices } = deadContentOf(report)

    expect(
      deadChoices,
      '以下「专业 + 选项」在所有决策风格下都从未被启用 —— 那个 requires 严到永远凑不齐（比如要的钱根本攒不够）',
    ).toEqual([])
  })

  /**
   * 第七个「死 XX」不变量：**行动**。
   *
   * 行动是内容里写得最多的一类，却最晚被纳入检查 —— 因为绝大多数行动没有 `requires`，
   * 天生就在菜单上。直到出现「钱 < 40 才显示」这种条件性行动，才需要一个
   * 「它到底有没有真的出现过」的判据。
   *
   * 判据同样是「曾经出现在菜单上」，不是「被选过」。
   */
  it('每个行动都至少上过一次菜单（没有死行动，且按专业成立）', () => {
    const report = runFullSimulation()
    const { deadActions } = deadContentOf(report)

    expect(
      deadActions,
      '以下「专业 + 行动」在所有决策风格下都从未出现在菜单上 —— 它的 requires 永远不满足',
    ).toEqual([])
  })
})

/* ============================================================
 * 死 flag（静态审计）
 *
 * 和「死结局 / 死事件 / 死规则」同构的第四个不变量，但它**不需要跑模拟**：
 * 静态就能确定「有没有人读这个 flag」。
 * ========================================================== */

describe('内容数据合法性：死 flag（静态审计）', () => {
  /** 把全部内容当成一个切片（用于「扫描范围是否有效」的自检） */
  const everyContent: MajorContent = {
    actions: GAME_DATA.actions,
    events: GAME_DATA.events,
    endings: GAME_DATA.endings,
    projects: GAME_DATA.projects,
    summaryRules: GAME_DATA.summary.rules,
    weeklyEffects: GAME_DATA.config.weeklyEffects,
  }

  it('审计器本身有效：能同时抓出「写了没人读」和「读了没人写」', () => {
    // 这一段是刻意的反向验证：如果下面两条不变量因为审计器失灵而永远通过，
    // 那么它们就是装饰品。这里用一个最小样例证明审计器真的会报错。
    const content: MajorContent = {
      actions: [
        {
          id: 'act',
          label: '行动',
          description: '描述',
          cost: 1,
          effects: [{ type: 'setFlag', key: '只写不读', value: true }],
        },
      ],
      events: [
        {
          id: 'ev',
          title: '事件',
          text: '正文',
          category: 'random',
          requires: { type: 'flag', key: '只读不写' },
          effects: [{ type: 'addFlag', key: '有写也有读', delta: 1 }],
        },
      ],
      endings: [
        {
          id: 'end',
          title: '结局',
          text: '正文',
          priority: 1,
          requires: { type: 'flag', key: '有写也有读' },
        },
      ],
      summaryRules: [],
      weeklyEffects: [],
      projects: [],
    }

    const audit = auditFlagsOf(content)
    expect(audit.writtenNeverRead).toEqual(['只写不读'])
    expect(audit.readNeverWritten).toEqual(['只读不写'])
  })

  it('扫描范围本身是有效的（数据不为空，否则两条不变量等于空转）', () => {
    const usage = flagUsageOf(everyContent)
    expect(usage.written.size).toBeGreaterThanOrEqual(10)
    expect(usage.read.size).toBeGreaterThanOrEqual(10)
  })

  it('全局：每个 flag 都是有写有读的（没有死 flag）', () => {
    const audit = auditFlags()
    expect(
      audit.writtenNeverRead,
      '以下 flag 被写入、但没有任何条件读它 —— 它是死数据，玩家永远感知不到',
    ).toEqual([])
    expect(
      audit.readNeverWritten,
      '以下 flag 被条件读取、但没有任何地方写它 —— 那些条件是永远不可能成立的分支',
    ).toEqual([])
  })

  it('按专业：每个专业自己写的 flag 自己读，不依赖另一个专业', () => {
    for (const major of GAME_DATA.majors) {
      const audit = auditFlags(major.id)
      expect(
        audit.writtenNeverRead,
        `专业「${major.id}」写了这些 flag 却没人读（在别的专业里读也算漏 —— 它对本科就是死的）`,
      ).toEqual([])
      expect(
        audit.readNeverWritten,
        `专业「${major.id}」读了这些 flag 却没人写（那个条件对本科永远不成立）`,
      ).toEqual([])
    }
  })
})

/* ============================================================
 * 专业维度（阶段 2）
 *
 * 现在数据里只有计算机一个专业，但下面用一份**合成的双专业数据**
 * 把过滤逻辑先测掉 —— 这样「加第 3 个专业只需要写数据」这句话
 * 在写第二个专业之前就已经被验证过了，而不是等写完才发现引擎里有暗礁。
 * ========================================================== */

const OTHER_MAJOR: MajorDef = {
  id: 'testart',
  name: '测试文科',
  identity: '测试文科专业大三学生',
  description: '只用于测试的第二个专业',
  statBonus: { academic: -5, social: 5 },
}

/** 造一份「两个专业」的数据：第二个专业带行动/事件/结局/回顾各一件专属内容 */
function dataWithSecondMajor(): GameData {
  return {
    ...GAME_DATA,
    majors: [...GAME_DATA.majors, OTHER_MAJOR],
    actions: [
      ...GAME_DATA.actions,
      {
        id: 'test_only_action',
        label: '测试专属行动',
        description: '只有测试文科能做',
        cost: 1,
        effects: [{ type: 'stat', key: 'social', delta: 1 }],
        majors: [OTHER_MAJOR.id],
      },
    ],
    events: [
      ...GAME_DATA.events,
      {
        id: 'ev_test_only',
        title: '测试专属事件',
        text: '只有测试文科会遇到',
        category: 'random',
        // 权重刻意给到极大：万一过滤失效，它必然被抽中，
        // 于是「没被抽中」这个断言才有意义（否则只是运气好）
        weight: 1_000_000,
        majors: [OTHER_MAJOR.id],
        effects: [],
      },
      {
        // ev_test_only 的**未打标签孪生兄弟**：权重、条件、结构完全一样，
        // 唯一的差别就是没有 majors 标签。
        // 它存在的意义是证明上面那条测试不是空转：同一个权重下，
        // 无标签的必然被抽中，有标签的必然不被抽中 ——
        // 于是「专业过滤」被证明是真正起作用的那一环，而不是运气或权重问题。
        id: 'ev_shared_twin',
        title: '共享孪生事件',
        text: '所有专业都会遇到',
        category: 'random',
        weight: 1_000_000,
        effects: [],
      },
    ],
    endings: [
      {
        id: 'ending_test_only',
        title: '测试专属结局',
        text: '只有测试文科能拿到',
        // priority 比所有结局都靠前 + 恒真条件：只要可见就必然命中
        priority: 5,
        requires: { type: 'all', conditions: [] },
        majors: [OTHER_MAJOR.id],
      },
      ...GAME_DATA.endings,
    ],
    summary: {
      ...GAME_DATA.summary,
      rules: [
        {
          // 恒真：只要专业对，这条必然出现在回顾里
          requires: { type: 'all', conditions: [] },
          kind: 'notable',
          text: '测试专属回顾',
          order: 1,
          majors: [OTHER_MAJOR.id],
        },
        ...GAME_DATA.summary.rules,
      ],
    },
  }
}

/** 用「一直休息」的策略把这局玩到结局（`rest` 是全专业共享行动） */
function playToEndWith(data: GameData, majorId?: string): GameEngine {
  const engine = new GameEngine(data, majorId === undefined ? { seed: 1 } : { seed: 1, majorId })
  let guard = 0
  while (!engine.isEnded() && guard++ < 500) {
    if (engine.getPending()) {
      chooseFirstEnabled(engine)
      continue
    }
    engine.takeAction('rest')
  }
  return engine
}

describe('专业：解析与开局', () => {
  it('不指定专业时用第一个专业（老调用方行为不变）', () => {
    const engine = new GameEngine(GAME_DATA, { seed: 1 })
    expect(engine.getState().majorId).toBe(GAME_DATA.majors[0]!.id)
    expect(engine.getMajor()).toEqual(GAME_DATA.majors[0])
  })

  it('指定未知专业直接抛错，而不是静默回退到默认专业', () => {
    // 静默回退会让「玩家选了文科、进的却是计算机」这种 bug 极难发现
    expect(() => new GameEngine(GAME_DATA, { seed: 1, majorId: 'nope' })).toThrow(/未知专业/)
  })

  it('majors 为空时抛错（必须有一个默认专业）', () => {
    expect(() => new GameEngine({ ...GAME_DATA, majors: [] }, { seed: 1 })).toThrow(/不能为空/)
  })

  it('每个专业的开局属性都落在 statRanges 内（I1 从第一帧就成立）', () => {
    const data = dataWithSecondMajor()
    for (const major of data.majors) {
      const stats = new GameEngine(data, { seed: 1, majorId: major.id }).getState().stats
      for (const key of STAT_ORDER) {
        const range = data.config.statRanges[key]
        expect(stats[key], `${major.id}.${key} 越界`).toBeGreaterThanOrEqual(range.min)
        expect(stats[key], `${major.id}.${key} 越界`).toBeLessThanOrEqual(range.max)
      }
    }
  })

  it('专业偏移真的生效，而基准属性只写在 config 一处', () => {
    const data = dataWithSecondMajor()
    const base = new GameEngine(data, { seed: 1 }).getState().stats
    const other = new GameEngine(data, { seed: 1, majorId: OTHER_MAJOR.id }).getState().stats

    // 计算机没写 statBonus → 开局属性就是基准值本身（保证老种子完全不变）
    expect(base).toEqual(GAME_DATA.config.initialStats)
    expect(other.academic).toBe(GAME_DATA.config.initialStats.academic - 5)
    expect(other.social).toBe(GAME_DATA.config.initialStats.social + 5)
  })

  it('开场白里的身份来自专业数据，不是引擎里写死的', () => {
    const data = {
      ...GAME_DATA,
      majors: [{ ...GAME_DATA.majors[0]!, identity: '某专业大三学生' }],
    }
    const engine = new GameEngine(data, { seed: 1 })
    expect(engine.getState().log[0]!.text).toContain('某专业大三学生')
  })

  it('结算回顾的身份跟着专业走', () => {
    const data = dataWithSecondMajor()
    const engine = new GameEngine(data, { seed: 1, majorId: OTHER_MAJOR.id })
    expect(engine.getSummary().identity).toBe(OTHER_MAJOR.identity)
  })
})

describe('专业：内容过滤是通用的（引擎里没有专业特判）', () => {
  it('专属行动只在本专业出现，别的专业调用它会被明确拒绝', () => {
    const data = dataWithSecondMajor()

    const computer = new GameEngine(data, { seed: 1 })
    expect(computer.availableActions().map((a) => a.id)).not.toContain('test_only_action')
    expect(() => computer.takeAction('test_only_action')).toThrow(/不属于本专业/)

    const other = new GameEngine(data, { seed: 1, majorId: OTHER_MAJOR.id })
    expect(other.availableActions().map((a) => a.id)).toContain('test_only_action')
    expect(() => other.takeAction('test_only_action')).not.toThrow()
  })

  it('专属随机事件在别的专业永远不会被抽到', () => {
    // 概率拉满 + 权重给到极大：过滤一旦失效，这个事件必然出现
    const data = dataWithSecondMajor()
    const forced = { ...data, config: { ...data.config, weeklyEventChance: 1 } }

    const computer = playToEndWith(forced)
    const seen = computer.getState().seenEvents

    // ★ 非空转证明：同权重的**无标签孪生**事件被抽中了……
    expect(seen).toContain('ev_shared_twin')
    // ……而有标签的专属事件一次都没出现。两者只差一个 majors 标签，
    // 所以「专业过滤」被证明是真正起作用的那一环。
    expect(seen).not.toContain('ev_test_only')

    // 反向验证：本专业确实抽得到
    const other = playToEndWith(forced, OTHER_MAJOR.id)
    expect(other.getState().seenEvents).toContain('ev_test_only')
  })

  it('专属结局不会被别的专业拿到，本专业则必然命中', () => {
    const data = dataWithSecondMajor()
    const forced = { ...data, config: { ...data.config, weeklyEventChance: 1 } }

    expect(playToEndWith(forced).getEnding()?.id).not.toBe('ending_test_only')
    expect(playToEndWith(forced, OTHER_MAJOR.id).getEnding()?.id).toBe('ending_test_only')
  })

  it('专属回顾规则不会被别的专业渲染出来', () => {
    const data = dataWithSecondMajor()
    const textsOf = (majorId?: string) =>
      playToEndWith(data, majorId).getSummary().lines.map((line) => line.text)

    expect(textsOf()).not.toContain('测试专属回顾')
    expect(textsOf(OTHER_MAJOR.id)).toContain('测试专属回顾')
  })

  it('每个专业都有兜底结局可见（I6：任何专业都不会卡死）', () => {
    const data = dataWithSecondMajor()
    for (const major of data.majors) {
      const visible = data.endings.filter(
        (ending) => ending.majors === undefined || ending.majors.includes(major.id),
      )
      const fallback = visible.filter(
        (ending) => ending.requires.type === 'all' && ending.requires.conditions.length === 0,
      )
      expect(fallback.length, `${major.id} 没有恒真兜底结局，这个专业会卡死`).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('专业：引擎里不许出现专业硬编码', () => {
  /**
   * 去掉注释再检查。注释是写给人看的说明（「引擎不认识计算机」这种话
   * 本身就该写在注释里），不构成行为；而**代码**里出现专业名/id 才是硬编码。
   */
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  const engineSources = (): { name: string; code: string }[] => {
    const dir = fileURLToPath(new URL('../src/engine', import.meta.url))
    return readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => ({ name, code: stripComments(readFileSync(join(dir, name), 'utf8')) }))
  }

  it('扫描范围本身是有效的（否则下面两条测试等于空转）', () => {
    const sources = engineSources()
    expect(sources.length).toBeGreaterThanOrEqual(5)
    expect(sources.some((s) => s.name === 'engine.ts')).toBe(true)
    // 注释剥离确实生效：engine.ts 的注释里写着「计算机专业大三学生」，
    // 剥完就不该再出现 —— 否则下面那条测试会因为注释而永远红
    const engineTs = sources.find((s) => s.name === 'engine.ts')!
    expect(engineTs.code).not.toContain('//')
    expect(engineTs.code).not.toContain('/*')
  })

  it('引擎代码里不出现任何专业 id 字面量（杜绝 if (majorId === "computer") 这类分支）', () => {
    for (const major of GAME_DATA.majors) {
      for (const { name, code } of engineSources()) {
        expect(
          code.includes(`'${major.id}'`) || code.includes(`"${major.id}"`),
          `${name} 里出现了专业 id 字面量 '${major.id}' —— 专业必须由数据决定，不能在引擎里特判`,
        ).toBe(false)
      }
    }
  })

  it('引擎代码里不出现任何专业的身份/名称文案（杜绝写死的开场白）', () => {
    for (const major of GAME_DATA.majors) {
      for (const text of [major.identity, major.name]) {
        for (const { name, code } of engineSources()) {
          expect(code.includes(text), `${name} 里写死了专业文案「${text}」`).toBe(false)
        }
      }
    }
  })
})

describe('专业：金标指纹（引入专业维度不得改变任何一局）', () => {
  /**
   * 夹具来自**重构前**那次抓取（见 tests/golden-fingerprint.ts）。
   *
   * 它守的规则比「重构没弄坏东西」更强：
   *   **新增一个专业，不得改变已有专业的任何一局。**
   * 因为新专业的内容都带 majors 标签会被过滤掉，进不了已有专业的抽取池。
   * 这条测试红了，就说明有人动了共享内容或破坏了过滤 ——
   * 而那正是「加第 3 个专业只需要写数据」是否还成立的判据。
   */
  it('7 种风格 × 10 个种子的结局/属性/事件数全部与上次抓取逐位一致', () => {
    const mismatches: string[] = []

    for (const line of GOLDEN_FINGERPRINT) {
      const [strategy, seedRaw] = line.split('|')
      // 找不到风格就明确报错，而不是静默退化成「所有行动等权」——
      // 后者会让指纹对不上，却给出一个完全看不懂的失败原因
      const weights = STRATEGIES[strategy as string]
      expect(
        weights,
        `金标指纹里的风格「${strategy}」在 STRATEGIES 里找不到了（改风格名会让历史对局失去参照）`,
      ).toBeDefined()

      const outcome = playOne(Number(seedRaw), weights!)

      const got = [
        strategy,
        seedRaw,
        outcome.endingId,
        STAT_ORDER.map((key) => outcome.stats[key]).join(','),
        outcome.seenEvents.length,
        outcome.summaryLines.length,
      ].join('|')

      if (got !== line) mismatches.push(`  期望 ${line}\n  实得 ${got}`)
    }

    expect(
      mismatches,
      `以下对局和上次抓取指纹时不一致：\n${mismatches.join('\n')}`,
    ).toEqual([])
    // 夹具条数本身也要守着：夹具被误删会让这条测试变成空转
    expect(GOLDEN_FINGERPRINT.length).toBe(70)
  })
})

/* ============================================================
 * 项目 / 作品系统（阶段 2.2）
 * ========================================================== */

/** 把待处理事件全部处理掉，方便连续测试（否则 investProject 会因为 pending 抛错） */
function drainPending(engine: GameEngine): void {
  let guard = 0
  while (engine.getPending() && guard++ < 50) chooseFirstEnabled(engine)
}

describe('项目 / 作品系统：机制', () => {
  const viewOf = (engine: GameEngine, id: string) =>
    engine.getProjects().find((view) => view.project.id === id)!

  it('进度会累计；攒满即完成并写入完成 flag；完成后不能再投入', () => {
    const engine = new GameEngine(GAME_DATA, { seed: 1, majorId: 'literature' })

    // 文科开局技能 28，而诗集要求 30 —— 先写一次稿
    expect(viewOf(engine, 'proj_poetry').unlocked, '技能 28 时诗集不该解锁').toBe(false)
    engine.takeAction('write')
    expect(viewOf(engine, 'proj_poetry').unlocked, '写了稿之后应该解锁').toBe(true)

    const required = viewOf(engine, 'proj_poetry').required
    for (let i = 0; i < required; i++) {
      drainPending(engine)
      engine.investProject('proj_poetry')
    }

    expect(viewOf(engine, 'proj_poetry').progress).toBe(required)
    expect(viewOf(engine, 'proj_poetry').completed).toBe(true)
    expect(engine.getState().flags['项目_诗集_完成']).toBe(true)

    drainPending(engine)
    expect(() => engine.investProject('proj_poetry')).toThrow(/已经完成/)
  })

  it('投入的日志带上进度与真实变化量（回执，不是预告）', () => {
    const engine = new GameEngine(GAME_DATA, { seed: 1, majorId: 'literature' })
    engine.takeAction('write')

    const result = engine.investProject('proj_poetry')
    const entry = result.logs.find((log) => log.text.includes('投入到'))
    expect(entry, '应该有一条「投入到」日志').toBeDefined()
    expect(entry!.text, '日志要写明进度，玩家不用回头翻面板').toContain('进度 1/')
    expect(entry!.changes, '投入必须带实际变化量（回执）').toBeDefined()
    expect(entry!.changes!.some((change) => change.key === 'skill' && change.delta > 0)).toBe(true)

    // 完成那一刻的奖励挂在完成日志上
    drainPending(engine)
    engine.investProject('proj_poetry')
    drainPending(engine)
    const final = engine.investProject('proj_poetry')
    const done = final.logs.find((log) => log.text.includes('完成了'))
    expect(done, '应该有一条完成日志').toBeDefined()
    expect(done!.changes, '完成奖励必须带实际变化量').toBeDefined()
  })

  it('未解锁的项目投入会被拒绝（fail fast，而不是默默扣行动力）', () => {
    const engine = new GameEngine(GAME_DATA, { seed: 1, majorId: 'literature' })
    // 长篇要求技能 45，文科开局 28
    expect(() => engine.investProject('proj_longform')).toThrow(/条件不满足/)
    expect(engine.getState().actionPoints, '被拒绝时不该扣行动力').toBe(
      GAME_DATA.config.actionPointsPerWeek,
    )
  })

  it('别的专业的项目既不可见也不能投入', () => {
    const engine = new GameEngine(GAME_DATA, { seed: 1, majorId: 'literature' })
    expect(engine.getProjects().map((view) => view.project.id)).not.toContain('proj_opensource')
    expect(() => engine.investProject('proj_opensource')).toThrow(/不属于本专业/)
  })

  it('未知项目抛错', () => {
    const engine = new GameEngine(GAME_DATA, { seed: 1 })
    expect(() => engine.investProject('proj_nope')).toThrow(/未知项目/)
  })

  it('有待处理事件时不能投入项目（和 takeAction 同一套相位控制）', () => {
    const data = { ...GAME_DATA, config: { ...GAME_DATA.config, weeklyEventChance: 1 } }
    const engine = new GameEngine(data, { seed: 3 })
    while (engine.getState().actionPoints > 0 && !engine.getPending()) {
      engine.takeAction('rest')
    }
    expect(engine.getPending()).not.toBeNull()
    expect(() => engine.investProject('proj_algorithm')).toThrow(/未处理的事件/)
  })

  /**
   * I9（回执 = 真实变化）从「行动」扩展到「项目」。
   * 项目是第二个会改属性的入口，它当然也要守同一条不变量 ——
   * 否则玩家做项目时看到的数字就可能是假的。
   */
  it('项目投入也遵守 I9：回执报告的变化量之和等于属性真实变化', () => {
    const engine = new GameEngine(GAME_DATA, { seed: 5, majorId: 'literature' })
    engine.takeAction('write')
    let guard = 0

    while (!engine.isEnded() && guard++ < 400) {
      if (engine.getPending()) {
        chooseFirstEnabled(engine)
        continue
      }
      const usable = engine.getProjects().filter((view) => view.unlocked && !view.completed)
      const before = engine.getState().stats
      const result =
        usable.length > 0
          ? engine.investProject(usable[0]!.project.id)
          : engine.takeAction('study')
      const after = engine.getState().stats

      const said = new Map<StatKey, number>()
      for (const log of result.logs) {
        for (const change of log.changes ?? []) {
          said.set(change.key, (said.get(change.key) ?? 0) + change.delta)
        }
      }
      for (const key of STAT_ORDER) {
        expect(
          said.get(key) ?? 0,
          `seed=5 第${engine.getState().week}周 ${key}: 回执说 ${said.get(key) ?? 0}，实际变了 ${after[key] - before[key]}`,
        ).toBe(after[key] - before[key])
      }
    }
  })
})

describe('项目：无死项目（按专业）', () => {
  it('每个专业可见的项目都被真的完成过', () => {
    const report = runFullSimulation()
    const dead: string[] = []
    for (const major of report.majors) {
      for (const project of major.content.deadProjects) {
        dead.push(`${major.majorId}: ${project.name}(${project.id})`)
      }
    }

    // 先确认这条测试不是空转：数据集里确实有项目
    expect(GAME_DATA.projects.length).toBeGreaterThan(0)
    expect(
      dead,
      '以下项目在所有决策风格下都从未被完成过 —— 玩家永远看不到它的完成奖励与文案',
    ).toEqual([])
  })
})

describe('项目：经典风格的随机流不被项目机制扰动', () => {
  /**
   * 这是金标指纹仍然成立的原因，值得单独钉死：
   * 项目投入是 **opt-in**（`__project` 默认为 0），
   * 所以 6 个经典风格的候选列表里连项目都不会出现，随机流逐位不变。
   * 哪天有人手滑给了某个经典风格一个非零项目权重，这条会立刻报警，
   * 而不是让金标指纹给出一个看不懂的失败原因。
   */
  it('6 个经典风格明确不投项目，只有「作品派」投', () => {
    for (const name of ['均衡派', '学霸', '技术宅', '社交达人', '躺平', '随机']) {
      expect(STRATEGIES[name]!['__project'], `${name} 应该明确不投项目（__project: 0）`).toBe(0)
    }
    expect(STRATEGIES['作品派']!['__project']).toBeGreaterThan(0)
  })
})

describe('专业隔离：一个专业的对局不受其他专业内容影响', () => {
  /**
   * 「加第 3 个专业只需要写数据」这句话的真正判据 ——
   * 它不依赖任何冻结的夹具，所以永远不会过期：
   *
   *   把 A 专业的内容**单独**拎出来跑一局，
   *   与它在完整数据集（含 B 专业的全部内容）里跑，
   *   结果必须逐位相同。
   *
   * 如果哪天引擎里的专业过滤漏了一处，B 专业的内容就会渗进 A 的池子，
   * 这条测试会直接指出来。
   */
  it('每个专业在「单独数据集」与「完整数据集」里的对局完全一致', () => {
    const mismatches: string[] = []

    for (const major of GAME_DATA.majors) {
      const isolated = isolateMajor(major.id)
      for (const [strategy, weights] of Object.entries(STRATEGIES)) {
        for (const seed of [1, 2, 3, 7, 42]) {
          const full = playOne(seed, weights, major.id)
          const alone = playOne(seed, weights, major.id, isolated)
          if (JSON.stringify(full) !== JSON.stringify(alone)) {
            mismatches.push(`  ${major.id} / ${strategy} / seed=${seed}`)
          }
        }
      }
    }

    expect(
      mismatches,
      `以下对局在「单独跑该专业」和「完整数据集」下结果不同 —— 说明别的专业的内容渗进了它的池子：\n${mismatches.join('\n')}`,
    ).toEqual([])
    // 非空转：确实比较了每个专业
    expect(GAME_DATA.majors.length).toBeGreaterThanOrEqual(2)
  })
})
