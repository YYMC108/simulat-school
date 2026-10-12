import { evaluate } from './conditions'
import { pickWeighted } from './rng'
import { pushLog } from './state'
import type { Effect, EvalContext, StatKey } from './types'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 应用一组效果。注意：会直接修改 ctx.state（引擎内部的写法），
 * 对外则通过 getState() 返回副本。
 */
export function applyEffects(ctx: EvalContext, effects: readonly Effect[]): void {
  for (const effect of effects) {
    applyEffect(ctx, effect)
  }
}

function applyEffect(ctx: EvalContext, effect: Effect): void {
  const { state, config } = ctx

  switch (effect.type) {
    case 'stat': {
      const range = config.statRanges[effect.key]
      const current: number = state.stats[effect.key]
      state.stats[effect.key] = clamp(current + effect.delta, range.min, range.max)
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
        applyEffects(ctx, effect.effects)
      }
      break

    case 'branch': {
      // 权重随机，必定且只命中一个分支
      const picked = pickWeighted(effect.options, (option) => option.weight, ctx.rng)
      if (picked) applyEffects(ctx, picked.effects)
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
