(function () {
  async function getJson(path, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, { credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error(`Request failed (${response.status}).`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // Only touch the DOM when the published value differs from the static HTML, so default content never flickers.
  function setText(selector, value) {
    const element = document.querySelector(selector);
    if (element && value !== undefined && value !== null && element.textContent !== value) element.textContent = value;
  }

  function setTitleLines(element, value) {
    if (!element || !value) return;
    const current = Array.from(element.childNodes).map((node) => (node.nodeName === 'BR' ? '\n' : node.textContent)).join('');
    if (current === String(value)) return;
    element.replaceChildren();
    String(value).split('\n').forEach((line, index) => {
      if (index) element.append(document.createElement('br'));
      element.append(document.createTextNode(line));
    });
  }

  function setAccentHeading(selector, value) {
    const element = document.querySelector(selector);
    if (!element || !value) return;
    const accent = element.querySelector('.text-gold, .text-gold-italic');
    const accentText = accent?.textContent || '';
    const accentIndex = accentText ? String(value).indexOf(accentText) : -1;
    if (accentIndex < 0) {
      element.textContent = value;
      return;
    }
    const replacement = document.createElement(accent.tagName.toLowerCase());
    replacement.className = accent.className;
    replacement.textContent = accentText;
    element.replaceChildren(
      document.createTextNode(String(value).slice(0, accentIndex)),
      replacement,
      document.createTextNode(String(value).slice(accentIndex + accentText.length)),
    );
  }

  // A <picture> prefers its WebP <source>, so a CMS image has to drop the sources to take effect.
  function setImageOverride(selector, url) {
    if (typeof url !== 'string' || !url) return;
    const image = document.querySelector(selector);
    if (!image) return;
    image.parentElement?.querySelectorAll('source').forEach((source) => source.remove());
    image.removeAttribute('srcset');
    if (image.getAttribute('src') !== url) image.src = url;
  }

  async function loadHomepage() {
    try {
      const content = await getJson('/api/content/public/pages/home');
      const blocks = new Map(content.filter((block) => block.isPublished).map((block) => [block.key, block]));
      const hero = blocks.get('hero');
      const treatmentsIntro = blocks.get('treatments_intro');

      if (hero) {
        setTitleLines(document.querySelector('.hero .headline'), hero.title);
        setText('.hero .lede', hero.body);
        // The hero visual is part of the animation, not CMS page content.
        // A CMS override here replaces the alpha-channel GSAP asset with a
        // full-bleed photo that paints over the cream hero background.
      } else {
        document.querySelector('.hero')?.setAttribute('hidden', '');
      }

      if (treatmentsIntro) {
        const heading = document.querySelector('.treatments-heading');
        if (heading && heading.textContent !== `${treatmentsIntro.title} ${treatmentsIntro.body}`) {
          heading.replaceChildren(document.createTextNode(`${treatmentsIntro.title} `));
          const accent = document.createElement('span');
          accent.className = 'accent';
          accent.textContent = treatmentsIntro.body;
          heading.append(accent);
        }
      } else {
        document.querySelector('.treatments')?.setAttribute('hidden', '');
      }

    } catch (error) {
      console.warn('Could not load published homepage content:', error.message);
    }
  }

  function formatPrice(value) {
    return `${'\u20B1'}${Number(value).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
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
      : `${formatPrice(low)} ${'\u2013'} ${formatPrice(high)}`;
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
      const [services, pageContent] = await Promise.all([
        getJson('/api/services'),
        getJson('/api/content/public/pages/services'),
      ]);
      const section = document.querySelector('.all-services');
      if (!section || !services.length) return;
      const pageBlocks = new Map(pageContent.map((block) => [block.key, block]));
      const intro = pageBlocks.get('services_intro');
      if (intro?.isPublished) {
        setText('.services-headline h1', intro.title);
        setText('.services-headline-lede', intro.body);
        document.querySelector('.services-headline')?.removeAttribute('hidden');
      } else {
        document.querySelector('.services-headline')?.setAttribute('hidden', '');
      }

      const applyCategoryImage = (card, category) => {
        const content = pageContent.find((block) => block.payload?.category === category);
        if (content?.imageUrl) {
          const image = card.querySelector('.category-photo');
          if (image) image.src = content.imageUrl;
        }
      };
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
      grouped.forEach((items, category) => {
        const card = existingCards.get(category.toLowerCase());
        const categoryContent = pageContent.find((block) => block.payload?.category === category);
        if (categoryContent && !categoryContent.isPublished) {
          card?.remove();
          existingCards.delete(category.toLowerCase());
          return;
        }
        if (card) {
          updateServiceCard(card, category, items);
          applyCategoryImage(card, category);
          existingCards.delete(category.toLowerCase());
        } else if (insertionGrid) {
          const newCard = createServiceCard(category, items);
          applyCategoryImage(newCard, category);
          insertionGrid.append(newCard);
        }
      });
      existingCards.forEach((card) => card.remove());
      if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
    } catch (error) {
      console.warn('Could not load published services:', error.message);
    }
  }

  async function loadAboutContent() {
    try {
      const blocks = new Map((await getJson('/api/content/public/pages/about'))
        .filter((block) => block.isPublished).map((block) => [block.key, block]));
      const hero = blocks.get('about_hero');
      const story = blocks.get('about_story');
      const teamIntro = blocks.get('about_team_intro');

      if (hero) {
        setAccentHeading('.about-title', hero.title);
        setText('.about-breadcrumb', hero.body);
      } else document.querySelector('.about-hero')?.setAttribute('hidden', '');

      if (story) {
        setAccentHeading('.story-heading', story.title);
        setText('.story-text', story.body);
        if (story.imageUrl) {
          const image = document.querySelector('.story-photo img');
          if (image) image.src = story.imageUrl;
        }
      } else document.querySelector('.story-section')?.setAttribute('hidden', '');

      if (teamIntro) {
        setAccentHeading('.team-heading', teamIntro.title);
        setText('.team-subtitle', teamIntro.body);
      } else document.querySelector('.team-section')?.setAttribute('hidden', '');
    } catch (error) {
      console.warn('Could not load published About page content:', error.message);
    }
  }

  async function loadContactContent() {
    try {
      const blocks = new Map((await getJson('/api/content/public/pages/contact'))
        .filter((block) => block.isPublished).map((block) => [block.key, block]));
      const hero = blocks.get('contact_hero');
      const message = blocks.get('contact_message');
      if (hero) {
        setAccentHeading('.contact-title', hero.title);
        setText('.contact-breadcrumb', hero.body);
      } else document.querySelector('.contact-hero')?.setAttribute('hidden', '');

      if (message) {
        setAccentHeading('.form-title', message.title);
        setText('.form-subtitle', message.body);
      } else document.querySelector('.contact-form-col')?.setAttribute('hidden', '');

      const info = document.querySelectorAll('.contact-info-card .info-row');
      [
        ['contact_address', 0],
        ['contact_phone', 1],
        ['contact_email', 2],
      ].forEach(([key, index]) => {
        const block = blocks.get(key);
        const row = info[index];
        if (!block) {
          row?.setAttribute('hidden', '');
          return;
        }
        const title = row?.querySelector('.info-title');
        if (title) title.textContent = block.title;
        const descriptions = row?.querySelectorAll('.info-sub');
        if (descriptions?.length) {
          const lines = block.body.split('\n');
          descriptions.forEach((description, lineIndex) => {
            description.textContent = lines[lineIndex] || '';
            description.hidden = !lines[lineIndex];
          });
        }
      });
    } catch (error) {
      console.warn('Could not load published Contact page content:', error.message);
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
  if (document.querySelector('.about-main')) loadAboutContent();
  if (document.querySelector('.contact-main')) loadContactContent();
})();
