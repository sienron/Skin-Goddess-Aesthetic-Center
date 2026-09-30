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
    const notificationBadge = notificationBtn.querySelector('.badge');

    function showEmptyState(message) {
        if (!notificationList) return;
        const empty = document.createElement('div');
        empty.className = 'notification-empty';
        empty.textContent = message;
        notificationList.replaceChildren(empty);
    }

    async function loadNotifications() {
        try {
            const response = await fetch('/api/notifications');
            if (!response.ok) {
                showEmptyState(response.status === 401
                    ? 'Sign in to view notifications'
                    : 'Notifications could not be loaded');
                return;
            }
            const data = await response.json();
            const notifications = Array.isArray(data.notifications) ? data.notifications : [];

            if (notificationBadge) {
                notificationBadge.textContent = data.unreadCount ? String(data.unreadCount) : '';
                notificationBadge.hidden = !data.unreadCount;
            }
            if (!notificationList) return;

            if (notifications.length === 0) {
                showEmptyState('No notifications yet');
                return;
            }

            notificationList.replaceChildren();
            notifications.forEach((notification) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = `notification-item${notification.is_read ? '' : ' unread'}`;
                item.dataset.notificationId = notification.notification_id;
                item.textContent = notification.message;
                notificationList.append(item);
            });
        } catch (error) {
            console.error('Could not load notifications:', error);
            showEmptyState('Notifications could not be loaded');
        }
    }

    if (notificationList) {
        notificationList.addEventListener('click', async (event) => {
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

    notificationBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = notificationDropdown.classList.toggle("show");
        notificationBtn.setAttribute('aria-expanded', String(isOpen));
        if (isOpen) loadNotifications();
    });

    document.addEventListener("click", (e) => {
        if (!notificationWrap.contains(e.target)) {
            notificationDropdown.classList.remove("show");
            notificationBtn.setAttribute('aria-expanded', 'false');
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            notificationDropdown.classList.remove("show");
            notificationBtn.setAttribute('aria-expanded', 'false');
        }
    });
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
