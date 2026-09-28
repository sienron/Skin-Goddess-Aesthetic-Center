(function () {
    const button = document.getElementById("adminNotificationBtn");
    const dropdown = document.getElementById("adminNotificationDropdown");
    const wrap = button?.closest(".admin-notification-wrap");
    if (!button || !dropdown || !wrap) return;

    function closeNotifications() {
        dropdown.classList.remove("show");
        button.setAttribute("aria-expanded", "false");
    }

    button.addEventListener("click", (event) => {
        event.stopPropagation();
        const open = dropdown.classList.toggle("show");
        button.setAttribute("aria-expanded", String(open));
    });

    document.addEventListener("click", (event) => {
        if (!wrap.contains(event.target)) closeNotifications();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeNotifications();
    });
})();
