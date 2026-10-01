(function () {
  async function getJson(path) {
    const response = await fetch(path, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Request failed (${response.status}).`);
    return response.json();
  }

  function setText(selector, value) {
    const element = document.querySelector(selector);
    if (element && value !== undefined && value !== null) element.textContent = value;
  }

  function setTitleLines(element, value) {
    if (!element || !value) return;
    element.replaceChildren();
    String(value).split('\n').forEach((line, index) => {
      if (index) element.append(document.createElement('br'));
      element.append(document.createTextNode(line));
    });
  }

  async function loadHomepage() {
    try {
      const content = await getJson('/api/content/public/homepage');
      const blocks = new Map(content.map((block) => [block.key, block]));
      const hero = blocks.get('hero');
      const servicesStrip = blocks.get('services_strip');
      const treatmentsIntro = blocks.get('treatments_intro');
      const why = blocks.get('why_skin_goddess');
      const newsletter = blocks.get('newsletter');

      if (hero) {
        setTitleLines(document.querySelector('.hero .headline'), hero.title);
        setText('.hero .lede', hero.body);
      } else {
        document.querySelector('.hero')?.setAttribute('hidden', '');
      }

      if (servicesStrip) {
        const section = document.querySelector('.services-strip');
        const items = servicesStrip.payload?.items || [];
        if (section && items.length) {
          section.replaceChildren(...items.map((item) => {
            const card = document.createElement('div');
            card.className = 'strip-col';
            const heading = document.createElement('h3');
            heading.textContent = item.title;
            const body = document.createElement('p');
            body.textContent = item.body;
            card.append(heading, body);
            return card;
          }));
        }

        document.querySelector('.services-strip')?.setAttribute('hidden', '');
      }

      if (treatmentsIntro) {
        const heading = document.querySelector('.treatments-heading');
        if (heading) {
          heading.replaceChildren(document.createTextNode(`${treatmentsIntro.title} `));
          const accent = document.createElement('span');
          accent.className = 'accent';
          accent.textContent = treatmentsIntro.body;
          heading.append(accent);
        }
      } else {
        document.querySelector('.treatments')?.setAttribute('hidden', '');
      }

      if (why) {
        setText('.wsg-heading', why.title);
        setText('.wsg-lede', why.body);
      } else {
        document.querySelector('.why-skin-goddess')?.setAttribute('hidden', '');
      }

      if (newsletter) {
        setText('.subscribe-heading', newsletter.title);
        setText('.subscribe-lede', newsletter.body);
      } else {
        document.querySelector('.subscribe-notification')?.setAttribute('hidden', '');
      }
    } catch (error) {
      console.warn('Could not load published homepage content:', error.message);
    }
  }

  function formatPrice(value) {
    return `₱${Number(value).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
  }

  function createServiceCard(category, items) {
    const article = document.createElement('article');
    article.className = 'category-card';
    const media = document.createElement('div');
    media.className = 'category-media';
    const image = document.createElement('img');
    image.className = 'category-photo';
    image.src = 'images/SkinGoddessReceptionImg.jpg';
    image.alt = category;
    const badge = document.createElement('span');
    badge.className = 'category-badge';
    badge.textContent = category;
    const mediaText = document.createElement('div');
    mediaText.className = 'category-media-text';
    const heading = document.createElement('h3');
    heading.textContent = category;
    const underline = document.createElement('div');
    underline.className = 'category-underline';
    const meta = document.createElement('div');
    meta.className = 'category-meta';
    meta.append(document.createElement('span'), document.createElement('span'));
    meta.children[0].className = 'category-price-range';
    meta.children[1].className = 'category-count';
    mediaText.append(heading, underline, meta);
    media.append(image, badge, mediaText);
    const body = document.createElement('div');
    body.className = 'category-body';
    const description = document.createElement('p');
    description.className = 'category-body-description';
    body.append(description);
    article.append(media, body);
    updateServiceCard(article, category, items);
    return article;
  }

  function updateServiceCard(article, category, items) {
    article.querySelector('h3').textContent = category;
    const prices = items.map((item) => Number(item.service_price)).filter(Number.isFinite);
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    article.querySelector('.category-price-range').textContent = low === high
      ? formatPrice(low)
      : `${formatPrice(low)} – ${formatPrice(high)}`;
    article.querySelector('.category-count').textContent = `${items.length} ${items.length === 1 ? 'service' : 'services'}`;
    const description = article.querySelector('.category-body-description');
    if (description) description.textContent = items[0]?.description || '';
    const body = article.querySelector('.category-body');
    body.querySelectorAll('.category-service-row').forEach((row) => row.remove());
    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = `category-service-row${index === items.length - 1 ? ' category-service-row--last' : ''}`;
      const name = document.createElement('span');
      name.textContent = item.service_name;
      const price = document.createElement('span');
      price.className = 'category-service-price';
      price.textContent = formatPrice(item.service_price);
      row.append(name, price);
      body.append(row);
    });
  }

  async function loadServices() {
    try {
      const services = await getJson('/api/services');
      const section = document.querySelector('.all-services');
      if (!section || !services.length) return;
      const grouped = new Map();
      services.forEach((service) => {
        const category = service.category || 'General';
        if (!grouped.has(category)) grouped.set(category, []);
        grouped.get(category).push(service);
      });

      const existingCards = new Map();
      section.querySelectorAll('.category-card').forEach((card) => {
        const title = card.querySelector('h3')?.textContent.trim().toLowerCase();
        if (title) existingCards.set(title, card);
      });
      const insertionGrid = section.querySelector('.category-grid:last-of-type') || section.querySelector('.category-grid');
+
      grouped.forEach((items, category) => {
        const card = existingCards.get(category.toLowerCase());
        if (card) {
          updateServiceCard(card, category, items);
          existingCards.delete(category.toLowerCase());
        } else if (insertionGrid) {
          insertionGrid.append(createServiceCard(category, items));
        }
      });
      existingCards.forEach((card) => card.remove());
    } catch (error) {
      console.warn('Could not load published services:', error.message);
    }
  }

  async function loadTeam() {
    try {
      const members = await getJson('/api/content/public/team');
      const grid = document.querySelector('.team-grid');
      if (!grid) return;
      grid.replaceChildren(...members.map((member) => {
        const article = document.createElement('article');
        article.className = 'team-card';
        const photo = document.createElement('div');
        photo.className = 'team-photo';
        const image = document.createElement('img');
        image.src = member.photoUrl;
        image.alt = member.name;
        photo.append(image);
        const info = document.createElement('div');
        info.className = 'team-info';
        const name = document.createElement('h3');
        name.className = 'team-name';
        name.textContent = member.name;
        const role = document.createElement('p');
        role.className = 'team-role';
        role.textContent = member.role;
        const specialty = document.createElement('p');
        specialty.className = 'team-specialty';
        specialty.textContent = member.specialty;
        const experience = document.createElement('p');
        experience.className = 'team-experience';
        experience.textContent = member.experience;
        info.append(name, role, specialty, experience);
        article.append(photo, info);
        return article;
      }));
    } catch (error) {
      console.warn('Could not load published team members:', error.message);
    }
  }

  if (document.querySelector('.hero')) loadHomepage();
  if (document.querySelector('.all-services')) loadServices();
  if (document.querySelector('.team-grid')) loadTeam();
})();
