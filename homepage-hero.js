(() => {
  const hero = document.querySelector(".homepage .hero");
  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  if (!hero || !gsap) return;
  if (ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  const pairsWrap = document.getElementById("heroPairs");
  const indicator = document.getElementById("scrollIndicator");
  const dots = indicator ? Array.from(indicator.querySelectorAll(".scroll-indicator__dot")) : [];

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
    const reveal = hero.querySelector(".hero-reveal");
    if (!ScrollTrigger || !pairsWrap || !reveal) return;

    hero.classList.add("hero-scrolly");
    const copy = hero.querySelector(".hero-copy");
    const band = hero.querySelector(".hero-band");
    const pairs = Array.from(pairsWrap.querySelectorAll(".hero-pair"));
    const W = () => hero.clientWidth;
    const H = () => hero.clientHeight;

    // Timeline units: 0-2.6 cream line appears and expands over the hero text, 2.4-3.4 first pair
    // settles in, then each pair holds for 0.6 and glides to the next over 1.4.
    const T0 = 3.4;
    const HOLD = 0.6;
    const MOVE = 1.4;
    const S = 0.7;
    const lastHold = T0 + (pairs.length - 1) * (HOLD + MOVE) + HOLD;

    // One scroll-driven stack position (p) is shared by every pair; each pair derives its own
    // y / scale / opacity from its distance (d = i - p) to the centre slot.
    const slots = { d: [-1, 0, 1, 2], y: [-0.5, 0, 0.44, 0.7], scale: [0.5, 1, 0.6, 0.4], alpha: [0, 1, 0.9, 0] };
    const sample = (arr, d) => {
      if (d <= -1) return arr[0];
      if (d >= 2) return arr[3];
      const k = d < 0 ? 0 : d < 1 ? 1 : 2;
      return gsap.utils.interpolate(arr[k], arr[k + 1], d - slots.d[k]);
    };
    const stack = { p: -1, vis: 0 };
    const render = () => {
      const h = H();
      pairs.forEach((pair, i) => {
        const d = i - stack.p;
        gsap.set(pair, {
          xPercent: -50,
          yPercent: -50,
          y: sample(slots.y, d) * h,
          scale: sample(slots.scale, d),
          autoAlpha: sample(slots.alpha, d) * stack.vis,
          zIndex: 10 - Math.round(Math.abs(d) * 3),
        });
      });
    };

    // At scroll 0 the band is invisible and collapsed, so the hero is a clean static screen.
    gsap.set(band, { autoAlpha: 0, scaleX: 0, scaleY: 0.01, transformOrigin: "50% 50%" });
    render();

    let activeIdx = -1;
    const setIndicator = (idx) => {
      if (idx === activeIdx || !indicator) return;
      activeIdx = idx;
      indicator.classList.toggle("is-hero-seq", idx >= 0);
      dots.forEach((dot, i) => dot.classList.toggle("is-active", i === idx));
    };

    const tl = gsap.timeline({
      defaults: { ease: "power2.inOut" },
      onUpdate: () => {
        const on = stack.vis > 0.5 && tl.time() <= lastHold + 0.3;
        setIndicator(on ? Math.min(pairs.length - 1, Math.max(0, Math.round(stack.p))) : -1);
      },
      scrollTrigger: {
        trigger: hero,
        start: "top top",
        end: () => "+=" + tl.duration() * H() * 0.5,
        pin: true,
        scrub: 0.6,
        snap: {
          snapTo: (p) => {
            const d = tl.duration();
            if (p * d > lastHold) return p;
            const stops = [0, ...pairs.map((_, i) => (T0 + i * (HOLD + MOVE) + HOLD / 2) / d)];
            return gsap.utils.snap(stops, p);
          },
          duration: { min: 0.2, max: 0.7 },
          delay: 0.05,
          ease: "power1.inOut",
        },
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onRefresh: render,
      },
    });

    // Cream line grows across the centre, then expands vertically over the hero text.
    tl.to(band, { autoAlpha: 1, duration: 0.01, ease: "none" }, 0.4)
      .to(band, { scaleX: 1, duration: 1, ease: "power2.inOut" }, 0.4)
      .to(band, { scaleY: 1, duration: 1.2, ease: "power2.inOut" }, 1.4)
      .to(copy, { autoAlpha: 0, duration: 0.8, ease: "power1.in" }, 1.8)
      .to(stack, { vis: 1, duration: 0.8, ease: "none", onUpdate: render }, 2.4)
      .to(stack, { p: 0, duration: 1, ease: "power2.out", onUpdate: render }, 2.4);

    pairs.forEach((_, i) => {
      if (i === pairs.length - 1) return;
      tl.to(stack, { p: i + 1, duration: MOVE, ease: "power2.inOut", onUpdate: render }, T0 + i * (HOLD + MOVE) + HOLD);
    });

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
    }, lastHold + 0.3)
      .set([copy, band, ...pairs], { autoAlpha: 0 })
      .to(revealInner, { xPercent: 0, autoAlpha: 1, duration: 1.2 * S, ease: "power3.out" }, ">-" + 0.1 * S)
      .to(carouselWrap, { xPercent: 0, autoAlpha: 1, duration: 1.6 * S, ease: "power3.out" }, ">" + 0.1 * S)
      .to({}, { duration: 1.5 * S });

    return () => {
      setIndicator(-1);
      hero.classList.remove("hero-scrolly");
      reveal.style.willChange = "";
      reveal.style.clipPath = "";
      gsap.set([revealInner, carouselWrap, copy, band, ...pairs], { clearProps: "all" });
    };
  });  if (ScrollTrigger) {
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
