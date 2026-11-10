const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_HOURS, normalizeHours, validDate, fitsSchedule, slotsForDate } = require('../utils/clinicSchedule');

test('clinic schedule validates calendar dates and exactly seven unique operating days', () => {
  assert.equal(validDate('2028-02-29'),true);
  for(const date of ['2026-02-29','2026-02-30','2026-13-01','2026-1-01','0000-01-01'])assert.equal(validDate(date),false,date);
  assert.throws(()=>normalizeHours(DEFAULT_HOURS.slice(1)),/seven/);
  assert.throws(()=>normalizeHours(DEFAULT_HOURS.map(day=>({...day,weekday:1}))),/valid opening/);
  assert.throws(()=>normalizeHours(DEFAULT_HOURS.map(day=>({...day,opening_time:'18:00',closing_time:'09:00'}))),/valid opening/);
  assert.equal(normalizeHours(DEFAULT_HOURS).length,7);
});
test('saved hours extend availability while preserving lunch, duration, buffer, and closures', () => {
  const date='2026-11-16',schedule={days:DEFAULT_HOURS.map(day=>({...day,opening_time:'07:15',closing_time:'21:00'})),closures:[]};
  assert.equal(slotsForDate(schedule,date)[0],'7:30 AM');
  assert.ok(slotsForDate(schedule,date).includes('8:30 PM'));
  assert.equal(fitsSchedule(schedule,date,'20:00','21:00'),true);
  assert.equal(fitsSchedule(schedule,date,'20:30','21:30'),false);
  assert.equal(fitsSchedule(schedule,date,'11:30','12:30'),false);
  schedule.closures.push({closure_date:date});
  assert.equal(fitsSchedule(schedule,date,'09:00','10:00'),false);
  assert.deepEqual(slotsForDate(schedule,date),[]);
});

test('Clinic Management PostgreSQL and HTTP workflows', {skip:!process.env.CLINIC_TEST_DATABASE}, async(t)=>{
  // Integration fixtures must use a separate local test database. Never use .env's database.
  assert.equal(process.env.DB_HOST,'127.0.0.1');
  assert.equal(process.env.DB_PORT,'55439');
  assert.match(process.env.DB_NAME,/^sg_clinic_test(?:_\w+)?$/);
  assert.equal(process.env.CLINIC_TEST_DATABASE,process.env.DB_NAME);
  const db=require('../db'),express=require('express');
  const {manilaNow}=require('../utils/slots');
  const {migrate}=require('../migrations/050-clinic-management');
  const {processClinicNotifications}=require('../utils/clinicNotifications');
  const originalFetch=global.fetch;let emails=[],rejectEmail=false;
  global.fetch=async(url,options)=>{
    if(String(url).startsWith('https://api.brevo.com/')){
      emails.push(JSON.parse(options.body));
      if(rejectEmail)return {ok:false,text:async()=>'simulated provider failure'};
      return {ok:true,json:async()=>({messageId:'test-delivery'})};
    }
    return originalFetch(url,options);
  };
  const prefix=`clinic-test-${Date.now()}`;
  const users=[];let serviceId,server;
  const query=(sql,values)=>db.query(sql,values);
  const addDays=(n)=>{const date=new Date(`${manilaNow().dateStr}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+n);return date.toISOString().slice(0,10);};
  let admin,staff,client,appointment1,appointment2,closureId,base;
  async function request(path,method='GET',body,user=admin){const response=await originalFetch(`${base}${path}`,{method,headers:{Accept:'application/json','Content-Type':'application/json','x-test-user':String(user||'')},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
  async function appointment(date,time='09:00'){
    const result=await query(`INSERT INTO appointments(user_id,service_id,aesthetician_id,appointment_date,appointment_time,appointment_end_time,scheduled_end_time,
      booked_duration_minutes,booked_buffer_minutes,booked_service_price,booked_reservation_fee,appointment_status,payment_status,customer_first_name,customer_last_name)
      VALUES($1,$2,$3,$4,$5,($5::time+INTERVAL '30 minutes')::time,($5::time+INTERVAL '30 minutes')::time,30,0,1000,100,'confirmed','unpaid','Clinic','Test') RETURNING appointment_id`,[client,serviceId,staff,date,time]);return result.rows[0].appointment_id;
  }
  async function flush(){for(let i=0;i<100;i++){await processClinicNotifications();const pending=await query("SELECT 1 FROM clinic_notification_deliveries WHERE email_status IN ('pending','sending') LIMIT 1");if(!pending.rows.length)return;await new Promise(resolve=>setTimeout(resolve,10));}}
  try{
    await query('ALTER TABLE appointments ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE');
    await migrate();await migrate();
    await query('TRUNCATE clinic_appointment_impacts,clinic_notification_deliveries,clinic_closures,clinic_schedule_changes,appointments,notifications RESTART IDENTITY CASCADE');
    for(const role of ['admin','aesthetician','client']){const result=await query("INSERT INTO users(email,password_hash,first_name,last_name,role,status,email_verified) VALUES($1,'test','Clinic',$2,$2,'active',TRUE) RETURNING user_id",[`${prefix}-${role}@example.test`,role]);users.push(result.rows[0].user_id);}
    [admin,staff,client]=users;
    serviceId=(await query("INSERT INTO services(service_name,category,duration_minutes,buffer_minutes,service_price,reservation_fee) VALUES($1,'facial',30,0,1000,100) RETURNING service_id",[prefix])).rows[0].service_id;
    await query('UPDATE clinic_operating_hours SET is_open=TRUE,opening_time=\'09:00\',closing_time=\'18:00\'');
    appointment1=await appointment(addDays(2));appointment2=await appointment(addDays(3));
    const app=express();app.use(express.json());app.use((req,_res,next)=>{req.session={userId:Number(req.headers['x-test-user'])||undefined};next();});
    app.use('/clinic',require('../routes/clinic'));app.use('/availability',require('../routes/availability'));app.use('/appointments',require('../routes/appointments'));
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;

    await t.test('admin permissions are enforced without changing staff or customer access',async()=>{
      assert.equal((await request('/clinic','GET',null,client)).status,403);
      assert.equal((await request('/clinic','GET',null,staff)).status,403);
      assert.equal((await request('/clinic','GET',null,null)).status,401);
      assert.equal((await request('/clinic')).status,200);
    });
    await t.test('multi-date closure requires a fresh affected-appointment review and preserves records',async()=>{
      const input={dates:[addDays(2),addDays(3)],reason:'Maintenance'};
      const preview=await request('/clinic/closures/preview','POST',input);assert.equal(preview.status,200);assert.equal(preview.body.affectedAppointments.length,2);
      assert.equal((await request('/clinic/closures','POST',input)).status,409);
      const before=(await query('SELECT * FROM appointments WHERE appointment_id=$1',[appointment1])).rows[0];
      const saved=await request('/clinic/closures','POST',{...input,reviewToken:preview.body.reviewToken});assert.equal(saved.status,201,JSON.stringify(saved.body));
      assert.deepEqual((await query('SELECT * FROM appointments WHERE appointment_id=$1',[appointment1])).rows[0],before);
      const state=(await request('/clinic')).body;assert.equal(state.pendingAppointments.length,2);closureId=state.closures.find(c=>c.closure_date===addDays(2)).closure_id;
      assert.equal((await request('/clinic/closures','POST',{...input,reviewToken:preview.body.reviewToken})).status,409);
      await flush();assert.ok(emails.length>0);assert.ok(emails.every(email=>/^[0-9a-f-]{36}$/.test(email.headers?.idempotencyKey)));
      const duplicates=await query('SELECT event_key,user_id,COUNT(*) FROM clinic_notification_deliveries GROUP BY event_key,user_id HAVING COUNT(*)>1');assert.equal(duplicates.rows.length,0);
    });
    await t.test('availability and direct database writes reject closed dates including payment creation',async()=>{
      const result=await request(`/availability?month=${addDays(2).slice(0,7)}&serviceId=${serviceId}`,'GET',null,client);
      assert.equal(result.status,200);const [y,m,d]=addDays(2).split('-').map(Number);assert.equal(result.body[`${y}-${m-1}-${d}`],undefined);
      await assert.rejects(()=>appointment(addDays(2),'10:00'),/clinic is closed/);
      await assert.rejects(()=>query("UPDATE appointments SET appointment_status='in_progress' WHERE appointment_id=$1",[appointment1]),/Resolve the clinic/);
      const details=await request(`/clinic/closures/${closureId}`);assert.equal(details.body.appointments[0].resolution,'pending');assert.ok(details.body.deliveries.length);
    });
    await t.test('existing admin rescheduling resolves the impact and suppresses duplicate final notices',async()=>{
      const before=await query('SELECT COUNT(*)::integer AS count FROM payments WHERE appointment_id=$1',[appointment1]);
      const result=await request(`/appointments/${appointment1}/reschedule`,'POST',{date:addDays(5),time:'09:00'});assert.equal(result.status,200,JSON.stringify(result.body));
      const impact=(await query('SELECT resolution FROM clinic_appointment_impacts WHERE appointment_id=$1',[appointment1])).rows[0];assert.equal(impact.resolution,'rescheduled');
      assert.deepEqual((await query('SELECT COUNT(*)::integer AS count FROM payments WHERE appointment_id=$1',[appointment1])).rows,before.rows);
      const notices=await query("SELECT n.user_id,COUNT(*)::integer AS count FROM notifications n JOIN clinic_notification_deliveries d USING(notification_id) WHERE d.appointment_id=$1 AND n.type='appointment_rescheduled' GROUP BY n.user_id",[appointment1]);assert.ok(notices.rows.length>=3);assert.ok(notices.rows.every(n=>n.count===1));
      await flush();
    });
    await t.test('existing cancellation preserves the appointment and marks its history as cancelled',async()=>{
      const result=await request(`/appointments/${appointment2}/cancel`,'POST',{});assert.equal(result.status,200,JSON.stringify(result.body));
      assert.equal((await query('SELECT resolution FROM clinic_appointment_impacts WHERE appointment_id=$1',[appointment2])).rows[0].resolution,'cancelled');
      assert.equal((await query('SELECT appointment_status FROM appointments WHERE appointment_id=$1',[appointment2])).rows[0].appointment_status,'cancelled');await flush();
    });
    await t.test('changing bookings after preview invalidates confirmation',async()=>{
      const input={dates:[addDays(6)],reason:'Training'},preview=(await request('/clinic/closures/preview','POST',input)).body;
      await appointment(addDays(6));assert.equal((await request('/clinic/closures','POST',{...input,reviewToken:preview.reviewToken})).status,409);
    });
    await t.test('concurrent booking and closure writes serialize and require a fresh review',async()=>{
      const connection=await db.pool.connect();
      try {
        const input={dates:[addDays(10)],reason:'Concurrent review test'},preview=(await request('/clinic/closures/preview','POST',input)).body;
        await connection.query('BEGIN');await connection.query('SELECT pg_advisory_xact_lock_shared(5032026,1)');
        await connection.query(`INSERT INTO appointments(user_id,service_id,aesthetician_id,appointment_date,appointment_time,appointment_end_time,scheduled_end_time,
          booked_duration_minutes,booked_buffer_minutes,booked_service_price,booked_reservation_fee,appointment_status,payment_status)
          VALUES($1,$2,$3,$4,'09:30','10:00','10:00',30,0,1000,100,'confirmed','unpaid')`,[client,serviceId,staff,addDays(10)]);
        const confirmation=request('/clinic/closures','POST',{...input,reviewToken:preview.reviewToken});
        for(let i=0;i<100;i++){const locks=await query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=5032026 AND NOT granted");if(locks.rows.length)break;await new Promise(resolve=>setTimeout(resolve,5));}
        await connection.query('COMMIT');assert.equal((await confirmation).status,409);
        await connection.query('BEGIN');await connection.query('SELECT pg_advisory_xact_lock(5032026,1)');
        const closure=(await connection.query("INSERT INTO clinic_closures(closure_date,reason,created_by) VALUES($1,'Concurrent booking test',$2) RETURNING closure_id",[addDays(11),admin])).rows[0];
        const rejected=assert.rejects(()=>appointment(addDays(11),'10:00'),/clinic is closed/);
        for(let i=0;i<100;i++){const locks=await query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=5032026 AND NOT granted");if(locks.rows.length)break;await new Promise(resolve=>setTimeout(resolve,5));}
        await connection.query('COMMIT');await rejected;
        await query('DELETE FROM clinic_closures WHERE closure_id=$1',[closure.closure_id]);
      }finally{await connection.query('ROLLBACK');connection.release();}
    });
    await t.test('hours changes warn and flag appointments, extend slots, and block disabled weekdays',async()=>{
      const appointmentId=await appointment(addDays(7));
      const days=DEFAULT_HOURS.map(day=>({...day,opening_time:'10:00',closing_time:'21:00'}));
      const preview=(await request('/clinic/hours/preview','POST',{days})).body;assert.ok(preview.affectedAppointments.some(a=>a.appointment_id===appointmentId));
      const saved=await request('/clinic/hours','PUT',{days,reviewToken:preview.reviewToken});assert.equal(saved.status,200,JSON.stringify(saved.body));
      assert.equal((await query('SELECT resolution FROM clinic_appointment_impacts WHERE appointment_id=$1',[appointmentId])).rows[0].resolution,'pending');
      const availability=(await request(`/availability?month=${addDays(8).slice(0,7)}&serviceId=${serviceId}`,'GET',null,client)).body;
      const [y,m,d]=addDays(8).split('-').map(Number);assert.ok(availability[`${y}-${m-1}-${d}`].includes('8:30 PM'));assert.equal(availability[`${y}-${m-1}-${d}`].includes('9:00 AM'),false);
      await assert.rejects(()=>appointment(addDays(8),'09:00'),/operating hours/);await flush();
    });
    await t.test('editing and reopening closures notify customers without restoring cancelled bookings',async()=>{
      const details=(await request(`/clinic/closures/${closureId}`)).body;
      const input={dates:[addDays(2)],reason:'Maintenance updated',closureId:Number(closureId)};
      const preview=(await request('/clinic/closures/preview','POST',input)).body;
      assert.equal((await request(`/clinic/closures/${closureId}`,'PUT',{...input,version:details.closure.version,reviewToken:preview.reviewToken})).status,200);
      assert.equal((await request(`/clinic/closures/${closureId}/reopen`,'POST',{version:details.closure.version})).status,409);
      const current=(await request(`/clinic/closures/${closureId}`)).body;
      assert.equal((await request(`/clinic/closures/${closureId}/reopen`,'POST',{version:current.closure.version})).status,200);
      assert.equal((await query('SELECT appointment_status FROM appointments WHERE appointment_id=$1',[appointment2])).rows[0].appointment_status,'cancelled');await flush();
    });
    await t.test('email failures appear in delivery history and the admin bell; retries reuse the notice',async()=>{
      rejectEmail=true;const input={dates:[addDays(9)],reason:'Provider failure test'},preview=(await request('/clinic/closures/preview','POST',input)).body;
      assert.equal((await request('/clinic/closures','POST',{...input,reviewToken:preview.reviewToken})).status,201);await flush();
      const failure=(await query("SELECT * FROM clinic_notification_deliveries WHERE email_status='failed' ORDER BY delivery_id DESC LIMIT 1")).rows[0];assert.ok(failure);
      assert.ok((await query("SELECT 1 FROM notifications WHERE user_id=$1 AND type='clinic_email_failed'",[admin])).rows.length);
      rejectEmail=false;assert.equal((await request(`/clinic/deliveries/${failure.delivery_id}/retry`,'POST',{})).status,200);await flush();
      const retried=(await query('SELECT * FROM clinic_notification_deliveries WHERE delivery_id=$1',[failure.delivery_id])).rows[0];assert.equal(retried.email_status,'sent');assert.equal(retried.notification_id,failure.notification_id);
    });
  }finally{
    await flush();global.fetch=originalFetch;if(server)await new Promise(resolve=>server.close(resolve));await db.pool.end();
  }
});
