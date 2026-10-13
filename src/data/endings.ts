import type { Ending } from '../engine/types'

/**
 * 结局表。
 *
 * 引擎按 priority 从小到大依次判定，命中第一个就定结局。
 * 所以「坏结局」优先级要小（先判），「普通结局」放最后兜底。
 *
 * 两条重要的设计原则：
 *   1. 一个坏结局只对应一个核心失败维度（学业 / 身体 / 心情）。
 *      如果两个坏结局都去判 mood，高优先级的那个会把低优先级的「饿死」，
 *      导致后者永远触发不到 —— 这个坑是靠 simulate 跑几千局才发现的。
 *   2. 最后一条的 requires 是 { type: 'all', conditions: [] }，空 all 恒为真，
 *      保证任何情况下都有结局，游戏不会卡死。这是典型的兜底分支设计。
 */
export const ENDINGS: Ending[] = [
  {
    id: 'ending_dropout',
    title: '学业崩塌',
    text: '期末成绩单下来，三门不及格。教务处的通知写着「建议退学」。你在宿舍坐了一整夜。',
    priority: 10,
    // 只看学业，不再顺手判 mood —— 心情崩了应该走「情绪崩溃」那条线
    requires: { type: 'stat', key: 'academic', op: '<', value: 25 },
  },
  {
    id: 'ending_sick_leave',
    title: '住院休学',
    text: '你在期末周倒下了。医生说是长期熬夜和营养不良导致的，需要休学一学期。',
    priority: 20,
    requires: { type: 'stat', key: 'health', op: '<', value: 15 },
  },
  {
    id: 'ending_depressed',
    title: '情绪崩溃',
    text: '你开始整夜睡不着，也不想见任何人。学工办帮你办了一学期的休学手续。',
    priority: 30,
    requires: { type: 'stat', key: 'mood', op: '<', value: 15 },
  },
  {
    id: 'ending_poverty',
    title: '为钱所困',
    text: '这一学期你几乎全在打工。期末成绩勉强过关，但你清楚自己什么都没学到。',
    priority: 40,
    requires: {
      type: 'all',
      conditions: [
        { type: 'flagAtLeast', key: '穷困周数', value: 4 },
        { type: 'stat', key: 'skill', op: '<', value: 55 },
      ],
    },
  },
  {
    id: 'ending_bigtech',
    title: '拿到大厂 Offer',
    text: '寒假前，你收到了大厂的实习转正意向书。回头看，那些通宵调 bug 的夜晚都值了。',
    priority: 50,
    // 计算机专属：这条路线靠的是「技能 + 实习 Offer」，且叙事本身绑定技术岗
    majors: ['computer'],
    requires: {
      type: 'all',
      conditions: [
        { type: 'flag', key: '拿到实习Offer' },
        { type: 'stat', key: 'skill', op: '>=', value: 75 },
      ],
    },
  },
  {
    id: 'ending_scholar',
    title: '保研上岸',
    text: '绩点排名专业前 5%，你拿到了推免资格。实验室的师兄说：「欢迎加入。」',
    priority: 60,
    requires: {
      type: 'all',
      conditions: [
        { type: 'stat', key: 'academic', op: '>=', value: 85 },
        { type: 'flag', key: '拿过奖学金' },
      ],
    },
  },
  {
    id: 'ending_geek',
    title: '技术宅的胜利',
    text: '你没怎么管成绩，但你的开源项目在 GitHub 上拿了 500 星，还收到了几个面试邀请。',
    priority: 70,
    majors: ['computer'],
    // social 阈值放宽到 60：宿舍生活和随机事件会持续往上推社交，
    // 原来的 50 在实际模拟里几乎达不到（社团招新、聚餐、谈心动不动就 +6~+10）
    //
    // 条件写成 any 的**两条路**：纯靠技能硬顶，或者真的把开源项目做出来了。
    // 第二条路严格更宽松（技能门槛 80 → 65），所以不会让这个结局变得更难拿；
    // 而它对「经典风格」是惰性的 —— 那些风格不投项目，完成 flag 永远为假。
    requires: {
      type: 'any',
      conditions: [
        {
          type: 'all',
          conditions: [
            { type: 'stat', key: 'skill', op: '>=', value: 80 },
            { type: 'stat', key: 'social', op: '<', value: 60 },
          ],
        },
        {
          type: 'all',
          conditions: [
            { type: 'flag', key: '项目_开源库_完成' },
            { type: 'stat', key: 'skill', op: '>=', value: 65 },
            { type: 'stat', key: 'social', op: '<', value: 60 },
          ],
        },
      ],
    },
  },
  {
    id: 'ending_social_star',
    title: '社交达人',
    text: '你成了系里的「人脉中心」。虽然成绩平平，但走到哪里都有人跟你打招呼。',
    priority: 80,
    requires: {
      type: 'all',
      conditions: [
        { type: 'stat', key: 'social', op: '>=', value: 85 },
        { type: 'stat', key: 'academic', op: '<', value: 70 },
      ],
    },
  },
  {
    id: 'ending_balanced',
    title: '全面发展',
    text: '学业过得去，身体没垮，朋友不少，还攒下了点钱。这大概就是最理想的大学生活。',
    priority: 90,
    requires: {
      type: 'all',
      conditions: [
        { type: 'stat', key: 'academic', op: '>=', value: 70 },
        { type: 'stat', key: 'health', op: '>=', value: 70 },
        { type: 'stat', key: 'social', op: '>=', value: 65 },
        { type: 'stat', key: 'mood', op: '>=', value: 60 },
      ],
    },
  },
  {
    id: 'ending_ordinary',
    title: '平凡的期末',
    text: '没有惊喜也没有意外。你拖着行李箱回家，觉得这学期好像过得很快。',
    priority: 999,
    // 空 all = 恒真，兜底保证一定有结局
    requires: { type: 'all', conditions: [] },
  },
]
