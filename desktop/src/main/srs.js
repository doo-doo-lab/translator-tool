/**
 * srs.js —— 生词本「记忆曲线」调度器
 *
 * 每分钟扫一次 wordbook 里到期的单词（next_review <= now），对每个：
 *   1. 弹一条 Electron Notification（包含原文 + 短译文 + 新阶段）
 *   2. 自动晋级（advanceWord）—— 下次出现间隔变长
 *
 * 5 个阶段（5min → 30min → 1h → 6h → 12h）后单词毕业，不再触发。
 * 用户在生词本 UI 点「重置」可让某个单词回到 stage 0 重新循环。
 *
 * 为什么用「被动晋级」而非真 SRS（要用户点击通知里的「记住/忘了」）：
 *   - Windows Notification 进 Action Center 之后点击行为不稳定，做不了可靠的
 *     双按钮交互；强行做了用户也容易忽略
 *   - 用户依然能从生词本 UI 主动控制（「重置」按钮）
 *   - 默认按渐稀疏的频率自动循环，不会无限刷屏
 */

import { Notification } from 'electron'
import { getDueWords, advanceWord } from './database.js'

const POLL_INTERVAL_MS = 60_000   // 每分钟查一次

const STAGE_LABELS = ['新', '初熟', '半熟', '熟', '稳', '毕业']

let timer = null
let startupTimer = null   // 启动 5 秒后那次 first tick 的 handle，destroy 要 clear 掉避免在 DB 关闭后跑
let onClickCallback = null

export function initSrs({ onClick } = {}) {
  onClickCallback = onClick
  // 启动后 5 秒先跑一次 tick，方便快速看到效果；之后每分钟一次
  startupTimer = setTimeout(tick, 5_000)
  timer = setInterval(tick, POLL_INTERVAL_MS)
  console.log('[srs] 调度器启动，每', POLL_INTERVAL_MS / 1000, '秒扫一次到期生词')
}

export function destroySrs() {
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null }
  if (timer) { clearInterval(timer); timer = null }
}

function tick() {
  if (!Notification.isSupported()) {
    console.warn('[srs] 系统不支持 Notification —— 跳过')
    return
  }

  let due
  try {
    due = getDueWords()
  } catch (e) {
    // DB 还没初始化（启动竞速）等情况：本轮跳过、下轮再试
    console.warn('[srs] 查到期生词失败:', e.message)
    return
  }
  if (due.length === 0) return

  console.log('[srs]', due.length, '个生词到期，开始提醒')
  for (const w of due) {
    const result = advanceWord(w.id)
    if (!result) continue   // 单词在 getDueWords 和 advance 之间被删了 —— 跳过
    showNotification(w, result.stage)
  }
}

function showNotification(word, newStage) {
  const def = (word.translation || word.definition || '')
    .split(/\n|；|;/)[0]
    ?.trim()
    .slice(0, 60) || ''
  const label = STAGE_LABELS[newStage] || `阶段 ${newStage}`
  const body = def ? `${def}\n→ ${label}` : `→ ${label}`

  const n = new Notification({
    title: `📖 复习 · ${word.word}`,
    body,
    silent: false,
  })
  n.on('click', () => onClickCallback?.())
  try {
    n.show()
  } catch (e) {
    console.error('[srs] 弹通知失败:', e.message)
  }
}
