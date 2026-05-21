import React, { useState, useEffect, useMemo, useRef } from 'react'
import { createRoot } from 'react-dom/client'

const C = {
  cream:'#F3F0EE', creamLifted:'#FCFBFA', ink:'#141413',
  white:'#FFFFFF', slate:'#696969', orange:'#F37338', signal:'#CF4500',
  inkBorder10:'rgba(20,20,19,0.10)', inkBorder20:'rgba(20,20,19,0.20)',
}
const FONT = "'Sofia Sans', Arial, sans-serif"

// SRS 5 个阶段（review_count）配色 + 标签：stage 0 红 → 5 灰（毕业）
const STAGE_COLORS = ['#E5484D', '#F37338', '#EAB308', '#3B82F6', '#16A34A', '#9CA3AF']
const STAGE_LABELS = ['新',      '初熟',    '半熟',    '熟',      '稳',      '毕业']
const SHADOW_CARD       = '0 16px 40px rgba(0,0,0,0.06)'
const SHADOW_CARD_HOVER = '0 28px 56px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.04)'
const SHADOW_SOFT       = '0 4px 16px rgba(0,0,0,0.08)'
const SHADOW_LIFT       = '0 24px 48px rgba(0,0,0,0.10), 0 8px 16px rgba(0,0,0,0.04)'

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
      <circle cx="8" cy="8" r="5.5" stroke={C.ink} strokeWidth="1.6" />
      <path d="M12.5 12.5l3.5 3.5" stroke={C.ink} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
function CloseIcon({ color = C.ink }) {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <path d="M3 3l8 8M11 3l-8 8" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
      <path d="M9 3v9M5.5 9l3.5 3.5L12.5 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 14h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

// ── Export helpers ───────────────────────────────────────────────────────────

function today() { return new Date().toISOString().slice(0,10).replace(/-/g,'') }

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function exportCSV(words) {
  const headers = ['Word','Phonetic','Definition','Translation','Example Sentence','Source URL','Added At']
  const esc = v => { const s = String(v||''); return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s }
  const rows = words.map(w => [w.word,w.phonetic,w.definition,w.translation,w.source_sentence,w.source_url,w.added_at].map(esc).join(','))
  triggerDownload(new Blob(['\uFEFF'+[headers.join(','),...rows].join('\n')],{type:'text/csv;charset=utf-8;'}), `wordbook_${today()}.csv`)
}

function exportAnki(words) {
  const rows = words.map(w => {
    const front = w.word + (w.phonetic ? `<br><small>${w.phonetic}</small>` : '')
    const back  = [w.definition||'', w.translation?`<i>${w.translation}</i>`:'', w.source_sentence?`<blockquote>${w.source_sentence}</blockquote>`:''].filter(Boolean).join('<br>')
    return `${front}\t${back}\twordbook`
  })
  triggerDownload(new Blob([rows.join('\n')],{type:'text/plain;charset=utf-8;'}), `wordbook_anki_${today()}.txt`)
}

// ── ExportMenu ───────────────────────────────────────────────────────────────

function ExportMenu({ words }) {
  const [open,setOpen]   = useState(false)
  const [hover,setHover] = useState(false)
  const ref              = useRef(null)

  useEffect(() => {
    if (!open) return
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} style={{position:'relative'}}>
      <button type="button"
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        disabled={words.length === 0}
        style={{...st.exportBtn, background: hover&&words.length>0 ? C.ink : C.white, color: hover&&words.length>0 ? C.cream : C.ink, opacity: words.length===0 ? 0.4 : 1, cursor: words.length===0 ? 'not-allowed' : 'pointer'}}>
        <DownloadIcon /><span>导出</span>
      </button>
      {open && (
        <div style={st.dropdown}>
          {[['CSV (Excel 可打开)','.csv',() => {exportCSV(words);setOpen(false)}],
            ['Anki 导入格式','.txt',() => {exportAnki(words);setOpen(false)}]
          ].map(([label,hint,fn]) => {
            const [h,sh] = [useState(false)[0], useState(false)[1]]
            return <DropItem key={label} label={label} hint={hint} onClick={fn} />
          })}
        </div>
      )}
    </div>
  )
}

function DropItem({ label, hint, onClick }) {
  const [hover,setHover] = useState(false)
  return (
    <button type="button" onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{...st.dropItem, background: hover ? C.cream : 'transparent'}}>
      <span style={{fontSize:14,fontWeight:450,letterSpacing:'-0.01em'}}>{label}</span>
      <span style={{fontSize:12,fontWeight:700,letterSpacing:'0.04em',color:C.slate,textTransform:'uppercase'}}>{hint}</span>
    </button>
  )
}

// ── ConfirmDialog ────────────────────────────────────────────────────────────

function ConfirmDialog({ word, onConfirm, onCancel }) {
  return (
    <div style={st.overlay} onClick={onCancel}>
      <div style={st.dialog} onClick={e => e.stopPropagation()}>
        <h3 style={st.dialogTitle}>移出生词本？</h3>
        <p style={st.dialogBody}>将从生词本中删除 <strong style={{fontWeight:500}}>"{word}"</strong>，此操作不可撤销。</p>
        <div style={st.dialogActions}>
          <button type="button" onClick={onCancel}  style={st.btnSecondary}>取消</button>
          <button type="button" onClick={onConfirm} style={st.btnDanger}>删除</button>
        </div>
      </div>
    </div>
  )
}

// ── WordCard ─────────────────────────────────────────────────────────────────

function WordCard({ entry, onDelete, onReset }) {
  const [hover,setHover]     = useState(false)
  const [delH,setDelH]       = useState(false)
  const [resetH,setResetH]   = useState(false)
  const [confirm,setConfirm] = useState(false)

  const defs   = (entry.definition||entry.translation||'').split(/\n|；|;/).map(s=>s.trim()).filter(Boolean).slice(0,2)
  const posSet = [...new Set((entry.definition||'').match(/\b(n|v|vt|vi|adj|adv|prep|conj|pron|num)\./g)||[])]

  const stage      = Math.min(entry.review_count || 0, 5)
  const stageColor = STAGE_COLORS[stage]
  const stageLabel = STAGE_LABELS[stage]

  return (
    <>
      <article
        onMouseEnter={() => setHover(true)} onMouseLeave={() => {setHover(false);setDelH(false);setResetH(false)}}
        style={{...st.card, transform: hover?'translateY(-4px)':'translateY(0)', boxShadow: hover?SHADOW_CARD_HOVER:SHADOW_CARD}}>

        <div title={`${stageLabel} 阶段（review_count = ${entry.review_count || 0}）`}
             style={{...st.stageChip, background: stageColor}} />

        <button type="button" onClick={() => setConfirm(true)}
          onMouseEnter={() => setDelH(true)} onMouseLeave={() => setDelH(false)}
          title="移出生词本"
          style={{...st.delBtn, background: delH?C.signal:C.white, color: delH?C.white:C.ink, opacity: hover?1:0.6}}>
          <CloseIcon color={delH ? C.white : C.ink} />
        </button>

        <h3 style={st.cardWord}>{entry.word}</h3>
        {entry.phonetic && <div style={st.cardPhonetic}>{entry.phonetic}</div>}

        {posSet.length > 0 && (
          <div style={st.posRow}>{posSet.map((p,i) => <span key={i} style={st.posTag}>{p}</span>)}</div>
        )}

        {defs.length > 0 && (
          <ul style={st.defList}>
            {defs.map((d,i) => (
              <li key={i} style={st.defRow}><span style={st.defBullet} /><span>{d}</span></li>
            ))}
          </ul>
        )}

        {entry.source_sentence && (
          <div style={st.sentenceBlock}>
            <div style={st.sentenceText}>{entry.source_sentence.length>90?entry.source_sentence.slice(0,90)+'…':entry.source_sentence}</div>
          </div>
        )}

        <div style={st.cardFooter}>
          <button type="button" onClick={() => onReset?.(entry.id)}
            onMouseEnter={() => setResetH(true)} onMouseLeave={() => setResetH(false)}
            title={stage >= 5 ? '已毕业 · 点重置重新加入复习循环' : '回到 stage 0 重新走一轮记忆曲线'}
            style={{...st.resetBtn, background: resetH?C.ink:'transparent', color: resetH?C.cream:C.slate, opacity: hover?1:0.55}}>
            重置
          </button>
          {entry.added_at && <span style={st.cardDate}>{new Date(entry.added_at).toLocaleDateString('zh-CN',{month:'short',day:'numeric'})}</span>}
        </div>
      </article>

      {confirm && <ConfirmDialog word={entry.word} onConfirm={() => {setConfirm(false);onDelete(entry.id)}} onCancel={() => setConfirm(false)} />}
    </>
  )
}

// ── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, onDone }) {
  useEffect(() => { const t = setTimeout(onDone,2200); return ()=>clearTimeout(t) },[])
  return <div style={st.toast}>{message}</div>
}

// ── EmptyState ───────────────────────────────────────────────────────────────

function EmptyState({ q, loading }) {
  return (
    <div style={st.empty}>
      <svg width="160" height="100" viewBox="0 0 180 120" fill="none">
        <path d="M10 88 Q 50 8, 110 50 T 170 38" stroke={C.orange} strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <circle cx="170" cy="38" r="4" fill={C.orange} />
        <circle cx="10"  cy="88" r="4" fill={C.orange} />
      </svg>
      <div style={st.emptyTitle}>{loading?'加载中…':q?'没有匹配的生词':'生词本还是空的'}</div>
      <div style={st.emptyHint}>{loading?'正在读取数据库…':q?`没有找到包含「${q}」的单词，换个关键词试试。`:'在翻译弹窗中点「加入生词本」，单词会出现在这里。'}</div>
    </div>
  )
}

// ── WordbookApp ──────────────────────────────────────────────────────────────

// embedded=true 时是被 settings/App.jsx 当 tab 嵌入，宽度比独立窗口窄、
// 高度由父 main-content 决定 —— 走更紧凑的 padding，不渲染底部黑色 footer bar
// （避免和 settings 自带的 statusbar 视觉冲突）
function WordbookApp({ embedded = false } = {}) {
  const [words,setWords]     = useState([])
  const [loading,setLoading] = useState(true)
  const [q,setQ]             = useState('')
  const [focus,setFocus]     = useState(false)
  const [toast,setToast]     = useState(null)

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      try { setWords(await window.electronAPI?.getWordbook() || []) }
      catch(e) { console.error(e) }
      finally  { setLoading(false) }
    })()
  }, [])

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase()
    return k ? words.filter(w => w.word?.toLowerCase().includes(k) || w.definition?.toLowerCase().includes(k) || w.translation?.toLowerCase().includes(k)) : words
  }, [q,words])

  const handleDelete = async (id) => {
    const deleted = words.find(w => w.id === id)
    setWords(ws => ws.filter(w => w.id !== id))
    try {
      await window.electronAPI?.deleteWord(id)
      setToast(`已移除「${deleted?.word||''}」`)
    } catch(e) {
      console.error(e)
      setWords(ws => [deleted,...ws].sort((a,b) => new Date(b.added_at)-new Date(a.added_at)))
      setToast('删除失败，请重试')
    }
  }

  const handleReset = async (id) => {
    const w = words.find(x => x.id === id)
    try {
      const result = await window.electronAPI?.resetWord(id)
      // 本地更新 stage + next_review，避免再 fetch 全表
      setWords(ws => ws.map(x => x.id === id
        ? { ...x, review_count: 0, next_review: result?.next_review ?? x.next_review }
        : x))
      setToast(`已重置「${w?.word||''}」到 stage 0`)
    } catch(e) {
      console.error(e)
      setToast('重置失败，请重试')
    }
  }

  const shellSt  = embedded ? {...st.shell,  minHeight:'100%'} : st.shell
  const headerSt = embedded ? {...st.header, padding:'24px 28px 14px'} : st.header
  const bodySt   = embedded ? {...st.body,   padding:'4px 28px 24px'} : st.body

  return (
    <div style={shellSt}>
      <header style={headerSt}>
        <div>
          <h1 style={st.h1}>我的生词本</h1>
          <p style={st.lede}>收藏的单词与短语 · 共 <strong style={{fontWeight:500}}>{words.length}</strong> 条</p>
        </div>

        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <div style={{...st.searchPill, boxShadow: focus?SHADOW_LIFT:SHADOW_SOFT, border: focus?`1.5px solid ${C.ink}`:'1.5px solid transparent'}}>
            <SearchIcon />
            <input type="text" value={q} onChange={e=>setQ(e.target.value)}
              onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
              placeholder="搜索单词或释义" style={st.searchInput} />
            {q && <button type="button" onClick={() => setQ('')} style={st.clearBtn}><CloseIcon /></button>}
          </div>
          <ExportMenu words={words} />
        </div>
      </header>

      <main style={bodySt}>
        {loading || filtered.length === 0
          ? <EmptyState q={q.trim()} loading={loading} />
          : <div style={st.grid}>{filtered.map(e => <WordCard key={e.id} entry={e} onDelete={handleDelete} onReset={handleReset} />)}</div>
        }
      </main>

      {!embedded && (
        <footer style={st.footer}>
          <div style={st.footEyebrow}><span style={{...st.eyebrowDot,background:C.orange}} /><span>Vocabulary</span></div>
          <div style={st.footStats}>
            <div style={st.footStat}><div style={st.footStatNum}>{words.length}</div><div style={st.footStatLabel}>Total words</div></div>
            <div style={st.footDivider} />
            <div style={st.footStat}><div style={st.footStatNum}>{filtered.length}</div><div style={st.footStatLabel}>Showing</div></div>
          </div>
        </footer>
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  )
}

const st = {
  shell:       {minHeight:'100%',background:C.cream,fontFamily:FONT,color:C.ink,display:'flex',flexDirection:'column',position:'relative'},
  header:      {display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:20,padding:'36px 48px 20px',flexWrap:'wrap'},
  eyebrow:     {display:'flex',alignItems:'center',gap:8,fontSize:14,fontWeight:700,letterSpacing:'0.04em',textTransform:'uppercase',color:C.ink},
  eyebrowDot:  {width:6,height:6,borderRadius:'50%',background:C.orange,display:'inline-block'},
  h1:          {margin:'10px 0 6px',fontSize:32,fontWeight:500,letterSpacing:'-0.02em',color:C.ink,lineHeight:1.05},
  lede:        {fontSize:15,fontWeight:450,letterSpacing:'-0.01em',color:C.slate,margin:0},
  searchPill:  {display:'flex',alignItems:'center',gap:8,background:C.white,borderRadius:999,padding:'10px 16px',minWidth:260,transition:'box-shadow 0.18s ease, border-color 0.18s ease'},
  searchInput: {flex:1,border:'none',outline:'none',background:'transparent',fontFamily:FONT,fontSize:14,fontWeight:450,letterSpacing:'-0.01em',color:C.ink},
  clearBtn:    {width:22,height:22,borderRadius:'50%',background:C.cream,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0},
  exportBtn:   {display:'flex',alignItems:'center',gap:7,border:'none',borderRadius:999,padding:'10px 18px',fontFamily:FONT,fontSize:14,fontWeight:500,letterSpacing:'-0.01em',boxShadow:SHADOW_SOFT,transition:'background 0.15s ease, color 0.15s ease'},
  dropdown:    {position:'absolute',top:'calc(100% + 8px)',right:0,background:C.white,borderRadius:20,boxShadow:SHADOW_LIFT,padding:6,minWidth:200,zIndex:100,display:'flex',flexDirection:'column',gap:2},
  dropItem:    {display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,border:'none',borderRadius:14,padding:'10px 14px',cursor:'pointer',textAlign:'left',fontFamily:FONT,transition:'background 0.12s ease'},
  body:        {flex:1,padding:'4px 48px 40px'},
  grid:        {display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))',gap:18},
  card:        {position:'relative',background:C.creamLifted,borderRadius:36,padding:'24px 24px 16px',boxShadow:SHADOW_CARD,transition:'transform 0.2s ease, box-shadow 0.2s ease',overflow:'hidden',display:'flex',flexDirection:'column'},
  stageChip:   {position:'absolute',top:18,left:18,width:10,height:10,borderRadius:'50%',boxShadow:'0 0 0 2px rgba(255,255,255,0.7)'},
  delBtn:      {position:'absolute',top:14,right:14,width:36,height:36,borderRadius:'50%',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:SHADOW_SOFT,transition:'background 0.15s ease, opacity 0.15s ease',padding:0},
  cardWord:    {margin:0,fontSize:24,fontWeight:500,letterSpacing:'-0.02em',color:C.ink,lineHeight:1.1,paddingRight:48,wordBreak:'break-word'},
  cardPhonetic:{marginTop:5,fontSize:14,fontWeight:450,letterSpacing:'-0.01em',color:C.slate},
  posRow:      {display:'flex',flexWrap:'wrap',gap:5,marginTop:12},
  posTag:      {background:C.cream,color:C.ink,border:`1px solid ${C.inkBorder10}`,borderRadius:8,padding:'3px 7px',fontSize:12,fontWeight:700,letterSpacing:'0.04em',textTransform:'uppercase',lineHeight:1.1},
  defList:     {listStyle:'none',padding:0,margin:'14px 0 0',display:'flex',flexDirection:'column',gap:7},
  defRow:      {display:'flex',alignItems:'flex-start',gap:9,fontSize:13,fontWeight:450,letterSpacing:'-0.01em',color:C.ink,lineHeight:1.5},
  defBullet:   {width:5,height:5,borderRadius:'50%',background:C.orange,marginTop:8,flexShrink:0},
  sentenceBlock:{marginTop:12,paddingTop:10,borderTop:`1px solid ${C.inkBorder10}`},
  sentenceText: {fontSize:12,fontWeight:450,letterSpacing:'-0.01em',color:C.slate,lineHeight:1.45,fontStyle:'italic'},
  cardFooter:  {marginTop:'auto',paddingTop:10,display:'flex',alignItems:'center',justifyContent:'space-between',gap:10},
  cardDate:    {fontSize:11,fontWeight:450,letterSpacing:'-0.01em',color:C.slate},
  resetBtn:    {border:'none',borderRadius:999,padding:'4px 10px',fontFamily:FONT,fontSize:11,fontWeight:500,letterSpacing:'-0.01em',cursor:'pointer',transition:'background 0.15s ease, color 0.15s ease, opacity 0.15s ease'},
  empty:       {minHeight:360,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',textAlign:'center',padding:'40px 32px',gap:10},
  emptyEyebrow:{marginTop:4,display:'flex',alignItems:'center',gap:8,fontSize:13,fontWeight:700,letterSpacing:'0.04em',textTransform:'uppercase',color:C.slate},
  emptyTitle:  {fontSize:22,fontWeight:500,letterSpacing:'-0.02em',color:C.ink},
  emptyHint:   {fontSize:14,fontWeight:450,letterSpacing:'-0.01em',color:C.slate,maxWidth:340,lineHeight:1.45},
  footer:      {background:C.ink,color:C.white,padding:'22px 48px',display:'flex',alignItems:'center',gap:24,flexWrap:'wrap'},
  footEyebrow: {display:'flex',alignItems:'center',gap:7,fontSize:11,fontWeight:700,letterSpacing:'0.04em',textTransform:'uppercase',color:'rgba(255,255,255,0.6)'},
  footStats:   {display:'flex',alignItems:'center',gap:18},
  footStat:    {display:'flex',flexDirection:'column',gap:2,minWidth:50},
  footStatNum: {fontSize:26,fontWeight:500,letterSpacing:'-0.02em',color:C.white,lineHeight:1},
  footStatLabel:{fontSize:11,fontWeight:450,letterSpacing:'-0.01em',color:'rgba(255,255,255,0.6)'},
  footDivider: {width:1,height:32,background:'rgba(255,255,255,0.18)'},
  overlay:     {position:'fixed',inset:0,background:'rgba(20,20,19,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200},
  dialog:      {background:C.white,borderRadius:28,padding:'32px 36px',maxWidth:340,width:'90%',boxShadow:SHADOW_LIFT},
  dialogTitle: {margin:'0 0 10px',fontSize:20,fontWeight:500,letterSpacing:'-0.02em',color:C.ink},
  dialogBody:  {margin:'0 0 24px',fontSize:14,fontWeight:450,letterSpacing:'-0.01em',color:C.slate,lineHeight:1.5},
  dialogActions:{display:'flex',gap:10,justifyContent:'flex-end'},
  btnSecondary:{border:`1.5px solid ${C.inkBorder20}`,background:'transparent',borderRadius:999,padding:'9px 20px',fontFamily:FONT,fontSize:14,fontWeight:500,letterSpacing:'-0.01em',cursor:'pointer',color:C.ink},
  btnDanger:   {border:'none',background:C.signal,color:C.white,borderRadius:999,padding:'9px 20px',fontFamily:FONT,fontSize:14,fontWeight:500,letterSpacing:'-0.01em',cursor:'pointer'},
  toast:       {position:'fixed',bottom:32,left:'50%',transform:'translateX(-50%)',background:C.ink,color:C.white,borderRadius:999,padding:'12px 24px',fontSize:14,fontWeight:500,letterSpacing:'-0.01em',boxShadow:SHADOW_LIFT,zIndex:300,pointerEvents:'none',whiteSpace:'nowrap'},
}

// Module 既能作为独立窗口 entry 加载 (createRoot 自挂)，也能被 settings/App.jsx
// import 当 tab 嵌入。判断方式：URL 以 wordbook/index.html 结尾就是独立 entry。
// 嵌入模式下不注入全局 style（避免污染父文档），样式靠 settings/styles.css 兜底。
const __isStandaloneEntry =
  typeof window !== 'undefined' &&
  window.location?.pathname?.endsWith('/wordbook/index.html')

if (__isStandaloneEntry) {
  const tag = document.createElement('style')
  tag.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Sofia+Sans:ital,wght@0,400;0,450;0,500;0,700;1,400&display=swap');
    *{box-sizing:border-box} body,html{margin:0;padding:0}
    *::-webkit-scrollbar{width:6px;height:6px}
    *::-webkit-scrollbar-thumb{background:rgba(20,20,19,0.15);border-radius:999px}
    *::-webkit-scrollbar-track{background:transparent}
    ::placeholder{color:#696969;opacity:1}
  `
  document.head.appendChild(tag)
  createRoot(document.getElementById('root')).render(<WordbookApp />)
}

export default WordbookApp
