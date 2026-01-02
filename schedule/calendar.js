(function(){
  let current = new Date();

  function renderCalendar() {
    const year = current.getFullYear();
    const month = current.getMonth();
    const today = new Date();

    document.getElementById("calendar-title").innerText =
      `${year} 年 ${month + 1} 月`;

    const grid = document.getElementById("calendar-grid");
    grid.innerHTML = "";

    const weekdays = ["一","二","三","四","五","六","日"];
    weekdays.forEach(d => {
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

  window.prevMonth = function() {
    current.setMonth(current.getMonth() - 1);
    renderCalendar();
  };

  window.nextMonth = function() {
    current.setMonth(current.getMonth() + 1);
    renderCalendar();
  };

  window.addEventListener("DOMContentLoaded", renderCalendar);
})();
