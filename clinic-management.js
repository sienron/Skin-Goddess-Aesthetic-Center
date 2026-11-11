document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);
  const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let data, selected = new Set(), editing = null, review = null;
  let month = new Date(`${today.slice(0,7)}-01T00:00:00Z`);
  function el(tag, text, className) { const node=document.createElement(tag); if(text!=null)node.textContent=text; if(className)node.className=className; return node; }
  function feedback(message,error=false) { $('clinicFeedback').textContent=message;$('clinicFeedback').classList.toggle('clinic-error',error); }
  function showError(id,error) { $(id).textContent=error.message;$(id).hidden=false; }
  function label(value) { return String(value || '').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()); }
  function dateLabel(date) { return new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium'}).format(new Date(`${date}T00:00:00+08:00`)); }
  function timeLabel(time) { const [h,m]=time.slice(0,5).split(':');return `${Number(h)%12||12}:${m} ${Number(h)<12?'AM':'PM'}`; }
  function action(text,fn,primary=false) { const button=el('button',text,`um-btn um-btn--${primary?'primary':'ghost'}`);button.type='button';button.addEventListener('click',async()=>{button.disabled=true;try{await fn();}catch(error){feedback(error.message,true);}finally{button.disabled=false;}});return button; }
  async function api(path='',method='GET',body) {
    const response=await fetch(`/api/clinic${path}`,{method,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json();if(!response.ok)throw new Error(result.message || 'Clinic request failed.');return result;
  }
  function appointmentTable(appointments,withResolution=false) {
    if(!appointments.length)return el('p','No affected appointments.','clinic-empty');
    const wrap=el('div',null,'um-table-wrap'),table=el('table',null,'um-table clinic-data-table'),head=el('thead'),row=el('tr');
    ['APPOINTMENT','CUSTOMER / SERVICE','DATE & TIME',...(withResolution?['RESOLUTION']:[]),'ACTION'].forEach(text=>row.append(el('th',text)));head.append(row);table.append(head);
    const body=el('tbody');appointments.forEach(a=>{
      const tr=el('tr');tr.append(el('td',`APT-${String(a.appointment_id).padStart(4,'0')}`));
      const customer=el('td');customer.append(el('strong',a.client),el('div',a.service_name,'clinic-hint'));tr.append(customer);
      tr.append(el('td',`${dateLabel(a.appointment_date)} · ${timeLabel(a.appointment_time)}`));
      if(withResolution){const cell=el('td');cell.append(el('span',a.resolution==='pending'?'Pending Resolution':label(a.resolution),'clinic-badge'));tr.append(cell);}
      const cell=el('td'),link=el('a','Manage Appointment','um-btn um-btn--ghost');link.href=`AdminAppointment.html?appointment=${a.appointment_id}`;cell.append(link);tr.append(cell);body.append(tr);
    });
    body.querySelectorAll('tr').forEach(tr=>{
      [...tr.cells].forEach((cell,index)=>{cell.dataset.label=row.cells[index].textContent;});
    });
    table.append(body);wrap.append(table);return wrap;
  }
  function hours() {
    const body=$('clinicHoursBody');body.replaceChildren();
    [1,2,3,4,5,6,0].forEach(weekday=>{
      const day=data.days.find(d=>d.weekday===weekday),tr=el('tr');tr.dataset.weekday=weekday;
      tr.append(el('th',names[weekday]));tr.firstChild.scope='row';
      const cell=el('td'),field=el('label',null,'clinic-switch'),check=el('input');check.type='checkbox';check.checked=day.is_open;check.setAttribute('aria-label',`${names[weekday]} operating`);
      const text=el('span',day.is_open?'Open':'Closed');field.append(check,text);cell.append(field);tr.append(cell);
      ['opening_time','closing_time'].forEach(key=>{const td=el('td'),input=el('input');td.dataset.label=key==='opening_time'?'Opening':'Closing';input.type='time';input.value=day[key].slice(0,5);input.required=true;input.disabled=!day.is_open;input.dataset.field=key;input.setAttribute('aria-label',`${names[weekday]} ${key==='opening_time'?'opening':'closing'} time`);td.append(input);tr.append(td);});
      check.addEventListener('change',()=>{text.textContent=check.checked?'Open':'Closed';tr.querySelectorAll('input[type="time"]').forEach(input=>input.disabled=!check.checked);});body.append(tr);
    });
  }
  function history() {
    const filter=$('clinicHistoryFilter').value,body=$('clinicHistoryBody');body.replaceChildren();
    const closures=data.closures.filter(c=>filter==='all'||(filter==='pending'?c.pending_count>0:c.status===filter));
    if(!closures.length){const row=el('tr'),cell=el('td','No closures to display.','clinic-empty');cell.colSpan=5;row.append(cell);body.append(row);return;}
    closures.forEach(c=>{
      const row=el('tr');row.append(el('td',dateLabel(c.closure_date)),el('td',c.reason));const status=el('td');status.append(el('span',label(c.status),'clinic-badge'));row.append(status);
      row.append(el('td',`${c.pending_count} pending · ${c.rescheduled_count} rescheduled · ${c.cancelled_count} cancelled (${c.affected_count} affected)`));
      const actions=el('td'),group=el('div',null,'clinic-row-actions');group.append(action('Details',()=>details(c.closure_id)));
      if(!c.reopened_at && c.closure_date>=today){group.append(action('Edit',()=>openCalendar(c)),action('Reopen',()=>reviewReopen(c)));}actions.append(group);row.append(actions);
      [...row.cells].forEach((cell,index)=>{cell.dataset.label=['Date','Reason','Status','Appointments','Actions'][index];});
      body.append(row);
    });
  }
  async function load(resetHours=true) {
    try{data=await api();if(resetHours)hours();history();$('clinicPending').replaceChildren(appointmentTable(data.pendingAppointments,true));$('clinicSaveHours').disabled=false;$('clinicAddClosure').disabled=false;feedback('Schedule shown in Asia/Manila. Changes are checked against existing appointments before confirmation.');}
    catch(error){feedback(error.message,true);}
  }
  function calendar() {
    $('clinicCalendarMonth').textContent=new Intl.DateTimeFormat('en-PH',{month:'long',year:'numeric',timeZone:'UTC'}).format(month);
    const grid=$('clinicCalendar');grid.replaceChildren();
    const year=month.getUTCFullYear(),m=month.getUTCMonth(),count=new Date(Date.UTC(year,m+1,0)).getUTCDate();
    for(let i=0;i<month.getUTCDay();i++)grid.append(el('span'));
    for(let day=1;day<=count;day++){
      const date=`${year}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`,button=el('button',day,'clinic-calendar-day');button.type='button';
      const closed=data.closures.some(c=>c.closure_date===date&&!c.reopened_at&&c.closure_id!==editing?.closure_id);
      button.disabled=date<today||closed;button.classList.toggle('is-selected',selected.has(date));button.setAttribute('aria-pressed',String(selected.has(date)));button.setAttribute('aria-label',`${dateLabel(date)}${closed?', already closed':''}`);
      button.addEventListener('click',()=>{if(selected.has(date))selected.delete(date);else{if(editing)selected.clear();selected.add(date);}calendar();});grid.append(button);
    }
    $('clinicSelectedDates').textContent=selected.size?`${selected.size} selected: ${[...selected].sort().map(dateLabel).join(', ')}`:'No dates selected';
    $('clinicPrevMonth').disabled=month.toISOString().slice(0,7)<=today.slice(0,7);
  }
  function openCalendar(closure=null) {
    editing=closure;selected=new Set(closure?[closure.closure_date]:[]);month=new Date(`${(closure?.closure_date||today).slice(0,7)}-01T00:00:00Z`);
    $('clinicClosureReason').value=closure?.reason||'';$('clinicClosureError').hidden=true;$('clinicClosureDialogTitle').textContent=closure?'Edit Clinic Closure':'Schedule Clinic Closure';calendar();$('clinicClosureDialog').showModal();
  }
  function displayReview(checked,summary,notice,operation) {
    review=operation;$('clinicReviewSummary').textContent=summary;$('clinicReviewNotice').textContent=notice;
    $('clinicReviewAppointments').replaceChildren(appointmentTable(checked.affectedAppointments||[]));$('clinicReviewError').hidden=true;$('clinicConfirm').disabled=false;$('clinicReviewDialog').showModal();
  }
  $('clinicHoursForm').addEventListener('submit',async(event)=>{
    event.preventDefault();const button=$('clinicSaveHours');button.disabled=true;
    try{const days=[...$('clinicHoursBody').rows].map(row=>({weekday:Number(row.dataset.weekday),is_open:row.querySelector('input[type="checkbox"]').checked,opening_time:row.querySelector('[data-field="opening_time"]').value,closing_time:row.querySelector('[data-field="closing_time"]').value}));
      const checked=await api('/hours/preview','POST',{days});displayReview(checked,`${checked.affectedAppointments.length} appointment(s) affected by new weekly hours.`,
        'Confirming saves the weekly schedule and flags affected appointments as Pending Resolution. Staff and affected customers receive notifications.',{path:'/hours',method:'PUT',body:{days,reviewToken:checked.reviewToken}});
    }catch(error){feedback(error.message,true);}finally{button.disabled=false;}
  });
  $('clinicClosureForm').addEventListener('submit',async(event)=>{
    event.preventDefault();const button=event.submitter;button.disabled=true;$('clinicClosureError').hidden=true;
    try{const input={dates:[...selected].sort(),reason:$('clinicClosureReason').value.trim(),...(editing?{closureId:editing.closure_id}:{})};
      const checked=await api('/closures/preview','POST',input);
      displayReview(checked,`${input.dates.map(dateLabel).join(', ')} · ${checked.affectedAppointments.length} affected appointment(s). Reason: ${input.reason}`,
        'These dates will be blocked from new bookings. Existing appointments remain on record as Pending Resolution until staff reschedules or cancels them. Initial notifications are sent after confirmation.',
        {path:editing?`/closures/${editing.closure_id}`:'/closures',method:editing?'PUT':'POST',body:{...input,reviewToken:checked.reviewToken,...(editing?{version:editing.version}:{})}});
    }catch(error){showError('clinicClosureError',error);}finally{button.disabled=false;}
  });
  function reviewReopen(closure) {
    displayReview({},`Reopen ${dateLabel(closure.closure_date)}?`,
      'This removes the closure restriction and notifies affected customers and staff. Regular weekly hours still apply. Rescheduled and cancelled appointments are preserved.',
      {path:`/closures/${closure.closure_id}/reopen`,method:'POST',body:{version:closure.version}});
  }
  $('clinicConfirm').addEventListener('click',async()=>{
    const button=$('clinicConfirm');button.disabled=true;
    try{const result=await api(review.path,review.method,review.body);$('clinicReviewDialog').close();$('clinicClosureDialog').close();await load();feedback(result.message);}
    catch(error){showError('clinicReviewError',error);}finally{button.disabled=false;}
  });
  function deliveryList(deliveries) {
    const list=el('div',null,'clinic-deliveries');if(!deliveries.length)list.append(el('p','No notifications recorded.','clinic-empty'));
    deliveries.forEach(d=>{const item=el('article',null,'clinic-delivery'),top=el('div',null,'clinic-heading');top.append(el('strong',`${d.recipient||'Customer'} · ${label(d.role)}`),el('span',`Email: ${label(d.email_status)}`,'clinic-badge'));item.append(top,el('p',d.message),el('small',`${label(d.type)} · In-app notification recorded${d.is_read===undefined?'':d.is_read?' · Read':' · Unread'} · ${d.attempts} email attempt(s)`));
      if(d.last_error)item.append(el('p',d.last_error,'clinic-error'));if(d.email_status==='failed')item.append(action('Retry Email',async()=>{const result=await api(`/deliveries/${d.delivery_id}/retry`,'POST',{});feedback(result.message);await showDeliveries();}));list.append(item);});return list;
  }
  async function details(closureId) {
    const result=await api(`/closures/${closureId}`),content=$('clinicDetailsContent');content.replaceChildren(el('h3',dateLabel(result.closure.closure_date)),el('p',result.closure.reason),el('h3','Affected Appointments'),appointmentTable(result.appointments,true),el('h3','Notification Delivery'),deliveryList(result.deliveries));$('clinicDetailsTitle').textContent='Closure Details';if(!$('clinicDetailsDialog').open)$('clinicDetailsDialog').showModal();
  }
  async function showDeliveries() {const deliveries=await api('/deliveries');$('clinicDetailsTitle').textContent='Notification Delivery';$('clinicDetailsContent').replaceChildren(el('p','Latest 200 clinic notifications. Failed email attempts also appear in the Admin notification bell.','clinic-hint'),deliveryList(deliveries));if(!$('clinicDetailsDialog').open)$('clinicDetailsDialog').showModal();}
  $('clinicAddClosure').addEventListener('click',()=>openCalendar());
  $('clinicPrevMonth').addEventListener('click',()=>{month.setUTCMonth(month.getUTCMonth()-1);calendar();});$('clinicNextMonth').addEventListener('click',()=>{month.setUTCMonth(month.getUTCMonth()+1);calendar();});
  $('clinicHistoryFilter').addEventListener('change',history);$('clinicRefresh').addEventListener('click',()=>load(false));$('clinicViewDeliveries').addEventListener('click',()=>showDeliveries().catch(error=>feedback(error.message,true)));
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
  load();
});
