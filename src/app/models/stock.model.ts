export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'SETUP_REQUIRED';
export interface StockItem {
  inventoryId: string; productId: string; productName: string; productSlug: string;
  imageUrl: string | null; categoryId: string; category: string; sizeId: string; size: string;
  currentStock: number; initialStock: number; threshold: number; configured: boolean;
  remainingPercent: number | null; status: StockStatus; updatedAt: string;
}
export interface StockSummary { totalProducts: number; totalUnits: number; lowStockSizes: number; outOfStockSizes: number; setupRequiredSizes: number; }
export interface StockResponse { items: StockItem[]; summary: StockSummary; pagination: { page: number; limit: number; total: number; pages: number }; }
export interface StockMovement { id: string; type: string; quantityChange: number; quantityBefore: number; quantityAfter: number;
  reason: string | null; orderNumber: string | null; returnNumber: string | null; createdBy: string; createdAt: string; }
