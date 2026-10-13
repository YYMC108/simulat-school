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
import { STAT_LABELS, STAT_ORDER, describeEffects } from '../engine/effects'
import type { LogEntry, StatChange, StatKey } from '../engine/types'
import { createColors, detectColorSupport, displayWidth } from './text'

const c = createColors(detectColorSupport())

/** 结算回执里每个单元格的显示宽度（CJK 感知） */
const CHANGE_CELL_WIDTH = 14
/** 每行放几个属性变化 */
const CHANGES_PER_ROW = 3

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

/**
 * 把一个属性变化格式化成「+4」/「−2」/「+¥280」这种纯文本。
 * 用真正的减号 `−`（U+2212）而不是连字符，等宽字体下视觉宽度更均衡。
 */
function formatChangeValue(change: StatChange): string {
  const sign = change.delta > 0 ? '+' : change.delta < 0 ? '−' : '±'
  const magnitude = Math.abs(change.delta)
  return change.key === 'money' ? `${sign}¥${magnitude}` : `${sign}${magnitude}`
}

/**
 * 打印结算回执 —— 这一周 / 这个选项到底改了什么。
 *
 * 这里刻意用的是引擎算出来的**实际**变化量，而不是效果数组里声明的意图：
 * 属性触顶时声明 `+4` 实际只有 `+2`，显示后者才是真话。
 */
function printChanges(changes: StatChange[] | undefined): void {
  if (!changes || changes.length === 0) return

  const cells = changes.map((change) => {
    const label = STAT_LABELS[change.key]
    const value = formatChangeValue(change)
    const colorize =
      change.delta > 0 ? c.green : change.delta < 0 ? c.red : c.dim
    return {
      plain: `${label} ${value}`,
      colored: `${label} ${colorize(value)}`,
    }
  })

  // 先按「纯文本宽度」补空格，再拼上带颜色的版本，
  // 否则颜色转义序列会被算进宽度导致错位
  for (let i = 0; i < cells.length; i += CHANGES_PER_ROW) {
    let line = '    '
    for (const cell of cells.slice(i, i + CHANGES_PER_ROW)) {
      line += cell.colored + ' '.repeat(Math.max(0, CHANGE_CELL_WIDTH - displayWidth(cell.plain)))
    }
    console.log(line.trimEnd())
  }

  // 触顶/见底的解释单独一行，避免把单元格撑得过宽。
  // 措辞要区分两种情况：完全没生效（+0）和只是被截断（+3 而不是 +4）。
  const notes = changes
    .filter((change) => change.capped !== undefined)
    .map((change) => {
      const label = `${STAT_LABELS[change.key]}${change.capped === 'max' ? '已满' : '见底'}`
      return change.delta === 0 ? `${label}，本次没有生效` : label
    })
  if (notes.length > 0) {
    console.log(c.dim(`    （${notes.join('；')}）`))
  }
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
    printChanges(entry.changes)
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

/**
 * 输入流结束时必须**说出来**。
 *
 * 之前这里是静默 `return`：如果 stdin 提前结束（重定向的输入用完了、
 * 终端断了、或者管道被关闭），程序会直接退出、什么都不打印，
 * 玩家会以为游戏崩了 —— 其实只是没输入了。
 */
function announceEof(engine: GameEngine): void {
  const state = engine.getState()
  console.log('')
  console.log(c.yellow(`输入已结束，这一局没有玩完（停在第 ${state.week} 周）。`))
  console.log(c.dim(`想重来这一局：pnpm play -- --seed ${engine.getSeed()}`))
}

async function main(): Promise<void> {
  // 不传 output：让终端保持 cooked 模式，由终端负责回显和退格，
  // 我们自己写提示符。这样在真实终端和重定向输入下行为一致。
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  const lines = rl[Symbol.asyncIterator]()

  // 支持 --seed N：CLI 一直在打印种子并说「记住它就能复现这一局」，
  // 但之前根本没办法把种子传回来 —— 这个承诺是空的。补上。
  const seedFlagIndex = process.argv.indexOf('--seed')
  const parsedSeed = Number.parseInt(process.argv[seedFlagIndex + 1] ?? '', 10)
  const engine = new GameEngine(
    GAME_DATA,
    Number.isInteger(parsedSeed) ? { seed: parsedSeed } : {},
  )

  console.log('\n🎓 大学生活模拟器 —— 命令行版')
  console.log('─'.repeat(52))
  console.log('你是计算机专业大三学生。本学期 16 周，每周 3 点行动力，')
  console.log('也就是一共只有 48 次「认真做一件事」的机会。')
  console.log('')
  console.log('六项属性互相牵制，你不可能全都拿到 —— 必须做取舍。')
  console.log('每周用完行动力后进入下一周，并可能触发一个事件让你做选择。')
  console.log('')
  console.log('另外每周有一笔「固定衰减」：不投入的属性会自然退步，生活费也会扣掉。')
  console.log('它和你这周做了什么无关 —— 所以你得持续投入才守得住。')
  console.log('（结算里那一行只报告这笔固定衰减；你的行动效果显示在自己的行上。）')
  console.log('')
  console.log('怎么玩：输入选项前面的数字，按回车。')
  console.log('复现某局：pnpm play -- --seed <种子>')
  console.log('─'.repeat(52))
  console.log(`随机种子: ${engine.getSeed()}`)

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
        if (index === null) {
          announceEof(engine)
          return
        }
        printLogs(engine.choose(index).logs)
        continue
      }

      renderState(engine)
      const actions = engine.availableActions()
      const index = await askIndex(
        lines,
        actions.map(
          (action) =>
            // 预告用灰色、回执用彩色：玩家一眼能分清
            // 「这个选项说它会做什么」和「它实际做了什么」
            `${action.label}  ${action.description}\n       ${c.dim(describeEffects(action.effects))}`,
        ),
        actions.map(() => true),
      )
      if (index === null) {
        announceEof(engine)
        return
      }
      printLogs(engine.takeAction(actions[index]!.id).logs)
    }

    const ending = engine.getEnding()
    const summary = engine.getSummary()
    const rule = '─'.repeat(56)

    console.log('')
    console.log('═'.repeat(56))
    console.log(` ${summary.identity} · 本学期结算`)
    console.log('═'.repeat(56))

    if (summary.lines.length > 0) {
      console.log('')
      console.log(' 这 16 周里，你——')
      console.log('')
      for (const line of summary.lines) {
        console.log(`   · ${line.text}`)
      }
    }

    console.log('')
    console.log(rule)
    for (const key of STAT_ORDER) {
      console.log(' ' + formatStat(key, summary.stats[key]))
    }
    console.log(rule)

    console.log('')
    console.log(` ${summary.verdict}`)
    console.log('')
    console.log(` 🏁 ${ending?.title ?? '未知'}`)
    console.log(`    ${ending?.text ?? ''}`)
    console.log('')
    console.log(` 种子 ${summary.seed} —— 同样的种子配上同样的选择，结果完全一致`)
    console.log('═'.repeat(56))
  } finally {
    rl.close()
  }
}

await main()
