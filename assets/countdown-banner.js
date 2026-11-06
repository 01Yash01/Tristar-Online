import { Component } from '@theme/component';
import { prefersReducedMotion } from '@theme/utilities';

/**
 * Countdown banner (sections/countdown-banner.liquid): copies the discount code and closes the banner.
 *
 * The live timer is the Countdown block (assets/countdown-timer.js), and the section's CSS hides the
 * banner once that timer is gone. A closed banner is remembered for the browser session under the
 * campaign key in `data-campaign`, which the section's inline script sets before first paint, so a
 * new campaign shows again.
 *
 * @typedef {object} Refs
 * @property {HTMLButtonElement} [codeButton] - The discount code chip.
 * @property {HTMLElement} [codeAction] - The chip's "Copy" / "Copied" label.
 * @property {HTMLElement} [status] - Live region that announces a copied code.
 *
 * @extends {Component<Refs>}
 */
class CountdownBanner extends Component {
  /** @type {number | undefined} */
  #resetTimer;

  disconnectedCallback() {
    super.disconnectedCallback();
    window.clearTimeout(this.#resetTimer);
  }

  /** Copies the discount code, then confirms it on the chip and to screen readers. */
  async copyCode() {
    const { codeButton, codeAction, status } = this.refs;
    const code = codeButton?.dataset.code;
    if (!codeButton || !code) return;

    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard unavailable: select the code so it can be copied by hand
      const value = codeButton.querySelector('.countdown-banner__code-value');
      if (value) window.getSelection()?.selectAllChildren(value);
      return;
    }

    codeButton.dataset.copied = '';
    if (codeAction) codeAction.textContent = codeAction.dataset.copiedLabel ?? '';
    if (status) status.textContent = status.dataset.message ?? '';

    window.clearTimeout(this.#resetTimer);
    this.#resetTimer = window.setTimeout(() => {
      delete codeButton.dataset.copied;
      if (codeAction) codeAction.textContent = codeAction.dataset.copyLabel ?? '';
      if (status) status.textContent = '';
    }, 2500);
  }

  /** Closes the banner for the rest of the session and hands focus to the next control on the page. */
  async dismiss() {
    const hadFocus = this.contains(document.activeElement);
    const { campaign, sectionId } = this.dataset;

    if (campaign !== undefined && !window.Shopify?.designMode) {
      try {
        sessionStorage.setItem(`countdown-banner:${sectionId}`, campaign);
      } catch {
        // Storage blocked: the banner still closes for this page view
      }
    }

    const card = this.firstElementChild;
    if (card instanceof HTMLElement && !prefersReducedMotion()) {
      const fade = card.animate(
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: 'translateY(-0.25rem) scale(0.98)' },
        ],
        { duration: 200, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }
      );
      await fade.finished.catch(() => {});
    }

    this.hidden = true;
    if (hadFocus) this.#focusNext();
  }

  /** Moves focus to the first visible control after the banner, so keyboard users keep their place. */
  #focusNext() {
    const selector =
      'a[href], button:not([disabled]), input:not([disabled], [type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    for (const element of document.querySelectorAll(selector)) {
      if (!(element instanceof HTMLElement) || this.contains(element)) continue;
      if (!(this.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      if (element.getClientRects().length === 0) continue;

      element.focus();
      return;
    }
  }
}

if (!customElements.get('countdown-banner')) {
  customElements.define('countdown-banner', CountdownBanner);
}
