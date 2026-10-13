import { GAME_DATA } from '../data/index'
import { ActionPanel } from './components/ActionPanel'
import { EndingScreen } from './components/EndingScreen'
import { EventPanel } from './components/EventPanel'
import { LogFeed } from './components/LogFeed'
import { StatsPanel } from './components/StatsPanel'
import { useEngine } from './useEngine'

/**
 * 页面骨架：顶部状态栏 + 属性面板 + 可滚动的日志流 + 底部操作区。
 *
 * 底部操作区**按相位切换**内容（行动 / 事件选项），这与引擎的相位控制一一对应：
 * 有 `pending` 事件时引擎会冻结时间、`takeAction` 会抛错，
 * 所以界面这里也必须在同一个条件下只给选项 —— 但判断条件是引擎给的
 * （`game.pending`），不是 UI 自己推出来的。
 */
export function App() {
  const game = useEngine()
  const { totalWeeks, actionPointsPerWeek } = GAME_DATA.config

  return (
    <div className="app">
      <header className="topbar">
        <span className="topbar-week">
          第 <strong>{game.state.week}</strong>/{totalWeeks} 周
        </span>
        <span className="topbar-ap" aria-label={`剩余 ${game.state.actionPoints} 次行动`}>
          {Array.from({ length: actionPointsPerWeek }, (_, index) => (
            <i key={index} className={index < game.state.actionPoints ? 'dot on' : 'dot'} />
          ))}
        </span>
        <span className="topbar-seed" title="随机种子，同一局可复现">
          #{game.seed}
        </span>
        <button type="button" className="button-ghost button-sm" onClick={() => game.restart()}>
          重开
        </button>
      </header>

      <StatsPanel stats={game.state.stats} />

      <LogFeed feed={game.feed} />

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
              actionPoints={game.state.actionPoints}
              onAct={game.acting}
            />
          )}
        </footer>
      )}

      {game.ended && game.ending && (
        <EndingScreen
          ending={game.ending}
          state={game.state}
          summary={game.summary}
          seed={game.seed}
          onRestart={game.restart}
        />
      )}
    </div>
  )
}
