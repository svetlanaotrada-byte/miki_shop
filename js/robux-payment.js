/* ============================================================================
   robux-payment.js — модуль оплаты Robux.

   Полностью отделён от интерфейса: страница магазина (robux-shop.js) только
   рисует карточки и окно покупки, а создание заказа и подтверждение оплаты
   делает этот модуль. Сюда же встанет подключение настоящего платёжа.

   Правила, зашитые в модуль:
   1. Оплата принимается только у официальных провайдеров (домен roblox.com).
   2. Модуль НИКОГДА не подтверждает оплату сам. Статус заказа остаётся
      «ожидает подтверждения», пока нет подтверждения от Roblox.
   3. Пароль Roblox, cookie, токены и коды 2FA не принимаются и не хранятся.
   4. Баланс Robux не хранится и не начисляется: localStorage содержит только
      историю намерений покупки, без «зачислений».
   ========================================================================== */
window.RobuxPayments = (function () {
  'use strict';

  var ORDERS_KEY = 'miki-robux-orders-v1';
  var MAX_ORDERS = 40;
  var OFFICIAL_HOST = /^(www\.)?roblox\.com$/i;

  /* ---------------- утилиты ---------------- */

  function isOfficialUrl(url) {
    try {
      return OFFICIAL_HOST.test(new URL(url, 'https://www.roblox.com/').hostname);
    } catch (e) {
      return false;
    }
  }

  function readOrders() {
    try {
      var raw = localStorage.getItem(ORDERS_KEY);
      if (!raw) return [];
      var data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  function writeOrders(list) {
    try {
      localStorage.setItem(ORDERS_KEY, JSON.stringify(list.slice(0, MAX_ORDERS)));
      return true;
    } catch (e) {
      return false;
    }
  }

  function makeReference() {
    return 'RBX-' + Date.now().toString(36).toUpperCase() + '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  function validUsername(name) {
    return /^[A-Za-z0-9_]{3,20}$/.test(String(name || '').trim());
  }

  /* ---------------- провайдеры ----------------
     Провайдер описывает, куда уходит пользователь и может ли модуль
     подтвердить оплату. Подключение нового официального способа — это
     добавление записи в providers: интерфейс и магазин не меняются.       */

  var providers = {
    roblox: {
      id: 'roblox',
      label: 'Официальный магазин Roblox',
      official: true,
      /* Реальное списание и зачисление Robux делает Roblox на своём домене. */
      checkoutUrl: 'https://www.roblox.com/upgrades/robux',

      profileUrl: function (username) {
        return 'https://www.roblox.com/users/' + encodeURIComponent(username) + '/profile';
      },

      /* Создаёт заказ-намерение. Подтверждения здесь быть не может:
         браузерное приложение не получает серверных уведомлений Roblox. */
      createOrder: function () {
        return {
          status: 'pending',
          redirectUrl: this.checkoutUrl,
          message: 'Оплата проходит на roblox.com. Пока Roblox не подтвердил покупку, ' +
            'заказ остаётся в статусе «ожидает подтверждения», а Robux не начисляются.'
        };
      }
    }
  };

  /* Точка подключения настоящего подтверждения. По умолчанию её нет:
     без серверной проверки подписи Roblox подтвердить оплату нечем. */
  var verifier = null;

  function configure(options) {
    if (options && typeof options.verify === 'function') {
      verifier = options.verify;
      return true;
    }
    return false;
  }

  function hasVerifier() {
    return typeof verifier === 'function';
  }

  /* Подтвердить заказ может только внешний проверяющий модуль (см. configure). */
  function confirm(reference, proof) {
    if (!hasVerifier()) {
      return {
        confirmed: false,
        reason: 'Подтверждение от Roblox недоступно: не подключён серверный проверяющий модуль. ' +
          'Заказ остаётся в статусе «ожидает подтверждения».'
      };
    }
    var result;
    try {
      result = verifier(reference, proof) || {};
    } catch (e) {
      return { confirmed: false, reason: 'Проверяющий модуль вернул ошибку: ' + (e && e.message) };
    }
    if (!result.confirmed) {
      return { confirmed: false, reason: result.reason || 'Roblox не подтвердил оплату.' };
    }
    var list = readOrders();
    var order = list.find(function (o) { return o.reference === reference; });
    if (order) {
      order.status = 'confirmed';
      order.confirmedAt = Date.now();
      order.confirmation = { source: result.source || 'roblox', id: result.id || null };
      writeOrders(list);
    }
    return { confirmed: true, order: order || null };
  }

  /* ---------------- публичный API ---------------- */

  function listProviders() {
    return Object.keys(providers).map(function (id) {
      return { id: id, label: providers[id].label, official: !!providers[id].official };
    });
  }

  function list() {
    return readOrders();
  }

  function get(reference) {
    return readOrders().find(function (o) { return o.reference === reference; }) || null;
  }

  /* Создание заказа. Возвращает статус 'pending' по определению:
     подтвердить оплату без ответа Roblox нельзя. */
  function create(input) {
    var pack = input && input.pack;
    var username = String((input && input.username) || '').trim();
    var providerId = (input && input.providerId) || 'roblox';
    var provider = providers[providerId];

    if (!provider || !provider.official) {
      return { ok: false, error: 'Доступен только официальный способ оплаты Roblox.' };
    }
    if (!pack || !Number.isFinite(Number(pack.amount)) || Number(pack.amount) < 1) {
      return { ok: false, error: 'Некорректный пакет Robux.' };
    }
    if (!Number.isFinite(Number(pack.priceEur)) || Number(pack.priceEur) < 0) {
      return { ok: false, error: 'Некорректная цена пакета.' };
    }
    if (!validUsername(username)) {
      return { ok: false, error: 'Укажите Roblox Username: 3–20 символов, латиница, цифры и _.' };
    }
    if (!isOfficialUrl(provider.checkoutUrl)) {
      return { ok: false, error: 'Способ оплаты не ведёт на официальный roblox.com.' };
    }

    var created = provider.createOrder({ pack: pack, username: username }) || {};
    var order = {
      reference: makeReference(),
      provider: providerId,
      providerLabel: provider.label,
      status: created.status === 'confirmed' ? 'pending' : (created.status || 'pending'),
      amount: Number(pack.amount),
      priceEur: Number(pack.priceEur),
      title: pack.title || (pack.amount + ' Robux'),
      username: username,
      createdAt: Date.now(),
      redirectUrl: created.redirectUrl || provider.checkoutUrl,
      profileUrl: provider.profileUrl ? provider.profileUrl(username) : null,
      message: created.message || '',
      /* Явно фиксируем, что зачисления нет: баланс Robux модуль не ведёт. */
      credited: false
    };

    if (order.status !== 'pending') order.status = 'pending';

    var list = readOrders();
    list.unshift(order);
    writeOrders(list);
    return { ok: true, order: order };
  }

  function cancel(reference) {
    var list = readOrders();
    var order = list.find(function (o) { return o.reference === reference; });
    if (!order) return { ok: false, error: 'Заказ не найден.' };
    if (order.status === 'confirmed') {
      return { ok: false, error: 'Подтверждённый заказ нельзя отменить в разделе покупок.' };
    }
    order.status = 'cancelled';
    order.cancelledAt = Date.now();
    order.credited = false;
    writeOrders(list);
    return { ok: true, order: order };
  }

  function remove(reference) {
    var list = readOrders();
    var next = list.filter(function (o) { return o.reference !== reference; });
    writeOrders(next);
    return { ok: true };
  }

  function clear() {
    writeOrders([]);
    return { ok: true };
  }

  return {
    ORDERS_KEY: ORDERS_KEY,
    providers: providers,
    listProviders: listProviders,
    list: list,
    get: get,
    create: create,
    cancel: cancel,
    remove: remove,
    clear: clear,
    confirm: confirm,
    configure: configure,
    hasVerifier: hasVerifier,
    isOfficialUrl: isOfficialUrl,
    validUsername: validUsername
  };
})(window);
