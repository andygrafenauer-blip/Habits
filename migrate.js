const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_FILE = path.join(__dirname, 'data.json');
const DB_PATH = path.join(__dirname, 'habits.db');

if (!fs.existsSync(DATA_FILE)) {
  console.log('No data.json found — nothing to migrate.');
  process.exit(0);
}

const raw = fs.readFileSync(DATA_FILE, 'utf8');
const data = JSON.parse(raw);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_date TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    deleted_date TEXT,
    sort_order INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS completions (
    date TEXT NOT NULL,
    habit_id TEXT NOT NULL,
    PRIMARY KEY (date, habit_id)
  );
  CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY,
    list TEXT NOT NULL CHECK (list IN ('work', 'home')),
    name TEXT NOT NULL,
    created_date TEXT NOT NULL
  );
`);

const migrate = db.transaction(() => {
  // Habits
  const insertHabit = db.prepare('INSERT OR IGNORE INTO habits (id, name, created_date, deleted, deleted_date, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
  (data.habits || []).forEach((h, i) => {
    insertHabit.run(h.id, h.name, h.createdDate, h.deleted ? 1 : 0, h.deletedDate || null, i);
  });

  // Completions
  const insertCompletion = db.prepare('INSERT OR IGNORE INTO completions (date, habit_id) VALUES (?, ?)');
  for (const [date, habits] of Object.entries(data.completions || {})) {
    for (const habitId of Object.keys(habits)) {
      insertCompletion.run(date, habitId);
    }
  }

  // Todos
  const insertTodo = db.prepare('INSERT OR IGNORE INTO todos (id, list, name, created_date) VALUES (?, ?, ?, ?)');
  const todos = data.todos || { work: [], home: [] };
  if (Array.isArray(todos)) {
    todos.forEach(t => insertTodo.run(t.id, 'work', t.name, t.createdDate));
  } else {
    for (const [list, items] of Object.entries(todos)) {
      (items || []).forEach(t => insertTodo.run(t.id, list, t.name, t.createdDate));
    }
  }
});

migrate();

const habitCount = db.prepare('SELECT COUNT(*) AS c FROM habits').get().c;
const completionCount = db.prepare('SELECT COUNT(*) AS c FROM completions').get().c;
const todoCount = db.prepare('SELECT COUNT(*) AS c FROM todos').get().c;

console.log(`Migration complete: ${habitCount} habits, ${completionCount} completions, ${todoCount} todos.`);
db.close();
