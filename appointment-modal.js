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
    "in-progress": "IN PROGRESS",
    "completed": "COMPLETED",
    "cancelled": "CANCELLED",
    "no-show": "NO SHOW"
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

function getDurationLabel(appt) {
    const [startH, startM] = appt.start.split(":").map(Number);
    const [endH, endM] = appt.end.split(":").map(Number);
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

    // NOTE: all fields below are populated from placeholder data until the backend is wired up.
    const statusClass = `status-${appt.status}`;
    const statusLabel = STATUS_LABELS[appt.status] || appt.status.toUpperCase();

    // Top bar + status badge color reflect the appointment's actual status
    apptModalTopbar.className = `appt-modal-topbar ${statusClass}`;

    const statusBadge = document.getElementById("apptModalStatus");
    statusBadge.className = `appt-status-badge ${statusClass}`;
    statusBadge.textContent = statusLabel;

    document.getElementById("apptModalAvatar").textContent = getInitials(appt.client);
    document.getElementById("apptModalName").textContent = appt.client;
    document.getElementById("apptModalSubtitle").textContent =
        `Appointment #${appt.apptNumber || appt.id} · ${appt.service || "—"}`;

    document.getElementById("apptModalDate").textContent = formatDateLong(appt.date);
    document.getElementById("apptModalTime").textContent = `${formatTime(appt.start)} – ${formatTime(appt.end)}`;

    document.getElementById("apptModalAesthetician").textContent = appt.aesthetician || "—";
    document.getElementById("apptModalDuration").textContent = getDurationLabel(appt);

    document.getElementById("apptModalService").textContent = appt.service || "—";
    document.getElementById("apptModalFee").textContent = appt.fee != null ? formatPeso(appt.fee) : "—";

    const depositText = appt.depositAmount != null
        ? `${appt.depositPaid ? "PAID" : "UNPAID"} ${formatPeso(appt.depositAmount)}`
        : "—";
    document.getElementById("apptModalDeposit").textContent = depositText;
    document.getElementById("apptModalContact").textContent = appt.contact || "—";

    document.getElementById("apptModalRemarks").textContent = appt.remarks || "No notes yet.";

    apptModalCancelBtn.dataset.apptId = appt.id;
    apptModalRescheduleBtn.dataset.apptId = appt.id;

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
