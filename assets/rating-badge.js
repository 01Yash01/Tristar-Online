import { Component } from '@theme/component';
import { DialogComponent } from '@theme/dialog';
import { sectionRenderer } from '@theme/section-renderer';
import { prefersReducedMotion, requestIdleCallback } from '@theme/utilities';

/** Section that renders the review content, fetched only when needed */
const REVIEWS_SECTION_ID = 'rating-reviews';

/** How long each popup stays on screen, in milliseconds */
const POPUP_DURATION = 6000;

/** Length of the card's exit animation, so the next card waits until the last one is gone */
const POPUP_EXIT = 500;

const STORAGE_KEYS = {
  dismissed: 'rating-popups:dismissed',
  shown: 'rating-popups:shown',
  next: 'rating-popups:next',
};

/** @type {Promise<Document> | null} */
let reviewsPromise = null;

/**
 * Fetches the review content once per page and shares it between the panel and the popups.
 * @returns {Promise<Document>}
 */
function loadReviews() {
  if (!reviewsPromise) {
    reviewsPromise = sectionRenderer
      .getSectionHTML(REVIEWS_SECTION_ID)
      .then((html) => new DOMParser().parseFromString(html, 'text/html'));

    // Let a later open try again after a network failure
    reviewsPromise.catch(() => {
      reviewsPromise = null;
    });
  }

  return reviewsPromise;
}

/**
 * Replaces review dates with relative times ("3 days ago") in the page's language.
 * @param {ParentNode} root
 */
function formatRelativeTimes(root) {
  const formatter = new Intl.RelativeTimeFormat(document.documentElement.lang || undefined, { numeric: 'auto' });
  /** @type {[Intl.RelativeTimeFormatUnit, number][]} */
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];

  for (const time of root.querySelectorAll('time[data-relative-time]')) {
    const date = new Date(time.getAttribute('datetime') ?? '');
    if (Number.isNaN(date.getTime())) continue;

    const seconds = (date.getTime() - Date.now()) / 1000;
    const [unit, size] = units.find(([, size]) => Math.abs(seconds) >= size) ?? ['minute', 60];
    time.textContent = formatter.format(Math.round(seconds / size), unit);
  }
}

/** Session storage can be unavailable (private windows, blocked site data) */
const session = {
  /** @param {string} key */
  get(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  /**
   * @param {string} key
   * @param {string} value
   */
  set(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Limits then apply to this page view only
    }
  },
};

const isDesignMode = () => Boolean(/** @type {any} */ (window).Shopify?.designMode);

/**
 * Whether a modal is on screen: a theme dialog, or an app's modal such as the Shopify Forms popup,
 * which renders an `aria-modal` element inside a shadow root attached to a direct child of body.
 */
function isModalOpen() {
  if (document.querySelector('dialog[open]')) return true;

  const roots = [document, ...[...document.body.children].flatMap((element) => element.shadowRoot ?? [])];

  for (const root of roots) {
    for (const modal of root.querySelectorAll('[aria-modal="true"]')) {
      const visible = modal.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true;
      if (visible && modal.getBoundingClientRect().width > 0) return true;
    }
  }

  return false;
}

/**
 * The review panel, with the phone edge tab that opens it. The header rating link opens it too
 * (`on:click="#RatingBadge/showDialog"`). Fills the panel with the rating breakdown and recent
 * reviews the first time it opens; hovering or focusing the tab or the link starts that fetch early.
 *
 * @typedef {object} RatingBadgeRefs
 * @property {HTMLDialogElement} dialog
 * @property {HTMLButtonElement} [tab]
 * @property {HTMLElement} panelBody
 * @property {HTMLElement} [panelError]
 *
 * @extends {DialogComponent}
 */
class RatingBadgeComponent extends DialogComponent {
  requiredRefs = ['dialog', 'panelBody'];

  #filled = false;

  /** @type {AbortController | null} */
  #controller = null;

  connectedCallback() {
    super.connectedCallback();

    this.#controller?.abort();
    this.#controller = new AbortController();
    const { signal } = this.#controller;

    const prefetch = () => {
      loadReviews().catch(() => {});
    };
    for (const trigger of [this.refs.tab, ...document.querySelectorAll('.rating-link')]) {
      trigger?.addEventListener('pointerenter', prefetch, { once: true, signal });
      trigger?.addEventListener('focus', prefetch, { once: true, signal });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#controller?.abort();
    this.#controller = null;
  }

  showDialog() {
    super.showDialog();
    this.#fill();
  }

  async #fill() {
    if (this.#filled) return;

    const { panelBody, panelError } = /** @type {RatingBadgeRefs} */ (this.refs);
    if (panelError) panelError.hidden = true;
    panelBody.setAttribute('aria-busy', 'true');

    try {
      const doc = await loadReviews();
      const content = doc.querySelector('[data-rating-panel-content]');
      if (!content) throw new Error('Rating reviews section returned no content');

      formatRelativeTimes(content);
      panelBody.querySelector('[data-rating-panel-content]')?.remove();
      panelBody.append(document.adoptNode(content));
      this.#filled = true;
    } catch {
      if (panelError) panelError.hidden = false;
    } finally {
      panelBody.setAttribute('aria-busy', 'false');
    }
  }
}

/**
 * Review cards that slide in one at a time. Each card shows for a few seconds (paused while
 * hovered or focused), then the next follows after the merchant's interval. The count and the
 * shopper's "close" carry across pages for the visit through session storage.
 *
 * All cards are built once while the page is idle. Showing and hiding one only changes inline
 * styles and runs Web Animations, so it never adds elements or toggles attributes, which on this
 * theme would restyle a large part of the page through its `:has()` rules.
 *
 * @typedef {object} RatingPopupsRefs
 * @property {HTMLElement} card
 * @property {HTMLElement} stage
 * @property {HTMLElement} progress
 *
 * @extends {Component<RatingPopupsRefs>}
 */
class RatingPopupsComponent extends Component {
  requiredRefs = ['card', 'stage', 'progress'];

  /** @type {HTMLElement[]} */
  #cards = [];

  /** @type {HTMLElement | null} */
  #current = null;

  /** @type {number | undefined} */
  #timer;

  /** Runs for as long as a card shows; pausing it pauses the card */
  /** @type {Animation | null} */
  #progress = null;

  #active = false;

  connectedCallback() {
    super.connectedCallback();

    if (this.#isDone()) return;

    const start = () => {
      const delay = isDesignMode() ? 1000 : this.#seconds('delay', 8) * 1000;
      this.#schedule(() => this.#begin(), delay);
    };

    if (document.readyState === 'complete') {
      requestIdleCallback(start);
    } else {
      window.addEventListener('load', () => requestIdleCallback(start), { once: true });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.clearTimeout(this.#timer);
    this.#progress?.cancel();
    this.#progress = null;
    this.#active = false;
  }

  /** Pauses the visible card while the shopper hovers or focuses it */
  pause() {
    if (this.#progress?.playState === 'running') this.#progress.pause();
  }

  /** @param {FocusEvent | PointerEvent} [event] */
  resume(event) {
    if (this.#progress?.playState !== 'paused') return;

    // Moving focus between controls inside the card keeps it paused
    if (event instanceof FocusEvent && event.relatedTarget instanceof Node && this.refs.card.contains(event.relatedTarget)) {
      return;
    }
    if (this.refs.card.matches(':hover')) return;

    this.#progress.play();
  }

  /** Hides the popups for the rest of the visit */
  dismiss() {
    if (!isDesignMode()) session.set(STORAGE_KEYS.dismissed, 'true');
    this.#active = false;
    window.clearTimeout(this.#timer);
    this.#hide(false);
  }

  async #begin() {
    /** @type {Element[]} */
    let sources;
    try {
      const doc = await loadReviews();
      sources = [...doc.querySelectorAll('[data-rating-popups] > .rating-popup')];
    } catch {
      return;
    }

    if (!sources.length || this.#isDone() || !this.isConnected) return;

    const fragment = document.createDocumentFragment();
    for (const source of sources) {
      const card = /** @type {HTMLElement} */ (document.importNode(source, true));
      card.style.display = 'none';
      formatRelativeTimes(card);
      fragment.append(card);
    }
    this.refs.stage.append(fragment);
    this.#cards = /** @type {HTMLElement[]} */ ([...this.refs.stage.children]);

    this.hidden = false;
    this.#active = true;
    this.#showNext();
  }

  #showNext() {
    if (!this.#active) return;
    if (this.#isDone()) {
      this.#active = false;
      return;
    }

    // Wait while the shopper is busy with a modal (including app popups), the tab is hidden, or
    // the popups are hidden at this screen size; none of these count against the limit.
    if (document.hidden || isModalOpen() || !this.checkVisibility()) {
      this.#schedule(() => this.#showNext(), 4000);
      return;
    }

    const index = Number(session.get(STORAGE_KEYS.next) ?? 0) % this.#cards.length;
    const next = this.#cards[index];
    if (!next) return;

    if (this.#current && this.#current !== next) this.#current.style.display = 'none';
    next.style.display = '';
    this.#current = next;

    if (!isDesignMode()) {
      session.set(STORAGE_KEYS.next, String(index + 1));
      session.set(STORAGE_KEYS.shown, String(this.#shownCount + 1));
    }

    const { card, progress } = this.refs;
    card.style.visibility = 'visible';
    card.animate(
      prefersReducedMotion()
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: 'translateY(16px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
      { duration: prefersReducedMotion() ? 150 : 380, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' }
    );

    this.#progress = progress.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
      duration: POPUP_DURATION,
      fill: 'forwards',
    });
    this.#progress.finished.then(() => this.#hide(true)).catch(() => {
      // Cancelled by close or disconnect
    });
  }

  /** @param {boolean} continueAfter */
  #hide(continueAfter) {
    const { card } = this.refs;

    this.#progress?.cancel();
    this.#progress = null;

    // Keep keyboard users in the page flow when the card they were in disappears
    if (card.contains(document.activeElement)) {
      /** @type {HTMLElement | null} */ (document.activeElement)?.blur();
    }

    if (card.style.visibility === 'visible') {
      const exit = card.animate(
        prefersReducedMotion()
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [
              { opacity: 1, transform: 'translateY(0)' },
              { opacity: 0, transform: 'translateY(16px)' },
            ],
        { duration: prefersReducedMotion() ? 150 : POPUP_EXIT, easing: 'ease', fill: 'forwards' }
      );
      exit.finished
        .then(() => {
          card.style.visibility = 'hidden';
          exit.cancel();
        })
        .catch(() => {});
    }

    if (!continueAfter) return;

    this.#schedule(() => this.#showNext(), POPUP_EXIT + this.#seconds('interval', 20) * 1000);
  }

  get #shownCount() {
    return Number(session.get(STORAGE_KEYS.shown) ?? 0);
  }

  #isDone() {
    if (isDesignMode()) return false;
    return session.get(STORAGE_KEYS.dismissed) === 'true' || this.#shownCount >= this.#seconds('max', 3);
  }

  /**
   * @param {string} name - data attribute name
   * @param {number} fallback
   */
  #seconds(name, fallback) {
    const value = Number(this.dataset[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  /**
   * @param {() => void} callback
   * @param {number} delay
   */
  #schedule(callback, delay) {
    window.clearTimeout(this.#timer);
    this.#timer = window.setTimeout(callback, delay);
  }
}

if (!customElements.get('rating-badge-component')) {
  customElements.define('rating-badge-component', RatingBadgeComponent);
}

if (!customElements.get('rating-popups-component')) {
  customElements.define('rating-popups-component', RatingPopupsComponent);
}
