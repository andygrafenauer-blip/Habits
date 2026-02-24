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

  CREATE TABLE IF NOT EXISTS achievements (
    type TEXT NOT NULL,
    habit_id TEXT,
    earned_date TEXT NOT NULL,
    UNIQUE(type, habit_id, earned_date)
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

// --- Streaks ---

function getStreaks(date) {
  const today = new Date().toISOString().slice(0, 10);
  const isToday = date === today;

  // Get visible habits for this date
  const habits = db.prepare(`
    SELECT id, name FROM habits
    WHERE NOT (deleted = 1 AND deleted_date <= ?)
    ORDER BY sort_order
  `).all(date);

  const checkCompletion = db.prepare('SELECT 1 FROM completions WHERE date = ? AND habit_id = ?');

  function shiftDate(dateStr, days) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  const results = [];

  for (const habit of habits) {
    let streak = 0;
    const doneOnDate = !!checkCompletion.get(date, habit.id);

    let checkDay;
    if (doneOnDate) {
      checkDay = date;
    } else if (isToday) {
      // Day isn't over yet, start counting from yesterday
      checkDay = shiftDate(date, -1);
    } else {
      // Past day and not completed — no streak
      continue;
    }

    // Walk backwards counting consecutive days
    while (checkCompletion.get(checkDay, habit.id)) {
      streak++;
      checkDay = shiftDate(checkDay, -1);
    }

    if (streak > 0) {
      results.push({ id: habit.id, name: habit.name, streak });
    }
  }

  results.sort((a, b) => b.streak - a.streak);
  return results;
}

// --- Achievements ---

function shiftDateStr(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

const insertAchievement = db.prepare(
  'INSERT OR IGNORE INTO achievements (type, habit_id, earned_date) VALUES (?, ?, ?)'
);

const removeInvalidAchievements = db.transaction((date, habitId) => {
  // Perfect day: this habit is now unchecked, so the day can't be perfect
  db.prepare('DELETE FROM achievements WHERE type = ? AND habit_id IS NULL AND earned_date = ?')
    .run('perfect_day', date);

  // Per-habit streaks: a streak_N earned on date E included date D if E-(N-1) <= D <= E
  // So any earned_date from D to D+(N-1) could have relied on D
  for (const [type, n] of [['streak_7', 7], ['streak_14', 14], ['streak_21', 21]]) {
    const endDate = shiftDateStr(date, n - 1);
    db.prepare('DELETE FROM achievements WHERE type = ? AND habit_id = ? AND earned_date >= ? AND earned_date <= ?')
      .run(type, habitId, date, endDate);
  }

  // Global streaks: same window logic
  for (const [type, n] of [['streak_7', 7], ['streak_14', 14], ['streak_21', 21]]) {
    const endDate = shiftDateStr(date, n - 1);
    db.prepare('DELETE FROM achievements WHERE type = ? AND habit_id IS NULL AND earned_date >= ? AND earned_date <= ?')
      .run(type, date, endDate);
  }

  // Perfect month: remove for the month containing this date (both per-habit and global)
  const monthStr = date.slice(0, 7) + '-01';
  db.prepare('DELETE FROM achievements WHERE type = ? AND habit_id = ? AND earned_date = ?')
    .run('perfect_month', habitId, monthStr);
  db.prepare('DELETE FROM achievements WHERE type = ? AND habit_id IS NULL AND earned_date = ?')
    .run('perfect_month', monthStr);
});

const checkAchievements = db.transaction((date) => {
  // Get active habits for this date
  const habits = db.prepare(`
    SELECT id FROM habits
    WHERE created_date <= ? AND NOT (deleted = 1 AND deleted_date <= ?)
  `).all(date, date);

  if (habits.length === 0) return;

  const habitIds = habits.map(h => h.id);
  const checkCompletion = db.prepare(
    'SELECT 1 FROM completions WHERE date = ? AND habit_id = ?'
  );

  // --- Perfect Day ---
  const allDone = habitIds.every(id => !!checkCompletion.get(date, id));
  if (allDone) {
    insertAchievement.run('perfect_day', null, date);
  }

  // --- Per-habit streaks ---
  for (const id of habitIds) {
    let streak = 0;
    let checkDay = date;
    while (checkCompletion.get(checkDay, id)) {
      streak++;
      checkDay = shiftDateStr(checkDay, -1);
    }
    if (streak >= 7) insertAchievement.run('streak_7', id, date);
    if (streak >= 14) insertAchievement.run('streak_14', id, date);
    if (streak >= 21) insertAchievement.run('streak_21', id, date);
  }

  // --- Global streaks ---
  for (const threshold of [7, 14, 21]) {
    let allStreak = true;
    for (let i = 0; i < threshold; i++) {
      const checkDay = shiftDateStr(date, -i);
      const dayHabits = db.prepare(`
        SELECT id FROM habits
        WHERE created_date <= ? AND NOT (deleted = 1 AND deleted_date <= ?)
      `).all(checkDay, checkDay);
      if (dayHabits.length === 0) { allStreak = false; break; }
      const allCompleted = dayHabits.every(h => !!checkCompletion.get(checkDay, h.id));
      if (!allCompleted) { allStreak = false; break; }
    }
    if (allStreak) {
      insertAchievement.run('streak_' + threshold, null, date);
    }
  }

  // --- Perfect Month (only fully elapsed months) ---
  const [year, month] = date.split('-').map(Number);
  // Check previous month (the most recently elapsed)
  let checkYear = month === 1 ? year - 1 : year;
  let checkMonth = month === 1 ? 12 : month - 1;
  const days = daysInMonth(checkYear, checkMonth);
  const monthStr = checkYear + '-' + String(checkMonth).padStart(2, '0');
  const firstOfMonth = monthStr + '-01';

  // Per-habit perfect month
  for (const id of habitIds) {
    // Check if habit existed for the whole month
    const habitRow = db.prepare('SELECT created_date FROM habits WHERE id = ?').get(id);
    if (habitRow.created_date > firstOfMonth) continue;
    let perfect = true;
    for (let d = 1; d <= days; d++) {
      const dayStr = monthStr + '-' + String(d).padStart(2, '0');
      if (!checkCompletion.get(dayStr, id)) { perfect = false; break; }
    }
    if (perfect) {
      insertAchievement.run('perfect_month', id, firstOfMonth);
    }
  }

  // Global perfect month
  let globalPerfect = true;
  for (let d = 1; d <= days; d++) {
    const dayStr = monthStr + '-' + String(d).padStart(2, '0');
    const dayHabits = db.prepare(`
      SELECT id FROM habits
      WHERE created_date <= ? AND NOT (deleted = 1 AND deleted_date <= ?)
    `).all(dayStr, dayStr);
    if (dayHabits.length === 0) { globalPerfect = false; break; }
    const allCompleted = dayHabits.every(h => !!checkCompletion.get(dayStr, h.id));
    if (!allCompleted) { globalPerfect = false; break; }
  }
  if (globalPerfect) {
    insertAchievement.run('perfect_month', null, firstOfMonth);
  }
});

function getAchievements() {
  const globalRows = db.prepare(`
    SELECT type, COUNT(*) AS count, MAX(earned_date) AS latestDate
    FROM achievements WHERE habit_id IS NULL
    GROUP BY type
  `).all();

  const globalMap = {};
  for (const r of globalRows) {
    globalMap[r.type] = { type: r.type, count: r.count, latestDate: r.latestDate };
  }

  const globalTypes = ['perfect_day', 'streak_7', 'streak_14', 'streak_21', 'perfect_month'];
  const global = globalTypes.map(t => globalMap[t] || { type: t, count: 0, latestDate: null });

  const perHabitRows = db.prepare(`
    SELECT a.type, a.habit_id, COUNT(*) AS count, MAX(a.earned_date) AS latestDate, h.name
    FROM achievements a
    JOIN habits h ON h.id = a.habit_id
    WHERE a.habit_id IS NOT NULL
    GROUP BY a.type, a.habit_id
  `).all();

  const perHabit = {};
  for (const r of perHabitRows) {
    if (!perHabit[r.habit_id]) {
      perHabit[r.habit_id] = { name: r.name, achievements: {} };
    }
    perHabit[r.habit_id].achievements[r.type] = {
      type: r.type, count: r.count, latestDate: r.latestDate
    };
  }

  // Include all active habits even without achievements
  const habits = db.prepare('SELECT id, name FROM habits WHERE deleted = 0 ORDER BY sort_order').all();
  const perHabitTypes = ['streak_7', 'streak_14', 'streak_21', 'perfect_month'];
  const result = {};
  for (const h of habits) {
    const existing = perHabit[h.id] || { name: h.name, achievements: {} };
    result[h.id] = {
      name: h.name,
      achievements: perHabitTypes.map(t =>
        existing.achievements[t] || { type: t, count: 0, latestDate: null }
      )
    };
  }

  return { global, perHabit: result };
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
  getStreaks,
  checkAchievements, removeInvalidAchievements, getAchievements,
  getTodos, addTodo, removeTodo,
  getExportData
};
