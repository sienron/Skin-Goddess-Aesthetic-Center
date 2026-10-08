document.addEventListener('DOMContentLoaded', async () => {
  const dashboard = document.getElementById('adminDashboardMain');
  if (!dashboard) return;

  const todayAppointments = document.getElementById('dashboardTodayAppointments');
  const confirmedAppointments = document.getElementById('dashboardConfirmedAppointments');
  const pendingRequests = document.getElementById('dashboardPendingRequests');
  const totalUsers = document.getElementById('dashboardTotalUsers');
  const attention = document.getElementById('dashboardAttention');
  const schedule = document.getElementById('dashboardSchedule');
  const activity = document.getElementById('dashboardActivity');

  function manilaDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);
    return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  }

  function dateKey(parts) {
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function stateMessage(container, message, isError = false) {
    const state = element('p', `admin-dashboard-state${isError ? ' admin-dashboard-state--error' : ''}`, message);
    container.replaceChildren(state);
  }

  async function fetchResource(url, validate) {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    const body = await response.text();
    let data;
    try {
      data = body ? JSON.parse(body) : null;
    } catch {
      throw new Error(response.ok ? 'The server returned invalid data.' : `Request failed (${response.status}).`);
    }
    if (!response.ok) {
      throw new Error(data?.message || `Request failed (${response.status}).`);
    }
    if (!validate(data)) throw new Error('The server returned data in an unexpected format.');
    return data;
  }

  function loadResource(name, url, validate) {
    return fetchResource(url, validate).then(
      (data) => ({ data }),
      (error) => {
        console.error(`Could not load dashboard ${name}:`, error);
        return { error };
      }
    );
  }

  function formatTime(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
    if (!match) return 'Time unavailable';
    const hour = Number(match[1]);
    return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Date unavailable';
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  }

  function renderSchedule(result, todayKey, nowMinutes) {
    if (result.error) {
      stateMessage(schedule, 'Today’s appointment schedule could not be loaded.', true);
      return;
    }

    const todays = result.data
      .filter((appointment) => String(appointment.date || '').slice(0, 10) === todayKey)
      .sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));

    if (!todays.length) {
      stateMessage(schedule, 'There are no appointments scheduled for today.');
      return;
    }

    const upcoming = todays.filter((appointment) => {
      const [hour, minute] = String(appointment.start || '').slice(0, 5).split(':').map(Number);
      return Number.isFinite(hour) && Number.isFinite(minute) && hour * 60 + minute >= nowMinutes;
    });
    const displayAppointments = upcoming.length ? upcoming : todays;
    const list = element('ul', 'admin-dashboard-list__items');
    displayAppointments.slice(0, 5).forEach((appointment) => {
      const row = element('li', 'admin-dashboard-schedule-item');
      row.append(
        element('time', 'admin-dashboard-schedule-item__time', formatTime(appointment.start)),
        element('div', 'admin-dashboard-schedule-item__details')
      );
      const details = row.querySelector('.admin-dashboard-schedule-item__details');
      details.append(
        element('strong', '', appointment.client || 'Client'),
        element('span', '', appointment.service || 'Service unavailable')
      );
      const status = element(
        'span',
        `admin-dashboard-status admin-dashboard-status--${String(appointment.status || '').toLowerCase().replace(/[^a-z-]/g, '')}`,
        String(appointment.status || 'Status unavailable').replace(/-/g, ' ')
      );
      row.append(status);
      list.append(row);
    });
    if (!upcoming.length) {
      list.prepend(element('li', 'admin-dashboard-list__note', 'No upcoming appointments; showing today’s full schedule.'));
    }
    if (displayAppointments.length > 5) {
      list.append(element('li', 'admin-dashboard-list__note', `And ${displayAppointments.length - 5} more scheduled today.`));
    }
    schedule.replaceChildren(list);
  }

  function renderAttention({ requests, inventory, thresholds, inquiries, todayKey }) {
    const items = [];
    if (requests.error) {
      items.push({
        href: 'AdminAppointment.html',
        title: 'Appointment requests',
        count: 'Unavailable',
        description: 'Could not load cancellation or reschedule requests.',
        error: true
      });
    } else {
      items.push({
        href: 'AdminAppointment.html',
        title: 'Cancellation & reschedule requests',
        count: requests.data.length,
        description: requests.data.length ? 'Waiting for your review.' : 'No requests waiting for review.',
        urgent: requests.data.length > 0
      });
    }

    if (inquiries.error) {
      items.push({
        href: 'AdminInquiries.html',
        title: 'Unanswered inquiries',
        count: 'Unavailable',
        description: 'Could not load customer messages.',
        error: true
      });
    } else {
      const unanswered = inquiries.data.filter((item) => !String(item.admin_reply || '').trim());
      items.push({
        href: 'AdminInquiries.html',
        title: 'Unanswered inquiries',
        count: unanswered.length,
        description: unanswered.length ? 'Customers are waiting for a reply.' : 'All inquiries have a reply.',
        urgent: unanswered.length > 0
      });
    }

    if (inventory.error || thresholds.error) {
      items.push({
        href: 'AdminInventoryManagement.html',
        title: 'Stock & expiry alerts',
        count: 'Unavailable',
        description: inventory.error
          ? 'Could not load product stock and expiry dates.'
          : 'Could not load the current stock alert thresholds.',
        error: true
      });
    } else {
      const lowStock = inventory.data.filter((product) => Number(product.stock_quantity) <= Number(thresholds.data.lowStock));
      const expired = inventory.data.filter((product) => {
        const expiry = String(product.expiry_date || '').slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(expiry) && expiry < todayKey;
      });
      const expiringSoon = inventory.data.filter((product) => {
        const expiry = String(product.expiry_date || '').slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(expiry) && expiry >= todayKey && expiry <= addDays(todayKey, 30);
      });
      const attentionCount = lowStock.length + expired.length + expiringSoon.length;
      items.push({
        href: 'AdminInventoryManagement.html',
        title: 'Stock & expiry alerts',
        count: attentionCount,
        description: `${lowStock.length} low/critical stock · ${expired.length} expired · ${expiringSoon.length} expiring within 30 days`,
        urgent: attentionCount > 0
      });
    }

    const list = element('div', 'admin-dashboard-attention__items');
    items.forEach((item) => {
      const link = element('a', `admin-dashboard-attention-item${item.urgent ? ' admin-dashboard-attention-item--urgent' : ''}${item.error ? ' admin-dashboard-attention-item--error' : ''}`);
      link.href = item.href;
      const details = element('span', 'admin-dashboard-attention-item__details');
      details.append(element('strong', '', item.title), element('span', '', item.description));
      link.append(details, element('span', 'admin-dashboard-attention-item__count', String(item.count)));
      list.append(link);
    });
    attention.replaceChildren(list);
  }

  function addDays(day, count) {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + count);
    return date.toISOString().slice(0, 10);
  }

  function renderActivity({ users, inquiries, transactions }) {
    const events = [];
    if (!users.error) {
      users.data.users.forEach((user) => {
        events.push({
          date: user.joined,
          type: 'New account',
          title: user.fullName || user.email || 'New user',
          detail: user.roleLabel || user.role || 'Account created',
          href: 'Usermanagement.html'
        });
      });
    }
    if (!inquiries.error) {
      inquiries.data.forEach((inquiry) => {
        events.push({
          date: inquiry.created_at,
          type: 'New inquiry',
          title: `${inquiry.first_name || ''} ${inquiry.last_name || ''}`.trim() || 'Customer inquiry',
          detail: String(inquiry.inquiry_type || 'other').replace(/-/g, ' '),
          href: 'AdminInquiries.html'
        });
      });
    }
    if (!transactions.error) {
      transactions.data.slice(0, 8).forEach((transaction) => {
        events.push({
          date: transaction.created_at,
          type: 'Inventory update',
          title: transaction.product_name || 'Product stock updated',
          detail: `${transaction.transaction_type || 'Stock change'} · ${transaction.quantity ?? 0} units`,
          href: 'AdminInventoryManagement.html'
        });
      });
    }

    events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const latest = events.filter((event) => !Number.isNaN(new Date(event.date).getTime())).slice(0, 6);
    if (!latest.length) {
      const failed = [users, inquiries, transactions].some((result) => result.error);
      stateMessage(activity, failed
        ? 'Recent activity could not be loaded.'
        : 'No recent account, inquiry, or inventory activity yet.', failed);
      return;
    }

    const list = element('ul', 'admin-dashboard-list__items');
    latest.forEach((event) => {
      const link = element('a', 'admin-dashboard-activity-item');
      link.href = event.href;
      const details = element('span', 'admin-dashboard-activity-item__details');
      details.append(
        element('span', 'admin-dashboard-activity-item__type', event.type),
        element('strong', '', event.title),
        element('span', '', event.detail)
      );
      link.append(details, element('time', '', formatDateTime(event.date)));
      list.append(link);
    });
    activity.replaceChildren(list);
  }

  const now = manilaDateParts();
  const todayKey = dateKey(now);
  const nowMinutes = Number(now.hour) * 60 + Number(now.minute);

  const [appointments, requests, inventory, thresholds, inquiries, userStats, users, transactions] = await Promise.all([
    loadResource('appointments', '/api/appointments/admin', Array.isArray),
    loadResource('appointment requests', '/api/appointments/admin/cancellation-requests', Array.isArray),
    loadResource('inventory', '/api/inventory', Array.isArray),
    loadResource('inventory thresholds', '/api/inventory/thresholds', (data) => data
      && Number.isFinite(Number(data.lowStock))
      && Number.isFinite(Number(data.criticalStock))),
    loadResource('inquiries', '/api/inquiries', Array.isArray),
    loadResource('user statistics', '/api/users/stats', (data) => data && Number.isFinite(Number(data.total))),
    loadResource('recent users', '/api/users?page=1&limit=10', (data) => data && Array.isArray(data.users)),
    loadResource('inventory transactions', '/api/inventory/transactions', Array.isArray)
  ]);

  if (appointments.error) {
    todayAppointments.textContent = '—';
    confirmedAppointments.textContent = '—';
  } else {
    const todays = appointments.data.filter((appointment) => String(appointment.date || '').slice(0, 10) === todayKey);
    todayAppointments.textContent = String(todays.length);
    confirmedAppointments.textContent = String(todays.filter((appointment) => appointment.status === 'confirmed').length);
  }
  pendingRequests.textContent = requests.error ? '—' : String(requests.data.length);
  totalUsers.textContent = userStats.error ? '—' : String(userStats.data.total);

  renderSchedule(appointments, todayKey, nowMinutes);
  renderAttention({ requests, inventory, thresholds, inquiries, todayKey });
  renderActivity({ users, inquiries, transactions });
});
