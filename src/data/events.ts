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
    weight: 1,
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
    weight: 1,
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
    weight: 1,
    repeatable: true,
    // 可重复事件要限窗口：否则 16 周都待在池子里，累计出现率太高（实测 54%），
    // 成为跨局重复感的主要来源。点名集中在上半学期，期末周没人在意点名了。
    requires: { type: 'week', op: '<=', value: 11 },
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
    weight: 3,
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
    weight: 4,
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
    weight: 4,
    requires: { type: 'week', op: '<=', value: 3 },
    choices: [
      {
        label: '加入 ACM 集训队',
        effects: [
          { type: 'stat', key: 'skill', delta: 8 },
          { type: 'stat', key: 'social', delta: 4 },
          { type: 'stat', key: 'mood', delta: -3 },
          { type: 'setFlag', key: '加入集训队', value: true },
          { type: 'addFlag', key: '社团贡献', delta: 1 },
        ],
      },
      {
        label: '加入街舞社',
        effects: [
          { type: 'stat', key: 'social', delta: 8 },
          { type: 'stat', key: 'health', delta: 4 },
          { type: 'stat', key: 'mood', delta: 5 },
          { type: 'setFlag', key: '加入街舞社', value: true },
          { type: 'addFlag', key: '社团贡献', delta: 1 },
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
    weight: 1,
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
    weight: 1,
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
    weight: 2,
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
    weight: 3,
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
    weight: 6,
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
    weight: 6,
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
    weight: 6,
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
    weight: 1,
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
    weight: 1,
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
    weight: 1,
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

  /* ════════════════ 阶段 1 新增：开学（1–4 周）════════════════ */

  {
    id: 'ev_opening_ceremony',
    title: '开学典礼',
    text: '礼堂里坐了三个年级的人，台上校长念着万年不变的稿子。你旁边的人已经开始打盹。',
    category: 'random',
    weight: 3,
    requires: { type: 'week', op: '<=', value: 2 },
    effects: [
      { type: 'stat', key: 'social', delta: 3 },
      { type: 'stat', key: 'mood', delta: 2 },
    ],
  },
  {
    id: 'ev_textbook',
    title: '教材好贵',
    text: '课表出来了，教材清单列了八百块。二手群里有人甩卖，但要抢。',
    category: 'random',
    weight: 2,
    requires: { type: 'week', op: '<=', value: 3 },
    choices: [
      {
        label: '买新的，省心',
        effects: [{ type: 'stat', key: 'money', delta: -300 }],
      },
      {
        label: '蹲二手群',
        effects: [
          { type: 'stat', key: 'money', delta: -100 },
          { type: 'stat', key: 'mood', delta: 3 },
        ],
      },
    ],
  },
  {
    id: 'ev_dorm_bonding',
    title: '室友第一次聚餐',
    text: '开学两周，四个人的名字终于对上了号。有人提议今晚出去搓一顿。',
    category: 'random',
    weight: 2,
    requires: { type: 'week', op: '<=', value: 4 },
    choices: [
      {
        label: '去！',
        effects: [
          { type: 'stat', key: 'money', delta: -80 },
          { type: 'stat', key: 'social', delta: 6 },
          { type: 'stat', key: 'mood', delta: 5 },
        ],
      },
      {
        label: '想省钱，不去了',
        effects: [
          { type: 'stat', key: 'social', delta: -4 },
          { type: 'stat', key: 'mood', delta: -3 },
        ],
      },
    ],
  },

  /* ════════════════ 适应（4–8 周）════════════════ */

  {
    id: 'ev_lab_join',
    title: '实验室进组',
    text: '导师在群里发：「招本科生做科研训练，有意私聊。」你有点心动。',
    category: 'random',
    weight: 2,
    requires: {
      type: 'all',
      conditions: [
        { type: 'week', op: '>=', value: 5 },
        { type: 'week', op: '<=', value: 8 },
        { type: 'stat', key: 'skill', op: '>=', value: 40 },
      ],
    },
    choices: [
      {
        label: '申请进组',
        effects: [
          { type: 'stat', key: 'skill', delta: 6 },
          { type: 'stat', key: 'mood', delta: -4 },
        ],
      },
      {
        label: '这学期太忙，算了',
        effects: [{ type: 'stat', key: 'mood', delta: 2 }],
      },
    ],
  },
  {
    id: 'ev_dorm_conflict',
    title: '宿舍矛盾',
    text: '卫生值日表又没人执行，公共区域堆了三天的外卖盒。气氛有点僵。',
    category: 'random',
    weight: 1,
    repeatable: true,
    requires: { type: 'week', op: '>=', value: 4 },
    choices: [
      {
        label: '主动收拾，缓和气氛',
        effects: [
          { type: 'stat', key: 'social', delta: 4 },
          { type: 'stat', key: 'mood', delta: 2 },
        ],
      },
      {
        label: '在群里发一段话',
        effects: [
          { type: 'stat', key: 'social', delta: 2 },
          { type: 'stat', key: 'mood', delta: -3 },
        ],
      },
      {
        label: '装没看见',
        effects: [
          { type: 'stat', key: 'mood', delta: -2 },
          { type: 'stat', key: 'health', delta: -2 },
        ],
      },
    ],
  },
  {
    id: 'ev_lonely_weekend',
    title: '没社团的周末',
    text: '周六下午，宿舍只剩你一个。朋友圈里同学晒着社团活动，你刷着手机。',
    category: 'random',
    weight: 1,
    requires: {
      // 用 not + any：既没加入集训队、也没加入街舞社的人才会遇到
      type: 'not',
      condition: {
        type: 'any',
        conditions: [
          { type: 'flag', key: '加入集训队' },
          { type: 'flag', key: '加入街舞社' },
        ],
      },
    },
    effects: [
      { type: 'stat', key: 'mood', delta: -4 },
      { type: 'stat', key: 'skill', delta: 1 },
    ],
  },
  {
    id: 'ev_burnout',
    title: '感觉被掏空',
    text: '你已经连续很久没有好好休息过了，注意力涣散，做什么都提不起劲。',
    category: 'random',
    weight: 3,
    requires: {
      // 用 any：健康或心情任一掉到危险区就触发
      type: 'any',
      conditions: [
        { type: 'stat', key: 'health', op: '<', value: 40 },
        { type: 'stat', key: 'mood', op: '<', value: 40 },
      ],
    },
    choices: [
      {
        label: '停下来好好休息',
        effects: [
          { type: 'stat', key: 'health', delta: 6 },
          { type: 'stat', key: 'mood', delta: 5 },
          { type: 'stat', key: 'academic', delta: -3 },
        ],
      },
      {
        label: '硬扛着继续',
        effects: [
          { type: 'stat', key: 'academic', delta: 3 },
          { type: 'stat', key: 'health', delta: -6 },
        ],
      },
    ],
  },

  /* ════════════════ 期中 / 转折（7–12 周）════════════════ */

  {
    id: 'ev_midterm_score',
    title: '期中成绩下来了',
    text: '成绩单发到群里，你的几门课都在及格线附近。舍友递过来一个安慰的眼神。',
    category: 'random',
    weight: 3,
    requires: {
      type: 'all',
      conditions: [
        { type: 'week', op: '>=', value: 8 },
        { type: 'week', op: '<=', value: 10 },
        { type: 'stat', key: 'academic', op: '<', value: 60 },
      ],
    },
    effects: [
      { type: 'stat', key: 'mood', delta: -6 },
      { type: 'stat', key: 'academic', delta: 2 },
    ],
  },
  {
    id: 'ev_kaoyan_choice',
    title: '考研还是工作',
    text: '大三下，周围人开始站队：考研的买起了资料，找工作的刷起了题。你被问得最多的是「你什么打算」。',
    category: 'random',
    weight: 3,
    requires: {
      type: 'all',
      conditions: [
        { type: 'week', op: '>=', value: 10 },
        { type: 'week', op: '<=', value: 12 },
      ],
    },
    choices: [
      {
        label: '决定考研',
        effects: [
          { type: 'stat', key: 'academic', delta: 6 },
          { type: 'stat', key: 'social', delta: -2 },
        ],
      },
      {
        label: '决定找工作',
        effects: [
          { type: 'stat', key: 'skill', delta: 6 },
          { type: 'stat', key: 'money', delta: 200 },
        ],
      },
      {
        label: '先观望',
        effects: [{ type: 'stat', key: 'mood', delta: -3 }],
      },
    ],
  },
  {
    id: 'ev_double11',
    title: '双十一',
    text: '凌晨零点，购物车里的键盘和羽绒服都在打折，室友也都没睡。',
    category: 'random',
    weight: 2,
    requires: {
      type: 'all',
      conditions: [
        { type: 'week', op: '>=', value: 10 },
        { type: 'week', op: '<=', value: 12 },
      ],
    },
    choices: [
      {
        label: '理性，只买需要的',
        effects: [{ type: 'stat', key: 'money', delta: -200 }],
      },
      {
        label: '蹲零点秒杀',
        effects: [
          { type: 'stat', key: 'mood', delta: -4 },
          { type: 'stat', key: 'money', delta: -300 },
          {
            type: 'if',
            // 用 chance：40% 概率抢到特价回血
            requires: { type: 'chance', probability: 0.4 },
            effects: [{ type: 'stat', key: 'money', delta: 500 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev_loan_temptation',
    title: '校园贷的诱惑',
    text: '手机弹出一条广告：「学生专属，秒到账」。你的生活费已经见底。',
    category: 'random',
    weight: 2,
    requires: {
      type: 'all',
      conditions: [
        { type: 'week', op: '>=', value: 10 },
        { type: 'stat', key: 'money', op: '<', value: 500 },
      ],
    },
    choices: [
      {
        label: '不碰，跟家里开口',
        effects: [
          { type: 'stat', key: 'money', delta: 500 },
          { type: 'stat', key: 'mood', delta: -4 },
        ],
      },
      {
        label: '借一笔应急',
        effects: [
          { type: 'stat', key: 'money', delta: 800 },
          { type: 'stat', key: 'mood', delta: -10 },
          { type: 'stat', key: 'health', delta: -3 },
        ],
      },
    ],
  },
  {
    id: 'ev_oss',
    title: '开源 PR 被合并了',
    text: '你给一个开源项目修了个小 bug，今天收到了 maintainer 的 merge 通知。',
    category: 'random',
    weight: 2,
    requires: { type: 'stat', key: 'skill', op: '>=', value: 50 },
    effects: [
      { type: 'stat', key: 'skill', delta: 8 },
      { type: 'stat', key: 'mood', delta: 10 },
    ],
  },
  {
    id: 'ev_hackathon',
    title: '48 小时黑客松',
    text: '校园黑客松报名开始了，主题是「帮大学生解决一个痛点」。你的队友已经在摇人了。',
    category: 'random',
    weight: 2,
    requires: {
      type: 'all',
      conditions: [
        { type: 'week', op: '>=', value: 5 },
        { type: 'week', op: '<=', value: 12 },
        { type: 'stat', key: 'skill', op: '>=', value: 45 },
      ],
    },
    choices: [
      {
        label: '组队冲一把',
        effects: [
          { type: 'stat', key: 'skill', delta: 8 },
          { type: 'stat', key: 'health', delta: -8 },
          { type: 'stat', key: 'mood', delta: 4 },
        ],
      },
      {
        label: '围观就好',
        effects: [{ type: 'stat', key: 'mood', delta: -2 }],
      },
    ],
  },
  {
    id: 'ev_asked_by_classmate',
    title: '被同学请教',
    text: '同学拍你的肩膀：「听说你写代码很厉害，这个报错帮我看看？」',
    category: 'random',
    weight: 2,
    requires: { type: 'stat', key: 'skill', op: '>=', value: 55 },
    effects: [
      { type: 'stat', key: 'social', delta: 4 },
      { type: 'stat', key: 'skill', delta: 2 },
    ],
  },

  /* ════════════════ 期末（13–16 周）════════════════ */

  {
    id: 'ev_final_cram',
    title: '期末通宵突击',
    text: '离最后一门考试还有 36 小时，你面前是整整一学期的课件。',
    category: 'random',
    weight: 1,
    repeatable: true,
    requires: { type: 'week', op: '>=', value: 13 },
    choices: [
      {
        label: '通宵刷题',
        effects: [
          { type: 'stat', key: 'academic', delta: 8 },
          { type: 'stat', key: 'health', delta: -8 },
          { type: 'stat', key: 'mood', delta: -4 },
        ],
      },
      {
        label: '按时睡觉，白天高效复习',
        effects: [
          { type: 'stat', key: 'academic', delta: 4 },
          { type: 'stat', key: 'health', delta: 1 },
        ],
      },
    ],
  },
  {
    id: 'ev_pe_test',
    title: '体测',
    text: '一年一度的体测来了：一千米、立定跳远、引体向上。体育老师吹响了哨子。',
    category: 'random',
    weight: 3,
    requires: {
      type: 'all',
      conditions: [
        { type: 'week', op: '>=', value: 13 },
        { type: 'week', op: '<=', value: 14 },
      ],
    },
    choices: [
      {
        label: '认真跑',
        effects: [
          { type: 'stat', key: 'health', delta: 6 },
          { type: 'stat', key: 'mood', delta: 3 },
          { type: 'stat', key: 'academic', delta: -2 },
        ],
      },
      {
        label: '能混就混',
        effects: [
          { type: 'stat', key: 'health', delta: 2 },
          { type: 'stat', key: 'mood', delta: -2 },
        ],
      },
    ],
  },
  {
    id: 'ev_ticket_home',
    title: '抢回家的票',
    text: '寒假临近，回家的车票开售。你盯着 12306 的倒计时，手指悬在按钮上。',
    category: 'random',
    weight: 3,
    requires: { type: 'week', op: '>=', value: 14 },
    choices: [
      {
        label: '候补抢票',
        effects: [
          { type: 'stat', key: 'money', delta: -400 },
          { type: 'stat', key: 'mood', delta: 5 },
        ],
      },
      {
        label: '买硬座，能省则省',
        effects: [
          { type: 'stat', key: 'money', delta: -150 },
          { type: 'stat', key: 'health', delta: -4 },
        ],
      },
    ],
  },
  {
    id: 'ev_cheating_caught',
    title: '考试作弊的诱惑',
    text: '期末最后一门课，你复习得很糟。邻座同学的卷子就在你的余光里。',
    category: 'random',
    weight: 3,
    requires: {
      type: 'all',
      conditions: [
        { type: 'week', op: '>=', value: 14 },
        { type: 'stat', key: 'academic', op: '<', value: 45 },
      ],
    },
    choices: [
      {
        label: '还是老实写，能写多少算多少',
        effects: [{ type: 'stat', key: 'academic', delta: 2 }],
      },
      {
        label: '冒险偷看',
        effects: [
          {
            type: 'branch',
            options: [
              {
                weight: 7,
                effects: [
                  { type: 'stat', key: 'academic', delta: 10 },
                  { type: 'stat', key: 'mood', delta: -6 },
                ],
              },
              {
                weight: 3,
                // 用 end：被抓住 = 半途强制结局，而不是等第 16 周
                effects: [
                  { type: 'log', text: '监考老师走了过来，收走了你的试卷。你因为考试作弊被处分，这学期到此为止。' },
                  { type: 'end', endingId: 'ending_dropout' },
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  /* ════════════════ flag 暗线（读取此前只写不读的 flag）════════════════ */

  {
    id: 'ev_training_team',
    title: '集训队选拔',
    text: 'ACM 集训队通知：新人选拔赛定在这周六，四道题，三个小时。',
    category: 'random',
    weight: 3,
    requires: {
      type: 'all',
      conditions: [
        { type: 'flag', key: '加入集训队' },
        { type: 'week', op: '>=', value: 4 },
      ],
    },
    effects: [
      { type: 'stat', key: 'skill', delta: 6 },
      { type: 'stat', key: 'mood', delta: 3 },
      { type: 'addFlag', key: '社团贡献', delta: 1 },
      { type: 'log', text: '你通过了选拔，成了集训队的正式队员。' },
    ],
  },
  {
    id: 'ev_dance_performance',
    title: '街舞社演出',
    text: '社团一年一度的专场演出在即，你被排进了开场舞。',
    category: 'random',
    weight: 3,
    requires: {
      type: 'all',
      conditions: [
        { type: 'flag', key: '加入街舞社' },
        { type: 'week', op: '>=', value: 5 },
      ],
    },
    effects: [
      { type: 'stat', key: 'social', delta: 8 },
      { type: 'stat', key: 'mood', delta: 6 },
      { type: 'addFlag', key: '社团贡献', delta: 1 },
      { type: 'log', text: '演出顺利，你在台上没忘动作。' },
    ],
  },
  {
    id: 'ev_teacher_remembers',
    title: '老师记住了你',
    text: '上次让别人替你答到的事，老师其实看出来了。这次上课，他点名让你回答一个问题。',
    category: 'random',
    weight: 2,
    requires: { type: 'flag', key: '替答到过' },
    effects: [
      { type: 'stat', key: 'academic', delta: -4 },
      { type: 'stat', key: 'mood', delta: -4 },
      { type: 'log', text: '你支支吾吾答不上来。老师叹了口气，什么都没说。' },
    ],
  },
  {
    id: 'ev_first_date',
    title: '第一次约会',
    text: '那张纸条上的号码你存了三天，终于鼓起勇气发了消息。对方答应了。',
    category: 'random',
    weight: 2,
    requires: { type: 'flag', key: '纸条成功' },
    effects: [
      { type: 'stat', key: 'mood', delta: 15 },
      { type: 'stat', key: 'social', delta: 8 },
      { type: 'stat', key: 'money', delta: -120 },
      { type: 'log', text: '你们在学校后门的小店聊到打烊。' },
    ],
  },
  {
    id: 'ev_debt_collect',
    title: '室友还钱了吗',
    text: '借出去的钱到了约定的日子。室友见你，欲言又止。',
    category: 'random',
    weight: 3,
    requires: { type: 'flag', key: '借出去过钱' },
    choices: [
      {
        label: '直接问',
        effects: [
          { type: 'stat', key: 'money', delta: 500 },
          { type: 'stat', key: 'social', delta: 2 },
          { type: 'log', text: '他痛快地把钱转了过来。' },
        ],
      },
      {
        label: '不好意思开口',
        effects: [
          { type: 'stat', key: 'mood', delta: -6 },
          { type: 'stat', key: 'social', delta: -2 },
          { type: 'log', text: '钱的事不了了之，你心里堵得慌。' },
        ],
      },
    ],
  },
  {
    id: 'ev_psych_counseling',
    title: '心理咨询预约',
    text: '上次和辅导员谈过之后，他建议你去学校的心理咨询中心坐坐。',
    category: 'random',
    weight: 2,
    requires: { type: 'flag', key: '谈过心' },
    effects: [
      { type: 'stat', key: 'mood', delta: 10 },
      { type: 'stat', key: 'health', delta: 3 },
      { type: 'log', text: '和咨询师聊了一个小时，你感觉轻松了不少。' },
    ],
  },
  {
    id: 'ev_health_checkup',
    title: '体检复查',
    text: '体检报告有几个指标偏高，校医院建议你复查。你有点紧张。',
    category: 'random',
    weight: 2,
    requires: { type: 'flag', key: '身体预警' },
    effects: [
      {
        type: 'branch',
        options: [
          {
            weight: 6,
            effects: [
              { type: 'stat', key: 'mood', delta: 6 },
              { type: 'log', text: '复查结果没事，只是最近太累了。你松了口气。' },
            ],
          },
          {
            weight: 4,
            effects: [
              { type: 'stat', key: 'health', delta: -6 },
              { type: 'stat', key: 'mood', delta: -4 },
              { type: 'log', text: '医生让你必须规律作息，否则身体撑不住。' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev_save_for_laptop',
    title: '攒钱买电脑',
    text: '电脑坏了之后，你只能用图书馆的机器。是时候为下一台存钱了。',
    category: 'random',
    weight: 2,
    requires: { type: 'flag', key: '电脑坏了' },
    choices: [
      {
        label: '咬咬牙买台新的',
        effects: [
          { type: 'stat', key: 'money', delta: -1800 },
          { type: 'stat', key: 'skill', delta: 4 },
          { type: 'stat', key: 'mood', delta: 3 },
        ],
      },
      {
        label: '继续蹭实验室的机器',
        effects: [
          { type: 'stat', key: 'mood', delta: -4 },
          { type: 'stat', key: 'skill', delta: 1 },
        ],
      },
    ],
  },
  {
    id: 'ev_makeup_exam',
    title: '补考通知',
    text: '教务系统的补考安排出来了。挂掉的那门课，还有最后一次机会。',
    category: 'random',
    weight: 3,
    requires: {
      type: 'all',
      conditions: [
        { type: 'flag', key: '被预警' },
        { type: 'week', op: '>=', value: 10 },
      ],
    },
    choices: [
      {
        label: '认真备考',
        effects: [
          { type: 'stat', key: 'academic', delta: 8 },
          { type: 'stat', key: 'mood', delta: -4 },
        ],
      },
      {
        label: '破罐破摔',
        effects: [
          { type: 'stat', key: 'academic', delta: -5 },
          { type: 'stat', key: 'mood', delta: 2 },
        ],
      },
    ],
  },
  {
    id: 'ev_baoyan_consult',
    title: '保研咨询会',
    text: '学院开了保研政策宣讲会。你拿着奖学金的光环，被老师多看了两眼。',
    category: 'random',
    weight: 2,
    requires: {
      type: 'all',
      conditions: [
        { type: 'flag', key: '拿过奖学金' },
        { type: 'week', op: '>=', value: 8 },
      ],
    },
    effects: [
      { type: 'stat', key: 'academic', delta: 3 },
      { type: 'stat', key: 'mood', delta: 4 },
      { type: 'log', text: '你算了下绩点，保研有戏。' },
    ],
  },
  {
    id: 'ev_first_day_intern',
    title: '实习第一天',
    text: '你背着包走进写字楼，工牌还没领，mentor 已经拉你进了三个群。',
    category: 'random',
    weight: 2,
    requires: {
      type: 'all',
      conditions: [
        { type: 'flag', key: '拿到实习Offer' },
        { type: 'week', op: '>=', value: 11 },
      ],
    },
    effects: [
      { type: 'stat', key: 'skill', delta: 5 },
      { type: 'stat', key: 'health', delta: -5 },
      { type: 'stat', key: 'mood', delta: 2 },
      { type: 'log', text: '搬砖第一天，你学到的东西比一学期都多。' },
    ],
  },
  {
    id: 'ev_written_test',
    title: '笔试通知',
    text: '投了这么多份简历，终于有一家公司发来了笔试邀请。',
    category: 'random',
    weight: 3,
    requires: {
      type: 'all',
      conditions: [
        { type: 'flagAtLeast', key: '投递次数', value: 3 },
        { type: 'week', op: '>=', value: 10 },
      ],
    },
    effects: [
      { type: 'stat', key: 'mood', delta: 5 },
      { type: 'stat', key: 'skill', delta: 3 },
      { type: 'log', text: '这是第一道坎。你做了套真题，手感还行。' },
    ],
  },

  /* ════════════════ 三阶段暗线（flagEq）════════════════ */

  {
    id: 'ev_club_elite',
    title: '社团骨干竞选',
    text: '社团换届，你因为在活动里的投入被推举为骨干候选人。',
    category: 'random',
    weight: 3,
    // 用 flagEq：社团贡献攒到 2（加入 + 至少参加一次社团大事件）才有资格
    requires: { type: 'flagEq', key: '社团贡献', value: 2 },
    effects: [
      { type: 'stat', key: 'social', delta: 10 },
      { type: 'stat', key: 'mood', delta: 5 },
      { type: 'stat', key: 'academic', delta: 2 },
      { type: 'log', text: '你当上了社团骨干。责任重了，但也更有归属感了。' },
    ],
  },
]