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
    return `${layout}-${desktop}-${reducedMotionQuery.matches}${desktop ? `-${window.innerWidth}x${window.innerHeight}` : ''}`;
  }

  function refreshAfterAssets() {
    const refresh = () => {
      if (isPinnedLayout() && animationCleanup) {
        resetAnimation();
        animationCleanup = setupAnimation();
      }
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

    testimonials.slice(0, 6).forEach((item, index) => {
      columns[index % columnCount].append(createCard(item));
    });

    const layout = document.createElement('div');
    layout.className = 'testimonial-columns';
    layout.append(...columns);
    const finalEntry = testimonials[6] ? createCard(testimonials[6]) : null;
    if (finalEntry) finalEntry.classList.add('testimonial-entry--final');
    list.replaceChildren(layout, ...(finalEntry ? [finalEntry] : []));
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
        closing.classList.toggle('homepage-closing--background-fixed', backgroundTrigger.isActive);
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

    closing.classList.add('homepage-closing--story-ready');
    story.classList.add('homepage-scroll-story--animated');
    section.classList.add('testimonials-section--pinned');
    signup.classList.add('homepage-signup--pinned');
    gsap.set(surface, { yPercent: 100 });
    gsap.set([heading, subheading], { autoAlpha: 0, y: 44 });
    gsap.set(entries, { autoAlpha: 0, y: 34, scale: 0.97 });
    gsap.set(brand, { autoAlpha: 0 });
    gsap.set(signup, { autoAlpha: 0 });
    gsap.set(signupLogo, { autoAlpha: 0 });
    gsap.set(contentItems, { autoAlpha: 0, y: 28 });

    const viewportHeight = viewport.clientHeight;
    const trackHeight = track.scrollHeight;
    const sourceRect = logo.getBoundingClientRect();
    const targetRect = signupLogo.getBoundingClientRect();
    const brandRect = brand.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    const logoWidth = sourceRect.width;
    const centerTrackY = viewportHeight / 2 - (brandRect.top - trackRect.top + brandRect.height / 2);
    const logoFinalX = targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2);
    const logoFinalY = targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2 + centerTrackY);
    const logoFinalScale = targetRect.width / logoWidth;
    const cardStart = 1.9;
    const cardDuration = 4.6;
    const morphAt = cardStart + cardDuration + 0.45;
    const listFadeAt = cardStart + cardDuration - 0.45;
    const totalDuration = morphAt + 1.6;

    const timeline = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: story,
        start: 'top top',
        end: () => `+=${Math.round(window.innerHeight * totalDuration)}`,
        pin: true,
        scrub: 1,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onLeave: () => {
          signup.classList.remove('homepage-signup--pinned');
          signup.classList.add('homepage-signup--released');
          closing.classList.remove('homepage-closing--story-ready');
        },
        onEnterBack: () => {
          closing.classList.add('homepage-closing--story-ready');
          signup.classList.remove('homepage-signup--released');
          signup.classList.add('homepage-signup--pinned');
        },
      },
    });

    timeline
      .to(surface, { yPercent: 0, duration: 0.7 }, 0)
      .to(heading, { autoAlpha: 1, y: 0, duration: 0.55 }, 0.75)
      .to(subheading, { autoAlpha: 1, y: 0, duration: 0.55 }, 1.3);

    const trackDistance = Math.max(0, trackHeight - viewportHeight);
    timeline.to(track, { y: -trackDistance, duration: cardDuration }, cardStart);

    entries.forEach((entry, index) => {
      const entryTop = entry.getBoundingClientRect().top - trackRect.top;
      const revealAt = cardStart + gsap.utils.clamp(0, 1, entryTop / Math.max(1, trackDistance)) * cardDuration;
      timeline.to(entry, {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        duration: 0.32,
        ease: 'power2.out',
      }, revealAt + index * 0.025);
    });

    timeline
      .to(track, { y: centerTrackY, duration: 0.45 }, morphAt - 0.45)
      .to(list, { autoAlpha: 0, duration: 0.4 }, listFadeAt)
      .to([heading, subheading], { autoAlpha: 0, y: -20, duration: 0.4 }, listFadeAt)
      .to(brand, { autoAlpha: 1, duration: 0.25 }, morphAt - 0.2)
      .to(logo, {
        x: logoFinalX,
        y: logoFinalY,
        scale: logoFinalScale,
        duration: 1.15,
        ease: 'power2.inOut',
      }, morphAt)
      .to(surface, { autoAlpha: 0, duration: 0.65 }, morphAt + 0.6)
      .to(section, { autoAlpha: 0, duration: 0.45 }, morphAt + 1.05)
      .to(signup, { autoAlpha: 1, duration: 0.3 }, morphAt + 0.35)
      .to(signupLogo, { autoAlpha: 1, duration: 0.2 }, morphAt + 0.85)
      .to(contentItems, {
        autoAlpha: 1,
        y: 0,
        duration: 0.5,
        stagger: 0.15,
        ease: 'power2.out',
      }, morphAt + 0.5);

    backgroundTrigger = ScrollTrigger.create({
      trigger: closing,
      start: 'top top',
      end: 'bottom top',
      onToggle: (self) => closing.classList.toggle('homepage-closing--background-fixed', self.isActive),
    });
    closing.classList.toggle('homepage-closing--background-fixed', backgroundTrigger.isActive);

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
      timeline.scrollTrigger?.kill();
      timeline.kill();
      parallax?.scrollTrigger?.kill();
      parallax?.kill();
      backgroundTrigger?.kill();
      gsap.set(animatedElements, { clearProps: 'all' });
      if (background) gsap.set(background, { clearProps: 'transform' });
      closing.classList.remove('homepage-closing--story-ready');
      closing.classList.remove('homepage-closing--background-fixed');
      signup.classList.remove('homepage-signup--released');
      story.classList.remove('homepage-scroll-story--animated');
      section.classList.remove('testimonials-section--pinned');
      signup.classList.remove('homepage-signup--pinned');
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
