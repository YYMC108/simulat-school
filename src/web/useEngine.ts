/**
 * 引擎与 React 之间的**唯一**适配层。
 *
 * 这个文件存在的意义：让 React 组件完全不认识引擎的内部结构，
 * 只用 §「稳定契约」里那几个公开方法（技术文档 §2.2）。
 *
 * 关键设计：引擎内部是**可变**的，但 `getState()` 返回**深拷贝**。
 * 所以「每次操作后重新取一份快照、靠新对象引用触发重渲染」就能直接用
 * `useState`，**不需要任何状态管理库**（Redux / Zustand 在这里都是多余的）。
 * 这与 CLI 的驱动方式完全一样 —— 同一套引擎，两个界面层。
 */
import { useCallback, useRef, useState } from 'react'

import { GAME_DATA } from '../data/index'
import type { ChoiceView } from '../engine/engine'
import { GameEngine } from '../engine/engine'
import { randomSeed } from '../engine/rng'
import type {
  ActionDef,
  Ending,
  GameEvent,
  GameState,
  LogEntry,
  RunSummary,
} from '../engine/types'

/** 一次快照：UI 需要的全部只读数据 */
interface Snapshot {
  state: GameState
  actions: ActionDef[]
  pending: GameEvent | null
  choices: ChoiceView[]
  ending: Ending | null
  ended: boolean
  seed: number
  /** 学期结算回顾。没走到结局时为 null —— 只在结局页需要，不必每步都算 */
  summary: RunSummary | null
}

function takeSnapshot(engine: GameEngine): Snapshot {
  const ended = engine.isEnded()
  return {
    state: engine.getState(),
    actions: engine.availableActions(),
    pending: engine.getPending(),
    choices: engine.getPendingChoices(),
    ending: engine.getEnding(),
    ended,
    seed: engine.getSeed(),
    summary: ended ? engine.getSummary() : null,
  }
}

export interface EngineView extends Snapshot {
  /** 累计的日志流。引擎只返回「本次新增」，累积是界面层的责任 */
  feed: LogEntry[]
  acting: (actionId: string) => void
  choosing: (index: number) => void
  restart: (seed?: number) => void
}

/**
 * 从地址栏读 `?seed=N`，让「复现某一局」可以通过链接分享。
 *
 * 刻意检查 `window` 是否存在：这样这个模块在非浏览器环境（Node、测试）里
 * 也能安全 import —— 于是可以在 Node 里用 `renderToString` 把整个组件树
 * 渲染一遍来验证，而不只是验证「能打包」。
 */
function seedFromUrl(): number | null {
  if (typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('seed')
  if (raw === null) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) ? parsed : null
}

export function useEngine(): EngineView {
  // 初始种子放在 state 里而不是直接 randomSeed()：
  // React 的 StrictMode 会双次渲染，放 state 里能保证两次拿到同一个种子，
  // 不会在开发模式下偷偷开出两局不同的游戏
  const [initialSeed] = useState(() => seedFromUrl() ?? randomSeed())

  const engineRef = useRef<GameEngine | null>(null)
  if (engineRef.current === null) {
    engineRef.current = new GameEngine(GAME_DATA, { seed: initialSeed })
  }

  // 所有回调都从 ref 里取引擎，**不捕获 engine 变量** ——
  // 否则 restart() 之后回调还指着旧引擎（这是 React 里很常见的 ref 陷阱）
  const [snapshot, setSnapshot] = useState<Snapshot>(() => takeSnapshot(engineRef.current!))
  const [feed, setFeed] = useState<LogEntry[]>(() => engineRef.current!.getState().log)

  /** 每次操作后统一同步：追加新日志 + 重新取快照 */
  const sync = useCallback((logs: LogEntry[]) => {
    setFeed((prev) => [...prev, ...logs])
    setSnapshot(takeSnapshot(engineRef.current!))
  }, [])

  const acting = useCallback(
    (actionId: string) => {
      // takeAction 会在非法操作时抛错（fail fast）。UI 传进来的 id
      // 都来自 availableActions()，所以正常路径不会走到 catch。
      // 这里不吞异常，让它在控制台暴露出来方便排查。
      sync(engineRef.current!.takeAction(actionId).logs)
    },
    [sync],
  )

  const choosing = useCallback(
    (index: number) => {
      sync(engineRef.current!.choose(index).logs)
    },
    [sync],
  )

  const restart = useCallback((seed?: number) => {
    const next = new GameEngine(GAME_DATA, { seed: seed ?? randomSeed() })
    engineRef.current = next
    // 新引擎的构造函数会写入一条开场日志，所以只取它自己的 log
    setFeed(next.getState().log)
    setSnapshot(takeSnapshot(next))
  }, [])

  return { ...snapshot, feed, acting, choosing, restart }
}
