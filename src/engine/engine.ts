import { evaluate } from './conditions'
import { STAT_ORDER, applyEffects } from './effects'
import { applyStatBonus, matchesMajor, resolveMajor } from './majors'
import { mulberry32, pickWeighted, randomSeed } from './rng'
import { cloneState, createInitialState, pushLog } from './state'
import type {
  ActionDef,
  Choice,
  EvalContext,
  GameData,
  GameEvent,
  GameState,
  LogEntry,
  MajorDef,
  ProjectDef,
  ProjectView,
  RNG,
  RunSummary,
  StatKey,
  SummaryLine,
  TurnResult,
} from './types'

export interface NewGameOptions {
  /** 指定随机种子即可复现同一局游戏；不传则随机 */
  seed?: number
  /**
   * 专业 id；不传则用 `data.majors` 里的第一个。
   *
   * 专业只影响「哪些内容可见」和「开局属性」，完全由数据决定 ——
   * 引擎这里只是把玩家的选择原样传给数据层。
   */
  majorId?: string
}

export interface ChoiceView {
  choice: Choice
  /** 条件不满足时为 false，UI 应该把按钮变灰 */
  enabled: boolean
}

/**
 * 游戏引擎。
 *
 * 设计要点：
 *  - 数据（GameData）从构造函数注入 → 换一套内容不需要改引擎
 *  - 随机数发生器（RNG）从构造函数注入 → 测试可以完全确定
 *  - 完全不依赖浏览器 / DOM / 框架 → 命令行、浏览器、测试都能跑
 */
export class GameEngine {
  private readonly data: GameData
  private readonly state: GameState
  private readonly rng: RNG
  private readonly seed: number
  /** 本局专业（数据里的一条定义，引擎不对它做任何特判） */
  private readonly major: MajorDef

  /** 正在等待玩家做选择的事件 */
  private pending: GameEvent | null = null

  constructor(data: GameData, options: NewGameOptions = {}) {
    this.data = data
    this.seed = options.seed ?? randomSeed()
    this.rng = mulberry32(this.seed)
    this.major = resolveMajor(data, options.majorId)

    this.state = createInitialState(
      data.config,
      this.major.id,
      // 基准属性 + 专业偏移，并且夹进合法区间（开局这一帧同样受 I1 约束）
      applyStatBonus(data.config.initialStats, this.major.statBonus, data.config.statRanges),
    )

    // 开场白里的「你是谁」来自专业数据。引擎里刻意不留任何一个具体专业名：
    // 一旦写死「计算机专业大三学生」，「加第 3 个专业只写数据」这句话就假了。
    pushLog(
      this.state,
      'system',
      `开学了。你是${this.major.identity}，本学期共 ${data.config.totalWeeks} 周，每周 ${data.config.actionPointsPerWeek} 点行动力。`,
    )
  }

  /* ---------------- 只读查询 ---------------- */

  getSeed(): number {
    return this.seed
  }

  /** 本局专业定义（含显示名与身份文案），供界面显示 */
  getMajor(): MajorDef {
    return this.major
  }

  /** 返回状态副本，外部改不动引擎内部 */
  getState(): GameState {
    return cloneState(this.state)
  }

  getConfig() {
    return this.data.config
  }

  getPending(): GameEvent | null {
    return this.pending
  }

  getPendingChoices(): ChoiceView[] {
    if (!this.pending) return []
    const ctx = this.createContext()
    return (this.pending.choices ?? []).map((choice) => ({
      choice,
      enabled: evaluate(choice.requires, ctx),
    }))
  }

  isEnded(): boolean {
    return this.state.endingId !== null
  }

  getEnding() {
    if (this.state.endingId === null) return null
    return this.data.endings.find((ending) => ending.id === this.state.endingId) ?? null
  }

  /**
   * 学期结算回顾：把这一局「做了什么」翻译成叙述。
   *
   * 规则表是纯数据（`data/summary.ts`），这里只做三件事：
   * 求值条件、替换 `{n}` 占位、按 order 排序。
   *
   * 没走到结局时也能调用（给出截至当前状态的回顾），
   * 但正常用法是在结局页 —— 所以 `endingTitle` 在未结束时是个占位串。
   */
  getSummary(): RunSummary {
    const ctx = this.createContext()

    const lines: SummaryLine[] = this.data.summary.rules
      .map((rule, index) => ({ rule, index }))
      // 先按专业过滤，再求值条件 —— 顺序不影响结果，但让「这条规则本局根本不存在」
      // 和「它存在但条件不满足」两件事在代码上一眼可分
      .filter(({ rule }) => matchesMajor(rule.majors, this.major.id))
      .filter(({ rule }) => evaluate(rule.requires, ctx))
      .map(({ rule, index }) => ({
        kind: rule.kind,
        text: rule.countFrom
          ? rule.text.replace(/\{n\}/g, String(this.flagNumber(rule.countFrom)))
          : rule.text,
        order: rule.order ?? 0,
        index,
      }))
      // 先按 order，再按规则在文件里的书写顺序 ——
      // 保证排序结果唯一且稳定（同种子必然给出同一份回顾）
      .sort((a, b) => a.order - b.order || a.index - b.index)
      .map(({ kind, text }) => ({ kind, text }))

    return {
      identity: this.major.identity,
      lines,
      stats: { ...this.state.stats },
      endingTitle: this.getEnding()?.title ?? '还没有走到结局',
      verdict: this.data.summary.verdicts[this.dominantStat()],
      seed: this.seed,
    }
  }

  /** 读一个数值 flag；未设置或不是数字都算 0 */
  private flagNumber(key: string): number {
    const value = this.state.flags[key]
    return typeof value === 'number' ? value : 0
  }

  /**
   * **归一化后**最高的属性 —— 用来选「一句话总评」。
   *
   * 归一化不能省：六项属性量纲不同（金钱上限 999999，其余 100），
   * 直接比大小的话金钱永远第一，总评就永远是「跟钱打交道」。
   * 并列时按 STAT_ORDER 取靠前的，保证同种子结果稳定。
   */
  private dominantStat(): StatKey {
    const ranges = this.data.config.statRanges
    const ratio = (key: StatKey) => this.state.stats[key] / (ranges[key].max || 1)
    let best: StatKey = STAT_ORDER[0]!
    for (const key of STAT_ORDER) {
      if (ratio(key) > ratio(best)) best = key
    }
    return best
  }

  /** 当前可执行的行动（本专业可见 + 行动力够 + 条件满足） */
  availableActions(): ActionDef[] {
    const ctx = this.createContext()
    return this.data.actions.filter(
      (action) =>
        matchesMajor(action.majors, this.major.id) &&
        action.cost <= this.state.actionPoints &&
        evaluate(action.requires, ctx),
    )
  }

  /**
   * 本专业可见的全部项目（含未解锁与已完成的），带进度。
   *
   * 这里**不过滤**未解锁/已完成的：界面需要显示「还没解锁」和
   * 「进度 2/3」这类信息，直接过滤掉它们反而啥都展示不了。
   * 能不能投入由 `investProject` 负责挡（fail fast）。
   */
  getProjects(): ProjectView[] {
    const ctx = this.createContext()
    return this.data.projects
      .filter((project) => matchesMajor(project.majors, this.major.id))
      .map((project) => {
        const progress = this.projectProgress(project)
        return {
          project,
          progress,
          required: project.requiredInvestments,
          completed: progress >= project.requiredInvestments,
          unlocked: evaluate(project.requires, ctx),
        }
      })
  }

  /** 读一个项目的进度；没开始过就是 0 */
  private projectProgress(project: ProjectDef): number {
    const value = this.state.flags[project.progressFlag]
    return typeof value === 'number' ? value : 0
  }

  /* ---------------- 推进游戏 ---------------- */

  /** 执行一个行动 */
  takeAction(actionId: string): TurnResult {
    const from = this.state.log.length

    if (this.state.endingId !== null) {
      throw new Error('游戏已经结束了')
    }
    if (this.pending !== null) {
      throw new Error('还有未处理的事件，请先做出选择')
    }

    const action = this.data.actions.find((item) => item.id === actionId)
    if (!action) throw new Error(`未知行动: ${actionId}`)
    // 专业可见性也要在这里挡一道：availableActions() 过滤过，但 takeAction
    // 是公开 API，不能假设调用方一定先过滤（fail fast 的一致性）
    if (!matchesMajor(action.majors, this.major.id)) {
      throw new Error(`行动不属于本专业(${this.major.id}): ${actionId}`)
    }
    if (action.cost > this.state.actionPoints) throw new Error('行动力不足')
    if (!evaluate(action.requires, this.createContext())) {
      throw new Error(`行动条件不满足: ${actionId}`)
    }

    this.state.actionPoints -= action.cost
    // 先写日志（这样效果里的 log 会排在它后面，叙事顺序才对），
    // 结算完再把实际变化量补挂上去
    const actionEntry = pushLog(
      this.state,
      'action',
      `〔第${this.state.week}周〕你选择了「${action.label}」`,
    )
    const actionChanges = applyEffects(this.createContext(), action.effects)
    if (actionChanges.length > 0) actionEntry.changes = actionChanges

    if (this.state.actionPoints <= 0) {
      this.endWeek()
    }

    return this.buildResult(from)
  }

  /**
   * 向一个项目投入一次：消耗行动力、进度 +1，攒满则完成并结算奖励。
   *
   * 语义刻意对齐 `takeAction` —— 同样的守卫顺序、同样的「先写日志、后补变化量」、
   * 同样在行动力归零时结算本周。这样「做项目」和「做行动」在引擎里是同一种东西，
   * UI 也能把它们并排放在「这周做点什么」里。
   */
  investProject(projectId: string): TurnResult {
    const from = this.state.log.length

    if (this.state.endingId !== null) {
      throw new Error('游戏已经结束了')
    }
    if (this.pending !== null) {
      throw new Error('还有未处理的事件，请先做出选择')
    }

    const project = this.data.projects.find((item) => item.id === projectId)
    if (!project) throw new Error(`未知项目: ${projectId}`)
    if (!matchesMajor(project.majors, this.major.id)) {
      throw new Error(`项目不属于本专业(${this.major.id}): ${projectId}`)
    }

    const cost = project.cost ?? 1
    if (cost > this.state.actionPoints) throw new Error('行动力不足')

    const progress = this.projectProgress(project)
    if (progress >= project.requiredInvestments) {
      throw new Error(`项目已经完成了: ${projectId}`)
    }
    if (!evaluate(project.requires, this.createContext())) {
      throw new Error(`项目条件不满足: ${projectId}`)
    }

    // 校验全部前置之后才开始改状态（一旦开始就不再回滚）
    this.state.actionPoints -= cost
    const next = progress + 1
    this.state.flags[project.progressFlag] = next

    // 进度写进日志文案：玩家不用回头翻面板也知道自己攒到哪了
    const entry = pushLog(
      this.state,
      'action',
      `〔第${this.state.week}周〕你投入到「${project.name}」（进度 ${next}/${project.requiredInvestments}）`,
    )
    const changes = applyEffects(this.createContext(), project.perInvest)
    if (changes.length > 0) entry.changes = changes

    if (next >= project.requiredInvestments) {
      // 先置完成 flag，再结算 onComplete —— 这样 onComplete 里的 if 条件
      // 能读到「已完成」，数据作者不必去猜执行顺序
      this.state.flags[project.completionFlag] = true
      const doneEntry = pushLog(this.state, 'system', `「${project.name}」完成了。`)
      const doneChanges = applyEffects(this.createContext(), project.onComplete)
      if (doneChanges.length > 0) doneEntry.changes = doneChanges
    }

    if (this.state.actionPoints <= 0) {
      this.endWeek()
    }

    return this.buildResult(from)
  }

  /** 对当前待处理事件做出选择 */
  choose(choiceIndex: number): TurnResult {
    const from = this.state.log.length

    const event = this.pending
    if (!event) throw new Error('当前没有待处理的事件')

    const choice = (event.choices ?? [])[choiceIndex]
    if (!choice) throw new Error(`无效的选项序号: ${choiceIndex}`)
    if (!evaluate(choice.requires, this.createContext())) {
      throw new Error('该选项的条件不满足')
    }

    this.pending = null
    const choiceEntry = pushLog(this.state, 'action', `你的选择：${choice.label}`)
    const choiceChanges = applyEffects(this.createContext(), choice.effects)
    if (choiceChanges.length > 0) choiceEntry.changes = choiceChanges

    // 事件处理完了，才轮到本周结束 / 进入下一周
    this.maybeAdvance()

    return this.buildResult(from)
  }

  /* ---------------- 内部流程 ---------------- */

  private createContext(): EvalContext {
    return { state: this.state, config: this.data.config, rng: this.rng }
  }

  /** 行动力耗尽 → 结算本周 → 抽随机事件 → 决定是否进入下一周 */
  private endWeek(): void {
    // 每周固定衰减单独占一条日志。
    //
    // 文案刻意**不叫**「第 N 周结算」：那个说法会被读成「本周总结」，
    // 但这条只报告固定衰减，不含本周的行动效果（行动效果在自己的行上）。
    // 玩家拿它去对属性条的实际变化，就会以为数字错了。
    // 改成「每周固定衰减」，明确它是与行动无关的常量侵蚀。
    const settlement = pushLog(this.state, 'system', '每周固定衰减')
    const weeklyChanges = applyEffects(this.createContext(), this.data.config.weeklyEffects)
    if (weeklyChanges.length > 0) settlement.changes = weeklyChanges

    this.rollWeeklyEvent()
    this.maybeAdvance()
  }

  private rollWeeklyEvent(): void {
    if (this.rng() >= this.data.config.weeklyEventChance) return

    const ctx = this.createContext()
    const pool = this.data.events.filter((event) => {
      if (!matchesMajor(event.majors, this.major.id)) return false
      if (event.category !== 'random') return false
      if (!event.repeatable && this.state.seenEvents.includes(event.id)) return false
      return evaluate(event.requires, ctx)
    })

    const picked = pickWeighted(pool, (event) => event.weight ?? 1, this.rng)
    if (picked) this.triggerEvent(picked)
  }

  private triggerEvent(event: GameEvent): void {
    this.state.seenEvents.push(event.id)
    const entry = pushLog(this.state, 'event', `【${event.title}】${event.text}`)

    if (event.choices && event.choices.length > 0) {
      this.pending = event
      return
    }

    // 没有选项的事件直接把效果挂在事件这一条日志上
    const changes = applyEffects(this.createContext(), event.effects ?? [])
    if (changes.length > 0) entry.changes = changes
  }

  /**
   * 只有在「没有待处理事件」且「没有结束」时才推进时间。
   * 这就是引擎的相位控制，UI 不用自己判断。
   */
  private maybeAdvance(): void {
    if (this.pending !== null) return
    if (this.state.endingId !== null) return

    if (this.state.week >= this.data.config.totalWeeks) {
      this.settleEnding()
      return
    }

    this.state.week += 1
    this.state.actionPoints = this.data.config.actionPointsPerWeek
    pushLog(this.state, 'system', `—— 第 ${this.state.week} 周开始 ——`)
  }

  /** 学期结束，按优先级挑第一个满足条件的结局（只在本专业可见的结局里挑） */
  private settleEnding(): void {
    const ctx = this.createContext()
    const sorted = this.data.endings
      // filter 已经产出了新数组，所以后面的 sort 不会动到 data 里的原顺序
      .filter((ending) => matchesMajor(ending.majors, this.major.id))
      .sort((a, b) => a.priority - b.priority)
    const hit = sorted.find((ending) => evaluate(ending.requires, ctx)) ?? null

    this.state.endingId = hit ? hit.id : null

    if (hit) {
      pushLog(this.state, 'ending', `【结局：${hit.title}】${hit.text}`)
    } else {
      pushLog(this.state, 'ending', '【结局】学期结束了，但你没有触发任何结局。')
    }
  }

  private buildResult(fromLogIndex: number): TurnResult {
    const logs: LogEntry[] = this.state.log.slice(fromLogIndex)
    return {
      logs,
      pending: this.pending,
      ended: this.isEnded(),
    }
  }
}
