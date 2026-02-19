(function () {
  'use strict';

  // State
  let currentDate = todayStr();
  let editingId = null;

  // Elements
  const dateDisplay = document.getElementById('date-display');
  const prevBtn = document.getElementById('prev-day');
  const nextBtn = document.getElementById('next-day');
  const todayBtn = document.getElementById('today-btn');
  const pastBanner = document.getElementById('past-banner');
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

  // Init
  updateNav();
  loadDay();
})();
