import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  collection, deleteDoc, doc, getDoc, getDocs, getFirestore, onSnapshot,
  serverTimestamp, setDoc, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js';

const config = window.ZAPLIN_FIREBASE_CONFIG;
const app = getApps()[0] || initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const sharedCollections = ['products', 'categories', 'brands', 'banners', 'coupons', 'deals', 'policies', 'homepage', 'settings'];
const cacheKey = (name) => `zaplin_firebase_cache_${name}`;
const parse = (value, fallback = []) => {
  try { return JSON.parse(value || JSON.stringify(fallback)); } catch (_) { return fallback; }
};
const clean = (value) => JSON.parse(JSON.stringify(value, (_, item) => item === undefined ? null : item));
const idFor = (item, field = 'id') => String(item?.[field] || item?.id || item?.slug || item?.code || item?.name || crypto.randomUUID());
let refreshTimer;
const scheduleRefresh = (name, items) => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    window.dispatchEvent(new CustomEvent('zaplin-firebase-update', { detail: { collection: name, items } }));
  }, 500);
};

window.ZAPLIN_FIREBASE_APP = app;
window.ZAPLIN_FIREBASE_AUTH = auth;
window.ZAPLIN_FIREBASE_DB = db;
window.ZAPLIN_FIREBASE_STORAGE = storage;

const authReady = new Promise((resolve) => {
  onAuthStateChanged(auth, async (user) => {
    let isAdmin = false;
    if (user) {
      try {
        const admin = await getDoc(doc(db, 'admins', user.uid));
        isAdmin = admin.exists() && admin.data().active !== false;
      } catch (error) {
        console.error('Admin authorization check failed:', error);
      }
    }
    window.ZAPLIN_CURRENT_USER = user || null;
    window.ZAPLIN_IS_ADMIN = isAdmin;
    resolve({ user, isAdmin });
    window.dispatchEvent(new CustomEvent('zaplin-auth-ready', { detail: { user, isAdmin } }));
  });
});

async function save(name, id, data) {
  if (!window.ZAPLIN_IS_ADMIN) throw new Error('Only an authorized administrator can make this change.');
  await setDoc(doc(db, name, String(id)), { ...clean(data), updatedAt: serverTimestamp() }, { merge: true });
}

async function saveOrder(order) {
  if (!auth.currentUser) throw new Error('Please sign in before placing an order.');
  const id = String(order.orderNo || order.id || crypto.randomUUID());
  await setDoc(doc(db, 'orders', id), { ...clean(order), id, userId: auth.currentUser.uid, updatedAt: serverTimestamp() }, { merge: true });
}

async function remove(name, id) {
  if (!window.ZAPLIN_IS_ADMIN) throw new Error('Only an authorized administrator can make this change.');
  await deleteDoc(doc(db, name, String(id)));
}

async function replaceCollection(name, items, idField = 'id') {
  if (!window.ZAPLIN_IS_ADMIN) throw new Error('Only an authorized administrator can make this change.');
  const existing = await getDocs(collection(db, name));
  const incoming = new Set(items.map((item) => idFor(item, idField)));
  let batch = writeBatch(db);
  let count = 0;
  const commit = async () => {
    if (!count) return;
    await batch.commit();
    batch = writeBatch(db);
    count = 0;
  };
  for (const snapshot of existing.docs) {
    if (!incoming.has(snapshot.id)) {
      batch.delete(snapshot.ref);
      count += 1;
      if (count >= 400) await commit();
    }
  }
  for (const item of items) {
    const id = idFor(item, idField);
    batch.set(doc(db, name, id), { ...clean(item), id, updatedAt: serverTimestamp() }, { merge: true });
    count += 1;
    if (count >= 400) await commit();
  }
  await commit();
}

async function upload(folder, file, id = crypto.randomUUID()) {
  if (!window.ZAPLIN_IS_ADMIN) throw new Error('Only an authorized administrator can upload images.');
  const extension = (file.name.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const target = ref(storage, `${folder}/${id}-${Date.now()}.${extension}`);
  await uploadBytes(target, file, { contentType: file.type || 'application/octet-stream' });
  return getDownloadURL(target);
}

async function migrateImage(folder, source, id) {
  if (!String(source || '').startsWith('data:image/')) return source || '';
  const response = await fetch(source);
  const blob = await response.blob();
  const extension = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const target = ref(storage, `${folder}/${id}-${Date.now()}.${extension}`);
  await uploadBytes(target, blob, { contentType: blob.type });
  return getDownloadURL(target);
}

async function migrateLocalData() {
  if (!window.ZAPLIN_IS_ADMIN) throw new Error('Only an authorized administrator can migrate data.');
  const marker = await getDoc(doc(db, 'settings', 'localMigration'));
  if (marker.exists() && marker.data().completed) throw new Error('Local data migration has already been completed.');
  const inventory = parse(localStorage.getItem('zaplin_inventory'), {});
  const overrides = parse(localStorage.getItem('zaplin_product_overrides'), {});
  const customProducts = parse(localStorage.getItem('zaplin_admin_products'), []);
  const deleted = new Set(parse(localStorage.getItem('zaplin_deleted_products'), []).map(String));
  const mergedProducts = [...(window.ZAPLIN_PRODUCTS || []), ...customProducts]
    .filter((item, index, all) => !deleted.has(String(item.id)) && all.findIndex((entry) => String(entry.id) === String(item.id)) === index)
    .map((item) => ({ ...item, ...(overrides[String(item.id)] || {}), ...(inventory[String(item.id)] || {}) }));
  const mappings = [
    ['categories', 'zaplin_managed_categories', 'slug'],
    ['banners', 'zaplin_managed_banners', 'id'],
    ['brands', 'zaplin_managed_brands', 'name'],
    ['coupons', 'zaplin_admin_coupons', 'code'],
  ];
  const counts = { products: mergedProducts.length };
  for (const product of mergedProducts) product.image = await migrateImage('products', product.image, product.id);
  await replaceCollection('products', mergedProducts, 'id');
  for (const [name, key, idField] of mappings) {
    let items = parse(localStorage.getItem(key), []);
    const imageField = name === 'brands' ? 'logo' : 'image';
    const folder = name === 'brands' ? 'brands' : name;
    for (const item of items) {
      if (item[imageField]) item[imageField] = await migrateImage(folder, item[imageField], idFor(item, idField));
    }
    if (Array.isArray(items) && items.length) await replaceCollection(name, items, idField);
    counts[name] = Array.isArray(items) ? items.length : 0;
  }
  await setDoc(doc(db, 'settings', 'localMigration'), {
    completed: true, completedAt: serverTimestamp(), completedBy: auth.currentUser?.uid || '', counts,
  });
  return counts;
}

window.ZAPLIN_FIREBASE = { authReady, save, saveOrder, remove, replaceCollection, upload, migrateLocalData, signOut: () => signOut(auth) };

sharedCollections.forEach((name) => {
  onSnapshot(collection(db, name), (snapshot) => {
    const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    const previous = localStorage.getItem(cacheKey(name));
    const next = JSON.stringify(items);
    localStorage.setItem(cacheKey(name), next);
    window.ZAPLIN_FIREBASE_CACHE = window.ZAPLIN_FIREBASE_CACHE || {};
    window.ZAPLIN_FIREBASE_CACHE[name] = items;
    if (previous !== next) scheduleRefresh(name, items);
  }, (error) => console.error(`Firestore ${name} listener failed:`, error));
});

if (location.pathname.endsWith('/admin.html') || location.pathname.endsWith('admin.html')) {
  authReady.then(({ user, isAdmin }) => {
    if (!user || !isAdmin) location.replace(`login.html?next=admin.html&reason=admin`);
    if (isAdmin) {
      onSnapshot(collection(db, 'orders'), (snapshot) => {
        const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        const previous = localStorage.getItem(cacheKey('orders'));
        const next = JSON.stringify(items);
        localStorage.setItem(cacheKey('orders'), next);
        if (previous !== next) scheduleRefresh('orders', items);
      });
    }
  });
}
