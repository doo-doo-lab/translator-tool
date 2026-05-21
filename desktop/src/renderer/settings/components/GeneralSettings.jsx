import React, { useState, useEffect } from 'react'

const LANG_OPTIONS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英文' },
  { value: 'ja', label: '日文' },
  { value: 'ko', label: '韩文' },
  { value: 'fr', label: '法文' },
  { value: 'de', label: '德文' },
]

const HOTKEY_PRESETS = ['Alt+Z', 'Alt+X', 'Alt+Q', 'Ctrl+Alt+Z', 'Ctrl+Alt+X']

export default function GeneralSettings() {
  const [settings, setSettings] = useState(null)
  const [hookEnabled, setHookEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [ocrHotkeyStatus, setOcrHotkeyStatus] = useState(null) // null | 'ok' | 'taken' —— 保存后由 IPC 返回值决定

  const api = window.electronAPI

  useEffect(() => {
    api.getSettings().then(setSettings)
    api.isHookEnabled().then(setHookEnabled)

    const unsub = api.onHookStatusChanged?.((enabled) => setHookEnabled(enabled))
    return () => unsub?.()
  }, [])

  const handleChange = (key, value) => {
    setSettings((s) => ({ ...s, [key]: value }))
  }

  const handleToggleHook = async () => {
    if (hookEnabled) {
      await api.disableHook()
      setHookEnabled(false)
    } else {
      await api.enableHook()
      setHookEnabled(true)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    let ocrResult = null
    for (const [key, value] of Object.entries(settings)) {
      const r = await api.setSetting(key, value)
      if (key === 'ocr_hotkey') ocrResult = r
    }
    setSaving(false)
    setSaved(true)
    // ocr_hotkey 这一 key 的 IPC 返回 { hotkeyRegistered: bool }，告诉 UI 是否真的注册到系统
    if (ocrResult) setOcrHotkeyStatus(ocrResult.hotkeyRegistered ? 'ok' : 'taken')
    setTimeout(() => setSaved(false), 2000)
  }

  if (!settings) return <div className="loading">加载设置中…</div>

  return (
    <div className="section">
      <div className="section-eyebrow">
        <span className="section-eyebrow-dot" />
        <span>Preferences</span>
      </div>

      <div className="section-header">
        <div>
          <h2 className="section-title">通用设置</h2>
          <p className="section-subtitle">配置翻译语言偏好、划词取词行为，以及本地服务参数。</p>
        </div>
      </div>

      <div className="settings-form">
        {/* ── 划词翻译 ─────────────────────────────────────────────────── */}
        <div className="settings-group">
          <div className="settings-group-eyebrow">
            <span className="settings-group-eyebrow-dot" />
            <span>Selection</span>
          </div>
          <h3 className="settings-group-title">划词翻译</h3>

          <div className="form-group">
            <div className="hook-toggle-row">
              <div>
                <div className="form-label">全局划词翻译</div>
                <div className="form-hint" style={{ marginTop: 4, lineHeight: 1.5 }}>
                  开启后，在任意应用选中文字并按下快捷键，即可弹出翻译窗口。
                </div>
              </div>
              <button
                type="button"
                className={`toggle-btn ${hookEnabled ? 'toggle-btn-on' : ''}`}
                onClick={handleToggleHook}
                aria-label="切换全局划词翻译"
              >
                <span className="toggle-knob" />
              </button>
            </div>
          </div>

          <div className="form-group">
            <div className="hook-toggle-row">
              <div>
                <div className="form-label">鼠标选中自动翻译</div>
                <div className="form-hint" style={{ marginTop: 4, lineHeight: 1.5 }}>
                  开启后，鼠标拖选/双击选中文字会自动模拟 Ctrl+C 并弹出翻译，无需快捷键。
                  关闭则只有按下面的快捷键才触发。
                </div>
              </div>
              <button
                type="button"
                className={`toggle-btn ${settings.auto_select === '1' ? 'toggle-btn-on' : ''}`}
                onClick={() => {
                  const next = settings.auto_select === '1' ? '0' : '1'
                  handleChange('auto_select', next)
                  // Apply immediately so user feels the change without needing to hit "保存"
                  api.setSetting('auto_select', next)
                }}
                aria-label="切换鼠标选中自动翻译"
              >
                <span className="toggle-knob" />
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              触发快捷键
              <span className="form-hint">修改后立即生效（即使关闭"自动翻译"也能用快捷键触发）</span>
            </label>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="form-input form-input-sm"
                type="text"
                value={settings.hotkey || 'Alt+Z'}
                onChange={(e) => handleChange('hotkey', e.target.value)}
                placeholder="如 Alt+Z"
                style={{ fontFamily: "'Sofia Sans', Arial, sans-serif", fontWeight: 500 }}
              />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {HOTKEY_PRESETS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`hotkey-chip ${settings.hotkey === k ? 'active' : ''}`}
                    onClick={() => handleChange('hotkey', k)}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
            <p className="form-hint" style={{ marginTop: 6, lineHeight: 1.5 }}>
              使用方法：先在任意应用中<strong style={{ fontWeight: 500, color: 'var(--mc-ink)' }}>选中文字</strong>，再按快捷键触发翻译弹窗。
            </p>
          </div>
        </div>

        {/* ── OCR 截图翻译 ─────────────────────────────────────────────── */}
        <div className="settings-group">
          <div className="settings-group-eyebrow">
            <span className="settings-group-eyebrow-dot" />
            <span>Screenshot</span>
          </div>
          <h3 className="settings-group-title">OCR 截图翻译</h3>

          <div className="form-group">
            <label className="form-label">
              触发快捷键
              <span className="form-hint">修改后立即生效；如默认 Alt+X 与其他软件冲突，换一个</span>
            </label>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="form-input form-input-sm"
                type="text"
                value={settings.ocr_hotkey || 'Alt+X'}
                onChange={(e) => { handleChange('ocr_hotkey', e.target.value); setOcrHotkeyStatus(null) }}
                placeholder="如 Alt+X"
                style={{ fontFamily: "'Sofia Sans', Arial, sans-serif", fontWeight: 500 }}
              />
              {ocrHotkeyStatus === 'ok' && (
                <span style={{ color: '#1F8A5B', fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em' }}>
                  ✓ 已注册
                </span>
              )}
              {ocrHotkeyStatus === 'taken' && (
                <span style={{ color: '#CF4500', fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em' }}>
                  ✗ 被占用，换一个
                </span>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {HOTKEY_PRESETS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`hotkey-chip ${settings.ocr_hotkey === k ? 'active' : ''}`}
                    onClick={() => { handleChange('ocr_hotkey', k); setOcrHotkeyStatus(null) }}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
            <p className="form-hint" style={{ marginTop: 6, lineHeight: 1.5 }}>
              使用方法：按快捷键 → 用截图工具（如 <strong style={{ fontWeight: 500, color: 'var(--mc-ink)' }}>Win+Shift+S</strong>）截一张图 → 自动 OCR 识别并翻译。
            </p>
          </div>
        </div>

        {/* ── 翻译语言 ─────────────────────────────────────────────────── */}
        <div className="settings-group">
          <div className="settings-group-eyebrow">
            <span className="settings-group-eyebrow-dot" />
            <span>Languages</span>
          </div>
          <h3 className="settings-group-title">翻译语言</h3>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">源语言</label>
              <select
                className="form-select"
                value={settings.source_lang || 'en'}
                onChange={(e) => handleChange('source_lang', e.target.value)}
              >
                {LANG_OPTIONS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">目标语言</label>
              <select
                className="form-select"
                value={settings.target_lang || 'zh'}
                onChange={(e) => handleChange('target_lang', e.target.value)}
              >
                {LANG_OPTIONS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-toggle">
              <input
                type="checkbox"
                checked={settings.auto_detect_lang === '1'}
                onChange={(e) => handleChange('auto_detect_lang', e.target.checked ? '1' : '0')}
              />
              <span>自动检测源语言</span>
            </label>
          </div>

          <div className="form-group">
            <label className="form-label">
              翻译风格
              <span className="form-hint">影响浏览器扩展的整页翻译；划词为响应速度始终用极简 prompt，不受此影响。API 配置自定义 prompt 优先级最高</span>
            </label>
            <select
              className="form-select"
              value={settings.prompt_preset || 'general'}
              onChange={(e) => handleChange('prompt_preset', e.target.value)}
            >
              <option value="general">通用</option>
              <option value="novel">小说 · 文学</option>
              <option value="doc">技术文档</option>
            </select>
          </div>
        </div>

        {/* ── 服务设置 ─────────────────────────────────────────────────── */}
        <div className="settings-group">
          <div className="settings-group-eyebrow">
            <span className="settings-group-eyebrow-dot" />
            <span>Service</span>
          </div>
          <h3 className="settings-group-title">服务设置</h3>

          <div className="form-group">
            <label className="form-label">
              HTTP 端口
              <span className="form-hint">浏览器插件通信端口，修改后需重启应用</span>
            </label>
            <input
              className="form-input form-input-sm"
              type="number"
              min="1024"
              max="65535"
              value={settings.port || '27463'}
              onChange={(e) => handleChange('port', e.target.value)}
            />
          </div>
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '保存中…' : saved ? '已保存' : '保存设置'}
          </button>
          {saved && <span className="form-actions-status">所有更改已写入本地数据库。</span>}
        </div>
      </div>
    </div>
  )
}
