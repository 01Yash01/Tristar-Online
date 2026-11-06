import { Component } from '@theme/component';

const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const desktopQuery = matchMedia('(min-width: 750px)');
const supportsScrollTimeline = CSS.supports('animation-timeline: view()');

/** Share of the pinned scroll over which the text fades in, and where the buttons start to rise. */
const TEXT_FADE_END = 0.17;
const ACTIONS_START = 0.75;

/**
 * Revealed image on scroll (sections/revealed-image.liquid).
 *
 * Where the browser has scroll-driven animations, CSS runs the whole reveal. Elsewhere this component
 * feeds the same progress to CSS through custom properties while the section is near the screen. It
 * also plays the background video only while the section is on screen and at the breakpoint it
 * belongs to, starts it paused for reduced motion, and powers the play/pause button.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} [stage] - The pinned, full-screen stage.
 * @property {HTMLButtonElement} [toggle] - The video play/pause button.
 *
 * @extends {Component<Refs>}
 */
class RevealedImage extends Component {
  /** @type {AbortController | null} */
  #controller = null;

  /** @type {IntersectionObserver | null} */
  #observer = null;

  #frame = 0;
  #isNearScreen = false;
  #isUserPaused = false;

  connectedCallback() {
    super.connectedCallback();
    this.#setup();
  }

  updatedCallback() {
    super.updatedCallback();
    this.#setup();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#teardown();
  }

  /** Plays or pauses the background video from the toggle button. */
  toggleVideo() {
    this.#isUserPaused = !this.#isUserPaused;
    this.#syncVideo();
  }

  #setup() {
    this.#teardown();
    this.#controller = new AbortController();
    const { signal } = this.#controller;

    this.#isUserPaused = reducedMotionQuery.matches;

    this.#observer = new IntersectionObserver(
      ([entry]) => {
        this.#isNearScreen = Boolean(entry?.isIntersecting);
        this.#syncVideo();
        // Also runs as the section leaves, so a fast scroll past it still ends in the right state
        this.#update();
      },
      { rootMargin: '20% 0px' }
    );
    this.#observer.observe(this);

    if (!supportsScrollTimeline) {
      // Captured on the document so it also hears the theme's own scroll container (.page-wrapper on desktop)
      document.addEventListener('scroll', this.#requestUpdate, { capture: true, passive: true, signal });
      window.addEventListener('resize', this.#requestUpdate, { signal });
      reducedMotionQuery.addEventListener('change', this.#requestUpdate, { signal });
      this.#update();
    }

    for (const video of this.#videos) {
      video.addEventListener('playing', this.#handlePlaying, { signal });
    }
    desktopQuery.addEventListener('change', this.#syncVideo, { signal });
  }

  #teardown() {
    this.#controller?.abort();
    this.#controller = null;
    this.#observer?.disconnect();
    this.#observer = null;
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  #requestUpdate = () => {
    if (supportsScrollTimeline || this.#frame || !this.#isNearScreen) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#update();
    });
  };

  /** Scripted fallback: maps the section's scroll position to the reveal's custom properties. */
  #update() {
    if (supportsScrollTimeline) return;

    if (reducedMotionQuery.matches) {
      // CSS shows the finished state for reduced motion
      for (const name of ['--revealed-image-progress', '--revealed-image-text', '--revealed-image-actions']) {
        this.style.removeProperty(name);
      }
      return;
    }

    // The reveal runs over (length - 1) screens of pinned scroll; with the slide-over the section is one
    // screen taller, but the reveal still ends at the same point
    const stageHeight = this.refs.stage?.offsetHeight ?? window.innerHeight;
    const length = parseFloat(getComputedStyle(this).getPropertyValue('--revealed-image-length')) || 1.8;
    const reveal = Math.max(1, (length - 1) * stageHeight);
    const linear = clamp(-this.getBoundingClientRect().top / reveal);

    this.style.setProperty('--revealed-image-progress', String(easeIn(linear)));
    this.style.setProperty('--revealed-image-text', String(clamp(linear / TEXT_FADE_END)));
    this.style.setProperty('--revealed-image-actions', String(easeOut(clamp((linear - ACTIONS_START) / (1 - ACTIONS_START)))));
  }

  /** @returns {HTMLVideoElement[]} */
  get #videos() {
    return Array.from(this.querySelectorAll('.revealed-image__video video'));
  }

  /** @param {Event} event */
  #handlePlaying = (event) => {
    if (event.target instanceof HTMLVideoElement) {
      event.target.closest('.revealed-image__video')?.removeAttribute('data-video-pending');
    }
  };

  #syncVideo = () => {
    const videos = this.#videos;
    if (!videos.length) return;

    const shouldPlay = this.#isNearScreen && !this.#isUserPaused;

    for (const video of videos) {
      // The desktop or mobile copy hidden at this breakpoint never plays
      const isDisplayed = video.checkVisibility?.() ?? video.offsetParent !== null;

      if (shouldPlay && isDisplayed) {
        video.play().catch(() => {
          // Autoplay can be blocked (for example in low power mode); the image stays in view
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

/**
 * @param {number} value
 * @returns {number} The value limited to 0–1.
 */
function clamp(value) {
  return Math.min(1, Math.max(0, value));
}

/**
 * Evaluates a CSS cubic-bezier timing function, so the fallback moves exactly like the CSS path.
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {number} x - Linear progress, 0–1.
 * @returns {number} Eased progress, 0–1.
 */
function cubicBezier(x1, y1, x2, y2, x) {
  /** @param {number} t @param {number} p1 @param {number} p2 */
  const curve = (t, p1, p2) => 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3;
  let low = 0;
  let high = 1;
  let t = x;
  for (let i = 0; i < 24; i += 1) {
    t = (low + high) / 2;
    if (curve(t, x1, x2) < x) low = t;
    else high = t;
  }
  return curve(t, y1, y2);
}

/** @param {number} x */
const easeIn = (x) => cubicBezier(0.42, 0, 1, 1, x);

/** @param {number} x */
const easeOut = (x) => cubicBezier(0, 0, 0.58, 1, x);

if (!customElements.get('revealed-image')) {
  customElements.define('revealed-image', RevealedImage);
}
