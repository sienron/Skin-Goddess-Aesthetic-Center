(function () {
    const button = document.getElementById("adminNotificationBtn");
    const dropdown = document.getElementById("adminNotificationDropdown");
    const wrap = button?.closest(".admin-notification-wrap");
    if (!button || !dropdown || !wrap) return;
    const list = dropdown.querySelector('.admin-notification-list');

    async function loadNotifications() {
        try {
            const response = await fetch('/api/notifications');
            if (!response.ok) return;
            const data = await response.json();
            const notifications = Array.isArray(data.notifications) ? data.notifications : [];
            button.title = `${data.unreadCount || 0} unread notifications`;
            if (!list) return;

            list.replaceChildren();
            if (notifications.length === 0) {
                list.textContent = 'No notifications yet';
                return;
            }

            notifications.forEach((notification) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = `admin-notification-item${notification.is_read ? '' : ' unread'}`;
                item.dataset.notificationId = notification.notification_id;
                item.textContent = notification.message;
                list.append(item);
            });
        } catch (error) {
            console.error('Could not load notifications:', error);
        }
    }

    if (list) {
        list.addEventListener('click', async (event) => {
            const item = event.target.closest('[data-notification-id]');
            if (!item || !item.classList.contains('unread')) return;
            try {
                await fetch(`/api/notifications/${encodeURIComponent(item.dataset.notificationId)}/read`, { method: 'PATCH' });
                await loadNotifications();
            } catch (error) {
                console.error('Could not mark notification as read:', error);
            }
        });
    }

    loadNotifications();

    function closeNotifications() {
        dropdown.classList.remove("show");
        button.setAttribute("aria-expanded", "false");
    }

    button.addEventListener("click", (event) => {
        event.stopPropagation();
        const open = dropdown.classList.toggle("show");
        button.setAttribute("aria-expanded", String(open));
        if (open) loadNotifications();
    });

    document.addEventListener("click", (event) => {
        if (!wrap.contains(event.target)) closeNotifications();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeNotifications();
    });
})();
