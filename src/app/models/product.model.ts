export interface ProductVariant {
  id: string;
  size: string;
  color: string;
  sku: string | null;
  price: number | null;
  stock: number;
  isActive: boolean;
}

export interface ProductImage {
  id: string;
  url: string;
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
  images: string[];
  imageObjects?: ProductImage[];
  variants?: ProductVariant[];
  rating: number;
  stock: number;
  featured: boolean;
  badge?: string;
  isActive: boolean;
}
