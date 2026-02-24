const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/habits — all habits (active + deleted)
app.get('/api/habits', (req, res) => {
  res.json(db.getHabits());
});

// POST /api/habits — add a new habit
app.post('/api/habits', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  res.status(201).json(db.addHabit(name.trim()));
});

// PUT /api/habits/reorder — reorder habits (must be before :id route)
app.put('/api/habits/reorder', (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: 'order array is required' });
  }
  db.reorderHabits(order);
  res.json({ ok: true });
});

// PUT /api/habits/:id — rename a habit
app.put('/api/habits/:id', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  const habit = db.renameHabit(req.params.id, name.trim());
  if (!habit) {
    return res.status(404).json({ error: 'Habit not found' });
  }
  res.json(habit);
});

// DELETE /api/habits/:id — soft-delete a habit
app.delete('/api/habits/:id', (req, res) => {
  const habit = db.deleteHabit(req.params.id);
  if (!habit) {
    return res.status(404).json({ error: 'Habit not found' });
  }
  res.json(habit);
});

// GET /api/day/:date — habits visible on that day + completions
app.get('/api/day/:date', (req, res) => {
  res.json(db.getDayView(req.params.date));
});

// PUT /api/day/:date — toggle a habit completion
app.put('/api/day/:date', (req, res) => {
  const { habitId, completed } = req.body;
  if (!habitId) {
    return res.status(400).json({ error: 'habitId is required' });
  }
  db.toggleCompletion(req.params.date, habitId, completed);
  res.json({ ok: true });
});

// GET /api/streaks/:date — current streaks as of a date
app.get('/api/streaks/:date', (req, res) => {
  res.json(db.getStreaks(req.params.date));
});

// GET /api/todos/:list — all to-dos for a list
app.get('/api/todos/:list', (req, res) => {
  const { list } = req.params;
  if (list !== 'work' && list !== 'home') {
    return res.status(400).json({ error: 'Invalid list: must be "work" or "home"' });
  }
  res.json(db.getTodos(list));
});

// POST /api/todos/:list — add a new to-do to a list
app.post('/api/todos/:list', (req, res) => {
  const { list } = req.params;
  if (list !== 'work' && list !== 'home') {
    return res.status(400).json({ error: 'Invalid list: must be "work" or "home"' });
  }
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  res.status(201).json(db.addTodo(list, name.trim()));
});

// DELETE /api/todos/:list/:id — remove a to-do from a list
app.delete('/api/todos/:list/:id', (req, res) => {
  const { list } = req.params;
  if (list !== 'work' && list !== 'home') {
    return res.status(400).json({ error: 'Invalid list: must be "work" or "home"' });
  }
  const removed = db.removeTodo(list, req.params.id);
  if (!removed) {
    return res.status(404).json({ error: 'To-do not found' });
  }
  res.json({ ok: true });
});

// GET /api/export/csv — download habit data as CSV
app.get('/api/export/csv', (req, res) => {
  const { habits, completions } = db.getExportData();
  const dates = Object.keys(completions).sort();

  if (habits.length === 0 || dates.length === 0) {
    res.setHeaders(new Headers({
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="habits.csv"'
    }));
    return res.send('No data to export');
  }

  // Fill in any gaps between first and last date
  const allDates = [];
  const d = new Date(dates[0] + 'T12:00:00');
  const end = new Date(dates[dates.length - 1] + 'T12:00:00');
  while (d <= end) {
    allDates.push(d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0'));
    d.setDate(d.getDate() + 1);
  }

  function csvEscape(str) {
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  const header = ['Habit', ...allDates].map(csvEscape).join(',');
  const rows = habits.map(h => {
    const cells = [csvEscape(h.name)];
    for (const date of allDates) {
      const done = completions[date] && completions[date][h.id];
      cells.push(done ? 'X' : '');
    }
    return cells.join(',');
  });

  const csv = [header, ...rows].join('\n');
  res.setHeaders(new Headers({
    'Content-Type': 'text/csv',
    'Content-Disposition': 'attachment; filename="habits.csv"'
  }));
  res.send(csv);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Habit tracker running on port ${PORT}`);
});
