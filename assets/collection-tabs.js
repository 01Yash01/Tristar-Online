import { Component } from '@theme/component';

/**
 * Collection Tabs Component
 * Handles accessible tab switching, panel reveal, and sync with featured image.
 */
class CollectionTabsComponent extends Component {
  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('click', this.#handleClick);
    this.addEventListener('keydown', this.#handleKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('click', this.#handleClick);
    this.removeEventListener('keydown', this.#handleKeydown);
  }

  get tabs() {
    return Array.from(this.querySelectorAll('[role="tab"]'));
  }

  get panels() {
    return Array.from(this.querySelectorAll('[role="tabpanel"]'));
  }

  get images() {
    return Array.from(this.querySelectorAll('.collection-tabs__image-link'));
  }

  #handleClick = (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (!tab) return;

    // Prevent default navigation or form actions; purely switch tabs
    event.preventDefault();
    const index = parseInt(tab.dataset.index, 10);
    if (!isNaN(index)) {
      this.selectTab(index);
    }
  };

  /**
   * Select a tab by index and synchronize panels and images
   * @param {number} targetIndex
   */
  selectTab(targetIndex) {
    const { tabs, panels, images } = this;
    if (targetIndex < 0 || targetIndex >= tabs.length) return;

    // 1. Update Tab buttons
    tabs.forEach((tab, i) => {
      const isSelected = i === targetIndex;
      tab.setAttribute('aria-selected', isSelected.toString());
      if (isSelected) {
        tab.classList.add('is-active');
      } else {
        tab.classList.remove('is-active');
      }
    });

    // 2. Update Tab panels
    panels.forEach((panel, i) => {
      const isSelected = i === targetIndex;
      panel.hidden = !isSelected;
      if (isSelected) {
        panel.classList.add('is-active');
      } else {
        panel.classList.remove('is-active');
      }
    });

    // 3. Update Featured Images
    images.forEach((img, i) => {
      const isSelected = i === targetIndex;
      if (isSelected) {
        img.classList.add('is-active');
        img.setAttribute('aria-hidden', 'false');
        img.setAttribute('tabindex', '0');
      } else {
        img.classList.remove('is-active');
        img.setAttribute('aria-hidden', 'true');
        img.setAttribute('tabindex', '-1');
      }
    });
  }

  /**
   * Keyboard navigation for tabs (Arrow keys, Home, End)
   * @param {KeyboardEvent} event
   */
  #handleKeydown = (event) => {
    const target = event.target.closest('[role="tab"]');
    if (!target) return;

    const { tabs } = this;
    const currentIndex = tabs.indexOf(target);
    if (currentIndex === -1) return;

    let nextIndex = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      tabs[nextIndex].focus();
      this.selectTab(nextIndex);
    }
  };
}

if (!customElements.get('collection-tabs-component')) {
  customElements.define('collection-tabs-component', CollectionTabsComponent);
}
