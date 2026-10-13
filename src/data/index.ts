import type { GameData } from '../engine/types'
import { ACTIONS } from './actions'
import { GAME_CONFIG } from './config'
import { ENDINGS } from './endings'
import { EVENTS } from './events'
import {
  LITERATURE_ACTIONS,
  LITERATURE_ENDINGS,
  LITERATURE_EVENTS,
  LITERATURE_SUMMARY_RULES,
} from './literature'
import { MAJORS } from './majors'
import { SUMMARY } from './summary'

/**
 * 把内容拼成一份完整数据集，注入给引擎。
 *
 * ── 拼接顺序是刻意的：共享内容在前，专业内容**追加**在后 ──
 * `pickWeighted` 是按数组顺序累加权重抽签的，所以顺序一变，
 * 同一颗种子的对局就全变了。把专属内容一律追加在末尾，
 * 已有专业（计算机）过滤出来的池子顺序就和加专业之前**逐位相同** ——
 * 于是「新增一个专业」不会动到任何一局老对局。
 * 这条性质由 tests/golden-fingerprint.ts 守着，不是靠自觉。
 */
export const GAME_DATA: GameData = {
  config: GAME_CONFIG,
  majors: MAJORS,
  actions: [...ACTIONS, ...LITERATURE_ACTIONS],
  events: [...EVENTS, ...LITERATURE_EVENTS],
  endings: [...ENDINGS, ...LITERATURE_ENDINGS],
  summary: {
    ...SUMMARY,
    rules: [...SUMMARY.rules, ...LITERATURE_SUMMARY_RULES],
  },
}

export { ACTIONS, GAME_CONFIG, ENDINGS, EVENTS, MAJORS, SUMMARY }
export { LITERATURE_ACTIONS, LITERATURE_ENDINGS, LITERATURE_EVENTS, LITERATURE_SUMMARY_RULES }
