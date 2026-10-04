import { CommonModule } from '@angular/common';
import { Component, OnInit, Optional } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Product } from '../../models/product.model';
import { Category } from '../../models/category.model';
import { ProductService } from '../../services/product.service';
import { CategoryService } from '../../services/category.service';
import { ProductCardComponent } from '../../components/product-card/product-card.component';
import { cachedMediaUrl } from '../../utils/media-url';
import { ProductScrollRestorationService } from '../../services/product-scroll-restoration.service';

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [CommonModule, FormsModule, ProductCardComponent],
  templateUrl: './products.component.html',
  styleUrl: './products.component.css'
})
export class ProductsComponent implements OnInit {
  products: Product[] = [];
  categories: Category[] = [];
  categoryNames: string[] = ['All'];
  activeCategory = 'All';
  search = '';
  sort = 'featured';
  loading = true;
  readonly cachedMediaUrl = cachedMediaUrl;

  constructor(
    private productService: ProductService,
    private categoryService: CategoryService,
    @Optional() private productScroll?: ProductScrollRestorationService
  ) {}

  ngOnInit(): void {
    this.categoryService.getCategories().subscribe({
      next: (cats) => {
        this.categories = cats;
        this.categoryNames = ['All', ...cats.map((c) => c.name)];
      },
      error: () => {
        // Fall back to distinct names from products if the categories API fails.
        this.productService.getCategories().subscribe((names) => {
          this.categoryNames = ['All', ...names];
        });
      }
    });
    this.load();
  }

  load(): void {
    this.loading = true;
    this.productService
      .getProducts({ category: this.activeCategory, search: this.search })
      .subscribe({
        next: (products) => {
          this.products = this.applySort(products);
          this.loading = false;
          this.productScroll?.restoreAfterProductsRender();
        },
        error: () => (this.loading = false)
      });
  }

  applySort(list: Product[]): Product[] {
    const sorted = [...list];
    switch (this.sort) {
      case 'price-asc':
        return sorted.sort((a, b) => a.price - b.price);
      case 'price-desc':
        return sorted.sort((a, b) => b.price - a.price);
      case 'rating':
        return sorted.sort((a, b) => b.rating - a.rating);
      default:
        return sorted.sort((a, b) => Number(b.featured) - Number(a.featured));
    }
  }

  setCategory(cat: string): void {
    this.activeCategory = cat;
    this.load();
  }

  onSortChange(): void {
    this.products = this.applySort(this.products);
  }
}
