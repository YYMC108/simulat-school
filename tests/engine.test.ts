import { describe, expect, it } from 'vitest'

import { deadSummaryRules, simulate } from '../src/cli/simulate'
import { GAME_DATA } from '../src/data/index'
import { GameEngine } from '../src/engine/engine'
import { evaluate } from '../src/engine/conditions'
import { STAT_ORDER, applyEffects } from '../src/engine/effects'
import { mulberry32 } from '../src/engine/rng'
import { createInitialState } from '../src/engine/state'
import type { EvalContext, GameState, StatKey } from '../src/engine/types'

function makeContext(overrides: Partial<GameState> = {}, seed = 1): EvalContext {
  const state = { ...createInitialState(GAME_DATA.config), ...overrides }
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
 * 一整轮完整模拟（6 种风格 × 120 局 = 720 局）的结果。
 *
 * 三个「死 XX」不变量（死结局 / 死事件 / 死规则）吃的都是同一份结果，
 * 所以缓存起来只跑一次 —— 否则测试要跑 2160 局，时间白翻三倍。
 * `simulate` 是种子确定的，缓存不影响正确性，也不会有 flaky。
 */
let fullReport: ReturnType<typeof simulate> | null = null
function runFullSimulation(): ReturnType<typeof simulate> {
  fullReport ??= simulate(120)
  return fullReport
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
   * 因为整个模拟是种子确定的，所以这条测试不会 flaky；
   * 反过来，如果调整数值导致某个结局变得不可达，它会立刻告诉你。
   */
  it('所有结局都能被玩出来（没有死结局）', () => {
    const report = runFullSimulation()
    expect(
      report.deadEndings.map((ending) => `${ending.title}(${ending.id})`),
      '以下结局在所有决策风格下都从未触发，检查它们的触发条件是否过严',
    ).toEqual([])
  })

  /**
   * 和「没有死结局」同构的不变量，只是对象换成事件。
   * 一个写进数据里却永远触发不到的事件，跟一段死代码没有区别 ——
   * 它只会平白占着权重、让别的本可以出现的事件更难出现。
   */
  it('所有随机事件都能被触发（没有死事件）', () => {
    const report = runFullSimulation()
    expect(
      report.content.deadEvents.map((event) => `${event.title}(${event.id})`),
      '以下事件在所有决策风格下都从未触发，检查它们的触发条件是否过严（或状态触发事件的阈值是否根本达不到）',
    ).toEqual([])
  })

  /**
   * 第三个同构的不变量，对象换成结算回顾的规则。
   * 一条写了却永远触发不到的回顾就是一段死文案 ——
   * 玩家看不到它，而它却占着「本可以放别的话」的位置。
   */
  it('结算回顾的每条规则都可能被触发（没有死规则）', () => {
    const report = runFullSimulation()
    expect(
      deadSummaryRules(report.content.summaryTexts).map((rule) => rule.text),
      '以下回顾规则在所有决策风格下都从未触发，检查条件是否过严（尤其是属性阈值类规则）',
    ).toEqual([])
  })
})
