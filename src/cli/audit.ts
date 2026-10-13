/**
 * 内容静态审计 —— 不需要跑模拟就能发现的问题。
 *
 * 目前只有一项：**死 flag**。
 *
 * ── 什么是死 flag ──
 *   · 「写了没人读」：`setFlag` 设了一个 flag，却没有任何条件读它。
 *     它是一段死数据 —— 玩家永远感知不到，维护者却以为它有意义。
 *   · 「读了没人写」：某个条件读了 flag，却没有任何地方写它。
 *     这是一个**永远不可能成立的条件**，写在事件/结局/回顾里就是死分支。
 *
 * 这两个方向都要查：只查一个方向，另一种死法会一直藏在水面下。
 *
 * ── 为什么必须按专业作用域查 ──
 * 阶段 2 之后内容带 `majors` 标签。如果只做全局检查，下面这种 bug 会漏掉：
 *   共享结局读了 flag「诗集完成」，而写它的只有文科的专属事件。
 * 全局看「有写有读」，完全正常；但对**计算机**来说，那个结局条件永远不成立。
 * 所以判据必须是：**每个专业自己看得见的那份内容，自己写了就自己读。**
 *
 * ── 它和模拟器的分工 ──
 * 静态审计回答「有没有人读它」；模拟器回答「它到底可不可达」。
 * 前者快、确定、能覆盖所有分支；后者慢但真实。两者都不能替代对方。
 */
import { GAME_DATA } from '../data/index'
import { contentFor } from './simulate'
import type { MajorContent } from './simulate'
import type { Condition, Effect } from '../engine/types'

/** 一份内容里出现过的 flag */
export interface FlagUsage {
  /** 被写入的 flag（setFlag / addFlag） */
  written: Set<string>
  /** 被读取的 flag（flag / flagEq / flagAtLeast 条件） */
  read: Set<string>
}

/** flag 审计结果 */
export interface FlagAudit {
  /** 写了却没有任何地方读 —— 死数据 */
  writtenNeverRead: string[]
  /** 读了却没有任何地方写 —— 永远不成立的条件 */
  readNeverWritten: string[]
}

function walkCondition(condition: Condition | undefined, usage: FlagUsage): void {
  if (condition === undefined) return

  switch (condition.type) {
    case 'flag':
    case 'flagEq':
    case 'flagAtLeast':
      usage.read.add(condition.key)
      return

    case 'not':
      walkCondition(condition.condition, usage)
      return

    case 'all':
    case 'any':
      for (const child of condition.conditions) walkCondition(child, usage)
      return

    // 与 flag 无关的分支：显式列出来，这样以后 DSL 加新分支时
    // TS 的穷尽性会让这里编译报错，而不是悄悄漏掉一个条件类型
    case 'stat':
    case 'week':
    case 'chance':
    case 'seenEvent':
      return
  }
}

function walkEffects(effects: readonly Effect[] | undefined, usage: FlagUsage): void {
  if (effects === undefined) return

  for (const effect of effects) {
    switch (effect.type) {
      case 'setFlag':
      case 'addFlag':
        usage.written.add(effect.key)
        break

      case 'if':
        // if 的条件是「读」，它的效果继续往下走
        walkCondition(effect.requires, usage)
        walkEffects(effect.effects, usage)
        break

      case 'branch':
        for (const option of effect.options) walkEffects(option.effects, usage)
        break

      case 'stat':
      case 'log':
      case 'end':
        break
    }
  }
}

/** 把一份内容里所有 flag 的读写位置都走一遍 */
export function flagUsageOf(content: MajorContent): FlagUsage {
  const usage: FlagUsage = { written: new Set(), read: new Set() }

  // 每周固定结算也要扫：`穷困周数` 就是在这里 +1 的，
  // 漏掉它会把「读了却没人写」误报出来（踩过这个假警报）
  walkEffects(content.weeklyEffects, usage)

  for (const action of content.actions) {
    walkCondition(action.requires, usage)
    walkEffects(action.effects, usage)
  }

  for (const event of content.events) {
    walkCondition(event.requires, usage)
    walkEffects(event.effects, usage)
    for (const choice of event.choices ?? []) {
      walkCondition(choice.requires, usage)
      walkEffects(choice.effects, usage)
    }
  }

  for (const ending of content.endings) {
    walkCondition(ending.requires, usage)
  }

  for (const rule of content.summaryRules) {
    // 回顾规则只读不写：叙述本来就是消费 flag 的地方
    walkCondition(rule.requires, usage)
  }

  return usage
}

/**
 * 审计一份内容的 flag 使用情况。
 *
 * `consumedByEngine` 用来豁免**由引擎而非数据写入**的 flag（目前没有，
 * 阶段 2.2 的项目进度 flag 会用到它）：那些 flag 静态扫描看不到写入点，
 * 但引擎确实会写它，所以不该被报成「读了没人写」。
 */
export function auditFlagsOf(content: MajorContent, consumedByEngine: string[] = []): FlagAudit {
  const usage = flagUsageOf(content)
  const engineWritten = new Set(consumedByEngine)

  return {
    writtenNeverRead: [...usage.written].filter((key) => !usage.read.has(key)).sort(),
    readNeverWritten: [...usage.read]
      .filter((key) => !usage.written.has(key) && !engineWritten.has(key))
      .sort(),
  }
}

function allContent(): MajorContent {
  return {
    actions: GAME_DATA.actions,
    events: GAME_DATA.events,
    endings: GAME_DATA.endings,
    summaryRules: GAME_DATA.summary.rules,
    weeklyEffects: GAME_DATA.config.weeklyEffects,
  }
}

/**
 * 审计某个专业的 flag 使用（不传 majorId = 全部内容合起来看一遍）。
 *
 * 全局那一遍能抓到「整个项目里没人读」的死 flag；
 * 按专业那一遍能抓到「有专业写了、但只有另一个专业读」的跨专业泄漏。
 * 两个都要跑。
 */
export function auditFlags(majorId?: string): FlagAudit {
  if (majorId === undefined) return auditFlagsOf(allContent())
  return auditFlagsOf(contentFor(majorId))
}
