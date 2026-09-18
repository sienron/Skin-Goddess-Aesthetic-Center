/* ===== Profile Area: show real user info if logged in, Sign In button if not ===== */
(function () {
    const profileWrap = document.getElementById('profileWrap');
    const profileBtn = document.getElementById('profileBtn');
    const profileDropdown = document.getElementById('profileDropdown');
    const mobileProfile = document.querySelector('.mobile-nav-profile');

    if (!profileBtn && !mobileProfile) return;

    function fillProfile(container, fullName, initials) {
        if (!container) return;
        const avatarEl = container.querySelector('.profile-avatar');
        const nameEl = container.querySelector('.profile-name');
        if (avatarEl) avatarEl.textContent = initials;
        if (nameEl) nameEl.textContent = fullName;
    }

    function showSignInButton(isMobile) {
        if (isMobile) {
            if (!mobileProfile) return;
            mobileProfile.innerHTML = `<a href="/LoginPage.html" class="book-now-btn mobile-nav-book-btn" style="text-decoration:none;text-align:center;display:block;">SIGN IN</a>`;
        } else {
            if (!profileWrap) return;
            profileWrap.innerHTML = `<a href="/LoginPage.html" class="book-now-btn" id="profileBtn" style="text-decoration:none;">SIGN IN</a>`;
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
            fillProfile(profileBtn, fullName, initials);
            fillProfile(mobileProfile, fullName, initials);
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

    notificationBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        notificationDropdown.classList.toggle("show");
    });

    document.addEventListener("click", (e) => {
        if (!notificationWrap.contains(e.target)) {
            notificationDropdown.classList.remove("show");
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            notificationDropdown.classList.remove("show");
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
    const hamburgerBtn = document.getElementById("hamburgerBtn");
    const mobileNavDrawer = document.getElementById("mobileNavDrawer");
    const mobileNavOverlay = document.getElementById("mobileNavOverlay");
    const mobileNavClose = document.getElementById("mobileNavClose");

    if (!hamburgerBtn || !mobileNavDrawer || !mobileNavOverlay) return;

    function openDrawer() {
        mobileNavDrawer.classList.add("show");
        mobileNavOverlay.classList.add("show");
        mobileNavDrawer.setAttribute("aria-hidden", "false");
        mobileNavDrawer.removeAttribute("inert");
        hamburgerBtn.setAttribute("aria-expanded", "true");
        document.body.style.overflow = "hidden";
    }

    function closeDrawer() {
        mobileNavDrawer.classList.remove("show");
        mobileNavOverlay.classList.remove("show");
        mobileNavDrawer.setAttribute("aria-hidden", "true");
        mobileNavDrawer.setAttribute("inert", "");
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

    mobileNavDrawer.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", closeDrawer);
    });
})();