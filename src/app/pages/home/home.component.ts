import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Product } from '../../models/product.model';
import { Category } from '../../models/category.model';
import { ProductService } from '../../services/product.service';
import { CategoryService } from '../../services/category.service';
import { ProductCardComponent } from '../../components/product-card/product-card.component';
import { MEDIA } from '../../config/media-assets';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ProductCardComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent implements OnInit, OnDestroy {
  featured: Product[] = [];
  newArrivals: Product[] = [];
  categories: Category[] = [];
  loading = true;

  readonly videos  = MEDIA.hero.videos;
  readonly posters = MEDIA.hero.posters;
  readonly media   = MEDIA;

  // CSS background strings built once from central config
  readonly editorialBg = `linear-gradient(to right, rgba(11,11,12,0.92), rgba(11,11,12,0.35)), url(${MEDIA.home.editorialBg}) center/cover`;

  readonly instaFeed  = MEDIA.instagram.posts;
  readonly instaUrl   = MEDIA.instagram.profileUrl;
  instaOffset = 0;
  readonly instaVisible = 5;

  get instaSlice() {
    return this.instaFeed.slice(this.instaOffset, this.instaOffset + this.instaVisible);
  }
  instaNext() { if (this.instaOffset + this.instaVisible < this.instaFeed.length) this.instaOffset++; }
  instaPrev() { if (this.instaOffset > 0) this.instaOffset--; }

  currentVideo = 0;
  private timer?: ReturnType<typeof setInterval>;

  marquee = [
    'NEW DROP — MONK HEAVY HOODIE',
    'FREE SHIPPING OVER ₹2999',
    'HEAVYWEIGHT 240 GSM TEES',
    'LIMITED RUNS — NEVER RESTOCKED'
  ];

  perks = [
    { icon: '🚚', title: 'Free Shipping', text: 'On all orders over ₹2999, across India.' },
    { icon: '↩️', title: 'Easy Returns', text: '7-day no-questions returns on every piece.' },
    { icon: '🧵', title: 'Heavyweight Fabric', text: '240–400 GSM premium cottons & fleece.' },
    { icon: '🔒', title: 'Secure Checkout', text: 'Encrypted payments and data protection.' }
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
    private categoryService: CategoryService
  ) {}

  ngOnInit(): void {
    this.productService.getProducts({ featured: true }).subscribe({
      next: (products) => {
        this.featured = products.slice(0, 4);
        this.loading = false;
      },
      error: () => (this.loading = false)
    });

    this.productService.getProducts().subscribe({
      next: (products) => {
        this.newArrivals = products.slice(0, 8);
      }
    });

    this.categoryService.getCategories().subscribe({
      next: (cats) => (this.categories = cats)
    });

    this.timer = setInterval(() => {
      this.currentVideo = (this.currentVideo + 1) % this.videos.length;
    }, 6000);
  }

  selectVideo(index: number): void {
    this.currentVideo = index;
  }

  ngOnDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
