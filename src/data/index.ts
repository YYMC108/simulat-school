import type { GameData } from '../engine/types'
import { ACTIONS } from './actions'
import { GAME_CONFIG } from './config'
import { ENDINGS } from './endings'
import { EVENTS } from './events'
import { SUMMARY } from './summary'

/** 把内容拼成一份完整数据集，注入给引擎 */
export const GAME_DATA: GameData = {
  config: GAME_CONFIG,
  actions: ACTIONS,
  events: EVENTS,
  endings: ENDINGS,
  summary: SUMMARY,
}

export { ACTIONS, GAME_CONFIG, ENDINGS, EVENTS, SUMMARY }
