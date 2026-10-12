/**
 * 命令行试玩版。
 *
 *   pnpm play
 *
 * 这个文件是「引擎可以脱离界面独立运行」的最好证明：
 * 同一份引擎代码，这里用命令行驱动，以后换成 React 驱动，引擎一行都不用改。
 *
 * ── 为什么不用 rl.question()？ ──
 * 踩过两个坑，都很隐蔽：
 *
 *   1. readline 在没有监听 'line' 事件时会把已缓冲的行**直接丢掉**。
 *      所以当你把输入重定向进程序（或终端一次性粘贴多行）时，
 *      只有当前 question() 挂着的那一行能被接住，剩下的全没了。
 *   2. question() 在输入流已结束（EOF）时，promise 永远不会 settle，
 *      进程会卡在 top-level await 上（Node 报 unsettled top-level await，
 *      退出码 13）。
 *
 * 改用 readline 的异步迭代器可以同时解决两个问题：它内部有行队列，
 * 且迭代结束会给出 done 而不是挂住。
 */
import { createInterface } from 'node:readline'
import process from 'node:process'

import { GAME_DATA } from '../data/index'
import { GameEngine } from '../engine/engine'
import { STAT_LABELS, describeEffects } from '../engine/effects'
import type { LogEntry, StatKey } from '../engine/types'

const STAT_ORDER: StatKey[] = ['academic', 'social', 'health', 'mood', 'money', 'skill']

/* ---------------- 显示 ---------------- */

function bar(value: number, max = 100, width = 18): string {
  const ratio = Math.max(0, Math.min(1, value / max))
  const filled = Math.round(ratio * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function formatStat(key: StatKey, value: number): string {
  if (key === 'money') return `${STAT_LABELS[key].padEnd(2, '　')} ¥${value}`
  const max = GAME_DATA.config.statRanges[key].max
  return `${STAT_LABELS[key].padEnd(2, '　')} ${bar(value, max)} ${String(value).padStart(3)}`
}

function renderState(engine: GameEngine): void {
  const state = engine.getState()
  const config = engine.getConfig()

  console.log('')
  console.log('═'.repeat(52))
  console.log(
    ` 第 ${state.week}/${config.totalWeeks} 周   行动力 ${'●'.repeat(state.actionPoints)}${'○'.repeat(
      Math.max(0, config.actionPointsPerWeek - state.actionPoints),
    )}`,
  )
  console.log('─'.repeat(52))
  for (const key of STAT_ORDER) {
    console.log(' ' + formatStat(key, state.stats[key]))
  }
  console.log('═'.repeat(52))
}

function printLogs(logs: LogEntry[]): void {
  for (const entry of logs) {
    const prefix =
      entry.kind === 'event'
        ? '❗'
        : entry.kind === 'ending'
          ? '🏁'
          : entry.kind === 'action'
            ? '▸'
            : '·'
    console.log(`${prefix} ${entry.text}`)
  }
}

/* ---------------- 输入 ---------------- */

/** 从异步迭代器读一行；返回 null 表示输入结束 */
async function readLine(
  lines: AsyncIterator<string>,
  prompt: string,
): Promise<string | null> {
  process.stdout.write(prompt)
  const next = await lines.next()
  return next.done ? null : next.value
}

async function askIndex(
  lines: AsyncIterator<string>,
  labels: string[],
  enabled: boolean[],
): Promise<number | null> {
  labels.forEach((label, index) => {
    console.log(`  ${index + 1}. ${label}${enabled[index] ? '' : '   [条件不足]'}`)
  })

  for (;;) {
    const answer = await readLine(lines, '> ')
    if (answer === null) return null // EOF，交给调用方优雅退出

    const raw = answer.trim()
    const index = Number.parseInt(raw, 10) - 1

    // 先区分「输入的不是有效序号」和「序号有效但该项不能用」——
    // 原来两种情况都回「输入无效」，玩家会以为是自己按错了，
    // 其实是他没钱选那一项。这两件事必须分开提示。
    if (!Number.isInteger(index) || index < 0 || index >= labels.length) {
      console.log(`  输入无效：请输入 1 到 ${labels.length} 之间的序号。`)
      continue
    }
    if (!enabled[index]) {
      console.log(`  第 ${index + 1} 项当前条件不足（后面标了 [条件不足]），请换一项。`)
      continue
    }

    return index
  }
}

/* ---------------- 主流程 ---------------- */

async function main(): Promise<void> {
  // 不传 output：让终端保持 cooked 模式，由终端负责回显和退格，
  // 我们自己写提示符。这样在真实终端和重定向输入下行为一致。
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  const lines = rl[Symbol.asyncIterator]()

  const engine = new GameEngine(GAME_DATA)

  console.log('\n🎓 大学生活模拟器 —— 命令行版')
  console.log('─'.repeat(52))
  console.log('你是计算机专业大三学生。本学期 16 周，每周 3 点行动力，')
  console.log('也就是一共只有 48 次「认真做一件事」的机会。')
  console.log('')
  console.log('六项属性互相牵制，你不可能全都拿到 —— 必须做取舍。')
  console.log('每周用完行动力后会结算，并可能触发一个事件让你做选择。')
  console.log('')
  console.log('怎么玩：输入选项前面的数字，按回车。')
  console.log('─'.repeat(52))
  console.log(`随机种子: ${engine.getSeed()}（记住它就能复现这一局）`)

  try {
    while (!engine.isEnded()) {
      const pending = engine.getPending()

      // 有事件在等选择时，必须先处理事件
      if (pending) {
        console.log('')
        console.log(`❗ ${pending.title}`)
        const views = engine.getPendingChoices()
        const index = await askIndex(
          lines,
          views.map((view) => view.choice.label),
          views.map((view) => view.enabled),
        )
        if (index === null) return
        printLogs(engine.choose(index).logs)
        continue
      }

      renderState(engine)
      const actions = engine.availableActions()
      const index = await askIndex(
        lines,
        actions.map(
          (action) =>
            `${action.label}  ${action.description}\n       ${describeEffects(action.effects)}`,
        ),
        actions.map(() => true),
      )
      if (index === null) return
      printLogs(engine.takeAction(actions[index]!.id).logs)
    }

    const ending = engine.getEnding()
    const state = engine.getState()
    console.log('')
    console.log('═'.repeat(52))
    console.log(`🏁 结局：${ending?.title ?? '未知'}`)
    console.log(ending?.text ?? '')
    console.log('─'.repeat(52))
    for (const key of STAT_ORDER) {
      console.log(' ' + formatStat(key, state.stats[key]))
    }
    console.log('═'.repeat(52))
  } finally {
    rl.close()
  }
}

await main()
