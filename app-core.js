'use strict';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// 題目全站唯一編號：後端 question_public 會帶 code；沒有時（例如作答紀錄只給 id）用同一規則補上。
const qCode = id => 'Q' + String(id ?? '').padStart(6, '0');

// ── 數學式子排版（KaTeX）──
// 題目／答案等文字可用 $...$ 寫行內數學、$$...$$ 寫獨立區塊數學，例如 $x^2-5x+6=0$。
// KaTeX 尚未載入或語法有誤時安全回退成純文字，不會讓整頁壞掉。
function katexHtml(tex, display){
  try{
    if(window.katex && typeof window.katex.renderToString === 'function'){
      const html=window.katex.renderToString(tex, {displayMode: !!display, throwOnError: false, strict: false, trust: false});
      // KaTeX 認不得的寫法（例如 \left（ 全角括號）會回一段紅色的 katex-error；
      // 與其讓老師看到紅字亂碼，不如把原始碼顯示出來，至少看得出是什麼
      if(html.indexOf('katex-error') < 0) return html;
    }
  }catch(_){}
  return `<code class="math-fallback">${esc(tex)}</code>`;
}
function mathText(value){
  const raw = String(value ?? '');
  if(raw.indexOf('$') < 0){
    // 整段都是數學式（沒有中文）就直接排版：AI 有時回傳 "x^2-3x-10<0" 這種純算式
    const trimmed = raw.trim();
    if(trimmed
       && /^[0-9A-Za-z\s+\-*/=<>^_{}()\[\].,|\\≥≤≠×÷−±]+$/.test(trimmed)
       && /[\^_=<>≥≤≠]/.test(trimmed)){
      // Unicode 數學符號換成 LaTeX，否則 KaTeX 會報錯
      const tex=trimmed
        .replace(/≥/g,'\\ge ').replace(/≤/g,'\\le ').replace(/≠/g,'\\ne ')
        .replace(/×/g,'\\times ').replace(/÷/g,'\\div ')
        .replace(/−/g,'-').replace(/±/g,'\\pm ');
      return katexHtml(tex, false);
    }
    return esc(raw);
  }
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  const out = [];
  let last = 0, m;
  while((m = re.exec(raw)) !== null){
    const display = m[1] !== undefined;
    const body = display ? m[1] : m[2];
    const prevChar = m.index > 0 ? raw[m.index - 1] : '';
    const nextChar = raw[m.index + m[0].length] || '';
    // 避免把「$5 元，$10 元」這類金額誤判成數學式
    const suspicious = !display && (
      /[\w\u4e00-\u9fff]/.test(prevChar) || /\d/.test(nextChar) || /^\s|\s$/.test(body));
    if(suspicious) continue;
    out.push(esc(raw.slice(last, m.index)));
    out.push(katexHtml(body, display));
    last = m.index + m[0].length;
  }
  out.push(esc(raw.slice(last)));
  return out.join('');
}


// ── 選擇題選項 ──
const OPTION_LETTERS = 'ABCDEFGHIJ';
const optionLetters = n => OPTION_LETTERS.slice(0, n).split('');
// 題目卡／詳解頁的選項清單（純呈現，數學式會渲染）
function optionsHtml(q, cls){
  const opts = (q && q.options) || [];
  if(!opts.length) return '';
  return `<ol class="choice-options ${cls||''}">${opts.map((o,j)=>`<li><span class="option-letter">${OPTION_LETTERS[j]}</span><span class="option-text">${mathText(o)}</span></li>`).join('')}</ol>`;
}
// 選項的即時渲染預覽（編輯頁用）。宣告在模組層級：'use strict' 下區塊內的
// function 宣告是區塊作用域，跨區塊呼叫會 ReferenceError。
function optionsPreviewHtml(opts){
  if(!opts||!opts.length) return '';
  return opts.map((o,j)=>`<div class="preview-option"><span class="option-letter">${OPTION_LETTERS[j]}</span><span>${mathText(o)}</span></div>`).join('');
}

// ── 評分標準（百分比，供 AI 評分按比例配分）──
const RUBRIC_MAX = 12;
function rubricTotal(items){
  return (items||[]).reduce((sum,x)=>sum+(Number(x&&x.percent)||0),0);
}
function rubricRowsHtml(items, scope){
  return (items||[]).map((it,j)=>`<div class="rubric-row"><input class="rubric-label" value="${esc(it.label||'')}" maxlength="200" placeholder="評分要點 ${j+1}（例如：正確列出方程式）" data-rubric-label="${scope}" data-rubric-index="${j}"><span class="rubric-percent"><input type="number" min="0" max="100" step="1" value="${Number(it.percent)||0}" data-rubric-percent="${scope}" data-rubric-index="${j}" aria-label="評分要點 ${j+1} 的百分比"><span>%</span></span><button type="button" class="icon-btn" data-rubric-drop="${scope}" data-rubric-index="${j}" aria-label="刪除評分要點 ${j+1}">${icon('trash')}</button></div>`).join('');
}
function rubricEditorHtml(scope, items){
  return `<label class="field-label">評分標準（百分比 · 供 AI 評分按比例配分）<span class="small-text" style="font-weight:400">　總和須為 100%</span></label>
    <div class="rubric-list" data-rubric-list="${scope}">${rubricRowsHtml(items, scope)}</div>
    <div class="rubric-actions"><button type="button" class="text-button" data-rubric-add="${scope}">＋ 新增評分要點</button><span class="rubric-total" data-rubric-total="${scope}">總和 0%</span></div>
    <div class="rubric-preview" data-rubric-preview="${scope}"></div>`;
}
// 客觀題（選擇題／填空題）：作答只有對或錯，用答案核對評分即可，不需要評分標準／評分步驟。
const OBJECTIVE_QTYPES = ['選擇題','填空題'];
const isObjectiveQtype = t => OBJECTIVE_QTYPES.includes(t);
function rubricFieldHtml(scope, items, qtype, qid){
  const objective = isObjectiveQtype(qtype);
  // 只有「已存在的題目」才有 qid：新增題目時還沒有 id，改用上面的「AI 生成答案與評分標準」。
  const aiButton = qid
    ? `<div class="ai-answer-row"><button type="button" class="secondary" id="${scope}-ai-rubric">${icon('spark')}只生成評分標準</button><span class="small-text">依現有的參考答案與詳解拆出評分要點（不會改動答案）</span></div>`
    : '';
  return `<div class="form-field" data-rubric-field="${scope}"${objective?' style="display:none"':''}>${rubricEditorHtml(scope, items)}${aiButton}</div>
    <div class="form-field objective-note" data-objective-note="${scope}"${objective?'':' style="display:none"'}>客觀題（選擇題／填空題）以「答案是否正確」評分，不需要評分標準，也不會產生 AI 評分步驟。</div>`;
}
function toggleRubricField(scope, qtype){
  const objective = isObjectiveQtype(qtype);
  const field=document.querySelector(`[data-rubric-field="${scope}"]`);
  const note=document.querySelector(`[data-objective-note="${scope}"]`);
  if(field) field.style.display=objective?'none':'';
  if(note) note.style.display=objective?'':'none';
}
// 唯讀呈現（題目詳解、批閱視窗、AI 草稿）
function rubricListHtml(items, points){
  if(!items||!items.length) return '';
  return `<ul class="rubric-view">${items.map(it=>{const pct=Number(it.percent)||0;
    return `<li><span class="rubric-view-label">${mathText(it.label||'')}</span><span class="rubric-view-percent">${pct}%${points?` · ${Math.round(points*pct)/100} 分`:''}</span></li>`;}).join('')}</ul>`;
}
// 批閱用：把評分要點做成可勾選的清單，勾完自動加總填入分數欄（仍可手動微調）。
// 只給教師看；學生端一律用 rubricListHtml（唯讀），避免洩漏評分標準。
function rubricChecklistHtml(items, points){
  const rows=(items||[]).filter(it=>it&&String(it.label||'').trim());
  if(!rows.length) return '';
  const pctTotal=rows.reduce((s,it)=>s+(Number(it.percent)||0),0);
  const body=rows.map((it,j)=>{const pct=Number(it.percent)||0;const pts=points?Math.round(points*pct)/100:0;
    return `<label class="rubric-check-row"><input type="checkbox" data-rubric-points="${pts}" data-rubric-pct="${pct}"><span class="rubric-check-label">${mathText(it.label||'')}</span><span class="rubric-check-pts">${pct}%${points?` · ${pts} 分`:''}</span></label>`;}).join('');
  // 要點合計不是 100% 時先講清楚，教師才知道「全勾也不會滿分」是正常的。
  const note=Math.abs(pctTotal-100)<0.01?'':`（要點合計 ${Math.round(pctTotal*10)/10}%，全勾為 ${Math.round((points||0)*pctTotal)/100} 分）`;
  return `<div class="rubric-check" id="review-rubric"><div class="rubric-check-head"><strong>評分要點</strong><span class="small-text">勾選即自動加總，仍可手動微調</span><span class="rubric-check-actions"><button type="button" class="text-button" id="rubric-all">全選</button><button type="button" class="text-button" id="rubric-none">清除</button></span></div>${body}<p class="rubric-check-total"><span id="rubric-total-hint">已勾 0/${rows.length} 項 · 合計 0 分</span>${note}</p></div>`;
}
// 編輯器的即時排版預覽：輸入框只能顯示原始 LaTeX，這裡讓教師看到排版後的式子。
function rubricPreviewRender(scope){
  const store = rubricStores.get(scope);
  const box = document.querySelector(`[data-rubric-preview="${scope}"]`);
  if(!store || !box) return;
  const html = rubricListHtml((store.items||[]).filter(x=>x && String(x.label||'').trim()));
  box.innerHTML = html ? `<span class="rubric-preview-label">排版預覽</span>${html}` : '';
}
const rubricStores = new Map();
function rubricRender(scope){
  const store = rubricStores.get(scope);
  const list = document.querySelector(`[data-rubric-list="${scope}"]`);
  if(!store || !list) return;
  const items = store.items;
  list.innerHTML = rubricRowsHtml(items, scope);
  rubricPreviewRender(scope);
  const total = document.querySelector(`[data-rubric-total="${scope}"]`);
  if(total){
    const t = Math.round(rubricTotal(items)*100)/100;
    total.textContent = items.length ? `總和 ${t}%${Math.abs(t-100)>0.01?'（須為 100%）':''}` : '尚未設定';
    total.classList.toggle('bad', items.length>0 && Math.abs(t-100)>0.01);
  }
  list.querySelectorAll('[data-rubric-label]').forEach(inp=>inp.oninput=e=>{items[Number(e.target.dataset.rubricIndex)].label=e.target.value;rubricPreviewRender(scope);});
  list.querySelectorAll('[data-rubric-percent]').forEach(inp=>inp.oninput=e=>{
    items[Number(e.target.dataset.rubricIndex)].percent=Number(e.target.value)||0;
    const t=Math.round(rubricTotal(items)*100)/100;
    if(total){total.textContent=`總和 ${t}%${Math.abs(t-100)>0.01?'（須為 100%）':''}`;total.classList.toggle('bad',Math.abs(t-100)>0.01);}
  });
  list.querySelectorAll('[data-rubric-drop]').forEach(b=>b.onclick=()=>{items.splice(Number(b.dataset.rubricIndex),1);rubricRender(scope);});
  const add = document.querySelector(`[data-rubric-add="${scope}"]`);
  if(add) add.onclick=()=>{
    if(items.length>=RUBRIC_MAX) return toast(`評分標準最多 ${RUBRIC_MAX} 項。`);
    items.push({label:'',percent:0});
    rubricRender(scope);
    const box=document.querySelector(`[data-rubric-list="${scope}"]`);
    const last=box&&box.querySelector('input:last-of-type');
    if(last) last.focus();
  };
}
function rubricBind(scope, items){
  if(!Array.isArray(items)) items=[];
  rubricStores.set(scope, {items});
  rubricRender(scope);
  return items;
}
// 送出前清理：移除沒有說明的項目；若總和不是 100 回傳錯誤訊息。
function cleanRubric(items){
  const out = (items||[]).map(x=>({label:String((x&&x.label)||'').trim(),percent:Number(x&&x.percent)||0}))
    .filter(x=>x.label);
  return out;
}
function rubricProblem(items){
  const clean = cleanRubric(items);
  if(!clean.length) return '';
  const total = Math.round(rubricTotal(clean)*100)/100;
  if(Math.abs(total-100) > 0.01) return `評分標準的百分比總和必須等於 100（目前 ${total}%）。`;
  return '';
}
