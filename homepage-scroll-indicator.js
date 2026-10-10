(function () {
  const progress = document.getElementById('homepageScrollProgress');
  const fill = document.getElementById('homepageScrollProgressFill');
  if (!progress || !fill) return;

  let frame = 0;

  function getScrollMetrics() {
    const scrollingElement = document.scrollingElement || document.documentElement;
    const maxScroll = Math.max(0, scrollingElement.scrollHeight - window.innerHeight);
    return {
      scrollTop: scrollingElement.scrollTop || window.pageYOffset || 0,
      maxScroll,
    };
  }

  function update() {
    frame = 0;
    const { scrollTop, maxScroll } = getScrollMetrics();
    const percent = maxScroll > 0 ? Math.min(100, Math.max(0, (scrollTop / maxScroll) * 100)) : 0;
    fill.style.width = `${percent.toFixed(2)}%`;
    progress.setAttribute('aria-valuenow', String(Math.round(percent)));
  }

  function requestUpdate() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate, { passive: true });
  window.addEventListener('load', requestUpdate);
  if (window.ResizeObserver) {
    const resizeObserver = new ResizeObserver(requestUpdate);
    resizeObserver.observe(document.documentElement);
    resizeObserver.observe(document.body);
  }
  update();
})();
