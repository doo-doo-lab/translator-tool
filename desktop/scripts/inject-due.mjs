// Inject a due wordbook entry so SRS tick fires immediately on next startup.
// Run from desktop/ folder so the local node_modules better-sqlite3 resolves.
import Database from 'better-sqlite3'
import path from 'node:path'
import os from 'node:os'

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'desktop', 'data.db')
console.log('DB:', dbPath)

const db = new Database(dbPath)

// 5 minutes in the past = definitely due
const past = new Date(Date.now() - 5 * 60_000).toISOString()

// Insert a marker word that's easy to spot in notifications
const r = db.prepare(`
  INSERT INTO wordbook (word, phonetic, definition, translation, source_sentence, review_count, next_review)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
  'verification_marker_' + Date.now().toString(36),
  '/test/',
  'AUMI verification marker',
  'AUMI 验证标记',
  'srs notification test',
  0,
  past,
)
console.log('inserted id =', r.lastInsertRowid, 'with next_review =', past)

// Confirm due query returns it
const due = db.prepare(`SELECT id, word, next_review FROM wordbook WHERE next_review IS NOT NULL AND next_review <= datetime('now')`).all()
console.log('due rows:', JSON.stringify(due, null, 2))

db.close()
