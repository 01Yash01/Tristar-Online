import { Component } from '@theme/component';
import { DialogComponent } from '@theme/dialog';
import { prefersReducedMotion } from '@theme/utilities';

/** Judge.me's public review feed: the one its free All Reviews widget reads. No token needed. */
const FEED_URL = 'https://api.judge.me/reviews/all_reviews_js_based';

/** Reviews per page in that feed */
const PAGE_SIZE = 25;

/** Only photos from Judge.me's image host are shown */
const PHOTO_HOST = 'review-images.judgeme.com';

/** Lines of review text shown before "Read more"; matches `-webkit-line-clamp` in the section */
const CLAMP_LINES = 6;

/** @type {Record<string, Record<string, string>>} */
const SORT_PARAMS = {
  newest: {},
  highest: { sort_by: 'rating', sort_dir: 'desc' },
  lowest: { sort_by: 'rating', sort_dir: 'asc' },
  photos: { sort_by: 'pictures_first' },
};

/**
 * @typedef {object} FeedReview
 * @property {string} id
 * @property {number} rating
 * @property {string} name
 * @property {boolean} verified
 * @property {Date | null} date
 * @property {string} title
 * @property {string} body - Plain text; paragraphs separated by blank lines
 * @property {string[]} photos - Photo URLs without size parameters
 * @property {{ title: string, url: string | null } | null} product
 * @property {boolean} storeReview
 * @property {string} reply
 */

/**
 * The store reviews page. The section renders the newest reviews; this component loads the rest,
 * other sort orders and star filters from Judge.me's feed, clamps long reviews behind "Read more",
 * and shows customer photos in a viewer.
 *
 * Feed reviews are read out of the feed's HTML in an inert document, and cards are built from the
 * section's `<template>` using text and checked URLs only, so nothing from the feed is inserted as
 * HTML.
 *
 * @typedef {object} StoreReviewsRefs
 * @property {HTMLUListElement} list
 * @property {HTMLTemplateElement} cardTemplate
 * @property {HTMLElement} count
 * @property {HTMLElement} toolbar
 * @property {HTMLButtonElement} [more]
 * @property {HTMLElement} [error]
 * @property {HTMLElement} [empty]
 * @property {HTMLElement} [sortControl]
 * @property {HTMLSelectElement} [sort]
 * @property {HTMLButtonElement} [chip]
 * @property {HTMLElement} [chipText]
 * @property {HTMLButtonElement[]} [filters]
 * @property {HTMLElement} [viewer]
 *
 * @extends {Component<StoreReviewsRefs>}
 */
class StoreReviewsComponent extends Component {
  requiredRefs = ['list', 'cardTemplate', 'count', 'toolbar'];

  /** Star filter, or 0 for all ratings */
  #rating = 0;

  #sort = 'newest';

  /** Last feed page shown */
  #page = 1;

  /** Reviews in the current view, according to Judge.me */
  #total = 0;

  #complete = false;

  /** IDs of the reviews shown, so a review that moved between pages isn't shown twice */
  /** @type {Set<string>} */
  #ids = new Set();

  /** @type {AbortController | null} */
  #controller = null;

  /** The latest request, for "Try again" */
  #lastRequest = { page: 1, append: false };

  /** @type {Record<number, number>} */
  #counts = {};

  /** Photos the viewer steps through, and the one showing */
  /** @type {HTMLAnchorElement[]} */
  #photos = [];

  #photoIndex = 0;

  #listWidth = 0;

  /** Re-checks which reviews need "Read more" when the list changes width */
  #resizeObserver = new ResizeObserver(([entry]) => {
    const width = entry?.contentRect.width ?? 0;
    if (Math.abs(width - this.#listWidth) < 1) return;
    this.#listWidth = width;
    this.#measure(this.refs.list);
  });

  connectedCallback() {
    super.connectedCallback();

    const { list, filters, sort, sortControl, more } = this.refs;

    this.#total = Number(this.dataset.total) || 0;
    this.#counts = parseCounts(this.dataset.counts ?? '');
    this.#ids = new Set();
    for (const card of list.querySelectorAll('.store-review[data-review-id]')) {
      if (card instanceof HTMLElement && card.dataset.reviewId) this.#ids.add(card.dataset.reviewId);
    }
    this.#complete = this.#ids.size < PAGE_SIZE || this.#ids.size >= this.#total;

    // Controls that only work with this script
    for (const button of filters ?? []) button.disabled = false;
    if (sortControl) sortControl.hidden = false;
    if (sort) sort.value = this.#sort;
    if (more) more.hidden = this.#complete;

    this.#resizeObserver.observe(list);
    document.fonts?.ready.then(() => this.#measure(this.refs.list));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#controller?.abort();
    this.#controller = null;
    this.#resizeObserver.disconnect();
  }

  /** Loads the next page of reviews */
  showMore() {
    if (this.#controller || this.#complete) return;
    this.#load(this.#page + 1, true);
  }

  /**
   * Shows only reviews with this many stars; choosing the active rating again clears the filter.
   * @param {number} rating
   */
  filterRating(rating) {
    const value = Number(rating);
    if (!Number.isInteger(value) || value < 1 || value > 5) return;

    this.#rating = this.#rating === value ? 0 : value;
    this.#syncFilters();
    this.#load(1, false);
  }

  clearFilter() {
    if (!this.#rating) return;

    const previous = this.refs.filters?.find((button) => Number(button.dataset.rating) === this.#rating);
    this.#rating = 0;
    this.#syncFilters();
    // The chip hides, so keep keyboard users near the filters
    previous?.focus();
    this.#load(1, false);
  }

  /** Repeats the request that failed */
  retry() {
    if (this.#controller) return;
    this.#load(this.#lastRequest.page, this.#lastRequest.append);
  }

  /** @param {Event} event */
  changeSort(event) {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;

    this.#sort = select.value in SORT_PARAMS ? select.value : 'newest';
    this.#load(1, false);
  }

  /** @param {Event} event */
  toggleReview(event) {
    const button = event.target;
    if (!(button instanceof HTMLButtonElement)) return;

    const card = button.closest('.store-review');
    if (!(card instanceof HTMLElement)) return;

    const expanded = card.classList.toggle('store-review--expanded');
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = (expanded ? this.dataset.readLess : this.dataset.readMore) ?? '';

    // Collapsing a long review can leave its start above the screen
    if (!expanded && card.getBoundingClientRect().top < 0) {
      card.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
  }

  /**
   * Opens a customer photo in the viewer. Without the viewer, the link opens the photo instead.
   * @param {MouseEvent} event
   */
  openPhoto(event) {
    const link = event.target;
    const { viewer } = this.refs;
    if (!(link instanceof HTMLAnchorElement) || !(viewer instanceof DialogComponent)) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();

    const set = link.closest('[data-photo-set]');
    this.#photos = set ? [...set.querySelectorAll('a[data-photo]')].filter((item) => item instanceof HTMLAnchorElement) : [link];
    this.#photoIndex = Math.max(0, this.#photos.indexOf(link));
    this.#renderPhoto();
    viewer.showDialog();
  }

  /** @param {number} step - 1 for the next photo, -1 for the previous one */
  stepPhoto(step) {
    const count = this.#photos.length;
    if (count < 2) return;

    this.#photoIndex = (this.#photoIndex + Math.sign(Number(step)) + count) % count;
    this.#renderPhoto();
  }

  /** @param {KeyboardEvent} event */
  handlePhotoKey(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    event.preventDefault();
    const forward = event.key === 'ArrowRight' ? 1 : -1;
    this.stepPhoto(document.documentElement.dir === 'rtl' ? -forward : forward);
  }

  /**
   * @param {number} page
   * @param {boolean} append - Add to the list instead of replacing it
   */
  async #load(page, append) {
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;
    this.#lastRequest = { page, append };
    this.#setBusy(true, append);

    try {
      const { reviews, total } = await fetchFeed({
        shop: this.dataset.shopDomain ?? '',
        page,
        rating: this.#rating,
        sort: this.#sort,
        signal: controller.signal,
      });
      if (controller.signal.aborted || !this.isConnected) return;

      this.#render(reviews, page, append, total);
    } catch (failure) {
      if (controller.signal.aborted) return;
      console.warn('[store-reviews] Reviews could not load from Judge.me', failure);
      this.#showError();
    } finally {
      if (this.#controller === controller) {
        this.#controller = null;
        this.#setBusy(false, append);
      }
    }
  }

  /**
   * @param {FeedReview[]} reviews
   * @param {number} page
   * @param {boolean} append
   * @param {number | null} total
   */
  #render(reviews, page, append, total) {
    const { list, more, empty, error } = this.refs;

    // "Try again" hides with the error, so its focus moves to the reviews
    const refocus = append || Boolean(error?.contains(document.activeElement));
    if (error) error.hidden = true;

    if (!append) this.#ids.clear();

    const fragment = document.createDocumentFragment();
    /** @type {HTMLElement[]} */
    const cards = [];
    for (const review of reviews) {
      if (this.#ids.has(review.id)) continue;
      this.#ids.add(review.id);
      const item = this.#buildCard(review);
      if (!item) continue;
      cards.push(item);
      fragment.append(item);
    }

    if (append) {
      list.append(fragment);
    } else {
      list.replaceChildren(fragment);
    }

    // Only a view's first page reports its total
    this.#page = page;
    this.#total = Math.max(total ?? (append ? this.#total : this.#expectedTotal()), this.#ids.size);
    this.#complete = reviews.length < PAGE_SIZE || this.#ids.size >= this.#total;

    if (more) more.hidden = this.#complete;
    if (empty) empty.hidden = this.#ids.size > 0;
    this.#updateCount();
    this.#measure(cards);

    if (!append && this.refs.toolbar.getBoundingClientRect().top < 0) {
      this.refs.toolbar.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }

    if (refocus) {
      // Move keyboard and screen reader users to the first new review
      const first = cards[0]?.querySelector('.store-review');
      if (first instanceof HTMLElement) first.focus({ preventScroll: !append });
    }
  }

  #showError() {
    const { error, more } = this.refs;
    if (!error) return;

    const hadFocus = Boolean(more?.contains(document.activeElement));
    error.hidden = false;
    // "Try again" takes over from "Show more" until a request works
    if (more) more.hidden = true;
    if (hadFocus) error.querySelector('button')?.focus();
  }

  /**
   * Builds a review card from the section's template
   * @param {FeedReview} review
   * @returns {HTMLElement | null}
   */
  #buildCard(review) {
    const fragment = document.importNode(this.refs.cardTemplate.content, true);
    const item = fragment.firstElementChild;
    const card = item?.querySelector('.store-review');
    if (!(item instanceof HTMLElement) || !(card instanceof HTMLElement)) return null;

    /** @param {string} name */
    const field = (name) => {
      const element = item.querySelector(`[data-field="${name}"]`);
      return element instanceof HTMLElement ? element : null;
    };

    card.dataset.reviewId = review.id;
    card.classList.add('store-review--new');

    const name = review.name && review.name !== 'Anonymous' ? review.name : this.dataset.anonymous ?? '';
    setText(field('initial'), name.charAt(0).toUpperCase());
    setText(field('name'), name);
    if (!review.verified) field('verified')?.remove();

    const stars = field('rating');
    stars?.style.setProperty('--rating-percent', `${review.rating * 20}%`);
    stars?.setAttribute('aria-label', fill(this.dataset.ratingLabel, { rating: review.rating }));

    const date = field('date');
    if (review.date && date instanceof HTMLTimeElement) {
      date.dateTime = review.date.toISOString().slice(0, 10);
      date.textContent = formatDate(review.date);
    } else {
      date?.remove();
    }

    if (review.title) {
      setText(field('title'), review.title);
    } else {
      field('title')?.remove();
    }

    const body = field('body');
    const more = field('more');
    if (review.body && body) {
      body.textContent = review.body;
      body.id = `StoreReviewBody-${this.dataset.sectionId}-${review.id}`;
      more?.setAttribute('aria-controls', body.id);
    } else {
      body?.remove();
      more?.remove();
    }

    const photos = field('photos');
    const prototype = photos?.firstElementChild;
    if (photos && prototype && review.photos.length) {
      const label = fill(this.dataset.photoLabel, { name });
      const excerpt = truncate(review.body.replace(/\s+/g, ' '), 220);
      photos.replaceChildren(
        ...review.photos.map((base) => {
          const photo = /** @type {HTMLElement} */ (prototype.cloneNode(true));
          const link = photo.querySelector('a');
          const image = photo.querySelector('img');
          if (link) {
            link.href = `${base}?quality=80&width=1200`;
            Object.assign(link.dataset, {
              full: link.href,
              name,
              rating: String(review.rating),
              title: review.title,
              body: excerpt,
            });
          }
          if (image) {
            image.src = `${base}?quality=80&width=160`;
            image.srcset = `${base}?quality=80&width=160 160w, ${base}?quality=80&width=240 240w`;
            image.alt = label;
          }
          return photo;
        })
      );
    } else {
      photos?.remove();
    }

    const productLink = field('product-link');
    const productText = field('product-text');
    if (review.storeReview) {
      productLink?.remove();
      setText(field('product-text-title'), this.dataset.storeReview ?? '');
    } else if (review.product?.url && productLink instanceof HTMLAnchorElement) {
      productLink.href = review.product.url;
      setText(field('product-title'), review.product.title);
      productText?.remove();
    } else if (review.product) {
      productLink?.remove();
      setText(field('product-text-title'), review.product.title);
    } else {
      productLink?.remove();
      productText?.remove();
    }

    if (review.reply) {
      setText(field('reply-body'), review.reply);
    } else {
      field('reply')?.remove();
    }

    return item;
  }

  /**
   * Clamps review text longer than CLAMP_LINES lines and shows its "Read more" button. Reads every
   * height first, then writes, so the browser lays out once.
   * @param {ParentNode | HTMLElement[]} scope - The list, or the cards just added
   */
  #measure(scope) {
    const roots = Array.isArray(scope) ? scope : [scope];
    const bodies = roots.flatMap((root) => [
      ...root.querySelectorAll('.store-review:not(.store-review--expanded) .store-review__body'),
    ]);
    if (!bodies.length) return;

    requestAnimationFrame(() => {
      const lineHeight = parseFloat(getComputedStyle(bodies[0]).lineHeight) || 26;
      const limit = lineHeight * CLAMP_LINES + 2;
      const long = bodies.map((body) => body.scrollHeight > limit);

      bodies.forEach((body, index) => {
        const card = body.closest('.store-review');
        if (!card?.querySelector('.store-review__more')) return;
        card.classList.toggle('store-review--long', long[index]);
      });
    });
  }

  #syncFilters() {
    for (const button of this.refs.filters ?? []) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.rating) === this.#rating));
    }

    const { chip, chipText } = this.refs;
    if (!chip) return;

    chip.hidden = !this.#rating;
    if (!this.#rating) return;

    setText(chipText ?? null, fill(this.dataset.chip, { rating: this.#rating }));
    chip.setAttribute('aria-label', fill(this.dataset.chipLabel, { rating: this.#rating }));
  }

  /**
   * @param {boolean} busy
   * @param {boolean} append
   */
  #setBusy(busy, append) {
    const { list, more } = this.refs;

    if (append) {
      more?.setAttribute('aria-busy', String(busy));
    } else {
      list.setAttribute('aria-busy', String(busy));
    }
  }

  #updateCount() {
    const shown = this.#ids.size;
    const total = Math.max(this.#total, shown);
    const rule = new Intl.PluralRules(document.documentElement.lang || undefined).select(total);
    const template = rule === 'one' ? this.dataset.showingOne : this.dataset.showingOther;

    this.refs.count.textContent = fill(template, { shown, total });
  }

  #expectedTotal() {
    return this.#rating ? this.#counts[this.#rating] ?? 0 : Number(this.dataset.total) || 0;
  }

  #renderPhoto() {
    const { viewer } = this.refs;
    const link = this.#photos[this.#photoIndex];
    if (!viewer || !link) return;

    /** @param {string} name */
    const part = (name) => {
      const element = viewer.querySelector(`[data-viewer="${name}"]`);
      return element instanceof HTMLElement ? element : null;
    };

    const image = part('image');
    if (image instanceof HTMLImageElement) {
      image.src = link.dataset.full || link.href;
      image.alt = link.querySelector('img')?.alt ?? '';
    }

    const rating = Number(link.dataset.rating) || 0;
    const stars = part('stars');
    if (stars) {
      stars.hidden = !rating;
      stars.style.setProperty('--rating-percent', `${rating * 20}%`);
      stars.setAttribute('aria-label', fill(this.dataset.ratingLabel, { rating }));
    }

    setText(part('name'), link.dataset.name ?? '');
    setText(part('title'), link.dataset.title ?? '');
    setText(part('body'), link.dataset.body ?? '');

    const count = this.#photos.length;
    setText(part('position'), count > 1 ? fill(this.dataset.photoPosition, { index: this.#photoIndex + 1, count }) : '');
    for (const name of ['prev', 'next']) {
      const button = part(name);
      if (button) button.hidden = count < 2;
    }
  }
}

/**
 * @param {{ shop: string, page: number, rating: number, sort: string, signal: AbortSignal }} options
 * @returns {Promise<{ reviews: FeedReview[], total: number | null }>}
 */
async function fetchFeed({ shop, page, rating, sort, signal }) {
  const params = new URLSearchParams({
    review_type: 'all-reviews',
    shop_domain: shop,
    platform: 'shopify',
    page: String(page),
    ...SORT_PARAMS[sort],
  });
  if (rating) params.set('filter_rating', String(rating));

  const response = await fetch(`${FEED_URL}?${params}`, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(`Judge.me responded ${response.status}`);

  const data = await response.json();
  if (typeof data?.html !== 'string') throw new Error('Unexpected Judge.me response');

  // The first page of a view also reports how many reviews it holds
  const total = Number(data.number_of_shop_reviews) + Number(data.number_of_product_reviews);

  return { reviews: parseFeed(data.html), total: Number.isFinite(total) ? total : null };
}

/**
 * @param {string} html - Review markup from the feed
 * @returns {FeedReview[]}
 */
function parseFeed(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  /** @type {FeedReview[]} */
  const reviews = [];

  for (const element of doc.querySelectorAll('.jdgm-rev[data-review-id]')) {
    const id = element.getAttribute('data-review-id');
    const rating = Number(element.querySelector('.jdgm-rev__rating')?.getAttribute('data-score'));
    if (!id || !(rating >= 1 && rating <= 5)) continue;

    /** @param {string} selector */
    const text = (selector) => element.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    let storeReview = false;
    /** @type {FeedReview['product']} */
    let product = null;
    const productLink = element.querySelector('a.jdgm-rev__prod-link');
    if (productLink) {
      const path = sitePath(productLink.getAttribute('href'));
      if (path === '/') {
        storeReview = true;
      } else {
        product = { title: text('a.jdgm-rev__prod-link'), url: path?.startsWith('/products/') ? withRoot(path) : null };
      }
    } else if (text('.jdgm-rev__prod-title')) {
      product = { title: text('.jdgm-rev__prod-title'), url: null };
    }

    const photos = [];
    for (const link of element.querySelectorAll('a.jdgm-rev__pic-link')) {
      const base = photoBase(link.getAttribute('href'));
      if (base) photos.push(base);
    }

    const reply = element.querySelector('.jdgm-rev__reply-content') ?? element.querySelector('.jdgm-rev__reply');

    reviews.push({
      id,
      rating,
      name: text('.jdgm-rev__author'),
      verified: element.getAttribute('data-verified-buyer') === 'true',
      date: parseDate(element.querySelector('.jdgm-rev__timestamp')?.getAttribute('data-content')),
      title: text('.jdgm-rev__title'),
      body: blockText(element.querySelector('.jdgm-rev__body')),
      photos,
      product,
      storeReview,
      reply: blockText(reply),
    });
  }

  return reviews;
}

/**
 * Plain text of a block of review HTML, keeping paragraphs and line breaks
 * @param {Element | null} element
 */
function blockText(element) {
  if (!element) return '';

  const paragraphs = element.querySelectorAll('p');
  const blocks = paragraphs.length ? [...paragraphs] : [element];
  return blocks
    .map((block) => lineText(block))
    .filter(Boolean)
    .join('\n\n');
}

/** @param {Node} node */
function lineText(node) {
  let text = '';
  for (const child of node.childNodes) {
    if (child.nodeName === 'BR') {
      text += '\n';
    } else if (child.nodeType === Node.TEXT_NODE) {
      text += (child.textContent ?? '').replace(/\s+/g, ' ');
    } else {
      text += lineText(child);
    }
  }
  return text.replace(/ *\n */g, '\n').trim();
}

/**
 * The path of a link to this store, or null for any other site
 * @param {string | null} href
 */
function sitePath(href) {
  if (!href) return null;
  try {
    const url = new URL(href, window.location.origin);
    return url.pathname || '/';
  } catch {
    return null;
  }
}

/** @param {string} path - Starts with "/" */
function withRoot(path) {
  const root = /** @type {any} */ (window).Shopify?.routes?.root ?? '/';
  return `${root}${path.slice(1)}`;
}

/** @param {string | null} href */
function photoBase(href) {
  if (!href) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' || url.hostname !== PHOTO_HOST) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Judge.me dates look like "2025-09-02 04:36:11 UTC"
 * @param {string | null | undefined} value
 */
function parseDate(value) {
  if (!value) return null;
  const date = new Date(value.trim().replace(' UTC', 'Z').replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** @type {Intl.DateTimeFormat | undefined} */
let monthFormat;

/**
 * "2 Sep 2025", matching the section's `%-d %b %Y` dates
 * @param {Date} date
 */
function formatDate(date) {
  monthFormat ??= new Intl.DateTimeFormat(document.documentElement.lang || undefined, { month: 'short' });
  return `${date.getDate()} ${monthFormat.format(date)} ${date.getFullYear()}`;
}

/** @param {string} value - "5:262,4:52," */
function parseCounts(value) {
  /** @type {Record<number, number>} */
  const counts = {};
  for (const pair of value.split(',')) {
    const [rating, count] = pair.split(':').map(Number);
    if (rating && Number.isFinite(count)) counts[rating] = count;
  }
  return counts;
}

/**
 * Replaces `[name]` placeholders in a translated string
 * @param {string | undefined} template
 * @param {Record<string, string | number>} values
 */
function fill(template, values) {
  let text = template ?? '';
  for (const [key, value] of Object.entries(values)) text = text.replaceAll(`[${key}]`, String(value));
  return text;
}

/**
 * @param {string} text
 * @param {number} length
 */
function truncate(text, length) {
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}

/**
 * @param {HTMLElement | null} element
 * @param {string} text
 */
function setText(element, text) {
  if (element) element.textContent = text;
}

if (!customElements.get('store-reviews-component')) {
  customElements.define('store-reviews-component', StoreReviewsComponent);
}
