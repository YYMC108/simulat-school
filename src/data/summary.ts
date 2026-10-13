import type { SummaryContent } from '../engine/types'

/**
 * 结算回顾：把「你这 16 周做了什么」翻译成叙述。
 *
 * ── 为什么要这个东西 ──
 * 一局 48 次行动、62 个事件，最后只丢一个结局标题过去，
 * 玩家记不住这局发生过什么。数字要能变成故事，一局才有「记忆点」。
 *
 * ── 规则怎么写 ──
 * 每条规则 = 「条件满足 → 产出一句话」。条件用的是**同一套条件 DSL**，
 * 所以 `flag`（做过某事）、`seenEvent`（遇到过某个事件）、`stat`（最终属性）
 * 三种都能用，不需要另学一套语法。
 *
 * ── 三条纪律 ──
 * 1. **一件事只写一条规则**。比如「拿到实习 Offer」由 flag 触发，
 *    就不要再对 `ev_internship` 写一条 seenEvent 规则 —— 否则同一件事说两遍。
 * 2. **不要用 `chance`**。回顾必须是确定的：同一局结算两次要给出同样的话。
 * 3. `order` 决定叙述顺序：10–79 是「具体做过什么」（按社团→学业→技能→人际→
 *    情感→健康→经济→前途→挫折 排），80+ 是「总体状态」（属性阈值），
 *    形成「先讲事、后总结」的阅读节奏。
 */
export const SUMMARY: SummaryContent = {
  identity: '计算机专业大三学生',

  rules: [
    /* ---------------- 社团 ---------------- */
    {
      requires: { type: 'flag', key: '加入集训队' },
      kind: 'club',
      order: 10,
      text: '加入了 ACM 集训队，把自己泡在算法题里',
    },
    {
      requires: { type: 'flag', key: '加入街舞社' },
      kind: 'club',
      order: 12,
      text: '加入了街舞社，在排练厅里度过了不少晚上',
    },
    {
      // 加入 + 参加过至少一次社团大事件，才算「做到了骨干」
      requires: { type: 'flagEq', key: '社团贡献', value: 2 },
      kind: 'club',
      order: 14,
      text: '在社团里从新人做到了骨干',
    },

    /* ---------------- 学业 ---------------- */
    {
      requires: { type: 'flag', key: '拿过奖学金' },
      kind: 'academic',
      order: 20,
      text: '名字上过学院的奖学金公示',
    },
    {
      requires: { type: 'seenEvent', id: 'ev_midterm' },
      kind: 'academic',
      order: 22,
      text: '熬过了数据库和操作系统挤在同一周的期中',
    },
    {
      requires: { type: 'flag', key: '替答到过' },
      kind: 'academic',
      order: 24,
      text: '让人替你答过一次到（后来被老师记住了）',
    },

    /* ---------------- 技能 / 作品 ---------------- */
    {
      requires: { type: 'seenEvent', id: 'ev_oss' },
      kind: 'skill',
      order: 30,
      text: '给开源项目提的补丁被合并了',
    },
    {
      requires: { type: 'seenEvent', id: 'ev_hackathon' },
      kind: 'skill',
      order: 32,
      text: '在 48 小时黑客松里熬了一整个通宵',
    },
    {
      requires: { type: 'seenEvent', id: 'ev_lab_join' },
      kind: 'skill',
      order: 34,
      text: '进了实验室跟着导师做科研训练',
    },
    {
      requires: { type: 'flag', key: '电脑坏了' },
      kind: 'skill',
      order: 36,
      text: '电脑中途坏过，有一阵子只能蹭实验室的机器',
    },

    /* ---------------- 人际 / 情感 ---------------- */
    {
      requires: { type: 'flag', key: '纸条成功' },
      kind: 'love',
      order: 50,
      text: '给心动的人递了纸条，而且成了',
    },
    {
      requires: { type: 'flag', key: '谈过心' },
      kind: 'social',
      order: 52,
      text: '和辅导员坐下来聊过一次',
    },

    /* ---------------- 健康 ---------------- */
    {
      requires: { type: 'seenEvent', id: 'ev_pe_test' },
      kind: 'health',
      order: 60,
      text: '跑完了一千米体测',
    },
    {
      requires: { type: 'flag', key: '身体预警' },
      kind: 'health',
      order: 62,
      text: '身体发过一次警告，逼你正视作息',
    },

    /* ---------------- 经济 ---------------- */
    {
      requires: { type: 'flag', key: '借出去过钱' },
      kind: 'money',
      order: 70,
      text: '借给室友一笔钱',
    },
    {
      requires: { type: 'seenEvent', id: 'ev_double11' },
      kind: 'money',
      order: 72,
      text: '在双十一的零点犹豫过要不要下单',
    },
    {
      requires: { type: 'flagAtLeast', key: '穷困周数', value: 1 },
      kind: 'money',
      order: 74,
      countFrom: '穷困周数',
      text: '有 {n} 周钱包见了底，食堂只敢点最便宜的窗口',
    },

    /* ---------------- 前途 ---------------- */
    {
      requires: { type: 'flag', key: '拿到实习Offer' },
      kind: 'career',
      order: 40,
      text: '拿到了一家公司的实习 Offer',
    },
    {
      requires: { type: 'flagAtLeast', key: '投递次数', value: 1 },
      kind: 'career',
      order: 42,
      countFrom: '投递次数',
      text: '投出去了 {n} 份简历',
    },
    {
      requires: { type: 'seenEvent', id: 'ev_kaoyan_choice' },
      kind: 'career',
      order: 44,
      text: '认真想过考研还是直接工作',
    },

    /* ---------------- 挫折 ---------------- */
    {
      requires: { type: 'flag', key: '被预警' },
      kind: 'setback',
      order: 46,
      text: '收到过一封学业预警通知',
    },

    /* ---------------- 总体状态（属性阈值，排在最后当总结）---------------- */
    {
      requires: { type: 'stat', key: 'academic', op: '>=', value: 85 },
      kind: 'academic',
      order: 80,
      text: '成绩一直稳稳排在前面',
    },
    {
      requires: { type: 'stat', key: 'academic', op: '<=', value: 40 },
      kind: 'academic',
      order: 81,
      text: '好几门课都在及格线附近挣扎',
    },
    {
      requires: { type: 'stat', key: 'skill', op: '>=', value: 85 },
      kind: 'skill',
      order: 82,
      text: '技术上的长进肉眼可见',
    },
    {
      requires: { type: 'stat', key: 'social', op: '>=', value: 85 },
      kind: 'social',
      order: 83,
      text: '认识的人比同届大多数人都多',
    },
    {
      requires: { type: 'stat', key: 'social', op: '<=', value: 30 },
      kind: 'social',
      order: 84,
      text: '大部分时间都是一个人过的',
    },
    {
      requires: { type: 'stat', key: 'health', op: '>=', value: 85 },
      kind: 'health',
      order: 85,
      text: '作息和体能都保持得不错',
    },
    {
      requires: { type: 'stat', key: 'health', op: '<=', value: 35 },
      kind: 'health',
      order: 86,
      text: '身体被透支得厉害',
    },
    {
      requires: { type: 'stat', key: 'mood', op: '>=', value: 80 },
      kind: 'notable',
      order: 87,
      text: '整体上过得挺开心',
    },
    {
      requires: { type: 'stat', key: 'mood', op: '<=', value: 35 },
      kind: 'notable',
      order: 88,
      text: '有很长一段时间心情都很低落',
    },
    {
      requires: { type: 'stat', key: 'money', op: '>=', value: 3000 },
      kind: 'money',
      order: 89,
      text: '学期末手里还攒下了一笔钱',
    },
  ],

  /**
   * 一句话总评，由**归一化后**最高的属性决定。
   *
   * 归一化 = 值 / 该项上限。这一步不能省：金钱上限是 999999、
   * 其余是 100，直接比大小的话金钱永远是第一，总评就废了。
   *
   * 副作用正好合乎意图：钱多不构成「你是什么样的人」，
   * 所以 `money` 的总评实际上不会被选中，留着只是为了让类型完整。
   */
  verdicts: {
    academic: '这一学期，你把大部分时间给了课本。',
    skill: '这一学期，你手上多了些真本事。',
    social: '这一学期，你最大的收获是人。',
    health: '这一学期，你把身体照顾得不错。',
    mood: '这一学期，你过得挺舒心。',
    money: '这一学期，你一直在跟钱打交道。',
  },
}
