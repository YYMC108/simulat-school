import { GAME_DATA } from '../../data/index'
import { STAT_LABELS, STAT_ORDER } from '../../engine/effects'
import type { Stats } from '../../engine/types'

/**
 * 属性面板。
 *
 * 只读，不持有任何状态 —— 所有数据都来自引擎快照。
 * 数值范围从 `config.statRanges` 取，不在组件里硬编码 100。
 */
export function StatsPanel({ stats }: { stats: Stats }) {
  return (
    <section className="stats" aria-label="属性">
      {STAT_ORDER.map((key) => {
        const value = stats[key]
        const range = GAME_DATA.config.statRanges[key]
        const isMoney = key === 'money'
        const ratio = isMoney ? 0 : (value - range.min) / (range.max - range.min)

        return (
          <div className="stat" key={key}>
            <span className="stat-label">{STAT_LABELS[key]}</span>
            {isMoney ? (
              <span className="stat-money">¥{value}</span>
            ) : (
              <>
                <span className="stat-bar" aria-hidden="true">
                  <span
                    className={`stat-bar-fill${ratio <= 0.2 ? ' is-low' : ''}`}
                    style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
                  />
                </span>
                <span className="stat-value">{value}</span>
              </>
            )}
          </div>
        )
      })}
    </section>
  )
}
