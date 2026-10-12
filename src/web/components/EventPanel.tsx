import type { ChoiceView } from '../../engine/engine'
import type { GameEvent } from '../../engine/types'

/**
 * 事件面板：取代行动面板出现在底部。
 *
 * 这个「面板按相位切换」直接对应引擎的相位控制 ——
 * 有 `pending` 事件时引擎会**冻结时间**、`takeAction` 会抛错，
 * 所以界面这里也必须只给选项，不给行动。UI 不用自己判断能不能行动，
 * 引擎已经挡住非法操作了（技术文档 §5.3）。
 *
 * 刻意**不显示**每个选项的属性影响：这是叙事游戏，
 * 玩家应该按剧情选，而不是按数字选。而且带 `branch` 的选项
 * 连引擎都给不出准确的预告（技术文档 §9.2）。
 */
export function EventPanel({
  event,
  choices,
  onChoose,
}: {
  event: GameEvent
  choices: ChoiceView[]
  onChoose: (index: number) => void
}) {
  return (
    <div className="panel panel-event">
      <h2 className="panel-title">{event.title}</h2>
      <p className="panel-text">{event.text}</p>

      <ul className="options">
        {choices.map((view, index) => (
          <li key={view.choice.label}>
            <button
              type="button"
              className="option"
              // enabled 是引擎算好的（getPendingChoices），UI 不自己判断条件
              disabled={!view.enabled}
              onClick={() => onChoose(index)}
            >
              <span className="option-head">
                <span className="option-label">{view.choice.label}</span>
                {!view.enabled && <span className="option-locked">条件不足</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
