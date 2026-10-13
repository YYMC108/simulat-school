import { useState } from 'react'

import { describeEffects } from '../../engine/effects'
import type { ActionDef, ProjectView } from '../../engine/types'
import { ProjectList, projectChipLabel } from './ProjectList'

/**
 * 行动面板（「这周做点什么」）。
 *
 * 效果预览用 `describeEffects(action.effects)`（**预告**：声明值），
 * 与日志里的**回执**（实际值）是两回事 —— 见技术文档 §4.4。
 * 这里刻意用灰色小字，让玩家能分清「说会做什么」和「实际做了什么」。
 *
 * ── 作品入口为什么挤在标题行里 ──
 * 手机上垂直空间是最稀缺的资源：`.panel` 的 `calc(100dvh - 220px)` 是由
 * 「顶栏 + 属性面板 + 日志区下限 + 底部留白」一项项推出来的，没有余量。
 * 所以在标题行右边放一个 chip 当入口（折叠时**不占额外高度**），
 * 展开的清单才追加在选项下面 —— 这时面板内部滚动是玩家自己要求的，
 * 和「选项被悄悄藏起来」是两回事。
 */
export function ActionPanel({
  actions,
  actionPoints,
  onAct,
  projects = [],
  onInvest,
}: {
  actions: ActionDef[]
  actionPoints: number
  onAct: (actionId: string) => void
  /** 本专业可见的项目（含未解锁与已完成）；传空数组就不显示作品入口 */
  projects?: ProjectView[]
  onInvest?: (projectId: string) => void
}) {
  const [projectsOpen, setProjectsOpen] = useState(false)
  const hasProjects = projects.length > 0 && onInvest !== undefined
  // 选项多到两行放不下时切到压缩模式（收起风味描述），见 styles.css 的长列表压缩模式
  const compact = actions.length >= 8

  return (
    <div className={compact ? 'panel panel-compact' : 'panel'}>
      <h2 className="panel-title">
        这周做点什么
        <span className="panel-hint">还剩 {actionPoints} 次行动</span>
        {hasProjects && (
          <button
            type="button"
            className={projectsOpen ? 'projects-chip open' : 'projects-chip'}
            aria-expanded={projectsOpen}
            onClick={() => setProjectsOpen((prev) => !prev)}
          >
            {projectChipLabel(projects)}
            <span className="projects-caret" aria-hidden="true">
              {projectsOpen ? '▾' : '▸'}
            </span>
          </button>
        )}
      </h2>

      <ul className="options">
        {actions.map((action) => (
          <li key={action.id}>
            <button type="button" className="option" onClick={() => onAct(action.id)}>
              {/* 标签和预告同一行、描述另起一行 —— 每个选项压在 2 行。
                  3 行会让行动超出手机屏幕，逼玩家在面板里滚动找选项，
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

      {hasProjects && projectsOpen && (
        <ProjectList projects={projects} actionPoints={actionPoints} onInvest={onInvest} />
      )}
    </div>
  )
}
