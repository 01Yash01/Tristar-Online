import { morph } from '@theme/morph';
import { Component } from '@theme/component';
import { StandardEvents, ProductSelectEvent } from '@shopify/events';

/**
 * Keeps the product condition in sync with the selected variant when a product sells its
 * condition grades as a variant option.
 */
class ProductConditionComponent extends Component {
  connectedCallback() {
    super.connectedCallback();
    const closestSection = this.closest('.shopify-section, dialog');
    closestSection?.addEventListener(StandardEvents.productSelect, this.#handleProductSelect);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    const closestSection = this.closest('.shopify-section, dialog');
    closestSection?.removeEventListener(StandardEvents.productSelect, this.#handleProductSelect);
  }

  /**
   * Handles product select event by updating the condition.
   * @param {ProductSelectEvent} event - The product select event.
   */
  #handleProductSelect = (event) => {
    if (!(event.target instanceof Element) || event.target.closest('product-card')) return;

    event.promise
      .then(({ detail }) => {
        if (!detail?.html) return;

        const { html, newProduct } = detail;

        if (newProduct) {
          this.dataset.productId = newProduct.id;
        } else if (detail.productId && detail.productId !== this.dataset.productId) {
          return;
        }

        const newCondition = html.querySelector(`product-condition-component[data-block-id="${this.dataset.blockId}"]`);
        if (!newCondition) return;

        morph(this, newCondition, { childrenOnly: true });
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[product-condition] Event promise rejected:', error);
      });
  };
}

if (!customElements.get('product-condition-component')) {
  customElements.define('product-condition-component', ProductConditionComponent);
}
