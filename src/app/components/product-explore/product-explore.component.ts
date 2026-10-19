import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, HostListener, Input, NgZone, OnChanges, OnDestroy, ViewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Product } from '../../models/product.model';
import { ProductCardComponent } from '../product-card/product-card.component';

@Component({
  selector: 'app-product-explore', standalone: true,
  imports: [CommonModule, RouterLink, ProductCardComponent],
  templateUrl: './product-explore.component.html', styleUrl: './product-explore.component.css'
})
export class ProductExploreComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() products: Product[] = [];
  @Input() loading = false;
  @Input() failed = false;
  @ViewChild('viewport') viewport?: ElementRef<HTMLElement>;
  items: Product[] = [];
  visibleCount = 4;
  mobile = window.innerWidth <= 1023;
  offset = 0;
  animating = false;
  transitioning = false;
  autoplay = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private hovered = false;
  private focused = false;
  private touching = false;
  private resumeAt = 0;
  private inView = false;
  private direction = 1;
  private interval?: ReturnType<typeof setInterval>;
  private completion?: ReturnType<typeof setTimeout>;
  private frame = 0;
  private observer?: IntersectionObserver;

  constructor(private zone: NgZone, private host: ElementRef<HTMLElement>) {}

  ngOnChanges(): void {
    this.clearAnimation();
    this.items = [...this.products];
    this.resize();
  }

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(entries => { this.inView = entries.some(entry => entry.isIntersecting); }, { threshold: 0.1 });
      this.observer.observe(this.host.nativeElement);
    } else this.inView = true;
    this.zone.runOutsideAngular(() => {
      this.interval = setInterval(() => {
        if (this.autoplay && this.inView && !document.hidden && !this.hovered && !this.focused && !this.touching && Date.now() >= this.resumeAt) {
          this.zone.run(() => this.advance(1));
        }
      }, 3000);
    });
  }

  @HostListener('window:resize') resize(): void {
    if (this.animating) this.finish();
    this.mobile = window.innerWidth <= 1023;
    const columns = this.mobile ? 2 : 4;
    this.visibleCount = this.items.length > 1 ? Math.min(columns, this.items.length) : columns;
  }

  trackProduct(_index: number, product: Product): string { return product.id; }
  pointerEntered(event: PointerEvent): void { if (event.pointerType === 'mouse') this.hovered = true; }
  pointerLeft(event: PointerEvent): void { if (event.pointerType === 'mouse') this.hovered = false; }
  touch(active: boolean): void {
    this.touching = active;
    if (!active) this.resumeAt = Date.now() + 3000;
  }
  scrolled(): void {
    if (this.mobile && (this.touching || Date.now() < this.resumeAt)) this.resumeAt = Date.now() + 3000;
  }
  focusEntered(): void { this.focused = true; }
  focusLeft(event: FocusEvent): void { this.focused = this.host.nativeElement.contains(event.relatedTarget as Node | null); }
  toggleAutoplay(): void {
    this.autoplay = !this.autoplay;
    if (this.autoplay) this.focused = false;
  }

  advance(direction: number): void {
    if (this.animating || this.items.length < 2) return;
    const viewport = this.viewport?.nativeElement;
    const first = viewport?.querySelector<HTMLElement>('[data-primary]');
    const step = (first?.getBoundingClientRect().width || 0) + 20;
    if (this.mobile) {
      if (!viewport || !first || step <= 20) return;
      const maximum = viewport.scrollWidth - viewport.clientWidth;
      if (maximum <= 0) return;
      const left = direction > 0
        ? (viewport.scrollLeft >= maximum - 2 ? 0 : Math.min(maximum, viewport.scrollLeft + step))
        : (viewport.scrollLeft <= 2 ? maximum : Math.max(0, viewport.scrollLeft - step));
      viewport.scrollTo({ left, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      return;
    }
    if (!viewport || !first || step <= 20 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.rotate(direction); return;
    }
    this.direction = direction;
    this.animating = true;
    if (direction > 0) {
      this.transitioning = true;
      this.offset = -step;
      this.scheduleFinish();
    } else {
      this.rotate(-1);
      this.transitioning = false;
      this.offset = -step;
      this.zone.runOutsideAngular(() => {
        this.frame = requestAnimationFrame(() => {
          this.frame = requestAnimationFrame(() => this.zone.run(() => {
            this.transitioning = true; this.offset = 0; this.scheduleFinish();
          }));
        });
      });
    }
  }

  transitionEnded(event: TransitionEvent): void {
    if (event.target === event.currentTarget && event.propertyName === 'transform') this.finish();
  }

  private rotate(direction: number): void {
    this.items = direction > 0 ? [...this.items.slice(1), this.items[0]] : [this.items[this.items.length - 1], ...this.items.slice(0, -1)];
  }

  private scheduleFinish(): void {
    this.zone.runOutsideAngular(() => { this.completion = setTimeout(() => this.zone.run(() => this.finish()), 400); });
  }

  private finish(): void {
    if (!this.animating) return;
    if (this.direction > 0) this.rotate(1);
    this.clearAnimation();
  }

  private clearAnimation(): void {
    if (this.completion) clearTimeout(this.completion);
    cancelAnimationFrame(this.frame);
    this.offset = 0; this.animating = false; this.transitioning = false;
  }

  ngOnDestroy(): void {
    if (this.interval) clearInterval(this.interval);
    this.observer?.disconnect();
    this.clearAnimation();
  }
}
