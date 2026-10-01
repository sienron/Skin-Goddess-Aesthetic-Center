const express = require('express');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { DEPOSIT_DEDUCTED_FROM_PRICE, NO_SHOW_DEPOSIT_IS_INCOME } = require('../utils/financeRules');

const router = express.Router();
const PAYMENT_TYPES = ['reservation', 'balance', 'product_sale'];
const METHODS = ['paymongo', 'cash', 'gcash', 'maya', 'card'];
const EXPENSE_CATEGORIES = ['Inventory & Supplies', 'Salaries & Commissions', 'Rent', 'Utilities', 'Marketing', 'Equipment Maintenance', 'Other'];
router.use(requireRole('finance_officer', 'admin'));

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function manilaDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateRange(query) {
  const today = manilaDate();
  const from = query.from === undefined ? `${today.slice(0, 7)}-01` : query.from;
  const to = query.to === undefined ? today : query.to;
  if (!validDate(from) || !validDate(to)) throw new ApiError(400, 'Dates must use YYYY-MM-DD.');
  if (from > to) throw new ApiError(400, 'The from date must be on or before the to date.');
  return { from, to };
}

function amountValue(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 99999999.99) throw new ApiError(400, 'Amount must be positive and no greater than 99999999.99.');
  const rounded = Math.round(amount * 100) / 100;
  if (rounded <= 0) throw new ApiError(400, 'Amount must be at least 0.01.');
  return rounded;
}

function idValue(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(400, `${label} must be a positive integer.`);
  return id;
}

function pageValues(query, defaultLimit = 25) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? defaultLimit : Number(query.limit);
  if (!Number.isInteger(page) || page < 1) throw new ApiError(400, 'Page must be a positive integer.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'Limit must be between 1 and 100.');
  return { page, limit, offset: (page - 1) * limit };
}

function endpoint(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (error instanceof ApiError) return res.status(error.status).json({ message: error.message });
      console.error('Finance API error:', error);
      return res.status(500).json({ message: 'Finance request failed.' });
    }
  };
}

const salesUnion = `
  SELECT a.appointment_date AS sale_date, a.booked_service_price::numeric AS amount
  FROM appointments a WHERE a.appointment_status = 'completed'
    AND a.appointment_date BETWEEN $1::date AND $2::date
  UNION ALL
  SELECT (p.created_at AT TIME ZONE 'Asia/Manila')::date, p.amount
  FROM payments p WHERE p.payment_type = 'product_sale' AND p.status = 'posted'
    AND (p.created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1::date AND $2::date
  UNION ALL
  SELECT a.appointment_date, p.amount
  FROM appointments a JOIN payments p ON p.appointment_id = a.appointment_id
  WHERE a.appointment_status = 'no_show' AND p.payment_type = 'reservation' AND p.status = 'posted'
    AND $3::boolean AND a.appointment_date BETWEEN $1::date AND $2::date
`;

async function outstandingBalance() {
  const result = await db.query(`
    SELECT COALESCE(SUM(GREATEST(a.booked_service_price - COALESCE(p.paid, 0), 0)), 0)::float8 AS amount
    FROM appointments a LEFT JOIN (
      SELECT appointment_id, SUM(amount) AS paid FROM payments
      WHERE status = 'posted' AND ($1::boolean OR payment_type <> 'reservation') GROUP BY appointment_id
    ) p ON p.appointment_id = a.appointment_id
    WHERE a.appointment_status = 'completed'
  `, [DEPOSIT_DEDUCTED_FROM_PRICE]);
  return Number(result.rows[0].amount || 0);
}

async function reportData(from, to) {
  const [sales, collected, expenses, daily, categoryRows, deposits, services, expenseCategories] = await Promise.all([
    db.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS amount FROM (${salesUnion}) sale_rows`, [from, to, NO_SHOW_DEPOSIT_IS_INCOME]),
    db.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS amount FROM payments WHERE status = 'posted' AND (created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1::date AND $2::date`, [from, to]),
    db.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS amount FROM expenses WHERE voided_at IS NULL AND expense_date BETWEEN $1::date AND $2::date`, [from, to]),
    db.query(`
      SELECT day::date::text AS date, COALESCE(c.total, 0)::float8 AS collected, COALESCE(e.total, 0)::float8 AS expenses
      FROM generate_series($1::date, $2::date, '1 day') day
      LEFT JOIN (SELECT (created_at AT TIME ZONE 'Asia/Manila')::date AS date, SUM(amount) AS total
        FROM payments WHERE status = 'posted' AND (created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1::date AND $2::date GROUP BY 1) c ON c.date = day::date
      LEFT JOIN (SELECT expense_date AS date, SUM(amount) AS total FROM expenses WHERE voided_at IS NULL AND expense_date BETWEEN $1::date AND $2::date GROUP BY 1) e ON e.date = day::date
      ORDER BY day
    `, [from, to]),
    db.query(`SELECT category, SUM(amount)::float8 AS amount FROM (
      SELECT s.category, a.booked_service_price::numeric AS amount FROM appointments a JOIN services s ON s.service_id = a.service_id
      WHERE a.appointment_status = 'completed' AND a.appointment_date BETWEEN $1::date AND $2::date
      UNION ALL
      SELECT s.category, p.amount FROM appointments a JOIN services s ON s.service_id = a.service_id JOIN payments p ON p.appointment_id = a.appointment_id
      WHERE a.appointment_status = 'no_show' AND p.payment_type = 'reservation' AND p.status = 'posted' AND $3::boolean AND a.appointment_date BETWEEN $1::date AND $2::date
    ) revenue GROUP BY category ORDER BY amount DESC`, [from, to, NO_SHOW_DEPOSIT_IS_INCOME]),
    db.query(`SELECT CASE WHEN p.status = 'refunded' THEN 'refunded' WHEN a.appointment_status = 'no_show' THEN 'forfeited' ELSE 'paid' END AS status, COUNT(*)::int AS count, SUM(p.amount)::float8 AS amount FROM payments p LEFT JOIN appointments a ON a.appointment_id = p.appointment_id WHERE p.payment_type = 'reservation' AND (p.created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1::date AND $2::date GROUP BY 1 ORDER BY 1`, [from, to]),
    db.query(`SELECT service, SUM(amount)::float8 AS amount, COUNT(*)::int AS count FROM (
      SELECT s.service_name AS service, a.booked_service_price::numeric AS amount FROM appointments a JOIN services s ON s.service_id = a.service_id
      WHERE a.appointment_status = 'completed' AND a.appointment_date BETWEEN $1::date AND $2::date
      UNION ALL
      SELECT s.service_name, p.amount FROM appointments a JOIN services s ON s.service_id = a.service_id JOIN payments p ON p.appointment_id = a.appointment_id
      WHERE a.appointment_status = 'no_show' AND p.payment_type = 'reservation' AND p.status = 'posted' AND $3::boolean AND a.appointment_date BETWEEN $1::date AND $2::date
    ) revenue GROUP BY service ORDER BY amount DESC LIMIT 5`, [from, to, NO_SHOW_DEPOSIT_IS_INCOME]),
    db.query(`SELECT category, SUM(amount)::float8 AS amount, COUNT(*)::int AS count FROM expenses WHERE voided_at IS NULL AND expense_date BETWEEN $1::date AND $2::date GROUP BY category ORDER BY amount DESC`, [from, to]),
  ]);
  const categories = categoryRows.rows.map((row) => ({ ...row, amount: Number(row.amount) }));
  const topCategories = categories.slice(0, 4);
  if (categories.length > 4) topCategories.push({ category: 'Other', amount: categories.slice(4).reduce((sum, row) => sum + row.amount, 0) });
  const totalSales = Number(sales.rows[0].amount || 0);
  const totalCollected = Number(collected.rows[0].amount || 0);
  const totalExpenses = Number(expenses.rows[0].amount || 0);
  return {
    from, to,
    income_statement: { sales: totalSales, collected: totalCollected, expenses: totalExpenses, net_income: totalCollected - totalExpenses, outstanding_balance: await outstandingBalance() },
    daily_cash: daily.rows.map((row) => ({ ...row, collected: Number(row.collected), expenses: Number(row.expenses) })),
    service_categories: topCategories,
    deposits: deposits.rows.map((row) => ({ ...row, count: Number(row.count), amount: Number(row.amount) })),
    top_services: services.rows.map((row) => ({ ...row, amount: Number(row.amount), count: Number(row.count) })),
    expenses_by_category: expenseCategories.rows.map((row) => ({ ...row, amount: Number(row.amount), count: Number(row.count) })),
  };
}

router.get('/summary', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const report = await reportData(from, to);
  const today = manilaDate();
  const [todayResult, noShows] = await Promise.all([
    db.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS amount FROM payments WHERE status = 'posted' AND (created_at AT TIME ZONE 'Asia/Manila')::date = $1::date`, [today]),
    db.query(`SELECT COUNT(*)::int AS count FROM appointments WHERE appointment_status = 'no_show' AND appointment_date BETWEEN date_trunc('week', $1::date)::date AND date_trunc('week', $1::date)::date + 6`, [today]),
  ]);
  res.json({ ...report.income_statement, today_collections: Number(todayResult.rows[0].amount), no_shows_this_week: Number(noShows.rows[0].count), from, to });
}));

router.get('/monthly', endpoint(async (req, res) => {
  const range = dateRange(req.query);
  const hasCustomRange = req.query.from !== undefined || req.query.to !== undefined;
  const [endYear, endMonth] = range.to.slice(0, 7).split('-').map(Number);
  const [startYear, startMonth] = range.from.slice(0, 7).split('-').map(Number);
  const rangeMonths = (endYear - startYear) * 12 + endMonth - startMonth + 1;
  const months = req.query.months === undefined ? (hasCustomRange ? rangeMonths : 6) : Number(req.query.months);
  if (!Number.isInteger(months) || months < 1 || months > 24) throw new ApiError(400, 'Months must be between 1 and 24.');
  const start = hasCustomRange && req.query.months === undefined
    ? `${range.from.slice(0, 7)}-01`
    : new Date(Date.UTC(endYear, endMonth - months, 1)).toISOString().slice(0, 10);
  const [sales, expenses] = await Promise.all([
    db.query(`SELECT to_char(month, 'YYYY-MM') AS month, SUM(amount)::float8 AS amount FROM (
      SELECT date_trunc('month', appointment_date)::date AS month, booked_service_price::numeric AS amount FROM appointments WHERE appointment_status = 'completed' AND appointment_date BETWEEN $1::date AND $2::date
      UNION ALL SELECT date_trunc('month', created_at AT TIME ZONE 'Asia/Manila')::date, amount FROM payments WHERE payment_type = 'product_sale' AND status = 'posted' AND (created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1::date AND $2::date
      UNION ALL SELECT date_trunc('month', a.appointment_date)::date, p.amount FROM appointments a JOIN payments p ON p.appointment_id = a.appointment_id WHERE a.appointment_status = 'no_show' AND p.payment_type = 'reservation' AND p.status = 'posted' AND $3::boolean AND a.appointment_date BETWEEN $1::date AND $2::date
    ) s GROUP BY month`, [start, range.to, NO_SHOW_DEPOSIT_IS_INCOME]),
    db.query(`SELECT to_char(date_trunc('month', expense_date), 'YYYY-MM') AS month, SUM(amount)::float8 AS amount FROM expenses WHERE voided_at IS NULL AND expense_date BETWEEN $1::date AND $2::date GROUP BY 1`, [start, range.to]),
  ]);
  const salesMap = new Map(sales.rows.map((row) => [row.month, Number(row.amount)]));
  const expenseMap = new Map(expenses.rows.map((row) => [row.month, Number(row.amount)]));
  const data = [];
  for (let i = 0; i < months; i += 1) {
    const key = new Date(Date.UTC(endYear, endMonth - months + i, 1)).toISOString().slice(0, 7);
    data.push({ month: key, sales: salesMap.get(key) || 0, expenses: expenseMap.get(key) || 0 });
  }
  res.json(data);
}));

router.get('/daily', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const result = await db.query(`SELECT day::date::text AS date, COALESCE(SUM(p.amount), 0)::float8 AS collected FROM generate_series($1::date, $2::date, '1 day') day LEFT JOIN payments p ON (p.created_at AT TIME ZONE 'Asia/Manila')::date = day::date AND p.status = 'posted' GROUP BY day ORDER BY day`, [from, to]);
  res.json(result.rows.map((row) => ({ ...row, collected: Number(row.collected) })));
}));

router.get('/by-method', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const values = [from, to];
  const where = ["p.status = 'posted'", "(p.created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1::date AND $2::date"];
  if (req.query.type) {
    if (!PAYMENT_TYPES.includes(req.query.type)) throw new ApiError(400, 'Invalid payment type.');
    values.push(req.query.type); where.push(`p.payment_type = $${values.length}`);
  }
  if (req.query.method) {
    if (!METHODS.includes(req.query.method)) throw new ApiError(400, 'Invalid payment method.');
    values.push(req.query.method); where.push(`p.method = $${values.length}`);
  }
  if (req.query.q) {
    values.push(`%${String(req.query.q).slice(0, 100)}%`);
    where.push(`(COALESCE(c.first_name || ' ' || c.last_name, '') ILIKE $${values.length} OR COALESCE(p.reference_no, '') ILIKE $${values.length} OR COALESCE(s.service_name, '') ILIKE $${values.length})`);
  }
  const result = await db.query(`SELECT p.method, SUM(p.amount)::float8 AS amount, COUNT(*)::int AS count FROM payments p LEFT JOIN appointments a ON a.appointment_id = p.appointment_id LEFT JOIN users c ON c.user_id = a.user_id LEFT JOIN services s ON s.service_id = a.service_id WHERE ${where.join(' AND ')} GROUP BY p.method ORDER BY amount DESC`, values);
  res.json(result.rows);
}));

router.get('/by-payment-type', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const result = await db.query(`SELECT payment_type, SUM(amount)::float8 AS amount, COUNT(*)::int AS count FROM payments WHERE status = 'posted' AND (created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1::date AND $2::date GROUP BY payment_type ORDER BY amount DESC`, [from, to]);
  res.json(result.rows);
}));

router.get('/by-service', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const { limit } = pageValues({ limit: req.query.limit }, 5);
  const result = await db.query(`SELECT service, SUM(amount)::float8 AS amount, COUNT(*)::int AS count FROM (
    SELECT s.service_name AS service, a.booked_service_price::numeric AS amount FROM appointments a JOIN services s ON s.service_id = a.service_id
    WHERE a.appointment_status = 'completed' AND a.appointment_date BETWEEN $1::date AND $2::date
    UNION ALL
    SELECT s.service_name, p.amount FROM appointments a JOIN services s ON s.service_id = a.service_id JOIN payments p ON p.appointment_id = a.appointment_id
    WHERE a.appointment_status = 'no_show' AND p.payment_type = 'reservation' AND p.status = 'posted' AND $3::boolean AND a.appointment_date BETWEEN $1::date AND $2::date
  ) revenue GROUP BY service ORDER BY amount DESC LIMIT $4`, [from, to, NO_SHOW_DEPOSIT_IS_INCOME, limit]);
  res.json(result.rows);
}));

router.get('/by-service-category', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const result = await db.query(`SELECT category, SUM(amount)::float8 AS amount FROM (
    SELECT s.category, a.booked_service_price::numeric AS amount FROM appointments a JOIN services s ON s.service_id = a.service_id
    WHERE a.appointment_status = 'completed' AND a.appointment_date BETWEEN $1::date AND $2::date
    UNION ALL
    SELECT s.category, p.amount FROM appointments a JOIN services s ON s.service_id = a.service_id JOIN payments p ON p.appointment_id = a.appointment_id
    WHERE a.appointment_status = 'no_show' AND p.payment_type = 'reservation' AND p.status = 'posted' AND $3::boolean AND a.appointment_date BETWEEN $1::date AND $2::date
  ) revenue GROUP BY category ORDER BY amount DESC`, [from, to, NO_SHOW_DEPOSIT_IS_INCOME]);
  const categories = result.rows.map((row) => ({ ...row, amount: Number(row.amount) }));
  const top = categories.slice(0, 4);
  if (categories.length > 4) top.push({ category: 'Other', amount: categories.slice(4).reduce((sum, row) => sum + row.amount, 0) });
  res.json(top);
}));

router.get('/expenses/by-category', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const values = [from, to];
  const where = ['voided_at IS NULL', 'expense_date BETWEEN $1::date AND $2::date'];
  if (req.query.category) {
    if (!EXPENSE_CATEGORIES.includes(req.query.category)) throw new ApiError(400, 'Invalid expense category.');
    values.push(req.query.category); where.push(`category = $${values.length}`);
  }
  if (req.query.q) {
    values.push(`%${String(req.query.q).slice(0, 100)}%`);
    where.push(`(description ILIKE $${values.length} OR COALESCE(supplier, '') ILIKE $${values.length} OR COALESCE(reference_no, '') ILIKE $${values.length})`);
  }
  const result = await db.query(`SELECT category, SUM(amount)::float8 AS amount, COUNT(*)::int AS count FROM expenses WHERE ${where.join(' AND ')} GROUP BY category ORDER BY amount DESC`, values);
  res.json(result.rows);
}));

router.get('/deposits', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const result = await db.query(`SELECT p.payment_id, p.appointment_id, p.amount::float8 AS amount, p.method, p.reference_no, p.note, p.status AS payment_status, (p.created_at AT TIME ZONE 'Asia/Manila')::date::text AS payment_date, a.appointment_status, a.appointment_date::text AS appointment_date, COALESCE(c.first_name || ' ' || c.last_name, 'Client') AS client FROM payments p LEFT JOIN appointments a ON a.appointment_id = p.appointment_id LEFT JOIN users c ON c.user_id = a.user_id WHERE p.payment_type = 'reservation' AND (p.created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1::date AND $2::date ORDER BY p.created_at DESC`, [from, to]);
  res.json(result.rows.map((row) => ({ ...row, deposit_status: row.payment_status === 'refunded' ? 'refunded' : row.appointment_status === 'no_show' ? 'forfeited' : 'paid' })));
}));

router.get('/payments/:id', endpoint(async (req, res) => {
  dateRange(req.query);
  const paymentId = idValue(req.params.id, 'Payment ID');
  const result = await db.query(`SELECT p.payment_id, p.appointment_id, p.payment_type, p.amount::float8 AS amount, p.method, p.reference_no, p.note, p.status, (p.created_at AT TIME ZONE 'Asia/Manila')::date::text AS payment_date, a.appointment_date::text AS appointment_date, a.appointment_status, a.booked_service_price::float8 AS service_price, COALESCE(c.first_name || ' ' || c.last_name, 'Product sale') AS client, c.email, s.service_name AS service FROM payments p LEFT JOIN appointments a ON a.appointment_id = p.appointment_id LEFT JOIN users c ON c.user_id = a.user_id LEFT JOIN services s ON s.service_id = a.service_id WHERE p.payment_id = $1`, [paymentId]);
  if (!result.rows.length) throw new ApiError(404, 'Payment not found.');
  const payment = result.rows[0];
  let history = [];
  if (payment.appointment_id) {
    const payments = await db.query(`SELECT payment_id, payment_type, amount::float8 AS amount, method, reference_no, note, status, (created_at AT TIME ZONE 'Asia/Manila')::date::text AS payment_date FROM payments WHERE appointment_id = $1 ORDER BY created_at, payment_id`, [payment.appointment_id]);
    history = payments.rows;
  }
  res.json({ payment, history });
}));

router.get('/appointments/:id', endpoint(async (req, res) => {
  dateRange(req.query);
  const appointmentId = idValue(req.params.id, 'Appointment ID');
  const result = await db.query(`SELECT a.appointment_id, a.appointment_date::text AS appointment_date, a.appointment_status, a.booked_service_price::float8 AS service_price, COALESCE(c.first_name || ' ' || c.last_name, 'Client') AS client, c.email, s.service_name AS service FROM appointments a JOIN users c ON c.user_id = a.user_id JOIN services s ON s.service_id = a.service_id WHERE a.appointment_id = $1`, [appointmentId]);
  if (!result.rows.length) throw new ApiError(404, 'Appointment not found.');
  const appointment = result.rows[0];
  const payments = await db.query(`SELECT payment_id, payment_type, amount::float8 AS amount, method, reference_no, note, status, (created_at AT TIME ZONE 'Asia/Manila')::date::text AS payment_date FROM payments WHERE appointment_id = $1 ORDER BY created_at, payment_id`, [appointmentId]);
  const paid = payments.rows.filter((payment) => payment.status === 'posted').reduce((sum, payment) => sum + Number(payment.amount), 0);
  res.json({
    payment: { payment_id: null, appointment_id: appointment.appointment_id, payment_type: 'appointment', amount: appointment.service_price, method: '—', reference_no: null, note: `Outstanding balance: ${Math.max(0, appointment.service_price - paid).toFixed(2)}`, status: appointment.appointment_status, payment_date: appointment.appointment_date, appointment_date: appointment.appointment_date, appointment_status: appointment.appointment_status, service_price: appointment.service_price, client: appointment.client, email: appointment.email, service: appointment.service },
    history: payments.rows,
  });
}));

router.get('/transactions', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const { page, limit, offset } = pageValues(req.query);
  const values = [from, to];
  const where = ["(p.created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1::date AND $2::date"];
  for (const [key, column, allowed, message] of [['type', 'p.payment_type', PAYMENT_TYPES, 'Invalid payment type.'], ['method', 'p.method', METHODS, 'Invalid payment method.']]) {
    if (req.query[key]) {
      if (!allowed.includes(req.query[key])) throw new ApiError(400, message);
      values.push(req.query[key]);
      where.push(`${column} = $${values.length}`);
    }
  }
  if (req.query.q) {
    values.push(`%${String(req.query.q).slice(0, 100)}%`);
    where.push(`(COALESCE(c.first_name || ' ' || c.last_name, '') ILIKE $${values.length} OR COALESCE(p.reference_no, '') ILIKE $${values.length} OR COALESCE(p.note, '') ILIKE $${values.length} OR COALESCE(s.service_name, '') ILIKE $${values.length})`);
  }
  const joins = 'FROM payments p LEFT JOIN appointments a ON a.appointment_id = p.appointment_id LEFT JOIN users c ON c.user_id = a.user_id LEFT JOIN services s ON s.service_id = a.service_id';
  const count = await db.query(`SELECT COUNT(*)::int AS count ${joins} WHERE ${where.join(' AND ')}`, values);
  values.push(limit, offset);
  const result = await db.query(`SELECT p.payment_id, p.appointment_id, p.payment_type, p.amount::float8 AS amount, p.method, p.reference_no, p.note, p.status, p.created_at, (p.created_at AT TIME ZONE 'Asia/Manila')::date::text AS payment_date, a.appointment_date::text AS appointment_date, a.appointment_status, COALESCE(c.first_name || ' ' || c.last_name, 'Product sale') AS client, s.service_name AS service ${joins} WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  res.json({ rows: result.rows, page, limit, total: Number(count.rows[0].count) });
}));

router.get('/receivables', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const result = await db.query(`SELECT a.appointment_id, a.appointment_date::text AS appointment_date, a.booked_service_price::float8 AS service_price, GREATEST(a.booked_service_price - COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'posted' AND ($1::boolean OR p.payment_type <> 'reservation')), 0), 0)::float8 AS outstanding, COALESCE(c.first_name || ' ' || c.last_name, 'Client') AS client, c.email, s.service_name AS service FROM appointments a JOIN users c ON c.user_id = a.user_id JOIN services s ON s.service_id = a.service_id LEFT JOIN payments p ON p.appointment_id = a.appointment_id WHERE a.appointment_status = 'completed' AND a.appointment_date BETWEEN $2::date AND $3::date GROUP BY a.appointment_id, c.user_id, s.service_id HAVING GREATEST(a.booked_service_price - COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'posted' AND ($1::boolean OR p.payment_type <> 'reservation')), 0), 0) > 0 ORDER BY a.appointment_date, a.appointment_id`, [DEPOSIT_DEDUCTED_FROM_PRICE, from, to]);
  res.json(result.rows);
}));

router.post('/payments', endpoint(async (req, res) => {
  const body = req.body || {};
  if (!PAYMENT_TYPES.includes(body.payment_type)) throw new ApiError(400, 'Invalid payment type.');
  if (!METHODS.includes(body.method)) throw new ApiError(400, 'Invalid payment method.');
  const amount = amountValue(body.amount);
  const appointmentId = body.appointment_id == null ? null : idValue(body.appointment_id, 'Appointment ID');
  if (body.payment_type === 'balance' && !appointmentId) throw new ApiError(400, 'Balance payments require an appointment.');
  if (body.payment_type === 'reservation') throw new ApiError(400, 'Reservation payments are recorded during checkout.');
  const reference = body.reference_no == null || body.reference_no === '' ? null : String(body.reference_no).trim().slice(0, 100);
  const note = body.note == null || body.note === '' ? null : String(body.note).trim().slice(0, 2000);
  const result = await db.transaction(async (client) => {
    if (body.payment_type === 'balance') {
      const appointment = await client.query(`SELECT booked_service_price FROM appointments WHERE appointment_id = $1 AND appointment_status = 'completed' FOR UPDATE`, [appointmentId]);
      if (!appointment.rows.length) throw new ApiError(404, 'Completed appointment not found.');
      const paid = await client.query(`SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE appointment_id = $1 AND status = 'posted' AND ($2::boolean OR payment_type <> 'reservation')`, [appointmentId, DEPOSIT_DEDUCTED_FROM_PRICE]);
      const outstanding = Math.max(0, Number(appointment.rows[0].booked_service_price) - Number(paid.rows[0].paid));
      if (amount > outstanding) throw new ApiError(400, `Payment exceeds the outstanding balance of ${outstanding.toFixed(2)}.`);
    }
    return client.query(`INSERT INTO payments (appointment_id, payment_type, amount, method, reference_no, note, recorded_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING payment_id, appointment_id, payment_type, amount::float8 AS amount, method, reference_no, note, status, created_at`, [appointmentId, body.payment_type, amount, body.method, reference, note, req.session.userId || null]);
  });
  res.status(201).json(result.rows[0]);
}));

router.post('/payments/:id/refund', endpoint(async (req, res) => {
  const paymentId = idValue(req.params.id, 'Payment ID');
  const note = String(req.body?.note || '').trim();
  if (!note || note.length > 2000) throw new ApiError(400, 'A refund note of 1 to 2000 characters is required.');
  const result = await db.query(`UPDATE payments SET status = 'refunded', note = CONCAT_WS(E'\\n', NULLIF(note, ''), $1) WHERE payment_id = $2 AND payment_type = 'reservation' AND status = 'posted' RETURNING payment_id, appointment_id, amount::float8 AS amount, status, note`, [`Refund note: ${note}`, paymentId]);
  if (!result.rows.length) throw new ApiError(404, 'Posted reservation payment not found.');
  res.json(result.rows[0]);
}));

function expenseInput(body) {
  if (!validDate(body.expense_date)) throw new ApiError(400, 'Expense date must use YYYY-MM-DD.');
  if (!EXPENSE_CATEGORIES.includes(body.category)) throw new ApiError(400, 'Invalid expense category.');
  const description = String(body.description || '').trim();
  if (!description || description.length > 5000) throw new ApiError(400, 'Description is required and must be at most 5000 characters.');
  return { date: body.expense_date, category: body.category, description, amount: amountValue(body.amount), supplier: body.supplier == null || body.supplier === '' ? null : String(body.supplier).trim().slice(0, 150), reference: body.reference_no == null || body.reference_no === '' ? null : String(body.reference_no).trim().slice(0, 100) };
}

router.get('/expenses', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const { page, limit, offset } = pageValues(req.query);
  const values = [from, to];
  const where = ['expense_date BETWEEN $1::date AND $2::date'];
  if (req.query.category) {
    if (!EXPENSE_CATEGORIES.includes(req.query.category)) throw new ApiError(400, 'Invalid expense category.');
    values.push(req.query.category); where.push(`category = $${values.length}`);
  }
  if (req.query.q) { values.push(`%${String(req.query.q).slice(0, 100)}%`); where.push(`(description ILIKE $${values.length} OR COALESCE(supplier, '') ILIKE $${values.length} OR COALESCE(reference_no, '') ILIKE $${values.length})`); }
  const count = await db.query(`SELECT COUNT(*)::int AS count FROM expenses WHERE ${where.join(' AND ')}`, values);
  values.push(limit, offset);
  const result = await db.query(`SELECT expense_id, expense_date::text AS expense_date, category, description, amount::float8 AS amount, supplier, reference_no, created_at, voided_at, voided_by, void_reason FROM expenses WHERE ${where.join(' AND ')} ORDER BY expense_date DESC, expense_id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  res.json({ rows: result.rows, page, limit, total: Number(count.rows[0].count) });
}));

router.post('/expenses', endpoint(async (req, res) => {
  const expense = expenseInput(req.body || {});
  const result = await db.query(`INSERT INTO expenses (expense_date, category, description, amount, supplier, reference_no, recorded_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING expense_id, expense_date::text AS expense_date, category, description, amount::float8 AS amount, supplier, reference_no`, [expense.date, expense.category, expense.description, expense.amount, expense.supplier, expense.reference, req.session.userId || null]);
  res.status(201).json(result.rows[0]);
}));

router.patch('/expenses/:id', endpoint(async (req, res) => {
  const expenseId = idValue(req.params.id, 'Expense ID');
  const expense = expenseInput(req.body || {});
  const result = await db.query(`UPDATE expenses SET expense_date = $1, category = $2, description = $3, amount = $4, supplier = $5, reference_no = $6 WHERE expense_id = $7 AND voided_at IS NULL RETURNING expense_id, expense_date::text AS expense_date, category, description, amount::float8 AS amount, supplier, reference_no`, [expense.date, expense.category, expense.description, expense.amount, expense.supplier, expense.reference, expenseId]);
  if (!result.rows.length) throw new ApiError(404, 'Active expense not found.');
  res.json(result.rows[0]);
}));

router.post('/expenses/:id/void', endpoint(async (req, res) => {
  const expenseId = idValue(req.params.id, 'Expense ID');
  const reason = String(req.body?.reason || '').trim();
  if (!reason || reason.length > 2000) throw new ApiError(400, 'A void reason of 1 to 2000 characters is required.');
  const result = await db.query(`UPDATE expenses SET voided_at = NOW(), voided_by = $1, void_reason = $2 WHERE expense_id = $3 AND voided_at IS NULL RETURNING expense_id, voided_at, void_reason`, [req.session.userId || null, reason, expenseId]);
  if (!result.rows.length) throw new ApiError(404, 'Active expense not found.');
  res.json(result.rows[0]);
}));

router.get('/report', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.query);
  res.json(await reportData(from, to));
}));

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function sendCsv(res, headers, rows, filename) {
  const body = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\uFEFF${body}`);
}

const peso = (value) => `PHP ${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
router.get('/export.csv', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const section = req.query.section;
  if (!['transactions', 'expenses', 'income-statement', 'daily-cash'].includes(section)) throw new ApiError(400, 'Invalid export section.');
  if (section === 'transactions') {
    const result = await db.query(`SELECT (p.created_at AT TIME ZONE 'Asia/Manila')::date::text AS date, p.payment_type, p.method, p.amount::float8 AS amount, p.status, p.reference_no, p.note, COALESCE(c.first_name || ' ' || c.last_name, 'Product sale') AS client FROM payments p LEFT JOIN appointments a ON a.appointment_id = p.appointment_id LEFT JOIN users c ON c.user_id = a.user_id WHERE (p.created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1::date AND $2::date ORDER BY p.created_at`, [from, to]);
    sendCsv(res, ['Date', 'Type', 'Method', 'Amount (PHP)', 'Status', 'Reference', 'Note', 'Client'], result.rows.map((row) => [row.date, row.payment_type, row.method, peso(row.amount), row.status, row.reference_no, row.note, row.client]), 'finance-transactions.csv'); return;
  }
  if (section === 'expenses') {
    const result = await db.query(`SELECT expense_date::text AS date, category, description, amount::float8 AS amount, supplier, reference_no, CASE WHEN voided_at IS NULL THEN 'active' ELSE 'voided' END AS status, void_reason FROM expenses WHERE expense_date BETWEEN $1::date AND $2::date ORDER BY expense_date, expense_id`, [from, to]);
    sendCsv(res, ['Date', 'Category', 'Description', 'Amount (PHP)', 'Supplier', 'Reference', 'Status', 'Void reason'], result.rows.map((row) => [row.date, row.category, row.description, peso(row.amount), row.supplier, row.reference_no, row.status, row.void_reason]), 'finance-expenses.csv'); return;
  }
  const report = await reportData(from, to);
  if (section === 'income-statement') {
    const income = report.income_statement;
    sendCsv(res, ['Item', 'Amount (PHP)'], [['Sales', peso(income.sales)], ['Collected', peso(income.collected)], ['Expenses', peso(income.expenses)], ['Net income (collected less expenses)', peso(income.net_income)]], 'finance-income-statement.csv'); return;
  }
  sendCsv(res, ['Date', 'Collected (PHP)', 'Expenses (PHP)'], report.daily_cash.map((row) => [row.date, peso(row.collected), peso(row.expenses)]), 'finance-daily-cash.csv');
}));

module.exports = router;