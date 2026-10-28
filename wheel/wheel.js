/* wheel.js — 转盘页面控制器 */
(function () {
  'use strict';

  var E = window.WheelEngine, R = window.WheelRender;
  var cfg = E.normalizeConfig(window.WHEEL_CONFIG);
  var n = cfg.prizes.length;
  var $ = function (id) { return document.getElementById(id); };
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var idleSpeed = reduceMotion ? 0 : cfg.idleSpeed;
  var spinSeconds = reduceMotion ? 2.2 : cfg.spinSeconds;
  var STORE = 'channelGames:wheel:' + cfg.campaignId;
  var isDraft = cfg.status !== 'live';

  /* ---------- 配置自检：配置有误时停用抽奖，而不是带着错误概率上线 ---------- */
  var problems = E.validateConfig(cfg).errors;

  /* ---------- 本机记录：只保存“最近一次”的 UID 与结果，用于刷新后直接展示（不是防作弊依据） ---------- */
  function readLast() {
    try {
      var o = JSON.parse(localStorage.getItem(STORE) || 'null');
      return o && typeof o.uid === 'string' && typeof o.prizeId === 'string' ? o : null;
    } catch (e) { return null; }
  }
  function writeLast(uid, prizeId) {
    try { localStorage.setItem(STORE, JSON.stringify({ uid: uid, prizeId: prizeId })); } catch (e) { /* 隐私模式等：忽略 */ }
  }

  /* ---------- 文案 ---------- */
  function renderTitle() {
    var h = $('title'), t = cfg.title, k = cfg.highlight;
    h.textContent = '';
    var at = k ? t.indexOf(k) : -1;
    if (at < 0) { h.textContent = t; return; }
    h.appendChild(document.createTextNode(t.slice(0, at)));
    var span = document.createElement('span');
    span.className = 'hl';
    span.textContent = k;
    h.appendChild(span);
    h.appendChild(document.createTextNode(t.slice(at + k.length)));
  }

  function fillList(listEl, items, cardEl) {
    listEl.textContent = '';
    items.forEach(function (s) {
      var li = document.createElement('li');
      li.textContent = s;
      listEl.appendChild(li);
    });
    if (cardEl) cardEl.hidden = items.length === 0;
  }

  function fillParas(box, items) {
    box.textContent = '';
    items.forEach(function (s) {
      var p = document.createElement('p');
      p.textContent = s;
      box.appendChild(p);
    });
  }

  function renderStatic() {
    document.title = cfg.channelName ? '专属福利转盘 · ' + cfg.channelName : '专属福利转盘';
    $('channelPill').textContent = cfg.channelName;
    $('channelPill').hidden = !cfg.channelName;
    renderTitle();
    $('subtitle').textContent = cfg.subtitle;
    $('uidLabel').textContent = cfg.uidLabel;
    $('draftBanner').hidden = !isDraft;
    fillList($('claimSteps'), cfg.claim.steps, $('claimCard'));
    $('notice').textContent = cfg.notice;
    $('notice').hidden = !cfg.notice;
    $('riskNotice').textContent = cfg.riskNotice;
    $('riskNotice').hidden = !cfg.riskNotice;
    fillList($('rulesList'), cfg.rules, $('rulesCard'));
    fillParas($('disclaimer'), cfg.disclaimer);
    $('updated').textContent = cfg.updatedAt ? '最后更新 ' + cfg.updatedAt : '';

    // 奖项与概率（对客公示，默认开启）
    var body = $('oddsBody'), probs = E.weightsOf(cfg.prizes);
    body.textContent = '';
    if (cfg.showOdds) {
      cfg.prizes.forEach(function (p, i) {
        var tr = document.createElement('tr');
        var a = document.createElement('td'); a.textContent = E.prizeText(p);
        var b = document.createElement('td'); b.className = 'r'; b.textContent = E.formatPct(probs[i]);
        tr.appendChild(a); tr.appendChild(b); body.appendChild(tr);
      });
    }
    $('oddsCard').hidden = !cfg.showOdds;
  }

  /* ---------- 活动时间 ---------- */
  var startMs = cfg.startAt ? Date.parse(cfg.startAt) : NaN;
  var endMs = cfg.endAt ? Date.parse(cfg.endAt) : NaN;
  // 页面状态只用于展示。是否在活动期内，以后台数据里的首次入金时间为准，不以页面状态为准。
  function phase() {
    var now = Date.now();
    if (isFinite(startMs) && now < startMs) return 'before';
    if (isFinite(endMs) && now > endMs) return 'ended';
    return 'running';
  }
  function pad(x) { return (x < 10 ? '0' : '') + x; }
  function fmtLeft(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (d > 0 ? d + ' 天 ' : '') + pad(h) + ':' + pad(m) + ':' + pad(x);
  }
  function fmtStart() {
    var d = new Date(startMs + 8 * 3600 * 1000); // 统一按 UTC+8 展示
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + '（UTC+8）';
  }
  function fmtEnd() { return cfg.endAt.slice(0, 16).replace('T', ' ') + '（UTC+8）'; }
  function tickCountdown() {
    var box = $('countdown'), note = $('countdownNote'), ph = phase(), now = Date.now();
    if (!isFinite(endMs) && !isFinite(startMs)) { box.hidden = true; note.hidden = true; return; }
    box.hidden = false;
    note.hidden = true;
    if (ph === 'before') { $('countdownLabel').textContent = '距开始'; $('countdownTime').textContent = fmtLeft(startMs - now); note.textContent = '开始时间 ' + fmtStart(); note.hidden = false; }
    else if (ph === 'ended') { $('countdownLabel').textContent = '活动已结束'; $('countdownTime').textContent = ''; }
    else if (isFinite(endMs)) { $('countdownLabel').textContent = '距结束'; $('countdownTime').textContent = fmtLeft(endMs - now); note.textContent = '截止时间 ' + fmtEnd(); note.hidden = false; }
    else box.hidden = true;
  }

  /* ---------- 转盘 ---------- */
  var wheel = null;
  var angle = Math.random() * 360;
  var mode = 'idle'; // idle | spin | done
  var plan = null, t0 = 0, a0 = 0, lastTs = 0, lastSeg = -1, lastAngle = angle, current = null;

  function frame(ts) {
    var dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    if (mode === 'idle') {
      angle += idleSpeed * dt;
    } else if (mode === 'spin') {
      var t = (ts - t0) / 1000;
      angle = a0 + E.spinAngle(plan, t);
      var speed = dt > 0 ? Math.abs(angle - lastAngle) / dt : 0;
      var seg = E.segmentAtPointer(angle, n);
      if (seg !== lastSeg) { lastSeg = seg; if (speed < 900) wheel.kick(); }
      if (t >= plan.T) finishSpin();
    }
    lastAngle = angle;
    wheel.setAngle(angle);
    window.requestAnimationFrame(frame);
  }

  function startSpin(draw) {
    current = draw;
    var A = E.targetRotation(draw.index, n, angle, cfg.minTurns, draw.jitter);
    plan = E.spinPlan(A, idleSpeed, spinSeconds, Math.min(0.7, spinSeconds / 4), 2.4);
    a0 = angle; t0 = performance.now(); lastSeg = E.segmentAtPointer(angle, n);
    mode = 'spin';
    wheel.setSpinning(true);
    wheel.setHubLabel('…');
    $('spinBtn').disabled = true;
    $('hint').hidden = true;
  }

  function finishSpin() {
    angle = a0 + plan.A;
    mode = 'done';
    wheel.setSpinning(false);
    wheel.highlight(current.index);
    wheel.setHubLabel('查看');
    $('spinBtn').disabled = false;
    $('spinBtn').textContent = '查看结果';
    writeLast(current.uid, current.prize.id);
    if (navigator.vibrate) { try { navigator.vibrate(40); } catch (e) { /* ignore */ } }
    window.setTimeout(function () { showResult(current); }, reduceMotion ? 100 : 650);
  }

  function resetToIdle() {
    if (mode === 'spin') return;
    mode = 'idle';
    current = null;
    wheel.highlight(null);
    wheel.setHubLabel('抽奖');
    $('spinBtn').textContent = '立即抽奖';
  }

  /* ---------- UID 输入与提示 ---------- */
  var uidInput = $('uid'), msg = $('uidMsg');
  function setMsg(text, isError) {
    msg.textContent = text || '';
    msg.classList.toggle('is-error', !!isError);
    uidInput.classList.toggle('is-error', !!isError);
    uidInput.setAttribute('aria-invalid', isError ? 'true' : 'false');
  }
  function shake() {
    var f = $('uidForm');
    f.classList.remove('shake');
    void f.offsetWidth;
    f.classList.add('shake');
  }

  function attemptSpin() {
    if (mode === 'spin') return;
    if (problems.length) { setMsg('活动配置异常，暂时无法抽奖，请联系你的客户经理', true); return; }
    var v = E.validateUid(cfg, uidInput.value);
    if (!v.ok) {
      setMsg(v.message, true);
      shake();
      uidInput.focus();
      if (uidInput.scrollIntoView) uidInput.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      return;
    }
    setMsg('');
    var draw = E.drawForUid(cfg, v.uid);
    var last = readLast();
    var already = last && last.uid === draw.uid && last.prizeId === draw.prize.id;
    if (current && current.uid === draw.uid && mode === 'done') { showResult(current); return; }
    // 活动结束后，已在本机抽过的 UID 仍可查看自己的结果（结果固定，不构成再次抽奖）
    var ph = phase();
    if (ph === 'before' && !already) { setMsg('活动将于 ' + fmtStart() + ' 开始，届时再来抽奖', true); return; }
    if (ph === 'ended' && !already) { setMsg('活动已结束，已无法抽奖。如你已保存抽奖记录，请尽快联系客户经理登记。', true); return; }
    if (already) {
      // 这台设备上这个 UID 已经抽过：不再重复动画，直接定位到结果并展示
      current = draw; mode = 'done';
      angle = angle + E.targetRotation(draw.index, n, angle, 0, draw.jitter);
      wheel.highlight(draw.index);
      wheel.setHubLabel('查看');
      $('spinBtn').textContent = '查看结果';
      showResult(draw);
      return;
    }
    resetToIdle();
    startSpin(draw);
  }

  /* ---------- 结果面板 ---------- */
  var sheet = $('sheet'), backdrop = $('sheetBackdrop'), lastFocus = null, closeTimer = 0;

  function showResult(draw) {
    $('resDraft').hidden = !isDraft;
    $('resPrize').textContent = draw.prize.label;
    $('resSub').textContent = draw.prize.sub || '';
    $('resSub').hidden = !draw.prize.sub;
    $('resNote').textContent = '这只是抽奖结果，奖励尚未发放。需在活动期内完成首次入金并达到净入金门槛，经客户经理核验通过后才会发放；未达标或核验未通过则不发放。';
    $('voucher').textContent = E.voucherText(cfg, draw);
    $('sheetNotice').textContent = cfg.notice;
    $('sheetNotice').hidden = !cfg.notice;
    $('sheetRisk').textContent = cfg.riskNotice;
    $('sheetRisk').hidden = !cfg.riskNotice;
    fillList($('sheetSteps'), cfg.claim.steps, null);
    fillParas($('sheetFoot'), cfg.disclaimer);

    var tg = E.safeTelegramUrl(cfg.contact.telegram), wx = cfg.contact.wechat, dep = E.safeDepositUrl(cfg.contact.depositUrl);
    $('tgLink').hidden = !tg; if (tg) $('tgLink').href = tg;
    $('copyWechat').hidden = !wx; $('copyWechat').textContent = wx ? '复制客户经理微信号：' + wx : '';
    $('depositLink').hidden = !dep; if (dep) $('depositLink').href = dep;
    $('noContact').hidden = !!(tg || wx);
    $('contactNote').hidden = !(tg || wx);

    lastFocus = document.activeElement;
    clearTimeout(closeTimer);
    sheet.hidden = false; backdrop.hidden = false;
    void sheet.offsetWidth;
    sheet.classList.add('open'); backdrop.classList.add('open');
    sheet.scrollTop = 0;
    sheet.focus();
  }

  function closeSheet() {
    sheet.classList.remove('open'); backdrop.classList.remove('open');
    closeTimer = window.setTimeout(function () { sheet.hidden = true; backdrop.hidden = true; }, 340);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  var toastTimer = 0;
  function toast(text) {
    var t = $('toast');
    t.textContent = text; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.left = '-9999px'; ta.style.top = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      toast(ok ? okMsg : '复制失败，请长按文字手动复制');
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback);
    } else fallback();
  }

  /* ---------- 启动 ---------- */
  renderStatic();
  if (problems.length) {
    $('configError').hidden = false;
    $('configError').textContent = '活动配置异常，暂时无法抽奖。';
    if (window.console && console.error) console.error('WHEEL_CONFIG errors:', problems);
  }
  // 配置异常时（如奖项数不合法）不渲染转盘，避免带着错误数据运行
  var renderable = n >= 2 && n <= 12;
  if (renderable) wheel = R.mount($('wheelHolder'), cfg.prizes, { hubLabel: '抽奖' });
  else wheel = { hub: document.createElement('button'), setAngle: function () {}, setHubLabel: function () {}, highlight: function () {}, kick: function () {}, setSpinning: function () {} };

  $('uidForm').addEventListener('submit', function (e) { e.preventDefault(); attemptSpin(); });
  wheel.hub.addEventListener('click', function () {
    if (!uidInput.value.trim()) { setMsg('请先输入你的 UID，再点击抽奖', true); shake(); uidInput.focus(); return; }
    attemptSpin();
  });
  uidInput.addEventListener('input', function () {
    setMsg('');
    if (mode === 'done' && current && E.normalizeUid(uidInput.value) !== current.uid) resetToIdle();
  });
  $('sheetClose').addEventListener('click', closeSheet);
  backdrop.addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });
  $('copyVoucher').addEventListener('click', function () { if (current) copyText(E.voucherText(cfg, current), '已复制，可发给客户经理登记核验'); });
  $('copyWechat').addEventListener('click', function () { copyText(cfg.contact.wechat, '微信号已复制'); });

  tickCountdown();
  window.setInterval(tickCountdown, 1000);
  window.requestAnimationFrame(frame);
})();
