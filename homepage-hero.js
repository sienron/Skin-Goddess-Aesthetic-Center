(() => {
  const benefitCards = Array.from(document.querySelectorAll("body.homepage .homepage-benefit-card"));
  benefitCards.forEach((card) => {
    card.addEventListener("click", () => {
      const shouldExpand = !card.classList.contains("is-expanded");
      benefitCards.forEach((otherCard) => {
        const isExpanded = otherCard === card && shouldExpand;
        otherCard.classList.toggle("is-expanded", isExpanded);
        otherCard.setAttribute("aria-expanded", String(isExpanded));
      });
    });
  });

  const hero = document.querySelector(".homepage .hero");
  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  if (!hero || !gsap) return;
  if (ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  const mm = gsap.matchMedia();
  mm.add("(prefers-reduced-motion: no-preference)", () => {
    const image = hero.querySelector(".hero-photo-img");
    const addWanderingTimeline = ({
      target,
      xProperty = "x",
      yProperty = "y",
      xRange,
      yRange,
      xCenter = 0,
      yCenter = 0,
      duration,
      delay,
      index = 0,
      durationOffset = 0,
      unit = "",
    }) => {
      const wander = gsap.timeline({
        repeat: -1,
        repeatRefresh: true,
        delay,
      });

      const randomOffset = (range, center) => {
        const value = gsap.utils.random(center - range, center + range);
        return unit ? `${value}${unit}` : value;
      };

      for (let waypoint = 0; waypoint < 4; waypoint += 1) {
        wander.to(target, {
          [xProperty]: () => randomOffset(xRange, xCenter),
          [yProperty]: () => randomOffset(yRange, yCenter),
          duration: duration + ((index + waypoint) % 3) * 0.22 + durationOffset,
          ease: "sine.inOut",
        });
      }
    };
    const motionProfiles = {
      horizontal: { x: 150, y: 95, duration: 3.15 },
      diagonal: { x: 135, y: 125, duration: 3.3 },
      vertical: { x: 95, y: 135, duration: 3 },
      circular: { x: 120, y: 105, duration: 3.5 },
    };
    const ambientGroups = [
      { selector: ".homepage-ambient-glows--hero", delay: 0, rangeScale: 1 },
      { selector: ".homepage-ambient-glows--care", delay: 1.4, rangeScale: 0.9 },
    ];

    ambientGroups.forEach(({ selector, delay, rangeScale }, groupIndex) => {
      hero.querySelectorAll(`${selector} .homepage-ambient-glow`).forEach((glow, index) => {
        const profile = motionProfiles[glow.dataset.ambientMotion];
        if (!profile) return;

        const viewportScale = window.matchMedia("(max-width: 700px)").matches ? 0.72 : 1;
        const xRange = profile.x * rangeScale * viewportScale;
        const yRange = profile.y * rangeScale * viewportScale;
        const startDelay = delay + index * 0.65;
        addWanderingTimeline({
          target: glow,
          xRange,
          yRange,
          duration: profile.duration,
          delay: startDelay,
          index,
          durationOffset: groupIndex * 0.18,
        });
      });
    });

    [
      {
        target: hero.querySelector(".hero-copy"),
        xProperty: "--hero-copy-glow-x",
        yProperty: "--hero-copy-glow-y",
        xRange: 70,
        yRange: 50,
        duration: 3.2,
        delay: 0.35,
      },
      {
        target: hero.querySelector(".hero-visual"),
        xProperty: "--hero-visual-glow-x",
        yProperty: "--hero-visual-glow-y",
        xRange: 80,
        yRange: 60,
        duration: 3.5,
        delay: 1.1,
      },
      {
        target: hero,
        xProperty: "--hero-dark-glow-x",
        yProperty: "--hero-dark-glow-y",
        xRange: 14,
        yRange: 10,
        xCenter: 77,
        yCenter: 48,
        duration: 3.4,
        delay: 0.75,
        unit: "%",
      },
    ].forEach((glow, index) => {
      const viewportScale = window.matchMedia("(max-width: 700px)").matches ? 0.72 : 1;
      addWanderingTimeline({
        ...glow,
        xRange: glow.xRange * viewportScale,
        yRange: glow.yRange * viewportScale,
        index,
        durationOffset: index * 0.2,
        unit: glow.unit || "px",
      });
    });

    const intro = gsap.timeline();
    intro
      .from(hero.querySelectorAll(".hero-copy > *"), {
        autoAlpha: 0,
        y: 24,
        duration: 0.85,
        ease: "power3.out",
        stagger: 0.14,
        delay: 0.1,
      })
      .from(image, {
        autoAlpha: 0,
        duration: 1.1,
        ease: "power1.out",
      }, 0);
  });

  mm.add("(min-width: 701px) and (prefers-reduced-motion: no-preference)", () => {
    const band = hero.querySelector(".hero-band");
    const copy = hero.querySelector(".hero-copy");
    const care = hero.querySelector("#featuredServices");
    const careHeading = care?.querySelector(".homepage-service-panels__header");
    const careColumns = care ? Array.from(care.querySelectorAll(".homepage-benefit-card")) : [];
    const treatments = hero.querySelector("#treatments");
    const treatmentsHeader = treatments?.querySelector(".treatments-section__header");
    const carouselWrap = treatments?.querySelector(".treatments-carousel-wrap");
    if (!ScrollTrigger || !band || !copy || !careHeading || !careColumns.length || !treatments || !treatmentsHeader || !carouselWrap) return;

    hero.classList.add("hero-scrolly");
    const W = () => hero.clientWidth;
    const H = () => hero.clientHeight;

    gsap.set(band, { autoAlpha: 0, scaleX: 0, scaleY: 0.01, transformOrigin: "50% 50%" });
    gsap.set([care, careHeading, ...careColumns], { autoAlpha: 0 });
    gsap.set(treatmentsHeader, { xPercent: -130, autoAlpha: 0 });
    gsap.set(carouselWrap, { xPercent: -105, autoAlpha: 0 });

    // Plays once when the cream finishes expanding and is never reversed by scrolling back up.
    let careShown = false;
    const careEntrance = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
    const showCare = () => {
      // ScrollTrigger refreshes render the timeline end-to-end, so ignore calls unless the user has really scrolled past the cream expansion.
      if (careShown || !tl.scrollTrigger || tl.scrollTrigger.progress < 2.5 / tl.duration()) return;
      careShown = true;
      care.classList.remove("is-background-visible");
      gsap.set(care, { autoAlpha: 1 });
      gsap.set(careHeading, { x: W() - careHeading.getBoundingClientRect().left });
      careEntrance
        .clear()
        .to(careHeading, { x: 0, autoAlpha: 1, duration: 0.9 })
        .to(careColumns, { autoAlpha: 1, duration: 0.3, ease: "power1.out", stagger: 0.05 }, ">-0.05")
        .call(() => care.classList.add("is-background-visible"))
        .play(0);
    };
    // Scrolling back up into the hero hands the screen back to the hero; Care stays put while the cream is covering it.
    const hideCare = () => {
      careShown = false;
      care.classList.remove("is-background-visible");
      careEntrance.pause(0).clear();
      gsap.set([care, careHeading, ...careColumns], { autoAlpha: 0 });
    };

    const wipe = { r: 0 };
    let lastClip = "";
    const paintWipe = () => {
      const clip = `circle(${Math.max(wipe.r, 0)}px at ${W() - 51}px ${H() - 57}px)`;
      if (clip === lastClip) return;
      lastClip = clip;
      treatments.style.clipPath = clip;
    };
    paintWipe();

    const S = 0.7;
    const tl = gsap.timeline({
      defaults: { ease: "power2.inOut" },
      scrollTrigger: {
        trigger: hero,
        start: "top top",
        end: () => "+=" + tl.duration() * H() * 0.5,
        pin: true,
        scrub: 0.6,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          if (careShown && self.progress < 1.8 / tl.duration()) hideCare();
        },
        onLeave: (self) => finishSequence(self),
      },
    });

    // Once the user scrolls past the sequence, swap the pinned choreography for a static stack
    // (hero, Care, Treatments) so scrolling back up never replays or reverses any animation.
    const finishSequence = (self) => {
      const over = Math.max(0, window.scrollY - self.end);
      careEntrance.kill();
      self.kill(true);
      tl.kill();
      hero.classList.remove("hero-scrolly");
      hero.classList.add("hero-static");
      treatments.style.clipPath = "";
      gsap.set([band, copy, care, careHeading, ...careColumns, treatmentsHeader, carouselWrap], { clearProps: "all" });
      window.scrollTo(0, treatments.getBoundingClientRect().top + window.scrollY + over);
      ScrollTrigger.refresh();
    };
    tl.to(band, { autoAlpha: 1, duration: 0.01, ease: "none" }, 0.4)
      .to(band, { scaleX: 1, duration: 1, ease: "power2.inOut" }, 0.4)
      .to(band, { scaleY: 1, duration: 1.2, ease: "power2.inOut" }, 1.4)
      .to(copy, { autoAlpha: 0, duration: 0.8, ease: "power1.in" }, 1.8)
      .call(showCare, null, 2.6)
      .to({}, { duration: 2.2 }, 2.6)
      .to(wipe, {
        r: () => Math.hypot(W(), H()),
        duration: 1.6 * S,
        ease: "power2.in",
        onUpdate: paintWipe,
        onComplete: paintWipe,
        onReverseComplete: paintWipe,
      }, 4.8)
      .to(treatmentsHeader, { xPercent: 0, autoAlpha: 1, duration: 1.2 * S, ease: "power3.out" }, ">-" + 0.1 * S)
      .to(carouselWrap, { xPercent: 0, autoAlpha: 1, duration: 1.6 * S, ease: "power3.out" }, ">" + 0.1 * S)
      .to({}, { duration: 1.5 * S });

    return () => {
      tl.scrollTrigger?.kill();
      tl.kill();
      careEntrance.kill();
      hero.classList.remove("hero-scrolly", "hero-static");
      care.classList.remove("is-background-visible");
      treatments.style.clipPath = "";
      gsap.set([band, copy, care, careHeading, ...careColumns, treatmentsHeader, carouselWrap], { clearProps: "all" });
    };
  });

  if (ScrollTrigger) {
    const refresh = () => ScrollTrigger.refresh();
    const image = hero.querySelector(".hero-photo-img");
    if (image && !image.complete) image.addEventListener("load", refresh, { once: true });
    if (document.readyState === "complete") refresh();
    else window.addEventListener("load", refresh, { once: true });
    document.fonts?.ready.then(refresh);
  }
})();
