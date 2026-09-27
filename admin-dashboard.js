// AdminDashboard.html page-specific JS
// Handles the mobile sidebar drawer (hamburger + overlay).
// Filter/Export/Create User buttons are stubbed for now —
// wire them up once the backend endpoints exist.

document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.getElementById('umSidebar');
  const toggleBtn = document.getElementById('umSidebarToggle');
  const overlay = document.getElementById('umSidebarOverlay');

  if (!sidebar || !toggleBtn || !overlay) return;

  function openSidebar() {
    sidebar.classList.add('um-sidebar--open');
    overlay.classList.add('um-sidebar-overlay--open');
    toggleBtn.classList.add('um-sidebar-toggle--open');
    toggleBtn.setAttribute('aria-expanded', 'true');
  }

  function closeSidebar() {
    sidebar.classList.remove('um-sidebar--open');
    overlay.classList.remove('um-sidebar-overlay--open');
    toggleBtn.classList.remove('um-sidebar-toggle--open');
    toggleBtn.setAttribute('aria-expanded', 'false');
  }

  toggleBtn.addEventListener('click', () => {
    const isOpen = sidebar.classList.contains('um-sidebar--open');
    if (isOpen) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });

  overlay.addEventListener('click', closeSidebar);

  // Close drawer automatically if the viewport is resized back to desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1024) {
      closeSidebar();
    }
  });
});