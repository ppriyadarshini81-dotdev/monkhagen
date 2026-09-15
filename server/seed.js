require('dotenv').config();
const { pool, connectDB } = require('./config/db');
const Product = require('./models/Product');
const Category = require('./models/Category');
const User = require('./models/User');
const MEDIA = require('./config/mediaAssets');

const categories = [
  { name: 'T-Shirts',    image: MEDIA.categories.tshirts,     description: 'Heavyweight everyday tees.' },
  { name: 'Hoodies',     image: MEDIA.categories.hoodies,     description: 'Premium fleece, boxy fits.' },
  { name: 'Bottoms',     image: MEDIA.categories.bottoms,     description: 'Cargos and relaxed trousers.' },
  { name: 'Jackets',     image: MEDIA.categories.jackets,     description: 'Technical outerwear layers.' },
  { name: 'Accessories', image: MEDIA.categories.accessories, description: 'Beanies, bags and extras.' }
];

// Products reference category by name; IDs are resolved after categories are inserted.
const products = [
  {
    name: 'Monk Oversized Tee — Onyx', categoryName: 'T-Shirts', basePrice: 1499, featured: true, badge: 'New Drop',
    description: 'Heavyweight 240 GSM oversized tee in deep onyx black. Drop-shoulder fit, ribbed crew neck.',
    images: [
      { url: MEDIA.products.monkOverszTeeOnyx[0], isPrimary: true },
      { url: MEDIA.products.monkOverszTeeOnyx[1], isPrimary: false }
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
      { url: MEDIA.products.hagenHoodieSlate[0], isPrimary: true },
      { url: MEDIA.products.hagenHoodieSlate[1], isPrimary: false }
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
      { url: MEDIA.products.ascendCargoStone[0], isPrimary: true },
      { url: MEDIA.products.ascendCargoStone[1], isPrimary: false }
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
      { url: MEDIA.products.monkZipJacketCharcoal[0], isPrimary: true },
      { url: MEDIA.products.monkZipJacketCharcoal[1], isPrimary: false }
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
      { url: MEDIA.products.hagenBeaniebone[0], isPrimary: true },
      { url: MEDIA.products.hagenBeaniebone[1], isPrimary: false }
    ],
    variants: [
      { size: 'One Size', color: 'Bone', stock: 30 }, { size: 'One Size', color: 'Black', stock: 25 }
    ]
  },
  {
    name: 'Origin Graphic Tee — Bone', categoryName: 'T-Shirts', basePrice: 1699, featured: true, badge: 'New Drop',
    description: 'Bone-white tee with a hand-drawn Monk Hagen graphic across the back. 100% combed cotton.',
    images: [
      { url: MEDIA.products.originGraphicTeeBone[0], isPrimary: true },
      { url: MEDIA.products.originGraphicTeeBone[1], isPrimary: false }
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
      { url: MEDIA.products.trailPufferVestBlack[0], isPrimary: true },
      { url: MEDIA.products.trailPufferVestBlack[1], isPrimary: false }
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
      { url: MEDIA.products.monkCrossbodyBagOnyx[0], isPrimary: true },
      { url: MEDIA.products.monkCrossbodyBagOnyx[1], isPrimary: false }
    ],
    variants: [{ size: 'One Size', color: 'Onyx', stock: 20 }]
  }
];

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database.');
  }
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
  console.log('Customers   : login with Google');
  await pool.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
