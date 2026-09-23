(function () {
    const tableBody = document.getElementById("dashboardClientsBody");
    if (!tableBody) return;

    const pageSize = 8;
    let appointments = [];
    let currentPage = 1;
    let sortKey = null;
    let sortDirection = 1;
    let statusFilter = "all";
    let serviceFilter = "all";
    const statusLabels = {
        pending: "PENDING",
        confirmed: "CONFIRMED",
        "in-progress": "IN PROGRESS",
        completed: "COMPLETED",
        cancelled: "CANCELLED",
        rescheduled: "RESCHEDULED",
        "no-show": "NO SHOW"
    };

    function localDateString(date = new Date()) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    function formatDate(date, time) {
        const value = new Date(`${date}T${time || "00:00"}`);
        if (Number.isNaN(value.getTime())) return "—";
        return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(value);
    }

    function formatTime(time) {
        if (!time) return "—";
        const [hour, minute] = time.slice(0, 5).split(":").map(Number);
        if (!Number.isInteger(hour) || !Number.isInteger(minute)) return "—";
        return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hour, minute));
    }

    function statusClass(status) {
        return `client-status--${String(status || "pending").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    }

    function initials(name) {
        return String(name || "Client").split(" ").map((part) => part[0] || "").slice(0, 2).join("").toUpperCase();
    }

    function filteredAppointments() {
        const search = document.getElementById("searchInput").value.trim().toLowerCase();
        const result = appointments.filter((appointment) => {
            const status = String(appointment.status || "pending").toLowerCase();
            const searchable = `${appointment.client || ""} ${appointment.service || ""} ${formatDate(appointment.date, appointment.start)} ${statusLabels[status] || status}`.toLowerCase();
            return (statusFilter === "all" || status === statusFilter) && (serviceFilter === "all" || appointment.service === serviceFilter) && (!search || searchable.includes(search));
        });

        if (sortKey) {
            result.sort((first, second) => {
                let firstValue;
                let secondValue;
                if (sortKey === "date") {
                    firstValue = new Date(`${first.date}T${first.start || "00:00"}`).getTime();
                    secondValue = new Date(`${second.date}T${second.start || "00:00"}`).getTime();
                } else {
                    firstValue = String(first[sortKey] || "").toLowerCase();
                    secondValue = String(second[sortKey] || "").toLowerCase();
                }
                if (firstValue < secondValue) return -1 * sortDirection;
                if (firstValue > secondValue) return 1 * sortDirection;
                return 0;
            });
        }
        return result;
    }

    function renderSummary() {
        const today = localDateString();
        const thisMonth = new Date().toISOString().slice(0, 7);
        const count = (status) => appointments.filter((item) => String(item.status || "").toLowerCase() === status).length;
        const todayCount = appointments.filter((item) => item.date === today && item.status !== "cancelled").length;
        document.getElementById("dashboardTodayCount").textContent = todayCount;
        document.getElementById("dashboardTodayHint").textContent = `${todayCount} remaining today`;
        document.getElementById("dashboardConfirmedCount").textContent = count("confirmed");
        document.getElementById("dashboardPendingCount").textContent = count("pending");
        document.getElementById("dashboardCancelledCount").textContent = appointments.filter((item) => String(item.status || "").toLowerCase() === "cancelled" && String(item.date || "").startsWith(thisMonth)).length;
        document.getElementById("dashboardClientTotal").textContent = `(${appointments.length})`;
    }

    function renderClientPage() {
        const visibleAppointments = filteredAppointments();
        const totalPages = Math.max(1, Math.ceil(visibleAppointments.length / pageSize));
        currentPage = Math.min(currentPage, totalPages);
        const start = (currentPage - 1) * pageSize;
        const visible = visibleAppointments.slice(start, start + pageSize);
        tableBody.replaceChildren();
        visible.forEach((appointment) => {
            const status = String(appointment.status || "pending").toLowerCase();
            const row = document.createElement("tr");
            row.innerHTML = `<td><div class="client-name-cell"><span class="client-avatar">${initials(appointment.client)}</span><span><strong>${appointment.client || "Client"}</strong><small>Appointment #${appointment.id || "—"}</small></span></div></td><td>${appointment.service || "—"}</td><td><div class="client-appointment-cell"><strong>${formatDate(appointment.date, appointment.start)}</strong><span>${formatTime(appointment.start)}</span></div></td><td><span class="client-status ${statusClass(status)}"><span></span>${statusLabels[status] || status.toUpperCase()}</span></td>`;
            tableBody.appendChild(row);
        });
        if (!visible.length) tableBody.innerHTML = '<tr><td colspan="4" class="clients-table-message">No client appointments found.</td></tr>';
        const shownFrom = visibleAppointments.length ? start + 1 : 0;
        document.getElementById("dashboardTableSummary").textContent = `Showing ${shownFrom}-${Math.min(start + pageSize, visibleAppointments.length)} of ${visibleAppointments.length} clients`;
        const pagination = document.getElementById("dashboardPagination");
        pagination.replaceChildren();
        for (let page = 1; page <= totalPages; page += 1) {
            if (totalPages === 1) break;
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = page;
            button.className = page === currentPage ? "active" : "";
            button.addEventListener("click", () => { currentPage = page; renderClientPage(); });
            pagination.appendChild(button);
        }
    }

    function renderTimeline() {
        const today = localDateString();
        const timeline = document.getElementById("dashboardTimeline");
        const todayAppointments = appointments.filter((item) => item.date === today).sort((a, b) => String(a.start).localeCompare(String(b.start)));
        timeline.replaceChildren();
        todayAppointments.forEach((appointment) => {
            const item = document.createElement("div");
            const status = String(appointment.status || "pending").toLowerCase();
            item.className = `timeline-item ${statusClass(status)}`;
            item.innerHTML = `<span class="timeline-dot"></span><div><time>${formatTime(appointment.start)}</time><strong>${appointment.client || "Client"} - ${appointment.service || "Appointment"}</strong><small>${statusLabels[status] || status.toUpperCase()}</small></div>`;
            timeline.appendChild(item);
        });
        if (!todayAppointments.length) timeline.innerHTML = '<p class="dashboard-empty-state">No appointments today.</p>';
    }

    function renderBreakdown() {
        const statuses = ["completed", "confirmed", "pending", "cancelled"];
        const breakdown = document.getElementById("dashboardBreakdown");
        breakdown.replaceChildren();
        statuses.forEach((status) => {
            const total = appointments.filter((item) => String(item.status || "").toLowerCase() === status).length;
            const row = document.createElement("div");
            row.className = `dashboard-breakdown-row dashboard-breakdown-row--${status}`;
            row.innerHTML = `<div><span>${statusLabels[status]}</span><strong>${total}</strong></div><span class="dashboard-breakdown-track"><i style="width: ${appointments.length ? (total / appointments.length) * 100 : 0}%"></i></span>`;
            breakdown.appendChild(row);
        });
    }

    function populateServiceMenu() {
        const serviceMenu = document.getElementById("dashboardServiceMenu");
        const services = [...new Set(appointments.map((appointment) => appointment.service).filter(Boolean))].sort((first, second) => first.localeCompare(second));
        serviceMenu.replaceChildren();
        const allButton = document.createElement("button");
        allButton.type = "button";
        allButton.dataset.service = "all";
        allButton.setAttribute("role", "menuitem");
        allButton.textContent = "ALL";
        serviceMenu.appendChild(allButton);
        services.forEach((service) => {
            const button = document.createElement("button");
            button.type = "button";
            button.dataset.service = service;
            button.setAttribute("role", "menuitem");
            button.textContent = service;
            serviceMenu.appendChild(button);
        });
    }

    function renderRating() {
        const data = { average: 4.9, totalReviews: 42, breakdown: { 5: 36, 4: 5, 3: 1, 2: 0, 1: 0 } };
        document.getElementById("dashboardRatingAverage").textContent = data.average.toFixed(1);
        document.getElementById("dashboardRatingCount").textContent = `from ${data.totalReviews} client reviews`;
        const stars = document.getElementById("dashboardRatingStars");
        for (let index = 0; index < 5; index += 1) {
            const star = document.createElement("span");
            star.className = index < Math.round(data.average) ? "rating-star filled" : "rating-star";
            star.textContent = "★";
            stars.appendChild(star);
        }
        const breakdown = document.getElementById("dashboardRatingBreakdown");
        for (let star = 5; star >= 1; star -= 1) {
            const row = document.createElement("div");
            row.className = "rating-breakdown-row";
            row.innerHTML = `<span class="rating-breakdown-label">${star} ★</span><span class="rating-breakdown-track"><span class="rating-breakdown-fill" style="width: ${(data.breakdown[star] / data.totalReviews) * 100}%"></span></span><span class="rating-breakdown-count">${data.breakdown[star]}</span>`;
            breakdown.appendChild(row);
        }
    }

    async function loadDashboard() {
        try {
            const response = await fetch("/api/appointments/mine");
            if (!response.ok) throw new Error("Could not load appointments.");
            appointments = await response.json();
            populateServiceMenu();
            renderSummary();
            renderClientPage();
            renderTimeline();
            renderBreakdown();
        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="4" class="clients-table-message">${error.message}</td></tr>`;
        }
    }

    const headerSearch = document.getElementById("searchWrap");
    const dashboardToolbar = document.querySelector(".dashboard-panel-tabs");
    dashboardToolbar.appendChild(headerSearch);
    document.getElementById("searchInput").addEventListener("input", () => {
        currentPage = 1;
        renderClientPage();
    });
    const statusButton = document.getElementById("dashboardStatusButton");
    const statusMenu = document.getElementById("dashboardStatusMenu");
    statusButton.addEventListener("click", (event) => {
        event.stopPropagation();
        const isOpen = statusMenu.classList.toggle("show");
        statusButton.setAttribute("aria-expanded", String(isOpen));
    });
    statusMenu.querySelectorAll("button[data-status]").forEach((button) => {
        button.addEventListener("click", () => {
            statusFilter = button.dataset.status;
            statusMenu.classList.remove("show");
            statusButton.setAttribute("aria-expanded", "false");
            currentPage = 1;
            renderClientPage();
        });
    });
    const serviceButton = document.getElementById("dashboardServiceButton");
    const serviceMenu = document.getElementById("dashboardServiceMenu");
    serviceButton.addEventListener("click", (event) => {
        event.stopPropagation();
        const isOpen = serviceMenu.classList.toggle("show");
        serviceButton.setAttribute("aria-expanded", String(isOpen));
    });
    serviceMenu.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-service]");
        if (!button) return;
        serviceFilter = button.dataset.service;
        serviceMenu.classList.remove("show");
        serviceButton.setAttribute("aria-expanded", "false");
        currentPage = 1;
        renderClientPage();
    });
    document.addEventListener("click", () => {
        statusMenu.classList.remove("show");
        statusButton.setAttribute("aria-expanded", "false");
        serviceMenu.classList.remove("show");
        serviceButton.setAttribute("aria-expanded", "false");
    });
    document.querySelectorAll(".dashboard-sort-button").forEach((button) => {
        button.addEventListener("click", () => {
            const nextSortKey = button.dataset.sort;
            if (sortKey === nextSortKey) {
                sortDirection *= -1;
            } else {
                sortKey = nextSortKey;
                sortDirection = nextSortKey === "date" ? -1 : 1;
            }
            document.querySelectorAll(".dashboard-sort-button").forEach((sortButton) => {
                sortButton.classList.toggle("active", sortButton === button);
                const icon = sortButton.querySelector(".dashboard-sort-icon");
                if (icon) {
                    icon.src = sortButton === button && sortDirection === 1 ? "icons/triangle-up.svg" : "icons/triangle-down.svg";
                    icon.alt = sortButton === button ? `Sort ${sortButton.dataset.sort} ${sortDirection === 1 ? "descending" : "ascending"}` : `Sort ${sortButton.dataset.sort}`;
                }
            });
            currentPage = 1;
            renderClientPage();
        });
    });
    renderRating();
    loadDashboard();
})();
