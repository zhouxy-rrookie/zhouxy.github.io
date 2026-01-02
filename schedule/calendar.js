(function () {
  let current = new Date();
  let view = "month"; // month | year
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

  /* ========== Supabase：读取事件 ========== */
  async function loadEvents(dateStr) {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("date", dateStr)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("读取事件失败：", error);
      return [];
    }
    return data;
  }

  /* ========== Supabase：添加事件 ========== */
  async function addEvent(dateStr, title, desc) {
    const { error } = await supabase
      .from("events")
      .insert([{ date: dateStr, title, desc }]);

    if (error) {
      alert("添加失败：你可能没有登录或没有写入权限");
      console.error(error);
    }
  }

  /* ========== Supabase：删除事件 ========== */
  async function deleteEvent(id) {
    const { error } = await supabase
      .from("events")
      .delete()
      .eq("id", id);

    if (error) {
      alert("删除失败：你可能没有登录或没有权限");
      console.error(error);
    }
  }

  /* ========== 渲染日历 ========== */
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

      loadEvents(dateStr).then(events => {
        if (events.length > 0) {
          const dot = document.createElement("div");
          dot.className = "event-dot";
          div.appendChild(dot);
        }
      });

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

  /* ========== 渲染右侧事件列表 ========== */
  async function renderEventPanel(dateStr) {
    const list = document.getElementById("event-list");
    const label = document.getElementById("event-date-label");

    label.innerText = `${dateStr} 的${i18n[lang].eventOn}`;
    list.innerHTML = "";

    const events = await loadEvents(dateStr);

    if (events.length === 0) {
      const empty = document.createElement("div");
      empty.className = "event-item";
      empty.innerText = i18n[lang].eventsEmpty;
      list.appendChild(empty);
      return;
    }

    events.forEach(ev => {
      const div = document.createElement("div");
      div.className = "event-item";

      const title = document.createElement("div");
      title.className = "event-item-title";
      title.innerText = ev.title;

      const desc = document.createElement("div");
      desc.className = "event-item-desc";
      desc.innerText = ev.desc || "";

      const time = document.createElement("div");
      time.className = "event-item-time";
      time.innerText = `创建于：${new Date(ev.created_at).toLocaleString()}`;

      const del = document.createElement("button");
      del.className = "event-item-delete";
      del.innerText = "删除";
      del.onclick = async () => {
        await deleteEvent(ev.id);
        render();
      };

      div.appendChild(title);
      if (ev.desc) div.appendChild(desc);
      div.appendChild(time);
      div.appendChild(del);

      list.appendChild(div);
    });
  }

  /* ========== 弹窗 ========== */
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

  window.saveEvent = async function () {
    const title = document.getElementById("event-title-input").value.trim();
    const desc = document.getElementById("event-desc-input").value.trim();

    if (!title) {
      alert("标题不能为空");
      return;
    }

    await addEvent(selectedDateStr, title, desc);
    closeModal();
    render();
  };

  /* ========== 控制按钮 ========== */
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

  window.addEventListener("DOMContentLoaded", () => {
    document.body.classList.add("calendar-dark");
    selectedDateStr = formatDateKey(new Date());
    render();
  });
})();
