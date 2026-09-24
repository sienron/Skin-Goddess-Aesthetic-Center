/* ===== Appointment Summary =====
   Creates the appointment after the user confirms the booking.
*/
(function () {
  const BOOKING_STORAGE_KEY = 'sg_pending_booking';
  const summaryContainer = document.getElementById('checkoutSummary');
  const paymentContainer = document.getElementById('paymongoCheckout');

  if (!summaryContainer || !paymentContainer) {
    return;
  }

  let booking;

  try {
    const rawBooking = localStorage.getItem(BOOKING_STORAGE_KEY);
    booking = rawBooking ? JSON.parse(rawBooking) : null;
  } catch (error) {
    booking = null;
  }

  if (!booking) {
    window.location.href = 'UserAppointment.html';
    return;
  }

  function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
      element.textContent = value || '—';
    }
  }

  function formatPeso(amount) {
    const number = Number(amount) || 0;
    return `₱${number.toLocaleString('en-US')}`;
  }

  function showMessage(message, type) {
    let messageElement = document.getElementById('checkoutMessage');

    if (!messageElement) {
      messageElement = document.createElement('p');
      messageElement.id = 'checkoutMessage';
      messageElement.className = 'booking-status-message';
      paymentContainer.after(messageElement);
    }

    messageElement.textContent = message;
    messageElement.className = `booking-status-message ${type}`;
  }

  function renderSummary() {
    setText('summaryService', booking.service);
    setText('summaryFee', formatPeso(booking.reservationFee));
    setText('summaryDate', booking.date);
    setText('summaryTime', booking.time);
    setText(
      'summaryName',
      `${booking.firstName || ''} ${booking.lastName || ''}`.trim()
    );
    setText('summaryEmail', booking.email);
    setText('summaryPhone', booking.phone);
    setText('summaryTotal', formatPeso(booking.total));
  }

  function renderConfirmButton() {
    paymentContainer.innerHTML = '';

    const heading = document.createElement('p');
    heading.className = 'checkout-section-title';
    heading.textContent = 'CONFIRM APPOINTMENT';

    const description = document.createElement('p');
    description.textContent =
      'Click the button below to reserve this appointment.';

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.id = 'confirmBookingBtn';
    confirmButton.className = 'confirm-btn';
    confirmButton.textContent = 'CONFIRM APPOINTMENT';

    confirmButton.addEventListener('click', async () => {
      confirmButton.disabled = true;
      confirmButton.textContent = 'CREATING APPOINTMENT...';

      showMessage('', '');

      try {
        const response = await fetch('/api/appointments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            serviceId: booking.serviceId,
            date: booking.date,
            time: booking.time
          })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data.message || 'Could not create your appointment.'
          );
        }

        localStorage.removeItem(BOOKING_STORAGE_KEY);

        showMessage(
          'Appointment created successfully. Redirecting...',
          'success'
        );

        setTimeout(() => {
          window.location.href = 'MyAppointments.html';
        }, 1000);
      } catch (error) {
        showMessage(
          error.message || 'Could not create your appointment.',
          'error'
        );

        confirmButton.disabled = false;
        confirmButton.textContent = 'CONFIRM APPOINTMENT';
      }
    });

    paymentContainer.append(heading, description, confirmButton);
  }

  renderSummary();
  renderConfirmButton();
})();