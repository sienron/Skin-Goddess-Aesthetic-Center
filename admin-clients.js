document.addEventListener("DOMContentLoaded", () => {
  const todayCount = document.getElementById("todayAppointmentCount");
  const rescheduledCount = document.getElementById("rescheduledCount");
  const cancelledCount = document.getElementById("cancelledCount");
  const tableBody = document.getElementById("clientsTableBody");
  const tableCount = document.getElementById("clientsTableCount");
  const tableSummary = document.getElementById("clientsTableSummary");
  const pagination = document.getElementById("clientsPagination");
  const errorMessage = document.getElementById("clientsError");
  const modal = document.getElementById("clientModalOverlay");
  if (!todayCount || !tableBody || !modal) return;

  const pageSize = 8;
  let appointments = [];
  let currentPage = 1;
  const statuses = { confirmed: "CONFIRMED", "in-progress": "IN PROGRESS", completed: "COMPLETED", cancelled: "CANCELLED", rescheduled: "RESCHEDULED", no_show: "NO SHOW" };

  function escapeHtml(value) {
    const node = document.createElement("span");
    node.textContent = String(value ?? "");
    return node.innerHTML;
  }

  function localDateKey() {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function dateLabel(value, time) {
    const date = new Date(`${value}T${time || "00:00:00"}`);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
  }

  function timeLabel(value) {
    if (!value) return "—";
    const [hour, minute] = String(value).slice(0, 5).split(":").map(Number);
    return Number.isInteger(hour) && Number.isInteger(minute)
      ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hour, minute))
      : "—";
  }

  function currency(value) {
    const amount = Number(value);
    return value === null || value === undefined || value === "" || !Number.isFinite(amount)
      ? "—"
      : `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function openDetails(appointment) {
    const name = appointment.client || "Client";
    const set = (id, value) => { document.getElementById(id).textContent = value || "—"; };
    set("clientModalTitle", name);
    set("clientModalAvatar", name.split(" ").map((part) => part[0] || "").slice(0, 2).join("").toUpperCase() || "--");
    set("clientModalNumber", `Appointment #${appointment.appointment_id}`);
    set("clientModalDate", dateLabel(appointment.date, appointment.start));
    set("clientModalTime", timeLabel(appointment.start));
    set("clientModalService", appointment.service);
    set("clientModalDuration", appointment.end ? `${timeLabel(appointment.start)} - ${timeLabel(appointment.end)}` : "—");
    set("clientModalFee", currency(appointment.fee));
    set("clientModalDeposit", currency(appointment.deposit_amount));
    set("clientModalContact", appointment.contact);
    set("clientModalAesthetician", appointment.assigned_to);
    const status = String(appointment.status || "unknown").toLowerCase();
    const badge = document.getElementById("clientModalStatus");
    badge.className = `client-status client-status--${status.replace(/[^a-z0-9]+/g, "-")}`;
    badge.innerHTML = `<span></span>${statuses[status] || escapeHtml(status.toUpperCase())}`;
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
  }

  function render() {
    const pages = Math.max(1, Math.ceil(appointments.length / pageSize));
    currentPage = Math.min(currentPage, pages);
    const offset = (currentPage - 1) * pageSize;
    const pageRows = appointments.slice(offset, offset + pageSize);
    tableBody.replaceChildren();
    if (!pageRows.length) {
      const row = document.createElement("tr");
      row.innerHTML = '<td class="clients-table-message" colspan="5">No client appointments found.</td>';
      tableBody.appendChild(row);
    } else {
      pageRows.forEach((appointment) => {
        const name = appointment.client || "Client";
        const status = String(appointment.status || "unknown").toLowerCase();
        const row = document.createElement("tr");
        row.innerHTML = `<td><div class="client-name-cell"><span class="client-avatar">${escapeHtml(name.split(" ").map((part) => part[0] || "").slice(0, 2).join("").toUpperCase())}</span><span><strong>${escapeHtml(name)}</strong><small>Appointment #${escapeHtml(appointment.appointment_id)}</small></span></div></td><td>${escapeHtml(appointment.service || "—")}</td><td class="client-appointment-cell"><strong>${escapeHtml(dateLabel(appointment.date, appointment.start))}</strong><span>${escapeHtml(timeLabel(appointment.start))}</span></td><td><span class="client-status client-status--${escapeHtml(status.replace(/[^a-z0-9]+/g, "-"))}"><span></span>${escapeHtml(statuses[status] || status.toUpperCase())}</span></td><td><button class="client-action" type="button">View</button></td>`;
        row.querySelector("button").addEventListener("click", () => openDetails(appointment));
        tableBody.appendChild(row);
      });
    }
    const shownFrom = appointments.length ? offset + 1 : 0;
    const shownTo = Math.min(offset + pageSize, appointments.length);
    tableSummary.textContent = `Showing ${shownTo ? `${shownFrom}-${shownTo}` : 0} of ${appointments.length} appointments`;
    tableCount.textContent = `${appointments.length} appointment${appointments.length === 1 ? "" : "s"}`;
    pagination.replaceChildren();
    for (let page = 1; page <= pages && pages > 1; page += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = page;
      button.className = page === currentPage ? "active" : "";
      button.setAttribute("aria-label", `Page ${page}`);
      if (page === currentPage) button.setAttribute("aria-current", "page");
      button.addEventListener("click", () => { currentPage = page; render(); });
      pagination.appendChild(button);
    }
  }

  async function load() {
    try {
      const response = await fetch("/api/appointments/admin");
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.message || "Could not load client appointments.");
      appointments = Array.isArray(data) ? data : [];
      const today = localDateKey();
      todayCount.textContent = appointments.filter((item) => item.date === today && item.status !== "cancelled").length;
      rescheduledCount.textContent = appointments.filter((item) => item.status === "rescheduled").length;
      cancelledCount.textContent = appointments.filter((item) => item.status === "cancelled").length;
      render();
    } catch (error) {
      errorMessage.textContent = error.message;
      errorMessage.hidden = false;
      tableBody.innerHTML = '<tr><td class="clients-table-message" colspan="5">Client appointments could not be loaded.</td></tr>';
      tableCount.textContent = "Unable to load clients";
    }
  }

  document.getElementById("clientsDashboardDate").textContent = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date());
  document.getElementById("clientModalClose").addEventListener("click", () => { modal.classList.remove("show"); modal.setAttribute("aria-hidden", "true"); });
  document.getElementById("clientModalDone").addEventListener("click", () => { modal.classList.remove("show"); modal.setAttribute("aria-hidden", "true"); });
  modal.addEventListener("click", (event) => { if (event.target === modal) { modal.classList.remove("show"); modal.setAttribute("aria-hidden", "true"); } });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && modal.classList.contains("show")) { modal.classList.remove("show"); modal.setAttribute("aria-hidden", "true"); } });
  load();
});
