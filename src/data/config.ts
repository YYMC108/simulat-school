import type { GameConfig, StatRange, Stats } from '../engine/types'

/**
 * 属性表：全部数值都集中在这里，方便调平衡。
 * 想改「学业满分是 100 还是 150」，只改这一处。
 */
export const STAT_RANGES: StatRange = {
  academic: { min: 0, max: 100 },
  social: { min: 0, max: 100 },
  health: { min: 0, max: 100 },
  mood: { min: 0, max: 100 },
  money: { min: 0, max: 999999 },
  skill: { min: 0, max: 100 },
}

export const INITIAL_STATS: Stats = {
  academic: 60,
  social: 50,
  health: 70,
  mood: 70,
  money: 800,
  skill: 40,
}

export const GAME_CONFIG: GameConfig = {
  totalWeeks: 16,
  actionPointsPerWeek: 3,
  initialStats: INITIAL_STATS,
  statRanges: STAT_RANGES,

  /**
   * 每周固定结算。
   *
   * 数值平衡的关键在「折旧」：如果只有正向收益，48 次行动会把所有属性顶满。
   * 加了每周衰减之后，你光是为了「不掉下去」就得持续投入，
   * 行动力立刻变成稀缺资源，取舍才有意义。
   * 这也符合现实：不复习会忘，不联系会疏远，不运动体能会退化。
   */
  weeklyEffects: [
    // 遗忘 / 疏远 / 体能退化：各 -1
    { type: 'stat', key: 'academic', delta: -1 },
    { type: 'stat', key: 'skill', delta: -1 },
    { type: 'stat', key: 'social', delta: -1 },
    { type: 'stat', key: 'health', delta: -1 },

    // 学业压力：心情每周自然下滑（-1 而不是 -2 —— 模拟显示 -2 会让
    // 「努力的人必然情绪崩溃」，把好结局全堵死了）
    { type: 'stat', key: 'mood', delta: -1 },

    // 生活费 + 伙食费
    { type: 'stat', key: 'money', delta: -100 },

    // 条件效果演示：真的没钱了会很难受，并且累计「穷困周数」影响结局
    {
      type: 'if',
      requires: { type: 'stat', key: 'money', op: '<=', value: 0 },
      effects: [
        { type: 'log', text: '钱包见底了，食堂只能点最便宜的窗口。' },
        { type: 'stat', key: 'mood', delta: -8 },
        { type: 'addFlag', key: '穷困周数', delta: 1 },
      ],
    },
  ],

  weeklyEventChance: 0.7,
}
