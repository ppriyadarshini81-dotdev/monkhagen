// ============================================================
// Central media asset registry — server side (seed script).
// Swap any URL here to replace Unsplash with Cloudflare R2.
// ============================================================

const MEDIA = {

  // ── Category cover images ─────────────────────────────────
  categories: {
    tshirts:     'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=900&q=80',
    hoodies:     'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=900&q=80',
    bottoms:     'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=900&q=80',
    jackets:     'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=900&q=80',
    accessories: 'https://images.unsplash.com/photo-1576871337622-98d48d1cf531?w=900&q=80'
  },

  // ── Product images (2 per product) ───────────────────────
  products: {
    monkOverszTeeOnyx:      ['https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80',
                             'https://images.unsplash.com/photo-1503341504253-dff4815485f1?w=800&q=80'],
    hagenHoodieSlate:       ['https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=800&q=80',
                             'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=800&q=80'],
    ascendCargoStone:       ['https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=800&q=80',
                             'https://images.unsplash.com/photo-1542272604-787c3835535d?w=800&q=80'],
    monkZipJacketCharcoal:  ['https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800&q=80',
                             'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=800&q=80'],
    hagenBeaniebone:        ['https://images.unsplash.com/photo-1576871337622-98d48d1cf531?w=800&q=80',
                             'https://images.unsplash.com/photo-1510598155802-7163d9f1f4dd?w=800&q=80'],
    originGraphicTeeBone:   ['https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=800&q=80',
                             'https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=800&q=80'],
    trailPufferVestBlack:   ['https://images.unsplash.com/photo-1544022613-e87ca75a784a?w=800&q=80',
                             'https://images.unsplash.com/photo-1548883354-94bcfe321cbb?w=800&q=80'],
    monkCrossbodyBagOnyx:   ['https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&q=80',
                             'https://images.unsplash.com/photo-1547949003-9792a18a2601?w=800&q=80']
  }
};

module.exports = MEDIA;
