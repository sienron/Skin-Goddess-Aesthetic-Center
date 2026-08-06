const appointments = [
    {
        id: 1, client: "Test Client", date: "2026-08-01", start: "10:00", end: "11:00", status: "confirmed",
        // placeholder detail fields below — replace with real data once backend is connected
        apptNumber: "APT-0141", service: "Facial Treatment", aesthetician: "Sofia Reyes",
        fee: 1200, depositPaid: true, depositAmount: 300, contact: "0917 000 0000",
        remarks: "No notes yet."
    },
    {
        id: 5, client: "Sienron", date: "2026-08-01", start: "14:00", end: "15:00", status: "in-progress",
        apptNumber: "APT-0142", service: "Deep Cleansing Facial", aesthetician: "Sofia Reyes",
        fee: 1200, depositPaid: true, depositAmount: 300, contact: "0917 123 4567",
        remarks: "Client requested gentle extraction; mild sensitivity noted on left cheek area."
    }
];
let currentDate = new Date(); // April 2026 — month is 0-indexed (3 = April)
const HOUR_HEIGHT = 100;
function renderMonth(date) {
    const grid = document.getElementById("monthGrid");
    grid.innerHTML = ""; // clear old cells

    const year = date.getFullYear();
    const month = date.getMonth();

    // First day of the month, and how many days it has
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startWeekday = firstDay.getDay(); // 0 = Sunday

    // Days from previous month to fill the first row
    const prevMonthDays = new Date(year, month, 0).getDate();

    const today = new Date();

    // --- Leading cells (previous month, greyed out) ---
    for (let i = startWeekday - 1; i >= 0; i--) {
        const d = prevMonthDays - i;
        const cellDate = new Date(year, month - 1, d);
        grid.appendChild(createDayCell(d, true, cellDate));
    }

    // --- Current month cells ---
    for (let d = 1; d <= daysInMonth; d++) {
        const cellDate = new Date(year, month, d);
        const isToday =
            d === today.getDate() &&
            month === today.getMonth() &&
            year === today.getFullYear();
        grid.appendChild(createDayCell(d, false, cellDate, isToday));
    }

    // --- Trailing cells (next month, greyed out) ---
    const totalCells = startWeekday + daysInMonth;
    const remaining = (7 - (totalCells % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
        const cellDate = new Date(year, month + 1, d);
        grid.appendChild(createDayCell(d, true, cellDate));
    }

    updateMonthLabel(date);
}

function createDayCell(dayNumber, isOtherMonth, cellDate, isToday = false) {
    const cell = document.createElement("div");
    cell.className = "month-day-cell";
    if (isOtherMonth) cell.classList.add("other-month");
    if (isToday) cell.classList.add("today");

    const num = document.createElement("span");
    num.className = "day-number";
    num.textContent = dayNumber;
    cell.appendChild(num);

    // Find appointments for this exact date
    const dateStr = formatDateKey(cellDate);
    const dayAppointments = appointments.filter(a => a.date === dateStr);

    dayAppointments.forEach(appt => {
        cell.appendChild(createMonthChip(appt));
    });

    return cell;
}

function updateMonthLabel(date) {
    const options = { month: "long", year: "numeric" };
    const label = date.toLocaleDateString("en-US", options);
    document.querySelector(".current-month").textContent = label;
}

function createMonthChip(appt) {
    const chip = document.createElement("div");
    chip.className = `appt-chip status-${appt.status}`;
    chip.dataset.apptId = appt.id;

    const client = document.createElement("span");
    client.className = "appt-client";
    client.textContent = appt.client;

    const time = document.createElement("span");
    time.className = "appt-time";
    time.textContent = formatTime(appt.start);

    chip.appendChild(client);
    chip.appendChild(time);
    return chip;
}

function formatDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function formatTime(time24) {
    const [h, m] = time24.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, "0")}${period}`;
}
renderMonth(currentDate);

const monthViewBtn = document.querySelectorAll(".view-btn")[1]; // "Month"
const weekViewBtn = document.querySelectorAll(".view-btn")[0];  // "Week"
const monthViewEl = document.querySelector(".month-view");
const weekViewEl = document.querySelector(".week-view");

weekViewBtn.addEventListener("click", () => {
    monthViewEl.style.display = "none";
    weekViewEl.style.display = "block";

    weekViewBtn.classList.add("active");
    monthViewBtn.classList.remove("active");

    renderWeek(currentDate);
});

monthViewBtn.addEventListener("click", () => {
    weekViewEl.style.display = "none";
    monthViewEl.style.display = "block";

    monthViewBtn.classList.add("active");
    weekViewBtn.classList.remove("active");

    renderMonth(currentDate);
});

function renderWeek(date) {
    const timeColumn = document.getElementById("weekTimeColumn");
    const daysGrid = document.getElementById("weekDaysGrid");
    timeColumn.innerHTML = "";
    daysGrid.innerHTML = "";

    // Find the Sunday that starts this week
    const startOfWeek = new Date(date);
    startOfWeek.setDate(date.getDate() - date.getDay());

    const startHour = 9;  // 9AM
    const endHour = 17;   // 5PM

    // --- Hour labels (left column) ---
    for (let h = startHour; h <= endHour; h++) {
        const label = document.createElement("div");
        label.className = "hour-label";
        label.textContent = formatHourLabel(h);
        timeColumn.appendChild(label);
    }

    // --- 7 day columns ---
    const weekDates = [];
    for (let i = 0; i < 7; i++) {
        const dayDate = new Date(startOfWeek);
        dayDate.setDate(startOfWeek.getDate() + i);
        weekDates.push(dayDate);


        const col = document.createElement("div");
        col.className = "week-day-col-bg";
        col.style.height = `${(endHour - startHour + 1) * HOUR_HEIGHT}px`;

        // Appointments for this day
        const dateStr = formatDateKey(dayDate);
        const dayAppointments = appointments.filter(a => a.date === dateStr);

        dayAppointments.forEach(appt => {
            col.appendChild(createWeekChip(appt, startHour));
        });

        daysGrid.appendChild(col);
    }

    updateWeekHeaderDates(weekDates);
    updateMonthLabel(date); // keep top label in sync
}

function createWeekChip(appt, startHour) {
    const chip = document.createElement("div");
    chip.className = `appt-chip-week status-${appt.status}`;
    chip.dataset.apptId = appt.id;

    const [startH, startM] = appt.start.split(":").map(Number);
    const [endH, endM] = appt.end.split(":").map(Number);

    const startMinutes = (startH - startHour) * 60 + startM;
    const endMinutes = (endH - startHour) * 60 + endM;
    const duration = endMinutes - startMinutes;

    chip.style.top = `${(startMinutes / 60) * HOUR_HEIGHT}px`;
    chip.style.height = `${(duration / 60) * HOUR_HEIGHT}px`;

    const client = document.createElement("span");
    client.className = "appt-client";
    client.textContent = appt.client;

    const timeRange = document.createElement("span");
    timeRange.className = "appt-time-range";
    timeRange.textContent = `${formatTime(appt.start)} - ${formatTime(appt.end)}`;

    chip.appendChild(client);
    chip.appendChild(document.createElement("br"));
    chip.appendChild(timeRange);
    return chip;
}

function formatHourLabel(h) {
    const period = h >= 12 ? "PM" : "AM";
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12} ${period}`;
}

function updateWeekHeaderDates(weekDates) {
    const nums = document.querySelectorAll(".week-date-num");
    weekDates.forEach((d, i) => {
        if (nums[i]) nums[i].textContent = d.getDate();
    });
}

const prevArrow = document.querySelectorAll(".nav-arrow")[0];
const nextArrow = document.querySelectorAll(".nav-arrow")[1];

prevArrow.addEventListener("click", () => {
    const isWeekView = getComputedStyle(weekViewEl).display !== "none";
    if (isWeekView) {
        currentDate.setDate(currentDate.getDate() - 7);
        renderWeek(currentDate);
    } else {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderMonth(currentDate);
    }
});

nextArrow.addEventListener("click", () => {
    const isWeekView = getComputedStyle(weekViewEl).display !== "none";
    if (isWeekView) {
        currentDate.setDate(currentDate.getDate() + 7);
        renderWeek(currentDate);
    } else {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderMonth(currentDate);
    }
});

/* ===== Search with live suggestions ===== */

const searchInput = document.getElementById("searchInput");
const searchSuggestions = document.getElementById("searchSuggestions");
const searchWrap = document.getElementById("searchWrap");

let activeSuggestionIndex = -1;

function formatDateDisplay(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dateObj = new Date(y, m - 1, d);
    return dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getMatches(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return appointments.filter(a =>
        a.client.toLowerCase().includes(q) ||
        a.status.toLowerCase().includes(q) ||
        a.date.includes(q)
    );
}

function renderSuggestions(matches) {
    searchSuggestions.innerHTML = "";
    activeSuggestionIndex = -1;

    if (matches.length === 0) {
        const li = document.createElement("li");
        li.className = "no-results";
        li.textContent = "No matching appointments";
        searchSuggestions.appendChild(li);
        searchSuggestions.classList.add("show");
        return;
    }

    matches.forEach(appt => {
        const li = document.createElement("li");
        li.dataset.apptId = appt.id;

        const client = document.createElement("span");
        client.className = "suggestion-client";
        client.textContent = appt.client;

        const meta = document.createElement("span");
        meta.className = "suggestion-meta";
        meta.textContent = `${formatDateDisplay(appt.date)} · ${formatTime(appt.start)}`;

        li.appendChild(client);
        li.appendChild(meta);

        li.addEventListener("click", () => selectAppointment(appt));

        searchSuggestions.appendChild(li);
    });

    searchSuggestions.classList.add("show");
}

function selectAppointment(appt) {
    searchInput.value = appt.client;
    closeSuggestions();

    // Jump the calendar to the date of the selected appointment
    const [y, m, d] = appt.date.split("-").map(Number);
    currentDate = new Date(y, m - 1, d);

    const isWeekView = getComputedStyle(weekViewEl).display !== "none";
    if (isWeekView) {
        renderWeek(currentDate);
    } else {
        renderMonth(currentDate);
    }

    highlightAppointment(appt.id);
    openApptModal(appt);
}

function highlightAppointment(apptId) {
    // Briefly flash the matching chip so the user can spot it
    const chips = document.querySelectorAll(`.appt-chip, .appt-chip-week`);
    chips.forEach(chip => {
        if (chip.dataset.apptId == apptId) {
            chip.classList.add("chip-highlight");
            setTimeout(() => chip.classList.remove("chip-highlight"), 1500);
        }
    });
}

function closeSuggestions() {
    searchSuggestions.classList.remove("show");
    searchSuggestions.innerHTML = "";
    activeSuggestionIndex = -1;
}

searchInput.addEventListener("input", () => {
    const matches = getMatches(searchInput.value);
    renderSuggestions(matches);
});

searchInput.addEventListener("focus", () => {
    if (searchInput.value.trim()) {
        renderSuggestions(getMatches(searchInput.value));
    }
});

searchInput.addEventListener("keydown", (e) => {
    const items = Array.from(searchSuggestions.querySelectorAll("li:not(.no-results)"));
    if (items.length === 0) return;

    if (e.key === "ArrowDown") {
        e.preventDefault();
        activeSuggestionIndex = (activeSuggestionIndex + 1) % items.length;
        updateActiveSuggestion(items);
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeSuggestionIndex = (activeSuggestionIndex - 1 + items.length) % items.length;
        updateActiveSuggestion(items);
    } else if (e.key === "Enter") {
        e.preventDefault();
        if (activeSuggestionIndex >= 0) {
            items[activeSuggestionIndex].click();
        }
    } else if (e.key === "Escape") {
        closeSuggestions();
    }
});

function updateActiveSuggestion(items) {
    items.forEach(item => item.classList.remove("active"));
    if (activeSuggestionIndex >= 0) {
        items[activeSuggestionIndex].classList.add("active");
        items[activeSuggestionIndex].scrollIntoView({ block: "nearest" });
    }
}

// Close dropdown when clicking outside the search box
document.addEventListener("click", (e) => {
    if (!searchWrap.contains(e.target)) {
        closeSuggestions();
    }
});
/* ===== Appointment Detail Modal =====
   The modal itself (open/close/populate) now lives in appointment-modal.js
   so it can be shared across the Admin, Staff, and Aesthetician pages.
   This file only needs to trigger it — clicking a calendar chip calls the
   shared openApptModal() from appointment-modal.js.
*/

// Clicking a calendar chip directly opens the detail modal
document.addEventListener("click", (e) => {
    const chip = e.target.closest(".appt-chip, .appt-chip-week");
    if (chip && chip.dataset.apptId) {
        const appt = appointments.find(a => a.id == chip.dataset.apptId);
        if (appt) openApptModal(appt);
    }
});

/* ===== Rating Widget (sidebar) =====
   Data shape expected from the backend:
   {
     average: 4.9,                 // number, 0–5
     totalReviews: 42,             // integer
     breakdown: { 5: 36, 4: 5, 3: 1, 2: 0, 1: 0 } // count of reviews per star value
   }
*/

const ratingAverageEl = document.getElementById("ratingAverage");
const ratingStarsEl = document.getElementById("ratingStars");
const ratingReviewCountEl = document.getElementById("ratingReviewCount");
const ratingBreakdownEl = document.getElementById("ratingBreakdown");

function renderRatingStars(average) {
    ratingStarsEl.innerHTML = "";
    for (let i = 0; i < 5; i++) {
        // How full this particular star should be, 0–100%
        const fillPercent = Math.max(0, Math.min(1, average - i)) * 100;

        const wrap = document.createElement("div");
        wrap.className = "star-wrap";

        const bg = document.createElement("div");
        bg.className = "star-bg";

        const fill = document.createElement("div");
        fill.className = "star-fill";
        fill.style.width = `${fillPercent}%`;

        const fillInner = document.createElement("div");
        fillInner.className = "star-fill-inner";

        fill.appendChild(fillInner);
        wrap.appendChild(bg);
        wrap.appendChild(fill);
        ratingStarsEl.appendChild(wrap);
    }
}

function renderRatingBreakdown(breakdown, totalReviews) {
    ratingBreakdownEl.innerHTML = "";
    for (let star = 5; star >= 1; star--) {
        const count = breakdown[star] || 0;
        const percent = totalReviews > 0 ? (count / totalReviews) * 100 : 0;

        const row = document.createElement("div");
        row.className = "rating-breakdown-row";

        const label = document.createElement("span");
        label.className = "rating-breakdown-label";
        label.textContent = `${star} ★`;

        const track = document.createElement("div");
        track.className = "rating-breakdown-track";

        const fill = document.createElement("div");
        fill.className = "rating-breakdown-fill";
        fill.style.width = `${percent}%`;
        track.appendChild(fill);

        const countEl = document.createElement("span");
        countEl.className = "rating-breakdown-count";
        countEl.textContent = count;

        row.appendChild(label);
        row.appendChild(track);
        row.appendChild(countEl);
        ratingBreakdownEl.appendChild(row);
    }
}

// Call this any time fresh rating data is available (initial load, after a new
// review comes in, after a websocket push, etc.) to refresh the whole widget.
function updateRatingUI(data) {
    ratingAverageEl.textContent = data.average.toFixed(1);
    ratingReviewCountEl.textContent = `from ${data.totalReviews} client review${data.totalReviews === 1 ? "" : "s"}`;
    renderRatingStars(data.average);
    renderRatingBreakdown(data.breakdown, data.totalReviews);
}

// Placeholder fetch — swap the body of this function for a real API call once
// the backend exists, e.g.:
//   return fetch("/api/aesthetician/123/ratings").then(res => res.json());
function fetchRatingData() {
    const placeholderData = {
        average: 4.9,
        totalReviews: 42,
        breakdown: { 5: 36, 4: 5, 3: 1, 2: 0, 1: 0 }
    };
    return Promise.resolve(placeholderData);
}

fetchRatingData().then(updateRatingUI);

/* Notification dropdown and logout button behavior now live in header.js,
   since they're shared across every page that uses the common header.
   Include header.js alongside this file wherever the header markup appears. */
