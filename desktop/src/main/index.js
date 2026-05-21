import { app, BrowserWindow, Menu, ipcMain, shell, screen, nativeImage, Notification } from 'electron'
import { join } from 'path'
import {
  initDatabase,
  getApiConfigs, addApiConfig, updateApiConfig, deleteApiConfig, setActiveConfig,
  getSelectionApiId, setSelectionApiConfig,
  getSettings, setSetting,
  addWordToWordbook, deleteWordFromWordbook, getWordbook, resetWord,
  getGlossary, addGlossaryTerm, updateGlossaryTerm, deleteGlossaryTerm,
} from './database.js'
import { startServer, stopServer } from './server.js'
import { setupTray } from './tray.js'
import { initDictionary, lookupWord } from './dictionary.js'
import { initGlobalHook, enableHook, disableHook, isHookEnabled, updateHotkey, destroyGlobalHook, setAutoSelect } from './globalHook.js'
import { translate, buildChatCompletionsUrl } from './translate.js'
import { initOcr, triggerOcrCapture, destroyOcr, updateOcrHotkey, getCurrentHotkey } from './ocr.js'
import { initSrs, destroySrs } from './srs.js'

let mainWindow = null
let popupWindow = null
let popupPinned = false

// ─── 设置窗口 ─────────────────────────────────────────────────────────────────

function createSettingsWindow() {
  // Load the app icon (used for taskbar + Alt+Tab; the in-window title bar
  // also references it via electronAPI.iconPath if needed).
  let iconImg = undefined
  try {
    const p = join(__dirname, '../../resources/icon.png')
    const img = nativeImage.createFromPath(p)
    if (!img.isEmpty()) iconImg = img
  } catch {}

  const win = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 720,
    minHeight: 500,
    title: '翻译工具',
    icon: iconImg,
    backgroundColor: '#F3F0EE',
    // Drop the native Windows chrome and the app menu bar; we render a
    // custom title bar inside the page (see renderer/settings/App.jsx).
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.setMenu(null)

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/settings/index.html')
  } else {
    win.loadFile(join(__dirname, '../renderer/settings/index.html'))
  }

  win.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault()
      win.hide()
    }
  })

  // Notify the renderer when maximize state changes so the title bar's
  // restore/maximize icon stays in sync.
  win.on('maximize',   () => win.webContents.send('win:maximizedChanged', true))
  win.on('unmaximize', () => win.webContents.send('win:maximizedChanged', false))

  // F12 toggles DevTools — only in unpackaged (dev) builds. End users of
  // the shipped .exe don't get this shortcut.
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        win.webContents.toggleDevTools()
        event.preventDefault()
      }
    })
  }

  return win
}

// ─── 翻译弹窗 ─────────────────────────────────────────────────────────────────

function createPopupWindow() {
  const win = new BrowserWindow({
    width: 360,
    height: 260,
    minWidth: 280,
    maxWidth: 720,   // 上限放宽：长原文/译文时 renderer 会请求加宽减少竖滚
    maxHeight: 720,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    show: false,
    title: '翻译',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/popup/index.html')
  } else {
    win.loadFile(join(__dirname, '../renderer/popup/index.html'))
  }

  win.on('blur', () => {
    if (!popupPinned) win.hide()
  })

  return win
}

/**
 * 在鼠标附近显示翻译弹窗
 */
async function showPopup({ text, x, y }) {
  if (!popupWindow || popupWindow.isDestroyed()) {
    popupWindow = createPopupWindow()
  }

  popupPinned = false

  // 发送加载中状态
  popupWindow.webContents.send('popup:loading', { text })

  // 计算弹窗位置（在鼠标右下角，避免超出屏幕）
  const display = screen.getDisplayNearestPoint({ x, y })
  const { bounds } = display
  const winW = 360
  const winH = 260

  let posX = x + 16
  let posY = y + 16
  if (posX + winW > bounds.x + bounds.width)  posX = x - winW - 8
  if (posY + winH > bounds.y + bounds.height) posY = y - winH - 8
  posX = Math.max(bounds.x + 4, posX)
  posY = Math.max(bounds.y + 4, posY)

  popupWindow.setPosition(Math.round(posX), Math.round(posY))
  popupWindow.setSize(winW, winH)
  popupWindow.show()

  // 判断是否是单词（用于决定是否查词典）
  const trimmed = text.trim()
  const isSingleWord = trimmed.split(/\s+/).length <= 2 && /^[a-zA-Z''-]+$/.test(trimmed.replace(/\s+/g, ''))

  // 并发执行：词典查询 + AI 翻译
  const [dictResult, transResult] = await Promise.allSettled([
    isSingleWord ? Promise.resolve(lookupWord(trimmed)) : Promise.resolve(null),
    translate({ text: trimmed, mode: isSingleWord ? 'word' : 'sentence' }),
  ])

  const dictData  = dictResult.status === 'fulfilled'  ? dictResult.value  : null
  const transData = transResult.status === 'fulfilled' ? transResult.value : { translation: '', offline: true }

  if (!popupWindow || popupWindow.isDestroyed()) return

  const payload = {
    text: trimmed,
    isSingleWord,
    dict: dictData,
    translation: transData.translation,
    engine: transData.engine,
    offline: transData.offline,
    error: transData.error,
  }

  popupWindow.webContents.send('popup:data', payload)
  // 高度不再在这里估算 —— 由 renderer 收到 data 后量真实 DOM scrollHeight，
  // 通过 popup:setSize IPC 反馈过来精确 setSize（解决长原文+长译文截断）
}

// ─── 显示主窗口并切到指定 tab（SRS 通知点击 / 托盘菜单都走这） ────────────

function showMainWindowAtTab(tabId) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.show()
  mainWindow.focus()
  // 等渲染进程就绪后发；通常窗口已加载过，立即可送。
  // 重复调也无害，渲染端收到自己当前 tab id 是 no-op。
  mainWindow.webContents.send('settings:setTab', tabId)
}

// ─── OCR 占位 popup ──────────────────────────────────────────────────────────

/**
 * OCR 处理中的占位 popup —— 用户截完图后立刻弹出来「正在 OCR」，免得 PS 启动
 * + WinRT 加载那 1-3 秒里桌面端死寂、用户以为程序挂了。OCR 出结果后由
 * showPopup（成功）或 Notification（empty/failed）接管。
 */
function showOcrPlaceholder(x, y) {
  if (!popupWindow || popupWindow.isDestroyed()) {
    popupWindow = createPopupWindow()
  }
  popupPinned = false

  popupWindow.webContents.send('popup:loading', { text: '', label: '正在 OCR…' })

  const display = screen.getDisplayNearestPoint({ x, y })
  const { bounds } = display
  const winW = 360
  const winH = 200

  let posX = x + 16
  let posY = y + 16
  if (posX + winW > bounds.x + bounds.width)  posX = x - winW - 8
  if (posY + winH > bounds.y + bounds.height) posY = y - winH - 8
  posX = Math.max(bounds.x + 4, posX)
  posY = Math.max(bounds.y + 4, posY)

  popupWindow.setPosition(Math.round(posX), Math.round(posY))
  popupWindow.setSize(winW, winH)
  popupWindow.show()
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

function registerIpcHandlers() {
  // API 配置
  ipcMain.handle('db:getApiConfigs', () => getApiConfigs())
  ipcMain.handle('db:addApiConfig', (_, config) => addApiConfig(config))
  ipcMain.handle('db:updateApiConfig', (_, id, config) => updateApiConfig(id, config))
  ipcMain.handle('db:deleteApiConfig', (_, id) => deleteApiConfig(id))
  ipcMain.handle('db:setActiveConfig', (_, id) => setActiveConfig(id))
  ipcMain.handle('db:getSelectionApiId', () => getSelectionApiId())
  ipcMain.handle('db:setSelectionApiConfig', (_, id) => setSelectionApiConfig(id))

  // 设置
  ipcMain.handle('db:getSettings', () => getSettings())
  ipcMain.handle('db:setSetting', (_, key, value) => {
    setSetting(key, String(value))
    if (key === 'hotkey')      updateHotkey(value)
    if (key === 'auto_select') setAutoSelect(value === '1' || value === true)
    // OCR 快捷键单独返回注册结果，让 UI 能 surface「被占用」给用户
    if (key === 'ocr_hotkey')  return { hotkeyRegistered: updateOcrHotkey(value) }
  })

  // 生词本
  ipcMain.handle('db:getWordbook', () => getWordbook())
  ipcMain.handle('db:addWord', (_, entry) => addWordToWordbook(entry))
  ipcMain.handle('db:deleteWord', (_, id) => deleteWordFromWordbook(id))
  ipcMain.handle('db:resetWord', (_, id) => resetWord(id))

  // 术语表
  ipcMain.handle('db:getGlossary', () => getGlossary())
  ipcMain.handle('db:addGlossaryTerm', (_, term) => addGlossaryTerm(term))
  ipcMain.handle('db:updateGlossaryTerm', (_, id, term) => updateGlossaryTerm(id, term))
  ipcMain.handle('db:deleteGlossaryTerm', (_, id) => deleteGlossaryTerm(id))

  // 全局 Hook 开关
  ipcMain.handle('hook:isEnabled', () => isHookEnabled())
  ipcMain.handle('hook:enable', () => {
    enableHook()
    setSetting('hook_enabled', '1')
    mainWindow?.webContents.send('hook:statusChanged', true)
  })
  ipcMain.handle('hook:disable', () => {
    disableHook()
    setSetting('hook_enabled', '0')
    mainWindow?.webContents.send('hook:statusChanged', false)
  })

  // 弹窗控制
  ipcMain.handle('popup:close', () => { popupWindow?.hide() })
  ipcMain.handle('popup:pin', (_, pinned) => { popupPinned = pinned })
  // 渲染端测完真实内容高度后反馈过来，连同 renderer 算的目标宽度一起 setSize。
  // clamp 高 [180,720] / 宽 [280,720]；setBounds 防出屏（默认锚左上角扩展，可能跑屏外）
  ipcMain.handle('popup:setSize', (_, h, w) => {
    if (!popupWindow || popupWindow.isDestroyed()) return
    const clampedH = Math.max(180, Math.min(720, Math.ceil(Number(h) || 0)))
    const requestedW = Math.max(280, Math.min(720, Math.ceil(Number(w) || 360)))
    // 宽度只增不减：第一次渲染加宽后，layout 变窄了的高度不会让宽度再缩回去 →
    // 避免「宽 640 算出 600 高 → 又请求 440 宽 → 又变窄又拉高」来回抖动
    const [curW] = popupWindow.getSize()
    const clampedW = Math.max(curW, requestedW)
    const [x, y] = popupWindow.getPosition()
    const display = screen.getDisplayMatching({ x, y, width: clampedW, height: clampedH })
    const maxX = display.bounds.x + display.bounds.width  - clampedW - 4
    const maxY = display.bounds.y + display.bounds.height - clampedH - 4
    popupWindow.setBounds({
      x: Math.max(display.bounds.x + 4, Math.min(x, maxX)),
      y: Math.max(display.bounds.y + 4, Math.min(y, maxY)),
      width: clampedW,
      height: clampedH,
    })
  })

  // 自定义标题栏的窗口控制（min / max-restore / close / state）
  function senderWindow(e) {
    return BrowserWindow.fromWebContents(e.sender)
  }
  ipcMain.handle('win:minimize', (e) => { senderWindow(e)?.minimize() })
  ipcMain.handle('win:toggleMaximize', (e) => {
    const w = senderWindow(e)
    if (!w) return false
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
    return w.isMaximized()
  })
  ipcMain.handle('win:close', (e) => { senderWindow(e)?.close() })
  ipcMain.handle('win:isMaximized', (e) => !!senderWindow(e)?.isMaximized())

  // 词典直查
  ipcMain.handle('dict:lookup', (_, word) => lookupWord(word))

  // 翻译直调
  ipcMain.handle('translate:run', (_, opts) => translate(opts))

  // 服务状态检查（主进程直接返回，不走 fetch）
  ipcMain.handle('server:status', () => ({ running: true, version: '0.1.0' }))

  // API 连接测试（在主进程发请求，绕过 CORS）
  ipcMain.handle('api:test', async (_, { base_url, api_key, model }) => {
    const url = buildChatCompletionsUrl(base_url)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api_key}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word: OK' }], max_tokens: 10 }),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) {
        const txt = await res.text()
        return { ok: false, msg: `HTTP ${res.status}: ${txt.slice(0, 200)}` }
      }
      const data  = await res.json()
      const reply = data.choices?.[0]?.message?.content || '(empty)'
      return { ok: true, msg: `✓ 连接成功，回复：${reply}` }
    } catch (e) {
      return { ok: false, msg: e.message }
    }
  })

  // 其他
  ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url))
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Kill the default "File / Edit / View / Window / Help" menu bar
  // globally — every BrowserWindow we create afterwards inherits this.
  Menu.setApplicationMenu(null)

  // Windows 通知（Notification）需要这个 ID 才能正确显示应用图标 + 在 Action
  // Center 里归类到「翻译工具」名下；不设的话通知可能显示为 Electron 通用图标
  // 或被 Windows 忽略。matches the appId in desktop/package.json build config.
  app.setAppUserModelId('com.internal.translator-tool')

  initDatabase()
  initDictionary()
  registerIpcHandlers()
  startServer()

  mainWindow  = createSettingsWindow()
  popupWindow = createPopupWindow()

  const settings   = getSettings()
  const hotkey     = settings.hotkey || 'Alt+Z'
  const hookActive = settings.hook_enabled === '1'

  initGlobalHook({
    hotkey,
    autoSelect: settings.auto_select === '1',
    onSelection: (text, x, y) => showPopup({ text, x, y }),
  })

  if (hookActive) enableHook()

  // 截图 OCR 翻译：成功 → showPopup；中间状态/失败 surface 给用户
  initOcr({
    onText:       (text, x, y)   => showPopup({ text, x, y }),
    onProcessing: (x, y)         => showOcrPlaceholder(x, y),
    onEmpty:      ()             => {
      popupWindow?.hide()
      if (Notification.isSupported()) {
        new Notification({ title: 'OCR', body: '没识别到文字 —— 换个更清晰的区域再试' }).show()
      }
    },
    onFailed:     (errMsg)       => {
      popupWindow?.hide()
      if (Notification.isSupported()) {
        new Notification({ title: 'OCR 失败', body: (errMsg || '未知错误').slice(0, 200) }).show()
      }
    },
    hotkey: settings.ocr_hotkey || 'Alt+X',
  })

  // 生词本 SRS 调度器：到期单词弹 Notification + 自动晋级
  // 用户点通知 → 显示主窗口并切到生词本 tab（语义对齐：通知说「复习」，点了就到列表）
  initSrs({
    onClick: () => showMainWindowAtTab('wordbook'),
  })

  setupTray(app, mainWindow, {
    isHookEnabled,
    enableHook: () => {
      enableHook()
      setSetting('hook_enabled', '1')
      mainWindow?.webContents.send('hook:statusChanged', true)
    },
    disableHook: () => {
      disableHook()
      setSetting('hook_enabled', '0')
      mainWindow?.webContents.send('hook:statusChanged', false)
    },
  }, triggerOcrCapture, getCurrentHotkey)

  app.on('activate', () => { if (mainWindow) mainWindow.show() })
})

app.on('before-quit', () => {
  app.isQuiting = true
  destroyGlobalHook()
  destroyOcr()
  destroySrs()
  stopServer()
})

app.on('window-all-closed', () => {
  // 托盘保持运行
})
