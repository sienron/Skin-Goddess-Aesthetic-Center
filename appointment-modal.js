/* ===== Shared Appointment Detail Modal =====
   Include this file on ANY page that has the appointment modal markup
   (Admin, Staff, Aesthetician, and Client appointment pages). It exposes two
   global functions other page-specific files can call:

     openApptModal(appt)   — pass an appointment object, opens + populates the modal
     closeApptModal()      — closes it

   All DOM lookups are guarded — if the modal markup isn't on the page,
   openApptModal()/closeApptModal() simply do nothing instead of throwing.
*/

const APPT_MODAL_STATUS_LABELS = {
    "confirmed": "CONFIRMED",
    "in-progress": "IN PROGRESS",
    "completed": "COMPLETED",
    "cancelled": "CANCELLED",
    no_show: "NO SHOW"
};

function formatApptModalTime(time24) {
    if (!time24) return "—";
    const [h, m] = String(time24).split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, "0")}${period}`;
}

function getApptManilaDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
}

const apptModalOverlay = document.getElementById("apptModalOverlay");
const apptModal = document.getElementById("apptModal");
const apptModalTopbar = document.getElementById("apptModalTopbar");
const apptModalClose = document.getElementById("apptModalClose");
const apptModalCancelBtn = document.getElementById("apptModalCancelBtn");
const apptModalRescheduleBtn = document.getElementById("apptModalRescheduleBtn");
const apptModalFinishBtn = document.getElementById("apptModalFinishBtn");
const apptModalClientInfoBtn = document.getElementById("apptModalClientInfoBtn");
const apptRescheduleForm = document.getElementById("apptRescheduleForm");
const apptCancellationForm = document.getElementById("apptCancellationForm");
const apptActionMessage = document.getElementById("apptActionMessage");
const apptRequestStatus = document.getElementById("apptRequestStatus") || apptActionMessage;
const apptRequestDialog = document.getElementById("apptRequestDialog");
const apptRequestTitle = document.getElementById("apptRequestTitle");
const apptRequestClose = document.getElementById("apptRequestClose");
const apptRescheduleMonth = document.getElementById("apptRescheduleMonth");
const apptRescheduleDate = document.getElementById("apptRescheduleDate");
const apptRescheduleTime = apptRescheduleForm?.elements.time;
let activeAppointment = null;
let availabilityByDate = new Map();
let availabilityRequestSequence = 0;

apptModalClientInfoBtn?.addEventListener("click", () => {
    if (!activeAppointment?.id) return;
    window.location.href = `StaffUserManagement.html?appointmentId=${encodeURIComponent(activeAppointment.id)}`;
});

function createAvailabilityOption(label, value) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
}

function resetRescheduleAvailability() {
    availabilityByDate = new Map();
    if (apptRescheduleDate) {
        apptRescheduleDate.replaceChildren(createAvailabilityOption("Select an available date", ""));
        apptRescheduleDate.disabled = true;
    }
    if (apptRescheduleTime) {
        apptRescheduleTime.replaceChildren(createAvailabilityOption("Select a date first", ""));
        apptRescheduleTime.disabled = true;
    }
    const submitButton = apptRescheduleForm?.querySelector("[type=submit]");
    if (submitButton) submitButton.disabled = true;
}

function normalizeAvailabilityDate(key) {
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(key));
    if (!match) return null;
    const year = Number(match[1]);
    const monthIndex = Number(match[2]);
    const day = Number(match[3]);
    if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
    const date = new Date(year, monthIndex, day);
    if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) return null;
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeAvailabilityTime(value) {
    const time = String(value).trim();
    let match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time);
    if (match) {
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        if (hour < 0 || hour > 23 || minute > 59) return null;
        return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
    match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    if (match[3].toUpperCase() === "PM" && hour !== 12) hour += 12;
    if (match[3].toUpperCase() === "AM" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatAvailabilityDate(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric"
    }).format(new Date(year, month - 1, day));
}

function formatAvailabilityTime(value) {
    const [hour, minute] = value.split(":").map(Number);
    return new Date(2000, 0, 1, hour, minute).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit"
    });
}

function populateRescheduleTimes() {
    const selectedDate = apptRescheduleDate?.value || "";
    const availableTimes = availabilityByDate.get(selectedDate) || [];
    if (!apptRescheduleTime) return;
    apptRescheduleTime.replaceChildren(createAvailabilityOption("Select an available time", ""));
    availableTimes.forEach((time) => {
        apptRescheduleTime.add(createAvailabilityOption(formatAvailabilityTime(time), time));
    });
    apptRescheduleTime.disabled = availableTimes.length === 0;
    const submitButton = apptRescheduleForm?.querySelector("[type=submit]");
    if (submitButton) submitButton.disabled = availableTimes.length === 0;
}

async function loadRescheduleAvailability() {
    const requestSequence = ++availabilityRequestSequence;
    const month = apptRescheduleMonth?.value || "";
    const serviceId = activeAppointment?.serviceId
        || activeAppointment?.service_id
        || activeAppointment?.service?.id;
    resetRescheduleAvailability();
    if (!month || !serviceId || !activeAppointment?.id) {
        if (apptActionMessage) {
            apptActionMessage.textContent = !month
                ? "Choose a month to view available dates."
                : "This appointment is missing scheduling information. Please contact an administrator.";
        }
        return;
    }

    const appointmentId = activeAppointment.id;
    if (apptActionMessage) apptActionMessage.textContent = "Loading available dates...";
    try {
        const params = new URLSearchParams({
            month,
            serviceId: String(serviceId),
            appointmentId: String(activeAppointment.id)
        });
        const response = await fetch(`/api/availability?${params.toString()}`);
        const data = await readApiResponse(response);
        if (!response.ok) throw new Error(data.message || "Could not load available dates.");
        if (requestSequence !== availabilityRequestSequence
            || activeAppointment?.id !== appointmentId
            || apptRescheduleMonth?.value !== month) return;

        const dates = Object.entries(data || {})
            .map(([key, slots]) => ({ date: normalizeAvailabilityDate(key), slots }))
            .filter((entry) => entry.date && entry.date.startsWith(`${month}-`) && Array.isArray(entry.slots))
            .map((entry) => ({
                date: entry.date,
                times: [...new Set(entry.slots.map(normalizeAvailabilityTime).filter(Boolean))]
            }))
            .filter((entry) => entry.times.length > 0)
            .sort((left, right) => left.date.localeCompare(right.date));

        dates.forEach(({ date, times }) => {
            availabilityByDate.set(date, times);
            apptRescheduleDate.add(createAvailabilityOption(formatAvailabilityDate(date), date));
        });
        apptRescheduleDate.disabled = dates.length === 0;
        if (apptActionMessage) {
            apptActionMessage.textContent = dates.length
                ? "Choose from the available dates and times below."
                : "No available dates for this service in the selected month.";
        }
    } catch (error) {
        if (requestSequence !== availabilityRequestSequence) return;
        if (apptActionMessage) apptActionMessage.textContent = error.message;
    }
}

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
    appointment.treatmentEnd = appointment.treatmentEnd ?? appointment.treatment_end_time ?? appointment.appointment_end_time ?? appointment.end;
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
    appointment.clinicPendingResolution = appointment.clinicPendingResolution ?? appointment.clinic_pending_resolution ?? false;
    appointment.apptNumber = appointment.apptNumber ?? appointment.appt_number ?? appointment.id;
    return appointment;
}

function getDurationLabel(appt) {
    if (appt.duration_is_estimated) return "Historical duration unavailable";
    if (Number.isSafeInteger(Number(appt.duration_minutes)) && Number(appt.duration_minutes) > 0) {
        return `${Number(appt.duration_minutes)} minutes`;
    }
    const [startH, startM] = (appt.start || "00:00").split(":").map(Number);
    const [endH, endM] = (appt.treatmentEnd || appt.end || "00:00").split(":").map(Number);
    const minutes = (endH * 60 + endM) - (startH * 60 + startM);
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
    const today = getApptManilaDateKey();
    activeAppointment = normalizedAppt;
    availabilityRequestSequence += 1;
    resetRescheduleAvailability();
    if (apptRescheduleMonth) apptRescheduleMonth.value = "";

    const statusClass = `status-${normalizedAppt.status.replace(/_/g, "-")}`;
    const statusLabel = APPT_MODAL_STATUS_LABELS[normalizedAppt.status] || (normalizedAppt.status || "UNKNOWN").toUpperCase();

    // Top bar + status badge color reflect the appointment's actual status
    apptModalTopbar.className = `appt-modal-topbar ${statusClass}`;

    const statusBadge = document.getElementById("apptModalStatus");
    statusBadge.className = `appt-status-badge ${statusClass}`;
    statusBadge.textContent = statusLabel;

    document.getElementById("apptModalAvatar").textContent = getInitials(normalizedAppt.client || "Client");
    document.getElementById("apptModalName").textContent = normalizedAppt.client || "Client";
    document.getElementById("apptModalSubtitle").textContent =
        `${normalizedAppt.service || "—"}${normalizedAppt.is_demo ? " · Survey sample — not a real booking" : ""}`;

    document.getElementById("apptModalDate").textContent = formatDateLong(normalizedAppt.date);
    document.getElementById("apptModalTime").textContent = `${formatApptModalTime(normalizedAppt.start)} – ${formatApptModalTime(normalizedAppt.treatmentEnd)}`;

    document.getElementById("apptModalAesthetician").textContent = normalizedAppt.aesthetician || "—";
    document.getElementById("apptModalDuration").textContent = getDurationLabel(normalizedAppt);

    document.getElementById("apptModalService").textContent = normalizedAppt.service || "—";
    document.getElementById("apptModalFee").textContent = normalizedAppt.fee != null ? formatPeso(normalizedAppt.fee) : "—";

    const depositText = normalizedAppt.depositAmount != null
        ? `${normalizedAppt.depositPaid ? "PAID" : "UNPAID"} ${formatPeso(normalizedAppt.depositAmount)}`
        : "—";
    document.getElementById("apptModalDeposit").textContent = depositText;
    document.getElementById("apptModalContact").textContent = normalizedAppt.contact || "—";

    const canManageAppointment = normalizedAppt.status === "confirmed" && normalizedAppt.is_demo !== true;

    if (apptModalCancelBtn) {
        apptModalCancelBtn.dataset.apptId = normalizedAppt.id;
        const cancellationPending = normalizedAppt.cancellationRequestStatus === "pending";
        apptModalCancelBtn.disabled = !canManageAppointment
            || (document.body?.dataset?.page === "account" ? cancellationPending : Boolean(normalizedAppt.cancellationRequestStatus));
    }
    if (apptModalRescheduleBtn) {
        apptModalRescheduleBtn.dataset.apptId = normalizedAppt.id;
        apptModalRescheduleBtn.disabled = !canManageAppointment || Boolean(normalizedAppt.rescheduleRequestStatus);
    }
    if (apptModalFinishBtn) {
        apptModalFinishBtn.dataset.apptId = normalizedAppt.id;
        apptModalFinishBtn.disabled = normalizedAppt.clinicPendingResolution || !canManageAppointment || normalizedAppt.date !== today;
        apptModalFinishBtn.textContent = "Start Service";
    }

    if (apptRescheduleForm) {
        apptRescheduleForm.hidden = true;
        if (apptRescheduleForm.elements.date) {
            apptRescheduleForm.elements.date.value = normalizedAppt.date || "";
            apptRescheduleForm.elements.date.min = today;
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
        const submitButton = apptCancellationForm.querySelector("[type=submit]");
        if (submitButton) submitButton.disabled = false;
    }
    if (apptRequestStatus) {
        const requestStatusMessage = (type, status) => {
            if (status === "pending") return `A ${type} request is pending admin review.`;
            if (status === "rejected") return `The ${type} request was rejected by an administrator.`;
            if (status === "approved") return `The ${type} request was approved by an administrator.`;
            return "";
        };
        const messages = [
            normalizedAppt.clinicPendingResolution
                ? "Pending Resolution: clinic schedule changed. Staff will coordinate rescheduling or cancellation."
                : "",
            requestStatusMessage("cancellation", normalizedAppt.cancellationRequestStatus),
            requestStatusMessage("reschedule", normalizedAppt.rescheduleRequestStatus)
        ].filter(Boolean);
        apptRequestStatus.textContent = messages.join(" ");
    }

    apptModalOverlay.classList.add("show");
    document.body.style.overflow = "hidden";
}

function closeApptModal() {
    if (!apptModalOverlay) return;
    if (apptRequestDialog?.open) apptRequestDialog.close();
    availabilityRequestSequence += 1;
    apptModalOverlay.classList.remove("show");
    document.body.style.overflow = "";
}

window.openApptModal = openApptModal;
window.closeApptModal = closeApptModal;

if (apptModalOverlay) {
    apptModalClose?.addEventListener("click", closeApptModal);
    apptRequestClose?.addEventListener("click", () => apptRequestDialog.close());
    apptRequestDialog?.addEventListener("close", () => {
        if (!apptRequestDialog.open) availabilityRequestSequence += 1;
    });

    apptModalOverlay.addEventListener("click", (e) => {
        if (e.target === apptModalOverlay) closeApptModal();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !apptRequestDialog?.open && apptModalOverlay.classList.contains("show")) {
            closeApptModal();
        }
    });

    apptModalCancelBtn?.addEventListener("click", () => {
        if (document.body?.dataset?.page === "account") {
            void cancelClientAppointment();
            return;
        }
        if (!apptCancellationForm) return;
        apptCancellationForm.hidden = apptRequestDialog ? false : !apptCancellationForm.hidden;
        if (apptRescheduleForm) apptRescheduleForm.hidden = true;
        if (apptActionMessage) apptActionMessage.textContent = "";
        if (apptRequestDialog) {
            apptRequestTitle.textContent = "Request cancellation";
            apptRequestDialog.showModal();
            apptCancellationForm.elements.reason?.focus();
        }
    });

    async function cancelClientAppointment() {
        const appointmentId = apptModalCancelBtn?.dataset.apptId;
        if (!appointmentId || apptModalCancelBtn.disabled) return;
        apptModalCancelBtn.disabled = true;
        if (apptActionMessage) apptActionMessage.textContent = "Cancelling appointment...";
        try {
            const response = await fetch(`/api/appointments/${appointmentId}/cancel-mine`, { method: "POST" });
            const data = await readApiResponse(response);
            if (!response.ok) throw new Error(data.message || "Could not cancel appointment.");
            closeApptModal();
            if (typeof refreshClientAppointments === "function") await refreshClientAppointments();
            window.dispatchEvent(new CustomEvent("appointmentUpdated", { detail: { id: appointmentId } }));
        } catch (error) {
            if (apptActionMessage) apptActionMessage.textContent = error.message;
            apptModalCancelBtn.disabled = false;
        }
    }

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
                    description: apptCancellationForm.elements.description?.value || "",
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
        if (apptActionMessage) apptActionMessage.textContent = "Starting appointment...";
        try {
            const response = await fetch(`/api/appointments/${apptModalFinishBtn.dataset.apptId}/start`, { method: "POST" });
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

    apptModalRescheduleBtn?.addEventListener("click", () => {
        if (!apptRescheduleForm) return;
        apptRescheduleForm.hidden = apptRequestDialog ? false : !apptRescheduleForm.hidden;
        if (apptCancellationForm) apptCancellationForm.hidden = true;
        if (apptActionMessage) apptActionMessage.textContent = "";
        if (apptRequestDialog) {
            apptRequestTitle.textContent = "Request reschedule";
            apptRequestDialog.showModal();
            apptRescheduleMonth?.focus();
        }
        if (apptRescheduleForm.hidden) {
            availabilityRequestSequence += 1;
            resetRescheduleAvailability();
        } else {
            const currentMonth = getApptManilaDateKey().slice(0, 7);
            if (apptRescheduleMonth) {
                apptRescheduleMonth.min = currentMonth;
                apptRescheduleMonth.value = currentMonth;
            }
            void loadRescheduleAvailability();
        }
    });

    apptRescheduleMonth?.addEventListener("change", () => {
        void loadRescheduleAvailability();
    });

    apptRescheduleDate?.addEventListener("change", populateRescheduleTimes);

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
