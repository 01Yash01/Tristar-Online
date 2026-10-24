import { Component } from '@theme/component';

const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const desktopQuery = matchMedia('(min-width: 750px)');

/**
 * Background video behavior for the hero section.
 *
 * - Fades each video in over its preview image once it is really playing.
 * - Plays only the videos visible at the current breakpoint, and only while on screen.
 * - Starts paused for shoppers who prefer reduced motion.
 * - Powers the optional play/pause button.
 *
 * @typedef {object} Refs
 * @property {HTMLButtonElement} [toggle] - The optional play/pause button.
 *
 * @extends {Component<Refs>}
 */
class HeroVideo extends Component {
  /** @type {AbortController | null} */
  #controller = null;

  /** @type {IntersectionObserver | null} */
  #observer = null;

  #isOnScreen = false;
  #isUserPaused = false;

  connectedCallback() {
    super.connectedCallback();

    this.#controller?.abort();
    this.#controller = new AbortController();
    const { signal } = this.#controller;

    this.#isUserPaused = reducedMotionQuery.matches;

    for (const video of this.#videos) {
      if (video.paused) this.#wrapperOf(video)?.setAttribute('data-video-pending', '');
      video.addEventListener('playing', this.#handlePlaying, { signal });
    }

    desktopQuery.addEventListener('change', this.#sync, { signal });

    this.#observer?.disconnect();
    this.#observer = new IntersectionObserver(([entry]) => {
      this.#isOnScreen = Boolean(entry?.isIntersecting);
      this.#sync();
    });
    this.#observer.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#controller?.abort();
    this.#controller = null;
    this.#observer?.disconnect();
    this.#observer = null;
  }

  /**
   * Toggles playback from the play/pause button.
   */
  toggle() {
    this.#isUserPaused = !this.#isUserPaused;
    this.#sync();
  }

  /** @returns {HTMLVideoElement[]} */
  get #videos() {
    return Array.from(this.querySelectorAll('.hero__media-grid video'));
  }

  /** @param {HTMLVideoElement} video */
  #wrapperOf(video) {
    return video.closest('.hero__media-wrapper');
  }

  /** @param {Event} event */
  #handlePlaying = (event) => {
    if (event.target instanceof HTMLVideoElement) {
      this.#wrapperOf(event.target)?.removeAttribute('data-video-pending');
    }
  };

  #sync = () => {
    const shouldPlay = this.#isOnScreen && !this.#isUserPaused;

    for (const video of this.#videos) {
      // The desktop or mobile copy hidden at this breakpoint never plays.
      const isDisplayed = video.checkVisibility?.() ?? video.offsetParent !== null;

      if (shouldPlay && isDisplayed) {
        video.play().catch(() => {
          // Autoplay can be blocked (for example in low power mode); the preview image stays.
        });
      } else {
        video.pause();
      }
    }

    const { toggle } = this.refs;
    if (toggle) {
      toggle.toggleAttribute('data-paused', this.#isUserPaused);
      const label = this.#isUserPaused ? toggle.dataset.labelPlay : toggle.dataset.labelPause;
      if (label) toggle.setAttribute('aria-label', label);
    }
  };
}

if (!customElements.get('hero-video')) {
  customElements.define('hero-video', HeroVideo);
}
