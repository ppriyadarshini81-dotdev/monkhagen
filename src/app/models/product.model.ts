export interface ProductVariant {
  id: string;
  size: string;
  color: string;
  sizeId: string | null;
  colorId: string | null;
  sku: string | null;
  price: number | null;
  stock: number;
  available?: boolean;
  lowStock?: boolean;
  isActive: boolean;
}

export interface ProductImage {
  id: string;
  url: string;
  zoomUrl: string | null;
  cloudinaryPublicId: string | null;
  displayOrder: number;
  isPrimary: boolean;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  // Backward-compat price (min variant price or base price)
  price: number;
  basePrice: number;
  category: string;
  categoryId: string;
  categorySlug: string | null;
  description: string;
  // Backward-compat flat arrays (derived from variants)
  sizes: string[];
  colors: string[];
  sizeIds: string[];
  colorIds: string[];
  images: string[];
  zoomImages?: Array<string | null>;
  imageObjects?: ProductImage[];
  variants?: ProductVariant[];
  sizeAvailability?: Array<{ size: string; sizeId: string; available: boolean; lowStock: boolean }>;
  sizeInventory?: Array<{ id: string; size: string; sizeId: string; stockQuantity: number;
    initialStockQuantity: number; lowStockThresholdQuantity: number; configured: boolean; active: boolean; updatedAt: string | null }>;
  inventorySetupRequired?: boolean;
  rating: number;
  stock: number;
  featured: boolean;
  badge?: string;
  badgeId?: string | null;
  isActive: boolean;
}
