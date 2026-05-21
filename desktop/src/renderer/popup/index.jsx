import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  cream:'#F3F0EE', creamLifted:'#FCFBFA', ink:'#141413',
  white:'#FFFFFF', slate:'#696969', orange:'#F37338', signal:'#CF4500',
}
const FONT = "'Sofia Sans', Arial, sans-serif"
const SHADOW_SOFT = '0 4px 16px rgba(0,0,0,0.08)'
const SHADOW_LIFT = '0 24px 48px rgba(0,0,0,0.10), 0 8px 16px rgba(0,0,0,0.04)'
const POS_LABELS = {
  n:'n.',vt:'v.',vi:'v.',v:'v.',adj:'adj.',adv:'adv.',
  prep:'prep.',conj:'conj.',pron:'pron.',num:'num.',
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const PinIcon = ({ active }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M10.5 1.5l4 4-3 1-1.5 4-2-2-3 3-.5-.5 3-3-2-2 4-1.5 1-3z"
      stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"
      fill={active ? 'currentColor' : 'none'} />
  </svg>
)
const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M2.5 2.5l9 9M11.5 2.5l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)
const BookmarkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M3 1.75h8v10.5L7 9.75l-4 2.5V1.75z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
)
const SpeakerIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M2 5.25h2.25L7.5 2.5v9L4.25 8.75H2v-3.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M9.75 4.75a3 3 0 010 4.5M11.25 3.25a5 5 0 010 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

// ── Styles ────────────────────────────────────────────────────────────────────
const ps = {
  shell: {
    width:'100%', height:'100%', background:C.cream, fontFamily:FONT, color:C.ink,
    // 内容超 window 高度时由 shell 自己滚动；footer 用 sticky 贴底永远可见
    overflow:'auto', position:'relative', display:'flex', flexDirection:'column',
    // 关键：no-drag 否则 webkit drag 区会吞掉鼠标滚轮事件（用户在原文区滚不动）
    // 拖动靠下面单独的 dragHandle 细条；userSelect:text 让用户能复制原文/译文
    animation:'tp-rise 0.2s ease-out both', WebkitAppRegion:'no-drag', userSelect:'text',
  },
  dragHandle: {
    // popup 顶部一条不可见的拖拽手柄（避开右上 topActions 按钮区）
    position:'absolute', top:0, left:0, right:80, height:18,
    WebkitAppRegion:'drag', zIndex:1, cursor:'move',
  },
  topActions: {
    position:'absolute', top:14, right:14, display:'flex', gap:7, zIndex:2, WebkitAppRegion:'no-drag',
  },
  iconCircle: {
    width:32, height:32, borderRadius:'50%', background:C.white, border:'none',
    display:'flex', alignItems:'center', justifyContent:'center',
    cursor:'pointer', color:C.ink, boxShadow:SHADOW_SOFT, padding:0,
    transition:'transform 0.15s ease, background 0.15s ease',
  },
  iconCircleActive: { background:C.ink, color:C.cream },
  loadingBody: {
    flex:1, padding:'40px 28px 32px', display:'flex', flexDirection:'column', gap:20,
  },
  loadingLabel: {
    fontSize:14, fontWeight:700, letterSpacing:'0.04em', textTransform:'uppercase',
    color:C.slate, display:'flex', alignItems:'center', gap:8,
  },
  eyebrowDot: { width:6, height:6, borderRadius:'50%', background:C.orange },
  loadingWord: {
    fontSize:24, fontWeight:500, letterSpacing:'-0.02em', color:C.ink, lineHeight:1.1, wordBreak:'break-word',
  },
  progressTrack: {
    height:2, width:'100%', background:'rgba(243,115,56,0.18)',
    borderRadius:999, overflow:'hidden', position:'relative',
  },
  progressBar: {
    position:'absolute', top:0, left:0, bottom:0, width:'40%',
    background:C.orange, borderRadius:999, animation:'tp-progress 1.2s ease-in-out infinite',
  },
  readyTop: { padding:'24px 24px 14px' },
  word: {
    fontSize:26, fontWeight:500, letterSpacing:'-0.02em', color:C.ink,
    lineHeight:1.1, paddingRight:82, wordBreak:'break-word',
  },
  phonetic: { marginTop:5, fontSize:15, fontWeight:450, letterSpacing:'-0.01em', color:C.slate },
  exchangeRow: { display:'flex', flexWrap:'wrap', gap:'3px 10px', marginTop:6 },
  exchangeItem: { fontSize:12, color:C.slate, fontWeight:450 },
  posRow: { display:'flex', flexWrap:'wrap', gap:5, marginTop:12 },
  posTag: {
    background:C.cream, color:C.ink, border:'1px solid rgba(20,20,19,0.10)',
    borderRadius:8, padding:'3px 7px', fontSize:13, fontWeight:700,
    letterSpacing:'0.04em', textTransform:'uppercase', lineHeight:1.1,
  },
  accentDivider: {
    height:1.5, margin:'12px 24px 0', background:C.orange, borderRadius:999, width:'calc(100% - 48px)',
  },
  defsList: {
    listStyle:'none', padding:'14px 24px 4px', display:'flex', flexDirection:'column', gap:8,
    // 不再 flex:1 抢空间 / 不再内滚 —— 让译文自然展开撑高，由外层 shell 整体滚动
    WebkitAppRegion:'no-drag', userSelect:'text',
  },
  defRow: {
    display:'flex', alignItems:'flex-start', gap:10,
    fontSize:13.5, fontWeight:450, letterSpacing:'-0.01em', color:C.ink, lineHeight:1.55,
  },
  defBullet: { width:5, height:5, borderRadius:'50%', background:C.orange, marginTop:8, flexShrink:0 },
  noticeBar: {
    margin:'0 24px 10px', padding:'8px 14px', background:'rgba(207,69,0,0.08)',
    borderRadius:10, fontSize:13, fontWeight:450, color:C.signal, lineHeight:1.4,
    WebkitAppRegion:'no-drag', userSelect:'text',
  },
  footer: {
    background:C.ink, color:C.white, padding:'13px 16px',
    display:'flex', alignItems:'center', gap:8,
    WebkitAppRegion:'no-drag', flexShrink:0,
    // sticky 贴底：内容很长用户滚动时按钮始终可见，不用滚到最底
    position:'sticky', bottom:0, zIndex:2,
  },
  primaryBtn: {
    flex:1, background:C.ink, color:C.cream, border:`1.5px solid ${C.cream}`,
    borderRadius:20, padding:'8px 14px', fontFamily:FONT, fontSize:14, fontWeight:500,
    letterSpacing:'-0.02em', cursor:'pointer',
    display:'flex', alignItems:'center', justifyContent:'center', gap:7,
    transition:'transform 0.15s ease, background 0.15s ease',
  },
  primaryBtnDone: { background:C.cream, color:C.ink, borderColor:C.cream },
  secondaryBtn: {
    background:C.white, color:C.ink, border:'none', borderRadius:999,
    padding:'8px 13px', fontFamily:FONT, fontSize:13, fontWeight:500,
    letterSpacing:'-0.02em', cursor:'pointer',
    display:'flex', alignItems:'center', gap:5, boxShadow:SHADOW_SOFT,
  },
}

// ── Sub-components ────────────────────────────────────────────────────────────
function TopActions({ pinned, onPin, onClose }) {
  return (
    <div style={ps.topActions}>
      <button type="button" title={pinned ? '取消固定' : '固定窗口'} onClick={onPin}
        style={{ ...ps.iconCircle, ...(pinned ? ps.iconCircleActive : {}) }}>
        <PinIcon active={pinned} />
      </button>
      <button type="button" title="关闭" onClick={onClose} style={ps.iconCircle}>
        <CloseIcon />
      </button>
    </div>
  )
}

function LoadingBody({ query, label }) {
  // 跟 ReadyBody 用一致的字号策略：短词 24pt / 长句 17pt
  // 否则 loading → ready 时字号会跳变
  const isShort = (query?.length || 0) < 30
  return (
    <div style={ps.loadingBody}>
      <div style={ps.loadingLabel}><span style={ps.eyebrowDot} /><span>{label || '查询中'}</span></div>
      <div style={{ ...ps.loadingWord, fontSize: isShort ? 24 : 17, lineHeight: isShort ? 1.1 : 1.5 }}>{query || '…'}</div>
      <div style={ps.progressTrack}><div style={ps.progressBar} /></div>
    </div>
  )
}

function ReadyBody({ uiData, added, adding, onAdd, onSpeak }) {
  const { word, phonetic, exchange, pos, definitions, translation, engine, offline, error } = uiData || {}
  const hasDict = definitions?.length > 0
  const hasAI   = !!translation

  return (
    <>
      <div style={ps.readyTop}>
        {/* 短词（< 30 字符）保留 26pt 大气派；长句压到 17pt 不占地方 */}
        <div style={{ ...ps.word, fontSize: (word?.length || 0) < 30 ? 26 : 17, lineHeight: (word?.length || 0) < 30 ? 1.1 : 1.5 }}>{word}</div>
        {phonetic && <div style={ps.phonetic}>{phonetic}</div>}
        {exchange && Object.keys(exchange).length > 0 && (
          <div style={ps.exchangeRow}>
            {exchange.past              && <span style={ps.exchangeItem}>过去式: <em>{exchange.past}</em></span>}
            {exchange.pastParticiple    && <span style={ps.exchangeItem}>过去分词: <em>{exchange.pastParticiple}</em></span>}
            {exchange.presentParticiple && <span style={ps.exchangeItem}>现在分词: <em>{exchange.presentParticiple}</em></span>}
            {exchange.plural            && <span style={ps.exchangeItem}>复数: <em>{exchange.plural}</em></span>}
          </div>
        )}
        {pos?.length > 0 && (
          <div style={ps.posRow}>{pos.map((p, i) => <span key={i} style={ps.posTag}>{p}</span>)}</div>
        )}
      </div>

      {(hasDict || hasAI) && (
        <>
          <div style={ps.accentDivider} />
          <ul style={ps.defsList}>
            {hasDict && definitions.map((d, i) => (
              <li key={i} style={ps.defRow}><span style={ps.defBullet} /><span>{d}</span></li>
            ))}
            {hasAI && (
              <li style={{ ...ps.defRow, marginTop: hasDict ? 8 : 0 }}>
                <span style={{ ...ps.defBullet, background: '#696969' }} />
                <span style={{ color: '#696969' }}>
                  {engine && <span style={{ fontSize:11, fontWeight:700, letterSpacing:'0.03em', marginRight:5, textTransform:'uppercase' }}>{engine}</span>}
                  {translation}
                </span>
              </li>
            )}
          </ul>
        </>
      )}

      {(offline || error) && (
        <div style={ps.noticeBar}>
          {error?.includes('未配置') ? '请在设置页配置翻译 API' : (error || 'API 不可用')}
        </div>
      )}

      <div style={ps.footer}>
        <button type="button" onClick={onAdd} disabled={added || adding}
          style={{ ...ps.primaryBtn, ...(added ? ps.primaryBtnDone : {}), ...(adding ? { opacity:0.65, cursor:'wait' } : {}) }}>
          <BookmarkIcon />
          <span>{added ? '已加入生词本' : adding ? '添加中…' : '加入生词本'}</span>
        </button>
        <button type="button" onClick={onSpeak} style={ps.secondaryBtn} title="朗读">
          <SpeakerIcon /><span>朗读</span>
        </button>
      </div>
    </>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────
function PopupApp() {
  const [state, setState]   = useState('idle')
  const [data, setData]     = useState(null)
  const [pinned, setPinned] = useState(false)
  const [added, setAdded]   = useState(false)
  const [adding, setAdding] = useState(false)
  const shellRef            = useRef(null)

  useEffect(() => {
    const removeLoading = window.electronAPI?.onPopupLoading(({ text, label }) => {
      setState('loading'); setData({ text, label }); setAdded(false)
    })
    const removeData = window.electronAPI?.onPopupData((payload) => {
      setData(payload); setState('ready')
    })
    return () => { removeLoading?.(); removeData?.() }
  }, [])

  // 内容渲染完后量真实 DOM 高度，反馈给主进程 setSize。
  // 同时根据高度推算宽度：内容多就加宽，减少用户竖滚距离。
  //
  // 关键：setSize 改了窗口尺寸 → layout 重排 → shell.scrollHeight 变化（比如 360 宽
  // 下 800 高的内容，720 宽下可能只要 500 高）。useLayoutEffect 本身不会再 fire（依赖
  // 没变），所以监听 window.resize（Electron setSize 会触发它）重新 measure 直到稳定。
  // lastSent 记录已上报值，差距 < 4px 视为收敛、停止上报，避免抖动。
  useLayoutEffect(() => {
    if (state === 'idle') return
    let lastSent = { h: 0, w: 0 }

    const measure = () => {
      const shell = shellRef.current
      if (!shell) return
      const h = shell.scrollHeight
      // 高度阈值 → 目标宽度。横宽比竖滚体感好很多 —— 阈值激进点
      let targetW = 360
      if (h > 380) targetW = 480
      if (h > 540) targetW = 600
      if (h > 700) targetW = 720
      if (Math.abs(h - lastSent.h) < 4 && targetW === lastSent.w) return  // 收敛
      lastSent = { h, w: targetW }
      window.electronAPI?.setPopupSize?.(h, targetW)
    }

    const id = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('resize', measure)
    }
  }, [state, data, pinned, added])

  const handleClose = useCallback(() => {
    window.electronAPI?.closePopup(); setState('idle')
  }, [])

  const handlePin = useCallback(async () => {
    const next = !pinned; setPinned(next)
    await window.electronAPI?.pinPopup(next)
  }, [pinned])

  const handleAdd = useCallback(async () => {
    if (!data?.text || added || adding) return
    setAdding(true)
    try {
      await window.electronAPI?.addWord({
        word:            data.isSingleWord ? data.text : data.text.slice(0, 100),
        phonetic:        data.dict?.phonetic || null,
        definition:      data.dict?.rawTranslation || null,
        source_sentence: data.isSingleWord ? null : data.text,
        translation:     data.translation || null,
        source_url:      null,
      })
      setAdded(true)
    } catch (err) {
      console.error('addWord error:', err)
    } finally {
      setAdding(false)
    }
  }, [data, added, adding])

  const handleSpeak = useCallback(() => {
    const word = data?.dict?.word || data?.text
    if (word) window.speechSynthesis?.speak(new SpeechSynthesisUtterance(word))
  }, [data])

  if (state === 'idle') return null

  // Convert Electron payload → UI format
  const uiData = (() => {
    if (!data) return null
    const { text, isSingleWord, dict, translation, engine, offline, error } = data
    const dictDefs = (isSingleWord && dict?.found && dict.definitions?.length)
      ? dict.definitions.map(d => d.def)
      : []
    return {
      word:        isSingleWord ? (dict?.word || text) : text,
      phonetic:    isSingleWord ? dict?.phonetic : null,
      exchange:    isSingleWord ? dict?.exchange : null,
      pos:         isSingleWord
        ? [...new Set((dict?.definitions || []).map(d => POS_LABELS[d.pos] || (d.pos ? d.pos + '.' : '')).filter(Boolean))]
        : [],
      definitions: dictDefs,
      translation, engine,
      offline, error,
    }
  })()

  return (
    <div ref={shellRef} style={ps.shell} data-state={state}>
      <div style={ps.dragHandle} aria-hidden="true" />
      <TopActions pinned={pinned} onPin={handlePin} onClose={handleClose} />
      {state === 'loading' && <LoadingBody query={data?.text} label={data?.label} />}
      {state === 'ready'   && <ReadyBody uiData={uiData} added={added} adding={adding} onAdd={handleAdd} onSpeak={handleSpeak} />}
    </div>
  )
}

// ── Global styles + keyframes ─────────────────────────────────────────────────
const styleEl = document.createElement('style')
styleEl.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=Sofia+Sans:ital,wght@0,400;0,450;0,500;0,700;1,400&display=swap');
  @keyframes tp-rise { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  @keyframes tp-progress {
    0%{left:-40%;width:40%} 50%{left:30%;width:50%} 100%{left:100%;width:40%}
  }
  *{box-sizing:border-box} body{margin:0;background:#F3F0EE;overflow:hidden}
  /* 加宽到 8px 让长内容时 scrollbar 好拉；hover 时颜色变深 */
  ::-webkit-scrollbar{width:8px;height:8px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:rgba(20,20,19,0.18);border-radius:999px;border:2px solid #F3F0EE}
  ::-webkit-scrollbar-thumb:hover{background:rgba(20,20,19,0.38)}
  button:focus-visible{outline:2px solid #F37338;outline-offset:2px}
`
document.head.appendChild(styleEl)

createRoot(document.getElementById('root')).render(<PopupApp />)
