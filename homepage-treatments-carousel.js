/* Treatments carousel: autoplays via the Web Animations API (instead
   of a CSS @keyframes animation) so the nav buttons can push its
   playback rate up/down without breaking the seamless loop. */
(function () {
  const track = document.getElementById('treatmentsTrack');
  const carousel = document.getElementById('treatmentsCarousel');
  const prevBtn = document.getElementById('carouselPrev');
  const nextBtn = document.getElementById('carouselNext');

  if (!track || !carousel) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BASE_DURATION = 70000; // ms — matches the original 70s loop
  const BOOST_RATE = 7;        // playback multiplier while a nav button is held

  const anim = track.animate(
    [{ transform: 'translateX(0)' }, { transform: 'translateX(-50%)' }],
    { duration: BASE_DURATION, iterations: Infinity, easing: 'linear' }
  );

  let hovering = false;
  let boosting = false;

  if (reduceMotion) anim.pause();

  function restingState() {
    if (boosting) return;
    if (hovering || reduceMotion) {
      anim.pause();
    } else {
      anim.playbackRate = 1;
      anim.play();
    }
  }

  carousel.addEventListener('mouseenter', () => { hovering = true; restingState(); });
  carousel.addEventListener('mouseleave', () => { hovering = false; restingState(); });

  function startBoost(direction) {
    boosting = true;
    anim.playbackRate = BOOST_RATE * direction;
    anim.play();
  }

  function endBoost() {
    if (!boosting) return;
    boosting = false;
    restingState();
  }

  [[prevBtn, -1], [nextBtn, 1]].forEach(([btn, direction]) => {
    if (!btn) return;

    // Hold-to-fast-forward (mouse, touch, pen) — release to resume normal play.
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); startBoost(direction); });
    btn.addEventListener('pointerup', endBoost);
    btn.addEventListener('pointerleave', endBoost);
    btn.addEventListener('pointercancel', endBoost);

    // Keyboard: hold Enter/Space to fast-forward the same way.
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startBoost(direction); }
    });
    btn.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' || e.key === ' ') endBoost();
    });
    btn.addEventListener('blur', endBoost);
  });
})();
