#!/usr/bin/env node
/**
 * 布局回归检查 —— 用真实浏览器测量，确认没有东西被挤出屏幕。
 *
 *   pnpm measure:layout                       # 检查 http://localhost:5173/
 *   pnpm measure:layout -- http://localhost:4173/
 *
 * ── 为什么需要这个脚本 ──
 * 布局问题**无法用单元测试覆盖**（`renderToString` 只产出 HTML，没有排版）。
 * 而它很难靠眼睛发现：我在开发这个界面时，桌面和移动端都出现了
 * 「6 个行动只显示 4 个，必须往面板里滚动才能看到剩下的」——
 * 截图看着只是"有点挤"，但真实数字是面板 clientHeight=386 / scrollHeight=590，
 * 也就是有 204px 的关键内容藏在折叠线下面。
 *
 * 所以这里把「测量」而不是「看着还行」作为判据。
 *
 * ── 两个坑（都是踩过的）──
 * 1. 不要用 `msedge --window-size=390,844 --screenshot`：
 *    Edge 在 Windows 上对窗口宽度有最小值，视口不会真的变成 390，
 *    截图会显示宽布局的左半边，看起来像「页面横向溢出了」——完全误导。
 *    必须用 CDP 的 Emulation.setDeviceMetricsOverride。
 * 2. 断言要带上下文：这个脚本检查的是 `scrollHeight > clientHeight + 1`，
 *    而不是「某个 CSS 值是否等于期望」。
 */
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'

/**
 * 页面地址里的 http(s) 部分（可以覆盖成 preview 的 4173 端口）。
 * 注意游戏内界面的测量会自动补上 `?major=`，见下面的 PAGE_URL。
 */
const BASE_URL = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5173/'
/** 加 --shots 会把每个视口的截图写到 shots/ 下，方便肉眼看排版 */
const WANT_SHOTS = process.argv.includes('--shots')
/** 加 --start 量「开局选专业」那一屏，而不是游戏内界面 */
const WANT_START = process.argv.includes('--start')
/** 加 --projects 先展开作品面板再量（默认折叠状态才是首屏要量的状态） */
const WANT_PROJECTS = process.argv.includes('--projects')
/** 量哪个专业：`--major literature`。专业不同，可见的行动与项目数量也不同 */
const MAJOR_FLAG_INDEX = process.argv.indexOf('--major')
const MAJOR = MAJOR_FLAG_INDEX === -1 ? 'computer' : (process.argv[MAJOR_FLAG_INDEX + 1] ?? 'computer')
/**
 * 加 --ending 会先在页面里把游戏玩到结局，再测量**结算页**的布局。
 *
 * 为什么要单独一个模式：结算页只在游戏结束时出现，
 * 而它恰好是最长的一屏（30 多条回顾 + 属性 + 结局文本），
 * 也是最容易出布局问题的地方（实测踩过 flex 居中 + 滚动导致顶部够不着的坑）。
 */
const WANT_ENDING = process.argv.includes('--ending')

/**
 * 推进游戏若干步再测量。
 *
 * 为什么需要它：首屏并**不是**最难的界面。第 9 周起「投简历」会解锁
 *（要求 week ≥ 9 且技能 ≥ 50），文科这时最多同时露出 8 个行动 ——
 * 那才是布局真正的边界，而只量首屏永远碰不到它。
 *
 *   --advance 30                点 30 次（优先第一个可用选项）
 *   --advance 30 --prefer 写稿   优先点标签含「写稿」的选项（用来把技能顶上去，
 *                              真的把第 9 周那个 8 行动的边界逼出来）
 */
const ADVANCE_FLAG_INDEX = process.argv.indexOf('--advance')
const ADVANCE_STEPS = ADVANCE_FLAG_INDEX === -1
  ? 0
  : Number.parseInt(process.argv[ADVANCE_FLAG_INDEX + 1] ?? '0', 10)
const PREFER_FLAG_INDEX = process.argv.indexOf('--prefer')
const PREFER_LABEL = PREFER_FLAG_INDEX === -1 ? null : (process.argv[PREFER_FLAG_INDEX + 1] ?? null)
const WANT_ADVANCE = Number.isFinite(ADVANCE_STEPS) && ADVANCE_STEPS > 0

/**
 * 真正要导航到的地址。
 *
 * 游戏内界面的测量一律带上 `?major=<专业>`，有两个用处：
 *   1. 跳过「选专业」那一屏，直接量到目标界面
 *   2. 顺便把「专业不同 → 可见行动数量不同」也纳入回归范围
 *      （文科有 8 个行动、计算机 7 个 —— 8 个那种才是真正压到边界的）
 * 量开局界面时当然不能带，否则它自己就被跳过了。
 */
const PAGE_URL = (() => {
  if (WANT_START) return BASE_URL
  const url = new URL(BASE_URL)
  url.searchParams.set('major', MAJOR)
  // 固定种子：布局回归必须可复现。同一颗种子 → 同一串事件 → 同一个界面状态，
  // 否则每次跑到的「中间状态」都不一样，出的问题也没法复现。
  url.searchParams.set('seed', '12345')
  return url.toString()
})()

const PORT = 9333
const BROWSER_TIMEOUT_MS = 20000

/**
 * 日志区的高度下限（与 CSS 里 `.panel` 的 `calc(100dvh - 220px)` 是同一套预算：
 * 顶栏 49 + 属性面板 88 + 日志区下限 72 + 底部留白 10 ≈ 220）。
 * 低于它，开场引导就真的放不下了。
 */
const FEED_FLOOR = 72

const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean)

/** 要检查的视口：手机为主（游戏主要在手机上玩），桌面一个作对照 */
const VIEWPORTS = [
  { width: 390, height: 844, mobile: true, label: 'iPhone 14' },
  { width: 360, height: 740, mobile: true, label: '小屏 Android' },
  { width: 1280, height: 900, mobile: false, label: '桌面' },
]

/**
 * 测结算页时**刻意用矮视口**。
 *
 * 结算卡片的高度取决于这一局触发了多少条回顾（实测 4–9 条 → 650–850px）。
 * 用 844px 的视口它往往刚好装得下，于是「内容超过一屏」这个真正危险的场景
 * **根本压不到** —— 我第一次跑就吃了这个亏：全绿，但其实没测到东西。
 *
 * 矮视口能稳定逼出「卡片比屏幕高」，从而验证那处 `margin: auto` 修复
 * （flex 居中 + overflow 会把超高内容的顶部顶出可视区）是否真的有效。
 */
const ENDING_VIEWPORTS = [
  { width: 390, height: 844, mobile: true, label: 'iPhone 14' },
  { width: 360, height: 560, mobile: true, label: '矮屏 360x560' },
  { width: 1280, height: 620, mobile: false, label: '桌面矮窗 1280x620' },
]

const MEASURE = `
(() => {
  const box = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      h: Math.round(r.height),
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
      innerScroll: el.scrollHeight > el.clientHeight + 1,
      offscreen: r.bottom > window.innerHeight + 1,
    }
  }
  const options = [...document.querySelectorAll('.option')]
  const last = options.length ? options[options.length - 1].getBoundingClientRect() : null
  return JSON.stringify({
    viewport: window.innerWidth + 'x' + window.innerHeight,
    docsOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    feed: box('.feed'),
    panel: box('.panel'),
    optionCount: options.length,
    optionHeight: options.length ? Math.round(options[0].getBoundingClientRect().height) : null,
    lastOptionBottom: last ? Math.round(last.bottom) : null,
  })
})()
`

/**
 * 在页面里把游戏玩到结局：**随机**点一个可用选项，直到出现结算页。
 *
 * 为什么是随机而不是固定点第一个：一直点「去图书馆自习」只会走出一条
 * 极其单调的路线（8 条回顾，卡片装得下屏幕），**测不到真正危险的场景** ——
 * 结算卡片内容多到超过一屏时，flex 居中会不会把顶部顶出可视区。
 * 随机选能触发更多 flag/事件，回顾条数更多、卡片更高，才算真的压到边界。
 */
const PLAY_TO_END = `
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  let seed = 12345
  const rand = () => {
    // 页面里的可复现伪随机，避免用 Math.random 让每次压测强度不一
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let i = 0; i < 1200; i++) {
    if (document.querySelector('.ending')) return 'ended'
    const btns = [...document.querySelectorAll('.option:not([disabled])')]
    if (btns.length > 0) {
      btns[Math.floor(rand() * btns.length)].click()
      await sleep(6)
    } else {
      await sleep(30)
    }
  }
  return document.querySelector('.ending') ? 'ended' : 'timeout'
})()
`

/** 量「开局选专业」那一屏：所有专业卡片都要在首屏里露出来 */
const MEASURE_START = `
(() => {
  const cards = [...document.querySelectorAll('.major-card')]
  const rect = (el) => el.getBoundingClientRect()
  const last = cards.length ? rect(cards[cards.length - 1]) : null
  const start = document.querySelector('.start')
  return JSON.stringify({
    viewport: window.innerWidth + 'x' + window.innerHeight,
    docsOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    cardCount: cards.length,
    cardWidth: cards.length ? Math.round(rect(cards[0]).width) : null,
    cardOverflowX: cards.some((card) => {
      const r = rect(card)
      return r.right > window.innerWidth + 1 || r.left < -1
    }),
    lastCardBottom: last ? Math.round(last.bottom) : null,
    startScrollable: start ? start.scrollHeight > start.clientHeight + 1 : false,
  })
})()
`

/**
 * 量**展开后**的作品面板。
 *
 * 默认折叠状态由首屏那四条检查覆盖；这里专门量玩家点开之后会不会出事：
 * 标题行必须还在屏幕上（否则收不回去），展开出来的项目要么看得见、
 * 要么至少能滚到（面板自己有滚动条）。
 */
const MEASURE_PROJECTS = `
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const toggle = document.querySelector('.projects-chip')
  if (!toggle) return JSON.stringify({ missing: true })
  if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click()
  await sleep(180)

  const rect = (el) => el.getBoundingClientRect()
  const panel = document.querySelector('.panel')
  const cards = [...document.querySelectorAll('.project')]
  const lastCard = cards.length ? rect(cards[cards.length - 1]) : null

  return JSON.stringify({
    viewport: window.innerWidth + 'x' + window.innerHeight,
    docsOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    optionCount: document.querySelectorAll('.option').length,
    projectCount: cards.length,
    projectOverflowX: cards.some((card) => {
      const r = rect(card)
      return r.right > window.innerWidth + 1 || r.left < -1
    }),
    summaryRowBottom: Math.round(rect(toggle).bottom),
    panelClientH: panel ? panel.clientHeight : null,
    panelScrollH: panel ? panel.scrollHeight : null,
    panelScrollable: panel ? panel.scrollHeight > panel.clientHeight + 1 : false,
    projectListBottom: lastCard ? Math.round(lastCard.bottom) : null,
    panelBottom: panel ? Math.round(rect(panel).bottom) : null,
  })
})()
`

/** 把游戏推进 N 步（可选：优先点某个标签），逼出后面的界面状态 */
const advanceScript = (steps, preferLabel) => `
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const prefer = ${JSON.stringify(preferLabel)}
  let clicked = 0
  for (let i = 0; i < 4000 && clicked < ${steps}; i++) {
    if (document.querySelector('.ending')) break
    const btns = [...document.querySelectorAll('.option:not([disabled])')]
    if (btns.length === 0) {
      await sleep(20)
      continue
    }
    const target = prefer ? (btns.find((b) => b.textContent.includes(prefer)) ?? btns[0]) : btns[0]
    target.click()
    clicked++
    await sleep(5)
  }
  return String(clicked)
})()
`

const ENDING_MEASURE = `
(() => {
  const overlay = document.querySelector('.ending')
  const card = document.querySelector('.ending-card')
  if (!overlay || !card) return JSON.stringify({ missing: true })

  // 关键：滚到顶部，检查卡片顶部是不是真的够得着。
  // 这一条专治「flex 居中 + overflow」把超高内容顶部顶出可视区的经典坑。
  overlay.scrollTop = 0
  const or = overlay.getBoundingClientRect()
  const cr = card.getBoundingClientRect()
  const kicker = document.querySelector('.ending-kicker')
  const kr = kicker ? kicker.getBoundingClientRect() : null

  return JSON.stringify({
    viewport: window.innerWidth + 'x' + window.innerHeight,
    docsOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    lineCount: document.querySelectorAll('.ending-line').length,
    cardHeight: Math.round(cr.height),
    cardWidth: Math.round(cr.width),
    cardOverflowX: cr.right > window.innerWidth + 1 || cr.left < -1,
    overlayScrollable: overlay.scrollHeight > overlay.clientHeight + 1,
    topReachable: kr ? kr.top >= or.top - 1 : true,
    topGap: kr ? Math.round(kr.top - or.top) : null,
  })
})()
`

function findBrowser() {
  return BROWSER_CANDIDATES.find((p) => existsSync(p)) ?? null
}

/** 等 CDP 端口起来（浏览器启动需要一点时间） */
async function waitForCdp(deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) return true
    } catch {
      /* 还没起来，继续等 */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

async function connect(url) {
  const targets = await (await fetch(`${url}/json`)).json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('找不到 page target')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 1

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id === undefined) return
    const slot = pending.get(msg.id)
    if (!slot) return
    pending.delete(msg.id)
    if (msg.error) slot.reject(new Error(msg.error.message))
    else slot.resolve(msg.result)
  })

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve())
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')))
  })

  const send = (method, params = {}) => {
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  }

  return { ws, send }
}

async function main() {
  const browser = findBrowser()
  if (!browser) {
    console.error('❌ 找不到 Edge / Chrome。可以用 CHROME_PATH 环境变量指定路径。')
    process.exit(1)
  }

  // 先确认页面可达 —— 否则会得到一堆「元素找不到」的误导性错误
  try {
    const res = await fetch(PAGE_URL, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (error) {
    console.error(`❌ 打不开 ${PAGE_URL}：${error.message}`)
    console.error('   先跑起来：pnpm dev:web（或 pnpm build:web && pnpm preview:web）')
    process.exit(1)
  }

  const modeLabel = WANT_START
    ? '开局选专业'
    : WANT_PROJECTS
      ? '作品面板（展开）'
      : WANT_ENDING
        ? '结算页'
        : WANT_ADVANCE
          ? `游戏第 N 步（推进 ${ADVANCE_STEPS} 次${PREFER_LABEL ? `，优先「${PREFER_LABEL}」` : ''}）`
          : '游戏首屏'

  console.log(`浏览器: ${browser}`)
  console.log(`模式:   ${modeLabel}${WANT_START ? '' : `　专业: ${MAJOR}`}`)
  console.log(`页面:   ${PAGE_URL}`)
  console.log(`端口:   ${PORT}\n`)

  const child = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${PORT}`,
      '--remote-allow-origins=*',
      '--user-data-dir=' + (process.env.TEMP ?? '/tmp') + '\\layout-check-profile',
      'about:blank',
    ],
    // stdio: 'ignore' 而不是 'pipe'：我们不需要它的输出，
    // 而且管道在某些受限环境下会因命名管道权限失败
    { stdio: 'ignore', detached: false },
  )

  const cdpUrl = `http://127.0.0.1:${PORT}`
  let failures = 0

  try {
    if (!(await waitForCdp(Date.now() + BROWSER_TIMEOUT_MS))) {
      throw new Error('浏览器 CDP 端口没起来')
    }

    const { ws, send } = await connect(cdpUrl)
    await send('Runtime.enable')
    await send('Page.enable')

    for (const vp of WANT_ENDING ? ENDING_VIEWPORTS : VIEWPORTS) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: vp.mobile ? 2 : 1,
        mobile: vp.mobile,
      })
      await send('Page.navigate', { url: PAGE_URL })
      await new Promise((r) => setTimeout(r, 2000))

      const problems = []
      let headline = ''
      let m = {}

      // 需要「游戏进行中」的状态时，先把游戏往前推。
      // 放在分支**之前**，这样它和 `--projects` 也能组合
      //（开局屏与结算页不需要，它们各自是一屏独立的状态）。
      if (WANT_ADVANCE && !WANT_START && !WANT_ENDING) {
        await send('Runtime.evaluate', {
          expression: advanceScript(ADVANCE_STEPS, PREFER_LABEL),
          awaitPromise: true,
          returnByValue: true,
        })
      }

      if (WANT_START) {
        const res = await send('Runtime.evaluate', { expression: MEASURE_START, returnByValue: true })
        m = JSON.parse(res.result.value)
        if (m.cardCount === 0) problems.push('开局界面没有渲染出任何专业卡片')
        if (m.docsOverflowX) problems.push('页面横向溢出')
        if (m.cardOverflowX) problems.push(`专业卡片横向溢出（宽 ${m.cardWidth}px）`)
        if (m.lastCardBottom !== null && m.lastCardBottom > vp.height) {
          problems.push(`最后一张专业卡片超出视口（底边 ${m.lastCardBottom} > ${vp.height}）—— 玩家选不到它`)
        }
        if (m.startScrollable) problems.push('开局界面需要滚动才能看全 —— 专业卡片被挤下去了')
        headline = `专业卡片 ${m.cardCount} 张（宽 ${m.cardWidth}px），最后一张底边 ${m.lastCardBottom}px`
      } else if (WANT_PROJECTS) {
        const res = await send('Runtime.evaluate', {
          expression: MEASURE_PROJECTS,
          awaitPromise: true,
          returnByValue: true,
        })
        m = JSON.parse(res.result.value)
        if (m.missing) {
          problems.push('页面上找不到作品面板 —— 这个专业是不是没有项目？')
        } else {
          if (m.docsOverflowX) problems.push('页面横向溢出')
          if (m.projectOverflowX) problems.push('项目卡片横向溢出')
          if (m.summaryRowBottom > vp.height) {
            problems.push(`作品面板的标题行被挤出屏幕（底边 ${m.summaryRowBottom} > ${vp.height}）—— 展开后收不回去`)
          }
          if (m.projectListBottom !== null && m.projectListBottom > vp.height && !m.panelScrollable) {
            problems.push('展开后最后一张项目卡片超出视口，而面板不可滚动 —— 够不着')
          }
        }
        headline =
          `作品面板展开：项目 ${m.projectCount} 个、行动仍有 ${m.optionCount} 个，` +
          `面板 ${m.panelClientH}px / 内容 ${m.panelScrollH}px`
      } else if (WANT_ENDING) {
        const played = await send('Runtime.evaluate', {
          expression: PLAY_TO_END,
          awaitPromise: true,
          returnByValue: true,
        })
        if (played.result.value !== 'ended') {
          console.log(`❌ ${vp.label} (${vp.width}x${vp.height})  没走到结局（${played.result.value}）`)
          failures++
          continue
        }
        const res = await send('Runtime.evaluate', { expression: ENDING_MEASURE, returnByValue: true })
        m = JSON.parse(res.result.value)
        if (m.missing) {
          problems.push('结算页没有渲染出来')
        } else {
          if (m.docsOverflowX) problems.push('页面横向溢出')
          if (m.cardOverflowX) problems.push(`结算卡片横向溢出（宽 ${m.cardWidth}px 超出视口）`)
          if (!m.topReachable) {
            problems.push(
              `滚到顶时结算卡片顶部仍被裁掉 ${Math.abs(m.topGap)}px` +
                ' —— 这就是「flex 居中 + overflow-y」的经典坑（要用 margin: auto）',
            )
          }
        }
        headline =
          `结算页：回顾 ${m.lineCount} 条，卡片高 ${m.cardHeight}px，` +
          `整页可滚动 ${m.overlayScrollable ? '是' : '否'}`
      } else {
        const res = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true })
        m = JSON.parse(res.result.value)
        if (m.docsOverflowX) problems.push('页面横向溢出')
        if (m.panel?.innerScroll) {
          problems.push(
            `行动面板需要内部滚动（clientH=${m.panel.clientH} / scrollH=${m.panel.scrollH}）` +
              ' —— 玩家看不到全部选项',
          )
        }
        if (m.feed?.innerScroll) {
          // 日志区是「历史」，它的本质就是可以滚 —— 真正不能容忍的是它被压到
          // 连一句开场白都放不下（低于 72px 的下限）。所以这里只在下限被击穿时判错，
          // 其余情况作为信息量报出来（阶段 2 底部多了一个作品入口，
          // 在最紧的 360×740 上，日志区首屏就开始滚动是有意接受的取舍）。
          if (m.feed.clientH < FEED_FLOOR) {
            problems.push(
              `日志区被压到 ${m.feed.clientH}px，低于 ${FEED_FLOOR}px 的下限 —— 开场引导放不下`,
            )
          }
        }
        if (m.lastOptionBottom !== null && m.lastOptionBottom > vp.height) {
          problems.push(`最后一个选项超出视口（底边 ${m.lastOptionBottom} > ${vp.height}）`)
        }
        headline =
          `选项 ${m.optionCount} 个 × ${m.optionHeight}px，` +
          `面板 ${m.panel?.clientH}px${m.panel?.innerScroll ? `（内容 ${m.panel.scrollH}px ⚠ 内部滚动）` : ''}，` +
          `日志区 ${m.feed?.clientH}px${m.feed?.innerScroll ? `（内容 ${m.feed.scrollH}px，可滚）` : ''}`
      }

      const tag = problems.length === 0 ? '✅' : '❌'
      console.log(`${tag} ${vp.label} (${vp.width}x${vp.height})  ${headline}`)
      for (const p of problems) console.log(`     ${p}`)
      failures += problems.length

      if (WANT_SHOTS) {
        const shot = await send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
        })
        const file = WANT_ENDING
          ? `shots/ending-${vp.width}x${vp.height}.png`
          : WANT_START
            ? `shots/start-${vp.width}x${vp.height}.png`
            : WANT_PROJECTS
              ? `shots/projects-${vp.width}x${vp.height}.png`
              : `shots/${vp.width}x${vp.height}.png`
        writeFileSync(file, Buffer.from(shot.data, 'base64'))
        console.log(`     截图: ${file}`)
      }
    }

    ws.close()
  } finally {
    child.kill()
  }

  console.log('')
  if (failures === 0) {
    console.log('✅ 布局检查通过：没有内容被挤出屏幕，也没有需要内部滚动的关键容器')
    process.exit(0)
  } else {
    console.log(`❌ 发现 ${failures} 个布局问题`)
    process.exit(1)
  }
}

await main()
