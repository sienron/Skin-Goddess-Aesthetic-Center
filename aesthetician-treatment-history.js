(function () {
    const tableBody = document.getElementById("appointmentsTableBody");
    const searchInput = document.getElementById("searchInput");
    const tableSummary = document.getElementById("appointmentsTableSummary");
    const notesModal = document.getElementById("treatmentNotesModal");
    const notesModalClose = document.getElementById("treatmentNotesModalClose");
    const notesModalTitle = document.getElementById("treatmentNotesModalTitle");
    const notesList = document.getElementById("treatmentNotesList");
    if (!tableBody || !searchInput || !tableSummary || !notesModal || !notesModalClose || !notesModalTitle || !notesList) return;

    const statusLabels = {
        pending: "PENDING",
        confirmed: "CONFIRMED",
        "in-progress": "IN PROGRESS",
        completed: "COMPLETED",
        cancelled: "CANCELLED",
        no_show: "NO SHOW",
    };

    let appointments = [];

    function text(value, fallback = "—") {
        return value === null || value === undefined || value === "" ? fallback : String(value);
    }

    function formatDate(dateValue) {
        const date = new Date(`${dateValue}T00:00:00`);
        if (Number.isNaN(date.getTime())) return text(dateValue);
        return new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        }).format(date);
    }

    function formatTime(timeValue) {
        if (!timeValue) return "—";
        const [hour, minute] = String(timeValue).slice(0, 5).split(":").map(Number);
        if (!Number.isInteger(hour) || !Number.isInteger(minute)) return "—";
        return new Intl.DateTimeFormat("en-US", {
            hour: "numeric",
            minute: "2-digit",
        }).format(new Date(2000, 0, 1, hour, minute));
    }

    function formatCurrency(value) {
        if (value === null || value === undefined || value === "") return "—";
        const amount = Number(value);
        return Number.isFinite(amount)
            ? `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : "—";
    }

    function statusClass(status) {
        return `client-status--${String(status || "pending").toLowerCase().replace(/_/g, "-")}`;
    }

    function appendCell(row, value, className = "") {
        const cell = document.createElement("td");
        if (className) cell.className = className;
        cell.textContent = text(value);
        row.appendChild(cell);
    }

    function appendStatusCell(row, status) {
        const cell = document.createElement("td");
        const badge = document.createElement("span");
        const normalizedStatus = String(status || "pending").toLowerCase();
        badge.className = `client-status ${statusClass(normalizedStatus)}`;
        const dot = document.createElement("span");
        badge.append(dot, document.createTextNode(statusLabels[normalizedStatus] || normalizedStatus.toUpperCase()));
        cell.appendChild(badge);
        row.appendChild(cell);
    }

    function appendNotesButtonCell(row, appointment) {
        const cell = document.createElement("td");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "client-action treatment-notes-view-btn";
        button.textContent = "View Notes";
        button.addEventListener("click", () => openNotesModal(appointment));
        cell.appendChild(button);
        row.appendChild(cell);
    }

    function closeNotesModal() {
        notesModal.classList.remove("show");
        notesModal.setAttribute("aria-hidden", "true");
        notesList.replaceChildren();
    }

    function formatNoteDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "Updated recently";
        return new Intl.DateTimeFormat("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
        }).format(date);
    }

    function renderClientNotes(notes) {
        notesList.replaceChildren();
        if (!notes.length) {
            const empty = document.createElement("p");
            empty.className = "treatment-notes-empty";
            empty.textContent = "No treatment notes for this client yet.";
            notesList.appendChild(empty);
            return;
        }

        notes.forEach((note) => {
            const article = document.createElement("article");
            article.className = "treatment-note-item";
            if (note.color) article.style.borderLeftColor = note.color;

            const heading = document.createElement("div");
            heading.className = "treatment-note-item-heading";
            const service = document.createElement("strong");
            service.textContent = text(note.service, "Treatment");
            const updated = document.createElement("time");
            updated.dateTime = note.updatedAt || "";
            updated.textContent = formatNoteDate(note.updatedAt);
            heading.append(service, updated);

            const appointment = document.createElement("p");
            appointment.className = "treatment-note-item-appointment";
            appointment.textContent = `Appointment #${text(note.appointmentId)} · ${formatDate(note.appointmentDate)} · ${text(note.appointmentStatus).replace(/_/g, " ").toUpperCase()}`;

            const content = document.createElement("p");
            content.className = "treatment-note-item-text";
            content.textContent = text(note.text, "No note text");

            article.append(heading, appointment, content);
            notesList.appendChild(article);
        });
    }

    async function openNotesModal(appointment) {
        notesModalTitle.textContent = `${text(appointment.client, "Client")} - Treatment Notes`;
        notesList.replaceChildren();
        const loading = document.createElement("p");
        loading.className = "treatment-notes-empty";
        loading.textContent = "Loading treatment notes...";
        notesList.appendChild(loading);
        notesModal.classList.add("show");
        notesModal.setAttribute("aria-hidden", "false");

        try {
            let response;
            if (appointment.clientId) {
                response = await fetch(`/api/appointments/client/${encodeURIComponent(appointment.clientId)}/notes`);
            }

            if (!response || !response.ok) {
                if (!appointment.id) throw new Error("This appointment has no valid ID.");
                response = await fetch(`/api/appointments/${encodeURIComponent(appointment.id)}/notes`);
            }

            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || "Could not load treatment notes.");
            renderClientNotes(Array.isArray(data) ? data : []);
        } catch (error) {
            notesList.replaceChildren();
            const message = document.createElement("p");
            message.className = "treatment-notes-empty treatment-notes-error";
            message.textContent = error.message;
            notesList.appendChild(message);
        }
    }

    notesModalClose.addEventListener("click", closeNotesModal);
    notesModal.addEventListener("click", (event) => {
        if (event.target === notesModal) closeNotesModal();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && notesModal.classList.contains("show")) closeNotesModal();
    });

    function appointmentTimestamp(appointment) {
        return new Date(`${appointment.date}T${String(appointment.start || "00:00").slice(0, 8)}`).getTime();
    }

    function filteredAppointments() {
        const query = searchInput.value.trim().toLowerCase();
        if (!query) return appointments;
        return appointments.filter((appointment) => {
            const status = statusLabels[appointment.status] || appointment.status;
            const searchable = [
                appointment.id,
                appointment.client,
                appointment.clientEmail,
                appointment.contact,
                appointment.service,
                appointment.date,
                appointment.start,
                status,
                appointment.paymentStatus,
                appointment.aesthetician,
                appointment.remarks,
            ].join(" ").toLowerCase();
            return searchable.includes(query);
        });
    }

    function render() {
        const visibleAppointments = filteredAppointments();
        tableBody.replaceChildren();

        if (visibleAppointments.length === 0) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 13;
            cell.className = "clients-table-message";
            cell.textContent = appointments.length === 0 ? "No recent appointments." : "No appointments match your search.";
            row.appendChild(cell);
            tableBody.appendChild(row);
        } else {
            visibleAppointments.forEach((appointment) => {
                const row = document.createElement("tr");
                appendCell(row, `#${text(appointment.apptNumber || appointment.id)}`);
                appendCell(row, appointment.client);
                appendCell(row, [appointment.clientEmail, appointment.contact].filter(Boolean).join(" · "));
                appendCell(row, appointment.service);
                appendCell(row, formatDate(appointment.date));
                appendCell(row, `${formatTime(appointment.start)} - ${formatTime(appointment.end)}`);
                appendStatusCell(row, appointment.status);
                appendCell(row, appointment.paymentStatus);
                appendCell(row, formatCurrency(appointment.fee));
                appendCell(row, formatCurrency(appointment.depositAmount));
                appendCell(row, appointment.aesthetician);
                appendCell(row, appointment.remarks);
                appendNotesButtonCell(row, appointment);
                tableBody.appendChild(row);
            });
        }

        tableSummary.textContent = searchInput.value.trim()
            ? `Showing ${visibleAppointments.length} of ${appointments.length} appointments`
            : `Showing ${appointments.length} appointments`;
    }

    async function loadAppointments() {
        try {
            const response = await fetch("/api/appointments/mine");
            if (!response.ok) throw new Error("Could not load appointments.");
            const data = await response.json();
            appointments = Array.isArray(data) ? data.map((appointment) => ({
                ...appointment,
                id: appointment.id ?? appointment.appointment_id,
                clientId: appointment.clientId ?? appointment.client_id,
                date: appointment.date ?? appointment.appointment_date,
                start: appointment.start ?? appointment.appointment_time,
                end: appointment.end ?? appointment.appointment_end_time,
                status: String(appointment.status ?? appointment.appointment_status ?? "").toLowerCase(),
                client: appointment.client ?? "Client",
                clientEmail: appointment.clientEmail ?? appointment.client_email,
                service: appointment.service ?? appointment.service_name,
                paymentStatus: appointment.payment_status,
                fee: appointment.fee ?? appointment.booked_service_price,
                depositAmount: appointment.depositAmount ?? appointment.booked_reservation_fee,
                contact: appointment.contact ?? appointment.contact_number,
                aesthetician: appointment.aesthetician ?? "Aesthetician",
                remarks: appointment.remarks ?? appointment.notes,
                apptNumber: appointment.apptNumber ?? appointment.appt_number ?? appointment.id,
            })).sort((first, second) => appointmentTimestamp(second) - appointmentTimestamp(first)) : [];
            render();
        } catch (error) {
            tableBody.innerHTML = "";
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 13;
            cell.className = "clients-table-message";
            cell.textContent = error.message;
            row.appendChild(cell);
            tableBody.appendChild(row);
            tableSummary.textContent = "Unable to load appointments";
        }
    }

    searchInput.addEventListener("input", render);
    loadAppointments();
})();
