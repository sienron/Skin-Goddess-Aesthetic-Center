const DASHBOARD_PER_ROLE = Object.freeze({
  client: '/index.html',
  admin: '/AdminDashboard.html',
  aesthetician: '/StaffDashboard.html',
  nail_tech: '/StaffDashboard.html',
  inventory_officer: '/InventoryManagement.html',
  finance_officer: '/FinanceDashboard.html',
  staff: '/StaffDashboard.html',
});

const STAFF_ROLES = Object.freeze(
  Object.keys(DASHBOARD_PER_ROLE).filter((role) => role !== 'client')
);

module.exports = { DASHBOARD_PER_ROLE, STAFF_ROLES };
