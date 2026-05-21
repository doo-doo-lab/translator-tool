/**
 * ocr.js —— 截图 OCR 翻译
 *
 * 流程（先按键、自动唤起截图、再 OCR）：
 *   1. 按 OCR 快捷键或点托盘菜单 → triggerOcrCapture()
 *   2. 记录当前剪贴板图片状态，开始轮询
 *   3. shell.openExternal('ms-screenclip:') 自动唤起 Win+Shift+S 那个截图界面
 *   4. 用户框选 → 图片进剪贴板（也接受用户改用别的截图工具，只要进剪贴板就行）
 *   5. 轮询发现「新」图片 → onProcessing(x, y) 通知调用方弹「正在 OCR」占位
 *   6. PowerShell 助手脚本：2x 双三次放大 + Windows.Media.OCR 识别
 *   7. 三种结果回调：
 *        识别成功 → onText(text, x, y)        → 走现有 showPopup 翻译流程
 *        识别空文 → onEmpty(x, y)             → 让调用方显示「未识别到文字」
 *        进程出错 → onFailed(errMsg, x, y)    → 让调用方显示失败原因
 *
 * 关键设计：
 *   - 「先按键再截图」（监听新图出现）而不是「直接读当前剪贴板」—— 后者会把
 *     20 分钟前的旧图也 OCR 了还不报错；跟 globalHook.js 的剪贴板轮询器一个套路
 *   - OCR 走 PowerShell：Windows.Media.OCR 系统内置、免费、离线，但只能从
 *     WinRT 调，Node 调不了；类比 globalHook.js 用 wscript 跑 .vbs
 *   - registerHotkey / updateOcrHotkey 返回 boolean，让 UI 能 surface
 *     「快捷键被占用」给用户看，而不是默默注册失败
 */

import { app, clipboard, globalShortcut, screen, shell } from 'electron'
import { execFile } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'

// ─── 配置 ─────────────────────────────────────────────────────────────────────

const WATCH_WINDOW_MS  = 20000     // 按键后，等待用户截图的时间窗口
const POLL_INTERVAL_MS = 200       // 剪贴板轮询间隔
const PS_TIMEOUT_MS    = 20000     // PowerShell 桥单次执行超时

// ─── 状态 ─────────────────────────────────────────────────────────────────────

let currentHotkey  = 'Alt+X'   // 默认值；通过 initOcr({hotkey}) 或 updateOcrHotkey 修改
let onTextCallback       = null   // (text, x, y)    — OCR 成功
let onProcessingCallback = null   // (x, y)          — 检测到新图、OCR 开始
let onEmptyCallback      = null   // (x, y)          — OCR 跑完没文字
let onFailedCallback     = null   // (errMsg, x, y)  — 进程出错或读结果失败
let watchTimer     = null
let watchUntil     = 0
let baselinePng    = null   // 触发时剪贴板里图片的 PNG，用来判断后面出现的是不是「新」图

// ─── PowerShell OCR 助手脚本 ──────────────────────────────────────────────────
//
// 写到 userData，用 powershell.exe 跑。两个参数：输入图片路径、输出文本路径。
// 做两件事：
//   ① System.Drawing 双三次 2x 放大 —— 小字 OCR 的关键。实测能把 1x 下糊成
//      "CLJStOmiZe" 的字救回 "Customize"，耗时几乎不变。
//   ② Windows.Media.OCR 识别，结果以「无 BOM 的 UTF-8」写进输出文件 —— 走文件
//      而不是 stdout，绕开 PowerShell 5.1 控制台编码的坑。
const PS_SCRIPT = `param([string]$ImagePath, [string]$OutPath)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.Runtime.WindowsRuntime

  $orig = [System.Drawing.Image]::FromFile($ImagePath)
  $w = [int]($orig.Width * 2); $h = [int]($orig.Height * 2)
  $big = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($big)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($orig, 0, 0, $w, $h)
  $g.Dispose(); $orig.Dispose()
  $scaled = $ImagePath + '.2x.png'
  $big.Save($scaled, [System.Drawing.Imaging.ImageFormat]::Png)
  $big.Dispose()

  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
  function Await($op, $resultType) {
    $netTask = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
  }

  [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
  [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime] | Out-Null

  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($scaled)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $stream.Dispose()
  Remove-Item $scaled -ErrorAction SilentlyContinue

  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'en-US')) }
  if ($null -eq $engine) { throw '系统没有可用的 OCR 语言包' }

  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  [System.IO.File]::WriteAllText($OutPath, $result.Text, (New-Object System.Text.UTF8Encoding $false))
} catch {
  [System.IO.File]::WriteAllText($OutPath, '', (New-Object System.Text.UTF8Encoding $false))
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`

let scriptPath = null

function ensureScript() {
  if (scriptPath && existsSync(scriptPath)) return scriptPath
  try {
    scriptPath = join(app.getPath('userData'), 'ocr-bridge.ps1')
    writeFileSync(scriptPath, PS_SCRIPT, 'utf8')
    return scriptPath
  } catch (e) {
    console.error('[ocr] 写入 PS 助手脚本失败:', e.message)
    scriptPath = null
    return null
  }
}

// ─── 对外 API ─────────────────────────────────────────────────────────────────

export function initOcr({ onText, onProcessing, onEmpty, onFailed, hotkey }) {
  onTextCallback       = onText
  onProcessingCallback = onProcessing
  onEmptyCallback      = onEmpty
  onFailedCallback     = onFailed
  if (hotkey) currentHotkey = hotkey
  ensureScript()
  return registerHotkey(currentHotkey)
}

export function destroyOcr() {
  try { globalShortcut.unregister(currentHotkey) } catch {}
  stopWatching()
}

/** 当前注册的 OCR 快捷键（托盘菜单 label 用这个动态拼） */
export function getCurrentHotkey() { return currentHotkey }

/**
 * 切换 OCR 快捷键（通用设置里改快捷键时调用）—— 卸载旧的、注册新的。
 * 返回 boolean：true = 新快捷键真的注册成功；false = 被占用或抛错。
 */
export function updateOcrHotkey(newHotkey) {
  if (!newHotkey) return false
  try { globalShortcut.unregister(currentHotkey) } catch {}
  currentHotkey = newHotkey
  return registerHotkey(currentHotkey)
}

/** 返回 boolean，true = 真的注册到系统了；false = 被占用 / 抛错 */
function registerHotkey(hk) {
  try {
    const ok = globalShortcut.register(hk, triggerOcrCapture)
    if (ok) console.log('[ocr] 快捷键已注册:', hk)
    else    console.warn('[ocr] 快捷键注册失败（可能被别的程序占用）:', hk, '—— 仍可从托盘菜单触发')
    return !!ok
  } catch (e) {
    console.error('[ocr] 快捷键注册抛错:', e.message)
    return false
  }
}

/**
 * 触发一次截图 OCR：记录当前剪贴板状态，开始监听「新」图片出现。
 * 快捷键和托盘菜单共用这个入口。
 */
export function triggerOcrCapture() {
  const img = clipboard.readImage()
  baselinePng = img.isEmpty() ? Buffer.alloc(0) : img.toPNG()

  watchUntil = Date.now() + WATCH_WINDOW_MS
  if (!watchTimer) watchTimer = setInterval(pollClipboard, POLL_INTERVAL_MS)
  console.log('[ocr] 已就绪，唤起 Windows 截图…')

  // 主动唤起 Windows 截图（ms-screenclip: = Win+Shift+S 那个协议入口）。
  // 唤不起来也无妨 —— 轮询器仍开着，用户可以手动 Win+Shift+S 截图。
  shell.openExternal('ms-screenclip:').catch((e) => {
    console.error('[ocr] 唤起截图工具失败，请手动 Win+Shift+S:', e.message)
  })
}

// ─── 内部 ─────────────────────────────────────────────────────────────────────

function stopWatching() {
  if (watchTimer) { clearInterval(watchTimer); watchTimer = null }
  watchUntil = 0
  baselinePng = null
}

function pollClipboard() {
  if (Date.now() > watchUntil) {
    console.log('[ocr] 等待超时，没等到截图')
    stopWatching()
    return
  }

  const img = clipboard.readImage()
  if (img.isEmpty()) return

  const png = img.toPNG()
  if (baselinePng && png.equals(baselinePng)) return  // 还是旧图，继续等

  // 出现了新图片 —— 就是用户刚截的。停止监听，开始 OCR。
  stopWatching()
  // 此刻 cursor 一般正好在用户刚松开鼠标的位置 —— 把它锁住、整条 OCR 链都
  // 用这同一个坐标，免得 PS 跑完几秒后 cursor 已经飘走、popup 弹错位置。
  const pos = screen.getCursorScreenPoint()
  onProcessingCallback?.(pos.x, pos.y)
  runOcr(png, pos)
}

function runOcr(png, pos) {
  const script = ensureScript()
  if (!script) {
    onFailedCallback?.('PS 助手脚本未就绪', pos.x, pos.y)
    return
  }

  const stamp   = Date.now()
  const inPath  = join(app.getPath('temp'), `tt-ocr-${stamp}.png`)
  const outPath = join(app.getPath('temp'), `tt-ocr-${stamp}.txt`)

  try {
    writeFileSync(inPath, png)
  } catch (e) {
    console.error('[ocr] 写入临时图片失败:', e.message)
    onFailedCallback?.('写入临时图片失败：' + e.message, pos.x, pos.y)
    return
  }

  execFile(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, inPath, outPath],
    { windowsHide: true, timeout: PS_TIMEOUT_MS },
    (err) => {
      let text = ''
      let failureMsg = null
      if (err) {
        // execFile 把 stderr 也合进 err.message —— PS 脚本 catch 里写的
        // 错误原因（比如「系统没有可用的 OCR 语言包」）会原样在里面
        failureMsg = err.message
        console.error('[ocr] PowerShell OCR 桥执行失败:', err.message)
      } else {
        try {
          text = readFileSync(outPath, 'utf8').trim()
        } catch (e) {
          failureMsg = '读取 OCR 结果失败：' + e.message
          console.error('[ocr] 读取 OCR 结果失败:', e.message)
        }
      }
      try { unlinkSync(inPath) } catch {}
      try { unlinkSync(outPath) } catch {}

      if (failureMsg) {
        onFailedCallback?.(failureMsg, pos.x, pos.y)
        return
      }
      if (!text) {
        console.log('[ocr] 未识别到文字')
        onEmptyCallback?.(pos.x, pos.y)
        return
      }
      console.log('[ocr] 识别到', text.length, '字')
      onTextCallback?.(text, pos.x, pos.y)
    }
  )
}
