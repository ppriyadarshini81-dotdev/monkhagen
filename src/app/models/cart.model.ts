import { Product, ProductVariant } from './product.model';

export interface CartItem {
  id: string;
  cartId: string;
  productId: string;
  variantId: string;
  quantity: number;
  productName: string | null;
  productSlug: string | null;
  size: string | null;
  color: string | null;
  sku: string | null;
  price: number | null;
  imageUrl: string | null;
  stock: number | null;
}

export interface Cart {
  cartId: string;
  items: CartItem[];
  total: number;
  prepaidOffer: PrepaidOffer;
}

export interface PrepaidOffer {
  code: string;
  discountPercent: number;
  eligible: boolean;
  discountAmount: number;
  totalAmount: number;
}
