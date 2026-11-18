function amountCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error('Invalid financial amount in operational report.');
  return Math.round(amount * 100);
}

function appointmentRecords(rows) {
  return rows.map((row) => {
    let balanceStatus = null;
    if (row.appointment_status !== 'cancelled' && row.payment_status !== 'not_recorded' && row.service_price != null) {
      const paid = amountCents(row.amount_paid);
      balanceStatus = paid <= 0 ? 'Unpaid' : paid >= amountCents(row.service_price) ? 'Fully Paid' : 'Partially Paid';
    }
    return {
      ...row,
      source_label: row.booking_source === 'online' ? 'Online reservation' : row.booking_source === 'walk_in' ? 'Walk-in' : 'Unknown',
      balance_status: balanceStatus,
    };
  });
}

function chartRecords(chart, payments, appointments) {
  if (chart === 'collected-services') {
    return payments.filter((row) => row.appointment_id != null && ['reservation', 'balance'].includes(row.category));
  }
  if (chart === 'payment-counts') return payments;
  if (chart === 'appointment-source') return appointments;
  if (chart === 'appointment-payment-status') return appointments.filter((row) => row.balance_status !== null);
  throw new Error('Invalid operational chart.');
}

function grouped(rows, key, amount = false) {
  const totals = new Map();
  rows.forEach((row) => {
    const label = row[key];
    if (label == null || label === '') throw new Error('Missing category in operational report.');
    totals.set(label, (totals.get(label) || 0) + (amount ? amountCents(row.amount) : 1));
  });
  return Array.from(totals, ([label, value]) => ({ label, value: amount ? value / 100 : value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function operationalReport(payments, rows) {
  const appointments = appointmentRecords(rows);
  return {
    revenue_by_service: grouped(chartRecords('collected-services', payments, appointments), 'service', true),
    appointment_source: grouped(appointments, 'source_label'),
    payment_status: grouped(chartRecords('appointment-payment-status', payments, appointments), 'balance_status'),
    payment_methods: grouped(payments, 'method'),
  };
}

module.exports = { appointmentRecords, chartRecords, operationalReport };
