/* appointment-summary.js
 * Runs on AppointmentSummary.html. Reads the booking that
 * appointment-booking.js saved to localStorage on confirm, renders it,
 * and is where the PayMongo checkout should be wired up.
 *
 * BACKEND / PAYMONGO TODO:
 * - Create a PayMongo Payment Intent / Checkout Session for
 *   booking.reservationFee (or booking.total, depending on what you charge
 *   upfront) inside #paymongoCheckout.
 * - On successful payment, POST the booking to /api/appointments (the call
 *   that used to live in appointment-booking.js's submit handler), then
 *   clear localStorage.removeItem("sg_pending_booking") and redirect to a
 *   confirmation page.
 */
(function () {
    const BOOKING_STORAGE_KEY = "sg_pending_booking";

    const container = document.getElementById("checkoutSummary");
    if (!container) return; // not on the summary page

    const raw = localStorage.getItem(BOOKING_STORAGE_KEY);
    const booking = raw ? JSON.parse(raw) : null;

    if (!booking) {
        // No booking in progress — send the user back to start over.
        window.location.href = "UserAppointment.html";
        return;
    }

    setText("summaryService", booking.service || "—");
    setText("summaryFee", formatPeso(booking.reservationFee));
    setText("summaryDate", booking.date || "Not selected");
    setText("summaryTime", booking.time || "Not selected");
    setText("summaryName", `${booking.firstName} ${booking.lastName}`.trim());
    setText("summaryEmail", booking.email || "—");
    setText("summaryPhone", booking.phone || "—");
    setText("summaryTotal", formatPeso(booking.total));

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function formatPeso(amount) {
        const n = Number(amount) || 0;
        return `₱${n.toLocaleString("en-US")}`;
    }
})();
