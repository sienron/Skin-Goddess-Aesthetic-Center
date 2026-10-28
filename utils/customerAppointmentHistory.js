const CUSTOMER_APPOINTMENTS_QUERY = `
  SELECT a.appointment_id,
         a.is_demo,
         a.appointment_date::text AS date,
         a.appointment_time::text AS start,
         a.appointment_end_time::text AS end,
         a.appointment_status AS status,
         a.payment_status,
         s.service_name AS service,
         a.booked_service_price AS fee,
         a.booked_reservation_fee AS deposit_amount,
         a.cancellation_request_status,
         a.cancellation_reason,
         a.cancellation_description,
         a.reschedule_request_status,
         a.reschedule_requested_date::text AS reschedule_requested_date,
         a.reschedule_requested_time::text AS reschedule_requested_time,
         a.reschedule_reason,
         a.reschedule_description,
         COALESCE(CONCAT(c.first_name, ' ', c.last_name), 'Client') AS client,
         COALESCE(NULLIF(CONCAT(aesthetician.first_name, ' ', aesthetician.last_name), ' '),
           CASE WHEN a.is_demo THEN 'Demo Aesthetician' ELSE 'Aesthetician' END) AS aesthetician,
         c.contact_number AS contact,
         NULL::text AS remarks,
         a.appointment_id AS apptNumber,
         ar.rating AS my_rating,
         ar.comment AS my_rating_comment
  FROM appointments a
  JOIN services s ON s.service_id = a.service_id
  JOIN users c ON c.user_id = a.user_id
  LEFT JOIN users aesthetician ON aesthetician.user_id = a.aesthetician_id
  LEFT JOIN appointment_ratings ar ON ar.appointment_id = a.appointment_id
  WHERE a.user_id = $1
  ORDER BY a.appointment_date ASC, a.appointment_time ASC
`;

function loadCustomerAppointmentHistory(database, authenticatedUserId) {
  return database.query(CUSTOMER_APPOINTMENTS_QUERY, [authenticatedUserId]);
}

module.exports = { CUSTOMER_APPOINTMENTS_QUERY, loadCustomerAppointmentHistory };
