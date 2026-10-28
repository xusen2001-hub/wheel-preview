/* render.js — 转盘的 SVG 渲染（前台页面与 admin 预览共用）
 * 只用 DOM API 创建节点（不拼 HTML 字符串），配置里的文字一律走 textContent，避免注入。 */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var C = { blue: '#0040FF', pale: '#E6EAF4', navy: '#03101E', deep: '#051F3D', white: '#FFFFFF' };
  var CX = 220, CY = 220, R_OUT = 216, R_WHEEL = 192, R_HUB = 50, LED_COUNT = 24;
  var uidSeq = 0;

  function svgEl(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }

  function polar(r, deg) {
    var a = (deg * Math.PI) / 180;
    return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
  }

  function fmt(p) { return p[0].toFixed(2) + ' ' + p[1].toFixed(2); }

  function wedgePath(r0, r1, a0, a1) {
    var large = a1 - a0 > 180 ? 1 : 0;
    return 'M' + fmt(polar(r1, a0)) +
      ' A' + r1 + ' ' + r1 + ' 0 ' + large + ' 1 ' + fmt(polar(r1, a1)) +
      ' L' + fmt(polar(r0, a1)) +
      ' A' + r0 + ' ' + r0 + ' 0 ' + large + ' 0 ' + fmt(polar(r0, a0)) + ' Z';
  }

  /** 粗略估算文字宽度（以 em 计）：中日韩字符≈1em，其它≈0.58em */
  function textUnits(s) {
    var u = 0;
    for (var i = 0; i < s.length; i++) u += s.charCodeAt(i) > 0x2e80 ? 1 : 0.58;
    return u;
  }

  function segColors(i, n, prize) {
    if (prize.highlight) return { fill: C.navy, text: C.white, sub: '#9DB4FF' };
    if (n % 2 === 1 && i === n - 1) return { fill: C.deep, text: C.white, sub: '#9DB4FF' };
    return i % 2 === 0 ? { fill: C.blue, text: C.white, sub: 'rgba(255,255,255,.78)' } : { fill: C.pale, text: C.navy, sub: '#51607A' };
  }

  function buildRotor(svg, prizes) {
    var n = prizes.length, seg = 360 / n, segs = [];
    var base = n <= 6 ? 25 : n <= 8 ? 22 : n <= 10 ? 19 : 16;
    var rMid = (R_HUB + R_WHEEL) / 2 + 8;
    var maxW = R_WHEEL - R_HUB - 22;

    svgEl('circle', { cx: CX, cy: CY, r: R_WHEEL, fill: C.white }, svg);
    prizes.forEach(function (p, i) {
      var a0 = i * seg, a1 = (i + 1) * seg, c = (a0 + a1) / 2, col = segColors(i, n, p);
      var g = svgEl('g', { 'class': 'seg' }, svg);
      svgEl('path', { d: wedgePath(R_HUB - 2, R_WHEEL, a0, a1), fill: col.fill, stroke: C.white, 'stroke-width': 2, 'stroke-linejoin': 'round' }, g);

      var f1 = Math.min(base, maxW / textUnits(p.label || ' '));
      var f2 = p.sub ? Math.max(9.5, Math.min(f1 * 0.56, maxW / textUnits(p.sub))) : 0;
      var H = f1 + (p.sub ? 3 + f2 : 0), top = -H / 2;
      var flip = c > 180;
      var t = svgEl('g', { transform: 'rotate(' + (flip ? c + 90 : c - 90) + ' ' + CX + ' ' + CY + ')' }, g);
      var x = flip ? CX - rMid : CX + rMid;
      var l1 = svgEl('text', {
        x: x.toFixed(2), y: (CY + top + f1 * 0.82).toFixed(2), 'text-anchor': 'middle', fill: col.text,
        'font-size': f1.toFixed(1), 'font-weight': 800, 'class': 'seg-label'
      }, t);
      l1.textContent = p.label;
      if (p.sub) {
        var l2 = svgEl('text', {
          x: x.toFixed(2), y: (CY + top + f1 + 3 + f2 * 0.82).toFixed(2), 'text-anchor': 'middle', fill: col.sub,
          'font-size': f2.toFixed(1), 'font-weight': 600, 'class': 'seg-sub'
        }, t);
        l2.textContent = p.sub;
      }
      segs.push(g);
    });
    return segs;
  }

  function buildFrame(svg, uid) {
    var defs = svgEl('defs', null, svg);
    var ring = svgEl('radialGradient', { id: 'ringG' + uid, cx: '50%', cy: '50%', r: '50%' }, defs);
    svgEl('stop', { offset: '88%', 'stop-color': C.deep }, ring);
    svgEl('stop', { offset: '100%', 'stop-color': C.navy }, ring);
    var gloss = svgEl('linearGradient', { id: 'glossG' + uid, x1: '0', y1: '0', x2: '1', y2: '1' }, defs);
    svgEl('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '.22' }, gloss);
    svgEl('stop', { offset: '.45', 'stop-color': '#fff', 'stop-opacity': '0' }, gloss);

    // 外环：深蓝底 + 内圈细线
    var outer = svgEl('path', {
      d: 'M' + CX + ' ' + (CY - R_OUT) + ' a' + R_OUT + ' ' + R_OUT + ' 0 1 0 0.01 0 Z M' + CX + ' ' + (CY - R_WHEEL) + ' a' + R_WHEEL + ' ' + R_WHEEL + ' 0 1 1 -0.01 0 Z',
      fill: 'url(#ringG' + uid + ')', 'fill-rule': 'evenodd'
    }, svg);
    outer.setAttribute('class', 'frame-ring');
    svgEl('circle', { cx: CX, cy: CY, r: R_OUT - 1, fill: 'none', stroke: C.blue, 'stroke-width': 2, 'stroke-opacity': '.9' }, svg);
    svgEl('circle', { cx: CX, cy: CY, r: R_WHEEL + 1, fill: 'none', stroke: '#fff', 'stroke-width': 1.5, 'stroke-opacity': '.55' }, svg);

    // LED 灯：交替闪烁形成“跑马灯”，是转盘待机时吸引注意的主要动效
    var rLed = (R_OUT + R_WHEEL) / 2;
    for (var i = 0; i < LED_COUNT; i++) {
      var p = polar(rLed, (360 / LED_COUNT) * i);
      var led = svgEl('circle', { cx: p[0].toFixed(2), cy: p[1].toFixed(2), r: 3.4, fill: '#fff', 'class': 'led' }, svg);
      led.style.setProperty('--i', String(i));
    }
    // 轻微高光，让盘面有“亚克力”质感
    svgEl('circle', { cx: CX, cy: CY, r: R_WHEEL, fill: 'url(#glossG' + uid + ')', 'pointer-events': 'none' }, svg);
  }

  function buildPointer(svg) {
    svgEl('path', {
      d: 'M20 46 C20 46 4 28 4 17 A16 16 0 0 1 36 17 C36 28 20 46 20 46 Z',
      fill: C.white, stroke: C.blue, 'stroke-width': 3, 'stroke-linejoin': 'round'
    }, svg);
    svgEl('circle', { cx: 20, cy: 17, r: 5.5, fill: C.blue }, svg);
  }

  /**
   * 在 container 里挂载一个转盘。返回控制句柄。
   * opts.hubLabel：中心按钮文字（默认“抽奖”）
   */
  function mount(container, prizes, opts) {
    opts = opts || {};
    var uid = ++uidSeq;
    container.textContent = '';
    var wheel = document.createElement('div');
    wheel.className = 'wheel';

    var rotor = svgEl('svg', { 'class': 'wheel-rotor', viewBox: '0 0 440 440', 'aria-hidden': 'true', focusable: 'false' });
    var segs = buildRotor(rotor, prizes);
    var frame = svgEl('svg', { 'class': 'wheel-frame', viewBox: '0 0 440 440', 'aria-hidden': 'true', focusable: 'false' });
    buildFrame(frame, uid);
    var pointer = svgEl('svg', { 'class': 'wheel-pointer', viewBox: '0 0 40 48', 'aria-hidden': 'true', focusable: 'false' });
    buildPointer(pointer);

    var hub = document.createElement('button');
    hub.type = 'button';
    hub.className = 'wheel-hub';
    hub.setAttribute('aria-label', opts.hubAria || '开始抽奖');
    var hubText = document.createElement('span');
    hubText.textContent = opts.hubLabel || '抽奖';
    hub.appendChild(hubText);

    // 旋转的正方形 SVG 在 45° 时外接框比自身宽约 41%，会撑宽页面产生横向滚动；用 overflow:hidden 的外壳裁掉
    var rotorBox = document.createElement('div');
    rotorBox.className = 'wheel-rotor-box';
    rotorBox.appendChild(rotor);
    wheel.appendChild(rotorBox);
    wheel.appendChild(frame);
    wheel.appendChild(pointer);
    wheel.appendChild(hub);
    container.appendChild(wheel);

    var kickTimer = 0;
    return {
      el: wheel,
      hub: hub,
      setAngle: function (deg) {
        var v = 'rotate(' + deg.toFixed(3) + 'deg)';
        rotor.style.transform = v;
        rotor.style.webkitTransform = v;
      },
      setHubLabel: function (s) { hubText.textContent = s; },
      highlight: function (index) {
        segs.forEach(function (g, i) {
          g.classList.toggle('win', index === i);
          g.classList.toggle('dim', index != null && index !== i);
        });
        wheel.classList.toggle('has-win', index != null);
      },
      kick: function () {
        pointer.classList.add('kick');
        clearTimeout(kickTimer);
        kickTimer = setTimeout(function () { pointer.classList.remove('kick'); }, 70);
      },
      setSpinning: function (on) { wheel.classList.toggle('is-spinning', !!on); }
    };
  }

  root.WheelRender = { mount: mount };
})(typeof self !== 'undefined' ? self : this);
