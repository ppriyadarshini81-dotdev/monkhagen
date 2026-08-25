import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Product } from '../../models/product.model';
import { Category } from '../../models/category.model';
import { ProductService } from '../../services/product.service';
import { CategoryService } from '../../services/category.service';
import { OrderService, Order } from '../../services/order.service';
import { UploadService } from '../../services/upload.service';
import { AuthService } from '../../services/auth.service';

interface ProductForm {
  id?: string;
  name: string;
  price: number | null;
  category: string;
  description: string;
  sizes: string;
  colors: string;
  images: string;
  stock: number | null;
  badge: string;
  featured: boolean;
}

interface CategoryForm {
  id?: string;
  name: string;
  image: string;
  description: string;
}

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.css'
})
export class AdminComponent implements OnInit {
  tab: 'products' | 'categories' | 'orders' = 'products';
  products: Product[] = [];
  categories: Category[] = [];
  orders: Order[] = [];
  message = '';
  error = '';

  showForm = false;
  editing = false;
  uploading = false;
  form: ProductForm = this.emptyForm();

  showCatForm = false;
  editingCat = false;
  uploadingCat = false;
  catForm: CategoryForm = this.emptyCatForm();

  constructor(
    private productService: ProductService,
    private categoryService: CategoryService,
    private orderService: OrderService,
    private uploadService: UploadService,
    public auth: AuthService
  ) {}

  ngOnInit(): void {
    this.loadProducts();
    this.loadCategories();
    this.loadOrders();
  }

  emptyForm(): ProductForm {
    return {
      name: '',
      price: null,
      category: '',
      description: '',
      sizes: '',
      colors: '',
      images: '',
      stock: null,
      badge: '',
      featured: false
    };
  }

  loadProducts(): void {
    this.productService.getProducts().subscribe((p) => (this.products = p));
  }

  loadCategories(): void {
    this.categoryService.getCategories().subscribe((c) => (this.categories = c));
  }

  loadOrders(): void {
    this.orderService.allOrders().subscribe({
      next: (o) => (this.orders = o),
      error: () => {}
    });
  }

  newProduct(): void {
    this.editing = false;
    this.form = this.emptyForm();
    this.showForm = true;
    this.message = '';
    this.error = '';
  }

  editProduct(p: Product): void {
    this.editing = true;
    this.form = {
      id: p.id,
      name: p.name,
      price: p.price,
      category: p.category,
      description: p.description,
      sizes: p.sizes.join(', '),
      colors: p.colors.join(', '),
      images: p.images.join(', '),
      stock: p.stock,
      badge: p.badge || '',
      featured: p.featured
    };
    this.showForm = true;
    this.message = '';
    this.error = '';
  }

  onImagesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }
    this.uploading = true;
    this.error = '';
    this.uploadService.uploadImages(input.files).subscribe({
      next: ({ urls }) => {
        const existing = this.form.images
          ? this.form.images.split(',').map((s) => s.trim()).filter(Boolean)
          : [];
        this.form.images = [...existing, ...urls].join(', ');
        this.uploading = false;
        input.value = '';
      },
      error: (err) => {
        this.error = err?.error?.message || 'Image upload failed.';
        this.uploading = false;
      }
    });
  }

  cancel(): void {
    this.showForm = false;
  }

  private toPayload(): Partial<Product> {
    const split = (s: string) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    return {
      name: this.form.name,
      price: Number(this.form.price),
      category: this.form.category,
      description: this.form.description,
      sizes: split(this.form.sizes),
      colors: split(this.form.colors),
      images: split(this.form.images),
      stock: Number(this.form.stock) || 0,
      badge: this.form.badge,
      featured: this.form.featured
    };
  }

  save(): void {
    this.error = '';
    if (!this.form.name || this.form.price == null || !this.form.category) {
      this.error = 'Name, price and category are required.';
      return;
    }
    const payload = this.toPayload();
    const handler = {
      next: () => {
        this.message = this.editing ? 'Product updated.' : 'Product created.';
        this.showForm = false;
        this.loadProducts();
      },
      error: (err: any) => {
        this.error = err?.error?.message || 'Could not save product.';
      }
    };
    if (this.editing && this.form.id) {
      this.productService.updateProduct(this.form.id, payload).subscribe(handler);
    } else {
      this.productService.createProduct(payload).subscribe(handler);
    }
  }

  remove(p: Product): void {
    if (!confirm(`Delete "${p.name}"?`)) {
      return;
    }
    this.productService.deleteProduct(p.id).subscribe(() => {
      this.message = 'Product deleted.';
      this.loadProducts();
    });
  }

  // ---- Categories ----
  emptyCatForm(): CategoryForm {
    return { name: '', image: '', description: '' };
  }

  newCategory(): void {
    this.editingCat = false;
    this.catForm = this.emptyCatForm();
    this.showCatForm = true;
    this.message = '';
    this.error = '';
  }

  editCategory(c: Category): void {
    this.editingCat = true;
    this.catForm = {
      id: c.id,
      name: c.name,
      image: c.image || '',
      description: c.description || ''
    };
    this.showCatForm = true;
    this.message = '';
    this.error = '';
  }

  cancelCat(): void {
    this.showCatForm = false;
  }

  onCatImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }
    this.uploadingCat = true;
    this.error = '';
    this.uploadService.uploadImages(input.files).subscribe({
      next: ({ urls }) => {
        if (urls.length) {
          this.catForm.image = urls[0];
        }
        this.uploadingCat = false;
        input.value = '';
      },
      error: (err) => {
        this.error = err?.error?.message || 'Image upload failed.';
        this.uploadingCat = false;
      }
    });
  }

  saveCategory(): void {
    this.error = '';
    if (!this.catForm.name) {
      this.error = 'Category name is required.';
      return;
    }
    const payload: Partial<Category> = {
      name: this.catForm.name,
      image: this.catForm.image,
      description: this.catForm.description
    };
    const handler = {
      next: () => {
        this.message = this.editingCat ? 'Category updated.' : 'Category created.';
        this.showCatForm = false;
        this.loadCategories();
      },
      error: (err: any) => {
        this.error = err?.error?.message || 'Could not save category.';
      }
    };
    if (this.editingCat && this.catForm.id) {
      this.categoryService.updateCategory(this.catForm.id, payload).subscribe(handler);
    } else {
      this.categoryService.createCategory(payload).subscribe(handler);
    }
  }

  removeCategory(c: Category): void {
    if (!confirm(`Delete category "${c.name}"?`)) {
      return;
    }
    this.categoryService.deleteCategory(c.id).subscribe({
      next: () => {
        this.message = 'Category deleted.';
        this.loadCategories();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not delete category.';
      }
    });
  }
}
