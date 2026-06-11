/* Zaplin storefront logic. Shared catalog/admin data is cached from Firestore;
   cart, profile, and price-view preferences remain device-specific. */

/* ---- Configuration ------------------------------------------------------ */
const WHATSAPP_NUMBER = '919797561691';     // orders are sent here
const FREE_DELIVERY_OVER = 5000;            // subtotal for free delivery
const DELIVERY_CHARGE = 50;                 // otherwise

/* ---- Helpers ------------------------------------------------------------ */
const PRODUCTS = window.ZAPLIN_PRODUCTS || [];
const PMAP = window.ZAPLIN_PRODUCT_MAP || {};
const slugify = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/&/g, 'and')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');
const safeLink = (value, fallback = '#') => {
  const link = String(value || '').trim();
  return /^(https?:\/\/|\/|[a-z0-9][a-z0-9._/-]*\.html(?:[?#].*)?|#)/i.test(link) ? link : fallback;
};
const persistentImage = (value) => {
  const source = String(value || '').trim();
  return /^(blob:|file:)/i.test(source) ? '' : source;
};
const CATEGORIES = Array.isArray(window.ZAPLIN_CATEGORIES) && window.ZAPLIN_CATEGORIES.length
  ? window.ZAPLIN_CATEGORIES
  : [...new Set(PRODUCTS.map((p) => p.category).filter(Boolean))]
    .map((slug) => ({ slug, name: slug.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()), emoji: '' }));

const RUPEE = '\u20B9';
const money = (v) => `${RUPEE}${Number(v || 0).toLocaleString('en-IN')}`;
const ADMIN_PRODUCTS_KEY = 'zaplin_admin_products';
const ADMIN_PRODUCT_OVERRIDES_KEY = 'zaplin_product_overrides';
const ADMIN_DELETED_PRODUCTS_KEY = 'zaplin_deleted_products';
const POLICY_STORAGE_KEY = 'zaplin_policies';
const ADMIN_BANNERS_KEY = 'zaplin_managed_banners';
const ADMIN_BRANDS_KEY = 'zaplin_managed_brands';
const firebaseCache = (name) => readJsonStorage(`zaplin_firebase_cache_${name}`, []);
const remoteItems = (name) => {
  const live = window.ZAPLIN_FIREBASE_CACHE?.[name];
  return Array.isArray(live) ? live : firebaseCache(name);
};
const firebaseIsAuthoritative = () => remoteItems('settings').some((item) => item.id === 'localMigration' && item.completed);
const remoteWrite = (promise, success = 'Saved to Firebase') => {
  if (!promise?.catch) return;
  promise.then(() => flashAdminState(success)).catch((error) => {
    console.error(error);
    flashAdminState(error?.message || 'Firebase save failed');
  });
};
const readJsonStorage = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (_) {
    return fallback;
  }
};
const writeJsonStorage = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const getAdminProducts = () => remoteItems('products').length ? remoteItems('products') : readJsonStorage(ADMIN_PRODUCTS_KEY, []);
const setAdminProducts = (items) => writeJsonStorage(ADMIN_PRODUCTS_KEY, items);
const getProductOverrides = () => readJsonStorage(ADMIN_PRODUCT_OVERRIDES_KEY, {});
const setProductOverrides = (items) => writeJsonStorage(ADMIN_PRODUCT_OVERRIDES_KEY, items);
const getDeletedProducts = () => readJsonStorage(ADMIN_DELETED_PRODUCTS_KEY, []);
const setDeletedProducts = (items) => writeJsonStorage(ADMIN_DELETED_PRODUCTS_KEY, items);
const getPolicies = () => ({
  ...(window.ZAPLIN_DEFAULT_POLICIES || {}),
  ...Object.fromEntries(remoteItems('policies').map((item) => [item.id, item])),
  ...(remoteItems('policies').length ? {} : readJsonStorage(POLICY_STORAGE_KEY, {})),
});
const setPolicies = (items) => {
  writeJsonStorage(POLICY_STORAGE_KEY, items);
  remoteWrite(window.ZAPLIN_FIREBASE?.replaceCollection('policies', Object.entries(items).map(([id, value]) => ({ id, ...value })), 'id'));
};
function rebuildProductMap() {
  Object.keys(PMAP).forEach((id) => delete PMAP[id]);
  PRODUCTS.forEach((product) => { PMAP[String(product.id)] = product; });
  window.ZAPLIN_PRODUCT_MAP = PMAP;
}
function applyAdminCatalog() {
  const remoteProducts = remoteItems('products');
  if (remoteProducts.length || firebaseIsAuthoritative()) {
    PRODUCTS.splice(0, PRODUCTS.length, ...remoteProducts);
    rebuildProductMap();
    return;
  }
  const deleted = new Set(getDeletedProducts().map(String));
  for (let index = PRODUCTS.length - 1; index >= 0; index -= 1) {
    if (deleted.has(String(PRODUCTS[index].id))) PRODUCTS.splice(index, 1);
  }
  const overrides = getProductOverrides();
  PRODUCTS.forEach((product) => {
    if (overrides[String(product.id)]) Object.assign(product, overrides[String(product.id)]);
  });
  getAdminProducts().forEach((product) => {
    if (!deleted.has(String(product.id)) && !PRODUCTS.some((item) => String(item.id) === String(product.id))) {
      PRODUCTS.push(product);
    }
  });
  PRODUCTS.forEach((product) => {
    if (product.selling_mrp == null) product.selling_mrp = Number(product.mrp || 0);
  });
  rebuildProductMap();
}
applyAdminCatalog();
const params = new URLSearchParams(location.search);
const schemeText = (s) => !s ? 'No active scheme'
  : s.type === 'bxgy' ? `Buy ${s.buy} Get ${s.get} Free` : 'Special scheme';
const retailPrice = (product) => Number(product.mrp || 0);
const wholesalePrice = (product) => Number(product.trade || 0);
const marginFor = (product, view = 'wholesale') => {
  const retail = retailPrice(product);
  const wholesale = wholesalePrice(product);
  if (!retail || !wholesale || retail <= wholesale) return 0;
  const divisor = view === 'retail' ? wholesale : retail;
  return Math.round(((retail - wholesale) / divisor) * 100);
};
const categoryImages = {
  namkeen: 'assets/img/categories/namkeen.jpg',
  biscuits: 'assets/img/categories/biscuits.jpg',
  bakery: 'assets/img/categories/bakery.jpg',
  cereals: 'assets/img/categories/cereals.jpg',
  'atta-flour': 'assets/img/categories/atta-flour.jpg',
  beverages: 'assets/img/categories/beverages.jpg',
  confectionery: 'assets/img/categories/confectionery.jpg',
  'cooking-oil': 'assets/img/categories/cooking-oil.jpg',
  'dairy-ghee': 'assets/img/categories/dairy-ghee.jpg',
  'health-ayurveda': 'assets/img/categories/health-ayurveda.jpg',
  'home-care': 'assets/img/categories/home-care.jpg',
  'personal-care': 'assets/img/categories/personal-care.jpg',
  'rice-pulses': 'assets/img/categories/rice-pulses.jpg',
  'spices-masala': 'assets/img/categories/spices-masala.jpg',
  'tea-coffee': 'assets/img/categories/tea-coffee.jpg',
};
const categoryUnitDefaults = {
  namkeen: 'packets',
  biscuits: 'packets',
  bakery: 'packets',
  cereals: 'packets',
  'atta-flour': 'packets',
  beverages: 'bottles',
  confectionery: 'packets',
  'cooking-oil': 'litres',
  'dairy-ghee': 'litres',
  'health-ayurveda': 'packets',
  'home-care': 'packets',
  'personal-care': 'packets',
  'rice-pulses': 'packets',
  'spices-masala': 'packets',
  'tea-coffee': 'packets',
};
const ADMIN_CATEGORIES_KEY = 'zaplin_managed_categories';
function categorySeedData() {
  return CATEGORIES.map((category) => ({
    ...category,
    image: category.image || categoryImages[category.slug] || 'assets/img/categories/biscuits.jpg',
    active: category.active !== false,
    unit_type: category.unit_type || categoryUnitDefaults[category.slug] || 'packets',
  }));
}
function getManagedCategories() {
  const remote = remoteItems('categories');
  if (remote.length || firebaseIsAuthoritative()) return remote.map((category) => ({ ...category, image: persistentImage(category.image) }));
  const saved = readJsonStorage(ADMIN_CATEGORIES_KEY, null);
  if (Array.isArray(saved) && saved.length) {
    return saved.map((category) => ({
      ...category,
      image: persistentImage(category.image),
      unit_type: category.unit_type || categoryUnitDefaults[category.slug] || 'packets',
    }));
  }
  const seeded = categorySeedData();
  writeJsonStorage(ADMIN_CATEGORIES_KEY, seeded);
  return seeded;
}
function setManagedCategories(categories) {
  writeJsonStorage(ADMIN_CATEGORIES_KEY, categories);
  remoteWrite(window.ZAPLIN_FIREBASE?.replaceCollection('categories', categories, 'slug'));
}
function syncManagedCategories() {
  const managed = getManagedCategories();
  CATEGORIES.splice(0, CATEGORIES.length, ...managed.filter((category) => category.active !== false));
  managed.forEach((category) => {
    if (category.image) categoryImages[category.slug] = category.image;
  });
}
syncManagedCategories();

function bannerSeedData() {
  return [
    {
      id: 'banner-zaplin',
      title: 'Wholesale buying, powered by Zaplin',
      subtitle: 'Saara Samaan Ek Jagah Se for kirana stores, retailers, and distributors.',
      buttonText: 'Shop Now',
      buttonUrl: 'search.html',
      image: 'assets/img/zaplin-banner-glow.png',
      active: true,
      sortOrder: 1,
    },
    {
      id: 'banner-fmcg',
      title: 'Everything your store needs',
      subtitle: 'Groceries, FMCG, beverages, snacks, personal care, and daily essentials at trade prices.',
      buttonText: 'Browse Products',
      buttonUrl: 'category-biscuits.html',
      image: 'assets/img/zaplin-wholesale-login-bg.jpeg',
      active: true,
      sortOrder: 2,
    },
  ];
}
function getManagedBanners() {
  const remote = remoteItems('banners');
  if (remote.length || firebaseIsAuthoritative()) return remote.map((banner) => ({ ...banner, image: persistentImage(banner.image) }));
  const saved = readJsonStorage(ADMIN_BANNERS_KEY, null);
  if (Array.isArray(saved)) return saved.map((banner) => ({ ...banner, image: persistentImage(banner.image) }));
  const seeded = bannerSeedData();
  writeJsonStorage(ADMIN_BANNERS_KEY, seeded);
  return seeded;
}
const setManagedBanners = (items) => {
  writeJsonStorage(ADMIN_BANNERS_KEY, items);
  remoteWrite(window.ZAPLIN_FIREBASE?.replaceCollection('banners', items, 'id'));
};

function brandSeedData() {
  const names = [...new Set([
    ...PRODUCTS.map((product) => product.brand),
    'Patanjali',
    'Bikano',
    'Lahoori Zeera',
    'Campa Sure',
    'Musta Pure',
  ].filter(Boolean))].sort();
  return names.map((name, index) => ({ name, logo: '', active: true, sortOrder: index + 1 }));
}
function getManagedBrands() {
  const remote = remoteItems('brands');
  if (remote.length || firebaseIsAuthoritative()) return remote.map((brand) => ({ ...brand, logo: persistentImage(brand.logo) }));
  const saved = readJsonStorage(ADMIN_BRANDS_KEY, null);
  if (Array.isArray(saved)) return saved.map((brand) => ({ ...brand, logo: persistentImage(brand.logo) }));
  const seeded = brandSeedData();
  writeJsonStorage(ADMIN_BRANDS_KEY, seeded);
  return seeded;
}
const setManagedBrands = (items) => {
  writeJsonStorage(ADMIN_BRANDS_KEY, items);
  remoteWrite(window.ZAPLIN_FIREBASE?.replaceCollection('brands', items, 'name'));
};

function svgIcon(name) {
  const icons = {
    home: '<svg viewBox="0 0 24 24"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
    grid: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    bag: '<svg viewBox="0 0 24 24"><path d="M6 8h12l1 13H5L6 8Z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>',
    orders: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 12h6M9 17h4"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    logout: '<svg viewBox="0 0 24 24"><path d="M10 17v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2"/><path d="M15 7l5 5-5 5"/><path d="M20 12H9"/></svg>',
  };
  return icons[name] || icons.home;
}

function normalizeSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  const current = location.pathname.split('/').pop() || 'index.html';
  const isAdmin = current === 'admin.html';
  const nav = isAdmin ? [
    ['Dashboard', 'admin.html', 'home'],
    ['Products', '#products', 'bag'],
    ['Coupons', '#coupons', 'orders'],
    ['Deal of the Day', '#deals', 'bag'],
    ['Categories', '#categories', 'grid'],
    ['Banners', '#banners', 'bag'],
    ['Top Brands', '#brands', 'grid'],
    ['Policies', '#policies', 'orders'],
    ['Clients', '#clients', 'user'],
    ['Orders', '#orders', 'orders'],
    ['Storefront', 'index.html', 'logout'],
  ] : [
    ['Home', 'index.html', 'home'],
    ['Categories', 'category-biscuits.html', 'grid'],
    ['All Products', 'search.html', 'bag'],
    ['My Orders', 'my-orders.html', 'orders'],
    ['My Account', 'my-account.html', 'user'],
    ['Logout', 'login.html', 'logout'],
  ];
  sidebar.innerHTML = `<div class="brand-lockup logo-lockup"><img class="brand-logo" src="assets/img/zaplin-logo.png" alt="Zaplin"><small>${isAdmin ? 'Admin Panel' : 'Saara Samaan Ek Jagah Se'}</small></div><nav>${nav.map(([label, href, icon], index) => `<a class="${current === href || (isAdmin && index === 0) ? 'active' : ''}" href="${href}"><span class="nav-icon">${svgIcon(icon)}</span>${label}</a>`).join('')}</nav>`;
}
normalizeSidebar();

const getCart = () => JSON.parse(localStorage.getItem('zaplin_cart') || '{}');
const setCart = (c) => localStorage.setItem('zaplin_cart', JSON.stringify(c));
const getCartPriceViews = () => JSON.parse(localStorage.getItem('zaplin_cart_price_views') || '{}');
const setCartPriceViews = (v) => localStorage.setItem('zaplin_cart_price_views', JSON.stringify(v));
const getOrders = () => remoteItems('orders').length && location.pathname.endsWith('admin.html')
  ? remoteItems('orders')
  : JSON.parse(localStorage.getItem('zaplin_orders') || '[]');
const setOrders = (o) => {
  localStorage.setItem('zaplin_orders', JSON.stringify(o));
  const latest = Array.isArray(o) ? o[0] : null;
  if (latest) window.ZAPLIN_FIREBASE?.saveOrder(latest).catch((error) => console.error('Order sync failed:', error));
};
const getProfile = () => JSON.parse(localStorage.getItem('zaplin_profile') || '{}');
const setProfile = (p) => localStorage.setItem('zaplin_profile', JSON.stringify(p));
const getInventory = () => JSON.parse(localStorage.getItem('zaplin_inventory') || '{}');
const setInventory = (i) => localStorage.setItem('zaplin_inventory', JSON.stringify(i));
const getClients = () => JSON.parse(localStorage.getItem('zaplin_clients') || '[]');
const setClients = (c) => localStorage.setItem('zaplin_clients', JSON.stringify(c));

function defaultStock(product) {
  return Math.max(18, 80 - Math.floor(Number(product.id || 0) % 13) * 4);
}

function inventoryFor(product) {
  if (product && (product.stock != null || product.stockQty != null)) {
    return {
      qty: Number(product.stock ?? product.stockQty ?? 0),
      reorder: Number(product.reorder ?? product.reorderAt ?? 0),
      active: product.active !== false && product.stockStatus !== 'inactive',
    };
  }
  const inventory = getInventory();
  return inventory[String(product.id)] || { qty: defaultStock(product), reorder: 12, active: true };
}

function priceForView(product, view = 'wholesale') {
  return view === 'retail' ? retailPrice(product) : wholesalePrice(product);
}

function selectedPriceViewForButton(button) {
  return button.closest('[data-product-card]')?.querySelector('input[type="radio"][name^="price-view-"]:checked')?.value
    || document.querySelector('input[name="pd-price-view"]:checked')?.value
    || 'wholesale';
}

function saveInventoryItem(id, next) {
  const inventory = getInventory();
  inventory[String(id)] = {
    qty: Math.max(0, Number(next.qty) || 0),
    reorder: Math.max(0, Number(next.reorder) || 0),
    active: next.active !== false,
  };
  setInventory(inventory);
  remoteWrite(window.ZAPLIN_FIREBASE?.save('products', id, {
    stock: inventory[String(id)].qty,
    reorder: inventory[String(id)].reorder,
    active: inventory[String(id)].active,
    stockStatus: inventory[String(id)].active ? 'active' : 'inactive',
  }), 'Stock synced');
}

/* Scheme savings for a line: e.g. Buy 10 Get 1 Free -> floor(qty/10) free units */
function lineScheme(product, qty, price = product.trade) {
  const s = product.scheme;
  if (!s || s.type !== 'bxgy') return 0;
  const free = Math.floor(qty / s.buy) * s.get;
  return free * price;
}

/* Compute full cart totals from the localStorage cart */
function cartTotals() {
  const cart = getCart();
  const priceViews = getCartPriceViews();
  let subtotal = 0, scheme = 0, count = 0;
  Object.entries(cart).forEach(([id, qty]) => {
    const p = PMAP[String(id)];
    if (!p) return;
    qty = Number(qty);
    const price = priceForView(p, priceViews[id] || 'wholesale');
    subtotal += price * qty;
    scheme += lineScheme(p, qty, price);
    count += qty;
  });
  const delivery = (subtotal === 0 || subtotal > FREE_DELIVERY_OVER) ? 0 : DELIVERY_CHARGE;
  const grand = Math.max(0, subtotal - scheme + delivery);
  return { subtotal, scheme, delivery, grand, count };
}

function updateCartBadge() {
  const { count } = cartTotals();
  document.querySelectorAll('[data-cart-count]').forEach((el) => { el.textContent = count; });
}

/* ---- Product card markup (matches existing CSS) ------------------------- */
function productCard(p) {
  const badge = `<span class="discount-badge margin-badge"><span class="margin-value">${marginFor(p, 'wholesale')}</span>% Margin</span>`;
  const stock = inventoryFor(p);
  const disabled = !stock.active || stock.qty <= 0;
  const stockClass = stock.qty <= stock.reorder ? ' stock-low' : '';
  const stockText = !stock.active ? 'Unavailable' : stock.qty <= 0 ? 'Out of stock' : `${stock.qty} in stock`;
  const uDisplay = p.unit || unitLabel(p);
  const printedMrp = Number(p.selling_mrp ?? p.mrp ?? 0);
  return `<article class="product-card premium-product-card" data-product-card data-wholesale="${wholesalePrice(p)}" data-retail="${retailPrice(p)}">
    <a href="product-parle-g.html?id=${p.id}"><img src="${p.image}" alt="${p.name}"></a>
    ${badge}
    <h3><a href="product-parle-g.html?id=${p.id}">${p.name}</a></h3>
    <p class="product-brand">${p.brand}</p>
    <div class="product-pack-meta">
      <span><b>MRP per unit:</b> ${money(printedMrp)}</span>
      <span><b>Pack contains:</b> ${escapeHtml(uDisplay)}</span>
    </div>
    <p class="stock-note${stockClass}">${stockText}</p>
    <div class="dual-price-row product-price-pair">
      <div class="price-option active" data-price-option="wholesale"><span>Wholesale Price</span><strong>${money(p.trade)}</strong><small>/ pack</small></div>
      <div class="price-option" data-price-option="retail"><span>Retail Price</span><strong>${money(p.mrp)}</strong><small>/ pack</small></div>
    </div>
    <div class="price-view-row">
      <span>View price as:</span>
      <label><input type="radio" name="price-view-${p.id}" value="wholesale" checked> Wholesale</label>
      <label><input type="radio" name="price-view-${p.id}" value="retail"> Retail</label>
    </div>
    <button class="add-cart" data-add-cart="${p.id}" ${disabled ? 'disabled' : ''}>${disabled ? 'Unavailable' : 'Add to Cart'}</button>
  </article>`;
}
function renderGrid(container, list) {
  if (!container) return;
  container.innerHTML = list.length
    ? list.map(productCard).join('')
    : '<p class="empty-state">No products found.</p>';
  bindAddToCart(container);
  bindPriceViews(container);
}

function bindPriceViews(scope = document) {
  scope.querySelectorAll('[data-product-card]').forEach((card) => {
    if (card.dataset.priceBound) return;
    card.dataset.priceBound = '1';
    const wholesale = Number(card.dataset.wholesale || 0);
    const retail = Number(card.dataset.retail || 0);
    card.querySelectorAll('input[type="radio"][name^="price-view-"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        const divisor = radio.value === 'retail' ? wholesale : retail;
        const margin = divisor ? Math.round(((retail - wholesale) / divisor) * 100) : 0;
        const value = card.querySelector('.margin-value');
        if (value) value.textContent = margin;
        card.querySelectorAll('[data-price-option]').forEach((option) => {
          option.classList.toggle('active', option.dataset.priceOption === radio.value);
        });
        card.dataset.currentPriceView = radio.value;
      });
    });
  });
}

/* ==========================================================================
   ADD TO CART (delegated, re-bindable for freshly rendered grids)
   ========================================================================== */
function bindAddToCart(scope = document) {
  scope.querySelectorAll('[data-add-cart]').forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = '1';
    button.addEventListener('click', () => {
      const id = button.dataset.addCart;
      const qtyField = document.querySelector('[data-qty]');
      const qty = Number(qtyField?.value || 1);
      const product = PMAP[String(id)];
      const stock = product ? inventoryFor(product) : { qty: 0, active: false };
      if (!stock.active || stock.qty <= 0) {
        button.textContent = 'Out of stock';
        setTimeout(() => { button.textContent = 'Unavailable'; }, 900);
        return;
      }
      const cart = getCart();
      const priceViews = getCartPriceViews();
      const requestedQty = Number(cart[id] || 0) + qty;
      cart[id] = Math.min(stock.qty, requestedQty);
      priceViews[id] = selectedPriceViewForButton(button);
      setCart(cart);
      setCartPriceViews(priceViews);
      updateCartBadge();
      const original = button.textContent;
      button.disabled = true;
      button.textContent = cart[id] < requestedQty ? 'Max stock added' : 'Added';
      setTimeout(() => { button.textContent = original; button.disabled = false; }, 900);
    });
  });
}

/* ==========================================================================
   SIDEBAR / CAROUSEL / COUNTDOWN  (unchanged behaviour)
   ========================================================================== */
const sidebarButton = document.querySelector('[data-toggle-sidebar]');
const sidebar = document.querySelector('#sidebar');
if (sidebarButton && sidebar) {
  sidebarButton.addEventListener('click', () => sidebar.classList.toggle('open'));
}

const bannerSlides = document.querySelector('[data-banner-slides]');
if (bannerSlides) {
  const activeBanners = getManagedBanners()
    .filter((banner) => banner.active !== false)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  bannerSlides.innerHTML = activeBanners.length ? activeBanners.map((banner, bannerIndex) => `
    <article class="hero-slide managed-banner-slide ${bannerIndex === 0 ? 'active' : ''}">
      ${banner.image ? `<img class="managed-banner-media" src="${escapeHtml(banner.image)}" alt="">` : ''}
      <div class="managed-banner-overlay" aria-hidden="true"></div>
      <div class="managed-banner-copy">
        <p class="eyebrow">Zaplin Wholesale</p>
        <h1>${escapeHtml(banner.title)}</h1>
        ${banner.subtitle ? `<p>${escapeHtml(banner.subtitle)}</p>` : ''}
        ${banner.buttonText ? `<a class="primary-action hero-cta" href="${escapeHtml(safeLink(banner.buttonUrl, 'search.html'))}">${escapeHtml(banner.buttonText)}</a>` : ''}
      </div>
    </article>`).join('') : `
    <article class="hero-slide managed-banner-slide active">
      <div class="managed-banner-copy"><p class="eyebrow">Zaplin Wholesale</p><h1>Saara Samaan Ek Jagah Se</h1><p>Add an active banner from the admin panel.</p></div>
    </article>`;
}

const carousel = document.querySelector('[data-carousel]');
if (carousel) {
  const slides = [...carousel.querySelectorAll('.hero-slide')];
  let index = 0;
  const show = (next) => {
    if (!slides.length) return;
    slides.forEach((slide) => slide.classList.remove('active'));
    index = (next + slides.length) % slides.length;
    slides[index].classList.add('active');
  };
  const controls = carousel.querySelector('.carousel-controls');
  if (slides.length <= 1 && controls) controls.hidden = true;
  carousel.querySelector('[data-next]')?.addEventListener('click', () => show(index + 1));
  carousel.querySelector('[data-prev]')?.addEventListener('click', () => show(index - 1));
  if (slides.length > 1) setInterval(() => show(index + 1), 6000);
  show(0);
}

const countdown = document.querySelector('[data-countdown]');
if (countdown) {
  let seconds = 8 * 60 * 60;
  setInterval(() => {
    seconds = Math.max(0, seconds - 1);
    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    countdown.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

/* ==========================================================================
   HOME PAGE - category tiles + deals grid from catalog
   ========================================================================== */
const catTiles = document.querySelector('[data-category-tiles]');
if (catTiles) {
  catTiles.innerHTML = CATEGORIES.map((c) =>
    `<a class="category-tile image-category-tile" href="category-biscuits.html?cat=${c.slug}">
      ${c.image ? `<img src="${escapeHtml(c.image)}" alt="${escapeHtml(c.name)}">` : '<span class="category-image-placeholder" aria-hidden="true">+</span>'}
      <strong>${escapeHtml(c.name)}</strong>
    </a>`
  ).join('');
}
const brandScroll = document.querySelector('[data-brand-scroll]');
if (brandScroll) {
  const brands = getManagedBrands()
    .filter((brand) => brand.active !== false)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  brandScroll.innerHTML = brands.map((brand) =>
    `<a class="brand-card logo-brand-card" href="search.html?q=${encodeURIComponent(brand.name)}">
      <span>${brand.logo ? `<img src="${escapeHtml(brand.logo)}" alt="${escapeHtml(brand.name)}">` : escapeHtml(brand.name)}</span>
      <strong>${escapeHtml(brand.name)}</strong>
    </a>`
  ).join('');
}
const dealsGrid = document.querySelector('[data-grid="deals"]');
if (dealsGrid) {
  const deals = [...PRODUCTS].sort((a, b) => b.discountPct - a.discountPct).slice(0, 4);
  renderGrid(dealsGrid, deals);
}

/* ==========================================================================
   CATEGORY PAGE - manual category, brand and search filters
   ========================================================================== */
const catGrid = document.querySelector('[data-grid="category"]');
if (catGrid) {
  const initialSlug = params.get('cat') || '';
  const catSel = document.querySelector('[data-filter-category]');
  const brandSel = document.querySelector('[data-filter-brand]');
  const priceSel = document.querySelector('[data-price-range]');
  const sortSel = document.querySelector('[data-sort]');
  const searchInput = document.querySelector('[data-category-search]');
  const subheadingText = document.querySelector('[data-cat-subtitle]');

  if (catSel) {
    catSel.innerHTML = '<option value="">Select Category</option>' +
      CATEGORIES.map((c) => `<option value="${c.slug}" ${c.slug === initialSlug ? 'selected' : ''}>${c.name}</option>`).join('');
  }

  const refreshBrands = () => {
    if (!brandSel) return;
    const selectedCat = catSel?.value || '';
    if (!selectedCat) {
      brandSel.innerHTML = '<option value="">Select category first</option>';
      brandSel.value = '';
      brandSel.disabled = true;
      return;
    }
    const pool = PRODUCTS.filter((p) => p.category === selectedCat);
    const current = brandSel.value || '';
    const brands = [...new Set(pool.map((p) => p.brand).filter(Boolean))].sort();
    brandSel.innerHTML = '<option value="">All brands</option>' +
      brands.map((b) => `<option value="${b}" ${b === current ? 'selected' : ''}>${b}</option>`).join('');
    if (current && !brands.includes(current)) brandSel.value = '';
    brandSel.disabled = false;
  };

  const apply = () => {
    const selectedCat = catSel?.value || '';
    const cat = CATEGORIES.find((c) => c.slug === selectedCat);
    let list = selectedCat ? PRODUCTS.filter((p) => p.category === selectedCat) : [...PRODUCTS];
    const b = selectedCat ? brandSel?.value : '';
    if (b) list = list.filter((p) => p.brand === b);
    const priceRange = priceSel?.value || '';
    if (priceRange) {
      const [min, max] = priceRange.split('-').map(Number);
      list = list.filter((p) => {
        const price = wholesalePrice(p);
        return price >= min && price <= max;
      });
    }
    const q = (searchInput?.value || '').trim().toLowerCase();
    if (q) {
      list = list.filter((p) => `${p.name} ${p.brand} ${p.sku}`.toLowerCase().includes(q));
    }
    const sort = sortSel?.value;
    if (sort === 'price-low') list.sort((a, c) => wholesalePrice(a) - wholesalePrice(c));
    else if (sort === 'price-high') list.sort((a, c) => wholesalePrice(c) - wholesalePrice(a));
    else if (sort === 'margin-high') list.sort((a, c) => marginFor(c, 'wholesale') - marginFor(a, 'wholesale'));
    else if (sort === 'newest') list.sort((a, c) => Number(c.id) - Number(a.id));
    document.querySelectorAll('[data-cat-name]').forEach((el) => { el.textContent = cat ? cat.name : 'All Categories'; });
    if (subheadingText) {
      const brandText = b ? ` from ${b}` : '';
      subheadingText.textContent = selectedCat
        ? `${list.length} products${brandText} in ${cat?.name || 'selected category'}`
        : `${list.length} products across all categories`;
    }
    document.title = `${cat ? cat.name : 'All Categories'} - Zaplin`;
    renderGrid(catGrid, list);
  };

  catSel?.addEventListener('change', () => {
    refreshBrands();
    apply();
  });
  brandSel?.addEventListener('change', apply);
  priceSel?.addEventListener('change', apply);
  searchInput?.addEventListener('input', apply);
  sortSel?.addEventListener('change', apply);
  refreshBrands();
  apply();
}

/* ==========================================================================
   SEARCH PAGE - ?q=<term>; empty term shows all products
   ========================================================================== */
const searchGrid = document.querySelector('[data-grid="search"]');
if (searchGrid) {
  const q = (params.get('q') || '').trim().toLowerCase();
  const heading = document.querySelector('[data-search-heading]');
  const list = !q ? PRODUCTS : PRODUCTS.filter((p) =>
    `${p.name} ${p.brand} ${p.sku} ${p.category}`.toLowerCase().includes(q));
  if (heading) heading.textContent = q ? `Results for "${params.get('q')}"` : 'All Products';
  renderGrid(searchGrid, list);
}

/* ==========================================================================
   PRODUCT DETAIL - ?id=<id> (defaults to Parle-G / 101)
   ========================================================================== */
const detail = document.querySelector('[data-product-detail]');
if (detail) {
  const id = params.get('id') || '101';
  const p = PMAP[String(id)] || PMAP['139'];
  if (p) {
    document.title = `${p.name} - Zaplin`;
    const set = (sel, val) => { const el = detail.querySelector(sel); if (el) el.textContent = val; };
    const img = detail.querySelector('[data-pd-img]');
    if (img) { img.src = p.image; img.alt = p.name; }
    set('[data-pd-eyebrow]', `${p.brand} - SKU ${p.sku}`);
    set('[data-pd-name]', p.name);
    set('[data-pd-mrp]', money(p.selling_mrp ?? p.mrp));
    set('[data-pd-trade]', money(p.trade));
    set('[data-pd-save]', `You Save ${money(p.mrp - p.trade)}`);
    set('[data-pd-wholesale]', money(p.trade));
    set('[data-pd-retail]', money(p.mrp));
    set('[data-pd-margin]', marginFor(p, 'wholesale'));
    set('[data-pd-margin-copy]', `Retail price is ${marginFor(p, 'wholesale')}% higher than wholesale price`);
    set('[data-pd-stock]', `${inventoryFor(p).qty} in stock`);
    set('[data-pd-sku]', p.sku);
    set('[data-pd-pack]', p.unit);
    set('[data-pd-scheme]', schemeText(p.scheme));
    set('[data-pd-unit]', `Unit: ${p.unit}. Weight: ${p.weight || '-'}.`);
    const stock = inventoryFor(p);
    const detailQty = detail.querySelector('[data-qty]');
    if (detailQty) detailQty.max = stock.qty;
    const crumbCat = detail.querySelector('[data-pd-crumb-cat]');
    if (crumbCat) {
      const c = CATEGORIES.find((x) => x.slug === p.category);
      crumbCat.textContent = c ? c.name : 'Products';
      crumbCat.href = `category-biscuits.html?cat=${p.category}`;
    }
    set('[data-pd-crumb-name]', p.name);
    const addBtn = detail.querySelector('[data-add-cart]');
    if (addBtn) {
      addBtn.dataset.addCart = p.id;
      addBtn.disabled = !stock.active || stock.qty <= 0;
      addBtn.textContent = addBtn.disabled ? 'Unavailable' : addBtn.textContent;
    }
    const brandSelect = detail.querySelector('[data-pd-brand]');
    if (brandSelect) {
      const brands = [...new Set(PRODUCTS.map((item) => item.brand))].sort();
      brandSelect.innerHTML = brands.map((brand) => `<option ${brand === p.brand ? 'selected' : ''}>${brand}</option>`).join('');
    }
    detail.querySelectorAll('[name="pd-price-view"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        const next = marginFor(p, radio.value);
        set('[data-pd-margin]', next);
        set('[data-pd-margin-copy]', radio.value === 'wholesale'
          ? `Retail price is ${next}% higher than wholesale price`
          : `Retail markup is ${next}% over wholesale price`);
        detail.querySelectorAll('[data-price-option]').forEach((option) => {
          option.classList.toggle('active', option.dataset.priceOption === radio.value);
        });
      });
    });
    bindAddToCart(detail);
  }
}

/* ==========================================================================
   CART PAGE - render from localStorage, edit qty, remove, live totals
   ========================================================================== */
const cartList = document.querySelector('[data-cart-list]');
function renderCart() {
  if (!cartList) return;
  const cart = getCart();
  const priceViews = getCartPriceViews();
  const ids = Object.keys(cart).filter((id) => PMAP[id] && Number(cart[id]) > 0);
  if (!ids.length) {
    cartList.innerHTML = '<p class="empty-state">Your cart is empty. <a href="search.html">Browse products</a>.</p>';
  } else {
    cartList.innerHTML = ids.map((id) => {
      const p = PMAP[id];
      const qty = Number(cart[id]);
      const view = priceViews[id] || 'wholesale';
      const unitPrice = priceForView(p, view);
      return `<article class="cart-item" data-id="${p.id}" data-price="${p.trade}">
        <img src="${p.image}" alt="${p.name}">
        <div><h3>${p.name}</h3><p>${p.brand} - ${view === 'retail' ? 'Retail Price' : 'Wholesale Price'} - ${schemeText(p.scheme)}</p></div>
        <div class="qty-row"><button data-cart-minus>-</button><input value="${qty}" data-cart-qty><button data-cart-plus>+</button></div>
        <strong>${money(unitPrice * qty)}</strong>
        <button data-remove-item title="Remove">&times;</button>
      </article>`;
    }).join('');
  }
  renderCartTotals();
  bindCartControls();
}

function renderCartTotals() {
  const { subtotal, scheme, delivery, grand } = cartTotals();
  const sub = document.querySelector('[data-subtotal]');
  const sch = document.querySelector('[data-scheme]');
  const del = document.querySelector('[data-delivery]');
  const grd = document.querySelector('[data-grand-total]');
  const sav = document.querySelector('[data-save-line]');
  if (sub) sub.textContent = money(subtotal);
  if (sch) sch.textContent = `-${money(scheme)}`;
  if (del) del.textContent = delivery ? money(delivery) : 'FREE';
  if (grd) grd.textContent = money(grand);
  if (sav) sav.textContent = scheme > 0 ? `You save ${money(scheme)} on this order` : '';
}

function bindCartControls() {
  document.querySelectorAll('.cart-item [data-cart-minus]').forEach((b) => {
    b.onclick = () => changeQty(b, -1);
  });
  document.querySelectorAll('.cart-item [data-cart-plus]').forEach((b) => {
    b.onclick = () => changeQty(b, +1);
  });
  document.querySelectorAll('.cart-item [data-cart-qty]').forEach((inp) => {
    inp.onchange = () => {
      const id = inp.closest('.cart-item').dataset.id;
      const cart = getCart();
      cart[id] = Math.max(1, Number(inp.value) || 1);
      setCart(cart); updateCartBadge(); renderCart();
    };
  });
  document.querySelectorAll('.cart-item [data-remove-item]').forEach((b) => {
    b.onclick = () => {
      const id = b.closest('.cart-item').dataset.id;
      const cart = getCart(); delete cart[id]; setCart(cart);
      const priceViews = getCartPriceViews(); delete priceViews[id]; setCartPriceViews(priceViews);
      updateCartBadge(); renderCart();
    };
  });
}
function changeQty(btn, delta) {
  const id = btn.closest('.cart-item').dataset.id;
  const cart = getCart();
  cart[id] = Math.max(1, Number(cart[id] || 1) + delta);
  setCart(cart); updateCartBadge(); renderCart();
}
if (cartList) renderCart();

/* ==========================================================================
   CHECKOUT - build the order, send to WhatsApp, save history, clear cart
   ========================================================================== */
/* ---- Coupon helpers ----------------------------------------------------- */
function getCoupons() {
  return remoteItems('coupons');
}

/**
 * Validate a coupon code against the Firestore coupons collection.
 * Returns { valid, coupon, discount, error } where discount is the rupee amount off.
 */
function validateCoupon(code, subtotal) {
  if (!code) return { valid: false, coupon: null, discount: 0, error: '' };
  const coupons = getCoupons();
  const coupon = coupons.find((c) => String(c.code || '').trim().toLowerCase() === code.toLowerCase());
  if (!coupon) return { valid: false, coupon: null, discount: 0, error: `Coupon "${code}" does not exist.` };
  if (coupon.active === false) return { valid: false, coupon, discount: 0, error: `Coupon "${code}" is no longer active.` };
  const minOrder = Number(coupon.minOrder || coupon.min_order || 0);
  if (minOrder > 0 && subtotal < minOrder) {
    return { valid: false, coupon, discount: 0, error: `Minimum order ${money(minOrder)} required for this coupon.` };
  }
  let discount = 0;
  if (coupon.type === 'percent' || coupon.discountType === 'percent') {
    const pct = Number(coupon.value || coupon.discount || 0);
    discount = Math.round((subtotal * pct) / 100);
    const cap = Number(coupon.maxDiscount || coupon.cap || 0);
    if (cap > 0) discount = Math.min(discount, cap);
  } else {
    discount = Number(coupon.value || coupon.discount || 0);
  }
  return { valid: true, coupon, discount, error: '' };
}

const checkoutSummary = document.querySelector('[data-checkout-summary]');
const checkoutCoupon = document.querySelector('[data-checkout-coupon]');
const couponError = (() => {
  if (!checkoutCoupon) return null;
  const el = document.createElement('p');
  el.style.cssText = 'color:var(--danger,#e53e3e);font-size:.85rem;margin:.25rem 0 0;min-height:1.2em';
  el.id = 'coupon-error-msg';
  checkoutCoupon.closest('label')?.after(el);
  return el;
})();

let appliedCouponDiscount = 0;   // rupee amount currently applied

/**
 * Extended cart totals that factor in a validated coupon discount.
 */
function cartTotalsWithCoupon(couponDiscount = 0) {
  const { subtotal, scheme, delivery } = cartTotals();
  const grand = Math.max(0, subtotal - scheme - couponDiscount + delivery);
  return { subtotal, scheme, delivery, grand, couponDiscount };
}

function renderCheckoutSummary() {
  if (!checkoutSummary) return;
  const cart = getCart();
  const priceViews = getCartPriceViews();
  const code = (checkoutCoupon?.value || '').trim();
  const { subtotal, scheme, delivery } = cartTotals();

  /* validate coupon and update inline error */
  let couponDiscount = 0;
  if (code) {
    const result = validateCoupon(code, subtotal - scheme);
    if (couponError) couponError.textContent = result.error;
    if (result.valid) couponDiscount = result.discount;
  } else {
    if (couponError) couponError.textContent = '';
  }
  appliedCouponDiscount = couponDiscount;

  const grand = Math.max(0, subtotal - scheme - couponDiscount + delivery);
  const rows = Object.keys(cart).filter((id) => PMAP[id]).map((id) => {
    const p = PMAP[id]; const qty = Number(cart[id]);
    const view = priceViews[id] || 'wholesale';
    const unitPrice = priceForView(p, view);
    return `<p><span>${p.name} × ${qty} <small>(${view === 'retail' ? 'Retail' : 'Wholesale'})</small></span><strong>${money(unitPrice * qty)}</strong></p>`;
  }).join('');
  const couponRow = code
    ? `<p class="save"><span>Coupon (${code})</span><strong>-${money(couponDiscount)}</strong></p>`
    : '';
  checkoutSummary.innerHTML = (rows || '<p class="empty-state">Cart is empty.</p>') +
    `<hr><p><span>Subtotal</span><strong>${money(subtotal)}</strong></p>` +
    `<p class="save"><span>Scheme Discount</span><strong>-${money(scheme)}</strong></p>` +
    couponRow +
    `<p><span>Delivery</span><strong>${delivery ? money(delivery) : 'FREE'}</strong></p>` +
    `<p class="grand"><span>Grand Total</span><strong>${money(grand)}</strong></p>`;
}
if (checkoutSummary) {
  renderCheckoutSummary();
  checkoutCoupon?.addEventListener('input', renderCheckoutSummary);
}


/* prefill name/phone/address from saved profile */
const prof = getProfile();
const nameField = document.querySelector('[data-checkout-name]');
const phoneField = document.querySelector('[data-checkout-phone]');
const addrField = document.querySelector('[data-checkout-address]');
if (nameField && prof.owner) nameField.value = prof.owner;
if (phoneField && prof.mobile) phoneField.value = prof.mobile;
if (addrField && prof.address) addrField.value = prof.address;

const placeOrder = document.querySelector('[data-place-order]');
if (placeOrder) {
  placeOrder.addEventListener('click', async () => {
    const cart = getCart();
    const ids = Object.keys(cart).filter((id) => PMAP[id] && Number(cart[id]) > 0);
    const confirmation = document.querySelector('[data-order-confirmation]');
    if (!ids.length) {
      if (confirmation) { confirmation.hidden = false; confirmation.textContent = 'Your cart is empty.'; }
      return;
    }
    const unavailable = ids.find((id) => {
      const stock = inventoryFor(PMAP[id]);
      return !stock.active || Number(cart[id]) > Number(stock.qty);
    });
    if (unavailable) {
      const product = PMAP[unavailable];
      const stock = inventoryFor(product);
      if (confirmation) {
        confirmation.hidden = false;
        confirmation.textContent = `${product.name} has only ${stock.qty} available. Please update your cart quantity.`;
      }
      return;
    }
    const name = (nameField?.value || '').trim();
    const phone = (phoneField?.value || '').trim();
    const address = (addrField?.value || '').trim();
    const salesRep = (document.querySelector('[data-checkout-sales-rep]')?.value || '').trim();
    const gstNo = (document.querySelector('[data-checkout-gst]')?.value || '').trim();
    const remarks = (document.querySelector('[data-checkout-remarks]')?.value || '').trim();
    const couponCode = (checkoutCoupon?.value || '').trim();
    if (!name || !phone || !address) {
      if (confirmation) { confirmation.hidden = false; confirmation.textContent = 'Please fill in name, phone and delivery address.'; }
      return;
    }
    const payment = document.querySelector('input[name="payment"]:checked')?.value || 'Cash on Delivery';
    const { subtotal, scheme, delivery, count } = cartTotals();

    /* re-validate coupon at submit time */
    const couponCode = (checkoutCoupon?.value || '').trim();
    let couponDiscount = 0;
    if (couponCode) {
      const result = validateCoupon(couponCode, subtotal - scheme);
      if (!result.valid) {
        if (confirmation) { confirmation.hidden = false; confirmation.textContent = result.error || 'Invalid coupon code. Please remove it or enter a valid one.'; }
        return;
      }
      couponDiscount = result.discount;
    }
    const grand = Math.max(0, subtotal - scheme - couponDiscount + delivery);
    const orderNo = 'ZPL' + Math.floor(10000 + Math.random() * 90000);

    /* build the WhatsApp message */
    let msg = `*New Order - Zaplin*\n`;
    msg += `Order Ref: #${orderNo}\n`;
    msg += `--------------------------------\n`;
    msg += `*Retailer:* ${name}\n*Phone:* ${phone}\n*Delivery Address:* ${address}\n`;
    if (salesRep) msg += `*Sales Representative:* ${salesRep}\n`;
    if (gstNo) msg += `*GST:* ${gstNo}\n`;
    if (couponCode) msg += `*Coupon Applied:* ${couponCode} (-${money(couponDiscount)})\n`;
    if (remarks) msg += `*Remarks:* ${remarks}\n`;
    msg += `--------------------------------\n*Items:*\n`;
    const priceViews = getCartPriceViews();
    ids.forEach((id, i) => {
      const p = PMAP[id]; const qty = Number(cart[id]);
      const view = priceViews[id] || 'wholesale';
      const unitPrice = priceForView(p, view);
      msg += `${i + 1}. ${p.name} (${p.sku}) × ${qty} [${view === 'retail' ? 'Retail' : 'Wholesale'}] = ${money(unitPrice * qty)}\n`;
    });
    msg += `--------------------------------\n`;
    msg += `Subtotal: ${money(subtotal)}\n`;
    if (scheme > 0) msg += `Scheme Discount: -${money(scheme)}\n`;
    if (couponDiscount > 0) msg += `Coupon Discount: -${money(couponDiscount)}\n`;
    msg += `Delivery: ${delivery ? money(delivery) : 'FREE'}\n`;
    msg += `*Grand Total: ${money(grand)}*\n`;
    msg += `Payment: ${payment}\n`;


    /* save to local order history */
    const orders = getOrders();
    orders.unshift({
      orderNo, date: new Date().toISOString().slice(0, 10),
      items: ids.map((id) => {
        const view = priceViews[id] || 'wholesale';
        return { name: PMAP[id].name, qty: Number(cart[id]), priceView: view, line: priceForView(PMAP[id], view) * Number(cart[id]) };
      }),
      itemCount: count, amount: grand, payment, name, phone, address, coupon: couponCode, couponDiscount, remarks,
      status: 'Order Placed',
    });
    setOrders(orders);
    ids.forEach((id) => {
      const current = inventoryFor(PMAP[id]);
      saveInventoryItem(id, { ...current, qty: current.qty - Number(cart[id]) });
    });

    /* open WhatsApp with the prefilled order */
    /* ── geo-tag: request GPS and append Maps link to order ── */
    let locationLine = '';
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 0
        });
      });
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      locationLine = `\n📍 *Delivery Location (GPS):* https://maps.google.com/?q=${lat},${lng}`;
    } catch (e) {
      // User denied location or timeout — order still proceeds without GPS line
    }
    msg += locationLine;
    /* ── end geo-tag ── */

    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');

    /* clear cart + confirm */
    setCart({});
    setCartPriceViews({});
    updateCartBadge();
    if (confirmation) {
      confirmation.hidden = false;
      confirmation.innerHTML = `Order <strong>#${orderNo}</strong> ready in WhatsApp - tap send to confirm with Zaplin. ` +
        `If WhatsApp didn't open, <a href="${url}" target="_blank">click here</a>.`;
    }
  });
}

/* ==========================================================================
   MY ORDERS - render local order history
   ========================================================================== */
const ordersBody = document.querySelector('[data-orders-body]');
if (ordersBody) {
  const orders = getOrders();
  ordersBody.innerHTML = orders.length ? orders.map((o) =>
    `<tr><td>#${o.orderNo}</td><td>${o.date}</td><td>${o.itemCount}</td><td>${money(o.amount)}</td>
      <td><span class="status status-processing">${o.status}</span></td>
      <td>${o.payment}</td></tr>`
  ).join('') : '<tr><td colspan="6" class="empty-state">No orders yet. Place your first order from the cart.</td></tr>';
}

/* ==========================================================================
   MY ACCOUNT - load + save profile (used to prefill checkout)
   ========================================================================== */
const accountForm = document.querySelector('[data-account-form]');
if (accountForm) {
  const p = getProfile();
  const fields = ['business', 'owner', 'mobile', 'email', 'gst', 'city', 'address', 'pincode'];
  fields.forEach((f) => {
    const el = accountForm.querySelector(`[data-acc="${f}"]`);
    if (el && p[f]) el.value = p[f];
  });
  const saveBtn = accountForm.querySelector('[data-save-profile]');
  saveBtn?.addEventListener('click', () => {
    const next = {};
    fields.forEach((f) => {
      const el = accountForm.querySelector(`[data-acc="${f}"]`);
      if (el) next[f] = el.value.trim();
    });
    setProfile(next);
    const note = accountForm.querySelector('[data-save-note]');
    if (note) { note.hidden = false; note.textContent = 'Profile saved'; }
  });
}

/* ==========================================================================
   QUICK ORDER - search-add rows, edit qty, totals, add all to cart
   ========================================================================== */
const qoBody = document.querySelector('[data-qo-body]');
if (qoBody) {
  const qoSearch = document.querySelector('[data-qo-search]');
  const qoResults = document.querySelector('[data-qo-results]');
  const rows = {}; // id -> qty

  const renderRows = () => {
    const ids = Object.keys(rows);
    qoBody.innerHTML = ids.length ? ids.map((id) => {
      const p = PMAP[id];
      return `<tr data-qo-row="${id}">
        <td>${p.name}</td><td>${money(p.mrp)}</td><td>${money(p.trade)}</td>
        <td><input value="${rows[id]}" data-qo-qty="${id}" style="width:64px"></td>
        <td>${money(p.trade * rows[id])}</td>
        <td><button data-qo-del="${id}">&times;</button></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty-state">Search above to add products.</td></tr>';

    qoBody.querySelectorAll('[data-qo-qty]').forEach((inp) => {
      inp.onchange = () => { rows[inp.dataset.qoQty] = Math.max(1, Number(inp.value) || 1); renderRows(); };
    });
    qoBody.querySelectorAll('[data-qo-del]').forEach((b) => {
      b.onclick = () => { delete rows[b.dataset.qoDel]; renderRows(); };
    });
    renderQoTotals();
  };

  const renderQoTotals = () => {
    let subtotal = 0, scheme = 0;
    Object.keys(rows).forEach((id) => {
      const p = PMAP[id]; subtotal += p.trade * rows[id]; scheme += lineScheme(p, rows[id]);
    });
    const delivery = (subtotal === 0 || subtotal > FREE_DELIVERY_OVER) ? 0 : DELIVERY_CHARGE;
    const set = (s, v) => { const el = document.querySelector(s); if (el) el.textContent = v; };
    set('[data-qo-subtotal]', money(subtotal));
    set('[data-qo-scheme]', `-${money(scheme)}`);
    set('[data-qo-delivery]', delivery ? money(delivery) : 'FREE');
    set('[data-qo-grand]', money(Math.max(0, subtotal - scheme + delivery)));
  };

  if (qoSearch && qoResults) {
    qoSearch.addEventListener('input', () => {
      const q = qoSearch.value.trim().toLowerCase();
      if (q.length < 2) { qoResults.hidden = true; return; }
      const matches = PRODUCTS.filter((p) =>
        `${p.name} ${p.brand} ${p.sku}`.toLowerCase().includes(q)).slice(0, 6);
      qoResults.innerHTML = matches.map((p) =>
        `<a data-qo-add="${p.id}">${p.name}<small> - ${p.sku}</small></a>`).join('');
      qoResults.hidden = !matches.length;
      qoResults.querySelectorAll('[data-qo-add]').forEach((a) => {
        a.onclick = () => {
          const id = a.dataset.qoAdd;
          rows[id] = (rows[id] || 0) + 1;
          qoResults.hidden = true; qoSearch.value = '';
          renderRows();
        };
      });
    });
  }

  const addAll = document.querySelector('[data-qo-add-all]');
  addAll?.addEventListener('click', (e) => {
    if (!Object.keys(rows).length) { e.preventDefault(); return; }
    const cart = getCart();
    Object.keys(rows).forEach((id) => { cart[id] = Number(cart[id] || 0) + rows[id]; });
    setCart(cart); updateCartBadge();
  });

  renderRows();
}

/* ==========================================================================
   ADMIN - show locally-placed orders so the shop can review them
   ========================================================================== */
const adminOrders = document.querySelector('[data-admin-orders]');
const adminStock = document.querySelector('[data-admin-stock]');
const adminCategories = document.querySelector('[data-admin-categories]');
const adminBanners = document.querySelector('[data-admin-banners]');
const adminBrands = document.querySelector('[data-admin-brands]');
const adminClients = document.querySelector('[data-admin-clients]');
const adminSaveState = document.querySelector('[data-admin-save-state]');

function flashAdminState(text = 'Saved') {
  if (!adminSaveState) return;
  adminSaveState.textContent = text;
  adminSaveState.classList.add('saved');
  setTimeout(() => adminSaveState.classList.remove('saved'), 900);
}

function categoryName(slug) {
  return getManagedCategories().find((c) => c.slug === slug)?.name || slug;
}

function categoryUnitType(slug) {
  return getManagedCategories().find((category) => category.slug === slug)?.unit_type
    || categoryUnitDefaults[slug]
    || 'packets';
}

function unitLabel(product) {
  return categoryUnitType(product.category);
}

function fillCategoryForm(category = {}) {
  const form = document.querySelector('[data-admin-category-form]');
  if (!form) return;
  const original = form.querySelector('[data-category-field="original-slug"]');
  const name = form.querySelector('[data-category-field="name"]');
  const unitType = form.querySelector('[data-category-field="unit_type"]');
  const active = form.querySelector('[data-category-field="active"]');
  const image = form.querySelector('[data-category-field="image"]');
  const preview = form.querySelector('[data-category-preview]');
  if (original) original.value = category.slug || '';
  if (name) name.value = category.name || '';
  if (unitType) unitType.value = category.unit_type || categoryUnitDefaults[category.slug] || 'packets';
  if (active) active.value = String(category.active !== false);
  if (image) image.value = '';
  form.dataset.removeImage = 'false';
  if (preview) {
    preview.src = category.image || '';
    preview.hidden = !category.image;
  }
}

async function categoryFormValues() {
  const form = document.querySelector('[data-admin-category-form]');
  const originalSlug = form?.querySelector('[data-category-field="original-slug"]')?.value || '';
  const name = form?.querySelector('[data-category-field="name"]')?.value.trim() || '';
  const active = form?.querySelector('[data-category-field="active"]')?.value !== 'false';
  const file = form?.querySelector('[data-category-field="image"]')?.files?.[0];
  const existing = getManagedCategories().find((category) => category.slug === originalSlug);
  const uploaded = await readImageFile(file, 1200, 'categories');
  const removeImage = form?.dataset.removeImage === 'true';
  return {
    originalSlug,
    category: {
      slug: originalSlug || slugify(name),
      name,
      image: removeImage ? '' : (uploaded || existing?.image || ''),
      active,
      unit_type: form?.querySelector('[data-category-field="unit_type"]')?.value || 'packets',
    },
  };
}

function renderAdminCategories() {
  if (!adminCategories) return;
  const categories = getManagedCategories();
  adminCategories.innerHTML = categories.length ? categories.map((category) => `
    <tr>
      <td>${category.image ? `<img class="admin-product-thumb" src="${escapeHtml(category.image)}" alt="${escapeHtml(category.name)}">` : '<span class="admin-image-empty">No image</span>'}</td>
      <td><strong>${category.name}</strong><small>${category.slug}</small></td>
      <td><span class="unit-type-badge">${category.unit_type || 'packets'}</span></td>
      <td><span class="status ${category.active !== false ? 'status-active' : 'status-suspended'}">${category.active !== false ? 'Active' : 'Inactive'}</span></td>
      <td class="admin-row-actions"><button data-edit-category="${category.slug}">Edit</button><button data-delete-category="${category.slug}">Delete</button></td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty-state">No categories found.</td></tr>';
  adminCategories.querySelectorAll('[data-edit-category]').forEach((button) => {
    button.addEventListener('click', () => {
      const category = getManagedCategories().find((item) => item.slug === button.dataset.editCategory);
      if (category) fillCategoryForm(category);
    });
  });
  adminCategories.querySelectorAll('[data-delete-category]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!confirm('Delete this category from the storefront?')) return;
      setManagedCategories(getManagedCategories().filter((item) => item.slug !== button.dataset.deleteCategory));
      syncManagedCategories();
      populateProductCategorySelect(true);
      renderAdminCategories();
      flashAdminState('Category deleted');
    });
  });
}

function fillBannerForm(banner = {}) {
  const form = document.querySelector('[data-admin-banner-form]');
  if (!form) return;
  const values = {
    id: banner.id || '',
    title: banner.title || '',
    subtitle: banner.subtitle || '',
    buttonText: banner.buttonText || '',
    buttonUrl: banner.buttonUrl || 'search.html',
    sortOrder: banner.sortOrder ?? getManagedBanners().length + 1,
    active: String(banner.active !== false),
  };
  Object.entries(values).forEach(([name, value]) => {
    const field = form.querySelector(`[data-banner-field="${name}"]`);
    if (field) field.value = value;
  });
  const image = form.querySelector('[data-banner-field="image"]');
  if (image) image.value = '';
  form.dataset.removeImage = 'false';
  const preview = form.querySelector('[data-banner-preview]');
  if (preview) {
    preview.src = banner.image || 'assets/img/zaplin-banner-glow.png';
    preview.hidden = false;
  }
}

async function bannerFormValues() {
  const form = document.querySelector('[data-admin-banner-form]');
  const value = (name) => form?.querySelector(`[data-banner-field="${name}"]`)?.value.trim() || '';
  const id = value('id');
  const existing = getManagedBanners().find((banner) => banner.id === id);
  const uploaded = await readImageFile(form?.querySelector('[data-banner-field="image"]')?.files?.[0], 1800, 'banners');
  return {
    id: id || `banner-${Date.now()}`,
    title: value('title'),
    subtitle: value('subtitle'),
    buttonText: value('buttonText'),
    buttonUrl: safeLink(value('buttonUrl'), 'search.html'),
    sortOrder: Number(value('sortOrder')) || 0,
    active: value('active') !== 'false',
    image: form?.dataset.removeImage === 'true' ? '' : (uploaded || existing?.image || ''),
  };
}

function renderAdminBanners() {
  if (!adminBanners) return;
  const banners = getManagedBanners().sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  adminBanners.innerHTML = banners.length ? banners.map((banner) => `
    <tr>
      <td>${banner.image ? `<img class="admin-banner-thumb" src="${escapeHtml(banner.image)}" alt="">` : '<span class="admin-image-empty">No image</span>'}</td>
      <td><strong>${escapeHtml(banner.title)}</strong><small>${escapeHtml(banner.subtitle || '')}</small></td>
      <td>${escapeHtml(banner.buttonText || '-')}</td>
      <td>${Number(banner.sortOrder || 0)}</td>
      <td><span class="status ${banner.active !== false ? 'status-active' : 'status-suspended'}">${banner.active !== false ? 'Active' : 'Inactive'}</span></td>
      <td class="admin-row-actions"><button data-edit-banner="${banner.id}">Edit</button><button data-delete-banner="${banner.id}">Delete</button></td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty-state">No banners found.</td></tr>';
  adminBanners.querySelectorAll('[data-edit-banner]').forEach((button) => {
    button.addEventListener('click', () => {
      const banner = getManagedBanners().find((item) => item.id === button.dataset.editBanner);
      if (banner) fillBannerForm(banner);
    });
  });
  adminBanners.querySelectorAll('[data-delete-banner]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!confirm('Delete this homepage banner?')) return;
      setManagedBanners(getManagedBanners().filter((item) => item.id !== button.dataset.deleteBanner));
      renderAdminBanners();
      fillBannerForm();
      flashAdminState('Banner deleted');
    });
  });
}

function fillBrandForm(brand = {}) {
  const form = document.querySelector('[data-admin-brand-form]');
  if (!form) return;
  const original = form.querySelector('[data-brand-field="original-name"]');
  const name = form.querySelector('[data-brand-field="name"]');
  const order = form.querySelector('[data-brand-field="sortOrder"]');
  const active = form.querySelector('[data-brand-field="active"]');
  const logo = form.querySelector('[data-brand-field="logo"]');
  const preview = form.querySelector('[data-brand-preview]');
  if (original) original.value = brand.name || '';
  if (name) name.value = brand.name || '';
  if (order) order.value = brand.sortOrder ?? getManagedBrands().length + 1;
  if (active) active.value = String(brand.active !== false);
  if (logo) logo.value = '';
  form.dataset.removeLogo = 'false';
  if (preview) {
    preview.src = brand.logo || 'assets/img/zaplin-logo.png';
    preview.hidden = !brand.logo;
  }
}

async function brandFormValues() {
  const form = document.querySelector('[data-admin-brand-form]');
  const value = (name) => form?.querySelector(`[data-brand-field="${name}"]`)?.value.trim() || '';
  const originalName = value('original-name');
  const existing = getManagedBrands().find((brand) => brand.name === originalName);
  const uploaded = await readImageFile(form?.querySelector('[data-brand-field="logo"]')?.files?.[0], 900, 'brands');
  return {
    originalName,
    brand: {
      name: value('name'),
      logo: form?.dataset.removeLogo === 'true' ? '' : (uploaded || existing?.logo || ''),
      active: value('active') !== 'false',
      sortOrder: Number(value('sortOrder')) || 0,
    },
  };
}

function renderAdminBrands() {
  if (!adminBrands) return;
  const brands = getManagedBrands().sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  adminBrands.innerHTML = brands.length ? brands.map((brand) => `
    <tr>
      <td>${brand.logo ? `<img class="admin-brand-thumb" src="${escapeHtml(brand.logo)}" alt="${escapeHtml(brand.name)}">` : `<span class="brand-text-logo">${escapeHtml(brand.name)}</span>`}</td>
      <td><strong>${escapeHtml(brand.name)}</strong></td>
      <td>${Number(brand.sortOrder || 0)}</td>
      <td><span class="status ${brand.active !== false ? 'status-active' : 'status-suspended'}">${brand.active !== false ? 'Active' : 'Inactive'}</span></td>
      <td class="admin-row-actions"><button data-edit-brand="${escapeHtml(brand.name)}">Edit</button><button data-delete-brand="${escapeHtml(brand.name)}">Delete</button></td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty-state">No brands found.</td></tr>';
  adminBrands.querySelectorAll('[data-edit-brand]').forEach((button) => {
    button.addEventListener('click', () => {
      const brand = getManagedBrands().find((item) => item.name === button.dataset.editBrand);
      if (brand) fillBrandForm(brand);
    });
  });
  adminBrands.querySelectorAll('[data-delete-brand]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!confirm('Remove this brand from Top Brands?')) return;
      setManagedBrands(getManagedBrands().filter((item) => item.name !== button.dataset.deleteBrand));
      renderAdminBrands();
      fillBrandForm();
      flashAdminState('Brand deleted');
    });
  });
}

const policyPageUrls = {
  privacy: 'privacy-policy.html',
  refund: 'refund-policy.html',
  shipping: 'shipping-delivery-policy.html',
  terms: 'terms-and-conditions.html',
};

function loadPolicyEditor() {
  const select = document.querySelector('[data-policy-select]');
  const editor = document.querySelector('[data-policy-editor]');
  const viewLink = document.querySelector('[data-view-policy]');
  if (!select || !editor) return;
  const key = select.value;
  const policy = getPolicies()[key];
  /* Sanitize stored HTML before rendering — prevents stored XSS from Firestore policy content */
  const rawContent = policy?.content || '<p>No policy content available.</p>';
  editor.innerHTML = (window.DOMPurify ? DOMPurify.sanitize(rawContent) : rawContent);
  if (viewLink) viewLink.href = policyPageUrls[key] || '#';
}

function renderPolicyPage() {
  const root = document.querySelector('[data-policy-page]');
  if (!root) return;
  const key = root.dataset.policyPage;
  const policy = getPolicies()[key];
  if (!policy) return;
  const title = root.querySelector('[data-policy-title]');
  const content = root.querySelector('[data-policy-content]');
  if (title) title.textContent = policy.title;
  if (content) {
    /* Sanitize stored HTML before rendering — prevents stored XSS from Firestore policy content */
    const rawContent = policy.content || '';
    content.innerHTML = window.DOMPurify ? DOMPurify.sanitize(rawContent) : rawContent;
  }
}

function seedClientsFromLocalData() {
  const clients = getClients();
  if (clients.length) return clients;
  const seeded = [];
  const profile = getProfile();
  if (profile.owner || profile.business || profile.mobile) {
    seeded.push({
      id: `CL${Date.now()}`,
      business: profile.business || profile.owner || 'Saved Account',
      owner: profile.owner || '',
      mobile: profile.mobile || '',
      city: profile.city || '',
      gst: profile.gst || '',
      credit: 0,
      status: 'Active',
    });
  }
  getOrders().forEach((order) => {
    if (!order.phone || seeded.some((client) => client.mobile === order.phone)) return;
    seeded.push({
      id: `CL${Date.now()}${seeded.length}`,
      business: order.name || 'Order Client',
      owner: order.name || '',
      mobile: order.phone || '',
      city: '',
      gst: '',
      credit: 0,
      status: 'Active',
    });
  });
  if (seeded.length) setClients(seeded);
  return seeded;
}

function renderAdminKpis() {
  if (!adminStock && !adminClients) return;
  const inventory = PRODUCTS.map(inventoryFor);
  const totalStock = inventory.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const lowStock = inventory.filter((item) => item.active && Number(item.qty || 0) <= Number(item.reorder || 0)).length;
  const setText = (selector, value) => {
    const el = document.querySelector(selector);
    if (el) el.textContent = value;
  };
  setText('[data-admin-total-products]', PRODUCTS.length);
  setText('[data-admin-total-stock]', totalStock.toLocaleString('en-IN'));
  setText('[data-admin-low-stock]', lowStock);
  setText('[data-admin-total-clients]', seedClientsFromLocalData().length);
}

function populateProductCategorySelect(force = false) {
  const select = document.querySelector('[data-product-field="category"]');
  if (!select || (select.dataset.ready && !force)) return;
  const current = select.value;
  select.innerHTML = CATEGORIES.map((cat) => `<option value="${cat.slug}">${cat.name}</option>`).join('');
  if (CATEGORIES.some((cat) => cat.slug === current)) select.value = current;
  select.dataset.ready = '1';
}

function updateProductUnitPlaceholder(categorySlug) {
  const unitInput = document.querySelector('[data-product-field="unit"]');
  if (!unitInput) return;
  const placeholders = {
    litres: 'e.g. 6 bottles x 1 ltr',
    bottles: 'e.g. 24 bottles x 200 ml',
    packets: 'e.g. 24 packets x 100 g',
  };
  unitInput.placeholder = placeholders[categoryUnitType(categorySlug)] || placeholders.packets;
}

function readImageFile(file, maxDimension = 1200, storageFolder = '') {
  if (!file) return Promise.resolve('');
  if (storageFolder && window.ZAPLIN_FIREBASE?.upload) {
    return window.ZAPLIN_FIREBASE.upload(storageFolder, file);
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const source = reader.result;
      if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
        resolve(source);
        return;
      }
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      image.onerror = () => resolve(source);
      image.src = source;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

function saveProductFields(id, fields) {
  const product = PMAP[String(id)];
  if (!product) return;
  const custom = getAdminProducts();
  const customIndex = custom.findIndex((item) => String(item.id) === String(id));
  if (customIndex >= 0) {
    custom[customIndex] = { ...custom[customIndex], ...fields };
    setAdminProducts(custom);
  } else {
    const overrides = getProductOverrides();
    overrides[String(id)] = { ...(overrides[String(id)] || {}), ...fields };
    setProductOverrides(overrides);
  }
  Object.assign(product, fields);
  rebuildProductMap();
  remoteWrite(window.ZAPLIN_FIREBASE?.save('products', id, product));
}

function fillProductForm(product = {}) {
  const form = document.querySelector('[data-admin-product-form]');
  if (!form) return;
  const values = {
    id: product.id || '',
    productNumber: product.productNumber || product.id || '',
    name: product.name || '',
    sku: product.sku || '',
    brand: product.brand || '',
    category: product.category || CATEGORIES[0]?.slug || '',
    selling_mrp: product.selling_mrp ?? product.mrp ?? '',
    mrp: product.mrp ?? '',
    trade: product.trade ?? '',
    marginPercentage: product.mrp ? `${Math.max(0, Math.round(((Number(product.mrp) - Number(product.trade || 0)) / Number(product.mrp)) * 100))}%` : '0%',
    unit: product.unit || '',
    description: product.description || '',
    stock: product.id ? inventoryFor(product).qty : '',
    reorder: product.id ? inventoryFor(product).reorder : '',
    active: product.id ? String(inventoryFor(product).active) : 'true',
  };
  Object.entries(values).forEach(([name, value]) => {
    const field = form.querySelector(`[data-product-field="${name}"]`);
    if (field) field.value = value;
  });
  const imageField = form.querySelector('[data-product-field="image"]');
  if (imageField) imageField.value = '';
  const preview = form.querySelector('[data-product-preview]');
  if (preview) preview.src = product.image || 'assets/img/aloo-bhujia-wholesale-pack.svg';
  updateProductUnitPlaceholder(values.category);
}

async function productFormValues() {
  const form = document.querySelector('[data-admin-product-form]');
  const value = (name) => form?.querySelector(`[data-product-field="${name}"]`)?.value.trim() || '';
  const id = value('id');
  const existing = id ? PMAP[String(id)] : null;
  const imageField = form?.querySelector('[data-product-field="image"]');
  const uploadedImage = await readImageFile(imageField?.files?.[0], 1200, 'products');
  const sellingMrp = Number(value('selling_mrp')) || 0;
  const mrp = Number(value('mrp')) || 0;
  const trade = Number(value('trade')) || 0;
  const nextId = id || `ADM-${Date.now()}`;
  return {
    product: {
      id: nextId,
      productNumber: value('productNumber') || nextId,
      slug: existing?.slug || slugify(`${value('brand')} ${value('name')} ${nextId}`),
      name: value('name'),
      brand: value('brand'),
      category: value('category'),
      sku: value('sku'),
      selling_mrp: sellingMrp,
      mrp,
      trade,
      unit: value('unit') || '1 pack',
      description: value('description'),
      weight: existing?.weight || value('unit') || '1 pack',
      discountPct: mrp ? Math.max(0, Math.round(((mrp - trade) / mrp) * 100)) : 0,
      marginPack: Math.max(0, mrp - trade),
      scheme: existing?.scheme || null,
      image: uploadedImage || existing?.image || 'assets/img/aloo-bhujia-wholesale-pack.svg',
    },
    stock: {
      qty: Number(value('stock')) || 0,
      reorder: Number(value('reorder')) || 0,
      active: value('active') !== 'false',
    },
    isExisting: Boolean(existing),
  };
}

function deleteAdminProduct(id) {
  const custom = getAdminProducts().filter((product) => String(product.id) !== String(id));
  setAdminProducts(custom);
  const deleted = [...new Set([...getDeletedProducts().map(String), String(id)])];
  setDeletedProducts(deleted);
  const index = PRODUCTS.findIndex((product) => String(product.id) === String(id));
  if (index >= 0) PRODUCTS.splice(index, 1);
  delete PMAP[String(id)];
  remoteWrite(window.ZAPLIN_FIREBASE?.remove('products', id), 'Product deleted');
  renderAdminStock();
  renderAdminKpis();
  updateCartBadge();
  flashAdminState('Product deleted');
}

function renderAdminStock() {
  if (!adminStock) return;
  const query = (document.querySelector('[data-admin-stock-search]')?.value || '').trim().toLowerCase();
  const rows = PRODUCTS.filter((product) => {
    if (!query) return true;
    return String(product.sku || '').toLowerCase() === query
      || String(product.productNumber || product.id || '').toLowerCase() === query;
  });
  adminStock.innerHTML = rows.length ? rows.map((product) => {
    const item = inventoryFor(product);
    const isLow = item.active && Number(item.qty) <= Number(item.reorder);
    return `<tr data-stock-row="${product.id}">
      <td><img class="admin-product-thumb" src="${product.image}" alt="${product.name}"></td>
      <td><strong>${product.name}</strong><small>${product.brand}</small></td>
      <td>${product.sku}</td>
      <td>${categoryName(product.category)}</td>
      <td><input type="number" min="0" step="0.01" value="${product.selling_mrp || 0}" data-price-selling-mrp="${product.id}"></td>
      <td><input type="number" min="0" step="0.01" value="${product.mrp}" data-price-mrp="${product.id}"></td>
      <td><input type="number" min="0" step="0.01" value="${product.trade}" data-price-trade="${product.id}"></td>
      <td><input type="text" value="${escapeHtml(product.unit || '')}" data-pack-unit="${product.id}" aria-label="Pack contains for ${escapeHtml(product.name)}"></td>
      <td><input type="number" min="0" value="${item.qty}" data-stock-qty="${product.id}"></td>
      <td><input type="number" min="0" value="${item.reorder}" data-stock-reorder="${product.id}"></td>
      <td><select data-stock-active="${product.id}">
        <option value="true" ${item.active ? 'selected' : ''}>Active</option>
        <option value="false" ${!item.active ? 'selected' : ''}>Inactive</option>
      </select><span class="stock-chip ${isLow ? 'low' : 'ok'}">${isLow ? 'Low' : 'OK'}</span></td>
      <td class="admin-row-actions"><button data-edit-product="${product.id}">Edit</button><button data-delete-product="${product.id}">Delete</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="12" class="empty-state">No Product Found</td></tr>';

  adminStock.querySelectorAll('[data-price-selling-mrp], [data-price-mrp], [data-price-trade], [data-pack-unit], [data-stock-qty], [data-stock-reorder], [data-stock-active]').forEach((field) => {
    field.addEventListener('change', () => {
      const id = field.dataset.priceSellingMrp || field.dataset.priceMrp || field.dataset.priceTrade || field.dataset.packUnit || field.dataset.stockQty || field.dataset.stockReorder || field.dataset.stockActive;
      const row = adminStock.querySelector(`[data-stock-row="${id}"]`);
      saveProductFields(id, {
        selling_mrp: Number(row.querySelector('[data-price-selling-mrp]').value) || 0,
        mrp: Number(row.querySelector('[data-price-mrp]').value) || 0,
        trade: Number(row.querySelector('[data-price-trade]').value) || 0,
        unit: row.querySelector('[data-pack-unit]').value.trim() || '1 pack',
        discountPct: Number(row.querySelector('[data-price-mrp]').value)
          ? Math.max(0, Math.round(((Number(row.querySelector('[data-price-mrp]').value) - Number(row.querySelector('[data-price-trade]').value)) / Number(row.querySelector('[data-price-mrp]').value)) * 100))
          : 0,
        marginPack: Math.max(0, (Number(row.querySelector('[data-price-mrp]').value) || 0) - (Number(row.querySelector('[data-price-trade]').value) || 0)),
      });
      saveInventoryItem(id, {
        qty: row.querySelector('[data-stock-qty]').value,
        reorder: row.querySelector('[data-stock-reorder]').value,
        active: row.querySelector('[data-stock-active]').value === 'true',
      });
      renderAdminStock();
      renderAdminKpis();
      flashAdminState('Stock saved');
    });
  });
  adminStock.querySelectorAll('[data-edit-product]').forEach((button) => {
    button.addEventListener('click', () => {
      const product = PMAP[String(button.dataset.editProduct)];
      if (product) fillProductForm(product);
    });
  });
  adminStock.querySelectorAll('[data-delete-product]').forEach((button) => {
    button.addEventListener('click', () => {
      if (confirm('Delete this product from the local catalog?')) deleteAdminProduct(button.dataset.deleteProduct);
    });
  });
}

function clientFormValues() {
  const form = document.querySelector('[data-admin-client-form]');
  const value = (name) => form?.querySelector(`[data-client-field="${name}"]`)?.value.trim() || '';
  return {
    id: value('id') || `CL${Date.now()}`,
    business: value('business'),
    owner: value('owner'),
    mobile: value('mobile'),
    city: value('city'),
    gst: value('gst'),
    credit: Number(value('credit')) || 0,
    status: value('status') || 'Active',
  };
}

function fillClientForm(client = {}) {
  const form = document.querySelector('[data-admin-client-form]');
  if (!form) return;
  ['id', 'business', 'owner', 'mobile', 'city', 'gst', 'credit', 'status'].forEach((name) => {
    const field = form.querySelector(`[data-client-field="${name}"]`);
    if (field) field.value = client[name] ?? (name === 'status' ? 'Active' : '');
  });
}

function renderAdminClients() {
  if (!adminClients) return;
  const query = (document.querySelector('[data-admin-client-search]')?.value || '').trim().toLowerCase();
  const clients = seedClientsFromLocalData().filter((client) =>
    `${client.business} ${client.owner} ${client.mobile} ${client.city} ${client.gst}`.toLowerCase().includes(query)
  );
  adminClients.innerHTML = clients.length ? clients.map((client) =>
    `<tr data-client-row="${client.id}">
      <td><strong>${client.business}</strong><small>${client.gst || 'No GST'}</small></td>
      <td>${client.owner}</td>
      <td>${client.mobile}</td>
      <td>${client.city || '-'}</td>
      <td>${money(client.credit)}</td>
      <td><span class="status status-${String(client.status).toLowerCase()}">${client.status}</span></td>
      <td class="admin-row-actions"><button data-edit-client="${client.id}">Edit</button><button data-delete-client="${client.id}">Delete</button></td>
    </tr>`
  ).join('') : '<tr><td colspan="7" class="empty-state">No clients yet. Add your first retailer above.</td></tr>';

  adminClients.querySelectorAll('[data-edit-client]').forEach((button) => {
    button.addEventListener('click', () => {
      const client = getClients().find((item) => item.id === button.dataset.editClient);
      if (client) fillClientForm(client);
    });
  });
  adminClients.querySelectorAll('[data-delete-client]').forEach((button) => {
    button.addEventListener('click', () => {
      setClients(getClients().filter((client) => client.id !== button.dataset.deleteClient));
      renderAdminClients();
      renderAdminKpis();
      flashAdminState('Client deleted');
    });
  });
}

if (adminOrders) {
  const orders = getOrders();
  adminOrders.innerHTML = orders.length ? orders.map((o) =>
    `<tr><td>#${o.orderNo}</td><td>${o.date}</td><td>${o.name}</td><td>${o.phone}</td>
      <td>${money(o.amount)}</td><td>${o.status}</td></tr>`
  ).join('') : '<tr><td colspan="6" class="empty-state">No orders placed on this device yet.</td></tr>';
}

if (adminStock || adminClients || adminCategories || adminBanners || adminBrands || document.querySelector('[data-policy-editor]')) {
  seedClientsFromLocalData();
  populateProductCategorySelect();
  renderAdminKpis();
  renderAdminStock();
  renderAdminCategories();
  renderAdminBanners();
  renderAdminBrands();
  renderAdminClients();
  loadPolicyEditor();

  document.querySelector('[data-admin-stock-search]')?.addEventListener('input', renderAdminStock);
  document.querySelector('[data-admin-client-search]')?.addEventListener('input', renderAdminClients);
  document.querySelector('[data-admin-reset-stock]')?.addEventListener('click', () => {
    localStorage.removeItem('zaplin_inventory');
    renderAdminStock();
    renderAdminKpis();
    flashAdminState('Stock reset');
  });

  document.querySelector('[data-admin-product-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const { product, stock, isExisting } = await productFormValues();
    if (!product.name || !product.sku || !product.brand || !product.category) return;
    if (isExisting) {
      saveProductFields(product.id, product);
    } else {
      const custom = getAdminProducts();
      custom.unshift(product);
      setAdminProducts(custom);
      PRODUCTS.unshift(product);
      rebuildProductMap();
      remoteWrite(window.ZAPLIN_FIREBASE?.save('products', product.id, { ...product, ...stock }));
    }
    saveInventoryItem(product.id, stock);
    fillProductForm();
    renderAdminStock();
    renderAdminKpis();
    flashAdminState('Product saved');
  });
  document.querySelector('[data-admin-product-clear]')?.addEventListener('click', () => fillProductForm());
  document.querySelector('[data-product-field="category"]')?.addEventListener('change', (event) => {
    updateProductUnitPlaceholder(event.target.value);
  });
  document.querySelector('[data-product-field="image"]')?.addEventListener('change', async (event) => {
    const preview = document.querySelector('[data-product-preview]');
    const image = await readImageFile(event.target.files?.[0]);
    if (preview && image) preview.src = image;
  });

  document.querySelector('[data-category-field="image"]')?.addEventListener('change', async (event) => {
    const form = document.querySelector('[data-admin-category-form]');
    const preview = document.querySelector('[data-category-preview]');
    const image = await readImageFile(event.target.files?.[0]);
    if (form) form.dataset.removeImage = 'false';
    if (preview && image) {
      preview.src = image;
      preview.hidden = false;
    }
  });
  document.querySelector('[data-remove-category-image]')?.addEventListener('click', () => {
    const form = document.querySelector('[data-admin-category-form]');
    const preview = document.querySelector('[data-category-preview]');
    if (form) form.dataset.removeImage = 'true';
    if (preview) {
      preview.removeAttribute('src');
      preview.hidden = true;
    }
  });
  document.querySelector('[data-admin-category-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const { originalSlug, category } = await categoryFormValues();
    if (!category.name || !category.slug) return;
    const categories = getManagedCategories();
    const index = categories.findIndex((item) => item.slug === originalSlug);
    if (index >= 0) categories[index] = category;
    else categories.push(category);
    setManagedCategories(categories);
    syncManagedCategories();
    populateProductCategorySelect(true);
    fillCategoryForm();
    renderAdminCategories();
    flashAdminState('Category saved');
  });
  document.querySelector('[data-admin-category-clear]')?.addEventListener('click', () => fillCategoryForm());

  document.querySelector('[data-banner-field="image"]')?.addEventListener('change', async (event) => {
    const form = document.querySelector('[data-admin-banner-form]');
    const preview = document.querySelector('[data-banner-preview]');
    const image = await readImageFile(event.target.files?.[0], 1800);
    if (form) form.dataset.removeImage = 'false';
    if (preview && image) {
      preview.src = image;
      preview.hidden = false;
    }
  });
  document.querySelector('[data-remove-banner-image]')?.addEventListener('click', () => {
    const form = document.querySelector('[data-admin-banner-form]');
    const preview = document.querySelector('[data-banner-preview]');
    if (form) form.dataset.removeImage = 'true';
    if (preview) {
      preview.removeAttribute('src');
      preview.hidden = true;
    }
  });
  document.querySelector('[data-admin-banner-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const banner = await bannerFormValues();
    if (!banner.title) return;
    const banners = getManagedBanners();
    const index = banners.findIndex((item) => item.id === banner.id);
    if (index >= 0) banners[index] = banner;
    else banners.push(banner);
    setManagedBanners(banners);
    fillBannerForm();
    renderAdminBanners();
    flashAdminState('Banner saved');
  });
  document.querySelector('[data-admin-banner-clear]')?.addEventListener('click', () => fillBannerForm());

  document.querySelector('[data-brand-field="logo"]')?.addEventListener('change', async (event) => {
    const form = document.querySelector('[data-admin-brand-form]');
    const preview = document.querySelector('[data-brand-preview]');
    const logo = await readImageFile(event.target.files?.[0], 900);
    if (form) form.dataset.removeLogo = 'false';
    if (preview && logo) {
      preview.src = logo;
      preview.hidden = false;
    }
  });
  document.querySelector('[data-remove-brand-logo]')?.addEventListener('click', () => {
    const form = document.querySelector('[data-admin-brand-form]');
    const preview = document.querySelector('[data-brand-preview]');
    if (form) form.dataset.removeLogo = 'true';
    if (preview) {
      preview.removeAttribute('src');
      preview.hidden = true;
    }
  });
  document.querySelector('[data-admin-brand-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const { originalName, brand } = await brandFormValues();
    if (!brand.name) return;
    const brands = getManagedBrands();
    const index = brands.findIndex((item) => item.name === originalName);
    if (index >= 0) brands[index] = brand;
    else if (!brands.some((item) => item.name.toLowerCase() === brand.name.toLowerCase())) brands.push(brand);
    setManagedBrands(brands);
    fillBrandForm();
    renderAdminBrands();
    flashAdminState('Brand saved');
  });
  document.querySelector('[data-admin-brand-clear]')?.addEventListener('click', () => fillBrandForm());

  document.querySelector('[data-policy-select]')?.addEventListener('change', loadPolicyEditor);
  document.querySelectorAll('[data-editor-command]').forEach((button) => {
    button.addEventListener('click', () => {
      document.execCommand(button.dataset.editorCommand, false);
      document.querySelector('[data-policy-editor]')?.focus();
    });
  });
  document.querySelectorAll('[data-editor-format]').forEach((button) => {
    button.addEventListener('click', () => {
      document.execCommand('formatBlock', false, button.dataset.editorFormat);
      document.querySelector('[data-policy-editor]')?.focus();
    });
  });
  document.querySelector('[data-save-policy]')?.addEventListener('click', () => {
    const select = document.querySelector('[data-policy-select]');
    const editor = document.querySelector('[data-policy-editor]');
    if (!select || !editor) return;
    const defaults = window.ZAPLIN_DEFAULT_POLICIES || {};
    const saved = getPolicies();
    saved[select.value] = {
      ...(defaults[select.value] || {}),
      ...(saved[select.value] || {}),
      content: editor.innerHTML,
    };
    setPolicies(saved);
    flashAdminState('Policy saved');
  });

  document.querySelector('[data-admin-client-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const next = clientFormValues();
    if (!next.business || !next.owner || !next.mobile) return;
    const clients = getClients();
    const index = clients.findIndex((client) => client.id === next.id);
    if (index >= 0) clients[index] = next;
    else clients.unshift(next);
    setClients(clients);
    fillClientForm();
    renderAdminClients();
    renderAdminKpis();
    flashAdminState('Client saved');
  });
  document.querySelector('[data-admin-client-clear]')?.addEventListener('click', () => fillClientForm());
}

/* ==========================================================================
   GLOBAL: top search autocomplete + initial badge + product tabs
   ========================================================================== */
const searchInput = document.querySelector('[data-autocomplete]');
const searchResults = document.querySelector('[data-autocomplete-results]');
if (searchInput && searchResults) {
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (q.length < 2) { searchResults.hidden = true; return; }
    const data = PRODUCTS.filter((p) =>
      `${p.name} ${p.brand} ${p.sku}`.toLowerCase().includes(q)).slice(0, 6);
    searchResults.innerHTML = data.map((p) =>
      `<a href="product-parle-g.html?id=${p.id}">${p.name}<small> - ${p.sku}</small></a>`).join('');
    searchResults.hidden = !data.length;
  });
}

document.querySelectorAll('[data-tabs]').forEach((tabs) => {
  tabs.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.querySelectorAll('[data-tab]').forEach((i) => i.classList.remove('active'));
      tabs.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = true; });
      tab.classList.add('active');
      const panel = tabs.querySelector(`[data-panel="${tab.dataset.tab}"]`);
      if (panel) panel.hidden = false;
    });
  });
});

function injectSiteFooter() {
  const pageShell = document.querySelector('.page-shell');
  if (!pageShell || document.body.classList.contains('auth-body') || location.pathname.endsWith('admin.html')) return;
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `
    <div class="site-footer-inner">
      <div class="footer-brand"><img src="assets/img/zaplin-logo.png" alt="Zaplin"><p>Saara Samaan Ek Jagah Se</p></div>
      <nav aria-label="Policy links">
        <strong>Policies</strong>
        <a href="privacy-policy">Privacy Policy</a>
        <a href="refund-policy">Refund Policy</a>
        <a href="shipping-delivery-policy">Shipping &amp; Delivery Policy</a>
        <a href="terms-and-conditions">Terms &amp; Conditions</a>
      </nav>
      <div class="footer-customer-care">
        <strong>Customer Care</strong>
        <a href="tel:+919797561691" aria-label="Call Zaplin customer care at plus 91 97975 61691">
          <span class="footer-phone-icon" aria-hidden="true">☎</span>
          <span>+91 97975 61691</span>
        </a>
        <small>Support for orders and deliveries</small>
      </div>
    </div>`;
  pageShell.appendChild(footer);
}

renderPolicyPage();
injectSiteFooter();
bindAddToCart(document);
bindPriceViews(document);
updateCartBadge();

document.querySelectorAll('img').forEach((image) => {
  if (!image.hasAttribute('loading')) image.loading = 'lazy';
  image.decoding = 'async';
});

window.addEventListener('zaplin-firebase-update', () => {
  location.reload();
});

