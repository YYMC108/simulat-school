import { describeEffects } from '../../engine/effects'
import type { ProjectView } from '../../engine/types'

/**
 * 作品清单（展开后的内容）。
 *
 * 入口是行动面板标题行里的那个小 chip（见 ActionPanel）——
 * **刻意不让它占额外高度**：360×740 上垂直空间早就被算干净了
 *（`.panel` 的 `calc(100dvh - 220px)` 就是这么推出来的），
 * 再塞一行进去就会把行动选项挤到折叠线以下。
 * chip 是挤进已有的标题行里的，折叠状态下成本是 0。
 */
export function ProjectList({
  projects,
  actionPoints,
  onInvest,
}: {
  projects: ProjectView[]
  actionPoints: number
  onInvest: (projectId: string) => void
}) {
  if (projects.length === 0) return null

  return (
    <ul className="project-list">
      {projects.map((view) => {
        const cost = view.project.cost ?? 1
        const blocked = !view.unlocked || view.completed || cost > actionPoints
        const ratio = Math.min(1, view.progress / view.required)

        return (
          <li key={view.project.id}>
            <button
              type="button"
              className="project"
              disabled={blocked}
              onClick={() => onInvest(view.project.id)}
            >
              <span className="project-head">
                <span className="project-name">{view.project.name}</span>
                <span className="project-progress">
                  {view.completed
                    ? '已完成'
                    : view.unlocked
                      ? `${view.progress}/${view.required}`
                      : '未解锁'}
                </span>
              </span>

              <span className="project-bar" aria-hidden="true">
                <i
                  className={view.completed ? 'fill done' : 'fill'}
                  style={{ width: `${ratio * 100}%` }}
                />
              </span>

              <span className="project-desc">{view.project.description}</span>

              {!view.completed && view.unlocked && (
                <span className="project-preview">
                  每次投入：{describeEffects(view.project.perInvest) || '无属性变化'}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * 标题行里的作品入口 chip 要显示什么。
 *
 * 折叠状态下玩家仍需要看到「攒到哪了」—— 项目的全部魅力就是看着进度长起来。
 * 所以 chip 优先显示**进行中的那个**进度；都完成了就显示完成数。
 */
export function projectChipLabel(projects: ProjectView[]): string {
  if (projects.length === 0) return ''
  const done = projects.filter((view) => view.completed).length
  if (done === projects.length) return `作品 ${done}✓`

  const inProgress = projects.find((view) => view.unlocked && !view.completed && view.progress > 0)
  if (inProgress) return `作品 ${inProgress.progress}/${inProgress.required}`

  const ready = projects.find((view) => view.unlocked && !view.completed)
  if (ready) return '作品 可开工'

  return '作品 未解锁'
}
