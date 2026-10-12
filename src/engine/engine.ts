import { evaluate } from './conditions'
import { applyEffects } from './effects'
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
  RNG,
  TurnResult,
} from './types'

export interface NewGameOptions {
  /** 指定随机种子即可复现同一局游戏；不传则随机 */
  seed?: number
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

  /** 正在等待玩家做选择的事件 */
  private pending: GameEvent | null = null

  constructor(data: GameData, options: NewGameOptions = {}) {
    this.data = data
    this.seed = options.seed ?? randomSeed()
    this.rng = mulberry32(this.seed)
    this.state = createInitialState(data.config)

    pushLog(
      this.state,
      'system',
      `开学了。你是计算机专业大三学生，本学期共 ${data.config.totalWeeks} 周，每周 ${data.config.actionPointsPerWeek} 点行动力。`,
    )
  }

  /* ---------------- 只读查询 ---------------- */

  getSeed(): number {
    return this.seed
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

  /** 当前可执行的行动（行动力够 + 条件满足） */
  availableActions(): ActionDef[] {
    const ctx = this.createContext()
    return this.data.actions.filter(
      (action) => action.cost <= this.state.actionPoints && evaluate(action.requires, ctx),
    )
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
    if (action.cost > this.state.actionPoints) throw new Error('行动力不足')
    if (!evaluate(action.requires, this.createContext())) {
      throw new Error(`行动条件不满足: ${actionId}`)
    }

    this.state.actionPoints -= action.cost
    pushLog(this.state, 'action', `〔第${this.state.week}周〕你选择了「${action.label}」`)
    applyEffects(this.createContext(), action.effects)

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
    pushLog(this.state, 'action', `你的选择：${choice.label}`)
    applyEffects(this.createContext(), choice.effects)

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
    applyEffects(this.createContext(), this.data.config.weeklyEffects)
    this.rollWeeklyEvent()
    this.maybeAdvance()
  }

  private rollWeeklyEvent(): void {
    if (this.rng() >= this.data.config.weeklyEventChance) return

    const ctx = this.createContext()
    const pool = this.data.events.filter((event) => {
      if (event.category !== 'random') return false
      if (!event.repeatable && this.state.seenEvents.includes(event.id)) return false
      return evaluate(event.requires, ctx)
    })

    const picked = pickWeighted(pool, (event) => event.weight ?? 1, this.rng)
    if (picked) this.triggerEvent(picked)
  }

  private triggerEvent(event: GameEvent): void {
    this.state.seenEvents.push(event.id)
    pushLog(this.state, 'event', `【${event.title}】${event.text}`)

    if (event.choices && event.choices.length > 0) {
      this.pending = event
      return
    }

    applyEffects(this.createContext(), event.effects ?? [])
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

  /** 学期结束，按优先级挑第一个满足条件的结局 */
  private settleEnding(): void {
    const ctx = this.createContext()
    const sorted = [...this.data.endings].sort((a, b) => a.priority - b.priority)
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
