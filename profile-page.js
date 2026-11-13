(function () {
  const navigation = document.querySelector('.profile-nav');
  const buttons = Array.from(document.querySelectorAll('[data-profile-section]'));
  const panels = Array.from(document.querySelectorAll('[data-profile-panel]'));
  if (!navigation || !buttons.length || !panels.length) return;

  const validSections = new Set(buttons.map((button) => button.dataset.profileSection));

  function activateSection(section, updateHash) {
    if (!validSections.has(section)) section = 'account';

    buttons.forEach((button) => {
      const active = button.dataset.profileSection === section;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });

    panels.forEach((panel) => {
      panel.hidden = panel.dataset.profilePanel !== section;
    });

    if (updateHash && window.location.hash !== `#${section}`) {
      window.history.replaceState(null, '', `#${section}`);
    }

    document.dispatchEvent(new CustomEvent('profile:sectionchange', { detail: { section } }));
  }

  navigation.addEventListener('click', (event) => {
    const button = event.target.closest('[data-profile-section]');
    if (button && navigation.contains(button)) {
      activateSection(button.dataset.profileSection, true);
    }
  });

  window.addEventListener('hashchange', () => {
    activateSection(window.location.hash.slice(1), false);
  });

  activateSection(window.location.hash.slice(1), false);
})();
