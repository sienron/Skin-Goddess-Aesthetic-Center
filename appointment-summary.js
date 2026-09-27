/* ===== Appointment Summary =====
   Redirects to PayMongo Hosted Checkout and confirms only verified payments.
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

  if (!booking || !Number.isSafeInteger(Number(booking.serviceId)) || Number(booking.serviceId) <= 0
    || !/^\d{4}-\d{2}-\d{2}$/.test(booking.date || '')
    || !/^\d{1,2}:\d{2} (AM|PM)$/.test(booking.time || '')) {
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

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.id = 'confirmBookingBtn';
    confirmButton.className = 'confirm-btn';
    confirmButton.textContent = 'PAY RESERVATION FEE WITH PAYMONGO';
    let checkoutReference = null;
    let checkoutState = 'ready';

    async function createCheckoutSession() {
      confirmButton.disabled = true;
      confirmButton.textContent = 'STARTING SECURE CHECKOUT...';
      showMessage('', '');

      try {
        const response = await fetch('/api/appointments/paymongo/checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serviceId: booking.serviceId,
            date: booking.date,
            time: booking.time
          })
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) {
          window.location.href = '/LoginPage.html';
          return;
        }
        if (!response.ok) throw new Error(data.message || 'Could not start PayMongo checkout.');

        setText('summaryFee', formatPeso(data.amount));
        setText('summaryTotal', formatPeso(data.amount));
        showMessage('Redirecting to PayMongo secure checkout...', 'info');
        window.location.assign(data.checkoutUrl);
      } catch (error) {
        showMessage(error.message || 'Could not start PayMongo checkout.', 'error');
        confirmButton.disabled = false;
        confirmButton.textContent = 'PAY RESERVATION FEE WITH PAYMONGO';
      }
    }

    async function verifyAndConfirmPayment(reference, attempts = 15) {
      checkoutReference = reference;
      checkoutState = 'checking';
      confirmButton.disabled = true;
      confirmButton.textContent = 'VERIFYING PAYMENT...';
      showMessage('Waiting for PayMongo to confirm your payment...', 'info');

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          const statusResponse = await fetch(`/api/appointments/paymongo/status/${encodeURIComponent(reference)}`);
          const statusData = await statusResponse.json().catch(() => ({}));
          if (statusResponse.status === 401) {
            window.location.href = '/LoginPage.html';
            return;
          }
          if (!statusResponse.ok) throw new Error(statusData.message || 'Could not check payment status.');

          if (statusData.status === 'failed' || statusData.status === 'expired') {
            checkoutReference = null;
            checkoutState = 'ready';
            showMessage('PayMongo did not complete this payment. You can try checkout again.', 'error');
            confirmButton.disabled = false;
            confirmButton.textContent = 'PAY RESERVATION FEE WITH PAYMONGO';
            return;
          }

          if (statusData.status === 'paid' || statusData.status === 'consumed') {
            const confirmResponse = await fetch('/api/appointments/paymongo/confirm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ referenceNumber: reference })
            });
            const confirmData = await confirmResponse.json().catch(() => ({}));
            if (!confirmResponse.ok) {
              if (confirmData.pending) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
                continue;
              }
              if (confirmResponse.status === 409) {
                checkoutState = 'blocked';
                confirmButton.textContent = 'CONTACT SUPPORT';
                showMessage(confirmData.message || 'Payment was received, but the appointment needs assistance.', 'error');
                return;
              }
              throw new Error(confirmData.message || 'Payment was received, but the appointment could not be confirmed.');
            }

            localStorage.removeItem(BOOKING_STORAGE_KEY);
            checkoutState = 'complete';
            showMessage('Payment verified and appointment created. Redirecting...', 'success');
            setTimeout(() => {
              window.location.href = 'MyAppointments.html';
            }, 1000);
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (error) {
          checkoutState = 'retry';
          showMessage(error.message || 'Could not verify payment.', 'error');
          confirmButton.disabled = false;
          confirmButton.textContent = 'CHECK PAYMENT STATUS';
          return;
        }
      }

      checkoutState = 'retry';
      showMessage('Payment is still processing. Check again in a moment.', 'info');
      confirmButton.disabled = false;
      confirmButton.textContent = 'CHECK PAYMENT STATUS';
    }

    confirmButton.addEventListener('click', async () => {
      if (checkoutState === 'retry' && checkoutReference) {
        await verifyAndConfirmPayment(checkoutReference);
      } else if (checkoutState === 'ready') {
        await createCheckoutSession();
      }
    });

    paymentContainer.append(heading, confirmButton);

    const query = new URLSearchParams(window.location.search);
    const returnedReference = query.get('reference');
    if (query.get('payment') === 'success' && returnedReference) {
      verifyAndConfirmPayment(returnedReference);
    } else if (query.get('payment') === 'cancelled') {
      showMessage('Checkout was cancelled. No appointment has been created.', 'info');
    }
  }

  renderSummary();
  renderConfirmButton();
})();