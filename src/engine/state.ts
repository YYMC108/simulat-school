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

export function pushLog(state: GameState, kind: LogEntry['kind'], text: string): void {
  state.log.push({ week: state.week, kind, text })
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
