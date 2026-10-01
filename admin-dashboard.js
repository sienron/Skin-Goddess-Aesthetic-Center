// AdminDashboard.html page-specific JS
// Handles the mobile sidebar drawer (hamburger + overlay).
// Filter/Export/Create User buttons are stubbed for now —
// wire them up once the backend endpoints exist.

document.addEventListener('DOMContentLoaded', () => {
  const account = document.querySelector('.um-sidebar__account');
  const accountName = account?.querySelector('.um-sidebar__account-name');
  const accountRole = account?.querySelector('.um-sidebar__account-role');
  const accountAvatar = account?.querySelector('.um-avatar');
  const logoutBtn = document.getElementById('adminLogoutBtn');

  fetch('/api/auth/me')
    .then((response) => {
      if (!response.ok) throw new Error('Could not load the current account');
      return response.json();
    })
    .then((data) => {
      const fullName = `${data.firstName || ''} ${data.lastName || ''}`.trim();
      if (accountName && fullName) accountName.textContent = fullName;
      if (accountRole && data.role) {
        accountRole.textContent = String(data.role)
          .split('_')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
      }
      if (accountAvatar) {
        accountAvatar.textContent = `${data.firstName?.[0] || ''}${data.lastName?.[0] || ''}`.toUpperCase();
      }
    })
    .catch((error) => console.error('Could not load admin account:', error));

  logoutBtn?.addEventListener('click', () => {
    fetch('/api/auth/logout', { method: 'POST' })
      .catch(() => {})
      .finally(() => {
        window.location.href = '/LoginPage.html';
      });
  });

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