const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    const initial = { habits: [], completions: {} };
    writeData(initial);
    return initial;
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// GET /api/habits — all habits (active + deleted)
app.get('/api/habits', (req, res) => {
  const data = readData();
  res.json(data.habits);
});

// POST /api/habits — add a new habit
app.post('/api/habits', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  const data = readData();
  const habit = {
    id: crypto.randomBytes(4).toString('hex'),
    name: name.trim(),
    createdDate: new Date().toISOString().slice(0, 10),
    deleted: false
  };
  data.habits.push(habit);
  writeData(data);
  res.status(201).json(habit);
});

// PUT /api/habits/reorder — reorder habits (must be before :id route)
app.put('/api/habits/reorder', (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: 'order array is required' });
  }
  const data = readData();
  const habitMap = new Map(data.habits.map(h => [h.id, h]));
  const reordered = [];
  for (const id of order) {
    const h = habitMap.get(id);
    if (h) {
      reordered.push(h);
      habitMap.delete(id);
    }
  }
  for (const h of habitMap.values()) {
    reordered.push(h);
  }
  data.habits = reordered;
  writeData(data);
  res.json({ ok: true });
});

// PUT /api/habits/:id — rename a habit
app.put('/api/habits/:id', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  const data = readData();
  const habit = data.habits.find(h => h.id === req.params.id);
  if (!habit) {
    return res.status(404).json({ error: 'Habit not found' });
  }
  habit.name = name.trim();
  writeData(data);
  res.json(habit);
});

// DELETE /api/habits/:id — soft-delete a habit
app.delete('/api/habits/:id', (req, res) => {
  const data = readData();
  const habit = data.habits.find(h => h.id === req.params.id);
  if (!habit) {
    return res.status(404).json({ error: 'Habit not found' });
  }
  habit.deleted = true;
  habit.deletedDate = new Date().toISOString().slice(0, 10);
  writeData(data);
  res.json(habit);
});

// GET /api/day/:date — habits visible on that day + completions
app.get('/api/day/:date', (req, res) => {
  const date = req.params.date;
  const data = readData();
  const dayCompletions = data.completions[date] || {};

  const visible = data.habits.filter(h => {
    if (h.deleted && h.deletedDate <= date) return false;
    return true;
  });

  const result = visible.map(h => ({
    id: h.id,
    name: h.name,
    completed: !!dayCompletions[h.id],
    deleted: h.deleted
  }));

  res.json(result);
});

// PUT /api/day/:date — toggle a habit completion
app.put('/api/day/:date', (req, res) => {
  const { habitId, completed } = req.body;
  if (!habitId) {
    return res.status(400).json({ error: 'habitId is required' });
  }
  const date = req.params.date;
  const data = readData();

  if (!data.completions[date]) {
    data.completions[date] = {};
  }

  if (completed) {
    data.completions[date][habitId] = true;
  } else {
    delete data.completions[date][habitId];
  }

  // Clean up empty date entries
  if (Object.keys(data.completions[date]).length === 0) {
    delete data.completions[date];
  }

  writeData(data);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Habit tracker running at http://localhost:${PORT}`);
});
