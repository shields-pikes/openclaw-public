/* 完落ち ― 言語の切り替え
 * 日本語が原文。ほかの言語は js/lang/<言語>.js が「原文 → 訳文」の辞書を登録する。
 *   ui:   ゲーム本体の文言（tr('原文', { 差し込み }) で引く）
 *   data: シナリオ（data.js）の文言。日本語を含む文字列を丸ごと置き換える
 * 訳がない原文は日本語のまま表示し、コンソールに一度だけ警告する。
 */
(function () {
  'use strict';
  const JA = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]|\u2026\u2026|\u2015\u2015/;
  const KANJI = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五'];
  const dicts = {};
  const langs = [{ id: 'ja', name: '日本語' }];
  const cache = {};
  const warned = new Set();
  let lang = 'ja';

  const fill = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : String(s));
  function miss(kind, src) {
    const key = lang + kind + src;
    if (warned.has(key)) return;
    warned.add(key);
    if (window.console) console.warn(`[i18n] ${lang}: no ${kind} translation for`, src);
  }
  function localize(v, dict) {
    if (typeof v === 'string') {
      if (!JA.test(v)) return v;
      if (Object.prototype.hasOwnProperty.call(dict, v)) return dict[v];
      miss('data', v);
      return v;
    }
    if (Array.isArray(v)) return v.map(x => localize(x, dict));
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) o[k] = localize(v[k], dict);
      return o;
    }
    return v; // 数値・真偽値・関数はそのまま
  }

  const I = {
    JA,
    langs,
    get lang() { return lang; },
    add(id, dict) {
      dicts[id] = dict;
      delete cache[id];
      if (!langs.some(l => l.id === id)) langs.push({ id, name: dict.name || id });
    },
    has: id => id === 'ja' || !!dicts[id],
    set(id) { lang = I.has(id) ? id : 'ja'; return lang; },
    // 起動時の言語：URLの ?lang= ＞ 前回選んだ言語 ＞ ブラウザの言語（日本語以外なら英語）
    pick({ url, saved, nav } = {}) {
      if (url && I.has(url)) return url;
      if (saved && I.has(saved)) return saved;
      const list = (nav || []).map(s => String(s).toLowerCase());
      if (!list.length || list.some(s => s.startsWith('ja'))) return 'ja';
      for (const s of list) { const id = s.split('-')[0]; if (I.has(id)) return id; }
      return I.has('en') ? 'en' : 'ja';
    },
    // 画面の文言。訳の値が { one, other } なら vars.n で選ぶ
    tr(src, vars) {
      let s = src;
      if (lang !== 'ja') {
        const ui = (dicts[lang] && dicts[lang].ui) || {};
        if (Object.prototype.hasOwnProperty.call(ui, src)) s = ui[src];
        else miss('ui', src);
        if (s && typeof s === 'object') s = vars && vars.n === 1 ? s.one : s.other;
      }
      return fill(s, vars);
    },
    // シナリオを、いまの言語に置き換えた写しで返す（言語ごとに一度だけ作る）
    data(src) {
      if (lang === 'ja') return src;
      if (!cache[lang]) cache[lang] = localize(src, (dicts[lang] && dicts[lang].data) || {});
      return cache[lang];
    },
    // 同じ原文でも場面によって訳し分けるとき：辞書に「文脈|原文」があればそれを使う
    trc(ctx, src, vars) {
      if (lang !== 'ja') {
        const ui = (dicts[lang] && dicts[lang].ui) || {};
        const key = ctx + '|' + src;
        if (Object.prototype.hasOwnProperty.call(ui, key)) {
          let s = ui[key];
          if (s && typeof s === 'object') s = vars && vars.n === 1 ? s.one : s.other;
          return fill(s, vars);
        }
      }
      return I.tr(src, vars);
    },
    fill,
    // 文の区切りの空き（日本語は全角スペース）
    gap: () => (lang === 'ja' ? '\u3000' : '\u2002'),
    // 番号：日本語は漢数字
    num: n => (lang === 'ja' ? KANJI[n] || String(n) : String(n)),
    // 人名：日本語は姓と名をつめて書く
    name: s => (lang === 'ja' ? String(s).replace(' ', '') : String(s)),
    // 長い文の切り詰め（聴取メモのカード用）
    clip(s, jaMax = 42) {
      s = String(s);
      if (lang === 'ja') return s.length > jaMax ? s.slice(0, jaMax - 1) + '…' : s;
      const max = Math.round(jaMax * 2.4);
      if (s.length <= max) return s;
      const cut = s.lastIndexOf(' ', max - 1);
      return s.slice(0, cut > max * 0.6 ? cut : max - 1).replace(/[\s,;:—–-]+$/, '') + '…';
    },
    // 文頭の「……」を外す
    trimLead: s => String(s).replace(lang === 'ja' ? /^……/ : /^…\s*/, ''),
    // 文字送りの待ち時間の倍率（句読点で間を取る）
    pause(text, i) {
      const c = text[i];
      if (lang === 'ja') return c === '。' || c === '！' || c === '？' ? 7 : c === '、' ? 4 : 1;
      const next = text[i + 1];
      if ((c === '.' || c === '!' || c === '?') && (next === undefined || next === ' ' || next === '”' || next === '’')) return 6;
      if (c === ',' || c === ';' || c === ':' || c === '—') return 3;
      if (c === '…') return next === undefined || next === ' ' ? 4 : 2;
      return 1;
    },
    // 一文字あたりの速さの倍率（英語は文字数が多いので速く送る）
    speed: () => (lang === 'ja' ? 1 : 0.5),
    // 文字送りの音を鳴らす文字か
    ticks: c => (lang === 'ja' ? c !== '…' && c !== '　' : /[A-Za-z0-9]/.test(c)),
    // HTML の固定文言（data-i18n / data-i18n-title / data-i18n-aria）を差し替える
    applyDom(root = document) {
      root.querySelectorAll('[data-i18n]').forEach(el => {
        if (el.dataset.i18nSrc == null) el.dataset.i18nSrc = el.textContent;
        el.textContent = I.tr(el.dataset.i18nSrc);
      });
      root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = I.tr(el.dataset.i18nTitle); });
      root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', I.tr(el.dataset.i18nAria)); });
      document.documentElement.lang = lang;
    },
  };
  window.KANOCHI_I18N = I;
})();
