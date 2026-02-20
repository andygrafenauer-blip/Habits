const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'habits.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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

// --- Habits ---

function getHabits() {
  return db.prepare('SELECT id, name, created_date AS createdDate, deleted, deleted_date AS deletedDate FROM habits ORDER BY sort_order').all()
    .map(h => ({ ...h, deleted: !!h.deleted }));
}

function addHabit(name) {
  const id = crypto.randomBytes(4).toString('hex');
  const createdDate = new Date().toISOString().slice(0, 10);
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM habits').get().m;
  db.prepare('INSERT INTO habits (id, name, created_date, deleted, sort_order) VALUES (?, ?, ?, 0, ?)').run(id, name, createdDate, maxOrder + 1);
  return { id, name, createdDate, deleted: false };
}

function renameHabit(id, name) {
  const info = db.prepare('UPDATE habits SET name = ? WHERE id = ?').run(name, id);
  if (info.changes === 0) return null;
  const h = db.prepare('SELECT id, name, created_date AS createdDate, deleted, deleted_date AS deletedDate FROM habits WHERE id = ?').get(id);
  return { ...h, deleted: !!h.deleted };
}

function deleteHabit(id) {
  const date = new Date().toISOString().slice(0, 10);
  const info = db.prepare('UPDATE habits SET deleted = 1, deleted_date = ? WHERE id = ?').run(date, id);
  if (info.changes === 0) return null;
  const h = db.prepare('SELECT id, name, created_date AS createdDate, deleted, deleted_date AS deletedDate FROM habits WHERE id = ?').get(id);
  return { ...h, deleted: !!h.deleted };
}

const reorderHabits = db.transaction((ids) => {
  const update = db.prepare('UPDATE habits SET sort_order = ? WHERE id = ?');
  ids.forEach((id, i) => update.run(i, id));
});

// --- Day view / completions ---

function getDayView(date) {
  const rows = db.prepare(`
    SELECT h.id, h.name, h.deleted,
           CASE WHEN c.habit_id IS NOT NULL THEN 1 ELSE 0 END AS completed
    FROM habits h
    LEFT JOIN completions c ON c.habit_id = h.id AND c.date = ?
    WHERE NOT (h.deleted = 1 AND h.deleted_date <= ?)
    ORDER BY h.sort_order
  `).all(date, date);

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    completed: !!r.completed,
    deleted: !!r.deleted
  }));
}

function toggleCompletion(date, habitId, completed) {
  if (completed) {
    db.prepare('INSERT OR IGNORE INTO completions (date, habit_id) VALUES (?, ?)').run(date, habitId);
  } else {
    db.prepare('DELETE FROM completions WHERE date = ? AND habit_id = ?').run(date, habitId);
  }
}

// --- Todos ---

function getTodos(list) {
  return db.prepare('SELECT id, name, created_date AS createdDate FROM todos WHERE list = ?').all(list);
}

function addTodo(list, name) {
  const id = crypto.randomBytes(4).toString('hex');
  const createdDate = new Date().toISOString().slice(0, 10);
  db.prepare('INSERT INTO todos (id, list, name, created_date) VALUES (?, ?, ?, ?)').run(id, list, name, createdDate);
  return { id, name, createdDate };
}

function removeTodo(list, id) {
  const info = db.prepare('DELETE FROM todos WHERE id = ? AND list = ?').run(id, list);
  return info.changes > 0;
}

// --- Export ---

function getExportData() {
  const habits = db.prepare('SELECT id, name FROM habits ORDER BY sort_order').all();
  const completions = {};
  for (const row of db.prepare('SELECT date, habit_id FROM completions').all()) {
    if (!completions[row.date]) completions[row.date] = {};
    completions[row.date][row.habit_id] = true;
  }
  return { habits, completions };
}

module.exports = {
  getHabits, addHabit, renameHabit, deleteHabit, reorderHabits,
  getDayView, toggleCompletion,
  getTodos, addTodo, removeTodo,
  getExportData
};
