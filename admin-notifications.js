(function () {
    const button = document.getElementById("adminNotificationBtn");
    const dropdown = document.getElementById("adminNotificationDropdown");
    const wrap = button?.closest(".admin-notification-wrap");
    if (!button || !dropdown || !wrap) return;
    const list = dropdown.querySelector('.admin-notification-list');
    const unreadBadge = document.getElementById('inventoryUnreadNotificationCount');
    let notifications = [];
    let isLoadingNotifications = false;

    function renderUnreadCount(count) {
        const unreadCount = Math.max(0, Number(count) || 0);
        button.title = `${unreadCount} unread notifications`;
        if (!unreadBadge) return;
        unreadBadge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        unreadBadge.hidden = unreadCount === 0 || dropdown.classList.contains('show');
        unreadBadge.setAttribute('aria-label', `${unreadCount} unread notifications`);
    }

    function showEmptyState(message) {
        if (!list) return;
        const empty = document.createElement('div');
        empty.className = 'notification-empty';
        empty.textContent = message;
        list.replaceChildren(empty);
    }

    async function loadNotifications() {
        if (isLoadingNotifications || document.visibilityState === 'hidden') return null;
        isLoadingNotifications = true;
        try {
            const response = await fetch('/api/notifications', { cache: 'no-store' });
            if (!response.ok) throw new Error(`Could not load notifications (HTTP ${response.status}).`);
            const data = await response.json();
            notifications = Array.isArray(data.notifications) ? data.notifications : [];
            renderUnreadCount(data.unreadCount);
            if (!list) return;

            if (notifications.length === 0) {
                showEmptyState('No notifications yet');
                return;
            }

            list.replaceChildren();
            notifications.forEach((notification) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = `admin-notification-item${notification.is_read ? '' : ' unread'}`;
                item.dataset.notificationId = notification.notification_id;
                const message = document.createElement('span');
                message.textContent = notification.message;
                item.append(message);
                const timestamp = document.createElement('time');
                const createdAt = new Date(notification.created_at);
                timestamp.className = 'admin-notification-timestamp';
                if (Number.isNaN(createdAt.getTime())) {
                    timestamp.textContent = 'Time unavailable';
                } else {
                    timestamp.dateTime = createdAt.toISOString();
                    timestamp.textContent = createdAt.toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short'
                    });
                }
                item.append(timestamp);
                if (!notification.is_read) {
                    const status = document.createElement('span');
                    status.className = 'admin-notification-unread-label';
                    status.textContent = 'UNREAD';
                    item.append(status);
                }
                list.append(item);
            });
            return notifications;
        } catch (error) {
            console.error('Could not load notifications:', error);
            showEmptyState('Notifications could not be loaded');
            return null;
        } finally {
            isLoadingNotifications = false;
        }
    }

    if (list) {
        list.addEventListener('click', async (event) => {
            const item = event.target.closest('[data-notification-id]');
            if (!item || !item.classList.contains('unread')) return;
            try {
                const response = await fetch(`/api/notifications/${encodeURIComponent(item.dataset.notificationId)}/read`, {
                    method: 'PATCH',
                    headers: { Accept: 'application/json' }
                });
                if (!response.ok) throw new Error(`Could not mark notification as read (HTTP ${response.status}).`);
                await loadNotifications();
            } catch (error) {
                console.error('Could not mark notification as read:', error);
            }
        });
    }

    loadNotifications();

    async function markNotificationsRead() {
        if (!notifications.some((notification) => !notification.is_read)) return;

        try {
            const response = await fetch('/api/notifications/read', {
                method: 'PATCH',
                headers: { Accept: 'application/json' }
            });
            if (!response.ok) throw new Error(`Could not mark notifications as read (HTTP ${response.status}).`);
            notifications = notifications.map((notification) => ({ ...notification, is_read: true }));
            renderUnreadCount(0);
        } catch (error) {
            console.error('Could not mark notifications as read:', error);
            await loadNotifications();
        }
    }

    function closeNotifications() {
        const wasOpen = dropdown.classList.contains('show');
        dropdown.classList.remove("show");
        button.setAttribute("aria-expanded", "false");
        if (wasOpen) markNotificationsRead();
    }

    button.addEventListener("click", (event) => {
        event.stopPropagation();
        const open = dropdown.classList.toggle("show");
        button.setAttribute("aria-expanded", String(open));
        if (open) {
            loadNotifications();
        } else {
            markNotificationsRead();
        }
    });

    document.addEventListener("click", (event) => {
        if (!wrap.contains(event.target)) closeNotifications();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeNotifications();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') loadNotifications();
    });

    window.setInterval(loadNotifications, 3000);
})();
