import { Component } from '@theme/component';
import { isRTL } from '@theme/utilities';

/** Pointer dwell before a hovered tab takes over. */
const SWITCH_DELAY_MS = 90;

/** Longer dwell while the pointer is heading toward the open panel, crossing other tabs on the way. */
const AIM_DELAY_MS = 300;

/**
 * Category tabs mega menu panel (snippets/mega-menu-tabs.liquid).
 *
 * Hovering, focusing, or (on touch screens) first tapping a tab shows its panel. A short dwell, longer
 * while the pointer moves toward the open panel, keeps diagonal moves across other tabs from
 * switching it. Inactive panels are hidden and inert, so keyboard order runs tab, its links, next tab.
 * Without JavaScript the first panel shows and every tab is still a working link.
 *
 * @typedef {object} Refs
 * @property {HTMLAnchorElement[]} tabs - The tab links, in menu order.
 * @property {HTMLElement[]} panels - One panel per tab, in the same order.
 *
 * @extends {Component<Refs>}
 */
class MegaMenuTabs extends Component {
  requiredRefs = ['tabs', 'panels'];

  #activeIndex = 0;

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #switchTimer;

  /** @type {AbortController | null} */
  #controller = null;

  #pointerX = 0;
  #pointerDeltaX = 0;

  connectedCallback() {
    super.connectedCallback();

    const current = this.refs.tabs.findIndex((tab) => tab.hasAttribute('data-active'));
    this.#activeIndex = current === -1 ? 0 : current;

    this.#controller?.abort();
    this.#controller = new AbortController();
    this.addEventListener('pointermove', this.#trackPointer, { passive: true, signal: this.#controller.signal });
  }

  updatedCallback() {
    super.updatedCallback();
    // Header hydration re-renders this markup after load; keep the tab the shopper is on.
    this.#show(this.#activeIndex);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#controller?.abort();
    this.#controller = null;
    clearTimeout(this.#switchTimer);
    this.#switchTimer = undefined;
  }

  /**
   * Shows a tab's panel after a short dwell.
   * @param {number} index
   * @param {PointerEvent} event
   */
  hoverTab(index, event) {
    if (event.pointerType && event.pointerType !== 'mouse') return;

    clearTimeout(this.#switchTimer);
    if (index === this.#activeIndex) return;

    const delay = this.#isHeadingToPanel() ? AIM_DELAY_MS : SWITCH_DELAY_MS;
    this.#switchTimer = setTimeout(() => this.#show(index), delay);
  }

  /** Cancels a pending switch when the pointer leaves a tab before its dwell ends. */
  leaveTab() {
    clearTimeout(this.#switchTimer);
  }

  /** Cancels a pending switch once the pointer reaches the open panel. */
  holdPanel() {
    clearTimeout(this.#switchTimer);
  }

  /**
   * Keyboard focus shows a tab's panel right away.
   * @param {number} index
   */
  focusTab(index) {
    clearTimeout(this.#switchTimer);
    this.#show(index);
  }

  /**
   * On touch screens the first tap opens a tab and a second tap follows its link.
   * @param {number} index
   * @param {MouseEvent} event
   */
  tapTab(index, event) {
    const pointerType = 'pointerType' in event ? event.pointerType : '';
    if (pointerType !== 'touch' && pointerType !== 'pen') return;
    if (index === this.#activeIndex) return;

    event.preventDefault();
    this.#show(index);
  }

  /** @param {PointerEvent} event */
  #trackPointer = (event) => {
    this.#pointerDeltaX = event.clientX - this.#pointerX;
    this.#pointerX = event.clientX;
  };

  #isHeadingToPanel() {
    const towardPanel = isRTL() ? -this.#pointerDeltaX : this.#pointerDeltaX;
    return towardPanel > 1;
  }

  /** @param {number} index */
  #show(index) {
    const { tabs, panels } = this.refs;
    if (!tabs[index] || !panels[index]) return;

    this.#activeIndex = index;

    tabs.forEach((tab, tabIndex) => tab.toggleAttribute('data-active', tabIndex === index));
    panels.forEach((panel, panelIndex) => {
      const isActive = panelIndex === index;
      panel.toggleAttribute('data-active', isActive);
      panel.inert = !isActive;
    });
  }
}

if (!customElements.get('mega-menu-tabs')) {
  customElements.define('mega-menu-tabs', MegaMenuTabs);
}
