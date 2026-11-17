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

/** Space between the button and a chat button below it, in pixels */
const CHAT_GAP = 12;

/**
 * Floating button that appears once the shopper has scrolled a screen down and returns them to the
 * top of the page. Reports scroll progress through `--back-to-top-progress` when a ring is rendered,
 * and lifts itself above a chat button in the same corner through `--back-to-top-chat-clearance`.
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
    window.addEventListener('resize', this.#handleScroll, { passive: true });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#unbindScroll();
    scrollContainerMediaQuery.removeEventListener('change', this.#handleBreakpointChange);
    window.removeEventListener('resize', this.#handleScroll);
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

    // The chat button can appear late or move (its app settings, the preview bar), so check while shown
    if (visible) this.#updateChatClearance();

    if (this.refs.ring) {
      const maxScroll = scrollHeight - clientHeight;
      const progress = maxScroll > 0 ? Math.min(scrollTop / maxScroll, 1) : 0;
      this.style.setProperty('--back-to-top-progress', progress.toFixed(3));
    }
  }

  /**
   * Lifts the button just above a chat button that shares its corner. Shopify Inbox draws its
   * launcher in an open shadow root; when it isn't there, the button keeps its normal offset.
   */
  #updateChatClearance() {
    const launcher = document.querySelector('shopify-chat')?.shadowRoot?.querySelector('.activator-nudge, .activator');
    let clearance = '';

    if (launcher instanceof HTMLElement) {
      const chat = launcher.getBoundingClientRect();
      const button = this.refs.button.getBoundingClientRect();
      const sharesCorner = chat.width > 0 && chat.left < button.right && chat.right > button.left;

      if (sharesCorner) {
        // Measure from layout rather than the painted box, so an animated chat button can't move this one
        const bottom = parseFloat(getComputedStyle(launcher).bottom);
        const height = Number.isFinite(bottom) ? bottom + launcher.offsetHeight : window.innerHeight - chat.top;
        clearance = `${Math.ceil(height + CHAT_GAP)}px`;
      }
    }

    if (this.style.getPropertyValue('--back-to-top-chat-clearance') !== clearance) {
      this.style.setProperty('--back-to-top-chat-clearance', clearance);
    }
  }
}

if (!customElements.get('back-to-top-component')) {
  customElements.define('back-to-top-component', BackToTopComponent);
}
