/**
 * 专业维度的**通用**处理。
 *
 * 这个文件刻意做得很小，因为它承担的是「引擎里的专业相关逻辑总共只有这么多」
 * 这个承诺。引擎不认识「计算机」或「文科」，只认识两条规则：
 *
 *   1. 内容没打 `majors` 标签 → 全专业共享
 *   2. 内容打了标签 → 只有列出的专业看得见
 *
 * 加一个新专业不需要碰这里一行代码。
 */
import type { GameData, MajorDef, StatKey, StatRange, Stats } from './types'

/**
 * 这条内容属于该专业吗？
 *
 * `undefined` 视为共享是刻意选的默认值：内容库里绝大多数条目
 * （宿舍矛盾、下雨、生病……）跟专业无关，让它们**默认可见**才能保证
 * 「加专业」这件事的改动量正比于新增内容，而不是正比于全库内容。
 */
export function matchesMajor(tags: string[] | undefined, majorId: string): boolean {
  return tags === undefined || tags.includes(majorId)
}

/**
 * 解析本局的专业定义。
 *
 * 不传 `majorId` 时用第一个专业当默认 —— 这样老调用方
 * （以及只想快速开一局的测试）不用被迫指定专业。
 * 传了却查不到则直接抛错（fail fast）：静默回退到默认专业会让
 * 「玩家选了文科、进了计算机」这种 bug 变得极难发现。
 */
export function resolveMajor(data: GameData, majorId?: string): MajorDef {
  const first = data.majors[0]
  if (!first) {
    throw new Error('GameData.majors 不能为空：至少要有第一个专业作为默认值')
  }
  if (majorId === undefined) return first

  const found = data.majors.find((major) => major.id === majorId)
  if (!found) {
    const available = data.majors.map((major) => major.id).join(' / ')
    throw new Error(`未知专业: ${majorId}（可选：${available}）`)
  }
  return found
}

/**
 * 基准属性 + 专业偏移 = 本局开局属性。
 *
 * 结果会被夹进 `statRanges`：I1 说「每项属性都在范围内」，而开局是最容易被
 * 忘掉的一帧 —— 数值型的偏移一旦写大（比如文科 社交 +40），
 * 玩家第一眼看到的就是一个越界的属性条。
 */
export function applyStatBonus(
  base: Stats,
  bonus: Partial<Stats> | undefined,
  ranges: StatRange,
): Stats {
  const result = { ...base }
  if (!bonus) return result

  for (const key of Object.keys(bonus) as StatKey[]) {
    const delta = bonus[key]
    if (delta === undefined) continue
    const range = ranges[key]
    result[key] = Math.min(range.max, Math.max(range.min, result[key] + delta))
  }
  return result
}
