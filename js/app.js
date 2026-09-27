/* ============================================================
   miki shop — логика приложения
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- Helpers ---------------- */

  const NBSP = '\u00A0';
  const money = (n) => Math.round(n).toLocaleString('ru-RU') + NBSP + '\u20BD';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function plural(n, forms) {
    const n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return forms[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1];
    return forms[2];
  }

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* Короткий уникальный идентификатор для публикаций и профиля. */
  function uid() {
    return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* Блокировка прокрутки. Класс ставится и на html, и на body:
     overflow у body иначе не блокирует прокрутку страницы. */
  function setLocked(on) {
    document.documentElement.classList.toggle('is-locked', on);
    document.body.classList.toggle('is-locked', on);
  }

  /* ---------------- Хранилище ---------------- */

  const CART_KEY = 'miki-shop-cart-v1';
  const LISTINGS_KEY = 'miki-shop-listings-v1';
  const PROFILE_KEY = 'miki-shop-profile-v1';

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const data = JSON.parse(raw);
      return data == null ? fallback : data;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- Профиль и товары пользователей ---------------- */

  /* Встроенного каталога нет. Единственный источник товаров —
     публикации, которые пользователи выставили сами. */

  /* Профиль: стабильный id (кто именно выставил товар) и имя, под которым
     пользователя видят покупатели. */
  function loadProfile() {
    const raw = readJSON(PROFILE_KEY, null);
    const id = raw && typeof raw.id === 'string' && /^u[a-z0-9]{4,}$/.test(raw.id) ? raw.id : uid();
    const name = raw && typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '';
    const profile = { id, name: name || 'Продавец' };
    if (!raw || raw.id !== profile.id) writeJSON(PROFILE_KEY, profile);
    return profile;
  }

  const profile = loadProfile();

  let listings = normalizeListings(readJSON(LISTINGS_KEY, []));

  function normalizeListings(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p) => p && typeof p === 'object' && p.id && p.name)
      .map((p) => {
        const name = String(p.name).slice(0, 70);
        const image = typeof p.image === 'string' && p.image.startsWith('data:') ? p.image : '';
        return {
          id: String(p.id),
          name,
          desc: String(p.desc || '').slice(0, 800),
          price: Math.max(1, Math.round(Number(p.price) || 1)),
          category: SELL_CATEGORIES.includes(p.category) ? p.category : 'Другое',
          condition: CONDITIONS.includes(p.condition) ? p.condition : 'Хорошее',
          /* Если фото нет (в т.ч. в данных из прошлых версий) — заглушка. */
          image: image || placeholderImage(name),
          seller: String(p.seller || 'Продавец').trim().slice(0, 40) || 'Продавец',
          /* Кто выставил товар: пусто у публикаций из прошлых версий. */
          ownerId: typeof p.ownerId === 'string' ? p.ownerId : '',
          createdAt: Number(p.createdAt) || Date.now()
        };
      });
  }

  /* Публикации, сделанные до появления ownerId, считаем своими. */
  (function claimLegacy() {
    let changed = false;
    listings.forEach((p) => {
      if (!p.ownerId) { p.ownerId = profile.id; changed = true; }
    });
    if (changed) saveListings();
  })();

  function saveListings() {
    return writeJSON(LISTINGS_KEY, listings);
  }

  /* Товар мой, если выставил его текущий пользователь. */
  function isMine(p) {
    return !!p && p.ownerId === profile.id;
  }

  function myListings() {
    return listings.filter(isMine);
  }

  /* Витрина = все опубликованные товары. */
  function allProducts() {
    return listings.slice();
  }

  function productById(id) {
    return listings.find((p) => p.id === id) || null;
  }

  /* Категории строим из публикаций — пустые фильтры не показываем. */
  function categoryList() {
    const used = new Set(listings.map((p) => p.category));
    const known = SELL_CATEGORIES.filter((c) => used.has(c));
    const extra = Array.from(used).filter((c) => !SELL_CATEGORIES.includes(c));
    return [ALL_TOGETHER].concat(known, extra);
  }

  /* ---------------- Состояние ---------------- */

  const state = {
    query: '',
    category: ALL_TOGETHER,
    sort: 'new',
    cart: {},
    detailId: null,
    editingId: null
  };

  function loadCart() {
    const data = readJSON(CART_KEY, {});
    if (!data || typeof data !== 'object') return {};
    const clean = {};
    for (const [id, qty] of Object.entries(data)) {
      const n = Math.floor(Number(qty));
      if (productById(id) && n > 0) clean[id] = Math.min(n, 99);
    }
    return clean;
  }

  function saveCart() {
    writeJSON(CART_KEY, state.cart);
  }

  state.cart = loadCart();

  /* ---------------- DOM ---------------- */

  const el = {
    grid: $('#grid'),
    empty: $('#emptyState'),
    emptyIcon: $('#emptyIcon'),
    emptyTitle: $('#emptyTitle'),
    emptyText: $('#emptyText'),
    emptySell: $('#emptySell'),
    cats: $('#catsRow'),
    catsNav: $('#catsNav'),
    search: $('#searchInput'),
    searchForm: $('#searchForm'),
    searchClear: $('#searchClear'),
    sort: $('#sortSelect'),
    resultCount: $('#resultCount'),
    catalogTitle: $('#catalogTitle'),
    heroCount: $('#heroCount'),
    heroSellers: $('#heroSellers'),
    heroMine: $('#heroMine'),
    heroSell: $('#heroSell'),
    cartOpen: $('#cartOpen'),
    cartCount: $('#cartCount'),
    drawer: $('#drawer'),
    drawerBody: $('#drawerBody'),
    drawerCount: $('#drawerCount'),
    drawerFoot: $('#drawerFoot'),
    overlay: $('#overlay'),
    cartClose: $('#cartClose'),
    footQty: $('#footQty'),
    footTotal: $('#footTotal'),
    footSellers: $('#footSellers'),
    checkout: $('#checkout'),
    checkoutTotal: $('#checkoutTotal'),
    clearCart: $('#clearCart'),
    modal: $('#modal'),
    modalClose: $('#modalClose'),
    orderNumber: $('#orderNumber'),
    modalItems: $('#modalItems'),
    copyOrder: $('#copyOrder'),
    toasts: $('#toasts'),
    reset: $('#resetFilters'),

    sellOpen: $('#sellOpen'),
    sellModal: $('#sellModal'),
    sellForm: $('#sellForm'),
    sellClose: $('#sellClose'),
    sellCancel: $('#sellCancel'),
    sellTitle: $('#sellTitle'),
    sellName: $('#sellName'),
    sellDesc: $('#sellDesc'),
    sellDescCount: $('#sellDescCount'),
    sellPrice: $('#sellPrice'),
    sellCategory: $('#sellCategory'),
    sellCondition: $('#sellCondition'),
    sellSeller: $('#sellSeller'),
    sellPhoto: $('#sellPhoto'),
    sellPhotoPreview: $('#sellPhotoPreview'),
    sellPhotoClear: $('#sellPhotoClear'),
    sellSubmit: $('#sellSubmit'),
    sellError: $('#sellError'),

    pmModal: $('#productModal'),
    pmClose: $('#pmClose'),
    pmImage: $('#pmImage'),
    pmCategory: $('#pmCategory'),
    pmName: $('#pmName'),
    pmMeta: $('#pmMeta'),
    pmSeller: $('#pmSeller'),
    pmCondition: $('#pmCondition'),
    pmDesc: $('#pmDesc'),
    pmPrice: $('#pmPrice'),
    pmAdd: $('#pmAdd'),

    mineOpen: $('#mineOpen'),
    mineCount: $('#mineCount'),
    myDrawer: $('#myDrawer'),
    myBody: $('#myBody'),
    myCount: $('#myCount'),
    myName: $('#myName'),
    myClose: $('#myClose'),
    mySellBtn: $('#mySellBtn')
  };

  /* ---------------- Категории ---------------- */

  function renderCats() {
    const products = allProducts();
    const chips = categoryList().map((cat) => {
      const n = cat === ALL_TOGETHER
        ? products.length
        : products.filter((p) => p.category === cat).length;
      if (n === 0) return '';
      const active = cat === state.category ? ' is-active' : '';
      return '<button class="chip' + active + '" type="button" data-cat="' + esc(cat) + '">' +
        esc(cat) + '<span class="chip__n">' + n + '</span></button>';
    }).join('');
    el.cats.innerHTML = chips;
    /* Нет товаров — нет и фильтров. */
    el.catsNav.hidden = !chips;
  }

  el.cats.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.category = chip.dataset.cat;
    renderCats();
    renderGrid();
  });

  /* ---------------- Каталог ---------------- */

  const DAY = 86400000;

  /* Рейтингов и отзывов у пользовательских товаров нет, поэтому вместо
     выдуманных звёзд показываем, когда товар появился на витрине. */
  function publishedLine(p) {
    const days = Math.max(0, Math.floor((Date.now() - (p.createdAt || 0)) / DAY));
    let text;
    if (days === 0) text = 'сегодня';
    else if (days === 1) text = 'вчера';
    else if (days < 5) text = days + ' ' + plural(days, ['день', 'дня', 'дней']) + ' назад';
    else {
      try {
        text = new Date(p.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      } catch (e) {
        text = 'недавно';
      }
    }
    return 'Опубликовано ' + text;
  }

  function getVisible() {
    const q = state.query.trim().toLowerCase();
    const list = allProducts().filter((p) => {
      const byCat = state.category === ALL_TOGETHER || p.category === state.category;
      if (!byCat) return false;
      if (!q) return true;
      return (p.name + ' ' + p.category + ' ' + (p.desc || '') + ' ' + (p.seller || ''))
        .toLowerCase().includes(q);
    });

    const sorters = {
      'new': (a, b) => b.createdAt - a.createdAt,
      'price-asc': (a, b) => a.price - b.price,
      'price-desc': (a, b) => b.price - a.price,
      'name': (a, b) => String(a.name).localeCompare(String(b.name), 'ru')
    };
    return list.sort(sorters[state.sort] || sorters.new);
  }

  function cardHTML(p, i) {
    const own = isMine(p) ? '<span class="card__own">Ваш товар</span>' : '';
    const cond = '<span class="cond" data-c="' + esc(p.condition) + '">' + esc(p.condition) + '</span>';

    return '' +
      '<article class="card" data-product="' + esc(p.id) + '"' +
        ' style="animation-delay:' + Math.min(i * 35, 400) + 'ms">' +
        '<div class="card__media" data-detail="' + esc(p.id) + '" role="button" tabindex="0"' +
          ' aria-label="Карточка товара: ' + esc(p.name) + '">' +
          '<img src="' + esc(p.image) + '" alt="' + esc(p.name) + '" loading="lazy"' +
            ' width="400" height="400">' +
          cond + own +
        '</div>' +
        '<div class="card__body">' +
          '<span class="card__cat">' + esc(p.category) + '</span>' +
          '<h3 class="card__title" data-detail="' + esc(p.id) + '">' + esc(p.name) + '</h3>' +
          '<div class="card__meta">' + publishedLine(p) + '</div>' +
          '<div class="card__meta"><span class="card__seller">' +
            'Продавец: <b>' + esc(p.seller) + '</b>' +
          '</span></div>' +
          '<div class="card__prices"><span class="price">' + money(p.price) + '</span></div>' +
          '<button class="btn btn--primary" type="button" data-add="' + esc(p.id) + '">' +
            'Добавить в корзину' +
          '</button>' +
        '</div>' +
      '</article>';
  }

  function renderHero() {
    el.heroCount.textContent = listings.length;
    el.heroSellers.textContent = new Set(listings.map((p) => p.seller)).size;
    el.heroMine.textContent = myListings().length;
  }

  function renderGrid() {
    const list = getVisible();

    el.grid.innerHTML = list.map(cardHTML).join('');
    el.empty.hidden = list.length > 0;
    el.grid.hidden = list.length === 0;

    /* Два разных пустых состояния: каталог пуст или ничего не найдено. */
    const emptyCatalog = listings.length === 0;
    el.emptyIcon.textContent = emptyCatalog ? '📦' : '🔍';
    el.emptyTitle.textContent = emptyCatalog ? 'Каталог пока пуст' : 'Ничего не найдено';
    el.emptyText.textContent = emptyCatalog
      ? 'Ни один товар ещё не выставлен. Станьте первым продавцом — ваш товар сразу появится в общем каталоге.'
      : 'Попробуйте изменить запрос или выбрать другую категорию.';
    el.resetFilters.hidden = emptyCatalog;
    el.emptySell.hidden = !emptyCatalog;

    const n = list.length;
    el.resultCount.textContent = n + ' ' + plural(n, ['товар', 'товара', 'товаров']);
    el.sort.disabled = listings.length === 0;

    let title = state.category;
    if (state.query.trim()) title = 'Поиск: «' + state.query.trim() + '»';
    el.catalogTitle.textContent = title;

    renderHero();
  }

  /* ---------------- Поиск ---------------- */

  let searchTimer = null;

  function onSearch(value) {
    state.query = value;
    el.searchClear.hidden = !value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderGrid, 90);
  }

  el.search.addEventListener('input', (e) => onSearch(e.target.value));

  el.searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    onSearch(el.search.value);
    $('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  el.searchClear.addEventListener('click', () => {
    el.search.value = '';
    onSearch('');
    el.search.focus();
  });

  el.sort.addEventListener('change', (e) => {
    state.sort = e.target.value;
    renderGrid();
  });

  el.reset.addEventListener('click', () => {
    state.query = '';
    state.category = ALL_TOGETHER;
    state.sort = 'new';
    el.search.value = '';
    el.searchClear.hidden = true;
    el.sort.value = 'new';
    renderCats();
    renderGrid();
  });

  /* ---------------- Корзина ---------------- */

  function cartEntries() {
    return Object.entries(state.cart)
      .map(([id, qty]) => ({ product: productById(id), qty }))
      .filter((e) => e.product);
  }

  function totals() {
    let qty = 0, sum = 0;
    const sellers = new Set();
    for (const { product, qty: q } of cartEntries()) {
      qty += q;
      sum += product.price * q;
      sellers.add(product.seller);
    }
    return { qty, sum, sellers: sellers.size };
  }

  function addToCart(id) {
    const product = productById(id);
    if (!product) return;
    const current = state.cart[id] || 0;
    if (current >= 99) {
      toast('\u041c\u0430\u043a\u0441\u0438\u043c\u0443\u043c 99 \u0448\u0442. \u043d\u0430 \u0442\u043e\u0432\u0430\u0440', 'info');
      return;
    }
    state.cart[id] = current + 1;
    saveCart();
    syncCart();

    const btn = document.querySelector('[data-add="' + id + '"]');
    if (btn) {
      btn.classList.add('is-added');
      btn.textContent = '\u2713 \u0412 \u043a\u043e\u0440\u0437\u0438\u043d\u0435';
      clearTimeout(btn._t);
      btn._t = setTimeout(() => {
        btn.classList.remove('is-added');
        btn.textContent = '\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0432 \u043a\u043e\u0440\u0437\u0438\u043d\u0443';
      }, 1400);
    }
    if (el.pmAdd && state.detailId === id) {
      el.pmAdd.classList.add('is-added');
      el.pmAdd.textContent = '\u2713 \u0412 \u043a\u043e\u0440\u0437\u0438\u043d\u0435';
      clearTimeout(el.pmAdd._t);
      el.pmAdd._t = setTimeout(() => {
        el.pmAdd.classList.remove('is-added');
        el.pmAdd.textContent = '\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0432 \u043a\u043e\u0440\u0437\u0438\u043d\u0443';
      }, 1400);
    }
    toast('\u0414\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u043e: ' + product.name);
  }

  el.grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (btn) { addToCart(btn.dataset.add); return; }
    const link = e.target.closest('[data-detail]');
    if (link) openProduct(link.dataset.detail);
  });

  el.grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const link = e.target.closest('[data-detail]');
    if (!link) return;
    e.preventDefault();
    openProduct(link.dataset.detail);
  });

  function changeQty(id, delta) {
    const next = (state.cart[id] || 0) + delta;
    if (next <= 0) {
      delete state.cart[id];
    } else {
      state.cart[id] = Math.min(next, 99);
    }
    saveCart();
    syncCart();
  }

  function removeItem(id) {
    const product = productById(id);
    delete state.cart[id];
    saveCart();
    syncCart();
    toast((product ? product.name : '\u0422\u043e\u0432\u0430\u0440') +
      ' \u2014 \u0443\u0434\u0430\u043b\u0435\u043d\u043e \u0438\u0437 \u043a\u043e\u0440\u0437\u0438\u043d\u044b', 'info');
  }

  function clearCart() {
    if (!Object.keys(state.cart).length) return;
    state.cart = {};
    saveCart();
    syncCart();
    toast('\u041a\u043e\u0440\u0437\u0438\u043d\u0430 \u043e\u0447\u0438\u0449\u0435\u043d\u0430', 'info');
  }

  el.clearCart.addEventListener('click', clearCart);

  el.drawerBody.addEventListener('click', (e) => {
    const plus = e.target.closest('[data-inc]');
    const minus = e.target.closest('[data-dec]');
    const del = e.target.closest('[data-del]');
    if (plus) changeQty(plus.dataset.inc, +1);
    else if (minus) changeQty(minus.dataset.dec, -1);
    else if (del) removeItem(del.dataset.del);
  });

  /* ---------------- Отрисовка корзины ---------------- */

  function itemHTML(product, qty) {
    return '' +
      '<div class="item">' +
        '<div class="item__media"><img src="' + esc(product.image) + '" alt="' +
          esc(product.name) + '" width="82" height="82"></div>' +
        '<div>' +
          '<span class="item__cat">' + esc(product.category) + '</span>' +
          '<h4 class="item__title">' + esc(product.name) + '</h4>' +
          '<div class="item__price">' + money(product.price) + ' / шт</div>' +
          '<div class="item__seller">Продавец: ' + esc(product.seller) + '</div>' +
          '<div class="item__row">' +
            '<div class="qty">' +
              '<button type="button" data-dec="' + esc(product.id) + '"' +
                ' aria-label="Уменьшить количество">−</button>' +
              '<span class="qty__value">' + qty + '</span>' +
              '<button type="button" data-inc="' + esc(product.id) + '"' +
                ' aria-label="Увеличить количество">+</button>' +
            '</div>' +
            '<span class="item__sum">' + money(product.price * qty) + '</span>' +
            '<button class="item__remove" type="button" data-del="' + esc(product.id) + '">' +
              'Убрать</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderCart() {
    const entries = cartEntries();
    const t = totals();

    el.drawerBody.innerHTML = entries.length
      ? entries.map(({ product, qty }) => itemHTML(product, qty)).join('')
      : '<div class="cart-empty">' +
          '<div class="cart-empty__icon">\uD83D\uDED2</div>' +
          '<h3>\u041a\u043e\u0440\u0437\u0438\u043d\u0430 \u043f\u0443\u0441\u0442\u0430</h3>' +
          '<p>\u0414\u043e\u0431\u0430\u0432\u044c\u0442\u0435 \u0442\u043e\u0432\u0430\u0440\u044b \u0438\u0437 \u043a\u0430\u0442\u0430\u043b\u043e\u0433\u0430, \u0447\u0442\u043e\u0431\u044b \u043e\u0444\u043e\u0440\u043c\u0438\u0442\u044c \u0437\u0430\u043a\u0430\u0437.</p>' +
        '</div>';

    el.drawerCount.textContent = t.qty;
    el.footQty.textContent = t.qty;
    el.footTotal.textContent = money(t.sum);
    el.footSellers.textContent = t.sellers;
    el.checkoutTotal.textContent = money(t.sum);
    el.checkout.disabled = t.qty === 0;
    el.clearCart.hidden = t.qty === 0;
  }

  function syncCart() {
    const { qty } = totals();
    el.cartCount.textContent = qty;
    el.cartCount.dataset.empty = qty === 0 ? 'true' : 'false';
    el.cartOpen.classList.remove('bump');
    void el.cartOpen.offsetWidth;
    el.cartOpen.classList.add('bump');
    renderCart();
  }

  /* ---------------- Панели (корзина и «Мои товары») ---------------- */

  const PANELS = {
    cart: { node: el.drawer, focus: el.cartClose },
    mine: { node: el.myDrawer, focus: el.myClose }
  };
  let openPanel = null;

  function openCart() {
    closePanel(true);
    el.drawer.hidden = false;
    el.overlay.hidden = false;
    el.drawer.classList.remove('is-closing');
    openPanel = 'cart';
    setLocked(true);
    el.cartClose.focus();
  }

  function openMine() {
    closePanel(true);
    renderMine();
    el.myDrawer.hidden = false;
    el.overlay.hidden = false;
    el.myDrawer.classList.remove('is-closing');
    openPanel = 'mine';
    setLocked(true);
    el.myClose.focus();
  }

  function closePanel(instant) {
    if (!openPanel) return;
    const node = PANELS[openPanel].node;
    openPanel = null;
    el.overlay.hidden = true;
    if (instant) {
      node.hidden = true;
      node.classList.remove('is-closing');
      unlockIfIdle();
      return;
    }
    node.classList.add('is-closing');
    setTimeout(() => {
      node.hidden = true;
      node.classList.remove('is-closing');
      unlockIfIdle();
    }, 260);
    setLocked(false);
  }

  el.cartOpen.addEventListener('click', openCart);
  el.cartClose.addEventListener('click', () => closePanel(false));
  el.mineOpen.addEventListener('click', openMine);
  el.myClose.addEventListener('click', () => closePanel(false));
  el.overlay.addEventListener('click', () => closePanel(false));

  /* ---------------- Карточка товара ---------------- */

  function openProduct(id) {
    const p = productById(id);
    if (!p) return;
    state.detailId = id;

    el.pmImage.src = p.image;
    el.pmImage.alt = p.name;
    el.pmCategory.textContent = p.category;
    el.pmName.textContent = p.name;
    el.pmMeta.textContent = publishedLine(p);
    el.pmSeller.innerHTML = 'Продавец: <b>' + esc(p.seller) + '</b>' +
      (isMine(p) ? ' <span class="detail__own">· это вы</span>' : '');
    el.pmDesc.textContent = p.desc || 'Описание не указано продавцом.';
    el.pmPrice.textContent = money(p.price);
    el.pmCondition.textContent = p.condition || '';
    el.pmCondition.hidden = !p.condition;
    el.pmAdd.classList.remove('is-added');
    el.pmAdd.textContent = '\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0432 \u043a\u043e\u0440\u0437\u0438\u043d\u0443';

    el.pmModal.hidden = false;
    setLocked(true);
    el.pmClose.focus();
  }

  function closeProduct() {
    el.pmModal.hidden = true;
    state.detailId = null;
    unlockIfIdle();
  }

  el.pmClose.addEventListener('click', closeProduct);
  el.pmModal.addEventListener('click', (e) => { if (e.target === el.pmModal) closeProduct(); });
  el.pmAdd.addEventListener('click', () => {
    if (state.detailId) addToCart(state.detailId);
  });

  /* ---------------- Публикация товара ---------------- */

  let formPhoto = '';

  /* Фото уменьшаем до 640px и жмём в JPEG — иначе base64 быстро
     переполнит квоту localStorage. */
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('decode'));
        img.onload = () => {
          const max = 640;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.78));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function initials(name) {
    const words = String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return (words.length ? words.map((w) => w[0]).join('') : 'MI').toUpperCase();
  }

  /* Заглушка, если пользователь не прикрепил фото. */
  function placeholderImage(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    const hue = hash % 360;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="hsl(' + hue + ' 78% 62%)"/>' +
      '<stop offset="1" stop-color="hsl(' + ((hue + 45) % 360) + ' 72% 46%)"/>' +
      '</linearGradient></defs>' +
      '<rect width="400" height="400" fill="url(#g)"/>' +
      '<text x="200" y="212" font-family="Segoe UI,Arial,sans-serif" font-size="150" font-weight="700" ' +
      'fill="#fff" fill-opacity=".92" text-anchor="middle">' + initials(name) + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function renderPhotoPreview() {
    if (formPhoto) {
      el.sellPhotoPreview.innerHTML = '<img src="' + esc(formPhoto) + '" alt="Фото товара">';
      el.sellPhotoClear.hidden = false;
    } else {
      el.sellPhotoPreview.innerHTML = '<span class="photo__hint">Нет фото</span>';
      el.sellPhotoClear.hidden = true;
    }
  }

  function fillSelect(select, values, selected) {
    select.innerHTML = values
      .map((v) => '<option value="' + esc(v) + '"' +
        (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>')
      .join('');
  }

  function formError(field, text) {
    const node = $('[data-error="' + field + '"]');
    const input = el[field];
    if (input) {
      input.setAttribute('aria-invalid', text ? 'true' : 'false');
      if (text) input.focus();
    }
    if (node) node.textContent = text || '';
  }

  function clearErrors() {
    ['sellName', 'sellPrice', 'sellSeller'].forEach((f) => formError(f, ''));
    el.sellError.hidden = true;
    el.sellError.textContent = '';
  }

  function openSell(id) {
    closePanel(true);
    state.editingId = id || null;

    const item = id ? listings.find((p) => p.id === id) : null;
    el.sellTitle.textContent = item
      ? 'Редактировать товар'
      : 'Выставить товар';
    el.sellSubmit.textContent = item
      ? 'Сохранить изменения'
      : 'Опубликовать';

    clearErrors();
    el.sellName.value = item ? item.name : '';
    el.sellDesc.value = item ? item.desc : '';
    el.sellDescCount.textContent = el.sellDesc.value.length;
    el.sellPrice.value = item ? item.price : '';
    el.sellSeller.value = item ? item.seller : profile.name;
    fillSelect(el.sellCategory, SELL_CATEGORIES, item ? item.category : SELL_CATEGORIES[0]);
    fillSelect(el.sellCondition, CONDITIONS, item ? item.condition : CONDITIONS[0]);

    formPhoto = item ? item.image : '';
    el.sellPhoto.value = '';
    renderPhotoPreview();

    el.sellModal.hidden = false;
    setLocked(true);
    el.sellName.focus();
  }

  function closeSell() {
    el.sellModal.hidden = true;
    state.editingId = null;
    el.sellForm.reset();
    formPhoto = '';
    renderPhotoPreview();
    unlockIfIdle();
  }

  el.sellOpen.addEventListener('click', () => openSell(null));
  el.heroSell.addEventListener('click', () => openSell(null));
  el.emptySell.addEventListener('click', () => openSell(null));
  el.mySellBtn.addEventListener('click', () => openSell(null));
  el.sellClose.addEventListener('click', closeSell);
  el.sellCancel.addEventListener('click', closeSell);
  el.sellModal.addEventListener('click', (e) => { if (e.target === el.sellModal) closeSell(); });

  el.sellDesc.addEventListener('input', () => {
    el.sellDescCount.textContent = el.sellDesc.value.length;
  });

  el.sellPhoto.addEventListener('change', () => {
    const file = el.sellPhoto.files && el.sellPhoto.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      el.sellError.hidden = false;
      el.sellError.textContent = 'Нужно изображение';
      return;
    }
    shrinkImage(file).then((dataUrl) => {
      formPhoto = dataUrl;
      renderPhotoPreview();
      el.sellError.hidden = true;
    }).catch(() => {
      el.sellError.hidden = false;
      el.sellError.textContent = 'Не удалось прочитать фото';
    });
  });

  el.sellPhotoClear.addEventListener('click', () => {
    formPhoto = '';
    el.sellPhoto.value = '';
    renderPhotoPreview();
  });

  el.sellForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors();

    const name = el.sellName.value.trim();
    const price = Math.round(Number(el.sellPrice.value));
    const seller = el.sellSeller.value.trim();
    let bad = false;

    if (name.length < 3) { formError('sellName', 'Минимум 3 символа'); bad = true; }
    if (!Number.isFinite(price) || price < 1) { formError('sellPrice', 'Укажите цену от 1 ₽'); bad = true; }
    if (!seller) { formError('sellSeller', 'Укажите имя продавца'); bad = true; }
    if (bad) return;

    const editing = state.editingId
      ? listings.find((p) => p.id === state.editingId) : null;

    const payload = {
      name,
      desc: el.sellDesc.value.trim(),
      price,
      category: el.sellCategory.value,
      condition: el.sellCondition.value,
      seller,
      image: formPhoto || placeholderImage(name),
      /* Товар остаётся моим и после перезагрузки страницы. */
      ownerId: profile.id
    };

    let savedId;
    if (editing) {
      Object.assign(editing, payload);
      savedId = editing.id;
    } else {
      /* Через normalizeListings — новая публикация получает ту же
         структуру, что и товары, загруженные из хранилища. */
      const fresh = normalizeListings([{
        id: uid(),
        createdAt: Date.now(),
        ...payload
      }])[0];
      if (fresh) listings.unshift(fresh);
      savedId = fresh ? fresh.id : null;
    }

    if (!saveListings()) {
      listings = normalizeListings(readJSON(LISTINGS_KEY, []));
      el.sellError.hidden = false;
      el.sellError.textContent =
        'Не удалось сохранить: хранилище браузера переполнено. Попробуйте фото поменьше.';
      return;
    }

    /* Имя запоминаем только при создании товара: правка старой публикации
       не должна менять имя текущего пользователя. */
    if (!editing) {
      profile.name = seller;
      writeJSON(PROFILE_KEY, { id: profile.id, name: profile.name });
    }

    const id = savedId;
    const wasEditing = Boolean(editing);
    closeSell();

    /* Показываем результат: сбрасываем поиск и открываем нужную категорию. */
    state.query = '';
    el.search.value = '';
    el.searchClear.hidden = true;
    const published = productById(id);
    state.category = published ? published.category : ALL_TOGETHER;
    renderCats();
    renderGrid();
    renderMine();
    saveCart();
    syncCart();

    $('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(wasEditing
      ? 'Изменения сохранены'
      : 'Товар опубликован — теперь он в общем каталоге');
  });

  /* ---------------- Мои товары ---------------- */

  function mineHTML(p) {
    return '' +
      '<div class="mine" data-mine="' + esc(p.id) + '">' +
        '<div class="mine__media" data-detail="' + esc(p.id) + '" role="button" tabindex="0"' +
          ' aria-label="\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0443">' +
          '<img src="' + esc(p.image) + '" alt="" width="72" height="72">' +
        '</div>' +
        '<div>' +
          '<h4 class="mine__title" data-detail="' + esc(p.id) + '">' + esc(p.name) + '</h4>' +
          '<div class="mine__meta">' +
            '<span class="cond" data-c="' + esc(p.condition) + '">' + esc(p.condition) + '</span>' +
            '<span class="dot">\u2022</span><span>' + esc(p.category) + '</span>' +
          '</div>' +
          '<div class="mine__price">' +
            '<input type="number" min="1" step="1" inputmode="numeric" value="' + p.price +
              '" data-price="' + esc(p.id) + '" aria-label="\u0426\u0435\u043d\u0430 \u0442\u043e\u0432\u0430\u0440\u0430">' +
            '<span class="mine__sum">' + money(p.price) + '</span>' +
            '<button class="mini-btn" type="button" data-save-price="' + esc(p.id) + '">' +
              '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c</button>' +
          '</div>' +
          '<div class="mine__actions">' +
            '<button class="mini-btn" type="button" data-mine-edit="' + esc(p.id) + '">' +
              '\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c</button>' +
            '<button class="mini-btn mini-btn--danger" type="button" data-mine-del="' + esc(p.id) + '">' +
              '\u0423\u0434\u0430\u043b\u0438\u0442\u044c</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderMine() {
    const mine = myListings();
    const n = mine.length;
    el.mineCount.textContent = n;
    el.myCount.textContent = n;
    el.mineCount.dataset.empty = n === 0 ? 'true' : 'false';
    el.myName.textContent = profile.name;

    el.myBody.innerHTML = n
      ? mine.map(mineHTML).join('')
      : '<div class="mine-empty">' +
          '<div class="mine-empty__icon">📦</div>' +
          '<h3>Пока нет товаров</h3>' +
          '<p>Выставьте первый товар — и он сразу появится в общем каталоге, где его увидят покупатели.</p>' +
          '<button class="btn btn--primary" type="button" data-sell-first>' +
            '+ Выставить товар</button>' +
        '</div>';
  }

  let deleteArmed = null;
  let deleteTimer = null;

  function disarmDelete() {
    if (!deleteArmed) return;
    const btn = el.myBody.querySelector('[data-mine-del="' + deleteArmed + '"]');
    if (btn) {
      btn.textContent = '\u0423\u0434\u0430\u043b\u0438\u0442\u044c';
      btn.classList.remove('mini-btn--ok');
    }
    deleteArmed = null;
    clearTimeout(deleteTimer);
  }

  function deleteListing(id) {
    const item = listings.find((p) => p.id === id);
    listings = listings.filter((p) => p.id !== id);
    delete state.cart[id];
    saveCart();
    saveListings();

    /* Категория могла опустеть — тогда возвращаем общий список. */
    if (!categoryList().includes(state.category)) state.category = ALL_TOGETHER;

    renderCats();
    renderGrid();
    renderMine();
    syncCart();
    toast((item ? item.name : 'Товар') + ' — удалён с витрины', 'info');
  }

  el.myBody.addEventListener('click', (e) => {
    if (e.target.closest('[data-sell-first]')) { openSell(null); return; }

    const save = e.target.closest('[data-save-price]');
    if (save) {
      const id = save.dataset.savePrice;
      const input = el.myBody.querySelector('[data-price="' + id + '"]');
      const value = Math.round(Number(input && input.value));
      const item = listings.find((p) => p.id === id);
      if (!item) return;
      if (!Number.isFinite(value) || value < 1) {
        toast('Укажите цену от 1 ₽', 'info');
        if (input) { input.value = item.price; input.focus(); }
        return;
      }
      if (value === item.price) { toast('Цена не изменилась', 'info'); return; }
      item.price = value;
      if (!saveListings()) { toast('Не удалось сохранить изменение', 'info'); return; }
      renderMine();
      renderGrid();
      renderCart();
      toast('Цена обновлена: ' + money(value));
      return;
    }

    const edit = e.target.closest('[data-mine-edit]');
    if (edit) { disarmDelete(); openSell(edit.dataset.mineEdit); return; }

    const del = e.target.closest('[data-mine-del]');
    if (del) {
      const id = del.dataset.mineDel;
      if (deleteArmed === id) {
        clearTimeout(deleteTimer);
        deleteArmed = null;
        deleteListing(id);
      } else {
        disarmDelete();
        deleteArmed = id;
        del.textContent = 'Точно удалить?';
        del.classList.add('mini-btn--ok');
        deleteTimer = setTimeout(disarmDelete, 3000);
      }
      return;
    }

    const link = e.target.closest('[data-detail]');
    if (link) { closePanel(true); openProduct(link.dataset.detail); }
  });

  el.myBody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const link = e.target.closest('[data-detail]');
    if (!link) return;
    e.preventDefault();
    closePanel(true);
    openProduct(link.dataset.detail);
  });

  /* ---------------- Оформление заказа ---------------- */

  /* Номер заказа вида #123456. Генерируется заново при каждом оформлении
     и хранится только в памяти вкладки — в localStorage он не попадает,
     поэтому после перезагрузки окно подтверждения не появится само. */
  let lastOrderNumber = '';

  function orderNumber() {
    let n;
    do {
      n = '#' + String(Math.floor(100000 + Math.random() * 900000));
    } while (n === lastOrderNumber);
    lastOrderNumber = n;
    return n;
  }

  function checkout() {
    const entries = cartEntries();
    if (!entries.length) {
      toast('\u041a\u043e\u0440\u0437\u0438\u043d\u0430 \u043f\u0443\u0441\u0442\u0430 \u2014 \u0434\u043e\u0431\u0430\u0432\u044c\u0442\u0435 \u0442\u043e\u0432\u0430\u0440\u044b', 'info');
      return;
    }

    const number = orderNumber();
    el.orderNumber.textContent = number;
    el.modalItems.innerHTML = entries.map(({ product, qty }) =>
      '<div class="modal__item">' +
        '<span><b>' + esc(product.name) + '</b> × ' + qty +
          '<i>Продавец: ' + esc(product.seller) + '</i></span>' +
        '<span>' + money(product.price * qty) + '</span>' +
      '</div>'
    ).join('');

    state.cart = {};
    saveCart();
    syncCart();
    closePanel(true);

    el.modal.hidden = false;
    setLocked(true);
    el.modalClose.focus();

    toast('\u0417\u0430\u043a\u0430\u0437 ' + number + ' \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d');
  }

  el.checkout.addEventListener('click', checkout);

  /* Закрытие окна. goTop = true — пользователь нажал «Продолжить покупки»:
     возвращаем его на главную страницу. */
  function closeModal(goTop) {
    el.modal.hidden = true;
    unlockIfIdle();
    if (goTop) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      el.cartOpen.focus({ preventScroll: true });
    }
  }

  el.modalClose.addEventListener('click', () => closeModal(true));
  el.modal.addEventListener('click', (e) => { if (e.target === el.modal) closeModal(false); });

  el.copyOrder.addEventListener('click', async () => {
    const text = el.orderNumber.textContent;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast('\u041d\u043e\u043c\u0435\u0440 \u0437\u0430\u043a\u0430\u0437\u0430 \u0441\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u043d', 'info');
    } catch (e) {
      toast('\u041d\u043e\u043c\u0435\u0440 \u0437\u0430\u043a\u0430\u0437\u0430: ' + text, 'info');
    }
  });

  /* ---------------- Блокировка и Escape ---------------- */

  function unlockIfIdle() {
    const busy = openPanel || !el.modal.hidden || !el.pmModal.hidden || !el.sellModal.hidden;
    if (!busy) setLocked(false);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!el.modal.hidden) closeModal(false);
    else if (!el.sellModal.hidden) closeSell();
    else if (!el.pmModal.hidden) closeProduct();
    else if (openPanel) closePanel(false);
  });

  /* ---------------- Тосты ---------------- */

  function toast(message, type) {
    const node = document.createElement('div');
    node.className = 'toast' + (type === 'info' ? ' toast--info' : '');
    node.innerHTML = '<span class="toast__ico">' + (type === 'info' ? '\u2139\uFE0F' : '\u2713') +
      '</span><span>' + message + '</span>';
    el.toasts.appendChild(node);
    setTimeout(() => {
      node.classList.add('is-out');
      setTimeout(() => node.remove(), 320);
    }, 2400);
    while (el.toasts.children.length > 3) el.toasts.firstElementChild.remove();
  }

  /* ---------------- Ссылки в подвале ---------------- */

  $$('.footer__links a').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const action = link.dataset.action;
      if (action === 'mine') {
        openMine();
      } else if (action === 'categories') {
        $('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.search.focus({ preventScroll: true });
      } else if (action === 'about') {
        toast('miki shop — площадка, где товары выставляют сами пользователи', 'info');
      } else {
        $('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  /* ---------------- Старт ---------------- */

  /* При старте страница всегда открывается «чистой»: главная, без корзины
     и без окна подтверждения. Состояние заказа нигде не сохраняется,
     поэтому перезагрузка не может его восстановить. */
  function resetOverlays() {
    el.modal.hidden = true;
    el.pmModal.hidden = true;
    el.sellModal.hidden = true;
    el.drawer.hidden = true;
    el.myDrawer.hidden = true;
    el.overlay.hidden = true;
    el.drawer.classList.remove('is-closing');
    el.myDrawer.classList.remove('is-closing');
    el.orderNumber.textContent = '';
    el.modalItems.innerHTML = '';
    state.detailId = null;
    state.editingId = null;
    openPanel = null;
    setLocked(false);
  }

  resetOverlays();
  renderCats();
  renderGrid();
  renderMine();
  syncCart();
})();
