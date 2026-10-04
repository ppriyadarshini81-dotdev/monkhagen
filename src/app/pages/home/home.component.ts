import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, Optional, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Product } from '../../models/product.model';
import { Category } from '../../models/category.model';
import { ProductService } from '../../services/product.service';
import { CategoryService } from '../../services/category.service';
import { ProductCardComponent } from '../../components/product-card/product-card.component';
import { MEDIA } from '../../config/media-assets';
import { ProductScrollRestorationService } from '../../services/product-scroll-restoration.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ProductCardComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent implements AfterViewInit, OnInit, OnDestroy {
  featured: Product[] = [];
  newArrivals: Product[] = [];
  categories: Category[] = [];
  loading = true;

  readonly posters = MEDIA.hero.posters;
  // Repeat the first banner once so the final-to-first transition slides forward.
  readonly heroSlides = this.posters.length ? [...this.posters, this.posters[0]] : [];
  readonly media   = MEDIA;

  readonly instaFeed  = MEDIA.instagram.posts;
  readonly instaUrl   = MEDIA.instagram.profileUrl;
  instaOffset = 0;
  readonly instaVisible = 5;

  get instaSlice() {
    return this.instaFeed.slice(this.instaOffset, this.instaOffset + this.instaVisible);
  }
  instaNext(): void {
    this.advanceInstagram(1);
    this.startInstagramTimer();
  }

  instaPrev(): void {
    this.advanceInstagram(-1);
    this.startInstagramTimer();
  }

  heroPosition = 0;
  heroAnimating = true;
  get currentSlide(): number {
    return this.posters.length ? this.heroPosition % this.posters.length : 0;
  }
  private heroTimer?: ReturnType<typeof setInterval>;
  private instagramTimer?: ReturnType<typeof setInterval>;
  private testimonialTimer?: ReturnType<typeof setInterval>;
  private testimonialIndex = 0;
  @ViewChild('testimonialTrack') testimonialTrack?: ElementRef<HTMLElement>;

  marquee = [
    'NEW DROP — MONK HEAVY HOODIE',
    'FREE SHIPPING OVER ₹2999',
    'HEAVYWEIGHT 240 GSM TEES',
    'LIMITED RUNS — NEVER RESTOCKED'
  ];

  perks = [
    { icon: '🚚', title: 'Free Shipping', text: 'Free Shipping \n on any orders all across India. ' },
    { icon: '↩️', title: 'Easy Returns', text: '\nEasy returns within 7 days of delivery.' },
    { icon: '🧵', title: 'Heavyweight Fabric', text: 'Premium Fabrics \nCrafted with quality fabrics for lasting comfort.' },
    { icon: '🔒', title: 'Secure Checkout', text: 'Secure Checkout \nSafe and encrypted online payments.' }
  ];

  testimonials = [
    {
      quote: 'I wanted to create pieces I’d genuinely want in my own wardrobe.',
      name: '',
      role: ''
    },
    {
      quote: 'The first collection is personal. Every piece represents what I wanted this brand to become.',
      name: '',
      role: ''
    },
    {
      quote: 'I’ve spent months imagining, refining and building this. Now it’s almost yours.',
      name: '',
      role: ''
    }
  ];

  constructor(
    private productService: ProductService,
    private categoryService: CategoryService,
    @Optional() private productScroll?: ProductScrollRestorationService
  ) {}

  ngOnInit(): void {
    this.productService.getProducts({ featured: true }).subscribe({
      next: (products) => {
        this.featured = products.slice(0, 4);
        this.loading = false;
        this.productScroll?.restoreAfterProductsRender();
      },
      error: () => (this.loading = false)
    });

    this.productService.getProducts().subscribe({
      next: (products) => {
        this.newArrivals = products.slice(0, 8);
        this.productScroll?.restoreAfterProductsRender();
      }
    });

    this.categoryService.getCategories().subscribe({
      next: (cats) => (this.categories = cats)
    });

    this.startHeroTimer();

    this.startInstagramTimer();
  }

  ngAfterViewInit(): void {
    this.startTestimonialTimer();
  }

  selectSlide(index: number): void {
    if (index < 0 || index >= this.posters.length) return;
    this.heroAnimating = true;
    this.heroPosition = index;
    this.startHeroTimer();
  }

  onHeroTransitionEnd(event: TransitionEvent): void {
    if (event.propertyName !== 'transform' || this.heroPosition !== this.posters.length) return;
    this.heroAnimating = false;
    this.heroPosition = 0;
  }

  private startHeroTimer(): void {
    if (this.heroTimer) clearInterval(this.heroTimer);
    this.heroTimer = undefined;
    if (this.posters.length < 2) return;
    this.heroTimer = setInterval(() => {
      this.heroAnimating = true;
      this.heroPosition = (this.heroPosition + 1) % this.heroSlides.length;
    }, 2000);
  }

  trackProduct(_index: number, product: Product): string {
    return product.id;
  }

  private advanceInstagram(direction: 1 | -1): void {
    const maxOffset = Math.max(0, this.instaFeed.length - this.instaVisible);
    if (direction === 1) {
      this.instaOffset = this.instaOffset >= maxOffset ? 0 : this.instaOffset + 1;
    } else {
      this.instaOffset = this.instaOffset <= 0 ? maxOffset : this.instaOffset - 1;
    }
  }

  private startInstagramTimer(): void {
    if (this.instagramTimer) {
      clearInterval(this.instagramTimer);
    }
    this.instagramTimer = setInterval(() => this.advanceInstagram(1), 2000);
  }

  restartTestimonialTimer(): void {
    this.startTestimonialTimer();
  }

  private startTestimonialTimer(): void {
    if (this.testimonialTimer) clearInterval(this.testimonialTimer);
    this.testimonialTimer = undefined;
    if (this.testimonials.length < 2) return;
    this.testimonialTimer = setInterval(() => this.advanceTestimonial(), 2000);
  }

  private advanceTestimonial(): void {
    if (typeof window.matchMedia !== 'function' || !window.matchMedia('(max-width: 1023px)').matches) return;
    const track = this.testimonialTrack?.nativeElement;
    const cards = track ? Array.from(track.querySelectorAll<HTMLElement>('.mh-testimonial')) : [];
    if (!track || cards.length < 2) return;
    this.testimonialIndex = (this.testimonialIndex + 1) % cards.length;
    const target = this.testimonialIndex === 0 ? 0 : cards[this.testimonialIndex].offsetLeft - track.offsetLeft;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollTo({ left: Math.max(0, target), behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  ngOnDestroy(): void {
    if (this.heroTimer) {
      clearInterval(this.heroTimer);
    }
    if (this.instagramTimer) {
      clearInterval(this.instagramTimer);
    }
    if (this.testimonialTimer) {
      clearInterval(this.testimonialTimer);
    }
  }
}
