(function () {
  const indicator = document.getElementById('scrollIndicator');
  const thumb = indicator?.querySelector('.scroll-indicator__thumb');
  if (!indicator || !thumb) return;

  let frame = 0;

  // TEMP DIAGNOSTICS (remove after diagnosis)
  const se = document.scrollingElement;
  console.log('[scroll-indicator] init', {
    htmlScrollHeight: document.documentElement.scrollHeight,
    bodyScrollHeight: document.body.scrollHeight,
    innerHeight: window.innerHeight,
    scrollY: window.scrollY,
    scrollingElement: se === document.documentElement ? 'html' : se === document.body ? 'body' : String(se),
    indicatorHeight: indicator.offsetHeight,
    thumbHeight: thumb.offsetHeight,
    indicatorDisplay: getComputedStyle(indicator).display,
  });
  let diagCount = 0;

  // style.css sets overflow-x:hidden on both html and body, so the scroll position and height
  // can live on either element; read whichever one actually scrolls.
  function getScrollMetrics() {
    const root = document.documentElement;
    const body = document.body;
    const scrollTop = Math.max(window.pageYOffset || 0, root.scrollTop || 0, body.scrollTop || 0);
    const scrollHeight = Math.max(root.scrollHeight, body.scrollHeight);
    const viewportHeight = window.innerHeight || root.clientHeight;
    return { scrollTop, maxScroll: scrollHeight - viewportHeight };
  }

  function update() {
    frame = 0;
    const { scrollTop, maxScroll } = getScrollMetrics();
    const progress = maxScroll > 1 ? Math.min(1, Math.max(0, scrollTop / maxScroll)) : 0;
    const travel = Math.max(0, indicator.offsetHeight - thumb.offsetHeight);
    thumb.style.transform = `translate3d(0, ${(progress * travel).toFixed(2)}px, 0)`;
    // TEMP DIAGNOSTICS
    if (diagCount++ % 10 === 0) {
      console.log('[scroll-indicator] update', {
        scrollY: window.scrollY,
        htmlScrollTop: document.documentElement.scrollTop,
        bodyScrollTop: document.body.scrollTop,
        maxScroll,
        progress,
        travel,
        appliedTransform: thumb.style.transform,
      });
    }
  }

  function requestUpdate(event) {
    // TEMP DIAGNOSTICS
    if (event && event.type === 'scroll' && diagCount % 10 === 0) {
      console.log('[scroll-indicator] scroll event fired, target:', event.target === document ? 'document' : event.target.nodeName || event.target);
    }
    if (!frame) frame = requestAnimationFrame(update);
  }

  // Capture phase catches scroll events from html, body, or any scrolling ancestor.
  window.addEventListener('scroll', requestUpdate, { passive: true, capture: true });
  window.addEventListener('resize', requestUpdate, { passive: true });
  window.addEventListener('load', requestUpdate);
  if (window.ResizeObserver) new ResizeObserver(requestUpdate).observe(document.body);
  update();
})();
