'use strict';
// 函數圖：老師輸入式子（例如 x^2-3x+2、sin(x)、1/x），前端直接畫成座標圖。
// 式子只在瀏覽器解析，不會送到伺服器；輸出是 PNG，跟手動插入圖片走同一條路。
// 支援 + - * / ^、括號、隱式乘法（2x、2(x+1)）、常數 pi/e，
// 以及 sin cos tan asin acos atan sqrt abs exp ln log floor ceil。

const PLOT_FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
  ln: Math.log, log: x => Math.log(x) / Math.LN10,
  floor: Math.floor, ceil: Math.ceil,
};

function plotTokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const num = Number(src.slice(i, j));
      if (!Number.isFinite(num)) throw new Error('數字格式不正確：' + src.slice(i, j));
      out.push({ t: 'num', v: num }); i = j; continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
      out.push({ t: 'name', v: src.slice(i, j).toLowerCase() }); i = j; continue;
    }
    if ('+-*/^()'.includes(c)) { out.push({ t: c }); i++; continue; }
    throw new Error('不支援的字元：' + c);
  }
  return out;
}

function plotParse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = t => { if (peek() && peek().t === t) { pos++; return true; } return false; };

  function expr() {
    let node = term();
    for (;;) {
      if (eat('+')) node = { op: '+', a: node, b: term() };
      else if (eat('-')) node = { op: '-', a: node, b: term() };
      else return node;
    }
  }
  function term() {
    let node = factor();
    for (;;) {
      if (eat('*')) node = { op: '*', a: node, b: factor() };
      else if (eat('/')) node = { op: '/', a: node, b: factor() };
      else if (startsPrimary(peek())) node = { op: '*', a: node, b: factor() };
      else return node;
    }
  }
  function factor() {
    const node = unary();
    return eat('^') ? { op: '^', a: node, b: factor() } : node;
  }
  function unary() {
    if (eat('-')) return { op: 'neg', a: unary() };
    if (eat('+')) return unary();
    return primary();
  }
  function primary() {
    const tk = peek();
    if (!tk) throw new Error('式子不完整');
    if (tk.t === 'num') { pos++; return { op: 'num', v: tk.v }; }
    if (tk.t === 'name') {
      pos++;
      if (tk.v === 'x') return { op: 'x' };
      if (tk.v === 'pi') return { op: 'num', v: Math.PI };
      if (tk.v === 'e') return { op: 'num', v: Math.E };
      if (PLOT_FUNCS[tk.v]) {
        if (!eat('(')) throw new Error('函數 ' + tk.v + ' 後面要加括號');
        const arg = expr();
        if (!eat(')')) throw new Error('缺少右括號');
        return { op: 'call', f: tk.v, a: arg };
      }
      throw new Error('看不懂的名稱：' + tk.v);
    }
    if (eat('(')) {
      const node = expr();
      if (!eat(')')) throw new Error('缺少右括號');
      return node;
    }
    throw new Error('式子格式不正確');
  }
  function startsPrimary(tk) {
    return !!tk && (tk.t === 'num' || tk.t === 'name' || tk.t === '(');
  }
  const root = expr();
  if (pos !== tokens.length) throw new Error('式子有多餘的內容');
  return root;
}

function plotEval(node, x) {
  switch (node.op) {
    case 'num': return node.v;
    case 'x': return x;
    case 'neg': return -plotEval(node.a, x);
    case '+': return plotEval(node.a, x) + plotEval(node.b, x);
    case '-': return plotEval(node.a, x) - plotEval(node.b, x);
    case '*': return plotEval(node.a, x) * plotEval(node.b, x);
    case '/': return plotEval(node.a, x) / plotEval(node.b, x);
    case '^': return Math.pow(plotEval(node.a, x), plotEval(node.b, x));
    case 'call': return PLOT_FUNCS[node.f](plotEval(node.a, x));
  }
  throw new Error('未知運算');
}

function plotCompile(src) {
  const root = plotParse(plotTokenize(src));
  return x => plotEval(root, x);
}

function plotFmt(v) {
  if (Math.abs(v) >= 1000) return String(Math.round(v));
  return String(Number(v.toFixed(2)));
}

// 把 src（可含多條，用分號分隔）畫到 canvas；回傳實際使用的座標範圍。
function plotGraph(canvas, src, opts) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const pad = 46;
  const xmin = Number(opts.xmin), xmax = Number(opts.xmax);
  if (!Number.isFinite(xmin) || !Number.isFinite(xmax) || xmin >= xmax) {
    throw new Error('x 範圍要由小到大。');
  }
  const fns = String(src).split(';').map(s => s.trim()).filter(Boolean);
  if (!fns.length) throw new Error('請輸入函數。');
  const compiled = fns.map(plotCompile);

  const N = Math.max(480, W - pad * 2);
  const samples = [];
  let lo = Infinity, hi = -Infinity;
  for (const f of compiled) {
    const arr = [];
    for (let i = 0; i <= N; i++) {
      const x = xmin + (xmax - xmin) * i / N;
      let y;
      try { y = f(x); } catch (_) { y = NaN; }
      arr.push(y);
      if (Number.isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
    }
    samples.push(arr);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    throw new Error('這個範圍內畫不出圖形（可能全在定義域外）。');
  }
  let ymin = opts.ymin, ymax = opts.ymax;
  if (!Number.isFinite(ymin) || !Number.isFinite(ymax) || ymin >= ymax) {
    const span = Math.max(hi - lo, 1e-6);
    ymin = lo - span * 0.12;
    ymax = hi + span * 0.12;
    if (lo > 0) ymin = Math.min(ymin, 0);
    if (hi < 0) ymax = Math.max(ymax, 0);
  }

  const X = x => pad + (x - xmin) / (xmax - xmin) * (W - pad * 2);
  const Y = y => H - pad - (y - ymin) / (ymax - ymin) * (H - pad * 2);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const niceStep = (span, target) => {
    const raw = span / target;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  };
  const xstep = niceStep(xmax - xmin, 10);
  const ystep = niceStep(ymax - ymin, 8);

  ctx.strokeStyle = '#e8eeea';
  ctx.lineWidth = 1;
  for (let x = Math.ceil(xmin / xstep) * xstep; x <= xmax + 1e-9; x += xstep) {
    ctx.beginPath(); ctx.moveTo(X(x), pad); ctx.lineTo(X(x), H - pad); ctx.stroke();
  }
  for (let y = Math.ceil(ymin / ystep) * ystep; y <= ymax + 1e-9; y += ystep) {
    ctx.beginPath(); ctx.moveTo(pad, Y(y)); ctx.lineTo(W - pad, Y(y)); ctx.stroke();
  }

  ctx.strokeStyle = '#17322c';
  ctx.lineWidth = 1.6;
  if (ymin <= 0 && ymax >= 0) {
    ctx.beginPath(); ctx.moveTo(pad, Y(0)); ctx.lineTo(W - pad, Y(0)); ctx.stroke();
  }
  if (xmin <= 0 && xmax >= 0) {
    ctx.beginPath(); ctx.moveTo(X(0), pad); ctx.lineTo(X(0), H - pad); ctx.stroke();
  }

  ctx.fillStyle = '#4c6259';
  ctx.font = '14px -apple-system, "PingFang TC", sans-serif';
  const y0 = Math.min(Math.max(Y(0), pad), H - pad);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let x = Math.ceil(xmin / xstep) * xstep; x <= xmax + 1e-9; x += xstep) {
    if (Math.abs(x) < 1e-9) continue;
    ctx.fillText(plotFmt(x), X(x), Math.min(y0 + 5, H - pad + 5));
  }
  const x0 = Math.min(Math.max(X(0), pad), W - pad);
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let y = Math.ceil(ymin / ystep) * ystep; y <= ymax + 1e-9; y += ystep) {
    if (Math.abs(y) < 1e-9) continue;
    ctx.fillText(plotFmt(y), Math.max(x0 - 6, pad + 36), Y(y));
  }
  ctx.fillText('O', Math.max(x0 - 9, pad + 18), Math.min(y0 + 13, H - pad + 13));

  const colors = ['#197c68', '#456bab', '#b96c5d', '#8a6420'];
  samples.forEach((arr, k) => {
    ctx.strokeStyle = colors[k % colors.length];
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= N; i++) {
      const y = arr[i];
      if (!Number.isFinite(y)) { started = false; continue; }
      const py = Y(y);
      if (py < -1e5 || py > 1e5) { started = false; continue; }
      if (started) {
        const prev = arr[i - 1];
        if (!Number.isFinite(prev) || Math.abs(y - prev) > (ymax - ymin) * 2) started = false;
      }
      const px = X(xmin + (xmax - xmin) * i / N);
      if (!started) { ctx.moveTo(px, py); started = true; }
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  });

  return { xmin, xmax, ymin, ymax };
}
