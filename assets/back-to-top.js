import { Component } from '@theme/component';
import { prefersReducedMotion } from '@theme/utilities';
import {
  getScrollContainer,
  getScrollEventTarget,
  scrollTo,
  scrollContainerMediaQuery,
} from '@theme/scroll-container';

/**
 * @typedef {Object} BackToTopRefs
 * @property {HTMLButtonElement} button - The button that returns to the top
 * @property {SVGElement} [ring] - The progress ring, present in the circle style
 */

/**
 * Floating button that appears once the shopper has scrolled a screen down and returns them to the
 * top of the page. Reports scroll progress through `--back-to-top-progress` when a ring is rendered.
 *
 * @extends {Component<BackToTopRefs>}
 */
class BackToTopComponent extends Component {
  requiredRefs = ['button'];

  /** @type {EventTarget | null} */
  #scrollTarget = null;

  /** @type {number | null} */
  #rafId = null;

  connectedCallback() {
    super.connectedCallback();
    this.#bindScroll();
    scrollContainerMediaQuery.addEventListener('change', this.#handleBreakpointChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#unbindScroll();
    scrollContainerMediaQuery.removeEventListener('change', this.#handleBreakpointChange);
  }

  /**
   * Scrolls the page back to the top. Focus moves to the top of the page, because the button hides
   * once the page reaches the top and keyboard users would otherwise continue from the page bottom.
   */
  scrollToTop() {
    scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'instant' : 'smooth' });

    // `#header-group` is `display: contents` under a sticky header and can't take focus, so the
    // first section in it does
    const target =
      document.querySelector('#header-group > .shopify-section') ?? document.getElementById('MainContent');
    if (!(target instanceof HTMLElement)) return;

    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
      target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
    }
    target.focus({ preventScroll: true });
  }

  #bindScroll() {
    this.#scrollTarget = getScrollEventTarget();
    this.#scrollTarget.addEventListener('scroll', this.#handleScroll, { passive: true });
    this.#update();
  }

  #unbindScroll() {
    this.#scrollTarget?.removeEventListener('scroll', this.#handleScroll);
    this.#scrollTarget = null;
    if (this.#rafId !== null) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
  }

  /**
   * The page scrolls inside `.page-wrapper` from 990px up and in the document below, so the
   * listener moves with the scroll container.
   */
  #handleBreakpointChange = () => {
    this.#unbindScroll();
    this.#bindScroll();
  };

  #handleScroll = () => {
    if (this.#rafId !== null) return;

    this.#rafId = requestAnimationFrame(() => {
      this.#rafId = null;
      this.#update();
    });
  };

  #update() {
    const container = getScrollContainer();
    const { scrollTop, scrollHeight, clientHeight } = container;
    const visible = scrollTop > clientHeight;

    if (this.dataset.visible !== String(visible)) {
      this.dataset.visible = String(visible);
    }

    if (this.refs.ring) {
      const maxScroll = scrollHeight - clientHeight;
      const progress = maxScroll > 0 ? Math.min(scrollTop / maxScroll, 1) : 0;
      this.style.setProperty('--back-to-top-progress', progress.toFixed(3));
    }
  }
}

if (!customElements.get('back-to-top-component')) {
  customElements.define('back-to-top-component', BackToTopComponent);
}
