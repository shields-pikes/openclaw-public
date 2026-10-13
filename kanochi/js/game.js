/* 完落ち ― 取調室・三章 ― ゲーム本体 */
(() => {
  'use strict';
  const I18N = window.KANOCHI_I18N;
  const tr = I18N.tr;
  const SRC = window.KANOCHI_DATA;
  // いまの言語に置き換えたシナリオ（useLang で入れ替わる）
  let DATA = SRC, R = SRC.reversal;
  const Sfx = window.Sfx;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const clone = o => JSON.parse(JSON.stringify(o));
  const IMG = n => `img/${n}.webp`;
  const THUMB = n => `img/t/${n}.webp`;
  const fmt = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const N = (t, o) => Object.assign({ s: 'n', t }, o);
  const M = (t, o) => Object.assign({ s: 'm', t }, o);
  const K = (t, o) => Object.assign({ s: 'k', t }, o);
  const S = (t, o) => Object.assign({ s: 's', t }, o);
  const X = (t, i, o) => Object.assign({ s: 'x', t, i }, o);
  const SYS = (t, o) => Object.assign({ s: 'sys', t }, o);

  // 文言はどれも日本語の原文。画面に出すときに tr() で今の言語にする
  const CMDS = [['hear', '聴き取り', '言い分を聞く'], ['facts', '捜査事実', '矛盾を突く'], ['shake', '揺さぶり', '心を動かす'], ['record', '供述調書', '記録を見る']];
  const COST = { hear: 15, point: 10, light: 5, desk: 5, tea: 10, katsudon: 30, accomplice: 10, parents: 15, demand: 10 };
  const SPEEDS = [{ label: 'ゆっくり', ms: 46 }, { label: 'ふつう', ms: 26 }, { label: 'はやい', ms: 11 }, { label: '一瞬', ms: 0 }];
  const SHAKES = [
    { id: 'light', name: 'スタンドライトを当てる', desc: '光で追い詰める。動揺↑ 反発↑' },
    { id: 'desk', name: '机を叩く', desc: '一喝する。動揺↑↑ 反発↑↑' },
    { id: 'tea', name: 'お茶を出す', desc: '気持ちをほぐす。懐柔↑ 動揺↓' },
    { id: 'katsudon', name: 'カツ丼を出す', desc: '腹を満たす。懐柔↑↑' },
    { id: 'accomplice', name: '共犯者の様子を話す', desc: '複数犯のときだけ。共犯者の口が軽いほど効く' },
    { id: 'parents', name: '親に連絡する', desc: '情に訴える。効くかどうかは相手しだい' },
    { id: 'demand', name: '自白を求める', desc: '' },
  ];
  const RESPONSES = [
    { id: 'rebel', name: '反発する', short: '反発する', sub: '突っぱねる' },
    { id: 'comply', name: '大人しく従う', short: '従う', sub: '受け流す' },
    { id: 'lie', name: '嘘をつく', short: '嘘をつく', sub: '言い逃れる' },
    { id: 'truth', name: '事実を供述する', short: '供述する', sub: '一部を認める' },
    { id: 'confess', name: '全てを自白する', short: '全て自白', sub: '終わらせる' },
  ];

  /* ───────────── 記録（ブラウザ内） ───────────── */
  const META_KEY = 'kanochi.v1';
  const meta = Object.assign({ unlocked: 1, endings: [], speed: 1, sound: true, helpSeen: false, save: null, lang: null }, (() => {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch (e) { return {}; }
  })());
  const saveMeta = () => { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* 保存できない環境では記録なしで続行 */ } };

  /* ───────────── 要素 ───────────── */
  const ui = {
    app: $('#app'), room: $('#room'), overlay: $('#overlay'), meters: $('#meters'), panel: $('#panel'), panelTitle: $('#panelTitle'),
    panelSub: $('#panelSub'), panelBody: $('#panelBody'), commands: $('#commands'), dialogue: $('#dialogue'), spk: $('#spk'), txt: $('#txt'),
    chap: $('#chapLabel'), caseL: $('#caseLabel'), clock: $('#clock'), clockTime: $('#clockTime'), clockEnd: $('#clockEnd'), toast: $('#toast'),
    photo: $('#photo'), shotA: $('#shotA'), shotB: $('#shotB'), fill: $('#fillImg'), insert: $('#insert'), evTag: $('#evTag'), stamp: $('#stamp'),
    ncrail: $('#ncrail'), flash: $('#flash'), flicker: $('#flicker'), lampglow: $('#lampglow'), glare: $('#glare'), povLabel: $('#povLabel'),
  };

  /* ───────────── 状態 ───────────── */
  let G = null;           // 進行中の章の状態
  let busy = false;       // 会話・演出中
  let panelKind = 'hear';
  let pick = { fact: null, topic: null };
  const logLines = [];

  const CH = () => DATA.chapters[G.ci];
  const SUS = () => CH().suspect;
  const topic = id => CH().topics.find(t => t.id === id);
  const fact = id => CH().facts.find(f => f.id === id);
  const stmt = id => CH().statements.find(s => s.id === id);
  const shortName = () => (G && G.phase !== 'rev' ? SUS().short : R.self.short);
  const isRev = () => G && G.phase === 'rev';
  const qOf = id => R.questions.find(q => q.id === id);

  /* ───────────── 写真と演出 ───────────── */
  const photo = { cur: null, front: 'a', insTimer: null, insToken: 0 };
  const imgReady = img => new Promise(res => { if (img.complete && img.naturalWidth) return res(); img.onload = () => res(); img.onerror = () => res(); });

  function setShot(name) {
    if (!name || photo.cur === name) return;
    photo.cur = name;
    const next = photo.front === 'a' ? ui.shotB : ui.shotA;
    const prev = photo.front === 'a' ? ui.shotA : ui.shotB;
    photo.front = photo.front === 'a' ? 'b' : 'a';
    next.src = IMG(name);
    imgReady(next).then(() => { if (photo.cur !== name) return; next.classList.add('on'); prev.classList.remove('on'); });
    ui.fill.src = IMG(name);
  }
  function exprImg(key) {
    if (!G || isRev()) return null;
    const map = SUS().img;
    return map[key] || map.neutral;
  }
  function moodKey() {
    const s = SUS();
    if (s.silentAtMin && G.K <= s.K.min) return 'defiant';
    if (G.D >= s.D.mark) return 'panic';
    if (G.K >= s.K.honest) return 'soft';
    if (G.K <= s.K.min + 25) return 'defiant';
    return 'neutral';
  }
  async function showInsert(name, { tag, hold } = {}) {
    clearTimeout(photo.insTimer);
    const token = ++photo.insToken;
    ui.insert.classList.remove('on');
    ui.insert.src = IMG(name);
    await imgReady(ui.insert);
    if (token !== photo.insToken) return;
    Sfx.play('insert');
    void ui.insert.offsetWidth;
    ui.insert.classList.toggle('evidence', !!tag);
    ui.insert.classList.add('on');
    if (tag) { ui.evTag.textContent = tag; ui.evTag.classList.add('on'); } else ui.evTag.classList.remove('on');
    if (!hold) photo.insTimer = setTimeout(hideInsert, 1500);
  }
  function hideInsert() { clearTimeout(photo.insTimer); photo.insToken++; ui.insert.classList.remove('on'); ui.evTag.classList.remove('on'); }
  function restart(elm, cls) { elm.classList.remove(cls); void elm.offsetWidth; elm.classList.add(cls); }
  function runFx(name) {
    switch (name) {
      case 'shake': if (!reduceMotion) restart(ui.photo, 'shake'); break;
      case 'flash': restart(ui.flash, 'go'); break;
      case 'flicker': restart(ui.flicker, 'go'); break;
      case 'lampOn':
        ui.lampglow.classList.add('on'); ui.photo.classList.add('overexpose');
        setTimeout(() => { ui.lampglow.classList.remove('on'); ui.photo.classList.remove('overexpose'); }, 2600);
        break;
      case 'push':
        if (!reduceMotion) { ui.photo.classList.add('push'); setTimeout(() => ui.photo.classList.remove('push'), 2200); }
        Sfx.play('push');
        break;
    }
  }
  function doStamp(kind) {
    ui.stamp.className = 'stamp ' + kind;
    ui.stamp.textContent = tr(kind === 'contra' ? '矛盾' : '矛盾なし');
    void ui.stamp.offsetWidth;
    ui.stamp.classList.add('go');
    Sfx.play(kind === 'contra' ? 'stamp' : 'nocontra');
    if (kind === 'contra') runFx('shake');
  }
  function renderRail() {
    ui.ncrail.innerHTML = '';
    if (!G || isRev() || !CH().innocent) return;
    for (let i = 0; i < G.nc; i++) ui.ncrail.appendChild(Object.assign(document.createElement('span'), { textContent: tr('矛盾なし') }));
  }
  function setTension() {
    let tense = false, level = 0;
    if (G && isRev()) { tense = G.rv.D >= R.D.mark; level = tense ? (G.rv.D - R.D.mark) / (R.D.max - R.D.mark) + 0.3 : 0; }
    else if (G && G.phase === 'interro') { const s = SUS(); tense = G.D >= s.D.mark; level = tense ? (G.D - s.D.mark) / Math.max(1, s.D.max - s.D.mark) + 0.3 : 0; }
    ui.photo.classList.toggle('tense', tense);
    Sfx.heartbeat(tense ? level : 0);
  }

  // フィルムの粒子（ノイズのタイルをずらして動かす）
  (function grain() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 170;
    const ctx = cv.getContext('2d'), id = ctx.createImageData(170, 170);
    for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    ctx.putImageData(id, 0, 0);
    $('#grain').style.backgroundImage = `url(${cv.toDataURL('image/png')})`;
  })();
  // 蛍光灯のまたたき
  (function flick() {
    const next = () => setTimeout(() => { if (G && !reduceMotion) runFx('flicker'); next(); }, 7000 + Math.random() * 11000);
    next();
  })();

  /* ───────────── 会話 ───────────── */
  let advanceFn = null, typing = false, skipType = false, skipAll = false;
  function onAdvance() {
    if (typing) { skipType = true; return; }
    if (advanceFn) { const f = advanceFn; advanceFn = null; f(); }
  }
  const waitAdvance = () => new Promise(r => { advanceFn = r; });
  function labelFor(s) {
    switch (s) {
      case 'k': return isRev() ? tr('{name}（あなた）', { name: R.self.short }) : R.self.short;
      case 's': return tr('瀬名');
      case 'x': return G ? I18N.name(SUS().name) : '';
      case 'm': return tr('{name}・心の声', { name: R.self.short });
      case 'sys': return tr('記録');
      default: return '';
    }
  }
  function fillText(t) { return String(t || '').replace(/\{name\}/g, shortName()); }

  async function say(ln) {
    // 演出
    if (ln.pov) setShot(ln.pov);
    if (ln.i) setShot(exprImg(ln.i));
    if (ln.ins) showInsert(ln.ins, { tag: ln.tag, hold: !!ln.insHold });
    if (ln.fx) runFx(ln.fx);
    if (ln.sfx) Sfx.play(ln.sfx);
    if (ln.stamp) doStamp(ln.stamp);
    if (ln.gauge) applyGaugeVisual(ln.gauge);
    if (ln.stmt) onStatementShown(ln.stmt);
    if (ln.newCard) render();
    if (ln.fact) revealFact(ln.fact);
    if (ln.call) ln.call();
    if (!ln.t) { if (ln.wait) await sleep(ln.wait); return; }
    const text = fillText(ln.t);
    ui.dialogue.classList.remove('idle', 'done');
    ui.dialogue.dataset.s = ln.s;
    const lab = labelFor(ln.s);
    ui.spk.innerHTML = lab ? `<b>${esc(lab)}</b>` : '';
    ui.txt.textContent = '';
    const ms = skipAll ? 0 : SPEEDS[meta.speed].ms * I18N.speed();
    typing = true; skipType = false;
    if (ms > 0) {
      for (let i = 0; i < text.length; i++) {
        if (skipType) break;
        ui.txt.textContent = text.slice(0, i + 1);
        if (I18N.ticks(text[i])) Sfx.tick();
        await sleep(ms * I18N.pause(text, i));
      }
    }
    ui.txt.textContent = text;
    typing = false;
    ui.dialogue.classList.add('done');
    logLines.push({ s: ln.s, who: lab, t: text });
    if (logLines.length > 400) logLines.shift();
    if (skipAll) await sleep(ln.stamp || ln.ins ? 260 : 40); else await waitAdvance();
    ui.dialogue.classList.remove('done');
    if (ln.ins && ln.insHold) hideInsert();
  }
  async function play(lines) {
    busy = true; lockUI(true);
    try { for (const ln of lines) if (ln) await say(ln); }
    finally { busy = false; skipAll = false; lockUI(false); }
  }
  function skipDialogue() {
    if (!busy) return;
    skipAll = true;
    onAdvance(); onAdvance();
  }
  function idleText(t) {
    ui.dialogue.classList.add('idle'); ui.dialogue.classList.remove('done'); ui.dialogue.dataset.s = 'n';
    ui.spk.innerHTML = ''; ui.txt.textContent = t;
  }
  let toastTimer = null;
  function toast(html, ms = 2200) {
    ui.toast.innerHTML = html; ui.toast.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => ui.toast.classList.remove('on'), ms);
  }

  /* ───────────── ゲージ ───────────── */
  function buildMeters() {
    const rev = isRev();
    const s = rev ? null : SUS();
    const Dc = rev ? R.D : s.D, Kc = rev ? R.K : s.K;
    const name = rev ? R.self.name : s.name;
    const metaTxt = rev ? R.self.meta : tr('{age}歳・{job}', { age: s.age, job: s.job });
    let type = rev ? tr('被疑者') : s.type, typeCls = '';
    if (!rev && CH().innocent) { if (G.flipped) { type = s.typeAfter; typeCls = 'innocent'; } else typeCls = 'unknown'; }
    const dPct = v => clamp(v, 0, 100);
    const kPct = v => (clamp(v, -100, 100) + 100) / 2;
    const voidD = `<i class="void" style="left:0;width:${dPct(Dc.min)}%"></i><i class="void" style="left:${dPct(Dc.max)}%;right:0"></i>`;
    const voidK = `<i class="void" style="left:0;width:${kPct(Kc.min)}%"></i><i class="void" style="left:${kPct(Kc.max)}%;right:0"></i>`;
    const markD = `<span class="mark" style="left:${dPct(Dc.mark)}%"></span>`;
    const capD = `<span class="mk" style="left:${dPct(Dc.mark)}%">▲${esc(tr(rev ? '口が滑る' : '自供'))}</span>`;
    const markK = !rev && Kc.honest != null ? `<span class="mark honest" style="left:${kPct(Kc.honest)}%"></span>` : '';
    const capK = `<span class="end l">← ${esc(tr('反発'))}</span>${!rev && Kc.honest != null ? `<span class="mk honest" style="left:${kPct(Kc.honest)}%">▲${esc(tr('本音'))}</span>` : ''}<span class="end r">${esc(tr('懐柔'))} →</span>`;
    ui.meters.innerHTML = `
      <div class="who"><span class="nm">${esc(name)}</span><span class="meta">${esc(metaTxt)}</span><span class="type ${typeCls}" title="${esc(rev ? '' : s.typeNote)}">${esc(type)}</span></div>
      <div class="gauge d" id="gD"><div class="gh"><span class="lb">${esc(tr(rev ? 'あなたの動揺' : '動揺'))}</span><span class="num" id="nD"></span></div>
        <div class="track">${voidD}<i class="fill" id="fD"></i>${markD}<i class="ticks"></i></div><div class="cap">${capD}</div></div>
      <div class="gauge k" id="gK"><div class="gh"><span class="lb">${esc(tr(rev ? 'あなたの懐柔／反発' : '懐柔／反発'))}</span><span class="num" id="nK"></span></div>
        <div class="track">${voidK}<i class="zero"></i><i class="fill" id="fK"></i>${markK}<i class="ticks"></i></div><div class="cap">${capK}</div></div>
      <div class="conds" id="conds"></div>`;
    ui.meters.setAttribute('aria-label', tr(rev ? 'あなたの状態' : '被疑者の状態'));
    const cur = rev ? { D: G.rv.D, K: G.rv.K } : { D: G.D, K: G.K };
    applyGaugeVisual(cur, true);
  }
  function applyGaugeVisual(g, silent) {
    const rev = isRev();
    const s = rev ? null : SUS();
    const Dc = rev ? R.D : s.D, Kc = rev ? R.K : s.K;
    const fD = $('#fD'), fK = $('#fK');
    if (!fD) return;
    fD.style.left = '0%'; fD.style.width = clamp(g.D, 0, 100) + '%';
    const kp = (clamp(g.K, -100, 100) + 100) / 2;
    if (g.K >= 0) { fK.className = 'fill pos'; fK.style.left = '50%'; fK.style.width = (kp - 50) + '%'; }
    else { fK.className = 'fill neg'; fK.style.left = kp + '%'; fK.style.width = (50 - kp) + '%'; }
    $('#nD').textContent = Math.round(g.D);
    $('#nK').textContent = (g.K > 0 ? '+' : '') + Math.round(g.K);
    const gD = $('#gD'), gK = $('#gK');
    gD.classList.toggle('hot', g.D >= Dc.mark);
    gD.classList.toggle('max', g.D >= Dc.max);
    gK.classList.toggle('max', g.K >= Kc.max);
    if (!silent) {
      if (g.dD) popDelta(gD, g.dD, 'D');
      if (g.dK) popDelta(gK, g.dK, 'K');
    }
    renderConds(g);
    setTension();
  }
  function popDelta(gauge, v, kind) {
    const p = document.createElement('span');
    const up = v > 0;
    p.className = 'pop ' + (kind === 'D' ? (up ? 'up' : 'down') : (up ? 'kup' : 'kdown'));
    p.textContent = tr('{label}{sign}{n}', { label: tr(kind === 'D' ? '動揺' : (up ? '懐柔' : '反発')), sign: kind === 'D' && !up ? '−' : '+', n: Math.abs(v) });
    (gauge.querySelector('.gh') || gauge).appendChild(p);
    setTimeout(() => p.remove(), 1700);
  }
  const SEP = () => esc(tr('｜'));
  function renderConds(g) {
    const box = $('#conds'); if (!box) return;
    const rev = isRev();
    if (rev) {
      const rv = G.rv;
      const boxes = Array.from({ length: R.threshold }, (_, i) => `<i class="${i < rv.weight ? 'on' : ''}"></i>`).join('');
      const dm = g.D >= R.D.max, km = g.K >= R.K.max;
      box.innerHTML = `<span class="stm">${esc(tr('あなたの供述'))} ${boxes} ${Math.min(rv.weight, 99)}/${R.threshold}</span><span class="sep">${SEP()}</span>
        <span class="${dm ? 'ok' : ''}">${esc(tr('動揺MAX'))}${dm ? '●' : '○'}</span><span class="${km ? 'ok' : ''}">${esc(tr('懐柔MAX'))}${km ? '●' : '○'}</span><span class="sep">${SEP()}</span>
        <span>${esc(tr('残り {n} 手', { n: Math.max(0, R.turns - rv.turn) }))}</span>`;
      return;
    }
    const ch = CH(), s = SUS();
    const n = G.stmts.length;
    const dm = g.D >= s.D.max, km = g.K >= s.K.max;
    if (ch.innocent) {
      box.innerHTML = `<span class="stm">${esc(tr('供述 {n}件', { n }))}</span><span class="sep">${SEP()}</span><span>${esc(tr('自白の条件：？'))}</span>` +
        (G.nc ? `<span class="sep">${SEP()}</span><span style="color:#9fbfcc">${esc(tr('矛盾なし ×{n}', { n: G.nc }))}</span>` : '');
      return;
    }
    const boxes = Array.from({ length: ch.threshold }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
    const ready = n >= ch.threshold;
    box.innerHTML = `<span class="stm ${ready ? 'ok' : ''}">${esc(tr('供述'))} ${boxes} ${n}/${ch.threshold}</span><span class="sep">${SEP()}</span>
      <span class="${dm ? 'ok' : ''}">${esc(tr('動揺MAX'))}${dm ? '●' : '○'}</span><span class="${km ? 'ok' : ''}">${esc(tr('懐柔MAX'))}${km ? '●' : '○'}</span>
      ${s.silentAtMin && g.K <= s.K.min ? `<span class="chip" style="color:#e0675c">${esc(tr('黙秘'))}</span>` : ''}`;
  }
  function delta(dD, dK) {
    const s = SUS();
    const D0 = G.D, K0 = G.K;
    G.D = clamp(G.D + (dD || 0), s.D.min, s.D.max);
    G.K = clamp(G.K + (dK || 0), s.K.min, s.K.max);
    return { D: G.D, K: G.K, dD: Math.round(G.D - D0), dK: Math.round(G.K - K0) };
  }

  /* ───────────── 画面の組み立て ───────────── */
  function lockUI(on) {
    ui.commands.querySelectorAll('button').forEach(b => { b.disabled = on; });
    if (on) ui.panelBody.querySelectorAll('button').forEach(b => { b.disabled = true; });
    else render();
  }
  function setTop() {
    if (!G) { ui.chap.textContent = tr('完落ち'); ui.caseL.textContent = ''; ui.clock.hidden = true; return; }
    const ch = CH();
    ui.chap.textContent = isRev() ? tr('{no}　逆転', { no: ch.no }) : tr('{no}　{title}', { no: ch.no, title: ch.title });
    ui.caseL.textContent = isRev() ? tr('被疑者：{name}（{meta}）', { name: R.self.name, meta: R.self.meta }) : ch.caseName;
    ui.clock.hidden = false;
    ui.clockTime.textContent = fmt(G.clock);
    const end = isRev() ? R.end : (ch.innocent ? null : ch.end);
    ui.clockEnd.textContent = end ? tr('／ {time} まで', { time: fmt(end) }) : ch.dateLabel;
    ui.clock.classList.toggle('urgent', !!end && end - G.clock <= 90);
  }
  function render() {
    if (!G) return;
    setTop();
    renderRail();
    if (isRev()) { renderRevPanel(); renderResponses(); return; }
    renderCommands();
    renderPanel();
  }
  function renderCommands() {
    if (ui.commands.dataset.mode !== 'cmd') {
      ui.commands.dataset.mode = 'cmd';
      ui.commands.className = 'commands';
      ui.commands.innerHTML = CMDS.map(([id, name, sub]) => `<button class="cmd" type="button" data-cmd="${id}">${esc(tr(name))}<small>${esc(tr(sub))}</small></button>`).join('');
    }
    ui.commands.querySelectorAll('.cmd').forEach(b => {
      b.classList.toggle('active', b.dataset.cmd === panelKind && (ui.panel.classList.contains('open') || !isNarrow()));
      b.querySelector('.badge')?.remove();
      if (b.dataset.cmd === 'facts' && G.newFacts.length) b.insertAdjacentHTML('beforeend', `<span class="badge">${G.newFacts.length}</span>`);
      b.disabled = busy;
    });
  }
  const isNarrow = () => window.matchMedia('(max-width: 860px), (max-aspect-ratio: 1/1)').matches;
  function openPanel(kind) {
    if (pick.fact && kind !== 'facts') { pick = { fact: null, topic: null }; hideInsert(); }
    panelKind = kind;
    if (kind === 'facts' && G.newFacts.length) { G.newFacts = []; }
    ui.panel.classList.add('open');
    renderCommands(); renderPanel();
    ui.panelBody.scrollTop = 0;
    Sfx.play('ui');
  }
  function closePanel() { ui.panel.classList.remove('open'); if (!busy) hideInsert(); renderCommands(); }

  function renderPanel() {
    if (!G || isRev()) return;
    const body = ui.panelBody;
    const st = body.scrollTop;
    if (panelKind === 'hear') renderHear(body);
    else if (panelKind === 'facts') renderFacts(body);
    else if (panelKind === 'shake') renderShake(body);
    else renderRecordPanel(body);
    body.scrollTop = st;
    if (busy) body.querySelectorAll('button').forEach(b => { b.disabled = true; });
  }
  // 聴取メモに出す文：本人が撤回していれば、認めた内容
  function cardText(tid) {
    const c = G.cards[tid];
    if (c.by) return I18N.clip(I18N.trimLead(stmt(c.by).line));
    if (c.admitted) return c.admitted; // 文字列で保存していたころの記録
    return topic(tid).short;
  }
  function cardHTML(tid, opts = {}) {
    const t = topic(tid), c = G.cards[tid];
    const labels = [];
    if (c.contra) labels.push(`<span class="lbl contra">${esc(tr('矛盾'))}</span>`);
    if (c.retracted && !c.contra) labels.push(`<span class="lbl ret">${esc(tr('撤回'))}</span>`);
    if (c.nc.length) labels.push(`<span class="lbl nc">${esc(tr('矛盾なし'))}${c.nc.length > 1 ? '×' + c.nc.length : ''}</span>`);
    if (c.deep && c.deep.length) labels.push(`<span class="lbl deep">${esc(tr('本音'))}</span>`);
    const checkedFacts = c.nc.map(f => fact(f).title);
    const chk = checkedFacts.length ? `<div class="chk">${esc(tr('照合済：{list}', { list: checkedFacts.join(tr('、')) }))}</div>` : '';
    const txt = cardText(tid);
    const tag = opts.button ? 'button' : 'div';
    const cls = ['card', c.contra ? 'contra' : '', c.retracted ? 'ret' : '', opts.pick ? 'pick' : '', opts.sel ? 'sel' : '', opts.dim ? 'dim' : ''].join(' ');
    return `<${tag} class="${cls}" ${opts.button ? `type="button" data-topic="${tid}" ${opts.disabled ? 'disabled' : ''}` : ''}>
      <div class="ct">${esc(t.label)}${opts.note ? `<span style="color:#8a5a20">${esc(tr('・'))}${esc(opts.note)}</span>` : ''}</div>
      <div class="cq">${esc(tr('「{q}」', { q: txt }))}</div>${chk}
      <div class="labels">${labels.join('')}</div></${tag}>`;
  }
  function renderHear(body) {
    ui.panelTitle.textContent = tr('聴き取り');
    ui.panelSub.textContent = tr('テーマを選ぶ（{n}分）', { n: COST.hear });
    const s = SUS(), ch = CH();
    const silent = s.silentAtMin && G.K <= s.K.min;
    const honest = G.K >= s.K.honest;
    let h = '';
    if (silent) h += `<p class="hint lamp">${esc(tr('{name}は黙秘している。懐柔しないと、口を開かない。', { name: shortName() }))}</p>`;
    else if (honest) h += `<p class="hint lamp">${esc(tr('今なら、本音を聞けるかもしれない。聴取済みのテーマを、もう一度聞いてみる。'))}</p>`;
    else if (!G.cardOrder.length) h += `<p class="hint">${esc(tr('まずは言い分を聞く。答えは「聴取メモ」に残り、捜査事実と照らし合わせられる。'))}</p>`;
    h += `<div class="sect-title">${esc(tr('聴取テーマ'))}</div><div class="topics">`;
    for (const tid of G.unlocked) {
      const t = topic(tid), c = G.cards[tid];
      let st = `<span class="st new">${esc(tr('未聴取'))}</span>`;
      if (c) st = honest && (t.deep || []).some(id => !G.stmts.includes(id)) ? `<span class="st honest">${esc(tr('本音を聞く'))}</span>` : `<span class="st">${esc(tr('聴取済'))}</span>`;
      h += `<button class="topic" type="button" data-hear="${tid}"><span class="tl">${esc(t.label)}</span>${st}</button>`;
    }
    h += '</div>';
    if (G.cardOrder.length) {
      h += `<div class="sect-title">${esc(tr('聴取メモ（{n}）', { n: G.cardOrder.length }))}</div><div class="cards">`;
      for (const tid of [...G.cardOrder].reverse()) h += cardHTML(tid);
      h += '</div>';
    }
    body.innerHTML = h;
  }
  function factHTML(fid, { sel, button = true } = {}) {
    const f = fact(fid);
    const isNew = G.freshFacts.includes(fid);
    const img = f.img ? `<img src="${THUMB(f.img)}" alt="" loading="lazy">` : '';
    return `<${button ? 'button type="button"' : 'div'} class="fact ${f.img ? '' : 'noimg'} ${sel ? 'sel' : ''}" data-fact="${fid}">
      ${img}<div><div class="ft">${esc(f.title)}${isNew ? '<span class="new">NEW</span>' : ''}</div><div class="fx">${esc(f.text)}</div></div></${button ? 'button' : 'div'}>`;
  }
  function renderFacts(body) {
    ui.panelTitle.textContent = tr('捜査結果');
    ui.panelSub.textContent = tr('判明した事実 → 聴取メモの順に選ぶ');
    let h = '';
    if (!pick.fact) {
      h += `<p class="hint">${esc(tr('供述と食い違う事実を選び、その供述を突きつける。矛盾していなければ、反論される。'))}</p>`;
      h += `<div class="sect-title">${esc(tr('判明した事実（{n}）', { n: G.facts.length }))}</div><div class="facts">`;
      const order = [...G.facts.filter(f => G.freshFacts.includes(f)).reverse(), ...G.facts.filter(f => !G.freshFacts.includes(f))];
      for (const fid of order) h += factHTML(fid);
      h += '</div>';
    } else {
      h += `<div class="sect-title">${esc(tr('選んだ事実'))}</div>${factHTML(pick.fact, { sel: true, button: false })}
        <button class="btn" type="button" data-unpick="1" style="justify-self:start">${esc(tr('事実を選び直す'))}</button>`;
      if (!G.cardOrder.length) h += `<p class="hint lamp">${esc(tr('まだ聴取メモがない。先に聴き取りで言い分を集めよう。'))}</p>`;
      else {
        h += `<div class="sect-title">${esc(tr('この事実と矛盾する聴取メモは？'))}</div><div class="cards">`;
        for (const tid of [...G.cardOrder].reverse()) {
          const c = G.cards[tid];
          const done = G.checked.includes(pick.fact + '|' + tid);
          const closed = c.contra || c.retracted;
          const note = closed ? tr(c.contra ? '矛盾を指摘済み' : '本人が撤回済み') : done ? tr('この事実とは照合済み') : '';
          h += cardHTML(tid, { button: true, pick: !closed && !done, sel: pick.topic === tid, dim: closed || done, disabled: closed || done, note });
        }
        h += '</div>';
      }
      if (pick.topic) {
        const f = fact(pick.fact);
        h += `<div class="pairbar"><p>${esc(tr('【事実】{v}', { v: f.title }))}<br>${esc(tr('【供述】「{v}」', { v: cardText(pick.topic) }))}</p>
          <div class="row"><button class="btn primary" type="button" data-point="1">${esc(tr('矛盾を指摘する（{n}分）', { n: COST.point }))}</button><button class="btn" type="button" data-unpick="topic">${esc(tr('やめる'))}</button></div></div>`;
      }
    }
    body.innerHTML = h;
  }
  function demandReady() {
    const ch = CH(), s = SUS();
    if (ch.innocent) return false;
    return G.stmts.length >= ch.threshold || (G.D >= s.D.max && G.K >= s.K.max);
  }
  function renderShake(body) {
    ui.panelTitle.textContent = tr('揺さぶり');
    ui.panelSub.textContent = tr('相手のタイプで効き目が変わる');
    const ch = CH(), s = SUS();
    let h = '';
    if (G.D >= s.D.max || G.K >= s.K.max) h += `<p class="hint lamp">${esc(tr('{g}が最高値だ。いま揺さぶれば、何か話すかもしれない。', { g: tr(G.D >= s.D.max ? '動揺' : '懐柔') }))}</p>`;
    h += `<p class="hint">${esc(tr('タイプ「{type}」――{note}', { type: s.type, note: s.typeNote }))}</p><div class="shakes">`;
    for (const sh of SHAKES) {
      let desc = sh.desc ? tr(sh.desc) : '', dis = false, cls = '';
      const used = G.uses[sh.id] || 0;
      if (sh.id === 'accomplice' && ch.singleCulprit) { dis = true; desc = tr('単独犯のため、使えない'); }
      if (sh.id === 'demand') {
        cls = 'demand' + (demandReady() ? ' ready' : '');
        desc = ch.innocent ? tr('条件は不明。') : tr('条件：供述{n}件以上、または動揺と懐柔がともに最高値。潰していない嘘が残っていると、それを盾に反論される。', { n: ch.threshold });
      }
      const lf = G.lastFx && G.lastFx[sh.id];
      const fxTxt = lf ? tr('　前回：{d}・{k}', { d: tr('動揺') + (lf.dD >= 0 ? '+' : '−') + Math.abs(lf.dD), k: lf.dK >= 0 ? tr('懐柔') + '+' + lf.dK : tr('反発') + '+' + Math.abs(lf.dK) }) : '';
      const cnt = used ? `<span class="cnt">${esc(I18N.trc('shake', sh.id === 'katsudon' ? '{n}杯' : '{n}回', { n: used }) + fxTxt)}</span>` : '';
      h += `<button class="shake ${cls}" type="button" data-shake="${sh.id}" ${dis ? 'disabled data-off="1"' : ''}><b>${esc(tr(sh.name))}</b><span>${esc(tr('{desc}（{n}分）', { desc, n: COST[sh.id] }))}</span>${cnt}</button>`;
    }
    h += '</div>';
    body.innerHTML = h;
  }
  function recordHTML(opts) {
    // opts: { title, rows:[{k,v}], intro, items:[doc], closing, signer, sign }
    const items = opts.items.length ? opts.items.map((d, i) => `<p><span class="num">${I18N.num(i + 1)}</span>${I18N.gap()}${esc(d)}</p>`).join('')
      : `<p class="empty">${esc(tr('（まだ、供述はない）'))}</p>`;
    const rows = opts.rows.map(r => `<p class="meta">${esc(r.k)}${I18N.gap()}${esc(r.v)}</p>`).join('');
    const closing = opts.closing ? `<p class="end">${esc(opts.closing)}</p>` : '';
    const sign = opts.sign ? `<p class="sig">${esc(opts.signer)}${I18N.gap()}<span id="fpSlot"></span></p>` : '';
    return `<div class="record-wrap"><div class="record" id="recordDoc"><h3>${esc(tr('供述調書'))}</h3>${rows}<p>${esc(opts.intro)}</p>${items}${closing}${sign}</div></div>`;
  }
  const recordRows = (address, job, name, age) => [
    { k: tr('住居'), v: address }, { k: tr('職業'), v: job }, { k: tr('氏名'), v: I18N.name(name) }, { k: tr('年齢'), v: tr('{n}歳', { n: age }) },
  ];
  const recordIntro = date => tr('上記の者は、令和○年{date}、湊川警察署において、本職に対し、任意、次のとおり供述した。', { date });
  const recordClosing = () => tr('以上のとおり録取して読み聞かせたところ、誤りのないことを申し立て、署名指印した。');
  function chapterRecordOpts(sign) {
    const ch = CH(), s = SUS();
    return {
      rows: recordRows(s.address, s.job, s.name, s.age),
      intro: recordIntro(ch.dateShort),
      items: G.stmts.map(id => stmt(id).doc),
      closing: sign ? recordClosing() : '',
      signer: I18N.name(s.name), sign,
    };
  }
  // 縦書きの調書か（日本語）。横書きなら上から読む
  const isVertical = el => !!el && getComputedStyle(el).writingMode.startsWith('vertical');
  function renderRecordPanel(body) {
    const ch = CH();
    ui.panelTitle.textContent = tr('供述調書');
    ui.panelSub.textContent = ch.innocent ? tr('供述 {n}件', { n: G.stmts.length }) : tr('供述 {n} / {m}', { n: G.stmts.length, m: ch.threshold });
    let h = recordHTML(chapterRecordOpts(false));
    h += `<p class="hint">${esc(tr('供述は、懐柔した上での聴き取り・矛盾の指摘・最高値のときの揺さぶりで増える。動揺が「自供」の目盛りを超えるか、懐柔が最高値になると、相手のほうから話し始める。'))}</p>`;
    body.innerHTML = h;
    const doc = $('#recordDoc'); if (isVertical(doc) && doc.parentElement) doc.parentElement.scrollLeft = doc.parentElement.scrollWidth;
  }

  /* ───────────── 章の進行 ───────────── */
  function newChapterState(ci) {
    const ch = DATA.chapters[ci], s = ch.suspect;
    return {
      v: 1, ci, phase: 'interro', clock: ch.start, D: s.D.start, K: s.K.start,
      cards: {}, cardOrder: [], unlocked: ch.topics.filter(t => !t.locked).map(t => t.id),
      facts: ch.facts.filter(f => !f.at && !f.hidden).map(f => f.id), newFacts: [], freshFacts: [],
      checked: [], stmts: [], nc: 0, uses: {}, accStage: -1, stage: 0, actions: 0, events: [], hints: {}, spontCount: 0,
      flipped: false, lastFx: {}, stats: { contra: 0, wrong: 0, shakes: 0, katsudon: 0, rebut: 0 },
    };
  }
  function preloadChapter(ci) {
    const ch = DATA.chapters[ci];
    const names = new Set([...Object.values(ch.suspect.img), ch.scene, 'ins_tea', 'ins_katsudon', 'ins_lamp', 'ins_phone', 'ins_slam', 'ins_window', 'ev_hand']);
    ch.facts.forEach(f => f.img && names.add(f.img));
    if (ch.innocent) ['pov_sit', 'pov_lean', 'pov_slam', 'pov_tea', 'pov_file', 'pov_off', 'ev_usb', 'ev_kenji', 'sc_station'].forEach(n => names.add(n));
    names.forEach(n => { const i = new Image(); i.src = IMG(n); });
  }
  function saveProgress() {
    if (!G || busy) return;
    meta.save = { G: clone(G), panelKind };
    saveMeta();
  }

  async function startChapter(ci) {
    G = newChapterState(ci);
    pick = { fact: null, topic: null };
    panelKind = 'hear';
    preloadChapter(ci);
    await chapterCard(ci);
    enterRoom();
    const ch = CH();
    setShot(exprImg('neutral'));
    buildMeters(); render();
    await play(clone(ch.intro));
    if (ch.tutorial && !meta.helpSeen) { meta.helpSeen = true; saveMeta(); await showHelp(true); }
    idleAsk();
    saveProgress();
  }
  function enterRoom() {
    ui.overlay.innerHTML = ''; ui.overlay.hidden = true;
    ui.app.classList.toggle('rev', isRev());
    ui.povLabel.classList.toggle('on', isRev());
    ui.glare.classList.toggle('on', isRev());
    Sfx.setWhine(isRev());
  }

  async function act(fn) {
    if (busy || !G) return;
    if (isNarrow()) closePanel();
    pick = { fact: null, topic: null };
    try { await fn(); }
    catch (e) { console.error(e); }
    if (!busy) { render(); if (G && !G.over) { if (isRev()) idleText(''); else idleAsk(); saveProgress(); } }
  }
  const idleAsk = () => idleText(tr('――{name}を、どう攻める。', { name: shortName() }));

  function advanceClock(min) { G.clock += min; setTop(); }

  function cardFor(tid, mood) {
    const t = topic(tid);
    // 嘘をすでに自分で撤回していれば、聞かれても認めた内容を話す
    const by = CH().statements.find(s => s.retracts === tid && G.stmts.includes(s.id));
    G.cards[tid] = { contra: false, nc: [], retracted: !!by, deep: [], by: by ? by.id : null };
    G.cardOrder.push(tid);
    if (by) return X(tr('……さっき、話したとおりです。{line}', { line: I18N.trimLead(by.line) }), 'soft', { newCard: tid });
    return X(t.claim, mood, { newCard: tid });
  }
  function revealFact(fid) {
    if (!G.facts.includes(fid)) G.facts.push(fid);
    const f = fact(fid);
    if (f) { Sfx.play('report'); toast(`<b>${esc(tr('捜査事実'))}</b>${I18N.gap()}${esc(f.title)}`, 3200); }
  }

  async function doHear(tid) {
    const ch = CH(), s = SUS(), t = topic(tid);
    G.actions++;
    const lines = [K(t.q)];
    const silent = s.silentAtMin && G.K <= s.K.min;
    if (silent) {
      const sl = clone(ch.lines.silent);
      sl[0].gauge = delta(2, 0);
      lines.push(...sl);
    } else if (!G.cards[tid]) {
      const ln = cardFor(tid, moodKey());
      ln.gauge = delta(s.fx.hear.D, s.fx.hear.K);
      lines.push(ln);
      if (ch.tutorial && !G.hints.firstHear) { G.hints.firstHear = 1; lines.push(M(tr('言い分は「聴取メモ」に残る。事実と食い違う嘘を探せ。'))); }
    } else if (G.K >= s.K.honest) {
      const sid = (t.deep || []).find(id => !G.stmts.includes(id));
      if (sid) {
        const ln = X(stmt(sid).line, 'soft');
        ln.gauge = delta(s.fx.hear.D, s.fx.hear.K);
        G.cards[tid].deep.push(sid);
        lines.push(...gainStatement(sid, ln));
      } else {
        lines.push(X(t.deepNone || ch.lines.deepNone, 'soft', { gauge: delta(s.fx.hear.D, s.fx.hear.K) }));
      }
    } else {
      lines.push(X(t.evasive, moodKey() === 'soft' ? 'neutral' : moodKey(), { gauge: delta(s.fx.hear.D, s.fx.hear.K) }));
    }
    advanceClock(COST.hear);
    await play(lines);
    await endTurn();
  }

  function gainStatement(sid, ln) {
    if (G.stmts.includes(sid)) return [ln];
    G.stmts.push(sid);
    ln.stmt = sid;
    const st = stmt(sid);
    if (st.retracts && G.cards[st.retracts] && !G.cards[st.retracts].contra) G.cards[st.retracts].retracted = true;
    return [ln];
  }
  function onStatementShown(sid) {
    Sfx.play('stmt');
    const n = G.stmts.indexOf(sid) + 1;
    toast(`<b>${esc(tr('供述 {n}', { n: I18N.num(n) }))}</b>${I18N.gap()}${esc(tr('供述調書に記録した'))}`);
    render();
  }

  async function doPoint(fid, tid) {
    const ch = CH(), s = SUS(), f = fact(fid), c = G.cards[tid];
    G.actions++;
    G.checked.push(fid + '|' + tid);
    const lines = [
      K(tr('「{claim}」――そう言ったな。', { claim: cardText(tid) }), { i: moodKey() }),
      N(f.text, { ins: f.img || null, insHold: !!f.img, tag: tr('捜査事実：{title}', { title: f.title }) }),
      K(tr('これは、どういうことだ。'), { fx: 'push' }),
    ];
    const sid = f.hits[tid];
    if (sid && !c.contra && !c.retracted) {
      c.contra = true; c.contraFact = fid; G.stats.contra++;
      lines.push(SYS('', { stamp: 'contra', wait: 900, call: () => render() }));
      const react = clone((f.react && f.react[tid]) || [X(tr('……っ。'), 'panic')]);
      react[0].gauge = delta(s.fx.contra.D, 0);
      lines.push(...react);
      if (!G.stmts.includes(sid)) lines.push(...gainStatement(sid, X(stmt(sid).line, 'panic')));
      if (ch.tutorial && !G.hints.firstContra) { G.hints.firstContra = 1; lines.push(M(tr('嘘をひとつ崩せば、人は揺らぐ。'))); }
    } else {
      c.nc.push(fid); G.nc++; G.stats.wrong++;
      lines.push(SYS('', { stamp: 'nocontra', wait: 800, call: () => { render(); renderRail(); } }));
      let rb;
      if (f.wrongAll) rb = clone(f.wrongAll);
      else if (f.wrong && f.wrong[tid]) rb = [X(f.wrong[tid], ch.innocent ? 'angry' : 'defiant')];
      else if (f.wrongDefault) rb = [X(f.wrongDefault, 'angry')];
      else rb = clone(ch.lines.wrongGeneric);
      rb[0].gauge = delta(s.fx.wrong.D, s.fx.wrong.K);
      rb[0].sfx = 'rebut';
      lines.push(...rb);
      if (f.unlock && f.unlock[tid] && !G.unlocked.includes(f.unlock[tid])) {
        const nt = f.unlock[tid];
        G.unlocked.push(nt);
        lines.push(SYS(tr('聴取テーマ「{label}」が加わった。', { label: topic(nt).label }), { sfx: 'report' }));
      }
      if (ch.tutorial && !G.hints.firstWrong) { G.hints.firstWrong = 1; lines.push(M(tr('焦るな。矛盾していないものを突けば、相手に逃げ道を与えるだけだ。'))); }
      if (!ch.innocent && (G.stats.wrong === 2 || G.stats.wrong === 4)) lines.push(...senaHint());
    }
    advanceClock(COST.point);
    await play(lines);
    await endTurn();
  }

  // 的外れが続いたときの、瀬名の助け舟
  function senaHint() {
    for (const tid of G.cardOrder) {
      const c = G.cards[tid];
      if (c.contra || c.retracted) continue;
      const fid = G.facts.find(f => fact(f).hits && fact(f).hits[tid] && !G.checked.includes(f + '|' + tid));
      if (fid) return [S(tr('……久我さん。「{fact}」と「{topic}」の話、並べてみてはどうでしょう。', { fact: fact(fid).title, topic: topic(tid).label }))];
    }
    const unheard = G.unlocked.find(t => !G.cards[t]);
    if (unheard) return [S(tr('……久我さん。「{topic}」のこと、まだ聞いていませんよね。', { topic: topic(unheard).label }))];
    return [S(tr('……久我さん。供述は、懐柔した上で聞き直せば出てくるかもしれません。'))];
  }
  function actionLines(kind, entry) {
    const nm = shortName();
    switch (kind) {
      case 'light': return [N(tr('スタンドライトの首を回し、光を{name}の顔に向けた。', { name: nm }), { ins: 'ins_lamp', sfx: 'lamp' }), { fx: 'lampOn', i: 'lamp', wait: 350 }];
      case 'desk': return [K(tr('――いい加減にしろ！'), { fx: 'shake', sfx: 'slam', ins: entry.ins || (G.ci === 0 ? 'ins_slam' : null) })];
      case 'tea': return [N(tr('湯呑みに茶を注ぎ、{name}の前に置いた。', { name: nm }), { ins: 'ins_tea', sfx: 'tea' })];
      case 'katsudon': return [N(tr('出前のカツ丼を、机に置いた。'), { ins: 'ins_katsudon', sfx: 'katsudon' })];
      case 'parents': return [{ ins: 'ins_phone', sfx: 'phone', wait: 900 }];
      case 'accomplice': return [{ ins: entry.ins || 'ins_window', wait: 700 }];
      default: return [];
    }
  }

  async function doShake(kind) {
    if (kind === 'demand') return doDemand();
    const ch = CH(), s = SUS();
    if (kind === 'accomplice' && ch.singleCulprit) return;
    G.actions++; G.stats.shakes++;
    const atMax = G.D >= s.D.max || G.K >= s.K.max;
    let entry;
    if (kind === 'accomplice') {
      const repeat = G.accStage === G.stage;
      entry = ch.shakes.accomplice[Math.min(G.stage, ch.shakes.accomplice.length - 1)];
      if (repeat) entry = { D: Math.round(entry.D / 4), K: -6, lines: ch.shakes.accompliceRepeat };
      G.accStage = G.stage;
    } else {
      const arr = ch.shakes[kind];
      entry = arr[Math.min(G.uses[kind] || 0, arr.length - 1)];
    }
    G.uses[kind] = (G.uses[kind] || 0) + 1;
    if (kind === 'katsudon') G.stats.katsudon++;
    const lines = [...actionLines(kind, entry)];
    if (entry.pre) lines.push(...clone(entry.pre));
    const el = clone(entry.lines);
    const target = el.find(l => l.s === 'x') || el[el.length - 1];
    target.gauge = delta(entry.D, entry.K);
    G.lastFx = G.lastFx || {};
    G.lastFx[kind] = { dD: target.gauge.dD, dK: target.gauge.dK };
    lines.push(...el);
    if (atMax) {
      const sid = nextSpont();
      if (sid) lines.push(...spontLines(sid, true));
    }
    advanceClock(COST[kind]);
    await play(lines);
    await endTurn();
  }

  function unresolvedLies() {
    return G.cardOrder.map(topic).filter(t => {
      const c = G.cards[t.id];
      if (!t.lie || c.contra || c.retracted) return false;
      return G.facts.some(fid => fact(fid).hits && fact(fid).hits[t.id]);
    });
  }

  async function doDemand() {
    const ch = CH(), s = SUS();
    G.actions++; G.uses.demand = (G.uses.demand || 0) + 1;
    const lines = [K(tr('{name}。……もう、全部話せ。', { name: shortName() }), { fx: 'push' })];
    const bothMax = G.D >= s.D.max && G.K >= s.K.max;
    advanceClock(COST.demand);
    if (ch.innocent) {
      if (bothMax) { lines.push(...clone(ch.lines.demandFalse)); await play(lines); return flip('false'); }
      const l = clone(ch.lines.demandFail); l[0].gauge = delta(s.fx.demandFail.D, s.fx.demandFail.K);
      lines.push(...l); await play(lines); return endTurn();
    }
    const un = unresolvedLies();
    if (un.length) {
      const t = un[0];
      G.stats.rebut++;
      lines.push(X(t.rebut, 'defiant', { gauge: delta(s.fx.rebut.D, s.fx.rebut.K), sfx: 'rebut', fx: 'shake' }));
      lines.push(M(tr('……「{label}」の嘘を、まだ潰していなかった。そこを突かれた。', { label: t.label })));
      await play(lines); return endTurn();
    }
    if (G.stmts.length >= ch.threshold || bothMax) return clearChapter();
    const l = clone(ch.lines.demandFail); l[0].gauge = delta(s.fx.demandFail.D, s.fx.demandFail.K);
    lines.push(...l);
    await play(lines);
    return endTurn();
  }

  function nextSpont() { return CH().spont.find(id => !G.stmts.includes(id)); }
  function spontLines(sid, fromShake) {
    const ch = CH();
    const intro = clone(G.spontCount ? ch.lines.spontMore : ch.lines.spontIntro);
    G.spontCount++;
    const ln = X(stmt(sid).line, fromShake ? 'panic' : (G.D >= SUS().D.mark ? 'panic' : 'soft'));
    ln.gauge = delta(-4, 0);
    return [...intro, ...gainStatement(sid, ln)];
  }

  function checkArrivals() {
    const ch = CH(), out = [];
    if (ch.accomplice) {
      const st = ch.accomplice.stages;
      while (G.stage < st.length && (G.clock >= st[G.stage].time || G.stmts.length >= st[G.stage].stmts)) G.stage++;
    }
    for (const f of ch.facts) {
      if (!f.at || f.hidden || G.facts.includes(f.id)) continue;
      const a = f.at;
      const ok = (a.time != null && G.clock >= a.time) || (a.stmt && G.stmts.includes(a.stmt)) || (a.stage && G.stage >= a.stage) || (a.noContra && G.nc >= a.noContra);
      if (!ok) continue;
      G.facts.push(f.id); G.newFacts.push(f.id); G.freshFacts.push(f.id);
      out.push(...clone(f.report || []));
      out.push(SYS(tr('捜査事実に「{title}」が加わった。', { title: f.title }), { sfx: 'report', call: () => render() }));
    }
    return out;
  }

  async function endTurn() {
    if (!G || G.over) return;
    const ch = CH(), s = SUS();
    const lines = [...checkArrivals()];
    for (const ev of ch.events || []) {
      if (G.events.includes(ev.id)) continue;
      if (ev.when.actions && G.actions >= ev.when.actions) { G.events.push(ev.id); lines.push(...clone(ev.lines)); }
    }
    const silent = s.silentAtMin && G.K <= s.K.min;
    // 動揺が目盛りを超えるか、懐柔が最高値なら、黙秘していても相手から話し始める
    if (G.D >= s.D.mark || G.K >= s.K.max) {
      const sid = nextSpont();
      if (sid) lines.push(...spontLines(sid, false));
    }
    if (ch.tutorial) {
      if (!G.hints.honest && G.K >= s.K.honest) { G.hints.honest = 1; lines.push(M(tr('……今なら、本音を聞けるかもしれない。聴取済みのテーマを、もう一度聞いてみるか。'))); }
      if (!G.hints.ready && G.stmts.length >= ch.threshold) { G.hints.ready = 1; lines.push(M(tr('供述は揃った。……潰し残した嘘がなければ、落ちる。'))); }
      if (!G.hints.silent && silent) { G.hints.silent = 1; lines.push(M(tr('殻に閉じこもった。茶でも出して、ほぐすしかない。'))); }
    }
    if (s.fx.decay && G.D > s.D.min) { const g = delta(s.fx.decay, 0); g.dD = 0; lines.push({ gauge: g }); }
    if (lines.length) await play(lines);
    render();
    if (ch.innocent) {
      if (G.nc >= ch.flipAt) return flip('nc');
      if (G.clock >= ch.flipTime) return flip('late');
      return;
    }
    if (G.clock >= ch.end) return gameOver();
  }

  async function clearChapter() {
    const ch = CH();
    G.over = true;
    const lines = clone(ch.lines.clear);
    lines[1].sfx = 'clear';
    await play(lines);
    Sfx.heartbeat(0);
    await signingScreen(recordHTML(chapterRecordOpts(true)), I18N.name(SUS().name));
    enterRoom();
    await play(clone(ch.lines.epilogue));
    meta.unlocked = Math.max(meta.unlocked, ch.id + 1);
    meta.save = null; saveMeta();
    resultScreen();
  }

  async function gameOver() {
    G.over = true;
    Sfx.play('gameover'); Sfx.heartbeat(0);
    await play(clone(DATA.common.timeUp));
    meta.save = null; saveMeta();
    const ch = CH();
    showOverlay(`<div class="screen card-screen"><div class="result"><h2>${esc(tr('落とせなかった'))}</h2>
      <p class="lead">${esc(tr('{no}「{title}」――取り調べの時間が尽きた。供述 {n}件、指摘した矛盾 {c}件。', { no: ch.no, title: ch.title, n: G.stmts.length, c: G.stats.contra }))}</p>
      <p class="lead" style="font-size:13px;color:#6b6255">${esc(tr('ヒント：嘘は事実で潰す。懐柔した上で聞けば本音が出る。動揺が「自供」の目盛りを超えると、相手から話し始める。'))}</p>
      <div class="row"><button class="btn primary" type="button" data-go="retry">${esc(tr('{no}をやり直す', { no: ch.no }))}</button><button class="btn" type="button" data-go="title">${esc(tr('タイトルへ'))}</button></div></div></div>`);
  }

  /* ───────────── 第三章：逆転 ───────────── */
  async function flip(reason) {
    const ch = CH();
    G.over = false;
    const lines = [];
    if (reason === 'late') lines.push(...clone(ch.lines.flipLate));
    // まだ届いていない鑑識結果を、ここで揃える
    for (const id of ['F7', 'F8', 'F9']) {
      if (!G.facts.includes(id)) { G.facts.push(id); G.freshFacts.push(id); lines.push(...clone(fact(id).report || []), SYS(tr('捜査事実に「{title}」が加わった。', { title: fact(id).title }), { sfx: 'report', call: () => render() })); }
    }
    const fl = clone(ch.lines.flip);
    const reveal = fl.find(l => l.typeReveal);
    if (reveal) reveal.call = () => { G.flipped = true; buildMeters(); };
    lines.push({ sfx: 'reveal', wait: 200 }, ...fl);
    await play(lines);
    if (!G.facts.includes('F10')) G.facts.push('F10');
    // 光が反転する
    Sfx.play('flip');
    Sfx.play('lamp');
    runFx('lampOn');
    await sleep(500);
    ui.flash.style.transition = 'opacity 1.2s';
    ui.flash.style.opacity = '1';
    await sleep(1400);
    rvInit();
    G.flipped = true;
    enterRoom();
    setShot('pov_sit');
    buildMeters(); render();
    ui.flash.style.opacity = '0';
    await sleep(900);
    ui.flash.style.transition = '';
    toast(`<b>${esc(tr('立場が、逆転した。'))}</b>${I18N.gap()}${esc(tr('これより、あなたが取り調べを受ける'))}`, 3800);
    await play(clone(R.opening));
    await rvTutorial();
    await play(clone(R.afterBreak));
    G.clock = R.start; setTop();
    saveProgress();
    rvLoop();
  }

  function rvInit() {
    G.phase = 'rev';
    G.rv = { turn: 0, D: R.D.start, K: R.K.start, told: [], weight: 0, answers: {}, lies: {}, used: [], bluffDone: false, uses: {}, asked: [], last: null, pending: null, stats: { lies: 0, exposed: 0, rebels: 0, truths: 0 } };
  }
  async function rvTutorial() {
    return showOverlayAwait(`<div class="screen card-screen"><div class="help" style="width:min(640px,100%)">
      <h2>${esc(tr('被疑者席'))}</h2>
      <p>${esc(tr('ここからは、あなたが取り調べを受ける。瀬名が「聴き取り」「捜査事実」「揺さぶり」を選び、あなたは五つの応じ方から選ぶ。'))}</p>
      <ul>
        <li><b>${esc(tr('反発する'))}</b>${esc(tr('：突っぱねる。動揺は下がるが、反発が限界まで達すると、かえって消耗する。'))}</li>
        <li><b>${esc(tr('大人しく従う'))}</b>${esc(tr('：受け流す。波風は立たないが、懐柔されていく。'))}</li>
        <li><b>${esc(tr('嘘をつく'))}</b>${esc(tr('：言い逃れる。瀬名の手札に崩されれば、大きく動揺する。崩されない嘘は、盾にもなる。'))}</li>
        <li><b>${esc(tr('事実を供述する'))}</b>${esc(tr('：一部を認める。気は楽になるが、供述が積み上がる。'))}</li>
        <li><b>${esc(tr('全てを自白する'))}</b>${esc(tr('：すべてを終わらせる。'))}</li>
      </ul>
      <p>${esc(tr('動揺が「口が滑る」の目盛りを超えるか懐柔が最高値になると、口が勝手に動く。供述が{n}件に達するか、動揺と懐柔がともに最高値のまま「自白を求める」を受ければ――落ちる。午後10時まで持ちこたえれば、取り調べは終わる。', { n: R.threshold }))}</p>
      <div class="row" style="display:flex;gap:8px"><button class="btn lamp" type="button" data-go="close">${esc(tr('取り調べを受ける'))}</button></div>
    </div></div>`);
  }

  function rvKnown() { return R.facts.filter(f => f.turn <= G.rv.turn); }
  function rvCond() { const rv = G.rv; return rv.weight >= R.threshold || (rv.D >= R.D.max && rv.K >= R.K.max); }
  function rvShield() {
    const rv = G.rv, known = rvKnown();
    return R.askOrder.find(q => rv.lies[q] && !rv.lies[q].exposed && !rv.lies[q].retracted && known.some(f => f.breaks === q));
  }
  function rvChoose() {
    const rv = G.rv, known = rvKnown();
    if (rvCond()) return { type: 'demand' };
    for (const q of R.askOrder) {
      const L = rv.lies[q];
      if (L && !L.exposed && !L.retracted) { const f = known.find(f => f.breaks === q); if (f) return { type: 'expose', q, fact: f.id }; }
    }
    if (rv.turn >= R.turns) return { type: 'demand', final: true };
    const l2 = rv.lies.Q2;
    if (!rv.bluffDone && l2 && !l2.exposed && !l2.retracted && known.some(f => f.id === 'G7') && !known.some(f => f.id === 'G4')) return { type: 'bluff', q: 'Q2', fact: 'G7' };
    if (rv.K < -75 && rv.turn >= 4) {
      if ((rv.uses.tea || 0) < 1) return { type: 'tea' };
      if (!rv.uses.katsudon) return { type: 'katsudon' };
      if (!rv.uses.parents) return { type: 'parents' };
    }
    if (rv.last === 'hear' && (rv.D < 58 || rv.lastChoice === 'rebel')) return { type: (rv.uses.light || 0) <= (rv.uses.desk || 0) ? 'light' : 'desk' };
    const next = R.askOrder.find(q => !rv.asked.includes(q) && !rv.told.includes(q));
    if (next) return { type: 'hear', q: next };
    const re = R.askOrder.find(q => !rv.told.includes(q) && !rv.lies[q] && !(rv.uses['re_' + q]));
    if (re) return { type: 'hear', q: re, re: true };
    if (!rv.uses.parents) return { type: 'parents' };
    return { type: rv.D < 60 ? 'desk' : 'light' };
  }
  function rvActLabel(a) {
    switch (a.type) {
      case 'hear': return { k: tr('聴き取り'), b: qOf(a.q).label, s: tr(a.re ? '同じことを、もう一度聞かれた' : '問いにどう応じる？') };
      case 'expose': return { k: tr('捜査事実'), b: R.facts.find(f => f.id === a.fact).title, s: tr('あなたの嘘「{lie}」を突いてきた', { lie: qOf(a.q).lieShort }) };
      case 'bluff': return { k: tr('捜査事実'), b: R.facts.find(f => f.id === a.fact).title, s: tr('「{lie}」は嘘だ、と言う。……本当に矛盾しているか？', { lie: qOf(a.q).lieShort }) };
      case 'demand': return { k: tr('揺さぶり'), b: tr('自白を求める'), s: tr(a.final ? '最後の追及' : 'あなたが落ちかけていると見ている') };
      default: return { k: tr('揺さぶり'), b: tr(SHAKES.find(s => s.id === a.type).name), s: '' };
    }
  }
  function rvPresent(a) {
    const rv = G.rv, gm = R.gm;
    switch (a.type) {
      case 'hear': {
        const Q = qOf(a.q);
        if (!rv.asked.includes(a.q)) rv.asked.push(a.q);
        if (a.re) rv.uses['re_' + a.q] = 1;
        return [...(a.re ? [S(gm.reask, { pov: 'pov_sit' })] : []), S(Q.q, { pov: 'pov_sit' })];
      }
      case 'expose': {
        const f = R.facts.find(x => x.id === a.fact), Q = qOf(a.q);
        if (!rv.used.includes(f.id)) rv.used.push(f.id);
        const ls = gm.exposeLines.map(tpl => S(I18N.fill(tpl, { lie: Q.lieShort, fact: f.say || f.text })));
        ls[0].pov = 'pov_file';
        ls[1].stamp = 'contra';
        return ls;
      }
      case 'bluff': {
        if (!rv.used.includes(a.fact)) rv.used.push(a.fact);
        const ls = clone(gm.bluffLines); ls[0].pov = 'pov_lean';
        return ls;
      }
      default: {
        rv.uses[a.type] = (rv.uses[a.type] || 0) + 1;
        const sh = gm.shakes[a.type];
        const ls = clone(sh.lines);
        ls[0].pov = sh.pov;
        if (sh.ins) ls[0].ins = sh.ins;
        if (a.type === 'desk') { ls[0].fx = 'shake'; ls[0].sfx = 'slam'; }
        if (a.type === 'light') { ls[0].fx = 'lampOn'; ls[0].sfx = 'lamp'; }
        if (a.type === 'tea') ls[0].sfx = 'tea';
        if (a.type === 'katsudon') ls[0].sfx = 'katsudon';
        if (a.type === 'parents') ls[0].sfx = 'phone';
        if (a.type === 'demand') ls[0].fx = 'push';
        return ls;
      }
    }
  }
  function rvApply(eff) {
    const rv = G.rv;
    let dD = eff.D, dK = eff.K;
    if (rv.K + dK < R.K.min) { const excess = R.K.min - (rv.K + dK); dK = R.K.min - rv.K; dD += Math.round(excess * (R.exhaust || 1)); }
    const D0 = rv.D, K0 = rv.K;
    rv.D = clamp(rv.D + dD, R.D.min, R.D.max);
    rv.K = clamp(rv.K + dK, R.K.min, R.K.max);
    return { D: rv.D, K: rv.K, dD: Math.round(rv.D - D0), dK: Math.round(rv.K - K0) };
  }
  function rvTell(qid) {
    const rv = G.rv;
    if (rv.told.includes(qid)) return [];
    rv.told.push(qid); rv.stats.truths++;
    rv.weight += qOf(qid).weight || 1;
    if (rv.lies[qid] && !rv.lies[qid].exposed) rv.lies[qid].retracted = true;
    return [SYS(tr('あなたの供述が、調書に記録された。（{n}/{m}）', { n: Math.min(rv.weight, R.threshold), m: R.threshold }), { sfx: 'stmt', call: () => render() })];
  }
  function rvNextTruth() {
    const rv = G.rv;
    for (let i = rv.asked.length - 1; i >= 0; i--) if (!rv.told.includes(rv.asked[i])) return rv.asked[i];
    return R.askOrder.find(q => !rv.told.includes(q));
  }
  // （ ）で始まる応答は、口に出さないしぐさ（地の文）
  const respLine = txt => (txt && /^[（(]/.test(txt) ? N(txt) : K(txt));

  async function rvLoop() {
    while (G && isRev() && !G.over) {
      const rv = G.rv;
      const before = rvKnown().length;
      rv.turn++;
      const gained = rvKnown().length - before;
      if (gained > 0 && rv.turn > 1) { Sfx.play('report'); toast(`<b>${esc(tr('瀬名の手札'))}</b>${I18N.gap()}${esc(tr('新しい資料が{n}枚、届いた', { n: gained }))}`, 2600); }
      const a = rvChoose();
      rv.pending = a;
      G.clock = Math.min(R.end, R.start + Math.round((R.end - R.start) * (rv.turn - 1) / R.turns));
      setTop();
      render();
      await play(rvPresent(a));
      render();
      const L = rvActLabel(a);
      idleText(tr('【瀬名の手：{k}】{b}　――{s}', { k: L.k, b: L.b, s: L.s || tr('どう応じる。') }));
      const choice = await waitResponse();
      rv.pending = null;
      await rvResolve(a, choice);
      if (!G || G.over) return;
      rv.last = a.type === 'hear' ? 'hear' : a.type;
      rv.lastChoice = choice;
      saveProgress();
    }
  }
  let respResolver = null;
  function waitResponse() { return new Promise(r => { respResolver = r; render(); }); }
  function onResponse(id) {
    if (!respResolver || busy) return;
    const r = respResolver; respResolver = null;
    Sfx.play('ui');
    r(id);
  }

  async function rvResolve(a, choice) {
    const rv = G.rv, E = R.effects, gm = R.gm;
    if (choice === 'confess') { await play([M(tr('……もう、いい。'))]); return endingConfess(); }
    const lines = [];
    let eff = null;
    switch (a.type) {
      case 'hear': {
        const Q = qOf(a.q);
        rv.answers[a.q] = choice;
        if (choice === 'truth') { lines.push(K(Q.r.truth)); lines.push(...rvTell(a.q)); }
        else if (choice === 'lie') { lines.push(K(Q.r.lie)); rv.lies[a.q] = { exposed: false, retracted: false, turn: rv.turn }; rv.stats.lies++; }
        else { lines.push(respLine(Q.r[choice])); if (choice === 'rebel') rv.stats.rebels++; }
        eff = E.hear[choice];
        break;
      }
      case 'expose': {
        const Q = qOf(a.q);
        rv.lies[a.q].exposed = true; rv.stats.exposed++;
        if (choice === 'truth') { lines.push(K(Q.r.truth), ...rvTell(a.q)); }
        else if (choice === 'comply') { lines.push(N(tr('（言葉が、出なかった。）')), K(Q.r.truth), ...rvTell(a.q)); }
        else lines.push(K(gm.exposeReplies[choice]));
        eff = E.expose[choice];
        break;
      }
      case 'bluff': {
        rv.bluffDone = true;
        if (choice === 'rebel') { lines.push(K(gm.bluffReplies.rebel), SYS('', { stamp: 'nocontra', wait: 700 }), S(tr('…………。'))); rv.stats.rebels++; }
        else if (choice === 'truth') { lines.push(K(qOf('Q2').r.truth), ...rvTell('Q2')); }
        else lines.push(respLine(gm.bluffReplies[choice]));
        eff = E.bluff[choice];
        break;
      }
      case 'demand': {
        if (rvCond()) {
          const shield = choice !== 'truth' && choice !== 'comply' ? rvShield() : null;
          if (shield) {
            lines.push(...clone(gm.rebutLines), K(tr('「{lie}」――それを、まだ崩せていないだろう。', { lie: qOf(shield).lieShort })), S(tr('……そうですね。まずは、そこから崩しましょう。')));
            eff = { D: -20, K: -25 };
            break;
          }
          const sh = gm.shakes.demand;
          if (choice === 'truth') { const q = rvNextTruth(); if (q) lines.push(K(qOf(q).r.truth)); }
          else lines.push(respLine(sh.r[choice]));
          lines.push(...clone(gm.breakLines));
          await play(lines);
          return endingConfess();
        }
        const sh = gm.shakes.demand;
        if (choice === 'truth') { const q = rvNextTruth(); if (q) { lines.push(K(qOf(q).r.truth), ...rvTell(q)); } }
        else { lines.push(respLine(sh.r[choice])); if (choice === 'rebel') rv.stats.rebels++; }
        eff = E.demand[choice];
        break;
      }
      default: {
        const sh = gm.shakes[a.type];
        if (choice === 'truth') { const q = rvNextTruth(); if (q) lines.push(K(qOf(q).r.truth), ...rvTell(q)); else lines.push(K(tr('……話せることは、もう話した。'))); }
        else { lines.push(respLine(sh.r[choice])); if (choice === 'rebel') rv.stats.rebels++; }
        eff = E[a.type][choice];
      }
    }
    if (eff) { const g = rvApply(eff); const first = lines.find(l => l && l.t); if (first) first.gauge = g; else lines.push({ gauge: g }); }
    // 疲労と、口が滑る
    const tail = [];
    const fat = rvApply({ D: R.fatigue, K: 0 }); fat.dD = 0; tail.push({ gauge: fat });
    if ((rv.D >= R.D.mark || rv.K >= R.K.max) && !(a.type === 'demand' && rvCond())) {
      const q = rvNextTruth();
      if (q) { tail.push(...clone(gm.blurt), K(qOf(q).r.truth, { fx: 'shake' }), ...rvTell(q)); const g = rvApply({ D: -6, K: 0 }); tail.push({ gauge: g }); }
    }
    await play([...lines, ...tail]);
    render();
    if (a.type === 'demand' && a.final) return rvCond() ? (await play(clone(gm.breakLines)), endingConfess()) : (await play(clone(gm.endOfDay)), endingSurvive());
    if (rv.turn >= R.turns && !rvCond()) { await play([...clone(gm.endOfDay)]); return endingSurvive(); }
  }

  function renderResponses() {
    if (ui.commands.dataset.mode !== 'resp') {
      ui.commands.dataset.mode = 'resp';
      ui.commands.className = 'responses';
      ui.commands.innerHTML = RESPONSES.map((r, i) => `<button class="resp ${r.id === 'confess' ? 'confess' : ''}" type="button" data-resp="${r.id}" title="${esc(tr('{name}（キー {n}）', { name: tr(r.name), n: i + 1 }))}"><span class="l">${esc(tr(r.name))}</span><span class="s">${esc(I18N.trc('short', r.short))}</span><small>${esc(tr(r.sub))}</small></button>`).join('');
    }
    const waiting = !!respResolver && !busy;
    ui.commands.querySelectorAll('.resp').forEach(b => { b.disabled = !waiting; });
  }
  function renderRevPanel() {
    const rv = G.rv;
    ui.panelTitle.textContent = tr('瀬名の手');
    ui.panelSub.textContent = tr('{n}手目／全{m}手', { n: rv.turn, m: R.turns });
    let h = '';
    if (rv.pending) {
      const L = rvActLabel(rv.pending);
      h += `<div class="gmcall"><span class="k">${esc(L.k)}</span><b>${esc(L.b)}</b><span>${esc(L.s)}</span></div>`;
    }
    const known = rvKnown();
    const shown = known.filter(f => rv.used.includes(f.id));
    const hidden = known.length - shown.length;
    h += `<div class="sect-title">${esc(tr('瀬名の手札（{n}）', { n: known.length }))}</div>`;
    h += shown.length ? `<div class="mini">${shown.map(f => `<div class="it"><b>${esc(f.title)}</b>${esc(f.text)}</div>`).join('')}</div>` : '';
    h += hidden ? `<div class="hand" title="${esc(tr('まだ見せていない手札'))}">${'<i class="fc"></i>'.repeat(hidden)}</div><p class="hint">${esc(tr('伏せられた手札が {n} 枚。何を握られているかは、わからない。', { n: hidden }))}</p>` : '';
    const lies = R.askOrder.filter(q => rv.lies[q]);
    h += `<div class="sect-title">${esc(tr('あなたがついた嘘（{n}）', { n: lies.length }))}</div>`;
    h += lies.length ? `<div class="mini">${lies.map(q => { const L = rv.lies[q]; const st = L.exposed ? `<span class="st out">${esc(tr('崩された'))}</span>` : L.retracted ? `<span class="st">${esc(tr('撤回した'))}</span>` : `<span class="st safe">${esc(tr('まだ崩されていない'))}</span>`; return `<div class="it ${L.exposed ? 'bad' : ''}"><b>${esc(tr('「{q}」', { q: qOf(q).lieShort }))}</b>${st}</div>`; }).join('')}</div>` : `<p class="hint">${esc(tr('まだ、嘘はついていない。'))}</p>`;
    h += `<div class="sect-title">${esc(tr('あなたの供述（{n}）', { n: rv.told.length }))}</div>`;
    h += rv.told.length ? `<div class="mini">${rv.told.map(q => `<div class="it"><b>${esc(qOf(q).label)}</b>${esc(qOf(q).r.truth)}</div>`).join('')}</div>` : `<p class="hint">${esc(tr('まだ、何も認めていない。'))}</p>`;
    h += `<div class="sect-title">${esc(tr('第三章前半で判明した事実'))}</div><div class="mini">${['F8', 'F9', 'F10'].filter(id => G.facts.includes(id)).map(id => `<div class="it"><b>${esc(fact(id).title)}</b>${esc(fact(id).text)}</div>`).join('')}</div>`;
    ui.panelBody.innerHTML = h;
  }

  /* ───────────── エンディング ───────────── */
  async function endingConfess() {
    G.over = true;
    Sfx.heartbeat(0);
    const E = DATA.endings.confess;
    await play(clone(E.lines));
    Sfx.setWhine(false); ui.glare.classList.remove('on');
    const order = ['Q4', 'Q1', 'Q2', 'Q3', 'Q6', 'Q5', 'Q7'];
    const me = R.self;
    const html = recordHTML({
      rows: recordRows(me.address, me.job, me.name, me.age),
      intro: recordIntro(E.record.date),
      items: [...order.map(q => qOf(q).doc), E.record.final],
      closing: recordClosing(),
      signer: I18N.name(me.name), sign: true,
    });
    await signingScreen(html, I18N.name(me.name));
    enterRoom();
    ui.glare.classList.remove('on'); Sfx.setWhine(false);
    setShot('pov_off');
    await play(clone(E.after));
    finishEnding('confess');
  }
  async function endingSurvive() {
    G.over = true;
    Sfx.heartbeat(0);
    const E = DATA.endings.survive;
    ui.glare.classList.remove('on'); Sfx.setWhine(false);
    const lines = clone(E.lines);
    if (G.rv && G.rv.told.some(q => ['Q1', 'Q2', 'Q3'].includes(q))) lines.splice(3, 0, N(E.partial));
    await play(lines);
    finishEnding('survive');
  }
  function finishEnding(kind) {
    if (!meta.endings.includes(kind)) meta.endings.push(kind);
    meta.unlocked = Math.max(meta.unlocked, 3);
    meta.save = null; saveMeta();
    const E = DATA.endings[kind];
    const rv = G.rv || { stats: {}, weight: 0 };
    const other = kind === 'confess' ? 'survive' : 'confess';
    const seenOther = meta.endings.includes(other);
    Sfx.play(kind === 'confess' ? 'clear' : 'gameover');
    showOverlay(`<div class="screen endcard"><div class="bg"><img src="${IMG(kind === 'confess' ? 'pov_off' : 'sc_station')}" alt=""></div><div class="inner">
      <h2>${esc(E.title)}</h2>
      <p>${esc(E.epitaph)}</p>
      <p class="stats">${esc(tr('ついた嘘 {lies}　崩された嘘 {exposed}　認めた事実 {truths}　反発 {rebels}', { lies: rv.stats.lies || 0, exposed: rv.stats.exposed || 0, truths: rv.stats.truths || 0, rebels: rv.stats.rebels || 0 }))}</p>
      <p class="stats">${esc(tr(seenOther ? 'ふたつの結末を、どちらも見届けた。' : 'もうひとつの結末がある。第三章を選び直せば、被疑者席からやり直せる。'))}</p>
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
        <button class="btn lamp" type="button" data-go="ch3">${esc(tr('第三章をもう一度'))}</button>
        <button class="btn" type="button" data-go="title">${esc(tr('タイトルへ'))}</button></div>
    </div></div>`);
    G = null;
  }

  /* ───────────── オーバーレイ画面 ───────────── */
  function showOverlay(html, { solid = true } = {}) {
    ui.overlay.innerHTML = html;
    ui.overlay.classList.toggle('solid', solid);
    ui.overlay.hidden = false;
    const b = ui.overlay.querySelector('button'); if (b) setTimeout(() => b.focus(), 50);
  }
  let overlayResolver = null;
  function hideOverlay() { ui.overlay.hidden = true; ui.overlay.innerHTML = ''; }
  // 選ばれたボタン（data-go）の値で解決する。'close' のときは閉じる
  function showOverlayAwait(html, opts) {
    showOverlay(html, opts);
    return new Promise(r => { overlayResolver = v => { if (v === 'close') hideOverlay(); r(v); }; });
  }
  function resolveOverlay(v) { if (overlayResolver) { const r = overlayResolver; overlayResolver = null; r(v); return true; } return false; }

  const LOGO = '完落ち<small>取調室・三章</small>'; // i18n-ignore 題字はどの言語でも日本語のまま
  function titleScreen() {
    G = null; busy = false; Sfx.heartbeat(0);
    advanceFn = null; respResolver = null; overlayResolver = null; typing = false;
    hideInsert(); ui.glare.classList.remove('on'); ui.povLabel.classList.remove('on'); Sfx.setWhine(false);
    ui.app.classList.remove('rev');
    setTop();
    const hasSave = !!(meta.save && meta.save.G);
    const chapters = DATA.chapters.map((c, i) => `<button class="btn" type="button" data-go="ch${i + 1}" ${i + 1 > meta.unlocked ? 'disabled' : ''}>${esc(tr('{no}　{title}', { no: c.no, title: c.title }))}</button>`).join('');
    const ends = meta.endings.length ? tr('見届けた結末：{list}', { list: meta.endings.map(e => DATA.endings[e].name).join(tr('・')) }) : '';
    // 日本語は縦書きの題字が見出し。ほかの言語では題字は飾りにして、訳した題名を見出しにする
    const ja = I18N.lang === 'ja';
    const word = `<${ja ? 'h1' : 'div'} class="title-word"${ja ? '' : ' aria-hidden="true" lang="ja"'}>${LOGO}</${ja ? 'h1' : 'div'}>`;
    const copy = (ja ? '' : `<h1 class="title-name">${esc(tr('完落ち'))}<small>${esc(tr('取調室・三章'))}</small></h1>`)
      + `<p class="tag">${esc(tr('その供述は、事実と矛盾している。'))}</p>`
      + (ja ? '<p class="en">KANOCHI — THREE CASES IN INTERROGATION ROOM 3</p>' : `<p class="gloss">${tr('〔題名の説明〕')}</p>`);
    const langs = I18N.langs.map(l => `<button class="lang ${l.id === I18N.lang ? 'on' : ''}" type="button" data-go="lang:${l.id}" lang="${l.id}" aria-pressed="${l.id === I18N.lang}">${esc(l.name)}</button>`).join('');
    showOverlay(`<div class="screen title-screen">
      <div class="title-bg"><img src="${IMG('sc_room')}" alt=""></div>
      <div class="title-inner">
        ${word}
        <div class="title-copy">${copy}</div>
        <div class="menu">
          ${hasSave ? `<button class="btn lamp" type="button" data-go="resume">${esc(tr('つづきから'))}</button>` : ''}
          <button class="btn ${hasSave ? '' : 'lamp'}" type="button" data-go="new">${esc(tr('はじめから'))}</button>
          <div class="row">${chapters}</div>
          <div class="row"><button class="btn" type="button" data-go="help">${esc(tr('遊び方'))}</button><button class="btn" type="button" data-go="sound">${esc(soundLabel())}</button><button class="btn" type="button" data-go="speed" data-tpl="文字：{v}">${esc(speedLabel('文字：{v}'))}</button></div>
          <p class="note">${esc(tr('写真はすべて生成画像で、登場する人物・団体・事件は架空のものです。音が鳴ります。'))}${ends ? '<br>' + esc(ends) : ''}</p>
        </div>
      </div>
      <div class="langs" role="group" aria-label="Language / 言語">${langs}</div></div>`);
  }

  async function chapterCard(ci) {
    const ch = DATA.chapters[ci], s = ch.suspect;
    for (;;) {
      const v = await showOverlayAwait(`<div class="screen card-screen"><div class="chapter-card">
      <div class="pic"><img src="${IMG(ch.scene)}" alt=""><div class="vt"><small>${esc(ch.no)}</small>${esc(ch.title)}</div></div>
      <div class="body">
        <div><div class="date">${esc(tr('{date}　取調べ開始 {start}', { date: ch.dateLabel, start: fmt(ch.start) }) + (ch.innocent ? '' : tr('／終了 {end}', { end: fmt(ch.end) })))}</div><div class="case">${esc(ch.caseName)}</div></div>
        <p class="sum">${esc(ch.summary)}</p>
        <div class="profile"><img src="${THUMB(s.img.neutral)}" alt="">
          <div><div class="pn">${esc(s.name)}${s.ruby ? `<small>${esc(s.ruby)}</small>` : ''}</div><div class="pm">${esc(tr('{age}歳　{job}', { age: s.age, job: s.job }))}</div>
          <div class="pt"><b>${esc(s.type)}</b>${esc(s.typeNote)}</div></div></div>
        <div class="row" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn lamp" type="button" data-go="close">${esc(tr('取り調べを始める'))}</button><button class="btn" type="button" data-go="cardhelp">${esc(tr('遊び方'))}</button></div>
      </div></div></div>`);
      if (v === 'cardhelp') { await showOverlayAwait(helpHTML('close', tr('事件の概要に戻る'))); continue; }
      return;
    }
  }

  function resultScreen() {
    const ch = CH(), st = G.stats;
    const used = G.clock - ch.start;
    const next = G.ci + 1 < DATA.chapters.length;
    showOverlay(`<div class="screen card-screen"><div class="result">
      <span class="big-stamp">${esc(I18N.trc('stamp', '完落ち'))}</span>
      <h2>${esc(ch.no)}</h2>
      <p class="lead">${esc(tr('{title}――{name}は、すべてを認めた。', { title: ch.title, name: SUS().name }))}</p>
      <dl>
        <dt>${esc(tr('取り調べの時間'))}</dt><dd>${esc(tr('{h}時間{m}分', { h: Math.floor(used / 60), m: used % 60 }))}</dd>
        <dt>${esc(tr('得た供述'))}</dt><dd>${esc(tr('{n}件', { n: G.stmts.length }))}</dd>
        <dt>${esc(tr('指摘した矛盾'))}</dt><dd>${esc(tr('{n}件', { n: st.contra }))}</dd>
        <dt>${esc(tr('的外れの指摘'))}</dt><dd>${esc(tr('{n}件', { n: st.wrong }))}</dd>
        <dt>${esc(tr('嘘を盾に反論された'))}</dt><dd>${esc(tr('{n}回', { n: st.rebut }))}</dd>
        <dt>${esc(I18N.trc('stat', '揺さぶり'))}</dt><dd>${esc(tr('{n}回', { n: st.shakes }))}</dd>
        <dt>${esc(tr('出したカツ丼'))}</dt><dd>${esc(tr('{n}杯', { n: st.katsudon }))}</dd>
      </dl>
      <div class="row">${next ? `<button class="btn primary" type="button" data-go="next">${esc(tr('{no}へ', { no: DATA.chapters[G.ci + 1].no }))}</button>` : ''}<button class="btn" type="button" data-go="title">${esc(tr('タイトルへ'))}</button></div>
    </div></div>`);
  }

  async function signingScreen(html, signer) {
    Sfx.heartbeat(0);
    showOverlay(`<div class="screen doc-screen"><div class="doc">
      <div class="bar"><span>${esc(tr('供述調書の読み聞かせ'))}</span><span>${esc(tr('右から左へ読む'))}</span></div>${html}
      <div class="bar"><span id="signNote">${esc(tr('署名ののち、指印を押す。'))}</span><button class="btn primary" type="button" data-go="close" id="signBtn" disabled>${esc(tr('指印を押す'))}</button></div></div></div>`);
    const wrap = ui.overlay.querySelector('.record-wrap');
    const vert = isVertical(wrap && wrap.firstElementChild);
    if (wrap) { if (vert) wrap.scrollLeft = wrap.scrollWidth; else wrap.scrollTop = 0; await sleep(400); }
    const btn = $('#signBtn');
    btn.disabled = false; btn.focus();
    await new Promise(r => { overlayResolver = r; });
    const slot = $('#fpSlot');
    if (slot) { slot.innerHTML = fingerprintSVG(); Sfx.play('fingerprint'); }
    if (wrap) wrap.scrollTo(vert ? { left: 0, behavior: reduceMotion ? 'auto' : 'smooth' } : { top: wrap.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
    btn.textContent = tr('次へ'); $('#signNote').textContent = tr('{name}――署名指印。', { name: signer });
    await new Promise(r => { overlayResolver = r; });
    ui.overlay.hidden = true; ui.overlay.innerHTML = '';
  }
  function fingerprintSVG() {
    let p = '';
    for (let i = 0; i < 11; i++) {
      const rx = 4 + i * 1.6, ry = 6 + i * 2;
      p += `<ellipse cx="19" cy="24" rx="${rx}" ry="${ry}" fill="none" stroke="#b5302a" stroke-width="1.1" stroke-dasharray="${6 + (i % 3) * 3} ${1.5 + (i % 2)}" opacity="${0.9 - i * 0.03}"/>`;
    }
    return `<svg class="fingerprint" viewBox="0 0 38 46" aria-label="${esc(tr('指印'))}"><g transform="rotate(-8 19 23)">${p}</g></svg>`;
  }

  function helpHTML(go, label) {
    return `<div class="screen card-screen"><div class="help">
      <h2>${esc(tr('遊び方'))}</h2>
      <p>${esc(tr('あなたは湊川警察署の刑事・久我。取調室で被疑者を追い詰め、「完落ち」――すべてを自白させる。全三章。'))}</p>
      <div class="two">
        <div><h3>${esc(tr('四つのコマンド'))}</h3><ul>
          <li><b>${esc(tr('聴き取り'))}</b>${esc(tr('：テーマを選んで言い分を聞く。答えは「聴取メモ」に残る。反発と動揺が上がる。'))}</li>
          <li><b>${esc(tr('捜査事実'))}</b>${esc(tr('：「判明した事実」を選び、次に聴取メモを選んで矛盾を突く。当たれば「矛盾」の判が押され、動揺が大きく上がり、供述が取れる。'))}</li>
          <li><b>${esc(tr('揺さぶり'))}</b>${esc(tr('：ライト、机、お茶、カツ丼、共犯者、親への連絡、そして自白を求める。'))}</li>
          <li><b>${esc(tr('供述調書'))}</b>${esc(tr('：得た供述の記録。'))}</li></ul></div>
        <div><h3>${esc(tr('二つのゲージ'))}</h3><ul>
          <li><b>${esc(tr('動揺'))}</b>${esc(tr('：赤い「自供」の目盛りを超えると、相手のほうから話し始める。'))}</li>
          <li><b>${esc(tr('懐柔／反発'))}</b>${esc(tr('：「本音」の目盛りより右で同じテーマを聞き直すと、本音が出る。最大まで懐柔しても、相手から話し始める。反発しきると黙秘されることがある。'))}</li>
          <li>${esc(tr('斜線は届かない範囲。初期値・増え方・上限下限は、被疑者のタイプで違う。'))}</li></ul></div>
      </div>
      <h3>${esc(tr('完落ちの条件'))}</h3>
      <p>${esc(tr('供述が規定の件数に達するか、動揺と懐柔がともに最高値のときに「自白を求める」。ただし、事実と食い違う嘘を潰し残していると、それを盾に反論され、動揺が大きく下がり反発が大きく上がる。矛盾していない供述を「矛盾だ」と突いたときも同じだ。'))}</p>
      <h3>${esc(tr('時間'))}</h3>
      <p>${esc(tr('行動ごとに時計が進む。取り調べは午後9時まで。捜査の進展で、途中から新しい事実が届く。'))}</p>
      <p style="font-size:12px;color:#958f83">${tr('操作：画面か会話欄をクリック／<kbd>Space</kbd><kbd>Enter</kbd>で会話を送る（<kbd>S</kbd>か「≫ 送る」でまとめて送る）。<kbd>1</kbd>〜<kbd>4</kbd>でコマンド、被疑者席では<kbd>1</kbd>〜<kbd>5</kbd>で応答。<kbd>Esc</kbd>で閉じる。')}</p>
      <div style="display:flex;gap:8px"><button class="btn lamp" type="button" data-go="${go}">${esc(label)}</button></div>
    </div></div>`;
  }
  function showHelp(awaitIt) {
    if (G) return showOverlayAwait(helpHTML('close', tr('取り調べに戻る')), { solid: false });
    showOverlay(helpHTML('title', tr('タイトルへ')));
  }
  function showLog() {
    const rows = logLines.slice(-160).map(l => `<div class="ln ${l.s}">${l.who ? `<b>${esc(l.who)}</b>` : ''}${esc(l.t)}</div>`).join('') || `<p class="hint">${esc(tr('まだ、会話はない。'))}</p>`;
    return showOverlayAwait(`<div class="screen card-screen"><div class="log"><div class="panel-head"><h2>${esc(tr('会話の履歴'))}</h2><button class="iconbtn x" type="button" data-go="close" style="margin-left:auto">${esc(tr('閉じる'))}</button></div><div class="panel-body" id="logBody">${rows}</div></div></div>`, { solid: false })
      .then(() => {});
  }
  function showMenu() {
    if (!G) return titleScreen();
    return showOverlayAwait(`<div class="screen card-screen"><div class="help" style="width:min(420px,100%)">
      <h2>${esc(tr('中断'))}</h2><p>${esc(tr('進み具合は、このブラウザに記録されている。'))}</p>
      <div style="display:grid;gap:8px">
        <button class="btn lamp" type="button" data-go="close">${esc(tr('取り調べに戻る'))}</button>
        <button class="btn" type="button" data-go="menuhelp">${esc(tr('遊び方'))}</button>
        <button class="btn" type="button" data-go="menulog">${esc(tr('会話の履歴'))}</button>
        <button class="btn" type="button" data-go="speed" data-tpl="文字の速さ：{v}">${esc(speedLabel('文字の速さ：{v}'))}</button>
        <button class="btn" type="button" data-go="sound">${esc(soundLabel())}</button>
        <button class="btn" type="button" data-go="title">${esc(tr('タイトルへ戻る'))}</button></div></div></div>`, { solid: false });
  }

  /* ───────────── 再開 ───────────── */
  function resume() {
    const sv = meta.save; if (!sv || !sv.G) return startChapter(0);
    G = sv.G; panelKind = sv.panelKind || 'hear';
    G.over = false;
    // 古い記録：撤回済みのカードに文字列で残していた内容を、供述の番号に置き換える
    if (G.phase !== 'rev') for (const [tid, c] of Object.entries(G.cards)) {
      if (c.admitted && !c.by) { const by = CH().statements.find(s => s.retracts === tid && G.stmts.includes(s.id)); if (by) { c.by = by.id; delete c.admitted; } }
    }
    preloadChapter(G.ci);
    enterRoom();
    if (isRev()) {
      setShot('pov_sit'); buildMeters(); render();
      idleText(tr('――取り調べが、再開された。'));
      if (G.rv.pending) G.rv.turn = Math.max(0, G.rv.turn - 1);
      rvLoop();
    } else {
      setShot(exprImg(moodKey())); buildMeters(); render();
      idleText(tr('――取り調べを再開する。{time}。', { time: fmt(G.clock) }));
    }
  }

  /* ───────────── 入力 ───────────── */
  document.addEventListener('click', e => {
    const t = e.target.closest('button, .dialogue, .stage');
    Sfx.init();
    if (!t) return;
    if (t.id === 'btnSkip') { skipDialogue(); return; }
    if (t.id === 'dialogue' || t.classList.contains('stage')) { onAdvance(); return; }
    if (t.dataset.go) return onGo(t.dataset.go, t);
    if (t.dataset.cmd) { if (busy) return onAdvance(); if (!isNarrow() && t.dataset.cmd === panelKind) return; return openPanel(t.dataset.cmd); }
    if (t.dataset.hear) return act(() => doHear(t.dataset.hear));
    if (t.dataset.fact && !busy) {
      pick = { fact: t.dataset.fact, topic: null };
      G.freshFacts = G.freshFacts.filter(x => x !== t.dataset.fact);
      const f = fact(t.dataset.fact);
      if (f && f.img) showInsert(f.img, { tag: tr('捜査事実：{title}', { title: f.title }), hold: true }); else hideInsert();
      Sfx.play('ui'); renderPanel(); ui.panelBody.scrollTop = 0; return;
    }
    if (t.dataset.topic && !busy) { pick.topic = t.dataset.topic; Sfx.play('ui'); renderPanel(); const bar = ui.panelBody.querySelector('.pairbar'); if (bar) bar.scrollIntoView({ block: 'nearest' }); return; }
    if (t.dataset.unpick) { if (t.dataset.unpick === 'topic') pick.topic = null; else { pick = { fact: null, topic: null }; hideInsert(); } renderPanel(); return; }
    if (t.dataset.point) { const f = pick.fact, tp = pick.topic; if (f && tp) act(() => doPoint(f, tp)); return; }
    if (t.dataset.shake) return act(() => doShake(t.dataset.shake));
    if (t.dataset.resp) return onResponse(t.dataset.resp);
    if (t.id === 'panelClose') return closePanel();
    if (t.id === 'btnLog') return showLog();
    if (t.id === 'btnHelp') return showHelp();
    if (t.id === 'btnSound') return toggleSound();
    if (t.id === 'btnMenu') return showMenu();
    if (t.id === 'btnHand') { ui.panel.classList.toggle('open'); return; }
  });
  const soundLabel = () => tr('音：{v}', { v: tr(meta.sound ? 'あり' : 'なし') });
  const speedLabel = tpl => tr(tpl, { v: tr(SPEEDS[meta.speed].label) });
  function toggleSound() {
    meta.sound = !meta.sound; saveMeta();
    Sfx.init(); Sfx.setOn(meta.sound);
    $('#btnSound').textContent = tr(meta.sound ? '音' : '無音');
    toast(esc(soundLabel()), 1200);
  }
  // 言語を切り替える。save のときは選んだ言語を記録に残す（自動判定のときは残さない）
  function useLang(id, { save } = {}) {
    I18N.set(id);
    DATA = I18N.data(SRC); R = DATA.reversal;
    if (save) { meta.lang = I18N.lang; saveMeta(); }
    I18N.applyDom();
    document.title = tr('完落ち ― 取調室・三章');
    ui.commands.dataset.mode = '';
    $('#btnSound').textContent = tr(meta.sound ? '音' : '無音');
  }
  function onGo(go, btn) {
    Sfx.init(); Sfx.play('ui');
    switch (go) {
      case 'close': if (!resolveOverlay('close')) hideOverlay(); return;
      case 'cardhelp': resolveOverlay('cardhelp'); return;
      case 'menuhelp': overlayResolver = null; showHelp(); return;
      case 'menulog': overlayResolver = null; showLog(); return;
      case 'new': meta.save = null; saveMeta(); return startChapter(0);
      case 'resume': return resume();
      case 'ch1': return startChapter(0);
      case 'ch2': return startChapter(1);
      case 'ch3': return startChapter(2);
      case 'next': return startChapter(G.ci + 1);
      case 'retry': return startChapter(G.ci);
      case 'title': overlayResolver = null; if (G && !G.over) saveProgress(); return titleScreen();
      case 'help': return showHelp(false);
      case 'sound': toggleSound(); btn.textContent = soundLabel(); return;
      case 'speed': meta.speed = (meta.speed + 1) % SPEEDS.length; saveMeta(); btn.textContent = speedLabel(btn.dataset.tpl || '文字：{v}'); return;
    }
    if (go.startsWith('lang:')) { useLang(go.slice(5), { save: true }); titleScreen(); }
  }
  document.addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key === 'Escape') {
      if (!ui.overlay.hidden && overlayResolver && ui.overlay.querySelector('[data-go="close"]') && !ui.overlay.querySelector('#signBtn')) { resolveOverlay('close'); return; }
      if (ui.panel.classList.contains('open')) closePanel();
      return;
    }
    if (!ui.overlay.hidden) return;
    if (e.key === ' ' || e.key === 'Enter') {
      if (document.activeElement && document.activeElement.tagName === 'BUTTON' && !busy) return;
      e.preventDefault(); onAdvance(); return;
    }
    if ((e.key === 's' || e.key === 'S') && busy) { skipDialogue(); return; }
    if (!G || busy) return;
    const n = parseInt(e.key, 10);
    if (isRev()) { if (n >= 1 && n <= 5 && respResolver) onResponse(RESPONSES[n - 1].id); return; }
    if (n >= 1 && n <= 4) openPanel(['hear', 'facts', 'shake', 'record'][n - 1]);
  });
  window.addEventListener('resize', () => { if (G && !isNarrow()) ui.panel.classList.remove('open'); });

  /* ───────────── 起動 ───────────── */
  Sfx.on = meta.sound;
  const urlLang = new URLSearchParams(location.search).get('lang');
  useLang(I18N.pick({ url: urlLang, saved: meta.lang, nav: navigator.languages || [navigator.language] }), { save: !!urlLang && I18N.has(urlLang) });
  idleText('');
  titleScreen();
  // 自動テスト用の窓口（ゲームの進行には使わない）
  window.__kanochi = { get G() { return G; }, get busy() { return busy; }, get DATA() { return DATA; }, get lang() { return I18N.lang; }, setLang: id => { useLang(id, { save: true }); titleScreen(); }, log: logLines, meta, advance: onAdvance, respond: onResponse, startChapter, doHear: id => act(() => doHear(id)), doPoint: (f, t) => act(() => doPoint(f, t)), doShake: k => act(() => doShake(k)) };
})();
