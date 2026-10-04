export interface ProductImagePair {
  imageUrl: string;
  zoomImageUrl: string | null;
}

export function imagePairsFromFields(images: string, zoomImages: string): ProductImagePair[] {
  const display = images.split(',').map(value => value.trim()).filter(Boolean);
  const zoom = zoomImages.split(',').map(value => value.trim() || null);
  return display.map((imageUrl, index) => ({ imageUrl, zoomImageUrl: zoom[index] || null }));
}

export function fieldsFromImagePairs(pairs: ProductImagePair[]): { images: string; zoomImages: string } {
  return {
    images: pairs.map(pair => pair.imageUrl).join(', '),
    zoomImages: pairs.some(pair => pair.zoomImageUrl)
      ? pairs.map(pair => pair.zoomImageUrl || '').join(', ')
      : ''
  };
}

export function moveImagePair(pairs: ProductImagePair[], from: number, to: number): ProductImagePair[] {
  if (from === to || from < 0 || to < 0 || from >= pairs.length || to >= pairs.length) return [...pairs];
  const reordered = [...pairs];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved);
  return reordered;
}

export function removeImagePair(pairs: ProductImagePair[], index: number): ProductImagePair[] {
  return pairs.filter((_pair, pairIndex) => pairIndex !== index);
}
