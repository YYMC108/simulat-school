import type { ProjectDef } from '../engine/types'

/**
 * 计算机专业的项目 / 作品。
 *
 * 文科的项目写在 `literature.ts` 里（和它的行动、事件、结局放在一起，
 * 让「一个专业的全部内容」保持在一个文件中）。这里只放计算机的。
 *
 * ── 项目是什么 ──
 * 需要**多周持续投入**才能做出来的东西：每次投入消耗 1 点行动力、进度 +1，
 * 攒够次数才算完成，然后产出一个 flag 与一份奖励。
 * 机制在引擎里（`getProjects()` / `investProject()`），这个文件只有数据。
 *
 * ── 为什么完成能通向结局 ──
 * `completionFlag` 会被结局与回顾规则读取（见 endings.ts / summary.ts）：
 * 「技术宅的胜利」多了一条「开源库做出来了」的路径，
 * 于是「你这个学期造出了什么」真的能决定你成为谁。
 */
export const COMPUTER_PROJECTS: ProjectDef[] = [
  {
    id: 'proj_opensource',
    name: '做一个自己的开源库',
    description: '把平时反复写的那几段工具代码抽出来，做成能给别人用的东西',
    majors: ['computer'],
    // 得先有点硬实力才谈得上「做给别人用」
    requires: { type: 'stat', key: 'skill', op: '>=', value: 45 },
    requiredInvestments: 3,
    perInvest: [
      { type: 'stat', key: 'skill', delta: 3 },
      // 写文档、回 issue、处理别人的需求，比写代码本身更耗人
      { type: 'stat', key: 'mood', delta: -2 },
    ],
    onComplete: [
      { type: 'stat', key: 'skill', delta: 5 },
      { type: 'stat', key: 'mood', delta: 8 },
      { type: 'stat', key: 'social', delta: 2 },
      { type: 'log', text: '第一个不认识的开发者给你提了 issue —— 你的库真的有人在用了。' },
    ],
    progressFlag: '项目_开源库_进度',
    completionFlag: '项目_开源库_完成',
  },
  {
    id: 'proj_algorithm',
    name: '把那份算法题单啃完',
    description: '收藏夹里躺了半年的题单，这学期把它从头刷到尾',
    majors: ['computer'],
    requires: { type: 'stat', key: 'skill', op: '>=', value: 35 },
    requiredInvestments: 4,
    perInvest: [
      { type: 'stat', key: 'skill', delta: 2 },
      { type: 'stat', key: 'academic', delta: 1 },
      // 刷题是纯粹的消耗：越到后面越枯燥
      { type: 'stat', key: 'mood', delta: -2 },
    ],
    onComplete: [
      { type: 'stat', key: 'skill', delta: 6 },
      { type: 'stat', key: 'academic', delta: 3 },
      { type: 'log', text: '题单最后一题通过的那一刻，你在宿舍里喊了一声。' },
    ],
    progressFlag: '项目_算法题单_进度',
    completionFlag: '项目_算法题单_完成',
  },
]
