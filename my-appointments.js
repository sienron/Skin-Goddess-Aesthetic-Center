/* Client-owned appointment history. The server remains the authorization authority. */
(function () {
  const upcoming = document.getElementById('upcomingAppointments');
  const past = document.getElementById('pastAppointments');
  const message = document.getElementById('appointmentsMessage');
  if (!upcoming || !past || !message) return;

  function manilaNow() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
  }

  function isUpcoming(appointment) {
    const now = manilaNow();
    return appointment.appointment_status !== 'cancelled' && (appointment.appointment_date > now.date || (appointment.appointment_date === now.date && appointment.appointment_time.slice(0, 5) >= now.time));
  }

  function emptyState(container, text) {
    const item = document.createElement('p');
    item.className = 'appointments-empty';
    item.textContent = text;
    container.appendChild(item);
  }

  function appointmentCard(appointment) {
    const card = document.createElement('article');
    card.className = 'appointment-card';
    const title = document.createElement('h3');
    title.textContent = appointment.service_name;
    const details = document.createElement('p');
    details.textContent = `${appointment.appointment_date} · ${appointment.appointment_time.slice(0, 5)}–${appointment.appointment_end_time.slice(0, 5)}`;
    const status = document.createElement('p');
    status.className = 'appointment-status';
    const statusLabel = String(appointment.appointment_status || '').replace(/_/g, ' ').toUpperCase();
    status.textContent = `${statusLabel} · ${appointment.payment_status}`;
    const fee = document.createElement('p');
    fee.className = 'appointment-fee';
    fee.textContent = `Reservation fee: ₱${Number(appointment.booked_reservation_fee).toLocaleString('en-US')}`;
    card.append(title, details, status, fee);

    if (['pending', 'confirmed'].includes(appointment.appointment_status)) {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'appointment-cancel-btn';
      cancel.textContent = 'Cancel appointment';
      cancel.addEventListener('click', async () => {
        if (!window.confirm('Cancel this appointment? This cannot be undone.')) return;
        cancel.disabled = true;
        try {
          const response = await fetch(`/api/appointments/${appointment.appointment_id}/cancel`, { method: 'POST' });
          const data = await response.json();
          if (!response.ok) throw new Error(data.message || 'Could not cancel appointment.');
          message.textContent = data.message;
          loadAppointments();
        } catch (error) {
          message.textContent = error.message;
          cancel.disabled = false;
        }
      });
      card.appendChild(cancel);
    }
    return card;
  }

  function render(container, appointments, emptyText) {
    container.replaceChildren();
    if (appointments.length === 0) return emptyState(container, emptyText);
    appointments.forEach((appointment) => container.appendChild(appointmentCard(appointment)));
  }

  async function loadAppointments() {
    message.textContent = '';
    try {
      const response = await fetch('/api/appointments/mine');
      if (!response.ok) throw new Error('Could not load your appointments.');
      const appointments = await response.json();
      render(upcoming, appointments.filter(isUpcoming), 'No upcoming appointments.');
      render(past, appointments.filter((appointment) => !isUpcoming(appointment)), 'No past appointments yet.');
    } catch (error) {
      message.textContent = error.message;
    }
  }

  loadAppointments();
})();
