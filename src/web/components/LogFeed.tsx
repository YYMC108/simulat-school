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
      {feed.map((entry, index) => (
        <article className={`log log-${entry.kind}`} key={index}>
          <p className="log-text">{entry.text}</p>
          <ChangeList changes={entry.changes} />
        </article>
      ))}
    </section>
  )
}
