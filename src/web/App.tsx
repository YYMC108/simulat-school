import { GAME_DATA } from '../data/index'
import { ActionPanel } from './components/ActionPanel'
import { EndingScreen } from './components/EndingScreen'
import { EventPanel } from './components/EventPanel'
import { LogFeed } from './components/LogFeed'
import { StartScreen } from './components/StartScreen'
import { StatsPanel } from './components/StatsPanel'
import { useEngine } from './useEngine'

/**
 * 页面骨架：顶部状态栏 + 属性面板 + 可滚动的日志流 + 底部操作区。
 *
 * 底部操作区**按相位切换**内容（行动 / 事件选项），这与引擎的相位控制一一对应：
 * 有 `pending` 事件时引擎会冻结时间、`takeAction` 会抛错，
 * 所以界面这里也必须在同一个条件下只给选项 —— 但判断条件是引擎给的
 * （`game.pending`），不是 UI 自己推出来的。
 *
 * 阶段 2 多了一屏「选专业」：没开局时整页换成 StartScreen。
 * 地址栏带了 `?major=<id>` 会直接开局跳过它（分享链接 / 布局回归脚本都靠这个）。
 */
export function App({
  initialMajorId,
  initialSeed,
}: {
  /** 跳过开局界面直接开局（测试与「分享链接」用；生产环境走 URL / 开局界面） */
  initialMajorId?: string
  initialSeed?: number
} = {}) {
  const game = useEngine({ majorId: initialMajorId, seed: initialSeed })

  if (!game.started || game.state === null || game.major === null) {
    return <StartScreen majors={game.majors} onStart={game.start} />
  }

  // 收进局部常量：TS 的收窄不会穿过 JSX 里的箭头函数（Array.from 的回调）
  const state = game.state
  const major = game.major
  const { totalWeeks, actionPointsPerWeek } = GAME_DATA.config

  return (
    <div className="app">
      {/* 顶栏横跨整宽：它是**应用级**的状态（第几周、剩几点行动力、种子、重开），
          不属于任何一栏。这样下面的两栏就能从同一条水平线开始，卡片顶边对齐。 */}
      <header className="topbar">
        <span className="topbar-week">
          第 <strong>{state.week}</strong>/{totalWeeks} 周
        </span>
        <span className="topbar-ap" aria-label={`剩余 ${state.actionPoints} 次行动`}>
          {Array.from({ length: actionPointsPerWeek }, (_, index) => (
            <i key={index} className={index < state.actionPoints ? 'dot on' : 'dot'} />
          ))}
        </span>
        <span className="topbar-major" title={major.identity}>
          {major.name}
        </span>
        <span className="topbar-seed" title="随机种子，同一局可复现">
          #{game.seed}
        </span>
        <button type="button" className="button-ghost button-sm" onClick={() => game.restart()}>
          重开
        </button>
      </header>

      {/* 两栏是**桌面专属**的：手机上 .col-main / .col-side 仍是上下堆叠，
          几何与加这两个包裹层之前完全一致（由 measure:layout 的移动端数字守着）。
          分栏切换只发生在 CSS 的 @media (min-width: 1000px) 里。 */}
      <div className="col-body">
        <div className="col-main">
          <StatsPanel stats={state.stats} />

          <LogFeed feed={game.feed} />
        </div>

        <div className="col-side">
          {!game.ended && (
            <footer className="bottom">
              {game.pending ? (
                <EventPanel
                  event={game.pending}
                  choices={game.choices}
                  onChoose={game.choosing}
                />
              ) : (
                <ActionPanel
                  actions={game.actions}
                  actionPoints={state.actionPoints}
                  onAct={game.acting}
                  projects={game.projects}
                  onInvest={game.investing}
                />
              )}
            </footer>
          )}
        </div>
      </div>

      {game.ended && game.ending && (
        <EndingScreen
          ending={game.ending}
          state={state}
          summary={game.summary}
          seed={game.seed}
          onRestart={game.restart}
          onChangeMajor={game.changeMajor}
        />
      )}
    </div>
  )
}
