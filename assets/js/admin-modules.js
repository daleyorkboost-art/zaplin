(() => {
  const parse = (key) => {
    try { return JSON.parse(localStorage.getItem(`zaplin_firebase_cache_${key}`) || '[]'); } catch (_) { return []; }
  };
  const api = () => window.ZAPLIN_FIREBASE;
  const message = (text) => {
    const state = document.querySelector('[data-admin-save-state]');
    if (state) state.textContent = text;
  };
  const value = (form, name) => form?.querySelector(`[data-field="${name}"]`)?.value.trim() || '';
  const dateValue = (form, name) => {
    const result = value(form, name);
    return result ? new Date(result).toISOString() : '';
  };
  const activeDeal = () => {
    const now = Date.now();
    return parse('deals').find((deal) => deal.active !== false
      && (!deal.startAt || new Date(deal.startAt).getTime() <= now)
      && (!deal.endAt || new Date(deal.endAt).getTime() > now));
  };

  function renderCoupons() {
    const body = document.querySelector('[data-coupon-rows]');
    if (!body) return;
    const coupons = parse('coupons');
    body.innerHTML = coupons.length ? coupons.map((coupon) => `
      <tr><td><strong>${coupon.code}</strong></td><td>${coupon.type}</td><td>${coupon.value}</td>
      <td>${coupon.expiryDate || '-'}</td><td>${coupon.active !== false ? 'Active' : 'Disabled'}</td>
      <td class="admin-row-actions"><button data-edit-coupon="${coupon.id}">Edit</button><button data-delete-coupon="${coupon.id}">Delete</button></td></tr>
    `).join('') : '<tr><td colspan="6" class="empty-state">No coupons found.</td></tr>';
    body.querySelectorAll('[data-edit-coupon]').forEach((button) => button.onclick = () => {
      const coupon = coupons.find((item) => item.id === button.dataset.editCoupon);
      const form = document.querySelector('[data-coupon-form]');
      Object.entries(coupon || {}).forEach(([key, val]) => {
        const field = form?.querySelector(`[data-field="${key}"]`);
        if (field) field.value = String(val);
      });
    });
    body.querySelectorAll('[data-delete-coupon]').forEach((button) => button.onclick = async () => {
      if (!confirm('Delete this coupon?')) return;
      await api().remove('coupons', button.dataset.deleteCoupon);
      message('Coupon deleted');
    });
  }

  function bindCoupons() {
    const form = document.querySelector('[data-coupon-form]');
    if (!form) return;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const code = value(form, 'code').toUpperCase();
      const id = value(form, 'id') || code;
      await api().save('coupons', id, {
        id, code, type: value(form, 'type'), value: Number(value(form, 'value')) || 0,
        expiryDate: value(form, 'expiryDate'), active: value(form, 'active') !== 'false',
      });
      form.reset();
      message('Coupon synced');
    };
    renderCoupons();
  }

  function renderDeals() {
    const body = document.querySelector('[data-deal-rows]');
    if (!body) return;
    const deals = parse('deals');
    body.innerHTML = deals.length ? deals.map((deal) => `
      <tr><td>${deal.productName || deal.productId}</td><td>${deal.dealPrice}</td><td>${deal.startAt ? new Date(deal.startAt).toLocaleString() : '-'}</td>
      <td>${deal.endAt ? new Date(deal.endAt).toLocaleString() : '-'}</td><td>${deal.active !== false ? 'Active' : 'Disabled'}</td>
      <td class="admin-row-actions"><button data-edit-deal="${deal.id}">Edit</button><button data-delete-deal="${deal.id}">Delete</button></td></tr>
    `).join('') : '<tr><td colspan="6" class="empty-state">No deals found.</td></tr>';
    body.querySelectorAll('[data-delete-deal]').forEach((button) => button.onclick = async () => {
      if (!confirm('Delete this deal?')) return;
      await api().remove('deals', button.dataset.deleteDeal);
      message('Deal deleted');
    });
    body.querySelectorAll('[data-edit-deal]').forEach((button) => button.onclick = () => {
      const deal = deals.find((item) => item.id === button.dataset.editDeal);
      const form = document.querySelector('[data-deal-form]');
      if (!deal || !form) return;
      Object.entries(deal).forEach(([key, val]) => {
        const field = form.querySelector(`[data-field="${key}"]`);
        if (!field) return;
        field.value = field.type === 'datetime-local' && val ? String(val).slice(0, 16) : String(val);
      });
    });
  }

  function bindDeals() {
    const form = document.querySelector('[data-deal-form]');
    const select = form?.querySelector('[data-field="productId"]');
    if (!form || !select) return;
    select.innerHTML = '<option value="">Select product</option>' + (window.ZAPLIN_PRODUCTS || []).map((product) =>
      `<option value="${product.id}">${product.name} - ${product.sku}</option>`).join('');
    form.onsubmit = async (event) => {
      event.preventDefault();
      const product = window.ZAPLIN_PRODUCT_MAP?.[value(form, 'productId')];
      const id = value(form, 'id') || `deal-${Date.now()}`;
      await api().save('deals', id, {
        id, productId: value(form, 'productId'), productName: product?.name || '',
        dealPrice: Number(value(form, 'dealPrice')) || 0, startAt: dateValue(form, 'startAt'),
        endAt: dateValue(form, 'endAt'), active: value(form, 'active') !== 'false', countdown: true,
      });
      form.reset();
      message('Deal synced');
    };
    renderDeals();
  }

  function bindMigration() {
    const button = document.querySelector('[data-migrate-local]');
    if (!button) return;
    button.onclick = async () => {
      if (!confirm('Migrate this browser local data to Firestore? This can only be completed once.')) return;
      button.disabled = true;
      message('Migrating local data...');
      try {
        const counts = await api().migrateLocalData();
        message(`Migration complete: ${Object.values(counts).reduce((sum, count) => sum + count, 0)} records`);
      } catch (error) {
        message(error.message || 'Migration failed');
      } finally {
        button.disabled = false;
      }
    };
  }

  function renderHomepageDeal() {
    if (!document.querySelector('[data-grid="deals"]')) return;
    const deal = activeDeal();
    if (!deal) return;
    const product = window.ZAPLIN_PRODUCT_MAP?.[String(deal.productId)];
    if (!product) return;
    const section = document.createElement('section');
    section.className = 'section-block';
    section.dataset.activeDeal = deal.id;
    section.innerHTML = `<div class="section-heading"><div><p class="eyebrow">Limited Time</p><h2>Deal of the Day</h2></div><strong data-deal-countdown></strong></div>
      <article class="deal-feature"><img loading="lazy" src="${product.image}" alt="${product.name}"><div><h3>${product.name}</h3><p>${product.brand}</p><strong>Deal Price: &#8377;${Number(deal.dealPrice).toLocaleString('en-IN')}</strong><a class="primary-action" href="product-parle-g.html?id=${product.id}">View Product</a></div></article>`;
    document.querySelector('[data-grid="deals"]').closest('.section-block')?.before(section);
    const timer = section.querySelector('[data-deal-countdown]');
    const tick = () => {
      const seconds = Math.max(0, Math.floor((new Date(deal.endAt).getTime() - Date.now()) / 1000));
      const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
      const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
      const s = String(seconds % 60).padStart(2, '0');
      timer.textContent = `${h}:${m}:${s}`;
      if (!seconds) section.remove();
    };
    tick();
    setInterval(tick, 1000);
  }

  function start() {
    bindCoupons();
    bindDeals();
    bindMigration();
    renderHomepageDeal();
    window.addEventListener('zaplin-auth-ready', (event) => {
      message(event.detail?.isAdmin ? 'Firebase connected - authorized admin' : 'Checking admin authorization...');
    });
    api()?.authReady?.then(({ isAdmin }) => message(isAdmin ? 'Firebase connected - authorized admin' : 'Checking admin authorization...'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
