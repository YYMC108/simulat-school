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

const PAGE_URL = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5173/'
/** 加 --shots 会把每个视口的截图写到 shots/ 下，方便肉眼看排版 */
const WANT_SHOTS = process.argv.includes('--shots')
const PORT = 9333
const BROWSER_TIMEOUT_MS = 20000

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

function findBrowser() {
  return BROWSER_CANDIDATES.find((p) => existsSync(p)) ?? null
}

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

  console.log(`浏览器: ${browser}`)
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

    for (const vp of VIEWPORTS) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: vp.mobile ? 2 : 1,
        mobile: vp.mobile,
      })
      await send('Page.navigate', { url: PAGE_URL })
      await new Promise((r) => setTimeout(r, 2000))

      const res = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true })
      const m = JSON.parse(res.result.value)

      const problems = []
      if (m.docsOverflowX) problems.push('页面横向溢出')
      if (m.panel?.innerScroll) {
        problems.push(
          `行动面板需要内部滚动（clientH=${m.panel.clientH} / scrollH=${m.panel.scrollH}）` +
            ' —— 玩家看不到全部选项',
        )
      }
      if (m.feed?.innerScroll) problems.push('日志区在初始状态就溢出（引导文字被裁掉）')
      if (m.lastOptionBottom !== null && m.lastOptionBottom > vp.height) {
        problems.push(`最后一个选项超出视口（底边 ${m.lastOptionBottom} > ${vp.height}）`)
      }

      const tag = problems.length === 0 ? '✅' : '❌'
      console.log(
        `${tag} ${vp.label} (${vp.width}x${vp.height})  ` +
          `选项 ${m.optionCount} 个 × ${m.optionHeight}px，` +
          `面板 ${m.panel?.clientH}px，日志区 ${m.feed?.clientH}px`,
      )
      for (const p of problems) console.log(`     ${p}`)
      failures += problems.length

      if (WANT_SHOTS) {
        const shot = await send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
        })
        const file = `shots/${vp.width}x${vp.height}.png`
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
