import type { Ending, GameState, RunSummary } from '../../engine/types'
import { StatsPanel } from './StatsPanel'

/**
 * 结算页：学期回顾 + 结局 + 重开入口。
 *
 * 回顾文案由**引擎**产出（`engine.getSummary()`），这里只负责排版 ——
 * 和 CLI 用的是同一份数据，所以「命令行玩」和「浏览器玩」看到的是同一段叙述。
 *
 * 内容可能很长（30 多条回顾），所以整页可滚动。
 */
export function EndingScreen({
  ending,
  state,
  summary,
  seed,
  onRestart,
  onChangeMajor,
}: {
  ending: Ending
  state: GameState
  summary: RunSummary | null
  seed: number
  onRestart: (seed?: number) => void
  /** 回到开局界面重新选专业（阶段 2：一局结束后最自然的「换个身份」时机） */
  onChangeMajor?: () => void
}) {
  return (
    <div className="ending" role="dialog" aria-modal="true" aria-label="学期结算">
      <div className="ending-card">
        <p className="ending-kicker">{summary ? summary.identity : '大学'} · 本学期结算</p>
        <h2 className="ending-title">{ending.title}</h2>
        <p className="ending-text">{ending.text}</p>

        {summary && summary.lines.length > 0 && (
          <>
            <h3 className="ending-subtitle">这学期，你——</h3>
            <ul className="ending-lines">
              {summary.lines.map((line) => (
                // 文案本身已经保证唯一（见「无死规则」测试），可以直接当 key
                <li key={line.text} className={`ending-line ending-line-${line.kind}`}>
                  {line.text}
                </li>
              ))}
            </ul>
          </>
        )}

        {summary && <p className="ending-verdict">{summary.verdict}</p>}

        <h3 className="ending-subtitle">最终属性</h3>
        <StatsPanel stats={state.stats} />

        <div className="ending-actions">
          <button type="button" className="button-primary" onClick={() => onRestart()}>
            再来一局
          </button>
          <button type="button" className="button-ghost" onClick={() => onRestart(seed)}>
            重玩这一局（种子 {seed}）
          </button>
          {onChangeMajor && (
            <button type="button" className="button-ghost" onClick={onChangeMajor}>
              换个专业
            </button>
          )}
        </div>

        <p className="ending-note">
          同一局的可复现性来自「注入随机种子」——同一个种子配上同样的选择，
          结果完全一致。地址栏里的 <code>?seed={seed}</code> 可以分享给朋友。
        </p>
      </div>
    </div>
  )
}
