import type { Ending, GameState } from '../../engine/types'
import { StatsPanel } from './StatsPanel'

/** 结局页：全屏覆盖，给出最终成绩和重开入口 */
export function EndingScreen({
  ending,
  state,
  seed,
  onRestart,
}: {
  ending: Ending
  state: GameState
  seed: number
  onRestart: (seed?: number) => void
}) {
  return (
    <div className="ending" role="dialog" aria-modal="true" aria-label="结局">
      <div className="ending-card">
        <p className="ending-kicker">结局</p>
        <h2 className="ending-title">{ending.title}</h2>
        <p className="ending-text">{ending.text}</p>

        <h3 className="ending-subtitle">最终属性</h3>
        <StatsPanel stats={state.stats} />

        <div className="ending-actions">
          <button type="button" className="button-primary" onClick={() => onRestart()}>
            再来一局
          </button>
          <button type="button" className="button-ghost" onClick={() => onRestart(seed)}>
            重玩这一局（种子 {seed}）
          </button>
        </div>

        <p className="ending-note">
          同一局的可复现性来自「注入随机种子」——同一个种子配上同样的选择，
          结果完全一致。地址栏里的 <code>?seed={seed}</code> 可以分享给朋友。
        </p>
      </div>
    </div>
  )
}
