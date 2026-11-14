const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');

test('legacy recovery audits, preserves business data and runs only missing safe migrations',{
  skip:!process.env.LEGACY_RECOVERY_TEST_DATABASE,
},async()=>{
  assert.equal(process.env.DB_HOST,'127.0.0.1');
  assert.equal(process.env.DB_PORT,'55440');
  assert.match(process.env.DB_NAME,/^sg_migration_recovery_test_\d+$/);
  assert.equal(process.env.LEGACY_RECOVERY_TEST_DATABASE,process.env.DB_NAME);
  const db=require('../db');
  const {buildRecoveryPlan,recoverDatabase,tableHashes}=require('../scripts/recover-existing-database');
  const {auditLegacyMigrations}=require('../scripts/audit-legacy-migrations');
  const {run}=require('../scripts/run-migrations');
  const client=await db.pool.connect();
  const protectedTables=['appointments','payments','inventory_products','inventory_transactions'];
  try{
    const before=await tableHashes(client,protectedTables);
    const paymentsBefore=(await client.query('SELECT to_jsonb(p) AS record FROM payments p ORDER BY payment_id')).rows.map((row)=>row.record);
    const usersBefore=(await client.query('SELECT to_jsonb(u) AS record FROM users u ORDER BY user_id')).rows.map((row)=>row.record);
    const plan=await buildRecoveryPlan(client);
    assert.equal(plan.verified.length,60);
    assert.deepEqual(plan.repairs,['045-newsletter-subscribers.js']);
    assert.deepEqual(plan.pending.map((row)=>row.filename),[
      '052-finance-client-product-sales.js','042-appointment-review-timezones.js',
      '049-consolidate-aesthetician-roles.js','053-finance-inventory-purchase-review.js','056-finance-payment-idempotency.js',
    ]);
    await assert.rejects(recoverDatabase(client,'stale-preview'),/preview changed/);
    assert.equal((await client.query("SELECT to_regclass('schema_migrations') AS table")).rows[0].table,null);
    await client.query(`CREATE TABLE newsletter_subscribers(subscriber_id SERIAL PRIMARY KEY,email VARCHAR(254) NOT NULL,subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      INSERT INTO newsletter_subscribers(email) VALUES('same@example.test'),('SAME@example.test')`);
    await assert.rejects(recoverDatabase(client,(await buildRecoveryPlan(client)).fingerprint),/duplicate key|unique index/);
    assert.equal((await client.query("SELECT to_regclass('schema_migrations') AS table")).rows[0].table,null);
    await client.query('DROP TABLE newsletter_subscribers');
    const result=await recoverDatabase(client,(await buildRecoveryPlan(client)).fingerprint);
    assert.equal(result.adopted.length,61);
    assert.equal(result.pending.length,5);
    assert.equal(result.existingDataUnchanged,true);
    assert.deepEqual(await tableHashes(client,protectedTables),before);
    await assert.rejects(recoverDatabase(client,plan.fingerprint),/already initialized/);
    await run([]);
    const audit=await auditLegacyMigrations(client);
    assert.equal(audit.length,66);
    assert.deepEqual(audit.filter((row)=>!row.verified),[]);
    const rows=(await client.query('SELECT migration_id,checksum,status,applied_at FROM schema_migrations ORDER BY migration_id')).rows;
    assert.equal(rows.length,66);
    assert.equal(rows.filter((row)=>row.status==='adopted').length,61);
    assert.equal(rows.filter((row)=>row.status==='applied').length,5);
    // The currently deployed Linux runner hashes the exact repository LF bytes.
    // Recovery must also work with that runner before the normalization patch deploys.
    for(const row of rows){
      const committed=execFileSync('git',['show',`HEAD:migrations/${row.migration_id}`]);
      assert.equal(row.checksum,createHash('sha256').update(committed).digest('hex'),row.migration_id);
    }
    const unchangedTables=protectedTables.filter((name)=>name!=='payments');
    assert.deepEqual(await tableHashes(client,unchangedTables),before.filter((row)=>row.table!=='payments'));
    const paymentsAfter=(await client.query('SELECT to_jsonb(p) AS record FROM payments p ORDER BY payment_id')).rows.map((row)=>row.record);
    for(const payment of paymentsAfter){
      assert.equal(payment.customer_id,null);assert.equal(payment.request_key,null);
      delete payment.customer_id;delete payment.request_key;
    }
    assert.deepEqual(paymentsAfter,paymentsBefore);
    const usersAfter=(await client.query('SELECT to_jsonb(u) AS record FROM users u ORDER BY user_id')).rows.map((row)=>row.record);
    for(const previous of usersBefore){
      const current=usersAfter.find((row)=>row.user_id===previous.user_id);
      if(previous.role==='nail_tech'){
        assert.equal(current.role,'aesthetician');
        delete current.role;delete current.updated_at;delete previous.role;delete previous.updated_at;
      }
      assert.deepEqual(current,previous);
    }
    await run([]);
    assert.deepEqual((await client.query('SELECT migration_id,checksum,status,applied_at FROM schema_migrations ORDER BY migration_id')).rows,rows);
    assert.equal((await client.query("SELECT SUM(booked_service_price)::text AS total FROM appointments WHERE historical_import_key LIKE 'client-october-2026:%'")).rows[0].total,'19500.00');
    const router=require('../routes/finance');
    for(const route of ['/transactions','/receivables','/summary']){
      const res={statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
      await router.stack.find((layer)=>layer.route?.path===route&&layer.route.methods.get).route.stack.at(-1).handle({query:{from:'2026-10-01',to:'2026-10-31'}},res);
      assert.equal(res.statusCode,200,`${route}: ${JSON.stringify(res.body)}`);
      if(route==='/summary')assert.equal(res.body.sales,19500);
    }
  }finally{client.release();await db.pool.end();}
});
