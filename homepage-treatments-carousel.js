/* Desktop uses a seamless autoplay loop; mobile and reduced-motion users
   navigate the same cards with native horizontal scrolling. */
(function () {
  const track = document.getElementById('treatmentsTrack');
  const carousel = document.getElementById('treatmentsCarousel');
  const wrapper = document.querySelector('.treatments-carousel-wrap');
  const prevBtn = document.getElementById('carouselPrev');
  const nextBtn = document.getElementById('carouselNext');
  if (!track || !carousel || !wrapper) return;

  const desktopMotion = window.matchMedia('(min-width: 701px) and (prefers-reduced-motion: no-preference)');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const BASE_DURATION = 70000;
  const BOOST_RATE = 7;
  let animation = null;
  let hovering = false;
  let boosting = false;
  let resizeTimer = null;

  function getCanonicalCards() {
    return Array.from(track.children).filter((card) =>
      card.matches('.treatment-card') && !card.classList.contains('treatment-card--clone'),
    );
  }

  function removeDesktopClones() {
    track.querySelectorAll('.treatment-card--clone').forEach((clone) => clone.remove());
  }

  function appendDesktopClones(cards) {
    const clones = cards.map((card) => {
      const clone = card.cloneNode(true);
      clone.classList.add('treatment-card--clone');
      clone.setAttribute('aria-hidden', 'true');
      clone.tabIndex = -1;
      clone.querySelectorAll('*').forEach((element) => {
        if (element.tabIndex >= 0) element.tabIndex = -1;
      });
      track.append(clone);
      return clone;
    });

    return clones;
  }

  function createDesktopClones(cards) {
    removeDesktopClones();
    return appendDesktopClones(cards);
  }

  function startDesktopLoop() {
    if (!desktopMotion.matches || animation) return;
    const cards = getCanonicalCards();
    if (!cards.length) return;

    let clones = createDesktopClones(cards);
    const firstVisibleIndex = cards.findIndex((card) => !card.hidden);
    if (firstVisibleIndex < 0) {
      removeDesktopClones();
      return;
    }
    const loopDistance = clones[firstVisibleIndex].getBoundingClientRect().left
      - cards[firstVisibleIndex].getBoundingClientRect().left;

    if (!Number.isFinite(loopDistance) || loopDistance <= 0) {
      console.error('Unable to measure the homepage treatments carousel loop.');
      removeDesktopClones();
      return;
    }

    while (track.getBoundingClientRect().right
      - (track.getBoundingClientRect().left + loopDistance) < carousel.clientWidth) {
      clones = clones.concat(appendDesktopClones(cards));
    }

    animation = track.animate(
      [{ transform: 'translateX(0)' }, { transform: `translateX(-${loopDistance}px)` }],
      { duration: BASE_DURATION, iterations: Infinity, easing: 'linear' },
    );
    restingState();
  }

  function stopDesktopLoop() {
    if (animation) {
      animation.cancel();
      animation = null;
    }
    boosting = false;
    removeDesktopClones();
  }

  function refreshDesktopLoop() {
    if (!desktopMotion.matches) return;
    stopDesktopLoop();
    startDesktopLoop();
  }

  function restingState() {
    if (!animation || boosting) return;
    if (hovering) {
      animation.pause();
    } else {
      animation.playbackRate = 1;
      animation.play();
    }
  }

  function startBoost(direction) {
    if (!animation) return;
    boosting = true;
    animation.playbackRate = BOOST_RATE * direction;
    animation.play();
  }

  function endBoost() {
    if (!boosting) return;
    boosting = false;
    restingState();
  }

  function scrollByCard(direction) {
    const card = track.querySelector('.treatment-card');
    const gap = Number.parseFloat(getComputedStyle(track).columnGap) || 0;
    const distance = (card?.getBoundingClientRect().width || carousel.clientWidth * 0.8) + gap;
    carousel.scrollBy({
      left: distance * direction,
      behavior: reduceMotion.matches ? 'auto' : 'smooth',
    });
  }

  function bindButton(button, direction) {
    if (!button) return;

    button.addEventListener('pointerdown', (event) => {
      if (!animation) return;
      event.preventDefault();
      startBoost(direction);
    });
    button.addEventListener('pointerup', endBoost);
    button.addEventListener('pointerleave', endBoost);
    button.addEventListener('pointercancel', endBoost);
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        if (animation) {
          event.preventDefault();
          startBoost(direction);
        }
      }
    });
    button.addEventListener('keyup', (event) => {
      if (event.key === 'Enter' || event.key === ' ') endBoost();
    });
    button.addEventListener('blur', endBoost);
    button.addEventListener('click', () => {
      if (!animation) scrollByCard(direction);
    });
  }

  wrapper.addEventListener('mouseenter', () => {
    hovering = true;
    restingState();
  });
  wrapper.addEventListener('mouseleave', () => {
    hovering = false;
    restingState();
  });

  bindButton(prevBtn, -1);
  bindButton(nextBtn, 1);
  desktopMotion.addEventListener('change', (event) => {
    if (event.matches) startDesktopLoop();
    else stopDesktopLoop();
  });
  reduceMotion.addEventListener('change', () => {
    if (!desktopMotion.matches) stopDesktopLoop();
    else startDesktopLoop();
  });

  const contentObserver = new MutationObserver((mutations) => {
    if (mutations.some((mutation) =>
      mutation.target.matches('.treatment-card') &&
      !mutation.target.classList.contains('treatment-card--clone'))) {
      refreshDesktopLoop();
    }
  });
  contentObserver.observe(track, { attributes: true, attributeFilter: ['hidden'], subtree: true });

  window.addEventListener('resize', () => {
    if (!desktopMotion.matches) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refreshDesktopLoop, 150);
  });

  startDesktopLoop();
})();
