const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { approval, approvedRows, buildPricePlan, applyPricePlan } = require('../scripts/reconcile-october-prices');

test('confirmed October aliases cover exactly eight appointments and PHP 19,500', () => {
  assert.equal(approval.mappings.length, 6);
  assert.deepEqual(approvedRows.map((row) => row.row), [3,4,8,9,11,26,28,29]);
  const total = approvedRows.reduce((sum, row) => sum + Number(approval.mappings.find((mapping) => mapping.label === row.treatment).price), 0);
  assert.equal(total, 19500);
});

test('confirmed pricing is atomic and repeatable; Finance recognizes sales while payment history stays unknown', {
  skip: !process.env.OCTOBER_PRICING_TEST_DATABASE,
}, async () => {
  assert.equal(process.env.DB_HOST, '127.0.0.1');
  assert.equal(process.env.DB_PORT, '55440');
  assert.match(process.env.DB_NAME, /^sg_october_pricing_test_\d+$/);
  assert.equal(process.env.OCTOBER_PRICING_TEST_DATABASE, process.env.DB_NAME);
  const pool = new Pool({ host:'127.0.0.1', port:55440, user:'postgres', database:process.env.DB_NAME });
  const client = await pool.connect();
  let db;
  try {
    const appointmentSnapshot = async () => (await client.query('SELECT jsonb_agg(to_jsonb(a) ORDER BY appointment_id) AS records FROM appointments a')).rows[0].records;
    const payments = async () => (await client.query('SELECT jsonb_agg(to_jsonb(p) ORDER BY payment_id) AS records FROM payments p')).rows[0].records;
    const before = await appointmentSnapshot();
    const paymentsBefore = await payments();
    const plan = await buildPricePlan(client);
    assert.equal(plan.updateCount, 8);
    assert.equal(plan.salesTotal, 19500);
    await assert.rejects(applyPricePlan(client, 'stale-preview'), /preview changed/);
    await client.query('BEGIN');
    await client.query("UPDATE services SET service_price=1001 WHERE service_name='Basic Facial'");
    await assert.rejects(buildPricePlan(client), /catalog service or price changed/);
    await client.query('ROLLBACK');
    await client.query('BEGIN');
    await client.query(`UPDATE appointments SET historical_source=jsonb_set(historical_source,'{original_treatment}','"Wrong source"')
      WHERE historical_import_key='client-october-2026:row:3'`);
    await assert.rejects(buildPricePlan(client), /Source identity or treatment changed/);
    await client.query('ROLLBACK');
    await client.query(`CREATE FUNCTION october_pricing_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated pricing failure'; END $$`);
    await client.query(`CREATE TRIGGER october_pricing_test_reject BEFORE UPDATE OF booked_service_price ON appointments
      FOR EACH ROW WHEN(OLD.historical_import_key='client-october-2026:row:9') EXECUTE FUNCTION october_pricing_test_reject()`);
    await assert.rejects(applyPricePlan(client, plan.fingerprint), /simulated pricing failure/);
    assert.deepEqual(await appointmentSnapshot(), before);
    assert.deepEqual(await payments(), paymentsBefore);
    await client.query('DROP TRIGGER october_pricing_test_reject ON appointments');
    await client.query('DROP FUNCTION october_pricing_test_reject()');

    db = require('../db');
    const router = require('../routes/finance');
    const handler = (path) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods.get).route.stack.at(-1).handle;
    const invoke = async (path, params={}) => {
      const response = { statusCode:200, status(code) { this.statusCode=code;return this; }, json(body) { this.body=body;return this; } };
      await handler(path)({ query:{from:'2026-10-01',to:'2026-10-31'},params },response);
      assert.equal(response.statusCode,200,JSON.stringify(response.body));
      return response.body;
    };
    const summaryBefore = await invoke('/summary');
    const result = await applyPricePlan(client,plan.fingerprint);
    assert.equal(result.updated,8);
    assert.equal(result.paymentRecordsCreated,0);
    const after = await appointmentSnapshot();
    const updatedIds = plan.changes.map((row) => row.id);
    assert.deepEqual(after.filter((row) => !updatedIds.includes(row.appointment_id)), before.filter((row) => !updatedIds.includes(row.appointment_id)));
    for (const record of after.filter((row) => updatedIds.includes(row.appointment_id))) {
      const previous = before.find((row) => row.appointment_id === record.appointment_id);
      const metadata = { ...record.historical_source };
      assert.equal(metadata.catalog_reconciliation.version,approval.version);
      assert.equal(metadata.catalog_reconciliation.original_service_id,previous.service_id);
      delete metadata.catalog_reconciliation;
      assert.deepEqual(metadata,previous.historical_source);
      assert.equal(record.payment_status,'not_recorded');
      assert.equal(record.booked_reservation_fee,null);
      assert.equal(record.appointment_time,previous.appointment_time);
      assert.equal(record.appointment_end_time,previous.appointment_end_time);
    }
    assert.deepEqual(await payments(),paymentsBefore);
    const summary = await invoke('/summary');
    assert.equal(summary.sales-summaryBefore.sales,19500);
    assert.equal(summary.collected,summaryBefore.collected);
    assert.equal(summary.outstanding_balance,summaryBefore.outstanding_balance);
    const receivables = await invoke('/receivables');
    assert.ok(receivables.every((row) => !updatedIds.includes(row.appointment_id)));
    const detail = await invoke('/appointments/:id',{id:updatedIds[0]});
    assert.match(detail.payment.note,/balance is unknown/);
    assert.deepEqual(detail.history,[]);
    const second = await applyPricePlan(client,(await buildPricePlan(client)).fingerprint);
    assert.equal(second.updated,0);
    assert.equal(second.alreadyApplied,8);
    assert.deepEqual(await appointmentSnapshot(),after);
    const importPlan = await require('../scripts/replace-test-appointments').buildPlan(client);
    assert.equal(importPlan.alreadyImported,21);
    assert.equal(importPlan.insert.length,0);
    assert.equal(Number((await client.query(`SELECT COUNT(*)::int AS count FROM appointments
      WHERE historical_import_key LIKE 'client-october-2026:%' AND booked_service_price IS NULL`)).rows[0].count),13);
  } finally {
    client.release();
    await pool.end();
    if (db) await db.pool.end();
  }
});
