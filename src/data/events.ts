import type { GameEvent } from '../engine/types'

/**
 * 事件库。
 *
 * 加内容 = 往这个数组里加对象，完全不用改引擎代码。
 * 这就是「数据驱动」的意义，也是你们两个人能并行的原因：
 * 一个人写引擎，一个人写这个文件。
 *
 * 字段速查：
 *   weight      随机权重，默认 1，数字越大越常出现
 *   repeatable  默认 false，只触发一次
 *   requires    前置条件（联合条件用 all / any / not 嵌套）
 *   choices     有选项 → 等玩家选；没有 → 直接结算 effects
 */
export const EVENTS: GameEvent[] = [
  /* ---------------- 宿舍生活 ---------------- */
  {
    id: 'ev_roommate_late',
    title: '室友通宵打游戏',
    text: '已经凌晨两点，室友的键盘还在噼里啪啦。你明天早上八点有课。',
    category: 'random',
    weight: 3,
    repeatable: true,
    choices: [
      {
        label: '戴上耳塞硬睡',
        effects: [{ type: 'stat', key: 'mood', delta: -5 }],
      },
      {
        label: '提醒他小声一点',
        effects: [
          { type: 'stat', key: 'social', delta: 3 },
          { type: 'stat', key: 'mood', delta: 2 },
        ],
      },
      {
        label: '算了，一起玩',
        effects: [
          { type: 'stat', key: 'mood', delta: 8 },
          { type: 'stat', key: 'social', delta: 5 },
          { type: 'stat', key: 'health', delta: -6 },
          { type: 'stat', key: 'academic', delta: -3 },
        ],
      },
    ],
  },
  {
    id: 'ev_water_cut',
    title: '宿舍停水了',
    text: '物业通知：整栋楼停水到晚上十点。澡是洗不成了。',
    category: 'random',
    weight: 2,
    effects: [
      { type: 'stat', key: 'mood', delta: -4 },
      { type: 'stat', key: 'health', delta: -2 },
    ],
  },

  /* ---------------- 学业线 ---------------- */
  {
    id: 'ev_roll_call',
    title: '老师上课点名',
    text: '「下面我点一下名。」教室里瞬间安静，而你今天恰好坐在最后一排。',
    category: 'random',
    weight: 3,
    repeatable: true,
    choices: [
      {
        label: '大声答到',
        effects: [
          { type: 'stat', key: 'academic', delta: 2 },
          { type: 'stat', key: 'mood', delta: 1 },
        ],
      },
      {
        label: '让同学帮忙答到',
        effects: [
          { type: 'stat', key: 'social', delta: 2 },
          { type: 'stat', key: 'academic', delta: -2 },
          { type: 'setFlag', key: '替答到过', value: true },
        ],
      },
    ],
  },
  {
    id: 'ev_midterm',
    title: '期中考试周',
    text: '数据库和操作系统的期中考试挤在同一周。你翻开书，发现前面几章还是崭新的。',
    category: 'random',
    weight: 5,
    requires: {
      type: 'all',
      conditions: [
        { type: 'week', op: '>=', value: 7 },
        { type: 'week', op: '<=', value: 9 },
      ],
    },
    choices: [
      {
        label: '通宵刷往年题',
        effects: [
          { type: 'stat', key: 'academic', delta: 10 },
          { type: 'stat', key: 'health', delta: -10 },
          { type: 'stat', key: 'mood', delta: -5 },
        ],
      },
      {
        label: '正常复习，保住作息',
        effects: [{ type: 'stat', key: 'academic', delta: 4 }],
      },
      {
        label: '弃疗，考多少算多少',
        effects: [
          { type: 'stat', key: 'academic', delta: -6 },
          { type: 'stat', key: 'mood', delta: 3 },
        ],
      },
    ],
  },
  {
    id: 'ev_academic_warning',
    title: '学业预警通知',
    text: '辅导员把你叫到办公室：「你这学期几门课都在及格线附近，注意一下。」',
    category: 'random',
    weight: 6,
    requires: { type: 'stat', key: 'academic', op: '<', value: 45 },
    effects: [
      { type: 'stat', key: 'mood', delta: -8 },
      { type: 'setFlag', key: '被预警', value: true },
    ],
  },
  {
    id: 'ev_scholarship',
    title: '奖学金公示',
    text: '学院公示了奖学金名单。你的名字出现在上面。',
    category: 'random',
    weight: 3,
    requires: { type: 'stat', key: 'academic', op: '>=', value: 85 },
    effects: [
      { type: 'stat', key: 'money', delta: 2000 },
      { type: 'stat', key: 'mood', delta: 12 },
      { type: 'setFlag', key: '拿过奖学金', value: true },
      { type: 'log', text: '你拿到了 2000 元奖学金。' },
    ],
  },

  /* ---------------- 社团 / 社交线 ---------------- */
  {
    id: 'ev_club_recruit',
    title: '社团招新',
    text: '百团大战。街舞社、辩论队、ACM 集训队都在招人，摊位前围满了人。',
    category: 'random',
    weight: 8,
    requires: { type: 'week', op: '<=', value: 3 },
    choices: [
      {
        label: '加入 ACM 集训队',
        effects: [
          { type: 'stat', key: 'skill', delta: 8 },
          { type: 'stat', key: 'social', delta: 4 },
          { type: 'stat', key: 'mood', delta: -3 },
          { type: 'setFlag', key: '加入集训队', value: true },
        ],
      },
      {
        label: '加入街舞社',
        effects: [
          { type: 'stat', key: 'social', delta: 8 },
          { type: 'stat', key: 'health', delta: 4 },
          { type: 'stat', key: 'mood', delta: 5 },
          { type: 'setFlag', key: '加入街舞社', value: true },
        ],
      },
      {
        label: '都算了，回宿舍',
        effects: [{ type: 'stat', key: 'mood', delta: -2 }],
      },
    ],
  },
  {
    id: 'ev_crush',
    title: '心动的人',
    text: '你在图书馆注意到一个人，连续三天坐在同一个位置。今天他/她抬头看了你一眼。',
    category: 'random',
    weight: 4,
    requires: { type: 'stat', key: 'mood', op: '>=', value: 50 },
    choices: [
      {
        label: '写张纸条递过去',
        effects: [
          { type: 'stat', key: 'social', delta: 6 },
          // 概率结果用 branch 写：weight 5 对 weight 5 = 各 50%
          {
            type: 'branch',
            options: [
              {
                weight: 5,
                effects: [
                  { type: 'stat', key: 'mood', delta: 12 },
                  { type: 'setFlag', key: '纸条成功', value: true },
                  { type: 'log', text: '纸条递过去了，对方笑了一下，写下了一串号码。' },
                ],
              },
              {
                weight: 5,
                effects: [
                  { type: 'stat', key: 'mood', delta: -6 },
                  { type: 'log', text: '纸条递过去了，对方愣了一下，说了句「谢谢」就走了。' },
                ],
              },
            ],
          },
        ],
      },
      {
        label: '假装专心看自己的书',
        effects: [{ type: 'stat', key: 'academic', delta: 3 }],
      },
    ],
  },
  {
    id: 'ev_borrow_money',
    title: '室友找你借钱',
    text: '「兄弟，这周手头紧，能先借我五百吗？下周一定还。」',
    category: 'random',
    weight: 3,
    requires: { type: 'stat', key: 'money', op: '>=', value: 500 },
    choices: [
      {
        label: '直接借给他',
        effects: [
          { type: 'stat', key: 'money', delta: -500 },
          { type: 'stat', key: 'social', delta: 10 },
          { type: 'setFlag', key: '借出去过钱', value: true },
        ],
      },
      {
        label: '借三百，说自己也紧',
        effects: [
          { type: 'stat', key: 'money', delta: -300 },
          { type: 'stat', key: 'social', delta: 5 },
        ],
      },
      {
        label: '委婉拒绝',
        effects: [
          { type: 'stat', key: 'social', delta: -6 },
          { type: 'stat', key: 'mood', delta: -4 },
        ],
      },
    ],
  },

  /* ---------------- 技能 / 求职线 ---------------- */
  {
    id: 'ev_bug_allnight',
    title: '一个诡异的 Bug',
    text: '你的项目在本地跑得好好的，一部署就报错。你已经盯着这段代码三个小时了。',
    category: 'random',
    weight: 4,
    requires: { type: 'stat', key: 'skill', op: '>=', value: 45 },
    choices: [
      {
        label: '通宵查出根因',
        effects: [
          { type: 'stat', key: 'skill', delta: 8 },
          { type: 'stat', key: 'health', delta: -8 },
          { type: 'stat', key: 'mood', delta: -4 },
          { type: 'log', text: '凌晨四点，你终于定位到问题：环境变量没配。' },
        ],
      },
      {
        label: '先睡，明天再说',
        effects: [
          { type: 'stat', key: 'health', delta: 4 },
          { type: 'stat', key: 'skill', delta: 2 },
        ],
      },
    ],
  },
  {
    id: 'ev_internship',
    title: '实习面试机会',
    text: '学长内推你到一家公司面后端开发实习。HR 说这周内安排面试。',
    category: 'random',
    weight: 6,
    requires: {
      type: 'all',
      conditions: [
        { type: 'week', op: '>=', value: 10 },
        { type: 'stat', key: 'skill', op: '>=', value: 60 },
      ],
    },
    choices: [
      {
        label: '全力准备，刷八股和算法',
        effects: [
          { type: 'stat', key: 'skill', delta: 6 },
          { type: 'stat', key: 'mood', delta: -6 },
          // 60% 拿到 Offer 对 40% 挂掉，同样用 branch
          {
            type: 'branch',
            options: [
              {
                weight: 6,
                effects: [
                  { type: 'setFlag', key: '拿到实习Offer', value: true },
                  { type: 'stat', key: 'mood', delta: 15 },
                  { type: 'log', text: '面试通过，你拿到了实习 Offer！' },
                ],
              },
              {
                weight: 4,
                effects: [
                  { type: 'stat', key: 'mood', delta: -10 },
                  { type: 'log', text: '面试挂了，面试官说基础还需要补。' },
                ],
              },
            ],
          },
        ],
      },
      {
        label: '算了，先顾学业',
        effects: [{ type: 'stat', key: 'academic', delta: 4 }],
      },
    ],
  },

  /* ---------------- 健康 / 心情线（负反馈警告） ---------------- */
  {
    id: 'ev_body_warning',
    title: '身体发出警告',
    text: '你连续几天起床时头晕，爬四楼要歇一次。体检报告上几个箭头朝上。',
    category: 'random',
    weight: 8,
    requires: { type: 'stat', key: 'health', op: '<', value: 40 },
    effects: [
      { type: 'stat', key: 'mood', delta: -6 },
      { type: 'stat', key: 'health', delta: -4 },
      { type: 'setFlag', key: '身体预警', value: true },
    ],
  },
  {
    id: 'ev_sick',
    title: '重感冒',
    text: '半夜发烧到 38.5 度，室友陪你去校医院挂了水。',
    category: 'random',
    weight: 7,
    requires: { type: 'stat', key: 'health', op: '<', value: 35 },
    effects: [
      { type: 'stat', key: 'health', delta: -8 },
      { type: 'stat', key: 'money', delta: -300 },
      { type: 'stat', key: 'academic', delta: -5 },
    ],
  },
  {
    id: 'ev_counselor',
    title: '辅导员找你谈心',
    text: '「最近状态不太好吧？我看你上课总在发呆。有什么事可以说说。」',
    category: 'random',
    weight: 8,
    requires: { type: 'stat', key: 'mood', op: '<', value: 40 },
    effects: [
      { type: 'stat', key: 'mood', delta: 10 },
      { type: 'stat', key: 'social', delta: 3 },
      { type: 'setFlag', key: '谈过心', value: true },
    ],
  },

  /* ---------------- 杂项 / 气氛 ---------------- */
  {
    id: 'ev_campus_festival',
    title: '校园文化节',
    text: '操场搭起了舞台，各社团摆摊卖小吃，晚上还有露天电影。',
    category: 'random',
    weight: 4,
    requires: { type: 'week', op: '>=', value: 4 },
    choices: [
      {
        label: '逛一整天',
        effects: [
          { type: 'stat', key: 'mood', delta: 12 },
          { type: 'stat', key: 'social', delta: 6 },
          { type: 'stat', key: 'academic', delta: -3 },
        ],
      },
      {
        label: '只看晚上的电影',
        effects: [
          { type: 'stat', key: 'mood', delta: 5 },
          { type: 'stat', key: 'social', delta: 2 },
        ],
      },
      {
        label: '在宿舍写代码',
        effects: [
          { type: 'stat', key: 'skill', delta: 5 },
          { type: 'stat', key: 'mood', delta: -3 },
        ],
      },
    ],
  },
  {
    id: 'ev_laptop_broken',
    title: '电脑主板烧了',
    text: '一早开机黑屏，维修店说主板烧了，换一块要一千二。',
    category: 'random',
    weight: 3,
    repeatable: true,
    choices: [
      {
        label: '咬牙换了',
        requires: { type: 'stat', key: 'money', op: '>=', value: 1200 },
        effects: [
          { type: 'stat', key: 'money', delta: -1200 },
          { type: 'stat', key: 'mood', delta: -5 },
        ],
      },
      {
        label: '先借用实验室的机器',
        effects: [
          { type: 'stat', key: 'mood', delta: -8 },
          { type: 'stat', key: 'skill', delta: -3 },
          { type: 'setFlag', key: '电脑坏了', value: true },
        ],
      },
    ],
  },
  {
    id: 'ev_library_seat',
    title: '图书馆抢座',
    text: '早上七点，图书馆门口已经排了长队。期末临近，座位就是稀缺资源。',
    category: 'random',
    weight: 3,
    repeatable: true,
    requires: { type: 'week', op: '>=', value: 12 },
    choices: [
      {
        label: '六点半起来排队',
        effects: [
          { type: 'stat', key: 'academic', delta: 7 },
          { type: 'stat', key: 'health', delta: -4 },
        ],
      },
      {
        label: '睡到自然醒',
        effects: [{ type: 'stat', key: 'health', delta: 3 }],
      },
    ],
  },
]
