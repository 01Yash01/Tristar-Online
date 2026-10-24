/**
 * Magnifies product images in place while a mouse hovers them; there is no full-screen viewer.
 *
 * Galleries opt in with `data-hover-zoom` (see snippets/product-media-gallery-content.liquid).
 * Listeners are delegated from the document, so galleries replaced by section rendering keep
 * working without re-initialising. Touch and coarse pointers are ignored.
 */
const ZOOM_SCALE = 2;
const ZOOM_TARGET = '[data-hover-zoom] .product-media-container--image';
const finePointerQuery = matchMedia('(hover: hover) and (pointer: fine)');

/** @type {HTMLElement | null} */
let activeContainer = null;
let isPressed = false;
let frame = 0;
let pointerX = 0;
let pointerY = 0;

/**
 * @param {EventTarget | null} target
 * @returns {HTMLElement | null}
 */
function zoomTargetFrom(target) {
  if (!(target instanceof Element)) return null;
  const container = target.closest(ZOOM_TARGET);
  // The zoom window has its own viewing behavior (scroll, click to close), so it is excluded.
  if (!(container instanceof HTMLElement) || container.closest('.dialog-zoomed-gallery')) return null;
  return container;
}

/** @param {HTMLElement} container */
function startZoom(container) {
  activeContainer = container;

  // Ask the browser for a sharper candidate from the image's existing srcset, once.
  const image = container.querySelector('.product-media__image');
  if (image instanceof HTMLImageElement && !image.dataset.hoverZoomSized) {
    image.dataset.hoverZoomSized = '';
    image.sizes = `${Math.ceil(container.getBoundingClientRect().width * ZOOM_SCALE)}px`;
  }

  updateOrigin();
  container.setAttribute('data-zooming', '');
}

function stopZoom() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  activeContainer?.removeAttribute('data-zooming');
  activeContainer = null;
}

function updateOrigin() {
  frame = 0;
  if (!activeContainer) return;

  const rect = activeContainer.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const x = Math.min(Math.max((pointerX - rect.left) / rect.width, 0), 1) * 100;
  const y = Math.min(Math.max((pointerY - rect.top) / rect.height, 0), 1) * 100;
  activeContainer.style.setProperty('--zoom-x', `${x}%`);
  activeContainer.style.setProperty('--zoom-y', `${y}%`);
}

document.addEventListener(
  'pointermove',
  (event) => {
    if (event.pointerType !== 'mouse' || !finePointerQuery.matches || isPressed) return;

    pointerX = event.clientX;
    pointerY = event.clientY;

    const container = zoomTargetFrom(event.target);
    if (container !== activeContainer) {
      stopZoom();
      if (container) startZoom(container);
      return;
    }

    if (activeContainer && !frame) frame = requestAnimationFrame(updateOrigin);
  },
  { passive: true }
);

document.addEventListener('pointerout', (event) => {
  if (!activeContainer) return;
  const next = event.relatedTarget;
  if (!(next instanceof Node) || !activeContainer.contains(next)) stopZoom();
});

// Dragging the carousel or clicking pauses the zoom until the button is released.
document.addEventListener('pointerdown', () => {
  isPressed = true;
  stopZoom();
});

for (const type of ['pointerup', 'pointercancel']) {
  document.addEventListener(type, () => {
    isPressed = false;
  });
}

// Scrolling moves the image under a still pointer, so let go instead of drifting. Captured on the
// document because on desktop the page scrolls inside `.page-wrapper`, whose scroll events never
// reach `window`.
document.addEventListener('scroll', stopZoom, { passive: true, capture: true });
