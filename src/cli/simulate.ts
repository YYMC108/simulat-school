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
 *   4. 内容健康度：跨局重复度、死事件、冷热事件排行
 *
 * 第 3 点特别关键：一个「永远触发不到的结局」就是一段死代码。
 * 人肉试玩几十局是发现不了的，但跑几千局一眼就能看出来。
 *
 * 第 4 点是阶段 1（内容扩充）的尺子：跨局重复度衡量「玩家会不会玩两局就腻」，
 * 死事件和「死结局」同理，冷热排行告诉你重复感具体来自哪几个事件。
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
  /** 本局触发过的事件 id —— 用于度量内容覆盖和跨局重复度 */
  seenEvents: string[]
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
    // 去重：可重复事件每触发一次就往 seenEvents 里 push 一次，
    // 但我们关心的是「遇到哪些事件」，不是「触发了几次」
    seenEvents: [...new Set(engine.getState().seenEvents)],
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
  /** 单事件最高出现率（0~1）。太高 = 每局必见 = 重复感的来源 */
  maxEventRate: number
  hottestEventId: string
  /** 同风格相邻两局的平均重复度（0~1）。阶段 1 验收标准是 ≤ 0.30 */
  repetition: number
  /** 平均每局遇到的不重复事件数 */
  avgDistinct: number
}

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
  content: ContentMetrics
}

export function simulate(gamesPerStrategy: number): SimReport {
  const strategyNames = Object.keys(STRATEGIES)
  const counts = new Map<string, Map<string, number>>()
  const statTotals = new Map<string, Record<string, number>>()
  const triggered = new Set<string>()

  // 内容度量用
  const eventCounts = new Map<string, number>()
  const seenPerGame: string[][] = []
  const gameStrategy: string[] = []
  let totalDistinct = 0

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

      seenPerGame.push(outcome.seenEvents)
      gameStrategy.push(name)
      totalDistinct += outcome.seenEvents.length
      for (const id of outcome.seenEvents) {
        eventCounts.set(id, (eventCounts.get(id) ?? 0) + 1)
      }
    }

    statTotals.set(name, totals)
  }

  const deadEndings = GAME_DATA.endings
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

  const deadEvents = GAME_DATA.events
    .filter((event) => event.category === 'random')
    .filter((event) => !eventCounts.has(event.id))
    .map((event) => ({ id: event.id, title: event.title }))

  const content: ContentMetrics = {
    eventCounts,
    games: totalGames,
    deadEvents,
    maxEventRate,
    hottestEventId,
    repetition: overlapPairs > 0 ? overlapSum / overlapPairs : 0,
    avgDistinct: totalGames > 0 ? totalDistinct / totalGames : 0,
  }

  return { gamesPerStrategy, strategyNames, counts, statTotals, triggered, deadEndings, content }
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

  renderContentHealth(report)
  console.log('')
}

/** 内容健康度：重复度、死事件、冷热排行。这是「玩家会不会玩两局就腻」的量化答案 */
function renderContentHealth(report: SimReport): void {
  const { content } = report
  const eventTitleOf = new Map(GAME_DATA.events.map((e) => [e.id, e.title]))

  console.log('\n── 内容健康度 ─────────────────────────────')
  console.log(`  每局遇到的不重复事件:  ${content.avgDistinct.toFixed(1)} / ${GAME_DATA.events.length}`)
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
    console.log('  死事件:                ✅ 无（每个事件都被触发过）')
  } else {
    console.log(`  死事件:                ⚠ 有 ${content.deadEvents.length} 个从未触发：`)
    for (const event of content.deadEvents) {
      console.log(`                             - ${event.title} (${event.id})`)
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
