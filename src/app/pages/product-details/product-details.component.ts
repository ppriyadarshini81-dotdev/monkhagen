import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Product } from '../../models/product.model';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';

@Component({
  selector: 'app-product-details',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './product-details.component.html',
  styleUrl: './product-details.component.css'
})
export class ProductDetailsComponent implements OnInit {
  product?: Product;
  loading = true;
  notFound = false;

  activeImage = 0;
  selectedSize: string | null = null;
  selectedColor: string | null = null;
  quantity = 1;
  added = false;

  constructor(
    private route: ActivatedRoute,
    private productService: ProductService,
    private cart: CartService
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug');
      if (!slug) {
        return;
      }
      this.loading = true;
      this.notFound = false;
      this.productService.getProduct(slug).subscribe({
        next: (product) => {
          this.product = product;
          this.selectedSize = product.sizes[0] ?? null;
          this.selectedColor = product.colors[0] ?? null;
          this.activeImage = 0;
          this.quantity = 1;
          this.loading = false;
        },
        error: () => {
          this.notFound = true;
          this.loading = false;
        }
      });
    });
  }

  changeQty(delta: number): void {
    this.quantity = Math.max(1, this.quantity + delta);
  }

  addToCart(): void {
    if (!this.product) {
      return;
    }
    this.cart.add(
      this.product,
      this.quantity,
      this.selectedSize,
      this.selectedColor
    );
    this.added = true;
    setTimeout(() => (this.added = false), 1800);
  }
}
