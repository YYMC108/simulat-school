import type { GameConfig, GameState, LogEntry } from './types'

/** 开一个新档 */
export function createInitialState(config: GameConfig): GameState {
  return {
    week: 1,
    actionPoints: config.actionPointsPerWeek,
    stats: { ...config.initialStats },
    flags: {},
    seenEvents: [],
    log: [],
    endingId: null,
  }
}

/**
 * 追加一条日志，并把这条日志**返回**给调用方。
 *
 * 返回它是为了能在效果结算完之后把实际变化量挂上去（`entry.changes`）：
 * 日志必须先写（这样效果里的 `log` 才会排在它后面，叙事顺序才对），
 * 但变化量只有结算完才知道，所以只能「先写日志、后补变化」。
 */
export function pushLog(state: GameState, kind: LogEntry['kind'], text: string): LogEntry {
  const entry: LogEntry = { week: state.week, kind, text }
  state.log.push(entry)
  return entry
}

/**
 * 深拷贝状态。
 *
 * 引擎内部是可变（mutable）的，但对外的 getState() 永远返回副本，
 * 这样调用方没法从外部改坏引擎内部状态。等以后接 React 时，
 * 这种「对外不可变」的语义是必须的。
 */
export function cloneState(state: GameState): GameState {
  return structuredClone(state)
}
