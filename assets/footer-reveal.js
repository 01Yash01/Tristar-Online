import { Component } from '@theme/component';
import { getScrollContainer, scrollTo } from '@theme/scroll-container';

/**
 * Holds the footer section it sits in, and every section after it, still at the bottom of the viewport
 * while the sections above scroll up off them. `position: sticky` takes one offset per element, so each
 * pinned section gets the combined height of the pinned sections below it. The footer stays in normal
 * flow until `data-reveal-active` is set. `data-reveal-in-view` and `--footer-reveal-rows` let the
 * back-to-top button move clear of the links in the pinned sections.
 *
 * @extends {Component}
 */
class FooterRevealComponent extends Component {
  /** @type {HTMLElement | null} */
  #footer = null;

  /** @type {ResizeObserver | null} */
  #resizeObserver = null;

  /** @type {IntersectionObserver | null} */
  #intersectionObserver = null;

  /** @type {AbortController | null} */
  #abortController = null;

  connectedCallback() {
    super.connectedCallback();

    this.#footer = this.closest('footer');
    if (!this.#footer) return;

    this.#abortController = new AbortController();
    const { signal } = this.#abortController;

    this.#footer.addEventListener('focusin', this.#scrollToPinned, { signal });
    this.#footer.addEventListener('shopify:section:select', this.#scrollToPinned, { signal });
    this.#footer.addEventListener('shopify:section:load', this.#observeSections, { signal });
    window.addEventListener('resize', this.#update, { passive: true, signal });

    this.#resizeObserver = new ResizeObserver(this.#update);
    this.#observeSections();

    this.#intersectionObserver = new IntersectionObserver((entries) => {
      this.#footer?.toggleAttribute('data-reveal-in-view', Boolean(entries.at(-1)?.isIntersecting));
    });
    this.#intersectionObserver.observe(this.#footer);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController?.abort();
    this.#resizeObserver?.disconnect();
    this.#intersectionObserver?.disconnect();
    this.#footer?.removeAttribute('data-reveal-active');
    this.#footer?.removeAttribute('data-reveal-in-view');
    document.documentElement.style.removeProperty('--footer-reveal-rows');
    this.#footer = null;
  }

  #observeSections = () => {
    if (!this.#footer || !this.#resizeObserver) return;

    this.#resizeObserver.disconnect();
    for (const section of this.#footer.children) this.#resizeObserver.observe(section);
  };

  #update = () => {
    if (!this.#footer) return;

    const sections = /** @type {HTMLElement[]} */ ([...this.#footer.children]);
    const firstPinned = sections.findIndex((section) => section.contains(this));
    const pinned = sections.slice(firstPinned);
    const heights = pinned.map((section) => section.offsetHeight);
    const pinnedHeight = heights.reduce((total, height) => total + height, 0);

    let offset = pinnedHeight;
    pinned.forEach((section, index) => {
      offset -= heights[index] ?? 0;
      section.style.setProperty('--footer-reveal-offset', `${offset}px`);
    });

    document.documentElement.style.setProperty('--footer-reveal-rows', `${pinnedHeight - (heights[0] ?? 0)}px`);

    // Taller than the viewport, the top of the pinned sections could never be scrolled into view
    const active = firstPinned > 0 && pinnedHeight <= getScrollContainer().clientHeight;
    this.#footer.toggleAttribute('data-reveal-active', active);
  };

  /**
   * A pinned section can be under the sections above it and still be inside the viewport, so the browser
   * finds nothing to scroll to when something in it takes focus or the theme editor selects it.
   *
   * @param {Event} event
   */
  #scrollToPinned = ({ target }) => {
    const section = target instanceof Element ? target.closest('.shopify-section') : null;
    if (!section || getComputedStyle(section).position !== 'sticky') return;

    const { scrollHeight, clientHeight } = getScrollContainer();
    scrollTo({ top: scrollHeight - clientHeight, behavior: 'smooth' });
  };
}

if (!customElements.get('footer-reveal-component')) {
  customElements.define('footer-reveal-component', FooterRevealComponent);
}
