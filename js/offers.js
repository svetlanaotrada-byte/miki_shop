/* ============================================================================
   offers.js — предложения цены к объявлениям о Robux.

   Отдельный модуль без доступа к DOM: работает только с записями
   предложений. Интерфейс (карточки, окно, «Мои товары») lives в app.js.

   Модуль сознательно НЕ переводит Robux и не принимает деньги: он
   хранит только текст предложения «я готов купить столько-то за N €».
   Сделка и настоящие Robux — только через официальные сервисы Roblox.
   ========================================================================== */
window.MarketOffers = (function () {
  'use strict';

  var OFFERS_KEY = 'miki-shop-offers-v1';
  var MAX_OFFERS = 200;

  var STATUS = {
    pending: 'Ожидает ответа',
    accepted: 'Принято',
    declined: 'Отклонено'
  };

  function read() {
    try {
      var raw = localStorage.getItem(OFFERS_KEY);
      if (!raw) return [];
      var data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  function write(list) {
    try {
      localStorage.setItem(OFFERS_KEY, JSON.stringify(list.slice(0, MAX_OFFERS)));
      return true;
    } catch (e) {
      return false;
    }
  }

  function uid() {
    return 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function normalize(list) {
    return list
      .filter(function (o) { return o && typeof o === 'object' && o.id && o.listingId; })
      .map(function (o) {
        return {
          id: String(o.id),
          listingId: String(o.listingId),
          /* Снимок данных объявления на момент предложения: после удаления
             товара предложение остаётся читаемым в истории. */
          title: String(o.title || 'Robux').slice(0, 70),
          amount: Math.max(0, Math.round(Number(o.amount) || 0)),
          price: Math.max(0, Math.round(Number(o.price) || 0)),
          listedPrice: Math.max(0, Math.round(Number(o.listedPrice) || 0)),
          buyerId: typeof o.buyerId === 'string' ? o.buyerId : '',
          buyerName: String(o.buyerName || 'Покупатель').trim().slice(0, 40) || 'Покупатель',
          sellerId: typeof o.sellerId === 'string' ? o.sellerId : '',
          status: STATUS[o.status] ? o.status : 'pending',
          note: String(o.note || '').slice(0, 200),
          createdAt: Number(o.createdAt) || Date.now(),
          answeredAt: Number(o.answeredAt) || 0
        };
      });
  }

  function list() {
    return normalize(read()).sort(function (a, b) { return b.createdAt - a.createdAt; });
  }

  function forListing(listingId) {
    return list().filter(function (o) { return o.listingId === listingId; });
  }

  function get(id) {
    return list().find(function (o) { return o.id === id; }) || null;
  }

  function pendingCount(listingId) {
    return forListing(listingId).filter(function (o) { return o.status === 'pending'; }).length;
  }

  /* Новое предложение. listing передаётся объектом, чтобы сохранить снимок
     названия и количества Robux. */
  function create(input) {
    var listing = input && input.listing;
    var price = Math.round(Number(input && input.price));

    if (!listing || !listing.id) return { ok: false, error: 'Объявление не найдено' };
    if (!listing.ownerId) return { ok: false, error: 'У объявления нет продавца' };
    if (listing.ownerId === (input.buyerId || '')) {
      return { ok: false, error: 'Своё объявление предлагать нельзя' };
    }
    if (!Number.isFinite(price) || price < 1 || price > 100000) {
      return { ok: false, error: 'Укажите цену от 1 до 100 000 €' };
    }
    if (price === listing.price) {
      return { ok: false, error: 'Эта цена уже указана в объявлении' };
    }

    var mine = list().filter(function (o) {
      return o.listingId === listing.id &&
        o.buyerId === input.buyerId &&
        o.status === 'pending';
    });
    if (mine.length) {
      return { ok: false, error: 'Ваше предложение по этому объявлению уже отправлено' };
    }

    var offer = {
      id: uid(),
      listingId: listing.id,
      title: listing.name,
      amount: Number(listing.rbxAmount) || 0,
      price: price,
      listedPrice: Number(listing.price) || 0,
      buyerId: input.buyerId || '',
      buyerName: input.buyerName || 'Покупатель',
      sellerId: listing.ownerId,
      status: 'pending',
      note: String(input.note || '').slice(0, 200),
      createdAt: Date.now(),
      answeredAt: 0
    };

    var all = list();
    all.unshift(offer);
    if (!write(all)) return { ok: false, error: 'Не удалось сохранить предложение' };
    return { ok: true, offer: offer };
  }

  /* Ответить на предложение может только продавец объявления. */
  function answer(offerId, sellerId, accept) {
    var all = list();
    var offer = all.find(function (o) { return o.id === offerId; });
    if (!offer) return { ok: false, error: 'Предложение не найдено' };
    if (offer.sellerId !== sellerId) return { ok: false, error: 'Это не ваше объявление' };
    if (offer.status !== 'pending') return { ok: false, error: 'На предложение уже ответили' };

    offer.status = accept ? 'accepted' : 'declined';
    offer.answeredAt = Date.now();

    /* Приняли одно предложение — остальные по этому объявлению гаснут. */
    if (accept) {
      all.forEach(function (o) {
        if (o.listingId === offer.listingId && o.id !== offer.id && o.status === 'pending') {
          o.status = 'declined';
          o.answeredAt = offer.answeredAt;
        }
      });
    }

    if (!write(all)) return { ok: false, error: 'Не удалось сохранить ответ' };
    return { ok: true, offer: offer, price: offer.price };
  }

  /* Удалить объявление — удаляем и его предложения. */
  function dropListing(listingId) {
    write(list().filter(function (o) { return o.listingId !== listingId; }));
  }

  function clear() {
    write([]);
  }

  return {
    OFFERS_KEY: OFFERS_KEY,
    STATUS: STATUS,
    list: list,
    forListing: forListing,
    get: get,
    pendingCount: pendingCount,
    create: create,
    answer: answer,
    dropListing: dropListing,
    clear: clear
  };
})(window);
