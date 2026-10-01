import { fieldsFromImagePairs, imagePairsFromFields, moveImagePair, removeImagePair } from './product-image-pairs';

describe('product image pairs', () => {
  it('preserves an empty middle zoom position', () => {
    const pairs = imagePairsFromFields('a.webp, b.webp, c.webp', 'a-zoom.webp, , c-zoom.webp');
    expect(pairs.map(pair => pair.zoomImageUrl)).toEqual(['a-zoom.webp', null, 'c-zoom.webp']);
    expect(fieldsFromImagePairs(pairs).zoomImages).toBe('a-zoom.webp, , c-zoom.webp');
  });

  it('moves display and zoom images together and makes the first pair primary by position', () => {
    const pairs = imagePairsFromFields('a.webp, b.webp, c.webp', 'a-zoom.webp, b-zoom.webp, c-zoom.webp');
    const reordered = moveImagePair(pairs, 2, 0);
    expect(reordered).toEqual([
      { imageUrl: 'c.webp', zoomImageUrl: 'c-zoom.webp' },
      { imageUrl: 'a.webp', zoomImageUrl: 'a-zoom.webp' },
      { imageUrl: 'b.webp', zoomImageUrl: 'b-zoom.webp' }
    ]);
  });

  it('removes the complete pair without shifting a different zoom image onto its neighbour', () => {
    const pairs = imagePairsFromFields('a.webp, b.webp, c.webp', 'a-zoom.webp, , c-zoom.webp');
    expect(removeImagePair(pairs, 1)).toEqual([
      { imageUrl: 'a.webp', zoomImageUrl: 'a-zoom.webp' },
      { imageUrl: 'c.webp', zoomImageUrl: 'c-zoom.webp' }
    ]);
  });

  it('keeps existing products without zoom images backward compatible', () => {
    expect(imagePairsFromFields('a.webp, b.webp', '')).toEqual([
      { imageUrl: 'a.webp', zoomImageUrl: null },
      { imageUrl: 'b.webp', zoomImageUrl: null }
    ]);
  });
});
