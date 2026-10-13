import type { MajorDef } from '../../engine/types'

/**
 * 开局界面：你是谁。
 *
 * 为什么专业选择要单独占一屏，而不是塞进游戏里的某处：
 * 这是玩家对本局**唯一一次不可撤销的身份选择**，而且它决定了后面 16 周
 * 你看得见哪些事件、能做哪些事、能做出什么东西。值得郑重一点。
 *
 * 卡片上刻意只写「是什么样的人」，不列数值偏移 ——
 * 数值差异本来就设计得很小（差异主要由行动/事件/项目承担），
 * 列出来反而会让玩家以为「选专业就是选属性」。
 */
export function StartScreen({
  majors,
  onStart,
}: {
  majors: MajorDef[]
  onStart: (majorId: string) => void
}) {
  return (
    <div className="start">
      <h1 className="start-title">🎓 大学生活模拟器</h1>
      <p className="start-sub">
        一个学期 16 周，每周 3 点行动力 —— 一共 48 次「认真做一件事」的机会。
        <br />
        先决定你是谁。
      </p>

      <ul className="majors">
        {majors.map((major) => (
          <li key={major.id}>
            <button type="button" className="major-card" onClick={() => onStart(major.id)}>
              <span className="major-name">{major.name}</span>
              <span className="major-identity">{major.identity}</span>
              <span className="major-desc">{major.description}</span>
            </button>
          </li>
        ))}
      </ul>

      <p className="start-note">
        专业决定你遇到哪些事、能做什么、以及最后能拿出什么作品。
      </p>
    </div>
  )
}
