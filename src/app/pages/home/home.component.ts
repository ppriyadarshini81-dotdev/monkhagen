import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Product } from '../../models/product.model';
import { Category } from '../../models/category.model';
import { ProductService } from '../../services/product.service';
import { CategoryService } from '../../services/category.service';
import { ProductCardComponent } from '../../components/product-card/product-card.component';

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

  // Rotating hero videos (muted, autoplay, looped one at a time).
  videos = [
    'https://cdn.coverr.co/videos/coverr-a-woman-in-a-fashion-store-1573/1080p.mp4',
    'https://cdn.coverr.co/videos/coverr-walking-on-the-street-9438/1080p.mp4',
    'https://cdn.coverr.co/videos/coverr-a-man-in-a-denim-jacket-2999/1080p.mp4'
  ];
  posters = [
    'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1600&q=80',
    'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1600&q=80',
    'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1600&q=80'
  ];
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
      quote: 'The hoodie is genuinely the heaviest, best-made piece I own. Worth every rupee.',
      name: 'Aarav K.',
      role: 'Verified Buyer'
    },
    {
      quote: 'Fit is perfect and the fabric just doesn\'t quit. Already on my third order.',
      name: 'Meera S.',
      role: 'Verified Buyer'
    },
    {
      quote: 'Limited drops mean nobody else has what I\'m wearing. That\'s the whole point.',
      name: 'Dev R.',
      role: 'Verified Buyer'
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
    }, 8000);
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
