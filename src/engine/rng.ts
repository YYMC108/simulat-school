import type { RNG } from './types'

/**
 * mulberry32：32 位种子的伪随机数发生器。
 *
 * 为什么不用 Math.random()？
 * 因为它不可复现。换成带种子的 RNG 之后：
 *   - 单元测试可以断言「给定种子必然得到给定结果」
 *   - 玩家可以靠种子复现同一局游戏（存档回放）
 *   - 数值平衡可以批量模拟，统计结局分布
 */
export function mulberry32(seed: number): RNG {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff)
}

/**
 * 按权重随机抽取一项。权重必须 >= 0，全为 0（或空列表）时返回 null。
 */
export function pickWeighted<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  rng: RNG,
): T | null {
  const weights = items.map(weightOf)
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0)
  if (total <= 0) return null

  let roll = rng() * total
  for (let i = 0; i < items.length; i++) {
    const w = Math.max(0, weights[i] ?? 0)
    if (w === 0) continue
    roll -= w
    if (roll < 0) return items[i] ?? null
  }

  // 浮点误差兜底：回退到最后一项非零权重的元素
  for (let i = items.length - 1; i >= 0; i--) {
    if ((weights[i] ?? 0) > 0) return items[i] ?? null
  }
  return null
}

/** 从数组里随机取一项 */
export function pickOne<T>(items: readonly T[], rng: RNG): T | null {
  if (items.length === 0) return null
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length))
  return items[index] ?? null
}
