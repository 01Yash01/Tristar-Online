/**
 * Refreshes the delivery window that Liquid rendered, because a cached page can be a day old.
 * Counts business days (Monday to Friday) from the shopper's today; public holidays are not skipped.
 */
class DeliveryEstimate extends HTMLElement {
  connectedCallback() {
    const minDays = Number(this.dataset.minDays);
    const maxDays = Number(this.dataset.maxDays);
    const start = this.querySelector('[data-delivery-start]');
    const end = this.querySelector('[data-delivery-end]');

    if (!(start instanceof HTMLTimeElement) || !(end instanceof HTMLTimeElement)) return;
    if (!Number.isInteger(minDays) || !Number.isInteger(maxDays) || minDays < 1 || maxDays < minDays) return;

    const format = createFormat(this.dataset.locale);
    const today = new Date();

    update(start, addBusinessDays(today, minDays), format);
    update(end, addBusinessDays(today, maxDays), format);
  }
}

/**
 * @param {string | undefined} locale - A locale such as `en-AU`.
 * @returns {Intl.DateTimeFormat}
 */
function createFormat(locale) {
  const options = /** @type {const} */ ({ weekday: 'short', day: 'numeric', month: 'short' });

  try {
    return new Intl.DateTimeFormat(locale, options);
  } catch {
    return new Intl.DateTimeFormat(undefined, options);
  }
}

/**
 * @param {Date} from - The day to count from.
 * @param {number} days - The number of business days to add.
 * @returns {Date}
 */
function addBusinessDays(from, days) {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let added = 0;

  while (added < days) {
    date.setDate(date.getDate() + 1);
    const weekday = date.getDay();
    if (weekday !== 0 && weekday !== 6) added += 1;
  }

  return date;
}

/**
 * @param {HTMLTimeElement} element - The element to update.
 * @param {Date} date - The date to show.
 * @param {Intl.DateTimeFormat} format - The display format.
 */
function update(element, date, format) {
  const pad = (/** @type {number} */ value) => String(value).padStart(2, '0');

  element.dateTime = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  element.textContent = format.format(date);
}

if (!customElements.get('delivery-estimate')) {
  customElements.define('delivery-estimate', DeliveryEstimate);
}
