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
                }
            })
            .catch(() => {
                showSignInButton(false);
                showSignInButton(true);
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
            if (String(data.role || '').toLowerCase() === 'admin' && profileDropdown) {
                const dashboardLink = document.createElement('a');
                dashboardLink.href = '/AdminDashboard.html';
                dashboardLink.className = 'profile-dropdown-item';
                dashboardLink.textContent = 'Dashboard';
                profileDropdown.prepend(dashboardLink);
            }
        })
        .catch(() => {
            showSignInButton(false);
            showSignInButton(true);
        });

    // Dropdown open/close (desktop only — wrap/dropdown don't exist once signed out)
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
            if (e.key === 'Escape') {
                profileDropdown.classList.remove('show');
                profileBtn.setAttribute('aria-expanded', 'false');
            }
        });
    }

    const signOutBtn = document.getElementById('signOutBtn');
    if (signOutBtn) {
        signOutBtn.addEventListener('click', () => {
            fetch('/api/auth/logout', { method: 'POST' })
                .catch(() => {})
                .finally(() => {
                    window.location.href = '/LoginPage.html';
                });
        });
    }
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
    const badge = notificationBtn.querySelector('.badge') || document.createElement('span');
    const readStorageKey = 'skinGoddess.readAnnouncements';
    const popupSuppressedKey = 'skinGoddess.suppressAnnouncementPopup';
    let announcements = [];
    let personalNotifications = [];
    let personalUnreadCount = 0;
    let displayedAnnouncement = null;

    if (!badge.classList.contains('badge')) {
        badge.className = 'badge';
        notificationBtn.appendChild(badge);
    }
    notificationBtn.setAttribute('role', 'button');
    notificationBtn.setAttribute('tabindex', '0');
    notificationBtn.setAttribute('aria-haspopup', 'true');
    notificationBtn.setAttribute('aria-expanded', 'false');
    notificationBtn.setAttribute('aria-label', 'View notifications');

    function readPreferenceSet(key, description) {
        try {
            const saved = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(saved) ? new Set(saved.map(String)) : new Set();
        } catch (error) {
            console.warn(`Could not read ${description}:`, error.message);
            return new Set();
        }
    }

    const readAnnouncementKeys = readPreferenceSet(readStorageKey, 'read announcements');

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

    try {
        const navigation = performance.getEntriesByType('navigation')[0];
        if (navigation?.type === 'reload') sessionStorage.removeItem(popupSuppressedKey);
    } catch (error) {
        console.warn('Could not reset announcement pop-up preference after reload:', error.message);
    }

    function savePreferenceSet(key, values, description) {
        try {
            localStorage.setItem(key, JSON.stringify([...values]));
        } catch (error) {
            console.warn(`Could not save ${description}:`, error.message);
        }
    }

    function unreadAnnouncements() {
        return announcements.filter((announcement) => !readAnnouncementKeys.has(`${announcement.announcement_id}:${announcement.updated_at}`));
    }

    function updateBadge() {
        const unreadCount = personalUnreadCount + unreadAnnouncements().length;
        badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        badge.hidden = unreadCount === 0;
    }

    function renderNotificationList() {
        if (!notificationList) return;
        notificationList.replaceChildren();
        unreadAnnouncements().forEach((announcement) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'notification-item notification-item--announcement unread';
            item.dataset.announcementId = announcement.announcement_id;
            const type = document.createElement('span');
            type.className = 'notification-item__type';
            type.textContent = announcement.type;
            const title = document.createElement('strong');
            title.textContent = announcement.title;
            const message = document.createElement('span');
            message.textContent = announcement.message;
            item.append(type, title, message);
            notificationList.append(item);
        });

        personalNotifications.forEach((notification) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `notification-item${notification.is_read ? '' : ' unread'}`;
            item.dataset.notificationId = notification.notification_id;
            item.textContent = notification.message;
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
        let popupSuppressed = false;
        try {
            popupSuppressed = sessionStorage.getItem(popupSuppressedKey) === '1';
        } catch (error) {
            console.warn('Could not read announcement pop-up preference:', error.message);
        }
        const announcement = announcements[0];
        if (!announcement || popupSuppressed) {
            popup.hidden = true;
            popupBackdrop.hidden = true;
            displayedAnnouncement = null;
            return;
        }

        displayedAnnouncement = announcement;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'announcement-popup__close';
        close.setAttribute('aria-label', 'Dismiss announcement');
        close.textContent = '×';
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

        popup.append(close, type, title, message);
        popup.hidden = false;
        popupBackdrop.hidden = false;
        close.focus({ preventScroll: true });
    }

    function dismissAnnouncement() {
        try {
            sessionStorage.setItem(popupSuppressedKey, '1');
        } catch (error) {
            console.warn('Could not suppress announcement pop-up for this session:', error.message);
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

    function markAnnouncementRead(announcement) {
        const key = `${announcement.announcement_id}:${announcement.updated_at}`;
        readAnnouncementKeys.add(key);
        savePreferenceSet(readStorageKey, readAnnouncementKeys, 'read announcements');
        try {
            sessionStorage.setItem(popupSuppressedKey, '1');
        } catch (error) {
            console.warn('Could not suppress announcement pop-up for this session:', error.message);
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
        const results = await Promise.allSettled([loadPublicAnnouncements(), loadPersonalNotifications()]);
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                console.error(index === 0 ? 'Could not load announcements:' : 'Could not load notifications:', result.reason);
            }
        });
        renderNotificationList();
        updateBadge();
    }

    notificationList?.addEventListener('click', async (event) => {
        const announcementItem = event.target.closest('[data-announcement-id]');
        if (announcementItem) {
            const announcement = announcements.find((item) => String(item.announcement_id) === announcementItem.dataset.announcementId);
            if (announcement) markAnnouncementRead(announcement);
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

    const hamburgerBtn = document.getElementById("hamburgerBtn");
    const mobileNavDrawer = document.getElementById("mobileNavDrawer");
    const mobileSidebar = document.querySelector(".staff-sidebar");
    const mobileNavOverlay = document.getElementById("mobileNavOverlay");
    const mobileNavClose = document.getElementById("mobileNavClose");

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
