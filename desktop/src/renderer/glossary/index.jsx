import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'

const C = {
  cream:'#F3F0EE', creamLifted:'#FCFBFA', ink:'#141413',
  white:'#FFFFFF', slate:'#696969', orange:'#F37338', signal:'#CF4500',
  dust:'#D1CDC7', ghost:'#EAE4DB',
  inkBorder10:'rgba(20,20,19,0.10)', inkBorder20:'rgba(20,20,19,0.20)',
}
const FONT        = "'Sofia Sans', Arial, sans-serif"
const SHADOW_SOFT = '0 4px 16px rgba(0,0,0,0.08)'
const SHADOW_LIFT = '0 24px 48px rgba(0,0,0,0.10), 0 8px 16px rgba(0,0,0,0.04)'

// ── Icons ────────────────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
      <circle cx="8" cy="8" r="5.5" stroke={C.ink} strokeWidth="1.6"/>
      <path d="M12.5 12.5l3.5 3.5" stroke={C.ink} strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  )
}
function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  )
}
function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M10.5 2.5l3 3L5 14H2v-3L10.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M2 4h12M6 4V3h4v1M5 4l1 9h4l1-9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function CloseIcon({ size=14, color=C.ink }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M3 3l8 8M11 3l-8 8" stroke={color} strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  )
}

// ── CategoryTag ──────────────────────────────────────────────────────────────

const CATEGORY_COLORS = {
  '角色': { bg:'#FFF0E6', color:'#C84B00' },
  '地名': { bg:'#E6F4FF', color:'#005E9E' },
  '技能': { bg:'#E8F9EE', color:'#1A7A3C' },
  '道具': { bg:'#F5E6FF', color:'#7A00B8' },
  '系统': { bg:'#FFF7E6', color:'#8A5A00' },
}

function CategoryTag({ cat }) {
  if (!cat) return null
  const style = CATEGORY_COLORS[cat] || { bg: C.cream, color: C.slate }
  return (
    <span style={{background:style.bg, color:style.color, borderRadius:8, padding:'3px 8px', fontSize:12, fontWeight:700, letterSpacing:'0.03em', lineHeight:1.1, whiteSpace:'nowrap'}}>
      {cat}
    </span>
  )
}

// ── TermModal (Add / Edit) ───────────────────────────────────────────────────

const PRESET_CATEGORIES = ['角色','地名','技能','道具','系统']

function TermModal({ initial, onSave, onClose }) {
  const isEdit = !!initial?.id
  const [form, setForm] = useState({
    source_term: initial?.source_term || '',
    target_term: initial?.target_term || '',
    category:    initial?.category    || '',
    note:        initial?.note        || '',
  })
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')
  const firstRef = useRef(null)

  useEffect(() => { firstRef.current?.focus() }, [])

  const set = (k, v) => setForm(f => ({...f, [k]: v}))

  const handleSubmit = async () => {
    if (!form.source_term.trim()) return setErr('原文术语不能为空')
    if (!form.target_term.trim()) return setErr('译文术语不能为空')
    setErr(''); setSaving(true)
    try {
      await onSave(form)
    } catch(e) {
      setErr('保存失败：' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleKey = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit() }

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={e => e.stopPropagation()} onKeyDown={handleKey}>
        {/* Header */}
        <div style={st.modalHeader}>
          <div>
            <div style={st.eyebrow}><span style={st.eyebrowDot}/><span>{isEdit ? 'Edit Term' : 'New Term'}</span></div>
            <h2 style={st.modalTitle}>{isEdit ? '编辑术语' : '添加新术语'}</h2>
          </div>
          <button type="button" onClick={onClose} style={st.closeBtn}><CloseIcon /></button>
        </div>

        {/* Form */}
        <div style={st.modalBody}>
          <div style={st.formRow}>
            <div style={st.formGroup}>
              <label style={st.label}>原文（Source）<span style={{color:C.signal}}>*</span></label>
              <input ref={firstRef} type="text" value={form.source_term}
                onChange={e => set('source_term', e.target.value)}
                placeholder="e.g. Mana" style={st.input} />
            </div>
            <div style={st.formGroup}>
              <label style={st.label}>译文（Target）<span style={{color:C.signal}}>*</span></label>
              <input type="text" value={form.target_term}
                onChange={e => set('target_term', e.target.value)}
                placeholder="e.g. 魔力" style={st.input} />
            </div>
          </div>

          <div style={st.formGroup}>
            <label style={st.label}>分类（Category）</label>
            <div style={st.catRow}>
              {PRESET_CATEGORIES.map(c => {
                const active = form.category === c
                return (
                  <button key={c} type="button"
                    onClick={() => set('category', active ? '' : c)}
                    style={{...st.catChip, background: active ? C.ink : C.cream, color: active ? C.cream : C.ink}}>
                    {c}
                  </button>
                )
              })}
              <input type="text" value={form.category}
                onChange={e => set('category', e.target.value)}
                placeholder="自定义" style={{...st.input, minWidth:90, flex:1}} />
            </div>
          </div>

          <div style={st.formGroup}>
            <label style={st.label}>备注（Note）</label>
            <textarea value={form.note} onChange={e => set('note', e.target.value)}
              placeholder="可选的补充说明，如：用于技能名，保留不翻译时写 (keep)" rows={3}
              style={{...st.input, resize:'vertical', minHeight:68, lineHeight:1.5}} />
          </div>

          {err && <div style={st.errMsg}>{err}</div>}
        </div>

        <div style={st.modalFooter}>
          <button type="button" onClick={onClose} style={st.btnSecondary}>取消</button>
          <button type="button" onClick={handleSubmit} disabled={saving}
            style={{...st.btnPrimary, opacity: saving ? 0.6 : 1}}>
            {saving ? '保存中…' : (isEdit ? '保存修改' : '添加术语')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── ConfirmDelete ────────────────────────────────────────────────────────────

function ConfirmDelete({ term, onConfirm, onCancel }) {
  return (
    <div style={st.overlay} onClick={onCancel}>
      <div style={{...st.modal, maxWidth:360, padding:'28px 32px'}} onClick={e => e.stopPropagation()}>
        <h3 style={{margin:'0 0 10px',fontSize:20,fontWeight:500,letterSpacing:'-0.02em',color:C.ink}}>删除术语？</h3>
        <p style={{margin:'0 0 24px',fontSize:14,fontWeight:450,letterSpacing:'-0.01em',color:C.slate,lineHeight:1.5}}>
          将删除 <strong style={{fontWeight:500}}>"{term}"</strong>，此操作不可撤销。
          翻译时将不再自动应用该术语。
        </p>
        <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
          <button type="button" onClick={onCancel}  style={st.btnSecondary}>取消</button>
          <button type="button" onClick={onConfirm} style={st.btnDanger}>删除</button>
        </div>
      </div>
    </div>
  )
}

// ── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2200); return () => clearTimeout(t) }, [])
  return <div style={st.toast}>{message}</div>
}

// ── GlossaryApp ──────────────────────────────────────────────────────────────

// embedded=true 时是被 settings/App.jsx 当 tab 嵌入：
//   - shell 高度由父容器决定（不用 100vh）
//   - header / scrollArea padding 收紧
//   - rail 的 maxHeight 不再绑 viewport
//   - 不渲染底部黑色 footer bar（避免和 settings statusbar 撞）
function GlossaryApp({ embedded = false } = {}) {
  const [entries,  setEntries]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [q,        setQ]        = useState('')
  const [catFilter,setCatFilter]= useState('all')
  const [activeLetter, setActive]= useState('')
  const [modal,    setModal]    = useState(null)   // null | { mode:'add'|'edit', data }
  const [delTarget,setDelTarget]= useState(null)   // entry to delete
  const [toast,    setToast]    = useState(null)
  const scrollRef   = useRef(null)
  const groupRefs   = useRef({})

  // Load
  useEffect(() => {
    ;(async () => {
      setLoading(true)
      try { setEntries(await window.electronAPI?.getGlossary() || []) }
      catch(e) { console.error(e) }
      finally  { setLoading(false) }
    })()
  }, [])

  // Derived: categories
  const allCategories = useMemo(() => {
    const cats = [...new Set(entries.map(e => e.category).filter(Boolean))].sort()
    return cats
  }, [entries])

  // Derived: grouped + filtered
  const grouped = useMemo(() => {
    const k = q.trim().toLowerCase()
    const filtered = entries.filter(e => {
      if (catFilter !== 'all' && e.category !== catFilter) return false
      if (k && !e.source_term?.toLowerCase().includes(k) && !e.target_term?.toLowerCase().includes(k)) return false
      return true
    })
    const map = {}
    for (const e of filtered) {
      const L = (e.source_term || '?')[0].toUpperCase()
      ;(map[L] ||= []).push(e)
    }
    return Object.keys(map).sort().map(L => ({ letter: L, items: map[L] }))
  }, [entries, q, catFilter])

  const totalCount     = grouped.reduce((s, g) => s + g.items.length, 0)
  const presentLetters = new Set(grouped.map(g => g.letter))
  const allLetters     = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

  const jumpTo = (L) => {
    const el = groupRefs.current[L]
    if (el && scrollRef.current) {
      scrollRef.current.scrollTo({ top: el.offsetTop - 80, behavior: 'smooth' })
      setActive(L)
    }
  }

  const handleScroll = () => {
    const c = scrollRef.current; if (!c) return
    const top = c.scrollTop + 90
    let cur = activeLetter
    for (const g of grouped) {
      const el = groupRefs.current[g.letter]
      if (el && el.offsetTop <= top) cur = g.letter
    }
    if (cur !== activeLetter) setActive(cur)
  }

  // CRUD handlers
  const handleAdd = () => setModal({ mode: 'add', data: null })

  const handleEdit = (entry) => setModal({ mode: 'edit', data: entry })

  const handleSave = async (form) => {
    if (modal.mode === 'add') {
      const result = await window.electronAPI?.addGlossaryTerm(form)
      setEntries(es => [...es, { id: result?.id || Date.now(), ...form, created_at: new Date().toISOString() }].sort((a,b) => a.source_term.localeCompare(b.source_term)))
      setToast(`已添加「${form.source_term}」`)
    } else {
      await window.electronAPI?.updateGlossaryTerm(modal.data.id, form)
      setEntries(es => es.map(e => e.id === modal.data.id ? {...e, ...form} : e))
      setToast(`已更新「${form.source_term}」`)
    }
    setModal(null)
  }

  const handleDeleteConfirm = async () => {
    const entry = delTarget; setDelTarget(null)
    setEntries(es => es.filter(e => e.id !== entry.id))
    try {
      await window.electronAPI?.deleteGlossaryTerm(entry.id)
      setToast(`已删除「${entry.source_term}」`)
    } catch(e) {
      console.error(e)
      setEntries(es => [...es, entry].sort((a,b) => a.source_term.localeCompare(b.source_term)))
      setToast('删除失败，请重试')
    }
  }

  const shellSt      = embedded ? {...st.shell,      height:'100%'} : st.shell
  const headerSt     = embedded ? {...st.header,     padding:'20px 28px 12px'} : st.header
  const scrollAreaSt = embedded ? {...st.scrollArea, padding:'0 28px 24px'} : st.scrollArea
  const railSt       = embedded ? {...st.rail,       width:38, padding:'6px 8px 12px 0'} : st.rail
  const railInnerSt  = embedded ? {...st.railInner,  maxHeight:'none'} : st.railInner

  return (
    <div style={shellSt}>
      {/* Header */}
      <header style={headerSt}>
        <div style={st.headerLeft}>
          <h1 style={st.h1}>术语表</h1>
          <p style={st.lede}>{loading ? '加载中…' : `显示 ${totalCount} / 共 ${entries.length} 条`}</p>
        </div>

        <div style={st.controls}>
          {/* Search */}
          <div style={st.searchPill}>
            <SearchIcon />
            <input type="text" value={q} onChange={e => setQ(e.target.value)}
              placeholder="搜索原文或译文" style={st.searchInput} />
            {q && <button type="button" onClick={() => setQ('')} style={st.clearBtn}><CloseIcon size={12}/></button>}
          </div>

          <div style={{display:'flex',gap:8,alignItems:'center',justifyContent:'flex-end',flexWrap:'wrap'}}>
            {/* Category filter */}
            <div style={st.catFilters}>
              {[['all','全部'], ...allCategories.map(c => [c,c])].map(([id,label]) => {
                const active = catFilter === id
                return (
                  <button key={id} type="button" onClick={() => setCatFilter(id)}
                    style={{...st.filterChip, background: active ? C.ink : C.white, color: active ? C.cream : C.ink, boxShadow: active ? 'none' : SHADOW_SOFT}}>
                    {label}
                  </button>
                )
              })}
            </div>

            {/* Add button */}
            <AddButton onClick={handleAdd} />
          </div>
        </div>
      </header>

      {/* Body */}
      <div style={st.bodyWrap}>
        <main ref={scrollRef} onScroll={handleScroll} style={scrollAreaSt} className="mc-scroll">
          {/* Table head */}
          <div style={st.tableHead}>
            <div>原文</div>
            <div>译文</div>
            <div>分类</div>
            <div>备注</div>
            <div />
          </div>

          {grouped.length === 0 ? (
            <div style={st.empty}>
              <div style={st.emptyTitle}>{loading ? '加载中…' : entries.length === 0 ? '术语表还没有内容' : '没有匹配的术语'}</div>
              <div style={st.emptyHint}>
                {loading ? '正在读取数据库…'
                  : entries.length === 0 ? '点右上角「+ 添加术语」添加第一个，翻译时会自动注入到 prompt。'
                  : '调整搜索关键词或分类筛选试试。'}
              </div>
              {!loading && entries.length === 0 && (
                <button type="button" onClick={handleAdd} style={{...st.btnPrimary, marginTop:16}}>
                  <PlusIcon /> 添加第一个术语
                </button>
              )}
            </div>
          ) : (
            grouped.map(group => (
              <section key={group.letter}
                ref={el => { if (el) groupRefs.current[group.letter] = el }}
                style={st.group}>
                <div style={st.groupHeader}>
                  <span style={st.groupGhost} aria-hidden="true">{group.letter}</span>
                  <span style={st.groupFront}>{group.letter}</span>
                  <span style={st.groupCount}>{group.items.length} {group.items.length===1?'entry':'entries'}</span>
                </div>

                <div style={st.tableBody}>
                  {group.items.map((e, i) => (
                    <TermRow key={e.id} entry={e} idx={i}
                      onEdit={() => handleEdit(e)}
                      onDelete={() => setDelTarget(e)} />
                  ))}
                </div>
              </section>
            ))
          )}
        </main>

        {/* A-Z rail */}
        <aside style={railSt}>
          <div style={railInnerSt}>
            {allLetters.map(L => {
              const present = presentLetters.has(L)
              const active  = L === activeLetter && present
              return (
                <button type="button" key={L} disabled={!present} onClick={() => jumpTo(L)}
                  style={{...st.railLetter, background: active ? C.ink : 'transparent', color: active ? C.cream : present ? C.ink : C.dust, cursor: present ? 'pointer' : 'default', fontWeight: active ? 700 : present ? 500 : 450}}>
                  {L}
                </button>
              )
            })}
          </div>
        </aside>
      </div>

      {/* Footer —— 嵌入模式不渲染（避免和 settings 的 status bar 撞色撞位） */}
      {!embedded && (
        <footer style={st.footer}>
          <div style={st.footEyebrow}><span style={{...st.eyebrowDot,background:C.orange}}/><span>Glossary</span></div>
          <div style={st.footStats}>
            <div style={st.footStat}><div style={st.footStatNum}>{entries.length}</div><div style={st.footStatLabel}>Total terms</div></div>
            <div style={st.footDivider}/>
            <div style={st.footStat}><div style={st.footStatNum}>{allCategories.length}</div><div style={st.footStatLabel}>Categories</div></div>
          </div>
        </footer>
      )}

      {/* Modals */}
      {modal && <TermModal initial={modal.data} onSave={handleSave} onClose={() => setModal(null)} />}
      {delTarget && <ConfirmDelete term={delTarget.source_term} onConfirm={handleDeleteConfirm} onCancel={() => setDelTarget(null)} />}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  )
}

// ── TermRow ──────────────────────────────────────────────────────────────────

function TermRow({ entry, idx, onEdit, onDelete }) {
  const [hover, setHover] = useState(false)

  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{...st.row, background: hover ? '#F0EDE9' : idx % 2 === 0 ? C.creamLifted : 'transparent'}}>
      <div style={st.colSource}>
        <span style={st.sourceText}>{entry.source_term}</span>
      </div>
      <div style={st.colTarget}>
        <span style={st.targetText}>{entry.target_term}</span>
      </div>
      <div style={st.colCat}>
        <CategoryTag cat={entry.category} />
      </div>
      <div style={st.colNote}>
        {entry.note && <span style={st.noteText} title={entry.note}>{entry.note.length > 40 ? entry.note.slice(0,40)+'…' : entry.note}</span>}
      </div>
      <div style={st.colActions}>
        <RowBtn icon={<EditIcon/>}  title="编辑"  onClick={onEdit}   color={C.ink}    />
        <RowBtn icon={<TrashIcon/>} title="删除"  onClick={onDelete} color={C.signal} />
      </div>
    </div>
  )
}

function RowBtn({ icon, title, onClick, color }) {
  const [hover, setHover] = useState(false)
  return (
    <button type="button" title={title} onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{...st.rowBtn, background: hover ? color : 'transparent', color: hover ? C.white : color}}>
      {icon}
    </button>
  )
}

function AddButton({ onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <button type="button" onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{...st.addBtn, background: hover ? C.orange : C.ink}}>
      <PlusIcon /> <span>添加术语</span>
    </button>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const st = {
  shell:      {height:'100%',minHeight:0,background:C.cream,fontFamily:FONT,color:C.ink,display:'flex',flexDirection:'column',overflow:'hidden'},
  header:     {display:'flex',alignItems:'flex-end',justifyContent:'space-between',gap:24,padding:'28px 48px 16px',flexWrap:'wrap'},
  headerLeft: {minWidth:240},
  eyebrow:    {display:'flex',alignItems:'center',gap:8,fontSize:14,fontWeight:700,letterSpacing:'0.04em',textTransform:'uppercase',color:C.ink},
  eyebrowDot: {width:6,height:6,borderRadius:'50%',background:C.orange,display:'inline-block'},
  h1:         {margin:'8px 0 4px',fontSize:30,fontWeight:500,letterSpacing:'-0.02em',color:C.ink,lineHeight:1.05},
  lede:       {fontSize:14,fontWeight:450,letterSpacing:'-0.01em',color:C.slate,margin:0},
  controls:   {display:'flex',flexDirection:'column',gap:8,alignItems:'flex-end'},
  searchPill: {display:'flex',alignItems:'center',gap:8,background:C.white,borderRadius:999,padding:'10px 16px',minWidth:280,boxShadow:SHADOW_SOFT},
  searchInput:{flex:1,border:'none',outline:'none',background:'transparent',fontFamily:FONT,fontSize:14,fontWeight:450,letterSpacing:'-0.01em',color:C.ink},
  clearBtn:   {width:20,height:20,borderRadius:'50%',background:C.cream,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0},
  catFilters: {display:'flex',gap:6,background:'transparent',padding:0,flexWrap:'wrap'},
  filterChip: {border:'none',borderRadius:999,padding:'10px 20px',fontFamily:FONT,fontSize:14,fontWeight:500,letterSpacing:'-0.01em',cursor:'pointer',transition:'background 0.15s ease, color 0.15s ease',whiteSpace:'nowrap'},
  addBtn:     {display:'flex',alignItems:'center',gap:7,border:'none',borderRadius:999,padding:'10px 20px',fontFamily:FONT,fontSize:14,fontWeight:600,letterSpacing:'-0.01em',color:C.white,cursor:'pointer',transition:'background 0.15s ease',whiteSpace:'nowrap'},
  bodyWrap:   {flex:1,display:'flex',minHeight:0,position:'relative'},
  scrollArea: {flex:1,overflowY:'auto',overflowX:'hidden',padding:'0 48px 32px',minWidth:0},
  tableHead:  {display:'grid',gridTemplateColumns:'1fr 1fr 100px 1fr 72px',gap:12,background:C.creamLifted,color:C.slate,padding:'10px 18px',borderRadius:14,fontSize:12,fontWeight:700,letterSpacing:'0.04em',position:'sticky',top:0,zIndex:5,boxShadow:SHADOW_SOFT,margin:'6px 0 14px',border:`1px solid ${C.inkBorder10}`},
  group:      {marginTop:40},
  groupHeader:{position:'relative',height:56,marginBottom:6,display:'flex',alignItems:'flex-end',paddingLeft:4,paddingBottom:3,overflow:'visible'},
  groupGhost: {position:'absolute',bottom:-4,left:-12,fontSize:100,fontWeight:500,letterSpacing:'-0.04em',color:C.ghost,lineHeight:0.85,pointerEvents:'none',userSelect:'none',zIndex:0},
  groupFront: {position:'relative',fontSize:30,fontWeight:500,letterSpacing:'-0.02em',color:C.ink,lineHeight:1,paddingLeft:4,zIndex:1},
  groupCount: {position:'relative',marginLeft:12,marginBottom:5,fontSize:12,fontWeight:700,letterSpacing:'0.04em',textTransform:'uppercase',color:C.slate,whiteSpace:'nowrap',zIndex:1},
  tableBody:  {background:C.cream,border:`1px solid ${C.inkBorder10}`,borderRadius:20,overflow:'hidden'},
  row:        {display:'grid',gridTemplateColumns:'1fr 1fr 100px 1fr 72px',gap:12,padding:'11px 18px',alignItems:'center',transition:'background 0.12s ease'},
  colSource:  {},
  colTarget:  {},
  colCat:     {display:'flex',alignItems:'center'},
  colNote:    {minWidth:0},
  colActions: {display:'flex',gap:4,justifyContent:'flex-end'},
  sourceText: {fontSize:16,fontWeight:500,letterSpacing:'-0.02em',color:C.ink},
  targetText: {fontSize:15,fontWeight:450,letterSpacing:'-0.01em',color:C.ink},
  noteText:   {fontSize:12,fontWeight:450,letterSpacing:'-0.01em',color:C.slate,lineHeight:1.4},
  rowBtn:     {width:30,height:30,borderRadius:10,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'background 0.12s ease, color 0.12s ease',padding:0},
  rail:       {width:48,flexShrink:0,padding:'6px 12px 12px 0',display:'flex',alignItems:'flex-start',justifyContent:'center'},
  railInner:  {background:C.white,borderRadius:999,boxShadow:SHADOW_LIFT,padding:'8px 5px',display:'flex',flexDirection:'column',gap:1,position:'sticky',top:14,maxHeight:'calc(100vh - 60px)',overflowY:'auto'},
  railLetter: {border:'none',width:26,height:20,borderRadius:999,fontFamily:FONT,fontSize:11,letterSpacing:'-0.01em',transition:'background 0.12s ease, color 0.12s ease',padding:0},
  empty:      {padding:'60px 32px',textAlign:'center',display:'flex',flexDirection:'column',alignItems:'center',gap:8},
  emptyTitle: {fontSize:20,fontWeight:500,letterSpacing:'-0.02em',color:C.ink},
  emptyHint:  {marginTop:4,fontSize:14,fontWeight:450,letterSpacing:'-0.01em',color:C.slate,maxWidth:380,lineHeight:1.45},
  footer:     {background:C.ink,color:C.white,padding:'22px 48px',display:'flex',alignItems:'center',gap:24,flexWrap:'wrap'},
  footEyebrow:{display:'flex',alignItems:'center',gap:7,fontSize:11,fontWeight:700,letterSpacing:'0.04em',textTransform:'uppercase',color:'rgba(255,255,255,0.6)'},
  footStats:  {display:'flex',alignItems:'center',gap:18},
  footStat:   {display:'flex',flexDirection:'column',gap:2,minWidth:50},
  footStatNum:{fontSize:26,fontWeight:500,letterSpacing:'-0.02em',color:C.white,lineHeight:1},
  footStatLabel:{fontSize:11,fontWeight:450,letterSpacing:'-0.01em',color:'rgba(255,255,255,0.6)'},
  footDivider:{width:1,height:32,background:'rgba(255,255,255,0.18)'},
  // Modal
  overlay:    {position:'fixed',inset:0,background:'rgba(20,20,19,0.50)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200},
  modal:      {background:C.white,borderRadius:28,maxWidth:520,width:'95%',boxShadow:SHADOW_LIFT,display:'flex',flexDirection:'column',maxHeight:'90vh'},
  modalHeader:{display:'flex',alignItems:'flex-start',justifyContent:'space-between',padding:'28px 32px 0'},
  modalTitle: {margin:'6px 0 0',fontSize:22,fontWeight:500,letterSpacing:'-0.02em',color:C.ink},
  closeBtn:   {width:34,height:34,borderRadius:'50%',background:C.cream,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:4},
  modalBody:  {padding:'20px 32px',overflowY:'auto',display:'flex',flexDirection:'column',gap:16},
  modalFooter:{padding:'16px 32px 28px',display:'flex',gap:10,justifyContent:'flex-end',borderTop:`1px solid ${C.inkBorder10}`,marginTop:4},
  formRow:    {display:'grid',gridTemplateColumns:'1fr 1fr',gap:14},
  formGroup:  {display:'flex',flexDirection:'column',gap:6},
  label:      {fontSize:13,fontWeight:600,letterSpacing:'0.02em',textTransform:'uppercase',color:C.slate},
  input:      {border:`1.5px solid ${C.inkBorder20}`,borderRadius:14,padding:'10px 14px',fontFamily:FONT,fontSize:15,fontWeight:450,letterSpacing:'-0.01em',color:C.ink,outline:'none',background:C.cream,transition:'border-color 0.15s ease'},
  catRow:     {display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'},
  catChip:    {border:'none',borderRadius:10,padding:'6px 13px',fontFamily:FONT,fontSize:13,fontWeight:600,cursor:'pointer',transition:'background 0.15s ease, color 0.15s ease',letterSpacing:'0.02em'},
  errMsg:     {fontSize:13,fontWeight:500,color:C.signal,padding:'8px 12px',background:'#FFF0EE',borderRadius:10},
  btnPrimary: {display:'flex',alignItems:'center',gap:7,border:'none',borderRadius:999,padding:'11px 24px',fontFamily:FONT,fontSize:14,fontWeight:600,letterSpacing:'-0.01em',background:C.ink,color:C.white,cursor:'pointer',transition:'opacity 0.15s ease'},
  btnSecondary:{border:`1.5px solid ${C.inkBorder20}`,background:'transparent',borderRadius:999,padding:'10px 20px',fontFamily:FONT,fontSize:14,fontWeight:500,letterSpacing:'-0.01em',cursor:'pointer',color:C.ink},
  btnDanger:  {border:'none',background:C.signal,color:C.white,borderRadius:999,padding:'10px 20px',fontFamily:FONT,fontSize:14,fontWeight:500,letterSpacing:'-0.01em',cursor:'pointer'},
  toast:      {position:'fixed',bottom:32,left:'50%',transform:'translateX(-50%)',background:C.ink,color:C.white,borderRadius:999,padding:'12px 24px',fontSize:14,fontWeight:500,letterSpacing:'-0.01em',boxShadow:SHADOW_LIFT,zIndex:300,pointerEvents:'none',whiteSpace:'nowrap'},
}

// 同 wordbook/index.jsx：独立 entry 才挂 createRoot + 注入全局 style，嵌入模式跳过。
const __isStandaloneEntry =
  typeof window !== 'undefined' &&
  window.location?.pathname?.endsWith('/glossary/index.html')

if (__isStandaloneEntry) {
  const tag = document.createElement('style')
  tag.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Sofia+Sans:ital,wght@0,400;0,450;0,500;0,700;1,400&display=swap');
    *{box-sizing:border-box} body,html{margin:0;padding:0}
    .mc-scroll::-webkit-scrollbar{width:4px}
    .mc-scroll::-webkit-scrollbar-thumb{background:${C.dust};border-radius:999px}
    .mc-scroll::-webkit-scrollbar-track{background:transparent}
    *::-webkit-scrollbar{width:4px} *::-webkit-scrollbar-thumb{background:${C.dust};border-radius:999px}
    *::-webkit-scrollbar-track{background:transparent}
    ::placeholder{color:${C.slate};opacity:1}
    input:focus,textarea:focus{border-color:${C.ink}!important}
  `
  document.head.appendChild(tag)
  createRoot(document.getElementById('root')).render(<GlossaryApp />)
}

export default GlossaryApp
