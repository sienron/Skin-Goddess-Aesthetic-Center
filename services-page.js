(function () {
  const PAGE_SIZE = 6;
  const FALLBACK_IMAGE = 'images/SkinGoddessReceptionImg.jpg';
  const CATEGORY_ORDER = ['all', 'beauty', 'hair-removal', 'facials', 'body', 'wellness'];
  const CATEGORY_IMAGES = {
    eyelash_extension: 'images/EyelashExtension.webp',
    paraffin_therapy: 'images/ParaffinTherapy.webp',
    hand_treatment: 'images/Manicure.webp',
    threading_services: 'images/ThreadingService.webp',
    foot_treatment: 'images/FootTreatment.webp',
    soft_gel_nail_extensions: 'images/NailExtension.webp',
    body_tightening_bt_body_fat_reduction_bfr: 'images/BodyTightening.webp',
    drip_shot_ed_gs: 'images/DripShot.webp',
    mesotherapy_mt: 'images/Mesotherapy.webp',
    facials: 'images/HydratingFacialImg.webp',
    hair_removal_ipl_hr: 'images/HairRemoval.webp',
    chemical_peeling_tca: 'images/ChemicalPeel.webp',
    electrocautery_ect: 'images/Electrocautery.webp',
  };
  const CATEGORY_DESCRIPTIONS = {
    eyelash_extension: 'Effortless beauty with customized lashes that enhance your eyes for a fuller, longer, and naturally stunning look.',
    paraffin_therapy: 'Deeply moisturizing wax treatment that softens dry, rough hands for smooth, supple, and rejuvenated skin.',
    hand_treatment: 'Gentle nail and hand care that shapes, cleanses, and nourishes for neat, polished, and beautifully groomed hands.',
    threading_services: 'Precise hair removal that gently shapes and defines for clean, smooth, and beautifully refined results.',
    foot_treatment: 'Relaxing care that exfoliates, softens, and refreshes tired feet for smooth, revitalized, and well-groomed results.',
    soft_gel_nail_extensions: 'Lightweight, durable extensions that add length and elegance for beautifully shaped nails in short, medium, or long styles.',
    body_tightening_bt_body_fat_reduction_bfr: 'Non-invasive body contouring that helps firm and sculpt targeted areas for a smoother, more defined silhouette.',
    drip_shot_ed_gs: 'Targeted wellness support designed to replenish essential nutrients and promote energy, vitality, and overall well-being.',
    chemical_peeling_tca: 'Professional exfoliation that renews the skin’s surface for a smoother, brighter, and more even-looking complexion.',
    electrocautery_ect: 'Targeted skin treatment that removes unwanted skin growths for a smoother, clearer, and more refined appearance.',
    mesotherapy_mt: 'Targeted treatment that delivers active ingredients to support healthier, smoother, and more revitalized-looking skin.',
    hair_removal_ipl_hr: 'Gentle light-based hair removal that reduces unwanted hair for smoother, softer, and longer-lasting results.',
  };
  const LEGACY_ANCHORS = {
    eyelash_extension: 'eyelash-extension',
    paraffin_therapy: 'paraffin-therapy',
    hand_treatment: 'hand-treatment',
    threading_services: 'threading-services',
    foot_treatment: 'foot-treatment',
    soft_gel_nail_extensions: 'soft-gel-nail-extensions',
    body_tightening_bt_body_fat_reduction_bfr: 'body-tightening',
    drip_shot_ed_gs: 'drip-shot',
    mesotherapy_mt: 'mesotherapy',
    facials: 'facials',
    hair_removal_ipl_hr: 'hair-removal',
    chemical_peeling_tca: 'chemical-peeling',
    electrocautery_ect: 'electrocautery',
  };

  const grid = document.getElementById('servicesGrid');
  const count = document.getElementById('servicesCount');
  const emptyState = document.getElementById('servicesEmptyState');
  const pagination = document.getElementById('servicesPagination');
  const searchInput = document.getElementById('servicesSearchInput');
  const clearSearch = document.getElementById('servicesSearchClear');
  const categoryButtons = [...document.querySelectorAll('.services-category-nav__item')];
  const dialog = document.getElementById('serviceOptionsDialog');
  const dialogTitle = document.getElementById('serviceOptionsTitle');
  const dialogList = document.getElementById('serviceOptionsList');
  const dialogClose = document.getElementById('serviceOptionsClose');

  const hero = document.querySelector('.services-page-intro');
  if (hero && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.requestAnimationFrame(() => hero.classList.add('is-entering'));
  }

  if (!grid || !count || !emptyState || !pagination || !searchInput || !dialog) return;

  let groups = [];
  let activeCategory = 'all';
  let currentPage = 1;
  let searchQuery = '';

  function slugify(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  function displayCategory(value) {
    return String(value || 'Other')
      .toLowerCase()
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
      .replace(/\bBt\b/g, 'BT')
      .replace(/\bBfr\b/g, 'BFR')
      .replace(/\bIpl\b/g, 'IPL')
      .replace(/\bHr\b/g, 'HR')
      .replace(/\bEd\b/g, 'ED')
      .replace(/\bGs\b/g, 'GS')
      .replace(/\bMt\b/g, 'MT')
      .replace(/\bTca\b/g, 'TCA')
      .replace(/\bEct\b/g, 'ECT');
  }

  function serviceCategory(value) {
    const category = String(value || '').toLowerCase();
    if (/eyelash|lash|nail|hand treatment|foot treatment|paraffin/.test(category)) return 'beauty';
    if (/hair removal|threading/.test(category)) return 'hair-removal';
    if (/facial|chemical peel|electrocautery|mesotherapy/.test(category)) return 'facials';
    if (/body tightening|body fat|contouring/.test(category)) return 'body';
    return 'wellness';
  }

  function formatPrice(value) {
    return `₱${Number(value).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function getMatchingOptions(group, query) {
    if (!query || group.title.toLocaleLowerCase().includes(query)) return group.options;
    return group.options.filter((option) => option.service_name.toLocaleLowerCase().includes(query));
  }

  function getVisibleGroups() {
    return groups
      .filter((group) => activeCategory === 'all' || group.categoryKey === activeCategory)
      .map((group) => ({ ...group, matchingOptions: getMatchingOptions(group, searchQuery) }))
      .filter((group) => group.matchingOptions.length > 0);
  }

  function serviceBadge(group) {
    const title = group.title.toLocaleLowerCase();
    if (/eyelash|lash/.test(title)) return 'Lashes';
    if (/nail/.test(title)) return 'Nails';
    if (/hand|paraffin/.test(title)) return 'Hand Care';
    if (/foot/.test(title)) return 'Foot Care';
    if (/threading|hair removal/.test(title)) return 'Hair Removal';
    if (/facial|peel|mesotherapy|electrocautery/.test(title)) return 'Skin';
    if (/body|contouring/.test(title)) return 'Body';
    if (/drip|shot/.test(title)) return 'Wellness';
    return 'Treatments';
  }

  function bookingUrl(group) {
    const category = group.options[0]?.category || group.categoryValue || group.title;
    const query = new URLSearchParams({
      category,
      categoryType: group.categoryKey,
    });
    return `UserAppointment.html?${query}`;
  }

  function createServiceCard(group) {
    const card = createElement('article', 'services-card');
    card.id = group.anchor;
    card.dataset.serviceCategory = group.categoryKey;

    const imageWrap = createElement('div', 'services-card__image-wrap');
    const image = createElement('img', 'services-card__image');
    image.src = group.imageUrl || FALLBACK_IMAGE;
    image.alt = `${group.title} treatment`;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => {
      if (image.src !== new URL(FALLBACK_IMAGE, window.location.href).href) image.src = FALLBACK_IMAGE;
    }, { once: true });
    const badge = createElement('span', 'services-card__badge', serviceBadge(group));
    const imageContent = createElement('div', 'services-card__image-content');
    const cardTitle = group.title.replace(/\s*\((?:BT|BFR)\)/gi, '');
    const title = createElement('h3', 'services-card__title', cardTitle);
    const divider = createElement('span', 'services-card__divider');
    const meta = createElement('div', 'services-card__meta');
    const prices = group.options.map((option) => Number(option.service_price));
    const lowestPrice = Math.min(...prices);
    const highestPrice = Math.max(...prices);
    const priceRange = lowestPrice === highestPrice
      ? formatPrice(lowestPrice)
      : `${formatPrice(lowestPrice)} – ${formatPrice(highestPrice)}`;
    meta.append(
      createElement('span', 'services-card__price', priceRange),
      createElement('span', 'services-card__option-count', `${group.options.length} ${group.options.length === 1 ? 'service' : 'services'}`)
    );
    imageContent.append(title, divider, meta);
    imageWrap.append(image, badge, imageContent);

    const body = createElement('div', 'services-card__body');
    const description = createElement('p', 'services-card__description', group.description);

    const actions = createElement('div', 'services-card__actions');
    const detailsButton = createElement('button', 'services-card__details', 'View Pricing & Options');
    detailsButton.type = 'button';
    detailsButton.addEventListener('click', () => openOptions(group));
    const bookLink = createElement('a', 'services-card__book', 'Book Appointment');
    bookLink.href = bookingUrl(group);
    actions.append(detailsButton, bookLink);
    body.append(description, actions);
    card.append(imageWrap, body);
    return card;
  }

  function openOptions(group) {
    dialogTitle.textContent = group.title;
    const bookLink = dialog.querySelector('.service-options-dialog__book');
    if (bookLink) bookLink.href = bookingUrl(group);
    dialogList.replaceChildren();
    group.options.forEach((option) => {
      const row = createElement('div', 'service-options-dialog__row');
      const details = createElement('div', 'service-options-dialog__details');
      details.append(
        createElement('span', 'service-options-dialog__name', option.service_name),
        createElement('span', 'service-options-dialog__duration', `${Number(option.duration_minutes)} min`)
      );
      row.append(details, createElement('strong', 'service-options-dialog__price', formatPrice(option.service_price)));
      dialogList.append(row);
    });
    dialog.showModal();
  }

  function pageButton(label, page, options = {}) {
    const button = createElement('button', `services-pagination__button${options.current ? ' is-current' : ''}`, label);
    button.type = 'button';
    button.disabled = Boolean(options.disabled);
    if (options.current) button.setAttribute('aria-current', 'page');
    button.setAttribute('aria-label', options.ariaLabel || `Page ${page}`);
    button.addEventListener('click', () => {
      currentPage = page;
      render();
      document.querySelector('.services-catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return button;
  }

  function renderPagination(pageCount) {
    pagination.replaceChildren();
    pagination.hidden = pageCount <= 1;
    if (pageCount <= 1) return;

    pagination.append(createElement('span', 'services-pagination__status', `Page ${currentPage} of ${pageCount}`));
    pagination.append(pageButton('Previous', Math.max(1, currentPage - 1), {
      disabled: currentPage === 1,
      ariaLabel: 'Previous page',
    }));

    const pages = new Set([1, pageCount]);
    for (let page = Math.max(1, currentPage - 1); page <= Math.min(pageCount, currentPage + 1); page += 1) {
      pages.add(page);
    }
    let previousPage = 0;
    [...pages].sort((a, b) => a - b).forEach((page) => {
      if (previousPage && page - previousPage > 1) {
        pagination.append(createElement('span', 'services-pagination__ellipsis', '…'));
      }
      pagination.append(pageButton(String(page), page, { current: page === currentPage }));
      previousPage = page;
    });

    pagination.append(pageButton('Next', Math.min(pageCount, currentPage + 1), {
      disabled: currentPage === pageCount,
      ariaLabel: 'Next page',
    }));
  }

  function render() {
    const visibleGroups = getVisibleGroups();
    const pageCount = Math.ceil(visibleGroups.length / PAGE_SIZE);
    currentPage = Math.max(1, Math.min(currentPage, pageCount || 1));
    const visibleOptionsCount = visibleGroups.reduce((total, group) => total + group.matchingOptions.length, 0);
    count.textContent = `${visibleGroups.length} ${visibleGroups.length === 1 ? 'service category' : 'service categories'} · ${visibleOptionsCount} ${visibleOptionsCount === 1 ? 'treatment option' : 'treatment options'}`;
    grid.replaceChildren();
    emptyState.hidden = visibleGroups.length > 0;

    if (!visibleGroups.length) {
      emptyState.textContent = searchQuery
        ? 'No services match your search. Try another name or clear the search.'
        : 'No services are available in this category right now.';
    } else {
      const start = (currentPage - 1) * PAGE_SIZE;
      visibleGroups.slice(start, start + PAGE_SIZE).forEach((group) => grid.append(createServiceCard(group)));
    }
    renderPagination(pageCount);
    grid.setAttribute('aria-busy', 'false');
  }

  function groupServices(services, pageContent) {
    const groupsByCategory = new Map();
    services.forEach((service) => {
      const category = String(service.category || 'Wellness').trim();
      if (!groupsByCategory.has(category)) groupsByCategory.set(category, []);
      groupsByCategory.get(category).push(service);
    });

    return [...groupsByCategory.entries()]
      .map(([category, options]) => {
        const categoryContent = pageContent.find((block) => block.payload?.category === category);
        if (categoryContent && !categoryContent.isPublished) return null;
        const categorySlug = slugify(category);
        const description = categoryContent?.body?.trim()
          || CATEGORY_DESCRIPTIONS[categorySlug]
          || String(options[0]?.description || '');
        return {
          title: displayCategory(category),
          categoryValue: category,
          categoryKey: serviceCategory(category),
          options,
          description,
          imageUrl: categoryContent?.imageUrl || CATEGORY_IMAGES[categorySlug] || FALLBACK_IMAGE,
          anchor: LEGACY_ANCHORS[categorySlug] || `service-category-${categorySlug}`,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  async function getJson(path) {
    const response = await fetch(path, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Request failed (${response.status}).`);
    return response.json();
  }

  function showLoadError(error) {
    console.error('Could not load published services:', error);
    count.textContent = 'Services are temporarily unavailable.';
    emptyState.textContent = 'We could not load services right now. Please try again in a moment.';
    emptyState.hidden = false;
    pagination.hidden = true;
    grid.setAttribute('aria-busy', 'false');
  }

  async function loadServices() {
    const [serviceResult, contentResult] = await Promise.allSettled([
      getJson('/api/services'),
      getJson('/api/content/public/pages/services'),
    ]);
    if (serviceResult.status === 'rejected') throw serviceResult.reason;

    const services = serviceResult.value;
    if (!Array.isArray(services)) throw new Error('The services response was not a list.');
    let pageContent = [];
    if (contentResult.status === 'fulfilled' && Array.isArray(contentResult.value)) {
      pageContent = contentResult.value;
    } else if (contentResult.status === 'rejected') {
      console.error('Could not load service page content:', contentResult.reason);
    }

    const intro = pageContent.find((block) => block.key === 'services_intro' && block.isPublished);
    if (intro?.title) document.getElementById('servicesTitle').textContent = intro.title;
    const introText = intro?.body?.trim();
    if (introText && !introText.startsWith('All prices are in Philippine Peso')) {
      document.querySelector('.services-page-intro__lede').textContent = introText;
    }

    groups = groupServices(services, pageContent);
    const hash = decodeURIComponent(window.location.hash.slice(1));
    const anchorIndex = groups.findIndex((group) => group.anchor === hash);
    if (anchorIndex >= 0) currentPage = Math.floor(anchorIndex / PAGE_SIZE) + 1;
    render();
    if (anchorIndex >= 0) {
      window.requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ block: 'center' }));
    }
  }

  categoryButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeCategory = CATEGORY_ORDER.includes(button.dataset.category) ? button.dataset.category : 'all';
      currentPage = 1;
      categoryButtons.forEach((item) => {
        const isActive = item === button;
        item.classList.toggle('is-active', isActive);
        item.setAttribute('aria-pressed', String(isActive));
      });
      render();
    });
  });

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim().toLocaleLowerCase();
    currentPage = 1;
    if (clearSearch) clearSearch.hidden = searchInput.value.length === 0;
    render();
  });
  clearSearch?.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    clearSearch.hidden = true;
    currentPage = 1;
    searchInput.focus();
    render();
  });
  dialogClose?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  loadServices().catch(showLoadError);
})();
