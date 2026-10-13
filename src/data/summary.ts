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
  // 「你是谁」不在这里 —— 它是专业决定的（见 data/majors.ts）。
  // 放在这里就会出现「换了专业、结算页还写着旧身份」的二源问题。
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
      // 这句话点名了「数据库和操作系统」，是计算机专业的课表
      majors: ['computer'],
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
      majors: ['computer'],
      text: '给开源项目提的补丁被合并了',
    },
    {
      requires: { type: 'seenEvent', id: 'ev_hackathon' },
      kind: 'skill',
      order: 32,
      majors: ['computer'],
      text: '在 48 小时黑客松里熬了一整个通宵',
    },
    {
      // 花钱换技能的那条线（见 events.ts 的「花钱换东西」一段）
      requires: { type: 'flag', key: '报过班' },
      kind: 'skill',
      order: 33,
      text: '自己掏钱报了个班，把一直想学的东西系统过了一遍',
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

    /* ---------------- 项目 / 作品（这学期造出来的东西） ---------------- */
    {
      requires: { type: 'flag', key: '项目_开源库_完成' },
      kind: 'skill',
      order: 38,
      // 必须标专业：这两个 flag 由计算机的项目产出，
      // 忘了标就会让文科「读一个自己永远写不出来的 flag」——
      // 静态死 flag 审计会立刻抓出来（确实抓出来了）
      majors: ['computer'],
      text: '自己写的小库被陌生的开发者用起来了',
    },
    {
      requires: { type: 'flag', key: '项目_算法题单_完成' },
      kind: 'skill',
      order: 39,
      countFrom: '项目_算法题单_进度',
      majors: ['computer'],
      text: '把那份躺了半年的题单啃完了，一共 {n} 次投入',
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
    {
      // 花钱换健康的那条线（见 events.ts 的「花钱换东西」一段）
      requires: { type: 'flag', key: '办了健身卡' },
      kind: 'health',
      order: 64,
      text: '办了张健身卡，虽然没做到天天去，但确实练出了点底子',
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
      // 「技术」是计算机的说法；文科的同位规则在 literature 包里另写
      majors: ['computer'],
      text: '技术上的长进肉眼可见',
    },
    {
      requires: { type: 'stat', key: 'social', op: '>=', value: 85 },
      kind: 'social',
      order: 83,
      text: '认识的人比同届大多数人都多',
    },
    {
      requires: { type: 'stat', key: 'social', op: '<=', value: 35 },
      kind: 'social',
      order: 84,
      /**
       * 阈值从 30 抬到 35（阶段 2.6）。这不是为了让检查变绿，而是因为 30 本来就卡在
       * **实际地板上**：社交从 50 起、每周 −1，什么都不做也会停在 ~34；
       * 也就是说 ≤30 需要额外的社交损失才能碰到，历史上只靠 **2800 局里漏出 1 局**
       * 通过（计算机），文科则是 0 局 —— 一条「偶尔靠运气可达」的规则不是可达。
       *
       * 新增「约同学打球」这类不花钱的社交之后，地板抬到 31，那唯一一局也没了。
       * 抬到 35 后两个专业各有 16–20 局命中（实测 400 局 × 7 风格），
       * 而且语义没变：社交只有 35 = 这个学期基本没跟人来往。
       */
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
