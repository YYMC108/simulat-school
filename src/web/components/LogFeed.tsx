import { useEffect, useRef } from 'react'

import type { LogEntry } from '../../engine/types'
import { ChangeList } from './ChangeList'

/**
 * 事件记录流。
 *
 * 引擎只返回**增量**日志（`TurnResult.logs`），累积是界面层的责任 ——
 * 这也正是引擎接口这样设计的原因：UI 只想渲染「刚发生了什么」，
 * 让它自己去 diff 全量日志很别扭。这里把增量攒成一条可滚动的历史。
 *
 * `key` 用下标是安全的：这个数组只追加，不重排、不删除。
 */
export function LogFeed({ feed }: { feed: LogEntry[] }) {
  const boxRef = useRef<HTMLElement | null>(null)

  // 新日志出现时滚到底部。
  // 直接设 scrollTop 而不是用 scrollIntoView —— 后者可能把整个页面也滚走。
  useEffect(() => {
    const box = boxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [feed.length])

  return (
    <section className="feed" aria-label="事件记录" ref={boxRef}>
      {/* 开局日志只有一条时，上方会空出一片。
          与其留白，不如用它告诉第一次玩的人这游戏怎么玩 —— 空白变成引导。
          刻意压成**一行**：两行在小屏（360×740）上会超出日志区，第一行被裁掉。
          与其去抠内边距和行高，不如把文案写短。 */}
      {feed.length <= 1 && (
        <p className="feed-hint">选你想做的事 —— 每周 3 次行动，用完就进入下一周。</p>
      )}

      {feed.map((entry, index) => (
        <article className={`log log-${entry.kind}`} key={index}>
          <p className="log-text">{entry.text}</p>
          <ChangeList changes={entry.changes} />
        </article>
      ))}
    </section>
  )
}
