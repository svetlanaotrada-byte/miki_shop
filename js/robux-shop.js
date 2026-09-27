/* ============================================================================
   robux-shop.js — интерфейс раздела «Купить Robux».

   Не занимается оплатой: заказы создаёт RobuxPayments (js/robux-payment.js).
   Здесь только карточки пакетов, окно покупки в три шага и «Мои покупки Robux».
   ========================================================================== */
(() => {
  'use strict';

  const PROFILE_KEY = 'miki-shop-profile-v1';
  const LISTINGS_KEY = 'miki-shop-listings-v1';
  const Pay = window.RobuxPayments;

  /* Пакеты и цены в евро — как указано в требованиях к магазину. */
  const PACKS = [
    { amount: 400, priceEur: 3, title: '400 Robux', note: 'Стартовый пакет' },
    { amount: 800, priceEur: 5, title: '800 Robux', note: 'Для аватара и подписок' },
    { amount: 1700, priceEur: 10, title: '1 700 Robux', note: 'Популярный выбор', top: true },
    { amount: 4500, priceEur: 30, title: '4 500 Robux', note: 'Для активной игры' },
    { amount: 10000, priceEur: 50, title: '10 000 Robux', note: 'Максимальный пакет' }
  ];

  const STATUS = {
    pending: { label: 'Ожидает подтверждения', cls: 'is-pending' },
    confirmed: { label: 'Подтверждено Roblox', cls: 'is-confirmed' },
    cancelled: { label: 'Отменён', cls: 'is-cancelled' }
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));

  /* ---------------- профиль (общий с маркетплейсом) ---------------- */

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

  function uid() {
    return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function loadProfile() {
    const raw = readJSON(PROFILE_KEY, null);
    const id = raw && typeof raw.id === 'string' && /^u[a-z0-9]{4,}$/.test(raw.id) ? raw.id : uid();
    const name = raw && typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '';
    const roblox = raw && typeof raw.roblox === 'string' ? raw.roblox.trim().slice(0, 20) : '';
    const profile = { id, name: name || 'Продавец', roblox };
    if (!raw || raw.id !== profile.id || raw.name !== profile.name || raw.roblox !== profile.roblox) {
      writeJSON(PROFILE_KEY, profile);
    }
    return profile;
  }

  const profile = loadProfile();

  /* ---------------- утилиты ---------------- */

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
  const num = (n) => Number(n).toLocaleString('ru-RU').replace(/ /g, ' ');
  const eur = (n) => num(n) + ' €';

  function dateOf(ts) {
    const d = new Date(ts);
    const pad = (v) => String(v).padStart(2, '0');
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() +
      ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  let toastTimer = null;
  function toast(text) {
    const box = $('#toasts');
    if (!box) return;
    box.innerHTML = '<div class="toast">' + esc(text) + '</div>';
    box.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('is-on'), 2800);
  }

  /* ---------------- карточки пакетов ---------------- */

  const COIN = '<span class="rbx-card__coin" aria-hidden="true">' +
    '<svg viewBox="0 0 48 48" focusable="false">' +
      '<circle cx="24" cy="24" r="21"></circle>' +
      '<path d="M16 15h7.2c3.4 0 5.4 1.6 5.4 4.2 0 1.7-.9 2.9-2.4 3.5 2 .5 3.2 2 3.2 4.1 0 3-2.2 4.7-6 4.7H16z" ' +
        'fill="none" stroke-width="2.4" stroke-linejoin="round"></path>' +
      '<path d="M16 15v16.5" fill="none" stroke-width="2.4" stroke-linecap="round"></path>' +
    '</svg></span>';

  function packHTML(p, i) {
    const top = p.top ? ' is-top' : '';
    return '' +
      '<article class="rbx-card' + top + '"' + (p.top ? ' data-top="true"' : '') + '>' +
        (p.top ? '<span class="rbx-card__flag">Популярный выбор</span>' : '') +
        COIN +
        '<b class="rbx-card__amount">' + num(p.amount) + '</b>' +
        '<span class="rbx-card__unit">Robux</span>' +
        '<span class="rbx-card__price">' + eur(p.priceEur) + '</span>' +
        '<span class="rbx-card__note">' + esc(p.note) + '</span>' +
        '<button class="btn btn--primary rbx-card__buy" type="button" data-buy="' + p.amount + '">' +
          'Купить' +
        '</button>' +
        '<span class="rbx-card__hint">Оплата на официальном roblox.com</span>' +
      '</article>';
  }

  function renderPacks() {
    $('#rbxGrid').innerHTML = PACKS.map(packHTML).join('');
  }

  function packByAmount(amount) {
    return PACKS.find((p) => p.amount === Number(amount)) || null;
  }

  /* ---------------- окно покупки: 3 шага ---------------- */

  let state = { pack: null, username: '', step: 1, order: null };
  let lastFocus = null;

  const setError = (text) => {
    const node = document.querySelector('[data-error="rbxModalUser"]');
    if (node) node.textContent = text || '';
  };

  function showStep(n) {
    state.step = n;
    $$('#rbxStepsNav li').forEach((li) => {
      const s = Number(li.getAttribute('data-step'));
      li.classList.toggle('is-active', s === n);
      li.classList.toggle('is-done', s < n);
    });
    $$('#rbxModal .rbx-pane').forEach((p) => {
      p.hidden = Number(p.getAttribute('data-pane')) !== n;
    });
  }

  function fillSummary() {
    const p = state.pack;
    $('#sumAmount').textContent = num(p.amount);
    $('#sumTitle').textContent = p.title;
    $('#sumPrice').textContent = eur(p.priceEur);
    $('#sumUser').textContent = state.username;
  }

  function openBuy(amount) {
    const pack = packByAmount(amount);
    if (!pack) return;
    state.pack = pack;
    state.username = profile.roblox || '';
    state.order = null;
    state.step = 1;

    const field = $('#rbxModalUser');
    field.value = state.username;
    setError('');
    $('#rbxUseSaved').hidden = !state.username;
    $('#rbxUseSaved').textContent = 'Использовать сохранённый: ' + state.username;

    lastFocus = document.activeElement;
    $('#rbxModal').hidden = false;
    document.body.classList.add('is-locked');
    showStep(1);
    setTimeout(() => field.focus(), 30);
  }

  function closeBuy() {
    $('#rbxModal').hidden = true;
    document.body.classList.remove('is-locked');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function stepOne() {
    const value = String($('#rbxModalUser').value || '').trim();
    if (!value) {
      setError('Введите Roblox Username — на него Roblox зачислит Robux.');
      $('#rbxModalUser').focus();
      return;
    }
    if (!Pay.validUsername(value)) {
      setError('От 3 до 20 символов: латиница, цифры и _');
      $('#rbxModalUser').focus();
      return;
    }
    setError('');
    state.username = value;
    profile.roblox = value;
    writeJSON(PROFILE_KEY, profile);
    fillSummary();
    showStep(2);
  }

  function pay() {
    const result = Pay.create({ pack: state.pack, username: state.username, providerId: 'roblox' });
    if (!result.ok) {
      toast(result.error);
      return;
    }
    state.order = result.order;
    $('#okRef').textContent = result.order.reference;
    $('#okTitle').textContent = result.order.title;
    $('#okPrice').textContent = eur(result.order.priceEur);
    $('#okUser').textContent = result.order.username;
    $('#okMessage').textContent = result.order.message;
    $('#okOpen').href = result.order.redirectUrl;
    showStep(3);
    renderHistory();
    paintHeader();
  }

  /* ---------------- Мои покупки Robux ---------------- */

  function orderHTML(o) {
    const st = STATUS[o.status] || STATUS.pending;
    return '' +
      '<li class="rbx-order ' + st.cls + '">' +
        '<span class="rbx-order__coin" aria-hidden="true">R$</span>' +
        '<div class="rbx-order__main">' +
          '<b class="rbx-order__title">' + esc(o.title) + '</b>' +
          '<span class="rbx-order__meta">' + esc(o.username) + ' · ' + eur(o.priceEur) + ' · ' + esc(dateOf(o.createdAt)) + '</span>' +
          '<span class="rbx-order__ref">Заказ ' + esc(o.reference) + '</span>' +
          '<span class="rbx-order__note">' + esc(o.message || 'Зачисление Robux выполняет Roblox.') + '</span>' +
        '</div>' +
        '<div class="rbx-order__side">' +
          '<span class="rbx-order__status ' + st.cls + '">' + esc(st.label) + '</span>' +
          (o.status === 'pending'
            ? '<a class="btn btn--ghost btn--sm" href="' + esc(o.redirectUrl) + '" target="_blank" rel="noopener noreferrer">Открыть Roblox</a>' +
              '<button class="btn btn--ghost btn--sm" type="button" data-cancel="' + esc(o.reference) + '">Отменить</button>'
            : '') +
          (o.status === 'cancelled'
            ? '<button class="btn btn--ghost btn--sm" type="button" data-remove="' + esc(o.reference) + '">Убрать из истории</button>'
            : '') +
        '</div>' +
      '</li>';
  }

  function renderHistory() {
    const orders = Pay.list();
    const box = $('#rbxHistory');
    const empty = $('#rbxHistoryEmpty');
    const count = $('#rbxOrdersCount');

    count.textContent = orders.length
      ? orders.length + ' ' + plural(orders.length, ['заказ', 'заказа', 'заказов'])
      : 'пока нет заказов';

    if (!orders.length) {
      box.innerHTML = '';
      box.hidden = true;
      empty.hidden = false;
      return;
    }
    box.innerHTML = orders.map(orderHTML).join('');
    box.hidden = false;
    empty.hidden = true;
  }

  function plural(n, forms) {
    const n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return forms[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
    return forms[2];
  }

  /* ---------------- шапка раздела ---------------- */

  function paintHeader() {
    const chip = $('#rbxName');
    if (chip) chip.textContent = profile.roblox || '—';
    const link = $('#rbxProfile');
    if (link) {
      link.href = profile.roblox
        ? 'https://www.roblox.com/users/' + encodeURIComponent(profile.roblox) + '/profile'
        : 'https://www.roblox.com/';
    }
    const list = readJSON(LISTINGS_KEY, []);
    const mine = Array.isArray(list)
      ? list.filter((p) => p && p.ownerId === profile.id).length
      : 0;
    const mineEl = $('#rbxMine');
    if (mineEl) mineEl.textContent = String(mine);
    const pend = Pay.list().filter((o) => o.status === 'pending').length;
    const pendEl = $('#rbxPending');
    if (pendEl) pendEl.textContent = String(pend);
  }

  /* ---------------- init ---------------- */

  renderPacks();
  renderHistory();
  paintHeader();

  $('#rbxGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-buy]');
    if (btn) openBuy(btn.getAttribute('data-buy'));
  });

  $('#rbxModal').addEventListener('click', (e) => {
    if (e.target === $('#rbxModal')) closeBuy();
  });

  $('#rbxModalClose').addEventListener('click', closeBuy);
  $('#rbxCancel1').addEventListener('click', closeBuy);
  $('#rbxStepOne').addEventListener('click', stepOne);
  $('#rbxModalUser').addEventListener('input', () => setError(''));
  $('#rbxModalUser').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); stepOne(); }
  });
  $('#rbxUseSaved').addEventListener('click', () => {
    $('#rbxModalUser').value = profile.roblox;
    setError('');
    $('#rbxModalUser').focus();
  });
  $('#rbxBack').addEventListener('click', () => showStep(1));
  $('#rbxPay').addEventListener('click', pay);
  $('#rbxDone').addEventListener('click', closeBuy);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#rbxModal').hidden) closeBuy();
  });

  /* История: отмена заказа и удаление записи. */
  $('#rbxHistory').addEventListener('click', (e) => {
    const cancel = e.target.closest('[data-cancel]');
    if (cancel) {
      const r = Pay.cancel(cancel.getAttribute('data-cancel'));
      if (r.ok) { renderHistory(); paintHeader(); toast('Заказ отменён. Robux не начислялись.'); }
      else toast(r.error);
      return;
    }
    const remove = e.target.closest('[data-remove]');
    if (remove) {
      Pay.remove(remove.getAttribute('data-remove'));
      renderHistory();
      paintHeader();
      toast('Запись убрана из истории');
    }
  });

  /* Ссылки на оплату ведут только на официальный roblox.com. */
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) return;
    if (!Pay.isOfficialUrl(href)) {
      e.preventDefault();
      toast('Оплата Robux доступна только на официальном roblox.com');
    }
  });
})();
