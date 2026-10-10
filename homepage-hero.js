(() => {
  const hero = document.querySelector(".homepage .hero");
  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  if (!hero || !gsap) return;
  if (ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  const mm = gsap.matchMedia();
  mm.add("(prefers-reduced-motion: no-preference)", () => {
    gsap.from(hero.querySelectorAll(".hero-copy > *"), {
      autoAlpha: 0,
      y: 28,
      duration: 0.9,
      ease: "power3.out",
      stagger: 0.18,
      delay: 0.15,
    });
  });

  mm.add("(min-width: 701px) and (prefers-reduced-motion: no-preference)", () => {
    const band = hero.querySelector(".hero-band");
    const copy = hero.querySelector(".hero-copy");
    const care = hero.querySelector("#featuredServices");
    const careHeading = care?.querySelector(".homepage-service-panels__header");
    const careColumns = care ? Array.from(care.querySelectorAll(".homepage-service-panel")) : [];
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
      gsap.set(care, { autoAlpha: 1 });
      gsap.set(careHeading, { x: W() - careHeading.getBoundingClientRect().left });
      careEntrance
        .clear()
        .to(careHeading, { x: 0, autoAlpha: 1, duration: 0.9 })
        .to(careColumns, { autoAlpha: 1, duration: 0.3, ease: "power1.out", stagger: 0.05 }, ">-0.05")
        .play(0);
    };
    // Scrolling back up into the hero hands the screen back to the hero; Care stays put while the cream is covering it.
    const hideCare = () => {
      careShown = false;
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
      treatments.style.clipPath = "";
      gsap.set([band, copy, care, careHeading, ...careColumns, treatmentsHeader, carouselWrap], { clearProps: "all" });
    };
  });

  if (ScrollTrigger) {
    const refresh = () => ScrollTrigger.refresh();
    if (document.readyState === "complete") refresh();
    else window.addEventListener("load", refresh, { once: true });
    document.fonts?.ready.then(refresh);
  }
})();

(() => {
  const motionQuery = window.matchMedia(
    "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)"
  );
  const body = document.body;

  const haloToggle = document.getElementById("haloToggle");
  if (haloToggle && body) {
    const setHalo = (on) => {
      body.classList.toggle("halo-off", !on);
      haloToggle.setAttribute("aria-pressed", String(on));
      haloToggle.title = on ? "Cursor halo: on" : "Cursor halo: off";
    };
    let stored = null;
    try { stored = localStorage.getItem("haloEnabled"); } catch (e) {}
    setHalo(stored !== "false");
    haloToggle.addEventListener("click", () => {
      const on = body.classList.contains("halo-off");
      setHalo(on);
      try { localStorage.setItem("haloEnabled", String(on)); } catch (e) {}
    });
  }

  const heroCopy = document.querySelector("body.homepage .hero-copy");
  if (!motionQuery.matches || !body || !heroCopy) return;

  const heading = heroCopy.querySelector(".headline");
  if (!heading) return;

  const accessibleText = heading.textContent.replace(/\s+/g, " ").trim();
  const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  const letters = [];
  textNodes.forEach((node) => {
    const fragment = document.createDocumentFragment();
    for (const character of node.nodeValue) {
      if (/\s/.test(character)) {
        fragment.appendChild(document.createTextNode(character));
      } else {
        const letter = document.createElement("span");
        letter.className = "hero-letter";
        letter.setAttribute("aria-hidden", "true");
        letter.textContent = character;
        letters.push(letter);
        fragment.appendChild(letter);
      }
    }
    node.replaceWith(fragment);
  });
  heading.setAttribute("aria-label", accessibleText);

  const halo = document.createElement("div");
  halo.className = "cursor-halo";
  halo.setAttribute("aria-hidden", "true");
  body.appendChild(halo);

  const radius = 72;
  const fullLightRadius = 18;
  let targetX = 0;
  let targetY = 0;
  let x = 0;
  let y = 0;
  let frame = 0;
  let positioned = false;

  function updateTextLight(clientX, clientY) {
    letters.forEach((letter) => {
      const rect = letter.getBoundingClientRect();
      const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
      const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
      const distance = Math.hypot(dx, dy);
      const light = distance <= fullLightRadius
        ? 1
        : Math.max(0, 1 - (distance - fullLightRadius) / (radius - fullLightRadius));
      letter.style.setProperty("--letter-light", `${(light * 100).toFixed(1)}%`);
      letter.style.setProperty("--letter-scale", (1 + light * 0.08).toFixed(3));
    });
  }

  function animateGlow() {
    frame = 0;
    x += (targetX - x) * 0.14;
    y += (targetY - y) * 0.14;
    halo.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;

    if (Math.abs(targetX - x) > 0.2 || Math.abs(targetY - y) > 0.2) {
      frame = window.requestAnimationFrame(animateGlow);
    } else {
      x = targetX;
      y = targetY;
      halo.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    }
  }

  function onPointerMove(event) {
    if (event.pointerType === "touch") return;
    targetX = event.clientX;
    targetY = event.clientY;
    if (!positioned) {
      x = targetX;
      y = targetY;
      positioned = true;
    }

    halo.classList.add("is-visible");
    updateTextLight(targetX, targetY);
    if (!frame) frame = window.requestAnimationFrame(animateGlow);
  }

  function hideGlow() {
    halo.classList.remove("is-visible");
    letters.forEach((letter) => {
      letter.style.removeProperty("--letter-light");
      letter.style.removeProperty("--letter-scale");
    });
  }

  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerout", (event) => {
    if (!event.relatedTarget) hideGlow();
  });
  window.addEventListener("blur", hideGlow);
  window.addEventListener("scroll", () => {
    if (positioned) updateTextLight(targetX, targetY);
  }, { passive: true });
})();
