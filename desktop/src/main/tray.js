import { Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'

let tray = null

/**
 * 托盘只放「即时 actions」+「显示主窗口」+「退出」。
 * 内容页（生词本 / 术语表）放在主窗口 sidebar，不在托盘开。
 *
 * @param {Electron.App} app
 * @param {Electron.BrowserWindow} mainWindow
 * @param {{ isHookEnabled: () => boolean, enableHook: () => void, disableHook: () => void }} hookCtrl
 * @param {() => void} onOcrCapture - 触发一次截图 OCR 翻译（快捷键与此菜单项共用）
 * @param {() => string} getOcrHotkey - 拿当前 OCR 快捷键字符串，菜单 label 用它实时拼
 */
export function setupTray(app, mainWindow, hookCtrl, onOcrCapture, getOcrHotkey) {
  // 尝试加载图标，失败时使用空图标（开发阶段可接受）
  let icon = nativeImage.createEmpty()
  try {
    const iconPath = join(__dirname, '../../resources/icon.png')
    const loaded = nativeImage.createFromPath(iconPath)
    if (!loaded.isEmpty()) icon = loaded.resize({ width: 16, height: 16 })
  } catch {}

  tray = new Tray(icon)
  tray.setToolTip('翻译工具')

  // 构建菜单（每次点击时重建，确保开关状态最新）
  function buildMenu() {
    const enabled = hookCtrl.isHookEnabled()
    return Menu.buildFromTemplate([
      {
        label: enabled ? '✓ 划词翻译已开启' : '○ 划词翻译已关闭',
        enabled: false,  // 仅显示，不可点击
      },
      {
        label: enabled ? '关闭划词翻译' : '开启划词翻译',
        click: () => {
          if (enabled) {
            hookCtrl.disableHook()
          } else {
            hookCtrl.enableHook()
          }
          tray.setContextMenu(buildMenu())  // 刷新菜单
        },
      },
      { type: 'separator' },
      {
        // 实时拼当前 OCR 快捷键。注意快捷键能否真注册成功是另一回事
        // （冲突时托盘菜单仍能用），通用设置那边会显示注册状态
        label: 'OCR 截图翻译' + (getOcrHotkey ? `  ·  ${getOcrHotkey() || '未设置'}` : ''),
        click: () => onOcrCapture?.(),
      },
      { type: 'separator' },
      {
        label: '打开主窗口',
        click: () => {
          mainWindow.show()
          mainWindow.focus()
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          app.isQuiting = true
          app.quit()
        },
      },
    ])
  }

  tray.setContextMenu(buildMenu())

  // 左键双击打开设置
  tray.on('double-click', () => {
    mainWindow.show()
    mainWindow.focus()
  })

  // Windows 单击左键也显示菜单（增强易用性）
  tray.on('click', () => {
    tray.setContextMenu(buildMenu())
  })

  return tray
}
