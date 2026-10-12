import { describe, expect, it } from 'vitest'

import { simulate } from '../src/cli/simulate'
import { GAME_DATA } from '../src/data/index'
import { GameEngine } from '../src/engine/engine'
import { evaluate } from '../src/engine/conditions'
import { mulberry32 } from '../src/engine/rng'
import { createInitialState } from '../src/engine/state'
import type { EvalContext, GameState } from '../src/engine/types'

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
    const report = simulate(120)
    expect(
      report.deadEndings.map((ending) => `${ending.title}(${ending.id})`),
      '以下结局在所有决策风格下都从未触发，检查它们的触发条件是否过严',
    ).toEqual([])
  })
})
