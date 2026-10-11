document.addEventListener("DOMContentLoaded", async () => {
  let account;
  try {
    const response = await fetch("/api/auth/me");
    if (!response.ok) return;
    account = await response.json();
  } catch (error) {
    console.error("Could not load account role for navigation:", error);
    return;
  }
  if (account.role !== "admin") return;

  const currentPage = window.location.pathname.split("/").pop();
  const links = [
    ["AdminDashboard.html", "Dashboard", "icons/finance-dashboard.svg"],
    ["AdminClients.html", "Clients", "icons/staff-users.svg"],
    ["AdminAppointment.html", "Appointments", "icons/staff-appointments.svg"],
    ["AdminTreatmentHistory.html", "Treatment History", "icons/finance-reports.svg"],
    ["AdminInventoryManagement.html", "Inventory", "icons/staff-inventory.svg"],
    ["AdminInventoryTransactions.html", "Stock Transaction Log", "icons/finance-transactions.svg"],
    ["FinancesTransactions.html", "Sales & Transactions", "icons/finance-transactions.svg"],
    ["FinanceExpenses.html", "Expenses", "icons/finance-expenses.svg"],
    ["FinanceReports.html", "Reports", "icons/finance-reports.svg"],
    ["AdminInquiries.html", "Inquiries", "icons/staff-inquiries.svg"],
    ["Usermanagement.html", "User Management", "icons/staff-users.svg"],
    ["AdminContentManagement.html", "Content Management", "icons/staff-content.svg"],
  ];
  const groups = [
    { label: "Appointments", icon: "icons/staff-appointments.svg", pages: links.slice(1, 4) },
    { label: "Inventory", icon: "icons/staff-inventory.svg", pages: links.slice(4, 6) },
    { label: "Finance", icon: "icons/finance-transactions.svg", pages: links.slice(6, 9) },
  ];

  function makeLink([href, label, icon], child = false) {
    const link = document.createElement("a");
    link.href = href;
    link.className = `um-nav-link${child ? " admin-nav-child" : ""}`;
    if (href === currentPage) {
      link.classList.add("um-nav-link--active");
      link.setAttribute("aria-current", "page");
    }
    if (!child) {
      const image = document.createElement("img");
      image.src = icon;
      image.alt = "";
      link.appendChild(image);
    }
    const text = document.createElement("span");
    text.textContent = label;
    link.appendChild(text);
    return link;
  }

  function groupElement(group, retainedMenu) {
    const section = document.createElement("section");
    section.className = "admin-nav-group";
    const active = group.pages.some(([href]) => href === currentPage);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "admin-nav-group-toggle";
    toggle.setAttribute("aria-expanded", String(active));
    const menuId = `adminContext${group.label.replace(/\s/g, "")}Menu`;
    toggle.setAttribute("aria-controls", menuId);
    const image = document.createElement("img");
    image.src = group.icon;
    image.alt = "";
    const label = document.createElement("span");
    label.textContent = group.label;
    const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chevron.setAttribute("class", "admin-nav-chevron");
    chevron.setAttribute("aria-hidden", "true");
    chevron.setAttribute("viewBox", "0 0 20 20");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m5 7.5 5 5 5-5");
    chevron.appendChild(path);
    toggle.append(image, label, chevron);

    const menu = document.createElement("ul");
    menu.className = "admin-nav-submenu";
    menu.id = menuId;
    menu.hidden = !active;
    group.pages.forEach((page) => {
      const item = document.createElement("li");
      item.appendChild(makeLink(page, true));
      if (retainedMenu && page[0] === "FinancesTransactions.html") {
        item.appendChild(retainedMenu);
      }
      menu.appendChild(item);
    });
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      menu.hidden = expanded;
    });
    section.append(toggle, menu);
    if (active) section.classList.add("is-active");
    return section;
  }

  const financeViews = document.getElementById("transactionViewMenu");
  const nav = document.querySelector(".staff-sidebar nav, .inv-sidebar__nav");
  if (!nav) return;
  nav.replaceChildren();
  nav.classList.add("um-sidebar__nav");
  nav.appendChild(makeLink(links[0]));
  groups.forEach((group) => {
    nav.appendChild(groupElement(group, group.label === "Finance" ? financeViews : null));
  });
  links.slice(9).forEach((page) => nav.appendChild(makeLink(page)));

  const mobileLinks = document.querySelector(".mobile-nav-links");
  if (mobileLinks) {
    mobileLinks.replaceChildren(...links.map(([href, label]) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = href;
      link.textContent = label;
      item.appendChild(link);
      return item;
    }));
  }

  const name = [account.firstName, account.lastName].filter(Boolean).join(" ");
  const profileName = document.querySelector(".inv-sidebar__account-name, .profile-name");
  const profileRole = document.querySelector(".inv-sidebar__account-role, .profile-role");
  if (profileName && name) profileName.textContent = name;
  if (profileRole) profileRole.textContent = "Admin";
});
