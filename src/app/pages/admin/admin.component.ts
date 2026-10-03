import { CommonModule } from '@angular/common';
import { Component, DoCheck, ElementRef, HostListener, OnInit, Optional, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Product } from '../../models/product.model';
import { Category } from '../../models/category.model';
import { Badge } from '../../models/badge.model';
import { VariantOption } from '../../models/variant-option.model';
import { ProductService, ProductWrite } from '../../services/product.service';
import { CategoryService } from '../../services/category.service';
import { BadgeService } from '../../services/badge.service';
import { VariantOptionService } from '../../services/variant-option.service';
import { AdminReturn, CodRefundReveal, OrderService, Order } from '../../services/order.service';
import { UploadService } from '../../services/upload.service';
import { AuthService } from '../../services/auth.service';
import { ShippingService } from '../../services/shipping.service';
import { saveInvoice } from '../../utils/invoice-download';
import { ProductPageContentEditorComponent } from '../../components/product-page-content-editor/product-page-content-editor.component';
import { ReviewService } from '../../services/review.service';
import { AdminReview } from '../../models/review.model';
import { fieldsFromImagePairs, imagePairsFromFields, moveImagePair, ProductImagePair, removeImagePair } from '../../utils/product-image-pairs';
import { sortSizes } from '../../utils/size-order';

interface SizeStockForm { stock: number | null; threshold: number | null; configured: boolean; }

interface ProductForm {
  id?: string;
  name: string;
  price: number | null;
  categoryId: string;
  description: string;
  sizeIds: string[];
  colorIds: string[];
  images: string;
  zoomImages: string;
  sizeInventory: Record<string, SizeStockForm>;
  inventoryReason: string;
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
  imports: [CommonModule, FormsModule, ProductPageContentEditorComponent],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.css'
})
export class AdminComponent implements OnInit, DoCheck {
  @ViewChild('orderDialog') orderDialog?: ElementRef<HTMLDialogElement>;
  tab: 'products' | 'categories' | 'badges' | 'sizes' | 'colors' | 'orders' | 'returns' | 'reviews' | 'content' = 'products';
  products: Product[] = [];
  categories: Category[] = [];
  badges: Badge[] = [];
  sizes: VariantOption[] = [];
  colors: VariantOption[] = [];
  orders: Order[] = [];
  returns: AdminReturn[] = [];
  returnsLoading = false;
  returnBusyId = '';
  codRefundReturn?: AdminReturn;
  codRefundReveal?: CodRefundReveal;
  codRefundReference = '';
  codRefundNote = '';
  codRefundError = '';
  customerReviews: AdminReview[] = [];
  reviewsLoading = false;
  reviewBusyId = '';
  reviewSearch = '';
  reviewRatingFilter: number | null = null;
  reviewStatusFilter = '';
  ordersLoading = false;
  ordersError = '';
  shippingBusyOrderId = '';
  invoiceBusyOrderId = '';
  invoiceError = '';
  selectedOrder: Order | null = null;
  orderSearch = '';
  orderFilter = 'all';
  message = '';
  error = '';

  showForm = false;
  editing = false;
  uploading = false;
  uploadingZoomIndex: number | null = null;
  draggedImageIndex: number | null = null;
  imagePairs: ProductImagePair[] = [];
  private lastDisplayImageUrls = '';
  private lastZoomImageUrls = '';
  private requestedOrderId = '';
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
    private shippingService: ShippingService,
    private reviewService: ReviewService,
    public auth: AuthService,
    @Optional() private route?: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.requestedOrderId = this.route?.snapshot.queryParamMap.get('order') || '';
    this.loadProducts();
    this.loadCategories();
    this.loadBadges();
    this.loadOptions('sizes');
    this.loadOptions('colors');
    this.loadOrders();
    this.loadReturns();
    this.loadCustomerReviews();
  }

  ngDoCheck(): void {
    if (this.form.images === this.lastDisplayImageUrls && this.form.zoomImages === this.lastZoomImageUrls) return;
    this.imagePairs = imagePairsFromFields(this.form.images, this.form.zoomImages);
    this.lastDisplayImageUrls = this.form.images;
    this.lastZoomImageUrls = this.form.zoomImages;
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
      zoomImages: '',
      sizeInventory: {},
      inventoryReason: '',
      badgeId: '',
      featured: false
    };
  }

  loadProducts(): void {
    this.productService.getAdminProducts().subscribe((p) => (this.products = p));
  }

  loadCategories(): void {
    this.categoryService.getAdminCategories().subscribe((c) => (this.categories = c));
  }

  loadBadges(): void {
    this.badgeService.getAdminBadges().subscribe((badges) => (this.badges = badges));
  }

  loadOptions(type: OptionType): void {
    this.variantOptionService.getAdminOptions(type).subscribe((options) => {
      if (type === 'sizes') {
        const order = sortSizes(options.map(option => option.name));
        this.sizes = [...options].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
      }
      else this.colors = options;
    });
  }

  loadOrders(): void {
    if (this.ordersLoading) return;
    this.ordersLoading = true;
    this.ordersError = '';
    this.orderService.allOrders().subscribe({
      next: (o) => {
        this.orders = o;
        if (this.selectedOrder) {
          this.selectedOrder = o.find((order) => order.id === this.selectedOrder?.id) || null;
        }
        if (this.requestedOrderId) {
          const requested = o.find(order => order.id === this.requestedOrderId);
          if (requested) {
            this.tab = 'orders';
            this.openOrder(requested);
            this.requestedOrderId = '';
          }
        }
        this.ordersLoading = false;
      },
      error: () => {
        this.ordersError = 'Could not refresh orders. Please try again.';
        this.ordersLoading = false;
      }
    });
  }

  loadReturns(): void {
    if (this.returnsLoading) return;
    this.returnsLoading = true;
    this.orderService.adminReturns().subscribe({
      next: returns => { this.returns = returns; this.returnsLoading = false; },
      error: () => { this.error = 'Could not load returns.'; this.returnsLoading = false; }
    });
  }

  loadCustomerReviews(): void {
    if (this.reviewsLoading) return;
    this.reviewsLoading = true;
    this.reviewService.adminList({
      search: this.reviewSearch.trim(), rating: this.reviewRatingFilter, status: this.reviewStatusFilter
    }).subscribe({
      next: result => { this.customerReviews = result.reviews; this.reviewsLoading = false; },
      error: () => { this.error = 'Could not load customer reviews.'; this.reviewsLoading = false; }
    });
  }

  moderateReview(review: AdminReview): void {
    if (this.reviewBusyId) return;
    const status = review.moderationStatus === 'approved' ? 'hidden' : 'approved';
    this.reviewBusyId = review.id;
    this.reviewService.moderate(review.id, status).subscribe({
      next: () => { this.reviewBusyId = ''; this.message = status === 'hidden' ? 'Review hidden.' : 'Review restored.'; this.loadCustomerReviews(); },
      error: error => { this.reviewBusyId = ''; this.error = error?.error?.message || 'Review moderation failed.'; }
    });
  }

  actOnReturn(item: AdminReturn, action: 'approve' | 'reject' | 'refund' | 'retry'): void {
    if (this.returnBusyId) return;
    if (action === 'reject') {
      const prompt = item.status === 'received'
        ? 'Reject this return after inspection? The customer will not be refunded and inventory will not be restored.'
        : item.shiprocketReturnOrderId
          ? 'Cancel this return in Shiprocket? Monk Hagen will close it only after Shiprocket accepts the cancellation.'
          : 'Reject this local request? Confirm first that no matching return exists in Shiprocket.';
      if (!window.confirm(prompt)) return;
    }
    this.returnBusyId = item.id;
    this.error = '';
    const request = action === 'approve' ? this.orderService.approveReturn(item.id)
      : action === 'reject' ? this.orderService.rejectReturn(item.id, !item.shiprocketReturnOrderId)
      : action === 'refund' ? this.orderService.refundReturn(item.id)
      : this.orderService.retryReturnCreation(item.id);
    request.subscribe({
      next: () => { this.returnBusyId = ''; this.message = `Return ${action} completed.`; this.loadReturns(); },
      error: error => { this.returnBusyId = ''; this.error = error?.error?.message || `Could not ${action} this return.`; this.loadReturns(); }
    });
  }

  canApproveReturn(item: AdminReturn): boolean { return item.status === 'received'; }
  canRefundReturn(item: AdminReturn): boolean {
    return item.paymentMethod !== 'cod' && item.status === 'approved' && item.refundStatus === 'pending';
  }
  canStartCodRefund(item: AdminReturn): boolean {
    return item.paymentMethod === 'cod' && item.refundDestination.provided &&
      ['PROVIDED', 'FAILED'].includes(item.refundDestination.status || '');
  }
  canRevealCodRefund(item: AdminReturn): boolean {
    return item.paymentMethod === 'cod' && item.refundDestination.provided && item.refundDestination.status !== 'REDACTED';
  }
  revealCodRefund(item: AdminReturn): void {
    if (this.returnBusyId) return;
    this.returnBusyId = item.id; this.codRefundError = '';
    this.orderService.revealCodRefund(item.id).subscribe({
      next: detail => { this.returnBusyId = ''; this.codRefundReturn = item; this.codRefundReveal = detail;
        this.codRefundReference = ''; this.codRefundNote = ''; },
      error: error => { this.returnBusyId = ''; this.error = error?.error?.message || 'Refund details could not be revealed.'; }
    });
  }
  closeCodRefund(): void {
    this.codRefundReturn = undefined; this.codRefundReveal = undefined; this.codRefundReference = '';
    this.codRefundNote = ''; this.codRefundError = '';
  }
  startCodRefund(item: AdminReturn): void {
    if (this.returnBusyId) return;
    if (!window.confirm(item.refundDestination.status === 'FAILED'
      ? 'Retry this COD refund transfer? The existing pending ledger entry will be reused.'
      : 'Start processing this COD refund? The customer will no longer be able to edit the destination.')) return;
    this.returnBusyId = item.id;
    this.orderService.startCodRefund(item.id).subscribe({ next: updated => { this.returnBusyId = ''; Object.assign(item, updated); this.loadReturns(); },
      error: error => { this.returnBusyId = ''; this.error = error?.error?.message || 'COD refund could not be started.'; } });
  }
  completeCodRefund(): void {
    const item = this.codRefundReturn; if (!item || this.returnBusyId) return;
    this.codRefundError = ''; this.returnBusyId = item.id;
    this.orderService.completeCodRefund(item.id, this.codRefundReference.trim(), this.codRefundNote.trim()).subscribe({
      next: () => { this.returnBusyId = ''; this.closeCodRefund(); this.message = 'COD refund completed.'; this.loadReturns(); },
      error: error => { this.returnBusyId = ''; this.codRefundError = error?.error?.message || 'COD refund could not be completed.'; }
    });
  }
  failCodRefund(): void {
    const item = this.codRefundReturn; if (!item || this.returnBusyId) return;
    this.codRefundError = ''; this.returnBusyId = item.id;
    this.orderService.failCodRefund(item.id, this.codRefundNote.trim()).subscribe({
      next: () => { this.returnBusyId = ''; this.closeCodRefund(); this.message = 'COD refund marked failed and remains retryable.'; this.loadReturns(); },
      error: error => { this.returnBusyId = ''; this.codRefundError = error?.error?.message || 'COD refund failure could not be recorded.'; }
    });
  }
  returnRejectLabel(item: AdminReturn): string | null {
    if (item.cancellationPending) return null;
    if (['requested','shiprocket_failed'].includes(item.status)) return 'Reject request';
    if (['return_created','pickup_scheduled','pickup_failed'].includes(item.status)) return 'Cancel return';
    if (item.status === 'received') return 'Reject after inspection';
    return null;
  }

  get visibleOrders(): Order[] {
    const query = this.orderSearch.trim().toLowerCase();
    return this.orders.filter((order) => {
      const hasShipmentIssue = Boolean(order.shipment?.lastErrorCode);
      const matchesFilter = this.orderFilter === 'all' ||
        (this.orderFilter === 'attention' && hasShipmentIssue) ||
        (this.orderFilter === 'unfulfilled' && order.paymentStatus === 'paid' && !order.shipment?.awbCode) ||
        (this.orderFilter === 'shipped' && Boolean(order.shipment?.awbCode));
      if (!matchesFilter) return false;
      if (!query) return true;
      const searchable = [
        order.orderNumber,
        order.id,
        order.address?.fullName,
        order.address?.phone,
        order.address?.city,
        ...order.items.map((item) => item.productName)
      ].filter(Boolean).join(' ').toLowerCase();
      return searchable.includes(query);
    });
  }

  orderReference(order: Order): string {
    const reference = order.orderNumber || order.id.slice(0, 8).toUpperCase();
    return reference.startsWith('#') ? reference : `#${reference}`;
  }

  orderItemCount(order: Order): number {
    return order.items.reduce((total, item) => total + item.quantity, 0);
  }

  orderItemSummary(order: Order): string {
    if (!order.items.length) return 'No items';
    const first = order.items[0].productName;
    return order.items.length > 1 ? `${first} +${order.items.length - 1} more` : first;
  }

  statusClass(status: string | null | undefined): string {
    const value = (status || '').toLowerCase();
    if (['paid', 'confirmed', 'awb_assigned', 'pickup_scheduled', 'shipped', 'delivered'].includes(value)) return 'is-success';
    if (['failed', 'cancelled', 'validation_failed', 'needs_review', 'needs_configuration'].includes(value)) return 'is-danger';
    if (['pending', 'placed', 'retry_pending', 'not_created'].includes(value)) return 'is-warning';
    return 'is-info';
  }

  openOrder(order: Order): void {
    this.selectedOrder = order;
    this.invoiceError = '';
    queueMicrotask(() => {
      const dialog = this.orderDialog?.nativeElement;
      if (dialog && !dialog.open) dialog.showModal();
    });
  }

  closeOrderDialog(): void {
    this.orderDialog?.nativeElement.close();
  }

  clearSelectedOrder(): void {
    this.selectedOrder = null;
  }

  statusLabel(status: string | null | undefined): string {
    const labels: Record<string, string> = {
      not_created: 'Not created', pending: 'Pending', created: 'Shipment Created',
      needs_configuration: 'Configuration Required', validation_failed: 'Failed',
      retry_pending: 'Retry Pending', needs_review: 'Review Required',
      awb_assigned: 'AWB Assigned', pickup_scheduled: 'Pickup Scheduled'
    };
    return status ? labels[status] || status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Unavailable';
  }

  shipmentError(order: Order): string {
    const code = order.shipment?.lastErrorCode;
    if (!code) return '';
    const messages: Record<string, string> = {
      SHIPPING_PACKAGE_NOT_CONFIGURED: 'Configure the pickup location and package measurements in the backend.',
      SHIPROCKET_NOT_CONFIGURED: 'Check the Shiprocket configuration in the backend.',
      SHIPROCKET_AUTH_FAILED: 'Shiprocket authentication failed. Check the backend credentials.',
      SHIPROCKET_PERMISSION_DENIED: 'Shiprocket accepted the login but denied shipment creation. Check the API user permissions and account status.',
      SHIPPING_VALIDATION: 'Check the saved address, order items and package details.',
      SHIPROCKET_TIMEOUT: 'Shiprocket did not respond in time.',
      SHIPROCKET_UNAVAILABLE: 'Shiprocket is temporarily unavailable.',
      SHIPPING_RECONCILIATION_REQUIRED: 'Check the order in Shiprocket before attempting another shipping operation.'
    };
    const message = messages[code] || 'The shipping operation could not be completed. Check the order in Shiprocket.';
    return order.shipment?.shippingStatus === 'needs_review'
      ? `${message} Review the order in Shiprocket before retrying to avoid duplicates.` : message;
  }

  canRetryShipment(order: Order): boolean {
    return order.paymentStatus === 'paid' &&
      !order.shipment?.shiprocketShipmentId;
  }

  retryShipment(order: Order): void {
    if (!this.canRetryShipment(order) || this.shippingBusyOrderId) return;
    this.shippingBusyOrderId = order.id;
    this.message = '';
    this.error = '';
    this.shippingService.createShipment(order.id).subscribe({
      next: () => {
        this.shippingBusyOrderId = '';
        this.message = 'Shipment created in Shiprocket.';
        this.loadOrders();
      },
      error: (err) => {
        this.shippingBusyOrderId = '';
        this.error = err?.error?.message || 'Could not create the Shiprocket shipment.';
        this.loadOrders();
      }
    });
  }

  downloadInvoice(order: Order): void {
    if (!order.shipment?.shiprocketOrderId || this.invoiceBusyOrderId) return;
    this.invoiceError = '';
    this.invoiceBusyOrderId = order.id;
    this.shippingService.getInvoice(order.id).subscribe({
      next: (response) => {
        this.invoiceBusyOrderId = '';
        try { saveInvoice(response, `${order.orderNumber || order.id}_Invoice.pdf`); }
        catch { this.invoiceError = 'Invoice is not available yet. Please try again later.'; }
      },
      error: () => {
        this.invoiceBusyOrderId = '';
        this.invoiceError = 'Invoice is not available yet. Please try again later.';
      }
    });
  }

  newProduct(): void {
    this.editing = false;
    this.form = this.emptyForm();
    this.imagePairs = [];
    this.showForm = true;
    this.message = '';
    this.error = '';
  }

  editProduct(p: Product): void {
    this.message = '';
    this.error = '';
    this.productService.getAdminProduct(p.id).subscribe({
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
          zoomImages: (product.zoomImages || []).map(url => url || '').join(', '),
          sizeInventory: Object.fromEntries((product.sizeInventory || []).map(item => [item.sizeId, {
            stock: item.stockQuantity, threshold: item.lowStockThresholdQuantity, configured: item.configured
          }])),
          inventoryReason: '',
          badgeId: product.badgeId || '',
          featured: product.featured
        };
        this.imagePairs = imagePairsFromFields(this.form.images, this.form.zoomImages);
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
        this.setImagePairs([
          ...this.imagePairs,
          ...urls.map(imageUrl => ({ imageUrl, zoomImageUrl: null }))
        ]);
        this.uploading = false;
        input.value = '';
      },
      error: (err) => {
        this.error = err?.error?.message || 'Image upload failed.';
        this.uploading = false;
      }
    });
  }

  updateDisplayImageUrls(value: string): void {
    this.form.images = value;
    this.imagePairs = imagePairsFromFields(this.form.images, this.form.zoomImages);
  }

  updateZoomImageUrls(value: string): void {
    this.form.zoomImages = value;
    this.imagePairs = imagePairsFromFields(this.form.images, this.form.zoomImages);
  }

  private setImagePairs(pairs: ProductImagePair[]): void {
    this.imagePairs = pairs;
    const fields = fieldsFromImagePairs(pairs);
    this.form.images = fields.images;
    this.form.zoomImages = fields.zoomImages;
    this.lastDisplayImageUrls = fields.images;
    this.lastZoomImageUrls = fields.zoomImages;
  }

  startImageDrag(index: number, event: DragEvent): void {
    this.draggedImageIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    }
  }

  allowImageDrop(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  dropImage(index: number, event: DragEvent): void {
    event.preventDefault();
    if (this.draggedImageIndex === null) return;
    this.setImagePairs(moveImagePair(this.imagePairs, this.draggedImageIndex, index));
    this.draggedImageIndex = null;
  }

  moveImage(index: number, delta: -1 | 1): void {
    this.setImagePairs(moveImagePair(this.imagePairs, index, index + delta));
  }

  removeImage(index: number): void {
    this.setImagePairs(removeImagePair(this.imagePairs, index));
  }

  onZoomImageSelected(event: Event, index: number): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.uploadingZoomIndex !== null) return;
    this.uploadingZoomIndex = index;
    this.error = '';
    this.uploadService.uploadImages([file]).subscribe({
      next: ({ urls }) => {
        const pairs = this.imagePairs;
        if (pairs[index] && urls[0]) pairs[index] = { ...pairs[index], zoomImageUrl: urls[0] };
        this.setImagePairs(pairs);
        this.uploadingZoomIndex = null;
        input.value = '';
      },
      error: err => {
        this.error = err?.error?.message || 'Zoom image upload failed.';
        this.uploadingZoomIndex = null;
      }
    });
  }

  removeZoomImage(index: number): void {
    const pairs = this.imagePairs;
    if (!pairs[index]) return;
    pairs[index] = { ...pairs[index], zoomImageUrl: null };
    this.setImagePairs(pairs);
  }

  cancel(): void {
    this.showForm = false;
  }

  private toPayload(): ProductWrite {
    const pairs = this.imagePairs;
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
    return {
      name: this.form.name,
      basePrice: Number(this.form.price),
      categoryId: this.form.categoryId,
      badgeId: this.form.badgeId || null,
      description: this.form.description,
      images: pairs.map(pair => pair.imageUrl),
      zoomImages: pairs.map(pair => pair.zoomImageUrl),
      sizeIds: [...this.form.sizeIds],
      colorIds: [...this.form.colorIds],
      variants: variantSelections.map((variant) => ({
        ...variant,
        stock: 0
      })),
      sizeInventory: selectedSizes.map(size => ({
        sizeId: size.id,
        stockQuantity: Number(this.form.sizeInventory[size.id]?.stock),
        lowStockThresholdQuantity: Number(this.form.sizeInventory[size.id]?.threshold ?? 0)
      })),
      inventoryReason: this.form.inventoryReason.trim() || null,
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
    const invalidSize = this.form.sizeIds.find(id => {
      const item = this.form.sizeInventory[id];
      return !item || !Number.isSafeInteger(Number(item.stock)) || Number(item.stock) < 0 ||
        !Number.isSafeInteger(Number(item.threshold)) || Number(item.threshold) < 0;
    });
    if (invalidSize) {
      this.error = 'Enter a whole non-negative stock and low-stock threshold for every selected size.';
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
    if (checked && !selected.includes(id)) {
      selected.push(id);
      if (type === 'sizes' && !this.form.sizeInventory[id]) {
        this.form.sizeInventory[id] = { stock: 0, threshold: 0, configured: false };
      }
    }
    if (!checked) {
      const index = selected.indexOf(id);
      if (index >= 0) selected.splice(index, 1);
    }
  }

  get totalSizeStock(): number {
    return this.form.sizeIds.reduce((total, id) => total + (Number(this.form.sizeInventory[id]?.stock) || 0), 0);
  }

  sizeStock(id: string): SizeStockForm {
    return this.form.sizeInventory[id] ||= { stock: 0, threshold: 0, configured: false };
  }

  sizeStockStatus(id: string): string {
    if (!this.form.sizeIds.includes(id)) return 'Not offered';
    const item = this.sizeStock(id); const stock = Number(item.stock || 0); const threshold = Number(item.threshold || 0);
    if (stock === 0) return 'Out of stock';
    return stock <= threshold ? 'Low stock' : 'In stock';
  }

  updateOpeningStock(id: string): void {
    const item = this.sizeStock(id);
    if (!item.configured && Number(item.threshold || 0) === 0) {
      item.threshold = Math.ceil((Number(item.stock) || 0) * 0.1);
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
