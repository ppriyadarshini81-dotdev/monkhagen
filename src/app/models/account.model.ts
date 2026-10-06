export interface Address {
  id: string;
  fullName: string;
  phone: string;
  email: string;
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
  email: string;
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
  invoiceAvailable: boolean;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
  cancellation?: { status: string; reason: string | null; cancelledAt: string | null; refundStatus: string } | null;
}
export interface CancellationEligibility {
  orderId: string;
  eligible: boolean;
  reason: string | null;
  message: string | null;
  cancellation: { status: string; reason: string | null; cancelledAt: string | null; refundStatus: string; refundId: string | null; shiprocketStatus: string } | null;
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

export interface IndiaLocations {
  country: 'India';
  attribution: string;
  states: Array<{ name: string; cities: string[] }>;
}

export interface PincodeLocation {
  postalCode: string;
  state: string;
  city: string;
}

export interface ReturnItem {
  id: string;
  orderItemId: string;
  productName: string;
  sku: string | null;
  size: string | null;
  color: string | null;
  quantity: number;
  reason: string | null;
  comments: string | null;
  refundAmount: number;
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
  paymentMethod: string;
  refundDestination: CodRefundDestination;
  returnAwb: string | null;
  pickupStatus: string | null;
  pickupDelayed: boolean;
  cancellationPending: boolean;
  items: ReturnItem[];
  requestedAt: string;
  receivedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  refundedAt: string | null;
  createdAt: string;
}

export interface CodRefundDestination {
  required: boolean;
  provided: boolean;
  method: 'UPI' | 'BANK' | null;
  masked: string | null;
  status: 'PROVIDED' | 'PROCESSING' | 'FAILED' | 'COMPLETED' | 'REDACTED' | null;
  canEdit: boolean;
  transactionReference: string | null;
  completedAt: string | null;
}

export type CodRefundDestinationPayload =
  | { method: 'UPI'; upiId: string; confirmUpiId: string }
  | { method: 'BANK'; accountHolderName: string; accountNumber: string; confirmAccountNumber: string; ifsc: string; bankName?: string };

export interface ReturnPayload {
  orderId: string;
  idempotencyKey: string;
  comments?: string;
  items: { orderItemId: string; quantity: number; reason: string; comments?: string }[];
}

export interface ReturnEligibility {
  orderId: string;
  eligible: boolean;
  reason: string | null;
  message: string | null;
  deliveredAt?: string;
  returnUntil: string | null;
  reasons: Array<{ code: string; label: string }>;
  items: Array<{
    orderItemId: string;
    productName: string;
    sku: string | null;
    size: string | null;
    color: string | null;
    purchasedQuantity: number;
    returnedQuantity: number;
    remainingQuantity: number;
  }>;
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
