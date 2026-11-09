from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.section import WD_SECTION
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT

OUT = 'Appointment System Process Guide.docx'

doc = Document()
sec = doc.sections[0]
sec.top_margin = Inches(0.72)
sec.bottom_margin = Inches(0.7)
sec.left_margin = Inches(0.8)
sec.right_margin = Inches(0.8)

styles = doc.styles
styles['Normal'].font.name = 'Aptos'
styles['Normal']._element.rPr.rFonts.set(qn('w:ascii'), 'Aptos')
styles['Normal']._element.rPr.rFonts.set(qn('w:hAnsi'), 'Aptos')
styles['Normal'].font.size = Pt(10.5)
styles['Normal'].paragraph_format.space_after = Pt(6)
styles['Normal'].paragraph_format.line_spacing = 1.12
for name, size in [('Title', 24), ('Heading 1', 16), ('Heading 2', 12.5), ('Heading 3', 11)]:
    st = styles[name]
    st.font.name = 'Aptos Display' if name == 'Title' else 'Aptos'
    st._element.rPr.rFonts.set(qn('w:ascii'), st.font.name)
    st._element.rPr.rFonts.set(qn('w:hAnsi'), st.font.name)
    st.font.size = Pt(size)
    st.font.color.rgb = RGBColor(0, 0, 0)
    st.font.bold = True
    st.paragraph_format.space_before = Pt(14 if name != 'Title' else 0)
    st.paragraph_format.space_after = Pt(6)

code_style = styles.add_style('Code Block', WD_STYLE_TYPE.PARAGRAPH)
code_style.font.name = 'Consolas'
code_style._element.rPr.rFonts.set(qn('w:ascii'), 'Consolas')
code_style._element.rPr.rFonts.set(qn('w:hAnsi'), 'Consolas')
code_style.font.size = Pt(8.1)
code_style.paragraph_format.space_before = Pt(4)
code_style.paragraph_format.space_after = Pt(7)
code_style.paragraph_format.left_indent = Inches(0.17)
code_style.paragraph_format.right_indent = Inches(0.1)
code_style.paragraph_format.line_spacing = 1.0

def shade(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr(); shd = OxmlElement('w:shd'); shd.set(qn('w:fill'), fill); tcPr.append(shd)
def border_table(table):
    tblPr = table._tbl.tblPr
    borders = OxmlElement('w:tblBorders')
    for edge in ('top','left','bottom','right','insideH','insideV'):
        el = OxmlElement(f'w:{edge}'); el.set(qn('w:val'),'single'); el.set(qn('w:sz'),'4'); el.set(qn('w:color'),'D9D9D9'); borders.append(el)
    tblPr.append(borders)
def set_cell(cell, text, bold=False, white=False):
    cell.text = ''
    p = cell.paragraphs[0]; p.paragraph_format.space_after = Pt(2); p.paragraph_format.space_before = Pt(2)
    r = p.add_run(text); r.bold = bold; r.font.size = Pt(9); r.font.color.rgb = RGBColor(255,255,255) if white else RGBColor(0,0,0)
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
def table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers)); t.alignment = WD_TABLE_ALIGNMENT.CENTER; t.style = 'Table Grid'; border_table(t)
    for i,h in enumerate(headers): shade(t.rows[0].cells[i], '17365D'); set_cell(t.rows[0].cells[i], h, True, True)
    for ri,row in enumerate(rows):
        cells=t.add_row().cells
        for i,val in enumerate(row):
            if ri % 2 == 1: shade(cells[i], 'F4F7FA')
            set_cell(cells[i], str(val))
    if widths:
        for row in t.rows:
            for i,w in enumerate(widths): row.cells[i].width = Inches(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t
def para(text='', boldlead=None):
    p=doc.add_paragraph()
    if boldlead:
        p.add_run(boldlead).bold=True
    p.add_run(text)
    return p
def bullet(text, level=0):
    p=doc.add_paragraph(style='List Bullet' if level==0 else 'List Bullet 2'); p.add_run(text); return p
def code(text):
    p=doc.add_paragraph(style='Code Block')
    p.paragraph_format.keep_together = True
    pPr=p._p.get_or_add_pPr(); shd=OxmlElement('w:shd'); shd.set(qn('w:fill'),'F2F4F7'); pPr.append(shd)
    p.add_run(text)
    return p
def heading(text, level=1): return doc.add_heading(text, level=level)
def pagebreak(): doc.add_page_break()

# Header/footer
header=sec.header.paragraphs[0]; header.text='Sculpt and Glow Appointment System'; header.alignment=WD_ALIGN_PARAGRAPH.RIGHT
header.runs[0].font.size=Pt(8); header.runs[0].font.color.rgb=RGBColor(89,89,89)
footer=sec.footer.paragraphs[0]; footer.alignment=WD_ALIGN_PARAGRAPH.CENTER
footer.add_run('System process guide | Current implementation review').font.size=Pt(8)

doc.add_heading('Appointment System Process Guide', 0)
p=doc.add_paragraph(); p.alignment=WD_ALIGN_PARAGRAPH.LEFT
r=p.add_run('Detailed walkthrough of booking, payment, scheduling, lifecycle, inventory, notifications, and exception handling'); r.italic=True; r.font.size=Pt(12)
para('This guide explains what the current system does, in the order events normally happen. It includes the code that enforces the important rules and calls out the situations the system is designed to handle successfully. The main distinction to remember is that a normal client booking is created only after verified PayMongo payment, while authorized staff can create walk-ins and rebookings as confirmed but unpaid appointments.')
heading('System at a glance', 1)
table(['Flow', 'What is stored', 'Why it matters'], [
('Client selects a service and slot', 'Temporary browser booking data', 'The server validates it again; browser data is not trusted.'),
('Client starts PayMongo checkout', 'Pending checkout session snapshot', 'A payment attempt does not reserve a permanent appointment row.'),
('Payment is verified', 'Confirmed paid appointment and reservation payment', 'A free aesthetician is assigned atomically.'),
('Appointment begins', 'Status becomes in progress', 'The appointment becomes eligible for inventory review.'),
('Inventory review and completion', 'Deduction record, stock transactions, completed status', 'Stock and completion change together in one transaction.')
], [2.0,2.2,2.6])
heading('Important exceptions', 2)
bullet('An admin-created walk-in is immediately confirmed and unpaid because payment is expected on site.')
bullet('An admin rebooking of a completed, cancelled, or no-show appointment is also confirmed and unpaid; the original appointment and payment history remain unchanged.')
bullet('A payment that arrives too late or after the selected slot is lost is handled as a refund case, not as a normal appointment.')

pagebreak()
heading('1 Operating Hours and Slot Validation', 1)
para('The shared time policy is defined in utils/slots.js. Client-facing booking and server-side validation use the same slot list, and server validation recalculates the actual end time using the service duration plus its buffer.')
code("""const CLOSING_TIME = '18:00';
const LUNCH_BREAK_START = '12:00';
const LUNCH_BREAK_END = '13:00';
const CLOSED_WEEKDAYS = [];
const MAX_ADVANCE_DAYS = 60;
const MIN_BOOKING_LEAD_MINUTES = 30;
const DEFAULT_BUFFER_MINUTES = 30;
const BOOKING_INTERVAL_MINUTES = 30;

function buildValidSlots() {
  const slots = [];
  for (const [start, end] of [[9 * 60, 12 * 60], [13 * 60, 18 * 60]]) {
    for (let minute = start; minute < end; minute += BOOKING_INTERVAL_MINUTES) {
      slots.push(from24h(`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`));
    }
  }
  return slots;
}""")
para('This produces 30-minute start times from 9:00 AM to 11:30 AM and from 1:00 PM to 5:30 PM. A start time is only offered if the entire service, including buffer time, finishes by 6:00 PM and does not overlap the noon to 1:00 PM lunch break.')
code("""function overlapsLunchBreak(startTime, endTime) {
  return startTime < LUNCH_BREAK_END && endTime > LUNCH_BREAK_START;
}

function isSlotTooSoon(dateStr, timeStr24) {
  const now = manilaNow();
  if (dateStr < now.dateStr) return true;
  if (dateStr > now.dateStr) return false;

  const [slotHour, slotMinute] = timeStr24.split(':').map(Number);
  const [nowHour, nowMinute] = now.timeStr.split(':').map(Number);
  return ((slotHour * 60 + slotMinute) - (nowHour * 60 + nowMinute)) * 60
    - now.second - now.millisecond / 1000 < MIN_BOOKING_LEAD_MINUTES * 60;
}""")
heading('Edge cases handled', 2)
bullet('A 90-minute service with a 30-minute buffer starting at 11:00 AM ends at 1:00 PM, overlaps lunch, and is rejected rather than split across the break.')
bullet('Same-day clients must select a slot at least 30 minutes away. All comparisons use Asia Manila time, not the server time zone.')
bullet('A date beyond 60 calendar days, a past slot, a closed weekday, an inactive service, or a non-slot time is rejected on the server.')

pagebreak()
heading('2 Finding an Available Slot and Preventing Double Booking', 1)
para('Availability is staff-based: a slot is available when at least one active, verified aesthetician is free for the complete interval. The availability endpoint includes the service buffer and checks interval overlap against confirmed, in-progress, and completed appointments.')
code("""const duration = Number(serviceResult.rows[0].duration_minutes)
  + Number(serviceResult.rows[0].buffer_minutes ?? DEFAULT_BUFFER_MINUTES);

return aestheticians.rows.some(({ user_id }) => !appointments.rows.some((appointment) => (
  appointment.aesthetician_id === user_id
  && appointment.appointment_date === dateStr
  && minutes(appointment.appointment_time) < minutes(end)
  && minutes(appointment.appointment_end_time) > minutes(start)
)));""")
para('The overlap formula is the standard rule: an existing appointment conflicts when its start is before the new end and its end is after the new start. In-progress appointments can have an adjusted expected end time; availability uses the later of the normal and adjusted end times so an extension blocks later slots.')
code("""SELECT u.user_id, u.first_name, u.last_name, u.role FROM users u
WHERE u.role = 'aesthetician' AND u.status = 'active' AND u.email_verified = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.aesthetician_id = u.user_id
      AND a.appointment_status IN ('confirmed', 'in_progress', 'completed')
      AND tsrange(
        a.appointment_date + a.appointment_time,
        a.appointment_date + GREATEST(a.appointment_end_time,
          COALESCE(a.adjusted_expected_end_time, a.appointment_end_time))
      ) && tsrange($1::date + $2::time, $1::date + $3::time)
  )
ORDER BY u.user_id""")
heading('Three safeguards', 2)
table(['Layer', 'Protection'], [
('Availability check', 'Avoids showing a client a slot with no currently free aesthetician.'),
('Transaction advisory locks', 'Serializes schedule writes for the relevant aesthetician or all candidates.'),
('PostgreSQL exclusion constraint', 'Rejects overlaps at the database level for active appointment rows using their stored end time.')
], [2.0,4.8])
code("""ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    aesthetician_id WITH =,
    tsrange(appointment_date + appointment_time,
            appointment_date + appointment_end_time) WITH &&
  )
  WHERE (appointment_status IN ('confirmed', 'in_progress', 'completed'))""")
para('The application handles PostgreSQL exclusion errors (23P01) and uniqueness errors (23505) as “the slot is no longer available.” One implementation detail is worth knowing: the database constraint uses appointment_end_time, while the application-level availability and conflict checks additionally consider adjusted_expected_end_time.')

pagebreak()
heading('3 Normal Client Booking and PayMongo Checkout', 1)
para('The booking page keeps the selection in localStorage under sg_pending_booking and passes it to the summary page. This improves the client experience but is not a security boundary: checkout always validates the user, customer details, service, date, time, duration, buffer, and staff availability again on the server.')
code("""async function getValidatedBooking(userId, body, res) {
  const userResult = await db.query(
    'SELECT user_id, first_name, last_name, email, contact_number, email_verified, role, dev_access_all FROM users WHERE user_id = $1',
    [userId]
  );
  if (userResult.rows.length === 0) {
    res.status(401).json({ message: 'Your session is no longer valid. Please log in again.' });
    return null;
  }
  const user = userResult.rows[0];
  if (!canBookAppointments(user)) {
    res.status(403).json({ message: 'Only verified client accounts can book appointments.' });
    return null;
  }
  const customer = getCustomerDetails(body, user, res);
  if (!customer) return null;
  const schedule = await getValidatedSchedule(db, body, res);
  return schedule ? { user, customer, ...schedule } : null;
}""")
para('Once validation succeeds, the system creates a pending paymongo_checkout_sessions row. It stores a snapshot of service name, price, reservation fee, duration, buffer, date, times, and customer information. A later service edit cannot change what this client agreed to pay or the duration that was booked.')
code("""referenceNumber = `SG${randomBytes(12).toString('hex').toUpperCase()}`;
await db.query(`
  INSERT INTO paymongo_checkout_sessions
    (reference_number, user_id, service_id, service_name, service_price,
     appointment_date, appointment_time, appointment_end_time,
     booked_duration_minutes, booked_buffer_minutes, amount_cents,
     currency, status, livemode, customer_first_name, customer_last_name, customer_email, customer_phone)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PHP', 'pending', $12, $13, $14, $15, $16)
`, [referenceNumber, booking.user.user_id, booking.service.service_id,
    booking.service.service_name, booking.service.service_price,
    booking.appointmentDate, booking.appointmentTime, booking.appointmentEndTime,
    booking.durationMinutes, booking.bufferMinutes, amountCents, config.isLive,
    booking.customer.firstName, booking.customer.lastName,
    booking.customer.email, booking.customer.phone]);""")
heading('Checkout safety checks', 2)
bullet('Demo customers cannot start PayMongo checkout.')
bullet('Live checkout requires an HTTPS APP_BASE_URL. Local HTTP is permitted only for test-mode localhost development.')
bullet('The returned checkout URL must be HTTPS on checkout.paymongo.com, and the returned live/test mode must match the configured mode.')
bullet('If PayMongo creation fails or returns an invalid response, the checkout row is marked failed so the client can retry.')

pagebreak()
heading('4 Payment Confirmation Through Webhook and Browser Recovery', 1)
para('PayMongo can notify the server through a signed webhook. The browser also checks checkout status after returning from PayMongo and periodically asks the confirmation route to recover a pending result from PayMongo. The two paths are intentionally idempotent: whichever path succeeds first consumes the checkout and creates the appointment once.')
code("""function payMongoSignatureIsValid(signatureHeader, rawBody, config) {
  if (typeof signatureHeader !== 'string' || !Buffer.isBuffer(rawBody)) return false;
  const fields = Object.fromEntries(signatureHeader.split(',').map((part) => {
    const separator = part.indexOf('=');
    return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }));
  if (!fields.t || !fields.te) return false;
  const expectedSignature = createHmac('sha256', config.webhookSecret)
    .update(`${fields.t}.${rawBody.toString('utf8')}`).digest();
  let actualSignature;
  try { actualSignature = Buffer.from(fields.te, 'hex'); } catch { return false; }
  return actualSignature.length === expectedSignature.length
    && timingSafeEqual(actualSignature, expectedSignature);
}""")
para('The webhook route is mounted with express.raw before express.json so that the exact bytes sent by PayMongo are available for the HMAC check. The payment event also checks the mode, payment currency, checkout ID, reference number, and amount before appointment creation.')
code("""if (payment.status === 'consumed' && payment.appointment_id) {
  return res.json({ message: 'Appointment already created.',
    appointment: { appointment_id: payment.appointment_id } });
}
...
const lockedPayment = await client.query(`
  SELECT status, appointment_id, user_id, service_id, service_name, service_price,
         customer_first_name, customer_last_name, customer_email, customer_phone,
         appointment_date::text AS appointment_date, appointment_time::text AS appointment_time,
         appointment_end_time::text AS appointment_end_time, booked_duration_minutes,
         booked_buffer_minutes, amount_cents, payment_id, payment_method
  FROM paymongo_checkout_sessions
  WHERE reference_number = $1 AND user_id = $2
  FOR UPDATE
`, [referenceNumber, req.session.userId]);""")
heading('Important payment scenarios handled', 2)
table(['Scenario', 'System outcome'], [
('Webhook arrives first', 'The webhook creates the appointment. A later browser confirmation sees consumed and returns the same appointment.'),
('Browser returns first', 'The browser recovery can query PayMongo directly, mark the checkout paid, and create the appointment.'),
('PayMongo temporarily unavailable', 'Confirmation returns 503 with pending true; the browser keeps trying rather than declaring payment failed.'),
('Checkout expires', 'The pending checkout status becomes expired and no appointment is created.'),
('Invalid signature', 'Webhook is rejected with 401 before any payment logic runs.')
], [2.15,4.65])

pagebreak()
heading('5 Creating the Paid Appointment and Assigning Staff', 1)
para('After a payment is verified, the system looks for available aestheticians. It locks candidate schedules and tries each candidate in order. Savepoints permit a conflict for one candidate to roll back cleanly while the transaction tries another free aesthetician.')
code("""for (const candidate of candidates.rows) {
  await client.query('SAVEPOINT appointment_candidate');
  try {
    const result = await client.query(`
      INSERT INTO appointments (
        user_id, service_id, booked_service_price, booked_reservation_fee,
        appointment_date, appointment_time, appointment_end_time, scheduled_end_time,
        booked_duration_minutes, booked_buffer_minutes, aesthetician_id,
        appointment_status, payment_status, reminder_24h_sent, reminder_3h_sent,
        reminder_email_24h_sent, reminder_email_3h_sent,
        customer_first_name, customer_last_name, customer_email, customer_phone
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, 'confirmed', 'paid',
        $5::date + $6::time <= (NOW() AT TIME ZONE 'Asia/Manila') + INTERVAL '24 hours',
        FALSE,
        $5::date + $6::time <= (NOW() AT TIME ZONE 'Asia/Manila') + INTERVAL '24 hours',
        FALSE, $11, $12, $13, $14)
      RETURNING appointment_id, appointment_status, payment_status, aesthetician_id
    `, [payment.user_id, payment.service_id, payment.service_price,
      Number(payment.amount_cents) / 100, payment.appointment_date,
      payment.appointment_time, payment.appointment_end_time,
      payment.booked_duration_minutes, payment.booked_buffer_minutes, candidate.user_id,
      payment.customer_first_name, payment.customer_last_name,
      payment.customer_email, payment.customer_phone]);
    await client.query('RELEASE SAVEPOINT appointment_candidate');
    return result.rows[0];
  } catch (error) {
    if (error.code === '23P01' || error.code === '23505') {
      await client.query('ROLLBACK TO SAVEPOINT appointment_candidate');
      await client.query('RELEASE SAVEPOINT appointment_candidate');
      continue;
    }
    throw error;
  }
}
return null;""")
para('The client does not choose an aesthetician during normal online booking. The system assigns the first eligible aesthetician who remains free when the transaction is committed.')
heading('Paid but cannot secure a slot', 2)
para('If no candidate can be secured after payment, the checkout remains paid and the system attempts a PayMongo refund with reason duplicate. If that automatic refund fails, the client and admin are notified that support must arrange a manual refund. The same pattern applies to a payment that arrives after the appointment start time, using the “others” refund reason.')

pagebreak()
heading('6 Appointment Lifecycle and Inventory Completion', 1)
para('The usual lifecycle is confirmed, then in progress at the scheduled start time, then completed after inventory handling. A cron job runs every minute in Asia Manila time, and the admin page can also advance started appointments so the UI does not remain stale.')
code("""UPDATE appointments
SET appointment_status = 'in_progress', updated_at = NOW()
WHERE appointment_status = 'confirmed'
  AND appointment_date + appointment_time <= (NOW() AT TIME ZONE 'Asia/Manila')
RETURNING appointment_id, user_id""")
para('Aesthetician staff may start their own confirmed appointment on its scheduled date. Direct completion is intentionally disabled; an appointment can be completed only through the admin inventory-completion route.')
code("""router.post('/:id/finish', requireActiveAccount, async (req, res) => {
  const appointmentId = validAppointmentId(req.params.id);
  if (!appointmentId) return res.status(400).json({ message: 'Choose a valid appointment.' });
  return res.status(409).json({
    message: `Appointment ${appointmentId} can be completed only after an admin confirms the inventory review.`
  });
});""")
heading('Inventory review and atomic completion', 2)
para('An inventory officer or admin can confirm the product review for an in-progress appointment. An admin then completes the appointment. The completion transaction verifies the confirmed review, locks products, checks quantities, writes the one-per-appointment deduction record, reduces stock, logs Used in Service transactions, and changes the status to completed.')
code("""if (!reviewDraft || !reviewDraft.reviewed_by || !reviewDraft.reviewed_at) {
  const error = new Error('Products are pending review. An authorized reviewer must confirm the products and quantities before the appointment can be completed.');
  error.statusCode = 409;
  throw error;
}
...
await client.query(`
  INSERT INTO appointment_inventory_deductions (appointment_id, confirmed_by, confirmed_at)
  VALUES ($1, $2, NOW())
`, [appointmentId, req.session.userId]);
...
const statusResult = await client.query(`
  UPDATE appointments
  SET appointment_status = 'completed', updated_at = NOW()
  WHERE appointment_id = $1 AND appointment_status = 'in_progress'
  RETURNING appointment_id, user_id
`, [appointmentId]);""")
heading('Inventory edge cases handled', 2)
bullet('No review, unconfirmed review, invalid quantities, missing products, insufficient stock, or a duplicate deduction all stop completion with a conflict response.')
bullet('The unique deduction record prevents stock being deducted twice for the same appointment.')
bullet('Because stock updates, inventory logging, and status completion occur in one transaction, a failure rolls them back together.')

pagebreak()
heading('7 Cancellation and Rescheduling', 1)
para('Clients and assigned aestheticians submit cancellation or reschedule requests; an admin reviews them. Cancellation requests must arrive more than 24 hours before the scheduled time. The refund decision is based on the time the request was submitted, not the time the admin approves it.')
code("""if (minutesUntil(appointment.appointment_date, appointment.appointment_time, manilaNow()) <= 24 * 60) {
  return res.status(400).json({
    message: 'Cancellation requests must be submitted more than 24 hours before the appointment.'
  });
}

CASE WHEN a.cancellation_requested_at IS NOT NULL THEN
  a.appointment_date + a.appointment_time >
    (a.cancellation_requested_at AT TIME ZONE 'Asia/Manila') + INTERVAL '24 hours'
ELSE FALSE END AS cancellation_refundable""")
table(['Situation', 'Outcome'], [
('Paid appointment; request submitted more than 24 hours early', 'The reservation payment is eligible for automatic PayMongo refund.'),
('Paid appointment; request too late', 'The reservation fee is recorded as forfeited rather than automatically refunded.'),
('Automatic refund fails', 'The appointment is cancelled, but the response tells the admin to process the refund manually.'),
('Cash payment', 'The automatic PayMongo refund query excludes cash payment records.'),
('Admin direct cancellation', 'Admins may cancel confirmed or in-progress appointments, but a confirmed appointment that has already begun cannot be cancelled.')
], [2.65,4.15])
heading('Rescheduling validation', 2)
para('For a non-admin request, the system stores the requested date, time, calculated end time, reason, and description. On approval it validates the stored booking duration and buffer, operating hours, lunch break, and conflicts again while holding an advisory lock. Reminder flags are reset so reminders can be sent for the new schedule.')
code("""if (!requestedEndTime || requestedEndTime > CLOSING_TIME
  || overlapsLunchBreak(requestedTime, requestedEndTime)
  || requestedEndTime !== storedRequestedEndTime) {
  const error = new Error(
    "The requested time no longer matches the appointment's booked duration and buffer."
  );
  error.statusCode = 409;
  throw error;
}""")

pagebreak()
heading('8 Walk Ins Rebooking and Administrative Edits', 1)
para('The system supports appointments for either a registered client or a named walk-in. The database constraint makes the two identity models mutually exclusive: an appointment cannot have both, and cannot have neither.')
code("""CHECK (
  (user_id IS NOT NULL AND walk_in_name IS NULL)
  OR (user_id IS NULL AND NULLIF(BTRIM(walk_in_name), '') IS NOT NULL)
)""")
para('An admin creates a walk-in as confirmed and unpaid, with an assigned aesthetician. The validation allows short lead times for this authorized administrative workflow, but it still validates the service, business hours, lunch break, duration, buffer, and staff conflicts.')
code("""INSERT INTO appointments
  (user_id, walk_in_name, service_id, booked_service_price, booked_reservation_fee,
   appointment_date, appointment_time, appointment_end_time, scheduled_end_time,
   booked_duration_minutes, booked_buffer_minutes, aesthetician_id,
   appointment_status, payment_status)
VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, 'confirmed', 'unpaid')
RETURNING appointment_id, appointment_status, payment_status""")
heading('Rebooking', 2)
para('Only completed, cancelled, and no-show appointments can be rebooked. Rebooking creates a new confirmed unpaid appointment using the original service and booked prices; it does not edit the original history. The admin must select a currently available staff member and a valid new schedule.')
code("""if (!['completed', 'cancelled', 'no_show'].includes(original.appointment_status)) {
  const error = new Error('Only completed, cancelled, or no-show appointments can be rebooked.');
  error.statusCode = 400;
  throw error;
}
...
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11, 'confirmed', 'unpaid')""")
heading('Admin edit protections', 2)
bullet('Completed, cancelled, and no-show appointments cannot be edited; rebook is the supported path.')
bullet('While an appointment is in progress, schedule, service, and assigned staff cannot change, and it cannot return to confirmed.')
bullet('An admin may set an appointment to in progress only when it is currently confirmed and scheduled for today.')
bullet('No-show is permitted only for a confirmed or in-progress appointment that has already started.')

pagebreak()
heading('9 Reminders Ratings and Operational Notifications', 1)
para('There are independent flags for in-app and email reminders at 24 hours and 3 hours. In-app reminders are marked and sent in batches. Email reminders use a claim-before-send pattern so multiple server instances do not send duplicates; failed sends release the flag for later retry.')
code("""const claim = await db.query(`
  UPDATE appointments
  SET ${flag} = TRUE
  WHERE appointment_id = $1 AND ${flag} = FALSE
    AND appointment_status = 'confirmed'
    AND appointment_date = $2::date AND appointment_time = $3::time
    AND appointment_date + appointment_time > ${now}
    AND appointment_date + appointment_time <= ${now} + ($4 * INTERVAL '1 hour')
    AND ($4::integer <> 24 OR appointment_date + appointment_time > ${now} + INTERVAL '3 hours')
  RETURNING appointment_id
`, [appointment.appointment_id, appointment.appointment_date,
  appointment.appointment_time, hours]);
if (!claim.rows.length) continue;

try {
  await sendAppointmentReminderEmail(appointment, hours);
} catch (error) {
  await db.query(`UPDATE appointments SET ${flag} = FALSE
    WHERE appointment_id = $1 AND ${flag} = TRUE`, [appointment.appointment_id]);
}""")
para('The 24-hour window deliberately excludes appointments within 3 hours, preventing a late booking from receiving both reminders together. Email reminder processing also takes a PostgreSQL advisory lock so only one server instance runs the job at a time.')
heading('Ratings', 2)
para('Only the owner of a completed, non-demo appointment can submit a rating, and the appointment must have an assigned aesthetician. The rating window is 7 days. A scheduled fallback inserts an automatic 5-star rating for eligible completed appointments that remain unrated after that window; the unique appointment rating constraint prevents duplicates.')
code("""INSERT INTO appointment_ratings (
  appointment_id, client_id, staff_id, service_id, rating, comment, is_automatic
)
SELECT a.appointment_id, a.user_id, a.aesthetician_id, a.service_id, 5, NULL, TRUE
FROM appointments a
WHERE a.appointment_status = 'completed'
  AND a.user_id IS NOT NULL
  AND a.aesthetician_id IS NOT NULL
  AND a.appointment_date < (NOW() AT TIME ZONE 'Asia/Manila')::date - $1::integer
  AND a.is_demo IS DISTINCT FROM TRUE
  AND NOT EXISTS (
    SELECT 1 FROM appointment_ratings existing
    WHERE existing.appointment_id = a.appointment_id
  )
ON CONFLICT (appointment_id) DO NOTHING""")

pagebreak()
heading('10 What the System Successfully Handles', 1)
para('The following scenarios are explicitly covered by the current implementation and are useful for a defense, demonstration, or testing discussion.')
table(['Scenario', 'Successful behavior'], [
('Two clients try the same time', 'The availability check, schedule locks, candidate savepoints, and database constraint prevent overlapping assignments.'),
('Service price changes after checkout begins', 'The pending checkout preserves price, deposit, duration, and buffer snapshots.'),
('Webhook and browser confirm at the same time', 'Checkout row locking and consumed status make the process idempotent.'),
('Customer paid but slot was lost', 'The system attempts an automatic refund and alerts the client and administrators if manual action is required.'),
('Payment arrives after service start', 'The system treats it as a late payment and attempts an automatic refund.'),
('Staff treatment runs longer', 'Adjusted expected end time blocks subsequent availability at the application layer.'),
('Inventory becomes insufficient before completion', 'Completion stops before stock is reduced or appointment status becomes completed.'),
('Admin approves a timely cancellation late', 'Refund eligibility still uses the recorded request time, protecting the client.'),
('Email provider fails during reminder', 'The reminder claim is released so a later job run can retry.'),
('Walk-in or rebook does not have online payment', 'Authorized admin flows create confirmed unpaid appointments without altering the normal online payment rule.')
], [2.45,4.35])
heading('Key takeaway', 2)
para('For regular client bookings, the pending checkout session is the temporary payment record and the appointment is created only after payment verification. The system then protects the schedule through validation, staff assignment, locking, and database constraints. Once service begins, inventory review controls the completed status and stock deduction. Separate request, refund, reminder, rating, walk-in, and rebooking paths handle the operational exceptions without weakening the regular paid-booking flow.')

doc.core_properties.title = 'Appointment System Process Guide'
doc.core_properties.subject = 'Detailed guide to current appointment system processes and edge cases'
doc.core_properties.author = 'Sculpt and Glow'
doc.save(OUT)
print(OUT)
