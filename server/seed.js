require('dotenv').config();
const { pool, connectDB } = require('./config/db');
const Product = require('./models/Product');
const Category = require('./models/Category');
const User = require('./models/User');

const categories = [
  {
    name: 'T-Shirts',
    image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=900&q=80',
    description: 'Heavyweight everyday tees.'
  },
  {
    name: 'Hoodies',
    image: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=900&q=80',
    description: 'Premium fleece, boxy fits.'
  },
  {
    name: 'Bottoms',
    image: 'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=900&q=80',
    description: 'Cargos and relaxed trousers.'
  },
  {
    name: 'Jackets',
    image: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=900&q=80',
    description: 'Technical outerwear layers.'
  },
  {
    name: 'Accessories',
    image: 'https://images.unsplash.com/photo-1576871337622-98d48d1cf531?w=900&q=80',
    description: 'Beanies, bags and extras.'
  }
];

// Products reference category by name; IDs are resolved after categories are inserted.
const products = [
  {
    name: 'Monk Oversized Tee — Onyx', categoryName: 'T-Shirts', basePrice: 1499, featured: true, badge: 'New Drop',
    description: 'Heavyweight 240 GSM oversized tee in deep onyx black. Drop-shoulder fit, ribbed crew neck.',
    images: [
      { url: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80', isPrimary: true },
      { url: 'https://images.unsplash.com/photo-1503341504253-dff4815485f1?w=800&q=80', isPrimary: false }
    ],
    variants: [
      { size: 'S', color: 'Onyx', stock: 10 }, { size: 'M', color: 'Onyx', stock: 14 },
      { size: 'L', color: 'Onyx', stock: 12 }, { size: 'XL', color: 'Onyx', stock: 8 }, { size: 'XXL', color: 'Onyx', stock: 4 },
      { size: 'S', color: 'Bone', stock: 8  }, { size: 'M', color: 'Bone', stock: 10 },
      { size: 'L', color: 'Bone', stock: 9  }, { size: 'XL', color: 'Bone', stock: 6 }
    ]
  },
  {
    name: 'Hagen Heavy Hoodie — Slate', categoryName: 'Hoodies', basePrice: 2999, featured: true, badge: 'Bestseller',
    description: 'Premium 400 GSM fleece hoodie with a boxy silhouette, double-lined hood and kangaroo pocket.',
    images: [
      { url: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=800&q=80', isPrimary: true },
      { url: 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=800&q=80', isPrimary: false }
    ],
    variants: [
      { size: 'S', color: 'Slate', stock: 8 }, { size: 'M', color: 'Slate', stock: 10 },
      { size: 'L', color: 'Slate', stock: 7 }, { size: 'XL', color: 'Slate', stock: 5 },
      { size: 'S', color: 'Black', stock: 6 }, { size: 'M', color: 'Black', stock: 8 },
      { size: 'L', color: 'Black', stock: 6 }, { size: 'XL', color: 'Black', stock: 4 }
    ]
  },
  {
    name: 'Ascend Cargo Pants — Stone', categoryName: 'Bottoms', basePrice: 2499, featured: false, badge: '',
    description: 'Relaxed-fit cargo pants in stone cotton twill. Utility pockets and adjustable hem toggles.',
    images: [
      { url: 'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=800&q=80', isPrimary: true },
      { url: 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=800&q=80', isPrimary: false }
    ],
    variants: [
      { size: '28', color: 'Stone', stock: 8 }, { size: '30', color: 'Stone', stock: 10 },
      { size: '32', color: 'Stone', stock: 9 }, { size: '34', color: 'Stone', stock: 7 },
      { size: '28', color: 'Olive', stock: 6 }, { size: '30', color: 'Olive', stock: 8 },
      { size: '32', color: 'Olive', stock: 7 }, { size: '34', color: 'Olive', stock: 5 }
    ]
  },
  {
    name: 'Monk Zip Jacket — Charcoal', categoryName: 'Jackets', basePrice: 3499, featured: true, badge: 'Limited',
    description: 'Lightweight technical zip jacket with water-repellent shell, hidden chest pocket and storm cuffs.',
    images: [
      { url: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800&q=80', isPrimary: true },
      { url: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=800&q=80', isPrimary: false }
    ],
    variants: [
      { size: 'S', color: 'Charcoal', stock: 5 }, { size: 'M', color: 'Charcoal', stock: 7 },
      { size: 'L', color: 'Charcoal', stock: 6 }, { size: 'XL', color: 'Charcoal', stock: 4 }
    ]
  },
  {
    name: 'Hagen Knit Beanie — Bone', categoryName: 'Accessories', basePrice: 799, featured: false, badge: '',
    description: 'Ribbed knit beanie in bone with a woven Monk Hagen tab. Soft, stretchy and warm.',
    images: [
      { url: 'https://images.unsplash.com/photo-1576871337622-98d48d1cf531?w=800&q=80', isPrimary: true },
      { url: 'https://images.unsplash.com/photo-1510598155802-7163d9f1f4dd?w=800&q=80', isPrimary: false }
    ],
    variants: [
      { size: 'One Size', color: 'Bone', stock: 30 }, { size: 'One Size', color: 'Black', stock: 25 }
    ]
  },
  {
    name: 'Origin Graphic Tee — Bone', categoryName: 'T-Shirts', basePrice: 1699, featured: true, badge: 'New Drop',
    description: 'Bone-white tee with a hand-drawn Monk Hagen graphic across the back. 100% combed cotton.',
    images: [
      { url: 'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=800&q=80', isPrimary: true },
      { url: 'https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=800&q=80', isPrimary: false }
    ],
    variants: [
      { size: 'S', color: 'Bone', stock: 12 }, { size: 'M', color: 'Bone', stock: 15 },
      { size: 'L', color: 'Bone', stock: 12 }, { size: 'XL', color: 'Bone', stock: 9 }, { size: 'XXL', color: 'Bone', stock: 5 }
    ]
  },
  {
    name: 'Trail Puffer Vest — Black', categoryName: 'Jackets', basePrice: 2799, featured: false, badge: '',
    description: 'Insulated puffer vest with a matte finish and zip pockets.',
    images: [
      { url: 'https://images.unsplash.com/photo-1544022613-e87ca75a784a?w=800&q=80', isPrimary: true },
      { url: 'https://images.unsplash.com/photo-1548883354-94bcfe321cbb?w=800&q=80', isPrimary: false }
    ],
    variants: [
      { size: 'S', color: 'Black', stock: 6 }, { size: 'M', color: 'Black', stock: 8 },
      { size: 'L', color: 'Black', stock: 7 }, { size: 'XL', color: 'Black', stock: 5 },
      { size: 'S', color: 'Sand',  stock: 4 }, { size: 'M', color: 'Sand',  stock: 6 }, { size: 'L', color: 'Sand', stock: 5 }
    ]
  },
  {
    name: 'Monk Crossbody Bag — Onyx', categoryName: 'Accessories', basePrice: 1299, featured: true, badge: 'New Drop',
    description: 'Water-resistant crossbody utility bag with adjustable strap and multiple compartments.',
    images: [
      { url: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&q=80', isPrimary: true },
      { url: 'https://images.unsplash.com/photo-1547949003-9792a18a2601?w=800&q=80', isPrimary: false }
    ],
    variants: [{ size: 'One Size', color: 'Onyx', stock: 20 }]
  }
];

async function seed() {
  await connectDB();
  console.log('Clearing existing data…');
  // Explicit delete order respects FK constraints
  await pool.query('DELETE FROM return_items');
  await pool.query('DELETE FROM return_requests');
  await pool.query('DELETE FROM order_items');
  await pool.query('DELETE FROM order_addresses');
  await pool.query('DELETE FROM orders');
  await pool.query('DELETE FROM cart_items');
  await pool.query('DELETE FROM carts');
  await pool.query('DELETE FROM product_variants');
  await pool.query('DELETE FROM product_images');
  await pool.query('DELETE FROM products');
  await pool.query('DELETE FROM customer_addresses');
  await pool.query('DELETE FROM users');
  await pool.query('DELETE FROM categories');

  console.log('Seeding categories…');
  const catMap = {};
  for (const c of categories) {
    const cat = await Category.create(c);
    catMap[cat.name] = cat.id;
  }

  console.log('Seeding products…');
  for (const { categoryName, ...rest } of products) {
    await Product.create({ ...rest, categoryId: catMap[categoryName] });
  }

  console.log('Seeding users…');
  await User.create({ name: 'Monk Admin', email: 'admin@monkhagen.com', passwordHash: await User.hashPassword('admin123'), role: 'admin' });
  await User.create({ name: 'Super Admin', email: 'super@monkhagen.com', passwordHash: await User.hashPassword('super123'), role: 'super_admin' });

  console.log('\nSeed complete ✓');
  console.log('Admin       : admin@monkhagen.com / admin123');
  console.log('Super Admin : super@monkhagen.com / super123');
  console.log('Customers   : login via OTP (phone number)');
  await pool.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
