(function () {
  'use strict';

  // State
  let currentDate = todayStr();
  let editingId = null;
  let dragSrcId = null;

  // Elements
  const dateDisplay = document.getElementById('date-display');
  const prevBtn = document.getElementById('prev-day');
  const nextBtn = document.getElementById('next-day');
  const todayBtn = document.getElementById('today-btn');
  const pastBanner = document.getElementById('past-banner');
  const streaksSection = document.getElementById('streaks-section');
  const streaksList = document.getElementById('streaks-list');
  const habitList = document.getElementById('habit-list');
  const emptyState = document.getElementById('empty-state');
  const addForm = document.getElementById('add-form');
  const addInput = document.getElementById('add-input');

  // Helpers
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function shiftDate(dateStr, days) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  // API helpers
  async function api(path, options) {
    const res = await fetch(path, options);
    return res.json();
  }

  // Navigation
  function updateNav() {
    const today = todayStr();
    dateDisplay.textContent = formatDate(currentDate);
    nextBtn.disabled = currentDate >= today;
    todayBtn.hidden = currentDate === today;
    pastBanner.hidden = currentDate === today;
  }

  prevBtn.addEventListener('click', () => {
    currentDate = shiftDate(currentDate, -1);
    updateNav();
    loadDay();
  });

  nextBtn.addEventListener('click', () => {
    const next = shiftDate(currentDate, 1);
    if (next <= todayStr()) {
      currentDate = next;
      updateNav();
      loadDay();
    }
  });

  todayBtn.addEventListener('click', () => {
    currentDate = todayStr();
    updateNav();
    loadDay();
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft') {
      prevBtn.click();
    } else if (e.key === 'ArrowRight' && !nextBtn.disabled) {
      nextBtn.click();
    }
  });

  // Load and render
  async function loadDay() {
    const habits = await api('/api/day/' + currentDate);
    render(habits);
    loadStreaks();
  }

  async function loadStreaks() {
    const streaks = await api('/api/streaks/' + currentDate);
    streaksList.innerHTML = '';
    if (streaks.length === 0) {
      streaksSection.hidden = true;
      return;
    }
    streaksSection.hidden = false;
    streaks.forEach(s => {
      const row = document.createElement('div');
      row.className = 'streak-row';

      const name = document.createElement('span');
      name.className = 'streak-name';
      name.textContent = s.name;

      const count = document.createElement('span');
      count.className = 'streak-count';
      count.textContent = s.streak + (s.streak === 1 ? ' day' : ' days');

      row.appendChild(name);
      row.appendChild(count);
      streaksList.appendChild(row);
    });
  }

  function render(habits) {
    habitList.innerHTML = '';

    if (habits.length === 0) {
      emptyState.hidden = false;
      return;
    }

    emptyState.hidden = true;

    habits.forEach(h => {
      const row = document.createElement('div');
      row.className = 'habit-row' + (h.completed ? ' checked' : '');
      row.dataset.id = h.id;

      // Drag handle (only on today)
      if (currentDate === todayStr()) {
        row.draggable = true;
        const handle = document.createElement('span');
        handle.className = 'drag-handle';
        handle.textContent = '\u2630';
        handle.title = 'Drag to reorder';
        row.appendChild(handle);

        row.addEventListener('dragstart', (e) => {
          dragSrcId = h.id;
          row.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        });
        row.addEventListener('dragend', () => {
          dragSrcId = null;
          row.classList.remove('dragging');
          habitList.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });
        row.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (h.id !== dragSrcId) {
            row.classList.add('drag-over');
          }
        });
        row.addEventListener('dragleave', () => {
          row.classList.remove('drag-over');
        });
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          row.classList.remove('drag-over');
          if (dragSrcId && dragSrcId !== h.id) {
            reorderHabits(dragSrcId, h.id);
          }
        });
      }

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'habit-checkbox';
      checkbox.checked = h.completed;
      checkbox.addEventListener('change', () => toggleHabit(h.id, checkbox.checked));

      row.appendChild(checkbox);

      if (editingId === h.id) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'habit-edit-input';
        input.value = h.name;
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            renameHabit(h.id, input.value);
          } else if (e.key === 'Escape') {
            editingId = null;
            loadDay();
          }
        });
        row.appendChild(input);
        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
      } else {
        const name = document.createElement('span');
        name.className = 'habit-name';
        name.textContent = h.name;
        row.appendChild(name);
      }

      // Only show edit/delete on today (not deleted habits)
      if (!h.deleted && currentDate === todayStr()) {
        const actions = document.createElement('div');
        actions.className = 'habit-actions';

        const editBtn = document.createElement('button');
        editBtn.textContent = 'edit';
        editBtn.title = 'Rename habit';
        editBtn.addEventListener('click', () => {
          editingId = h.id;
          loadDay();
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.textContent = '\u00d7';
        deleteBtn.title = 'Delete habit';
        deleteBtn.addEventListener('click', () => deleteHabit(h.id, h.name));

        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
        row.appendChild(actions);
      }

      habitList.appendChild(row);
    });
  }

  // Actions
  async function toggleHabit(habitId, completed) {
    await api('/api/day/' + currentDate, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ habitId, completed })
    });
    loadDay();
  }

  async function renameHabit(id, newName) {
    if (!newName.trim()) return;
    editingId = null;
    await api('/api/habits/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });
    loadDay();
  }

  async function deleteHabit(id, name) {
    if (!confirm('Delete "' + name + '"? It will still appear on past days.')) return;
    await api('/api/habits/' + id, { method: 'DELETE' });
    loadDay();
  }

  // Reorder habits
  async function reorderHabits(draggedId, targetId) {
    const rows = Array.from(habitList.querySelectorAll('.habit-row'));
    const ids = rows.map(r => r.dataset.id);
    const fromIdx = ids.indexOf(draggedId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, draggedId);
    await api('/api/habits/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: ids })
    });
    loadDay();
  }

  // Add habit
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = addInput.value.trim();
    if (!name) return;
    await api('/api/habits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    addInput.value = '';
    loadDay();
  });

  // To-do list setup (reusable for work and home)
  function setupTodoList(listName) {
    const listEl = document.getElementById('todo-list-' + listName);
    const emptyEl = document.getElementById('todo-empty-' + listName);
    const form = document.querySelector('form[data-list="' + listName + '"]');
    const input = form.querySelector('input');

    async function loadTodos() {
      const todos = await api('/api/todos/' + listName);
      renderTodos(todos);
    }

    function renderTodos(todos) {
      listEl.innerHTML = '';

      if (todos.length === 0) {
        emptyEl.hidden = false;
        return;
      }

      emptyEl.hidden = true;

      todos.forEach(t => {
        const row = document.createElement('div');
        row.className = 'habit-row';
        row.dataset.id = t.id;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'habit-checkbox';
        checkbox.addEventListener('change', () => removeTodo(t.id));

        const name = document.createElement('span');
        name.className = 'habit-name';
        name.textContent = t.name;

        const actions = document.createElement('div');
        actions.className = 'habit-actions';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.textContent = '\u00d7';
        deleteBtn.title = 'Delete to-do';
        deleteBtn.addEventListener('click', () => removeTodo(t.id));

        actions.appendChild(deleteBtn);
        row.appendChild(checkbox);
        row.appendChild(name);
        row.appendChild(actions);
        listEl.appendChild(row);
      });
    }

    async function removeTodo(id) {
      await api('/api/todos/' + listName + '/' + id, { method: 'DELETE' });
      loadTodos();
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      await api('/api/todos/' + listName, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      input.value = '';
      loadTodos();
    });

    return { load: loadTodos };
  }

  const workList = setupTodoList('work');
  const homeList = setupTodoList('home');

  // Init
  updateNav();
  loadDay();
  workList.load();
  homeList.load();
})();
