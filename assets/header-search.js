import { Component } from '@theme/component';
import { DialogCloseEvent, DialogOpenEvent } from '@theme/dialog';
import { mediaQueryLarge, prefersReducedMotion } from '@theme/utilities';

const HINT_INTERVAL = 3200;
const HINT_ANIMATION = { duration: 260, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' };
const prefersReducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const ANCHOR_MIN_WIDTH = 640;
const VIEWPORT_GUTTER = 16;

/**
 * Inline header search bar.
 *
 * Without JavaScript the bar is a plain search form. When enhanced, it hands the
 * query to the shared predictive search modal (`#search-modal`), which opens as a
 * dropdown anchored over the bar on desktop and full screen on mobile.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} field - The visual field wrapper the dropdown anchors to.
 * @property {HTMLInputElement} input - The search input.
 * @property {HTMLElement} [hintTerm] - The rotating hint term.
 *
 * @extends {Component<Refs>}
 */
class HeaderSearchComponent extends Component {
  requiredRefs = ['field', 'input'];

  /** @type {AbortController | null} */
  #controller = null;

  /** @type {AbortController | null} */
  #modalController = null;

  /** @type {number | undefined} */
  #hintTimer;

  #hintIndex = 0;

  connectedCallback() {
    super.connectedCallback();

    this.#controller?.abort();
    this.#controller = new AbortController();
    const { signal } = this.#controller;

    document.addEventListener('keydown', this.#handleShortcut, { signal });
    window.addEventListener('resize', this.#handleResize, { signal, passive: true });
    document.addEventListener('visibilitychange', this.#syncHintRotation, { signal });
    prefersReducedMotionQuery.addEventListener('change', this.#syncHintRotation, { signal });

    this.#syncHintRotation();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#controller?.abort();
    this.#controller = null;
    this.#modalController?.abort();
    this.#stopHints();
  }

  /**
   * The shared search modal rendered by `layout/theme.liquid`.
   * @returns {(HTMLElement & { showDialog?: () => void, closeDialog?: () => Promise<void> }) | null}
   */
  get #modal() {
    return document.getElementById('search-modal');
  }

  /** @returns {HTMLInputElement | null} */
  get #modalInput() {
    const input = this.#modal?.querySelector('input[name="q"]');
    return input instanceof HTMLInputElement ? input : null;
  }

  get #isVisible() {
    return this.checkVisibility?.() ?? this.offsetParent !== null;
  }

  /**
   * Opens predictive search from a press on the bar.
   */
  open() {
    this.#openModal();
  }

  /**
   * Opens predictive search once the shopper starts typing in the bar.
   * @param {InputEvent} event
   */
  handleInput(event) {
    if (!event.inputType) return;
    this.#openModal();
  }

  /**
   * Arrow down opens results; Enter submits the native form.
   * @param {KeyboardEvent} event
   */
  handleKeydown(event) {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    this.#openModal();
  }

  /**
   * Focuses search with the "/" key, unless the shopper is typing elsewhere.
   * @param {KeyboardEvent} event
   */
  #handleShortcut = (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;

    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) {
      return;
    }

    if (!this.#isVisible || document.querySelector('dialog[open]')) return;

    event.preventDefault();
    this.#openModal();
  };

  #openModal() {
    const modal = this.#modal;
    const dialog = modal?.querySelector('dialog');

    // Before the dialog module loads, the bar keeps working as a native form.
    if (!modal || !dialog || typeof modal.showDialog !== 'function' || dialog.open) return;

    this.#modalController?.abort();
    this.#modalController = new AbortController();
    const { signal } = this.#modalController;

    this.#updateAnchor();

    modal.addEventListener(DialogOpenEvent.eventName, this.#handleModalOpen, { once: true, signal });
    modal.addEventListener(DialogCloseEvent.eventName, this.#handleModalClose, { once: true, signal });

    modal.showDialog();
  }

  #handleModalOpen = () => {
    const input = this.#modalInput;
    if (!input || !this.#modalController) return;

    const { signal } = this.#modalController;
    const query = this.refs.input.value;

    // Opening locks page scroll, which can remove the scrollbar; re-measure before first paint.
    this.#updateAnchor();
    input.focus({ preventScroll: true });

    if (query.trim()) {
      input.value = query;
      input.setSelectionRange(query.length, query.length);
      // The predictive search component only searches on real text input.
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: query }));
    }

    // Mirror the modal query back so the bar reflects what was searched.
    input.addEventListener('input', () => this.#setValue(input.value), { signal });
    this.#modal
      ?.querySelector('.predictive-search__reset-button')
      ?.addEventListener('click', () => this.#setValue(''), { signal });
  };

  #handleModalClose = () => {
    this.#modalController?.abort();
    this.#modalController = null;
    this.#modal?.removeAttribute('data-anchored');
  };

  #handleResize = () => {
    const dialog = this.#modal?.querySelector('dialog');
    if (!this.#modalController || !dialog?.open) return;
    this.#updateAnchor();
  };

  /**
   * Positions the modal over the bar on desktop; mobile keeps the full-screen modal.
   */
  #updateAnchor() {
    const modal = this.#modal;
    if (!modal) return;

    if (!mediaQueryLarge.matches || !this.#isVisible) {
      modal.removeAttribute('data-anchored');
      return;
    }

    const rect = this.refs.field.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const width = Math.min(Math.max(rect.width, ANCHOR_MIN_WIDTH), viewportWidth - VIEWPORT_GUTTER * 2);
    const centeredLeft = rect.left - (width - rect.width) / 2;
    const left = Math.min(Math.max(centeredLeft, VIEWPORT_GUTTER), viewportWidth - VIEWPORT_GUTTER - width);
    const radius = getComputedStyle(this).getPropertyValue('--header-search-radius');

    modal.style.setProperty('--search-anchor-top', `${Math.max(rect.top, 0)}px`);
    modal.style.setProperty('--search-anchor-left', `${left}px`);
    modal.style.setProperty('--search-anchor-width', `${width}px`);
    modal.style.setProperty('--search-anchor-height', `${rect.height}px`);
    if (radius) modal.style.setProperty('--header-search-radius', radius);
    modal.setAttribute('data-anchored', '');
  }

  /** @param {string} value */
  #setValue(value) {
    this.refs.input.value = value;
    this.#syncHintRotation();
  }

  /** @returns {string[]} */
  get #hints() {
    try {
      const hints = JSON.parse(this.dataset.hints ?? '[]');
      return Array.isArray(hints) ? hints.filter((hint) => typeof hint === 'string') : [];
    } catch {
      return [];
    }
  }

  #syncHintRotation = () => {
    const shouldRotate =
      this.refs.hintTerm &&
      this.#hints.length > 1 &&
      !prefersReducedMotion() &&
      document.visibilityState === 'visible';

    if (shouldRotate && this.#hintTimer === undefined) {
      this.#hintTimer = window.setInterval(this.#rotateHint, HINT_INTERVAL);
    } else if (!shouldRotate) {
      this.#stopHints();
    }
  };

  #stopHints() {
    window.clearInterval(this.#hintTimer);
    this.#hintTimer = undefined;
  }

  #rotateHint = async () => {
    const { hintTerm, input } = this.refs;
    const hints = this.#hints;

    // Skip work while the hint is hidden behind typed text or off screen.
    if (!hintTerm || input.value || !this.#isVisible) return;

    this.#hintIndex = (this.#hintIndex + 1) % hints.length;

    try {
      const exit = hintTerm.animate(
        [
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 0, transform: 'translateY(-60%)' },
        ],
        { ...HINT_ANIMATION, fill: 'forwards' }
      );
      await exit.finished;

      hintTerm.textContent = hints[this.#hintIndex] ?? '';

      const enter = hintTerm.animate(
        [
          { opacity: 0, transform: 'translateY(60%)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        HINT_ANIMATION
      );
      exit.cancel();
      await enter.finished;
    } catch {
      // Animation cancelled by a re-render; the next tick recovers.
    }
  };
}

if (!customElements.get('header-search-component')) {
  customElements.define('header-search-component', HeaderSearchComponent);
}
