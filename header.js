/* ===== Profile Area: show real user info if logged in, Sign In button if not ===== */
(function () {
    const profileWrap = document.getElementById('profileWrap');
    const profileBtn = document.getElementById('profileBtn');
    const profileDropdown = document.getElementById('profileDropdown');
    const mobileProfile = document.querySelector('.mobile-nav-profile');

    if (!profileBtn && !mobileProfile) return;

    // Auth pages (login/register) shouldn't show a logged-in profile.
    // If the user already has a valid session and lands here anyway
    // (e.g. manually typing the URL, or clicking back), just send
    // them to the homepage instead of showing their name on a page
    // whose whole purpose is signing in / creating a NEW account.
    const authPages = ['login', 'registration'];
    const currentPage = document.body.dataset.page;

    function revealProfile() {
        document.body.classList.add('profile-ready');
    }

    if (authPages.includes(currentPage)) {
        fetch('/api/auth/me')
            .then((res) => {
                if (res.ok) {
                    // Already logged in — don't let them see the login/register form
                    window.location.href = '/index.html';
                } else {
                    // Not logged in (expected case) — replace the hardcoded
                    // placeholder profile markup with the Sign In button
                    showSignInButton(false);
                    showSignInButton(true);
                    revealProfile();
                }
            })
            .catch(() => {
                showSignInButton(false);
                showSignInButton(true);
                revealProfile();
            });
        return;
    }

    function formatRoleLabel(role) {
        return String(role || '').split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }

    function fillProfile(container, fullName, initials, roleLabel) {
        if (!container) return;
        const avatarEl = container.querySelector('.profile-avatar');
        const nameEl = container.querySelector('.profile-name');
        const roleEl = container.querySelector('.profile-role');
        if (avatarEl) avatarEl.textContent = initials;
        if (nameEl) nameEl.textContent = fullName;
        if (roleEl && roleLabel) roleEl.textContent = roleLabel;
    }

    function enableCustomerProfileNavigation() {
        if (profileBtn) {
            profileBtn.setAttribute('aria-haspopup', 'true');
            profileBtn.setAttribute('aria-expanded', 'false');
            profileBtn.setAttribute('aria-controls', 'profileDropdown');
        }
        if (profileDropdown) {
            const signOutButton = profileDropdown.querySelector('[data-sign-out], #signOutBtn');
            const profileLink = document.createElement('a');
            profileLink.href = '/UserAccount.html#account';
            profileLink.className = 'profile-dropdown-item';
            profileLink.textContent = 'Profile';
            profileDropdown.replaceChildren(profileLink);
            if (signOutButton) {
                signOutButton.textContent = 'Sign Out';
                profileDropdown.appendChild(signOutButton);
            }
        }
        if (mobileProfile) {
            mobileProfile.setAttribute('role', 'link');
            mobileProfile.setAttribute('tabindex', '0');
            mobileProfile.setAttribute('aria-label', 'Open your profile');
            mobileProfile.addEventListener('click', () => {
                window.location.assign('/UserAccount.html');
            });
            mobileProfile.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    window.location.assign('/UserAccount.html');
                }
            });
        }
    }

    function showSignInButton(isMobile) {
        if (isMobile) {
            if (!mobileProfile) return;
            mobileProfile.innerHTML = `<a href="/LoginPage.html" class="book-now-btn mobile-nav-book-btn" style="text-decoration:none;text-align:center;display:block;">SIGN IN</a>`;
        } else {
            // Pages like LoginPage.html/Registration.html have a bare
            // #profileBtn with no #profileWrap wrapper around it (no
            // dropdown needed there). Fall back to replacing the button
            // itself directly in that case.
            const target = profileWrap || profileBtn;
            if (!target) return;
            target.outerHTML = `<a href="/LoginPage.html" class="book-now-btn" id="profileBtn" style="text-decoration:none;">SIGN IN</a>`;
        }
    }

    fetch('/api/auth/me')
        .then((res) => {
            if (res.ok) return res.json();
            throw new Error('not logged in');
        })
        .then((data) => {
            const fullName = `${data.firstName} ${data.lastName}`.trim();
            const initials = `${data.firstName?.[0] || ''}${data.lastName?.[0] || ''}`.toUpperCase();
            const roleLabel = formatRoleLabel(data.role);
            fillProfile(profileBtn, fullName, initials, roleLabel);
            fillProfile(mobileProfile, fullName, initials, roleLabel);
            const role = String(data.role || '').toLowerCase();
            if (role === 'client') {
                enableCustomerProfileNavigation();
            } else if (role === 'admin' && profileDropdown) {
                profileDropdown.querySelectorAll(
                    'a[href="UserAccount.html"], a[href="MyAppointments.html"]'
                ).forEach((link) => link.remove());
                const dashboardLink = document.createElement('a');
                dashboardLink.href = '/AdminDashboard.html';
                dashboardLink.className = 'profile-dropdown-item';
                dashboardLink.textContent = 'Dashboard';
                profileDropdown.prepend(dashboardLink);
            }
            revealProfile();
        })
        .catch(() => {
            showSignInButton(false);
            showSignInButton(true);
            revealProfile();
        });

    // Keep the profile dropdown available to pointer and keyboard users.
    if (profileWrap && profileBtn && profileDropdown) {
        profileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = profileDropdown.classList.toggle('show');
            profileBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });

        document.addEventListener('click', (e) => {
            if (!profileWrap.contains(e.target)) {
                profileDropdown.classList.remove('show');
                profileBtn.setAttribute('aria-expanded', 'false');
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && profileDropdown.classList.contains('show')) {
                profileDropdown.classList.remove('show');
                profileBtn.setAttribute('aria-expanded', 'false');
                profileBtn.focus();
            }
        });
    }

    document.addEventListener('click', (event) => {
        const signOutBtn = event.target.closest('[data-sign-out], #signOutBtn');
        if (!signOutBtn) return;
        signOutBtn.disabled = true;
        fetch('/api/auth/logout', { method: 'POST' })
            .catch(() => {})
            .finally(() => {
                window.location.href = '/LoginPage.html';
            });
    });
})();

/* ===== Shared Header Behavior =====
   Include this file on ANY page that uses the shared header markup
   (notification bell + dropdown, logout button). It only wires up
   elements that actually exist on the page, so it's safe to reuse on
   pages that don't have all of them (e.g. the public site header has
   no logout button).
*/

(function () {
    const notificationWrap = document.getElementById("notificationWrap");
    const notificationBtn = document.getElementById("notificationBtn");
    const notificationDropdown = document.getElementById("notificationDropdown");

    if (!notificationWrap || !notificationBtn || !notificationDropdown) return;

    const notificationList = notificationDropdown.querySelector('.notification-list');
    const notificationHeader = notificationDropdown.querySelector('.notification-dropdown-header');
    const badge = notificationBtn.querySelector('.badge') || document.createElement('span');
    const popupSuppressedKey = 'skinGoddess.suppressAnnouncementPopup';
    let announcements = [];
    let personalNotifications = [];
    let personalUnreadCount = 0;
    let displayedAnnouncement = null;
    let isClientAccount = false;
    let notificationCount;
    let markAllButton;

    if (!badge.classList.contains('badge')) {
        badge.className = 'badge';
        notificationBtn.appendChild(badge);
    }
    if (notificationHeader) {
          const title = document.createElement('span');
          title.className = 'notification-dropdown-title';
          title.textContent = 'Notifications';
          notificationCount = document.createElement('span');
          notificationCount.className = 'notification-dropdown-count';
          notificationCount.hidden = true;
          notificationCount.setAttribute('aria-live', 'polite');
          notificationCount.setAttribute('aria-atomic', 'true');
          markAllButton = document.createElement('button');
          markAllButton.type = 'button';
          markAllButton.className = 'notification-mark-all';
          markAllButton.textContent = 'Mark all as read';
          markAllButton.hidden = true;
          notificationHeader.replaceChildren(title, notificationCount, markAllButton);
    }
    notificationBtn.setAttribute('role', 'button');
    notificationBtn.setAttribute('tabindex', '0');
    notificationBtn.setAttribute('aria-haspopup', 'true');
    notificationBtn.setAttribute('aria-expanded', 'false');
    notificationBtn.setAttribute('aria-label', 'View notifications');

    const popupBackdrop = document.createElement('div');
    popupBackdrop.className = 'announcement-popup-backdrop';
    popupBackdrop.hidden = true;
    const popup = document.createElement('aside');
    popup.className = 'announcement-popup';
    popup.hidden = true;
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('tabindex', '-1');
    popup.setAttribute('aria-live', 'polite');
    popup.setAttribute('aria-label', 'Promotion or event announcement');
    document.body.append(popupBackdrop, popup);

    function isAnnouncementRead(announcement) {
        return announcement.is_read === true;
    }

    function unreadAnnouncements() {
        return announcements.filter((announcement) => !isAnnouncementRead(announcement));
    }

    function isAnnouncementPopupSuppressed(announcement) {
        try {
            const version = new Date(announcement.updated_at).getTime();
            return sessionStorage.getItem(`${popupSuppressedKey}:${announcement.announcement_id}:${version}`) === '1';
        } catch (error) {
            console.warn('Could not read announcement pop-up preference:', error.message);
            return false;
        }
    }

    function updateBadge() {
        const unreadCount = personalUnreadCount + unreadAnnouncements().length;
        badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        badge.hidden = unreadCount === 0;
        if (notificationCount) {
            notificationCount.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
            notificationCount.hidden = unreadCount === 0;
        }
        if (markAllButton) markAllButton.hidden = unreadCount === 0;
    }

    function notificationAgeClass(value) {
        const createdAt = new Date(value);
        if (Number.isNaN(createdAt.getTime())) return '';
        const age = Math.max(0, Date.now() - createdAt.getTime());
        if (age < 24 * 60 * 60 * 1000) return 'notification-age--fresh';
        if (age < 7 * 24 * 60 * 60 * 1000) return 'notification-age--recent';
        return 'notification-age--older';
    }

    function appendTimestamp(item, value) {
        const timestamp = document.createElement('time');
        const createdAt = new Date(value);
        timestamp.className = 'notification-item__timestamp';
        if (Number.isNaN(createdAt.getTime())) {
            timestamp.textContent = 'Time unavailable';
        } else {
            timestamp.dateTime = createdAt.toISOString();
            timestamp.textContent = createdAt.toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short'
            });
            const ageClass = notificationAgeClass(value);
            if (ageClass) {
                item.classList.add(ageClass);
                timestamp.classList.add(ageClass);
            }
        }
        item.append(timestamp);
    }

    function appendUnreadLabel(item) {
        const status = document.createElement('span');
        status.className = 'notification-item__unread';
        status.setAttribute('aria-label', 'Unread notification');
        item.append(status);
    }

    function renderNotificationList() {
        if (!notificationList) return;
        notificationList.replaceChildren();
        announcements.forEach((announcement) => {
            const isRead = isAnnouncementRead(announcement);
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `notification-item notification-item--announcement${isRead ? '' : ' unread'}`;
            item.dataset.announcementId = announcement.announcement_id;
            const type = document.createElement('span');
            type.className = 'notification-item__type';
            type.textContent = announcement.type;
            const title = document.createElement('strong');
            title.textContent = announcement.title;
            const message = document.createElement('span');
            message.className = 'notification-item__message';
            message.textContent = announcement.message;
            item.append(type, title, message);
            appendTimestamp(item, announcement.starts_at);
            if (!isRead) appendUnreadLabel(item);
            notificationList.append(item);
        });

        personalNotifications.forEach((notification) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `notification-item${notification.is_read ? '' : ' unread'}`;
            item.dataset.notificationId = notification.notification_id;
            const message = document.createElement('span');
            message.className = 'notification-item__message';
            message.textContent = notification.message;
            item.append(message);
            appendTimestamp(item, notification.created_at);
            if (!notification.is_read) appendUnreadLabel(item);
            notificationList.append(item);
        });

        if (notificationList.children.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'notification-empty';
            empty.textContent = 'No notifications yet';
            notificationList.append(empty);
        }
    }

    function renderAnnouncementsPopup() {
        popup.replaceChildren();
        const announcement = unreadAnnouncements().find((item) => !isAnnouncementPopupSuppressed(item));
        if (!announcement) {
            popup.hidden = true;
            popupBackdrop.hidden = true;
            displayedAnnouncement = null;
            return;
        }

        displayedAnnouncement = announcement;
        if (announcement.image_url) {
            const image = document.createElement('img');
            image.className = 'announcement-popup__image';
            image.src = announcement.image_url;
            image.alt = announcement.title;
            popup.appendChild(image);
            popup.classList.add('announcement-popup--with-image');
        } else {
            popup.classList.remove('announcement-popup--with-image');
        }

        const content = document.createElement('div');
        content.className = 'announcement-popup__content';
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'announcement-popup__close';
        close.setAttribute('aria-label', 'Dismiss announcement');
        const closeIcon = document.createElement('span');
        closeIcon.className = 'announcement-popup__close-icon';
        closeIcon.setAttribute('aria-hidden', 'true');
        closeIcon.textContent = '×';
        close.appendChild(closeIcon);
        close.addEventListener('click', dismissAnnouncement);

        const type = document.createElement('span');
        type.className = 'announcement-popup__type';
        type.textContent = announcement.type;
        const title = document.createElement('h2');
        title.className = 'announcement-popup__title';
        title.textContent = announcement.title;
        const message = document.createElement('p');
        message.className = 'announcement-popup__message';
        message.textContent = announcement.message;

        content.append(close, type, title, message);
        popup.appendChild(content);
        popup.hidden = false;
        popupBackdrop.hidden = false;
        close.focus({ preventScroll: true });
    }

    function dismissAnnouncement() {
        if (displayedAnnouncement) {
            try {
                const version = new Date(displayedAnnouncement.updated_at).getTime();
                sessionStorage.setItem(
                    `${popupSuppressedKey}:${displayedAnnouncement.announcement_id}:${version}`,
                    '1'
                );
            } catch (error) {
                console.warn('Could not suppress announcement pop-up for this session:', error.message);
            }
        }
        renderAnnouncementsPopup();
        renderNotificationList();
        updateBadge();
    }

    popupBackdrop.addEventListener('click', () => {
        if (displayedAnnouncement) dismissAnnouncement();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && displayedAnnouncement) {
            dismissAnnouncement();
        }
    });

    async function markAnnouncementRead(announcement) {
        try {
            const response = await fetch(`/api/announcements/${encodeURIComponent(announcement.announcement_id)}/read`, {
                method: 'PATCH'
            });
            if (!response.ok) throw new Error(`Could not mark announcement as read (${response.status}).`);
            announcement.is_read = true;
        } catch (error) {
            console.error('Could not mark announcement as read:', error);
            return;
        }
        renderAnnouncementsPopup();
        renderNotificationList();
        updateBadge();
    }

    async function loadPublicAnnouncements() {
        const response = await fetch('/api/announcements/public');
        if (!response.ok) throw new Error(`Announcement request failed (${response.status}).`);
        const data = await response.json();
        if (!Array.isArray(data.announcements)) throw new Error('Announcement response was invalid.');
        announcements = data.announcements;
        renderAnnouncementsPopup();
        renderNotificationList();
        updateBadge();
    }

    async function loadCustomerAnnouncements() {
        announcements = [];
        renderAnnouncementsPopup();

        const response = await fetch('/api/auth/me');
        if (response.status === 401) return;
        if (!response.ok) throw new Error(`Could not verify account role (${response.status}).`);
        const user = await response.json();
        isClientAccount = user.role === 'client';
        if (!isClientAccount) return;

        await loadPublicAnnouncements();
    }

    async function loadPersonalNotifications() {
        const response = await fetch('/api/notifications');
        if (response.status === 401) {
            personalNotifications = [];
            personalUnreadCount = 0;
            return;
        }
        if (!response.ok) throw new Error(`Notification request failed (${response.status}).`);
        const data = await response.json();
        personalNotifications = Array.isArray(data.notifications) ? data.notifications : [];
        personalUnreadCount = Number(data.unreadCount) || 0;
    }

    async function loadNotifications() {
        const results = await Promise.allSettled([loadCustomerAnnouncements(), loadPersonalNotifications()]);
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                console.error(index === 0 ? 'Could not load announcements:' : 'Could not load notifications:', result.reason);
            }
        });
        renderNotificationList();
        updateBadge();
    }

    async function markAllNotificationsRead() {
        const unreadAnnouncementIds = unreadAnnouncements()
            .map((announcement) => announcement.announcement_id);
        const hasUnreadPersonalNotifications = personalNotifications.some((notification) => !notification.is_read);
        if (!unreadAnnouncementIds.length && !hasUnreadPersonalNotifications) return;

        markAllButton.disabled = true;
        const requests = [];
        if (hasUnreadPersonalNotifications) {
            requests.push(fetch('/api/notifications/read', { method: 'PATCH' }).then((response) => {
                if (!response.ok) throw new Error(`Could not mark notifications as read (${response.status}).`);
            }));
        }
        unreadAnnouncementIds.forEach((announcementId) => {
            requests.push(fetch(`/api/announcements/${encodeURIComponent(announcementId)}/read`, {
                method: 'PATCH'
            }).then((response) => {
                if (!response.ok) throw new Error(`Could not mark announcement as read (${response.status}).`);
            }));
        });

        const results = await Promise.allSettled(requests);
        results.forEach((result) => {
            if (result.status === 'rejected') {
                console.error('Could not mark all notifications as read:', result.reason);
            }
        });
        await loadNotifications();
        markAllButton.disabled = false;
    }

    markAllButton?.addEventListener('click', (event) => {
        event.stopPropagation();
        markAllNotificationsRead();
    });

    notificationList?.addEventListener('click', async (event) => {
        const announcementItem = event.target.closest('[data-announcement-id]');
        if (announcementItem) {
            const announcement = announcements.find((item) => String(item.announcement_id) === announcementItem.dataset.announcementId);
            if (announcement && !isAnnouncementRead(announcement)) await markAnnouncementRead(announcement);
            return;
        }
        const notificationItem = event.target.closest('[data-notification-id]');
        if (!notificationItem || !notificationItem.classList.contains('unread')) return;
        try {
            const response = await fetch(`/api/notifications/${encodeURIComponent(notificationItem.dataset.notificationId)}/read`, { method: 'PATCH' });
            if (!response.ok) throw new Error(`Could not mark notification as read (${response.status}).`);
            await loadNotifications();
        } catch (error) {
            console.error('Could not mark notification as read:', error);
        }
    });

    function toggleNotifications() {
        const isOpen = notificationDropdown.classList.toggle('show');
        notificationBtn.setAttribute('aria-expanded', String(isOpen));
        if (isOpen) loadNotifications();
    }

    notificationBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleNotifications();
    });
    notificationBtn.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleNotifications();
    });

    document.addEventListener('click', (event) => {
        if (!notificationWrap.contains(event.target)) {
            notificationDropdown.classList.remove('show');
            notificationBtn.setAttribute('aria-expanded', 'false');
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            notificationDropdown.classList.remove('show');
            notificationBtn.setAttribute('aria-expanded', 'false');
        }
    });

    loadNotifications();
    window.setInterval(() => {
        if (!isClientAccount) return;
        loadPublicAnnouncements().catch((error) => {
            console.error('Could not refresh promotional announcements:', error);
        });
    }, 60_000);
})();

(function () {
    const logoutBtn = document.getElementById("logoutBtn");
    if (!logoutBtn) return;

    logoutBtn.addEventListener("click", () => {
        console.log("Logout requested");
    });
})();

(function () {
    const staffSearchBtn = document.getElementById("staffSearchBtn");
    const searchInput = document.getElementById("searchInput");
    const staffHeader = document.querySelector(".staff-header");

    if (staffSearchBtn && searchInput) {
        staffSearchBtn.addEventListener("click", () => {
            staffHeader?.classList.toggle("search-open");
            searchInput.focus();
        });
    }

    const staffSidebar = document.querySelector(".staff-sidebar");
    const actions = staffHeader?.querySelector(".actions");
    if (staffHeader && staffSidebar && actions) {
        const notificationWrap = actions.querySelector(".notification-wrap");
        const themeStorageKey = "skin-goddess-staff-theme";
        const sharedThemeStorageKey = "skin-goddess-theme";
        const customerThemeStorageKey = "skin-goddess-customer-theme";
        const iconMarkup = `
            <svg class="staff-theme-toggle__icon staff-theme-toggle__icon--moon" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M16.8 12.1A7.2 7.2 0 0 1 7.9 3.2 7.3 7.3 0 1 0 16.8 12.1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <svg class="staff-theme-toggle__icon staff-theme-toggle__icon--sun" viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="10" cy="10" r="3.3" fill="none" stroke="currentColor" stroke-width="1.6"/>
                <path d="M10 1.8v2M10 16.2v2M18.2 10h-2M3.8 10h-2m14-5.8-1.4 1.4M5.6 14.4l-1.4 1.4m11.6 0-1.4-1.4M5.6 5.6 4.2 4.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <span class="staff-theme-toggle__label"></span>`;

        function createThemeToggle(location) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `staff-theme-toggle staff-theme-toggle--${location}`;
            button.innerHTML = iconMarkup;
            button.addEventListener("click", () => {
                setTheme(document.body.classList.contains("staff-theme-dark") ? "light" : "dark", true);
            });
            return button;
        }

        const headerThemeToggle = createThemeToggle("header");
        const sidebarThemeToggle = createThemeToggle("sidebar");
        if (notificationWrap) {
            notificationWrap.insertAdjacentElement("afterend", headerThemeToggle);
        } else {
            actions.prepend(headerThemeToggle);
        }
        const profileWrap = staffSidebar.querySelector(".profile-wrap");
        staffSidebar.insertBefore(sidebarThemeToggle, profileWrap || null);

        function setTheme(theme, persist) {
            const isDark = theme === "dark";
            document.body.classList.toggle("staff-theme-dark", isDark);
            [headerThemeToggle, sidebarThemeToggle].forEach((button) => {
                const label = isDark ? "Switch to light mode" : "Switch to dark mode";
                button.setAttribute("aria-label", label);
                button.title = label;
                button.setAttribute("aria-pressed", String(isDark));
                button.querySelector(".staff-theme-toggle__label").textContent = isDark ? "Light mode" : "Dark mode";
            });

            if (!persist) return;
            try {
                window.localStorage.setItem(sharedThemeStorageKey, theme);
                window.localStorage.setItem(themeStorageKey, theme);
                window.localStorage.setItem(customerThemeStorageKey, theme);
            } catch (error) {
                console.warn("Unable to save the staff theme preference.", error);
            }
        }

        let savedTheme = "light";
        try {
            savedTheme = [
                sharedThemeStorageKey,
                themeStorageKey,
                customerThemeStorageKey,
            ].map((key) => window.localStorage.getItem(key))
                .find((theme) => theme === "dark" || theme === "light") || "light";
        } catch (error) {
            console.warn("Unable to read the saved staff theme preference.", error);
        }
        setTheme(savedTheme, false);

        window.addEventListener("storage", (event) => {
            if ([sharedThemeStorageKey, themeStorageKey, customerThemeStorageKey].includes(event.key)) {
                setTheme(event.newValue === "dark" ? "dark" : "light", false);
            }
        });
    }

    const customerThemeToggle = document.getElementById("themeToggle");
    if (customerThemeToggle && (document.body.classList.contains("client-header") || document.body.classList.contains("homepage"))) {
        const themeStorageKey = "skin-goddess-customer-theme";
        const sharedThemeStorageKey = "skin-goddess-theme";
        const staffThemeStorageKey = "skin-goddess-staff-theme";
        const themeIcon = customerThemeToggle.querySelector(".theme-toggle-icon");

        function setCustomerTheme(theme, persist) {
            const isDark = theme === "dark";
            document.body.classList.toggle("customer-theme-dark", isDark);
            customerThemeToggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
            customerThemeToggle.setAttribute("aria-pressed", String(isDark));
            customerThemeToggle.title = isDark ? "Switch to light mode" : "Switch to dark mode";
            if (themeIcon) themeIcon.src = isDark ? "icons/dark-mode.svg" : "icons/light-mode.svg";

            if (!persist) return;
            try {
                window.localStorage.setItem(sharedThemeStorageKey, theme);
                window.localStorage.setItem(staffThemeStorageKey, theme);
                window.localStorage.setItem(themeStorageKey, theme);
            } catch (error) {
                console.warn("Unable to save the customer theme preference.", error);
            }
        }

        customerThemeToggle.addEventListener("click", () => {
            setCustomerTheme(document.body.classList.contains("customer-theme-dark") ? "light" : "dark", true);
        });

        let savedTheme = "light";
        try {
            savedTheme = [
                sharedThemeStorageKey,
                staffThemeStorageKey,
                themeStorageKey,
            ].map((key) => window.localStorage.getItem(key))
                .find((theme) => theme === "dark" || theme === "light") || "light";
        } catch (error) {
            console.warn("Unable to read the saved customer theme preference.", error);
        }
        setCustomerTheme(savedTheme, false);

        window.addEventListener("storage", (event) => {
            if ([sharedThemeStorageKey, staffThemeStorageKey, themeStorageKey].includes(event.key)) {
                setCustomerTheme(event.newValue === "dark" ? "dark" : "light", false);
            }
        });
    }

    const hamburgerBtn = document.getElementById("hamburgerBtn");
    const mobileNavDrawer = document.getElementById("mobileNavDrawer");
    const mobileSidebar = document.querySelector(".staff-sidebar");
    const mobileNavOverlay = document.getElementById("mobileNavOverlay");
    const mobileNavClose = document.getElementById("mobileNavClose");

    document.querySelectorAll(".mobile-nav-book-btn:not([onclick]):not([href])").forEach((button) => {
        button.addEventListener("click", () => {
            window.location.href = "/UserAppointment.html";
        });
    });

    if (!hamburgerBtn || !mobileNavDrawer || !mobileNavOverlay) return;

    function openDrawer() {
        const drawer = mobileSidebar || mobileNavDrawer;
        drawer.classList.add(mobileSidebar ? "mobile-sidebar-open" : "show");
        mobileNavOverlay.classList.add("show");
        drawer.setAttribute("aria-hidden", "false");
        drawer.removeAttribute("inert");
        hamburgerBtn.setAttribute("aria-expanded", "true");
        document.body.style.overflow = "hidden";
    }

    function closeDrawer() {
        const drawer = mobileSidebar || mobileNavDrawer;
        drawer.classList.remove(mobileSidebar ? "mobile-sidebar-open" : "show");
        mobileNavOverlay.classList.remove("show");
        drawer.setAttribute("aria-hidden", "true");
        drawer.setAttribute("inert", "");
        hamburgerBtn.setAttribute("aria-expanded", "false");
        document.body.style.overflow = "";
    }

    hamburgerBtn.addEventListener("click", openDrawer);
    mobileNavOverlay.addEventListener("click", closeDrawer);

    if (mobileNavClose) {
        mobileNavClose.addEventListener("click", closeDrawer);
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeDrawer();
    });

    const drawerLinks = (mobileSidebar || mobileNavDrawer).querySelectorAll("a");
    drawerLinks.forEach((link) => {
        link.addEventListener("click", closeDrawer);
    });
})();

/* ===== Glass nav: sliding hover indicator ===== */
(function () {
    const list = document.querySelector('body.homepage .public-nav-links, body.client-header .public-nav-links');
    if (!list) return;
    const indicator = document.createElement('span');
    indicator.className = 'nav-indicator';
    list.appendChild(indicator);
    const links = list.querySelectorAll('a');
    const active = list.querySelector('a.active');

    function moveTo(a) {
        const el = a && a.parentElement;
        if (!el) { indicator.style.opacity = '0'; return; }
        indicator.style.width = el.offsetWidth + 'px';
        indicator.style.height = el.offsetHeight + 'px';
        indicator.style.transform = 'translate(' + el.offsetLeft + 'px,' + el.offsetTop + 'px)';
        indicator.style.opacity = '1';
    }
    const reset = () => moveTo(active);

    links.forEach(a => {
        a.addEventListener('mouseenter', () => moveTo(a));
        a.addEventListener('focus', () => moveTo(a));
        a.addEventListener('blur', reset);
    });
    list.addEventListener('mouseleave', reset);
    window.addEventListener('resize', reset);
    window.addEventListener('load', reset);
    reset();
})();
