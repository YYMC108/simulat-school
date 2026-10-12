import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { App } from '../src/web/App'

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
