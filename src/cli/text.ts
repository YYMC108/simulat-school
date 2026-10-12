/**
 * 终端文本排版工具（CLI 层共用）。
 *
 * 两件事：中文对齐、以及「这个终端到底能不能显示颜色」。
 */
import process from 'node:process'

/**
 * 判断一个字符是否占两个显示宽度。
 *
 * 中文在等宽字体里占 **2** 个字符宽度，但 `String.length` 只算 1，
 * 所以用 `padEnd` 对齐中文表格必然错位。必须按「显示宽度」算。
 *
 * 注意这个正则**不能加 `g` 标志** —— 带 `g` 的正则用 `test()`
 * 会在多次调用间保留 lastIndex，导致同一字符时对时错。
 */
const FULL_WIDTH =
  /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/

/** 字符串在等宽终端里的显示宽度（CJK 算 2） */
export function displayWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    width += FULL_WIDTH.test(ch) ? 2 : 1
  }
  return width
}

export function padEndWidth(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)))
}

export function padStartWidth(text: string, width: number): string {
  return ' '.repeat(Math.max(0, width - displayWidth(text))) + text
}

/**
 * 判断当前终端能不能显示 ANSI 颜色。
 *
 * 为什么必须检测：Windows PowerShell 5.1 的旧版控制台（conhost）默认
 * 不解析 ANSI 转义序列，会把 `\u001b[32m` 原样显示成乱码。
 * 所以只有「确定支持」时才上色，宁可不彩色也不要乱码。
 *
 * 遵循社区约定：
 *   - `NO_COLOR` 非空 → 关闭（https://no-color.org）
 *   - `FORCE_COLOR` 非空且非 0/false → 强制开启
 *     （重定向到文件后想保留颜色、或检测漏判时手动覆盖）
 */
export function detectColorSupport(): boolean {
  const noColor = process.env.NO_COLOR
  if (noColor !== undefined && noColor !== '') return false

  const forceColor = process.env.FORCE_COLOR
  if (forceColor !== undefined && forceColor !== '' && forceColor !== '0' && forceColor !== 'false') {
    return true
  }

  // 不是交互式终端（被重定向 / 被别的程序捕获）时不上色，避免污染日志
  if (!process.stdout.isTTY) return false

  if (process.platform === 'win32') {
    // Windows Terminal、VS Code 集成终端、ConEmu 都支持 ANSI；
    // 纯 conhost 下保守地不上色
    return (
      process.env.WT_SESSION !== undefined ||
      process.env.TERM_PROGRAM !== undefined ||
      process.env.ConEmuANSI === 'ON'
    )
  }
  return true
}

export interface Colors {
  green: (text: string) => string
  red: (text: string) => string
  yellow: (text: string) => string
  dim: (text: string) => string
  bold: (text: string) => string
}

/** 关闭时所有函数都退化成「原样返回」，调用方不用到处写 if */
export function createColors(enabled: boolean): Colors {
  const wrap =
    (code: number) =>
    (text: string): string =>
      enabled ? `\u001b[${code}m${text}\u001b[0m` : text

  return {
    green: wrap(32),
    red: wrap(31),
    yellow: wrap(33),
    dim: wrap(2),
    bold: wrap(1),
  }
}
