import { evaluate } from './conditions'
import { pickWeighted } from './rng'
import { pushLog } from './state'
import type { Effect, EvalContext, StatChange, StatKey } from './types'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 把一次属性变化累加进汇总表（同一次结算里对同一属性的多次变化要合并） */
function recordChange(
  changes: Map<StatKey, StatChange>,
  key: StatKey,
  delta: number,
  capped: 'min' | 'max' | null,
): void {
  const existing = changes.get(key)
  if (existing) {
    existing.delta += delta
    if (capped !== null) existing.capped = capped
  } else {
    changes.set(key, capped === null ? { key, delta } : { key, delta, capped })
  }
}

/**
 * 应用一组效果，**并返回它造成的实际属性变化**。
 *
 * 注意返回的是「实际」而不是「声明」：属性触顶时声明的 `+4` 只算 `+2`；
 * `if` / `branch` 里没走到的分支一点都不算。
 * UI 用这个显示结算回执，而不是拿效果数组去猜。
 *
 * 会直接修改 ctx.state（引擎内部的写法），对外通过 getState() 返回副本。
 */
export function applyEffects(ctx: EvalContext, effects: readonly Effect[]): StatChange[] {
  const changes = new Map<StatKey, StatChange>()
  applyEffectsInto(ctx, effects, changes)

  // 净变化为 0 且没有触顶的属性不显示，避免「+0」噪声；
  // 但触顶的 0 变化必须保留 —— 「这次白费了」本身就是最重要的反馈
  return [...changes.values()].filter(
    (change) => change.delta !== 0 || change.capped !== undefined,
  )
}

/** 内部递归用：把变化累加进调用方传进来的同一张表 */
function applyEffectsInto(
  ctx: EvalContext,
  effects: readonly Effect[],
  changes: Map<StatKey, StatChange>,
): void {
  for (const effect of effects) {
    applyEffect(ctx, effect, changes)
  }
}

function applyEffect(ctx: EvalContext, effect: Effect, changes: Map<StatKey, StatChange>): void {
  const { state, config } = ctx

  switch (effect.type) {
    case 'stat': {
      const range = config.statRanges[effect.key]
      const current: number = state.stats[effect.key]
      const desired = current + effect.delta
      const next = clamp(desired, range.min, range.max)
      state.stats[effect.key] = next

      // 被截断说明撞到了上限或下限，记下来让 UI 能解释「为什么只加了这么点」
      let capped: 'min' | 'max' | null = null
      if (next !== desired) capped = desired > next ? 'max' : 'min'

      recordChange(changes, effect.key, next - current, capped)
      break
    }

    case 'setFlag':
      state.flags[effect.key] = effect.value
      break

    case 'addFlag': {
      const current = state.flags[effect.key]
      state.flags[effect.key] = (typeof current === 'number' ? current : 0) + effect.delta
      break
    }

    case 'log':
      pushLog(state, 'system', effect.text)
      break

    case 'if':
      if (evaluate(effect.requires, ctx)) {
        applyEffectsInto(ctx, effect.effects, changes)
      }
      break

    case 'branch': {
      // 权重随机，必定且只命中一个分支
      const picked = pickWeighted(effect.options, (option) => option.weight, ctx.rng)
      if (picked) applyEffectsInto(ctx, picked.effects, changes)
      break
    }

    case 'end':
      state.endingId = effect.endingId
      break
  }
}

/**
 * 给玩家看的一段属性变化摘要，例如「学业 +6 / 心情 -3」。
 * CLI 和以后的 UI 都用它做反馈。
 */
export function describeEffects(effects: readonly Effect[]): string {
  const parts: string[] = []

  const walk = (list: readonly Effect[]): void => {
    for (const effect of list) {
      if (effect.type === 'stat') {
        const sign = effect.delta >= 0 ? '+' : ''
        parts.push(`${STAT_LABELS[effect.key]} ${sign}${effect.delta}`)
      } else if (effect.type === 'if') {
        walk(effect.effects)
      } else if (effect.type === 'branch') {
        for (const option of effect.options) walk(option.effects)
      }
    }
  }

  walk(effects)
  return parts.join(' / ')
}

export const STAT_LABELS: Record<StatKey, string> = {
  academic: '学业',
  social: '社交',
  health: '健康',
  mood: '心情',
  money: '金钱',
  skill: '技能',
}
