import Database from 'better-sqlite3'

let db = null

export function initDb(dbPath) {
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      raw_text TEXT,
      app_name TEXT,
      duration_ms INTEGER,
      words INTEGER,
      ppm REAL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS dictionary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      term TEXT NOT NULL,
      replacement TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS snippets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  `)
  seedDictionary()
  return db
}

// Nomes que o Whisper não tem como escrever certo nem com o vocabulário no
// prompt, porque a fala é ambígua (sigla soletrada, marca com grafia torta).
// Semeado só na primeira vez: o Felipe pode editar ou apagar à vontade.
const DICIONARIO_BASE = [
  ['m8n', 'n8n'], ['n8m', 'n8n'], ['N8N', 'n8n'],
  ['whisper flow', 'Wispr Flow'], ['wisper flow', 'Wispr Flow'], ['super flow', 'Wispr Flow'],
  ['supa base', 'Supabase'], ['super base', 'Supabase'],
  ['rabbit mq', 'RabbitMQ'], ['versel', 'Vercel'], ['obsidiam', 'Obsidian'],
  ['ia for business', 'IA4Business'], ['ia4 business', 'IA4Business']
]

function seedDictionary() {
  const feito = db.prepare("SELECT value FROM settings WHERE key = 'dictionarySeeded'").get()
  if (feito) return
  const ins = db.prepare('INSERT INTO dictionary (term, replacement) VALUES (?, ?)')
  const tx = db.transaction(() => {
    for (const [term, replacement] of DICIONARIO_BASE) ins.run(term, replacement)
    db.prepare("INSERT INTO settings (key, value) VALUES ('dictionarySeeded', '1')").run()
  })
  tx()
}

export function saveDictation({ text, rawText, appName, durationMs }) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const ppm = durationMs > 0 ? Math.round((words / (durationMs / 60000)) * 10) / 10 : 0
  const info = db.prepare(
    'INSERT INTO history (text, raw_text, app_name, duration_ms, words, ppm) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(text, rawText, appName, durationMs, words, ppm)
  return db.prepare('SELECT * FROM history WHERE id = ?').get(info.lastInsertRowid)
}

export function getLastDictation() {
  return db.prepare('SELECT * FROM history ORDER BY id DESC LIMIT 1').get()
}

export function listHistory(limit = 50) {
  return db.prepare('SELECT * FROM history ORDER BY id DESC LIMIT ?').all(limit)
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? row.value : fallback
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value))
}

export function listDictionary() {
  return db.prepare('SELECT * FROM dictionary ORDER BY id').all()
}

export function listSnippets() {
  return db.prepare('SELECT * FROM snippets ORDER BY id').all()
}
