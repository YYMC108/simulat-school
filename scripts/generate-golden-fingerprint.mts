/**
 * 重新生成 `tests/golden-fingerprint.ts`（对局金标指纹）。
 *
 *   cd campus-life
 *   pnpm exec tsx scripts/generate-golden-fingerprint.mts
 *
 * ⚠️ **不要因为「测试红了」就跑它。**
 *
 * 指纹是**冻结的历史**：它记录「某一次改内容之前，那套引擎打出过什么」。
 * 它红掉通常意味着两件完全不同的事，先分清楚再动手：
 *
 *   1. 你**有意**改了共享内容（加事件/行动、改权重、改共享规则）
 *      → 那么指纹**必然**红，重新生成是对的。但**先生成到临时文件、diff 一遍**，
 *        确认变化的形状是你预期的（比如「新加的花钱事件让若干局医疗费变少」），
 *        而不是「莫名其妙所有局面目全非」。
 *   2. 你只想改引擎、不该动到对局
 *      → 那指纹红就是**真警报**，别生成，回去查代码。
 *
 * 加专属专业的内容（带 `majors` 标签）**不该**让指纹变红 ——
 * 那条性质由「差分不变量」守着（见 tests/engine.test.ts），它不依赖这个文件，
 * 所以永远不会过期。指纹负责抓「悄悄漂移」，差分负责抓「渗漏」。
 */
import { writeFileSync } from 'node:fs'

import { STRATEGIES, playOne } from '../src/cli/simulate'

const STAT_KEYS = ['academic', 'social', 'health', 'mood', 'money', 'skill']
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 100, 2025]

const entries: string[] = []
for (const [strategy, weights] of Object.entries(STRATEGIES)) {
  for (const seed of SEEDS) {
    const outcome = playOne(seed, weights)
    entries.push(
      `  '${strategy}|${seed}|${outcome.endingId}|` +
        `${STAT_KEYS.map((key) => outcome.stats[key]).join(',')}|` +
        `${outcome.seenEvents.length}|${outcome.summaryLines.length}',`,
    )
  }
}

const header = `/**
 * 金标指纹（**冻结夹具，不要手改；用 scripts/generate-golden-fingerprint.mts 重生成**）。
 *
 * ── 这是什么 ──
 * 「6 个经典决策风格 × 10 个种子」各跑一局，记录
 * 「结局 / 终局六项属性 / 遇到的事件数 / 回顾条数」。
 *
 * ── 它守什么 ──
 *   **新增专业、新增机制，不得改变已有风格的对局。**
 * 阶段 2 就是靠它证明了两件事：
 *   · 加完整个「汉语言文学」专业，计算机的 60 局逐位一致
 *     （专属内容带 majors 标签，被过滤掉了，进不了别的专业的池子）
 *   · 加完整套「项目/作品系统」，60 局依然逐位一致
 *     （项目投入是 opt-in，经典风格的 __project 权重是 0 —— 而 pickWeighted
 *       对 0 权重项是惰性的：不参与累加、总权重不变、rng() 仍只调一次）
 *
 * ── 它**不**守什么 ──
 * 它守不住「改共享内容」。你往共享池子里加一个事件、动一个权重，
 * 整局随机流就会变，指纹必然红 —— 那不是 bug，是种子确定性系统的固有特性
 *（见技术文档 §5.4）。所以它是一份**快照**，不是永久契约；
 * 真正永久的是「差分不变量」（把某专业单独拎出来跑，结果必须与完整数据集一致）。
 *
 * ── 本次抓取 ──
 * 阶段 2.6（花钱换属性 + 不花钱的社交）之后重新抓取。
 * 那一次**有意**改了共享内容（新增 1 个行动 + 3 个事件 + 调了一条共享回顾规则阈值），
 * 所以 70 局的对局全都变了 —— 已经 diff 过，变化形状与改动一致。
 *
 * ── 格式 ──
 *   \`策略|种子|结局id|学业,社交,健康,心情,金钱,技能|遇到事件数|回顾条数\`
 *
 * 共 ${entries.length} 条。
 */
`

writeFileSync(
  new URL('../tests/golden-fingerprint.ts', import.meta.url),
  `${header}export const GOLDEN_FINGERPRINT: string[] = [\n${entries.join('\n')}\n]\n`,
  'utf8',
)

console.log(`已写入 ${entries.length} 条指纹`)
