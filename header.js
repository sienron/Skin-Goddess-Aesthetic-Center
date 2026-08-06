/* ===== Shared Header Behavior =====
   Include this file on ANY page that uses the shared header markup
   (notification bell + dropdown, logout button). It only wires up
   elements that actually exist on the page, so it's safe to reuse on
   pages that don't have all of them (e.g. the public site header has
   no logout button).
*/

/* ===== Notification Dropdown =====
   notificationList is intentionally left empty in the HTML.
   Once the backend is ready, populate it like:
     notificationList.innerHTML = "";
     notifications.forEach(n => notificationList.appendChild(buildNotificationItem(n)));
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

/* ===== Profile Button =====
   Placeholder handler — replace with real navigation to the client's
   profile/account page once that page exists, e.g.:
     window.location.href = "/profile";
*/
(function () {
    const profileBtn = document.getElementById("profileBtn");
    if (!profileBtn) return;

    profileBtn.addEventListener("click", () => {
        console.log("Profile clicked");
    });
})();

/* ===== Logout Button =====
   Placeholder handler — replace the body with real session/auth teardown
   once the backend exists, e.g. clearing the session token and redirecting:
     fetch("/api/logout", { method: "POST" }).then(() => window.location.href = "/login");
*/
(function () {
    const logoutBtn = document.getElementById("logoutBtn");
    if (!logoutBtn) return;

    logoutBtn.addEventListener("click", () => {
        console.log("Logout requested");
    });
})();