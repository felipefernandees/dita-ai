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
  return db
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
