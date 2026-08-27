import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Product } from '../../models/product.model';
import { Category } from '../../models/category.model';
import { Badge } from '../../models/badge.model';
import { VariantOption } from '../../models/variant-option.model';
import { ProductService, ProductWrite } from '../../services/product.service';
import { CategoryService } from '../../services/category.service';
import { BadgeService } from '../../services/badge.service';
import { VariantOptionService } from '../../services/variant-option.service';
import { OrderService, Order } from '../../services/order.service';
import { UploadService } from '../../services/upload.service';
import { AuthService } from '../../services/auth.service';

interface ProductForm {
  id?: string;
  name: string;
  price: number | null;
  categoryId: string;
  description: string;
  sizeIds: string[];
  colorIds: string[];
  images: string;
  stock: number | null;
  badgeId: string;
  featured: boolean;
}

interface CategoryForm {
  id?: string;
  name: string;
  image: string;
  description: string;
}

interface BadgeForm {
  id?: string;
  name: string;
}

type OptionType = 'sizes' | 'colors';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.css'
})
export class AdminComponent implements OnInit {
  tab: 'products' | 'categories' | 'badges' | 'sizes' | 'colors' | 'orders' = 'products';
  products: Product[] = [];
  categories: Category[] = [];
  badges: Badge[] = [];
  sizes: VariantOption[] = [];
  colors: VariantOption[] = [];
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

  showBadgeForm = false;
  editingBadge = false;
  badgeForm: BadgeForm = { name: '' };

  showOptionForm = false;
  editingOption = false;
  optionType: OptionType = 'sizes';
  optionForm: { id?: string; name: string } = { name: '' };

  constructor(
    private productService: ProductService,
    private categoryService: CategoryService,
    private badgeService: BadgeService,
    private variantOptionService: VariantOptionService,
    private orderService: OrderService,
    private uploadService: UploadService,
    public auth: AuthService
  ) {}

  ngOnInit(): void {
    this.loadProducts();
    this.loadCategories();
    this.loadBadges();
    this.loadOptions('sizes');
    this.loadOptions('colors');
    this.loadOrders();
  }

  emptyForm(): ProductForm {
    return {
      name: '',
      price: null,
      categoryId: '',
      description: '',
      sizeIds: [],
      colorIds: [],
      images: '',
      stock: null,
      badgeId: '',
      featured: false
    };
  }

  loadProducts(): void {
    this.productService.getProducts().subscribe((p) => (this.products = p));
  }

  loadCategories(): void {
    this.categoryService.getCategories().subscribe((c) => (this.categories = c));
  }

  loadBadges(): void {
    this.badgeService.getBadges().subscribe((badges) => (this.badges = badges));
  }

  loadOptions(type: OptionType): void {
    this.variantOptionService.getOptions(type).subscribe((options) => {
      if (type === 'sizes') this.sizes = options;
      else this.colors = options;
    });
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
    this.message = '';
    this.error = '';
    this.productService.getProduct(p.id).subscribe({
      next: (product) => {
        this.editing = true;
        this.form = {
          id: product.id,
          name: product.name,
          price: product.basePrice,
          categoryId: product.categoryId,
          description: product.description,
          sizeIds: product.sizeIds?.length ? product.sizeIds : [...new Set((product.variants || []).map((v) =>
            v.sizeId || this.sizes.find((size) => size.name === v.size)?.id || ''
          ).filter(Boolean))],
          colorIds: product.colorIds?.length ? product.colorIds : [...new Set((product.variants || []).map((v) =>
            v.colorId || this.colors.find((color) => color.name === v.color)?.id || ''
          ).filter(Boolean))],
          images: product.images.join(', '),
          stock: product.stock,
          badgeId: product.badgeId || '',
          featured: product.featured
        };
        this.showForm = true;
      },
      error: (err) => (this.error = err?.error?.message || 'Could not load product details.')
    });
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

  private toPayload(): ProductWrite {
    const split = (s: string) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    const selectedSizes = this.sizes.filter((size) => this.form.sizeIds.includes(size.id));
    const selectedColors = this.colors.filter((color) => this.form.colorIds.includes(color.id));
    const variantSelections = selectedSizes.flatMap((size) =>
      selectedColors.map((color) => ({
        size: size.name,
        color: color.name,
        sizeId: size.id,
        colorId: color.id
      }))
    );
    const totalStock = Math.max(0, Math.floor(Number(this.form.stock) || 0));
    const stockPerVariant = variantSelections.length ? Math.floor(totalStock / variantSelections.length) : 0;
    const stockRemainder = variantSelections.length ? totalStock % variantSelections.length : 0;
    return {
      name: this.form.name,
      basePrice: Number(this.form.price),
      categoryId: this.form.categoryId,
      badgeId: this.form.badgeId || null,
      description: this.form.description,
      images: split(this.form.images),
      sizeIds: [...this.form.sizeIds],
      colorIds: [...this.form.colorIds],
      variants: variantSelections.map((variant, index) => ({
        ...variant,
        stock: stockPerVariant + (index < stockRemainder ? 1 : 0)
      })),
      featured: this.form.featured
    };
  }

  save(): void {
    this.error = '';
    if (!this.form.name || this.form.price == null || !this.form.categoryId ||
        !this.form.sizeIds.length || !this.form.colorIds.length) {
      this.error = 'Name, price, category, at least one size and at least one color are required.';
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

  // ---- Badges ----
  newBadge(): void {
    this.editingBadge = false;
    this.badgeForm = { name: '' };
    this.showBadgeForm = true;
    this.message = '';
    this.error = '';
  }

  editBadge(badge: Badge): void {
    this.editingBadge = true;
    this.badgeForm = { id: badge.id, name: badge.name };
    this.showBadgeForm = true;
    this.message = '';
    this.error = '';
  }

  cancelBadge(): void {
    this.showBadgeForm = false;
  }

  saveBadge(): void {
    const name = this.badgeForm.name.trim();
    if (!name) {
      this.error = 'Badge name is required.';
      return;
    }
    const request = this.editingBadge && this.badgeForm.id
      ? this.badgeService.updateBadge(this.badgeForm.id, { name })
      : this.badgeService.createBadge({ name });
    request.subscribe({
      next: () => {
        this.message = this.editingBadge ? 'Badge updated.' : 'Badge created.';
        this.showBadgeForm = false;
        this.loadBadges();
        this.loadProducts();
      },
      error: (err) => (this.error = err?.error?.message || 'Could not save badge.')
    });
  }

  removeBadge(badge: Badge): void {
    if (!confirm(`Delete badge "${badge.name}"?`)) return;
    this.badgeService.deleteBadge(badge.id).subscribe({
      next: () => {
        this.message = 'Badge deleted.';
        this.loadBadges();
        this.loadProducts();
      },
      error: (err) => (this.error = err?.error?.message || 'Could not delete badge.')
    });
  }

  // ---- Sizes and colors ----
  newOption(type: OptionType): void {
    this.optionType = type;
    this.editingOption = false;
    this.optionForm = { name: '' };
    this.showOptionForm = true;
    this.message = '';
    this.error = '';
  }

  editOption(type: OptionType, option: VariantOption): void {
    this.optionType = type;
    this.editingOption = true;
    this.optionForm = { id: option.id, name: option.name };
    this.showOptionForm = true;
    this.message = '';
    this.error = '';
  }

  cancelOption(): void {
    this.showOptionForm = false;
  }

  saveOption(): void {
    const name = this.optionForm.name.trim();
    const label = this.optionType === 'sizes' ? 'Size' : 'Color';
    if (!name) {
      this.error = `${label} name is required.`;
      return;
    }
    const request = this.editingOption && this.optionForm.id
      ? this.variantOptionService.updateOption(this.optionType, this.optionForm.id, name)
      : this.variantOptionService.createOption(this.optionType, name);
    request.subscribe({
      next: () => {
        this.message = this.editingOption ? `${label} updated.` : `${label} created.`;
        this.showOptionForm = false;
        this.loadOptions(this.optionType);
        this.loadProducts();
      },
      error: (err) => (this.error = err?.error?.message || `Could not save ${label.toLowerCase()}.`)
    });
  }

  removeOption(type: OptionType, option: VariantOption): void {
    const label = type === 'sizes' ? 'size' : 'color';
    if (!confirm(`Delete ${label} "${option.name}"?`)) return;
    this.variantOptionService.deleteOption(type, option.id).subscribe({
      next: () => {
        this.message = `${label[0].toUpperCase()}${label.slice(1)} deleted.`;
        this.loadOptions(type);
      },
      error: (err) => (this.error = err?.error?.message || `Could not delete ${label}.`)
    });
  }

  optionSelected(type: OptionType, id: string): boolean {
    return (type === 'sizes' ? this.form.sizeIds : this.form.colorIds).includes(id);
  }

  toggleProductOption(type: OptionType, id: string, checked: boolean): void {
    const selected = type === 'sizes' ? this.form.sizeIds : this.form.colorIds;
    if (checked && !selected.includes(id)) selected.push(id);
    if (!checked) {
      const index = selected.indexOf(id);
      if (index >= 0) selected.splice(index, 1);
    }
  }

  selectedOptionLabel(type: OptionType): string {
    const options = type === 'sizes' ? this.sizes : this.colors;
    const selected = type === 'sizes' ? this.form.sizeIds : this.form.colorIds;
    const names = options.filter((option) => selected.includes(option.id)).map((option) => option.name);
    if (!names.length) return type === 'sizes' ? 'Select sizes' : 'Select colors';
    if (names.length <= 2) return names.join(', ');
    return `${names.length} selected`;
  }

  @HostListener('document:click', ['$event'])
  closeOtherOptionDropdowns(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const clickedDropdown = target.closest('.mh-checkdrop');
    document.querySelectorAll<HTMLDetailsElement>('.mh-checkdrop[open]').forEach((dropdown) => {
      if (dropdown !== clickedDropdown) dropdown.open = false;
    });
  }
}
