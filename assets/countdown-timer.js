import { Component } from '@theme/component';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** The drop-in animation of each number, kept so a change can rewind it @type {WeakMap<Element, Animation>} */
const tickAnimations = new WeakMap();

/**
 * Live countdown for the Countdown block (blocks/countdown.liquid).
 *
 * The end time arrives as a Unix timestamp in `data-end`, already resolved in the store's time
 * zone by Liquid, so every shopper counts down to the same moment. Liquid renders the starting
 * digits; this component keeps them current and, at zero, hides the block or shows its message
 * according to `data-after-end`. With `data-trim-days` the day unit stays hidden while it is zero,
 * and with `data-animate` each changed number replays a short CSS drop-in.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} [units] - Wrapper of the digit tiles.
 * @property {HTMLElement} [dayUnit] - The day tile, number and name together.
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

    const days = Math.floor(totalSeconds / 86400);
    const { dayUnit } = this.refs;
    if (dayUnit && 'trimDays' in this.dataset && dayUnit.hidden !== (days === 0)) dayUnit.hidden = days === 0;

    this.#write(this.refs.days, days);
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
    if (element.textContent === text) return;

    // Edit the existing text instead of replacing it: a replaced node is a DOM change that makes the browser
    // recheck :has() rules across the page every second, while edited text only redraws the digits
    const node = element.firstChild;
    if (node instanceof Text && node === element.lastChild) node.data = text;
    else element.textContent = text;

    if (!('animate' in this.dataset) || reducedMotion.matches) return;
    // Replay the drop-in that CSS defines. The class goes on once and starts it; after that the same animation
    // is rewound, without class changes or a forced layout
    const animation = tickAnimations.get(element);
    if (animation) {
      animation.currentTime = 0;
      animation.play();
      return;
    }
    element.classList.add('countdown__value--tick');
    const [started] = element.getAnimations();
    if (started) tickAnimations.set(element, started);
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
