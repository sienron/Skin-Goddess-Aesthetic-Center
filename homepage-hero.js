(() => {
  const hero = document.querySelector(".homepage .hero");
  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  if (!hero || !gsap) return;
  if (ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  const mm = gsap.matchMedia();
  mm.add("(min-width: 701px) and (prefers-reduced-motion: no-preference)", () => {
    if (!ScrollTrigger) return;
    const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
    intro
      .from(hero.querySelector(".hero-book-btn"), { autoAlpha: 0, duration: 0.6 }, "-=0.65")
      .from(hero.querySelectorAll(".hero-copy > *:not(.hero-book-btn)"), { autoAlpha: 0, y: 20, duration: 0.65, stagger: 0.12 }, "-=0.35");

    hero.classList.add("hero-scrolly");
    const visual = hero.querySelector(".hero-visual");
    const photo = hero.querySelector(".hero-photo-img");
    const copy = hero.querySelector(".hero-copy");
    const reveal = hero.querySelector(".hero-reveal");
    const W = () => hero.clientWidth;
    const H = () => hero.clientHeight;
    const q = (name) => hero.querySelector(".hero-step--" + name);

    // Timeline was authored for a 10-viewport scroll; scale it to 7 viewports with the same pacing.
    const S = 0.7;

    // focus: point on the photo (0-1), at: where it lands on screen (0-1), text: where the text centres
    const stops = [
      { el: q("certified"), scale: 3, focus: [0.455, 0.40], at: [0.88, 0.42], text: [0.27, 0.50] },
      { el: q("personalized"), scale: 3, focus: [0.52, 0.22], at: [0.88, 0.74], text: [0.38, 0.22] },
      { el: q("premium"), scale: 3, focus: [0.50, 0.25], at: [0.10, 0.72], text: [0.60, 0.22] },
      { el: q("support"), scale: 3, focus: [0.52, 0.40], at: [0.06, 0.36], text: [0.70, 0.42] },
    ];
    const place = (s) => {
      const r = s.el.getBoundingClientRect();
      const h = hero.getBoundingClientRect();
      return {
        x: s.text[0] * W() - (r.left - h.left + r.width / 2),
        y: s.text[1] * H() - (r.top - h.top + r.height / 2),
      };
    };
    const updateStopPositions = () => {
      stops.forEach((s) => gsap.set(s.el, {
        autoAlpha: 0,
        scale: k,
        transformOrigin: "50% 50%",
        ...place(s),
      }));
    };
    const zoomTo = (s) => ({
      scale: s.scale,
      x: () => s.at[0] * W() - s.focus[0] * s.scale * visual.offsetWidth,
      y: () => s.at[1] * H() - visual.offsetTop - s.focus[1] * s.scale * visual.offsetHeight,
    });

    // Floating "breathing" tweens only need to run while the hero is pinned.
    const floaters = [];
    const setFloating = (active) => floaters.forEach((tween) => (active ? tween.play() : tween.pause()));

    gsap.set(visual, { transformOrigin: "0 0" });
    visual.style.willChange = "transform";

    const tl = gsap.timeline({
      defaults: { ease: "power2.inOut" },
      scrollTrigger: {
        trigger: hero,
        start: "top top",
        end: () => "+=" + H() * 7,
        pin: true,
        scrub: 1,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onToggle: (self) => setFloating(self.isActive),
      },
    });

    const k = 2.3;
    updateStopPositions();
    ScrollTrigger.addEventListener("refreshInit", updateStopPositions);

    tl.to(photo, { autoAlpha: 1, duration: 0.6, ease: "power1.out" }, 0);
    tl.to(copy, { autoAlpha: 0, y: -40, duration: 0.6 * S, ease: "power2.out" }, 0);
    stops.forEach((s, i) => {
      const t = (0.4 + i * 2) * S;
      tl.to(visual, { ...zoomTo(s), duration: 1.2 * S }, t)
        .to(s.el, { autoAlpha: 1, duration: 0.5 * S, ease: "power1.out" }, t + 0.8 * S)
        .to(s.el, { autoAlpha: 0, duration: 0.4 * S, ease: "power1.in" }, t + 1.7 * S);
    });
    const end = (0.4 + stops.length * 2) * S;
    tl.to(visual, { scale: 1, x: 0, y: 0, duration: 1.4 * S }, end);
    stops.forEach((s) => tl.set(s.el, { x: 0, y: 0, scale: 1 }, end + 1.4 * S).to(s.el, { autoAlpha: 1, duration: 0.6 * S, ease: "power1.out" }, end + 1.4 * S));
    tl.to({}, { duration: 1 * S }); // hold on the final view

    // Gold circle grows from the chat launcher corner and wipes the hero
    const revealInner = hero.querySelector(".hero-reveal-inner");
    const wipe = { r: 0 };
    let lastClip = "";
    const paintWipe = () => {
      const clip = "circle(" + Math.max(wipe.r, 0) + "px at " + (W() - 51) + "px " + (H() - 57) + "px)";
      if (clip === lastClip) return;
      lastClip = clip;
      reveal.style.clipPath = clip;
    };
    paintWipe();
    const carouselWrap = hero.querySelector(".treatments-carousel-wrap");
    gsap.set(revealInner, { xPercent: -130, autoAlpha: 0 });
    gsap.set(carouselWrap, { xPercent: -105, autoAlpha: 0 });
    const wipeStart = () => { reveal.style.willChange = "clip-path"; };
    const wipeStop = () => { reveal.style.willChange = ""; };
    tl.to(wipe, {
      r: () => Math.hypot(W(), H()),
      duration: 1.6 * S,
      ease: "power2.in",
      onStart: wipeStart,
      onUpdate: paintWipe,
      onComplete: () => { paintWipe(); wipeStop(); },
      onReverseComplete: () => { paintWipe(); wipeStop(); },
    })
      .set([visual, copy, ...stops.map((s) => s.el)], { autoAlpha: 0 })
      .to(revealInner, { xPercent: 0, autoAlpha: 1, duration: 1.2 * S, ease: "power3.out" }, ">-" + 0.1 * S)
      .to(carouselWrap, { xPercent: 0, autoAlpha: 1, duration: 1.6 * S, ease: "power3.out" }, ">" + 0.1 * S)
      .to({}, { duration: 1.5 * S });

    hero.querySelectorAll(".hero-step-inner").forEach((el, i) => {
      floaters.push(gsap.to(el, { y: i % 2 ? 7 : -7, duration: 2.4 + i * 0.3, ease: "sine.inOut", yoyo: true, repeat: -1, paused: true }));
    });
    setFloating(tl.scrollTrigger.isActive);

    return () => {
      ScrollTrigger.removeEventListener("refreshInit", updateStopPositions);
      hero.classList.remove("hero-scrolly");
      visual.style.willChange = "";
      reveal.style.willChange = "";
      reveal.style.clipPath = "";
      floaters.length = 0;
    };
  });

  mm.add("(max-width: 700px) and (prefers-reduced-motion: no-preference)", () => {
    const intro = gsap.timeline({ defaults: { ease: "power2.out" } });
    intro
      .from(hero.querySelector(".hero-photo-img"), { autoAlpha: 0, duration: 0.35 })
      .from(hero.querySelector(".hero-book-btn"), { y: 10, duration: 0.25 }, "-=0.1")
      .from(hero.querySelectorAll(".hero-copy > *:not(.hero-book-btn)"), { y: 10, duration: 0.3, stagger: 0.05 }, "-=0.1");
  });

  if (ScrollTrigger) {
    const refresh = () => ScrollTrigger.refresh();
    if (document.readyState === "complete") refresh();
    else window.addEventListener("load", refresh, { once: true });
    document.fonts?.ready.then(refresh);
  }
})();
