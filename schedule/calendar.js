(function () {
  let current = new Date();
  let view = "month"; // month | year
  const storageKey = "hexoScheduleEvents";
  let selectedDateStr = formatDateKey(new Date());

  const holidays = {
    "2026-01-01": "元旦",
    "2026-10-01": "国庆节"
  };

  const i18n = {
    zh: {
      months: ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"],
      weekdays: ["一","二","三","四","五","六","日"],
      eventsEmpty: "这一天还没有日程",
      eventOn: "日程"
    }
  };
  let lang = "zh";

  function formatDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function loadEvents() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return {};
      return JSON.parse(raw);
    } catch (e) {
      return {};
    }
  }

  function saveEventsToStorage(events) {
    localStorage.setItem(storageKey, JSON.stringify(events));
  }

  function render() {
    if (view === "month") renderMonth();
    else renderYear();
    renderEventPanel(selectedDateStr);
  }

  function renderMonth() {
    const year = current.getFullYear();
    const month = current.getMonth();
    const today = new Date();

    document.getElementById("calendar-title").innerText =
      `${year} ${i18n[lang].months[month]}`;

    const grid = document.getElementById("calendar-grid");
    grid.className = "calendar-grid fade";
    grid.innerHTML = "";

    i18n[lang].weekdays.forEach(d => {
      const div = document.createElement("div");
      div.className = "weekday";
      div.innerText = d;
      grid.appendChild(div);
    });

    const firstDay = new Date(year, month, 1).getDay();
    const offset = firstDay === 0 ? 6 : firstDay - 1;

    for (let i = 0; i < offset; i++) {
      grid.appendChild(document.createElement("div"));
    }

    const events = loadEvents();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const dateStr = formatDateKey(date);

      const div = document.createElement("div");
      div.className = "day";
      div.innerText = d;

      if (holidays[dateStr]) {
        div.classList.add("holiday");
      }

      if (events[dateStr] && events[dateStr].length > 0) {
        const dot = document.createElement("div");
        dot.className = "event-dot";
        div.appendChild(dot);
      }

      if (
        d === today.getDate() &&
        month === today.getMonth() &&
        year === today.getFullYear()
      ) {
        div.classList.add("today");
      }

      div.onclick = () => {
        selectedDateStr = dateStr;
        openModal(dateStr);
      };

      grid.appendChild(div);
    }
  }

  function renderYear() {
    const year = current.getFullYear();
    document.getElementById("calendar-title").innerText = `${year}`;

    const grid = document.getElementById("calendar-grid");
    grid.className = "year-grid fade";
    grid.innerHTML = "";

    i18n[lang].months.forEach((m, idx) => {
      const div = document.createElement("div");
      div.className = "year-month";
      div.innerText = m;
      div.onclick = () => {
        current.setMonth(idx);
        view = "month";
        render();
      };
      grid.appendChild(div);
    });
  }

  function renderEventPanel(dateStr) {
    const events = loadEvents();
    const list = document.getElementById("event-list");
    const label = document.getElementById("event-date-label");

    label.innerText = `${dateStr} 的${i18n[lang].eventOn}`;

    list.innerHTML = "";

    const items = events[dateStr] || [];

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "event-item";
      empty.innerText = i18n[lang].eventsEmpty;
      list.appendChild(empty);
      return;
    }

    items.forEach((ev, idx) => {
      const div = document.createElement("div");
      div.className = "event-item";

      const title = document.createElement("div");
      title.className = "event-item-title";
      title.innerText = ev.title || "未命名日程";

      const desc = document.createElement("div");
      desc.className = "event-item-desc";
      desc.innerText = ev.desc || "";

      const time = document.createElement("div");
      time.className = "event-item-time";
      time.innerText = `创建于：${ev.createdAt || ""}`;

      const del = document.createElement("button");
      del.className = "event-item-delete";
      del.innerText = "删除";
      del.onclick = () => {
        deleteEvent(dateStr, idx);
      };

      div.appendChild(title);
      if (ev.desc) div.appendChild(desc);
      div.appendChild(time);
      div.appendChild(del);

      list.appendChild(div);
    });
  }

  function deleteEvent(dateStr, index) {
    const events = loadEvents();
    if (!events[dateStr]) return;
    events[dateStr].splice(index, 1);
    if (events[dateStr].length === 0) {
      delete events[dateStr];
    }
    saveEventsToStorage(events);
    render();
  }

  function openModal(dateStr) {
    const modal = document.getElementById("event-modal");
    const dateLabel = document.getElementById("modal-date");
    dateLabel.innerText = dateStr;

    document.getElementById("event-title-input").value = "";
    document.getElementById("event-desc-input").value = "";

    modal.classList.remove("hidden");
  }

  window.closeModal = function () {
    document.getElementById("event-modal").classList.add("hidden");
    renderEventPanel(selectedDateStr);
  };

  window.saveEvent = function () {
    const title = document.getElementById("event-title-input").value.trim();
    const desc = document.getElementById("event-desc-input").value.trim();

    if (!title) {
      alert("标题不能为空");
      return;
    }

    const events = loadEvents();
    if (!events[selectedDateStr]) events[selectedDateStr] = [];
    events[selectedDateStr].push({
      title,
      desc,
      createdAt: new Date().toLocaleString()
    });
    saveEventsToStorage(events);
    closeModal();
    render();
  };

  window.prevMonth = function () {
    if (view === "month") current.setMonth(current.getMonth() - 1);
    else current.setFullYear(current.getFullYear() - 1);
    render();
  };

  window.nextMonth = function () {
    if (view === "month") current.setMonth(current.getMonth() + 1);
    else current.setFullYear(current.getFullYear() + 1);
    render();
  };

  window.toggleView = function () {
    view = view === "month" ? "year" : "month";
    render();
  };

  window.toggleTheme = function () {
    if (document.body.classList.contains("calendar-dark")) {
      document.body.classList.remove("calendar-dark");
      document.body.classList.add("calendar-light");
    } else if (document.body.classList.contains("calendar-light")) {
      document.body.classList.remove("calendar-light");
      document.body.classList.add("calendar-dark");
    } else {
      document.body.classList.add("calendar-dark");
    }
  };

  window.clearAllEvents = function () {
    if (confirm("确定要清空所有日程吗？此操作不可恢复")) {
      localStorage.removeItem(storageKey);
      render();
    }
  };

  window.addEventListener("DOMContentLoaded", () => {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      document.body.classList.add("calendar-dark");
    } else {
      document.body.classList.add("calendar-light");
    }
    selectedDateStr = formatDateKey(new Date());
    render();
  });
})();
