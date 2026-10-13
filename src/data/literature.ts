import type { ActionDef, Ending, GameEvent, ProjectDef, SummaryRule } from '../engine/types'

/**
 * 汉语言文学专业内容包 —— 「计算机」之外的第二条人生。
 *
 * ── 这个文件为什么存在 ──
 * 引擎不认识任何专业：它只认 `majors` 这个标签。凡是带了 `['literature']`
 * 的内容，只有汉语言文学专业的存档看得见；没带的仍然全专业共享。
 * 所以「加一个专业」在这份代码里的全部代价 = 新增这一个数据文件，
 * 引擎、CLI、Web 一行都不用改（专业定义本身在 data/majors.ts，由接线者补上）。
 *
 * ── 文科和计算机差在哪（数值层）──
 *   计算机的硬实力来自「写代码 / 刷题」（共享行动 `code`），学业来自 `study`；
 *   文科的两件正事则是**写**和**读**：
 *     · `write`     技能涨得最快，但明确吃心情和健康 —— 交稿日是真的会掉头发；
 *     · `read_lit`  学业与心情双收，代价是健康（一晚上看完一本长篇，第二天废掉）。
 *   两个行动都不是纯赚的：`write` 与共享的 `code` 数值接近但更耗心情、更偏学业，
 *   `read_lit` 与 `study` 相比是「少 1 学业、多 5 心情、多 2 技能、多 1 健康消耗」。
 *   这样文科生也要在「写 / 读 / 睡 / 吃饭」之间选，而不是有一个必胜解。
 *
 * ── flag 暗线（静态审计要的自闭环）──
 * 本文件写了 7 个 flag，每一个都在本文件的**条件**里被读过（结局或回顾规则），
 * 所以按专业审计的两个方向都干净：没有「写了没人读」，也没有「读了没人写」。
 *
 *   flag          写在哪                                  读在哪
 *   ------------  ------------------------------------  ------------------------------------------
 *   写完的稿子     write 行动                            LITERATURE_SUMMARY_RULES[6]（flagAtLeast 1）
 *   发表过作品     校刊约稿 / 征文比赛 的获奖分支          结局 ending_lit_published + 回顾规则[0]
 *   退稿次数       退稿信 / 校刊落选 / 征文落选            LITERATURE_SUMMARY_RULES[2]（flagAtLeast 1）
 *   上台朗读过     剧本朗读会「举手试试」                   LITERATURE_SUMMARY_RULES[4]
 *   读书会成员     导师读书会「报名并主讲」                 LITERATURE_SUMMARY_RULES[3]
 *   去过老街       城南老街（无选项事件，遇到即写）          LITERATURE_SUMMARY_RULES[5]
 *   连载邀约       编辑私信「答应日更」且技能达标           结局 ending_lit_serial + 回顾规则[1]
 *
 * 另外两条纪律也体现在数据里：
 *   · 每个带 `choices` 的事件都**至少有一个无条件选项**，否则条件全不满足时玩家会卡死；
 *   · 回顾规则一律不用 `chance`（回顾必须确定，且 chance 会消耗随机数破坏复现）。
 */

/* ============================================================
 * 一、专属行动（2 个）
 * ========================================================== */
export const LITERATURE_ACTIONS: ActionDef[] = [
  {
    id: 'write',
    label: '写稿 / 赶稿',
    description: '打开文档，把脑子里那点东西写下来',
    cost: 1,
    effects: [
      // 文笔是练出来的，也只能靠练：技能给到 +4，与共享的 `code` 同档
      { type: 'stat', key: 'skill', delta: 4 },
      // 比 `code` 多 1 点学业：写的过程本身就是古代文学/现当代的细读训练
      { type: 'stat', key: 'academic', delta: 2 },
      // 代价也比 `code` 重一点：写不出来的时候，人是坐在那儿跟自己较劲的
      { type: 'stat', key: 'mood', delta: -3 },
      { type: 'stat', key: 'health', delta: -1 },
      // 数值 flag：用来支撑回顾里「写完了 {n} 篇东西」这句话
      { type: 'addFlag', key: '写完的稿子', delta: 1 },
    ],
    majors: ['literature'],
  },
  {
    id: 'read_lit',
    label: '读原著 / 看展',
    description: '从图书馆抱一摞书回宿舍，或者去看一场没什么人的展览',
    cost: 1,
    effects: [
      { type: 'stat', key: 'academic', delta: 3 },
      // 读书是这个专业里少数「做完心情会变好」的正事 —— 但它买的是时间与精力
      { type: 'stat', key: 'mood', delta: 3 },
      { type: 'stat', key: 'skill', delta: 2 },
      { type: 'stat', key: 'health', delta: -2 },
    ],
    majors: ['literature'],
  },
]

/* ============================================================
 * 二、随机事件（10 个）
 *
 * 全部围绕「大三文科生」的真实处境：约稿、退稿、讲座、征文、剧本朗读、
 * 古籍室、读书会、采风、书店夜班、编辑私信。
 * 数值只服务于叙事，不做「+3 学业」式的说明书。
 * ========================================================== */
export const LITERATURE_EVENTS: GameEvent[] = [
  /* ---------------- 发稿线：约稿 → 过稿 / 退稿 ---------------- */
  {
    id: 'ev_lit_journal_invite',
    title: '校刊的约稿消息',
    text:
      '校刊编辑在微信上找到你：「这一期想做『大三』专题，你手上有没有现成的稿子？周日晚上截稿。」' +
      '你翻了翻文件夹，只有一篇半年前写的散文，结尾还是草草收的。',
    category: 'random',
    // 权重 3：这是文科版「投递简历」，是整条发稿线的入口，出现得太少整条线就废了
    weight: 3,
    choices: [
      {
        // 无条件选项：保证条件全不满足时玩家也有路可走
        label: '把那篇散文翻出来改到凌晨',
        effects: [
          { type: 'stat', key: 'mood', delta: -3 },
          { type: 'stat', key: 'skill', delta: 3 },
          { type: 'stat', key: 'academic', delta: 1 },
          // 改稿的结果不确定 —— 用 branch（按权重必中一个），而不是两次独立随机。
          // 6:4 ≈ 六成上刊，这个比例对应「认真改过的东西，过稿率其实不低」。
          {
            type: 'branch',
            options: [
              {
                weight: 6,
                effects: [
                  { type: 'setFlag', key: '发表过作品', value: true },
                  { type: 'stat', key: 'mood', delta: 8 },
                  { type: 'log', text: '编辑回过来两个字：「要了」。署名那一栏，你填了专业和年级。' },
                ],
              },
              {
                weight: 4,
                effects: [
                  { type: 'addFlag', key: '退稿次数', delta: 1 },
                  { type: 'stat', key: 'mood', delta: -5 },
                  { type: 'log', text: '编辑说这期版面不够，让你「下次早点」。你把文档又另存了一遍。' },
                ],
              },
            ],
          },
        ],
      },
      {
        label: '回一句「这学期太忙，下次一定」',
        effects: [
          { type: 'stat', key: 'mood', delta: 2 },
          { type: 'stat', key: 'academic', delta: 2 },
        ],
      },
      {
        // 带条件的选项：社交够高才想得起「把别人的东西递上去」这条人情路
        label: '把室友那篇写夜市的小说推给编辑',
        requires: { type: 'stat', key: 'social', op: '>=', value: 55 },
        effects: [
          { type: 'stat', key: 'social', delta: 4 },
          { type: 'stat', key: 'mood', delta: 2 },
          { type: 'log', text: '室友的稿子上了目录。他请你吃了顿麻辣烫，说欠你一次。' },
        ],
      },
    ],
    majors: ['literature'],
  },
  {
    id: 'ev_lit_rejection',
    title: '邮箱里的退稿信',
    text:
      '邮箱里躺着一封退稿信，第一句是「感谢您的来稿」，第二句是「很遗憾」。' +
      '附件甚至没有被下载过的痕迹。你盯着那行字，把手边的水喝完了。',
    category: 'random',
    weight: 2,
    // 无选项事件：退稿不接受谈判，遇到了就是遇到了
    effects: [
      { type: 'addFlag', key: '退稿次数', delta: 1 },
      { type: 'stat', key: 'mood', delta: -5 },
      // 唯一的正面：退稿信里那句评语，往往比夸你的话更有用
      { type: 'stat', key: 'skill', delta: 1 },
      { type: 'log', text: '你把编辑那句「节奏偏慢」抄进备忘录，标题写着「下次改」。' },
    ],
    majors: ['literature'],
  },

  /* ---------------- 讲堂与圈子 ---------------- */
  {
    id: 'ev_lit_lecture',
    title: '作家讲座',
    text:
      '文学院请来一位写小说的校友做讲座，报告厅的过道都坐满了人。' +
      '散场后他站在门口抽烟，身边暂时只有你。',
    category: 'random',
    weight: 2,
    choices: [
      {
        label: '走上去问他一个问题',
        effects: [
          { type: 'stat', key: 'social', delta: 3 },
          { type: 'stat', key: 'mood', delta: 3 },
          { type: 'stat', key: 'skill', delta: 2 },
          { type: 'log', text: '他说：「先把一百万字写废，再谈天赋。」烟灰掉在地上，他自己踩灭了。' },
        ],
      },
      {
        label: '把讲座从头记到尾',
        effects: [
          { type: 'stat', key: 'academic', delta: 4 },
          { type: 'stat', key: 'skill', delta: 2 },
          { type: 'stat', key: 'mood', delta: -1 },
        ],
      },
      {
        label: '和同学去后门吃宵夜，边吃边聊讲座',
        effects: [
          { type: 'stat', key: 'social', delta: 4 },
          { type: 'stat', key: 'mood', delta: 4 },
          { type: 'stat', key: 'money', delta: -30 },
        ],
      },
    ],
    majors: ['literature'],
  },
  {
    id: 'ev_lit_reading_group',
    title: '导师的读书会',
    text:
      '导师在群里发了一份书单：这学期每月聚一次，读《世说新语》和两本当代长篇。' +
      '「来不来随意，但来的人平时分加五分。」',
    category: 'random',
    weight: 2,
    choices: [
      {
        label: '报名，并且认领第一次主讲',
        effects: [
          { type: 'setFlag', key: '读书会成员', value: true },
          { type: 'stat', key: 'academic', delta: 4 },
          { type: 'stat', key: 'skill', delta: 3 },
          // 在十几个人面前讲错一个版本问题，是会被记住的
          { type: 'stat', key: 'mood', delta: -3 },
          { type: 'stat', key: 'social', delta: 2 },
          { type: 'log', text: '第一次主讲你准备了三个晚上。散会时导师说了句「有点意思」。' },
        ],
      },
      {
        label: '只去旁听，不发言',
        effects: [
          { type: 'stat', key: 'academic', delta: 2 },
          { type: 'stat', key: 'skill', delta: 1 },
          { type: 'stat', key: 'mood', delta: 1 },
        ],
      },
      {
        label: '不去，这个学期实在排不开',
        effects: [
          { type: 'stat', key: 'mood', delta: 2 },
          { type: 'stat', key: 'academic', delta: 1 },
        ],
      },
    ],
    majors: ['literature'],
  },

  /* ---------------- 写作现场 ---------------- */
  {
    id: 'ev_lit_contest',
    title: '征文比赛的截稿日',
    text:
      '学院和市作协合办短篇小说大赛，一等奖三千块。截稿是下周三，' +
      '而你手上只有一个开了头的文档，和一堆没想清楚的设定。',
    category: 'random',
    weight: 2,
    // 截稿在学期中后段：太早出现会显得这个比赛没人管
    requires: { type: 'week', op: '<=', value: 12 },
    choices: [
      {
        // 无条件选项：这场赌局谁都可以进
        label: '这几天全泡在这一篇上',
        effects: [
          { type: 'stat', key: 'academic', delta: 3 },
          { type: 'stat', key: 'skill', delta: 5 },
          { type: 'stat', key: 'health', delta: -4 },
          { type: 'stat', key: 'mood', delta: -2 },
          // 3:7 —— 比赛比校刊难得多，落选才是常态
          {
            type: 'branch',
            options: [
              {
                weight: 3,
                effects: [
                  { type: 'setFlag', key: '发表过作品', value: true },
                  { type: 'stat', key: 'money', delta: 500 },
                  { type: 'stat', key: 'mood', delta: 10 },
                  { type: 'log', text: '公示名单贴出来那天，你在二等奖那一行找到了自己的名字。' },
                ],
              },
              {
                weight: 7,
                effects: [
                  { type: 'addFlag', key: '退稿次数', delta: 1 },
                  { type: 'stat', key: 'mood', delta: -4 },
                  { type: 'log', text: '名单上没有你。评委给的四字评语是「后劲不足」。' },
                ],
              },
            ],
          },
        ],
      },
      {
        label: '先把开头写完，投了再说',
        effects: [
          { type: 'stat', key: 'skill', delta: 3 },
          { type: 'stat', key: 'academic', delta: 1 },
          { type: 'stat', key: 'mood', delta: -1 },
        ],
      },
      {
        label: '把时间让给期末论文',
        effects: [
          { type: 'stat', key: 'academic', delta: 4 },
          { type: 'stat', key: 'mood', delta: 1 },
        ],
      },
    ],
    majors: ['literature'],
  },
  {
    id: 'ev_lit_drama',
    title: '剧本朗读会',
    text:
      '话剧社在活动室办剧本朗读会，缺一个念配角的。社长把本子塞给你：' +
      '「不用背，站着读就行。」台下坐着二十来个人，全是熟人。',
    category: 'random',
    weight: 2,
    choices: [
      {
        label: '举手，说我试试',
        effects: [
          { type: 'setFlag', key: '上台朗读过', value: true },
          { type: 'stat', key: 'social', delta: 4 },
          { type: 'stat', key: 'mood', delta: 5 },
          { type: 'stat', key: 'skill', delta: 3 },
          { type: 'stat', key: 'health', delta: -1 },
          { type: 'log', text: '读到第三幕那句台词时，活动室安静了一下 —— 然后是椅子腿刮地板的声音。' },
        ],
      },
      {
        label: '坐在下面听完，散场后提意见',
        effects: [
          { type: 'stat', key: 'academic', delta: 2 },
          { type: 'stat', key: 'mood', delta: 2 },
          { type: 'stat', key: 'social', delta: 1 },
        ],
      },
      {
        label: '把本子借回去，自己改一版',
        effects: [
          { type: 'stat', key: 'skill', delta: 4 },
          { type: 'stat', key: 'academic', delta: 2 },
          { type: 'stat', key: 'mood', delta: -2 },
        ],
      },
    ],
    majors: ['literature'],
  },

  /* ---------------- 书与街 ---------------- */
  {
    id: 'ev_lit_rare_book',
    title: '古籍室的借书条',
    text:
      '为了查一个注，你申请进了图书馆六楼的古籍室。管理员递来一支铅笔和一张借书条：' +
      '「不能拍照，抄吧。」等你抬头，窗外的天已经暗了。',
    category: 'random',
    weight: 1,
    // 无选项：查资料这件事没有取舍，只有「去不去」，而事件本身已经是「你去了」
    effects: [
      { type: 'stat', key: 'academic', delta: 5 },
      { type: 'stat', key: 'skill', delta: 2 },
      { type: 'stat', key: 'mood', delta: 3 },
      { type: 'stat', key: 'health', delta: -3 },
    ],
    majors: ['literature'],
  },
  {
    id: 'ev_lit_fieldtrip',
    title: '城南老街',
    text:
      '写作课布置了一份非虚构作业：写一个真实的街角。你坐了四十分钟公交到城南，' +
      '在修鞋摊旁边蹲到收摊。老师傅最后跟你讲了他儿子的故事。',
    category: 'random',
    weight: 2,
    effects: [
      { type: 'setFlag', key: '去过老街', value: true },
      { type: 'stat', key: 'academic', delta: 4 },
      { type: 'stat', key: 'skill', delta: 3 },
      { type: 'stat', key: 'mood', delta: 2 },
      { type: 'stat', key: 'health', delta: -2 },
      { type: 'log', text: '回学校的公交上，你把那段话一句句默写在手机备忘录里。' },
    ],
    majors: ['literature'],
  },
  {
    id: 'ev_lit_bookstore',
    title: '书店的夜班',
    text:
      '学校后门的独立书店在招夜班临时工，一小时十八块。老板说：' +
      '「不忙的时候你可以坐在收银台后面看书，就是客人来了得抬头。」',
    category: 'random',
    weight: 2,
    choices: [
      {
        label: '接下这个夜班',
        effects: [
          { type: 'stat', key: 'money', delta: 260 },
          { type: 'stat', key: 'mood', delta: 3 },
          { type: 'stat', key: 'skill', delta: 1 },
          { type: 'stat', key: 'academic', delta: 1 },
          { type: 'stat', key: 'health', delta: -4 },
        ],
      },
      {
        label: '只周末去一天',
        effects: [
          { type: 'stat', key: 'money', delta: 120 },
          { type: 'stat', key: 'mood', delta: 1 },
          { type: 'stat', key: 'skill', delta: 1 },
          { type: 'stat', key: 'health', delta: -1 },
        ],
      },
      {
        label: '算了，晚上想留给自己那篇稿子',
        effects: [
          { type: 'stat', key: 'skill', delta: 3 },
          { type: 'stat', key: 'mood', delta: 2 },
        ],
      },
    ],
    majors: ['literature'],
  },

  /* ---------------- 唯一的「前途」入口 ---------------- */
  {
    id: 'ev_lit_editor_dm',
    title: '一条陌生的私信',
    text:
      '一个连载平台的编辑顺着你发在网上的几章小说找过来：「保底千字三十，日更三千，' +
      '断更也不罚你。」你点开合同附件，条款密密麻麻。',
    category: 'random',
    // 权重 3 + 只在后半学期出现：这是「签约作者」结局的唯一入口，
    // 入口太窄就会没人走得到；而它也确实需要你已经写了几个月东西才可能出现。
    weight: 3,
    requires: { type: 'week', op: '>=', value: 6 },
    choices: [
      {
        // 无条件选项：能不能签下来交给技能说话（见下面的 if），但「答应」这个动作本身人人可做
        label: '答应下来，先写上一个月试试',
        effects: [
          {
            type: 'if',
            requires: { type: 'stat', key: 'skill', op: '>=', value: 45 },
            effects: [
              { type: 'setFlag', key: '连载邀约', value: true },
              { type: 'stat', key: 'mood', delta: 4 },
              { type: 'stat', key: 'money', delta: 150 },
              { type: 'stat', key: 'health', delta: -4 },
              { type: 'log', text: '你签了那份电子合同。第一章上线的当晚，你刷新了二十次评论区。' },
            ],
          },
          {
            // 技能不够时，同一个选项通向另一个（确定性的）结果。
            // 这里刻意不用 chance：用属性门槛分叉，玩家能复盘出「是我写得还不够」。
            type: 'if',
            requires: {
              type: 'not',
              condition: { type: 'stat', key: 'skill', op: '>=', value: 45 },
            },
            effects: [
              { type: 'stat', key: 'mood', delta: -4 },
              { type: 'stat', key: 'skill', delta: 1 },
              { type: 'log', text: '你写到第三章就断了。编辑再没回过消息，那条私信还留在对话框最上面。' },
            ],
          },
        ],
      },
      {
        label: '先加个好友，问问分成和版权',
        effects: [
          { type: 'stat', key: 'social', delta: 3 },
          { type: 'stat', key: 'skill', delta: 1 },
          { type: 'stat', key: 'mood', delta: 1 },
        ],
      },
      {
        label: '婉拒，说想先把期末的东西写完',
        effects: [
          { type: 'stat', key: 'academic', delta: 3 },
          { type: 'stat', key: 'mood', delta: 2 },
        ],
      },
    ],
    majors: ['literature'],
  },
]

/* ============================================================
 * 三、结算回顾规则（7 条）
 *
 * order 10–22 都属于「这一学期具体做过什么」，跟共享规则里的 80+ 总体状态
 * 形成「先讲事、后总结」的节奏。全部按 flag（或数值 flag）判定，不用 chance。
 * ========================================================== */
export const LITERATURE_SUMMARY_RULES: SummaryRule[] = [
  {
    requires: { type: 'flag', key: '发表过作品' },
    kind: 'skill',
    order: 10,
    text: '有东西被真的印出来过，署名后面跟着专业和年级',
    majors: ['literature'],
  },
  {
    requires: { type: 'flag', key: '连载邀约' },
    kind: 'career',
    order: 12,
    text: '被一位编辑问过：要不要签下来，试试日更',
    majors: ['literature'],
  },
  {
    requires: { type: 'flagAtLeast', key: '退稿次数', value: 1 },
    kind: 'setback',
    order: 14,
    countFrom: '退稿次数',
    text: '被退稿 {n} 次，后来学会了把退稿信当修改意见看',
    majors: ['literature'],
  },
  {
    requires: { type: 'flag', key: '读书会成员' },
    kind: 'academic',
    order: 16,
    text: '成了导师读书会的固定成员，第一次主讲准备了三个晚上',
    majors: ['literature'],
  },
  {
    requires: { type: 'flag', key: '上台朗读过' },
    kind: 'notable',
    order: 18,
    text: '在剧本朗读会上，念过一段自己写的台词',
    majors: ['literature'],
  },
  {
    requires: { type: 'flag', key: '去过老街' },
    kind: 'social',
    order: 20,
    text: '为了写一个真实的街角，在老街的修鞋摊旁边蹲到收摊',
    majors: ['literature'],
  },
  {
    requires: { type: 'flagAtLeast', key: '写完的稿子', value: 1 },
    kind: 'skill',
    order: 22,
    countFrom: '写完的稿子',
    text: '前前后后写完了 {n} 篇东西，大多数只有自己读过',
    majors: ['literature'],
  },

  /* ---------------- 项目 / 作品（真的写完了整本） ---------------- */
  {
    requires: { type: 'flag', key: '项目_诗集_完成' },
    kind: 'skill',
    order: 24,
    text: '把那沓断断续续的诗攒成了一本，自己排版、自己印了十册',
    majors: ['literature'],
  },
  {
    requires: { type: 'flag', key: '项目_长篇_完成' },
    kind: 'skill',
    order: 26,
    countFrom: '项目_长篇_进度',
    text: '一部长篇前后投入了 {n} 次，结尾改了七遍',
    majors: ['literature'],
  },
]

/* ============================================================
 * 四、专属结局（2 个）
 *
 * priority 都落在 54–56：排在共享的「坏结局」（10–40）和「大厂 Offer」（50）之后、
 * 「保研上岸」（60）之前，既不会被坏结局饿死，也不会把学霸/社交线路全部截胡。
 * 刻意**不写**恒真兜底结局 —— 那份兜底是共享的（endings.ts 的最后一个），
 * 这里再写一个只会让 priority 打架。
 * ========================================================== */
export const LITERATURE_ENDINGS: Ending[] = [
  {
    id: 'ending_lit_serial',
    title: '签约作者',
    text:
      '寒假前，编辑把合同发了过来：一个长篇的连载，按千字结算。' +
      '你在「作者」那一栏签下本名，手心里全是汗 —— 从今天起，写东西不只是你自己的事。',
    priority: 54,
    requires: {
      type: 'all',
      conditions: [
        // 两条路通往同一个结局：编辑找上门（事件线），
        // 或者你自己把长篇写完了（项目线）——「项目收益通向专业结局」就体现在这里
        {
          type: 'any',
          conditions: [
            { type: 'flag', key: '连载邀约' },
            { type: 'flag', key: '项目_长篇_完成' },
          ],
        },
        // 再要一道门槛：签约是手艺活，光有人问不算
        { type: 'stat', key: 'skill', op: '>=', value: 50 },
      ],
    },
    majors: ['literature'],
  },
  {
    id: 'ending_lit_published',
    title: '作品发表',
    text:
      '学期末，那篇东西真的被印了出来。你在图书馆的期刊架上找到它，' +
      '署名后面跟着「汉语言文学专业」。你把那一页拍下来，发给了很久没联系的爸妈。',
    priority: 56,
    requires: {
      type: 'all',
      conditions: [
        // 校刊过稿 / 征文获奖（事件线），或者诗集完成（项目线）
        {
          type: 'any',
          conditions: [
            { type: 'flag', key: '发表过作品' },
            { type: 'flag', key: '项目_诗集_完成' },
          ],
        },
        { type: 'stat', key: 'skill', op: '>=', value: 45 },
      ],
    },
    majors: ['literature'],
  },
]

/* ============================================================
 * 五、专属项目 / 作品（2 个）
 *
 * ── 这才是「不同专业」真正拉开差距的地方 ──
 * 起始属性差几点，三周就被抹平了；但「你花 3–4 次行动力做出了什么东西」
 * 不会 —— 它同时改变了终局属性和你配得上的结局。
 *
 * 两个项目刻意做成**不同性格**：
 *   · 诗集  门槛低（技能 30）、周期短（3 次），收益偏心情 —— 随手就能开始
 *   · 长篇  门槛高（技能 45）、周期长（4 次），收益偏学业与技能 —— 需要下决心
 * 于是「先写短的还是直接啃长的」本身就是一个取舍。
 *
 * 完成时引擎会写入 `completionFlag`，它被结局和回顾规则消费（见文件上方）。
 * ========================================================== */
export const LITERATURE_PROJECTS: ProjectDef[] = [
  {
    id: 'proj_poetry',
    name: '攒一本自己的诗集',
    description: '把这几年断断续续写的东西挑一挑，凑够一本，自己排版印出来',
    majors: ['literature'],
    // 门槛很低：写过的稿子够十来篇就能开始攒
    requires: { type: 'stat', key: 'skill', op: '>=', value: 30 },
    requiredInvestments: 3,
    perInvest: [
      { type: 'stat', key: 'skill', delta: 3 },
      // 挑自己的旧稿是最容易自我怀疑的环节
      { type: 'stat', key: 'mood', delta: -1 },
    ],
    onComplete: [
      { type: 'stat', key: 'skill', delta: 5 },
      { type: 'stat', key: 'mood', delta: 10 },
      { type: 'log', text: '十个印本摊在桌上，你给每一本都写了不同的赠言。' },
    ],
    progressFlag: '项目_诗集_进度',
    completionFlag: '项目_诗集_完成',
  },
  {
    id: 'proj_longform',
    name: '开始写一部长篇',
    description: '先不管能不能写完，每天固定写两千字，写完为止',
    majors: ['literature'],
    requires: { type: 'stat', key: 'skill', op: '>=', value: 45 },
    requiredInvestments: 4,
    perInvest: [
      { type: 'stat', key: 'skill', delta: 3 },
      // 长篇写作会反过来要求你查资料、补知识结构
      { type: 'stat', key: 'academic', delta: 1 },
      { type: 'stat', key: 'mood', delta: -2 },
    ],
    onComplete: [
      { type: 'stat', key: 'skill', delta: 6 },
      { type: 'stat', key: 'academic', delta: 3 },
      { type: 'stat', key: 'mood', delta: 6 },
      { type: 'log', text: '敲下「全文完」三个字的时候，宿舍已经熄灯很久了。' },
    ],
    progressFlag: '项目_长篇_进度',
    completionFlag: '项目_长篇_完成',
  },
]
