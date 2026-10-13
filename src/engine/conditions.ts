import type { CompareOp, Condition, EvalContext } from './types'

function compare(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case '>=':
      return a >= b
    case '<=':
      return a <= b
    case '>':
      return a > b
    case '<':
      return a < b
    case '==':
      return a === b
    case '!=':
      return a !== b
    default:
      return false
  }
}

/**
 * 条件求值。condition 为 undefined 时视为恒真（没写条件 = 总是触发）。
 */
export function evaluate(condition: Condition | undefined, ctx: EvalContext): boolean {
  if (condition === undefined) return true

  switch (condition.type) {
    case 'stat':
      return compare(ctx.state.stats[condition.key], condition.op, condition.value)

    case 'flag': {
      const value = ctx.state.flags[condition.key]
      return value === true || (typeof value === 'number' && value !== 0)
    }

    case 'flagEq':
      return ctx.state.flags[condition.key] === condition.value

    case 'flagAtLeast': {
      const value = ctx.state.flags[condition.key]
      return typeof value === 'number' && value >= condition.value
    }

    case 'week':
      return compare(ctx.state.week, condition.op, condition.value)

    case 'not':
      return !evaluate(condition.condition, ctx)

    case 'all':
      return condition.conditions.every((child) => evaluate(child, ctx))

    case 'any':
      return condition.conditions.some((child) => evaluate(child, ctx))

    case 'chance':
      return ctx.rng() < condition.probability

    case 'seenEvent':
      return ctx.state.seenEvents.includes(condition.id)
  }
}
