function timeToMinutes(value) {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function minutesToTime(value) {
  const normalized = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function calculateAppointmentEtas(appointments) {
  const ordered = [...appointments]
    .map((appointment) => ({
      appointment,
      scheduledStart: timeToMinutes(appointment.appointment_time),
      scheduledEnd: timeToMinutes(appointment.appointment_end_time),
      adjustedEnd: timeToMinutes(appointment.adjusted_expected_end_time)
    }))
    .filter((entry) => entry.scheduledStart !== null)
    .sort((left, right) => left.scheduledStart - right.scheduledStart
      || Number(left.appointment.appointment_id) - Number(right.appointment.appointment_id));

  const estimates = [];
  let precedingEnd = null;
  let precedingSources = [];

  for (const entry of ordered) {
    const { appointment, scheduledStart, scheduledEnd, adjustedEnd } = entry;
    const reservedDuration = Math.max(
      1,
      Number(appointment.booked_duration_minutes || 0)
        + Number(appointment.booked_buffer_minutes || 0)
        || (scheduledEnd === null ? 1 : scheduledEnd - scheduledStart)
    );
    const estimatedStart = Math.max(scheduledStart, precedingEnd ?? scheduledStart);
    const delayMinutes = Math.max(0, estimatedStart - scheduledStart);
    const delayedBy = delayMinutes > 0 ? precedingSources : [];
    const reservedEnd = scheduledEnd ?? scheduledStart + reservedDuration;
    const hasManualExtension = adjustedEnd !== null && adjustedEnd > reservedEnd;
    const estimatedEnd = Math.max(estimatedStart + reservedDuration, adjustedEnd ?? 0);

    estimates.push({
      ...appointment,
      estimated_start_time: minutesToTime(estimatedStart),
      estimated_end_time: minutesToTime(estimatedEnd),
      delay_minutes: delayMinutes,
      source_appointment_ids: [...new Set(delayedBy.map(Number))],
      is_delayed: delayMinutes > 0
    });

    precedingEnd = estimatedEnd;
    precedingSources = [...new Set([
      ...delayedBy,
      ...(hasManualExtension ? [Number(appointment.appointment_id)] : [])
    ])];
  }

  return estimates;
}

module.exports = { calculateAppointmentEtas, timeToMinutes, minutesToTime };
