import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { GAME_DATA } from '../src/data/index'
import { GameEngine } from '../src/engine/engine'
import type { ProjectView } from '../src/engine/types'
import { App } from '../src/web/App'
import { ActionPanel } from '../src/web/components/ActionPanel'
import { EndingScreen } from '../src/web/components/EndingScreen'
import { ProjectList } from '../src/web/components/ProjectList'

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
  return renderToString(<App initialMajorId="computer" initialSeed={7} />).replace(
    /<!--[\s\S]*?-->/g,
    '',
  )
}

/**
 * 纯文本视图：再去掉标签。
 * 用于跨越标签的文案断言（`第 1/16 周` 实际是 `第 <strong>1</strong>/16 周`）。
 */
function text(): string {
  return html().replace(/<[^>]*>/g, '')
}

/**
 * 开局界面（不传专业）。
 *
 * 阶段 2 起 App 的第一屏就是「选专业」。Node 里没有 window，
 * 传不了 `?major=`，所以走 `initialMajorId` 这个测试专用入口 ——
 * 不传就是开局屏，传了就直接进游戏。
 */
describe('Web 开局界面', () => {
  const startText = () =>
    renderToString(<App />)
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]*>/g, '')

  it('没选专业时给出可选专业，而不是空白页或直接开局', () => {
    const view = startText()
    expect(view).toContain('大学生活模拟器')
    for (const major of GAME_DATA.majors) {
      expect(view, `专业「${major.name}」没有出现在开局界面`).toContain(major.name)
      expect(view, `专业「${major.name}」的身份文案没有出现`).toContain(major.identity)
    }
    // 开局界面不该同时出现游戏内的行动面板
    expect(view).not.toContain('这周做点什么')
  })

  it('专业卡片数量与数据一致（加专业只写数据，开局界面自动多一张卡）', () => {
    const raw = renderToString(<App />)
    const cards = raw.match(/class="major-card"/g) ?? []
    expect(cards.length).toBe(GAME_DATA.majors.length)
  })
})

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
 * 作品 / 项目界面。
 *
 * 这里刻意用真实数据里的一个项目（`proj_poetry`）来造 ProjectView，
 * 而不是手搓一个假 ProjectDef：`requiredInvestments` 这类字段一旦改名，
 * 假数据会继续「通过」，真数据不会。
 */
describe('作品 / 项目界面', () => {
  const poetry = GAME_DATA.projects.find((project) => project.id === 'proj_poetry')!
  const view = (over: Partial<ProjectView> = {}): ProjectView => ({
    project: poetry,
    progress: 1,
    required: poetry.requiredInvestments,
    completed: false,
    unlocked: true,
    ...over,
  })

  const computerActions = GAME_DATA.actions.filter(
    (action) => action.majors === undefined || action.majors.includes('computer'),
  )

  it('作品入口在标题行里，并显示进行中的进度', () => {
    const out = renderToString(
      <ActionPanel
        actions={computerActions}
        actionPoints={3}
        onAct={() => {}}
        projects={[view()]}
        onInvest={() => {}}
      />,
    )
    expect(out).toContain('projects-chip')
    expect(out).toContain(`作品 1/${poetry.requiredInvestments}`)
  })

  it('选项达到 8 个时切到压缩模式（收起风味描述，保证全部选项可见）', () => {
    const eight = [...computerActions, GAME_DATA.actions[0]!]
    const seven = computerActions
    expect(
      renderToString(<ActionPanel actions={eight} actionPoints={3} onAct={() => {}} />),
      '8 个选项时应该压缩',
    ).toContain('panel-compact')
    expect(
      renderToString(<ActionPanel actions={seven} actionPoints={3} onAct={() => {}} />),
      '7 个选项时不该压缩（风味描述还放得下）',
    ).not.toContain('panel-compact')
  })

  it('项目清单渲染进度与「每次投入」预告', () => {
    const out = renderToString(
      <ProjectList projects={[view()]} actionPoints={3} onInvest={() => {}} />,
    )
    expect(out).toContain('project-progress')
    expect(out).toContain(`>1/${poetry.requiredInvestments}<`)
    expect(out).toContain('每次投入')
    expect(out).toContain('width:')
  })

  it('未解锁的项目是禁用的，且标出「未解锁」', () => {
    const out = renderToString(
      <ProjectList projects={[view({ unlocked: false })]} actionPoints={3} onInvest={() => {}} />,
    )
    expect(out).toContain('disabled')
    expect(out).toContain('未解锁')
  })

  it('行动力不够时项目按钮也被禁用（不会点了才报错）', () => {
    const out = renderToString(
      <ProjectList projects={[view()]} actionPoints={0} onInvest={() => {}} />,
    )
    expect(out).toContain('disabled')
  })

  it('不同专业在界面上渲染出不同的行动（UI 真接上了专业过滤）', () => {
    const strip = (htmlText: string) =>
      htmlText.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '')

    const literature = strip(renderToString(<App initialMajorId="literature" initialSeed={7} />))
    expect(literature).toContain('写稿 / 赶稿')
    expect(literature, '文科不该看到计算机专属的「写项目」').not.toContain('写自己的项目')

    const computer = strip(renderToString(<App initialMajorId="computer" initialSeed={7} />))
    expect(computer).toContain('写自己的项目 / 刷算法题')
    expect(computer).not.toContain('写稿 / 赶稿')
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
