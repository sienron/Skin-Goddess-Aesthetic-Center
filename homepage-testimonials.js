(function () {
  const section = document.querySelector('.testimonials-section');
  const list = document.getElementById('testimonialsList');
  if (!section || !list) return;
  const viewport = document.getElementById('testimonialsViewport');
  const track = document.getElementById('testimonialsTrack');
  const story = document.getElementById('homepageScrollStory');
  const closing = document.querySelector('.homepage-closing');
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let animationCleanup = null;
  let visibleTestimonials = [];
  let layoutSignature = '';
  let resizeFrame = 0;
  let assetRefreshHooksInstalled = false;
  const watchedImages = new WeakSet();

  function isPinnedLayout() {
    return window.matchMedia('(min-width: 701px) and (prefers-reduced-motion: no-preference)').matches;
  }

  function getLayoutSignature() {
    const desktop = isPinnedLayout();
    const layout = getColumnCount();
    return `${layout}-${desktop}-${reducedMotionQuery.matches}`;
  }

  function refreshAfterAssets() {
    const refresh = () => {
      window.ScrollTrigger?.refresh();
    };
    if (!assetRefreshHooksInstalled) {
      assetRefreshHooksInstalled = true;
      if (document.fonts?.status === 'loading') document.fonts.ready.then(refresh);
      window.addEventListener('load', refresh, { once: true });
    }
    story.querySelectorAll('img').forEach((image) => {
      if (image.complete || watchedImages.has(image)) return;
      watchedImages.add(image);
      image.addEventListener('load', refresh, { once: true });
      image.addEventListener('error', refresh, { once: true });
    });
  }

  function createCard(item) {
    const entry = document.createElement('article');
    entry.className = 'testimonial-entry';

    const comment = document.createElement('p');
    comment.className = 'testimonial-card__comment';
    comment.textContent = item.comment;

    const card = document.createElement('div');
    card.className = 'testimonial-card';
    card.append(comment);

    const author = document.createElement('div');
    author.className = 'testimonial-author';

    const initial = document.createElement('span');
    initial.className = 'testimonial-author__initial';
    initial.textContent = (item.client || 'C').trim().charAt(0).toUpperCase();
    initial.setAttribute('aria-hidden', 'true');

    const details = document.createElement('div');
    details.className = 'testimonial-author__details';

    const client = document.createElement('p');
    client.className = 'testimonial-author__name';
    client.textContent = item.client || 'Client';

    const date = document.createElement('time');
    date.className = 'testimonial-author__date';
    if (item.createdAt) {
      const postedAt = new Date(item.createdAt);
      if (!Number.isNaN(postedAt.getTime())) {
        date.dateTime = postedAt.toISOString();
        date.textContent = new Intl.DateTimeFormat(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }).format(postedAt);
      }
    }

    details.append(client, date);
    author.append(initial, details);
    entry.append(card, author);
    return entry;
  }

  function getColumnCount() {
    if (window.matchMedia('(max-width: 700px)').matches) return 1;
    if (window.matchMedia('(max-width: 1240px)').matches) return 2;
    return 3;
  }

  function renderTestimonials(testimonials) {
    const columnCount = getColumnCount();
    const columns = Array.from({ length: columnCount }, () => {
      const column = document.createElement('div');
      column.className = 'testimonial-column';
      return column;
    });

    testimonials.forEach((item, index) => {
      columns[index % columnCount].append(createCard(item));
    });

    const layout = document.createElement('div');
    layout.className = 'testimonial-columns';
    layout.append(...columns);
    list.replaceChildren(layout);
  }

  function setupAnimation() {
    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;
    if (!gsap) return null;
    if (ScrollTrigger) gsap.registerPlugin(ScrollTrigger);
    const surface = section.querySelector('.testimonials-section__surface');
    const heading = section.querySelector('.testimonials-section__heading');
    const subheading = section.querySelector('.testimonials-section__subheading');
    const entries = Array.from(list.querySelectorAll('.testimonial-entry'));
    const brand = section.querySelector('.testimonials-brand');
    const logo = brand.querySelector('img');
    const signup = document.querySelector('.homepage-signup');
    const signupLogo = signup.querySelector('.homepage-signup__logo img');
    const contentItems = signup.querySelectorAll('.homepage-signup__content > *');
    const background = document.querySelector('.homepage-closing__background img');
    const isPinned = isPinnedLayout() && Boolean(ScrollTrigger) && !reducedMotionQuery.matches;
    const animatedElements = [surface, heading, subheading, ...entries, list, brand, track, signup, signupLogo, ...contentItems];
    let backgroundTrigger;

    if (!isPinned) {
      closing.classList.remove('homepage-closing--story-ready');
      story.classList.remove('homepage-scroll-story--animated');
      section.classList.remove('testimonials-section--pinned');
      signup.classList.remove('homepage-signup--pinned', 'homepage-signup--released');
      if (ScrollTrigger) {
        backgroundTrigger = ScrollTrigger.create({
          trigger: closing,
          start: 'top top',
          end: 'bottom top',
          onToggle: (self) => closing.classList.toggle('homepage-closing--background-fixed', self.isActive),
        });
        closing.classList.toggle('homepage-closing--background-fixed', Boolean(backgroundTrigger.isActive));
      }
      if (reducedMotionQuery.matches) {
        return () => {
          backgroundTrigger?.kill();
          closing.classList.remove('homepage-closing--background-fixed');
        };
      }

      const timeline = gsap.timeline({ defaults: { ease: 'power2.out' } });
      timeline
        .from([heading, subheading], { y: 12, duration: 0.35, stagger: 0.06 })
        .from(entries, { y: 12, duration: 0.35, stagger: 0.04 }, 0.12)
        .from(brand, { y: 12, duration: 0.35 }, '>-0.05')
        .from([signupLogo, ...contentItems], { y: 12, duration: 0.35, stagger: 0.05 }, '>-0.05');
      return () => {
        timeline.kill();
        backgroundTrigger?.kill();
        closing.classList.remove('homepage-closing--background-fixed');
        gsap.set(animatedElements, { clearProps: 'all' });
      };
    }

    // One-shot entrances: each element plays once when scrolled into view, then stays in its final state.
    const triggers = [];
    const playOnce = (targets, vars) => gsap.to(targets, {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      ease: 'power2.out',
      overwrite: true,
      onComplete: () => gsap.set(targets, { clearProps: 'all' }),
      ...vars,
    });

    gsap.set(brand, { display: 'none' });
    gsap.set([heading, subheading], { autoAlpha: 0, y: 28 });
    gsap.set(entries, { autoAlpha: 0, y: 36, scale: 0.97 });
    gsap.set([signupLogo, ...contentItems], { autoAlpha: 0, y: 28 });

    triggers.push(ScrollTrigger.create({
      trigger: heading,
      start: 'top 95%',
      once: true,
      onEnter: () => playOnce([heading, subheading], { duration: 0.6, stagger: 0.1 }),
    }));

    if (entries.length) {
      triggers.push(...ScrollTrigger.batch(entries, {
        start: 'top 96%',
        once: true,
        batchMax: 3,
        interval: 0.05,
        onEnter: (batch) => playOnce(batch, { duration: 0.6, stagger: 0.1 }),
      }));
    }

    triggers.push(ScrollTrigger.create({
      trigger: signup,
      start: 'top 70%',
      once: true,
      onEnter: () => playOnce([signupLogo, ...contentItems], { duration: 0.6, stagger: 0.1 }),
    }));

    backgroundTrigger = ScrollTrigger.create({
      trigger: closing,
      start: 'top top',
      end: 'bottom top',
      onToggle: (self) => closing.classList.toggle('homepage-closing--background-fixed', self.isActive),
    });
    closing.classList.toggle('homepage-closing--background-fixed', Boolean(backgroundTrigger.isActive));

    let parallax;
    if (background) {
      parallax = gsap.fromTo(background, { yPercent: -4 }, {
        yPercent: 4,
        ease: 'none',
        scrollTrigger: {
          trigger: document.querySelector('.homepage-closing'),
          start: 'top bottom',
          end: 'bottom top',
          scrub: true,
        },
      });
    }

    return () => {
      triggers.forEach((trigger) => trigger.kill());
      gsap.killTweensOf(animatedElements);
      parallax?.scrollTrigger?.kill();
      parallax?.kill();
      backgroundTrigger?.kill();
      gsap.set(animatedElements, { clearProps: 'all' });
      if (background) gsap.set(background, { clearProps: 'transform' });
      closing.classList.remove('homepage-closing--background-fixed');
    };
  }

  function resetAnimation() {
    if (animationCleanup) {
      animationCleanup();
      animationCleanup = null;
    }
  }

  function scheduleLayoutUpdate() {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      const nextSignature = getLayoutSignature();
      if (nextSignature === layoutSignature) return;

      const shouldRerender = nextSignature.split('-')[0] !== layoutSignature.split('-')[0];
      layoutSignature = nextSignature;
      resetAnimation();
      if (shouldRerender) renderTestimonials(visibleTestimonials);
      animationCleanup = setupAnimation();
      refreshAfterAssets();
      window.ScrollTrigger?.refresh();
    });
  }

  window.addEventListener('resize', scheduleLayoutUpdate, { passive: true });
  reducedMotionQuery.addEventListener('change', scheduleLayoutUpdate);

  async function loadTestimonials() {
    try {
      const response = await fetch('/api/ratings/public');
      if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
      const testimonials = await response.json();
      if (!Array.isArray(testimonials)) throw new Error('Testimonial response was not a list');

      visibleTestimonials = testimonials.slice(0, 7);
      renderTestimonials(visibleTestimonials);
      animationCleanup = setupAnimation();
      layoutSignature = getLayoutSignature();
      refreshAfterAssets();
      window.ScrollTrigger?.refresh();
    } catch (error) {
      console.warn('Could not load public testimonials:', error.message);
      animationCleanup = setupAnimation();
      layoutSignature = getLayoutSignature();
      refreshAfterAssets();
      window.ScrollTrigger?.refresh();
    }
  }

  loadTestimonials();
})();
