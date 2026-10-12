import type { ActionDef } from '../engine/types'

/**
 * 每周可选的行动。每个行动消耗 1 点行动力，每周 3 点 → 一周做 3 件事。
 *
 * 设计原则：所有行动都是「有得有失」的交换，没有纯赚的选项。
 * 数值刻度是 0–100，每周还有 -1 的自然衰减，
 * 所以「把某一项从 60 推到 85」大约要吃掉 15 次行动（约三分之一的行动力）。
 *
 * 数值摘要不写在这里 —— CLI 和 UI 用 describeEffects(action.effects) 自动生成，
 * 这样改了 effects 就不用同步改文案，从根上避免两者不一致。
 */
export const ACTIONS: ActionDef[] = [
  {
    id: 'study',
    label: '去图书馆自习',
    description: '图书馆四楼靠窗的位置最安静',
    cost: 1,
    effects: [
      { type: 'stat', key: 'academic', delta: 4 },
      { type: 'stat', key: 'mood', delta: -2 },
      { type: 'stat', key: 'health', delta: -1 },
    ],
  },
  {
    id: 'socialize',
    label: '和朋友聚餐 / 玩',
    description: '和室友去校门口那家烧烤摊',
    cost: 1,
    requires: { type: 'stat', key: 'money', op: '>=', value: 40 },
    effects: [
      { type: 'stat', key: 'social', delta: 4 },
      { type: 'stat', key: 'mood', delta: 4 },
      { type: 'stat', key: 'money', delta: -40 },
    ],
  },
  {
    id: 'exercise',
    label: '去操场跑步',
    description: '操场上跑五公里，出一身汗',
    cost: 1,
    effects: [
      // 健康是唯一「多个行动都在扣、只有运动在补」的属性，
      // 所以单次收益必须给足，否则谁都留不住健康
      { type: 'stat', key: 'health', delta: 7 },
      { type: 'stat', key: 'mood', delta: 2 },
    ],
  },
  {
    id: 'rest',
    label: '在宿舍躺平休息',
    description: '什么也不干，就躺着',
    cost: 1,
    effects: [
      { type: 'stat', key: 'mood', delta: 7 },
      { type: 'stat', key: 'health', delta: 1 },
      { type: 'stat', key: 'academic', delta: -1 },
    ],
  },
  {
    id: 'parttime',
    label: '去做兼职',
    description: '奶茶店打工 / 做家教',
    cost: 1,
    effects: [
      { type: 'stat', key: 'money', delta: 280 },
      { type: 'stat', key: 'health', delta: -2 },
      { type: 'stat', key: 'mood', delta: -2 },
    ],
  },
  {
    id: 'code',
    label: '写自己的项目 / 刷算法题',
    description: '打开编辑器，写点自己想写的东西',
    cost: 1,
    effects: [
      { type: 'stat', key: 'skill', delta: 4 },
      { type: 'stat', key: 'academic', delta: 1 },
      { type: 'stat', key: 'mood', delta: -2 },
      { type: 'stat', key: 'health', delta: -1 },
    ],
  },
  {
    id: 'job_hunt',
    label: '投简历 / 准备面试',
    description: '投简历、背八股、刷算法题',
    cost: 1,
    requires: {
      type: 'all',
      conditions: [
        { type: 'stat', key: 'skill', op: '>=', value: 50 },
        { type: 'week', op: '>=', value: 9 },
      ],
    },
    effects: [
      { type: 'stat', key: 'skill', delta: 3 },
      { type: 'stat', key: 'mood', delta: -3 },
      { type: 'addFlag', key: '投递次数', delta: 1 },
    ],
  },
]
