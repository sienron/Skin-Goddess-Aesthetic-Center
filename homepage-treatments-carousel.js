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

  function startDesktopLoop() {
    if (!desktopMotion.matches || animation) return;
    animation = track.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-50%)' }],
      { duration: BASE_DURATION, iterations: Infinity, easing: 'linear' },
    );
    restingState();
  }

  function stopDesktopLoop() {
    if (!animation) return;
    animation.cancel();
    animation = null;
    boosting = false;
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
  startDesktopLoop();
})();
