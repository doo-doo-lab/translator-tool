/**
 * globalHook.js — 全局划词监听（修复版）
 *
 * 核心问题修复：
 *   原来的实现在每次鼠标松开时都启动 powershell.exe 模拟 Ctrl+C，
 *   PowerShell 进程启动会短暂抢夺系统焦点，导致任务栏缩略图/系统弹窗瞬间消失。
 *
 * 修复策略：
 *   mouseup 自动检测路径 → 改为"剪贴板监听"模式，不再主动模拟 Ctrl+C。
 *     用户选中文字后正常按 Ctrl+C 复制，工具自动检测到剪贴板变化并翻译。
 *
 *   快捷键路径 (Alt+Z) → 仍然模拟 Ctrl+C，但改用 WScript.Shell（比 PowerShell
 *     启动快 10 倍，且不加载 .NET 程序集，大幅减少焦点干扰）。
 *
 * 工作流程：
 *   方式一（快捷键，推荐）：
 *     1. 选中文字
 *     2. 按 Alt+Z（可配置）
 *     3. 工具模拟 Ctrl+C → 读取剪贴板 → 翻译 → 显示弹窗
 *
 *   方式二（鼠标自动划词，需在「通用设置」里开启）：
 *     1. 用户拖选 / 双击选中文字
 *     2. 工具模拟一次 Ctrl+C；剪贴板轮询器只认「这次模拟的复制」
 *     3. 内容符合条件（非空、<500字、不是中文）→ 翻译 → 显示弹窗
 *   注意：轮询器只接工具自己模拟的复制，用户手动按 Ctrl+C 的普通复制不会触发翻译。
 */

import { app, clipboard, globalShortcut, screen } from 'electron'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import { execFile } from 'child_process'
import { writeFileSync, existsSync } from 'fs'
import { join } from 'path'

// ─── State ────────────────────────────────────────────────────────────────────

let isEnabled = false
let autoSelectEnabled = false      // 鼠标拖选后自动模拟 Ctrl+C，无需按快捷键
let onSelectionCallback = null
let currentHotkey = 'Alt+Z'
let lastKnownClipboard = ''

// 鼠标最后松开的位置（用于定位弹窗）
let lastMouseX = 0
let lastMouseY = 0
// 鼠标按下位置 —— 与松开位置对比可判断是否为拖选
let lastMouseDownX = 0
let lastMouseDownY = 0
// 鼠标最近松开的时间戳（剪贴板监听用）
let lastMouseUpTime = 0
// 是否在等「工具自己模拟的那次 Ctrl+C」落到剪贴板 —— 轮询器只认这个，
// 用户手动按 Ctrl+C 的普通复制不会被当成划词
let expectingSimulatedCopy = false

// 剪贴板轮询定时器
let clipboardPollTimer = null
const CLIPBOARD_WATCH_WINDOW_MS = 2000  // 鼠标松开后，监听剪贴板变化的时间窗口
const CLIPBOARD_POLL_INTERVAL_MS = 120  // 轮询间隔
// 拖选距离阈值：mousedown→mouseup 移动这么多像素以上，认定是在划词
const DRAG_THRESHOLD_PX = 5

// ─── Main API ─────────────────────────────────────────────────────────────────

export function initGlobalHook({ onSelection, hotkey = 'Alt+Z', autoSelect = false }) {
  onSelectionCallback = onSelection
  currentHotkey = hotkey
  autoSelectEnabled = !!autoSelect
  lastKnownClipboard = clipboard.readText()

  registerHotkey(hotkey)

  if (process.platform === 'win32') {
    setupMouseHook()
    startClipboardPoller()
  }

  console.log('[globalHook] Initialized. Hotkey:', hotkey, '· autoSelect:', autoSelectEnabled)
}

export function enableHook()    { isEnabled = true;  console.log('[globalHook] Enabled') }
export function disableHook()   { isEnabled = false; console.log('[globalHook] Disabled') }
export function isHookEnabled() { return isEnabled }
export function setAutoSelect(on) {
  autoSelectEnabled = !!on
  console.log('[globalHook] autoSelect →', autoSelectEnabled)
}

export function updateHotkey(newHotkey) {
  if (currentHotkey) {
    try { globalShortcut.unregister(currentHotkey) } catch {}
  }
  currentHotkey = newHotkey
  registerHotkey(newHotkey)
}

export function destroyGlobalHook() {
  if (currentHotkey) {
    try { globalShortcut.unregister(currentHotkey) } catch {}
  }
  if (clipboardPollTimer) {
    clearInterval(clipboardPollTimer)
    clipboardPollTimer = null
  }
  try { uIOhook.stop() } catch {}
}

// ─── 快捷键处理（保留 Ctrl+C 模拟，但改用 WScript，速度快 10x）──────────────

function registerHotkey(hotkey) {
  if (!hotkey) return
  try {
    const ok = globalShortcut.register(hotkey, handleHotkeyTriggered)
    if (!ok) {
      console.warn('[globalHook] Hotkey registration FAILED — likely already taken by another app:', hotkey)
    } else {
      console.log('[globalHook] Hotkey registered:', hotkey)
    }
  } catch (err) {
    console.error('[globalHook] Failed to register hotkey:', err.message)
  }
}

async function handleHotkeyTriggered() {
  console.log('[globalHook] Hotkey fired. isEnabled =', isEnabled)
  if (!isEnabled) {
    console.log('[globalHook] → ignored (hook disabled, turn it on in 通用设置)')
    return
  }

  // Critical: when our hotkey is e.g. "Alt+Z", the user is still holding
  // Alt physically while this callback runs. If we send Ctrl+C now, the OS
  // sees it as "Alt+Ctrl+C" (Alt is stuck virtually-down), and basically
  // no app binds that combo to "copy" → clipboard never updates.
  //
  // Fix: explicitly inject "Alt up" + "AltRight up" + "Shift up" via
  // uiohook BEFORE the SendKeys. uiohook's keyToggle goes through Win32
  // SendInput, which updates the OS-level modifier state. After this, the
  // OS believes Alt is up regardless of what the user's finger is doing,
  // and our subsequent Ctrl+C is interpreted cleanly.
  try {
    uIOhook.keyToggle(UiohookKey.Alt, 'up')
    uIOhook.keyToggle(UiohookKey.AltRight, 'up')
    uIOhook.keyToggle(UiohookKey.Shift, 'up')
  } catch (_) {}

  const prevClip = clipboard.readText()
  simulateCtrlC()           // wscript.exe → SendKeys "^c" (async, ~50–80ms)
  await sleep(250)          // wscript startup + SendKeys + foreground app's copy + clipboard write

  const newText = clipboard.readText().trim()
  if (!newText) {
    console.log('[globalHook] → clipboard empty after Ctrl+C, did you select anything?')
    return
  }
  if (newText === lastKnownClipboard && newText === prevClip) {
    console.log('[globalHook] → clipboard unchanged, treating as no new selection')
    return
  }

  console.log('[globalHook] → translating:', newText.slice(0, 60) + (newText.length > 60 ? '…' : ''))
  lastKnownClipboard = newText
  const pos = screen.getCursorScreenPoint()
  deliverSelection(newText, pos.x, pos.y)
}

// ─── 鼠标 Hook：只记录位置和时间，不再发送 Ctrl+C ────────────────────────────
//
//  原来：mouseup → 等 150ms → 启动 PowerShell → SendKeys("^c") → 剪贴板变化
//  现在：mouseup → 记录时间+位置 → 剪贴板轮询器在时间窗口内检测变化
//
//  这样完全不启动任何外部进程，任务栏缩略图/弹窗不再被打断。

function setupMouseHook() {
  // Track mousedown so we can tell drag-selections from plain clicks.
  uIOhook.on('mousedown', (e) => {
    if (e.button !== 1) return
    lastMouseDownX = e.x
    lastMouseDownY = e.y
  })

  uIOhook.on('mouseup', (e) => {
    if (!isEnabled || e.button !== 1) return
    if (isTaskbarArea(e.x, e.y)) return  // 点任务栏不触发

    lastMouseX = e.x
    lastMouseY = e.y
    lastMouseUpTime = Date.now()
    expectingSimulatedCopy = false  // 新的鼠标动作 → 作废上一次还没落地的等待

    // Auto-select mode: if the user dragged (≥ DRAG_THRESHOLD_PX) or
    // double-clicked (e.clicks ≥ 2 selects a word), assume they highlighted
    // text and fire Ctrl+C automatically. The clipboard poller below picks
    // up the change and triggers translation — no shortcut needed.
    if (!autoSelectEnabled) return
    const dx = Math.abs(e.x - lastMouseDownX)
    const dy = Math.abs(e.y - lastMouseDownY)
    const dragged = (dx + dy) >= DRAG_THRESHOLD_PX
    const doubleClicked = e.clicks && e.clicks >= 2
    if (dragged || doubleClicked) {
      simulateCtrlC()
      expectingSimulatedCopy = true  // 只有这次复制是工具自己模拟的，轮询器才认
    }
  })

  uIOhook.start()
}

// ─── 剪贴板轮询器 ───────────────────────────────────────────────────────────
//
//  只负责一件事：等「自动划词模式下工具自己模拟的那次 Ctrl+C」落到剪贴板上。
//  靠 expectingSimulatedCopy 把它和用户手动按 Ctrl+C 的普通复制区分开 —— 否则
//  用户随便复制点东西都会蹦出翻译弹窗（这就是原来的 bug）。

function startClipboardPoller() {
  clipboardPollTimer = setInterval(() => {
    if (!isEnabled) return
    if (!expectingSimulatedCopy) return  // 不是工具模拟的复制 → 不管，普通复制不打扰用户

    const now = Date.now()
    const withinWindow = (now - lastMouseUpTime) < CLIPBOARD_WATCH_WINDOW_MS
    if (!withinWindow) {
      expectingSimulatedCopy = false  // 窗口内没等到 → 放弃
      return
    }

    const current = clipboard.readText().trim()
    if (!current) return
    if (current === lastKnownClipboard) return
    if (current.length > 500) return  // 长内容不算划词

    // 等到了工具模拟的那次复制 → 视为划词翻译
    expectingSimulatedCopy = false
    lastKnownClipboard = current
    lastMouseUpTime = 0  // 重置，避免同一次复制触发多次
    deliverSelection(current, lastMouseX, lastMouseY)
  }, CLIPBOARD_POLL_INTERVAL_MS)
}

// ─── Ctrl+C 模拟 ────────────────────────────────────────────────────────────
//
//  踩过的坑历程：
//    1. PowerShell SendKeys：每次启动 .NET CLR + Forms 程序集，~600ms，慢
//    2. 内联 mshta vbscript:Execute("..."): cmd→mshta 三层引号转义被吃，"语法错误"
//    3. uIOhook.keyTap(C, [Ctrl])：理论上调 SendInput，但 Alt+Z 触发时 Alt 还被按着，
//       OS 看到的是 "Alt+Ctrl+C" 不是 Ctrl+C，前台窗口忽略 → 剪贴板不变
//
//  最终方案：磁盘上放一个 send-ctrlc.vbs，每次用 wscript.exe 直接执行该文件。
//  优点：
//    - 没有 cmd 中间层 → 没有引号转义问题
//    - wscript 比 mshta 老老实实只跑脚本，不会弹错误对话框
//    - SendKeys "^c" 走 Win32 SendInput，会清掉残留修饰键（实测 Alt 也不影响）
//    - 启动 ~50–80ms，对快捷键交互来说够快
//  缺点：每次起一个 wscript 进程，比 uiohook 慢一点，但可靠性是第一位。

const VBS_SCRIPT = [
  'Set ws = CreateObject("WScript.Shell")',
  'ws.SendKeys "^c"',
].join('\r\n')

let vbsPath = null

function ensureVbsScript() {
  if (vbsPath && existsSync(vbsPath)) return vbsPath
  try {
    const dir = app.getPath('userData')
    vbsPath = join(dir, 'send-ctrlc.vbs')
    writeFileSync(vbsPath, VBS_SCRIPT, 'utf8')
    return vbsPath
  } catch (e) {
    console.error('[globalHook] Failed to write VBS helper:', e.message)
    vbsPath = null
    return null
  }
}

function simulateCtrlC() {
  const path = ensureVbsScript()
  if (!path) return
  // wscript.exe runs a .vbs file in batch mode (no console, no UI). The
  // child process opens, fires SendKeys, and exits — typically <80ms.
  try {
    execFile('wscript.exe', ['//Nologo', path], { windowsHide: true, timeout: 3000 }, (err) => {
      if (err) console.error('[globalHook] wscript SendKeys failed:', err.message)
    })
  } catch (e) {
    console.error('[globalHook] execFile wscript failed:', e.message)
  }
}

// ─── 辅助：判断是否点击在任务栏区域 ─────────────────────────────────────────
//
//  Windows 任务栏默认在屏幕底部，高度约 48px（DPI 缩放前）
//  通过 electron.screen 获取实际显示器尺寸来判断

function isTaskbarArea(x, y) {
  try {
    const { workArea, bounds } = screen.getDisplayNearestPoint({ x, y })
    // 如果点击坐标在 workArea 之外（即在任务栏区域），返回 true
    const inWorkArea = (
      x >= workArea.x &&
      x <= workArea.x + workArea.width &&
      y >= workArea.y &&
      y <= workArea.y + workArea.height
    )
    return !inWorkArea
  } catch {
    return false
  }
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 选中的文字「本来就是中文」就别翻了 —— 有汉字、且不含拉丁字母和日文假名，
// 视为中文直接跳过（翻译工具是 外文→中文，中译中没意义）。
function looksLikeChinese(text) {
  const hasHan   = /[一-鿿]/.test(text)
  const hasLatin = /[a-zA-Z]/.test(text)
  const hasKana  = /[぀-ヿ]/.test(text)
  return hasHan && !hasLatin && !hasKana
}

// 划词结果的统一出口：先滤掉「本来就是中文」的，再交给翻译弹窗。
function deliverSelection(text, x, y) {
  if (looksLikeChinese(text)) {
    console.log('[globalHook] → 选中的是中文，跳过')
    return
  }
  onSelectionCallback?.(text, x, y)
}
