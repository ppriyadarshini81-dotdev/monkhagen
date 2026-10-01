export interface ReviewSummary {
  average: number;
  total: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

export interface ReviewImage {
  id: string;
  url: string;
  sortOrder: number;
}

export interface ProductReview {
  id: string;
  productId: string;
  rating: number;
  text: string;
  displayName: string;
  verifiedBuyer: boolean;
  sizePurchased: string | null;
  helpfulCount: number;
  helpfulByMe: boolean;
  images: ReviewImage[];
  edited: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewEligibility {
  eligible: boolean;
  hasReview: boolean;
  orderItemId: string | null;
  sizePurchased: string | null;
  ownReview: (ProductReview & { moderationStatus: 'approved' | 'hidden' }) | null;
}

export interface ReviewPage {
  reviews: ProductReview[];
  total: number;
  limit: number;
  offset: number;
  customerPhotos: Array<{ id: string; reviewId: string; url: string }>;
}

export interface AdminReview extends ProductReview {
  productName: string;
  customerName: string;
  moderationStatus: 'approved' | 'hidden';
}
