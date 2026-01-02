(function () {
  let current = new Date();
  let lang = "zh"; // zh / en
  let view = "month"; // month / year

  const holidays = {
    "2026-01-01": "元旦",
    "2026-02-14": "情人节",
    "2026-10-01": "国庆节"
  };

  const events = {
    "2026-01-05": ["会议"],
    "2026-01-12": ["生日"],
    "2026-01-20": ["旅行"]
  };

  const i18n = {
    zh: {
      months: ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"],
      weekdays: ["一","二","三","四","五","六","日"]
    },
    en: {
      months: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
      weekdays: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
    }
  };

  function render() {
    if (view === "month") renderMonth();
    else renderYear();
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
      const div = document.createElement("div");
      div.className = "day";
      div.innerText = d;

      const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

      if (holidays[dateStr]) div.classList.add("holiday");
      if (events[dateStr]) {
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

  window.toggleLang = function () {
    lang = lang === "zh" ? "en" : "zh";
    render();
  };

  window.toggleTheme = function () {
    document.body.classList.toggle("dark");
  };

  window.toggleView = function () {
    view = view === "month" ? "year" : "month";
    render();
  };

  window.addEventListener("DOMContentLoaded", render);
})();
