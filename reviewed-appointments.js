document.addEventListener('DOMContentLoaded', () => {
    const list = document.getElementById('reviewedAppointmentsList');
    const message = document.getElementById('reviewedAppointmentsMessage');
    const refreshButton = document.getElementById('refreshReviewedAppointments');
    if (!list || !message || !refreshButton) return;

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function formatReviewedAt(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Review date unavailable';
        return new Intl.DateTimeFormat('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'Asia/Manila'
        }).format(date);
    }

    function renderAppointments(appointments) {
        list.replaceChildren();
        if (!appointments.length) {
            list.appendChild(el('p', 'appointment-review-queue__empty', 'No appointments have reviewed products yet.'));
            return;
        }

        const table = el('div', 'appointment-review-queue__table');
        appointments.forEach((appointment) => {
            const row = el('article', 'appointment-review-queue__row reviewed-appointment-row');
            const info = el('div', 'appointment-review-queue__info');
            const time = String(appointment.start || '').slice(0, 5);
            info.append(
                el('strong', 'appointment-review-queue__client', appointment.client || 'Client'),
                el('span', 'appointment-review-queue__service', appointment.service || 'Service unavailable'),
                el('span', '', `${appointment.date || 'Date unavailable'} · ${time || 'Time unavailable'} · ${appointment.assigned_to || 'Unassigned'}`)
            );

            const status = el('span', 'appointment-review-status is-confirmed', 'Products Reviewed');
            const reviewDetails = el('div', 'reviewed-appointment-row__details');
            reviewDetails.appendChild(el(
                'span',
                'reviewed-appointment-row__reviewer',
                `Reviewed by ${appointment.reviewer_name || 'Staff'} · ${formatReviewedAt(appointment.reviewed_at)}`
            ));
            if (appointment.status === 'in_progress') {
                const viewReview = el('button', 'btn btn-export', 'View / Edit Review');
                viewReview.type = 'button';
                viewReview.addEventListener('click', () => {
                    window.location.href = `InventoryManagement.html?reviewAppointmentId=${encodeURIComponent(appointment.appointment_id)}`;
                });
                reviewDetails.appendChild(viewReview);
            }
            row.append(info, status, reviewDetails);
            table.appendChild(row);
        });
        list.appendChild(table);
    }

    async function loadReviewedAppointments() {
        refreshButton.disabled = true;
        message.textContent = 'Loading reviewed appointments…';
        message.classList.remove('is-error');
        try {
            const response = await fetch('/api/appointments/inventory-officer/reviews/reviewed', {
                headers: { Accept: 'application/json' },
                cache: 'no-store'
            });
            const text = await response.text();
            let result;
            try {
                result = text ? JSON.parse(text) : [];
            } catch {
                throw new Error(`Could not load reviewed appointments (HTTP ${response.status}).`);
            }
            if (!response.ok) {
                throw new Error(result.message || `Could not load reviewed appointments (HTTP ${response.status}).`);
            }
            if (!Array.isArray(result)) {
                throw new Error('The reviewed appointments response was invalid.');
            }

            renderAppointments(result);
            message.textContent = `${result.length} reviewed appointment${result.length === 1 ? '' : 's'}`;
        } catch (error) {
            list.replaceChildren();
            message.textContent = error.message || 'Could not load reviewed appointments.';
            message.classList.add('is-error');
        } finally {
            refreshButton.disabled = false;
        }
    }

    refreshButton.addEventListener('click', loadReviewedAppointments);
    loadReviewedAppointments();
});
