/* ===== Shared Appointment Detail Modal =====
   Include this file on ANY page that has the appointment modal markup
   (Admin, Staff, and Aesthetician appointment pages). It exposes two
   global functions other page-specific files can call:

     openApptModal(appt)   — pass an appointment object, opens + populates the modal
     closeApptModal()      — closes it

   Depends on formatTime() being defined elsewhere on the page (currently
   in appointments-aesthetician.js). If a future page includes this modal
   without that calendar file, copy formatTime() into its own script too.

   All DOM lookups are guarded — if the modal markup isn't on the page,
   openApptModal()/closeApptModal() simply do nothing instead of throwing.
*/

const STATUS_LABELS = {
    "confirmed": "CONFIRMED",
    "pending": "PENDING",
    "in-progress": "IN PROGRESS",
    "completed": "COMPLETED",
    "cancelled": "CANCELLED",
    no_show: "NO SHOW"
};

const apptModalOverlay = document.getElementById("apptModalOverlay");
const apptModal = document.getElementById("apptModal");
const apptModalTopbar = document.getElementById("apptModalTopbar");
const apptModalClose = document.getElementById("apptModalClose");
const apptModalCancelBtn = document.getElementById("apptModalCancelBtn");
const apptModalRescheduleBtn = document.getElementById("apptModalRescheduleBtn");

function getInitials(name) {
    return name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map(word => word[0].toUpperCase())
        .join("");
}

function formatDateLong(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dateObj = new Date(y, m - 1, d);
    return dateObj.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function normalizeAppt(appt) {
    if (!appt) return {};

    const appointment = { ...appt };
    appointment.id = appointment.id ?? appointment.appointment_id;
    appointment.status = (appointment.status ?? appointment.appointment_status ?? "").replace(/-/g, "_");
    appointment.date = appointment.date ?? appointment.appointment_date;
    appointment.start = appointment.start ?? appointment.appointment_time;
    appointment.end = appointment.end ?? appointment.appointment_end_time;
    appointment.service = appointment.service ?? appointment.service_name;
    const fallbackClientName = [appointment.first_name, appointment.last_name].filter(Boolean).join(" ");
    appointment.client = appointment.client ?? (fallbackClientName || "Client");
    appointment.aesthetician = appointment.aesthetician ?? appointment.aesthetician_name ?? "Aesthetician";
    appointment.fee = appointment.fee ?? appointment.booked_service_price ?? appointment.service_price;
    appointment.depositAmount = appointment.depositAmount ?? appointment.deposit_amount ?? appointment.booked_reservation_fee ?? appointment.reservation_fee;
    appointment.contact = appointment.contact ?? appointment.contact_number ?? "—";
    appointment.remarks = appointment.remarks ?? appointment.notes ?? "No notes yet.";
    appointment.apptNumber = appointment.apptNumber ?? appointment.appt_number ?? appointment.id;
    return appointment;
}

function getDurationLabel(appt) {
    const [startH, startM] = (appt.start || "00:00").split(":").map(Number);
    const [endH, endM] = (appt.end || "00:00").split(":").map(Number);
    const minutes = (endH * 60 + endM) - (startH * 60 + startM);
    if (minutes % 60 === 0) return `${minutes / 60 * 60} minutes`.replace(/^60 minutes$/, "60 minutes");
    return `${minutes} minutes`;
}

function formatPeso(amount) {
    const n = Number(amount);
    if (isNaN(n)) return "—";
    return `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function openApptModal(appt) {
    if (!apptModalOverlay) return; // this page doesn't have the modal markup

    const normalizedAppt = normalizeAppt(appt);

    const statusClass = `status-${normalizedAppt.status.replace(/_/g, "-")}`;
    const statusLabel = STATUS_LABELS[normalizedAppt.status] || (normalizedAppt.status || "UNKNOWN").toUpperCase();

    // Top bar + status badge color reflect the appointment's actual status
    apptModalTopbar.className = `appt-modal-topbar ${statusClass}`;

    const statusBadge = document.getElementById("apptModalStatus");
    statusBadge.className = `appt-status-badge ${statusClass}`;
    statusBadge.textContent = statusLabel;

    document.getElementById("apptModalAvatar").textContent = getInitials(normalizedAppt.client || "Client");
    document.getElementById("apptModalName").textContent = normalizedAppt.client || "Client";
    document.getElementById("apptModalSubtitle").textContent =
        `Appointment #${normalizedAppt.apptNumber || normalizedAppt.id} · ${normalizedAppt.service || "—"}`;

    document.getElementById("apptModalDate").textContent = formatDateLong(normalizedAppt.date);
    document.getElementById("apptModalTime").textContent = `${formatTime(normalizedAppt.start)} – ${formatTime(normalizedAppt.end)}`;

    document.getElementById("apptModalAesthetician").textContent = normalizedAppt.aesthetician || "—";
    document.getElementById("apptModalDuration").textContent = getDurationLabel(normalizedAppt);

    document.getElementById("apptModalService").textContent = normalizedAppt.service || "—";
    document.getElementById("apptModalFee").textContent = normalizedAppt.fee != null ? formatPeso(normalizedAppt.fee) : "—";

    const depositText = normalizedAppt.depositAmount != null
        ? `${normalizedAppt.depositPaid ? "PAID" : "UNPAID"} ${formatPeso(normalizedAppt.depositAmount)}`
        : "—";
    document.getElementById("apptModalDeposit").textContent = depositText;
    document.getElementById("apptModalContact").textContent = normalizedAppt.contact || "—";

    document.getElementById("apptModalRemarks").textContent = normalizedAppt.remarks || "No notes yet.";

    apptModalCancelBtn.dataset.apptId = normalizedAppt.id;
    apptModalRescheduleBtn.dataset.apptId = normalizedAppt.id;

    apptModalOverlay.classList.add("show");
    document.body.style.overflow = "hidden";
}

function closeApptModal() {
    if (!apptModalOverlay) return;
    apptModalOverlay.classList.remove("show");
    document.body.style.overflow = "";
}

if (apptModalOverlay) {
    apptModalClose.addEventListener("click", closeApptModal);

    apptModalOverlay.addEventListener("click", (e) => {
        if (e.target === apptModalOverlay) closeApptModal();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && apptModalOverlay.classList.contains("show")) {
            closeApptModal();
        }
    });

    // Placeholder handlers — wire these up to real cancel/reschedule logic once the backend exists
    apptModalCancelBtn.addEventListener("click", () => {
        console.log("Cancel requested for appointment:", apptModalCancelBtn.dataset.apptId);
        closeApptModal();
    });

    apptModalRescheduleBtn.addEventListener("click", () => {
        console.log("Reschedule requested for appointment:", apptModalRescheduleBtn.dataset.apptId);
        closeApptModal();
    });
}
