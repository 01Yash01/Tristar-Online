/**
 * Reveals `[data-reveal]` elements once, as they scroll into view.
 *
 * `snippets/scroll-reveal.liquid` adds `.reveal-ready` to <html> before first paint and
 * removes it again if this module has not run within a few seconds, so content is never
 * left hidden (no JavaScript, reduced motion, theme editor, or a failed module load).
 */
const root = document.documentElement;

function initScrollReveal() {
  if (!root.classList.contains('reveal-ready')) return;

  // Tells the inline failsafe that reveals are handled.
  root.dataset.revealActive = '';

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute('data-revealed', '');
        observer.unobserve(entry.target);
      }
    },
    // Start a little before the element is fully in view so motion finishes while it is read.
    { rootMargin: '0px 0px -10% 0px', threshold: 0 }
  );

  for (const element of document.querySelectorAll('[data-reveal]:not([data-revealed])')) {
    observer.observe(element);
  }
}

initScrollReveal();
