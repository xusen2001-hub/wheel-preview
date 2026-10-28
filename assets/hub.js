/* hub.js — 渲染入口页的活动列表（只用 textContent，不拼 HTML） */
(function () {
  'use strict';
  var items = (window.ACTIVITIES || []).filter(function (a) { return a && a.status !== 'hidden'; });
  var list = document.getElementById('list');
  var hasDraft = false;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  items.forEach(function (a) {
    // 只放行站内相对路径（不允许以 / 开头，避免 //host 之类协议相对地址跳到外站）
    var href = String(a.href || '');
    if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?$/.test(href)) return;
    var card = el('a', 'act');
    card.href = href;
    var top = el('div', 'act-top');
    if (a.tag) top.appendChild(el('span', 'act-tag', a.tag));
    if (a.status === 'draft') { hasDraft = true; top.appendChild(el('span', 'act-draft', '草稿')); }
    card.appendChild(top);
    card.appendChild(el('h2', null, a.title));
    if (a.desc) card.appendChild(el('p', null, a.desc));
    card.appendChild(el('span', 'act-go', '去参与 →'));
    list.appendChild(card);
  });

  document.getElementById('draftBanner').hidden = !hasDraft;
  document.getElementById('empty').hidden = list.children.length > 0;
})();
