/* ===== Shared Appointment Detail Modal =====
   Include this file on ANY page that has the appointment modal markup
   (Admin, Staff, Aesthetician, and Client appointment pages). It exposes two
   global functions other page-specific files can call:

     openApptModal(appt)   — pass an appointment object, opens + populates the modal
     closeApptModal()      — closes it

   All DOM lookups are guarded — if the modal markup isn't on the page,
   openApptModal()/closeApptModal() simply do nothing instead of throwing.
*/

const STATUS_LABELS = {
    "confirmed": "CONFIRMED",
    "in-progress": "IN PROGRESS",
    "completed": "COMPLETED",
    "cancelled": "CANCELLED",
    no_show: "NO SHOW"
};

function formatTime(time24) {
    if (!time24) return "—";
    const [h, m] = String(time24).split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, "0")}${period}`;
}

const apptModalOverlay = document.getElementById("apptModalOverlay");
const apptModal = document.getElementById("apptModal");
const apptModalTopbar = document.getElementById("apptModalTopbar");
const apptModalClose = document.getElementById("apptModalClose");
const apptModalCancelBtn = document.getElementById("apptModalCancelBtn");
const apptModalRescheduleBtn = document.getElementById("apptModalRescheduleBtn");
const apptModalFinishBtn = document.getElementById("apptModalFinishBtn");
const apptModalNoShowBtn = document.getElementById("apptModalNoShowBtn");
const apptRescheduleForm = document.getElementById("apptRescheduleForm");
const apptCancellationForm = document.getElementById("apptCancellationForm");
const apptActionMessage = document.getElementById("apptActionMessage");

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
    appointment.depositPaid = appointment.depositPaid ?? (appointment.payment_status === "paid");
    appointment.contact = appointment.contact ?? appointment.contact_number ?? "—";
    appointment.remarks = appointment.remarks ?? appointment.notes ?? "No notes yet.";
    appointment.cancellationRequestStatus = appointment.cancellationRequestStatus ?? appointment.cancellation_request_status;
    appointment.rescheduleRequestStatus = appointment.rescheduleRequestStatus ?? appointment.reschedule_request_status;
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

async function readApiResponse(response) {
    const bodyText = await response.text();
    try {
        return bodyText ? JSON.parse(bodyText) : {};
    } catch (_) {
        return { message: response.ok ? "The server returned an invalid response." : `Request failed (${response.status}). Please sign in again.` };
    }
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

    const canManageAppointment = normalizedAppt.status === "confirmed";
    const manilaToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

    if (apptModalCancelBtn) {
        apptModalCancelBtn.dataset.apptId = normalizedAppt.id;
        apptModalCancelBtn.disabled = !canManageAppointment || Boolean(normalizedAppt.cancellationRequestStatus);
    }
    if (apptModalRescheduleBtn) {
        apptModalRescheduleBtn.dataset.apptId = normalizedAppt.id;
        apptModalRescheduleBtn.disabled = !canManageAppointment || Boolean(normalizedAppt.rescheduleRequestStatus);
    }
    if (apptModalFinishBtn) {
        apptModalFinishBtn.dataset.apptId = normalizedAppt.id;
        apptModalFinishBtn.disabled = !canManageAppointment || normalizedAppt.date !== manilaToday;
    }
    if (apptModalNoShowBtn) {
        apptModalNoShowBtn.dataset.apptId = normalizedAppt.id;
        apptModalNoShowBtn.disabled = !canManageAppointment || normalizedAppt.date !== manilaToday;
    }

    if (apptRescheduleForm) {
        apptRescheduleForm.hidden = true;
        if (apptRescheduleForm.elements.date) {
            apptRescheduleForm.elements.date.value = normalizedAppt.date || "";
            apptRescheduleForm.elements.date.min = manilaToday;
        }
        if (apptRescheduleForm.elements.time) {
            apptRescheduleForm.elements.time.value = (normalizedAppt.start || "").slice(0, 5);
        }
        if (apptRescheduleForm.elements.reason) apptRescheduleForm.elements.reason.value = "";
        if (apptRescheduleForm.elements.description) apptRescheduleForm.elements.description.value = "";
    }
    if (apptCancellationForm) {
        apptCancellationForm.hidden = true;
        apptCancellationForm.reset();
    }
    if (apptActionMessage) {
        if (normalizedAppt.cancellationRequestStatus === "pending") {
            apptActionMessage.textContent = "A cancellation request is pending admin review.";
        } else if (normalizedAppt.rescheduleRequestStatus === "pending") {
            apptActionMessage.textContent = "A reschedule request is pending admin review.";
        } else {
            apptActionMessage.textContent = "";
        }
    }

    apptModalOverlay.classList.add("show");
    document.body.style.overflow = "hidden";
}

function closeApptModal() {
    if (!apptModalOverlay) return;
    apptModalOverlay.classList.remove("show");
    document.body.style.overflow = "";
}

window.openApptModal = openApptModal;
window.closeApptModal = closeApptModal;

if (apptModalOverlay) {
    apptModalClose?.addEventListener("click", closeApptModal);

    apptModalOverlay.addEventListener("click", (e) => {
        if (e.target === apptModalOverlay) closeApptModal();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && apptModalOverlay.classList.contains("show")) {
            closeApptModal();
        }
    });

    apptModalCancelBtn?.addEventListener("click", () => {
        if (!apptCancellationForm) return;
        apptCancellationForm.hidden = !apptCancellationForm.hidden;
        if (apptRescheduleForm) apptRescheduleForm.hidden = true;
        if (apptActionMessage) apptActionMessage.textContent = "";
    });

    apptCancellationForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitButton = apptCancellationForm.querySelector("[type=submit]");
        submitButton.disabled = true;
        if (apptActionMessage) apptActionMessage.textContent = "Sending cancellation request...";
        try {
            const response = await fetch(`/api/appointments/${apptModalCancelBtn.dataset.apptId}/cancellation-request`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    reason: apptCancellationForm.elements.reason.value,
                    description: apptCancellationForm.elements.description.value,
                }),
            });
            const data = await readApiResponse(response);
            if (!response.ok) throw new Error(data.message || "Could not send cancellation request.");
            closeApptModal();
            if (typeof refreshAestheticianAppointments === "function") await refreshAestheticianAppointments();
            if (typeof refreshClientAppointments === "function") await refreshClientAppointments();
            window.dispatchEvent(new CustomEvent("appointmentUpdated", { detail: { id: apptModalCancelBtn.dataset.apptId } }));
        } catch (error) {
            if (apptActionMessage) apptActionMessage.textContent = error.message;
            submitButton.disabled = false;
        }
    });

    apptModalFinishBtn?.addEventListener("click", async () => {
        apptModalFinishBtn.disabled = true;
        if (apptActionMessage) apptActionMessage.textContent = "Finishing appointment...";
        try {
            const response = await fetch(`/api/appointments/${apptModalFinishBtn.dataset.apptId}/finish`, { method: "POST" });
            const data = await readApiResponse(response);
            if (!response.ok) throw new Error(data.message || "Could not finish appointment.");
            closeApptModal();
            if (typeof refreshAestheticianAppointments === "function") await refreshAestheticianAppointments();
            if (typeof refreshClientAppointments === "function") await refreshClientAppointments();
            window.dispatchEvent(new CustomEvent("appointmentUpdated", { detail: { id: apptModalFinishBtn.dataset.apptId } }));
        } catch (error) {
            if (apptActionMessage) apptActionMessage.textContent = error.message;
            apptModalFinishBtn.disabled = false;
        }
    });

    apptModalNoShowBtn?.addEventListener("click", async () => {
        if (!window.confirm("Mark this client as no show?")) return;
        apptModalNoShowBtn.disabled = true;
        if (apptActionMessage) apptActionMessage.textContent = "Marking appointment as no show...";
        try {
            const response = await fetch(`/api/appointments/${apptModalNoShowBtn.dataset.apptId}/no-show`, { method: "POST" });
            const data = await readApiResponse(response);
            if (!response.ok) throw new Error(data.message || "Could not mark appointment as no show.");
            closeApptModal();
            if (typeof refreshAestheticianAppointments === "function") await refreshAestheticianAppointments();
            if (typeof refreshClientAppointments === "function") await refreshClientAppointments();
            window.dispatchEvent(new CustomEvent("appointmentUpdated", { detail: { id: apptModalNoShowBtn.dataset.apptId } }));
        } catch (error) {
            if (apptActionMessage) apptActionMessage.textContent = error.message;
            apptModalNoShowBtn.disabled = false;
        }
    });

    apptModalRescheduleBtn?.addEventListener("click", () => {
        if (!apptRescheduleForm) return;
        apptRescheduleForm.hidden = !apptRescheduleForm.hidden;
        if (apptCancellationForm) apptCancellationForm.hidden = true;
        if (apptActionMessage) apptActionMessage.textContent = "";
    });

    apptRescheduleForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitButton = apptRescheduleForm.querySelector("[type=submit]");
        submitButton.disabled = true;
        if (apptActionMessage) apptActionMessage.textContent = "Updating appointment...";
        try {
            const response = await fetch(`/api/appointments/${apptModalRescheduleBtn.dataset.apptId}/reschedule`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    date: apptRescheduleForm.elements.date.value,
                    time: apptRescheduleForm.elements.time.value,
                    reason: apptRescheduleForm.elements.reason?.value || "",
                    description: apptRescheduleForm.elements.description?.value || ""
                })
            });
            const data = await readApiResponse(response);
            if (!response.ok) throw new Error(data.message || "Could not reschedule appointment.");
            closeApptModal();
            if (typeof refreshAestheticianAppointments === "function") await refreshAestheticianAppointments();
            if (typeof refreshClientAppointments === "function") await refreshClientAppointments();
            window.dispatchEvent(new CustomEvent("appointmentUpdated", { detail: { id: apptModalRescheduleBtn.dataset.apptId } }));
        } catch (error) {
            if (apptActionMessage) apptActionMessage.textContent = error.message;
            submitButton.disabled = false;
        }
    });
}
