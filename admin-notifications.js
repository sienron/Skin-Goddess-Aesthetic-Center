(function () {
    const sidebar = document.querySelector(".um-sidebar, .inv-sidebar");
    let headerActions = document.querySelector(".um-header__actions, .header-actions");
    const header = document.querySelector(".um-header");

    if (!headerActions && header) {
        headerActions = document.createElement("div");
        headerActions.className = "staff-theme-header-actions";
        header.append(headerActions);
    }

    if (sidebar && headerActions) {
        const notificationWrap = headerActions.querySelector(".admin-notification-wrap");
        const account = sidebar.querySelector(".um-sidebar__account, .inv-sidebar__account");
        const storageKey = "skin-goddess-staff-theme";
        const icons = `
            <svg class="staff-theme-toggle__icon staff-theme-toggle__icon--moon" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M16.8 12.1A7.2 7.2 0 0 1 7.9 3.2 7.3 7.3 0 1 0 16.8 12.1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <svg class="staff-theme-toggle__icon staff-theme-toggle__icon--sun" viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="10" cy="10" r="3.3" fill="none" stroke="currentColor" stroke-width="1.6"/>
                <path d="M10 1.8v2M10 16.2v2M18.2 10h-2M3.8 10h-2m14-5.8-1.4 1.4M5.6 14.4l-1.4 1.4m11.6 0-1.4-1.4M5.6 5.6 4.2 4.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <span class="staff-theme-toggle__label"></span>`;

        function createToggle(location) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `staff-theme-toggle staff-theme-toggle--${location}`;
            button.innerHTML = icons;
            button.addEventListener("click", () => {
                setTheme(document.body.classList.contains("staff-theme-dark") ? "light" : "dark", true);
            });
            return button;
        }

        const headerToggle = createToggle("header");
        const sidebarToggle = createToggle("sidebar");
        if (notificationWrap) {
            notificationWrap.insertAdjacentElement("afterend", headerToggle);
        } else {
            headerActions.prepend(headerToggle);
        }
        sidebar.insertBefore(sidebarToggle, account || null);

        function setTheme(theme, persist) {
            const isDark = theme === "dark";
            document.body.classList.toggle("staff-theme-dark", isDark);
            [headerToggle, sidebarToggle].forEach((button) => {
                const label = isDark ? "Switch to light mode" : "Switch to dark mode";
                button.setAttribute("aria-label", label);
                button.title = label;
                button.setAttribute("aria-pressed", String(isDark));
                button.querySelector(".staff-theme-toggle__label").textContent = isDark ? "Light mode" : "Dark mode";
            });
            if (!persist) return;
            try {
                window.localStorage.setItem(storageKey, theme);
            } catch (error) {
                console.warn("Unable to save the staff theme preference.", error);
            }
        }

        let savedTheme = "light";
        try {
            savedTheme = window.localStorage.getItem(storageKey) === "dark" ? "dark" : "light";
        } catch (error) {
            console.warn("Unable to read the saved staff theme preference.", error);
        }
        setTheme(savedTheme, false);

        window.addEventListener("storage", (event) => {
            if (event.key === storageKey) {
                setTheme(event.newValue === "dark" ? "dark" : "light", false);
            }
        });
    }

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
