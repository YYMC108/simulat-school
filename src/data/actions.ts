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
    // 括号里那句是**给玩家的暗示**（不是给引擎看的）：
    // 有钱的时候「聚餐」才在菜单上，而免费的社交恰恰在这个时候看不见 ——
    // 玩家需要一个线索，知道「钱花光了不等于交不到朋友」。
    // 这句话只在这条行动可见时出现，条件天然正确。
    description: '和室友去校门口吃烧烤，没钱就约人打游戏',
    cost: 1,
    requires: { type: 'stat', key: 'money', op: '>=', value: 40 },
    effects: [
      { type: 'stat', key: 'social', delta: 4 },
      { type: 'stat', key: 'mood', delta: 4 },
      { type: 'stat', key: 'money', delta: -40 },
    ],
  },
  {
    id: 'hangout',
    label: '约同学联机打游戏',
    description: '不花钱的那种社交：宿舍开一局，能玩到熄灯',
    cost: 1,
    /**
     * 「涨社交必须花钱」曾经是内容层面的独木桥：全项目只有 `socialize` 一个行动
     * 能给社交，而它要 ¥40。于是在钱包见底的那几周，社交这条路是**直接封死**的。
     *
     * ── 为什么是「打游戏」而不是「一起自习 / 打球」──
     * 效果是 社交 +3 / 心情 +3 / 学业 −1 / 健康 −1，四个数字必须互相自洽：
     *   · 一起自习 → 说不通（自习是学习，凭什么扣学业）
     *   · 打球     → 也说不通（打球是锻炼，凭什么扣健康）
     *   · 联机打游戏 → 全部自洽：占掉学习时间（学业 −1）、熬到熄灯（健康 −1）、
     *                  一起玩很开心（心情 +3）、宿舍关系更近（社交 +3）
     * 效果一个没动（那会动摇已经调好的平衡），改的只是让它**说得通**。
     *
     * ── 为什么门槛写成「钱 < 40」而不是不写门槛 ──
     * 这不是为了刁难有钱人，而是被 simulate 教出来的：
     *
     * 第一版没有门槛，结果 社交达人 结局在计算机均衡派身上从 4% 涨到 **42%**、
     * 保研从 14.5% 掉到 3%、社交达人风格的「为钱所困」从 18.5% 涨到 41%。
     * 两个独立的原因：
     *   1. **健康是最紧的属性**（设计文档 §4.3），第一版白送健康 +3，太贵了
     *   2. 更根本的：模拟器是**按权重随机**选的，它表达不了「我只在没钱时才这么干」。
     *      一个永远可用的免费社交行动，会被「有钱的时候」也大量选中 ——
     *      既顶掉了 `parttime`（于是更容易穷），又给所有人涨社交。
     *
     * 所以把「只在需要时出现」这件事**写进数据**：钱够 40 就去聚餐（社交 +4/心情 +4），
     * 钱不够才走这条路。两者条件互斥，于是**任何时刻都有且只有一条社交路** ——
     * 这既修好了「没钱就社交不了」的独木桥，又不会给所有对局免费加社交。
     */
    requires: { type: 'stat', key: 'money', op: '<', value: 40 },
    effects: [
      { type: 'stat', key: 'social', delta: 3 },
      { type: 'stat', key: 'mood', delta: 3 },
      // 代价是时间（学业）与体力，而不是钱
      { type: 'stat', key: 'academic', delta: -1 },
      { type: 'stat', key: 'health', delta: -1 },
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
    // 计算机专业的核心行动：文科的同位行动是「写稿」（见 literature.ts）
    majors: ['computer'],
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
    // 描述不能只写「背八股、刷算法题」：这个行动是两个专业共享的，
    // 文科生投简历也要准备笔试和面试（描述只用于展示，不影响数值）
    description: '投简历、准备笔试和面试',
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
