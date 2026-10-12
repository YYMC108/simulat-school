import { STAT_LABELS } from '../../engine/effects'
import type { StatChange } from '../../engine/types'

/**
 * 结算回执。
 *
 * 数据直接来自 `LogEntry.changes` —— 引擎算好的**实际**变化量，
 * 界面层**不做任何推断**（不去读 effect 数组、不自己 diff 前后状态）。
 * 这就是技术文档 §4.4「回执 vs 预告」里说的分工。
 */
export function ChangeList({ changes }: { changes?: StatChange[] }) {
  if (!changes || changes.length === 0) return null

  return (
    <ul className="changes">
      {changes.map((change) => {
        const sign = change.delta > 0 ? '+' : change.delta < 0 ? '−' : '±'
        const magnitude = Math.abs(change.delta)
        const text = change.key === 'money' ? `${sign}¥${magnitude}` : `${sign}${magnitude}`
        const tone = change.delta > 0 ? 'up' : change.delta < 0 ? 'down' : 'flat'
        const capNote =
          change.capped === undefined
            ? ''
            : change.capped === 'max'
              ? '已满'
              : '见底'

        return (
          <li className={`change change-${tone}`} key={change.key}>
            <span className="change-label">{STAT_LABELS[change.key]}</span>
            <span className="change-delta">{text}</span>
            {capNote && <span className="change-cap">{capNote}</span>}
          </li>
        )
      })}
    </ul>
  )
}
