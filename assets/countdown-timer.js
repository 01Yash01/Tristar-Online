import { Component } from '@theme/component';

/**
 * Live countdown for the Countdown block (blocks/countdown.liquid).
 *
 * The end time arrives as a Unix timestamp in `data-end`, already resolved in the store's time
 * zone by Liquid, so every shopper counts down to the same moment. Liquid renders the starting
 * digits; this component keeps them current and, at zero, hides the block or shows its message
 * according to `data-after-end`.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} [units] - Wrapper of the digit tiles.
 * @property {HTMLElement} [days]
 * @property {HTMLElement} [hours]
 * @property {HTMLElement} [minutes]
 * @property {HTMLElement} [seconds]
 * @property {HTMLElement} [expired] - The message shown after the end, when enabled.
 *
 * @extends {Component<Refs>}
 */
class CountdownTimer extends Component {
  /** @type {number | undefined} */
  #interval;

  connectedCallback() {
    super.connectedCallback();
    this.#start();
  }

  updatedCallback() {
    super.updatedCallback();
    this.#start();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.clearInterval(this.#interval);
    this.#interval = undefined;
  }

  #start() {
    window.clearInterval(this.#interval);
    if (this.#tick()) this.#interval = window.setInterval(() => this.#tick(), 1000);
  }

  /** @returns {boolean} Whether the countdown is still running. */
  #tick() {
    const end = Number(this.dataset.end) * 1000;
    if (!Number.isFinite(end) || end <= 0) return false;

    const totalSeconds = Math.max(0, Math.floor((end - Date.now()) / 1000));

    if (totalSeconds === 0) {
      this.#finish();
      return false;
    }

    this.#write(this.refs.days, Math.floor(totalSeconds / 86400));
    this.#write(this.refs.hours, Math.floor((totalSeconds % 86400) / 3600));
    this.#write(this.refs.minutes, Math.floor((totalSeconds % 3600) / 60));
    this.#write(this.refs.seconds, totalSeconds % 60);
    return true;
  }

  /**
   * @param {HTMLElement | undefined} element
   * @param {number} value
   */
  #write(element, value) {
    if (!element) return;
    const text = String(value).padStart(2, '0');
    if (element.textContent !== text) element.textContent = text;
  }

  #finish() {
    window.clearInterval(this.#interval);
    this.#interval = undefined;

    const { units, expired } = this.refs;
    if (this.dataset.afterEnd === 'message' && expired) {
      if (units) units.hidden = true;
      expired.hidden = false;
      return;
    }

    // Keep the block selectable in the theme editor; hide it on the storefront.
    if (!window.Shopify?.designMode) this.hidden = true;
  }
}

if (!customElements.get('countdown-timer')) {
  customElements.define('countdown-timer', CountdownTimer);
}
