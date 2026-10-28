/* guard.js — 防点击劫持（frame-busting 的“默认隐藏”写法）
 * 静态托管（如 GitHub Pages）无法设置 X-Frame-Options / frame-ancestors 响应头，meta CSP 也不支持 frame-ancestors。
 * 做法：页面默认隐藏（html.guard body{display:none}），只有确认自己是顶层窗口才显示。
 * 被跨域 iframe 嵌入时，读取 window.top 会抛异常或不相等，页面保持隐藏。
 * 正式上线到公司域名后，应由网关加响应头：Content-Security-Policy: frame-ancestors 'none'。
 * 必须是外部脚本：本站 CSP 不允许内联脚本。 */
(function () {
  'use strict';
  try {
    if (window.top === window.self) document.documentElement.classList.remove('guard');
  } catch (e) { /* 跨域嵌入：保持隐藏 */ }
})();
