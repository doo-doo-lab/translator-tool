import { contextBridge, ipcRenderer } from 'electron'

/**
 * 通过 contextBridge 暴露给渲染进程的 API
 * 所有渲染进程（settings / popup / wordbook / glossary）共用同一个 preload
 */
contextBridge.exposeInMainWorld('electronAPI', {

  // ── API 配置 ──────────────────────────────────────────────────────────────
  getApiConfigs:    ()            => ipcRenderer.invoke('db:getApiConfigs'),
  addApiConfig:     (config)      => ipcRenderer.invoke('db:addApiConfig', config),
  updateApiConfig:  (id, config)  => ipcRenderer.invoke('db:updateApiConfig', id, config),
  deleteApiConfig:  (id)          => ipcRenderer.invoke('db:deleteApiConfig', id),
  setActiveConfig:  (id)          => ipcRenderer.invoke('db:setActiveConfig', id),
  getSelectionApiId:    ()        => ipcRenderer.invoke('db:getSelectionApiId'),
  setSelectionApiConfig:(id)      => ipcRenderer.invoke('db:setSelectionApiConfig', id),

  // ── 设置 ──────────────────────────────────────────────────────────────────
  getSettings: ()          => ipcRenderer.invoke('db:getSettings'),
  setSetting:  (key, val)  => ipcRenderer.invoke('db:setSetting', key, val),

  // ── 生词本 ────────────────────────────────────────────────────────────────
  getWordbook: ()      => ipcRenderer.invoke('db:getWordbook'),
  addWord:     (entry) => ipcRenderer.invoke('db:addWord', entry),
  deleteWord:  (id)    => ipcRenderer.invoke('db:deleteWord', id),
  resetWord:   (id)    => ipcRenderer.invoke('db:resetWord', id),

  // ── 术语表 ────────────────────────────────────────────────────────────────
  getGlossary:        ()          => ipcRenderer.invoke('db:getGlossary'),
  addGlossaryTerm:    (term)      => ipcRenderer.invoke('db:addGlossaryTerm', term),
  updateGlossaryTerm: (id, term)  => ipcRenderer.invoke('db:updateGlossaryTerm', id, term),
  deleteGlossaryTerm: (id)        => ipcRenderer.invoke('db:deleteGlossaryTerm', id),

  // ── 全局 Hook ─────────────────────────────────────────────────────────────
  isHookEnabled: ()    => ipcRenderer.invoke('hook:isEnabled'),
  enableHook:    ()    => ipcRenderer.invoke('hook:enable'),
  disableHook:   ()    => ipcRenderer.invoke('hook:disable'),

  // ── 弹窗（供弹窗页面自身调用）────────────────────────────────────────────
  closePopup:    ()         => ipcRenderer.invoke('popup:close'),
  pinPopup:      (pinned)   => ipcRenderer.invoke('popup:pin', pinned),
  setPopupSize:  (h, w)     => ipcRenderer.invoke('popup:setSize', h, w),

  // ── 词典 / 翻译（渲染进程直调）──────────────────────────────────────────
  lookupWord:     (word) => ipcRenderer.invoke('dict:lookup', word),
  translate:      (opts) => ipcRenderer.invoke('translate:run', opts),
  testApiConfig:  (cfg)  => ipcRenderer.invoke('api:test', cfg),
  getServerStatus: ()    => ipcRenderer.invoke('server:status'),

  // ── 事件监听（主进程 → 渲染进程推送）────────────────────────────────────
  onPopupLoading: (fn) => {
    ipcRenderer.on('popup:loading', (_, data) => fn(data))
    return () => ipcRenderer.removeAllListeners('popup:loading')
  },
  onPopupData: (fn) => {
    ipcRenderer.on('popup:data', (_, data) => fn(data))
    return () => ipcRenderer.removeAllListeners('popup:data')
  },
  onHookStatusChanged: (fn) => {
    ipcRenderer.on('hook:statusChanged', (_, enabled) => fn(enabled))
    return () => ipcRenderer.removeAllListeners('hook:statusChanged')
  },

  // 主进程主动切设置页 tab（SRS 通知点击 → 'wordbook'、托盘菜单 → 任意）
  onSetTab: (fn) => {
    ipcRenderer.on('settings:setTab', (_, id) => fn(id))
    return () => ipcRenderer.removeAllListeners('settings:setTab')
  },

  // ── 工具 ──────────────────────────────────────────────────────────────────
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // ── 自定义标题栏窗口控制 ──────────────────────────────────────────────
  windowMinimize:       ()  => ipcRenderer.invoke('win:minimize'),
  windowToggleMaximize: ()  => ipcRenderer.invoke('win:toggleMaximize'),
  windowClose:          ()  => ipcRenderer.invoke('win:close'),
  windowIsMaximized:    ()  => ipcRenderer.invoke('win:isMaximized'),
  onWindowMaximizedChanged: (fn) => {
    const handler = (_, isMax) => fn(!!isMax)
    ipcRenderer.on('win:maximizedChanged', handler)
    return () => ipcRenderer.removeListener('win:maximizedChanged', handler)
  },
})
