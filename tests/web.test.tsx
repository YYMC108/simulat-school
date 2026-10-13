import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { GAME_DATA } from '../src/data/index'
import { GameEngine } from '../src/engine/engine'
import { App } from '../src/web/App'
import { EndingScreen } from '../src/web/components/EndingScreen'

/**
 * Web 界面的冒烟测试。
 *
 * 为什么值得有：构建成功只证明「语法对、模块能打包」，
 * 证明不了组件真的能渲染出内容 —— props 名字写错、undefined 解引用、
 * hook 顺序不对，这些在构建阶段全都发现不了。
 *
 * 用 `renderToString` 而不是装 jsdom + testing-library：
 * 引擎本身零 DOM 依赖，所以整个组件树的**首屏**在纯 Node 里就能渲染出来。
 * 这让我们用极小的成本换来「UI 没坏」的持续保障。
 */
/**
 * React 会在相邻文本节点之间插入 `<!-- -->` 注释
 * （例如 `第 <strong>1</strong>/<!-- -->16<!-- --> 周`），
 * 所以断言连续文本前必须去掉它们，否则会误判成「内容缺失」。
 */
function html(): string {
  return renderToString(<App />).replace(/<!--[\s\S]*?-->/g, '')
}

/**
 * 纯文本视图：再去掉标签。
 * 用于跨越标签的文案断言（`第 1/16 周` 实际是 `第 <strong>1</strong>/16 周`）。
 */
function text(): string {
  return html().replace(/<[^>]*>/g, '')
}

describe('Web 界面首屏', () => {
  it('渲染出周数、行动力与属性面板', () => {
    expect(text()).toContain('第 1/16 周')
    expect(html()).toContain('剩余 3 次行动')
    expect(text()).toContain('学业')
    expect(text()).toContain('技能')
    // 金钱用文字显示（没有上限，画进度条没有意义）
    expect(text()).toContain('¥800')
  })

  it('属性条的宽度来自 config.statRanges，不是硬编码 100', () => {
    // 学业初值 60，上限 100 → 60%
    expect(html()).toContain('width:60%')
    // 技能初值 40 → 40%
    expect(html()).toContain('width:40%')
  })

  it('渲染出行动面板与首屏可用的行动', () => {
    const view = text()
    expect(view).toContain('这周做点什么')
    expect(view).toContain('去图书馆自习')
    expect(view).toContain('去做兼职')
    // 「投简历」要 week >= 9 且 skill >= 50，首屏不该出现 ——
    // 这条断言同时验证了 availableActions() 的条件过滤真的接进了界面
    expect(view).not.toContain('投简历')
  })

  it('行动效果预告来自 describeEffects（声明值）', () => {
    expect(text()).toContain('学业 +4')
  })

  it('渲染出引擎构造函数写入的开场日志', () => {
    expect(text()).toContain('开学了')
  })

  it('提供重开入口与随机种子（复现某一局的前提）', () => {
    const view = text()
    expect(view).toContain('重开')
    expect(view).toContain('#')
  })
})

/**
 * 跑一局到结束（一路选第一个选项），拿到一个**真实**的终局引擎。
 *
 * 为什么不手搓一个假 state：结算页要展示的是「引擎产出的回顾」，
 * 用假数据测就测不出「回顾文案能不能正确渲染出来」这件事本身。
 */
function playToEnd(seed: number): GameEngine {
  const engine = new GameEngine(GAME_DATA, { seed })
  let guard = 0
  while (!engine.isEnded() && guard++ < 800) {
    if (engine.getPending()) {
      engine.choose(0)
      continue
    }
    const actions = engine.availableActions()
    if (actions.length === 0) break
    engine.takeAction(actions[0]!.id)
  }
  return engine
}

describe('结算页', () => {
  it('把引擎产出的每一条回顾都渲染出来', () => {
    const engine = playToEnd(3)
    const summary = engine.getSummary()
    const ending = engine.getEnding()

    expect(ending, '这一局应该走到某个结局').not.toBeNull()
    // 先保证这个用例不是空转：如果一条回顾都没有，下面的循环等于没测
    expect(summary.lines.length, '这一局应该至少产出一条回顾').toBeGreaterThan(0)

    const view = renderToString(
      <EndingScreen
        ending={ending!}
        state={engine.getState()}
        summary={summary}
        seed={engine.getSeed()}
        onRestart={() => {}}
      />,
    )
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]*>/g, '')

    for (const line of summary.lines) {
      expect(view, `回顾「${line.text}」没有被渲染出来`).toContain(line.text)
    }
    expect(view).toContain(summary.verdict)
    expect(view).toContain(ending!.title)
    expect(view).toContain(summary.identity)
  })

  it('没有回顾数据时不崩，也不渲染空的要点列表', () => {
    const engine = playToEnd(3)
    const view = renderToString(
      <EndingScreen
        ending={engine.getEnding()!}
        state={engine.getState()}
        summary={null}
        seed={engine.getSeed()}
        onRestart={() => {}}
      />,
    ).replace(/<!--[\s\S]*?-->/g, '')

    expect(view).not.toContain('ending-lines')
    expect(view).toContain('最终属性')
  })
})
