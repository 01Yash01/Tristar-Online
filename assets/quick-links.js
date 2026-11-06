import { Component } from '@theme/component';
import { prefersReducedMotion } from '@theme/utilities';
import '@theme/scrolling';

/**
 * Quick links row (sections/quick-links.liquid).
 *
 * Flags the row as overflowing so the desktop arrows appear only when there is somewhere to
 * scroll, keeps each arrow disabled at its end, and scrolls by most of a view per click.
 * With the Shiny edge style it also flags the row as off screen, which rests the glint animation.
 * Without JavaScript the row is still a plain, scrollable list of links.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} scroller - The horizontally scrolling list wrapper.
 * @property {HTMLButtonElement} [previous] - The optional previous arrow.
 * @property {HTMLButtonElement} [next] - The optional next arrow.
 *
 * @extends {Component<Refs>}
 */
class QuickLinks extends Component {
  requiredRefs = ['scroller'];

  /** @type {HTMLElement | null} */
  #scroller = null;

  #frame = 0;

  #resizeObserver = new ResizeObserver(() => this.#update());

  /** @type {IntersectionObserver | null} */
  #visibilityObserver = null;

  connectedCallback() {
    super.connectedCallback();
    this.#bindScroller();
    this.#syncVisibilityObserver();
  }

  updatedCallback() {
    super.updatedCallback();
    this.#bindScroller();
    this.#syncVisibilityObserver();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#unbindScroller();
    this.#visibilityObserver?.disconnect();
    this.#visibilityObserver = null;
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  /** Scrolls back by most of a view. */
  previous() {
    this.#scrollByView(-1);
  }

  /** Scrolls forward by most of a view. */
  next() {
    this.#scrollByView(1);
  }

  /** Listens to the current scroller, also after section rendering replaces it. */
  #bindScroller() {
    const { scroller } = this.refs;
    if (scroller === this.#scroller) return;

    this.#unbindScroller();
    this.#scroller = scroller;
    scroller.addEventListener('scroll', this.#handleScroll, { passive: true });
    this.#resizeObserver.observe(scroller);
    this.#update();
  }

  #unbindScroller() {
    this.#scroller?.removeEventListener('scroll', this.#handleScroll);
    this.#resizeObserver.disconnect();
    this.#scroller = null;
  }

  /** Watches whether a Shiny edge row is on screen; other styles have no animation to rest. */
  #syncVisibilityObserver() {
    const isShiny = this.classList.contains('quick-links--shiny');

    if (!isShiny) {
      this.#visibilityObserver?.disconnect();
      this.#visibilityObserver = null;
      this.removeAttribute('data-offscreen');
      return;
    }

    if (this.#visibilityObserver) return;

    this.#visibilityObserver = new IntersectionObserver(([entry]) => {
      if (entry) this.toggleAttribute('data-offscreen', !entry.isIntersecting);
    });
    this.#visibilityObserver.observe(this);
  }

  /** @param {number} direction - 1 for forward, -1 for back */
  #scrollByView(direction) {
    const { scroller } = this.refs;
    // In right-to-left layouts the row scrolls toward negative offsets.
    const isRtl = getComputedStyle(scroller).direction === 'rtl';
    const distance = scroller.clientWidth * 0.8 * direction * (isRtl ? -1 : 1);

    scroller.scrollBy({ left: distance, behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
  }

  #handleScroll = () => {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#update();
    });
  };

  #update() {
    const { scroller, previous, next } = this.refs;
    if (!scroller) return;

    const maxScroll = scroller.scrollWidth - scroller.clientWidth;
    const isOverflowing = maxScroll > 1;
    const position = Math.abs(scroller.scrollLeft);

    this.toggleAttribute('data-overflowing', isOverflowing);
    if (previous) previous.disabled = !isOverflowing || position <= 1;
    if (next) next.disabled = !isOverflowing || position >= maxScroll - 1;
  }
}

if (!customElements.get('quick-links')) {
  customElements.define('quick-links', QuickLinks);
}
