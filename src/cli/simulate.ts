/**
 * 数值平衡模拟器。
 *
 *   pnpm simulate                每种风格 200 局
 *   pnpm simulate -- --games 1000
 *
 * 它会用几种「决策风格」各跑大量对局，然后输出：
 *   1. 结局 × 风格的命中率矩阵
 *   2. 每种风格的终局平均属性
 *   3. 从来没被触发过的结局  ← 最重要的输出
 *
 * 第 3 点特别关键：一个「永远触发不到的结局」就是一段死代码。
 * 人肉试玩几十局是发现不了的，但跑几千局一眼就能看出来。
 *
 * 整个模拟是「种子确定」的 —— 同样的 --games 永远得到同样的结果，
 * 所以这个逻辑可以直接被单元测试断言（见 tests/engine.test.ts）。
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'

import { GAME_DATA } from '../data/index'
import { GameEngine } from '../engine/engine'
import { STAT_LABELS, STAT_ORDER } from '../engine/effects'
import { mulberry32, pickOne, pickWeighted } from '../engine/rng'
import { padEndWidth, padStartWidth } from './text'
import type { Stats } from '../engine/types'

// STAT_ORDER 现在从 engine/effects 统一导出（CLI 和 Web 共用一份顺序）

/**
 * 决策风格：给每个行动一个偏好权重（没列出的默认 1，填 0 表示不会主动选）。
 * 这几种风格覆盖了现实中大学生的主要「玩法」。
 */
export const STRATEGIES: Record<string, Record<string, number>> = {
  均衡派: { study: 4, socialize: 4, exercise: 3, rest: 3, parttime: 3, code: 4, job_hunt: 3 },
  学霸: { study: 9, socialize: 1, exercise: 2, rest: 2, parttime: 2, code: 3, job_hunt: 2 },
  技术宅: { study: 3, socialize: 1, exercise: 2, rest: 2, parttime: 2, code: 9, job_hunt: 4 },
  社交达人: { study: 2, socialize: 9, exercise: 2, rest: 2, parttime: 2, code: 2, job_hunt: 1 },
  躺平: { study: 1, socialize: 3, exercise: 2, rest: 9, parttime: 2, code: 1, job_hunt: 1 },
  随机: {},
}

/* ---------------- 单局模拟 ---------------- */

export interface SimOutcome {
  endingId: string
  stats: Stats
}

/** 用指定决策风格跑一局。seed 固定则结果固定。 */
export function playOne(seed: number, weights: Record<string, number>): SimOutcome {
  const engine = new GameEngine(GAME_DATA, { seed })
  const rng = mulberry32(seed * 7919 + 13)
  let guard = 0

  while (!engine.isEnded() && guard++ < 5000) {
    const pending = engine.getPending()
    if (pending) {
      const enabled = engine
        .getPendingChoices()
        .map((view, index) => ({ view, index }))
        .filter((item) => item.view.enabled)
      const picked = pickOne(enabled, rng)
      engine.choose(picked ? picked.index : 0)
      continue
    }

    const actions = engine.availableActions()
    // 权重随机：避免机械化的唯一最优解，同时让每种风格有稳定倾向
    const picked = pickWeighted(actions, (action) => weights[action.id] ?? 1, rng)
    if (!picked) break
    engine.takeAction(picked.id)
  }

  return {
    endingId: engine.getEnding()?.id ?? '(无结局)',
    stats: engine.getState().stats,
  }
}

/* ---------------- 汇总 ---------------- */

export interface SimReport {
  gamesPerStrategy: number
  strategyNames: string[]
  /** 风格 → (结局 id → 次数) */
  counts: Map<string, Map<string, number>>
  /** 风格 → (属性 key → 总和) */
  statTotals: Map<string, Record<string, number>>
  /** 所有被触发过的结局 id */
  triggered: Set<string>
  /** 从未被触发过的结局 */
  deadEndings: { id: string; title: string }[]
}

export function simulate(gamesPerStrategy: number): SimReport {
  const strategyNames = Object.keys(STRATEGIES)
  const counts = new Map<string, Map<string, number>>()
  const statTotals = new Map<string, Record<string, number>>()
  const triggered = new Set<string>()

  for (const name of strategyNames) {
    const weights = STRATEGIES[name] ?? {}
    const tally = new Map<string, number>()
    const totals: Record<string, number> = {}
    counts.set(name, tally)

    for (let i = 0; i < gamesPerStrategy; i++) {
      const outcome = playOne(i + 1, weights)
      tally.set(outcome.endingId, (tally.get(outcome.endingId) ?? 0) + 1)
      triggered.add(outcome.endingId)
      for (const key of STAT_ORDER) {
        totals[key] = (totals[key] ?? 0) + outcome.stats[key]
      }
    }

    statTotals.set(name, totals)
  }

  const deadEndings = GAME_DATA.endings
    .filter((ending) => !triggered.has(ending.id))
    .map((ending) => ({ id: ending.id, title: ending.title }))

  return { gamesPerStrategy, strategyNames, counts, statTotals, triggered, deadEndings }
}

/* ---------------- 中英文混排对齐（中文按 2 个字符宽度算） ---------------- */

/* ---------------- 渲染 ---------------- */

export function renderReport(report: SimReport): void {
  const { strategyNames, counts, statTotals, gamesPerStrategy } = report
  const ordered = [...GAME_DATA.endings].sort((a, b) => a.priority - b.priority)
  const labelWidth = 18
  const cellWidth = 10

  console.log(
    `\n每种风格 ${gamesPerStrategy} 局，共 ${gamesPerStrategy * strategyNames.length} 局\n`,
  )

  console.log(
    padEndWidth('结局', labelWidth) +
      strategyNames.map((name) => padStartWidth(name, cellWidth)).join(''),
  )
  console.log('─'.repeat(labelWidth + cellWidth * strategyNames.length))

  for (const ending of ordered) {
    const cells = strategyNames.map((name) =>
      padStartWidth(`${(((counts.get(name)?.get(ending.id) ?? 0) / gamesPerStrategy) * 100).toFixed(1)}%`, cellWidth),
    )
    const never = strategyNames.every((name) => (counts.get(name)?.get(ending.id) ?? 0) === 0)
    console.log(padEndWidth(ending.title, labelWidth) + cells.join('') + (never ? '  ⚠ 从未触发' : ''))
  }

  console.log('─'.repeat(labelWidth + cellWidth * strategyNames.length))
  console.log(
    padEndWidth('平均终局属性', labelWidth) +
      strategyNames.map(() => padStartWidth('', cellWidth)).join(''),
  )

  for (const key of STAT_ORDER) {
    const cells = strategyNames.map((name) => {
      const avg = (statTotals.get(name)?.[key] ?? 0) / gamesPerStrategy
      return padStartWidth(key === 'money' ? `¥${Math.round(avg)}` : avg.toFixed(0), cellWidth)
    })
    console.log(padEndWidth(`  ${STAT_LABELS[key]}`, labelWidth) + cells.join(''))
  }

  console.log('')
  if (report.deadEndings.length === 0) {
    console.log(`✅ 所有 ${ordered.length} 个结局都至少被触发过一次。`)
  } else {
    console.log(`⚠  有 ${report.deadEndings.length} 个结局在所有风格下都没触发过，很可能是「死结局」：`)
    for (const ending of report.deadEndings) {
      console.log(`     - ${ending.title}  (${ending.id})`)
    }
    console.log('   要么放宽触发条件，要么确认这条路线真的走得通。')
  }
  console.log('')
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
