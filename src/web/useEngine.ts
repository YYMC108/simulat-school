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
  MajorDef,
  ProjectView,
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
  /** 本局专业（开局界面选的那个） */
  major: MajorDef
  /** 本局可见的项目（含未解锁与已完成） */
  projects: ProjectView[]
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
    major: engine.getMajor(),
    projects: engine.getProjects(),
    summary: ended ? engine.getSummary() : null,
  }
}

export interface EngineView {
  /** 还没有开局（正在选专业）时为 false */
  started: boolean
  /** 可选专业（开局界面用） */
  majors: MajorDef[]

  state: GameState | null
  actions: ActionDef[]
  projects: ProjectView[]
  pending: GameEvent | null
  choices: ChoiceView[]
  ending: Ending | null
  ended: boolean
  seed: number
  major: MajorDef | null
  summary: RunSummary | null
  /** 累计的日志流。引擎只返回「本次新增」，累积是界面层的责任 */
  feed: LogEntry[]

  /** 选一个专业开局 */
  start: (majorId: string) => void
  acting: (actionId: string) => void
  choosing: (index: number) => void
  investing: (projectId: string) => void
  /** 同一专业重开（不传 seed 就换新种子） */
  restart: (seed?: number) => void
  /** 回到开局界面重新选专业 */
  changeMajor: () => void
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

/**
 * 从地址栏读 `?major=<id>`。
 *
 * 有它就**直接进游戏**（跳过开局界面）—— 两个用处：
 *   1. 分享链接：「我在文科这局……你也来玩同一个专业」
 *   2. 布局回归脚本可以绕过开局屏，直接量游戏内界面（见 scripts/measure-layout.mjs）
 * 认不出来的 id 一律当没写，让玩家回到开局界面自己选，而不是白屏。
 */
function majorFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('major')
  if (raw === null) return null
  return GAME_DATA.majors.some((major) => major.id === raw) ? raw : null
}

/** 把当前这局的专业与种子写回地址栏，让链接可以分享 */
function syncUrl(majorId: string, seed: number): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('major', majorId)
  url.searchParams.set('seed', String(seed))
  window.history.replaceState(null, '', url)
}

export interface UseEngineOptions {
  /**
   * 指定初始专业（跳过开局界面）。
   * 生产环境不传 —— 它只服务于测试（Node 里没有 window，传不了 `?major=`）。
   */
  majorId?: string
  /** 指定初始种子，同样主要为测试服务 */
  seed?: number
}

export function useEngine(options: UseEngineOptions = {}): EngineView {
  // 初始种子放在 state 里而不是直接 randomSeed()：
  // React 的 StrictMode 会双次渲染，放 state 里能保证两次拿到同一个种子，
  // 不会在开发模式下偷偷开出两局不同的游戏
  const [initialSeed] = useState(() => options.seed ?? seedFromUrl() ?? randomSeed())
  const [initialMajor] = useState(() => options.majorId ?? majorFromUrl())

  const engineRef = useRef<GameEngine | null>(null)
  // 地址栏带了合法专业 → 直接开局；否则停在「选专业」界面
  if (engineRef.current === null && initialMajor !== null) {
    engineRef.current = new GameEngine(GAME_DATA, { seed: initialSeed, majorId: initialMajor })
  }
  const engine = engineRef.current

  const [snapshot, setSnapshot] = useState<Snapshot | null>(() =>
    engine === null ? null : takeSnapshot(engine),
  )
  const [feed, setFeed] = useState<LogEntry[]>(() => (engine === null ? [] : engine.getState().log))

  /** 每次操作后统一同步：追加新日志 + 重新取快照 */
  const sync = useCallback((logs: LogEntry[]) => {
    setFeed((prev) => [...prev, ...logs])
    setSnapshot(takeSnapshot(engineRef.current!))
  }, [])

  const start = useCallback((majorId: string, seed?: number) => {
    const nextSeed = seed ?? randomSeed()
    const next = new GameEngine(GAME_DATA, { seed: nextSeed, majorId })
    engineRef.current = next
    syncUrl(majorId, nextSeed)
    setFeed(next.getState().log)
    setSnapshot(takeSnapshot(next))
  }, [])

  // 所有回调都从 ref 里取引擎，**不捕获 engine 变量** ——
  // 否则 restart() 之后回调还指着旧引擎（这是 React 里很常见的 ref 陷阱）
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

  const investing = useCallback(
    (projectId: string) => {
      sync(engineRef.current!.investProject(projectId).logs)
    },
    [sync],
  )

  const restart = useCallback(
    (seed?: number) => {
      const current = engineRef.current
      // 重开保持同一个专业：玩家点「再来一局」是想换个玩法，不是想重新选身份
      const majorId = current?.getMajor().id ?? GAME_DATA.majors[0]!.id
      start(majorId, seed)
    },
    [start],
  )

  const changeMajor = useCallback(() => {
    engineRef.current = null
    setSnapshot(null)
    setFeed([])
  }, [])

  return {
    started: snapshot !== null,
    majors: GAME_DATA.majors,
    state: snapshot?.state ?? null,
    actions: snapshot?.actions ?? [],
    projects: snapshot?.projects ?? [],
    pending: snapshot?.pending ?? null,
    choices: snapshot?.choices ?? [],
    ending: snapshot?.ending ?? null,
    ended: snapshot?.ended ?? false,
    seed: snapshot?.seed ?? 0,
    major: snapshot?.major ?? null,
    summary: snapshot?.summary ?? null,
    feed,
    start,
    acting,
    choosing,
    investing,
    restart,
    changeMajor,
  }
}
