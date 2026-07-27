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

// Glossário de desenvolvedor. MEDIDO, não imaginado: as entradas abaixo saíram
// de transcrições reais de uma frase densa de jargão (scripts/diag-vocabulario.js).
//
// Por que aqui e não na instrução do modelo: testamos mandar um glossário na
// systemInstruction do Gemini e a saída ficou IDÊNTICA, palavra por palavra.
// A transcrição da entrada (inputTranscription) é feita por um caminho de ASR
// que ignora a instrução do modelo. Corrigir depois, no polish(), é o único
// ponto que funciona — e tem a vantagem de valer para os DOIS motores, porque
// o polish está no caminho compartilhado.
//
// Regra para entrar nesta lista: a forma errada NÃO pode ser palavra legítima
// do português nem termo válido de dev. Substituição é regex cega — uma
// entrada ruim corrompe texto certo. Por isso "webp" (formato de imagem real)
// não vira "webhook", e "compus" sozinho não é tocado, só "docker compus".
const DICIONARIO_DEV = [
  // grafia/espaçamento de ferramentas
  ['git hub', 'GitHub'], ['git lab', 'GitLab'], ['bit bucket', 'Bitbucket'],
  ['post gres', 'Postgres'], ['postgree', 'Postgres'], ['graph ql', 'GraphQL'],
  ['type script', 'TypeScript'], ['java script', 'JavaScript'],
  ['node js', 'Node.js'], ['next js', 'Next.js'], ['vue js', 'Vue.js'],
  ['vs code', 'VS Code'], ['tail wind', 'Tailwind'], ['cloud flare', 'Cloudflare'],
  ['fire base', 'Firebase'], ['red is', 'Redis'], ['kafca', 'Kafka'],
  ['kubernets', 'Kubernetes'], ['cubernetes', 'Kubernetes'],
  // termos compostos que o ASR separa
  ['web hook', 'webhook'], ['end point', 'endpoint'], ['front end', 'frontend'],
  ['back end', 'backend'], ['pull requeste', 'pull request'], ['pool request', 'pull request'],
  ['code revi', 'code review'], ['ci cd', 'CI/CD'],
  // aportuguesamentos que não são palavra do português
  ['deploi', 'deploy'], ['branche', 'branch'], ['rollbeque', 'rollback'],
  ['docker compus', 'docker compose'], ['docker composto', 'docker compose']
]

// A semeadura é VERSIONADA. A original gravava um booleano, então quem já usa
// o app nunca receberia termo novo — e este glossário chegou depois. Cada
// versão insere só o que ainda não existe, então rodar de novo é inofensivo e
// nada que o usuário tenha editado é sobrescrito.
const SEEDS = [
  ['dictionarySeeded', DICIONARIO_BASE],
  ['dictionarySeededDev1', DICIONARIO_DEV]
]

function seedDictionary() {
  const ins = db.prepare('INSERT INTO dictionary (term, replacement) VALUES (?, ?)')
  const existe = db.prepare('SELECT 1 FROM dictionary WHERE lower(term) = lower(?)')
  const marca = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')

  for (const [chave, lista] of SEEDS) {
    if (db.prepare('SELECT value FROM settings WHERE key = ?').get(chave)) continue
    db.transaction(() => {
      for (const [term, replacement] of lista) {
        if (!existe.get(term)) ins.run(term, replacement)
      }
      marca.run(chave, '1')
    })()
  }
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
