/* admin.js — 转盘配置台。全部在浏览器本地运算，不发任何网络请求。 */
(function () {
  'use strict';

  var E = window.WheelEngine, R = window.WheelRender;
  var $ = function (id) { return document.getElementById(id); };
  var state = E.normalizeConfig(window.WHEEL_CONFIG);
  // 奖项概率/顺序/数量的“签名”：只有它们变化才会让已抽过的 UID 换奖，改文案不会
  var sigOf = function (c) { return JSON.stringify(c.prizes.map(function (p) { return [p.id, p.weight]; })); };
  var initial = { campaignId: state.campaignId, sig: sigOf(state) };
  var budgetIn = { people: 500, claimPct: 15 };
  var COST_KEY = 'channelGames:adminCosts';

  /* ---------- 内部成本：不写入公开的 config.js，只存在这台电脑的浏览器里 ---------- */
  function loadCosts() { try { return JSON.parse(localStorage.getItem(COST_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function saveCosts() {
    var o = {};
    state.prizes.forEach(function (p) { if (p.cost != null) o[p.id] = p.cost; });
    try { localStorage.setItem(COST_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ }
  }
  function inferCost(label) { var m = /^\s*(?:US\s*)?\$\s*(\d+(?:\.\d+)?)/i.exec(label) || /^\s*(\d+(?:\.\d+)?)\s*USDT/i.exec(label); return m ? Number(m[1]) : null; }
  (function seedCosts() {
    var saved = loadCosts();
    state.prizes.forEach(function (p) {
      if (p.cost != null) return;
      p.cost = saved[p.id] != null ? Number(saved[p.id]) : inferCost(p.label); // 没填过就按面值预填，可改
    });
  })();

  /* ---------- 小工具 ---------- */
  function getPath(o, path) { return path.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function setPath(o, path, v) {
    var ks = path.split('.'), last = ks.pop();
    ks.reduce(function (a, k) { return a[k]; }, o)[last] = v;
  }
  function round(x, d) { var f = Math.pow(10, d); return Math.round(x * f) / f; }
  function fmtNum(x, d) { return x.toLocaleString('en-US', { minimumFractionDigits: d == null ? 0 : d, maximumFractionDigits: d == null ? 2 : d }); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var toastTimer = 0;
  function toast(text) {
    var t = $('toast');
    t.textContent = text; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2000);
  }
  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.left = '-9999px'; ta.style.top = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      toast(ok ? okMsg : '复制失败，请手动全选复制');
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback);
    else fallback();
  }

  /* ---------- 基本字段绑定 ---------- */
  document.querySelectorAll('[data-path]').forEach(function (node) {
    var path = node.getAttribute('data-path'), type = node.getAttribute('data-type'), v = getPath(state, path);
    if (type === 'bool') node.checked = !!v;
    else if (type === 'lines') node.value = (v || []).join('\n');
    else node.value = v == null ? '' : v;
    var onChange = function () {
      var val;
      if (type === 'bool') val = node.checked;
      else if (type === 'number') val = node.value === '' ? 0 : Number(node.value);
      else if (type === 'lines') val = node.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      else val = path === 'campaignId' || path === 'uidPattern' ? node.value.trim() : node.value;
      setPath(state, path, val);
      refresh();
    };
    node.addEventListener('input', onChange);
    node.addEventListener('change', onChange);
  });

  $('newCampaign').addEventListener('click', function () {
    var d = new Date(), p = function (x) { return (x < 10 ? '0' : '') + x; };
    state.campaignId = 'wheel-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
    document.querySelector('[data-path="campaignId"]').value = state.campaignId;
    refresh();
    toast('已生成新期号，所有 UID 将重新抽奖，旧期号的抽奖记录全部作废');
  });

  /* ---------- 奖项表 ---------- */
  var pctCells = [];

  function numInput(value, cls, aria, onInput) {
    var e = document.createElement('input');
    e.type = 'number'; e.className = 'input ' + cls; e.value = value == null || (typeof value === 'number' && !isFinite(value)) ? '' : value;
    e.min = '0'; e.step = 'any'; e.inputMode = 'decimal'; e.setAttribute('aria-label', aria);
    e.addEventListener('input', function () { onInput(e.value); });
    return e;
  }
  function textInput(value, cls, aria, onInput) {
    var e = document.createElement('input');
    e.type = 'text'; e.className = 'input ' + cls; e.value = value || ''; e.setAttribute('aria-label', aria);
    e.addEventListener('input', function () { onInput(e.value); });
    return e;
  }
  function cell(child, cls) { var td = document.createElement('td'); if (cls) td.className = cls; td.appendChild(child); return td; }

  function nextPrizeId() {
    var used = Object.create(null); state.prizes.forEach(function (p) { used[p.id] = true; });
    var k = state.prizes.length + 1;
    while (used['p' + k]) k++;
    return 'p' + k;
  }

  function renderPrizes() {
    var body = $('prizeBody');
    body.textContent = '';
    pctCells = [];
    state.prizes.forEach(function (p, i) {
      var tr = document.createElement('tr');
      tr.appendChild(cell(textInput(p.label, 'w-label', '奖项名称', function (v) { p.label = v; refresh(); })));
      tr.appendChild(cell(textInput(p.sub, 'w-sub', '副标题', function (v) { p.sub = v; refresh(); })));
      tr.appendChild(cell(numInput(p.weight, 'w-num', '概率权重', function (v) { p.weight = v === '' ? NaN : Number(v); refresh(); })));
      var pct = el('span'); pctCells.push(pct); tr.appendChild(cell(pct, 'pct'));
      tr.appendChild(cell(numInput(p.cost, 'w-num', '内部成本 US$（仅本机，不会导出）', function (v) { p.cost = v === '' ? null : Number(v); saveCosts(); refresh(); })));
      var hl = document.createElement('input');
      hl.type = 'checkbox'; hl.checked = !!p.highlight; hl.setAttribute('aria-label', '标为最高奖励（深色高亮）');
      hl.addEventListener('change', function () { p.highlight = hl.checked; refresh(); });
      tr.appendChild(cell(hl));
      var ops = el('div', 'ops');
      var up = el('button', null, '↑'), down = el('button', null, '↓'), del = el('button', 'del', '✕');
      [up, down, del].forEach(function (b) { b.type = 'button'; });
      up.setAttribute('aria-label', '上移'); down.setAttribute('aria-label', '下移'); del.setAttribute('aria-label', '删除该奖项');
      up.disabled = i === 0; down.disabled = i === state.prizes.length - 1;
      up.addEventListener('click', function () { swap(i, i - 1); });
      down.addEventListener('click', function () { swap(i, i + 1); });
      del.addEventListener('click', function () { state.prizes.splice(i, 1); renderPrizes(); refresh(); });
      ops.appendChild(up); ops.appendChild(down); ops.appendChild(del);
      tr.appendChild(cell(ops, 'ops'));
      body.appendChild(tr);
    });
  }

  function swap(a, b) {
    var t = state.prizes[a]; state.prizes[a] = state.prizes[b]; state.prizes[b] = t;
    renderPrizes(); refresh();
  }

  $('normalize').addEventListener('click', function () {
    var ws = state.prizes.map(function (p) { var w = Number(p.weight); return isFinite(w) && w > 0 ? w : 0; });
    var sum = ws.reduce(function (a, b) { return a + b; }, 0);
    if (sum <= 0) { toast('先填写至少一个大于 0 的权重'); return; }
    var out = ws.map(function (w) { return round((w / sum) * 100, 4); });
    var diff = round(100 - out.reduce(function (a, b) { return a + b; }, 0), 4);
    if (diff !== 0) { var m = 0; out.forEach(function (w, i) { if (w > out[m]) m = i; }); out[m] = round(out[m] + diff, 4); }
    var lost = out.some(function (w, i) { return ws[i] > 0 && w === 0; });
    state.prizes.forEach(function (p, i) { p.weight = out[i]; });
    renderPrizes(); refresh();
    if (lost) toast('注意：有奖项的概率小到被舍入为 0，实际不会被抽中');
  });
  $('equalize').addEventListener('click', function () {
    state.prizes.forEach(function (p) { p.weight = 1; }); // 权重全 1，引擎自动折算为均分，不凑整
    renderPrizes(); refresh();
  });
  $('addPrize').addEventListener('click', function () {
    if (state.prizes.length >= 12) { toast('奖项最多 12 个'); return; }
    state.prizes.push({ id: nextPrizeId(), label: '新奖项', sub: '', weight: 1, cost: null, highlight: false });
    renderPrizes(); refresh();
  });

  /* ---------- 派生内容：概率、提示、预览、预算、导出 ---------- */
  function renderDerivedPrizes() {
    var probs = E.weightsOf(state.prizes), sum = 0;
    state.prizes.forEach(function (p) { var w = Number(p.weight); if (isFinite(w) && w > 0) sum += w; });
    pctCells.forEach(function (c, i) { c.textContent = E.formatPct(probs[i] || 0); });
    var line = $('sumLine');
    var okSum = Math.abs(sum - 100) < 1e-6;
    line.textContent = '概率权重合计：' + fmtNum(round(sum, 4), 4) + (okSum ? '  ✓ 恰好 100' : '  （将按比例折算为 100%）');
    line.className = 'sumline ' + (okSum ? 'ok' : (sum > 0 ? '' : 'bad'));
  }

  function renderMessages() {
    var v = E.validateConfig(state), ul = $('msgs');
    ul.textContent = '';
    v.errors.forEach(function (m) { ul.appendChild(el('li', 'err', '✕ ' + m)); });
    if (sigOf(state) !== initial.sig && state.campaignId === initial.campaignId) {
      ul.appendChild(el('li', 'warn', '⚠ 你修改了奖项的概率/顺序/数量，但期号没变。实测：把某一项概率挪 1 个百分点，约 7% 的 UID 会换奖；调换前两项顺序约 16%；换期号约 77% 的 UID 会换奖。已抽过的客户再打开页面或来领奖，结果可能与之前不同。活动期内请不要改；新一期请点「新一期」，旧期号的抽奖记录全部作废。'));
    }
    v.warnings.forEach(function (m) { ul.appendChild(el('li', 'warn', '⚠ ' + m)); });
    var blocked = v.errors.length > 0;
    $('copyCfg').disabled = blocked; $('dlCfg').disabled = blocked;
    $('exportBlock').hidden = !blocked;
    return v;
  }

  var preview = null, pAngle = 0, previewTimer = 0, lastT = 0;
  function renderPreview() {
    var holder = $('previewHolder');
    if (state.prizes.length < 2 || state.prizes.length > 12) {
      preview = null; holder.textContent = '';
      holder.appendChild(el('p', 'hint-line', '奖项数需在 2–12 之间才能预览'));
      return;
    }
    preview = R.mount(holder, state.prizes, { hubLabel: '预览', hubAria: '预览' });
    preview.hub.tabIndex = -1;
    preview.setAngle(pAngle);
  }
  function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 140); }
  function previewLoop(ts) {
    var dt = lastT ? Math.min(0.1, (ts - lastT) / 1000) : 0; lastT = ts;
    if (preview) { pAngle += 14 * dt; preview.setAngle(pAngle); }
    requestAnimationFrame(previewLoop);
  }

  var budgetBuilt = false, budgetDl = null;
  function renderBudget() {
    var box = $('budget');
    if (!budgetBuilt) {
      budgetBuilt = true;
      var ctrl = el('div', 'ctrl');
      var l1 = el('label', null, '预计参与人数'), l2 = el('label', null, '其中入金领奖的比例 %');
      var i1 = numInput(budgetIn.people, '', '预计参与人数', function (v) { budgetIn.people = Math.max(0, Number(v) || 0); renderBudget(); });
      var i2 = numInput(budgetIn.claimPct, '', '入金领奖比例', function (v) { budgetIn.claimPct = Math.min(100, Math.max(0, Number(v) || 0)); renderBudget(); });
      ctrl.appendChild(l1); ctrl.appendChild(i1); ctrl.appendChild(l2); ctrl.appendChild(i2);
      budgetDl = document.createElement('dl');
      box.appendChild(ctrl); box.appendChild(budgetDl);
      box.appendChild(el('p', 'note', '奖励只在客户首次入金并核验后发放，所以实际成本 ≈ 参与人数 × 领奖比例 × 每人期望奖励。领奖比例是你的假设，不是预测；分位数用正态近似，只作量级参考，不是预算封顶。'));
    }
    budgetDl.textContent = '';
    var row = function (k, v) { budgetDl.appendChild(el('dt', null, k)); budgetDl.appendChild(el('dd', null, v)); };
    var s = E.payoutStats(state, budgetIn.people, budgetIn.claimPct / 100);
    if (!s.complete) { row('每人期望奖励', '请为每个奖项填写不为负的成本'); return; }
    row('每人期望奖励', fmtNum(s.evPerPerson, 2) + ' 美元');
    row('预计发放（领奖 ' + budgetIn.claimPct + '%）', '≈ ' + fmtNum(s.claimMean, 0) + ' 美元');
    row('　　95% 情形下不超过', '≈ ' + fmtNum(s.claimP95, 0) + ' 美元');
    row('　　99% 情形下不超过', '≈ ' + fmtNum(s.claimP99, 0) + ' 美元');
    row('全部参与者都领奖：期望', '≈ ' + fmtNum(s.allMean, 0) + ' 美元');
    row('　　99% 情形下不超过', '≈ ' + fmtNum(s.allP99, 0) + ' 美元');
    row('理论最坏（人人抽中最大奖）', fmtNum(s.worst, 0) + ' 美元');
    row('最大奖：' + s.tops.join('、'), fmtNum(s.maxCost, 0) + ' 美元');
    row('至少 1 人抽中最大奖', E.formatPct(Math.min(1, s.atLeastOneDrawn)));
    row('至少 1 人抽中并领走最大奖', E.formatPct(Math.min(1, s.atLeastOneClaimed)));
    row('最大奖预计抽中人数', fmtNum(s.expectedTops, 1));
  }

  var CFG_ORDER = ['status', 'campaignId', 'channelName', 'title', 'highlight', 'subtitle', 'startAt', 'endAt', 'uidPattern', 'uidLabel', 'showOdds', 'idleSpeed', 'spinSeconds', 'minTurns', 'contact', 'notice', 'riskNotice', 'claim', 'rules', 'disclaimer', 'updatedAt'];
  function buildConfigJs() {
    var out = {};
    CFG_ORDER.forEach(function (k) { out[k] = state[k]; });
    // 对外公开的 config.js 不含内部成本
    out.prizes = state.prizes.map(function (p) {
      var o = { id: p.id, label: p.label, sub: p.sub, weight: p.weight };
      if (p.highlight) o.highlight = true;
      return o;
    });
    var json = JSON.stringify(out, null, 2)
      .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029').replace(/</g, '\\u003c');
    var head = [
      '/* config.js — 转盘配置（由 admin.html 生成）',
      ' * 修改奖项/概率/顺序时请同时更换 campaignId（新一期），活动期内不要改。',
      ' * 本文件会被公开访问：不要写入密钥、内部链接、客户资料或内部成本。 */'
    ].join('\n');
    return head + '\nwindow.WHEEL_CONFIG = ' + json + ';\n';
  }

  function refresh() {
    renderDerivedPrizes();
    renderMessages();
    renderBudget();
    $('cfgOut').value = buildConfigJs();
    schedulePreview();
  }

  /* ---------- 抽样模拟 ---------- */
  $('simBtn').addEventListener('click', function () {
    var v = E.validateConfig(state);
    if (v.errors.length) { toast('请先修正奖项里的错误'); return; }
    var total = Math.min(200000, Math.max(1000, parseInt($('simN').value, 10) || 20000)), done = 0, base = 20000000;
    var counts = state.prizes.map(function () { return 0; }), btn = $('simBtn');
    btn.disabled = true;
    (function step() {
      var size = Math.min(5000, total - done), part = E.simulate(state, size, base + done);
      part.forEach(function (c, i) { counts[i] += c; });
      done += size;
      btn.textContent = Math.round((done / total) * 100) + '%';
      if (done < total) { setTimeout(step, 0); return; }
      btn.disabled = false; btn.textContent = '开始模拟';
      var probs = E.weightsOf(state.prizes), body = $('simBody');
      body.textContent = '';
      state.prizes.forEach(function (p, i) {
        var tr = document.createElement('tr'), obs = counts[i] / total, d = (obs - probs[i]) * 100;
        var se = Math.sqrt(probs[i] * (1 - probs[i]) / total) * 100; // 标准误（百分点）
        var within = Math.abs(d) <= 2 * se + 1e-9;
        tr.appendChild(el('td', null, E.prizeText(p)));
        tr.appendChild(el('td', 'r', E.formatPct(probs[i])));
        tr.appendChild(el('td', 'r', E.formatPct(obs)));
        tr.appendChild(el('td', 'r', (d >= 0 ? '+' : '') + d.toFixed(2) + 'pp' + (within ? '' : ' ⚠')));
        body.appendChild(tr);
      });
      $('simNote').textContent = '偏差旁的 ⚠ 表示超过 ±2 倍标准误（抽样 ' + fmtNum(total, 0) + ' 次时，0.5% 的奖项标准误约 ' + (Math.sqrt(0.005 * 0.995 / total) * 100).toFixed(2) + 'pp），否则只是抽样噪音。';
      $('simWrap').hidden = false;
    })();
  });

  /* ---------- 核验 ---------- */
  $('vUidBtn').addEventListener('click', function () {
    var out = $('vUidOut'), v = E.validateUid(state, $('vUid').value);
    out.hidden = false;
    if (!v.ok) { out.textContent = v.message; return; }
    out.textContent = E.voucherText(state, E.drawForUid(state, v.uid));
  });

  $('vTextBtn').addEventListener('click', function () {
    var out = $('vTextOut'), r = E.verifyVoucher(state, $('vText').value);
    out.className = 'verdict';
    if (!r.ok) {
      out.classList.add('bad');
      out.textContent = '✕ 无效：' + r.reason + (r.draw && !r.prizeMismatch ? '（按当前配置，该 UID 应得：' + E.prizeText(r.draw.prize) + '）' : '');
      return;
    }
    out.classList.add('good');
    out.textContent = '✓ 记录与算法一致：UID ' + r.draw.uid + ' 在期号 ' + state.campaignId + ' 抽中「' + E.prizeText(r.draw.prize) + '」。注意：校验码只防抄错，不防伪造（算法公开）。请再用后台数据核对：是否首次入金、是否达标、是否本渠道客户、是否已领取过。';
  });

  /* ---------- 导出 ---------- */
  $('copyCfg').addEventListener('click', function () { copyText(buildConfigJs(), '已复制，去替换 wheel/config.js'); });
  $('dlCfg').addEventListener('click', function () {
    var blob = new Blob([buildConfigJs()], { type: 'text/javascript;charset=utf-8' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'config.js';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  /* ---------- 启动 ---------- */
  renderPrizes();
  refresh();
  renderPreview();
  requestAnimationFrame(previewLoop);
})();
