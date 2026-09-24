(function () {
    const todayCount = document.getElementById("todayAppointmentCount");
    const rescheduledCount = document.getElementById("rescheduledCount");
    const cancelledCount = document.getElementById("cancelledCount");
    const tableBody = document.getElementById("clientsTableBody");
    const tableCount = document.getElementById("clientsTableCount");
    const tableSummary = document.getElementById("clientsTableSummary");
    const pagination = document.getElementById("clientsPagination");
    const errorMessage = document.getElementById("clientsError");
    const dateLabel = document.getElementById("clientsDashboardDate");
    const clientModalOverlay = document.getElementById("clientModalOverlay");
    const clientModalClose = document.getElementById("clientModalClose");
    const clientModalDone = document.getElementById("clientModalDone");

    if (!todayCount || !tableBody) return;

    const pageSize = 6;
    let allAppointments = [];
    let currentPage = 1;

    const statusLabels = {
        pending: "PENDING",
        confirmed: "CONFIRMED",
        "in-progress": "IN PROGRESS",
        completed: "COMPLETED",
        cancelled: "CANCELLED",
        rescheduled: "RESCHEDULED",
        no_show: "NO SHOW",
    };

    function localDateString(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function formatDate(dateValue, timeValue) {
        const date = new Date(`${dateValue}T${timeValue || "00:00:00"}`);
        if (Number.isNaN(date.getTime())) return "—";
        return new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        }).format(date);
    }

    function formatTime(timeValue) {
        if (!timeValue) return "—";
        const [hour, minute] = timeValue.slice(0, 5).split(":").map(Number);
        if (!Number.isInteger(hour) || !Number.isInteger(minute)) return "—";
        const date = new Date(2000, 0, 1, hour, minute);
        return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
    }

    function statusClass(status) {
        return `client-status--${String(status || "pending").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    }

    function setModalValue(id, value) {
        document.getElementById(id).textContent = value || "—";
    }

    function formatCurrency(value) {
        if (value === null || value === undefined || value === "") return "—";
        return `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function openClientModal(appointment) {
        const clientName = appointment.client || "Client";
        const status = String(appointment.status || "pending").toLowerCase();
        const avatar = clientName.split(" ").map((part) => part[0] || "").slice(0, 2).join("").toUpperCase();
        setModalValue("clientModalTitle", clientName);
        setModalValue("clientModalAvatar", avatar || "--");
        setModalValue("clientModalNumber", `Appointment #${appointment.id || "—"}`);
        setModalValue("clientModalDate", formatDate(appointment.date, appointment.start));
        setModalValue("clientModalTime", formatTime(appointment.start));
        setModalValue("clientModalService", appointment.service);
        setModalValue("clientModalDuration", appointment.end ? `${formatTime(appointment.start)} - ${formatTime(appointment.end)}` : "—");
        setModalValue("clientModalFee", formatCurrency(appointment.fee));
        setModalValue("clientModalDeposit", formatCurrency(appointment.depositAmount));
        setModalValue("clientModalContact", appointment.contact);
        setModalValue("clientModalAesthetician", appointment.aesthetician);
        const statusBadge = document.getElementById("clientModalStatus");
        statusBadge.className = `client-status ${statusClass(status)}`;
        statusBadge.innerHTML = `<span></span>${statusLabels[status] || status.toUpperCase()}`;
        clientModalOverlay.classList.add("show");
        clientModalOverlay.setAttribute("aria-hidden", "false");
    }

    function closeClientModal() {
        clientModalOverlay.classList.remove("show");
        clientModalOverlay.setAttribute("aria-hidden", "true");
    }

    function createAppointmentCell(appointment) {
        const cell = document.createElement("td");
        cell.className = "client-appointment-cell";
        cell.innerHTML = `<strong>${formatDate(appointment.date, appointment.start)}</strong><span>${formatTime(appointment.start)}</span>`;
        return cell;
    }

    function renderAppointments(appointments) {
        allAppointments = appointments;
        currentPage = 1;
        const today = localDateString();
        const counts = appointments.reduce((result, appointment) => {
            const status = String(appointment.status || "").toLowerCase();
            if (appointment.date === today && status !== "cancelled") result.today += 1;
            if (status === "rescheduled") result.rescheduled += 1;
            if (status === "cancelled") result.cancelled += 1;
            return result;
        }, { today: 0, rescheduled: 0, cancelled: 0 });

        todayCount.textContent = counts.today;
        rescheduledCount.textContent = counts.rescheduled;
        cancelledCount.textContent = counts.cancelled;
        tableCount.textContent = `${appointments.length} appointment${appointments.length === 1 ? "" : "s"}`;
        renderClientPage();
    }

    function renderClientPage() {
        const totalPages = Math.max(1, Math.ceil(allAppointments.length / pageSize));
        currentPage = Math.min(currentPage, totalPages);
        const startIndex = (currentPage - 1) * pageSize;
        const pageAppointments = allAppointments.slice(startIndex, startIndex + pageSize);
        tableBody.replaceChildren();

        if (pageAppointments.length === 0) {
            const row = document.createElement("tr");
            row.innerHTML = '<td class="clients-table-message" colspan="5">No client appointments found.</td>';
            tableBody.appendChild(row);
        } else {
            pageAppointments.forEach((appointment) => {
                const row = document.createElement("tr");
                const status = String(appointment.status || "pending").toLowerCase();
                row.innerHTML = `
                    <td>
                        <div class="client-name-cell">
                            <span class="client-avatar">${String(appointment.client || "Client").split(" ").map((part) => part[0] || "").slice(0, 2).join("").toUpperCase()}</span>
                            <span><strong>${appointment.client || "Client"}</strong><small>Appointment #${appointment.id || "—"}</small></span>
                        </div>
                    </td>
                    <td>${appointment.service || "—"}</td>
                    <td></td>
                    <td><span class="client-status ${statusClass(status)}"><span></span>${statusLabels[status] || status.toUpperCase()}</span></td>
                    <td><button class="client-action" type="button" data-appointment-id="${appointment.id || ""}">View</button><button class="client-action client-action--muted" type="button" disabled>Add Notes</button></td>
                `;
                row.children[2].replaceWith(createAppointmentCell(appointment));
                row.querySelector(".client-action").addEventListener("click", () => openClientModal(appointment));
                tableBody.appendChild(row);
            });
        }

        const shownFrom = allAppointments.length === 0 ? 0 : startIndex + 1;
        const shownTo = Math.min(startIndex + pageSize, allAppointments.length);
        tableSummary.textContent = `Showing ${shownTo === 0 ? 0 : `${shownFrom}-${shownTo}`} of ${allAppointments.length} clients`;
        pagination.replaceChildren();

        if (totalPages > 1) {
            for (let page = 1; page <= totalPages; page += 1) {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = page;
                button.className = page === currentPage ? "active" : "";
                button.setAttribute("aria-label", `Page ${page}`);
                button.setAttribute("aria-current", page === currentPage ? "page" : "false");
                button.addEventListener("click", () => {
                    currentPage = page;
                    renderClientPage();
                });
                pagination.appendChild(button);
            }
        }
    }

    async function loadAppointments() {
        try {
            const response = await fetch("/api/appointments/mine");
            if (!response.ok) throw new Error("Could not load client appointments.");
            renderAppointments(await response.json());
        } catch (error) {
            errorMessage.textContent = error.message;
            errorMessage.hidden = false;
            tableBody.innerHTML = '<tr><td class="clients-table-message" colspan="5">Client appointments could not be loaded.</td></tr>';
        }
    }

    dateLabel.textContent = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date());
    clientModalClose.addEventListener("click", closeClientModal);
    clientModalDone.addEventListener("click", closeClientModal);
    clientModalOverlay.addEventListener("click", (event) => {
        if (event.target === clientModalOverlay) closeClientModal();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && clientModalOverlay.classList.contains("show")) closeClientModal();
    });
    loadAppointments();
})();