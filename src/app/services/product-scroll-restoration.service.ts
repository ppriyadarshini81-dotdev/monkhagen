import { Injectable } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';

interface ProductScrollRecord {
  sourceUrl: string;
  productId: string;
  viewportTop: number;
  savedAt: number;
}

@Injectable({ providedIn: 'root' })
export class ProductScrollRestorationService {
  private readonly storageKey = 'mh-product-scroll-return';
  private returningWithHistory = false;

  constructor(private router: Router) {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.returningWithHistory = event.navigationTrigger === 'popstate';
      }
    });
  }

  remember(productId: string, card: HTMLElement): void {
    const record: ProductScrollRecord = {
      sourceUrl: this.router.url,
      productId,
      viewportTop: card.getBoundingClientRect().top,
      savedAt: Date.now()
    };
    try { sessionStorage.setItem(this.storageKey, JSON.stringify(record)); }
    catch { /* Navigation must still work when storage is unavailable. */ }
  }

  restoreAfterProductsRender(): void {
    if (!this.returningWithHistory) return;
    const record = this.read();
    if (!record || record.sourceUrl !== this.router.url || Date.now() - record.savedAt > 30 * 60 * 1000) return;

    requestAnimationFrame(() => {
      const card = Array.from(document.querySelectorAll<HTMLElement>('[data-scroll-product-id]'))
        .find(element => element.dataset['scrollProductId'] === record.productId);
      if (!card) return;
      const top = Math.max(0, window.scrollY + card.getBoundingClientRect().top - record.viewportTop);
      window.scrollTo({ top, left: 0, behavior: 'auto' });
      this.returningWithHistory = false;
      try { sessionStorage.removeItem(this.storageKey); }
      catch { /* The position has already been restored. */ }
    });
  }

  private read(): ProductScrollRecord | null {
    try {
      const value = JSON.parse(sessionStorage.getItem(this.storageKey) || 'null') as Partial<ProductScrollRecord> | null;
      return value && typeof value.sourceUrl === 'string' && typeof value.productId === 'string' &&
        Number.isFinite(value.viewportTop) && Number.isFinite(value.savedAt)
        ? value as ProductScrollRecord : null;
    } catch { return null; }
  }
}
