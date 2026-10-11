const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { DEPOSIT_DEDUCTED_FROM_PRICE, NO_SHOW_DEPOSIT_IS_INCOME } = require('../utils/financeRules');
const { notifyRoles } = require('../utils/notifications');

const router = express.Router();
const PAYMENT_TYPES = ['reservation', 'balance', 'product_sale'];
const METHODS = ['paymongo', 'cash', 'gcash', 'maya', 'card'];
const PAYMENT_STATUSES = ['posted', 'refunded', 'reversed'];
const EXPENSE_CATEGORIES = ['Inventory & Supplies', 'Salaries & Commissions', 'Rent', 'Utilities', 'Marketing', 'Equipment Maintenance', 'Other'];
const RETAINED_DEPOSIT_REVENUE = `(
  (a.appointment_status = 'no_show' AND $3::boolean)
  OR (a.appointment_status = 'cancelled'
    AND POSITION('[DEPOSIT_FORFEITED]' IN COALESCE(p.note, '')) > 0)
)`;
router.use(requireRole('finance_officer', 'admin'));

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function manilaDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function manilaTimestamp(date = new Date()) {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return `${formatted} Asia/Manila`;
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

function missingPurchaseSchema(error) {
  if (error.code === '42703' && error.column === 'product_name') {
    throw new ApiError(503, 'Inventory transaction names are not installed. Run npm run migrate:inventory-transactions against the database configured for this server, then try again.');
  }
  if (error.code === '42P01'
    && ['inventory_purchase_batches', 'inventory_purchase_records', 'product_sale_details'].includes(error.table)) {
    throw new ApiError(503, 'Finance inventory sales are not installed. Run npm run migrate:finance-sales-purchases against the database configured for this server, then try again.');
  }
}

function financeQuery(sql, values) {
  return db.query(sql, values).catch((error) => {
    if (error.code === '42P01' && error.table === 'payment_reversals') {
      throw new ApiError(503, 'The payment reversal audit table is not installed. Apply the approved payment reversal migration, then try again.');
    }
    missingPurchaseSchema(error);
    throw error;
  });
}

function pageValues(query, defaultLimit = 25) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? defaultLimit : Number(query.limit);
  if (!Number.isSafeInteger(page) || page < 1) throw new ApiError(400, 'Page must be a positive integer.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'Limit must be between 1 and 100.');
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) throw new ApiError(400, 'Page is too large.');
  return { page, limit, offset };
}

function boundedPageValues(query, defaultLimit, maxLimit) {
  const values = pageValues(query, defaultLimit);
  if (values.limit > maxLimit) throw new ApiError(400, `Limit must be between 1 and ${maxLimit}.`);
  return values;
}

function cashClosingSchemaError(error) {
  if (error.code === '42P01'
    && (error.table === 'cash_closings' || String(error.message).includes('"cash_closings"'))) {
    throw new ApiError(503, 'Cash closing is not installed. Run npm run migrate:finance-dashboard against this database, then try again.');
  }
  throw error;
}

async function lockCashBusinessDate(client, businessDate) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    [`finance-cash-date:${businessDate}`]
  );
}

async function assertBusinessDateOpen(client, businessDate, recordType = 'Cash receipts') {
  await lockCashBusinessDate(client, businessDate);
  let closing;
  try {
    closing = await client.query(
      'SELECT 1 FROM cash_closings WHERE business_date = $1::date',
      [businessDate]
    );
  } catch (error) {
    cashClosingSchemaError(error);
  }
  if (closing.rows.length) {
    throw new ApiError(409, `Cash closing for ${businessDate} is already recorded. ${recordType} for this date are closed.`);
  }
}

async function lockCurrentCashBusinessDateIfOpen(client) {
  const dateResult = await client.query(`
    SELECT (NOW() AT TIME ZONE 'Asia/Manila')::date::text AS business_date
  `);
  await assertBusinessDateOpen(client, dateResult.rows[0].business_date);
}

function cashAmountValue(value) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new ApiError(400, 'Counted cash must be a non-negative amount with at most two decimal places.');
  }
  const text = String(value).trim();
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(text)) {
    throw new ApiError(400, 'Counted cash must be a non-negative amount with at most two decimal places.');
  }
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount > 999999999999.99) {
    throw new ApiError(400, 'Counted cash exceeds the supported amount.');
  }
  return amount.toFixed(2);
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
  WHERE p.payment_type = 'reservation' AND p.status = 'posted'
    AND ${RETAINED_DEPOSIT_REVENUE} AND a.appointment_date BETWEEN $1::date AND $2::date
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
  const [sales, collected, expenses, daily, onlineReservations, categoryRows, deposits, services, expenseCategories] = await Promise.all([
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
    db.query(`
      SELECT day::date::text AS date, COUNT(p.payment_id)::int AS count
      FROM generate_series($1::date, $2::date, '1 day') day
      LEFT JOIN payments p ON (p.created_at AT TIME ZONE 'Asia/Manila')::date = day::date
        AND p.payment_type = 'reservation' AND p.status = 'posted'
        AND EXISTS (
          SELECT 1
          FROM paymongo_checkout_sessions checkout
          WHERE checkout.reference_number = p.reference_no
            AND checkout.payment_id IS NOT NULL
        )
      GROUP BY day ORDER BY day
    `, [from, to]),
    db.query(`SELECT category, SUM(amount)::float8 AS amount FROM (
      SELECT s.category, a.booked_service_price::numeric AS amount FROM appointments a JOIN services s ON s.service_id = a.service_id
      WHERE a.appointment_status = 'completed' AND a.appointment_date BETWEEN $1::date AND $2::date
      UNION ALL
      SELECT s.category, p.amount FROM appointments a JOIN services s ON s.service_id = a.service_id JOIN payments p ON p.appointment_id = a.appointment_id
      WHERE p.payment_type = 'reservation' AND p.status = 'posted' AND ${RETAINED_DEPOSIT_REVENUE} AND a.appointment_date BETWEEN $1::date AND $2::date
    ) revenue GROUP BY category ORDER BY amount DESC`, [from, to, NO_SHOW_DEPOSIT_IS_INCOME]),
    db.query(`SELECT CASE WHEN p.status = 'refunded' THEN 'refunded' WHEN p.status = 'reversed' THEN 'reversed' WHEN a.appointment_status = 'no_show' OR (a.appointment_status = 'cancelled' AND POSITION('[DEPOSIT_FORFEITED]' IN COALESCE(p.note, '')) > 0) THEN 'forfeited' ELSE 'paid' END AS status, COUNT(*)::int AS count, SUM(p.amount)::float8 AS amount FROM payments p LEFT JOIN appointments a ON a.appointment_id = p.appointment_id WHERE p.payment_type = 'reservation' AND (p.created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1::date AND $2::date GROUP BY 1 ORDER BY 1`, [from, to]),
    db.query(`SELECT service, SUM(amount)::float8 AS amount, COUNT(*)::int AS count FROM (
      SELECT s.service_name AS service, a.booked_service_price::numeric AS amount FROM appointments a JOIN services s ON s.service_id = a.service_id
      WHERE a.appointment_status = 'completed' AND a.appointment_date BETWEEN $1::date AND $2::date
      UNION ALL
      SELECT s.service_name, p.amount FROM appointments a JOIN services s ON s.service_id = a.service_id JOIN payments p ON p.appointment_id = a.appointment_id
      WHERE p.payment_type = 'reservation' AND p.status = 'posted' AND ${RETAINED_DEPOSIT_REVENUE} AND a.appointment_date BETWEEN $1::date AND $2::date
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
    generated_at: manilaTimestamp(),
    date_basis: 'Sales earned uses completed appointment dates, posted eligible product-sale payment dates, and retained deposits under the active finance rules. Cash collected includes posted payments across all methods by payment date in Asia/Manila. Expenses use expense_date.',
    accounting_basis: 'Mixed operational metrics. Net cash after expenses is posted collections less non-voided recorded expenses; expense payment method is not stored, so this is not a complete cash-flow statement.',
    active_filters: 'Date range only',
    income_statement: { sales: totalSales, collected: totalCollected, expenses: totalExpenses, net_income: totalCollected - totalExpenses, outstanding_balance: await outstandingBalance() },
    daily_cash: daily.rows.map((row) => ({ ...row, collected: Number(row.collected), expenses: Number(row.expenses) })),
    online_reservations: onlineReservations.rows.map((row) => ({ ...row, count: Number(row.count) })),
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

router.get('/activity', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const { page, limit, offset } = boundedPageValues(req.query, 10, 50);
  const result = await db.query(`
    SELECT activity_date::text AS activity_date, activity_type, category, method,
      amount, status
    FROM (
      SELECT (payment.created_at AT TIME ZONE 'Asia/Manila')::date AS activity_date,
        payment.created_at AS sort_at, payment.payment_id AS source_id,
        'payment'::text AS activity_type, payment.payment_type AS category,
        payment.method::text AS method, payment.amount::float8 AS amount,
        payment.status::text AS status
      FROM payments payment
      WHERE payment.created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Manila')
        AND payment.created_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Manila')
      UNION ALL
      SELECT expense.expense_date AS activity_date, expense.created_at AS sort_at,
        expense.expense_id AS source_id, 'expense'::text AS activity_type,
        expense.category::text AS category, NULL::text AS method,
        expense.amount::float8 AS amount,
        CASE WHEN expense.voided_at IS NULL THEN 'active' ELSE 'voided' END AS status
      FROM expenses expense
      WHERE expense.expense_date BETWEEN $1::date AND $2::date
    ) activity
    ORDER BY activity_date DESC, sort_at DESC, source_id DESC
    LIMIT $3 OFFSET $4
  `, [from, to, limit, offset]);
  res.json({ rows: result.rows.map((row) => ({ ...row, amount: Number(row.amount) })), page, limit, from, to });
}));

router.get('/appointment-trends', endpoint(async (req, res) => {
  const months = req.query.months === undefined ? 6 : Number(req.query.months);
  if (!Number.isInteger(months) || months < 1 || months > 24) {
    throw new ApiError(400, 'Months must be between 1 and 24.');
  }
  const to = manilaDate();
  const [year, month] = to.slice(0, 7).split('-').map(Number);
  const from = new Date(Date.UTC(year, month - months, 1)).toISOString().slice(0, 10);
  const result = await db.query(`
    WITH months AS (
      SELECT generate_series(
        date_trunc('month', $1::date),
        date_trunc('month', $2::date),
        INTERVAL '1 month'
      )::date AS month_start
    )
    SELECT to_char(months.month_start, 'YYYY-MM') AS month,
      COUNT(appointment.appointment_id) FILTER (WHERE appointment.appointment_status = 'confirmed')::int AS confirmed,
      COUNT(appointment.appointment_id) FILTER (WHERE appointment.appointment_status = 'in_progress')::int AS in_progress,
      COUNT(appointment.appointment_id) FILTER (WHERE appointment.appointment_status = 'completed')::int AS completed,
      COUNT(appointment.appointment_id) FILTER (WHERE appointment.appointment_status = 'cancelled')::int AS cancelled,
      COUNT(appointment.appointment_id) FILTER (WHERE appointment.appointment_status = 'no_show')::int AS no_show
    FROM months
    LEFT JOIN appointments appointment
      ON appointment.appointment_date >= months.month_start
      AND appointment.appointment_date < months.month_start + INTERVAL '1 month'
      AND appointment.appointment_date <= $2::date
      AND appointment.appointment_status IN ('confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')
    GROUP BY months.month_start
    ORDER BY months.month_start
  `, [from, to]);
  res.json({
    from,
    to,
    rows: result.rows.map((row) => {
      const confirmed = Number(row.confirmed);
      const inProgress = Number(row.in_progress);
      const completed = Number(row.completed);
      const cancelled = Number(row.cancelled);
      const noShow = Number(row.no_show);
      return {
        month: row.month,
        confirmed,
        in_progress: inProgress,
        completed,
        cancelled,
        no_show: noShow,
        total: confirmed + inProgress + completed + cancelled + noShow,
      };
    }),
  });
}));

router.get('/cash-closing', endpoint(async (req, res) => {
  const businessDate = req.query.date === undefined ? manilaDate() : req.query.date;
  if (!validDate(businessDate)) throw new ApiError(400, 'Business date must use YYYY-MM-DD.');

  let existing;
  try {
    const result = await db.query(`
      SELECT closing.business_date::text AS business_date,
        closing.expected_amount::float8 AS expected_amount,
        closing.actual_amount::float8 AS actual_amount,
        closing.variance::float8 AS variance,
        closing.closed_by, closing.closed_at,
        CONCAT_WS(' ', NULLIF(user_record.first_name, ''), NULLIF(user_record.last_name, '')) AS closed_by_name
      FROM cash_closings closing
      JOIN users user_record ON user_record.user_id = closing.closed_by
      WHERE closing.business_date = $1::date
    `, [businessDate]);
    existing = result.rows[0] || null;
  } catch (error) {
    cashClosingSchemaError(error);
  }

  let expectedAmount = existing?.expected_amount;
  if (expectedAmount === undefined) {
    const expected = await db.query(`
      SELECT COALESCE(SUM(amount), 0)::numeric(14, 2)::float8 AS expected_amount
      FROM payments
      WHERE method = 'cash'
        AND status = 'posted'
        AND created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Manila')
        AND created_at < (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Manila')
    `, [businessDate]);
    expectedAmount = Number(expected.rows[0].expected_amount);
  }

  res.json({
    business_date: businessDate,
    expected_amount: Number(expectedAmount),
    closing: existing,
  });
}));

router.get('/cash-closing/history', endpoint(async (req, res) => {
  const { page, limit, offset } = boundedPageValues(req.query, 10, 50);
  try {
    const result = await db.query(`
      SELECT closing.business_date::text AS business_date,
        closing.expected_amount::float8 AS expected_amount,
        closing.actual_amount::float8 AS actual_amount,
        closing.variance::float8 AS variance,
        closing.closed_at,
        CONCAT_WS(' ', NULLIF(user_record.first_name, ''), NULLIF(user_record.last_name, '')) AS closed_by_name,
        COUNT(*) OVER()::int AS total
      FROM cash_closings closing
      JOIN users user_record ON user_record.user_id = closing.closed_by
      ORDER BY closing.business_date DESC, closing.cash_closing_id DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    res.json({
      rows: result.rows.map(({ total, ...row }) => ({
        ...row,
        expected_amount: Number(row.expected_amount),
        actual_amount: Number(row.actual_amount),
        variance: Number(row.variance),
      })),
      total: Number(result.rows[0]?.total || 0),
      page,
      limit,
    });
  } catch (error) {
    cashClosingSchemaError(error);
  }
}));

router.post('/cash-closing', endpoint(async (req, res) => {
  const businessDate = req.body?.business_date;
  if (!validDate(businessDate)) throw new ApiError(400, 'Business date must use YYYY-MM-DD.');
  if (businessDate > manilaDate()) throw new ApiError(400, 'Future business dates cannot be closed.');
  const actualAmount = cashAmountValue(req.body?.actual_amount);
  let closing;
  try {
    closing = await db.transaction(async (client) => {
      await lockCashBusinessDate(client, businessDate);
      const expected = await client.query(`
        SELECT COALESCE(SUM(amount), 0)::numeric(14, 2)::text AS expected_amount
        FROM payments
        WHERE method = 'cash'
          AND status = 'posted'
          AND created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Manila')
          AND created_at < (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Manila')
      `, [businessDate]);
      const result = await client.query(`
        INSERT INTO cash_closings
          (business_date, expected_amount, actual_amount, variance, closed_by)
        VALUES ($1::date, $2::numeric, $3::numeric, $3::numeric - $2::numeric, $4)
        ON CONFLICT (business_date) DO NOTHING
        RETURNING cash_closing_id, business_date::text AS business_date,
          expected_amount::float8 AS expected_amount,
          actual_amount::float8 AS actual_amount,
          variance::float8 AS variance, closed_by, closed_at
      `, [businessDate, expected.rows[0].expected_amount, actualAmount, req.session.userId]);
      if (!result.rows.length) {
        throw new ApiError(409, 'A cash closing already exists for this business date. Closings cannot be revised.');
      }
      return result.rows[0];
    });
  } catch (error) {
    cashClosingSchemaError(error);
  }

  const variance = Number(closing.variance);
  if (variance !== 0) {
    await notifyRoles(
      ['finance_officer', 'admin'],
      'finance_cash_closing_discrepancy',
      `Cash closing for ${businessDate} shows a ${variance < 0 ? 'shortage' : 'surplus'} of PHP ${Math.abs(variance).toFixed(2)}.`,
      { excludeUserIds: [Number(req.session.userId)], email: false }
    );
  }
  res.status(201).json({ closing: { ...closing, expected_amount: Number(closing.expected_amount), actual_amount: Number(closing.actual_amount), variance } });
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
      UNION ALL SELECT date_trunc('month', a.appointment_date)::date, p.amount FROM appointments a JOIN payments p ON p.appointment_id = a.appointment_id WHERE p.payment_type = 'reservation' AND p.status = 'posted' AND ${RETAINED_DEPOSIT_REVENUE} AND a.appointment_date BETWEEN $1::date AND $2::date
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
    where.push(`(COALESCE(NULLIF(CONCAT_WS(' ', NULLIF(BTRIM(c.first_name), ''), NULLIF(BTRIM(c.last_name), '')), ''), a.walk_in_name, '') ILIKE $${values.length} OR COALESCE(p.reference_no, '') ILIKE $${values.length} OR COALESCE(p.note, '') ILIKE $${values.length} OR COALESCE(s.service_name, '') ILIKE $${values.length} OR COALESCE(sale.product_name, '') ILIKE $${values.length})`);
  }
  const result = await db.query(`SELECT p.method, SUM(p.amount)::float8 AS amount, COUNT(*)::int AS count FROM payments p LEFT JOIN appointments a ON a.appointment_id = p.appointment_id LEFT JOIN users c ON c.user_id = a.user_id LEFT JOIN services s ON s.service_id = a.service_id LEFT JOIN product_sale_details sale ON sale.payment_id = p.payment_id WHERE ${where.join(' AND ')} GROUP BY p.method ORDER BY amount DESC`, values);
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
    WHERE p.payment_type = 'reservation' AND p.status = 'posted' AND ${RETAINED_DEPOSIT_REVENUE} AND a.appointment_date BETWEEN $1::date AND $2::date
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
    WHERE p.payment_type = 'reservation' AND p.status = 'posted' AND ${RETAINED_DEPOSIT_REVENUE} AND a.appointment_date BETWEEN $1::date AND $2::date
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

router.get('/expenses/machine-trend', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.query);
  if (req.query.category && !EXPENSE_CATEGORIES.includes(req.query.category)) {
    throw new ApiError(400, 'Invalid expense category.');
  }
  if (req.query.category && req.query.category !== 'Equipment Maintenance') {
    return res.json([]);
  }

  const values = [from, to];
  const where = [
    'voided_at IS NULL',
    'expense_date BETWEEN $1::date AND $2::date',
    "category = 'Equipment Maintenance'",
  ];
  if (req.query.q) {
    values.push(`%${String(req.query.q).slice(0, 100)}%`);
    where.push(`(description ILIKE $${values.length} OR COALESCE(supplier, '') ILIKE $${values.length} OR COALESCE(reference_no, '') ILIKE $${values.length})`);
  }

  const result = await db.query(`
    SELECT date_trunc('week', expense_date)::date::text AS week,
           SUM(amount)::float8 AS amount
    FROM expenses
    WHERE ${where.join(' AND ')}
    GROUP BY date_trunc('week', expense_date)
    ORDER BY date_trunc('week', expense_date)
  `, values);
  res.json(result.rows);
}));

router.get('/deposits', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const result = await db.query(`SELECT p.payment_id, p.appointment_id, p.amount::float8 AS amount, p.method, p.reference_no, p.note, p.status AS payment_status, (p.created_at AT TIME ZONE 'Asia/Manila')::date::text AS payment_date, a.appointment_status, a.appointment_date::text AS appointment_date, COALESCE(NULLIF(CONCAT_WS(' ', NULLIF(BTRIM(c.first_name), ''), NULLIF(BTRIM(c.last_name), '')), ''), a.walk_in_name, 'Client') AS client FROM payments p LEFT JOIN appointments a ON a.appointment_id = p.appointment_id LEFT JOIN users c ON c.user_id = a.user_id WHERE p.payment_type = 'reservation' AND (p.created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1::date AND $2::date ORDER BY p.created_at DESC`, [from, to]);
  res.json(result.rows.map((row) => ({
    ...row,
    deposit_status: row.payment_status === 'refunded'
      ? 'refunded'
      : row.payment_status === 'reversed'
        ? 'reversed'
        : row.appointment_status === 'no_show'
          || (row.appointment_status === 'cancelled' && row.note?.includes('[DEPOSIT_FORFEITED]'))
          ? 'forfeited'
          : 'paid',
  })));
}));

router.get('/payments/:id', endpoint(async (req, res) => {
  dateRange(req.query);
  const paymentId = idValue(req.params.id, 'Payment ID');
  const result = await financeQuery(`SELECT p.payment_id, p.appointment_id, p.payment_type, p.amount::float8 AS amount, p.method, p.reference_no, p.note, p.status, (p.created_at AT TIME ZONE 'Asia/Manila')::date::text AS payment_date, CONCAT('SG-RCT-', TO_CHAR(p.created_at AT TIME ZONE 'Asia/Manila', 'YYYY'), '-', LPAD(p.payment_id::text, 8, '0')) AS receipt_number, a.appointment_date::text AS appointment_date, a.appointment_status, a.booked_service_price::float8 AS service_price, COALESCE(NULLIF(CONCAT_WS(' ', NULLIF(BTRIM(c.first_name), ''), NULLIF(BTRIM(c.last_name), '')), ''), a.walk_in_name, 'Product sale') AS client, c.email, CASE WHEN p.payment_type = 'product_sale' THEN CASE WHEN sale.payment_id IS NOT NULL THEN CONCAT(sale.product_name, ' × ', sale.quantity) ELSE COALESCE(p.note, p.reference_no, 'Product sale') END ELSE s.service_name END AS service, sale.quantity AS product_quantity, sale.unit_price::float8 AS product_unit_price, reversal.reason AS reversal_reason, reversal.reversed_by, reversal.reversed_at FROM payments p LEFT JOIN appointments a ON a.appointment_id = p.appointment_id LEFT JOIN users c ON c.user_id = a.user_id LEFT JOIN services s ON s.service_id = a.service_id LEFT JOIN product_sale_details sale ON sale.payment_id = p.payment_id LEFT JOIN payment_reversals reversal ON reversal.payment_id = p.payment_id WHERE p.payment_id = $1`, [paymentId]);
  if (!result.rows.length) throw new ApiError(404, 'Payment not found.');
  const payment = result.rows[0];
  let history = [];
  if (payment.appointment_id) {
    const payments = await db.query(`SELECT payment_id, payment_type, amount::float8 AS amount, method, reference_no, note, status, (created_at AT TIME ZONE 'Asia/Manila')::date::text AS payment_date FROM payments WHERE appointment_id = $1 ORDER BY created_at, payment_id`, [payment.appointment_id]);
    history = payments.rows;
  }
  res.json({ payment, history });
}));

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

router.get('/payments/:id/receipt', endpoint(async (req, res) => {
  const paymentId = idValue(req.params.id, 'Payment ID');
  const result = await financeQuery(`
    SELECT payment.payment_id, payment.payment_type, payment.amount::float8 AS amount,
      payment.method, payment.reference_no, payment.note, payment.status,
      (payment.created_at AT TIME ZONE 'Asia/Manila')::date::text AS payment_date,
      reversal.reason AS reversal_reason, reversal.reversed_by, reversal.reversed_at,
      COALESCE(NULLIF(CONCAT_WS(' ', NULLIF(BTRIM(customer.first_name), ''),
        NULLIF(BTRIM(customer.last_name), '')), ''), appointment.walk_in_name,
        CASE WHEN payment.payment_type = 'product_sale' THEN 'Retail sale' ELSE 'Client' END) AS client,
      service.service_name,
      sale.product_name, sale.quantity, sale.unit_price::float8 AS unit_price
    FROM payments payment
    LEFT JOIN appointments appointment ON appointment.appointment_id = payment.appointment_id
    LEFT JOIN users customer ON customer.user_id = appointment.user_id
    LEFT JOIN services service ON service.service_id = appointment.service_id
    LEFT JOIN product_sale_details sale ON sale.payment_id = payment.payment_id
    LEFT JOIN payment_reversals reversal ON reversal.payment_id = payment.payment_id
    WHERE payment.payment_id = $1
  `, [paymentId]);
  if (!result.rows.length) throw new ApiError(404, 'Payment not found.');

  const payment = result.rows[0];
  const safe = (value) => escapeHtml(value);
  const money = (value) => new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(Number(value));
  const number = receiptNumber(payment.payment_id, payment.payment_date);
  const detail = payment.payment_type === 'product_sale' && payment.product_name
    ? `${payment.product_name} × ${payment.quantity}`
    : payment.service_name || payment.payment_type.replace('_', ' ');
  const unitPrice = payment.product_name
    ? `<p>Unit price: <strong>${safe(money(payment.unit_price))}</strong></p>`
    : '';
  const isPosted = payment.status === 'posted';
  const documentTitle = isPosted
    ? 'Payment receipt'
    : payment.status === 'refunded'
      ? 'Refund adjustment notice'
      : payment.status === 'reversed'
        ? 'Payment reversal notice'
        : 'Payment status adjustment notice';
  const refundAuditNote = String(payment.note || '').split(/\r?\n/)
    .filter((line) => /^(Manual cash refund recorded|PayMongo refund completed)/.test(line.trim()))
    .join('\n') || 'Not recorded';
  let adjustmentDetails = '';
  if (!isPosted) {
    const adjustmentReason = payment.status === 'reversed'
      ? `<p>Reversal reason: ${safe(payment.reversal_reason || 'Not recorded')}</p>
         <p>Reversed at: ${safe(payment.reversed_at || 'Not recorded')} · user ID: ${safe(payment.reversed_by || 'Not recorded')}</p>`
      : `<p>Refund audit note: <span style="white-space:pre-wrap">${safe(refundAuditNote)}</span></p>`;
    adjustmentDetails = `
      <p><strong>This is an adjustment notice, not proof of a current valid payment.</strong></p>
      ${adjustmentReason}`;
  }
  const receipt = `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${safe(documentTitle)} ${safe(number)}</title>
        <style>
          body{font:16px/1.5 Arial,sans-serif;color:#242424;margin:0;padding:32px}
          main{max-width:680px;margin:0 auto;border:1px solid #ddd;padding:32px}
          h1{font-size:24px;margin:0 0 4px}h2{font-size:20px;margin:24px 0 8px}
          .muted{color:#666}.receipt-number{font-weight:700;font-size:18px}
          dl{display:grid;grid-template-columns:1fr auto;gap:8px 16px;margin:24px 0}
          dt{color:#555}dd{margin:0;text-align:right}
          .total{border-top:1px solid #ddd;padding-top:16px;font-size:20px;font-weight:700}
          .actions{margin:24px auto 0;max-width:680px;display:flex;justify-content:flex-end}
          button{padding:10px 18px;background:#B5892A;border:0;border-radius:6px;color:white;font:inherit;cursor:pointer}
          @media print{body{padding:0}main{border:0;padding:0}.actions{display:none}}
        </style>
      </head>
      <body>
        <main>
          <h1>Skin Goddess Aesthetic Center</h1>
          <p class="muted">${safe(documentTitle)}</p>
          <p class="receipt-number">${isPosted ? 'Receipt no.' : 'Original transaction reference:'} ${safe(number)}</p>
          ${!isPosted ? '<p><strong>Original transaction; status is not posted.</strong></p>' : ''}
          <dl>
            <dt>Payment date</dt><dd>${safe(payment.payment_date)}</dd>
            <dt>Received from</dt><dd>${safe(payment.client)}</dd>
            <dt>Payment method</dt><dd>${safe(paymentMethodLabel(payment.method))}</dd>
            <dt>Status</dt><dd>${safe(payment.status)}</dd>
            <dt>Reference</dt><dd>${safe(payment.reference_no || '—')}</dd>
          </dl>
          <h2>Transaction details</h2>
          <p>${safe(detail)}</p>
          ${payment.product_name ? `<p>Quantity: <strong>${safe(payment.quantity)}</strong></p>${unitPrice}` : ''}
          ${adjustmentDetails}
          <p class="total">${isPosted ? 'Total received' : 'Original payment amount'}: ${safe(money(payment.amount))}</p>
        </main>
        <div class="actions"><button type="button" onclick="window.print()">${isPosted ? 'Print receipt' : 'Print adjustment notice'}</button></div>
      </body>
    </html>`;
  res.setHeader('Cache-Control', 'private, no-store');
  res.type('html').send(receipt);
}));

router.get('/appointments/:id', endpoint(async (req, res) => {
  dateRange(req.query);
  const appointmentId = idValue(req.params.id, 'Appointment ID');
  const result = await db.query(`SELECT a.appointment_id, a.appointment_date::text AS appointment_date, a.appointment_status, a.booked_service_price::float8 AS service_price, COALESCE(NULLIF(CONCAT_WS(' ', NULLIF(BTRIM(c.first_name), ''), NULLIF(BTRIM(c.last_name), '')), ''), a.walk_in_name, 'Client') AS client, c.email, s.service_name AS service FROM appointments a LEFT JOIN users c ON c.user_id = a.user_id JOIN services s ON s.service_id = a.service_id WHERE a.appointment_id = $1`, [appointmentId]);
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
  if (req.query.status && req.query.status !== 'all') {
    if (!PAYMENT_STATUSES.includes(req.query.status)) throw new ApiError(400, 'Invalid payment status.');
    values.push(req.query.status);
    where.push(`p.status = $${values.length}`);
  }
  if (req.query.q) {
    values.push(`%${String(req.query.q).slice(0, 100)}%`);
    where.push(`(COALESCE(NULLIF(CONCAT_WS(' ', NULLIF(BTRIM(c.first_name), ''), NULLIF(BTRIM(c.last_name), '')), ''), a.walk_in_name, '') ILIKE $${values.length} OR COALESCE(p.reference_no, '') ILIKE $${values.length} OR COALESCE(p.note, '') ILIKE $${values.length} OR COALESCE(s.service_name, '') ILIKE $${values.length} OR COALESCE(sale.product_name, '') ILIKE $${values.length})`);
  }
  const joins = 'FROM payments p LEFT JOIN appointments a ON a.appointment_id = p.appointment_id LEFT JOIN users c ON c.user_id = a.user_id LEFT JOIN services s ON s.service_id = a.service_id LEFT JOIN product_sale_details sale ON sale.payment_id = p.payment_id';
  const count = await financeQuery(`SELECT COUNT(*)::int AS count ${joins} WHERE ${where.join(' AND ')}`, values);
  values.push(limit, offset);
  const result = await financeQuery(`SELECT p.payment_id, p.appointment_id, p.payment_type, p.amount::float8 AS amount, p.method, p.reference_no, p.note, p.status, p.created_at, (p.created_at AT TIME ZONE 'Asia/Manila')::date::text AS payment_date, CONCAT('SG-RCT-', TO_CHAR(p.created_at AT TIME ZONE 'Asia/Manila', 'YYYY'), '-', LPAD(p.payment_id::text, 8, '0')) AS receipt_number, a.appointment_date::text AS appointment_date, a.appointment_status, COALESCE(NULLIF(CONCAT_WS(' ', NULLIF(BTRIM(c.first_name), ''), NULLIF(BTRIM(c.last_name), '')), ''), a.walk_in_name, 'Product sale') AS client, CASE WHEN p.payment_type = 'product_sale' THEN CASE WHEN sale.payment_id IS NOT NULL THEN CONCAT(sale.product_name, ' × ', sale.quantity) ELSE COALESCE(p.note, p.reference_no, 'Product sale') END ELSE s.service_name END AS service ${joins} WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  res.json({ rows: result.rows, page, limit, total: Number(count.rows[0].count) });
}));

router.get('/sale-products', endpoint(async (req, res) => {
  const result = await db.query(`
    SELECT product_id, product_name, stock_quantity
    FROM inventory_products
    WHERE stock_quantity > 0
    ORDER BY product_name, product_id
  `);
  res.json(result.rows);
}));

router.get('/receivables', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const hasDateFilter = req.query.from !== undefined || req.query.to !== undefined;
  const dateClause = hasDateFilter ? 'AND a.appointment_date BETWEEN $2::date AND $3::date' : '';
  const values = hasDateFilter
    ? [DEPOSIT_DEDUCTED_FROM_PRICE, from, to]
    : [DEPOSIT_DEDUCTED_FROM_PRICE];
  const result = await db.query(`SELECT a.appointment_id, a.appointment_date::text AS appointment_date, a.booked_service_price::float8 AS service_price, GREATEST(a.booked_service_price - COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'posted' AND ($1::boolean OR p.payment_type <> 'reservation')), 0), 0)::float8 AS outstanding, COALESCE(NULLIF(CONCAT_WS(' ', NULLIF(BTRIM(c.first_name), ''), NULLIF(BTRIM(c.last_name), '')), ''), a.walk_in_name, 'Client') AS client, c.email, s.service_name AS service FROM appointments a LEFT JOIN users c ON c.user_id = a.user_id JOIN services s ON s.service_id = a.service_id LEFT JOIN payments p ON p.appointment_id = a.appointment_id WHERE a.appointment_status = 'completed' ${dateClause} GROUP BY a.appointment_id, c.user_id, s.service_id HAVING GREATEST(a.booked_service_price - COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'posted' AND ($1::boolean OR p.payment_type <> 'reservation')), 0), 0) > 0 ORDER BY a.appointment_date, a.appointment_id`, values);
  res.json(result.rows);
}));

router.post('/payments', endpoint(async (req, res) => {
  const body = req.body || {};
  if (!PAYMENT_TYPES.includes(body.payment_type)) throw new ApiError(400, 'Invalid payment type.');
  if (!METHODS.includes(body.method)) throw new ApiError(400, 'Invalid payment method.');
  if (body.payment_type === 'product_sale') {
    throw new ApiError(400, 'Use the Record Sale form so the inventory deduction and payment are recorded together.');
  }
  const amount = amountValue(body.amount);
  const appointmentId = body.payment_type === 'product_sale'
    ? null
    : body.appointment_id == null ? null : idValue(body.appointment_id, 'Appointment ID');
  if (body.payment_type === 'balance' && !appointmentId) throw new ApiError(400, 'Balance payments require an appointment.');
  if (body.payment_type === 'reservation') throw new ApiError(400, 'Reservation payments are recorded during checkout.');
  const reference = body.reference_no == null || body.reference_no === '' ? null : String(body.reference_no).trim().slice(0, 100);
  const note = body.note == null || body.note === '' ? null : String(body.note).trim().slice(0, 2000);
  const result = await db.transaction(async (client) => {
    if (body.method === 'cash') await lockCurrentCashBusinessDateIfOpen(client);
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

router.post('/product-sales', endpoint(async (req, res) => {
  const body = req.body || {};
  const requestKey = typeof body.request_key === 'string' ? body.request_key.toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestKey)) {
    throw new ApiError(400, 'A valid sale request key is required.');
  }
  const productId = idValue(body.product_id, 'Product ID');
  const quantity = Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) {
    throw new ApiError(400, 'Quantity must be a positive whole number.');
  }
  if (!METHODS.includes(body.method)) throw new ApiError(400, 'Invalid payment method.');
  const unitPrice = amountValue(body.unit_price);
  const unitPriceCents = Math.round(unitPrice * 100);
  const totalCents = unitPriceCents * quantity;
  if (!Number.isSafeInteger(totalCents) || totalCents > 9999999999) {
    throw new ApiError(400, 'Sale total must not exceed 99999999.99.');
  }
  const total = (totalCents / 100).toFixed(2);
  const reference = body.reference_no == null || body.reference_no === ''
    ? null
    : String(body.reference_no).trim().slice(0, 100);

  let sale;
  try {
    sale = await db.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`finance-sale:${requestKey}`]);
      const duplicate = await client.query(`
        SELECT payment.payment_id, payment.amount::float8 AS amount, payment.method,
          payment.reference_no, payment.status, detail.product_id, detail.product_name,
          detail.quantity, detail.unit_price::float8 AS unit_price
        FROM product_sale_details detail
        JOIN payments payment ON payment.payment_id = detail.payment_id
        WHERE detail.request_key = $1
      `, [requestKey]);
      if (duplicate.rows.length) {
        const existing = duplicate.rows[0];
        if (Number(existing.product_id) !== productId
          || Number(existing.quantity) !== quantity
          || Math.round(Number(existing.unit_price) * 100) !== unitPriceCents
          || existing.method !== body.method
          || existing.reference_no !== reference) {
          throw new ApiError(409, 'This sale request key was already used for different sale details.');
        }
        return { ...existing, replayed: true };
      }

      if (body.method === 'cash') await lockCurrentCashBusinessDateIfOpen(client);

      const productResult = await client.query(`
        SELECT product_id, product_name, stock_quantity
        FROM inventory_products
        WHERE product_id = $1
        FOR UPDATE
      `, [productId]);
      if (!productResult.rows.length) throw new ApiError(404, 'Inventory product not found.');
      const product = productResult.rows[0];
      const previousStock = Number(product.stock_quantity);
      if (previousStock < quantity) {
        throw new ApiError(409, `Only ${previousStock} unit${previousStock === 1 ? '' : 's'} remain in stock.`);
      }
      const newStock = previousStock - quantity;
      await client.query(`
        UPDATE inventory_products
        SET stock_quantity = $1, updated_at = NOW()
        WHERE product_id = $2
      `, [newStock, productId]);
      const payment = await client.query(`
        INSERT INTO payments
          (appointment_id, payment_type, amount, method, reference_no, note, recorded_by)
        VALUES (NULL, 'product_sale', $1, $2, $3, $4, $5)
        RETURNING payment_id, appointment_id, payment_type, amount::float8 AS amount,
          method, reference_no, note, status, created_at
      `, [total, body.method, reference, `Product sale: ${product.product_name}`, req.session.userId || null]);
      await client.query(`
        INSERT INTO product_sale_details
          (payment_id, product_id, product_name, quantity, unit_price, request_key)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [payment.rows[0].payment_id, productId, product.product_name, quantity, (unitPriceCents / 100).toFixed(2), requestKey]);
      await client.query(`
        INSERT INTO inventory_transactions
          (product_id, product_name, transaction_type, quantity, previous_stock, new_stock, created_by, created_at)
        VALUES ($1, $2, 'Sale', $3, $4, $5, $6, NOW())
      `, [productId, product.product_name, -quantity, previousStock, newStock, req.session.userId || null]);
      return {
        ...payment.rows[0],
        product_id: productId,
        product_name: product.product_name,
        quantity,
        unit_price: unitPriceCents / 100,
        stock_quantity: newStock,
        replayed: false
      };
    });
  } catch (error) {
    missingPurchaseSchema(error);
    throw error;
  }
  res.status(sale.replayed ? 200 : 201).json(sale);
}));
router.post('/payments/:id/refund', endpoint(async (req, res) => {
  const paymentId = idValue(req.params.id, 'Payment ID');
  const note = String(req.body?.note || '').trim();
  if (!note || note.length > 2000) throw new ApiError(400, 'A refund note of 1 to 2000 characters is required.');
  const payment = await db.transaction(async (client) => {
    const existing = await client.query(`
      SELECT p.payment_id, p.appointment_id, p.payment_type, p.method, p.status, p.note,
             (p.created_at AT TIME ZONE 'Asia/Manila')::date::text AS business_date,
             a.appointment_status
      FROM payments p
      LEFT JOIN appointments a ON a.appointment_id = p.appointment_id
      WHERE p.payment_id = $1
      FOR UPDATE OF p
    `, [paymentId]);
    if (!existing.rows.length) throw new ApiError(404, 'Reservation payment not found.');

    const row = existing.rows[0];
    if (row.payment_type !== 'reservation') throw new ApiError(400, 'Only reservation deposits can be marked refunded.');
    if (row.status === 'refunded') throw new ApiError(409, 'This payment has already been refunded.');
    if (row.status !== 'posted') throw new ApiError(409, 'Only posted reservation payments can be refunded.');
    if (row.appointment_status === 'no_show') throw new ApiError(409, 'No-show reservation deposits are forfeited and cannot be refunded.');
    if (row.note?.includes('[DEPOSIT_FORFEITED]')) throw new ApiError(409, 'Forfeited reservation deposits cannot be refunded.');
    if (row.appointment_status !== 'cancelled') throw new ApiError(409, 'Only canceled appointment deposits are eligible for a manual refund.');
    if (row.method !== 'cash') {
      throw new ApiError(409, 'Online payments must be successfully refunded through PayMongo before they can be marked refunded.');
    }
    await assertBusinessDateOpen(client, row.business_date, 'Cash payments');

    const auditNote = await client.query(`
      UPDATE payments
      SET status = 'refunded',
          note = CONCAT_WS(E'\\n', NULLIF(note, ''),
            FORMAT('Manual cash refund recorded by user %s at %s: %s', $1::text, NOW(), $2::text))
      WHERE payment_id = $3 AND status = 'posted'
      RETURNING payment_id, appointment_id, amount::float8 AS amount, status, note
    `, [req.session.userId, note, paymentId]);
    if (!auditNote.rows.length) throw new ApiError(409, 'This payment is no longer eligible for refund.');

    if (row.appointment_id !== null) {
      await client.query(
        `UPDATE appointments SET payment_status = 'refunded' WHERE appointment_id = $1`,
        [row.appointment_id]
      );
    }
    return auditNote.rows[0];
  });
  res.json(payment);
}));

router.post('/payments/:id/reverse', endpoint(async (req, res) => {
  const paymentId = idValue(req.params.id, 'Payment ID');
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!reason || reason.length > 2000) {
    throw new ApiError(400, 'A reversal reason of 1 to 2000 characters is required.');
  }

  const reversal = await db.transaction(async (client) => {
    const existing = await client.query(
      `SELECT payment_id, appointment_id, payment_type, method, status,
        (created_at AT TIME ZONE 'Asia/Manila')::date::text AS business_date
       FROM payments WHERE payment_id = $1 FOR UPDATE`,
      [paymentId]
    );
    if (!existing.rows.length) throw new ApiError(404, 'Payment not found.');
    if (existing.rows[0].status !== 'posted') {
      throw new ApiError(409, 'Only posted payments can be reversed. This payment may already be reversed or refunded.');
    }
    if (existing.rows[0].method === 'cash') {
      await assertBusinessDateOpen(client, existing.rows[0].business_date, 'Cash payments');
    }
    let saleDetails = null;
    if (existing.rows[0].payment_type === 'product_sale') {
      const sale = await client.query(`
        SELECT product_id, product_name, quantity
        FROM product_sale_details
        WHERE payment_id = $1
        FOR UPDATE
      `, [paymentId]);
      if (!sale.rows.length) {
        throw new ApiError(409, 'This legacy product sale has no inventory detail and cannot be reversed safely.');
      }
      saleDetails = sale.rows[0];
    }

    const audit = await client.query(`
      INSERT INTO payment_reversals (payment_id, reason, reversed_by)
      VALUES ($1, $2, $3)
      RETURNING reversal_id, payment_id, reason, reversed_by, reversed_at
    `, [paymentId, reason, req.session.userId]);

    const updated = await client.query(`
      UPDATE payments SET status = 'reversed'
      WHERE payment_id = $1 AND status = 'posted'
      RETURNING payment_id, status
    `, [paymentId]);
    if (!updated.rows.length) throw new ApiError(409, 'This payment is no longer eligible for reversal.');

    if (saleDetails) {
      const stock = await client.query(`
        UPDATE inventory_products
        SET stock_quantity = stock_quantity + $1, updated_at = NOW()
        WHERE product_id = $2
        RETURNING stock_quantity
      `, [saleDetails.quantity, saleDetails.product_id]);
      if (!stock.rows.length) throw new ApiError(409, 'The sale product no longer exists in inventory.');
      const newStock = Number(stock.rows[0].stock_quantity);
      const previousStock = newStock - Number(saleDetails.quantity);
      await client.query(`
        INSERT INTO inventory_transactions
          (product_id, product_name, transaction_type, quantity, previous_stock, new_stock, created_by, created_at)
        VALUES ($1, $2, 'Sale Reversed', $3, $4, $5, $6, NOW())
      `, [saleDetails.product_id, saleDetails.product_name, saleDetails.quantity, previousStock, newStock, req.session.userId || null]);
    }

    if (existing.rows[0].payment_type === 'reservation' && existing.rows[0].appointment_id !== null) {
      await client.query(
        `UPDATE appointments SET payment_status = 'unpaid' WHERE appointment_id = $1`,
        [existing.rows[0].appointment_id]
      );
    }

    return { ...updated.rows[0], ...audit.rows[0] };
  });
  await notifyRoles(
    ['finance_officer', 'admin'],
    'finance_payment_reversed',
    `Payment ${paymentId} was reversed.`,
    { excludeUserIds: [Number(req.session.userId)], email: false }
  );
  res.json(reversal);
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
  const result = await db.transaction(async (client) => {
    await assertBusinessDateOpen(client, expense.date, 'Expense entries');
    return client.query(`INSERT INTO expenses (expense_date, category, description, amount, supplier, reference_no, recorded_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING expense_id, expense_date::text AS expense_date, category, description, amount::float8 AS amount, supplier, reference_no`, [expense.date, expense.category, expense.description, expense.amount, expense.supplier, expense.reference, req.session.userId || null]);
  });
  res.status(201).json(result.rows[0]);
}));

router.get('/expenses/:id/history', endpoint(async (req, res) => {
  const expenseId = idValue(req.params.id, 'Expense ID');
  const result = await db.query(`
    SELECT history.expense_edit_history_id, history.expense_id,
      history.edited_at, history.edited_by,
      CONCAT_WS(' ', NULLIF(BTRIM(editor.first_name), ''), NULLIF(BTRIM(editor.last_name), '')) AS editor_name,
      history.previous_values, history.updated_values
    FROM expense_edit_history history
    JOIN users editor ON editor.user_id = history.edited_by
    WHERE history.expense_id = $1
    ORDER BY history.edited_at DESC, history.expense_edit_history_id DESC
    LIMIT 100
  `, [expenseId]);
  res.json({ rows: result.rows });
}));

router.get('/inventory-purchase-suggestions', endpoint(async (req, res) => {
  let result;
  try {
    result = await db.query(`
      SELECT purchase.purchase_id, purchase.product_name, purchase.quantity,
        purchase.unit_price::float8 AS unit_price,
        (purchase.quantity * purchase.unit_price)::float8 AS suggested_amount,
        purchase.purchase_date::text AS purchase_date,
        CONCAT('INV-PURCHASE-', purchase.purchase_id) AS reference_no
      FROM inventory_purchase_records purchase
      WHERE purchase.expense_id IS NULL AND purchase.unit_price > 0
      ORDER BY purchase.purchase_date, purchase.purchase_id
      LIMIT 100
    `);
  } catch (error) {
    missingPurchaseSchema(error);
    throw error;
  }
  res.json(result.rows);
}));

router.post('/inventory-purchase-suggestions/:id/expense', endpoint(async (req, res) => {
  const purchaseId = idValue(req.params.id, 'Purchase ID');
  const body = req.body || {};
  if (!validDate(body.expense_date)) throw new ApiError(400, 'Expense date must use YYYY-MM-DD.');
  const description = String(body.description || '').trim();
  if (!description || description.length > 5000) {
    throw new ApiError(400, 'Description is required and must be at most 5000 characters.');
  }
  const amount = amountValue(body.amount);
  const supplier = body.supplier == null || body.supplier === ''
    ? null
    : String(body.supplier).trim().slice(0, 150);
  const reference = body.reference_no == null || body.reference_no === ''
    ? null
    : String(body.reference_no).trim().slice(0, 100);

  let result;
  try {
    result = await db.transaction(async (client) => {
      const purchase = await client.query(`
        SELECT purchase_id, expense_id
        FROM inventory_purchase_records
        WHERE purchase_id = $1
        FOR UPDATE
      `, [purchaseId]);
      if (!purchase.rows.length) throw new ApiError(404, 'Inventory purchase suggestion not found.');
      if (purchase.rows[0].expense_id !== null) {
        const existing = await client.query(`
          SELECT expense_id, expense_date::text AS expense_date, category, description,
            amount::float8 AS amount, supplier, reference_no
          FROM expenses
          WHERE expense_id = $1
        `, [purchase.rows[0].expense_id]);
        if (!existing.rows.length) throw new ApiError(409, 'This purchase was already linked to an expense.');
        return { expense: existing.rows[0], replayed: true };
      }

      await assertBusinessDateOpen(client, body.expense_date, 'Expense entries');
      const expense = await client.query(`
        INSERT INTO expenses
          (expense_date, category, description, amount, supplier, reference_no, recorded_by)
        VALUES ($1, 'Inventory & Supplies', $2, $3, $4, $5, $6)
        RETURNING expense_id, expense_date::text AS expense_date, category, description,
          amount::float8 AS amount, supplier, reference_no
      `, [body.expense_date, description, amount, supplier, reference, req.session.userId || null]);
      const linked = await client.query(`
        UPDATE inventory_purchase_records
        SET expense_id = $1, reviewed_by = $2, reviewed_at = NOW()
        WHERE purchase_id = $3 AND expense_id IS NULL
        RETURNING purchase_id
      `, [expense.rows[0].expense_id, req.session.userId || null, purchaseId]);
      if (!linked.rows.length) throw new ApiError(409, 'This purchase was already recorded as an expense.');
      return { expense: expense.rows[0], replayed: false };
    });
  } catch (error) {
    missingPurchaseSchema(error);
    throw error;
  }
  res.status(result.replayed ? 200 : 201).json(result);
}));

router.patch('/expenses/:id', endpoint(async (req, res) => {
  const expenseId = idValue(req.params.id, 'Expense ID');
  const expense = expenseInput(req.body || {});
  const updated = await db.transaction(async (client) => {
    const current = await client.query(`
      SELECT expense_id, expense_date::text AS expense_date, category, description,
        amount::text AS amount, supplier, reference_no
      FROM expenses
      WHERE expense_id = $1 AND voided_at IS NULL
      FOR UPDATE
    `, [expenseId]);
    if (!current.rows.length) throw new ApiError(404, 'Active expense not found.');

    const { expense_id: currentExpenseId, ...previousValues } = current.rows[0];
    const updatedValues = {
      expense_date: expense.date,
      category: expense.category,
      description: expense.description,
      amount: expense.amount.toFixed(2),
      supplier: expense.supplier,
      reference_no: expense.reference,
    };
    const changed = Object.keys(updatedValues).some((key) => (
      String(previousValues[key] ?? '') !== String(updatedValues[key] ?? '')
    ));
    if (!changed) {
      return {
        expense_id: currentExpenseId,
        ...updatedValues,
        amount: Number(previousValues.amount),
      };
    }

    for (const businessDate of [...new Set([previousValues.expense_date, expense.date])].sort()) {
      await assertBusinessDateOpen(client, businessDate, 'Expense records');
    }

    const result = await client.query(`
      UPDATE expenses
      SET expense_date = $1, category = $2, description = $3, amount = $4,
        supplier = $5, reference_no = $6
      WHERE expense_id = $7 AND voided_at IS NULL
      RETURNING expense_id, expense_date::text AS expense_date, category, description,
        amount::float8 AS amount, supplier, reference_no
    `, [expense.date, expense.category, expense.description, expense.amount, expense.supplier, expense.reference, expenseId]);
    if (!result.rows.length) throw new ApiError(404, 'Active expense not found.');

    await client.query(`
      INSERT INTO expense_edit_history
        (expense_id, edited_by, previous_values, updated_values)
      VALUES ($1, $2, $3::jsonb, $4::jsonb)
    `, [
      expenseId,
      req.session.userId,
      JSON.stringify(previousValues),
      JSON.stringify(updatedValues),
    ]);
    return result.rows[0];
  });
  res.json(updated);
}));

router.post('/expenses/:id/void', endpoint(async (req, res) => {
  const expenseId = idValue(req.params.id, 'Expense ID');
  const reason = String(req.body?.reason || '').trim();
  if (!reason || reason.length > 2000) throw new ApiError(400, 'A void reason of 1 to 2000 characters is required.');
  const result = await db.transaction(async (client) => {
    const expense = await client.query(`
      SELECT expense_id, expense_date::text AS expense_date
      FROM expenses
      WHERE expense_id = $1 AND voided_at IS NULL
      FOR UPDATE
    `, [expenseId]);
    if (!expense.rows.length) throw new ApiError(404, 'Active expense not found.');
    await assertBusinessDateOpen(client, expense.rows[0].expense_date, 'Expense records');
    return client.query(`
      UPDATE expenses
      SET voided_at = NOW(), voided_by = $1, void_reason = $2
      WHERE expense_id = $3 AND voided_at IS NULL
      RETURNING expense_id, voided_at, void_reason
    `, [req.session.userId || null, reason, expenseId]);
  });
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

function activeFilterSummary(section, query = {}) {
  const filters = [];
  if (section === 'transactions') {
    filters.push(`Status: ${query.status || 'all'}`);
    if (query.type) filters.push(`Payment type: ${query.type}`);
    if (query.method) filters.push(`Payment method: ${paymentMethodLabel(query.method)}`);
  }
  if (section === 'expenses' && query.category) filters.push(`Category: ${query.category}`);
  if (query.q && ['transactions', 'expenses'].includes(section)) filters.push('Search: applied');
  return filters.length ? filters.join('; ') : 'None beyond selected date range';
}

function exportDateBasis(section) {
  if (section === 'transactions') {
    return 'Payment received date in Asia/Manila; amount is the original transaction amount, with refunded/reversed status shown separately.';
  }
  if (section === 'expenses') {
    return 'Expense date (expense_date); active and voided records are included. Expense payment method is not stored.';
  }
  if (section === 'daily-cash') {
    return 'Posted payments across all methods by received date in Asia/Manila and non-voided expense_date.';
  }
  return 'Sales earned: completed appointment date, eligible product-sale payment date, and retained-deposit rules. Cash collected: posted payment date. Expenses: expense_date.';
}

function exportAccountingBasis(section) {
  if (section === 'transactions') {
    return 'Payment ledger; amounts are gross original payment records, not a net cash adjustment total.';
  }
  if (section === 'expenses') {
    return 'Expense register by expense_date; the current model does not record settlement method.';
  }
  return 'Mixed operational metrics. Net cash after expenses is posted collections less non-voided recorded expenses; expense payment method is not stored, so this is not a complete cash-flow statement.';
}

function exportMetadataRows(from, to, section, query = {}) {
  return [
    ['Generated at (Asia/Manila)', manilaTimestamp()],
    ['Selected date range', `${from} to ${to}`],
    ['Date basis', exportDateBasis(section)],
    ['Calculation basis', exportAccountingBasis(section)],
    ['Active filters', activeFilterSummary(section, query)],
  ];
}

function sendCsvWithMetadata(res, headers, rows, filename, from, to, section, query = {}) {
  sendCsv(res, [...exportMetadataRows(from, to, section, query), [], headers], rows, filename);
}

const peso = (value) => `PHP ${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function paymentMethodLabel(method) {
  return method === 'paymongo' ? 'PayMongo (Other)' : method;
}

function receiptNumber(paymentId, paymentDate) {
  return `SG-RCT-${String(paymentDate).slice(0, 4)}-${String(paymentId).padStart(8, '0')}`;
}

async function transactionExportRows(from, to, query) {
  const values = [from, to];
  const where = ["(payment.created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1::date AND $2::date"];
  for (const [key, column, allowed, message] of [
    ['type', 'payment.payment_type', PAYMENT_TYPES, 'Invalid payment type.'],
    ['method', 'payment.method', METHODS, 'Invalid payment method.'],
  ]) {
    if (query[key]) {
      if (!allowed.includes(query[key])) throw new ApiError(400, message);
      values.push(query[key]);
      where.push(`${column} = $${values.length}`);
    }
  }
  if (query.status && query.status !== 'all') {
    if (!PAYMENT_STATUSES.includes(query.status)) throw new ApiError(400, 'Invalid payment status.');
    values.push(query.status);
    where.push(`payment.status = $${values.length}`);
  }
  if (query.q) {
    values.push(`%${String(query.q).slice(0, 100)}%`);
    where.push(`(
      COALESCE(NULLIF(CONCAT_WS(' ', NULLIF(BTRIM(customer.first_name), ''),
        NULLIF(BTRIM(customer.last_name), '')), ''), appointment.walk_in_name, '') ILIKE $${values.length}
      OR COALESCE(payment.reference_no, '') ILIKE $${values.length}
      OR COALESCE(payment.note, '') ILIKE $${values.length}
      OR COALESCE(service.service_name, '') ILIKE $${values.length}
      OR COALESCE(sale.product_name, '') ILIKE $${values.length}
    )`);
  }
  return financeQuery(`
    SELECT payment.payment_id,
      appointment.appointment_date::text AS appointment_date,
      (payment.created_at AT TIME ZONE 'Asia/Manila')::date::text AS date,
      CONCAT('SG-RCT-', TO_CHAR(payment.created_at AT TIME ZONE 'Asia/Manila', 'YYYY'),
        '-', LPAD(payment.payment_id::text, 8, '0')) AS receipt_number,
      payment.payment_type, payment.method, payment.amount::float8 AS amount,
      payment.status, payment.reference_no, payment.note,
      COALESCE(NULLIF(CONCAT_WS(' ', NULLIF(BTRIM(customer.first_name), ''),
        NULLIF(BTRIM(customer.last_name), '')), ''), appointment.walk_in_name,
        'Product sale') AS client,
      CASE WHEN payment.payment_type = 'product_sale'
        THEN CASE WHEN sale.payment_id IS NOT NULL
          THEN CONCAT(sale.product_name, ' × ', sale.quantity)
          ELSE COALESCE(payment.note, payment.reference_no, 'Product sale')
        END
        ELSE COALESCE(service.service_name, payment.reference_no, '')
      END AS details
    FROM payments payment
    LEFT JOIN appointments appointment ON appointment.appointment_id = payment.appointment_id
    LEFT JOIN users customer ON customer.user_id = appointment.user_id
    LEFT JOIN services service ON service.service_id = appointment.service_id
    LEFT JOIN product_sale_details sale ON sale.payment_id = payment.payment_id
    WHERE ${where.join(' AND ')}
    ORDER BY payment.created_at, payment.payment_id
  `, values);
}

async function salesEarnedExportRows(from, to) {
  return financeQuery(`
    SELECT sale_date::text AS date, source, record_id, receipt_number, appointment_id,
      client, details, payment_status, appointment_status, amount::float8 AS amount,
      recognition_rule
    FROM (
      SELECT appointment.appointment_date AS sale_date,
        'Completed appointment'::text AS source,
        CONCAT('APT-', appointment.appointment_id)::text AS record_id,
        NULL::text AS receipt_number,
        appointment.appointment_id::text AS appointment_id,
        COALESCE(NULLIF(CONCAT_WS(' ', NULLIF(BTRIM(customer.first_name), ''),
          NULLIF(BTRIM(customer.last_name), '')), ''), appointment.walk_in_name, 'Client') AS client,
        service.service_name::text AS details,
        'not applicable'::text AS payment_status,
        appointment.appointment_status::text AS appointment_status,
        appointment.booked_service_price::numeric AS amount,
        'Booked service price on completed appointment date'::text AS recognition_rule
      FROM appointments appointment
      LEFT JOIN users customer ON customer.user_id = appointment.user_id
      JOIN services service ON service.service_id = appointment.service_id
      WHERE appointment.appointment_status = 'completed'
        AND appointment.appointment_date BETWEEN $1::date AND $2::date

      UNION ALL

      SELECT (payment.created_at AT TIME ZONE 'Asia/Manila')::date,
        'Posted product sale'::text,
        CONCAT('PAY-', payment.payment_id)::text,
        CONCAT('SG-RCT-', TO_CHAR(payment.created_at AT TIME ZONE 'Asia/Manila', 'YYYY'),
          '-', LPAD(payment.payment_id::text, 8, '0')),
        appointment.appointment_id::text,
        COALESCE(NULLIF(CONCAT_WS(' ', NULLIF(BTRIM(customer.first_name), ''),
          NULLIF(BTRIM(customer.last_name), '')), ''), appointment.walk_in_name, 'Product sale'),
        CASE WHEN sale.payment_id IS NOT NULL
          THEN CONCAT(sale.product_name, ' × ', sale.quantity)
          ELSE COALESCE(payment.note, payment.reference_no, 'Product sale')
        END,
        payment.status::text,
        COALESCE(appointment.appointment_status::text, 'not applicable'),
        payment.amount::numeric,
        'Posted product-sale amount on payment receipt date'
      FROM payments payment
      LEFT JOIN appointments appointment ON appointment.appointment_id = payment.appointment_id
      LEFT JOIN users customer ON customer.user_id = appointment.user_id
      LEFT JOIN product_sale_details sale ON sale.payment_id = payment.payment_id
      WHERE payment.payment_type = 'product_sale' AND payment.status = 'posted'
        AND (payment.created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1::date AND $2::date

      UNION ALL

      SELECT appointment.appointment_date,
        CASE WHEN appointment.appointment_status = 'no_show'
          THEN 'Retained no-show deposit'
          ELSE 'Forfeited cancellation deposit'
        END,
        CONCAT('PAY-', payment.payment_id)::text,
        CONCAT('SG-RCT-', TO_CHAR(payment.created_at AT TIME ZONE 'Asia/Manila', 'YYYY'),
          '-', LPAD(payment.payment_id::text, 8, '0')),
        appointment.appointment_id::text,
        COALESCE(NULLIF(CONCAT_WS(' ', NULLIF(BTRIM(customer.first_name), ''),
          NULLIF(BTRIM(customer.last_name), '')), ''), appointment.walk_in_name, 'Client'),
        service.service_name::text,
        payment.status::text,
        appointment.appointment_status::text,
        payment.amount::numeric,
        CASE WHEN appointment.appointment_status = 'no_show'
          THEN 'Retained under the configured no-show deposit rule'
          ELSE 'Cancellation deposit explicitly marked forfeited'
        END
      FROM appointments appointment
      JOIN payments payment ON payment.appointment_id = appointment.appointment_id
      LEFT JOIN users customer ON customer.user_id = appointment.user_id
      JOIN services service ON service.service_id = appointment.service_id
      WHERE payment.payment_type = 'reservation' AND payment.status = 'posted'
        AND (
          (appointment.appointment_status = 'no_show' AND $3::boolean)
          OR (appointment.appointment_status = 'cancelled'
            AND POSITION('[DEPOSIT_FORFEITED]' IN COALESCE(payment.note, '')) > 0)
        )
        AND appointment.appointment_date BETWEEN $1::date AND $2::date
    ) earned
    ORDER BY sale_date, record_id
  `, [from, to, NO_SHOW_DEPOSIT_IS_INCOME]);
}

async function incomeStatementDetailRows(from, to) {
  const [sales, payments, expenses] = await Promise.all([
    salesEarnedExportRows(from, to),
    transactionExportRows(from, to, { status: 'all' }),
    expenseExportRows(from, to, {}),
  ]);
  return { sales: sales.rows, payments: payments.rows, expenses: expenses.rows };
}

async function expenseExportRows(from, to, query) {
  const values = [from, to];
  const where = ['expense_date BETWEEN $1::date AND $2::date'];
  if (query.category) {
    if (!EXPENSE_CATEGORIES.includes(query.category)) throw new ApiError(400, 'Invalid expense category.');
    values.push(query.category);
    where.push(`category = $${values.length}`);
  }
  if (query.q) {
    values.push(`%${String(query.q).slice(0, 100)}%`);
    where.push(`(description ILIKE $${values.length} OR COALESCE(supplier, '') ILIKE $${values.length} OR COALESCE(reference_no, '') ILIKE $${values.length})`);
  }
  return db.query(`
    SELECT expense_id, expense_date::text AS date, category, description, amount::float8 AS amount,
      supplier, reference_no,
      CASE WHEN voided_at IS NULL THEN 'active' ELSE 'voided' END AS status,
      void_reason
    FROM expenses
    WHERE ${where.join(' AND ')}
    ORDER BY expense_date, expense_id
  `, values);
}

function spreadsheetDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

// Keep exported workbooks visually distinct from the warm website palette.
// Neutral slate with a restrained blue accent stays readable in print and on screen.
const EXCEL_STYLE = {
  navy: 'FF1F2937',
  blue: 'FF2563EB',
  slate: 'FF475569',
  band: 'FFF8FAFC',
  total: 'FFEFF6FF',
  border: 'FF93C5FD',
};

async function sendFinanceWorkbook(res, section, from, to, records, query = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Skin Goddess Aesthetic Center';
  workbook.subject = `${section === 'transactions' ? 'Payment ledger' : 'Expense register'} ${from} to ${to}`;
  workbook.title = `Finance ${section} export ${from} to ${to}`;
  const transactions = section === 'transactions';
  const headers = transactions
    ? ['Date', 'Receipt number', 'Client', 'Type', 'Details', 'Payment method', 'Amount (PHP)', 'Status', 'Reference', 'Note']
    : ['Date', 'Category', 'Description', 'Amount (PHP)', 'Supplier', 'Reference', 'Status', 'Void reason'];
  const amounts = records.reduce((total, record) => total + Number(record.amount || 0), 0);
  const worksheet = addReportDetailSheet(workbook, {
    name: transactions ? 'Payment Ledger' : 'Expense Register',
    title: transactions ? 'Payment Ledger' : 'Expense Register',
    from,
    to,
    description: transactions
      ? 'Payment records by Manila receipt date. Amounts are original transaction amounts; use the Status column when reconciling posted collections.'
      : 'Expense records by expense date. Voided entries remain available for audit context and should be excluded from active expense totals.',
    headers,
    widths: transactions
      ? [15, 22, 26, 18, 36, 20, 18, 15, 26, 42]
      : [15, 24, 42, 18, 26, 24, 15, 42],
    dateColumns: [1],
    amountColumns: [transactions ? 7 : 4],
    records: records.map((record) => (transactions
      ? [spreadsheetDate(record.date), record.receipt_number, record.client, record.payment_type,
        record.details, paymentMethodLabel(record.method), Number(record.amount), record.status,
        record.reference_no || '', record.note || '']
      : [spreadsheetDate(record.date), record.category, record.description, Number(record.amount),
        record.supplier || '', record.reference_no || '', record.status, record.void_reason || ''])),
    total: {
      label: transactions ? 'Total listed payment amount' : 'Total listed expense amount',
      column: transactions ? 7 : 4,
      value: amounts,
    },
  });
  worksheet.properties.tabColor = { argb: EXCEL_STYLE.navy };

  const metadata = workbook.addWorksheet('Report Information');
  metadata.columns = [{ width: 29 }, { width: 100 }];
  metadata.mergeCells('A1:B1');
  metadata.getCell('A1').value = 'Skin Goddess Aesthetic Center';
  metadata.getCell('A1').font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  metadata.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_STYLE.navy } };
  metadata.getCell('A1').alignment = { vertical: 'middle' };
  metadata.getRow(1).height = 28;
  metadata.mergeCells('A2:B2');
  metadata.getCell('A2').value = transactions ? 'Payment Ledger Export Information' : 'Expense Register Export Information';
  metadata.getCell('A2').font = { bold: true, size: 12, color: { argb: EXCEL_STYLE.navy } };
  metadata.getRow(2).height = 24;
  exportMetadataRows(from, to, section, query).forEach(([label, value]) => metadata.addRow([label, value]));
  for (let rowNumber = 3; rowNumber <= metadata.lastRow.number; rowNumber += 1) {
    const row = metadata.getRow(rowNumber);
    row.height = 28;
    row.getCell(1).font = { bold: true, color: { argb: EXCEL_STYLE.slate } };
    row.getCell(1).alignment = { vertical: 'top', wrapText: true };
    row.getCell(2).alignment = { vertical: 'top', wrapText: true };
    if (rowNumber % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_STYLE.band } };
  }
  metadata.views = [{ state: 'frozen', ySplit: 2 }];
  metadata.pageSetup = { fitToPage: true, fitToWidth: 1, fitToHeight: 1 };
  metadata.properties.tabColor = { argb: EXCEL_STYLE.blue };

  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="finance-${section}-${from}-to-${to}.xlsx"`);
  res.send(Buffer.from(buffer));
}

function configurePrintableTable(worksheet, headerRow, dataEndRow, lastRow, columnCount, totalRow) {
  worksheet.views = [{ state: 'frozen', ySplit: headerRow }];
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${headerRow}:${headerRow}`,
    margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.25 },
    printArea: `A1:${worksheet.getColumn(columnCount).letter}${lastRow}`,
  };
  worksheet.headerFooter.oddFooter = '&LSkin Goddess Aesthetic Center&CFinance report&RPage &P of &N';
  worksheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: Math.max(headerRow, dataEndRow), column: columnCount },
  };
  const header = worksheet.getRow(headerRow);
  header.height = 44;
  header.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_STYLE.navy } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  for (let rowNumber = headerRow + 1; rowNumber <= dataEndRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    let lineCount = 1;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.alignment = { vertical: 'top', wrapText: true };
      const value = cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : String(cell.value ?? '');
      const width = Math.max(10, worksheet.getColumn(columnNumber).width || 12);
      lineCount = Math.max(lineCount, value.split(/\r?\n/).reduce(
        (count, line) => count + Math.max(1, Math.ceil(line.length / width)),
        0
      ));
    });
    row.height = Math.min(390, Math.max(32, lineCount * 16 + 10));
    if ((rowNumber - headerRow) % 2 === 0) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_STYLE.band } };
    }
  }
  if (totalRow) {
    const row = worksheet.getRow(totalRow);
    row.height = 30;
    row.font = { bold: true, color: { argb: EXCEL_STYLE.navy } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_STYLE.total } };
    row.border = { top: { style: 'thin', color: { argb: EXCEL_STYLE.border } } };
  }
}

function addReportDetailSheet(workbook, options) {
  const {
    name, title, from, to, description, headers, widths, records,
    dateColumns = [], amountColumns = [], total = null,
  } = options;
  const worksheet = workbook.addWorksheet(name);
  worksheet.columns = widths.map((width) => ({ width }));
  const columnCount = headers.length;
  [[1, 'Skin Goddess Aesthetic Center'], [2, title], [3, `Reporting period: ${from} to ${to}`], [4, description]]
    .forEach(([rowNumber, value]) => {
      worksheet.mergeCells(rowNumber, 1, rowNumber, columnCount);
      const cell = worksheet.getCell(rowNumber, 1);
      cell.value = value;
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
  worksheet.getCell(1, 1).font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  worksheet.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_STYLE.navy } };
  worksheet.getRow(1).height = 28;
  worksheet.getCell(2, 1).font = { bold: true, size: 13, color: { argb: EXCEL_STYLE.navy } };
  worksheet.getRow(2).height = 23;
  worksheet.getCell(3, 1).font = { bold: true, color: { argb: EXCEL_STYLE.slate } };
  worksheet.getRow(3).height = 20;
  worksheet.getCell(4, 1).font = { italic: true, color: { argb: EXCEL_STYLE.slate } };
  worksheet.getRow(4).height = 30;
  const headerRow = 6;
  headers.forEach((header, index) => {
    worksheet.getCell(headerRow, index + 1).value = header;
  });
  const firstDataRow = headerRow + 1;
  records.forEach((record) => worksheet.addRow(record));
  const dataEndRow = records.length ? worksheet.lastRow.number : headerRow;
  dateColumns.forEach((column) => { worksheet.getColumn(column).numFmt = 'dd mmm yyyy'; });
  amountColumns.forEach((column) => {
    worksheet.getColumn(column).numFmt = '"PHP" #,##0.00;[Red]-"PHP" #,##0.00';
  });
  let totalRow = null;
  if (total) {
    totalRow = worksheet.lastRow.number + 1;
    const row = worksheet.addRow([]);
    row.getCell(1).value = total.label;
    const totalCell = row.getCell(total.column);
    if (records.length) {
      const letter = worksheet.getColumn(total.column).letter;
      totalCell.value = {
        formula: total.formula
          ? total.formula(firstDataRow, dataEndRow, worksheet)
          : `SUM(${letter}${firstDataRow}:${letter}${dataEndRow})`,
        result: Number(total.value),
      };
    } else {
      totalCell.value = Number(total.value);
    }
    totalCell.numFmt = '"PHP" #,##0.00;[Red]-"PHP" #,##0.00';
    totalCell.alignment = { horizontal: 'right' };
  }
  configurePrintableTable(worksheet, headerRow, dataEndRow, worksheet.lastRow.number, columnCount, totalRow);
  amountColumns.forEach((column) => {
    for (let rowNumber = firstDataRow; rowNumber <= (totalRow || dataEndRow); rowNumber += 1) {
      worksheet.getCell(rowNumber, column).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    }
  });
  return worksheet;
}

async function sendIncomeStatementWorkbook(res, from, to, report, chartImages = {}, details) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Skin Goddess Aesthetic Center';
  workbook.subject = `Financial summary ${from} to ${to}`;
  workbook.title = `Finance report ${from} to ${to}`;
  const summary = workbook.addWorksheet('Financial Summary', {
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.35, right: 0.35, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.25 },
    },
  });
  summary.columns = [{ width: 25 }, { width: 20 }, { width: 82 }];
  summary.mergeCells('A1:C1');
  summary.getCell('A1').value = 'Skin Goddess Aesthetic Center';
  summary.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  summary.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_STYLE.navy } };
  summary.getCell('A1').alignment = { vertical: 'middle' };
  summary.getRow(1).height = 30;
  summary.mergeCells('A2:C2');
  summary.getCell('A2').value = 'Financial Summary';
  summary.getCell('A2').font = { bold: true, size: 13, color: { argb: EXCEL_STYLE.navy } };
  summary.getRow(2).height = 24;
  summary.addRow(['Reporting period', `${from} to ${to}`]);
  summary.addRow(['Generated (Asia/Manila)', report.generated_at]);
  [3, 4].forEach((rowNumber) => {
    summary.getRow(rowNumber).getCell(1).font = { bold: true, color: { argb: EXCEL_STYLE.slate } };
  });
  summary.mergeCells('A6:C6');
  summary.getCell('A6').value = 'Key financial measures';
  summary.getCell('A6').font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summary.getCell('A6').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_STYLE.navy } };
  ['Metric', 'Amount (PHP)', 'Interpretation'].forEach((header, index) => {
    summary.getCell(7, index + 1).value = header;
  });
  summary.getRow(7).height = 25;
  summary.getRow(7).eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_STYLE.blue } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  const income = report.income_statement;
  [
    ['Sales earned', Number(income.sales), 'Recognized revenue shown item-by-item on Sales Earned Detail. It is not the same as cash received.'],
    ['Cash collected', Number(income.collected), 'Posted payments by Manila receipt date. Refunded and reversed payments are excluded.'],
    ['Recorded expenses', Number(income.expenses), 'Non-voided expenses by expense date. Voided records remain visible on Expense Register but are excluded.'],
    ['Net cash after expenses', Number(income.net_income), 'Cash collected less recorded expenses; this is not a complete cash-flow statement.'],
  ].forEach((values, index) => {
    const row = summary.addRow(values);
    row.height = 38;
    row.getCell(2).numFmt = '"PHP" #,##0.00;[Red]-"PHP" #,##0.00';
    row.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell(3).alignment = { vertical: 'top', wrapText: true };
    if (index % 2 === 1) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_STYLE.band } };
  });
  summary.getRow(11).font = { bold: true, color: { argb: EXCEL_STYLE.navy } };
  summary.getRow(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_STYLE.total } };
  summary.getRow(11).border = { top: { style: 'thin', color: { argb: EXCEL_STYLE.border } } };
  summary.addRow([]);
  summary.mergeCells('A13:C13');
  summary.getCell('A13').value = 'Calculation and date basis';
  summary.getCell('A13').font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summary.getCell('A13').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_STYLE.navy } };
  [
    ['Sales earned', 'Completed services use booked service price on appointment date; posted product sales use receipt date; retained no-show and explicitly forfeited cancellation deposits follow the configured deposit rules.'],
    ['Cash collected', 'All payment methods are included when posted. Reservation deposits and balances are counted on payment receipt date; refunds and reversals are excluded.'],
    ['Expenses', 'Active expense records are counted by expense date. The application does not record an expense settlement method.'],
    ['Reconciliation', 'See Payment Ledger, Payment References, Expense Register, and Daily Reconciliation for source records and status treatment.'],
  ].forEach((values, index) => {
    const row = summary.addRow([values[0], '', values[1]]);
    row.height = 38;
    row.getCell(1).font = { bold: true, color: { argb: EXCEL_STYLE.slate } };
    row.getCell(3).alignment = { vertical: 'top', wrapText: true };
    if (index % 2 === 1) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_STYLE.band } };
  });
  summary.mergeCells('A18:C18');
  summary.getCell('A18').value = report.accounting_basis;
  summary.getCell('A18').font = { italic: true, size: 9, color: { argb: EXCEL_STYLE.slate } };
  summary.getCell('A18').alignment = { vertical: 'top', wrapText: true };
  summary.getRow(18).height = 42;
  summary.views = [{ state: 'frozen', ySplit: 7 }];
  summary.headerFooter.oddFooter = '&LSkin Goddess Aesthetic Center&CFinance report&RPage &P of &N';
  summary.pageSetup.printArea = 'A1:C18';

  const salesColumns = [
    'Date', 'Revenue source', 'Record ID', 'Receipt number',
    'Client', 'Service / product details', 'Payment / appointment status', 'Sales earned (PHP)',
  ];
  addReportDetailSheet(workbook, {
    name: 'Sales Earned Detail',
    title: 'Sales Earned Detail',
    from, to,
    description: 'Recognized revenue rows that reconcile to Financial Summary. Completed services use booked price; product sales use receipt date; retained deposits follow the configured forfeiture rules.',
    headers: salesColumns,
    widths: [15, 25, 16, 22, 26, 38, 25, 20],
    dateColumns: [1],
    amountColumns: [8],
    records: details.sales.map((row) => [
      spreadsheetDate(row.date), row.source, row.record_id, row.receipt_number || '',
      row.client, row.details,
      [row.payment_status !== 'not applicable' ? row.payment_status : '',
        row.appointment_status !== 'not applicable' ? row.appointment_status : ''].filter(Boolean).join(' / '),
      Number(row.amount),
    ]),
    total: { label: 'Total sales earned', column: 8, value: income.sales },
  });

  addReportDetailSheet(workbook, {
    name: 'Payment Ledger',
    title: 'Payment Ledger — All Statuses',
    from, to,
    description: 'All payment records by Manila receipt date. Amounts are original gross transaction amounts; only posted rows count as cash collected.',
    headers: ['Payment ID', 'Payment date', 'Receipt number', 'Client', 'Payment type',
      'Service / product details', 'Payment method', 'Original amount (PHP)', 'Status'],
    widths: [12, 15, 23, 25, 18, 34, 19, 20, 16],
    dateColumns: [2],
    amountColumns: [8],
    records: details.payments.map((row) => [
      row.payment_id, spreadsheetDate(row.date), row.receipt_number, row.client,
      row.payment_type, row.details, paymentMethodLabel(row.method), Number(row.amount), row.status,
    ]),
    total: {
      label: 'Posted cash collected (ties to summary)',
      column: 8,
      value: income.collected,
      formula: (first, last) => `SUMIF(I${first}:I${last},"posted",H${first}:H${last})`,
    },
  });

  addReportDetailSheet(workbook, {
    name: 'Payment References',
    title: 'Payment Reference and Notes',
    from, to,
    description: 'Cross-reference by Payment ID or receipt number to review appointment dates, external references, and recorded notes.',
    headers: ['Payment ID', 'Receipt number', 'Appointment date', 'External reference', 'Recorded note'],
    widths: [14, 24, 18, 30, 66],
    dateColumns: [3],
    records: details.payments.map((row) => [
      row.payment_id, row.receipt_number,
      row.appointment_date ? spreadsheetDate(row.appointment_date) : '',
      row.reference_no || '', row.note || '',
    ]),
  });

  addReportDetailSheet(workbook, {
    name: 'Expense Register',
    title: 'Expense Register — Active and Voided',
    from, to,
    description: 'All expenses by expense date. Voided records are retained for audit context and excluded from recorded expenses.',
    headers: ['Expense ID', 'Expense date', 'Category', 'Description', 'Amount (PHP)', 'Supplier',
      'Reference', 'Status', 'Void reason'],
    widths: [14, 14, 27, 42, 18, 25, 24, 14, 42],
    dateColumns: [2],
    amountColumns: [5],
    records: details.expenses.map((row) => [
      row.expense_id, spreadsheetDate(row.date), row.category, row.description,
      Number(row.amount), row.supplier || '', row.reference_no || '', row.status, row.void_reason || '',
    ]),
    total: {
      label: 'Active recorded expenses (ties to summary)',
      column: 5,
      value: income.expenses,
      formula: (first, last, worksheet) => `SUMIF(H${first}:H${last},"active",E${first}:E${last})`,
    },
  });

  addReportDetailSheet(workbook, {
    name: 'Daily Reconciliation',
    title: 'Daily Collection and Expense Reconciliation',
    from, to,
    description: 'Daily totals use posted payments by Manila receipt date and non-voided expenses by expense date.',
    headers: ['Date', 'Posted collections (PHP)', 'Recorded expenses (PHP)', 'Net after expenses (PHP)'],
    widths: [18, 28, 28, 28],
    dateColumns: [1],
    amountColumns: [2, 3, 4],
    records: report.daily_cash.map((row) => [
      spreadsheetDate(row.date), Number(row.collected), Number(row.expenses),
      Number(row.collected) - Number(row.expenses),
    ]),
    total: {
      label: 'Period total',
      column: 2,
      value: income.collected,
    },
  });
  const dailySheet = workbook.getWorksheet('Daily Reconciliation');
  const dailyTotalRow = dailySheet.lastRow;
  const dailyFirstDataRow = 7;
  const dailyLastDataRow = dailyTotalRow.number - 1;
  [3, 4].forEach((column) => {
    const letter = dailySheet.getColumn(column).letter;
    const sourceColumn = letter;
    const totalCell = dailyTotalRow.getCell(column);
    totalCell.value = report.daily_cash.length
      ? { formula: `SUM(${sourceColumn}${dailyFirstDataRow}:${sourceColumn}${dailyLastDataRow})`,
        result: column === 3 ? Number(income.expenses) : Number(income.net_income) }
      : 0;
    totalCell.numFmt = '"PHP" #,##0.00;[Red]-"PHP" #,##0.00';
  });

  const chartEntries = Object.entries(chartImages);
  if (chartEntries.length) {
    const chartSheet = workbook.addWorksheet('Charts', {
      pageSetup: {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.25 },
      },
    });
    chartSheet.columns = Array.from({ length: 16 }, () => ({ width: 12 }));
    chartSheet.headerFooter.oddFooter = '&LSkin Goddess Aesthetic Center&CFinance report&RPage &P of &N';
    chartEntries.forEach(([title, base64], index) => {
      const column = (index % 2) * 8;
      const row = Math.floor(index / 2) * 20;
      const heading = chartSheet.getCell(row + 1, column + 1);
      heading.value = title;
      heading.font = { bold: true, size: 12, color: { argb: EXCEL_STYLE.navy } };
      const imageId = workbook.addImage({ base64, extension: 'png' });
      chartSheet.addImage(imageId, {
        tl: { col: column, row: row + 1 },
        ext: { width: 560, height: 310 },
      });
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="finance-income-statement-${from}-to-${to}.xlsx"`);
  res.send(Buffer.from(buffer));
}

router.get('/export.xlsx', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.query);
  if (req.query.section === 'income-statement') {
    const [report, details] = await Promise.all([
      reportData(from, to),
      incomeStatementDetailRows(from, to),
    ]);
    await sendIncomeStatementWorkbook(res, from, to, report, {}, details);
    return;
  }
  if (!['transactions', 'expenses'].includes(req.query.section)) {
    throw new ApiError(400, 'Excel export section must be transactions, expenses, or income-statement.');
  }
  const result = req.query.section === 'transactions'
    ? await transactionExportRows(from, to, req.query)
    : await expenseExportRows(from, to, req.query);
  await sendFinanceWorkbook(res, req.query.section, from, to, result.rows, req.query);
}));

router.post('/export-report.xlsx', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.body || {});
  const chartLabels = {
    'Sales earned vs expenses': 'reportSalesExpensesChart',
    'Online reservations': 'reportOnlineReservationsChart',
    'Revenue by service category': 'reportServiceCategoryChart',
    'Deposits by status': 'reportDepositsChart',
    'Cash collected by payment method': 'reportMethodsChart',
    'Top services': 'reportTopServicesChart',
    'Expenses by category': 'reportExpenseCategoryChart',
  };
  const suppliedCharts = req.body?.charts;
  if (!suppliedCharts || typeof suppliedCharts !== 'object' || Array.isArray(suppliedCharts)) {
    throw new ApiError(400, 'Chart images are required for the report export.');
  }
  const chartImages = {};
  for (const [title, dataUrl] of Object.entries(suppliedCharts)) {
    if (!Object.hasOwn(chartLabels, title)
      || typeof dataUrl !== 'string'
      || !dataUrl.startsWith('data:image/png;base64,')) {
      throw new ApiError(400, 'The report contains an invalid chart image.');
    }
    const base64 = dataUrl.slice('data:image/png;base64,'.length);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      throw new ApiError(400, 'The report contains an invalid chart image.');
    }
    chartImages[title] = dataUrl;
  }
  if (!Object.keys(chartImages).length) {
    throw new ApiError(400, 'At least one chart image is required for the report export.');
  }
  const [report, details] = await Promise.all([
    reportData(from, to),
    incomeStatementDetailRows(from, to),
  ]);
  await sendIncomeStatementWorkbook(res, from, to, report, chartImages, details);
}));

router.get('/export.csv', endpoint(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const section = req.query.section;
  if (!['transactions', 'expenses', 'income-statement', 'daily-cash'].includes(section)) throw new ApiError(400, 'Invalid export section.');
  if (section === 'transactions') {
    const result = await transactionExportRows(from, to, req.query);
    sendCsvWithMetadata(res, ['Date', 'Type', 'Method', 'Amount (PHP)', 'Status', 'Reference', 'Note', 'Client'], result.rows.map((row) => [row.date, row.payment_type, paymentMethodLabel(row.method), peso(row.amount), row.status, row.reference_no, row.note, row.client]), 'finance-transactions.csv', from, to, section, req.query); return;
  }
  if (section === 'expenses') {
    const result = await expenseExportRows(from, to, req.query);
    sendCsvWithMetadata(res, ['Date', 'Category', 'Description', 'Amount (PHP)', 'Supplier', 'Reference', 'Status', 'Void reason'], result.rows.map((row) => [row.date, row.category, row.description, peso(row.amount), row.supplier, row.reference_no, row.status, row.void_reason]), 'finance-expenses.csv', from, to, section, req.query); return;
  }
  const report = await reportData(from, to);
  if (section === 'income-statement') {
    const income = report.income_statement;
    sendCsvWithMetadata(res, ['Item', 'Amount (PHP)'], [['Sales earned', peso(income.sales)], ['Cash collected', peso(income.collected)], ['Expenses', peso(income.expenses)], ['Net cash after expenses', peso(income.net_income)]], 'finance-income-statement.csv', from, to, section, req.query); return;
  }
  sendCsvWithMetadata(res, ['Date', 'Cash collected (PHP)', 'Recorded expenses (PHP)'], report.daily_cash.map((row) => [row.date, peso(row.collected), peso(row.expenses)]), 'finance-daily-cash.csv', from, to, section, req.query);
}));

module.exports = router;
