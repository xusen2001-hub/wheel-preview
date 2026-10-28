/* engine.js — 转盘核心逻辑（纯函数，无 DOM，无网络）
 *
 * 设计要点
 *  1. 抽奖结果 = 哈希(期号 + UID) → [0,1) → 按权重取奖。同一期内，同一个 UID 永远抽到同一个奖：
 *     清缓存/换设备/多次刷新都无法重抽；客户经理在 admin.html 输入 UID 即可复算核验。
 *  2. UID 必须通过严格格式校验（默认：1-9 开头的 6-10 位数字）才会参与抽奖/核验，
 *     否则“补前导 0”“夹不可见字符”等写法会各自得到一个独立的结果，等于变相重抽。
 *  3. 哈希用纯 JS 的 SHA-256（同步），不依赖 crypto.subtle，所以 file:// 与非 HTTPS 环境也能跑。
 *  4. 没有密钥：任何人读源码都能复算任意 UID 的结果与校验码。校验码只防抄错/随手改字，不防伪造；
 *     发放一律以客户经理按 UID 复算的奖项 + 后台数据核验为准。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WheelEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- SHA-256 ---------------- */
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var d = str.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function sha256Hex(str) {
    var bytes = utf8Bytes(String(str));
    var len = bytes.length;
    var total = Math.ceil((len + 9) / 64) * 64;
    var buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    var bitsHi = Math.floor(len / 0x20000000);
    var bitsLo = (len * 8) >>> 0;
    buf[total - 8] = (bitsHi >>> 24) & 255; buf[total - 7] = (bitsHi >>> 16) & 255;
    buf[total - 6] = (bitsHi >>> 8) & 255; buf[total - 5] = bitsHi & 255;
    buf[total - 4] = (bitsLo >>> 24) & 255; buf[total - 3] = (bitsLo >>> 16) & 255;
    buf[total - 2] = (bitsLo >>> 8) & 255; buf[total - 1] = bitsLo & 255;

    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Array(64);
    for (var off = 0; off < total; off += 64) {
      var i;
      for (i = 0; i < 16; i++) {
        w[i] = (buf[off + i * 4] << 24) | (buf[off + i * 4 + 1] << 16) | (buf[off + i * 4 + 2] << 8) | buf[off + i * 4 + 3];
      }
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    var hex = '';
    for (var k = 0; k < 8; k++) hex += ('00000000' + (h[k] >>> 0).toString(16)).slice(-8);
    return hex;
  }

  /* ---------------- 配置：默认值与清洗 ---------------- */
  var DEFAULT_UID_PATTERN = '^[1-9][0-9]{5,9}$';
  var PLACEHOLDER_RE = /示例|草稿|待确认|TODO|XXX/i;
  var LINK_HOSTS = ['bit.com']; // 入金链接只放行这些域名（含子域）；要加域名须改代码并走评审

  var DEFAULTS = {
    status: 'draft',
    campaignId: 'wheel-draft',
    channelName: '',
    title: '转一转，抽取渠道专属奖励',
    highlight: '专属奖励',
    subtitle: '',
    startAt: '',
    endAt: '',
    uidPattern: DEFAULT_UID_PATTERN,
    uidLabel: '你的 BIT UID',
    showOdds: true,
    idleSpeed: 24,
    spinSeconds: 5.4,
    minTurns: 6,
    contact: { telegram: '', wechat: '', depositUrl: '' },
    claim: { steps: [] },
    rules: [],
    notice: '',
    riskNotice: '',
    disclaimer: [],
    updatedAt: '',
    prizes: []
  };

  function str(v, d) { return v == null ? d : String(v); }
  function strArr(v) {
    if (Array.isArray(v)) return v.map(function (s) { return String(s).trim(); }).filter(Boolean);
    if (typeof v === 'string' && v.trim()) return [v.trim()];
    return [];
  }
  function num(v, d, lo, hi) {
    var n = Number(v);
    if (v === '' || v == null || !isFinite(n)) n = d;
    return Math.min(hi, Math.max(lo, n));
  }

  /** 把任意输入清洗成类型正确的配置；文本字段一律转字符串，数组字段一律转字符串数组，数值字段夹到安全范围。 */
  function normalizeConfig(input) {
    var src = input && typeof input === 'object' ? input : {};
    var contact = src.contact && typeof src.contact === 'object' ? src.contact : {};
    var claim = src.claim && typeof src.claim === 'object' ? src.claim : {};
    var cfg = {
      status: src.status === 'live' ? 'live' : 'draft',
      campaignId: str(src.campaignId, DEFAULTS.campaignId).trim() || DEFAULTS.campaignId,
      channelName: str(src.channelName, DEFAULTS.channelName).trim(),
      title: str(src.title, DEFAULTS.title),
      highlight: str(src.highlight, DEFAULTS.highlight),
      subtitle: str(src.subtitle, DEFAULTS.subtitle),
      startAt: str(src.startAt, '').trim(),
      endAt: str(src.endAt, '').trim(),
      uidPattern: str(src.uidPattern, DEFAULT_UID_PATTERN).trim() || DEFAULT_UID_PATTERN,
      uidLabel: str(src.uidLabel, DEFAULTS.uidLabel),
      showOdds: src.showOdds === undefined ? true : !!src.showOdds,
      idleSpeed: num(src.idleSpeed, DEFAULTS.idleSpeed, 0, 120),
      spinSeconds: num(src.spinSeconds, DEFAULTS.spinSeconds, 2, 12),
      minTurns: Math.floor(num(src.minTurns, DEFAULTS.minTurns, 1, 12)),
      contact: {
        telegram: str(contact.telegram, '').trim(),
        wechat: str(contact.wechat, '').trim(),
        depositUrl: str(contact.depositUrl, '').trim()
      },
      claim: { steps: strArr(claim.steps) },
      rules: strArr(src.rules),
      notice: str(src.notice, '').trim(),
      riskNotice: str(src.riskNotice, '').trim(),
      disclaimer: strArr(src.disclaimer),
      updatedAt: str(src.updatedAt, '').trim(),
      prizes: []
    };
    var ps = Array.isArray(src.prizes) ? src.prizes : [];
    cfg.prizes = ps.map(function (p, i) {
      p = p && typeof p === 'object' ? p : {};
      var w = p.weight === '' || p.weight == null ? NaN : Number(p.weight);
      var cost = p.cost === '' || p.cost == null ? null : Number(p.cost);
      return {
        id: str(p.id, '') || 'p' + (i + 1),
        label: str(p.label, ''),
        sub: str(p.sub, ''),
        weight: w,
        cost: cost != null && isFinite(cost) ? cost : null,
        highlight: !!p.highlight
      };
    });
    return cfg;
  }

  /* ---------------- 权重 / 抽奖 ---------------- */
  function weightsOf(prizes) {
    var ws = prizes.map(function (p) { var w = Number(p.weight); return isFinite(w) && w > 0 ? w : 0; });
    var sum = ws.reduce(function (a, b) { return a + b; }, 0);
    if (sum <= 0 || !isFinite(sum)) return ws.map(function () { return 1 / ws.length; });
    return ws.map(function (w) { return w / sum; });
  }

  /** UID 规范化：只去首尾空白并转小写。内部空白/不可见字符不会被悄悄吞掉——它们会让格式校验失败。 */
  function normalizeUid(uid) {
    return String(uid == null ? '' : uid).trim().toLowerCase();
  }

  function unitFromHash(hex, from) {
    // 取 13 个十六进制字符 = 52 bit，恰好是 double 能精确表示的整数范围
    return parseInt(hex.slice(from, from + 13), 16) / 4503599627370496;
  }

  function pickIndex(probs, u) {
    var acc = 0, last = -1;
    for (var i = 0; i < probs.length; i++) {
      if (probs[i] > 0) { last = i; acc += probs[i]; if (u < acc) return i; }
    }
    return last;
  }

  function checkCode(cfg, uid, prizeId) {
    var h = sha256Hex(cfg.campaignId + '|' + normalizeUid(uid) + '|' + prizeId + '|v1').slice(0, 8).toUpperCase();
    return h.slice(0, 4) + '-' + h.slice(4);
  }

  /** 对一个【已通过 validateUid 的】UID 抽奖（确定性）。返回 {index, prize, uid, u, jitter, code} */
  function drawForUid(cfg, uid) {
    var nuid = normalizeUid(uid);
    var hex = sha256Hex(cfg.campaignId + '|' + nuid + '|draw');
    var u = unitFromHash(hex, 0);
    var index = pickIndex(weightsOf(cfg.prizes), u);
    var prize = cfg.prizes[index];
    var jitter = (unitFromHash(hex, 13) - 0.5) * 0.7; // 落点在扇区内的偏移，±35%，避免压线
    return { index: index, prize: prize, uid: nuid, u: u, jitter: jitter, code: checkCode(cfg, nuid, prize.id) };
  }

  function prizeText(p) { return (p.label + (p.sub ? ' ' + p.sub : '')).trim(); }

  function voucherText(cfg, draw) {
    return [
      '【专属转盘·抽奖记录】',
      '期号：' + cfg.campaignId,
      'UID：' + draw.uid,
      '奖项：' + prizeText(draw.prize),
      '校验码：' + draw.code,
      '（仅用于登记核验，不是奖励发放凭证，不可转让；须首次入金达标并经客户经理核验后方可发放）'
    ].join('\n');
  }

  function validateUid(cfg, raw) {
    var uid = String(raw == null ? '' : raw).trim();
    if (!uid) return { ok: false, message: '请先输入你的 UID' };
    var re;
    try { re = new RegExp(cfg.uidPattern); } catch (e) { re = new RegExp(DEFAULT_UID_PATTERN); }
    if (uid.length > 64 || !re.test(uid)) return { ok: false, message: 'UID 格式不正确，请核对你的 BIT UID 后重新输入' };
    return { ok: true, uid: uid };
  }

  function squash(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  /** 从客户发来的抽奖记录里解析并复算核验。UID 必须通过严格格式校验；奖项文字必须与复算结果一致。 */
  function verifyVoucher(cfg, text) {
    var t = String(text || '')
      .replace(/[ 　]/g, ' ')
      .replace(/[：﹕]/g, ':')
      .replace(/[‐-―−]/g, '-');
    var pick = function (re) { var m = t.match(re); return m ? m[1].trim() : ''; };
    var campaign = pick(/期号\s*:\s*([0-9A-Za-z._-]+)/);
    var uid = pick(/UID\s*:\s*(\S+)/i).replace(/[。，,;；.]+$/, '');
    var code = pick(/校验码\s*:\s*([0-9A-Za-z-]+)/);
    var claimed = squash(pick(/奖项\s*:\s*(.+)/));
    if (!uid || !code) return { ok: false, reason: '未能从文本中解析出 UID / 校验码，请让客户重新复制完整的抽奖记录' };
    var v = validateUid(cfg, uid);
    if (!v.ok) return { ok: false, reason: '记录中的 UID 含非法字符或格式不符（原文：' + JSON.stringify(uid) + '），请按客户的真实 UID 用“按 UID 复算”核对' };
    if (campaign && campaign !== cfg.campaignId) {
      return { ok: false, reason: '期号不一致：记录为 ' + campaign + '，当前配置为 ' + cfg.campaignId };
    }
    var d = drawForUid(cfg, v.uid);
    if (d.code.toUpperCase() !== code.replace(/-/g, '').replace(/^(.{4})(.{4})$/, '$1-$2').toUpperCase()) {
      return { ok: false, reason: '校验码不匹配：可能被改动，或奖项配置已变更', draw: d };
    }
    var real = squash(prizeText(d.prize));
    if (claimed && claimed !== real) {
      return { ok: false, reason: '奖项被改动：记录上写的是「' + claimed + '」，按算法复算该 UID 实际抽中的是「' + real + '」', draw: d, claimedPrize: claimed, prizeMismatch: true };
    }
    return { ok: true, draw: d, claimedPrize: claimed, prizeMismatch: false };
  }

  /* ---------------- 链接白名单 ---------------- */
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /** 返回规范化后的 Telegram 链接，不合法返回 ''。接受 @name、name、t.me/name、https://t.me/name。 */
  function safeTelegramUrl(v) {
    v = String(v == null ? '' : v).trim();
    if (!v) return '';
    var m = v.match(/^(?:https:\/\/)?((?:t|telegram)\.me\/[A-Za-z0-9_+\/-]+)$/i);
    if (m) return 'https://' + m[1];
    v = v.replace(/^@/, '');
    return /^[A-Za-z0-9_]{4,32}$/.test(v) ? 'https://t.me/' + v : '';
  }

  /** 入金链接：仅 https，且域名必须是白名单域名（含子域），不允许 userinfo、端口、反斜杠。 */
  function safeDepositUrl(v) {
    v = String(v == null ? '' : v).trim();
    if (!v) return '';
    var hosts = LINK_HOSTS.map(escapeRe).join('|');
    var re = new RegExp('^https://(?:[a-z0-9-]+\\.)*(?:' + hosts + ')(?:/[A-Za-z0-9._~:/?#@!$&()*+,;=%\\[\\]-]*)?$', 'i');
    return re.test(v) ? v : '';
  }

  /* ---------------- 动画几何 ---------------- */
  /** 需要再转多少度，才能让 index 号扇区（含落点偏移 jitter）停在顶部指针下。 */
  function targetRotation(index, n, current, minTurns, jitter) {
    var seg = 360 / n;
    var offset = (index + 0.5 + (jitter || 0)) * seg; // 指针下方的转盘局部角度
    var need = (((-offset - current) % 360) + 360) % 360;
    return Math.max(0, minTurns) * 360 + need;
  }

  function segmentAtPointer(theta, n) {
    var seg = 360 / n;
    var local = (((-theta) % 360) + 360) % 360;
    return Math.min(n - 1, Math.floor(local / seg));
  }

  /** 速度连续的旋转曲线：先平滑加速 ta 秒，再按 (1-s)^p 衰减到 0。总位移精确等于 A，且不会倒转。 */
  function spinPlan(A, v0, T, ta, p) {
    if (v0 > A / ta) v0 = A / ta; // 位移太短时压低起始速度，保证 vmax > 0（否则会先转后倒退）
    var denom = ta / 2 + (T - ta) / (p + 1);
    var vmax = (A - (v0 * ta) / 2) / denom;
    return { A: A, v0: v0, T: T, ta: ta, p: p, vmax: vmax, thetaA: v0 * ta + ((vmax - v0) * ta) / 2 };
  }

  function spinAngle(plan, t) {
    if (t <= 0) return 0;
    if (t >= plan.T) return plan.A;
    if (t < plan.ta) {
      var u = t / plan.ta;
      return plan.v0 * t + (plan.vmax - plan.v0) * plan.ta * (u * u * u - (u * u * u * u) / 2);
    }
    var s = (t - plan.ta) / (plan.T - plan.ta);
    return plan.thetaA + (plan.vmax * (plan.T - plan.ta) / (plan.p + 1)) * (1 - Math.pow(1 - s, plan.p + 1));
  }

  /* ---------------- 统计 / 校验 ---------------- */
  function formatPct(x) {
    if (x > 0 && x < 0.0001) return '<0.01%';
    var s = (x * 100).toFixed(2);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s + '%';
  }

  function expectedCost(cfg) {
    var probs = weightsOf(cfg.prizes);
    var total = 0, known = true;
    cfg.prizes.forEach(function (p, i) {
      if (probs[i] <= 0) return;
      if (p.cost == null || !isFinite(p.cost)) known = false;
      else total += probs[i] * p.cost;
    });
    return { value: total, complete: known };
  }

  /**
   * 预算估算。people=预计参与人数，claimRate=其中入金领奖的比例(0-1)。
   * 分位数用正态近似（N 较小时偏粗，仅作量级参考，不是封顶）。
   */
  function payoutStats(cfg, people, claimRate) {
    var probs = weightsOf(cfg.prizes), m1 = 0, m2 = 0, maxCost = -Infinity, complete = true;
    cfg.prizes.forEach(function (p, i) {
      if (probs[i] <= 0) return;
      if (p.cost == null || !isFinite(p.cost) || p.cost < 0) { complete = false; return; }
      m1 += probs[i] * p.cost; m2 += probs[i] * p.cost * p.cost;
      if (p.cost > maxCost) maxCost = p.cost;
    });
    if (!complete) return { complete: false };
    var N = Math.max(0, people), c = Math.min(1, Math.max(0, claimRate));
    var meanC = c * m1, varC = Math.max(0, c * m2 - meanC * meanC), varAll = Math.max(0, m2 - m1 * m1);
    var worst = N * maxCost;
    var cap = function (x) { return Math.min(worst, x); };
    var tops = [], pTop = 0;
    cfg.prizes.forEach(function (p, i) { if (probs[i] > 0 && p.cost === maxCost) { tops.push(prizeText(p)); pTop += probs[i]; } });
    return {
      complete: true,
      evPerPerson: m1,
      claimMean: N * meanC,
      claimP95: cap(N * meanC + 1.645 * Math.sqrt(N * varC)),
      claimP99: cap(N * meanC + 2.326 * Math.sqrt(N * varC)),
      allMean: N * m1,
      allP99: cap(N * m1 + 2.326 * Math.sqrt(N * varAll)),
      worst: worst,
      maxCost: maxCost,
      tops: tops,
      pTop: pTop,
      expectedTops: N * pTop,
      atLeastOneDrawn: 1 - Math.pow(1 - pTop, N),
      atLeastOneClaimed: 1 - Math.pow(1 - pTop * c, N)
    };
  }

  function simulate(cfg, n, startUid) {
    var counts = cfg.prizes.map(function () { return 0; });
    var base = startUid == null ? 10000000 : startUid;
    for (var i = 0; i < n; i++) counts[drawForUid(cfg, String(base + i)).index]++;
    return counts;
  }

  function hasTz(s) { return /(?:Z|[+-]\d{2}:\d{2})$/i.test(s); }

  /** 返回 {errors, warnings}。status=live 时额外执行“上线闸门”，示例/待确认字样、空声明都会被拦下。 */
  function validateConfig(cfg) {
    var errors = [], warnings = [], live = cfg.status === 'live';
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(cfg.campaignId)) errors.push('期号只能由字母、数字、点、下划线、短横线组成，长度 3–40');
    if (cfg.prizes.length < 2) errors.push('至少需要 2 个奖项');
    if (cfg.prizes.length > 12) errors.push('奖项最多 12 个（太多会看不清）');
    var sum = 0, ids = Object.create(null);
    cfg.prizes.forEach(function (p, i) {
      var n = i + 1;
      if (!p.label.trim()) errors.push('第 ' + n + ' 个奖项缺少名称');
      if (!isFinite(p.weight) || p.weight < 0) errors.push('第 ' + n + ' 个奖项的概率必须是 ≥ 0 的数字');
      else if (p.weight > 1e6) errors.push('第 ' + n + ' 个奖项的概率权重过大（上限 1,000,000）');
      else sum += p.weight;
      if (p.cost != null && p.cost < 0) errors.push('第 ' + n + ' 个奖项的成本不能为负数');
      var units = 0; for (var ci = 0; ci < p.label.length; ci++) units += p.label.charCodeAt(ci) > 0x2e80 ? 1 : 0.58;
      if (units > 8) warnings.push('第 ' + n + ' 个奖项名称偏长（建议 ≤ 8 个汉字或 12 个字符），转盘上的文字会被缩得很小，手机上难以阅读');
      if (ids[p.id]) errors.push('奖项 id 重复：' + p.id);
      ids[p.id] = true;
    });
    if (cfg.prizes.length && sum <= 0) errors.push('所有奖项概率之和必须 > 0');
    else if (Math.abs(sum - 100) > 1e-6) warnings.push('概率权重合计为 ' + (Math.round(sum * 1000) / 1000) + '，不是 100；系统会按比例折算，建议点「归一化」让页面展示的概率更直观');
    if (cfg.uidPattern.length > 100 || /\)[*+{]/.test(cfg.uidPattern)) errors.push('UID 格式过于复杂（不支持括号后接重复符号，避免卡死）');
    else { try { new RegExp(cfg.uidPattern); } catch (e) { errors.push('UID 格式（正则）无效'); } }
    ['startAt', 'endAt'].forEach(function (k) {
      if (!cfg[k]) return;
      if (isNaN(Date.parse(cfg[k]))) errors.push((k === 'endAt' ? '结束' : '开始') + '时间格式无效，例：2026-10-31T23:59:59+08:00');
      else if (!hasTz(cfg[k])) errors.push((k === 'endAt' ? '结束' : '开始') + '时间必须带时区（如 +08:00），否则不同地区的客户看到的截止时刻不同');
    });
    if (cfg.contact.telegram && !safeTelegramUrl(cfg.contact.telegram)) errors.push('Telegram 格式不正确，可填 @用户名 或 https://t.me/用户名，否则按钮不会显示');
    if (cfg.contact.depositUrl && !safeDepositUrl(cfg.contact.depositUrl)) errors.push('入金链接必须是 https 且域名属于 ' + LINK_HOSTS.join('、') + '，否则按钮不会显示');
    if (!cfg.endAt) warnings.push('未设置结束时间：页面不会显示倒计时，也不会自动关闭活动');
    if (!cfg.contact.telegram && !cfg.contact.wechat) warnings.push('未填写客户经理联系方式：客户抽奖后无处联系');
    if (cfg.prizes.some(function (p) { return p.cost == null; })) warnings.push('部分奖项未填成本，无法完整估算预算');
    if (!live) {
      warnings.push('当前为草稿状态：页面会显示“草稿预览”横幅。奖项与规则经审批后再改为 live');
      return { errors: errors, warnings: warnings };
    }
    // —— 上线闸门 ——
    var texts = [cfg.title, cfg.subtitle, cfg.notice, cfg.riskNotice, cfg.channelName]
      .concat(cfg.claim.steps, cfg.rules, cfg.disclaimer)
      .concat(cfg.prizes.map(function (p) { return p.label + ' ' + p.sub; }));
    if (texts.some(function (s) { return PLACEHOLDER_RE.test(s); })) errors.push('上线闸门：对客文案里仍有“示例/草稿/待确认/TODO/XXX”字样，请替换为经批准的正式内容');
    if (!cfg.disclaimer.length) errors.push('上线闸门：免责声明不能为空');
    if (!cfg.rules.length) errors.push('上线闸门：活动规则不能为空');
    if (!cfg.claim.steps.length) errors.push('上线闸门：领奖步骤不能为空');
    if (!cfg.endAt) errors.push('上线闸门：必须设置带时区的结束时间');
    if (!cfg.contact.telegram && !cfg.contact.wechat) errors.push('上线闸门：必须填写至少一种客户经理联系方式');
    if (!cfg.riskNotice) errors.push('上线闸门：风险提示不能为空');
    return { errors: errors, warnings: warnings };
  }

  return {
    sha256Hex: sha256Hex,
    normalizeConfig: normalizeConfig,
    weightsOf: weightsOf,
    normalizeUid: normalizeUid,
    drawForUid: drawForUid,
    checkCode: checkCode,
    prizeText: prizeText,
    voucherText: voucherText,
    verifyVoucher: verifyVoucher,
    validateUid: validateUid,
    safeTelegramUrl: safeTelegramUrl,
    safeDepositUrl: safeDepositUrl,
    targetRotation: targetRotation,
    segmentAtPointer: segmentAtPointer,
    spinPlan: spinPlan,
    spinAngle: spinAngle,
    formatPct: formatPct,
    expectedCost: expectedCost,
    payoutStats: payoutStats,
    simulate: simulate,
    validateConfig: validateConfig,
    LINK_HOSTS: LINK_HOSTS
  };
});
