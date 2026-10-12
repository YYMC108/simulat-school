import { describeEffects } from '../../engine/effects'
import type { ActionDef } from '../../engine/types'

/**
 * 行动面板。
 *
 * 效果预览用 `describeEffects(action.effects)`（**预告**：声明值），
 * 与日志里的**回执**（实际值）是两回事 —— 见技术文档 §4.4。
 * 这里刻意用灰色小字，让玩家能分清「说会做什么」和「实际做了什么」。
 */
export function ActionPanel({
  actions,
  actionPoints,
  onAct,
}: {
  actions: ActionDef[]
  actionPoints: number
  onAct: (actionId: string) => void
}) {
  return (
    <div className="panel">
      <h2 className="panel-title">
        这周做点什么
        <span className="panel-hint">还剩 {actionPoints} 次行动</span>
      </h2>

      <ul className="options">
        {actions.map((action) => (
          <li key={action.id}>
            <button type="button" className="option" onClick={() => onAct(action.id)}>
              {/* 标签和预告同一行、描述另起一行 —— 每个选项压在 2 行。
                  3 行会让 6 个行动超出手机屏幕，逼玩家在面板里滚动找选项，
                  而「选行动」是核心操作，不该藏起来。 */}
              <span className="option-head">
                <span className="option-label">{action.label}</span>
                <span className="option-preview">{describeEffects(action.effects)}</span>
              </span>
              <span className="option-desc">{action.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
