export interface Address {
  id: string;
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  addressType: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AddressPayload {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  landmark?: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
  addressType?: string;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  sku: string | null;
  size: string | null;
  color: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  imageUrl: string | null;
}

export interface OrderAddress {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  subtotal: number;
  discountAmount: number;
  shippingAmount: number;
  totalAmount: number;
  items: OrderItem[];
  address: OrderAddress | null;
  awbNumber: string | null;
  courierName: string | null;
  trackingUrl: string | null;
  shippingStatus: string;
  trackingStatus: string | null;
  pickupStatus: string | null;
  estimatedDelivery: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TrackingInfo {
  orderId: string;
  available: boolean;
  awbCode: string | null;
  courierName: string | null;
  shippingStatus: string;
  trackingStatus: string | null;
  trackingUrl: string | null;
  estimatedDelivery: string | null;
  pickupStatus: string | null;
  events: {
    date: string | null;
    status: string | null;
    activity: string | null;
    location: string | null;
  }[];
  lastCheckedAt: string | null;
}

export interface ReturnItem {
  id: string;
  orderItemId: string;
  quantity: number;
  reason: string | null;
}

export interface ReturnRequest {
  id: string;
  orderId: string;
  returnNumber: string;
  reason: string;
  comments: string | null;
  status: string;
  refundAmount: number;
  refundStatus: string;
  items: ReturnItem[];
  requestedAt: string;
  approvedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ReturnPayload {
  orderId: string;
  reason: string;
  comments?: string;
  items: { orderItemId: string; quantity: number; reason?: string }[];
}

export interface CreditTransaction {
  id: string;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  reason: string;
  referenceType: string | null;
  referenceId: string | null;
  expiresAt: string | null;
  createdAt: string;
}
