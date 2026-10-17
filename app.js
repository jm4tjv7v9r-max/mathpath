'use strict';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ── 數學式子排版（KaTeX）──
// 題目／答案等文字可用 $...$ 寫行內數學、$$...$$ 寫獨立區塊數學，例如 $x^2-5x+6=0$。
// KaTeX 尚未載入或語法有誤時安全回退成純文字，不會讓整頁壞掉。
function katexHtml(tex, display){
  try{
    if(window.katex && typeof window.katex.renderToString === 'function'){
      return window.katex.renderToString(tex, {displayMode: !!display, throwOnError: false, strict: false, trust: false});
    }
  }catch(_){}
  return `<code class="math-fallback">${esc(tex)}</code>`;
}
function mathText(value){
  const raw = String(value ?? '');
  if(raw.indexOf('$') < 0) return esc(raw);
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
function rubricFieldHtml(scope, items, qtype){
  const objective = isObjectiveQtype(qtype);
  return `<div class="form-field" data-rubric-field="${scope}"${objective?' style="display:none"':''}>${rubricEditorHtml(scope, items)}</div>
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

const paths = {
 plus:'<path d="M12 5v14M5 12h14"/>',
 newq:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M12 12v5M9.5 14.5h5"/>',
 line:'<path d="M4 19 20 5"/>',
 dashed:'<path d="M4 19 20 5" stroke-dasharray="3 3"/>',
 circle:'<circle cx="12" cy="12" r="8"/>',
 label:'<path d="M6 19 12 5l6 14"/><path d="M8.8 14.2h6.4"/>',
 select:'<path d="M5 3l14 7-6 1.6L10.6 19z" fill="currentColor" stroke-linejoin="round"/>',
 bank:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 practice:'<path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5M4 15l5 5"/>',
 import:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 15h8M12 11v8"/>',
 mistakes:'<path d="M4 19V5a2 2 0 0 1 2-2h13v17H6a2 2 0 0 1-2-1Zm0 0a2 2 0 0 1 2-2h13M9 7h6M9 11h4"/>',
 growth:'<path d="M3 3v18h18M7 14l4-4 4 2 6-7M16 5h5v5"/>',
 settings:'<path d="m9 3-1 3-3 1-2 3 2 3v3l3 1 1 4h6l1-4 3-1v-3l2-3-2-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
 chevron:'<path d="m9 5 7 7-7 7"/>',
 back:'<path d="M20 12H4m6-6-6 6 6 6"/>',
 bookmark:'<path d="M6 3h12v18l-6-4-6 4Z"/>',
 list:'<path d="M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1"/>',
 spark:'<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>',
 warn:'<path d="M12 3 2 20h20ZM12 9v5m0 3h.01"/>',
 bulb:'<path d="M9 18h6M9 21h6M8 14a6 6 0 1 1 8 0l-1 2H9ZM12 3V1M4 5 2 3M20 5l2-2"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
 flame:'<path d="M12 2c2 6 7 7 7 13a7 7 0 0 1-14 0c0-3 1-5 4-8l1 5c3-3 3-6 2-10Z"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 1c0 2-3 2-3 4M12 17h.01"/>',
 upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
 image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
 undo:'<path d="M4 9h9a7 7 0 0 1 0 14M4 9l5-5M4 9l5 5"/>',
 eraser:'<path d="m16 3 5 5-10 12H7l-5-5Z"/><path d="m8 8 8 8M11 20h10"/>',
 trash:'<path d="M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
 lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
 logout:'<path d="M9 3H4v18h5M9 12h12m-5-5 5 5-5 5"/>',
 file:'<path d="M14 2H5v20h14V7ZM14 2v5h5M8 12h8M8 16h6"/>',
 ai:'<path d="M9 3v6M15 3v6M6 9h12v3a6 6 0 0 1-12 0Z"/><path d="M12 18v3"/>',
 mock:'<path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"/><circle cx="12" cy="12" r="4"/>',
 text:'<path d="M4 20 10 4h4l6 16M7 14h10"/>',
 calculator:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 7h7M8.5 11h1M12 11h1M15.5 11h1M8.5 15h1M12 15h1M15.5 15h1"/>',
 edit:'<path d="M4 20h4L19 9a2.12 2.12 0 0 0-3-3L5 17Z"/><path d="M14.5 6.5 17.5 9.5"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.bank}</svg>`;
const topicTree = {
"數與數系": [
"正數與負數",
"有理數及其分類",
"數軸",
"相反數",
"絕對值",
"有理數加減法",
"有理數乘除法",
"有理數乘方",
"科學記數法",
"近似數與有效數字",
"平方根與算術平方根",
"立方根",
"無理數",
"實數及其運算",
"數系擴展",
"二次根式",
"二次根式的乘除",
"二次根式的加減",
"複數的概念",
"複數的四則運算"
],
"代數": [
"用字母表示數",
"代數式",
"列代數式",
"代數式的值",
"單項式",
"多項式",
"升冪與降冪排列",
"同類項",
"合併同類項",
"去括號法則",
"整式的加減"
],
"代數式與多項式": [
"同底數冪的乘法",
"冪的乘方",
"積的乘方",
"單項式乘單項式",
"單項式乘多項式",
"多項式乘多項式",
"平方差公式",
"完全平方公式",
"乘法公式的變形運用",
"同底數冪的除法",
"零指數與負整數指數",
"單項式除以單項式",
"多項式除以單項式",
"分式的概念",
"分式的基本性質",
"分式的乘除",
"分式的加減",
"分式方程"
],
"因式分解": [
"因式分解的概念",
"提公因式法",
"公式法（平方差）",
"公式法（完全平方）",
"十字相乘法",
"分組分解法",
"拆項與添項法",
"因式分解的應用"
],
"方程與不等式": [
"方程的概念",
"等式的性質",
"一元一次方程",
"解一元一次方程（移项）",
"解一元一次方程（去括号）",
"解一元一次方程（去分母）",
"一元一次方程的應用",
"二元一次方程組",
"代入消元法",
"加減消元法",
"二元一次方程組的應用",
"三元一次方程組",
"不等式及其性質",
"一元一次不等式",
"一元一次不等式組",
"不等式的應用",
"絕對值不等式"
],
"一元二次方程": [
"一元二次方程的概念",
"直接開平方法",
"配方法",
"公式法",
"因式分解法",
"根的判別式",
"韋達定理（根與係數關係）",
"根的符號與分佈",
"可化為一元二次方程的方程",
"二元二次方程組",
"一元二次方程的應用"
],
"函數": [
"變量與函數",
"函數的表示法",
"函數定義域與值域",
"正比例函數",
"一次函數",
"一次函數的圖象與性質",
"一次函數與方程（組）",
"反比例函數",
"反比例函數的圖象與性質",
"二次函數及其圖象",
"二次函數的頂點與對稱軸",
"二次函數與一元二次方程",
"二次函數的最值",
"二次函數的應用",
"函數的單調性",
"函數的奇偶性",
"函數的最大（小）值",
"分段函數"
],
"函數圖像與變換": [
"平面直角坐標系",
"點的坐標與象限",
"坐標方法的簡單應用",
"函數圖象的繪製",
"圖象的平移",
"圖象的對稱變換",
"圖象的伸縮變換",
"圖象的翻折",
"函數圖象的交點問題",
"函數與方程的關係"
],
"指數與對數": [
"根式與分數指數冪",
"指數冪的運算",
"指數函數",
"指數函數的圖象與性質",
"對數的概念",
"對數的運算性質",
"換底公式",
"對數函數",
"對數函數的圖象與性質",
"指數函數與對數函數的關係",
"指數與對數的實際應用"
],
"數列與級數": [
"數列的概念與表示",
"數列的通項公式",
"遞推公式",
"數列的前n項和",
"等差數列",
"等差數列的前n項和",
"等差數列的性質",
"等比數列",
"等比數列的前n項和",
"等比數列的性質",
"等差與等比的綜合",
"裂項相消求和",
"錯位相減求和",
"分組求和",
"數列的應用",
"數學歸納法"
],
"變分": [
"正變（正比例）",
"反變（反比例）",
"聯變",
"部分變",
"變分的應用",
"變分與函數的關係"
],
"線性規劃": [
"二元一次不等式（組）與平面區域",
"圖解法求最優解",
"線性目標函數",
"線性規劃的實際應用",
"整點最優解問題"
],
"幾何": [
"立體圖形與平面圖形",
"點、線、面、體",
"直線、射線、線段",
"線段的長短比較",
"線段的中點",
"兩點之間線段最短",
"角的定義與度量",
"角的比較與運算",
"餘角與補角",
"對頂角",
"垂線與點到直線的距離",
"同位角、內錯角、同旁內角",
"平行線及其判定",
"平行線的性質",
"命題、定理與證明",
"平移及其性質"
],
"三角形": [
"三角形的邊",
"三角形的高、中線、角平分線",
"三角形的穩定性",
"三角形內角和定理",
"三角形的外角",
"三邊關係",
"多邊形及其內角和",
"多邊形的外角和",
"全等三角形",
"全等的判定（SSS）",
"全等的判定（SAS）",
"全等的判定（ASA、AAS）",
"全等的判定（HL）",
"角的平分線的性質",
"等腰三角形",
"等邊三角形",
"含30°角的直角三角形",
"勾股定理",
"勾股定理的逆定理",
"勾股數",
"相似圖形",
"相似三角形",
"相似三角形的判定",
"相似三角形的性質",
"位似圖形"
],
"四邊形與多邊形": [
"多邊形的基本概念",
"多邊形的內角和與外角和",
"正多邊形",
"平行四邊形",
"平行四邊形的判定",
"矩形的性質與判定",
"菱形的性質與判定",
"正方形的性質與判定",
"梯形與等腰梯形",
"三角形中位線定理",
"梯形中位線定理",
"重心與其他特殊點"
],
"圓": [
"圓的基本概念",
"點與圓的位置關係",
"垂徑定理",
"弧、弦、圓心角的關係",
"圓周角定理",
"圓內接四邊形",
"直線與圓的位置關係",
"切線的判定",
"切線的性質",
"切線長定理",
"圓與圓的位置關係",
"三角形的外接圓與內切圓",
"正多邊形與圓",
"弧長與扇形面積",
"圓錐的側面積與全面積",
"圓的綜合證明"
],
"立體圖形": [
"立體圖形的三視圖",
"由三視圖判斷幾何體",
"立體圖形的展開圖",
"投影",
"中心投影與平行投影",
"直棱柱與圓柱的表面積",
"棱錐與圓錐的表面積",
"柱體、錐體、球的體積",
"球的表面積",
"空間點、線、面的位置關係",
"直線與平面平行",
"平面與平面平行",
"直線與平面垂直",
"平面與平面垂直",
"空間角（異面直線所成角）",
"空間距離",
"多面體與旋轉體"
],
"三角學": [
"銳角三角函數（正弦、餘弦、正切）",
"特殊角的三角函數值",
"解直角三角形",
"解直角三角形的應用",
"坡度與方位角",
"任意角與弧度制",
"任意角的三角函數",
"同角三角函數的基本關係",
"誘導公式",
"三角函數的圖象與性質",
"函數 y=Asin(ωx+φ)",
"正弦定理",
"餘弦定理",
"三角形面積公式",
"解三角形的應用",
"兩角和與差的正弦、餘弦、正切",
"二倍角公式",
"半角公式",
"和差化積與積化和差",
"三角恆等式的證明"
],
"坐標幾何": [
"平面直角坐標系",
"兩點間距離公式",
"中點坐標公式",
"分點坐標公式",
"直線的傾斜角與斜率",
"直線的方程（點斜式、斜截式）",
"直線的方程（一般式）",
"兩直線平行與垂直",
"兩直線的交點",
"點到直線的距離公式",
"圓的標準方程",
"圓的一般方程",
"直線與圓的位置關係",
"圓與圓的位置關係",
"橢圓及其標準方程",
"橢圓的幾何性質",
"雙曲線及其標準方程",
"雙曲線的幾何性質",
"拋物線及其標準方程",
"拋物線的幾何性質",
"圓錐曲線的統一性質",
"直線與圓錐曲線的位置關係",
"軌跡方程的求法"
],
"軌跡與幾何證明": [
"軌跡的概念",
"基本軌跡（到定點等距）",
"基本軌跡（到定直線等距）",
"軌跡方程",
"幾何證明的步驟與書寫",
"綜合法證明",
"分析法證明",
"反證法",
"同一法",
"面積法證明",
"代數法（坐標法）證明",
"向量法證明"
],
"向量": [
"向量的概念",
"相等向量與共線向量",
"向量的加法與減法",
"向量的數乘",
"向量共線定理",
"平面向量基本定理",
"平面向量的坐標表示",
"平面向量的數量積",
"向量垂直與平行的坐標判定",
"向量的模與夾角",
"向量在幾何中的應用",
"向量在物理中的應用",
"空間向量及其運算",
"空間向量基本定理",
"空間向量的坐標表示",
"空間向量的數量積",
"空間向量與立體幾何",
"法向量及其應用"
],
"統計": [
"數據的收集（全面調查）",
"抽樣調查",
"簡單隨機抽樣",
"系統抽樣",
"分層抽樣",
"總體、樣本與樣本容量",
"數據的整理",
"條形統計圖",
"扇形統計圖",
"折線統計圖",
"頻數與頻率",
"頻數分佈表",
"頻率分佈直方圖",
"莖葉圖",
"用樣本估計總體",
"用樣本頻率分佈估計總體分佈",
"統計圖表的選擇與誤導"
],
"集中趨勢與離差": [
"平均數",
"加權平均數",
"中位數",
"眾數",
"平均數、中位數、眾數的比較與選用",
"極差",
"方差",
"標準差",
"百分位數",
"四分位數與箱線圖",
"離散程度的比較",
"變量間的相關關係",
"散佈圖",
"一元線性回歸方程",
"相關係數",
"列聯表與獨立性檢驗",
"殘差分析"
],
"概率": [
"隨機事件",
"事件的关系与運算",
"概率的意義",
"古典概型",
"列舉法求概率",
"樹狀圖求概率",
"幾何概型",
"頻率與概率的關係",
"事件的相互獨立性",
"條件概率",
"概率的乘法公式",
"全概率公式",
"貝葉斯公式",
"離散型隨機變量",
"隨機變量的分佈列",
"兩點分佈與超幾何分佈",
"二項分佈",
"正態分佈",
"隨機變量的均值（期望）",
"隨機變量的方差",
"概率的實際應用"
],
"排列與組合": [
"分類加法計數原理",
"分步乘法計數原理",
"排列與排列數",
"排列數公式",
"組合與組合數",
"組合數公式",
"組合數的性質",
"排列組合的綜合應用",
"二項式定理",
"二項式係數的性質",
"楊輝三角"
],
"極限與微分": [
"數列的極限",
"函數的極限",
"極限的四則運算",
"兩個重要極限",
"無窮小與無窮大",
"函數的連續性",
"變化率問題",
"導數的概念",
"導數的幾何意義",
"基本初等函數的導數",
"導數的四則運算",
"複合函數的導數",
"隱函數與參數方程求導",
"高階導數",
"導數與函數的單調性",
"函數的極值",
"函數的最大（小）值",
"導數在最優化中的應用",
"曲線的切線與法線",
"微分中值定理",
"洛必達法則"
],
"積分": [
"定積分的概念",
"定積分的幾何意義",
"定積分的性質",
"微積分基本定理（牛頓-萊布尼茨公式）",
"不定積分的概念",
"基本積分公式",
"換元積分法",
"分部積分法",
"定積分求平面圖形面積",
"定積分求旋轉體體積",
"定積分的物理應用"
],
"比賽題": [
"金蓮花",
"校際",
"AIMO",
"思維",
"其他"
]
};
const topics = Object.keys(topicTree);
const grades = ["中一", "中二", "中三", "中四", "中五", "中六"];
const subtopicsOf=t=>topicTree[t]||[];
const levels = ['','基礎','鞏固','進階'];
const qtypes = ['選擇題','填空題','解答題','證明題'];
const preview = [
{id:1,title:'因式分解解二次方程',content:'解方程 x²−5x+6=0。',topic:topics[0],level:1,grade:'中三',points:6,tags:['因式分解','零乘積性質'],source:'中三數學·第一學期測驗',hint:'先找出乘積為6、和為5的兩數。'},
{id:2,title:'相似題：整數根',content:'解方程 x²−7x+12=0。',topic:topics[0],level:1,grade:'中三',points:6,tags:['因式分解','整數根'],source:'中三數學·第一學期測驗'},
{id:3,title:'完全平方式與重根',content:'解方程 x²−6x+9=0。',topic:topics[0],level:1,grade:'中三',points:5,tags:['完全平方','重根'],source:'中三數學·第一學期測驗'},
{id:4,title:'進階：含參數的重根',content:'方程 x²−(k+2)x+2k=0 有兩個相等的實根，求實數 k。',topic:topics[0],level:3,grade:'中三',points:8,tags:['判別式','參數','重根'],source:'中三數學·第一學期測驗'},
{id:5,title:'一正一負的兩根',content:'解方程 x²+x−6=0。',topic:topics[0],level:2,grade:'中三',points:6,tags:['因式分解','負數根'],source:'中三數學·第一學期測驗'},
{id:6,title:'一次函數求值',content:'已知 f(x)=2x+1，求 f(3)。',topic:topics[1],level:1,grade:'中三',points:4,tags:['函數值','代入'],source:'校本題庫'}
];
let S={user:null,questions:preview,attempts:[],stats:{completed:0,accuracy:0,streak:0,minutes:0},ai:{configured:false,mode:'off'},notice:''};
let page='bank', topic='全部題目', subtopic='', search='', grade='', level='', qtype='', currentPage=1, viewMode='list', currentQuestion=null, recommendations=null, answerMode='hand', lastResult=null, lastSolution=null;
let importStage=1, drafts=[], importMethod='', paperFile=null, paperName='', paperText='', figImage=null, figSketch=null, figCanvasTools=null, historyFilter='all';
// 題目圖形工作室的狀態；關閉視窗時要一起清掉（見 closeModal）。
let figStudio=null;
// 自主練習的範圍：先選章節（主分類／子分類）與題型，再開始練習。
let practiceRange={topic:'',subtopic:'',qtype:''};
let toastTimer, serverOnline=false, busy=false, answerFile=null, selectedOption=null;
// 伺服器未就緒（初始化中／初始化失敗）時的原因；成功呼叫任何 API 後就清掉。
let serverIssue='';
// 演示帳號是否仍用內建密碼（由 /api/health 回報）：null＝尚未確認。
// 已換過密碼就不再顯示舊的演示帳密——那會誤導學生，也是安全問題。
let serverDemo=null;
let strokes=[], redoStrokes=[], activeStroke=null, penColor='#274b3b', eraser=false;
let bookmarks=new Set();
let assignmentContext=null, mockContext=null;
let draftTimer, draftUser=null, viewSeq=0, uploadSeq=0, uploadReading=false;
function beginView(){viewSeq++;uploadSeq++;uploadReading=false;clearTimeout(draftTimer);}
function viewTarget(){return {seq:viewSeq,userId:S.user?.id,page,questionId:currentQuestion?.id,assignmentId:assignmentContext?.id,mockId:mockContext?.id};}
function viewMatches(t){return t.seq===viewSeq&&t.userId===S.user?.id&&t.page===page&&t.questionId===currentQuestion?.id&&t.assignmentId===assignmentContext?.id&&t.mockId===mockContext?.id;}
function draftKey(){return S.user&&currentQuestion?`mathpath_draft_${S.user.id}_${mockContext?`mock_${mockContext.id}`:assignmentContext?.id||'practice'}_${currentQuestion.id}`:null;}
function saveDraft(){const key=draftKey();if(!key||page!=='practice'||lastResult)return;const payload={mode:answerMode,strokes,process:$('#answer-process')?.value||window.answerTextDraft||'',final:$('#final-answer')?.value||'',image:answerFile,choice:selectedOption,updatedAt:new Date().toISOString()};try{sessionStorage.setItem(key,JSON.stringify(payload));draftUser=S.user.id;const label=$('#draft-status');if(label)label.textContent='草稿已暫存於本分頁 · 正式提交後才保存到伺服器';}catch{const label=$('#draft-status');if(label)label.textContent='草稿暫存失敗，請及時提交（圖片可能太大）';}}
function scheduleDraft(){clearTimeout(draftTimer);draftTimer=setTimeout(saveDraft,350);}
function restoreDraft(){const key=draftKey();if(!key)return;try{const d=JSON.parse(sessionStorage.getItem(key)||'null');if(!d)return;if(!['choice','hand','text','upload'].includes(d.mode)||!Array.isArray(d.strokes))return;answerMode=(d.mode==='choice'&&!(currentQuestion&&currentQuestion.options&&currentQuestion.options.length))?'hand':d.mode;strokes=d.strokes;window.answerTextDraft=d.process||'';answerFile=d.image||null;selectedOption=d.choice||null;renderAnswerArea();$$('[data-answer-mode]').forEach(b=>b.classList.toggle('active',b.dataset.answerMode===answerMode));$('#final-answer').value=d.final||'';$('#draft-status').textContent='已恢復本分頁草稿 · 未正式提交';syncMathKeyboard();}catch{toast('草稿無法恢復，請重新作答。');}}
function clearCurrentDraft(){const key=draftKey();if(key)try{sessionStorage.removeItem(key);}catch{}clearTimeout(draftTimer);}
function clearUserDrafts(uid){try{for(let i=sessionStorage.length-1;i>=0;i--){const k=sessionStorage.key(i);if(k?.startsWith(`mathpath_draft_${uid}_`))sessionStorage.removeItem(k);}}catch{}}
function preserveDraft(){if(page==='practice'&&!lastResult)saveDraft();}
window.addEventListener('pagehide',preserveDraft);
document.addEventListener('input',e=>{if(e.target.matches('#final-answer,#answer-process')){lastResult=null;scheduleDraft();}});
// AI 無法批改時，伺服器會在評語裡明說「AI 暫時無法…」。這種訊息要讓學生與教師一眼看到，
// 不能混在一般說明文字裡，所以另外給一個樣式類別（紅色粗體加大）。
function feedbackClass(value){return /AI 暫時無法/.test(String(value||''))?' ai-unavailable':'';}
function suggestionCard(s){if(!s)return '';return `<section class="learning-advice"><div class="advice-heading">${icon('spark')}本次學習建議 <span class="badge">${s.source==='ai'?'AI 個別建議':'規則建議 · 非 AI'}</span></div><div class="advice-grid"><div><span>做得好的地方</span><p>${esc(s.strength)}</p></div><div><span>需要留意</span><p>${esc(s.focus)}</p></div><div><span>下一步練習</span><p>${esc(s.nextStep)}</p></div></div>${s.recommended?.length?`<div class="advice-links">${s.recommended.map(q=>`<button class="text-button" data-qid="${q.id}">${q.kind==='advanced'?'進階':'相似'} · ${mathText(q.title)} ${icon('arrow')}</button>`).join('')}</div>`:''}<small class="field-hint">${esc(s.notice||'建議依目前作答產生，不代表完整能力診斷。')}</small></section>`;}
function bookmarkKey(){return `mathpath_bookmarks_${S.user?.id || 'guest'}`;}
function loadBookmarks(){try{bookmarks=new Set(JSON.parse(localStorage.getItem(bookmarkKey()) || '[]'));}catch{bookmarks=new Set();}}
function saveBookmarks(){try{localStorage.setItem(bookmarkKey(),JSON.stringify([...bookmarks]));}catch{toast('瀏覽器未允許儲存收藏設定。');}}
const FONT_SCALES=[['normal','標準'],['large','大'],['xlarge','特大']];
function fontScale(){try{const v=localStorage.getItem('mathpath_font_scale');return FONT_SCALES.some(([id])=>id===v)?v:'normal';}catch{return 'normal';}}
function applyFontScale(v){if(!FONT_SCALES.some(([id])=>id===v))v='normal';if(v==='normal')delete document.documentElement.dataset.fs;else document.documentElement.dataset.fs=v;try{localStorage.setItem('mathpath_font_scale',v);}catch{}}
function fontScaleControl(){const cur=fontScale();return `<div class="font-scale" role="group" aria-label="字體大小">${icon('text')}<span>字體</span>${FONT_SCALES.map(([id,label])=>`<button type="button" data-font-scale="${id}" class="${cur===id?'active':''}" aria-pressed="${cur===id}" title="字體${label}">${label}</button>`).join('')}</div><p class="font-scale-note">免登入即可調整，只影響這台裝置。</p>`;}
applyFontScale(fontScale());
// 版面配色：與字體一樣免登入即可切換，只影響這台裝置。
const THEMES=[['day','晨光'],['night','墨夜']];
function theme(){try{const v=localStorage.getItem('mathpath_theme');return THEMES.some(([id])=>id===v)?v:'day';}catch{return 'day';}}
function applyTheme(v){if(!THEMES.some(([id])=>id===v))v='day';if(v==='day')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=v;try{localStorage.setItem('mathpath_theme',v);}catch{}}
function themeControl(){const cur=theme();return `<div class="font-scale" role="group" aria-label="版面配色">${icon('image')}<span>版面</span>${THEMES.map(([id,label])=>`<button type="button" data-theme-id="${id}" class="${cur===id?'active':''}" aria-pressed="${cur===id}" title="版面${label}">${label}</button>`).join('')}</div><p class="font-scale-note">只影響這台裝置，隨時可切回。</p>`;}
applyTheme(theme());
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),4200);}
async function api(path,body){let r;try{r=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin'});}catch{throw new Error('無法連接網站伺服器，請確認服務已啟動。');}let data;try{data=await r.json();}catch{throw new Error(r.status===524?'AI 處理超過兩分鐘，已被網路層中斷。請縮短試卷、分批上傳，或稍後再試。':`伺服器回應無效（HTTP ${r.status}），請稍後再試；伺服器日誌會有實際原因。`);}if(!r.ok){if(r.status===401 && !path.includes('login') && !path.includes('change-password')){S.user=null;loginModal();}throw new Error(data.error || '操作未完成，請再試。');}serverIssue='';return data;}
async function refresh(){S=await api('/api/state');loadBookmarks();shell();}
function empty(title,desc,button=''){return `<div class="empty">${icon('bank')}<h3>${title}</h3><p>${desc}</p>${button}</div>`;}
// ── 新手上路：圖文並茂的快速指引 ──────────────────────────────────────
// 插圖全部是行內 SVG 線稿，跟著該步驟的色系走；不載入任何外部圖片，離線也能看。
function guideArt(kind){
  const A='var(--q-accent,#2f6d55)',S='var(--q-soft,#e8f2ec)',B='#c3d2c9',W='#fff',G='#e4ebe6';
  const card=(x,y,w,h,r=5)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${W}" stroke="${B}"/>`;
  const bar=(x,y,w,h=5,f=G)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h/2}" fill="${f}"/>`;
  const tick=(cx,cy,s=1,c=W)=>`<path d="M${cx-4*s} ${cy} l${3*s} ${3*s} l${7*s} ${-7*s}" fill="none" stroke="${c}" stroke-width="${2*s}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const pill=(x,y,w,h,f=A)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(h/2,6)}" fill="${f}"/>`;
  const arts={
    login:`${card(28,14,104,82)}${bar(40,28,34)}${bar(40,42,80,10)}${bar(40,58,80,10)}${pill(40,74,42,13)}${tick(61,80.5,0.8)}`,
    class:`${card(18,14,124,82)}${[44,80,116].map(x=>`<circle cx="${x}" cy="42" r="10" fill="${S}" stroke="${A}"/>`).join('')}${[44,80,116].map(x=>bar(x-14,58,28,5)).join('')}${bar(38,74,84,5)}`,
    assign:`${card(22,12,116,86)}${[0,1,2,3].map(i=>{const y=26+i*17;return `<rect x="36" y="${y}" width="12" height="12" rx="3" fill="${i===0?A:W}" stroke="${i===0?A:B}"/>${i===0?tick(42,y+6,0.75):''}${bar(56,y+3,64,5)}`;}).join('')}`,
    answer:`${card(20,12,120,86)}${[0,1,2].map(i=>`<path d="M28 ${22+i*24} h104" fill="none" stroke="#eaf0ec" stroke-width="1"/>`).join('')}<path d="M36 82 q16 -34 34 -24 q18 10 34 -22" fill="none" stroke="${A}" stroke-width="2.5" stroke-linecap="round"/><path d="M96 26 l12 -12 l10 10 l-12 12 z" fill="${S}" stroke="${A}"/>`,
    submit:`<rect x="30" y="38" width="100" height="32" rx="16" fill="${A}"/>${tick(80,54,1.5)}<circle cx="46" cy="54" r="6" fill="none" stroke="${W}" stroke-width="2"/>`,
    review:`<rect x="42" y="14" width="90" height="62" rx="6" fill="${W}" stroke="${B}"/><rect x="30" y="24" width="90" height="66" rx="6" fill="${W}" stroke="${A}"/><circle cx="112" cy="84" r="13" fill="${A}"/>${tick(112,84,1.2)}${bar(42,42,50,5)}${bar(42,56,62,5)}${bar(42,70,38,5)}`,
    results:`<path d="M30 88 h104" fill="none" stroke="${B}" stroke-width="1.5"/>${[[44,40],[66,26],[88,52],[110,32]].map(([x,h])=>`<rect x="${x-8}" y="${88-h}" width="16" height="${h}" rx="4" fill="${S}" stroke="${A}"/>`).join('')}`,
    import:`${card(16,20,54,70)}${[0,1,2,3].map(i=>bar(24,32+i*13,38,4)).join('')}<path d="M78 55 h18 m-6 -5 l6 5 l-6 5" fill="none" stroke="${A}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>${[0,1,2].map(i=>card(104,24+i*24,42,18,4)).join('')}`,
    mistakes:`${card(26,14,108,82)}<path d="M52 44 l16 16 m0 -16 l-16 16" fill="none" stroke="#c8807a" stroke-width="2.5" stroke-linecap="round"/>${bar(78,42,44,5)}${bar(78,56,32,5)}<path d="M46 86 a16 16 0 1 0 5 -13" fill="none" stroke="${A}" stroke-width="2" stroke-linecap="round"/><path d="M43 68 l3 8 l8 -3" fill="none" stroke="${A}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  };
  return `<svg viewBox="0 0 160 110" class="guide-svg" aria-hidden="true">${arts[kind]||arts.login}</svg>`;
}
const GUIDE_STEPS={
  teacher:[
    ['login','登入（選「教師」）','用教師帳號登入；第一次請先到「設定與隱私」更換密碼。'],
    ['class','建立班級與學生帳號','「設定與隱私」建立學生帳號，或用名單檔案一次匯入一整班。'],
    ['assign','佈置作業','「作業與成績」→ 佈置作業：先篩章節或搜尋，勾選題目、設定截止時間。'],
    ['review','批閱（可一路批到完）','學生提交後到「作答批閱」。存檔後自動跳下一題；有 AI 建議分可一鍵採用。'],
    ['results','看成績與建議','「作業與成績」→ 批閱與建議：逐題分數、學習建議、匯出成績 CSV。'],
    ['import','題庫三件常用的事','匯入試卷自動拆題、生成相似／進階題、AI 畫題目圖形（都可先核驗再入庫）。']
  ],
  student:[
    ['login','登入（選「學生」）','用學號與老師給的密碼登入。'],
    ['assign','打開「我的作業」','看到老師佈置的作業與截止時間，點進去開始作答。'],
    ['answer','寫下解題過程','可以手寫、打字，或上傳紙本照片；真的不會就按「本題不會」。'],
    ['submit','正式提交','每題都交代過才能提交；提交後不能再改。'],
    ['results','看回饋','老師批閱後才看得到分數、評語與參考答案。'],
    ['mistakes','錯題本再練一次','「我的錯題本」把錯過的題再練一次；「自主練習」可自選知識點。']
  ]
};
const GUIDE_TIPS=[
  ['clock','分數要等老師批閱','作業未批閱前不顯示分數，也不會當零分。'],
  ['spark','AI 只是建議','AI 建議分要老師覆核才算正式分；有疑問的題目會標「建議覆核」。'],
  ['help','不會就說不會','按「本題不會」老師會看到，不會自動記零分。']
];
let guideRole=null;
function guidePage(role){
  page='guide';shell();
  if(role)guideRole=role;
  // 預設看自己身分那一版；訪客看第一版（老師），跟分頁順序一致。
  if(!guideRole)guideRole=S.user?.role||'teacher';
  const isTeacher=guideRole==='teacher',steps=GUIDE_STEPS[guideRole];
  $('#main').innerHTML=`<div class="fade-in">${heading('GET STARTED','新手上路',
    isTeacher?'教師：五分鐘把一份作業發出去、批回來。':'學生：五分鐘交出一份作業，拿到回饋。')}
    <div class="guide-tabs" role="tablist">${[['teacher','我是老師'],['student','我是學生']].map(([id,t])=>
      `<button type="button" role="tab" data-guide-role="${id}" class="${guideRole===id?'active':''}" aria-selected="${guideRole===id}">${t}</button>`).join('')}</div>
    <section class="panel"><div class="guide-steps">${steps.map(([art,title,text],i)=>
      `<article class="guide-step"><div class="guide-art">${guideArt(art)}</div>
        <div class="guide-text"><span class="guide-num">${String(i+1).padStart(2,'0')}</span>
        <h3>${esc(title)}</h3><p>${esc(text)}</p></div></article>`).join('')}</div></section>
    <section class="panel"><div class="panel-heading"><h2>${icon('bulb')}三個要知道的事</h2></div>
      <div class="guide-tip-row">${GUIDE_TIPS.map(([ic,title,text])=>
        `<div class="guide-tip">${icon(ic)}<strong>${esc(title)}</strong><p>${esc(text)}</p></div>`).join('')}</div></section>
    ${S.user?'':`<div class="import-warning">你現在是訪客預覽。<button class="primary" data-action="login" style="margin-left:8px">登入開始使用 ${icon('arrow')}</button></div>`}
    </div>`;
  $$('[data-guide-role]').forEach(b=>b.onclick=()=>guidePage(b.dataset.guideRole));
}

function shell(){let nav=[['guide','新手上路'],['homework',S.user?.role==='teacher'?'作業與成績':'我的作業'],['calendar','日曆'],['mock','模擬測驗'],['bank','數學題庫'],['practice','自主練習'],['import','試卷拆題'],['mistakes',S.user?.role==='teacher'?'作答批閱':'我的錯題本'],['growth','學習足跡']];if(S.user?.role!=='student')nav=nav.filter(([id])=>id!=='mock');if(S.user?.role==='teacher'){nav=nav.filter(([id])=>id!=='practice');const at=nav.findIndex(([id])=>id==='mistakes');nav.splice(at<0?nav.length:at,0,['newq','新增題目']);nav.push(['ai','模型端點']);}$('#nav').innerHTML=nav.map(([id,label])=>`<button class="nav-item ${page===id?'active':''}" data-page="${id}">${icon(id)}<span>${label}</span>${id==='bank'?`<span class="count">${S.user?S.questions.length:'示例'}</span>`:id==='import'?'<span class="new">教師</span>':''}</button>`).join('');$('#settings-nav').innerHTML=icon('settings')+'<span>設定與隱私</span>';$('#settings-nav').classList.toggle('active',page==='settings');$('#font-scale').innerHTML=fontScaleControl();$('#theme-switch').innerHTML=themeControl();$('#account').innerHTML=`<span class="avatar">${S.user?(S.user.role==='teacher'?'師':'學'):'M'}</span><span class="account-info">${S.user?esc(S.user.name):'訪客預覽'}<small>${S.user?(S.user.role==='teacher'?'教師工作空間':'中三數學學習者'):'登入後開始學習'}</small></span>${icon(S.user?'chevron':'logout')}`;$('#avatar').textContent=S.user?(S.user.role==='teacher'?'師':'學'):'M';const labels={guide:'新手上路',homework:S.user?.role==='teacher'?'作業與成績':'我的作業',calendar:'日曆',mock:'模擬測驗',ai:'模型端點',bank:'數學題庫',practice:'自主練習',import:'試卷拆題',mistakes:S.user?.role==='teacher'?'作答批閱':'我的錯題本',growth:'學習足跡',newq:'新增題目',settings:'設定與隱私'};$('#crumb').textContent=labels[page] || '數學題庫';renderCalculator();}

let calCursor=null,calSelected=null;
const calPad=n=>String(n).padStart(2,'0');
const calFmt=d=>`${d.getFullYear()}-${calPad(d.getMonth()+1)}-${calPad(d.getDate())}`;
async function calendarPage(){if(!S.user)return loginModal(calendarPage);page='calendar';shell();
const now=new Date();if(!calCursor)calCursor=new Date(now.getFullYear(),now.getMonth(),1);
const y=calCursor.getFullYear(),m=calCursor.getMonth(),first=new Date(y,m,1),last=new Date(y,m+1,0);
let events=[],notes=[],error='';
try{const r=await api(`/api/calendar?from=${calFmt(first)}&to=${calFmt(last)}`);events=r.events||[];notes=r.notes||[];}catch(e){error=e.message;}
const byDate={};events.forEach(ev=>{(byDate[ev.date]=byDate[ev.date]||[]).push(ev);});
const notesByDate={};notes.forEach(n=>{(notesByDate[n.date]=notesByDate[n.date]||[]).push(n);});
const isTeacher=S.user.role==='teacher',teacher=isTeacher;
const kindName=k=>k==='quiz'?'測驗':'作業';
const cells=[];for(let i=0;i<first.getDay();i++)cells.push(null);for(let d=1;d<=last.getDate();d++)cells.push(d);
const monthPrefix=`${y}-${calPad(m+1)}`;
if(!calSelected||!calSelected.startsWith(monthPrefix))calSelected=calPad(now.getFullYear()===y&&now.getMonth()===m?now.getDate():1).length?`${monthPrefix}-${calPad(now.getFullYear()===y&&now.getMonth()===m?now.getDate():1)}`:`${monthPrefix}-01`;
const todayStr=calFmt(now);
const grid=cells.map(d=>{if(d===null)return '<div class="cal-cell empty"></div>';const date=`${monthPrefix}-${calPad(d)}`,list=byDate[date]||[],noteList=notesByDate[date]||[];
const hwPub=list.filter(e=>e.kind!=='quiz'&&e.event!=='due'),hwDue=list.filter(e=>e.kind!=='quiz'&&e.event==='due');
const qzPub=list.filter(e=>e.kind==='quiz'&&e.event!=='due'),qzDue=list.filter(e=>e.kind==='quiz'&&e.event==='due');
// 同一份作業會有「發布」與「截止」兩筆事件：標記要分開講清楚是哪一種，
// 並依作業編號去重（同一天既發布又截止只算一項），
// 否則日曆看起來就像把同一份作業重複列在好幾天。
const countIds=arr=>new Set(arr.map(e=>e.assignmentId)).size;
const marks=[];
if(hwPub.length)marks.push(`<span class="cal-mark hw">${countIds(hwPub)} 項作業</span>`);
if(hwDue.length)marks.push(`<span class="cal-mark due">${countIds(hwDue)} 項作業截止</span>`);
if(qzPub.length)marks.push(`<span class="cal-mark quiz">${countIds(qzPub)} 項測驗</span>`);
if(qzDue.length)marks.push(`<span class="cal-mark due">${countIds(qzDue)} 項測驗截止</span>`);
if(noteList.length)marks.push(`<span class="cal-mark note">${noteList.length} 則提醒</span>`);
return `<button class="cal-cell${date===todayStr?' today':''}${date===calSelected?' selected':''}" data-cal-date="${date}"><span class="cal-day">${d}</span><span class="cal-marks">${marks.join('')}</span></button>`;}).join('');
const selEvents=byDate[calSelected]||[];
// 「本月作業／本月測驗」算的是幾份作業，不是幾筆事件：同一份作業的「發布」與「截止」
// 是兩筆事件，直接拿事件數當作業數會把一份作業算成兩份
// （事件數由第 4 張卡「本月事件 · 發布與截止分別計算」負責）。
const hwIds=new Set(events.filter(e=>e.kind!=='quiz').map(e=>e.assignmentId));
const qzIds=new Set(events.filter(e=>e.kind==='quiz').map(e=>e.assignmentId));
const totalHw=hwIds.size,totalQz=qzIds.size;
const selNotes=notesByDate[calSelected]||[];
const detail=selEvents.length?selEvents.map(ev=>`<div class="cal-event ${ev.kind==='quiz'?'quiz':'hw'}"><span class="cal-event-tag">${kindName(ev.kind)}</span><div><strong>${esc(ev.title)}</strong><small>${ev.event==='due'?'截止':'發布'} · ${esc(ev.className)}${ev.event==='due'?` · ${dateText(ev.dueAt)}`:''}${ev.myStatus?` · ${statusText(ev.myStatus)}`:''}${ev.studentCount!=null?` · 已交 ${ev.submittedCount} / ${ev.studentCount} 人`:''}</small></div>${ev.assignmentId?`<button class="text-button" data-cal-open="${ev.assignmentId}">開啟 ${icon('arrow')}</button>`:''}</div>`).join(''):'<p class="field-hint">這一天沒有作業或測驗。</p>';
$('#main').innerHTML=`<div class="fade-in">${heading('SCHEDULE','日曆','一眼看清每日的作業與測驗；有標記的日子表示當天有發布或截止。')}
<div class="metric-row">${[['check','本月作業',totalHw,'項',teacher?'你發布的作業':'你的班級作業'],['target','本月測驗',totalQz,'項',teacher?'你發布的測驗':'你的班級測驗'],['clock','本月事件',events.length,'項','發布與截止分別計算'],['spark','本月提醒',notes.length,'則','只有你看得到']].map(([ic,label,value,unit,foot])=>`<div class="metric"><div class="metric-icon">${icon(ic)}</div><div><span class="metric-label">${label}</span><strong class="metric-value">${value}<small>${unit}</small></strong><span class="metric-foot">${foot}</span></div></div>`).join('')}</div>
<section class="panel panel-pad"><div class="cal-head"><button class="secondary" id="cal-prev">‹ 上月</button><strong class="cal-title">${y} 年 ${m+1} 月</strong><button class="secondary" id="cal-next">下月 ›</button><button class="text-button" id="cal-today">回到本月</button></div>
${error?`<div class="inline-error">${esc(error)}</div>`:''}
<div class="cal-weekdays">${['日','一','二','三','四','五','六'].map(d=>`<span>${d}</span>`).join('')}</div>
<div class="cal-grid">${grid}</div></section>
<section class="panel panel-pad" style="margin-top:20px"><h2>${icon('file')}${esc(calSelected)}</h2>${detail}<div class="divider-text"><span>提醒事項</span></div>${selNotes.length?selNotes.map(n=>`<div class="cal-note"><span class="cal-event-tag note">提醒</span><div><strong>${esc(n.title)}</strong>${n.note?`<p class="field-hint">${esc(n.note)}</p>`:''}</div><button class="icon-btn" data-note-del="${n.id}" title="刪除提醒" aria-label="刪除提醒">${icon('trash')}</button></div>`).join(''):'<p class="field-hint">這一天還沒有提醒事項。</p>'}<form id="note-form" style="margin-top:14px"><div class="form-grid"><div class="form-field"><label class="field-label" for="note-title">新增提醒標題</label><input id="note-title" maxlength="120" placeholder="例如：收齊作業、教研會議" required></div><div class="form-field"><label class="field-label" for="note-body">內容（可留空）</label><input id="note-body" maxlength="2000" placeholder="例如：下午三點前完成"></div></div><p class="field-hint">提醒事項只會出現在你自己的日曆，不會顯示給學生或其他教師。</p><p class="error-text" id="note-error"></p><button class="secondary" type="submit">${icon('check')}加入 ${esc(calSelected)} 的提醒</button></form></section></div>`;
$('#cal-prev').onclick=()=>{calCursor=new Date(y,m-1,1);calendarPage();};
$('#cal-next').onclick=()=>{calCursor=new Date(y,m+1,1);calendarPage();};
$('#cal-today').onclick=()=>{calCursor=new Date(now.getFullYear(),now.getMonth(),1);calSelected=calFmt(now);calendarPage();};
$$('[data-cal-date]').forEach(b=>b.onclick=()=>{calSelected=b.dataset.calDate;calendarPage();});
$$('[data-cal-open]').forEach(b=>b.onclick=()=>navigate('homework'));
$$('[data-note-del]').forEach(b=>b.onclick=async()=>{if(!confirm('刪除這則提醒？'))return;try{await api(`/api/calendar/notes/${b.dataset.noteDel}/delete`,{});toast('提醒已刪除。');calendarPage();}catch(e){toast(e.message);}});
const nf=$('#note-form');
if(nf)nf.onsubmit=async e=>{e.preventDefault();const b=$('button[type=submit]',e.target);b.disabled=true;$('#note-error').textContent='';
try{await api('/api/calendar/notes',{date:calSelected,title:$('#note-title').value.trim(),note:$('#note-body').value.trim()});toast('提醒已加入。');calendarPage();}
catch(err){$('#note-error').textContent=err.message;b.disabled=false;}};
window.scrollTo({top:0});}
function heading(eyebrow,title,sub,actions=''){return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtitle">${sub}</p></div>${actions?`<div class="actions">${actions}</div>`:''}</div>`;}
function metrics(){const s=S.stats, items=[['check','已完成練習',s.completed,'題',S.user?'以已批閱作答計算':'登入後記錄你的每次進步'],['target','練習得分率',s.completed?s.accuracy:'—',s.completed?'%':'','依批閱分數計算 · 非掌握率'],['flame','連續練習',s.streak,'天','每天一小步，理解更深入'],['clock','學習時長估算',s.minutes,'分鐘','依同日提交間隔估算']];return `<div class="metric-row">${items.map(([ic,label,value,unit,foot])=>`<div class="metric"><div class="metric-label">${icon(ic)}${label}</div><div class="metric-value">${value}<small>${unit}</small></div><div class="metric-foot">${foot}</div><div class="metric-spark">${[8,13,11,18,15,22].map(h=>`<i style="height:${h}px"></i>`).join('')}</div></div>`).join('')}</div>`;}
function hero(){return `<section class="hero"><div class="hero-copy"><div class="hero-eyebrow">${icon('spark')} EVERY STEP COUNTS</div><h2>讓每一步思考，都成為進步。</h2><p>從理解一道題，到掌握一類題。找到屬於你的數學學習路徑。</p>${S.user?.role==='teacher'?`<button class="text-button" data-page="import">匯入試卷，建立校本題庫 ${icon('arrow')}</button>`:`<button class="text-button" data-action="start">開始今日練習 ${icon('arrow')}</button>`}</div><div class="hero-visual" aria-hidden="true"><span class="formula f1">x² − 5x + 6 = 0</span><span class="formula f2">a² + b² = c²</span><svg viewBox="0 0 300 170"><ellipse cx="158" cy="148" rx="94" ry="9" fill="#dce7d2" opacity=".5"/><path d="m75 112 69-19 75 29-70 25Z" fill="#d0dfbe"/><path d="m75 112 74 28v7l-74-28Z" fill="#b4caa4"/><path d="m149 140 70-18v7l-70 18Z" fill="#e4ecd6"/><path d="m84 98 69-18 74 28-69 23Z" fill="#f5f7ec"/><path d="m84 98 74 26v7L84 105Z" fill="#dfe8cd"/><path d="m158 124 69-16v7l-69 16Z" fill="#c6d7b3"/><path d="m85 78 70-20 76 28-70 26Z" fill="#b2cda5"/><path d="m85 78 76 29v5L85 85Z" fill="#8fac88"/><path d="m161 107 70-21v5l-70 21Z" fill="#dce8c8"/><path d="m149 45 52 19-23 52-49-20Z" fill="#fffdf3" stroke="#d6dfc6"/><path d="m138 71 30 11m-34 1 24 9m-20-28 15 5" stroke="#c4d1b8" stroke-width="2"/><path d="m189 35 9 3-24 61-9-3Z" fill="#779c76"/><path d="m165 96 9 3-9 8Z" fill="#e3c7a0"/><path d="m166 104-2 4 4-2" stroke="#557158"/><circle cx="244" cy="44" r="15" fill="#e6edd7"/><path d="M236 44h16m-8-8v16" stroke="#a2b28e"/><path d="m43 78 6-6 6 6-6 6Z" fill="#c9d7b7"/><circle cx="251" cy="124" r="4" fill="#b8c6a3"/><path d="m101 31 3-6 3 6 6 3-6 3-3 6-3-6-6-3Z" fill="#ccd9b8"/></svg></div></section>`;}
function topicStats(t){const a=S.attempts.filter(a=>a.topic===t && a.status==='graded');const max=a.reduce((n,a)=>n+a.maxScore,0);return {n:a.length,value:max?Math.round(100*a.reduce((n,a)=>n+a.score,0)/max):0};}
function knowledge(){return `<section class="panel right-panel"><h2>${icon('growth')}知識點練習表現</h2><p class="panel-sub">以已批閱得分呈現，不等同能力診斷</p>${(()=>{const practiced=topics.map(t=>({t,st:topicStats(t)})).filter(x=>x.st.n>0).sort((a,b)=>a.st.value-b.st.value).slice(0,4);if(!practiced.length)return `<p class="panel-sub" style="margin:0">還沒有已批閱的練習，先做幾題就會顯示你的知識點表現。</p>`;return practiced.map(({t,st})=>`<div class="knowledge-row"><span>${esc(t)}</span><span>${st.value}%</span></div><div class="progress-track"><div class="progress-fill ${st.value<60?'gold':''}" style="width:${st.value}%"></div></div>`).join('');})()}<button class="text-button" data-page="growth" style="font-size:calc(13px*var(--fs))">查看完整學習足跡 ${icon('arrow')}</button></section>`;}
function rightBank(){return `<div class="right-stack"><section class="panel right-panel"><h2>${icon('spark')}你的下一步</h2><p class="panel-sub">圍繞同一知識點，循序建立解題能力</p><div class="roadmap"><div class="roadmap-item active"><span class="roadmap-circle">1</span>理解原題</div><div class="roadmap-item"><span class="roadmap-circle">2</span>相似鞏固</div><div class="roadmap-item"><span class="roadmap-circle">3</span>進階挑戰</div></div><div class="recommendation-mini"><div class="title-row"><span>今日建議</span><span>基礎 · 6 分</span></div><strong>從因式分解開始，<br>一步一步找出二次方程的根。</strong><button class="secondary wide" data-qid="1">進入練習 ${icon('arrow')}</button></div></section>${knowledge()}<section class="panel right-panel tip-panel"><h2>${icon('bulb')}解題小提示</h2><p>寫下你的思考，而不只是答案。<br>一個清楚的推導，比一次猜對更有價值。</p><button class="text-button" data-action="hand-demo">試試手寫解題 ${icon('arrow')}</button></section></div>`;}
function filteredQuestions(){return S.questions.filter(q=>(topic==='全部題目'||q.topic===topic||topic==='我的收藏'&&bookmarks.has(q.id))&&(!subtopic||q.subtopic===subtopic)&&(!grade||q.grade===grade)&&(!level||q.level===Number(level))&&(!qtype||(q.qtype||'解答題')===qtype)&&(!search||`${q.title} ${q.content} ${q.tags.join(' ')} ${q.source} ${q.subtopic||''}`.toLowerCase().includes(search.toLowerCase())));}
// 題面與圖形並排：題目文字在左、該題圖形在右。沒有圖形時只輸出題面，不留下空的區塊。
function stemHtml(q,opts={}){
  const text=`<div class="${opts.className||'question-formula'}">${mathText(q.content||'')}</div>${opts.options===false?'':optionsHtml(q)}`;
  if(!q.figure)return text;
  return `<div class="question-stem"><div class="question-stem-text">${text}</div><figure class="question-figure"><img src="${q.figure}" alt="題目圖形" loading="lazy" data-zoom></figure></div>`;
}
// 點一下題目圖形可放大檢視（幾何圖的標註常需要看清楚），按一下或按 Esc 關閉。
document.addEventListener('click',e=>{
  const img=e.target&&e.target.closest?e.target.closest('img[data-zoom]'):null;
  if(!img||document.querySelector('.figure-zoom'))return;
  const box=document.createElement('div');
  box.className='figure-zoom';box.setAttribute('role','dialog');box.setAttribute('aria-label','放大檢視題目圖形');
  const big=document.createElement('img');big.src=img.src;big.alt='題目圖形（放大）';
  const hint=document.createElement('span');hint.className='figure-zoom-hint';hint.textContent='按一下或按 Esc 關閉';
  box.append(big,hint);
  const close=()=>{box.remove();document.removeEventListener('keydown',onKey);};
  const onKey=ev=>{if(ev.key==='Escape')close();};
  box.onclick=close;
  document.addEventListener('keydown',onKey);
  document.body.appendChild(box);
});
function questionCard(q,n){return `<article class="question-card"><span class="question-number">${String(n).padStart(2,'0')}</span><div class="question-body"><div class="question-top"><h3>${mathText(q.title)}</h3><span class="badge l${q.level}">${levels[q.level]}</span><span class="badge outline">${esc(q.qtype||'解答題')}</span><span class="badge outline">${q.points} 分</span></div>${stemHtml(q)}<div class="question-meta"><span>${esc(q.tags.slice(0,2).join(' · '))}</span><i class="separator"></i><span>${esc(q.source)}</span></div></div><div class="question-controls"><button class="bookmark ${bookmarks.has(q.id)?'saved':''}" data-save="${q.id}" aria-label="${bookmarks.has(q.id)?'取消收藏':'收藏題目'}" aria-pressed="${bookmarks.has(q.id)}">${icon('bookmark')}</button><button class="practice-btn" data-qid="${q.id}">${S.user?.role==='teacher'?'檢視題目':'開始練習'} ${icon('chevron')}</button>${S.user?.role==='teacher'?`<button class="text-button" data-editq="${q.id}" style="font-size:calc(12px*var(--fs))">${icon('edit')}編輯題目</button><button class="text-button ai-gen-entry" data-aigen="${q.id}" style="font-size:calc(12px*var(--fs))">${icon('spark')}AI 生成類似題</button><button class="text-button" data-aifig="${q.id}" style="font-size:calc(12px*var(--fs))">${icon('spark')}${q.figure?'重新生成圖形':'AI 生成圖形'}</button><button class="text-button" data-aifig-manual="${q.id}" style="font-size:calc(12px*var(--fs))">${icon('upload')}手動插入圖形</button>${q.figure?`<button class="text-button" data-aifig-clear="${q.id}" style="font-size:calc(12px*var(--fs))">移除圖形</button>`:''}`:''}</div></article>`;}
function bank(){beginView();page='bank';assignmentContext=null;mockContext=null;stopQuizClock();shell();$('#main').innerHTML=`<div class="fade-in">${heading('QUESTION BANK','數學題庫','每一道題，都是通往理解的一步。',`<button class="secondary" data-action="collection">${icon('bookmark')}我的收藏</button>${S.user?.role==='teacher'?`<button class="secondary" data-page="newq">${icon('plus')}新增題目</button><button class="secondary" id="export-latex">${icon('file')}匯出 LaTeX</button>`:''}<button class="primary" data-page="import">${icon('upload')}匯入試卷</button>`)}${!S.user?`<div class="field-hint" style="margin:-9px 0 17px">訪客預覽 · 以下為題庫示例，學習紀錄尚未開始。<button class="text-button" data-action="login" style="font-size:calc(13px*var(--fs));margin-left:8px">登入學習 ${icon('arrow')}</button></div>`:''}${hero()}${metrics()}<div class="bank-layout"><section class="panel bank-panel"><div class="panel-heading"><h2>精選題目 <span class="small-text" id="question-count"></span></h2><div class="segmented"><button data-view="list" class="${viewMode==='list'?'active':''}" aria-label="清單檢視">${icon('list')}</button><button data-view="grid" class="${viewMode==='grid'?'active':''}" aria-label="卡片檢視">${icon('bank')}</button></div></div><div class="filters"><label class="search-field">${icon('search')}<input id="question-search" value="${esc(search)}" placeholder="搜尋題目、知識點或試卷名稱…" aria-label="搜尋题目"></label><select id="grade-filter" aria-label="年級"><option value="">所有年級</option>${grades.map(g=>`<option ${grade===g?'selected':''}>${g}</option>`).join('')}</select><select id="level-filter" aria-label="難度"><option value="">所有難度</option>${[1,2,3].map(i=>`<option value="${i}" ${Number(level)===i?'selected':''}>${levels[i]}</option>`).join('')}</select><select id="qtype-filter" aria-label="題型"><option value="">所有題型</option>${qtypes.map(t=>`<option ${qtype===t?'selected':''}>${t}</option>`).join('')}</select></div><div class="topic-tabs">${['全部題目',...topics].map(t=>`<button class="topic-tab ${topic===t?'active':''}" data-topic="${t}">${t}</button>`).join('')}</div><div class="topic-tabs subtopic-tabs" style="display:${topic!=='全部題目'&&topic!=='我的收藏'&&subtopicsOf(topic).length?'flex':'none'}">${['全部子分類',...subtopicsOf(topic)].map(sb=>`<button class="subtopic-tab ${subtopic===sb?'active':''}" data-subtopic="${sb}">${sb}</button>`).join('')}</div><div class="question-list ${viewMode}" id="question-list"></div><div class="pagination" id="pagination"></div></section>${rightBank()}</div></div>`;renderList();$('#question-search').addEventListener('input',e=>{search=e.target.value;currentPage=1;renderList();});$('#grade-filter').addEventListener('change',e=>{grade=e.target.value;currentPage=1;renderList();});$('#level-filter').addEventListener('change',e=>{level=e.target.value;currentPage=1;renderList();});$('#qtype-filter').addEventListener('change',e=>{qtype=e.target.value;currentPage=1;renderList();});const lb=$('#export-latex');if(lb)lb.onclick=exportLatexDialog;}
// ── 匯出 LaTeX（XeLaTeX 可編譯）──
// 後端只回傳 .tex 文字；圖形由瀏覽器轉成 PNG（XeLaTeX 不支援 WebP），再用最小 ZIP 打包下載。
const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=CRC_TABLE[(c^b)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}
const u16=n=>[n&0xff,(n>>>8)&0xff];
const u32=n=>[n&0xff,(n>>>8)&0xff,(n>>>16)&0xff,(n>>>24)&0xff];
function zipStore(files){
  const enc=new TextEncoder(),chunks=[],central=[];let offset=0;
  for(const f of files){
    const name=enc.encode(f.name),data=f.bytes,crc=crc32(data);
    const head=new Uint8Array([0x50,0x4b,3,4,20,0,0,0,0,0,0,0,0,0,...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),0,0]);
    chunks.push(head,name,data);
    // 中央目錄每一筆後面必須緊接檔名，否則解壓工具會報「Truncated central directory」。
    central.push(new Uint8Array([0x50,0x4b,1,2,20,0,20,0,0,0,0,0,0,0,0,0,...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),0,0,0,0,0,0,0,0,0,0,0,0,...u32(offset)]),name);
    offset+=head.length+name.length+data.length;
  }
  const cdSize=central.reduce((n,b)=>n+b.length,0);
  const eocd=new Uint8Array([0x50,0x4b,5,6,0,0,0,0,...u16(files.length),...u16(files.length),...u32(cdSize),...u32(offset),0,0]);
  return new Blob([...chunks,...central,eocd],{type:'application/zip'});
}
function figurePngBlob(url){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onerror=()=>reject(new Error('圖形載入失敗'));
    img.onload=()=>{
      const c=document.createElement('canvas');
      c.width=Math.max(1,img.naturalWidth);c.height=Math.max(1,img.naturalHeight);
      const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0);
      c.toBlob(b=>b?resolve(b):reject(new Error('圖形轉換失敗')),'image/png');
    };
    img.src=url;
  });
}
function exportLatexDialog(){
  if(S.user?.role!=='teacher')return toast('只有教師可以匯出題庫。');
  const filtered=filteredQuestions();
  if(!filtered.length)return toast('目前沒有可匯出的題目。');
  modal(`<p class="eyebrow">EXPORT</p><h2>匯出 LaTeX（XeLaTeX 可編譯）</h2>
  <p class="modal-intro">會下載一個 zip：<code>questions.tex</code> 加 <code>figures/</code> 內的題目圖形。解壓後執行 <code>xelatex questions.tex</code> 即可編譯；數學式原樣保留，圖形自動轉成 PNG。</p>
  <form id="latex-form"><div class="form-field"><label class="field-label" for="latex-scope">匯出範圍</label><select id="latex-scope"><option value="filtered">目前篩選（${filtered.length} 題）</option><option value="all">全部題庫（${S.questions.length} 題）</option></select></div>
  <div class="form-field"><label class="field-label" for="latex-title">文件標題</label><input id="latex-title" maxlength="120" value="${esc(topic==='全部題目'?'MathPath 題庫匯出':topic)}"></div>
  <label class="checkbox-line"><input type="checkbox" id="latex-answers" checked>包含參考答案、詳解與評分標準（教師版；取消則只輸出題目卷）</label>
  <p class="field-hint">一次最多 200 題；超過請分批匯出。圖形以 PNG 附上，請保持 <code>figures/</code> 與 <code>.tex</code> 同一個資料夾。</p>
  <p class="error-text" id="latex-error"></p><button class="primary wide" type="submit">開始匯出 ${icon('arrow')}</button></form>`);
  $('#latex-form').onsubmit=async e=>{
    e.preventDefault();
    const btn=$('#latex-form button[type=submit]');btn.disabled=true;btn.textContent='正在準備…';
    const title=$('#latex-title').value.trim()||'MathPath 題庫匯出';
    try{
      const ids=(($('#latex-scope').value==='all')?S.questions:filtered).map(q=>q.id).slice(0,200);
      const r=await api('/api/questions/latex',{questionIds:ids,includeAnswers:$('#latex-answers').checked,title});
      const enc=new TextEncoder();
      const files=[{name:'questions.tex',bytes:enc.encode(r.tex)}];
      let done=0;
      for(const fig of r.figures){
        done+=1;btn.textContent=`正在轉換圖形 ${done}/${r.figures.length}…`;
        try{files.push({name:fig.path,bytes:new Uint8Array(await (await figurePngBlob(fig.url)).arrayBuffer())});}
        catch{files.push({name:fig.path.replace(/\.png$/,'.MISSING.txt'),bytes:enc.encode('這個圖形無法轉成 PNG（可能是舊的 WebP 圖或已被刪除）；請在題庫重新上傳圖片後再匯出。')});}
      }
      const url=URL.createObjectURL(zipStore(files));
      const a=document.createElement('a');
      a.href=url;a.download=`${title.replace(/[\\/:*?"<>|]/g,'_')}.zip`;
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),4000);
      closeModal();
      toast(`已匯出 ${r.count} 題；解壓後執行 xelatex questions.tex。`);
    }catch(err){$('#latex-error').textContent=err.message;btn.disabled=false;btn.innerHTML='開始匯出';}
  };
}
function renderList(){const list=filteredQuestions(),size=5,total=Math.ceil(list.length/size);currentPage=Math.max(1,Math.min(currentPage,total||1));$('#question-count').textContent=`${list.length} 題${topic==='我的收藏'?' · 我的收藏':''}`;$('#question-list').innerHTML=list.length?list.slice((currentPage-1)*size,currentPage*size).map((q,i)=>questionCard(q,(currentPage-1)*size+i+1)).join(''):empty('還沒有符合的題目','試試更換分類、難度或搜尋關鍵字。');$('#pagination').innerHTML=`<span>顯示 ${list.length?(currentPage-1)*size+1:0}–${Math.min(currentPage*size,list.length)} / 共 ${list.length} 題</span><div class="pagination-buttons"><button data-pagination="${currentPage-1}" ${currentPage<=1?'disabled':''} aria-label="上一頁">‹</button>${Array.from({length:Math.min(total,7)},(_,i)=>`<button data-pagination="${i+1}" class="${currentPage===i+1?'active':''}">${i+1}</button>`).join('')}<button data-pagination="${currentPage+1}" ${currentPage>=total?'disabled':''} aria-label="下一頁">›</button></div>`;}
function requireLogin(fn){if(S.user){fn();return true;}loginModal(fn);return false;}
let modalReturnFocus=null, modalSeq=0;
function modal(html,large=false,dismiss=true){
  if(!$('.modal'))modalReturnFocus=document.activeElement;
  const titleId=`modal-title-${++modalSeq}`;
  $('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal ${large?'large':''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1">${dismiss?`<button class="icon-btn modal-close" data-action="close-modal" aria-label="關閉">×</button>`:''}${html}</section></div>`;
  const dialog=$('.modal'),title=$('h2',dialog);
  if(title){title.id=titleId;title.tabIndex=-1;title.focus();}else{dialog.removeAttribute('aria-labelledby');dialog.setAttribute('aria-label','操作視窗');dialog.focus();}
  $('#modal-root').onkeydown=e=>{
    if(e.key==='Escape'&&dismiss){e.preventDefault();closeReviewAware();return;}
    if(e.key!=='Tab')return;
    const focusable=$$('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],summary,[tabindex]:not([tabindex="-1"])',dialog).filter(el=>!el.hidden&&el.getClientRects().length&&el.tabIndex>=0);
    if(!focusable.length){e.preventDefault();dialog.focus();return;}
    const first=focusable[0],last=focusable.at(-1),active=document.activeElement;
    if(e.shiftKey&&(active===first||!focusable.includes(active))){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&(active===last||!focusable.includes(active))){e.preventDefault();first.focus();}
  };
}
let reviewReturn=null,reviewDirty=false;
// 關閉批閱視窗：如果剛剛存過分數，順便把上一層（成績表／批閱清單）重抓一次。
function closeReviewAware(){const go=reviewDirty?reviewReturn:null;reviewDirty=false;reviewReturn=null;closeModal();if(go)go();}
function closeModal(){const prev=modalReturnFocus;modalReturnFocus=null;figStudio=null;$('#modal-root').innerHTML='';$('#modal-root').onkeydown=null;if(prev?.isConnected)prev.focus();else $('#main').focus();}
function demoAccountsHtml(){
  if(serverDemo===true)return `<div class="demo-accounts" id="login-demo-note">本地演示帳戶<br>學生：student / Math1234!<br>教師：teacher / Teach1234!<br>校內正式使用前，請先更換演示密碼。</div>`;
  if(serverDemo===false)return `<div class="demo-accounts" id="login-demo-note">此站已更換演示密碼。<br>帳戶與密碼由學校提供，忘記密碼請聯絡老師。</div>`;
  return `<div class="demo-accounts" id="login-demo-note">正在確認帳戶狀態…</div>`;
}
async function loadServerDemo(){
  try{const info=await api('/api/health');
    if(info&&info.status==='ok'){serverDemo=info.demoAccounts===true;
      const box=$('#login-demo-note');if(box)box.outerHTML=demoAccountsHtml();}
  }catch(_){}                      // 讀不到就維持「尚未確認」，不顯示任何帳密
}
function loginModal(after){const lastUser=(()=>{try{return localStorage.getItem('mathpath_last_user')||''}catch(_){return ''}})();modal(`<div class="login-brand"><span class="brand-symbol">m<span>↗</span></span>MathPath</div><h2>登入學習空間</h2><p class="modal-intro">先選擇身分，再輸入密碼。系統會記住你的帳戶，下次開啟不必重新輸入。</p><div class="role-cards"><button type="button" data-role="student" class="role-card active"><span class="role-card-icon">${icon('practice')}</span><strong>學生</strong><small>領取作業、手寫或打字解題、查看自己的分數與建議</small></button><button type="button" data-role="teacher" class="role-card"><span class="role-card-icon">${icon('import')}</span><strong>教師</strong><small>佈置作業與測驗、批閱、查看全班成績</small></button></div><form id="login-form"><div class="form-field"><label class="field-label" for="username">校內帳戶</label><input id="username" name="username" autocomplete="username" value="${esc(lastUser||'student')}" required maxlength="64">${lastUser?`<p class="field-hint login-remembered">已記住上次登入的帳戶：<strong>${esc(lastUser)}</strong></p>`:''}</div><div class="form-field"><label class="field-label" for="password">密碼</label><input id="password" type="password" name="password" autocomplete="current-password" placeholder="輸入帳戶密碼" required maxlength="256"></div><label class="checkbox-line remember-line login-remember"><input type="checkbox" id="remember" checked><span><strong>記住我（30 天）</strong><small>下次開啟不必重新登入；公用電腦請取消勾選。</small></span></label><p class="error-text" id="login-error"></p><button type="submit" class="primary wide login-submit">登入學習空間 ${icon('arrow')}</button></form>${demoAccountsHtml()}`);if(serverDemo===null)loadServerDemo();$$('[data-role]').forEach(b=>b.onclick=()=>{$$('[data-role]').forEach(x=>x.classList.toggle('active',x===b));$('#username').value=b.dataset.role;$('#password').value='';$('#password').focus();});$$('[data-role]').forEach(x=>x.classList.toggle('active',x.dataset.role===(lastUser==='teacher'?'teacher':'student')));$('#login-form').onsubmit=async e=>{e.preventDefault();const btn=$('button[type="submit"]',e.target);btn.disabled=true;$('#login-error').textContent='';const uname=$('#username').value;try{await api('/api/login',{username:uname,password:$('#password').value,remember:$('#remember').checked});try{localStorage.setItem('mathpath_last_user',uname);}catch(_){}await refresh();closeModal();toast('已登入，學習紀錄已準備就緒。');if(after)after();else navigate(page);}catch(err){$('#login-error').textContent=err.message;}finally{btn.disabled=false;}};if(serverIssue){const box=$('#login-error');if(box)box.textContent=serverIssue;}}
function accountModal(){if(!S.user)return loginModal();modal(`<h2>${esc(S.user.name)}</h2><p class="modal-intro">${S.user.role==='teacher'?'教師工作空間':'中三數學學習空間'} · 資料保存在網站伺服器；實際位置由管理員確認</p>${S.notice?`<div class="import-warning">${esc(S.notice)}</div>`:''}<div class="result-actions"><button class="secondary" id="password-link">${icon('lock')}更換密碼</button><button class="secondary" id="logout-btn">${icon('logout')}登出</button></div>`);$('#password-link').onclick=()=>{closeModal();navigate('settings');};$('#logout-btn').onclick=async()=>{beginView();stopQuizClock();pendingQuizSubmission=null;quizDeadlines.clear();try{await api('/api/logout',{});clearUserDrafts(S.user.id);S={user:null,questions:preview,attempts:[],stats:{completed:0,accuracy:0,streak:0,minutes:0},ai:{configured:false,mode:'off'}};strokes=[];answerFile=null;lastResult=null;lastSolution=null;currentQuestion=null;assignmentContext=null;assignmentDetail=null;HW=null;resultData=null;closeModal();loadBookmarks();homeworkPage();toast('已登出。');}catch(e){toast(e.message);}};}
async function openQuestion(id){if(busy)return toast('正在保存作答，請等待完成。');preserveDraft();if(!S.user){loginModal(()=>openQuestion(id));return;}const q=S.questions.find(q=>q.id===Number(id));if(!q)return toast('找不到題目，請重新整理題庫。');if(currentQuestion&&currentQuestion.id!==q.id&&strokes.length&&!lastResult&&!confirm('目前手寫內容尚未提交，確定切換題目？'))return;assignmentContext=null;mockContext=null;currentQuestion=q;lastResult=null;lastSolution=null;answerMode=(q.options&&q.options.length)?'choice':'hand';answerFile=null;selectedOption=null;window.answerTextDraft='';strokes=[];redoStrokes=[];recommendations=null;stopQuizClock();practice();const target=viewTarget();try{const rec=await api(`/api/questions/${q.id}/recommendations`);if(viewMatches(target)){recommendations=rec;renderRecommendations();}}catch(e){if(viewMatches(target))toast(e.message);}}
// ── 自主練習：先選章節與題型 ──
function practicePool(skipQtype){
  return (S.questions||[]).filter(q=>
    (!practiceRange.topic||q.topic===practiceRange.topic)
    &&(!practiceRange.subtopic||q.subtopic===practiceRange.subtopic)
    &&(skipQtype||!practiceRange.qtype||(q.qtype||'解答題')===practiceRange.qtype));
}
function practicePickerHtml(){
  const all=S.questions||[];
  const chapters=[...new Set(all.map(q=>q.topic).filter(Boolean))].sort();
  // 子分類只列出這個章節「題庫裡真的有的」，避免選到空範圍。
  const subs=practiceRange.topic
    ? [...new Set(all.filter(q=>q.topic===practiceRange.topic).map(q=>q.subtopic).filter(Boolean))].sort()
    : [];
  const typePool=practicePool(true);
  const available=[...new Set(typePool.map(q=>q.qtype||'解答題'))];
  const pool=practicePool(false);
  const attempted=new Set(S.attempts.map(a=>a.questionId));
  const fresh=pool.filter(q=>!attempted.has(q.id));
  const preview=pool.slice(0,8).map(q=>`<button class="practice-range-row" data-pr-q="${q.id}">
    <span class="badge outline">${esc(q.qtype||'解答題')}</span>
    <span class="practice-range-title">${mathText(q.title)}</span>
    <small>${esc(q.topic)}${q.subtopic?' · '+esc(q.subtopic):''} · ${q.points} 分 · ${levels[q.level]||''}${attempted.has(q.id)?' · 練過':''}</small>
  </button>`).join('');
  return `<section class="panel practice-setup">
    <div class="panel-heading"><h2>${icon('practice')}選擇練習範圍</h2><span class="small-text" id="pr-count">${pool.length} 題符合</span></div>
    <div class="form-grid">
      <div class="form-field"><label class="field-label" for="pr-topic">章節（主分類）</label>
        <select id="pr-topic"><option value="">全部章節</option>${chapters.map(t=>`<option value="${esc(t)}"${practiceRange.topic===t?' selected':''}>${esc(t)}</option>`).join('')}</select></div>
      <div class="form-field"><label class="field-label" for="pr-subtopic">子分類</label>
        <select id="pr-subtopic"${subs.length?'':' disabled'}><option value="">全部子分類</option>${subs.map(sb=>`<option value="${esc(sb)}"${practiceRange.subtopic===sb?' selected':''}>${esc(sb)}</option>`).join('')}</select></div>
      <div class="form-field"><label class="field-label" for="pr-qtype">題型</label>
        <select id="pr-qtype"><option value="">全部題型</option>${available.map(t=>`<option value="${esc(t)}"${practiceRange.qtype===t?' selected':''}>${esc(t)}</option>`).join('')}</select></div>
    </div>
    <p class="field-hint">${pool.length
      ? `符合條件 ${pool.length} 題${fresh.length?`，其中 ${fresh.length} 題還沒練過`:''}。「開始練習」會優先挑沒練過的題目。`
      : '目前題庫沒有符合這個範圍的題目，請放寬章節或題型。'}</p>
    <div class="practice-setup-actions">
      <button class="primary" id="pr-start"${pool.length?'':' disabled'}>開始練習 ${icon('arrow')}</button>
      <button class="secondary" id="pr-random"${pool.length?'':' disabled'}>隨機一題</button>
    </div>
    ${preview?`<div class="practice-range-list"><p class="panel-sub">這個範圍的題目（點選可直接開始）</p>${preview}</div>`:''}
  </section>`;
}
function keepRangeValid(){
  // 換章節／子分類後，原本選的子分類或題型可能已不存在，要自動清掉避免出現 0 題。
  const byTopic=(S.questions||[]).filter(q=>!practiceRange.topic||q.topic===practiceRange.topic);
  if(practiceRange.subtopic&&!byTopic.some(q=>q.subtopic===practiceRange.subtopic))practiceRange.subtopic='';
  const bySubtopic=byTopic.filter(q=>!practiceRange.subtopic||q.subtopic===practiceRange.subtopic);
  if(practiceRange.qtype&&!bySubtopic.some(q=>(q.qtype||'解答題')===practiceRange.qtype))practiceRange.qtype='';
}
function bindPracticePicker(){
  const t=$('#pr-topic'),sb=$('#pr-subtopic'),ty=$('#pr-qtype');
  if(t)t.onchange=()=>{practiceRange.topic=t.value;practiceRange.subtopic='';keepRangeValid();practicePicker();};
  if(sb)sb.onchange=()=>{practiceRange.subtopic=sb.value;keepRangeValid();practicePicker();};
  if(ty)ty.onchange=()=>{practiceRange.qtype=ty.value;practicePicker();};
  const start=$('#pr-start');if(start)start.onclick=()=>practiceStart(false);
  const rand=$('#pr-random');if(rand)rand.onclick=()=>practiceStart(true);
  $$('[data-pr-q]').forEach(b=>b.onclick=()=>openQuestion(Number(b.dataset.prQ)));
}
function practiceStart(random){
  const pool=practicePool(false);
  if(!pool.length)return toast('目前沒有符合這個範圍的題目。');
  if(random)return openQuestion(pool[Math.floor(Math.random()*pool.length)].id);
  const attempted=new Set(S.attempts.map(a=>a.questionId));
  const fresh=pool.filter(q=>!attempted.has(q.id));
  const wrong=pool.filter(q=>S.attempts.some(a=>a.questionId===q.id&&a.status==='graded'&&a.score!==null&&a.score<a.maxScore));
  openQuestion((fresh[0]||wrong[0]||pool[0]).id);
}
function practicePicker(){
  beginView();page='practice';assignmentContext=null;mockContext=null;currentQuestion=null;stopQuizClock();shell();
  $('#main').innerHTML=`<div class="fade-in">${heading('FOCUSED PRACTICE','自主練習','先選章節與題型，再一次練一類題；已接入 AI 時可即時評分；未接入時文字核對答案，手稿待批閱。')}${practicePickerHtml()}</div>`;
  bindPracticePicker();
}
function practice(){if(!S.user){return requireLogin(()=>practice());}if(!currentQuestion)return practicePicker();beginView();page='practice';shell();const q=currentQuestion;$('#main').innerHTML=`<div class="fade-in">${heading(mockContext?'MOCK EXAM':assignmentContext?'ASSIGNMENT PRACTICE':'FOCUSED PRACTICE',mockContext?'模擬測驗作答':assignmentContext?'作業解題':'自主練習',mockContext?esc(mockContext.title)+' · 本次作答計入模擬測驗':assignmentContext?esc(assignmentContext.title)+' · 此次保存將計入本份作業':'慢一點思考，清楚寫下每一步。理解，比速度更重要。')}${quizClockBadge()}${mockContext?`<button class="text-button back-button" data-mock="${mockContext.id}">${icon('back')}返回模擬測驗</button>`:assignmentContext?`<button class="text-button back-button" data-assignment="${assignmentContext.id}">${icon('back')}返回本份作業</button>`:`<button class="text-button back-button" data-page="bank">${icon('back')}返回題庫</button><button class="text-button back-button" id="change-range">${icon('practice')}換練習範圍</button>`}<div class="practice-layout"><section class="panel practice-panel"><div class="practice-question"><div class="question-top"><span class="badge">${q.grade} · ${esc(q.topic)}${q.subtopic?' · '+esc(q.subtopic):''}</span><span class="badge l${q.level}">${levels[q.level]}</span><span class="badge outline">${esc(q.qtype||'解答題')}</span><span class="badge outline">${q.points} 分</span><button class="bookmark ${bookmarks.has(q.id)?'saved':''}" style="margin-left:auto" data-save="${q.id}" aria-label="收藏題目">${icon('bookmark')}</button></div><h2>${mathText(q.title)}</h2>${stemHtml(q,{options:false})}<div class="question-meta">${esc(q.tags.join(' · '))}<i class="separator"></i>${esc(q.source)}</div></div><div class="section-head"><h2 style="font-size:calc(16px*var(--fs))">你的解題過程</h2><button class="text-button" id="hint-btn" style="font-size:calc(14px*var(--fs))">${icon('bulb')}給我一點提示</button></div><div id="hint-root"></div>${(()=>{const modes=practiceModes(q);if(modes.length<2)return '';return `<div class="practice-tabs">${modes.map(([id,ic,t])=>`<button data-answer-mode="${id}" class="${answerMode===id?'active':''}">${icon(ic)}${t}</button>`).join('')}</div>`;})()}<div id="answer-area"></div><div class="form-field">${mathKeyboardHtml()}<div class="final-answer-head"><label class="field-label" for="final-answer">最終答案 <span class="small-text">· 文字作答必填，手寫作答可選填</span></label><button type="button" class="text-button math-editor-open" id="open-math-editor">${icon('calculator')}公式編輯器</button></div><input class="answer-field" id="final-answer" placeholder="例如：x=2 或 x=3，或按上方數學鍵盤輸入" maxlength="4000"><div class="math-preview" id="final-answer-preview" hidden></div></div>${aiGradingHtml()}${(aiGradedNow()&&S.ai.mode==='external')?`<label class="checkbox-line"><input type="checkbox" id="consent-ai">我同意將本題、作答及最多5次本人同知識點已評紀錄，傳送至學校配置的外部 AI 作批改與學習建議。</label>`:''}<div class="submit-row answer-submit"><span class="small-text" id="draft-status">本分頁草稿暫存 · 提交後才保存至伺服器</span>${assignmentContext?`<button class="secondary" id="skip-answer" title="不會也沒關係，老師會看到">本題不會</button>`:''}<button class="primary" id="submit-answer">${icon('check')}${submitLabel()}</button></div><div id="result-root"></div></section><div class="right-stack"><section class="panel right-panel"><h2>${icon('spark')}從一道題，到一類題</h2><p class="panel-sub">先鞏固相同解法，再挑戰更深的思考</p><div id="recommendations">${empty('正在找題','從校本題庫尋找同知識點練習')}</div></section><section class="panel right-panel tip-panel"><h2>${icon('bulb')}解題習慣</h2><p>① 先理解題目要找甚麼。<br>② 選擇方法，寫下理由。<br>③ 代回原題，檢查結果。<br><br>手寫評閱需要能辨認完整步驟；請保持字跡清楚。</p></section></div></div></div>`;renderAnswerArea();bindMathKeyboard();$('#hint-btn').onclick=()=>{$('#hint-root').innerHTML=`<div class="hint-box">${mathText(q.hint||'先圈出已知條件，再想想與哪一個知識點有關。')}</div>`;};$('#submit-answer').onclick=submitAnswer;
  const skipBtn=$('#skip-answer');if(skipBtn)skipBtn.onclick=markCurrentSkipped;const rangeBtn=$('#change-range');if(rangeBtn)rangeBtn.onclick=()=>{if(strokes.length&&!lastResult&&!confirm('目前手寫內容尚未提交，確定離開這一題？'))return;preserveDraft();currentQuestion=null;strokes=[];redoStrokes=[];lastResult=null;lastSolution=null;practicePicker();};restoreDraft();renderRecommendations();}
// ── 作答模式與數學鍵盤 ──
// 選擇題只可點選作答；填空題只手寫或文字作答；解答題／證明題保留上傳手稿。
function practiceModes(q){
  if(q && q.options && q.options.length) return [['choice','check','點選作答']];
  const modes = [['hand','practice','手寫解題'], ['text','file','文字作答']];
  if(!q || q.qtype !== '填空題') modes.push(['upload','image','上傳手稿']);
  return modes;
}
function ensureAnswerMode(){
  if(!currentQuestion) return;
  const ids = practiceModes(currentQuestion).map(m=>m[0]);
  if(!ids.includes(answerMode)) answerMode = ids[0];
}
// 這題會不會由 AI 批改、分數由誰確認：
// - 教師佈置的作業／測驗：由教師在佈置時決定（學生不可自行選擇），AI 只作建議。
// - 自主練習與自助模擬測驗：一律 AI 即時評分並記錄分數，不需教師批閱。
function aiGradedNow(){
  if(!S.ai.configured) return false;
  if(assignmentContext) return !!assignmentContext.aiGrading;
  return true;
}
// 學生頁面的唯讀說明：讓學生知道這題會不會經過 AI，以及分數由誰決定。
function aiGradingHtml(){
  const model = S.ai.mode==='local' ? '本地模型' : '外部模型';
  if(aiGradedNow()){
    return assignmentContext
      ? `<div class="field-hint">${icon('spark')}本份作業由教師設定使用 AI 建議評分（${model}），僅供教師覆核，最終分數以教師確認為準。</div>`
      : `<div class="field-hint">${icon('spark')}自主練習由 AI 即時評分並記錄分數（${model}），不需教師批閱；分數只作個人練習紀錄。</div>`;
  }
  if(assignmentContext && S.ai.configured){
    return `<div class="field-hint">${icon('lock')}本份作業由教師設定不使用 AI 批改：文字作答只核對最終答案，手寫作答交由教師批閱。</div>`;
  }
  if(S.ai.configured){
    return `<div class="field-hint">${icon('lock')}本題不使用 AI 批改：文字作答只核對最終答案，手寫作答交由教師批閱。</div>`;
  }
  return `<div class="field-hint">${icon('lock')} AI 尚未接入：手寫作答將保存為待教師批閱；純文字只核對最終答案。</div>`;
}
// 提交按鈕文字：自主練習是「評分」，教師佈置的作業才是「批閱」。
function submitLabel(){ return aiGradedNow() ? (assignmentContext ? '提交與批閱' : '提交並評分') : '提交作答'; }
// 數學鍵盤（MathType 式輸入）：點按按鈕即插入 LaTeX，輸入框下方即時顯示排版結果。
const MATH_KEYBOARD = [
  ['basic','常用',[
    ['+','＋'],['-','－'],['\\times','×'],['\\div','÷'],['\\pm','±'],['\\cdot','·'],
    ['=','＝'],['\\ne','≠'],['\\approx','≈'],['\\equiv','≡'],['\\le','≤'],['\\ge','≥'],
    ['\\ll','≪'],['\\gg','≫'],['\\propto','∝'],['\\%','%'],['\\infty','∞'],['\\sqrt{}','√'],
  ]],
  ['frac','分數 · 根號 · 上下標',[
    ['\\frac{}{}','分數'],['\\dfrac{}{}','大分數'],['\\tfrac{}{}','小分數'],['\\frac{1}{2}','½'],
    ['\\sqrt{}','根號'],['\\sqrt[n]{}','n 次根'],['\\sqrt[3]{}','立方根'],
    ['^{}','上標'],['_{}','下標'],['\\left(\\right)','圓括號'],['\\left[\\right]','方括號'],
    ['\\left\\{\\right\\}','大括號'],['\\left|\\right|','絕對值'],['\\overline{}','上橫線'],
    ['\\vec{}','向量'],['\\hat{}','帽號'],
  ]],
  ['greek','希臘字母',[
    ['\\alpha','α'],['\\beta','β'],['\\gamma','γ'],['\\delta','δ'],['\\epsilon','ε'],['\\varepsilon','ε'],
    ['\\zeta','ζ'],['\\eta','η'],['\\theta','θ'],['\\vartheta','ϑ'],['\\iota','ι'],['\\kappa','κ'],
    ['\\lambda','λ'],['\\mu','μ'],['\\nu','ν'],['\\xi','ξ'],['\\pi','π'],['\\rho','ρ'],
    ['\\sigma','σ'],['\\tau','τ'],['\\upsilon','υ'],['\\phi','φ'],['\\varphi','φ'],['\\chi','χ'],
    ['\\psi','ψ'],['\\omega','ω'],['\\Gamma','Γ'],['\\Delta','Δ'],['\\Theta','Θ'],['\\Lambda','Λ'],
    ['\\Xi','Ξ'],['\\Pi','Π'],['\\Sigma','Σ'],['\\Phi','Φ'],['\\Psi','Ψ'],['\\Omega','Ω'],
  ]],
  ['algebra','代數 · 函數',[
    ['x','x'],['y','y'],['z','z'],['n','n'],['e^{}','e^'],['a^{}','a^'],
    ['\\log_{}','log'],['\\ln','ln'],['\\lg','lg'],['\\lim_{x\\to 0}','lim'],
    ['\\frac{d}{dx}','d/dx'],['\\frac{\\partial}{\\partial x}','∂/∂x'],['\\partial','∂'],['\\Delta','Δ'],
    ['\\to','→'],['\\mapsto','↦'],['\\forall','∀'],['\\exists','∃'],
  ]],
  ['trig','三角',[
    ['\\sin','sin'],['\\cos','cos'],['\\tan','tan'],['\\cot','cot'],['\\sec','sec'],['\\csc','csc'],
    ['\\arcsin','arcsin'],['\\sin^{-1}','sin⁻¹'],['\\cos^{-1}','cos⁻¹'],['\\tan^{-1}','tan⁻¹'],
    ['^{\\circ}','°'],['\\pi','π'],['\\theta','θ'],['\\varphi','φ'],
  ]],
  ['calc','微積分 · 數列',[
    ['\\int_{}^{}','積分'],['\\int','∫'],['\\oint','∮'],['\\iint','∬'],
    ['\\sum_{i=1}^{n}','Σ 求和'],['\\prod_{}^{}','Π 連乘'],
    ['\\lim_{n\\to\\infty}','lim'],['\\frac{d}{dx}','導數'],['\\frac{\\partial}{\\partial x}','偏導'],
    ['\\nabla','∇'],['\\infty','∞'],['\\ldots','…'],
  ]],
  ['set','集合 · 邏輯',[
    ['\\in','∈'],['\\notin','∉'],['\\subset','⊂'],['\\subseteq','⊆'],['\\supset','⊃'],['\\supseteq','⊇'],
    ['\\cup','∪'],['\\cap','∩'],['\\varnothing','∅'],['\\setminus','＼'],
    ['\\mathbb{N}','ℕ'],['\\mathbb{Z}','ℤ'],['\\mathbb{Q}','ℚ'],['\\mathbb{R}','ℝ'],['\\mathbb{C}','ℂ'],
    ['\\Rightarrow','⇒'],['\\Leftrightarrow','⇔'],['\\neg','¬'],['\\land','∧'],['\\lor','∨'],
    ['\\therefore','∴'],['\\because','∵'],
  ]],
  ['geo','幾何 · 向量',[
    ['\\angle','∠'],['\\parallel','∥'],['\\perp','⊥'],['\\sim','∼'],['\\cong','≅'],['\\triangle','△'],
    ['\\square','□'],['\\bigcirc','○'],['\\degree','°'],['\\vec{}','向量'],['\\overline{}','線段'],
    ['\\overrightarrow{}','有向線段'],['\\widehat{}','弧'],
  ]],
];
function mathKeyboardHtml(suffix, hidden=true){
  const kid = suffix ? `math-keyboard-${suffix}` : 'math-keyboard';
  const tabs = MATH_KEYBOARD.map(([id,label],i)=>
    `<button type="button" class="mk-tab ${i===0?'active':''}" data-mk-tab="${id}">${esc(label)}</button>`).join('');
  const panels = MATH_KEYBOARD.map(([id,label,keys],i)=>
    `<div class="mk-panel" data-mk-panel="${id}"${i===0?'':' hidden'}>${keys.map(([tex,text])=>
      `<button type="button" class="mk-key" data-mk-insert="${esc(tex)}" title="${esc(tex)}">${esc(text)}</button>`).join('')}</div>`).join('');
  return `<div class="math-keyboard" id="${kid}"${hidden?' hidden':''}><div class="mk-head">${icon('practice')}<span class="mk-title">數學鍵盤</span><span class="small-text">點按插入符號，可在輸入框直接修改</span></div><div class="mk-tabs">${tabs}</div>${panels}</div>`;
}
function insertMathSnippet(snippet){
  const input=$('#final-answer');
  if(!input) return;
  const start=input.selectionStart ?? input.value.length;
  const end=input.selectionEnd ?? start;
  input.value = input.value.slice(0, start) + snippet + input.value.slice(end);
  const inner = snippet.indexOf('{}');
  const caret = start + (inner >= 0 ? inner + 1 : snippet.length);
  try{ input.setSelectionRange(caret, caret); }catch(_){}
  input.focus();
  input.dispatchEvent(new Event('input', {bubbles:true}));
}
function updateMathPreview(){
  const input=$('#final-answer'), preview=$('#final-answer-preview');
  if(!input || !preview) return;
  const value=input.value.trim();
  // 選擇題的「最終答案」是選項字母，不需要排版預覽。
  if(answerMode==='choice'){ preview.hidden=true; preview.innerHTML=''; return; }
  if(!value){
    // 只有文字作答（有數學鍵盤）才顯示輸入提示；手寫解題不佔位。
    preview.hidden = answerMode !== 'text';
    preview.innerHTML='<span class="small-text">輸入後這裡會顯示排版結果（例如 \\frac{1}{2} → ½）</span>';
    return;
  }
  // 含 LaTeX 語法才用數學排版，否則照原樣顯示，避免把「5 cm」排成斜體。
  // 手寫解題模式也顯示：學生切換模式後仍看得懂自己先前輸入的數學式（例如 \\frac{1}{2} 顯示成 ½）。
  preview.hidden = false;
  preview.innerHTML = /[\\^_{}]/.test(value) ? katexHtml(value, false) : `<span>${esc(value)}</span>`;
}
// 公式編輯器：點按鈕才載入 MathLive（約 790 KB），平常不影響頁面載入速度。
let mathLiveReady=null;
function loadMathLive(){
  if(mathLiveReady)return mathLiveReady;
  mathLiveReady=new Promise((resolve,reject)=>{
    if(window.MathLive)return resolve(window.MathLive);
    const script=document.createElement('script');
    script.src='vendor/mathlive.min.js';
    script.onload=()=>window.MathLive?resolve(window.MathLive):reject(new Error('公式編輯器載入失敗。'));
    script.onerror=()=>reject(new Error('公式編輯器載入失敗，請檢查網路後再試。'));
    document.head.appendChild(script);
  });
  return mathLiveReady;
}
async function openMathEditor(){
  const input=$('#final-answer');
  if(!input)return;
  toast('正在載入公式編輯器…');
  try{await loadMathLive();}
  catch(err){toast(err.message);return;}
  const current=input.value.trim();
  modal(`<p class="eyebrow">MATH EDITOR</p><h2>公式編輯器</h2>
  <p class="modal-intro">像在 Word 裡打公式：下方鍵盤與作答頁完全相同（常用、分數根號、希臘字母、代數、三角、微積分、數列、集合邏輯、幾何向量），點一下就會長出對應結構。完成後按「插入答案」寫回作答欄。</p>
  <div class="math-editor-host"><math-field id="math-editor-field" virtual-keyboard-mode="manual"></math-field></div>
  ${mathKeyboardHtml('editor', false)}
  <p class="error-text" id="math-editor-error"></p>
  <div class="submit-row"><button class="primary" id="math-editor-ok">${icon('check')}插入答案</button><button class="secondary" data-action="close-modal">取消</button></div>`);
  const field=$('#math-editor-field');
  if(!field){toast('公式編輯器無法啟動，請改用數學鍵盤輸入。');return;}
  field.value=current;
  field.focus();
  // 彈窗內的鍵盤與作答頁共用同一份 MATH_KEYBOARD 資料，插入目標改成 math-field。
  bindMathKeyboard($('#math-keyboard-editor'), snippet=>{
    field.insert(snippet);
    field.focus();
  });
  $('#math-editor-ok').onclick=()=>{
    const latex=(field.value||'').trim();
    input.value=latex;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    closeModal();
    toast(latex?'已插入公式，可繼續微調。':'已清空最終答案。');
  };
}
function syncMathKeyboard(){
  const keyboard=$('#math-keyboard');
  if(!keyboard) return;
  // 數學鍵盤只在文字作答出現；排版預覽只要輸入框有內容就顯示（任何作答模式）。
  keyboard.hidden = answerMode !== 'text';
  updateMathPreview();
}
function bindMathKeyboard(root, insert){
  const keyboard=root||$('#math-keyboard');
  if(!keyboard) return;
  const input=$('#final-answer');
  if(!root && input) input.addEventListener('input', updateMathPreview);
  const doInsert = insert || (snippet=>insertMathSnippet(snippet));
  keyboard.querySelectorAll('[data-mk-tab]').forEach(tab=>{
    tab.onclick=()=>{
      keyboard.querySelectorAll('[data-mk-tab]').forEach(other=>other.classList.toggle('active', other===tab));
      keyboard.querySelectorAll('[data-mk-panel]').forEach(panel=>{
        panel.hidden = panel.dataset.mkPanel !== tab.dataset.mkTab;
      });
    };
  });
  keyboard.querySelectorAll('[data-mk-insert]').forEach(key=>{
    key.onclick=()=>doInsert(key.dataset.mkInsert);
  });
  if(!root) syncMathKeyboard();
}
function renderAnswerArea(){ensureAnswerMode();renderAnswerAreaInner();syncMathKeyboard();}
function renderAnswerAreaInner(){const area=$('#answer-area');if(!area)return;if(answerMode==='choice'){const opts=(currentQuestion&&currentQuestion.options)||[];area.innerHTML=`<label class="field-label">點選你的答案</label><div class="choice-picker" id="choice-picker">${opts.map((o,j)=>{const L=OPTION_LETTERS[j];return `<button type="button" class="choice-option ${selectedOption===L?'selected':''}" data-choice="${L}" aria-pressed="${selectedOption===L}"><span class="option-letter">${L}</span><span class="option-text">${mathText(o)}</span></button>`;}).join('')}</div><p class="field-hint">點選一項即完成作答；自主練習提交後可即時核對，作業結果須教師覆核。</p>`;$$('[data-choice]').forEach(b=>b.addEventListener('click',()=>{selectedOption=b.dataset.choice;$('#final-answer').value=selectedOption;lastResult=null;renderAnswerArea();scheduleDraft();}));return;}if(answerMode==='hand'){area.innerHTML=`<div class="writing-toolbar"><div class="tool-group"><button class="icon-btn active" id="pen-btn" aria-label="畫筆">${icon('practice')}</button><button class="icon-btn" id="eraser-btn" aria-label="橡皮擦">${icon('eraser')}</button><span style="height:20px;border-right:1px solid var(--border);margin:0 4px"></span>${['#274b3b','#456bab','#b96c5d'].map(c=>`<button class="pen-color ${c===penColor?'selected':''}" style="background:${c}" data-color="${c}" aria-label="${c==='#274b3b'?'深綠':c==='#456bab'?'藍':'紅'}色畫筆"></button>`).join('')}<button class="icon-btn" id="undo-btn" aria-label="撤銷一筆">${icon('undo')}</button><button class="icon-btn" id="clear-btn" aria-label="清空畫布">${icon('trash')}</button></div><span class="small-text">觸控筆 / 滑鼠皆可</span></div><div class="canvas-wrap hand-canvas-wrap"><canvas id="hand-canvas" width="${handSize()[2]}" height="${handSize()[3]}" aria-label="手寫解題畫布"></canvas><div class="canvas-placeholder" id="canvas-placeholder">在這裡寫下你的思考…</div></div><div class="hand-size-row">${handSizeControl()}<span class="small-text">步驟多就換大一點；已寫的內容會保留。</span></div><p class="field-hint">提示：先寫出算式，再補上推導。切換文字模式不會清除手寫內容。</p>`;initCanvas();const sizeSel=$('#hand-size');if(sizeSel)sizeSel.onchange=()=>{const next=HAND_SIZES.find(([id])=>id===sizeSel.value);if(!next)return;const current=handSize();if(strokes.length&&next[3]<current[3]&&!confirm(`縮小後，超出範圍的筆跡不會出現在送出的圖片上（畫布內仍保留，可再放大回來）。仍要換成「${next[1]}」？`)){renderAnswerArea();return;}try{localStorage.setItem('mathpath_hand_size',next[0]);}catch{}renderAnswerArea();toast(`書寫區已換成「${next[1]}」。`);};$('#pen-btn').onclick=()=>setEraser(false);$('#eraser-btn').onclick=()=>setEraser(true);$('#undo-btn').onclick=()=>{if(strokes.length)redoStrokes.push(strokes.pop());drawCanvas();lastResult=null;scheduleDraft();};$('#clear-btn').onclick=()=>{if(!strokes.length)return;if(confirm('清空尚未提交的手寫內容？此動作無法復原。')){strokes=[];redoStrokes=[];drawCanvas();lastResult=null;scheduleDraft();}};$$('[data-color]').forEach(b=>b.onclick=()=>{penColor=b.dataset.color;setEraser(false);$$('[data-color]').forEach(x=>x.classList.toggle('selected',x===b));});}else if(answerMode==='text'){area.innerHTML=`<p class="field-hint">${icon('practice')}用下方數學鍵盤輸入數學式（例如分數、根號、次方），也可直接打字；輸入框下方會即時顯示排版結果。純文字作答（如 5 cm）同樣可以。</p>`;}else{const isPdf=!!answerFile&&answerFile.indexOf('data:application/pdf')===0;area.innerHTML=`<label class="upload-answer" id="answer-drop">${isPdf?`<span class="upload-file">${icon('file')}<strong>已選擇 PDF 作答</strong><small>提交時會先讀取 PDF 的文字；掃描檔會取用內嵌的圖片</small></span>`:answerFile?`<img src="${answerFile}" alt="待提交的手寫解題">`:`${icon('image')}<strong>上傳紙上的解題過程</strong><small>相片 JPG / PNG 最多 25 MB（上傳前會自動壓縮）、PDF 最多 20 MB；請保持完整、清晰</small>`}<input id="answer-upload" type="file" accept="image/*,application/pdf" hidden></label><div class="upload-actions"><button type="button" class="secondary" id="answer-select">選擇檔案</button><button type="button" class="secondary" id="answer-camera">${icon('image')}用手機拍照</button><button type="button" class="secondary" id="answer-remove" ${answerFile||uploadReading?'':'disabled'}>移除檔案</button><span class="small-text" id="answer-read-status" role="status">${uploadReading?'正在讀取並壓縮相片，請稍候…':answerFile?(isPdf?'已選擇 PDF 作答，提交時會先讀取 PDF 文字':'相片已壓縮至約 '+fmtBytes(dataUrlBytes(answerFile))+'，送出更快'):'可選擇檔案或用手機相機拍照。'}</span><input id="answer-capture" type="file" accept="image/*" capture="environment" hidden></div>`;
const pickAnswer=async file=>{
  if(!file||busy)return;
  const target=viewTarget(),seq=++uploadSeq;uploadReading=true;renderAnswerArea();if($('#submit-answer'))$('#submit-answer').disabled=true;
  try{const data=file.type==='application/pdf'?await fileData(file,['application/pdf']):await answerImageData(file);if(seq!==uploadSeq||!viewMatches(target))return;answerFile=data;lastResult=null;scheduleDraft();}
  catch(err){if(seq===uploadSeq&&viewMatches(target))toast(err.message);}
  finally{if(seq===uploadSeq&&viewMatches(target)){uploadReading=false;renderAnswerArea();if($('#submit-answer'))$('#submit-answer').disabled=busy||quizTargetExpired();}}
};
$('#answer-upload').onchange=e=>pickAnswer(e.target.files[0]);$('#answer-select').onclick=()=>$('#answer-upload').click();$('#answer-camera').onclick=()=>$('#answer-capture').click();$('#answer-capture').onchange=e=>pickAnswer(e.target.files[0]);
$('#answer-remove').onclick=()=>{if(busy)return;uploadSeq++;uploadReading=false;answerFile=null;lastResult=null;renderAnswerArea();if($('#submit-answer'))$('#submit-answer').disabled=quizTargetExpired();scheduleDraft();};}}
function setEraser(value){eraser=value;$('#pen-btn')?.classList.toggle('active',!value);$('#eraser-btn')?.classList.toggle('active',value);}
function initCanvas(){const c=$('#hand-canvas');function pos(e){const r=c.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width*c.width,y:(e.clientY-r.top)/r.height*c.height,p:e.pressure||.5};}c.onpointerdown=e=>{if(e.button!==0&&e.pointerType==='mouse')return;e.preventDefault();c.setPointerCapture(e.pointerId);activeStroke={color:penColor,erase:eraser,points:[pos(e)]};strokes.push(activeStroke);redoStrokes=[];drawCanvas();};c.onpointermove=e=>{if(!activeStroke)return;e.preventDefault();activeStroke.points.push(pos(e));drawCanvas();};c.onpointerup=c.onpointercancel=c.onlostpointercapture=()=>{activeStroke=null;lastResult=null;scheduleDraft();};drawCanvas();}
function drawCanvas(){const c=$('#hand-canvas');if(!c)return;const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);for(const s of strokes){ctx.globalCompositeOperation=s.erase?'destination-out':'source-over';ctx.strokeStyle=s.color;ctx.fillStyle=s.color;ctx.lineWidth=s.erase?36:4;ctx.lineCap='round';ctx.lineJoin='round';if(s.points.length===1){const p=s.points[0];ctx.beginPath();ctx.arc(p.x,p.y,s.erase?18:2,0,Math.PI*2);ctx.fill();}else{ctx.beginPath();s.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();}}ctx.globalCompositeOperation='source-over';$('#canvas-placeholder').hidden=strokes.length>0;}
// 手寫圖、題目圖形與教師批註改用 WebP（實測比 PNG 小約三成；JPEG 對線條圖反而更大，故不採用）。
// 瀏覽器不支援 WebP 編碼時（部分較舊的 Safari）自動退回 PNG，功能不受影響。
let webpSupported=null;
function supportsWebp(){if(webpSupported===null){try{const probe=document.createElement('canvas');probe.width=probe.height=1;webpSupported=probe.toDataURL('image/webp').startsWith('data:image/webp');}catch{webpSupported=false;}}return webpSupported;}
function imageDataUrl(canvas){return supportsWebp()?canvas.toDataURL('image/webp',0.8):canvas.toDataURL('image/png');}
function canvasImage(){const c=$('#hand-canvas'),out=document.createElement('canvas');out.width=c.width;out.height=c.height;const ctx=out.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(c,0,0);return imageDataUrl(out);}
// 書寫區大小：題目長、步驟多就需要更高的畫布。學生自己選，選擇會記在瀏覽器裡。
// 改變大小只換畫布尺寸，筆跡用原本的座標保留（縮小只是暫時看不到，放大就回來）。
const HAND_SIZES=[['normal','標準',1200,700],['tall','加高',1200,1000],['tallest','特大',1200,1400],['wide','寬版',1600,900]];
function handSizeId(){try{const v=localStorage.getItem('mathpath_hand_size');return HAND_SIZES.some(([id])=>id===v)?v:'normal';}catch{return 'normal';}}
function handSize(){return HAND_SIZES.find(([id])=>id===handSizeId())||HAND_SIZES[0];}
function handSizeControl(){return `<label class="small-text" for="hand-size">書寫區大小</label><select id="hand-size" aria-label="選擇手寫書寫區大小">${HAND_SIZES.map(([id,label,w,h])=>`<option value="${id}" ${id===handSizeId()?'selected':''}>${label}（${w} × ${h}）</option>`).join('')}</select>`;}
// ── 拆題時的題目圖形 ──
// AI 只回報圖形在試卷圖片中的範圍；裁切在瀏覽器做（這裡才有原圖尺寸），
// 圖形本身不經伺服器，與手寫圖／批註一樣用 WebP 保存。
function loadImageDataUrl(src,message){
  return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error(message||'試卷圖片載入失敗'));img.src=src;});
}
// 範圍優先用 0–1 比例；數值明顯大於 1.5 就當成像素座標，按原圖尺寸換算。
// 稍微留白以免切掉圖形的標註；框太小（<4%）幾乎一定是模型亂框，寧可留空讓教師自己補圖。
function cropFigureBox(img,box){
  const W=img.naturalWidth,H=img.naturalHeight;
  if(!W||!H||!box)return '';
  const pixel=Math.max(box.x,box.y,box.x+box.w,box.y+box.h)>1.5;
  const sx=pixel?W:1, sy=pixel?H:1;
  let x=box.x/sx, y=box.y/sy, w=box.w/sx, h=box.h/sy;
  if(!(w>0)||!(h>0))return '';
  const pad=0.012;
  x=Math.max(0,x-pad); y=Math.max(0,y-pad);
  w=Math.min(1-x,w+pad*2); h=Math.min(1-y,h+pad*2);
  if(w<0.04||h<0.04)return '';
  const c=document.createElement('canvas');
  c.width=Math.max(1,Math.round(w*W)); c.height=Math.max(1,Math.round(h*H));
  const ctx=c.getContext('2d');
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height);
  ctx.drawImage(img,Math.round(x*W),Math.round(y*H),Math.round(w*W),Math.round(h*H),0,0,c.width,c.height);
  return imageDataUrl(c);
}
// 把拆題回傳的圖形範圍裁成圖形並貼到對應題目；草稿卡與題庫都會顯示在題目右邊。
async function attachFigureBoxes(list,boxes,source){
  if(!source||!Array.isArray(boxes)||!list||!list.length)return 0;
  if(!boxes.some(Boolean))return 0;
  let img;
  try{img=await loadImageDataUrl(source);}catch{return 0;}
  let done=0;
  list.forEach((q,i)=>{
    const box=boxes[i];
    if(!q||!box)return;
    const figure=cropFigureBox(img,box);
    if(figure){q.figure=figure;done+=1;}
  });
  return done;
}
// 只有「圖片」試卷才可能框出圖形：掃描版 PDF 的頁面圖由伺服器產生，
// 前端沒有原圖可裁，所以後端不會回報 figureBox。
function paperImageSource(){return paperFile&&/^image\//.test(paperFile.mime)?paperFile.dataUrl:'';}

// ── AI 依題目內容畫圖 ──
// 後端回傳的是消毒過的 SVG（只含幾何元素）；這裡統一把它畫成圖片再存，
// 這樣顯示、LaTeX 匯出與 R2 物件儲存都不用為 SVG 另做一套。
function svgToDataUrl(svg,scale=2){
  return new Promise((resolve,reject)=>{
    // 獨立 SVG 文件當圖片載入時一定要有命名空間，缺了會整張載不出來。
    const text=/xmlns=/.test(svg)?svg:svg.replace('<svg','<svg xmlns="http://www.w3.org/2000/svg"');
    const url=URL.createObjectURL(new Blob([text],{type:'image/svg+xml;charset=utf-8'}));
    const img=new Image();
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('AI 圖形無法轉成圖片，請再生成一次。'));};
    img.onload=()=>{
      const w=Math.max(1,img.naturalWidth||400),h=Math.max(1,img.naturalHeight||300);
      const c=document.createElement('canvas');c.width=w*scale;c.height=h*scale;
      const ctx=c.getContext('2d');
      ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
      ctx.drawImage(img,0,0,c.width,c.height);
      URL.revokeObjectURL(url);
      resolve(imageDataUrl(c));
    };
    img.src=url;
  });
}
// 依題目內容請 AI 畫圖：後端先產生「圖形規格」（數學座標），再由程式畫成 SVG。
// 回傳 {figure, spec, issues, rounds}；失敗回 null（訊息已提示）。
async function aiFigureData(payload,btn,label){
  if(S.user?.role!=='teacher')return toast('只有教師可以生成題目圖形。'),null;
  if(!S.ai.configured)return toast('AI 尚未接入。請在「設定與隱私」查看管理員配置說明。'),null;
  const old=btn?btn.innerHTML:'';
  if(btn){btn.disabled=true;btn.innerHTML=icon('clock')+(label||'正在畫圖…');}
  try{
    const r=await api('/api/questions/ai-figure',{...payload,consentExternal:S.ai.mode==='external'});
    return {...r,figure:await svgToDataUrl(r.svg)};
  }catch(e){toast(e.message);return null;}
  finally{if(btn){btn.disabled=false;btn.innerHTML=old;}}
}
// ── 題目圖形工作室 ──
// AI 只為幾何／向量題材畫圖；畫好後用視覺模型做「題目 ↔ 圖形」互相核對，
// 有問題就依核對結果重畫，或隨時手動插入自己的圖片。所有變更都留在這裡，
// 按「使用這張圖形」才會寫回題目。
const FIGURE_TOPICS=['幾何','三角形','四邊形與多邊形','圓','立體圖形','三角學','坐標幾何','軌跡與幾何證明','向量'];
// 生成後最多檢驗兩次「圖文是否相符」：第 1 輪畫圖＋核對，有疑慮就帶問題重畫第 2 輪，
// 之後保留問題最少的一版（教師可再按「依核對結果重畫」）。
const FIGURE_ROUNDS=2;
const FIGURE_ISSUE_LIMIT=6;

function figureNeeded(topic){return FIGURE_TOPICS.includes(topic);}
// 外部模型要先取得同意；生成與核對都會把題目內容（及圖形）送出。
function aiExternalOk(what){
  return !(S.ai.mode==='external'&&!confirm(`${what}會將題目內容與圖形（不含學生作答）傳送至學校配置的外部 AI，是否繼續？`));
}

function openFigureStudio(ctx){
  figStudio={ctx,figure:ctx.figure||'',original:ctx.figure||'',check:null,busy:'',manual:false,
             spec:null,issues:[],specIssues:[],rounds:0,history:[],
             drawing:false,sketch:newSketch(),sketchTools:null};
  renderFigureStudio();
}

// 手動插入的圖片沒有規格可比對，清掉自動檢查的結果，避免顯示過期的結論。
function setManualFigure(figure){
  figStudio.figure=figure;figStudio.check=null;figStudio.spec=null;
  figStudio.issues=[];figStudio.specIssues=[];figStudio.rounds=0;figStudio.history=[];
  figStudio.manual=true;renderFigureStudio();
}

async function runFigureCheck(ctx,figure){
  return await api('/api/questions/ai-figure-check',
                   {title:ctx.title,content:ctx.content,image:figure,consentExternal:S.ai.mode==='external'});
}

// 把核對結果的「讀到的資料」排成可讀的內容。
function readingHtml(block){
  if(!block)return '<span class="small-text">（沒有讀到資料）</span>';
  const rows=(block.values||[]).map(v=>`<li><b>${esc(v.key)}</b> = ${esc(v.value)}</li>`).join('');
  const marks=(block.marks||[]).length?`<div class="small-text">記號：${esc(block.marks.join('、'))}</div>`:'';
  return (block.shape?`<div class="fig-read-shape">${esc(block.shape)}</div>`:'')
       + (rows?`<ul>${rows}</ul>`:'') + marks;
}

function renderFigureStudio(){
  if(!figStudio)return;
  const {ctx,figure,check,busy,spec,issues}=figStudio;
  // 原本有圖、現在被清空了：這時「使用這張圖形」的意義是移除，必須能按下去把移除送出，
  // 不然按了「移除圖形」之後按鈕變 disabled，移除動作就卡在工作室裡送不出去。
  const original=figStudio.original||'';
  const willRemove=!figure&&!!original;
  const canDraw=figureNeeded(ctx.topic);
  const canCheck=!!figure&&!!S.ai.configured&&!!S.ai.vision;
  const needFix=!!(figure&&issues.length);
  const checkHtml=!issues.length
    ? (figStudio.rounds?`<div class="fig-check ok">${icon('check')}<div><strong>核對結果：圖形與題目相符</strong><small>共比對 ${figStudio.rounds} 輪，題目與圖上的數據一致；仍請自己再看一眼。</small></div></div>`:'')
    : `<div class="fig-check bad">${icon('warn')}<div><strong>核對結果：發現 ${issues.length} 個疑慮</strong><ul>${issues.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>${check&&check.advice?`<small>修正指示：${esc(check.advice)}</small>`:''}</div></div>`;
  const readHtml=check?`<details class="fig-read"><summary>AI 分別讀到的資料</summary>
    <div class="fig-read-grid"><div><strong>題目說的</strong>${readingHtml(check.question)}</div>
    <div><strong>圖上畫的</strong>${readingHtml(check.figure)}</div></div>
    <small class="small-text">兩邊由視覺模型分開讀出，再由系統逐項比對；它不判斷「像不像」，只讀出看到的數據。</small></details>`:'';
  const historyHtml=(figStudio.history||[]).length>1
    ?`<details class="fig-read"><summary>自動修正紀錄（共 ${figStudio.history.length} 輪）</summary><ul>${figStudio.history.map(h=>`<li>第 ${h.round} 輪：${h.issues.length?esc(h.issues.join('；')):'沒有發現問題'}</li>`).join('')}</ul></details>`:'';
  const specHtml=spec?`<details class="fig-read"><summary>圖形規格（數學座標，程式依此繪圖）</summary><pre class="fig-spec">${esc(JSON.stringify(spec,null,1))}</pre></details>`:'';
  modal(`<p class="eyebrow">FIGURE</p><h2>題目圖形</h2>
  <p class="modal-intro">${esc(ctx.title||'（未命名題目）')}${ctx.topic?` · ${esc(ctx.topic)}${ctx.subtopic?' · '+esc(ctx.subtopic):''}`:''}</p>
  <div class="fig-question">${mathText(ctx.content||'')}</div>
  <div class="fig-preview">${figure?`<img src="${figure}" alt="題目圖形">`:`<span class="fig-empty">尚未有圖形</span>`}</div>
  <div class="fig-draw-panel"${figStudio.drawing?'':' hidden'}>
    ${figureToolbarHtml('fig-studio','AI 畫得不對時，可以直接在方格上自己畫：拖曳畫直線／虛線／圓，選「點名稱」再點畫布放置，選「選擇」可拖曳移動、並用「縮放／旋轉」調整大小與角度')}
    <div class="canvas-wrap figure-canvas-wrap"><canvas id="fig-studio-canvas" width="900" height="420" tabindex="0" aria-label="手繪題目圖形畫布"></canvas></div>
    <div class="submit-row"><span class="small-text">按「套用手繪圖形」才會取代目前的圖</span><div class="row-actions"><button class="primary" id="fig-sketch-apply">${icon('check')}套用手繪圖形</button></div></div>
  </div>
  ${checkHtml}
  ${readHtml}
  ${historyHtml}
  ${specHtml}
  <div class="fig-actions">
    <button class="secondary" id="fig-draw" ${canDraw&&!busy?'':'disabled'} title="${canDraw?'':'只有幾何與向量題材會用 AI 畫圖'}">${icon('spark')}${busy==='draw'?(figStudio.note||'正在畫圖…'):(figure?'重新生成圖形':'AI 生成圖形')}</button>
    <button class="secondary" id="fig-check" ${canCheck&&!busy?'':'disabled'} title="${S.ai.vision?'':'尚未設定視覺模型，無法自動核對'}">${icon('search')}${busy==='check'?'核對中…':'核對題目與圖形'}</button>
    ${needFix?`<button class="secondary" id="fig-fix" ${busy?'disabled':''}>${icon('spark')}依核對結果重畫</button>`:''}
    <button type="button" class="secondary" id="fig-sketch-btn">${icon('practice')}${figStudio.drawing?'收起手繪畫布':'手繪圖形'}</button>
    <button type="button" class="secondary" id="fig-manual-btn">${icon('image')}手動插入圖片</button><input type="file" id="fig-manual" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif" hidden>
    ${figure?`<button class="secondary" id="fig-clear">移除圖形</button>`:''}
  </div>
  ${canDraw?'':'<p class="field-hint">這道題的分類「'+esc(ctx.topic||'未分類')+'」不是幾何或向量題材，AI 不會為它畫圖（避免畫出與題目無關的圖）；如仍需要附圖，請用「手動插入圖片」。</p>'}
  ${S.ai.configured?(S.ai.vision?'':'<p class="field-hint">尚未設定視覺模型，暫時不能自動核對圖形；仍可自行核對後使用。</p>'):'<p class="field-hint">尚未接入 AI，只能手動插入圖片。</p>'}
  <p class="field-hint">手動插入：按「手動插入圖片」選檔，或直接在本視窗貼上截圖（Ctrl／⌘ + V）。</p>
  <div class="submit-row"><span class="small-text">按「${willRemove?'移除這張圖形':'使用這張圖形'}」才會寫回題目</span><div class="row-actions"><button class="primary" id="fig-apply" ${figure||willRemove?'':'disabled'}>${icon('check')}${willRemove?'移除這張圖形':'使用這張圖形'}</button><button class="secondary" id="fig-close">關閉</button></div></div>`,true);
  $('#fig-draw').onclick=()=>drawFigureInStudio(false);
  $('#fig-check').onclick=checkFigureInStudio;
  const fix=$('#fig-fix');if(fix)fix.onclick=()=>drawFigureInStudio(true);
  const clr=$('#fig-clear');if(clr)clr.onclick=()=>{figStudio.figure='';figStudio.check=null;figStudio.spec=null;figStudio.issues=[];figStudio.specIssues=[];figStudio.rounds=0;figStudio.history=[];renderFigureStudio();};
  // 手繪畫布：AI 畫得不對、或題目圖形本來就得自己畫時，教師可以直接在方格上畫。
  const sketchBtn=$('#fig-sketch-btn');
  if(sketchBtn)sketchBtn.onclick=()=>{figStudio.drawing=!figStudio.drawing;renderFigureStudio();};
  const sketchCanvas=$('#fig-studio-canvas');
  if(sketchCanvas){
    figStudio.sketchTools=wireFigureTools('fig-studio',sketchCanvas,figStudio.sketch,()=>{});
    const apply=$('#fig-sketch-apply');
    if(apply)apply.onclick=()=>{
      if(!figStudio.sketch.strokes.length)return toast('畫布是空的，先在方格上畫出圖形。');
      const data=imageDataUrl(sketchCanvas);
      if(!data)return toast('手繪圖形無法轉成圖片，請再試一次。');
      // 手繪圖沒有規格可比對，清掉自動檢查的結果，避免顯示過期的結論。
      figStudio.figure=data;figStudio.check=null;figStudio.spec=null;
      figStudio.issues=[];figStudio.specIssues=[];figStudio.rounds=0;figStudio.history=[];
      figStudio.manual=true;figStudio.drawing=false;
      renderFigureStudio();
      toast('已套用手繪圖形；按「使用這張圖形」就會寫回題目，也可以先按「核對題目與圖形」檢查。');
    };
  }
  const manual=$('#fig-manual');
  $('#fig-manual-btn').onclick=()=>manual&&manual.click();
  if(manual)manual.onchange=async e=>{
    const chosen=e.target.files[0];
    // 清掉 value，同一個檔案再選一次才會再觸發 change。
    e.target.value='';
    if(!chosen)return;
    let f;
    try{f=await normalizeHeicFile(chosen);}catch(err){return toast(err.message);}
    if(!f)return;
    if(!/^image\/(png|jpeg|webp)$/.test(f.type)){
      return toast('請選擇 PNG、JPG、WebP 或 HEIC 圖片。');
    }
    if(f.size>12*1024*1024){
      return toast('圖片不可超過 12 MB；手機相片可先裁剪，或直接截圖後貼上。');
    }
    try{setManualFigure(await fitFigureImage(f));toast('已插入圖片，可再按「核對題目與圖形」。');}
    catch(err){toast(err.message);}
  };
  $('#fig-close').onclick=()=>{figStudio=null;closeModal();};
  $('#fig-apply').onclick=async()=>{
    const studio=figStudio,btn=$('#fig-apply');
    // 圖形沒有改動就不必寫回（題庫題目的 figure 是網址，直接送回會被當成無效檔案）。
    if(studio.figure===studio.original){figStudio=null;closeModal();return;}
    // 還有疑慮就先講清楚，避免教師順手把跟題目差很遠的圖存進題庫。
    if(studio.issues.length&&!confirm(`這張圖仍有 ${studio.issues.length} 個疑慮：\n\n`
        +studio.issues.map(x=>'・'+x).join('\n')+'\n\n確定要使用嗎？')){
      return;
    }
    btn.disabled=true;btn.textContent='正在儲存…';
    try{await studio.ctx.apply(studio.figure);figStudio=null;}
    catch(e){btn.disabled=false;btn.innerHTML=icon('check')+'使用這張圖形';toast(e.message);}
  };
}

async function drawFigureInStudio(useIssues){
  if(!figStudio)return;
  const {ctx}=figStudio;
  let issues=(useIssues&&figStudio.issues)?figStudio.issues.slice(0,FIGURE_ISSUE_LIMIT):[];
  if(!aiExternalOk('生成圖形與核對圖形'))return;
  const canCheck=!!S.ai.configured&&!!S.ai.vision;
  // 開始重畫就先把舊的核對結果收起來，避免教師看到已經過期的核對結論。
  figStudio.check=null;figStudio.issues=[];figStudio.specIssues=[];
  figStudio.rounds=0;figStudio.history=[];
  figStudio.busy='draw';figStudio.note='正在畫圖…';renderFigureStudio();
  let best=null;
  for(let round=1;round<=FIGURE_ROUNDS;round++){
    figStudio.busy='draw';figStudio.note=`正在畫圖…（第 ${round} 輪）`;renderFigureStudio();
    const draft=await aiFigureData({title:ctx.title,content:ctx.content,topic:ctx.topic,subtopic:ctx.subtopic,
                                    qtype:ctx.qtype,issues},null,figStudio.note);
    if(!draft)break;
    const specIssues=[...(draft.issues||[])];
    let check=null,found=specIssues.slice();
    if(canCheck){
      figStudio.busy='check';figStudio.note='';renderFigureStudio();
      try{
        check=await runFigureCheck(ctx,draft.figure);
        found=found.concat(check.issues||[]);
      }catch(e){toast(e.message);}
    }
    figStudio.history.push({round,issues:found.slice()});
    const candidate={figure:draft.figure,spec:draft.spec,check,specIssues,issues:found,round};
    if(!best||candidate.issues.length<best.issues.length)best=candidate;
    if(!found.length)break;
    issues=found.slice(0,FIGURE_ISSUE_LIMIT);
  }
  figStudio.busy='';figStudio.note='';
  if(!best){renderFigureStudio();return;}
  figStudio.figure=best.figure;figStudio.spec=best.spec;figStudio.check=best.check;
  figStudio.specIssues=best.specIssues;figStudio.issues=best.issues;
  figStudio.rounds=best.round;figStudio.manual=false;
  renderFigureStudio();
  toast(best.issues.length
    ? `已試 ${best.round} 輪，仍有 ${best.issues.length} 個疑慮，請人工核對或自行換圖。`
    : (canCheck?`已生成圖形並自動核對通過（共 ${best.round} 輪）。`:'已生成圖形，建議按「核對題目與圖形」確認是否相符。'));
}

async function checkFigureInStudio(){
  if(!figStudio||!figStudio.figure)return toast('請先有圖形才能核對。');
  if(!S.ai.vision)return toast('核對圖形需要視覺模型，請先到「設定與隱私」設定。');
  if(!aiExternalOk('核對圖形'))return;
  const {ctx,figure,specIssues}=figStudio;
  figStudio.busy='check';renderFigureStudio();
  try{
    const r=await runFigureCheck(ctx,figure);
    figStudio.check=r;figStudio.busy='';
    figStudio.issues=[...(specIssues||[]),...(r.issues||[])].slice(0,FIGURE_ISSUE_LIMIT);
    renderFigureStudio();
    toast(r.ok?'核對結果：圖形與題目相符。':`核對發現 ${r.issues.length} 個問題，可按「依核對結果重畫」。`);
  }catch(e){figStudio.busy='';renderFigureStudio();toast(e.message);}
}

// 工作室開著時，直接貼上截圖即可作為題目圖形。
document.addEventListener('paste',async e=>{
  // 除了狀態，再用 DOM 確認工作室真的開著：視窗被關掉時不可接手貼上，
  // 否則會把圖形塞進已經關閉的工作室、甚至把視窗叫回來。
  if(!figStudio||!$('#fig-manual'))return;
  const item=[...(e.clipboardData?.items||[])].find(it=>it.type&&it.type.startsWith('image/'));
  if(!item)return;
  const file=item.getAsFile();
  if(!file)return;
  e.preventDefault();
  try{setManualFigure(await fitFigureImage(file));toast('已插入貼上的圖片。');}
  catch(err){toast(err.message);}
});

// 題庫題目：開啟工作室（教師）。
function openFigureStudioForQuestion(qid,pick=false){
  if(S.user?.role!=='teacher')return toast('只有教師可以編輯題目圖形。');
  const q=S.questions.find(x=>x.id===Number(qid));
  if(!q)return toast('找不到題目，請重新整理題庫。');
  openFigureStudio({
    title:q.title,content:q.content,topic:q.topic,subtopic:q.subtopic,qtype:q.qtype,figure:q.figure||'',
    apply:async figure=>{
      await api('/api/questions/figures',{figures:[{id:q.id,figure}]});
      await refresh();closeModal();bank();
      toast(figure?'已更新題目圖形，請核對數據與標註。':'已移除題目圖形。');
    }});
  if(pick)$('#fig-manual')?.click();
}

async function clearQuestionFigure(qid){
  if(!confirm('確定移除這道題目的圖形？'))return;
  try{
    await api('/api/questions/figures',{figures:[{id:Number(qid),figure:''}]});
    await refresh();bank();
    toast('已移除題目圖形。');
  }catch(e){toast(e.message);}
}
async function submitAnswer(){
  if(busy)return;
  if(uploadReading)return toast('檔案仍在讀取，請等待完成後提交。');
  if(quizTargetExpired())return toast('測驗時間已結束，不能再保存作答。');
  const target=viewTarget(),btn=$('#submit-answer');
  const final=$('#final-answer').value.trim(),process=answerMode==='text'?(($('#answer-process')?.value||'').trim()):'';
  const body={questionId:currentQuestion.id,answerText:process?(process+(final?'\n最終答案：'+final:'')):final,consentExternal:!!$('#consent-ai')?.checked};
  if(mockContext)body.mockId=mockContext.id;else if(assignmentContext)body.assignmentId=assignmentContext.id;
  if(answerMode==='hand'&&strokes.some(s=>!s.erase))body.image=canvasImage();
  if(answerMode==='upload'&&answerFile)body.image=answerFile;
  if(!body.answerText&&!body.image)return toast('請先寫下答案或上傳手寫作答。');
  if(aiGradedNow()&&S.ai.mode==='external'&&!body.consentExternal)return toast(assignmentContext?'本份作業由教師設定使用外部 AI 評分，請先確認資料傳送同意。':'自主練習會把本題與作答傳送至外部 AI 即時評分，請先確認資料傳送同意。');
  busy=true;btn.disabled=true;btn.innerHTML=icon('clock')+(aiGradedNow()?'正在保存與評分…':'正在保存…');
  try{
    const {attempt,solution}=await api('/api/attempts',body);
    if(!viewMatches(target))return;
    clearCurrentDraft();lastResult=attempt;lastSolution=solution||null;rememberAssignmentAttempt(attempt);
    const state=await api('/api/state');if(!viewMatches(target))return;
    S=state;loadBookmarks();shell();renderResult();
    toast(assignmentContext?'作答已保存，分數與 AI 建議須由教師覆核。':attempt.status==='pending'?'作答已保存，等待批閱。':'作答與即時評分已記錄。');
    $('#result-root')?.scrollIntoView({behavior:'smooth',block:'nearest'});
  }catch(e){if(viewMatches(target)){toast(e.message);$('#result-root').innerHTML=`<div class="inline-error">${esc(e.message)}<br>你的內容仍保留在頁面，可稍後重試。</div>`;}}
  finally{
    busy=false;
    if(viewMatches(target)){btn.disabled=uploadReading||quizTargetExpired();btn.innerHTML=icon('check')+'再次提交作答';}
    if(pendingQuizSubmission){const pending=pendingQuizSubmission;pendingQuizSubmission=null;await autoSubmitQuiz(pending);}
  }
}
// 作業／測驗的逐題導覽：提交一題後直接前往下一題，不必先回到本份作業。
// 剛提交的作答併回本份作業的快照，進度與「下一題」才能即時更新。
function rememberAssignmentAttempt(attempt){
  if(!assignmentContext||!assignmentDetail||!attempt)return;
  const list=assignmentDetail.attempts||(assignmentDetail.attempts=[]);
  const i=list.findIndex(x=>x.id===attempt.id);
  if(i<0)list.push(attempt);else list[i]=attempt;
}
// 「本題不會」：留空作答但明確記錄，教師端看得到、不自動記零分。
// 不逼學生隨便打一個字才交得出去，也不讓空白題悄悄消失。
async function markQuestionSkipped(qid,opts={}){
  const aid=opts.assignmentId||assignmentContext?.id;
  if(busy||!aid||S.user?.role!=='student')return null;
  if(!opts.silent&&!confirm('標示「本題不會」？老師會看到這題你沒有作答，不會自動記零分。'))return null;
  const target=viewTarget();
  busy=true;
  try{
    const {attempt}=await api('/api/attempts',{questionId:Number(qid),skipped:true,assignmentId:aid});
    if(!viewMatches(target))return null;
    rememberAssignmentAttempt(attempt);
    const state=await api('/api/state');if(!viewMatches(target))return null;
    S=state;loadBookmarks();
    return attempt;
  }catch(e){if(viewMatches(target))toast(e.message);return null;}
  finally{busy=false;}
}
// 作答頁的「本題不會」：標示後直接前往下一題還沒交代的；都交代完就回本份作業。
async function markCurrentSkipped(){
  const btn=$('#skip-answer'),qid=currentQuestion?.id,aid=assignmentContext?.id;
  if(!qid||!aid)return;
  if(btn){btn.disabled=true;btn.innerHTML=icon('clock')+'正在保存…';}
  const done=await markQuestionSkipped(qid);
  if(!done){if(btn){btn.disabled=false;btn.innerHTML='本題不會';}return;}
  toast('已標示「本題不會」，老師會看到。');
  const answered=new Set((assignmentDetail?.attempts||[]).map(x=>x.questionId));
  const next=(assignmentQuestionScope()||[]).find(q=>q.id!==qid&&!answered.has(q.id));
  if(next)openAssignmentQuestion(next.id);else await assignmentPage(aid);
}
// 題目列上的「本題不會」：標示後重畫本份作業，該題狀態立刻變成「等待教師處理」。
async function skipQuestionFromList(qid){
  const done=await markQuestionSkipped(qid);
  if(done){toast('已標示「本題不會」，老師會看到。');await assignmentPage(assignmentContext.id);}
}
function assignmentQuestionScope(){
  const fix=assignmentDetail?.mySubmission?.correction;
  return (assignmentDetail?.questions||[]).filter(q=>!fix||(fix.questionIds||[]).includes(q.id));
}
function assignmentAnsweredIds(){
  const ids=new Set();
  const fix=assignmentDetail?.mySubmission?.correction;
  const scope=new Set(assignmentQuestionScope().map(q=>q.id)),latest=new Map();
  (assignmentDetail?.attempts||[]).forEach(a=>{if(a&&scope.has(a.questionId)&&(!latest.has(a.questionId)||latest.get(a.questionId).id<a.id))latest.set(a.questionId,a);});
  latest.forEach(a=>{if(!fix||a.id>(fix.minAttemptId??-1))ids.add(a.questionId);});
  return ids;
}
function assignmentNavHtml(){
  if(!assignmentContext)return '';
  const list=assignmentQuestionScope();
  const idx=list.findIndex(q=>q.id===(currentQuestion&&currentQuestion.id));
  if(idx<0)return '';
  const answered=assignmentAnsweredIds();
  const done=list.filter(q=>answered.has(q.id)).length;
  const all=done>=list.length;
  // 先找後面還沒作答的題目；都做完了就往前找，最後才提示可以提交。
  const next=list.find((q,i)=>i>idx&&!answered.has(q.id))||list.find((q,i)=>i<idx&&!answered.has(q.id))||null;
  const prev=idx>0?list[idx-1]:null;
  const buttons=[
    next?`<button class="primary" data-next-question="${next.id}">下一題（第 ${list.indexOf(next)+1} / ${list.length} 題）${icon('arrow')}</button>`
        :`<button class="primary" data-assignment="${assignmentContext.id}">${all?'全部題目已完成 · 返回本份作業提交':'返回本份作業'} ${icon('arrow')}</button>`,
    prev?`<button class="secondary" data-prev-question="${prev.id}">上一題</button>`:'',
    next?`<button class="secondary" data-assignment="${assignmentContext.id}">返回本份作業</button>`:''
  ].filter(Boolean).join('');
  return `<div class="assignment-nav"><p class="field-hint">${icon('check')}本份作業進度：已完成 ${done} / ${list.length} 題${all?'，可以正式提交了。':'，可按「下一題」繼續。'}</p><div class="result-actions">${buttons}</div></div>`;
}
function renderResult(){if(!lastResult||!$('#result-root'))return;const a=lastResult,nav=assignmentNavHtml();if(a.awaitingReview){$('#result-root').innerHTML=`<div class="result pending"><div class="result-title">${icon('clock')}已提交，等待教師批閱</div><p>作答已保存。教師批閱後，你才會看到分數、AI 批閱結果、參考答案與學習建議。</p></div>${nav}`;return;}$('#result-root').innerHTML=`<div class="result ${a.status==='pending'?'pending':''}"><div class="result-title">${icon(a.status==='pending'?'clock':'check')}${a.status==='pending'?'已保存，等待批閱':a.gradingMethod==='rule-final'?'最終答案核對':a.gradingMethod==='ai-practice'?'AI 即時評分':a.teacherReviewed?'教師批閱':'AI 建議批閱'}${a.status==='graded'?`<span class="result-score">${a.score}<small> / ${a.maxScore}</small></span>`:''}</div><p class="${feedbackClass(a.feedback).trim()}">${mathText(a.feedback).replace(/\n/g,'<br>')}</p>${(a.steps||[]).map(s=>`<div class="result-step"><div><strong>${mathText(s.label)}</strong><p>${mathText(s.comment)}</p></div><span>${s.earned} / ${s.max}</span></div>`).join('')}${lastSolution&&(lastSolution.answer||(lastSolution.steps||[]).length||lastSolution.analysis||(lastSolution.rubric||[]).length)?`<details class="solution-box"><summary>${icon('bulb')}參考答案與詳解</summary>${lastSolution.answer?`<p class="solution-answer"><strong>參考答案：</strong>${mathText(lastSolution.answer)}</p>`:''}${(lastSolution.steps||[]).length?`<ol class="solution-steps">${lastSolution.steps.map(x=>`<li>${mathText(x)}</li>`).join('')}</ol>`:''}${lastSolution.analysis?`<p class="solution-analysis">${mathText(lastSolution.analysis)}</p>`:''}${rubricListHtml(lastSolution.rubric,a.maxScore)}</details>`:''}${suggestionCard(a.suggestion)}<div class="result-actions">${mockContext?`<button class="secondary" data-mock="${mockContext.id}">返回模擬測驗 ${icon('arrow')}</button>`:''}<button class="secondary" id="next-similar">相似題鞏固 ${icon('arrow')}</button><button class="secondary" data-page="mistakes">查看作答紀錄</button></div></div>${nav}`;$('#next-similar').onclick=()=>{const q=recommendations?.similar?.[0];if(q)openQuestion(q.id);else toast('此題目前沒有同難度的相似題，請選擇其他知識點練習。');};}
function renderRecommendations(){const r=$('#recommendations');if(!r)return;if(!recommendations){r.innerHTML='<p class="field-hint">正在讀取同知識點題目…</p>';return;}r.innerHTML=`<div class="recommend-label">02 · 相似題鞏固</div><div class="recommend-list">${recommendations.similar.length?recommendations.similar.map(q=>`<button data-qid="${q.id}"><strong>${mathText(q.title)}</strong><small>${levels[q.level]} · ${q.points} 分 · 題庫精選</small></button>`).join(''):'<p class="field-hint">暫無同難度的相似題。</p>'}</div><div class="recommend-label">03 · 進階挑戰</div><div class="recommend-list">${recommendations.advanced.length?recommendations.advanced.map(q=>`<button data-qid="${q.id}"><strong>${mathText(q.title)}</strong><small>${levels[q.level]} · ${q.points} 分 · 題庫精選</small></button>`).join(''):'<p class="field-hint">已達此知識點的目前最高難度。</p>'}</div>${S.user?.role==='teacher'?`<div style="border-top:1px solid var(--border);margin-top:18px;padding-top:14px"><p class="field-hint">${S.ai.configured?'AI 可依本題生成變式題；生成後由你決定是否加入題庫。':'接入 AI 後，可依本題生成變式題，並由你決定是否加入題庫。'}</p><button class="text-button" data-generate="similar" style="font-size:calc(13px*var(--fs))">${icon('spark')}AI 生成相似題</button><button class="text-button" data-generate="advanced" style="font-size:calc(13px*var(--fs));margin-top:8px;display:flex">${icon('spark')}AI 生成進階題</button></div>`:''}`;}
// 同一道參考題每次生成都要不一樣：記住這題已生成過的摘要，下次生成時要求模型避開。
const aiDraftSeen={};
function aiDraftSummary(q){return `${q.title||''}${q.content||''}`.replace(/\s+/g,'').slice(0,160);}
async function generateQuestion(kind,qid){
  if(S.user?.role!=='teacher')return toast('只有教師可以生成題目並加入題庫。');
  if(!S.ai.configured)return toast('AI 尚未接入。請在「設定與隱私」查看管理員配置說明。');
  if(S.ai.mode==='external'&&!confirm('生成新題會將原題（不含學生作答）傳送至學校配置的外部 AI，是否繼續？'))return;
  const target=Number(qid||(currentQuestion&&currentQuestion.id));
  if(!target||Number.isNaN(target))return toast('請先開啟一道參考題。');
  const b=$(`[data-gen-kind="${kind}"]`)||$(`[data-generate="${kind}"]`);
  const label=b?b.textContent:'',view=viewTarget(),dialog=$('.modal');
  if(b){b.disabled=true;b.textContent='正在生成，請稍候…';}
  try{
    const avoid=(aiDraftSeen[target]||[]).slice(-12);
    const {draft}=await api(`/api/questions/${target}/generate`,{kind,consentExternal:S.ai.mode==='external',avoid});
    if(!viewMatches(view)||$('.modal')!==dialog)return;
    const seen=aiDraftSeen[target]||(aiDraftSeen[target]=[]);
    seen.push(aiDraftSummary(draft));
    if(seen.length>20)seen.splice(0,seen.length-20);
    aiDraftModal(draft,kind,target);
  }catch(e){
    if(viewMatches(view)&&$('.modal')===dialog){toast(e.message);if(b){b.disabled=false;b.textContent=label;}}
  }
}
// 教師：以某道題為參考，請 AI 生成變式題草稿（不直接寫入題庫）。
function aiGenerateModal(qid){
  if(S.user?.role!=='teacher')return toast('只有教師可以生成題目並加入題庫。');
  const q=S.questions.find(x=>x.id===Number(qid));
  if(!q)return toast('找不到題目，請重新整理題庫。');
  modal(`<p class="eyebrow">AI GENERATE</p><h2>依這道題生成變式題</h2>
  <p class="modal-intro">以「${esc(q.title)}」為參考題，由 AI 生成一道變式題。<strong>生成後不會直接加入題庫</strong>，你可以先核對內容，再決定是否加入。</p>
  <div class="draft-card">${stemHtml(q)}<div class="question-meta"><span>${esc(q.topic)}${q.subtopic?' · '+esc(q.subtopic):''}</span><i class="separator"></i><span>${levels[q.level]||''}</span><i class="separator"></i><span>${q.points} 分</span></div></div>
  <p class="field-hint">${S.ai.configured?'生成會使用學校配置的 AI 模型，需教師核驗後才入庫。':'尚未接入 AI 模型，請先到「設定與隱私」完成設定。'}</p>
  <div class="submit-row"><button class="primary" data-gen-kind="similar" data-gen-qid="${q.id}">${icon('spark')}生成相似題（同難度）</button><button class="secondary" data-gen-kind="advanced" data-gen-qid="${q.id}">${icon('spark')}生成進階題（高一級）</button></div>`,true);
}
// 教師：AI 草稿預覽（含答案、詳解、評分標準），決定是否加入題庫。
function aiDraftPreview(q){
  // 評分標準用唯讀版型呈現，數學式（$...$）會排版後再顯示，不會看到原始 LaTeX。
  const rub=rubricListHtml(q.rubric,q.points);
  const steps=(q.steps||[]).map(s=>`<li>${mathText(s)}</li>`).join('');
  return `<div class="draft-card">
  <div class="draft-top"><strong>${mathText(q.title||'（未命名題目）')}</strong></div>
  <div class="question-top"><span class="badge l${q.level}">${levels[q.level]||''}</span><span class="badge outline">${esc(q.qtype||'解答題')}</span><span class="badge outline">${q.points} 分</span></div>
  <div class="question-stem"><div class="question-stem-text"><div class="question-formula">${mathText(q.content||'')}</div>${optionsHtml(q)}</div>${q.figure?`<div class="draft-figure"><img src="${q.figure}" alt="題目圖形"></div>`:''}</div>
  <div class="question-meta"><span>${esc(q.topic||'')}${q.subtopic?' · '+esc(q.subtopic):''}</span><i class="separator"></i><span>${esc(q.grade||'')}</span></div>
  <div class="draft-section"><span>參考答案</span><p>${mathText(q.answer||'（無）')}</p></div>
  ${steps?`<div class="draft-section"><span>詳解步驟</span><ol>${steps}</ol></div>`:''}
  ${q.analysis?`<div class="draft-section"><span>詳細解釋</span><p>${mathText(q.analysis)}</p></div>`:''}
  ${rub?`<div class="draft-section"><span>評分標準</span>${rub}</div>`:''}
  ${(q.tags||[]).length?`<div class="question-meta" style="margin-top:10px"><span>${esc(q.tags.join(' · '))}</span></div>`:''}
  </div>`;
}
function aiDraftModal(draft,kind,qid){
  const ref=S.questions.find(x=>x.id===Number(qid));
  const name=kind==='advanced'?'進階題':'相似題';
  // 明確寫出與參考題的難度關係，方便教師一眼看出這是不是他按的那一種。
  const relation=kind==='advanced'
    ? `比參考題${ref?`（${levels[ref.level]||'—'}）`:''}高一級`
    : `與參考題${ref?`（${levels[ref.level]||'—'}）`:''}同難度`;
  modal(`<p class="eyebrow">AI DRAFT</p><h2>AI 生成的${name}草稿</h2>
  <p class="modal-intro">這是依參考題生成的${name}草稿（<strong>${relation}</strong>），<strong>尚未加入題庫</strong>。請核對題目內容、分類與參考答案，再決定是否加入。</p>
  ${ref?`<details class="ref-compare"><summary>對照參考題：${esc(ref.title)}</summary>${stemHtml(ref)}<div class="question-meta"><span>${esc(ref.topic)}${ref.subtopic?' · '+esc(ref.subtopic):''}</span><i class="separator"></i><span>${levels[ref.level]||''}</span><i class="separator"></i><span>${esc(ref.qtype||'')}</span></div></details>`:''}
  ${aiDraftPreview(draft)}
  <p class="field-hint">加入題庫代表你已核對題目、分類、參考答案、詳解及評分標準；加入後標示為「AI 生成 · 教師已核驗」。</p>
  <div class="submit-row"><button class="primary" id="ai-draft-save">${icon('check')}加入題庫</button><div class="row-actions"><button class="secondary" id="ai-draft-figure">${icon('spark')}${draft.figure?'重新生成圖形':'AI 生成圖形'}</button><button class="secondary" id="ai-draft-again">再生成一題</button><button class="secondary" id="ai-draft-cancel">放棄</button></div></div>`,true);
  $('#ai-draft-cancel').onclick=()=>closeModal();
  $('#ai-draft-again').onclick=()=>{closeModal();generateQuestion(kind,qid);};
  $('#ai-draft-figure').onclick=()=>{
    if(S.user?.role!=='teacher')return toast('只有教師可以生成題目圖形。');
    openFigureStudio({title:draft.title,content:draft.content,topic:draft.topic,subtopic:draft.subtopic,
                      qtype:draft.qtype,figure:draft.figure||'',
      apply:async figure=>{draft.figure=figure;closeModal();aiDraftModal(draft,kind,qid);
        toast(figure?'已加入題目圖形，請核對數據與標註。':'已移除題目圖形。');}});
  };
  $('#ai-draft-save').onclick=async()=>{
    if(S.user?.role!=='teacher')return toast('只有教師可以核驗並加入題庫。');
    if(!confirm('我已核對題目內容、分類、參考答案、詳解與評分標準，確認將這道題標記為「教師已核驗」並加入題庫。'))return;
    const verified=structuredClone(draft);
    verified.tags=(verified.tags||[]).filter(t=>!/待.*(?:核驗|核验|審核|审核|確認|确认)/.test(t));
    verified.source='AI 生成 · 教師已核驗';
    const target=viewTarget(),dialog=$('.modal'),b=$('#ai-draft-save');b.disabled=true;b.textContent='正在加入題庫…';
    try{
      await api('/api/questions/import',{questions:[verified],teacher:true});
      if(!viewMatches(target)||$('.modal')!==dialog)return;
      const state=await api('/api/state');if(!viewMatches(target)||$('.modal')!==dialog)return;
      S=state;loadBookmarks();shell();closeModal();
      toast('已加入題庫。');
      // 不跳轉到新題：教師留在原本的位置，可以繼續生成或挑下一道參考題。
      if(page==='bank')bank();
    }catch(e){if(viewMatches(target)&&$('.modal')===dialog){b.disabled=false;b.innerHTML=icon('check')+'加入題庫';toast(e.message);}}
  };
}
async function fileData(file,allowed,maxMB){if(!file)throw new Error('請先選擇檔案。');if(!allowed.includes(file.type))throw new Error('不支援此檔案類型，請選擇 PDF、PNG、JPG 或 WebP。');const limit=maxMB||(file.type==='application/pdf'?20:10);if(file.size>limit*1024*1024)throw new Error(`檔案不可超過 ${limit} MB。`);return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('檔案讀取失敗。'));r.readAsDataURL(file);});}
// 題目圖形：優先用教師上傳／貼上的圖片（課本截圖、GeoGebra 匯出等），
// 沒有圖片才用方格畫布的手繪圖。
function figureDataUrl(){if(figImage)return figImage;const c=$('#figure-canvas');return c?imageDataUrl(c):'';}
// ── 學生相片作答：上傳前先在瀏覽器縮圖並轉 WebP ──
// 手機原檔動輒 3～4 MB，直接送上網盤會讓學生在弱網上等很久，也讓空間需求暴增約 20 倍；
// 縮到長邊 1600px 後通常只剩 100～200 KB，批改看得清楚、上傳快、備份也小。
// 原檔上限放寬到 25 MB（壓縮後才送出）；PDF 不壓縮，維持 20 MB 由伺服器讀文字層。
const ANSWER_MAX_SIDE = 1600;
const ANSWER_MAX_MB = 25;
const ANSWER_UPLOAD_LIMIT = 10 * 1024 * 1024;
function dataUrlBytes(value){const i=String(value||'').indexOf(',');return i<0?0:Math.round((value.length-i-1)*3/4);}
function fmtBytes(bytes){return bytes>=1024*1024?`${(bytes/1024/1024).toFixed(1)} MB`:`${Math.max(1,Math.round(bytes/1024))} KB`;}
async function compressImageDataUrl(raw,message){
  const img=await loadImageDataUrl(raw,message);
  const scale=Math.min(1,ANSWER_MAX_SIDE/Math.max(img.naturalWidth,img.naturalHeight));
  const out=document.createElement('canvas');
  out.width=Math.max(1,Math.round(img.naturalWidth*scale));
  out.height=Math.max(1,Math.round(img.naturalHeight*scale));
  const ctx=out.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);
  ctx.drawImage(img,0,0,out.width,out.height);
  return imageDataUrl(out);
}
// iPhone 預設用 HEIC 拍照，Chrome／Firefox 無法解碼（Safari 可以）。
// 先讓瀏覽器自己試（Safari 直接成功，不必下載轉換器）；不行才動態載入
// heic2any（約 1.3 MB，只在真的選到 HEIC 時才下載）轉成 JPEG 再壓縮。
let heicConverter=null;
function isHeicFile(file){
  return /^image\/hei[cf]$/i.test(file.type||'')||/\.(heic|heif)$/i.test(file.name||'');
}
function loadHeicConverter(){
  if(!heicConverter)heicConverter=new Promise((resolve,reject)=>{
    if(window.heic2any)return resolve(window.heic2any);
    const script=document.createElement('script');
    script.src='vendor/heic2any.min.js';
    script.onload=()=>window.heic2any?resolve(window.heic2any):reject(new Error('HEIC 轉換器載入失敗。'));
    script.onerror=()=>reject(new Error('HEIC 轉換器載入失敗，請檢查網路後再試。'));
    document.head.appendChild(script);
  });
  return heicConverter;
}
function readAsDataUrl(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error('檔案讀取失敗。'));
    reader.readAsDataURL(file);
  });
}
async function heicToWebp(file){
  // 先試瀏覽器原生解碼（Safari 支援 HEIC），失敗才用轉換器。
  try{return await compressImageDataUrl(await readAsDataUrl(file),'');}catch{}
  const convert=await loadHeicConverter();
  let out;
  try{out=await convert({blob:file,toType:'image/jpeg',quality:0.92});}
  catch{throw new Error('這張 HEIC 相片無法轉換。可以到 iPhone 設定 → 相機 → 格式改用「最相容」，或用 JPG 重新拍照。');}
  const blob=Array.isArray(out)?out[0]:out;
  return await compressImageDataUrl(await readAsDataUrl(blob),'這張 HEIC 相片無法轉換，請改用 JPG 重新拍照。');
}
// 教師端（題目圖形、圖形工作室、試卷拆題）也要吃 HEIC：只轉格式、不縮圖，
// 尺寸交給各入口自己決定（題目圖形縮到 1400px、拆題原樣送去辨識）。
async function normalizeHeicFile(file){
  if(!isHeicFile(file))return file;
  const jpegName=(file.name||'photo').replace(/\.(heic|heif)$/i,'.jpg');
  // 先試瀏覽器原生解碼（Safari 支援 HEIC），能解就不必下載轉換器。
  try{
    const img=await loadImageDataUrl(await readAsDataUrl(file),'');
    const canvas=document.createElement('canvas');
    canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.95));
    if(blob)return new File([blob],jpegName,{type:'image/jpeg'});
  }catch{}
  const convert=await loadHeicConverter();
  let out;
  try{out=await convert({blob:file,toType:'image/jpeg',quality:0.92});}
  catch{throw new Error('這張 HEIC 相片無法轉換。可以到 iPhone 設定 → 相機 → 格式改用「最相容」，或用 JPG 重新拍照。');}
  const blob=Array.isArray(out)?out[0]:out;
  return new File([blob],jpegName,{type:'image/jpeg'});
}
async function answerImageData(file){
  // HEIC 一定要先轉成通用格式：後端只接受 PNG／JPEG／WebP。
  if(isHeicFile(file))return await heicToWebp(file);
  const raw=await fileData(file,['image/png','image/jpeg','image/webp'],ANSWER_MAX_MB);
  let small=null;
  try{small=await compressImageDataUrl(raw,'這張相片無法辨識，請改用 JPG／PNG 或重新拍照。');}catch{small=null;}
  // 壓縮後反而更大（例如小張線稿 PNG）就保留原檔；原檔超過伺服器 10 MB 上限時仍用壓縮版。
  if(small&&small.length<raw.length)return small;
  if(dataUrlBytes(raw)<=ANSWER_UPLOAD_LIMIT)return raw;
  if(small)return small;
  throw new Error('這張相片無法壓縮，請改用 JPG／PNG 或重新拍照。');
}
// 把選到的圖片縮到合理尺寸再存成 WebP，避免佔用過多題庫空間。
async function fitFigureImage(file){
  // 貼上的圖片與各上傳入口都會走這裡，HEIC 統一先轉成 JPEG（不縮圖，這裡才縮）。
  file=await normalizeHeicFile(file);
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('圖片讀取失敗。'));
    reader.onload=()=>{
      const img=new Image();
      img.onerror=()=>reject(new Error('這個檔案不是可辨識的圖片。'));
      img.onload=()=>{
        const scale=Math.min(1,1400/Math.max(img.naturalWidth,img.naturalHeight));
        const out=document.createElement('canvas');
        out.width=Math.max(1,Math.round(img.naturalWidth*scale));
        out.height=Math.max(1,Math.round(img.naturalHeight*scale));
        const ctx=out.getContext('2d');
        ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);
        ctx.drawImage(img,0,0,out.width,out.height);
        resolve(imageDataUrl(out));
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function renderFigImage(){
  const box=$('#fig-image-preview');
  if(!box)return;
  box.innerHTML=figImage?`<img src="${figImage}" alt="題目圖形預覽"><button type="button" class="text-button" id="fig-image-clear" style="font-size:calc(13px*var(--fs))">移除圖片，改用手繪</button>`:'';
  const wrap=$('.figure-canvas-wrap');if(wrap)wrap.style.display=figImage?'none':'';
  const toolbar=$('#fig-toolbar');if(toolbar)toolbar.style.display=figImage?'none':'';
  const st=$('#fig-status');
  if(st)st.textContent=figImage?'已加入題目圖形圖片，會與題目一併儲存。':'圖形會與題目一併儲存；不畫圖也可直接加入題目。';
  const clr=$('#fig-image-clear');
  if(clr)clr.onclick=()=>{figImage=null;renderFigImage();};
}
// 直接貼上截圖即可作為題目圖形（只在「試卷拆題」的手動輸入區生效）。
document.addEventListener('paste',async e=>{
  if(!$('#fig-upload'))return;
  const item=[...(e.clipboardData?.items||[])].find(it=>it.type&&it.type.startsWith('image/'));
  if(!item)return;
  const file=item.getAsFile();
  if(!file)return;
  e.preventDefault();
  try{figImage=await fitFigureImage(file);renderFigImage();toast('已貼上題目圖形。');}
  catch(err){toast(err.message);}
});
// ── 方格畫布 ──
// 題目圖形工作室與試卷拆題的手動輸入共用同一套繪圖邏輯：
// 自由筆、直線、虛線、圓、點名稱、選擇（移動），加上橡皮／撤銷／清除。
// state = {strokes:[], drawing:null, tool:'pen', selected:null, drag:null, labelSize:26}；
// 每個項目都存 points，橡皮、撤銷與移動才不必為每種圖形各寫一套。
const FIGURE_INK='#1d3b32';
const FIGURE_GRID='#e2ece6';
const FIGURE_PICK='#237c5c';
const FIGURE_HIT=26;
const FIGURE_LABEL_SIZE=26;

function figureLabelFont(size){return `600 ${size||FIGURE_LABEL_SIZE}px system-ui, -apple-system, "Noto Sans TC", sans-serif`;}
// 點名稱的粗略寬高：只用來做命中判定與選取框，不必與實際字型完全一致。
function figureLabelBox(item){
  const p=((item&&item.points)||[])[0];
  if(!p)return null;
  const size=item.size||FIGURE_LABEL_SIZE;
  const halfW=size*0.62*String(item.text||'').length/2+12;
  const halfH=size*0.8+8;
  return {x0:p.x-halfW,y0:p.y-halfH,x1:p.x+halfW,y1:p.y+halfH};
}
// 選取框（圓用圓周、線用兩端、點名稱用文字框）。
function figureItemBounds(item){
  const pts=(item&&item.points)||[];
  if(!pts.length)return null;
  if(item.type==='circle'){
    const c=pts[0],e=pts[1];if(!c||!e)return null;
    const r=Math.hypot(e.x-c.x,e.y-c.y);
    return {x0:c.x-r-8,y0:c.y-r-8,x1:c.x+r+8,y1:c.y+r+8};
  }
  if(item.type==='label')return figureLabelBox(item);
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const p of pts){x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y);}
  return {x0:x0-8,y0:y0-8,x1:x1+8,y1:y1+8};
}

function pointSegmentDistance(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;
  if(len2<1e-9)return Math.hypot(p.x-a.x,p.y-a.y);
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len2));
  return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));
}
// 命中判定：線看線段距離、圓看圓周、點名稱看文字框。橡皮與選取都用這個。
function figureItemHit(item,pts){
  const own=(item&&item.points)||[];
  if(!own.length)return false;
  if(item.type==='circle'){
    const c=own[0],e=own[1];
    if(!c||!e)return false;
    const r=Math.hypot(e.x-c.x,e.y-c.y);
    return pts.some(p=>Math.hypot(p.x-c.x,p.y-c.y)<FIGURE_HIT||Math.abs(Math.hypot(p.x-c.x,p.y-c.y)-r)<FIGURE_HIT);
  }
  if(item.type==='line'){
    const a=own[0],b=own[1]||a;
    return pts.some(p=>pointSegmentDistance(p,a,b)<FIGURE_HIT);
  }
  if(item.type==='label'){
    const box=figureLabelBox(item);
    return !!box&&pts.some(p=>p.x>=box.x0&&p.x<=box.x1&&p.y>=box.y0&&p.y<=box.y1);
  }
  return own.some(q=>pts.some(p=>Math.hypot(p.x-q.x,p.y-q.y)<FIGURE_HIT));
}
// 選取時取最上面（最後畫）的那一項，跟視覺上的前後關係一致。
function topmostFigureItem(strokes,pt){
  // 縮放／旋轉過的項目：先把指標反算回該項的原始座標再比對，
  // 命中範圍才會跟著圖形一起放大／旋轉。
  for(let i=strokes.length-1;i>=0;i--){
    if(figureItemHit(strokes[i],[figureItemLocal(strokes[i],pt)]))return strokes[i];
  }
  return null;
}

// ── 圖形的縮放與旋轉 ────────────────────────────────────────────────
// 每一項圖形可以有自己的 scale（倍率）與 rotate（度），都以「該項自己的中心」為基準。
// 繪製時把畫布變換套上去；命中判定則是把指標位置**反算回該項的原始座標**再比對，
// 所以移動、橡皮、選取都不必為每一種圖形各寫一套。
function figureItemScale(item){const s=Number(item&&item.scale);return Number.isFinite(s)&&s>0?s:1;}
function figureItemRotate(item){const r=Number(item&&item.rotate);return Number.isFinite(r)?r:0;}
function figureItemCenter(item){
  const pts=(item&&item.points)||[];
  if(!pts.length)return null;
  if(item.type==='circle'||item.type==='label')return {x:pts[0].x,y:pts[0].y};
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const p of pts){x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y);}
  return {x:(x0+x1)/2,y:(y0+y1)/2};
}
// 原始座標 → 畫面座標（縮放＋旋轉，繞該項中心）
function figureItemToWorld(item,pt){
  const s=figureItemScale(item),deg=figureItemRotate(item),c=figureItemCenter(item);
  if(!c||(s===1&&!deg))return {x:pt.x,y:pt.y};
  const a=deg*Math.PI/180,dx=(pt.x-c.x)*s,dy=(pt.y-c.y)*s;
  return {x:c.x+dx*Math.cos(a)-dy*Math.sin(a),y:c.y+dx*Math.sin(a)+dy*Math.cos(a)};
}
// 畫面座標 → 原始座標（上面的反運算），命中判定與拖曳起點都用它
function figureItemLocal(item,pt){
  const s=figureItemScale(item),deg=figureItemRotate(item),c=figureItemCenter(item);
  if(!c||(s===1&&!deg))return {x:pt.x,y:pt.y};
  const a=-deg*Math.PI/180,dx=pt.x-c.x,dy=pt.y-c.y;
  const rx=dx*Math.cos(a)-dy*Math.sin(a),ry=dx*Math.sin(a)+dy*Math.cos(a);
  return {x:c.x+rx/s,y:c.y+ry/s};
}
function withItemTransform(ctx,item,draw){
  const s=figureItemScale(item),deg=figureItemRotate(item),c=figureItemCenter(item);
  if(!c||(s===1&&!deg)){draw();return;}
  ctx.save();
  ctx.translate(c.x,c.y);
  if(deg)ctx.rotate(deg*Math.PI/180);
  if(s!==1)ctx.scale(s,s);
  ctx.translate(-c.x,-c.y);
  draw();
  ctx.restore();
}
// 選取框：把原始外框的四個角換算到畫面座標，畫成（可能已旋轉的）四邊形。
function figureSelectionPath(ctx,item){
  const box=figureItemBounds(item);
  if(!box)return false;
  const corners=[[box.x0,box.y0],[box.x1,box.y0],[box.x1,box.y1],[box.x0,box.y1]]
    .map(([x,y])=>figureItemToWorld(item,{x,y}));
  ctx.beginPath();ctx.moveTo(corners[0].x,corners[0].y);
  for(const p of corners.slice(1))ctx.lineTo(p.x,p.y);
  ctx.closePath();
  return true;
}

function paintFigureCanvas(canvas,strokes,selected){
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.setLineDash([]);
  ctx.strokeStyle=FIGURE_GRID;ctx.lineWidth=1;
  for(let x=30;x<canvas.width;x+=30){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();}
  for(let y=30;y<canvas.height;y+=30){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();}
  ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=FIGURE_INK;
  for(const item of strokes){
    const pts=(item&&item.points)||[];
    // 每一項各自的縮放／旋轉（繞該項中心）；沒有調整過的項目完全不變。
    withItemTransform(ctx,item,()=>{
      if(item.type==='label'){
        const p=pts[0];if(!p)return;
        const text=String(item.text||'');
        const size=item.size||FIGURE_LABEL_SIZE;
        ctx.font=figureLabelFont(size);ctx.textAlign='center';ctx.textBaseline='middle';
        const w=ctx.measureText(text).width+10;
        ctx.fillStyle='rgba(255,255,255,.92)';
        ctx.fillRect(p.x-w/2,p.y-size*0.68,w,size*1.36);
        ctx.fillStyle=FIGURE_INK;
        ctx.fillText(text,p.x,p.y);
        return;
      }
      ctx.lineWidth=item.type==='pen'?4:3;
      ctx.setLineDash(item.dashed?[12,9]:[]);
      if(item.type==='circle'){
        const c=pts[0],e=pts[1];if(!c||!e)return;
        const r=Math.hypot(e.x-c.x,e.y-c.y);
        if(r<1)return;
        ctx.beginPath();ctx.arc(c.x,c.y,r,0,Math.PI*2);ctx.stroke();
      }else if(item.type==='line'){
        const a=pts[0],b=pts[1];if(!a||!b)return;
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      }else{
        if(pts.length<2)return;
        ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
        for(const pt of pts.slice(1))ctx.lineTo(pt.x,pt.y);
        ctx.stroke();
      }
    });
  }
  ctx.setLineDash([]);
  // 選取中的圖形畫一個虛線框，讓教師知道拖曳會移動哪一項；
  // 縮放或旋轉過的外框也跟著傾斜／放大，才看得出目前的實際範圍。
  if(selected&&strokes.indexOf(selected)>=0){
    if(figureSelectionPath(ctx,selected)){
      ctx.setLineDash([6,5]);ctx.lineWidth=2;ctx.strokeStyle=FIGURE_PICK;
      ctx.fillStyle='rgba(35,124,92,.08)';
      ctx.fill();ctx.stroke();
      ctx.setLineDash([]);ctx.strokeStyle=FIGURE_INK;
    }
  }
}

// 下一個還沒用到的點名稱（放完 A 自動換 B），連續標頂點時很省事。
function nextFigureLabel(strokes){
  const used=new Set((strokes||[]).filter(x=>x.type==='label').map(x=>String(x.text||'').toUpperCase()));
  for(let i=0;i<26;i++){const ch=String.fromCharCode(65+i);if(!used.has(ch))return ch;}
  return 'A';
}
function newSketch(){return {strokes:[],drawing:null,tool:'pen',selected:null,drag:null,labelSize:FIGURE_LABEL_SIZE};}

// 接上指標事件。拖曳類（直線／虛線／圓）先放進 strokes 再更新終點，
// 拖曳過程就能直接看到預覽；選取工具則是把整項的每個點一起平移。
function wireFigureCanvas(canvas,state,onChange){
  if(!canvas)return null;
  paintFigureCanvas(canvas,state.strokes,state.selected);
  const pos=e=>{const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*canvas.width,y:(e.clientY-r.top)/r.height*canvas.height};};
  const done=()=>{if(onChange)onChange();};
  const paint=()=>paintFigureCanvas(canvas,state.strokes,state.selected);
  const setSelected=item=>{state.selected=item;if(state.onSelect)state.onSelect();};
  canvas.onpointerdown=e=>{
    if(!e.isPrimary&&e.pointerType!=='mouse')return;
    e.preventDefault();
    if(canvas.focus)canvas.focus();
    const pt=pos(e),tool=state.tool;
    if(tool==='select'){
      // 點到圖形就選它並開始拖曳，點空白就取消選取。
      const hit=topmostFigureItem(state.strokes,pt);
      setSelected(hit);
      state.drag=hit?{last:pt}:null;
      paint();done();
      try{canvas.setPointerCapture(e.pointerId);}catch(_){}
      return;
    }
    if(tool==='label'){
      state.strokes.push({type:'label',points:[pt],text:(state.labelText&&state.labelText())||'A',
                          size:state.labelSize||FIGURE_LABEL_SIZE});
      if(state.onLabelPlaced)state.onLabelPlaced();
      paint();done();return;
    }
    if(tool==='eraser'){state.drawing={type:'eraser',points:[pt]};}
    else{
      const item=tool==='line'?{type:'line',dashed:false,points:[pt,pt]}
        :tool==='dashed'?{type:'line',dashed:true,points:[pt,pt]}
        :tool==='circle'?{type:'circle',points:[pt,pt]}
        :{type:'pen',points:[pt]};
      state.strokes.push(item);
      state.drawing=item;
    }
    try{canvas.setPointerCapture(e.pointerId);}catch(_){}
  };
  canvas.onpointermove=e=>{
    const pt=pos(e);
    if(state.drag&&state.selected){
      const item=state.selected;
      // 縮放／旋轉過的項目：先把螢幕位移換算回該項的原始座標系（反旋轉、再除以倍率），
      // 拖曳方向才會與眼睛看到的一致。
      const s=figureItemScale(item),deg=figureItemRotate(item);
      let dx=pt.x-state.drag.last.x,dy=pt.y-state.drag.last.y;
      if(deg){const a=-deg*Math.PI/180,rx=dx*Math.cos(a)-dy*Math.sin(a),ry=dx*Math.sin(a)+dy*Math.cos(a);dx=rx;dy=ry;}
      if(s!==1){dx/=s;dy/=s;}
      item.points.forEach(p=>{p.x+=dx;p.y+=dy;});
      state.drag.last=pt;
      paint();return;
    }
    const d=state.drawing;if(!d)return;
    if(d.type==='line'||d.type==='circle')d.points[1]=pt;else d.points.push(pt);
    paint();
  };
  canvas.onpointerup=canvas.onpointercancel=()=>{
    if(state.drag){state.drag=null;done();return;}
    const d=state.drawing;if(!d)return;
    state.drawing=null;
    if(d.type==='eraser'){
      state.strokes=state.strokes.filter(item=>!figureItemHit(item,d.points));
      if(state.selected&&state.strokes.indexOf(state.selected)<0)setSelected(null);
    }else if(d.type==='line'){
      const a=d.points[0],b=d.points[1];
      if(Math.hypot(b.x-a.x,b.y-a.y)<6)state.strokes=state.strokes.filter(x=>x!==d);
    }else if(d.type==='circle'){
      const c=d.points[0],edge=d.points[1];
      if(Math.hypot(edge.x-c.x,edge.y-c.y)<6)state.strokes=state.strokes.filter(x=>x!==d);
    }else if(d.points.length<2){
      state.strokes=state.strokes.filter(x=>x!==d);
    }
    paint();done();
  };
  // Delete／Backspace 刪掉選取中的圖形（畫布要能取得焦點才收得到鍵盤事件）。
  canvas.onkeydown=e=>{
    if((e.key!=='Delete'&&e.key!=='Backspace')||!state.selected)return;
    e.preventDefault();
    state.strokes=state.strokes.filter(x=>x!==state.selected);
    setSelected(null);
    paint();done();
  };
  return {
    undo(){
      if(!state.strokes.length)return false;
      const removed=state.strokes.pop();
      if(state.selected===removed)setSelected(null);
      paint();done();return true;
    },
    clear(){state.strokes=[];setSelected(null);paint();done();},
    repaint(){paint();}
  };
}

// 工具列（兩處共用）：scope 只用來組 id（fig／fig-studio），兩邊不會互相打架。
function figureToolbarHtml(scope,hint){
  return `<div class="writing-toolbar" id="${scope}-toolbar"><div class="tool-group">
    <button type="button" class="icon-btn active" data-tool="pen" aria-label="自由筆">${icon('practice')}</button>
    <button type="button" class="icon-btn" data-tool="line" aria-label="直線">${icon('line')}</button>
    <button type="button" class="icon-btn" data-tool="dashed" aria-label="虛線">${icon('dashed')}</button>
    <button type="button" class="icon-btn" data-tool="circle" aria-label="圓">${icon('circle')}</button>
    <button type="button" class="icon-btn" data-tool="label" aria-label="加入點名稱">${icon('label')}</button>
    <button type="button" class="icon-btn" data-tool="select" aria-label="選擇並移動">${icon('select')}</button>
    <span style="height:20px;border-right:1px solid var(--border);margin:0 4px"></span>
    <button type="button" class="icon-btn" data-tool="eraser" aria-label="橡皮擦">${icon('eraser')}</button>
    <button type="button" class="icon-btn" id="${scope}-undo" aria-label="撤銷">${icon('undo')}</button>
    <button type="button" class="icon-btn" id="${scope}-clear" aria-label="清除">${icon('trash')}</button>
    <span class="label-name-field" id="${scope}-label-field">點名稱<input id="${scope}-label-text" maxlength="4" value="A" aria-label="點名稱">字級<input id="${scope}-label-size" type="range" min="16" max="48" step="2" value="26" aria-label="字母大小"><span class="label-size-value" id="${scope}-label-size-value">26</span></span>
    <span class="item-transform-field" id="${scope}-transform-field" title="先用「選擇」點一下圖形，再拖這裡調整">縮放<input id="${scope}-item-scale" type="range" min="40" max="250" step="5" value="100" aria-label="所選圖形縮放" disabled><span class="label-size-value" id="${scope}-item-scale-value">—</span>旋轉<input id="${scope}-item-rotate" type="range" min="-180" max="180" step="5" value="0" aria-label="所選圖形旋轉" disabled><span class="label-size-value" id="${scope}-item-rotate-value">—</span></span>
  </div><span class="small-text">${esc(hint||'拖曳畫直線／虛線／圓；選「點名稱」再點畫布放置；選「選擇」可拖曳移動、用「縮放／旋轉」調整大小與角度，按 Delete 刪除')}</span></div>`;
}

// 接上工具列：切換工具、點名稱與字級、撤銷與清除。
function wireFigureTools(scope,canvas,state,onChange){
  const bar=$('#'+scope+'-toolbar');
  const tools=bar?[...bar.querySelectorAll('[data-tool]')]:[];
  const labelField=$('#'+scope+'-label-field');
  const labelInput=$('#'+scope+'-label-text');
  const sizeInput=$('#'+scope+'-label-size');
  const sizeValue=$('#'+scope+'-label-size-value');
  const scaleInput=$('#'+scope+'-item-scale');
  const scaleValue=$('#'+scope+'-item-scale-value');
  const rotateInput=$('#'+scope+'-item-rotate');
  const rotateValue=$('#'+scope+'-item-rotate-value');
  const tools2=wireFigureCanvas(canvas,state,onChange);
  const repaint=()=>{if(tools2)tools2.repaint();};
  const selectedLabel=()=>state.selected&&state.selected.type==='label'?state.selected:null;
  const sync=()=>{
    tools.forEach(b=>b.classList.toggle('active',b.dataset.tool===state.tool));
    // 點名稱／字級欄位固定顯示（切換顯示會讓工具列忽高忽低、畫布跟著跳位）；
    // 選取了某個點名稱時，欄位就代表那一項，可以直接改名與改字級。
    const chosen=selectedLabel();
    if(labelInput&&chosen)labelInput.value=chosen.text||'A';
    if(sizeInput){
      const size=chosen?(chosen.size||state.labelSize):state.labelSize;
      sizeInput.value=String(size);
      if(sizeValue)sizeValue.textContent=String(size);
    }
    // 縮放／旋轉欄位同樣固定顯示：沒選取時停用並顯示「—」，
    // 選取了圖形就代表那一項的目前倍率與角度。
    const sel=state.selected;
    if(scaleInput){
      scaleInput.disabled=!sel;
      scaleInput.value=String(Math.round(figureItemScale(sel)*100));
      if(scaleValue)scaleValue.textContent=sel?`${Math.round(figureItemScale(sel)*100)}%`:'—';
    }
    if(rotateInput){
      rotateInput.disabled=!sel;
      rotateInput.value=String(Math.round(figureItemRotate(sel)));
      if(rotateValue)rotateValue.textContent=sel?`${Math.round(figureItemRotate(sel))}°`:'—';
    }
  };
  state.labelText=()=>(labelInput&&labelInput.value.trim())||'A';
  state.onLabelPlaced=()=>{if(labelInput)labelInput.value=nextFigureLabel(state.strokes);};
  tools.forEach(b=>b.onclick=()=>{
    state.tool=b.dataset.tool;
    if(state.tool!=='select')state.selected=null;
    sync();repaint();
  });
  if(labelInput)labelInput.oninput=()=>{
    const chosen=selectedLabel();
    if(chosen){chosen.text=state.labelText();repaint();}
  };
  if(sizeInput)sizeInput.oninput=()=>{
    const size=Number(sizeInput.value)||FIGURE_LABEL_SIZE;
    state.labelSize=size;
    if(sizeValue)sizeValue.textContent=String(size);
    const chosen=selectedLabel();
    if(chosen){chosen.size=size;repaint();}
  };
  if(scaleInput)scaleInput.oninput=()=>{
    const sel=state.selected;if(!sel)return;
    sel.scale=Math.max(0.4,Math.min(2.5,Number(scaleInput.value)/100));
    if(scaleValue)scaleValue.textContent=`${Math.round(sel.scale*100)}%`;
    repaint();
  };
  if(rotateInput)rotateInput.oninput=()=>{
    const sel=state.selected;if(!sel)return;
    sel.rotate=Math.max(-180,Math.min(180,Number(rotateInput.value)));
    if(rotateValue)rotateValue.textContent=`${Math.round(sel.rotate)}°`;
    repaint();
  };
  state.onSelect=sync;
  sync();
  const undo=$('#'+scope+'-undo'),clear=$('#'+scope+'-clear');
  if(undo)undo.onclick=()=>{if(!tools2.undo())toast('沒有可撤銷的線條。');};
  if(clear)clear.onclick=()=>tools2.clear();
  return tools2;
}

function drawFigure(){paintFigureCanvas($('#figure-canvas'),figSketch?figSketch.strokes:[],figSketch?figSketch.selected:null);}
function initFigureCanvas(){
  const c=$('#figure-canvas');if(!c)return;
  figSketch=newSketch();
  figCanvasTools=wireFigureTools('fig',c,figSketch,()=>{
    const st=$('#fig-status');
    if(st)st.textContent=figSketch.strokes.length?'已繪製圖形，會與題目一併儲存。':'圖形已清空；不畫圖也可直接加入題目。';
  });
}
// 拆題步驟可以點回上一步：走錯了不必從頭再匯入一次。
// 只開放「第二步 → 第一步」——第三步已經寫進題庫，再往回走會讓同一批題目被匯入兩次。
function goToImportStep(n){
  if(importStage!==2||n!==1)return;
  if(drafts.length&&!confirm(`回到「匯入試卷」會清掉已拆分的 ${drafts.length} 道題目，確定嗎？`))return;
  drafts=[];importMethod='';importStage=1;
  importPage();
  toast('已回到第一步。');
}
function importPage(){page='import';shell();if(!S.user)return loginModal(importPage);if(importStage===1)figImage=null;if(S.user.role!=='teacher'){$('#main').innerHTML=heading('TEACHER WORKSPACE','試卷拆題','把一份試卷，變成可持續練習的知識庫。')+`<section class="panel">${empty('試卷匯入只限教師','學生可在題庫開始練習；教師可拆題、核驗及匯入新題。',`<button class="primary" data-page="bank">前往數學題庫 ${icon('arrow')}</button>`)}</section>`;return;}
$('#main').innerHTML=`<div class="fade-in">${heading('PAPER TO PRACTICE','試卷拆題','匯入試卷，自動分割題目與分類；確認後，建立校本題庫。')}<div class="import-layout"><section class="panel import-panel"><div class="stepper">${[[1,'匯入試卷'],[2,'拆題與核驗'],[3,'確認入庫']].map(([n,t])=>`<button type="button" class="step ${importStage===n?'active':''}${n<importStage?' done':''}" data-import-step="${n}"${n===1&&importStage===2?'':' disabled'}${importStage===n?' aria-current="step"':''}><span>${n}</span>${t}</button>`).join('')}</div><div id="import-content"></div></section><div class="right-stack"><section class="panel right-panel"><h2>${icon('file')}從試卷到學習路徑</h2><ul class="feature-list"><li><strong>${icon('import')}拆分獨立題目</strong>按題號辨識主題，子題保留在原題內；先預覽再匯入。</li><li><strong>${icon('bank')}建立知識分類</strong>分類、難度與參考答案均可修改，教師保有最後決定權。</li><li><strong>${icon('spark')}鞏固與加深</strong>同知識點題庫推薦，AI 接入後可生成變式與進階題。</li></ul></section><section class="panel right-panel tip-panel"><h2>${icon('lock')}資料與辨識說明</h2><p>文字型 PDF 直接提取文字。<br>掃描版 PDF 會由伺服器逐頁轉成圖片，連同照片一起交給視覺 AI 識別；未接入視覺 AI 時請貼上題目文字。<br><br>辨識、分類及 AI 答案皆需教師核验，不能直接作正式評核。</p></section></div></div></div>`;$$('[data-import-step]').forEach(b=>b.onclick=()=>goToImportStep(Number(b.dataset.importStep)));renderImportContent();}
// ── AI 生成答案（答案／詳解／詳細解釋／評分標準）──
async function aiGenerateForQuestion(payload, consent){
  return api('/api/questions/ai-answer', {...payload, consentExternal: !!consent});
}
function aiConfirmExternal(){
  if(S.ai.mode !== 'external') return true;
  return window.confirm('將題目內容傳送到外部 AI 產生答案與評分標準，是否繼續？');
}
function applyAiAnswer(target, r){
  if(r.answer) target.answer = r.answer;
  target.steps = r.steps || [];
  target.analysis = r.analysis || '';
  const arr = Array.isArray(target.rubric) ? target.rubric : (target.rubric = []);
  arr.length = 0;
  (r.rubric || []).forEach(x => arr.push(x));
  return arr;
}
async function aiFillDraft(i, btn){
  const q = drafts[i];
  if(!q) return;
  if(!(q.content || '').trim()) return toast('請先填寫題目內容，AI 才能生成答案。');
  if(!S.ai.configured) return toast('AI 尚未設定：請先設定模型端點，或手動填寫答案。');
  if(!aiConfirmExternal()) return;
  const old = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = icon('clock') + 'AI 生成中…';
  try{
    const r = await aiGenerateForQuestion({title:q.title||'', content:q.content, qtype:q.qtype||'',
      options:q.options||[], points:Number(q.points)||5, topic:q.topic||'', subtopic:q.subtopic||''}, true);
    applyAiAnswer(q, r);
    if(!(q.options||[]).length && (r.options||[]).length){ q.options = r.options; q.qtype = '選擇題'; }
    renderImportContent();
    toast('AI 已生成答案、詳解、詳細解釋與評分標準，請核驗後匯入。');
  }catch(e){ toast(e.message); btn.disabled = false; btn.innerHTML = old; }
}
async function aiFillQuestion(prefix, state, btn){
  const el=id=>$('#'+prefix+'-'+id);
  const content = el('content').value.trim();
  if(!content) return toast('請先填寫題目內容，AI 才能生成答案。');
  if(!S.ai.configured) return toast('AI 尚未設定：請先設定模型端點，或手動填寫答案。');
  if(!aiConfirmExternal()) return;
  const qtype = el('qtype').value;
  const old = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = icon('clock') + 'AI 生成中…';
  try{
    const r = await aiGenerateForQuestion({title:el('title').value.trim(), content, qtype,
      options: qtype==='選擇題' ? state.options.map(o=>String(o||'').trim()).filter(Boolean) : [],
      points: Number(el('points').value)||5,
      topic: el('topic').value, subtopic: el('subtopic').value}, true);
    if(r.answer) el('answer').value = r.answer;
    el('steps').value = (r.steps||[]).join('\n');
    el('analysis').value = r.analysis || '';
    if(qtype==='選擇題' && (r.options||[]).length && !state.options.filter(Boolean).length){
      state.options.length = 0; r.options.forEach(o=>state.options.push(o)); renderQuestionOptions(prefix, state);
    }
    const store = rubricStores.get(prefix);
    const items = store ? store.items : null;
    if(items){ items.length = 0; (r.rubric||[]).forEach(x=>items.push(x)); }
    rubricRender(prefix);
    toast('AI 已生成答案、詳解、詳細解釋與評分標準，請核驗後加入題目。');
  }catch(e){ toast(e.message); }
  finally{ btn.disabled = false; btn.innerHTML = old; }
}
// ── 教師手動新增題目 ──
// 不必先匯入整份試卷：填好欄位、加上圖形，按「建立題目」就直接進題庫。
// 圖形用題目圖形工作室（AI 生成／核對／手繪／上傳都在同一個地方）；
// 工作室是彈窗，關掉之後這一頁的表單內容還在，不會被清掉。
let newQuestionFigure='';
function renderNewQuestionFigure(){
  const box=$('#newq-figure-preview');if(!box)return;
  box.innerHTML=newQuestionFigure?`<img src="${newQuestionFigure}" alt="題目圖形預覽">`:'';
}
function newQuestionPage(){
  page='newq';shell();
  if(!S.user)return loginModal(newQuestionPage);
  if(S.user.role!=='teacher'){
    $('#main').innerHTML=heading('NEW QUESTION','新增題目','新增題目只限教師。')+`<section class="panel">${empty('此頁只限教師','教師可以在這裡直接建立題目並存入題庫。',`<button class="primary" data-page="bank">前往數學題庫 ${icon('arrow')}</button>`)}</section>`;
    return;
  }
  newQuestionFigure='';
  const state={options:[],rubric:[]};
  $('#main').innerHTML=`<div class="fade-in">${heading('NEW QUESTION','新增題目','不必先匯入整份試卷，直接建立一道題目；圖形可以用 AI 生成、自己手繪或上傳圖片。')}<div class="import-layout"><section class="panel import-panel"><div class="form-field"><label class="field-label">題目圖形（可選）</label><div class="fig-source-row"><button type="button" class="secondary" id="newq-figure-btn">${icon('image')}開啟題目圖形</button><button type="button" class="secondary" id="newq-figure-clear">移除圖形</button><span class="small-text">AI 生成、核對、手繪、貼上或上傳圖片都在同一個工作室</span></div><div id="newq-figure-preview" class="fig-image-preview"></div></div>${questionFormHtml('newq',{submitLabel:'建立題目'})}</section><div class="right-stack"><section class="panel right-panel"><h2>${icon('bulb')}出題小提示</h2><ul class="feature-list"><li><strong>${icon('spark')}AI 生成答案</strong>填好題目內容後可按「AI 生成答案與評分標準」，產生的內容仍可自行修改。</li><li><strong>${icon('image')}題目圖形</strong>AI 畫得不對時，可以在工作室裡直接手繪，也可以上傳課本截圖或貼上圖片。</li><li><strong>${icon('check')}建立之後</strong>題目直接進入題庫，可以立即用來佈置作業或讓學生練習。</li></ul></section></div></div></div>`;
  renderNewQuestionFigure();
  $('#newq-figure-btn').onclick=()=>openFigureStudio({
    title:$('#newq-title').value.trim(),content:$('#newq-content').value.trim(),
    topic:$('#newq-topic').value,subtopic:$('#newq-subtopic').value,qtype:$('#newq-qtype').value,
    figure:newQuestionFigure||'',
    apply:async figure=>{newQuestionFigure=figure||'';closeModal();renderNewQuestionFigure();
      toast(figure?'已設定題目圖形。':'已移除題目圖形。');}});
  $('#newq-figure-clear').onclick=()=>{newQuestionFigure='';renderNewQuestionFigure();toast('已移除題目圖形。');};
  wireQuestionForm('newq',state,{figure:()=>newQuestionFigure||undefined,onSubmit:async draft=>{
    const btn=$('#newq-add');
    btn.disabled=true;btn.textContent='正在建立…';
    try{
      await api('/api/questions/import',{questions:[draft]});
      await refresh();bank();
      toast(`已新增題目「${draft.title}」，可以直接用來佈置作業。`);
    }catch(e){
      btn.disabled=false;btn.innerHTML=icon('check')+'建立題目';
      $('#newq-error').textContent=e.message;
    }
  }});
}

// ── 題目表單（試卷拆題的手動輸入 與 題庫的「新增題目」共用） ──
// prefix 用來組出欄位 id（manual／newq）；兩處不會同時出現在畫面上。
function questionFormHtml(prefix, opts){
  const o=opts||{};
  const qtype=o.qtype||'選擇題';
  return `<div class="form-grid">
    <div class="form-field"><label class="field-label" for="${prefix}-title">題目標題</label><input id="${prefix}-title" maxlength="200" placeholder="例如：直角三角形求斜邊"></div>
    <div class="form-field"><label class="field-label" for="${prefix}-topic">知識分類</label><select id="${prefix}-topic">${topics.map(t=>`<option>${t}</option>`).join('')}</select></div>
    <div class="form-field"><label class="field-label" for="${prefix}-subtopic">子分類</label><select id="${prefix}-subtopic"></select></div>
    <div class="form-field"><label class="field-label" for="${prefix}-grade">年級</label><select id="${prefix}-grade">${grades.map(g=>`<option${g==='中三'?' selected':''}>${g}</option>`).join('')}</select></div>
    <div class="form-field"><label class="field-label" for="${prefix}-level">難度</label><select id="${prefix}-level">${[1,2,3].map(n=>`<option value="${n}">${levels[n]}</option>`).join('')}</select></div>
    <div class="form-field"><label class="field-label" for="${prefix}-qtype">題型</label><select id="${prefix}-qtype">${qtypes.map(t=>`<option>${t}</option>`).join('')}</select></div>
    <div class="form-field"><label class="field-label" for="${prefix}-points">分值</label><input id="${prefix}-points" type="number" min="1" max="100" value="5"></div>
  </div>
  <div class="form-field"><label class="field-label" for="${prefix}-content">題目內容</label><textarea class="answer-field import-text" id="${prefix}-content" maxlength="79000" placeholder="例如：直角三角形兩條直角邊長為 3 cm 和 4 cm，求斜邊長。"></textarea></div>
  <div class="form-field" id="${prefix}-options-field" style="display:none"><label class="field-label">選項（選擇題 · 可增刪修改）<span class="small-text" style="font-weight:400">　2 至 10 個，學生作答時可直接點選</span></label><div class="option-list" id="${prefix}-options"></div><div class="option-actions"><button type="button" class="text-button" id="${prefix}-add-option">＋ 新增選項</button></div><div class="math-preview" id="${prefix}-options-preview"></div></div>
  <div class="form-grid"><div class="form-field"><label class="field-label" for="${prefix}-answer">參考答案（可留空）</label><input id="${prefix}-answer" maxlength="4000" placeholder="例如：5 cm"></div><div class="form-field"><label class="field-label" for="${prefix}-hint">解題提示</label><input id="${prefix}-hint" maxlength="4000" placeholder="例如：用畢氏定理"></div></div>
  <div class="form-field"><label class="field-label" for="${prefix}-steps">詳解步驟（每行一步）<span class="small-text" style="font-weight:400">　支援 LaTeX：$x^2-5x+6=0$</span></label><textarea class="answer-field import-text" id="${prefix}-steps" maxlength="40000" placeholder="第一步：設未知數…&#10;第二步：列式…&#10;第三步：求解並檢查…"></textarea></div>
  <div class="form-field"><label class="field-label" for="${prefix}-analysis">詳細解釋（考點 · 解題思路 · 常見錯誤）</label><textarea class="answer-field import-text" id="${prefix}-analysis" maxlength="6000" placeholder="說明本題考什麼、解題關鍵與容易出錯的地方。"></textarea></div>
  ${rubricFieldHtml(prefix, [], qtype)}
  <div class="ai-answer-row"><button type="button" class="secondary" id="${prefix}-ai-answer">${icon('spark')}AI 生成答案與評分標準</button><span class="small-text">依題目內容自動產生答案、詳解、詳細解釋與評分標準百分比（可再修改）</span></div>
  ${o.figureHtml||''}
  <p class="error-text" id="${prefix}-error"></p>
  <button class="secondary wide" id="${prefix}-add">${icon('check')}${o.submitLabel||'加入題目'}</button>`;
}

// 選擇題的選項編輯（可增刪、即時預覽）。
function renderQuestionOptions(prefix, state){
  const box=$('#'+prefix+'-options');if(!box)return;
  box.innerHTML=state.options.map((o,j)=>`<div class="option-row"><span class="option-letter">${OPTION_LETTERS[j]}</span><input value="${esc(o)}" maxlength="600" data-option-index="${j}" placeholder="選項 ${OPTION_LETTERS[j]}"><button type="button" class="icon-btn" data-option-drop="${j}" aria-label="刪除選項 ${OPTION_LETTERS[j]}">${icon('trash')}</button></div>`).join('');
  const preview=$('#'+prefix+'-options-preview');if(preview)preview.innerHTML=optionsPreviewHtml(state.options);
  box.querySelectorAll('[data-option-index]').forEach(inp=>inp.addEventListener('input',e=>{
    state.options[Number(e.target.dataset.optionIndex)]=e.target.value;
    const p=$('#'+prefix+'-options-preview');if(p)p.innerHTML=optionsPreviewHtml(state.options);
  }));
  box.querySelectorAll('[data-option-drop]').forEach(b=>b.addEventListener('click',()=>{
    state.options.splice(Number(b.dataset.optionDrop),1);renderQuestionOptions(prefix,state);
  }));
}

// 接上題目表單：分類連動、選項編輯、AI 生成答案、評分標準、送出。
// state = {options:[], rubric:[]}；圖形由呼叫端自己處理（兩邊的圖形來源不同）。
function wireQuestionForm(prefix, state, opts){
  const o=opts||{};
  const el=id=>$('#'+prefix+'-'+id);
  const syncSub=()=>{const sel=el('subtopic');if(!sel)return;const cur=sel.value;
    sel.innerHTML=subtopicsOf(el('topic').value).map(v=>`<option${v===cur?' selected':''}>${esc(v)}</option>`).join('');};
  el('topic').onchange=syncSub;syncSub();
  if(el('add-option'))el('add-option').onclick=()=>{
    if(state.options.length>=OPTION_LETTERS.length)return toast(`最多 ${OPTION_LETTERS.length} 個選項。`);
    state.options.push('');renderQuestionOptions(prefix,state);
    const box=el('options'),last=box&&box.querySelector('input:last-of-type');if(last)last.focus();
  };
  el('qtype').addEventListener('change',e=>{
    const isChoice=e.target.value==='選擇題';
    const field=el('options-field');if(field)field.style.display=isChoice?'block':'none';
    if(isChoice&&!state.options.length){state.options=['','','',''];renderQuestionOptions(prefix,state);}
    // 選擇題／填空題是客觀題，隱藏評分標準（也不需要 AI 評分步驟）。
    toggleRubricField(prefix,e.target.value);
  });
  renderQuestionOptions(prefix,state);
  rubricBind(prefix,state.rubric);
  if(el('ai-answer'))el('ai-answer').onclick=()=>aiFillQuestion(prefix,state,el('ai-answer'));
  el('add').onclick=()=>{
    const title=el('title').value.trim(),content=el('content').value.trim();
    if(!title)return el('error').textContent='請填寫題目標題。';
    if(!content)return el('error').textContent='請填寫題目內容。';
    el('error').textContent='';
    const qtype=el('qtype').value;
    o.onSubmit({title,content,topic:el('topic').value,subtopic:el('subtopic').value,
      level:Number(el('level').value),grade:el('grade').value,qtype,
      points:Number(el('points').value)||5,answer:el('answer').value.trim(),
      steps:el('steps').value.split('\n').map(x=>x.trim()).filter(Boolean),
      analysis:el('analysis').value.trim(),
      rubric:isObjectiveQtype(qtype)?[]:cleanRubric(state.rubric),
      options:qtype==='選擇題'?state.options.map(x=>String(x||'').trim()).filter(Boolean):[],
      hint:el('hint').value.trim(),source:o.source||'手動輸入',tags:[],
      figure:o.figure?o.figure():undefined});
  };
}

const manualState={options:[],rubric:[]};

// ── 編輯題目（教師） ────────────────────────────────────────────────
// 把題目的現有值載入表單。questionFormHtml 只產生空表單，值要在這裡補。
function fillQuestionForm(prefix, q, state){
  const el=id=>$('#'+prefix+'-'+id);
  if(!el('title'))return;
  el('title').value=q.title||'';
  el('topic').value=topics.includes(q.topic)?q.topic:topics[0];
  if(el('topic').onchange)el('topic').onchange();   // 依主分類重算子分類選項
  el('subtopic').value=q.subtopic||'';
  el('grade').value=grades.includes(q.grade)?q.grade:'中三';
  el('level').value=String(q.level||1);
  el('points').value=String(q.points||5);
  el('content').value=q.content||'';
  el('answer').value=q.answer||'';
  el('hint').value=q.hint||'';
  el('steps').value=(q.steps||[]).join('\n');
  el('analysis').value=q.analysis||'';
  state.options=(q.options||[]).slice();
  state.rubric=(q.rubric||[]).map(r=>({label:String((r&&r.label)||''),percent:Number((r&&r.percent)||0)}));
  renderQuestionOptions(prefix,state);
  rubricBind(prefix,state.rubric);
  el('qtype').value=q.qtype||'解答題';
  // 觸發 change：選擇題才顯示選項欄，客觀題隱藏評分標準。
  el('qtype').dispatchEvent(new Event('change',{bubbles:true}));
}

// 編輯題目：教師可以改所有設定，含題解、評分標準與圖形。
// 圖形只有在真的動過（換圖或移除）時才送出，否則保留題庫裡原本那張。
function editQuestionModal(id){
  const q=S.questions.find(x=>x.id===Number(id));
  if(!q)return toast('找不到題目，請重新整理題庫。');
  const state={options:[],rubric:[]};
  const hasFigure=!!q.figure;
  let picked=null;      // 新選的圖形 dataURL；null＝沒動過
  let removed=false;    // 有沒有按過「移除圖形」
  const figureHtml=`<div class="form-field"><label class="field-label">題目圖形（可選）</label>
    <div class="fig-source-row">
      <label class="secondary fig-upload" for="editq-fig-upload">${icon('image')}${hasFigure?'換一張圖形':'加入圖形'}<input id="editq-fig-upload" type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif" hidden></label>
      <button type="button" class="secondary" id="editq-fig-remove">移除圖形</button>
      <span class="small-text">不動它的話，原本的圖形會保留。</span>
    </div>
    <div id="editq-fig-preview" class="fig-image-preview"></div>
    <p class="field-hint" id="editq-fig-status"></p></div>`;
  modal(`<h2>編輯題目</h2><p class="field-hint">修改後直接更新題庫。已經批閱過的分數不變，但學生之後看到的題目會是新的版本。</p>${questionFormHtml('editq',{submitLabel:'儲存修改',figureHtml})}`,true);
  const el=id=>$('#editq-'+id);
  const paintFigure=()=>{
    const box=$('#editq-fig-preview');
    const src=picked||(!removed&&hasFigure?q.figure:'');
    if(box)box.innerHTML=src?`<img src="${src}" alt="題目圖形預覽">`:'';
    const st=$('#editq-fig-status');
    if(st)st.textContent=picked?'已選擇新的圖形，儲存後會取代原本的圖。'
      :removed?'儲存後會移除圖形。'
      :hasFigure?'目前使用題庫中的圖形。':'這道題目前沒有圖形。';
    const btn=$('#editq-fig-remove');if(btn)btn.disabled=!(picked||(!removed&&hasFigure));
  };
  paintFigure();
  const input=$('#editq-fig-upload');
  if(input)input.onchange=async e=>{
    const f=await normalizeHeicFile(e.target.files[0]);
    if(!f)return;
    if(!/^image\/(png|jpeg|webp)$/.test(f.type))return toast('請選擇 PNG、JPG、WebP 或 HEIC 圖片。');
    if(f.size>4*1024*1024)return toast('圖片不可超過 4 MB，請先裁剪或壓縮。');
    try{picked=await fitFigureImage(f);removed=false;paintFigure();}
    catch(err){toast(err.message);}
  };
  const rm=$('#editq-fig-remove');
  if(rm)rm.onclick=()=>{picked=null;removed=true;paintFigure();};
  wireQuestionForm('editq',state,{
    figure:()=>picked||undefined,
    onSubmit:async draft=>{
      const body={question:draft};
      // 只有真的動過圖形才送 figure：送空字串＝移除，完全沒送＝保留原圖。
      if(picked)body.figure=picked;
      else if(removed)body.figure='';
      const btn=el('add');
      if(btn)btn.disabled=true;
      try{
        const {question}=await api(`/api/questions/${q.id}/update`,body);
        const i=S.questions.findIndex(x=>x.id===q.id);
        if(i>=0)S.questions[i]={...S.questions[i],...question};
        closeModal();bank();toast('已更新題目。');
      }catch(err){
        el('error').textContent=err.message;
        if(btn)btn.disabled=false;
      }
    }});
  fillQuestionForm('editq',q,state);
}

function renderImportContent(){const r=$('#import-content');if(importStage===1){
  const manualFigureHtml=`<div class="form-field"><label class="field-label">題目圖形（可選）</label><div class="fig-source-row"><label class="secondary fig-upload" for="fig-upload">${icon('image')}上傳圖形圖片<input id="fig-upload" type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif" hidden></label><span class="small-text">可直接貼上截圖（Ctrl/⌘+V）；上傳後會取代手繪圖，最多 4 MB。</span></div><div id="fig-image-preview" class="fig-image-preview"></div>${figureToolbarHtml('fig','在方格上畫出三角形、坐標軸等圖形：拖曳畫直線／虛線／圓，選「點名稱」再點畫布放置，選「選擇」可拖曳移動、並用「縮放／旋轉」調整大小與角度')}<div class="canvas-wrap figure-canvas-wrap"><canvas id="figure-canvas" width="900" height="420" tabindex="0" aria-label="題目圖形畫布"></canvas></div><p class="field-hint" id="fig-status">圖形會與題目一併儲存；不畫圖也可直接加入題目。</p></div>`;
  const manualForm=questionFormHtml('manual',{submitLabel:'加入這道題目',figureHtml:manualFigureHtml});r.innerHTML=`<div class="form-field"><label class="field-label" for="paper-name">試卷名稱</label><input id="paper-name" value="${esc(paperName)}" placeholder="例如：中三數學 · 第一學期測驗" maxlength="200"></div><label class="dropzone" id="paper-drop">${icon('upload')}<strong id="paper-filename">${paperFile?esc(paperFile.name):'點擊或拖入試卷檔案'}</strong><small>文字型 PDF / PNG / JPG · 最多 10 MB · 掃描版 PDF 自動逐頁轉圖 · 圖片會自動框出題目圖形並裁到題目右邊</small><input type="file" id="paper-upload" accept="application/pdf,image/png,image/jpeg,image/heic,image/heif,.heic,.heif" hidden></label><div class="divider-text"><span>或直接貼上題目文字</span></div><label class="field-label" for="paper-text">試卷內容<span class="small-text" style="font-weight:400">　數學式可用 LaTeX：$x^2-5x+6=0$、$\\frac{1}{2}$、$\\sqrt{3}$</span></label><textarea class="answer-field import-text" id="paper-text" placeholder="1. 解方程 $x^2-5x+6=0$。\n\n2. 直角三角形兩邊長為 $3\\text{cm}$ 及 $4\\text{cm}$，求斜邊長。\n\n3. 擲一枚公平骰子，求點數大於 4 的概率。" maxlength="79000">${esc(paperText)}</textarea><button class="text-button" id="sample-paper" style="font-size:calc(14px*var(--fs));margin-top:12px">填入示例試卷 ${icon('arrow')}</button>${S.ai.mode==='external'?`<label class="checkbox-line"><input type="checkbox" id="paper-consent">允許將試卷傳送到學校配置的外部 AI（未同意時，文字只用本地規則處理）</label>`:''}<div id="parse-error"></div><div class="submit-row"><span class="small-text">${S.ai.configured?'可用 AI 識別，仍需核驗':'本地規則拆題 · 分類結果需核驗'}</span><div class="row-actions"><button class="secondary" id="parse-paper">先拆分預覽 ${icon('spark')}</button><button class="primary" id="auto-import-paper">全自動拆分並匯入 ${icon('check')}</button></div></div><div class="divider-text"><span>或手動輸入題目並繪製圖形</span></div><div class="manual-entry">${manualForm}</div>`;$('#paper-name').oninput=e=>paperName=e.target.value;$('#paper-text').oninput=e=>{paperText=e.target.value;if(paperText.trim()){paperFile=null;$('#paper-filename').textContent='已使用貼上文字（不會同時提交檔案）';}};$('#sample-paper').onclick=()=>{paperName='中三數學 · 示例練習卷';paperText='1. 解方程 $x^2-5x+6=0$。\n\n2. 直角三角形兩條直角邊長為 $3\\text{ cm}$ 和 $4\\text{ cm}$，求斜邊長。\n\n3. 擲一枚公平骰子，求點數大於 4 的概率。\n\n4. 已知 $f(x)=2x+1$，求 $f(3)$。';paperFile=null;renderImportContent();};const select=async f=>{try{f=await normalizeHeicFile(f);const dataUrl=await fileData(f,['application/pdf','image/png','image/jpeg']);paperFile={name:f.name,mime:f.type,dataUrl};paperText='';if(!paperName)paperName=f.name.replace(/\.[^.]+$/,'');renderImportContent();}catch(e){toast(e.message);}};$('#paper-upload').onchange=e=>select(e.target.files[0]);const d=$('#paper-drop');d.ondragover=e=>{e.preventDefault();d.classList.add('dragover');};d.ondragleave=()=>d.classList.remove('dragover');d.ondrop=e=>{e.preventDefault();select(e.dataTransfer.files[0]);};$('#parse-paper').onclick=parsePaper;$('#auto-import-paper').onclick=autoImportPaper;
initFigureCanvas();
renderFigImage();
const figInput=$('#fig-upload');
if(figInput)figInput.onchange=async e=>{
  const f=await normalizeHeicFile(e.target.files[0]);
  if(!f)return;
  if(!/^image\/(png|jpeg|webp)$/.test(f.type))return toast('請選擇 PNG、JPG、WebP 或 HEIC 圖片。');
  if(f.size>4*1024*1024)return toast('圖片不可超過 4 MB，請先裁剪或壓縮。');
  try{figImage=await fitFigureImage(f);renderFigImage();toast('已加入題目圖形，可繼續填寫其他欄位。');}
  catch(err){toast(err.message);}
};
wireQuestionForm('manual',manualState,{
  figure:()=>(figImage||(figSketch&&figSketch.strokes.length))?figureDataUrl():undefined,
  onSubmit:draft=>{
    drafts.push(draft);
    ['title','content','answer','hint','steps','analysis'].forEach(f=>{$('#manual-'+f).value='';});
    manualState.options=[];renderQuestionOptions('manual',manualState);
    manualState.rubric.length=0;rubricRender('manual');
    figImage=null;initFigureCanvas();renderFigImage();
    importStage=2;importPage();toast('已加入題目，請核驗後匯入。');
  }});}else if(importStage===2){r.innerHTML=`<div class="section-head"><div><h2 style="font-size:calc(18px*var(--fs))">已拆分 ${drafts.length} 道題目</h2><p>請逐題確認原文、分類、難度、分值及參考答案。</p>${importMethod?`<p class="small-text">拆分方式：${esc(importMethod)}</p>`:''}</div></div><div class="import-warning">辨識結果不是答案核驗。參考答案空白的題目會交由教師批閱；若要啟用答案核對，請填寫正確答案。若 AI 在試卷圖片中框出圖形，已自動裁好放在題目右邊，可逐題確認或按「移除圖形」拿掉。</div><div id="draft-list">${drafts.map((q,i)=>`<article class="draft-card" data-draft="${i}"><div class="draft-top"><span class="draft-index">${String(i+1).padStart(2,'0')}</span><strong>題目 ${String(i+1).padStart(2,'0')} · 待教師核驗</strong><button class="icon-btn" data-remove-draft="${i}" aria-label="移除此題">${icon('trash')}</button></div><div class="form-field"><label class="field-label">題目標題</label><input data-field="title" value="${esc(q.title)}" maxlength="200"></div><div class="question-stem draft-stem"><div class="question-stem-text"><div class="form-field"><label class="field-label">題目內容（可修正分割結果）<span class="small-text" style="font-weight:400">　下方即時預覽渲染後的數學式</span></label><textarea class="answer-field" data-field="content" maxlength="60000">${esc(q.content)}</textarea><div class="math-preview" data-preview="${i}">${mathText(q.content)}</div></div></div>${q.figure?`<div class="draft-figure"><img src="${q.figure}" alt="題目圖形"><button class="text-button" data-remove-figure="${i}">移除圖形</button></div>`:''}</div><div class="form-grid"><div class="form-field"><label class="field-label">知識分類</label><select data-field="topic">${topics.map(t=>`<option ${q.topic===t?'selected':''}>${t}</option>`).join('')}</select></div><div class="form-field"><label class="field-label">子分類</label><select data-field="subtopic">${subtopicsOf(q.topic).map(v=>`<option ${(q.subtopic||'')===v?'selected':''}>${esc(v)}</option>`).join('')}</select></div><div class="form-field"><label class="field-label">題型</label><select data-field="qtype">${qtypes.map(t=>`<option ${(q.qtype||'解答題')===t?'selected':''}>${t}</option>`).join('')}</select></div><div class="form-field"><label class="field-label">難度</label><select data-field="level">${[1,2,3].map(n=>`<option value="${n}" ${q.level===n?'selected':''}>${levels[n]}</option>`).join('')}</select></div><div class="form-field"><label class="field-label">分值</label><input data-field="points" type="number" min="1" max="100" value="${q.points}"></div><div class="form-field"><label class="field-label">參考答案（可留空）</label><input data-field="answer" value="${esc(q.answer)}" maxlength="4000"></div></div><div class="form-field options-field" data-options-field="${i}" style="display:${q.qtype==='選擇題'?'block':'none'}"><label class="field-label">選項（選擇題 · 可增刪修改）</label><div class="option-list" data-option-list="${i}"></div><div class="option-actions"><button type="button" class="text-button" data-add-option="${i}">＋ 新增選項</button><span class="small-text">支援 2 至 10 個選項，學生作答時可直接點選</span></div></div><div class="form-field"><label class="field-label">解題提示</label><input data-field="hint" value="${esc(q.hint)}" maxlength="4000"></div><div class="form-field"><label class="field-label">詳解步驟（每行一步）<span class="small-text" style="font-weight:400">　支援 LaTeX：$x^2-5x+6=0$</span></label><textarea class="answer-field" data-field="steps" maxlength="40000">${esc((q.steps||[]).join('\n'))}</textarea><div class="math-preview" data-steps-preview="${i}">${(q.steps||[]).map(st=>`<div class="preview-option">${mathText(st)}</div>`).join('')}</div></div><div class="form-field"><label class="field-label">詳細解釋（考點 · 解題思路 · 常見錯誤）</label><textarea class="answer-field" data-field="analysis" maxlength="6000">${esc(q.analysis||'')}</textarea><div class="math-preview" data-analysis-preview="${i}">${mathText(q.analysis||'')}</div></div><div class="form-field" data-rubric-field="draft-${i}"${isObjectiveQtype(q.qtype)?' style="display:none"':''}>${rubricEditorHtml('draft-'+i, q.rubric||[])}</div><div class="form-field objective-note" data-objective-note="draft-${i}"${isObjectiveQtype(q.qtype)?'':' style="display:none"'}>客觀題（選擇題／填空題）以「答案是否正確」評分，不需要評分標準，也不會產生 AI 評分步驟。</div><div class="ai-answer-row"><button type="button" class="secondary" data-ai-answer="${i}">${icon('spark')}AI 生成答案與評分標準</button><span class="small-text">依題目自動產生答案、詳解、詳細解釋與評分標準百分比（可再修改）</span></div><div class="ai-answer-row"><button type="button" class="secondary" data-ai-figure="${i}">${icon('spark')}AI 生成圖形</button><button type="button" class="secondary" data-fig-manual="${i}">${icon('upload')}手動插入圖形</button><span class="small-text">AI 只為幾何／向量題材畫圖，畫好可核對題目與圖形是否相符，或自行插入圖片</span></div></article>`).join('')}</div><label class="checkbox-line"><input type="checkbox" id="confirm-drafts">我已確認題目內容、分類與評分依據，允許加入校本題庫。</label><div id="import-error"></div><div class="submit-row"><button class="secondary" id="back-import">返回修改來源</button><button class="primary" id="save-drafts">確認匯入 ${drafts.length} 題 ${icon('check')}</button></div>`;$$('[data-field]').forEach(f=>f.oninput=e=>{const card=e.target.closest('[data-draft]'),i=Number(card.dataset.draft),k=e.target.dataset.field;drafts[i][k]=k==='steps'?e.target.value.split('\n').map(x=>x.trim()).filter(Boolean):['level','points'].includes(k)?Number(e.target.value):e.target.value;if(k==='steps'||k==='analysis'){const pv=card.querySelector(k==='steps'?'[data-steps-preview]':'[data-analysis-preview]');if(pv)pv.innerHTML=k==='steps'?(drafts[i].steps||[]).map(x=>`<div class="preview-option">${mathText(x)}</div>`).join(''):mathText(e.target.value);}});$$('[data-field="topic"]').forEach(f=>f.onchange=e=>{const card=e.target.closest('[data-draft]'),sub=card&&card.querySelector('[data-field="subtopic"]');if(sub){sub.innerHTML=subtopicsOf(e.target.value).map(v=>`<option>${esc(v)}</option>`).join('');drafts[Number(card.dataset.draft)].subtopic=sub.value;}});
// 選項編輯：每個草稿的選項輸入列 ＋ 即時渲染預覽
function renderDraftOptions(i){
  const box=document.querySelector(`[data-option-list="${i}"]`);
  if(!box) return;
  const opts=drafts[i].options||[];
  box.innerHTML=opts.map((o,j)=>`<div class="option-row"><span class="option-letter">${OPTION_LETTERS[j]}</span><input value="${esc(o)}" maxlength="600" data-option-field="${i}" data-option-index="${j}" placeholder="選項 ${OPTION_LETTERS[j]}"><button type="button" class="icon-btn" data-drop-option="${i}" data-option-index="${j}" aria-label="刪除選項 ${OPTION_LETTERS[j]}">${icon('trash')}</button></div>`).join('')
    + (opts.length?`<div class="math-preview option-preview">${optionsPreviewHtml(opts)}</div>`:'');
  box.querySelectorAll('[data-option-field]').forEach(inp=>inp.addEventListener('input',e=>{
    const di=Number(e.target.dataset.optionField), oi=Number(e.target.dataset.optionIndex);
    drafts[di].options[oi]=e.target.value;
    const pv=box.querySelector('.option-preview');
    if(pv) pv.innerHTML=optionsPreviewHtml(drafts[di].options);
  }));
  box.querySelectorAll('[data-drop-option]').forEach(b=>b.addEventListener('click',()=>{
    const di=Number(b.dataset.dropOption);
    drafts[di].options.splice(Number(b.dataset.optionIndex),1);
    renderDraftOptions(di);
  }));
}
drafts.forEach((q,i)=>renderDraftOptions(i));
$$('[data-add-option]').forEach(b=>b.addEventListener('click',()=>{
  const i=Number(b.dataset.addOption);
  const opts=drafts[i].options||(drafts[i].options=[]);
  if(opts.length>=OPTION_LETTERS.length) return toast(`最多 ${OPTION_LETTERS.length} 個選項。`);
  opts.push(''); renderDraftOptions(i);
  const box=document.querySelector(`[data-option-list="${i}"]`);
  const last=box&&box.querySelector('[data-option-field]:last-of-type');
  if(last) last.focus();
}));
// 題目內容即時渲染預覽（用 addEventListener，不覆蓋既有的 data-field 綁定）
$$('[data-preview]').forEach(pv=>{
  const card=pv.closest('[data-draft]');
  const ta=card&&card.querySelector('[data-field="content"]');
  if(ta) ta.addEventListener('input',()=>{pv.innerHTML=mathText(ta.value);});
});
// 題型改為選擇題時顯示選項編輯；改為其他題型時隱藏（選項內容保留，匯入時才剔除）
$$('[data-field="qtype"]').forEach(sel=>sel.addEventListener('change',e=>{
  const card=e.target.closest('[data-draft]');
  const di=Number(card.dataset.draft);
  const field=card.querySelector('[data-options-field]');
  if(field) field.style.display=e.target.value==='選擇題'?'block':'none';
  // 選擇題／填空題是客觀題，隱藏評分標準（也不需要 AI 評分步驟）。
  toggleRubricField('draft-'+di, e.target.value);
  if(e.target.value==='選擇題'&&!(drafts[di].options||[]).length){drafts[di].options=[];renderDraftOptions(di);}
}));
drafts.forEach((q,i)=>{if(!Array.isArray(q.rubric))q.rubric=[];rubricBind('draft-'+i,q.rubric);});
$$('[data-ai-answer]').forEach(b=>b.onclick=()=>aiFillDraft(Number(b.dataset.aiAnswer),b));
const openDraftFigure=(i,pick)=>{
  const q=drafts[i];
  if(!q)return;
  if(!(q.content||'').trim())return toast('請先填寫題目內容。');
  openFigureStudio({title:q.title,content:q.content,topic:q.topic,subtopic:q.subtopic,qtype:q.qtype,figure:q.figure||'',
    apply:async figure=>{q.figure=figure;closeModal();renderImportContent();
      toast(figure?'已加入題目圖形，請核對數據與標註。':'已移除題目圖形。');}});
  if(pick)$('#fig-manual')?.click();
};
$$('[data-ai-figure]').forEach(b=>b.onclick=()=>openDraftFigure(Number(b.dataset.aiFigure),false));
$$('[data-fig-manual]').forEach(b=>b.onclick=()=>openDraftFigure(Number(b.dataset.figManual),true));
$$('[data-remove-figure]').forEach(b=>b.onclick=()=>{delete drafts[Number(b.dataset.removeFigure)].figure;renderImportContent();});$('#back-import').onclick=()=>{importStage=1;importPage();};$('#save-drafts').onclick=saveDrafts;}else{r.innerHTML=`<div class="success-panel"><div class="success-icon">${icon('check')}</div><h2>試卷已轉化為練習題</h2><p>${drafts.length} 道題目已存入本地校本題庫，可供學生練習。</p><button class="primary" id="view-imported">查看新題目 ${icon('arrow')}</button><button class="text-button" id="new-import" style="display:flex;margin:20px auto;font-size:calc(15px*var(--fs))">繼續匯入其他試卷</button></div>`;$('#view-imported').onclick=()=>{search=paperName;topic='全部題目';level='';currentPage=1;bank();};$('#new-import').onclick=()=>{paperFile=null;paperName='';paperText='';drafts=[];importStage=1;importPage();};}}
async function parsePaper(){if(busy)return;if(!paperName.trim())return toast('請先填寫試卷名稱。');if(!paperFile&&!paperText.trim())return toast('請選擇試卷或貼上題目文字。');const body={name:paperName.trim(),consentExternal:!!$('#paper-consent')?.checked};if(paperFile)Object.assign(body,{dataUrl:paperFile.dataUrl,mime:paperFile.mime});else body.text=paperText.trim();busy=true;$('#parse-paper').disabled=true;$('#parse-paper').textContent='正在辨識與拆分…';try{const r=await api('/api/papers/parse',body);drafts=r.drafts;
    // figureBox 是拆題的中間產物、不是題目欄位，先取出再裁圖，避免匯入時被擋下。
    const boxes=drafts.map(q=>{const b=q.figureBox||null;delete q.figureBox;return b;});
    const cropped=await attachFigureBoxes(drafts,boxes,paperImageSource());
    importMethod=r.method||'';importStage=2;importPage();
    toast(cropped?`已辨識，並自動裁出 ${cropped} 題圖形，請逐題核驗。`:(r.method.includes('AI')?'AI 已辨識，請逐題核驗。':'已用本地規則拆分，請核驗分類與答案。'));}catch(e){$('#parse-error').innerHTML=`<div class="inline-error">${esc(e.message)}</div>`+`<p class="field-hint">若持續失敗，可先改用手動輸入；伺服器日誌（Render → Logs）會顯示 AI 的實際錯誤原因。</p>`;}finally{busy=false;if($('#parse-paper')){$('#parse-paper').disabled=false;$('#parse-paper').innerHTML='開始拆分題目 '+icon('spark');}}}
async function autoImportPaper(){if(busy)return;if(!paperName.trim())return toast('請先填寫試卷名稱。');if(!paperFile&&!paperText.trim())return toast('請選擇試卷或貼上題目文字。');if(!confirm('全自動拆分並直接寫入題庫？題目會標示為「自動匯入 · 待核驗」，可之後在題庫核對。'))return;const body={name:paperName.trim(),consentExternal:!!$('#paper-consent')?.checked};if(paperFile)Object.assign(body,{dataUrl:paperFile.dataUrl,mime:paperFile.mime});else body.text=paperText.trim();busy=true;const b=$('#auto-import-paper'),original=b.innerHTML;b.disabled=true;b.innerHTML=icon('clock')+'正在拆分並匯入…';try{const source=paperImageSource();const r=await api('/api/papers/auto-import',body);
    // 題目已寫入題庫，圖形改由 POST /api/questions/figures 補上（一次批次送出）。
    const cropped=await attachFigureBoxes(r.questions||[],r.figureBoxes||[],source);
    if(cropped){const figures=(r.questions||[]).filter(q=>q.figure).map(q=>({id:q.id,figure:q.figure}));if(figures.length)await api('/api/questions/figures',{figures});}
    await refresh();drafts=[];paperText='';paperFile=null;importStage=1;
    toast(`已全自動匯入 ${r.count} 題（${r.method}）${cropped?`，並自動裁出 ${cropped} 題圖形`:''}，請在題庫核對題型與答案。`);bank();}catch(e){$('#parse-error').innerHTML=`<div class="inline-error">${esc(e.message)}</div>`;}finally{busy=false;if($('#auto-import-paper')){$('#auto-import-paper').disabled=false;$('#auto-import-paper').innerHTML=original;}}}

async function saveDrafts(){if(busy)return;if(!$('#confirm-drafts').checked)return toast('請確認已核驗題目及評分依據。');if(!drafts.length)return toast('沒有可匯入的題目。');const rp=drafts.map(q=>isObjectiveQtype(q.qtype)?'':rubricProblem(q.rubric)).find(Boolean);if(rp)return $('#import-error').innerHTML=`<div class="inline-error">${esc(rp)}</div>`;busy=true;$('#save-drafts').disabled=true;try{const verified=drafts.map(q=>{const isChoice=q.qtype==='選擇題';const options=isChoice?(q.options||[]).map(o=>String(o||'').trim()).filter(Boolean):[];return {...q,options,rubric:isObjectiveQtype(q.qtype)?[]:cleanRubric(q.rubric),tags:(q.tags||[]).filter(t=>!/(?:待.*(?:確認|确认|核驗|核验|審核|审核))/.test(t))};});await api('/api/questions/import',{questions:verified});await refresh();importStage=3;importPage();toast('已成功保存到本地題庫。');}catch(e){$('#import-error').innerHTML=`<div class="inline-error">${esc(e.message)}</div>`;if($('#save-drafts'))$('#save-drafts').disabled=false;}finally{busy=false;}}
function recordsPage(){page='mistakes';shell();if(!S.user)return loginModal(recordsPage);const teacher=S.user.role==='teacher',filtered=S.attempts.filter(a=>historyFilter==='all'||historyFilter==='pending'&&a.status==='pending'||historyFilter==='wrong'&&a.status==='graded'&&a.score<a.maxScore||historyFilter==='saved'&&bookmarks.has(a.questionId));// 教師批閱時用「畫面上這份清單」當待批佇列，存檔後一路批到完。
// 建議覆核的題目排前面：教師一打開就先看到最需要判斷的那幾題（其餘順序不變）。
const ordered=teacher?[...filtered].sort((x,y)=>(y.reviewFlags?.length?1:0)-(x.reviewFlags?.length?1:0)):filtered;
const reviewQueue=teacher?ordered.map(x=>x.id).join(','):'';$('#main').innerHTML=`<div class="fade-in">${heading(teacher?'REVIEW & FEEDBACK':'REFLECT & IMPROVE',teacher?'作答批閱':'我的錯題本',teacher?'看見學生的推導，用簡短回饋引導下一步。':'錯題不是終點。回看思路，再用相似題鞏固理解。',`<button class="secondary" id="refresh-records">${icon('undo')}重新整理</button>`)}<div class="history-filters">${[['all',teacher?'全部作答':'全部紀錄'],['wrong','需要鞏固'],['pending','等待批閱'],['saved','已收藏題目']].map(([id,t])=>`<button data-history="${id}" class="${historyFilter===id?'active':''}">${t}</button>`).join('')}</div><section class="panel records-panel">${filtered.length?filtered.map(a=>`<article class="record"><div class="record-icon">${icon(a.status==='pending'?'clock':a.score<a.maxScore?'mistakes':'check')}</div><div class="record-main"><strong>${esc(a.questionTitle)}</strong> <span class="badge">${esc(a.topic)}</span>${teacher&&a.reviewFlags?.length?'<span class="badge review-flag">建議覆核</span>':''}${teacher&&!a.assignmentId&&!a.mockId?'<span class="badge self-practice">自主練習 · 不需批閱</span>':''}<p>${mathText(a.feedback)}</p>${teacher?`<details class="record-advice"><summary>學習建議與推薦題目</summary>${suggestionCard(a.suggestion)}</details>`:suggestionCard(a.suggestion)}<small>${esc(new Date(a.submittedAt).toLocaleString('zh-HK'))}${teacher&&a.student?' · '+esc(a.student.name):''} · ${teacher&&!a.assignmentId&&!a.mockId?'學生自主練習 · 不計入作業成績':a.teacherReviewed?'教師已覆核':a.gradingMethod==='awaiting-review'?'已提交 · 等待教師批閱':a.gradingMethod==='rule-final'?'規則核對 · 非步驟評分':a.gradingMethod==='ai-practice'?'AI 即時評分 · 不需教師批閱':a.gradingMethod==='ai-advisory'?'AI 建議 · 未教師覆核':'等待教師'}</small><div class="record-actions">${teacher?'':`<button class="secondary" data-qid="${a.questionId}">再練一次 ${icon('arrow')}</button>`}${teacher&&!a.assignmentId&&!a.mockId?`<button class="secondary" data-review="${a.id}" data-review-view="1">查看作答</button>`:`<button class="${teacher?'primary':'secondary'}" data-review="${a.id}" data-review-queue="${reviewQueue}">${teacher?'查看與批閱':'查看作答'}</button>`}</div></div><div class="record-score">${a.status==='pending'?'待批閱':`${a.score} <small>/ ${a.maxScore} 分</small>`}</div></article>`).join(''):empty(historyFilter==='wrong'?'目前沒有需鞏固的題目':'還沒有作答紀錄',historyFilter==='pending'?'提交手寫作答後，可在這裡查看批閱進度。':'開始一道練習，讓思考留下足跡。',`${teacher?`<button class="secondary" data-page="bank">前往數學題庫 ${icon('arrow')}</button>`:`<button class="primary" data-action="start">開始練習 ${icon('arrow')}</button>`}`)}</section></div>`;$('#refresh-records').onclick=async()=>{try{await refresh();recordsPage();toast('已讀取最新批閱紀錄。');}catch(e){toast(e.message);}};}
// ── AI 判定印章與批語：貼在手寫稿上，但絕不遮住手寫內容 ──
// 先把圖片縮成小畫布做「墨水圖」，找出哪些格子有筆跡；印章與批語只放在沒有筆跡的
// 空白處（找不到空白處就不畫在圖上，仍可在下方文字清單看到），因此不會壓住學生的字。
const VERDICT_TEXT={correct:'全對',wrong:'全錯',partial:'部分正確'};
// 部分正確＝「✓」與「＼」兩個符號合併：紅剔上疊一撇，斜線由左上往右下（＼方向），
// 撇畫得比剔幼，免得看起來像一個叉（全錯）。
const VERDICT_PATHS={correct:[{d:'M12 34 L26 48 L52 16'}],
  wrong:[{d:'M16 16 L48 48'},{d:'M48 16 L16 48'}],
  partial:[{d:'M12 34 L26 48 L52 16'},{d:'M30 22 L50 46',w:5}]};
const INK_COLS=24, INK_ROWS=24;
const AI_INK_DATA=new Map();
const verdictPaths=v=>(VERDICT_PATHS[v]||[]).map(p=>`<path d="${p.d}"${p.w?` style="stroke-width:${p.w}"`:''}/>`).join('');
function verdictGlyph(v){return VERDICT_PATHS[v]?`<svg class="verdict-glyph" viewBox="0 0 64 64" aria-hidden="true">${verdictPaths(v)}</svg>`:'';}
function verdictBadge(v){return VERDICT_TEXT[v]?`<span class="badge verdict ${v}">${VERDICT_TEXT[v]} ${verdictGlyph(v)}</span>`:'';}
function aiInkLayer(a,editable){
  if(!a.image)return '';
  const issues=a.aiAnnotation?.issues||[], summary=a.aiAnnotation?.summary||'';
  if(!issues.length&&!a.verdict&&!summary)return '';
  AI_INK_DATA.set(a.id,{image:a.image,verdict:a.verdict||'',summary,issues,
                        placements:{...(a.aiAnnotation?.placements||{})}});
  return `<div class="ai-ink-layer${editable?' editable':''}" data-ink="${a.id}"></div>`;
}
// 縮圖後逐格統計深色像素，做出「這裡有筆跡」的粗略地圖。
function inkGrid(img){
  const scale=Math.min(1,200/Math.max(img.naturalWidth,img.naturalHeight));
  const w=Math.max(12,Math.round(img.naturalWidth*scale)),h=Math.max(12,Math.round(img.naturalHeight*scale));
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  if(!ctx)return null;
  ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
  let px;try{px=ctx.getImageData(0,0,w,h).data;}catch{return null;}   // 讀不到像素（跨來源）就不畫
  const count=new Uint32Array(INK_COLS*INK_ROWS);
  for(let y=0;y<h;y++){
    const ry=Math.min(INK_ROWS-1,Math.floor(y/h*INK_ROWS));
    for(let x=0;x<w;x++){
      const i=(y*w+x)*4;
      if(px[i+3]<40)continue;
      if(0.299*px[i]+0.587*px[i+1]+0.114*px[i+2]>=150)continue;   // 只算明顯比紙張深的筆跡
      count[ry*INK_COLS+Math.min(INK_COLS-1,Math.floor(x/w*INK_COLS))]++;
    }
  }
  const min=Math.max(2,Math.round(w*h/(INK_COLS*INK_ROWS)*0.02));
  return {cols:INK_COLS,rows:INK_ROWS,grid:Array.from(count,n=>n>=min?1:0)};
}
// 找一塊完全沒有筆跡的矩形（比例座標，回傳中心點），取最接近 anchor 的一塊；找不到回 null。
// pad 用來避開 anchor 本身：批語框若正好壓在自己的圓標上，教師會拖不到框（點到的是圓標），
// 也點不到框改文字。所以要求框的中心與 anchor 至少隔開半個框再加 pad。
function inkFreeSpot(ink,w,h,anchor,pad=0){
  if(!ink)return null;
  const cw=Math.min(ink.cols,Math.max(1,Math.round(w*ink.cols)));
  const ch=Math.min(ink.rows,Math.max(1,Math.round(h*ink.rows)));
  const halfW=w/2+pad, halfH=h/2+pad;
  let best=null;
  for(let cy=0;cy<=ink.rows-ch;cy++){
    for(let cx=0;cx<=ink.cols-cw;cx++){
      let hit=false;
      for(let y=cy;y<cy+ch&&!hit;y++)for(let x=cx;x<cx+cw;x++)if(ink.grid[y*ink.cols+x]){hit=true;break;}
      if(hit)continue;
      const px=(cx+cw/2)/ink.cols,py=(cy+ch/2)/ink.rows;
      if(pad>0&&Math.abs(px-anchor.x)<halfW&&Math.abs(py-anchor.y)<halfH)continue;
      const d=Math.hypot(px-anchor.x,py-anchor.y);
      if(!best||d<best.d)best={d,x:px,y:py};
    }
  }
  if(!best)return null;
  const clamp=(v,half)=>w>=1||h>=1?0.5:Math.min(Math.max(v,half),1-half);
  return {x:clamp(best.x,w/2),y:clamp(best.y,h/2)};
}
// 佔用剛放好的位置，避免下一個印章／批語疊在同一處。
function inkReserve(ink,spot,w,h){
  const cw=Math.min(ink.cols,Math.max(1,Math.round(w*ink.cols)));
  const ch=Math.min(ink.rows,Math.max(1,Math.round(h*ink.rows)));
  const x0=Math.round(spot.x*ink.cols-cw/2), y0=Math.round(spot.y*ink.rows-ch/2);
  for(let y=Math.max(0,y0);y<Math.min(ink.rows,y0+ch);y++)
    for(let x=Math.max(0,x0);x<Math.min(ink.cols,x0+cw);x++)ink.grid[y*ink.cols+x]=1;
}
function aiCalloutBox(text){
  const lines=Math.min(4,Math.max(1,Math.ceil(String(text).length/16)));
  return {w:0.30,h:0.055+0.036*lines};
}
// 把手寫稿上的空白處填上印章與批語；沒有空白處的項目就不畫（下方清單仍完整）。
// 教師拖過的位置（data.placements）優先：之後重畫都停在他放的地方，不再自動跳位。
async function paintAiInk(layer,data){
  const editable=layer.classList.contains('editable');
  const img=new Image();
  img.src=data.image;
  if(!img.complete)await new Promise(r=>{img.onload=r;img.onerror=r;});
  if(!img.naturalWidth)return;
  const ink=inkGrid(img);
  if(!ink)return;
  const kept=data.placements||{};
  const boxes=[],leaders=[];
  const hint=editable?' title="拖曳可移動；點一下可修改文字"':'';
  const spotFor=(key,w,h,anchor,pad=0)=>{
    const saved=kept[key];
    if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y))return {x:saved.x,y:saved.y,kept:true};
    let spot=inkFreeSpot(ink,w,h,anchor,pad);
    if(!spot&&pad>0)spot=inkFreeSpot(ink,w,h,anchor);   // 找不到就退回不避讓，寧可畫出來
    if(spot)inkReserve(ink,spot,w,h);   // 自動放的位置要佔住，免得下一個疊上來
    return spot?{x:spot.x,y:spot.y,kept:false}:null;
  };
  const place=(key,text,anchor,w,h,cls,pad=0)=>{
    const spot=spotFor(key,w,h,anchor,pad);
    if(!spot)return false;
    boxes.push(`<span class="ai-callout ${cls}${editable?' movable':''}" data-place="${key}" style="left:${(spot.x*100).toFixed(2)}%;top:${(spot.y*100).toFixed(2)}%;width:${(w*100).toFixed(2)}%"${hint}>${text}</span>`);
    if(Math.hypot(spot.x-anchor.x,spot.y-anchor.y)>0.06)
      leaders.push(`<line x1="${(spot.x*100).toFixed(2)}" y1="${(spot.y*100).toFixed(2)}" x2="${(anchor.x*100).toFixed(2)}" y2="${(anchor.y*100).toFixed(2)}"/>`);
    return true;
  };
  const ratio=img.naturalWidth/Math.max(1,img.naturalHeight);
  // 印章：寬 16%（下方還有一行文字，估算高度時要一起算進去）。
  if(data.verdict){
    const w=0.16, h=Math.min(0.50,Math.max(0.12,w*ratio+0.07));
    const spot=spotFor('stamp',w,h,{x:0.88,y:0.12});
    if(spot)
      boxes.push(`<div class="verdict-stamp ${data.verdict}${editable?' movable':''}" data-place="stamp" style="left:${(spot.x*100).toFixed(2)}%;top:${(spot.y*100).toFixed(2)}%;width:${(w*100).toFixed(2)}%"${editable?' title="拖曳可移動印章"':''}><svg viewBox="0 0 64 64" aria-hidden="true">${verdictPaths(data.verdict)}</svg><span>${VERDICT_TEXT[data.verdict]}</span></div>`);
  }
  data.issues.forEach((it,i)=>{
    const text=`<b>${i+1}</b><span><strong>${esc(it.label)}</strong>${esc(String(it.comment||'').slice(0,60))}${String(it.comment||'').length>60?'…':''}</span>`;
    const box=aiCalloutBox(`${it.label}${it.comment||''}`);
    // pad 0.03：框不要壓在自己的圓標上，教師才拖得到框、也點得到框改文字。
    place(`issue:${i}`,text,{x:it.x,y:it.y},box.w,box.h,'issue',0.03);
  });
  if(data.summary){
    const text=`<span><strong>AI 總結</strong>${esc(data.summary.slice(0,80))}${data.summary.length>80?'…':''}</span>`;
    const box=aiCalloutBox(data.summary);
    place('summary',text,{x:0.5,y:0.88},box.w,box.h,'summary');
  }
  layer.innerHTML=`${leaders.length?`<svg class="ai-leaders" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${leaders.join('')}</svg>`:''}${boxes.join('')}`;
}
function paintAllAiInk(){
  $$('.ai-ink-layer[data-ink]').forEach(layer=>{
    const data=AI_INK_DATA.get(Number(layer.dataset.ink));
    if(data)paintAiInk(layer,data).catch(()=>{});
  });
}
// 記下畫面上目前的位置：教師動過（拖曳或改字）之後就固定住，之後重畫不會再自動跳位。
function captureAiPlacements(layer,data){
  layer.querySelectorAll('[data-place]').forEach(el=>{
    const x=parseFloat(el.style.left), y=parseFloat(el.style.top);
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    data.placements=data.placements||{};
    data.placements[el.dataset.place]={x:Math.min(Math.max(x/100,0),1),y:Math.min(Math.max(y/100,0),1)};
  });
}
function aiMarkLayer(a,drag){const ann=a.aiAnnotation;if(!ann||!ann.issues?.length)return '';return `<div class="ai-mark-layer${drag?' draggable':''}">${ann.issues.map((it,i)=>`<span class="ai-mark" data-ai-index="${i}" data-label="${esc(it.label)}" data-comment="${esc(it.comment)}" style="left:${(it.x*100).toFixed(2)}%;top:${(it.y*100).toFixed(2)}%" title="${esc(it.label)}：${esc(it.comment)}"><i>${i+1}</i></span>`).join('')}</div>`;}
function aiMarksBlock(a){const ann=a.aiAnnotation;if(!ann||!ann.issues?.length)return '';return `<div class="ai-annotation"><div class="advice-heading">${icon('spark')}AI 建議批註 <span class="badge">${ann.issues.length} 處 · ${ann.adjusted?'教師已調整位置／文字':'未經教師確認'}</span></div><p class="field-hint">AI 只標示它能從照片確認的位置；標記座標可能偏移，數學判斷也可能出錯，必須由教師覆核後才可作準。數字對應圖上的圓形標記。</p>${ann.summary?`<p class="ai-summary">${esc(ann.summary)}</p>`:''}<ol class="ai-issue-list">${ann.issues.map(it=>`<li><strong>${esc(it.label)}</strong><span>${esc(it.comment)}</span></li>`).join('')}</ol>${ann.at?`<small class="field-hint">AI 於 ${dateText(ann.at)} 產生${ann.adjusted?'，教師已調整位置或文字':''}</small>`:''}</div>`;}
function annotationBlock(a,editable){
  if(!a.image)return '';
  const hasMarks=!!(a.aiAnnotation?.issues||[]).length;
  if(!editable){
    return `<div class="annotated-view">${a.annotation?`<span class="badge">教師批註</span>`:`<span class="badge outline">手寫原稿</span>`}${verdictBadge(a.verdict)}<div class="mark-wrap"><img class="review-image" src="${a.annotation||a.image}" alt="學生手寫解題${a.annotation?'（含教師批註）':''}">${aiInkLayer(a)}${aiMarkLayer(a)}</div>${a.verdict?`<small class="field-hint">AI 判定：<strong>${VERDICT_TEXT[a.verdict]}</strong>（${scoreText(a.score)} / ${a.maxScore} 分）${a.teacherReviewed?'，已由教師確認':''}。紅色剔＝全對、紅色叉＝全錯、紅色剔加一撇＝部分正確；AI 批語只寫在手稿的空白處，不會蓋住你的字。</small>`:''}${a.annotation&&a.annotationAt?`<small class="field-hint">教師批註於 ${dateText(a.annotationAt)}。紅圈與箭頭指出需要修改的地方。</small>`:`<small class="field-hint">教師尚未加上批註。</small>`}</div>${aiMarksBlock(a)}`;
  }
  return `<div class="annotation-tool"><div class="writing-toolbar"><div class="tool-group"><button class="icon-btn" data-ann-tool="select" title="選取並移動／修改批註" aria-label="選取批註">${icon('select')}</button><button class="icon-btn active" data-ann-tool="pen" title="紅筆" aria-label="紅筆">${icon('practice')}</button><button class="icon-btn" data-ann-tool="ellipse" title="圈出錯處" aria-label="圈出錯處">◯</button><button class="icon-btn" data-ann-tool="arrow" title="箭頭指出錯處" aria-label="箭頭">↗</button><button class="icon-btn" data-ann-tool="highlight" title="螢光標示" aria-label="螢光標示">▬</button><button class="icon-btn" data-ann-tool="text" title="文字批註" aria-label="文字批註">A</button><button class="icon-btn" data-ann-tool="eraser" title="擦除批註" aria-label="擦除批註">${icon('eraser')}</button><span style="height:20px;border-right:1px solid var(--border);margin:0 4px"></span><button class="icon-btn" id="ann-undo" title="撤銷" aria-label="撤銷">${icon('undo')}</button><button class="icon-btn" id="ann-clear" title="清除全部批註" aria-label="清除全部批註">${icon('trash')}</button></div><span class="small-text">直接在學生手稿上標示</span></div><div class="canvas-wrap ann-canvas-wrap"><canvas id="ann-canvas" width="1200" height="800" aria-label="批註畫布"></canvas></div><div class="ann-edit-row"><span class="small-text" id="ann-select-status">用「選取」工具點一下圖上的批註，就能移動、改文字或刪除</span><label class="small-text" for="ann-item-size">粗細／字級</label><input id="ann-item-size" type="range" min="2" max="72" value="30" disabled><span class="small-text ann-size-value" id="ann-item-size-value">—</span><button class="secondary" id="ann-edit-text" disabled>改文字</button><button class="secondary" id="ann-delete" disabled>刪除選取</button></div><div class="submit-row"><span class="small-text" id="ann-status">批註在按下「儲存批註」前不會保存</span><button class="secondary" id="ann-save">${icon('check')}儲存批註</button></div><div class="ai-tool-row">${S.ai.configured?`<button class="secondary" id="ai-annotate">${icon('spark')}${hasMarks?'重新產生 AI 批註':'請 AI 建議批註位置'}</button>`:`<span class="small-text">AI 未接入，未能產生建議批註。</span>`}${hasMarks?`<button class="text-button" id="ai-clear" style="font-size:calc(14px*var(--fs))">清除 AI 批註</button>`:''}</div>${(hasMarks||a.verdict)?`<div class="mark-wrap${hasMarks?' ai-preview':''}"${hasMarks?` data-attempt="${a.id}" data-summary="${esc(a.aiAnnotation.summary||'')}"`:''}><img class="review-image" src="${a.annotation||a.image}" alt="${hasMarks?'AI 建議批註位置':'手寫稿與 AI 判定'}">${aiInkLayer(a,true)}${hasMarks?aiMarkLayer(a,true):''}</div>`:''}${hasMarks?`<div class="submit-row"><span class="small-text" id="ai-adjust-status">${a.aiAnnotation.adjusted?'教師已調整標記位置與批語':'可拖動圓標、批語框與印章；點一下批語可修改文字'}</span><button class="secondary" id="ai-adjust-save">${icon('check')}儲存調整</button></div>`:''}${aiMarksBlock(a)}</div>`;
}

let ann={base:null,shapes:[],tool:'pen',drawing:null},annotationDone=null;
function annotationRefresh(attempt){if(ann.shapes?.length&&!confirm('畫面將重新載入，你尚未儲存的紅筆批註會遺失。確定繼續？'))return;closeModal();reviewModal(attempt.id,annotationDone);}
function redrawAnn(){const c=$('#ann-canvas');if(!c||!ann.base)return;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(ann.base,0,0,c.width,c.height);for(const s of ann.shapes)drawAnnShape(ctx,s);if(ann.drawing)drawAnnShape(ctx,ann.drawing);if(ann.selected!=null&&ann.shapes[ann.selected]){const b=annShapeBounds(ann.shapes[ann.selected]);ctx.save();ctx.setLineDash([9,7]);ctx.strokeStyle='#2c6a8e';ctx.lineWidth=2.5;ctx.strokeRect(b.x-8,b.y-8,b.w+16,b.h+16);ctx.restore();}}
function drawAnnShape(ctx,s){ctx.save();ctx.lineCap='round';ctx.lineJoin='round';if(s.type==='pen'||s.type==='highlight'){ctx.strokeStyle=s.erase?'rgba(255,255,255,.92)':s.type==='highlight'?'rgba(255,206,0,.38)':'#d9453b';ctx.lineWidth=s.erase?30:annShapeSize(s);ctx.beginPath();s.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();}else if(s.type==='ellipse'){const x=Math.min(s.a.x,s.b.x),y=Math.min(s.a.y,s.b.y),w=Math.abs(s.b.x-s.a.x),h=Math.abs(s.b.y-s.a.y);ctx.strokeStyle='#d9453b';ctx.lineWidth=annShapeSize(s);ctx.beginPath();ctx.ellipse(x+w/2,y+h/2,Math.max(w/2,6),Math.max(h/2,6),0,0,Math.PI*2);ctx.stroke();}else if(s.type==='arrow'){const ang=Math.atan2(s.b.y-s.a.y,s.b.x-s.a.x),L=26;ctx.strokeStyle='#d9453b';ctx.lineWidth=annShapeSize(s);ctx.beginPath();ctx.moveTo(s.a.x,s.a.y);ctx.lineTo(s.b.x,s.b.y);ctx.moveTo(s.b.x,s.b.y);ctx.lineTo(s.b.x-L*Math.cos(ang-0.42),s.b.y-L*Math.sin(ang-0.42));ctx.moveTo(s.b.x,s.b.y);ctx.lineTo(s.b.x-L*Math.cos(ang+0.42),s.b.y-L*Math.sin(ang+0.42));ctx.stroke();}else if(s.type==='text'){ctx.font=`600 ${annShapeSize(s)}px "PingFang TC","Microsoft JhengHei",sans-serif`;ctx.lineWidth=8;ctx.strokeStyle='rgba(255,255,255,.94)';ctx.strokeText(s.text,s.x,s.y);ctx.fillStyle='#c0392b';ctx.fillText(s.text,s.x,s.y);}ctx.restore();}
// ── 選取／移動／修改既有批註 ──
// 以前只能「撤銷一筆」或「清除全部」，畫錯一個圈就得整份重來。現在可以點選單一批註，
// 拖曳移動、調整粗細或字級、改文字、刪除。
function annShapeSize(s){return s.size||(s.type==='text'?30:s.type==='highlight'?26:5);}
function annDistToSegment(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,L=dx*dx+dy*dy;if(!L)return Math.hypot(p.x-a.x,p.y-a.y);const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/L));return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));}
// 粗略外框：用來畫選取虛線框，也用來判斷文字批註的點擊範圍。
function annShapeBounds(s){
  if(s.type==='text'){const size=annShapeSize(s),w=Math.max(size,String(s.text||'').length*size*0.62);return {x:s.x-4,y:s.y-size*1.05,w:w+8,h:size*1.35};}
  if(s.type==='ellipse')return {x:Math.min(s.a.x,s.b.x),y:Math.min(s.a.y,s.b.y),w:Math.abs(s.b.x-s.a.x),h:Math.abs(s.b.y-s.a.y)};
  const pts=s.type==='pen'?s.points:[s.a,s.b],pad=annShapeSize(s)/2+8;
  const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
  return {x:Math.min(...xs)-pad,y:Math.min(...ys)-pad,w:Math.max(...xs)-Math.min(...xs)+pad*2,h:Math.max(...ys)-Math.min(...ys)+pad*2};
}
// 由上往下找最上面一項被點到的批註；找不到回 -1。
function annHitShape(p){
  const slack=12;
  for(let i=ann.shapes.length-1;i>=0;i--){
    const s=ann.shapes[i],pad=annShapeSize(s)/2+slack;
    if(s.type==='pen'||s.type==='highlight'){
      if(s.points.length===1){if(Math.hypot(p.x-s.points[0].x,p.y-s.points[0].y)<=pad)return i;continue;}
      for(let k=1;k<s.points.length;k++)if(annDistToSegment(p,s.points[k-1],s.points[k])<=pad)return i;
    }else if(s.type==='ellipse'){
      const rx=Math.abs(s.b.x-s.a.x)/2,ry=Math.abs(s.b.y-s.a.y)/2,cx=(s.a.x+s.b.x)/2,cy=(s.a.y+s.b.y)/2;
      if(rx<5||ry<5){if(Math.hypot(p.x-cx,p.y-cy)<=pad)return i;}
      else{const r=Math.sqrt(((p.x-cx)/rx)**2+((p.y-cy)/ry)**2);if(Math.abs(r-1)*Math.min(rx,ry)<=pad)return i;}
    }else if(s.type==='arrow'){
      if(annDistToSegment(p,s.a,s.b)<=pad)return i;
    }else if(s.type==='text'){
      const b=annShapeBounds(s);
      if(p.x>=b.x-slack&&p.x<=b.x+b.w+slack&&p.y>=b.y-slack&&p.y<=b.y+b.h+slack)return i;
    }
  }
  return -1;
}
function annTranslate(s,dx,dy){
  if(s.type==='text'){s.x+=dx;s.y+=dy;}
  else if(s.type==='ellipse'||s.type==='arrow'){s.a.x+=dx;s.a.y+=dy;s.b.x+=dx;s.b.y+=dy;}
  else s.points.forEach(p=>{p.x+=dx;p.y+=dy;});
}
const ANN_TYPE_LABEL={pen:'紅筆線',highlight:'螢光標示',ellipse:'圈選',arrow:'箭頭',text:'文字批註'};
function syncAnnSelection(){
  const s=ann.selected!=null?ann.shapes[ann.selected]:null;
  const slider=$('#ann-item-size'),value=$('#ann-item-size-value'),edit=$('#ann-edit-text'),del=$('#ann-delete'),note=$('#ann-select-status');
  if(slider){slider.disabled=!s;if(s)slider.value=Math.min(72,Math.max(2,annShapeSize(s)));}
  if(value)value.textContent=s?String(annShapeSize(s)):'—';
  if(edit)edit.disabled=!(s&&s.type==='text');
  if(del)del.disabled=!s;
  if(note)note.textContent=s?`已選取${ANN_TYPE_LABEL[s.type]||'批註'}`:'用「選取」工具點一下圖上的批註，就能移動、改文字或刪除';
}
function deleteAnnSelected(){
  if(ann.selected==null||!ann.shapes[ann.selected])return;
  ann.shapes.splice(ann.selected,1);ann.selected=null;
  syncAnnSelection();redrawAnn();
  const st=$('#ann-status');if(st)st.textContent='已刪除選取的批註，記得儲存。';
}
// 選取批註後按 Delete／Backspace 直接刪除；在輸入框裡打字不受影響。
document.addEventListener('keydown',e=>{
  if(ann.selected==null||!$('#ann-canvas'))return;
  const tag=(e.target&&e.target.tagName)||'';
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||e.target?.isContentEditable)return;
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteAnnSelected();}
});
function initAnnotation(a){const c=$('#ann-canvas');if(!c)return;const img=new Image();img.onload=()=>{const s=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));c.width=Math.max(1,Math.round(img.naturalWidth*s));c.height=Math.max(1,Math.round(img.naturalHeight*s));ann={base:img,shapes:[],tool:'pen',drawing:null,selected:null,dragging:null};redrawAnn();syncAnnSelection();};img.onerror=()=>{$('#ann-status').textContent='無法載入學生手稿，請關閉後重新整理。';};img.src=a.annotation||a.image;
function pos(e){const r=c.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*c.width,y:(e.clientY-r.top)/r.height*c.height};}
c.onpointerdown=e=>{if(!ann.base)return;if(e.button!==0&&e.pointerType==='mouse')return;e.preventDefault();const p=pos(e);if(ann.tool==='select'){const hit=annHitShape(p);ann.selected=hit>=0?hit:null;ann.dragging=hit>=0?{index:hit,last:p}:null;if(hit>=0)try{c.setPointerCapture(e.pointerId);}catch(_){}syncAnnSelection();redrawAnn();return;}if(ann.tool==='text'){const t=(prompt('輸入要寫在圖上的批註文字（例如：這裡漏了負號）')||'').trim();if(t)ann.shapes.push({type:'text',x:p.x,y:p.y,text:t.slice(0,120)});redrawAnn();$('#ann-status').textContent='已加入文字批註，記得儲存。';return;}c.setPointerCapture(e.pointerId);ann.drawing=ann.tool==='pen'||ann.tool==='highlight'||ann.tool==='eraser'?{type:ann.tool==='highlight'?'highlight':'pen',points:[p],erase:ann.tool==='eraser'}:{type:ann.tool,a:p,b:p};redrawAnn();};
c.onpointermove=e=>{if(ann.dragging){e.preventDefault();const p=pos(e),s=ann.shapes[ann.dragging.index];if(s){annTranslate(s,p.x-ann.dragging.last.x,p.y-ann.dragging.last.y);ann.dragging.last=p;redrawAnn();$('#ann-status').textContent='批註尚未儲存';}return;}if(!ann.drawing)return;e.preventDefault();const p=pos(e);if(ann.drawing.points)ann.drawing.points.push(p);else ann.drawing.b=p;redrawAnn();};
c.onpointerup=c.onpointercancel=c.onlostpointercapture=()=>{ann.dragging=null;const d=ann.drawing;ann.drawing=null;if(!d)return;if(d.type==='pen'&&d.erase){const pts=d.points;ann.shapes=ann.shapes.filter(s=>!(s.points||[]).some(q=>pts.some(p=>Math.hypot(p.x-q.x,p.y-q.y)<30)));}else if(d.points){if(d.points.length>=2)ann.shapes.push(d);}else if(Math.hypot(d.b.x-d.a.x,d.b.y-d.a.y)>=12){ann.shapes.push(d);}ann.selected=null;syncAnnSelection();redrawAnn();if(ann.shapes.length)$('#ann-status').textContent='批註尚未儲存';};
$$('[data-ann-tool]').forEach(b=>b.onclick=()=>{ann.tool=b.dataset.annTool;$$('[data-ann-tool]').forEach(x=>x.classList.toggle('active',x===b));if(ann.tool!=='select')ann.selected=null;syncAnnSelection();});
$('#ann-delete').onclick=deleteAnnSelected;
$('#ann-edit-text').onclick=()=>{const s=ann.selected!=null?ann.shapes[ann.selected]:null;if(!s||s.type!=='text')return;const next=prompt('修改這則文字批註',s.text);if(next===null)return;const t=next.trim();if(!t)return toast('文字不可留空；要移除請用「刪除選取」。');s.text=t.slice(0,120);redrawAnn();$('#ann-status').textContent='文字已修改，記得儲存。';};
const annSize=$('#ann-item-size');
if(annSize)annSize.oninput=()=>{const s=ann.selected!=null?ann.shapes[ann.selected]:null;if(!s)return;s.size=Number(annSize.value);const v=$('#ann-item-size-value');if(v)v.textContent=String(s.size);redrawAnn();$('#ann-status').textContent='批註尚未儲存';};
syncAnnSelection();
$('#ann-undo').onclick=()=>{if(!ann.shapes.length)return toast('沒有可撤銷的批註。');ann.shapes.pop();ann.selected=null;syncAnnSelection();redrawAnn();$('#ann-status').textContent='已撤銷一筆，記得儲存。';};
$('#ann-clear').onclick=()=>{if(!ann.shapes.length)return;if(!confirm('清除圖上所有批註？原有手寫內容不受影響。'))return;ann.shapes=[];ann.selected=null;syncAnnSelection();redrawAnn();$('#ann-status').textContent='已清除全部批註，記得儲存。';};
$('#ann-save').onclick=async()=>{const b=$('#ann-save');b.disabled=true;$('#ann-status').textContent='正在儲存批註…';try{const {attempt}=await api(`/api/attempts/${a.id}/annotation`,{image:imageDataUrl(c)});const i=S.attempts.findIndex(x=>x.id===attempt.id);if(i<0)S.attempts.push(attempt);else S.attempts[i]=attempt;toast('批註已儲存，學生可查看。');closeModal();if(annotationDone)annotationDone();}catch(e){$('#ann-status').textContent=e.message;b.disabled=false;}};
const aiBtn=$('#ai-annotate');
if(aiBtn)aiBtn.onclick=async()=>{if(S.ai.mode==='external'&&!confirm('AI 批註會將這位學生的手寫照片及本題內容，傳送至學校配置的外部 AI 服務，是否繼續？'))return;const original=aiBtn.innerHTML;aiBtn.disabled=true;aiBtn.innerHTML=icon('clock')+'AI 正在看手稿…';try{const {attempt}=await api(`/api/attempts/${a.id}/ai-annotation`,{consentExternal:S.ai.mode==='external'});const i=S.attempts.findIndex(x=>x.id===attempt.id);if(i<0)S.attempts.push(attempt);else S.attempts[i]=attempt;const n=attempt.aiAnnotation?.issues?.length||0;toast(n?`AI 建議 ${n} 處，須由教師覆核。`:'AI 未標示任何錯處；這不代表作答正確，請教師自行檢視。');annotationRefresh(attempt);}catch(e){toast(e.message);aiBtn.disabled=false;aiBtn.innerHTML=original;}};
const aiClear=$('#ai-clear');
if(aiClear)aiClear.onclick=async()=>{if(!confirm('清除 AI 建議批註？教師自己的批註不受影響。'))return;try{const {attempt}=await api(`/api/attempts/${a.id}/ai-annotation`,{clear:true});const i=S.attempts.findIndex(x=>x.id===attempt.id);if(i<0)S.attempts.push(attempt);else S.attempts[i]=attempt;toast('已清除 AI 批註。');annotationRefresh(attempt);}catch(e){toast(e.message);}};}
let aiDrag=null,aiJustDragged=false;
// 教師可以直接拖動：圓形標記、AI 批語框、印章。三種都寫回同一組相對座標。
const aiMovableTarget=e=>e.target&&e.target.closest?e.target.closest('.ai-mark-layer.draggable .ai-mark, .ai-ink-layer.editable .movable'):null;
document.addEventListener('pointerdown',e=>{const m=aiMovableTarget(e);if(!m)return;const wrap=m.closest('.mark-wrap');if(!wrap)return;const r=wrap.getBoundingClientRect(),b=m.getBoundingClientRect();aiDrag={m,r,dx:e.clientX-(b.left+b.width/2),dy:e.clientY-(b.top+b.height/2),x0:e.clientX,y0:e.clientY,moved:false};try{m.setPointerCapture(e.pointerId);}catch(_){}e.preventDefault();});
document.addEventListener('pointermove',e=>{if(!aiDrag)return;const {m,r}=aiDrag;if(Math.abs(e.clientX-aiDrag.x0)+Math.abs(e.clientY-aiDrag.y0)>4)aiDrag.moved=true;let x=e.clientX-aiDrag.dx-r.left,y=e.clientY-aiDrag.dy-r.top;x=Math.min(Math.max(x,0),r.width);y=Math.min(Math.max(y,0),r.height);m.style.left=(x/r.width*100)+'%';m.style.top=(y/r.height*100)+'%';const st=document.getElementById('ai-adjust-status');if(st)st.textContent='位置已改動，記得按「儲存調整」。';});
// 拖曳結束後緊接著的 click 要忽略，否則一放手就跳出修改文字。
['pointerup','pointercancel'].forEach(t=>document.addEventListener(t,()=>{if(aiDrag&&aiDrag.moved){aiJustDragged=true;setTimeout(()=>{aiJustDragged=false;},400);}aiDrag=null;}));
// 點一下（沒有拖動）批語就改文字：教師可以直接改寫 AI 的說法，不必整組重來。
document.addEventListener('click',e=>{
  const el=e.target&&e.target.closest?e.target.closest('.ai-ink-layer.editable .ai-callout'):null;
  if(!el||aiJustDragged)return;
  const layer=el.closest('.ai-ink-layer'),data=layer&&AI_INK_DATA.get(Number(layer.dataset.ink));
  if(!data)return;
  const key=el.dataset.place||'';
  if(key==='summary'){
    const next=prompt('修改 AI 總結（會直接寫在學生的手稿上）',data.summary);
    if(next===null)return;
    const t=next.trim();
    if(!t)return toast('總結不可留空；如要移除整組批註，請按「清除 AI 批註」。');
    data.summary=t.slice(0,80);
  }else if(key.startsWith('issue:')){
    const it=data.issues[Number(key.slice(6))];
    if(!it)return;
    const next=prompt('修改這則批註（格式：標籤 | 說明）',`${it.label} | ${it.comment}`);
    if(next===null)return;
    const parts=next.split('|');
    const label=(parts.length>1?parts[0]:it.label).trim();
    const comment=(parts.length>1?parts.slice(1).join('|'):next).trim();
    if(!label||!comment)return toast('標籤與說明都要填寫。');
    it.label=label.slice(0,100);it.comment=comment.slice(0,500);
  }else return;
  captureAiPlacements(layer,data);      // 改字後留在原位，不要跳到別的空白處
  paintAiInk(layer,data).catch(()=>{});
  const st=document.getElementById('ai-adjust-status');
  if(st)st.textContent='批註文字已修改，記得按「儲存調整」。';
});
document.addEventListener('click',async e=>{const btn=e.target&&e.target.closest?e.target.closest('#ai-adjust-save'):null;if(!btn)return;const wrap=btn.closest('#modal-root')?.querySelector('.mark-wrap.ai-preview');if(!wrap)return;const aid=wrap.dataset.attempt,marksLayer=wrap.querySelector('.ai-mark-layer.draggable'),inkLayer=wrap.querySelector('.ai-ink-layer.editable');const data=inkLayer?AI_INK_DATA.get(Number(inkLayer.dataset.ink)):null;if(!aid||!marksLayer||!data)return;const r=wrap.getBoundingClientRect(),clamp01=v=>Math.min(Math.max(v,0),1);const issues=[...marksLayer.querySelectorAll('.ai-mark')].map(m=>{const b=m.getBoundingClientRect(),src=data.issues[Number(m.dataset.aiIndex)]||{};return {x:clamp01((b.left+b.width/2-r.left)/r.width),y:clamp01((b.top+b.height/2-r.top)/r.height),label:src.label||m.dataset.label||'',comment:src.comment||m.dataset.comment||''};});captureAiPlacements(inkLayer,data);const payload={issues,summary:data.summary||''};if(Object.keys(data.placements||{}).length)payload.placements=data.placements;btn.disabled=true;const st=document.getElementById('ai-adjust-status');if(st)st.textContent='正在儲存調整後的批註…';try{const {attempt}=await api(`/api/attempts/${aid}/ai-annotation`,{marks:payload});const i=S.attempts.findIndex(x=>x.id===attempt.id);if(i<0)S.attempts.push(attempt);else S.attempts[i]=attempt;toast('已儲存調整後的標記位置與批語。');annotationRefresh(attempt);}catch(err){if(st)st.textContent=err.message;btn.disabled=false;}});
function reviewModal(id,onDone=null,snapshot=null,queue=null,viewOnly=false){
  const a=S.attempts.find(a=>a.id===Number(id));if(!a)return;
  // 從批閱視窗直接關掉時（沒批完佇列），若剛剛存過分數就把上一層的成績表重抓一次；
  // 否則教師會看到舊數字，誤以為沒存到（其實資料庫已經寫入了）。
  reviewReturn=onDone||null;
  // 待批佇列：存檔後直接換下一題，不關窗、不整頁重抓；跑完佇列才回上一層。
  const list=(Array.isArray(queue)&&queue.length?queue:[Number(id)]).map(Number);
  const pos=list.indexOf(Number(id)),nextId=pos>=0&&pos<list.length-1?list[pos+1]:null;
  const snapFor=x=>{const na=S.attempts.find(y=>y.id===Number(x));return na&&assignmentDetail?((assignmentDetail.questions||[]).find(q=>q.id===na.questionId)||null):null;};
  // viewOnly：學生的自主練習不屬教師批閱範圍，只給看、不給打分也不給批註。
  const q=snapshot||(a.assignmentId&&assignmentDetail?.assignment?.id===a.assignmentId?assignmentDetail.questions.find(q=>q.id===a.questionId):null)||S.questions.find(q=>q.id===a.questionId),teacher=S.user.role==='teacher'&&!viewOnly,showRetry=S.user?.role!=='teacher';
  const progress=list.length>1?`待批閱佇列：第 ${pos+1} / ${list.length} 題`:'';
  modal(`<p class="eyebrow">${teacher?'TEACHER REVIEW':'YOUR THINKING'}</p><h2>${esc(a.questionTitle)}</h2><p class="modal-intro">${a.maxScore} 分${a.student?' · '+esc(a.student.name):''}${progress?' · '+progress:''}</p>${q&&(q.content||q.figure)?stemHtml(q,{options:false}):''}${annotationBlock(a,teacher)}${a.skipped&&teacher?`<div class="hint-box">${icon('help')}學生標示本題不會，沒有作答內容。可以給 0 分，或用「退回訂正」要求他重做。</div>`:''}${teacher&&a.reviewFlags?.length?`<div class="hint-box review-flag-box">${icon('help')}<div><strong>建議覆核</strong><ul class="review-flag-list">${a.reviewFlags.map(f=>`<li>${esc(f.message)}</li>`).join('')}</ul><small>這是系統的交叉檢查提示，不是自動改分；請以你看到的推導為準。</small></div></div>`:''}${a.answerText?`<div class="review-answer">${mathText(a.answerText)}</div>`:''}${teacher&&(q?.answer||q?.steps?.length||q?.analysis||q?.rubric?.length)?`<div class="hint-box"><strong>教師參考答案：</strong>${q?.answer?mathText(q.answer):'（未填）'}${(q?.steps||[]).length?`<ol class="solution-steps">${q.steps.map(x=>`<li>${mathText(x)}</li>`).join('')}</ol>`:''}${q?.analysis?`<p class="solution-analysis">${mathText(q.analysis)}</p>`:''}${rubricListHtml(q?.rubric,a.maxScore)}</div>`:''}${a.awaitingReview&&!teacher?`<div class="hint-box">${icon('clock')}教師批閱後才會顯示分數、AI 批閱結果、參考答案與學習建議。你的作答已保存。</div>`:`<p class="info-note${feedbackClass(a.feedback)}">${mathText(a.feedback)}</p>${suggestionCard(a.suggestion)}<p class="field-hint">AI 原建議分：${scoreText(a.aiScore)} · 規則原分：${scoreText(a.ruleScore)} · 教師確認：${scoreText(a.confirmedScore)}</p>`}${teacher?`<form id="review-form"><div class="form-field"><label class="field-label" for="review-score">評分（0–${a.maxScore}）</label><input id="review-score" type="number" min="0" max="${a.maxScore}" step="0.5" value="${a.score??''}" required></div><div class="form-field"><label class="field-label" for="review-feedback">簡要評語 / 下一步建議 <span class="small-text">· 可留空</span></label><textarea class="answer-field" id="review-feedback" placeholder="可留空；若要寫，指出做得好的步驟，再給一個具體可改進的地方。" maxlength="12000"></textarea></div><p id="review-error" class="error-text"></p>${a.aiScore!=null?`<button class="secondary wide" type="button" id="adopt-ai">${icon('spark')}採用 AI 建議（${a.aiScore} 分）</button>`:''}<button class="primary wide" type="submit">${nextId?'保存並看下一題':'保存教師批閱'} ${icon('check')}</button></form>`:`${showRetry?`<button class="secondary wide" id="retry-from-review">再練一次 ${icon('arrow')}</button>`:''}`}`,true);
  if(teacher&&a.image){annotationDone=nextId?(()=>reviewModal(nextId,onDone,snapFor(nextId),list)):(onDone||(()=>recordsPage()));initAnnotation(a);}
  // 存檔只更新這一筆作答（就地取代），不再整頁重抓；佇列還有下一題就直接換題。
  const saveReview=async(score,feedback)=>{
    const btn=$('#review-form [type=submit]'),adopt=$('#adopt-ai');
    if(btn)btn.disabled=true;if(adopt)adopt.disabled=true;
    try{
      const r=await api(`/api/attempts/${a.id}/review`,{score,feedback});
      const updated=r&&r.attempt;
      if(updated){
        const i=S.attempts.findIndex(x=>x.id===updated.id);
        if(i>=0)S.attempts[i]=updated;else S.attempts.push(updated);
        if(assignmentDetail&&Array.isArray(assignmentDetail.attempts)){
          const j=assignmentDetail.attempts.findIndex(x=>x.id===updated.id);
          if(j>=0)assignmentDetail.attempts[j]=updated;else assignmentDetail.attempts.push(updated);
        }
      }
      if(nextId){reviewDirty=true;toast('已保存，接著批下一題。');reviewModal(nextId,onDone,snapFor(nextId),list);return;}
      reviewDirty=false;
      closeModal();
      if(onDone)onDone();else recordsPage();
      toast('教師批閱已保存，學生可查看最新評語與建議。');
    }catch(err){
      if($('#review-error'))$('#review-error').textContent=err.message;
      if(btn)btn.disabled=false;if(adopt)adopt.disabled=false;
    }
  };
  if(teacher){
    $('#review-form').onsubmit=async e=>{e.preventDefault();await saveReview(Number($('#review-score').value),$('#review-feedback').value);};
    const adopt=$('#adopt-ai');
    if(adopt)adopt.onclick=()=>{$('#review-score').value=a.aiScore;saveReview(a.aiScore,$('#review-feedback').value);};
  }else{const retry=$('#retry-from-review');if(retry)retry.onclick=()=>{closeModal();openQuestion(a.questionId);};}
  paintAllAiInk();
}
function growthPage(){page='growth';shell();if(!S.user)return loginModal(growthPage);const days=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);const key=d.toLocaleDateString('en-CA');return {label:`${d.getMonth()+1}/${d.getDate()}`,n:S.attempts.filter(a=>new Date(a.submittedAt).toLocaleDateString('en-CA')===key).length};});const max=Math.max(1,...days.map(d=>d.n));$('#main').innerHTML=`<div class="fade-in">${heading('YOUR LEARNING JOURNEY','學習足跡','進步藏在每一次願意再想一步的練習裡。')}${metrics()}<div class="growth-layout"><section class="panel growth-panel"><h2>最近七天的練習</h2><p>提交次數（含待批閱） · 只呈現真實作答，不產生示例學習紀錄</p><div class="chart">${days.map(d=>`<div class="chart-column"><span class="bar-value">${d.n}</span><div class="bar" style="height:${d.n/max*145+3}px"></div><span class="bar-label">${d.label}</span></div>`).join('')}</div><div class="chart-caption">每一次練習都值得被看見。${S.attempts.length?'繼續保持，鞏固薄弱知識點。':'你還沒有提交練習，從第一道題開始吧。'}</div></section><section class="panel growth-panel"><h2>知識點練習表現</h2><p>得分率是練習表現，不代表能力的完整測量。</p>${(()=>{const practiced=topics.map(t=>({t,st:topicStats(t)})).filter(x=>x.st.n>0).sort((a,b)=>a.st.value-b.st.value);if(!practiced.length)return `<p class="chart-caption">還沒有任何知識點的練習記錄，先去做幾題吧。</p>`;return practiced.map(({t,st})=>`<div class="topic-detail"><div class="knowledge-row"><span>${esc(t)}</span><span>${st.n} 次 · ${st.value}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${st.value}%"></div></div></div>`).join('');})()}</section><section class="panel growth-panel"><h2>${icon('bulb')}下一步學習建議</h2><p>${S.attempts.some(a=>a.status==='graded'&&a.score<a.maxScore)?'從錯題本選擇一道需要鞏固的題目，先回看錯誤步驟，再做同知識點相似題。':'先完成一道基礎題；在能清楚解釋方法後，再挑戰進階題。'}</p><button class="text-button" data-action="start">前往自主練習 ${icon('arrow')}</button></section></div></div>`;}
let AICFG=null;
function aiCapability(label,ok,need){return `<li class="${ok?'ready':''}">${ok?icon('check'):icon('lock')}<div><strong>${esc(label)}</strong><small>${ok?'可用 · ':''}${esc(need)}</small></div></li>`;}
async function aiConfigPage(){page='ai';shell();if(!S.user)return loginModal(aiConfigPage);if(S.user.role!=='teacher'){$('#main').innerHTML=heading('AI ENDPOINT','模型端點','更換模型端點只限教師。')+`<section class="panel">${empty('此頁只限教師','模型端點涉及伺服器金鑰，只開放給教師。',`<button class="primary" data-page="homework">返回作業 ${icon('arrow')}</button>`)}</section>`;return;}$('#main').innerHTML=heading('AI ENDPOINT','模型端點','隨時更換 AI 服務，無需重新啟動。')+`<section class="panel">${empty('正在讀取模型設定','向網站伺服器查詢目前端點。')}</section>`;try{AICFG=await api('/api/ai-config');}catch(e){if(page==='ai')$('#main').innerHTML=heading('AI ENDPOINT','模型端點','讀取設定失敗。')+`<div class="inline-error">${esc(e.message)}</div>`;return;}if(page==='ai')renderAiConfigPage();}
function renderAiConfigPage(){const c=AICFG,a=c.active;const mode={local:'本機模型（可傳送作答）',external:'外部模型（每次需同意）',off:'未接入'}[a.mode]||a.mode;const source={env:'伺服器環境變數',saved:'介面儲存設定',none:'未設定'}[a.source]||a.source;const draft=c.saved||c.env,dis=c.canEdit?'':'disabled';
$('#main').innerHTML=`<div class="fade-in">${heading('AI ENDPOINT','模型端點','隨時更換 AI 服務，無需重新啟動。設定只保存在這台伺服器，金鑰不會傳到瀏覽器。')}<div class="metric-row">${[['目前模式',mode,''],['文字模型',a.model||'—','用於批改、學習建議、拆題與生成'],['視覺模型',a.vision||'—','用於手寫辨識與 AI 建議批註'],['繪圖模型',a.draw||'—',a.drawCustom?'另外指定，用於 AI 依題目畫幾何圖形':'沿用文字模型，用於 AI 依題目畫幾何圖形'],['設定來源',source,'已儲存設定優先於環境變數'],['計費模式',a.thinking?'精確模式（較貴）':'省錢模式（推薦）',a.thinking?'AI 先推理再作答，適合申論／證明題':'AI 直接作答，輸出 token 少，費用約三分之一']].map(([l,v,f])=>`<div class="metric"><div class="metric-label">${l}</div><div class="metric-value" style="font-size:calc(18px*var(--fs));line-height:1.6;word-break:break-all">${esc(v)}</div><div class="metric-foot">${f}</div></div>`).join('')}</div>${c.invalidSaved?`<div class="inline-error">已儲存的端點設定無效，系統已回退環境變數。請重新儲存一組可用的設定。</div>`:''}<div class="settings-layout"><section class="panel settings-panel"><h2>${icon('ai')}更換模型端點</h2><p class="info-note">支援任何 OpenAI 相容的 <code>/chat/completions</code> 端點。本機服務（127.0.0.1／localhost）可用 HTTP；其他主機必須 HTTPS。</p>${!c.canEdit?`<div class="import-warning">${c.tokenRequired?'此伺服器已設定 MATH_ADMIN_TOKEN，需要管理員權杖才能更換端點。':'只有從伺服器本機操作時才可直接更換端點。若需從校內其他電腦管理，請在伺服器設定 MATH_ADMIN_TOKEN 環境變數。'}</div>`:''}<form id="ai-form"><div class="form-field"><label class="field-label" for="ai-base">端點位址</label><input id="ai-base" value="${esc(draft.baseUrl||'')}" placeholder="例如：http://127.0.0.1:11434/v1" maxlength="500" ${dis}></div><div class="form-grid"><div class="form-field"><label class="field-label" for="ai-model">文字模型</label><input id="ai-model" value="${esc(draft.model||'')}" placeholder="例如：qwen2.5:14b" maxlength="200" ${dis}></div><div class="form-field"><label class="field-label" for="ai-vision">視覺模型（可留空）</label><input id="ai-vision" value="${esc(draft.visionModel||'')}" placeholder="須真實支援圖片輸入" maxlength="200" ${dis}></div></div><div class="form-field"><label class="field-label" for="ai-draw">繪圖模型（可留空）</label><input id="ai-draw" value="${esc(draft.drawModel||'')}" placeholder="留空＝沿用文字模型" maxlength="200" ${dis}><small class="field-hint">AI 依題目畫幾何圖形時使用。畫圖是「讀題 → 輸出座標」的推理工作，比批改更吃模型能力；留空就沿用上面的文字模型。</small></div><div class="form-field"><label class="field-label" for="ai-key">API 金鑰</label><input id="ai-key" type="password" autocomplete="new-password" placeholder="${draft.keySet?'已設定 · 留空表示不變更':'未設定 · 若端點無需認證可留空'}" maxlength="8192" ${dis}></div><div class="form-field"><label class="field-label" for="ai-thinking">計費模式</label><label class="checkbox-line"><input type="checkbox" id="ai-thinking" ${a.thinking?'':'checked'}> <b>省錢模式</b>（推薦）<small>關閉 AI 的「思考鏈」，輸出 token 大幅減少，費用約為原本的三分之一。適合選擇題、填空題、計算題與簡短作答。</small></label><p class="field-hint">取消勾選＝<b>精確模式</b>：AI 會先推理再作答，申論題／證明題較準確，但費用較高。此設定僅對 DeepSeek 等支援思考模式的模型有效，其他模型會自動忽略。</p></div>${c.tokenRequired?`<div class="form-field"><label class="field-label" for="ai-token">管理員權杖</label><input id="ai-token" type="password" autocomplete="off" placeholder="MATH_ADMIN_TOKEN" maxlength="256"></div>`:''}<p class="field-hint">金鑰只會送往網站伺服器並存於伺服器的資料庫；介面永遠不會讀回金鑰內容，只顯示是否已設定。</p><p class="error-text" id="ai-error"></p><div class="ai-config-actions"><button class="secondary" type="button" id="ai-test" ${dis}>${icon('check')}測試文字模型</button><button class="secondary" type="button" id="ai-test-vision" ${dis}>${icon('image')}測試視覺模型</button><button class="primary" type="submit" ${dis}>${icon('check')}儲存並立即啟用</button></div><div id="ai-test-result"></div></form>${c.canEdit?`<button class="text-button" id="ai-clear" style="font-size:calc(14px*var(--fs));margin-top:14px">清除已儲存設定，改用環境變數</button>`:''}</section><div><section class="panel settings-panel"><h2>${icon('spark')}這個端點能支援甚麼</h2><ul class="capability-list">${aiCapability('批改文字作答、產生學習建議',a.configured,'需要文字模型')}${aiCapability('拆題與生成相似／進階題',a.configured,'需要文字模型')}${aiCapability('手寫辨識與 AI 建議批註',!!a.vision,'需要視覺模型')}</ul></section><section class="panel settings-panel" style="margin-top:20px"><h2>${icon('lock')}安全說明</h2><ul><li>金鑰保存在伺服器的 SQLite 資料庫（檔案權限 600）。</li><li>金鑰不會回傳瀏覽器，介面只顯示是否已設定。</li><li>${c.tokenRequired?'更換端點需要管理員權杖。':'未設定 MATH_ADMIN_TOKEN 時，只有伺服器本機可以更換端點。'}</li><li>外部端點必須使用 HTTPS；非本機位址不接受 HTTP。</li><li>使用外部模型傳送學生作答前，系統會要求逐次同意。</li><li>AI 的數學判斷與批註只作教師覆核的提示，不可直接作為成績。</li></ul></section></div></div></div>`;
const body=()=>{const v={baseUrl:$('#ai-base').value.trim(),model:$('#ai-model').value.trim(),visionModel:$('#ai-vision').value.trim(),drawModel:$('#ai-draw').value.trim()};if($('#ai-key').value)v.apiKey=$('#ai-key').value;if($('#ai-token')?.value)v.adminToken=$('#ai-token').value;if($('#ai-thinking'))v.thinking=!$('#ai-thinking').checked;return v;};
$('#ai-form').onsubmit=async e=>{e.preventDefault();const b=$('#ai-form button[type=submit]');b.disabled=true;$('#ai-error').textContent='';try{await api('/api/ai-config',body());toast('模型端點已更新並立即生效。');aiConfigPage();}catch(err){$('#ai-error').textContent=err.message;b.disabled=false;}};
const runTest=async vision=>{const btn=$(vision?'#ai-test-vision':'#ai-test'),original=btn.innerHTML;btn.disabled=true;btn.innerHTML=icon('clock')+'測試中…';$('#ai-test-result').innerHTML='';try{const payload=body();if(vision)payload.vision=true;const r=await api('/api/ai-config/test',payload);$('#ai-test-result').innerHTML=`<div class="hint-box">連線成功（${r.mode==='local'?'本機':'外部'} · ${esc(r.model)}）${r.testedVision?'；端點接受了圖片輸入，但這不證明辨識準確度。':''}</div>`;}catch(err){$('#ai-test-result').innerHTML=`<div class="inline-error">連線失敗：${esc(err.message)}</div>`;}finally{btn.disabled=false;btn.innerHTML=original;}};
$('#ai-test').onclick=()=>runTest(false);$('#ai-test-vision').onclick=()=>runTest(true);
if($('#ai-thinking'))$('#ai-thinking').onchange=async e=>{const on=e.target.checked;e.target.disabled=true;try{const r=await api('/api/ai-config/economy',{economy:on});AICFG.active=r.active;toast(on?'已切換為省錢模式：AI 直接作答，費用約三分之一。':'已切換為精確模式：AI 先推理再作答，費用較高。');renderAiConfigPage();}catch(err){toast(err.message);e.target.checked=!on;}finally{e.target.disabled=false;}};
if($('#ai-clear'))$('#ai-clear').onclick=async()=>{if(!confirm('清除已儲存的模型設定？AI 功能將停用，除非環境變數另有設定。'))return;try{await api('/api/ai-config',{baseUrl:'',model:''});toast('已清除已儲存的設定。');aiConfigPage();}catch(e){toast(e.message);}};}
let ADMIN_STATS=null;
function formatBytes(value){const n=Number(value)||0;if(n<=0)return '0 B';const units=['B','KB','MB','GB','TB'];const i=Math.min(units.length-1,Math.floor(Math.log(n)/Math.log(1024)));return (n/Math.pow(1024,i)).toFixed(i?1:0)+' '+units[i];}
// 用量卡片：讓教師知道題庫、作答與圖片各佔多少，以及還有多少空間可以回收。
function adminStatsCards(stats){
  if(!stats)return `<div class="metric"><div class="metric-label">用量</div><div class="metric-value">讀取中…</div><div class="metric-foot">正在查詢本機資料庫</div></div>`;
  const d=stats.database,c=stats.counts,img=stats.images;
  const cards=[['資料庫檔案',formatBytes(d.bytes),`可回收 ${formatBytes(d.reclaimableBytes)} · WAL ${formatBytes(d.walBytes)}`],
    ['題庫題目',`${c.questions} 題`,`跨學年保留 · 題目圖形 ${img.questionFigure} 張`],
    ['作答紀錄',`${c.attempts} 筆`,`手寫圖 ${img.handwriting} 張 · 教師批註 ${img.annotation} 張`],
    ['圖片占用',formatBytes(img.inDatabaseBytes),img.storageMode==='r2'?`另有 ${img.inObjectStorage} 張在物件儲存`:'目前存在資料庫內（可設定 R2 搬出）'],
    ['最近學年重置',stats.lastStudentReset?dateText(stats.lastStudentReset):'尚未執行','重置只清學生資料，題庫保留']];
  return cards.map(([label,value,foot])=>`<div class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(String(value))}</div><div class="metric-foot">${esc(foot)}</div></div>`).join('');
}
// 網盤備份：手寫圖／題目圖形／批註在上傳當下就已進網盤；這裡再把資料庫快照與題庫歸檔送上去。
function backupZoneHtml(b){
  if(!b)return `<h3>${icon('upload')}網盤備份</h3><p class="field-hint">正在讀取備份狀態…</p>`;
  const rows=[[ '網盤', b.bucket||'已設定', b.endpoint?`${b.endpoint}${b.region?` · region ${b.region}`:''}`:'S3 相容端點'],
              [ '最近備份', b.lastAt?dateText(b.lastAt):'尚未備份',
                b.lastTrigger==='scheduled'?'由排程自動執行':b.lastTrigger==='manual'?'手動執行':'—'],
              [ '保留份數', `${b.count} / ${b.keep}`, '超過就自動刪掉最舊的一份'],
              [ '自動備份', b.intervalHours?`每 ${b.intervalHours} 小時`:'未啟用',
                b.intervalHours?'由 MATH_BACKUP_HOURS 設定':'在部署平台設定 MATH_BACKUP_HOURS 即會開啟']];
  return `<h3>${icon('upload')}網盤備份</h3>
  <p class="field-hint">學生手寫圖、題目圖形與教師批註在<strong>上傳當下</strong>就已經存進網盤；這裡再把<strong>資料庫快照</strong>（帳號、班級、作業、作答、分數）與<strong>題庫歸檔</strong>一起送上去。兩者都在網盤上，就算伺服器整台消失也能還原。</p>
  ${b.configured?`<div class="metric-row">${rows.map(([l,v,f])=>`<div class="metric"><div class="metric-label">${esc(l)}</div><div class="metric-value" style="font-size:calc(17px*var(--fs))">${esc(String(v))}</div><div class="metric-foot">${esc(f)}</div></div>`).join('')}</div>
  <div class="admin-actions"><button class="secondary" id="admin-backup-now">${icon('upload')}立即備份到網盤</button></div>`
  :`<div class="import-warning">尚未設定網盤。在部署平台加入 <code>R2_ACCOUNT_ID</code>、<code>R2_ACCESS_KEY_ID</code>、<code>R2_SECRET_ACCESS_KEY</code>、<code>R2_BUCKET</code> 四個環境變數後重新部署，手寫圖與備份就會自動存到網盤。改用 AWS S3、Backblaze B2、Wasabi 或自架 MinIO 時，改填 <code>R2_ENDPOINT</code>（＋<code>R2_REGION</code>），並可省略 <code>R2_ACCOUNT_ID</code>。${b.error?`<br>目前狀態：${esc(b.error)}`:''}</div>`}
  ${(b.history||[]).length?`<details class="backup-history"><summary>最近 ${b.history.length} 次備份</summary><ul>${b.history.map(h=>`<li><strong>${dateText(h.at)}</strong> · ${h.trigger==='scheduled'?'排程':'手動'} · ${formatBytes(h.bytes)}<br><code>${esc((h.files||[]).join(' , '))}</code></li>`).join('')}</ul></details>`:''}`;
}
function bindBackupZone(){
  const b=$('#admin-backup-now');
  if(!b)return;
  b.onclick=async()=>{const original=b.innerHTML;b.disabled=true;b.innerHTML=icon('clock')+'正在備份…';
    try{const r=await api('/api/admin/backup/upload',{});ADMIN_STATS=ADMIN_STATS||{};ADMIN_STATS.backup=r.status;
      $('#admin-backup-zone').innerHTML=backupZoneHtml(r.status);bindBackupZone();
      toast(`已備份到網盤（${formatBytes(r.entry.bytes)}，保留 ${r.kept} 份）。`);}
    catch(e){toast(e.message);b.disabled=false;b.innerHTML=original;}};
}
// 還原是「新增」資料：不刪現有內容、不覆蓋同名帳號。歸檔不含密碼，還原後要重新發密碼。
function restoreHtml(){
  return `<div class="restore-zone">
  <h3>${icon('upload')}從歸檔還原</h3>
  <p class="field-hint">還原只會<strong>新增</strong>資料，不會刪掉現有內容；同名的學生帳號會跳過不覆蓋。建議順序：<strong>先還原題庫 → 再還原學生作業</strong>，這樣題號才對得上。歸檔不含密碼，還原後的學生需要新密碼。</p>
  <div class="restore-grid">
    <div class="restore-card"><strong>1 · 還原題庫歸檔</strong>
      <p class="field-hint">上傳題庫歸檔 <code>.json</code>。預設只補上缺少的題目（依標題比對）。</p>
      <label class="checkbox-line"><input type="checkbox" id="restore-replace">整批取代現有題庫（會保留原編號；題庫已被作答引用時會被擋下）</label>
      <input id="restore-questions-file" type="file" accept=".json,application/json">
      <button class="secondary" id="restore-questions-btn">${icon('upload')}還原題庫</button>
      <div class="restore-result" id="restore-questions-result"></div></div>
    <div class="restore-card"><strong>2 · 還原學生作業歸檔</strong>
      <p class="field-hint">上傳學生歸檔 <code>.jsonl</code>，會重建學生帳號、班級、作業、作答與手寫圖。</p>
      <div class="form-field"><label class="field-label" for="restore-password">還原後學生的初始密碼（留空＝每人自動產生）</label><input id="restore-password" type="password" minlength="10" maxlength="256" autocomplete="new-password" placeholder="至少 10 字"></div>
      <input id="restore-students-file" type="file" accept=".jsonl,.txt,application/x-ndjson">
      <button class="secondary" id="restore-students-btn">${icon('upload')}還原學生作業</button>
      <div class="restore-result" id="restore-students-result"></div></div>
    <div class="restore-card"><strong>3 · 還原完整資料庫備份</strong>
      <p class="field-hint">上傳 <code>.sqlite3</code> 備份，<strong>會取代整個資料庫</strong>（題庫＋學生＋作答＋圖片一次還原）。目前的資料庫會自動保留一份。</p>
      <input id="restore-db-file" type="file" accept=".sqlite3,.db,application/vnd.sqlite3,application/octet-stream">
      <button class="danger" id="restore-db-btn">${icon('upload')}取代並還原資料庫</button>
      <div class="restore-result" id="restore-db-result"></div></div>
  </div></div>`;
}
async function uploadFile(path,file){
  if(!file)throw new Error('請先選擇要上傳的檔案。');
  const response=await fetch(path,{method:'POST',body:file,credentials:'same-origin',
    headers:{'Content-Type':'application/octet-stream'}});
  const text=await response.text();
  let data=null;try{data=JSON.parse(text);}catch(e){data=null;}
  if(!response.ok)throw new Error((data&&data.error)||`上傳失敗（HTTP ${response.status}）`);
  return data||{};
}
function countList(obj){if(!obj)return '';return Object.entries(obj).filter(([,v])=>v).map(([k,v])=>`${k} ${v}`).join(' · ');}
function dataAdminHtml(){
  if(S.user?.role!=='teacher')return '';
  // 備份、歸檔、還原與學年重置都會動到全校資料，只限管理員（最早建立的教師帳號）。
  if(!S.user.isOwner)return `<section class="panel panel-pad" style="margin-top:20px"><h2>${icon('file')}資料管理</h2>
  <p class="info-note">資料備份、歸檔、還原與學年重置都會影響<strong>全校</strong>的資料，只限<strong>管理員帳號</strong>（學校最早建立的那個教師帳號）使用。需要備份或匯出時，請找管理員協助。</p></section>`;
  return `<section class="panel panel-pad" style="margin-top:20px"><h2>${icon('file')}資料管理</h2>
  <p class="field-hint">題庫歸檔與學生作業歸檔是分開的：<strong>題庫跨學年保留</strong>，學生資料每學年重新設定。下載的檔案由你自行保存，伺服器不會留存。</p>
  <div class="metric-row" id="admin-stats">${adminStatsCards(ADMIN_STATS)}</div>
  <div class="admin-actions">
    <button class="secondary" data-admin-download="/api/admin/backup/db">${icon('file')}下載完整資料庫備份</button>
    <button class="secondary" data-admin-download="/api/admin/archive/questions">${icon('upload')}匯出題庫歸檔（JSON）</button>
    <button class="secondary" data-admin-download="/api/admin/archive/students">${icon('upload')}匯出學生作業歸檔（含手寫圖）</button>
    <button class="secondary" data-admin-download="/api/admin/archive/students?images=0">${icon('file')}只匯出文字成績紀錄</button>
    <button class="secondary" id="admin-refresh">${icon('undo')}重新整理用量</button>
    <button class="secondary" id="admin-vacuum">${icon('check')}壓實資料庫</button>
  </div>
  <p class="field-hint">「壓實資料庫」把刪除後留下的空間還給系統；資料量大時可能需要數十秒，期間請勿關閉頁面。</p>
  <div class="backup-zone" id="admin-backup-zone">${backupZoneHtml(ADMIN_STATS&&ADMIN_STATS.backup)}</div>
  ${restoreHtml()}
  <div class="danger-zone">
    <h3>${icon('trash')}學年重置（新學年開始前使用）</h3>
    <p>會清空：<strong>學生帳號、班級、作業、所有作答與手寫圖、模擬測驗、訂正紀錄</strong>。</p>
    <p>一律保留：<strong>題庫（<span id="admin-question-count">…</span> 題）、教師帳號、內建演示帳號、日曆提醒</strong>。</p>
    <p class="field-hint">執行前請先下載「學生作業歸檔」；刪除後無法還原。歸檔不含密碼，新學年的學生要重新匯入名單並發新密碼。</p>
    <div class="form-field" style="max-width:280px"><label class="field-label" for="reset-confirm">輸入 RESET 以確認</label><input id="reset-confirm" maxlength="20" placeholder="RESET" autocomplete="off"></div>
    <p class="error-text" id="reset-error"></p>
    <button class="danger" id="admin-reset">${icon('trash')}執行學年重置</button>
  </div></section>`;
}
async function loadAdminStats(notify){
  if(S.user?.role!=='teacher'||!S.user.isOwner)return;
  try{ADMIN_STATS=await api('/api/admin/storage');
    const box=$('#admin-stats');if(box)box.innerHTML=adminStatsCards(ADMIN_STATS);
    const count=$('#admin-question-count');if(count)count.textContent=ADMIN_STATS.counts.questions;
    const zone=$('#admin-backup-zone');if(zone){zone.innerHTML=backupZoneHtml(ADMIN_STATS.backup);bindBackupZone();}
    if(notify)toast('已更新用量。');}
  catch(e){if(notify)toast(e.message);}
}
function bindDataAdmin(){
  // 非管理員看到的是提示區塊，底下沒有任何資料管理控制項可以綁。
  if(S.user?.role!=='teacher'||!S.user.isOwner)return;
  bindBackupZone();
  $$('[data-admin-download]').forEach(b=>b.onclick=()=>{const a=document.createElement('a');a.href=b.dataset.adminDownload;a.rel='noopener';document.body.appendChild(a);a.click();a.remove();toast('已開始下載，請查看瀏覽器的下載項目。');});
  if($('#admin-refresh'))$('#admin-refresh').onclick=()=>loadAdminStats(true);
  if($('#admin-vacuum'))$('#admin-vacuum').onclick=async()=>{const b=$('#admin-vacuum'),original=b.innerHTML;b.disabled=true;b.innerHTML=icon('clock')+'壓實中…';try{const r=await api('/api/admin/vacuum',{});toast(`已壓實：${formatBytes(r.beforeBytes)} → ${formatBytes(r.afterBytes)}，回收 ${formatBytes(r.savedBytes)}。`);await loadAdminStats();}catch(e){toast(e.message);}finally{b.disabled=false;b.innerHTML=original;}};
  if($('#admin-reset'))$('#admin-reset').onclick=async()=>{
    const typed=$('#reset-confirm').value.trim();
    if(typed.toUpperCase()!=='RESET'){$('#reset-error').textContent='請先輸入 RESET 才能執行學年重置。';return;}
    if(!confirm('確定清空這一學年的學生帳號、班級、作業與所有作答嗎？題庫會保留，但刪除後無法還原。'))return;
    const b=$('#admin-reset');b.disabled=true;$('#reset-error').textContent='';
    try{const r=await api('/api/admin/reset/students',{confirm:typed});
      toast(`學年重置完成：刪除 ${r.removed.students} 個學生帳號、${r.removed.attempts} 筆作答；題庫 ${r.kept.questions} 題保留。`);
      $('#reset-confirm').value='';await refresh();settingsPage();}
    catch(e){$('#reset-error').textContent=e.message;b.disabled=false;}
  };
  const restoreQuestions=$('#restore-questions-btn');
  if(restoreQuestions)restoreQuestions.onclick=async()=>{
    const replace=$('#restore-replace').checked;
    if(replace&&!confirm('整批取代會先清空現有題庫，再寫入歸檔內容。確定嗎？'))return;
    const box=$('#restore-questions-result');box.innerHTML='';
    const original=restoreQuestions.innerHTML;restoreQuestions.disabled=true;restoreQuestions.innerHTML=icon('clock')+'還原中…';
    try{const r=await uploadFile('/api/admin/restore/questions'+(replace?'?replace=1':''),$('#restore-questions-file').files[0]);
      box.innerHTML=`<div class="hint-box">題庫還原完成：新增 <strong>${r.inserted}</strong> 題、略過 ${r.skipped} 題（已存在），歸檔共 ${r.total} 題。${esc(r.notice)}</div>`;
      await loadAdminStats();}
    catch(e){box.innerHTML=`<div class="inline-error">${esc(e.message)}</div>`;}
    finally{restoreQuestions.disabled=false;restoreQuestions.innerHTML=original;}
  };
  const restoreStudents=$('#restore-students-btn');
  if(restoreStudents)restoreStudents.onclick=async()=>{
    const password=$('#restore-password').value;
    if(password&&password.length<10){$('#restore-students-result').innerHTML='<div class="inline-error">初始密碼至少 10 字。</div>';return;}
    if(!confirm('將依歸檔重建學生帳號、班級、作業與作答（不會刪除現有資料）。確定嗎？'))return;
    const box=$('#restore-students-result');box.innerHTML='';
    const original=restoreStudents.innerHTML;restoreStudents.disabled=true;restoreStudents.innerHTML=icon('clock')+'還原中…';
    try{const path='/api/admin/restore/students'+(password?'?password='+encodeURIComponent(password):'');
      const r=await uploadFile(path,$('#restore-students-file').files[0]);
      const rows=(r.credentials||[]).map(c=>`${c.username}\t${c.seat||''}\t${c.password}`).join('\n');
      const header=r.usedSharedPassword?'學號\t班內號\t密碼（你設定的初始密碼）':'學號\t班內號\t自動產生的密碼';
      box.innerHTML=`<div class="hint-box">學生作業還原完成：${countList(r.written)}。${countList(r.skipped)?`略過：${countList(r.skipped)}。`:''}${r.unreadableImages?`有 ${r.unreadableImages} 張圖片無法讀取，已略過。`:''}${r.questionMapApplied?'題號已依題庫還原對照表換算。':''}</div>`
      +(rows?`<div class="import-warning">請把下面的密碼交給學生（只顯示這一次）。</div><pre class="code-block">${esc(header+'\n'+rows)}</pre><button class="secondary" id="restore-copy">${icon('file')}複製帳號密碼</button>`:'');
      const copy=$('#restore-copy');
      if(copy)copy.onclick=async()=>{try{await navigator.clipboard.writeText(header+'\n'+rows);toast('已複製，請妥善保管。');}catch(e){toast('無法自動複製，請手動選取。');}};
      await loadAdminStats();}
    catch(e){box.innerHTML=`<div class="inline-error">${esc(e.message)}</div>`;}
    finally{restoreStudents.disabled=false;restoreStudents.innerHTML=original;}
  };
  const restoreDb=$('#restore-db-btn');
  if(restoreDb)restoreDb.onclick=async()=>{
    if(!confirm('這會用備份檔取代目前的整個資料庫（題庫、學生、作答、圖片全部換成備份內容）。目前的資料庫會自動保留一份。確定嗎？'))return;
    const box=$('#restore-db-result');box.innerHTML='';
    const original=restoreDb.innerHTML;restoreDb.disabled=true;restoreDb.innerHTML=icon('clock')+'還原中…';
    try{const r=await uploadFile('/api/admin/restore/db',$('#restore-db-file').files[0]);
      box.innerHTML=`<div class="hint-box">資料庫已還原：題庫 ${r.counts.questions} 題、作答 ${r.counts.attempts} 筆、帳號 ${r.counts.users} 個。<br>${esc(r.notice)}<br>畫面即將重新載入；若顯示未登入，請用原本的帳密登入。</div>`;
      setTimeout(()=>location.reload(),2600);}
    catch(e){box.innerHTML=`<div class="inline-error">${esc(e.message)}</div>`;restoreDb.disabled=false;restoreDb.innerHTML=original;}
  };
  loadAdminStats();
}
function settingsPage(){page='settings';shell();$('#main').innerHTML=`<div class="fade-in">${heading('STORAGE & PRIVACY','設定與隱私','資料保存在網站伺服器；實際位置由管理員確認。AI 服務由管理員配置。')}<div class="settings-layout"><section class="panel settings-panel"><h2>${icon('lock')}AI 批閱服務</h2><div class="settings-status"><strong><i class="status-dot"></i>${S.ai.configured?`已配置${S.ai.mode==='local'?'本地':'外部'}模型`:'尚未接入 AI 服務'}</strong><p>${S.ai.configured?'可用於拆題、生成相似或進階題、作答建議評分。模型：'+esc(S.ai.model):'現有題庫、規則拆題、手寫保存、教師批閱仍可使用。未接入時，不會生成假的 AI 成績或評語。'}</p></div>${S.user?.role==='teacher'?`<button class="secondary wide" id="ai-config-link" style="font-size:calc(14px*var(--fs));margin-bottom:16px">${icon('ai')}前往模型端點設定</button>`:''}<details class="settings-details"><summary>管理員配置（環境變數，部署參考）</summary><p class="info-note">由伺服器環境變數設定相容的 AI 介面，密鑰不會保存於瀏覽器。建議優先使用校內本地視覺模型。</p><pre class="code-block">MATH_AI_BASE_URL=http://127.0.0.1:11434/v1
MATH_AI_MODEL=你的文字模型名稱
MATH_AI_VISION_MODEL=你的視覺模型名稱
MATH_AI_DRAW_MODEL=你的繪圖模型名稱（選用，留空沿用文字模型）
MATH_AI_API_KEY=伺服器端密鑰（若需要）</pre><p class="info-note">上述是配置格式示例，並非已安裝的模型。設定後需重新啟動伺服器；真實模型須由學校部署並測試。</p></details><div class="import-warning">作業的 AI 評分只是建議，不應直接決定正式考試成績；無法辨認的手寫、複雜證明及特殊解法，必須交由教師覆核。自主練習與自助模擬測驗由 AI 即時評分並記錄分數，不需教師批閱，分數只作個人練習紀錄。</div></section><div><section class="panel settings-panel"><h2>資料保護</h2><details class="settings-details"><summary>我們如何保護資料</summary><ul><li>資料保存在網站伺服器；實際位置由管理員確認。</li><li>學生僅可讀取自己的作答；教師可查看及批閱。</li><li>手寫圖片受登入與角色權限保護。</li><li>外部 AI 作答與試卷傳送需逐次明確同意。</li><li>收藏只保存於本瀏覽器，不跨裝置同步。</li><li>正式部署需 HTTPS、存取限制與獨立學生帳戶。</li></ul></details>${S.user?.role==='teacher'?`<button class="secondary wide" id="manage-users" style="font-size:calc(14px*var(--fs));margin-bottom:14px">${icon('lock')}管理帳號（教師與學生）</button>`:''}<button class="text-button" id="deployment-help" style="font-size:calc(14px*var(--fs))">查看啟動與內網使用方式 ${icon('arrow')}</button></section><section class="panel settings-panel" style="margin-top:20px"><h2>帳戶密碼</h2>${S.user?`<form id="password-form"><div class="form-field"><label class="field-label" for="old-password">目前密碼</label><input id="old-password" type="password" autocomplete="current-password" required maxlength="256"></div><div class="form-field"><label class="field-label" for="new-password">新密碼（至少10字）</label><input id="new-password" type="password" autocomplete="new-password" minlength="10" maxlength="256" required></div><p class="error-text" id="password-error"></p><button class="secondary" type="submit">更新密碼 ${icon('lock')}</button></form>`:`<p class="info-note">登入後可更換演示帳戶密碼。</p><button class="secondary" data-action="login">登入帳戶</button>`}</section></div></div>${dataAdminHtml()}</div>`;$('#deployment-help').onclick=deploymentHelp;if($('#ai-config-link'))$('#ai-config-link').onclick=()=>navigate('ai');if($('#manage-users'))$('#manage-users').onclick=manageUsers;bindDataAdmin();if($('#password-form'))$('#password-form').onsubmit=async e=>{e.preventDefault();const btn=$('[type="submit"]',e.target);btn.disabled=true;try{const r=await api('/api/change-password',{oldPassword:$('#old-password').value,newPassword:$('#new-password').value});await refresh();settingsPage();toast(r.notice);}catch(err){$('#password-error').textContent=err.message;btn.disabled=false;}};}
function randomPassword(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';const a=new Uint32Array(12);crypto.getRandomValues(a);return[...a].map(n=>chars[n%chars.length]).join('');}
const BULK_FIELD_NAMES={name:'姓名',username:'學號',seat:'班內號',password:'密碼'};
const BULK_HEADERS={name:/^(姓名|名字|名稱|名称|學生|学生|name)$/i,username:/^(學號|学号|帳號|帐号|账号|登入帳號|登入帐号|username|account|login|id)$/i,seat:/^(班內號|班内号|班號|班号|座號|座号|seat|no|number)$/i,password:/^(密碼|密码|password|passwd|pass|pwd)$/i};
const BULK_ORDERS={name_username_password:['name','username','password'],username_seat_password:['username','seat','password'],username_password:['username','password']};
// 標題列：每一欄都能辨識且不重複時，直接依標題決定欄位順序（例如「學號,班內號,密碼」）。
function bulkHeaderFields(cells){const kinds=cells.map(v=>Object.keys(BULK_HEADERS).find(f=>BULK_HEADERS[f].test(v))||null);return kinds.some(k=>!k)||new Set(kinds).size!==kinds.length?null:kinds;}
// 沒有標題列時的猜測：學號是3–40個英數字；班內號是短號碼（1、03、3A）。
function bulkGuessFields(parts){const isUser=v=>/^[A-Za-z0-9_.-]{3,40}$/.test(v),isSeat=v=>/^[A-Za-z]{0,2}\d{1,3}$/.test(v)||/^[A-Za-z]\d{0,2}$/.test(v),isPw=v=>v.length>=10||(v.length>=6&&/\d/.test(v)&&/[A-Za-z]/.test(v));if(parts.length===3){if(isUser(parts[0])&&isSeat(parts[1]))return['username','seat','password'];if(isUser(parts[1]))return['name','username','password'];return null;}if(parts.length===2){if(isUser(parts[0])&&(!parts[1]||isPw(parts[1])))return['username','password'];if(isUser(parts[1]))return['name','username'];return null;}if(parts.length===1&&isUser(parts[0]))return['username'];return null;}
// 名單解析：姓名可以完全省略（只有學號、班內號、密碼也能匯入）；密碼省略時自動產生。
function parseBulkStudents(text,order='auto'){const rows=[],errors=[];let fields=BULK_ORDERS[order]||null;const fixed=!!fields;String(text||'').split(/\r?\n/).forEach((line,i)=>{const raw=line.trim();if(!raw||raw.startsWith('#'))return;const parts=raw.split(/[,\t，;；]/).map(v=>v.trim());const header=bulkHeaderFields(parts);if(header){if(!fixed)fields=header;return;}if(!fields)fields=bulkGuessFields(parts);if(!fields){errors.push(`第 ${i+1} 行格式不正確：需要「學號,班內號,密碼」或「姓名,學號,密碼」，每行一位學生。`);return;}const least=fields[fields.length-1]==='password'?fields.length-1:fields.length;if(parts.length<least||parts.length>fields.length){errors.push(`第 ${i+1} 行欄位數不正確，需要「${fields.map(f=>BULK_FIELD_NAMES[f]).join(',')}」。`);return;}const rec={};fields.forEach((f,idx)=>{rec[f]=(parts[idx]||'').trim();});if(!rec.username){errors.push(`第 ${i+1} 行學號不可留空。`);return;}if(!/^[A-Za-z0-9_.-]{3,40}$/.test(rec.username)){errors.push(`第 ${i+1} 行學號須為3至40個英文字母、數字或 _ . -。`);return;}if(rec.seat&&!/^[A-Za-z0-9-]{1,20}$/.test(rec.seat)){errors.push(`第 ${i+1} 行班內號只接受1至20個英文字母、數字或連字號。`);return;}if(rec.password&&rec.password.length<10){errors.push(`第 ${i+1} 行密碼必須至少10字。`);return;}rows.push({name:rec.name||'',username:rec.username,seat:rec.seat||'',password:rec.password||randomPassword(),generated:!rec.password});});return{rows,errors,fields};}
let ROSTER_USERS=[],ROSTER_OWNER=null;
// 誰能改這個帳號：管理員可改全部；教師可改自己與自己建立的學生；其餘只可檢視。
function canEditAccount(u){return !!S.user?.isOwner||u.id===S.user?.id||(u.role==='student'&&u.createdBy===S.user?.id);}
function accountRow(u){
  const teacher=u.role==='teacher',admin=u.id===ROSTER_OWNER,mine=canEditAccount(u);
  const maker=(!mine&&u.createdBy)?ROSTER_USERS.find(x=>x.id===u.createdBy):null;
  return `<div class="roster-row"><span class="roster-who">${admin?'<span class="role-badge admin">管理員</span>':teacher?'<span class="role-badge">教師</span>':u.seat?`<span class="seat-badge">${esc(u.seat)}</span>`:''}${esc(u.name)}${u.username===u.name?'':`<span class="small-text">${esc(u.username)}</span>`}${maker?`<span class="small-text">由 ${esc(maker.name)} 建立</span>`:''}</span>${mine?`<button class="text-button" data-edit-user="${u.id}">編輯</button>`:'<span class="small-text">僅可檢視</span>'}</div>`;
}
// 編輯帳號：只送出有改動的欄位；重設密碼會讓該帳號目前的登入立即失效。
function editAccountModal(id){
  const u=ROSTER_USERS.find(x=>x.id===id);
  if(!u)return;
  const teacher=u.role==='teacher',self=u.id===S.user?.id;
  modal(`<p class="eyebrow">${teacher?'EDIT TEACHER':'EDIT STUDENT'}</p><h2>${teacher?'編輯教師帳號':'編輯學生資料'}</h2>
  <p class="modal-intro">只填要修改的欄位就好。${teacher?'帳號就是教師的登入名稱。':'學號就是學生的登入帳號。'}</p>
  <form id="account-edit-form">
  <div class="form-grid"><div class="form-field"><label class="field-label" for="edit-username">${teacher?'帳號（登入名稱）':'學號（登入帳號）'}</label><input id="edit-username" value="${esc(u.username)}" minlength="3" maxlength="40" required autocomplete="off"></div>
  ${teacher?'':`<div class="form-field"><label class="field-label" for="edit-seat">班內號（可留空）</label><input id="edit-seat" value="${esc(u.seat||'')}" maxlength="20"></div>`}</div>
  <div class="form-field"><label class="field-label" for="edit-name">姓名${teacher?'':'（可留空，預設用學號）'}</label><input id="edit-name" value="${esc(u.name)}" maxlength="60"${teacher?' required':''}></div>
  <div class="form-field"><label class="field-label" for="edit-password">重設密碼（留空＝不變更）</label><input id="edit-password" type="password" minlength="10" maxlength="256" autocomplete="new-password" placeholder="至少 10 字"></div>
  <p class="field-hint">重設密碼後，${teacher?'這位教師':'這位學生'}目前的登入會立即失效，需要用新密碼重新登入。${self&&teacher?'<strong>你正在修改自己的帳號，重設密碼後會被登出。</strong>':''}</p>
  <p class="error-text" id="edit-error"></p>
  <div class="submit-row"><button class="primary" type="submit">儲存變更 ${icon('check')}</button><button class="secondary" type="button" id="edit-cancel">返回帳號管理</button></div>
  </form>
  ${S.user?.isOwner&&!self?`<div class="danger-zone" style="margin-top:18px">
    <h3>${icon('trash')}刪除帳號</h3>
    <p>${teacher?'這位教師的班級與作業會轉給管理員，他建立的學生改為無歸屬（只有管理員能改）。':'會一併刪除這位學生的所有作答、手寫圖與批改紀錄。'}刪除後無法還原。</p>
    <div class="form-field" style="max-width:240px"><label class="field-label" for="delete-confirm">輸入 DELETE 以確認</label><input id="delete-confirm" maxlength="20" placeholder="DELETE" autocomplete="off"></div>
    <p class="error-text" id="delete-error"></p>
    <button class="danger" type="button" id="delete-account">${icon('trash')}刪除帳號</button>
  </div>`:''}`);
  $('#edit-cancel').onclick=()=>manageUsers();
  if($('#delete-account'))$('#delete-account').onclick=async()=>{
    const typed=$('#delete-confirm').value;
    if(typed.trim().toUpperCase()!=='DELETE'){$('#delete-error').textContent='請輸入 DELETE 確認。';return;}
    if(!window.confirm(`確定要刪除「${u.name}」的帳號嗎？此操作無法還原。`))return;
    const b=$('#delete-account');b.disabled=true;$('#delete-error').textContent='';
    try{const r=await api(`/api/users/${id}/delete`,{confirm:typed});
      toast(`已刪除 ${r.deleted.name} 的帳號：${r.removed.attempts} 筆作答${r.imagesDeleted?`、${r.imagesDeleted} 張圖片`:''}。`);
      await manageUsers();}
    catch(err){$('#delete-error').textContent=err.message;b.disabled=false;}
  };
  $('#account-edit-form').onsubmit=async e=>{
    e.preventDefault();
    const body={};
    const username=$('#edit-username').value.trim(),name=$('#edit-name').value,pw=$('#edit-password').value;
    const seatField=$('#edit-seat');
    if(username!==u.username)body.username=username;
    if(seatField&&seatField.value.trim()!==(u.seat||''))body.seat=seatField.value.trim();
    if(name!==u.name)body.name=name;
    if(pw)body.password=pw;
    if(!Object.keys(body).length){$('#edit-error').textContent='沒有變更的欄位。';return;}
    const b=$('#account-edit-form button[type=submit]');b.disabled=true;$('#edit-error').textContent='';
    try{const r=await api(`/api/users/${id}/update`,body);
      // 重設自己的密碼會刪掉目前這個登入，直接回到登入畫面，免得後續請求全部 401。
      if(body.password&&self){closeModal();S.user=null;shell();loginModal();toast('密碼已更新，請用新密碼重新登入。');return;}
      toast(`已更新 ${r.user.username} 的${r.changed.join('、')}。${r.passwordReset?`已登出${teacher?'該教師':'該生'}目前的登入。`:''}`);
      await manageUsers();}
    catch(err){$('#edit-error').textContent=err.message;b.disabled=false;}
  };
}
async function manageUsers(){try{const {users,ownerId}=await api('/api/users');ROSTER_USERS=users;ROSTER_OWNER=ownerId;
const teachers=users.filter(u=>u.role==='teacher'),students=users.filter(u=>u.role==='student');
const canAddTeacher=!!S.user?.isOwner;
modal(`<p class="eyebrow">ACCOUNTS</p><h2>帳號管理</h2>
<p class="modal-intro">${canAddTeacher?'管理員可建立教師帳號，並修改任何帳號；教師可建立學生帳號，並修改自己建立的學生。':'你可以建立學生帳號，並修改自己建立的學生；其他帳號只可檢視。'}</p>
<p class="account-group">教師帳號（${teachers.length}）</p>
<div class="review-answer" style="max-height:150px;overflow:auto">${teachers.map(accountRow).join('')}</div>
${canAddTeacher?`<form id="teacher-create-form">
<div class="form-grid" style="margin-top:14px"><div class="form-field"><label class="field-label" for="teacher-name">姓名</label><input id="teacher-name" maxlength="60" required placeholder="例如：陳老師"></div>
<div class="form-field"><label class="field-label" for="teacher-username">帳號（登入名稱）</label><input id="teacher-username" minlength="3" maxlength="40" pattern="[A-Za-z0-9_.\\-]{3,40}" required placeholder="例如：teacher2" autocomplete="off"></div></div>
<div class="form-field"><label class="field-label" for="teacher-password">初始密碼（至少10字）</label><input id="teacher-password" type="password" minlength="10" maxlength="256" required autocomplete="new-password"></div>
<p class="field-hint">教師權限與你相同：可佈置作業、批閱、匯入題庫、管理資料，也能重設其他帳號的密碼。請只發給信任的同事，並提醒首次登入後更換密碼。</p>
<p class="error-text" id="teacher-error"></p>
<button class="primary wide" type="submit">建立教師帳號 ${icon('check')}</button></form>`:'<p class="info-note" style="margin-top:14px">只有<strong>管理員帳號</strong>（學校最早建立的那個教師帳號）能新增教師。需要新同事的帳號時，請找管理員協助。</p>'}
<div class="divider-text"><span>學生帳號</span></div>
<p class="account-group">獨立學生帳戶（${students.length}）</p>
<div class="review-answer" style="max-height:180px;overflow:auto">${students.map(accountRow).join('')}</div><form id="user-create-form"><div class="form-grid" style="margin-top:20px"><div class="form-field"><label class="field-label" for="student-name">姓名（可留空，預設用學號）</label><input id="student-name" maxlength="60" placeholder="例如：陳大文"></div><div class="form-field"><label class="field-label" for="student-username">學號（登入帳戶）</label><input id="student-username" minlength="3" maxlength="40" pattern="[A-Za-z0-9_.\\-]{3,40}" required placeholder="例如：s3a01" autocomplete="off"></div><div class="form-field"><label class="field-label" for="student-seat">班內號（可留空）</label><input id="student-seat" maxlength="20" placeholder="例如：3"></div></div><div class="form-field"><label class="field-label" for="student-password">初始密碼（至少10字）</label><input id="student-password" type="password" minlength="10" maxlength="256" required autocomplete="new-password"></div><p class="field-hint">學號只接受英文字母、數字、底線、點或連字號；<strong>姓名可以留空</strong>（不匯入名字），系統會以學號作為顯示名稱。請私下將初始密碼交給學生，提醒首次登入後更換。</p><p class="error-text" id="user-error"></p><button class="primary wide" type="submit">建立學生帳戶 ${icon('check')}</button></form><div class="divider-text"><span>或批次匯入一整班</span></div><div class="bulk-tools"><label class="secondary" for="bulk-file">${icon('upload')}上傳名單檔案</label><input id="bulk-file" type="file" accept=".csv,.txt,text/csv,text/plain" hidden><button class="text-button" id="bulk-template" type="button">${icon('file')}下載名單範本</button></div><div class="form-field" style="margin-top:14px"><label class="field-label" for="bulk-order">名單欄位順序</label><select id="bulk-order"><option value="auto">自動判斷（依內容或第一行標題）</option><option value="username_seat_password">學號,班內號,密碼</option><option value="name_username_password">姓名,學號,密碼</option><option value="username_password">學號,密碼</option></select></div><p class="field-hint"><strong>姓名可以完全省略</strong>（不匯入名字）：省略時以學號作為顯示名稱，名單上不會出現空白姓名。班內號與密碼都可留空（密碼留空會自動產生）。也接受 Tab、全角逗號或分號；第一行若是標題（如「學號,班內號,密碼」）會自動略過並依標題對應欄位。以 # 開頭的行會被忽略。名單檔案請存成 UTF-8 的 CSV 或 TXT。</p><textarea class="answer-field" id="bulk-students" style="min-height:150px;font-size:calc(15px*var(--fs))" placeholder="s3a01,1,MathPass1234&#10;s3a02,2,MathPass1234&#10;s3a03,3&#10;s3a04"></textarea><div id="bulk-preview" class="field-hint"></div><div id="bulk-preview-table"></div><label class="checkbox-line"><input type="checkbox" id="bulk-class-toggle">匯入後直接建立班級（把這批學生編入同一班）</label><div class="form-field" id="bulk-class-field" hidden><label class="field-label" for="bulk-class-name">班級名稱</label><input id="bulk-class-name" maxlength="100" placeholder="例如：中三甲班"></div><p class="error-text" id="bulk-error"></p><button class="secondary wide" id="bulk-submit" style="margin-top:6px">${icon('upload')}批次建立學生帳戶</button><div id="bulk-result"></div>`,true);if($('#teacher-create-form'))$('#teacher-create-form').onsubmit=async e=>{e.preventDefault();const b=$('[type="submit"]',e.target);b.disabled=true;$('#teacher-error').textContent='';try{const {user:made}=await api('/api/teachers',{username:$('#teacher-username').value,name:$('#teacher-name').value,password:$('#teacher-password').value});toast(`教師帳號「${made.name}」已建立，請把帳號與初始密碼私下交給對方。`);manageUsers();}catch(err){$('#teacher-error').textContent=err.message;b.disabled=false;}};$('#user-create-form').onsubmit=async e=>{e.preventDefault();const b=$('[type="submit"]',e.target);b.disabled=true;try{await api('/api/users',{username:$('#student-username').value,name:$('#student-name').value,seat:$('#student-seat').value,password:$('#student-password').value});toast('獨立學生帳戶已建立。');manageUsers();}catch(err){$('#user-error').textContent=err.message;b.disabled=false;}};
const bulkPreview=()=>{const {rows,errors,fields}=parseBulkStudents($('#bulk-students').value,$('#bulk-order')?$('#bulk-order').value:'auto');const generated=rows.filter(r=>r.generated).length,noName=rows.filter(r=>!r.name).length,seated=rows.filter(r=>r.seat).length;$('#bulk-preview').innerHTML=rows.length?`將建立 <strong>${rows.length}</strong> 個帳戶${fields?`（${fields.map(f=>BULK_FIELD_NAMES[f]).join(' · ')}）`:''}${generated?`，其中 ${generated} 個自動產生密碼`:''}${noName?`，${noName} 個未填姓名（以學號顯示）`:''}${seated?`，${seated} 個有班內號`:''}`:'請輸入學生名單，每行一位。';$('#bulk-error').innerHTML=errors.length?errors.slice(0,6).map(esc).join('<br>'):'';const table=$('#bulk-preview-table');if(table)table.innerHTML=rows.length?`<div class="table-scroll" style="margin-top:10px"><table class="results-table bulk-table"><thead><tr><th>學號</th><th>班內號</th><th>顯示名稱</th><th>密碼</th></tr></thead><tbody>${rows.slice(0,8).map(r=>`<tr><td>${esc(r.username)}</td><td>${r.seat?esc(r.seat):'—'}</td><td>${esc(r.name||r.username)}</td><td>${r.generated?'自動產生':'已填'}</td></tr>`).join('')}</tbody></table></div>${rows.length>8?`<p class="field-hint">…另有 ${rows.length-8} 位未顯示。</p>`:''}`:'';return{rows,errors};};
$('#bulk-students').oninput=bulkPreview;$('#bulk-students').onchange=bulkPreview;$('#bulk-order').onchange=bulkPreview;
$('#bulk-file').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(f.size>1024*1024)return toast('名單檔案不可超過 1 MB。');if(!/\.(csv|txt)$/i.test(f.name)&&!['text/csv','text/plain'].includes(f.type))return toast('請提供 CSV 或 TXT 名單檔案。');try{const raw=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error('檔案讀取失敗，請確認是 UTF-8 的 CSV 或 TXT。'));r.readAsText(f,'UTF-8');});$('#bulk-students').value=raw.replace(/^\ufeff/,'');bulkPreview();toast(`已載入名單：${f.name}`);}catch(err){toast(err.message);}e.target.value='';};
$('#bulk-template').onclick=()=>{const order=$('#bulk-order')?$('#bulk-order').value:'auto';const fields=order==='auto'?['username','seat','password']:(BULK_ORDERS[order]||['username','seat','password']);const sample={name:['陳大文','李小美','黃志強'],username:['s3a01','s3a02','s3a03'],seat:['1','2','3'],password:['MathPass1234','','']};const csv='\ufeff'+fields.map(f=>BULK_FIELD_NAMES[f]).join(',')+'\r\n'+sample.username.map((_,i)=>fields.map(f=>sample[f][i]).join(',')).join('\r\n')+'\r\n';const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='MathPath-學生名單範本.csv';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已下載名單範本（'+fields.map(f=>BULK_FIELD_NAMES[f]).join(',')+'），可用試算表填寫後另存為 CSV。');};
$('#bulk-class-toggle').onchange=e=>{$('#bulk-class-field').hidden=!e.target.checked;};
$('#bulk-submit').onclick=async()=>{const {rows,errors}=bulkPreview();if(errors.length)return toast('請先修正名單格式錯誤。');if(!rows.length)return toast('請輸入至少一位學生。');if(rows.length>200)return toast('每批最多200位學生。');const makeClass=$('#bulk-class-toggle').checked,className=$('#bulk-class-name').value.trim();if(makeClass&&!className)return toast('請填寫班級名稱，或取消建立班級。');const b=$('#bulk-submit');b.disabled=true;b.textContent='正在建立…';try{const {users:created}=await api('/api/users/bulk',{students:rows.map(r=>({username:r.username,name:r.name,seat:r.seat,password:r.password}))});let classNote='';if(makeClass){try{const {class:room}=await api('/api/classes',{name:className,studentIds:created.map(u=>u.id)});classNote=`<div class="hint-box" style="margin-top:12px">已同時建立班級「${esc(room.name)}」，共 ${room.studentCount} 位學生，可直接佈置作業。</div>`;}catch(err){classNote=`<div class="inline-error" style="margin-top:12px">帳戶已建立，但班級未建立：${esc(err.message)}可在「作業與成績」重新建立班級。</div>`;}}const merged=rows.map((r,i)=>({username:r.username,password:r.password,name:(created[i]&&created[i].name)||r.name||r.username,seat:(created[i]&&created[i].seat)||r.seat||''}));const hasName=merged.some(r=>r.name!==r.username),hasSeat=merged.some(r=>r.seat);const cols=[['學號',r=>r.username]].concat(hasName?[['姓名',r=>r.name]]:[],hasSeat?[['班內號',r=>r.seat]]:[],[['密碼',r=>r.password]]);const text=[cols.map(c=>c[0]).join('\t'),...merged.map(r=>cols.map(c=>c[1](r)).join('\t'))].join('\n');$('#bulk-result').innerHTML=`<div class="import-warning">已建立 ${created.length} 個帳戶${merged.some(r=>r.name===r.username)?`（${merged.filter(r=>r.name===r.username).length} 個未填姓名，以學號顯示）`:""}。密碼只會顯示這一次，請立即複製並私下發給學生。</div>${classNote}<pre class="code-block">${esc(text)}</pre><button class="secondary wide" id="bulk-copy" style="margin-top:10px">${icon('file')}複製帳號密碼</button>`;$('#bulk-copy').onclick=async()=>{try{await navigator.clipboard.writeText(text);toast('已複製，請妥善保管。');}catch{toast('無法自動複製，請手動選取。');}};$('#bulk-students').value='';$('#bulk-class-toggle').checked=false;$('#bulk-class-field').hidden=true;$('#bulk-class-name').value='';bulkPreview();toast(`已建立 ${created.length} 個學生帳戶。`);}catch(err){$('#bulk-error').textContent=err.message;}finally{b.disabled=false;b.innerHTML=icon('upload')+'批次建立學生帳戶';}};}catch(e){toast(e.message);}}
function deploymentHelp(){modal(`<p class="eyebrow">SERVER SETUP</p><h2>啟動與部署說明</h2><p class="modal-intro">資料保存在網站伺服器；實際位置由管理員確認。以下是可選部署方式，不代表目前網站的部署狀態。</p><h3>本機預覽</h3><p class="info-note">雙擊 start.command，或用 Python 3 啟動：</p><pre class="code-block">python3 server.py --host 127.0.0.1 --port 8765</pre><p class="info-note">瀏覽器開啟 http://127.0.0.1:8765。</p><h3>校內連線</h3><p class="info-note">由資訊人員將 --host 設為伺服器的校內 IP，並限制防火牆只允許校內來源；正式使用需反向代理 HTTPS。不要把演示帳戶直接用於全校。</p><h3>目前帳戶範圍</h3><p class="info-note">初始演示配置包含學生與教師帳戶；實際帳戶由管理員確認。教師可在「設定與隱私」建立獨立學生帳戶，避免共用作答紀錄。可在「作業與成績」建立班級並發布作業；校內單一登入及批量帳戶管理仍可再擴充。</p><div class="import-warning">資料保存在網站伺服器；實際位置由管理員確認。預設資料庫路徑為 data/mathpath.sqlite3；備份及保存年限應按學校規定安排。AI 必須另行配置，未配置時手写作答由教師批閱。</div>`);}
function navigate(target){if(busy)return toast('目前操作正在進行，請等待完成。');preserveDraft();if(page==='practice'&&strokes.length&&target!=='practice'&&!lastResult&&!confirm('尚未提交的手寫內容未保存。確定離開？'))return;beginView();$('#sidebar').classList.remove('open');if(target!=='practice'){assignmentContext=null;mockContext=null;stopQuizClock();}page=target;switch(target){case'guide':guidePage();break;
case'homework':homeworkPage();break;case'calendar':calendarPage();break;case'mock':mockPage();break;case'ai':aiConfigPage();break;case'bank':bank();break;case'practice':practice();break;case'import':importPage();break;case'newq':newQuestionPage();break;case'mistakes':recordsPage();break;case'growth':growthPage();break;case'settings':settingsPage();break;default:bank();}window.scrollTo({top:0,behavior:'instant'});}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;if(b.dataset.fontScale){applyFontScale(b.dataset.fontScale);shell();toast(`字體已設為「${FONT_SCALES.find(([id])=>id===b.dataset.fontScale)[1]}」，只影響這台裝置。`);return;}
if(b.dataset.themeId){applyTheme(b.dataset.themeId);shell();toast(`版面已設為「${THEMES.find(([id])=>id===b.dataset.themeId)[1]}」，只影響這台裝置。`);return;}
if(b.id==='open-math-editor'){openMathEditor();return;}if(b.dataset.page)return navigate(b.dataset.page);if(b.dataset.assignment)return assignmentPage(Number(b.dataset.assignment));if(b.dataset.mock)return mockExamPage(Number(b.dataset.mock));if(b.dataset.mockQ)return openMockQuestion(Number(b.dataset.mockQ));if(b.dataset.results)return resultsPage(Number(b.dataset.results));if(b.dataset.skipQ)return skipQuestionFromList(b.dataset.skipQ);
if(b.dataset.assignmentQ)return openAssignmentQuestion(Number(b.dataset.assignmentQ));if(b.dataset.nextQuestion)return openAssignmentQuestion(Number(b.dataset.nextQuestion));if(b.dataset.prevQuestion)return openAssignmentQuestion(Number(b.dataset.prevQuestion));if(b.dataset.qid)return openQuestion(b.dataset.qid);if(b.dataset.topic){topic=b.dataset.topic;subtopic='';currentPage=1;return bank();}if(b.dataset.subtopic){subtopic=b.dataset.subtopic;currentPage=1;return bank();}if(b.dataset.pagination){currentPage=Number(b.dataset.pagination);return renderList();}if(b.dataset.view){viewMode=b.dataset.view;return bank();}if(b.dataset.save){const id=Number(b.dataset.save);if(bookmarks.has(id))bookmarks.delete(id);else bookmarks.add(id);saveBookmarks();b.classList.toggle('saved',bookmarks.has(id));b.setAttribute('aria-pressed',String(bookmarks.has(id)));toast(bookmarks.has(id)?'已收藏題目（本瀏覽器）':'已取消收藏');if(page==='bank'&&topic==='我的收藏')renderList();return;}if(b.dataset.answerMode){if(busy)return toast('正在保存作答，請等待完成。');preserveDraft();answerMode=b.dataset.answerMode;$$('[data-answer-mode]').forEach(x=>x.classList.toggle('active',x===b));renderAnswerArea();return;}if(b.dataset.generate)return generateQuestion(b.dataset.generate,currentQuestion&&currentQuestion.id);if(b.dataset.editq)return editQuestionModal(b.dataset.editq);if(b.dataset.aigen)return aiGenerateModal(b.dataset.aigen);if(b.dataset.aifig)return openFigureStudioForQuestion(b.dataset.aifig);if(b.dataset.aifigManual)return openFigureStudioForQuestion(b.dataset.aifigManual,true);if(b.dataset.aifigClear)return clearQuestionFigure(b.dataset.aifigClear);if(b.dataset.genKind)return generateQuestion(b.dataset.genKind,b.dataset.genQid);if(b.dataset.removeDraft){drafts.splice(Number(b.dataset.removeDraft),1);return renderImportContent();}if(b.dataset.history){historyFilter=b.dataset.history;return recordsPage();}if(b.dataset.review)return reviewModal(b.dataset.review,null,null,(b.dataset.reviewQueue||'').split(',').map(Number).filter(n=>n),b.dataset.reviewView==='1');
if(b.dataset.editUser)return editAccountModal(Number(b.dataset.editUser));switch(b.dataset.action){case'login':loginModal();break;case'close-modal':closeReviewAware();break;case'collection':topic='我的收藏';search='';currentPage=1;bank();break;case'start':requireLogin(()=>{const a=S.attempts.find(a=>a.status==='graded'&&a.score<a.maxScore);openQuestion(a?.questionId||S.questions[0]?.id||1);});break;case'hand-demo':openQuestion(1);break;}});
$('#account').onclick=accountModal;$('#avatar').onclick=accountModal;$('#menu-btn').onclick=()=>$('#sidebar').classList.toggle('open');$('#help-btn').innerHTML=icon('help');$('#help-btn').onclick=()=>{modal(`<p class="eyebrow">LEARN WITH MATHPATH</p><h2>讓練習真正帶來理解</h2><ul class="feature-list"><li><strong>01 · 選一個知識點</strong>在題庫搜尋、篩選難度，從基礎題開始。</li><li><strong>02 · 寫出解題過程</strong>用滑鼠或觸控筆手寫、輸入文字，或上傳紙本手稿。</li><li><strong>03 · 看回饋，再練一次</strong>接入 AI 可取得建議評分；教師可覆核並給簡要建議。</li><li><strong>04 · 相似鞏固，進階加深</strong>做同知識點題目，練到能說清楚原因，再挑戰進階題。</li></ul><button class="primary wide" id="help-guide">看圖文版新手上路 ${icon('arrow')}</button><div class="import-warning">資料保存在網站伺服器；實際位置由管理員確認。作業分數與 AI 建議須教師覆核；自主練習可即時評分，未配置 AI 的手稿待批閱。所有學習紀錄均來自實際提交。</div>`);$('#help-guide').onclick=()=>{closeModal();guidePage();};};
const scoreText=v=>v===null||v===undefined?'—':Number(v).toLocaleString('zh-HK',{maximumFractionDigits:1});
const dateText=v=>v?new Date(v).toLocaleString('zh-HK',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const statusText=v=>({not_started:'未開始',in_progress:'作答中',submitted:'已正式提交',correction:'需訂正'}[v]||v);
let HW=null,assignmentDetail=null,resultData=null;
function csvCell(v){const s=String(v??'').replace(/\r?\n/g,' ').trim();const safe=/^[=+\-@\t\r]/.test(s)?`'${s}`:s;return`"${safe.replace(/"/g,'""')}"`;}
function exportResultsCsv(){if(!resultData)return;const a=resultData.assignment,s=resultData.summary;const rows=[['作業',a.title],['班級',a.className],['題數',a.questionCount],['卷面總分',a.totalPoints],['正式提交',`${s.submittedCount} / ${s.studentCount}`],['全題已評平均',s.averageScore??''],['教師確認平均',s.confirmedAverage??''],['待覆核題目',s.pendingReviewCount],['建議覆核題目',s.reviewFlagCount],['說明','已評得分可能只涵蓋部分題目，不代表整卷總分；待批與未交不當零分。'],[],
['學生','帳號','提交狀態','遲交','已作答題數','待批題數','已評得分','已評涵蓋分值','卷面總分','AI原建議分','規則原分','教師確認分','教師確認題數','建議覆核題數','建議-做得好的地方','建議-需要留意','建議-下一步'],
...resultData.students.map(st=>[st.name,st.username,statusText(st.status),st.late?'是':'否',st.answeredCount,st.pendingCount,st.score??'',st.scoredPoints,st.totalPoints,st.aiScore??'',st.ruleScore??'',st.confirmedScore??'',st.confirmedCount,st.reviewFlagCount??0,st.suggestion?.strength??'',st.suggestion?.focus??'',st.suggestion?.nextStep??''])];const csv='\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`${a.title}-成績.csv`.replace(/[\\/:*?"<>|]/g,'_');document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已匯出成績 CSV，可用試算表開啟。');}
function weakTopic(){const graded=S.attempts.filter(a=>a.status==='graded'&&a.score!==null&&a.maxScore>0);if(!graded.length)return null;const by={};graded.forEach(a=>{const t=by[a.topic]||(by[a.topic]={score:0,max:0,n:0});t.score+=a.score;t.max+=a.maxScore;t.n++;});return Object.entries(by).map(([topic,v])=>({topic,percent:Math.round(v.score*100/v.max),n:v.n})).sort((a,b)=>a.percent-b.percent||b.n-a.n)[0];}
function weakTopicPanel(){const wt=weakTopic();return `<section class="panel right-panel"><h2>${icon('target')}最需要鞏固</h2>${wt?`<p class="field-hint">依已批閱作答計算，不代表完整能力診斷。</p><div class="knowledge-row"><span>${esc(wt.topic)}</span><span>${wt.percent}%</span></div><div class="progress-track"><div class="progress-fill gold" style="width:${wt.percent}%"></div></div><p class="field-hint">已批閱 ${wt.n} 次。先重做錯題，再做同知識點的相似題，最後挑戰進階題。</p><button class="secondary wide" data-topic="${esc(wt.topic)}">開始針對練習 ${icon('arrow')}</button>`:`<p class="field-hint">還沒有已批閱的作答。完成作業或練習後，這裡會指出最需要鞏固的知識點。</p>`}</section>`;}
function homeworkMetrics(items){return `<div class="metric-row">${items.map(([label,value,foot])=>`<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></div>`).join('')}</div>`;}
async function homeworkPage(){beginView();page='homework';assignmentContext=null;mockContext=null;currentQuestion=null;stopQuizClock();shell();const target=viewTarget();const teacher=S.user?.role==='teacher';$('#main').innerHTML=heading('ASSIGN · REVIEW · GROW',teacher?'作業與成績':'我的作業',teacher?'把每次作業，轉化為可跟進的學習回饋。':'領取作業，寫下思考，每次提交都有下一步建議。');if(!S.user){$('#main').innerHTML+=`<section class="hero homework-hero"><div><p class="eyebrow">MathPath · 數學作業研習室</p><h2>從一份作業，看見每個學生的進步。</h2><p>教師佈置 · 學生手寫 · AI 建議批閱 · 成績統計 · 個別學習建議</p><button class="primary" id="homework-login">登入作業空間 ${icon('arrow')}</button><button class="secondary" data-page="bank" style="margin-left:10px">瀏覽題庫</button><button class="secondary" data-page="guide" style="margin-left:10px">新手上路</button></div></section><div class="homework-features">${[['import','教師佈置作業','建立班級，選題與截止日期，發布後保存題目及學生名單快照。'],['practice','學生寫下思考','逐題保存文字或手稿，完成所有題目後正式提交。'],['growth','批閱與學習建議','AI 接入後可建議評分；教師覆核，分數與每次建議分開記錄。']].map(([i,t,p])=>`<section class="panel"><div class="feature-icon">${icon(i)}</div><h2>${t}</h2><p>${p}</p></section>`).join('')}</div><div class="import-warning" style="margin-top:22px">資料保存在網站伺服器；實際位置由管理員確認。作業分數與 AI 建議須教師覆核；自主練習可即時核對文字答案，未接入 AI 的手稿待批閱。</div>`;$('#homework-login').onclick=()=>loginModal(homeworkPage);return;}$('#main').innerHTML+='<section class="panel">'+empty('正在讀取作業','從網站伺服器讀取班級與作業紀錄。')+'</section>';try{const data=await api('/api/homework');if(!viewMatches(target))return;HW=data;const a=HW.assignments;const submitted=teacher?a.reduce((n,v)=>n+v.submittedCount,0):a.filter(v=>v.myStatus==='submitted').length;$('#main').innerHTML=`<div class="fade-in">${heading('ASSIGN · REVIEW · GROW',teacher?'作業與成績':'我的作業',teacher?'佈置、批阅、統計，用具體建議引導每個學生的下一步。':'依次完成作業，回看回饋，再鞏固最需要練習的知識點。',teacher?`<button class="secondary" id="create-class">${icon('bank')}建立班級</button><button class="primary" id="create-assignment">${icon('import')}佈置作業</button>`:`<button class="secondary" id="refresh-homework">${icon('undo')}重新整理</button>`)}${homeworkMetrics([['已發布作業',a.length,'只顯示你有權查看的作業'],['我的班級',HW.classes.length,teacher?'班級名單由教師建立':'作業只對指定學生開放'],[teacher?'正式提交人次':'已正式提交',submitted,'逐題保存後，需正式提交作業'],['AI 批閱服務',S.ai.configured?'已配置':'待接入',S.ai.configured?'建議分數仍需教師覆核':'手稿待批 · 文字規則核對']])}<div class="homework-layout"><section><div class="section-head"><h2>${teacher?'已發布的作業':'待辦與已交作業'}</h2><div class="section-head-actions"><span class="small-text">${a.length} 份</span><button class="secondary" data-page="calendar">${icon('calendar')}查看日曆</button></div></div><div class="assignment-list">${a.length?a.map(v=>`<article class="panel assignment-card"><div class="assignment-card-head"><span class="assignment-icon">${icon('file')}</span><div><span class="badge">${esc(v.className)}</span><h2>${mathText(v.title)}</h2></div><span class="badge ${new Date(v.dueAt)<new Date()?'l2':''}">${teacher?'已發布':statusText(v.myStatus)}</span></div><div class="assignment-meta"><span>${v.questionCount} 題 · ${v.totalPoints} 分</span><span>${icon('clock')}截止 ${dateText(v.dueAt)}</span></div><div class="assignment-bottom"><span class="small-text">${v.kind==='quiz'?'測驗':'作業'}${v.durationMinutes?` · 限時 ${v.durationMinutes} 分鐘`:''} · ${teacher?`已交 ${v.submittedCount} / ${v.studentCount} 人 · 全題已評 ${v.gradedCount} 人`:`目前已評得分 ${scoreText(v.myScore)} · 教師確認 ${scoreText(v.myConfirmedScore)}`}</span><button class="${teacher?'secondary':'primary'}" ${teacher?'data-results':'data-assignment'}="${v.id}">${teacher?'查看成績與建議':v.myStatus==='submitted'?'查看批閱與建議':'開始／繼續作業'} ${icon('arrow')}</button></div></article>`).join(''):`<section class="panel">${empty(teacher?'還沒有發布作業':'目前沒有指派給你的作業',teacher?'先建立班級，再从題庫選題發布。':'教師發布到你的班級後，作業會出現在這裡。')}</section>`}</div></section><aside class="right-stack">${teacher?'':weakTopicPanel()}<section class="panel right-panel"><h2>${icon('bank')}${teacher?'我的班級':'所屬班級'}</h2>${HW.classes.length?HW.classes.map(c=>`<div class="class-mini"><strong>${esc(c.name)}</strong><span>${c.studentCount} 位學生</span></div>`).join(''):'<p class="field-hint">尚未加入班級。</p>'}${teacher?`<button class="text-button" id="class-manage-link" style="font-size:calc(14px*var(--fs))">建立班級 ${icon('arrow')}</button>`:''}</section><section class="panel right-panel tip-panel"><h2>${icon('bulb')}分數不是學習的終點</h2><p>每次作答都有學習建議：<br>做得好的地方 → 需要留意 → 下一步練習。<br><br>待批阅不當零分；AI 建議分與教師確認分分開保存。</p></section><section class="panel right-panel"><h2>${icon('lock')}運行狀態</h2><p class="field-hint">資料保存在網站伺服器；實際位置由管理員確認。AI ${S.ai.configured?'已配置，仍需真實效果核驗':'尚未接入，不產生假評分'}。</p></section></aside></div></div>`;if(teacher){$('#create-class').onclick=createClassModal;$('#class-manage-link').onclick=createClassModal;$('#create-assignment').onclick=createAssignmentModal;}else $('#refresh-homework').onclick=homeworkPage;}catch(e){if(viewMatches(target))$('#main').innerHTML+=`<div class="inline-error">${esc(e.message)}</div>`;}}
function createClassModal(){if(!HW.students?.length){toast('請先建立獨立學生帳戶。');return navigate('settings');}modal(`<p class="eyebrow">CLASSROOM</p><h2>建立班級</h2><p class="modal-intro">選擇已建立的學生帳戶。每份作業發布時會保存收件名單快照。</p><form id="class-form"><div class="form-field"><label class="field-label" for="class-name">班級名稱</label><input id="class-name" placeholder="例如：中三甲班" maxlength="100" required></div><div class="student-picks">${HW.students.map(s=>`<label class="pick-row"><input type="checkbox" name="students" value="${s.id}"><span>${s.seat?`<span class="seat-badge">${esc(s.seat)}</span>`:''}${esc(s.name)}${s.username===s.name?'':`<small>${esc(s.username)}</small>`}</span></label>`).join('')}</div><p class="error-text" id="class-error"></p><button class="primary wide" type="submit">建立班級 ${icon('check')}</button></form>`);$('#class-form').onsubmit=async e=>{e.preventDefault();const b=$('[type=submit]',e.target);b.disabled=true;try{await api('/api/classes',{name:$('#class-name').value,studentIds:$$('[name=students]:checked').map(x=>Number(x.value))});closeModal();toast('班級已保存。');homeworkPage();}catch(err){$('#class-error').textContent=err.message;b.disabled=false;}};}
function createAssignmentModal(){if(!HW.classes.length)return createClassModal();const qs=S.questions.filter(q=>q.answer?.trim()&&!/待.*(?:核驗|核验|審核|审核|確認|确认)/.test(q.source+' '+q.tags.join(' ')));
  // 挑題：先選章節（主分類／子分類），或直接輸入關鍵字搜尋，再勾選要佈置的題目。
  const qById=new Map(qs.map(q=>[q.id,q]));
  const pickState={topic:'',subtopic:'',search:'',picked:new Set(),page:1};
  const pickTopics=[...new Set(qs.map(q=>q.topic))].sort();
  const pickCount=t=>qs.filter(q=>q.topic===t).length;
  const PICK_LIMIT=60;
  const pickPool=()=>qs.filter(q=>(!pickState.topic||q.topic===pickState.topic)&&(!pickState.subtopic||q.subtopic===pickState.subtopic)&&(!pickState.search||`${q.title} ${q.content} ${q.topic} ${q.subtopic||''} ${q.tags.join(' ')}`.toLowerCase().includes(pickState.search)));
  const pickScore=()=>[...pickState.picked].reduce((n,id)=>n+(qById.get(id)?.points||0),0);
  const renderPickCount=()=>{const el=$('#selected-question-count');if(!el)return;el.textContent=`已選 ${pickState.picked.size} 題 · ${pickScore()} 分`;el.classList.toggle('bad',pickState.picked.size>30);};
  const renderPickedChips=()=>{const box=$('#picked-chips');if(!box)return;const items=[...pickState.picked].map(id=>qById.get(id)).filter(Boolean);
    box.innerHTML=items.length?`<span class="small-text">已選題目：</span>${items.map(q=>`<button type="button" class="pick-chip" data-unpick="${q.id}" title="按一下移除">${mathText(q.title)} <b>×</b></button>`).join('')}<button type="button" class="text-button" id="pick-clear" style="font-size:calc(13px*var(--fs))">清除選取</button>`:'';};
  const syncPickSubtopics=()=>{const sel=$('#pick-subtopic');if(!sel)return;
    const list=[...new Set(qs.filter(q=>!pickState.topic||q.topic===pickState.topic).map(q=>q.subtopic).filter(Boolean))].sort();
    sel.innerHTML=`<option value="">全部子分類</option>`+list.map(s=>`<option value="${esc(s)}"${s===pickState.subtopic?' selected':''}>${esc(s)}</option>`).join('');};
  const renderPickList=()=>{const box=$('#assignment-picks');if(!box)return;const pool=pickPool(),pages=Math.max(1,Math.ceil(pool.length/PICK_LIMIT));pickState.page=Math.max(1,Math.min(pickState.page,pages));const shown=pool.slice((pickState.page-1)*PICK_LIMIT,pickState.page*PICK_LIMIT);
    box.innerHTML=shown.length?shown.map(q=>`<label class="pick-row"><input type="checkbox" name="assignment-questions" value="${q.id}" ${pickState.picked.has(q.id)?'checked':''}><span><strong>${mathText(q.title)}</strong><small>${esc(q.topic)}${q.subtopic?' · '+esc(q.subtopic):''} · ${mathText(q.content)}</small></span><span class="badge l${q.level}">${levels[q.level]} · ${q.points} 分</span></label>`).join('')
      :`<p class="pick-empty">沒有符合條件的題目，請換一個章節或關鍵字。</p>`;
    box.insertAdjacentHTML('beforeend',`<div class="pick-pagination"><button type="button" class="secondary" data-pick-page="${pickState.page-1}" ${pickState.page<=1?'disabled':''}>上一頁</button><span class="small-text">第 ${pickState.page} / ${pages} 頁</span><button type="button" class="secondary" data-pick-page="${pickState.page+1}" ${pickState.page>=pages?'disabled':''}>下一頁</button></div>`);const hint=$('#pick-hint');if(hint)hint.textContent=`符合條件 ${pool.length} 題，顯示 ${shown.length} 題 · 可佈置題目共 ${qs.length} 題 · 最多選 30 題`;};const due=new Date();due.setDate(due.getDate()+7);due.setHours(23,59,0,0);const local=new Date(due.getTime()-due.getTimezoneOffset()*60000).toISOString().slice(0,16);modal(`<p class="eyebrow">ASSIGN HOMEWORK</p><h2>佈置作業或測驗</h2><p class="modal-intro">題目及分值發布後固定；每題需要已核验參考答案，AI 待核驗題不會列入。</p><form id="assignment-form"><div class="form-grid"><div class="form-field"><label class="field-label" for="assignment-title">作業名稱</label><input id="assignment-title" placeholder="例如：因式分解鞏固練習" maxlength="200" required></div><div class="form-field"><label class="field-label" for="assignment-class">指派班級</label><select id="assignment-class">${HW.classes.map(c=>`<option value="${c.id}">${esc(c.name)} · ${c.studentCount} 人</option>`).join('')}</select></div><div class="form-field"><label class="field-label" for="assignment-due">截止時間（本地時區）</label><input id="assignment-due" type="datetime-local" value="${local}" required></div><div class="form-field"><label class="field-label" for="assignment-kind">類型</label><select id="assignment-kind"><option value="homework">作業</option><option value="quiz">測驗</option></select></div><div class="form-field"><label class="field-label" for="assignment-duration">時間限制（分鐘）</label><input id="assignment-duration" type="number" min="1" max="300" placeholder="留空＝不限時"><p class="field-hint">模擬測驗建議設定 20–45 分鐘；學生按「開始測驗」後倒數，時間到自動提交。</p></div><div class="form-field"><label class="field-label" for="assignment-description">作業說明</label><input id="assignment-description" maxlength="4000" placeholder="寫出完整步驟，並代回檢查。"></div></div><div class="section-head" style="margin:24px 0 12px"><h2 style="font-size:calc(16px*var(--fs))">選擇題目</h2><span class="small-text" id="selected-question-count">已選 0 題</span></div><div class="pick-filters"><div class="form-field"><label class="field-label" for="pick-topic">章節（主分類）</label><select id="pick-topic"><option value="">全部章節</option>${pickTopics.map(t=>`<option value="${esc(t)}">${esc(t)}（${pickCount(t)} 題）</option>`).join('')}</select></div><div class="form-field"><label class="field-label" for="pick-subtopic">子分類</label><select id="pick-subtopic"><option value="">全部子分類</option></select></div><div class="form-field"><label class="field-label" for="pick-search">搜尋題目</label><input id="pick-search" placeholder="輸入關鍵字，例如：因式分解、三角形面積" maxlength="60"></div></div><div class="assignment-question-picks" id="assignment-picks"></div><p class="field-hint" id="pick-hint"></p><div id="picked-chips" class="picked-chips"></div><label class="checkbox-line"><input id="assignment-late" type="checkbox">允許截止時間後補交（會記錄遲交）</label><label class="checkbox-line"><input id="assignment-ai" type="checkbox" ${S.ai.configured?'':'disabled'}>使用 AI 建議評分與簡評（僅供教師覆核，不直接作正式成績；${S.ai.configured?(S.ai.mode==='local'?'本地模型':'外部模型'):'尚未接入 AI，無法啟用'}）</label><div class="import-warning">學生逐題保存作答後，需正式提交整份作業。正式提交後作答鎖定，教師仍可覆核。上限30題。</div><p class="error-text" id="assignment-error"></p><button class="primary wide" type="submit">發布給班級 ${icon('arrow')}</button></form>`,true);
$('#pick-topic').onchange=e=>{pickState.topic=e.target.value;pickState.subtopic='';pickState.page=1;syncPickSubtopics();renderPickList();};
$('#pick-subtopic').onchange=e=>{pickState.subtopic=e.target.value;pickState.page=1;renderPickList();};
$('#pick-search').oninput=e=>{pickState.search=e.target.value.trim().toLowerCase();pickState.page=1;renderPickList();};
// 勾選狀態存在 pickState.picked，篩選後仍保留已選題目（不會因換章節而漏掉）。
$('#assignment-picks').onchange=e=>{const cb=e.target.closest('input[name=assignment-questions]');if(!cb)return;const id=Number(cb.value);if(cb.checked){if(pickState.picked.size>=30){cb.checked=false;toast('每份作業最多選 30 題，請先移除已選題目。');return;}pickState.picked.add(id);}else pickState.picked.delete(id);renderPickCount();renderPickedChips();};
$('#assignment-picks').onclick=e=>{const b=e.target.closest('[data-pick-page]');if(!b||b.disabled)return;pickState.page=Number(b.dataset.pickPage);renderPickList();};
$('#picked-chips').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.id==='pick-clear')pickState.picked.clear();else if(b.dataset.unpick)pickState.picked.delete(Number(b.dataset.unpick));else return;renderPickList();renderPickCount();renderPickedChips();};
syncPickSubtopics();renderPickList();renderPickCount();$('#assignment-form').onsubmit=async e=>{e.preventDefault();const b=$('[type=submit]',e.target);b.disabled=true;try{const raw=$('#assignment-due').value,dt=new Date(raw);if(!raw||!Number.isFinite(dt.getTime()))throw new Error('請填寫有效的截止時間。');const durRaw=$('#assignment-duration').value.trim();if(durRaw){const d=Number(durRaw);if(!Number.isInteger(d)||d<1||d>300)throw new Error('時間限制必須是 1 至 300 的整數分鐘。');}await api('/api/assignments',{title:$('#assignment-title').value,kind:$('#assignment-kind').value,classId:Number($('#assignment-class').value),questionIds:[...pickState.picked],dueAt:dt.toISOString(),description:$('#assignment-description').value,allowLate:$('#assignment-late').checked,aiGrading:$('#assignment-ai').checked,durationMinutes:durRaw?Number(durRaw):null});closeModal();toast('作業已發布到指定班級。');homeworkPage();}catch(err){$('#assignment-error').textContent=err.message;b.disabled=false;}};}
let quizClock=null,pendingQuizSubmission=null;
const quizDeadlines=new Map(),quizSubmitting=new Set();
function quizKey(target){return `${target.userId??S.user?.id}:${target.kind}:${target.id}`;}
function stopQuizClock(){if(quizClock?.timer)clearInterval(quizClock.timer);quizClock=null;}
function fmtClock(total){const m=Math.floor(total/60),sec=total%60;return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;}
function quizActive(){return !!(quizClock&&S.user?.role==='student');}
function quizTargetExpired(){
  const target=mockContext?{kind:'mock',id:mockContext.id}:assignmentContext&&!assignmentDetail?.mySubmission?.correction?{kind:'assignment',id:assignmentContext.id}:null;
  return !!target&&(quizDeadlines.get(quizKey(target))??Infinity)<=Date.now();
}
function startQuizClock(target,remainingSeconds,expiresAt){
  target={...target,userId:S.user?.id};const key=quizKey(target),serverDeadline=Date.parse(expiresAt);
  const deadline=Number.isFinite(serverDeadline)?serverDeadline:quizDeadlines.get(key)??(Number.isFinite(remainingSeconds)?Date.now()+remainingSeconds*1000:NaN);
  stopQuizClock();if(!Number.isFinite(deadline))return;
  quizDeadlines.set(key,deadline);const clock=quizClock={target,deadline,timer:null};
  const tick=()=>{
    if(quizClock!==clock)return;
    const left=Math.max(0,Math.ceil((clock.deadline-Date.now())/1000));clock.left=left;
    $$('[data-quiz-clock]').forEach(el=>{el.textContent=fmtClock(left);el.classList.toggle('urgent',left<=300);});
    $$('[data-quiz-bar]').forEach(el=>{const total=Number(el.dataset.quizBar)||1;el.style.width=Math.max(0,Math.min(100,left*100/total))+'%';});
    if(left<=0){stopQuizClock();if($('#submit-answer'))$('#submit-answer').disabled=true;autoSubmitQuiz(clock.target);}
  };
  tick();if(quizClock===clock)clock.timer=setInterval(tick,1000);
}
async function autoSubmitQuiz(target){
  target={...target,userId:target.userId??S.user?.id};
  if(target.userId!==S.user?.id||S.user?.role!=='student')return;
  if(busy){pendingQuizSubmission=target;toast('測驗時間已結束，正在等待本次作答保存後封存。');return;}
  const key=quizKey(target);if(quizSubmitting.has(key))return;
  const view=viewTarget();quizSubmitting.add(key);
  toast(target.kind==='mock'?'測驗時間已結束，正在自動封存並計算可評分作答。':'測驗時間已結束，正在自動封存；分數與 AI 建議須由教師覆核。');
  const url=target.kind==='mock'?`/api/mock/${target.id}/submit`:`/api/assignments/${target.id}/submit`;
  try{
    await api(url,{});if(!viewMatches(view))return;
    if(target.kind==='mock'&&((page==='mock'&&mockContext?.id===target.id)||(page==='practice'&&mockContext?.id===target.id)))await mockExamPage(target.id);
    else if(target.kind==='assignment'&&((page==='homework'&&assignmentContext?.id===target.id)||(page==='practice'&&assignmentContext?.id===target.id)))await assignmentPage(target.id);
  }catch(e){if(viewMatches(view)){toast(`自動封存失敗：${e.message}。請返回測驗重試提交。`);const root=$('#result-root');if(root)root.innerHTML=`<div class="inline-error">自動封存失敗：${esc(e.message)}。請返回測驗重試提交。</div>`;}}
  finally{quizSubmitting.delete(key);}
}
function quizClockBadge(){return quizActive()?`<div class="quiz-clock-chip">${icon('clock')}<span data-quiz-clock class="${(quizClock.left??0)<=300?'quiz-clock urgent':'quiz-clock'}">${fmtClock(quizClock.left??0)}</span></div>`:'';}
let mockData=null, mockDetail=null;
function mockTopicPanel(stats){if(!stats||!stats.length)return '';return `<section class="panel right-panel"><h2>${icon('growth')}知識點表現</h2>${stats.map(t=>`<div class="topic-detail"><div class="knowledge-row"><span>${esc(t.topic)}</span><span>${t.percent===null?'待批閱':t.percent+'%'}</span></div><div class="progress-track"><div class="progress-fill" style="width:${t.percent||0}%"></div></div><small class="field-hint">已評 ${t.scoredCount} / ${t.totalCount} 題</small></div>`).join('')}</section>`;}
async function mockPage(){if(!S.user)return loginModal(mockPage);beginView();page='mock';assignmentContext=null;mockContext=null;currentQuestion=null;shell();stopQuizClock();const target=viewTarget();
if(S.user.role!=='student'){$('#main').innerHTML=`<div class="fade-in">${heading('MOCK EXAM','模擬測驗','學生自助的限時測驗。')}<section class="panel">${empty('模擬測驗供學生使用','教師請在「作業與成績」為班級佈置限時測驗。')}</section></div>`;return;}
try{const data=await api('/api/mock');if(!viewMatches(target))return;mockData=data;}catch(e){if(!viewMatches(target))return;$('#main').innerHTML=`<div class="fade-in">${heading('MOCK EXAM','模擬測驗','')}<section class="panel"><div class="inline-error">${esc(e.message)}</div></section></div>`;return;}
const o=mockData.options,exams=mockData.exams||[],done=exams.filter(e=>e.status==='submitted');
const best=done.length?Math.max(...done.map(e=>e.percent??0)):null;
$('#main').innerHTML=`<div class="fade-in">${heading('MOCK EXAM','模擬測驗','自選知識點、題數與時限，限時作答；提交後即時計分並給出學習建議。')}
${homeworkMetrics([['已開始場數',exams.length,'模擬測驗不計入正式成績'],['最佳得分率',best==null?'—':best+'%','只計已評分題目'],['題庫可用題目',o.available,'只抽答案已核驗的題目'],['AI 批閱',S.ai.configured?'已配置':'待接入',S.ai.configured?'文字與手寫作答都即時評分':'手寫作答需 AI 才能即時計分']])}
<section class="panel panel-pad"><div class="section-head"><h2>開始一場模擬測驗</h2><span class="small-text">題庫可用 ${o.available} 題</span></div><div class="form-grid">
<div class="form-field"><label class="field-label" for="mock-topic">知識點（主分類）</label><select id="mock-topic"><option value="">全部知識點</option>${o.topics.map(t=>`<option>${esc(t)}</option>`).join('')}</select></div><div class="form-field"><label class="field-label" for="mock-subtopic">子分類（可選）</label><select id="mock-subtopic"><option value="">全部子分類</option></select></div>
<div class="form-field"><label class="field-label" for="mock-level">難度</label><select id="mock-level"><option value="">全部難度</option>${[1,2,3].map(n=>`<option value="${n}">${levels[n]}</option>`).join('')}</select></div>
<div class="form-field"><label class="field-label" for="mock-qtype">題型</label><select id="mock-qtype"><option value="">全部題型</option>${(o.qtypes||[]).map(t=>`<option>${esc(t)}</option>`).join('')}</select></div>
<div class="form-field"><label class="field-label" for="mock-count">題數</label><select id="mock-count">${o.counts.map(n=>`<option value="${n}">${n} 題</option>`).join('')}</select></div>
<div class="form-field"><label class="field-label" for="mock-minutes">時限</label><select id="mock-minutes">${o.minutes.map(n=>`<option value="${n}" ${n===15?'selected':''}>${n} 分鐘</option>`).join('')}</select></div></div>
<p class="field-hint">題目只從答案已核驗的題庫抽選；按「開始」後即開始倒數，時間到會自動封存；教師佈置的測驗須教師覆核，自助模擬測驗即時評分可評的作答。${S.ai.configured?'已接入 AI：文字與手寫作答都會即時批閱。':'未接入 AI：文字作答即時核對最終答案；手寫作答會列為待批閱，不計入總分（不會當零分）。'}</p>
<div id="mock-error"></div><button class="primary" id="mock-start">開始模擬測驗 ${icon('arrow')}</button></section>
<section class="panel panel-pad"><div class="section-head"><h2>我的模擬測驗紀錄</h2><span class="small-text">${exams.length} 場</span></div>
${exams.length?`<div class="record-list">${exams.map(e=>`<article class="record"><span class="record-icon">${icon('mock')}</span><div class="record-body"><strong>${esc(e.topic)}${e.subtopic?` › ${esc(e.subtopic)}`:''} · ${e.questionCount} 題 · 限時 ${e.minutes} 分鐘</strong><p>${e.status==='submitted'?`已提交 · ${scoreText(e.score)} / ${e.maxScore} 分${e.percent!=null?`（${e.percent}%）`:''}${e.expired?' · 逾時自動提交':''}${e.pendingCount?` · ${e.pendingCount} 題待批閱`:''}`:`進行中 · 剩餘 ${fmtClock(e.remainingSeconds||0)}`}</p><small>${dateText(e.startedAt)}</small></div><button class="secondary" data-mock="${e.id}">${e.status==='submitted'?'查看結果':'繼續作答'}</button></article>`).join('')}</div>`:'<p class="field-hint">還沒有紀錄。選擇上面的條件開始第一場模擬測驗。</p>'}
</section></div>`;
const syncMockSub=()=>{const sel=$('#mock-subtopic');if(!sel)return;const subs=(o.subtopics||{})[$('#mock-topic').value]||[];sel.innerHTML='<option value="">全部子分類</option>'+subs.map(v=>`<option>${esc(v)}</option>`).join('');};$('#mock-topic').onchange=syncMockSub;syncMockSub();
$('#mock-start').onclick=async()=>{const b=$('#mock-start');b.disabled=true;$('#mock-error').innerHTML='';const body={count:Number($('#mock-count').value),minutes:Number($('#mock-minutes').value)};const topic=$('#mock-topic').value,level=$('#mock-level').value,qtype=$('#mock-qtype').value;if(topic)body.topic=topic;const sub=$('#mock-subtopic')?$('#mock-subtopic').value:'';if(sub)body.subtopic=sub;if(level)body.level=Number(level);if(qtype)body.qtype=qtype;const request=viewTarget();try{const r=await api('/api/mock',body);if(!viewMatches(request))return;toast('模擬測驗已開始，請把握時間。');mockExamPage(r.exam.id);}catch(e){if(!viewMatches(request))return;$('#mock-error').innerHTML=`<div class="inline-error">${esc(e.message)}</div>`;b.disabled=false;}};}
function openMockQuestion(qid){if(!mockDetail||busy||mockContext?.id!==mockDetail.exam.id)return;if(mockDetail.exam.status==='submitted'||mockDetail.exam.remainingSeconds<=0||Date.parse(mockDetail.exam.expiresAt)<=Date.now()||quizTargetExpired())return toast('本份測驗已提交或到期，不能再作答。');preserveDraft();const q=mockDetail.questions.find(x=>x.id===Number(qid));if(!q)return;if(currentQuestion&&currentQuestion.id!==q.id&&strokes.length&&!lastResult&&!confirm('目前手寫內容尚未提交，確定切換題目？'))return;assignmentContext=null;mockContext={id:mockDetail.exam.id,title:'模擬測驗 · '+mockDetail.exam.topic};currentQuestion=q;lastResult=null;lastSolution=null;answerMode=(q.options&&q.options.length)?'choice':'hand';answerFile=null;selectedOption=null;window.answerTextDraft='';strokes=[];redoStrokes=[];recommendations=null;practice();}
async function mockExamPage(id){if(!S.user)return loginModal(()=>mockExamPage(id));if(S.user.role!=='student')return toast('只有學生可以作答模擬測驗。');if(busy)return toast('請先等待作答保存完成。');preserveDraft();beginView();stopQuizClock();page='mock';assignmentContext=null;mockContext={id:Number(id)};mockDetail=null;currentQuestion=null;shell();$('#sidebar').classList.remove('open');const target=viewTarget();
try{const data=await api(`/api/mock/${id}`);if(!viewMatches(target))return;mockDetail=data;}catch(e){if(!viewMatches(target))return;$('#main').innerHTML=`<div class="fade-in"><button class="text-button back-button" data-page="mock">${icon('back')}返回模擬測驗</button>${heading('MOCK EXAM','模擬測驗','')}<section class="panel"><div class="inline-error">${esc(e.message)}</div></section></div>`;return;}
const exam=mockDetail.exam,questions=mockDetail.questions||[],attempts=mockDetail.attempts||[],report=mockDetail.report;
const latest=new Map();attempts.forEach(a=>{if(!latest.has(a.questionId)||latest.get(a.questionId).id<a.id)latest.set(a.questionId,a);});
const submitted=exam.status==='submitted',remaining=exam.remainingSeconds||0,expired=!submitted&&(remaining<=0||Date.parse(exam.expiresAt)<=Date.now());
const answered=[...latest.keys()].length;
const banner=submitted?`<section class="quiz-banner done"><strong>${icon('check')}測驗已完成 · 即時計分</strong><div class="quiz-score">${scoreText(report?.score)} / ${report?.maxScore} 分${report?.percent!=null?`（${report.percent}%）`:''}</div><small>已評 ${report?.scoredPoints??0} 分${report?.pendingCount?` · ${report.pendingCount} 題待批閱，不計入總分`:''}${exam.expired?' · 逾時自動提交':''}</small></section>`
:expired?`<section class="quiz-banner expired"><strong>${icon('clock')}時間已結束</strong><small>已不能再作答，請提交以取得成績。</small></section>`
:`<section class="quiz-banner"><strong>${icon('clock')}模擬測驗進行中 · 限時 ${exam.minutes} 分鐘</strong><small>剩餘時間 <span class="quiz-clock" data-quiz-clock>${fmtClock(remaining)}</span> · 時間到會自動封存；教師佈置的測驗須教師覆核，自助模擬測驗即時評分可評的作答。</small><div class="quiz-bar"><span data-quiz-bar="${exam.minutes*60}"></span></div></section>`;
$('#main').innerHTML=`<div class="fade-in"><button class="text-button back-button" data-page="mock">${icon('back')}返回模擬測驗</button>
${heading('MOCK EXAM','模擬測驗 · '+esc(exam.topic),`${exam.questionCount} 題 · 限時 ${exam.minutes} 分鐘${exam.level?' · 難度 '+levels[exam.level]:''}`)}
${banner}
${homeworkMetrics([['已保存題目',`${answered} / ${questions.length}`,'逐題保存不等於正式提交'],['已評得分',report?scoreText(report.score):'—',`僅涵蓋已評 ${report?report.scoredPoints:0} 分，非完整總分`],['待批題目',report?report.pendingCount:0,'待批閱不當零分'],['教師確認分',report?scoreText(report.confirmedScore):'—',`已確認 ${report?report.confirmedCount:0} 題`]])}
<section class="panel panel-pad"><div class="section-head"><h2>本份測驗題目</h2><span class="small-text">${submitted?'已提交，作答已鎖定':expired?'已逾時，不能作答':'可逐題作答與修改'}</span></div>
<div class="assignment-questions">${questions.map((q,i)=>{const at=latest.get(q.id);return `<article class="assignment-question-row"><span class="q-index">${String(i+1).padStart(2,'0')}</span><div class="q-body"><strong>${mathText(q.title)}</strong><span class="badge outline">${esc(q.qtype||'解答題')}</span><span class="badge l${q.level}">${levels[q.level]}</span><span class="small-text">${q.points} 分</span>${stemHtml(q,{className:'question-text',options:false})}<span class="small-text">${at?(at.status==='pending'?'已保存 · 待批閱':`已評 ${scoreText(at.score)} / ${at.maxScore} · ${at.teacherReviewed?'教師確認':'尚未教師確認'}`):'尚未作答'}</span></div>${submitted?`<button class="secondary" data-review="${at?at.id:''}" ${at?'':'disabled'}>查看</button>`:`<button class="practice-btn" data-mock-q="${q.id}" ${expired?'disabled':''}>${at?'修改作答':'開始解題'} ${icon('arrow')}</button>`}</article>`;}).join('')}</div>
<div class="assignment-submit"><p class="field-hint">${submitted?'已提交。模擬測驗只供你本人檢視，不會計入正式成績。':expired?'時間已結束，提交後即時計分。':'完成所有題目後按「提交並即時計分」；含待批閱的手稿也可提交，不會自動記零分。'}</p>${submitted?`<button class="secondary" data-page="mock">返回模擬測驗</button>`:`<button class="primary" id="mock-submit" ${answered||expired?'':'disabled'}>提交並即時計分 ${icon('check')}</button>`}</div></section>
${report?`<div class="result-layout"><section class="panel panel-pad">${suggestionCard(report.suggestion)}</section><aside class="right-stack">${mockTopicPanel(report.topicStats)}</aside></div>`:''}</div>`;
if(!submitted)startQuizClock({kind:'mock',id:exam.id},remaining,exam.expiresAt);else stopQuizClock();
const sb=$('#mock-submit');
if(sb)sb.onclick=async()=>{if(!confirm('提交後不能修改作答，確定提交？'))return;const request=viewTarget(),b=sb;b.disabled=true;try{await api(`/api/mock/${exam.id}/submit`,{});if(!viewMatches(request))return;stopQuizClock();toast('已提交並即時計分。');mockExamPage(exam.id);}catch(e){if(viewMatches(request)){toast(e.message);b.disabled=false;}}};}
async function assignmentPage(id){if(busy)return toast('請先等待作答保存完成。');preserveDraft();if(!S.user)return loginModal(()=>assignmentPage(id));if(S.user.role==='teacher')return resultsPage(id);beginView();stopQuizClock();page='homework';mockContext=null;assignmentContext={id:Number(id)};assignmentDetail=null;currentQuestion=null;shell();$('#sidebar').classList.remove('open');const target=viewTarget();try{const data=await api(`/api/assignments/${id}`);if(!viewMatches(target))return;assignmentDetail=data;assignmentContext=data.assignment;const {assignment:a,report:r,mySubmission:sub,questions:qs,attempts}=data;const map=new Map();attempts.forEach(x=>{if(!map.has(x.questionId)||map.get(x.questionId).id<x.id)map.set(x.questionId,x);});const submitted=sub.status==='submitted';const late=new Date(a.dueAt)<new Date();const fix=sub.correction;const isQuiz=a.kind==='quiz'&&!!a.durationMinutes;const quizStarted=!!sub.startedAt;const quizExpired=!!sub.expired||(quizStarted&&(sub.remainingSeconds<=0||Date.parse(sub.expiresAt)<=Date.now()));const quizBlocked=isQuiz&&!submitted&&!sub.correction&&(!quizStarted||quizExpired);const fixIds=new Set(fix?fix.questionIds:[]);const locked=submitted||!!fix;const inFix=q=>!fix||fixIds.has(q.id);const redone=q=>{const at=map.get(q.id);return!!(at&&fix&&at.id>(fix.minAttemptId??-1));};const pendingFix=fix?qs.filter(inFix).filter(q=>!redone(q)).length:0;$('#main').innerHTML=`<div class="fade-in"><button class="text-button back-button" data-page="homework">${icon('back')}返回我的作業</button>${heading('YOUR ASSIGNMENT',mathText(a.title),`${esc(a.className)} · 截止 ${dateText(a.dueAt)} · ${a.questionCount} 題 / ${a.totalPoints} 分`,`<span class="badge ${submitted?'':'l2'}">${statusText(sub.status)}${sub.late?' · 遲交':''}${sub.submitCount>1?` · 第 ${sub.submitCount} 次提交`:''}</span>`)}${isQuiz&&!submitted?`<div class="quiz-banner${quizExpired?' expired':''}">${icon('clock')}<div class="quiz-banner-body"><strong>模擬測驗 · 限時 ${a.durationMinutes} 分鐘</strong>${!quizStarted?`<small>按「開始測驗」後開始倒數；到期自動封存，分數與 AI 建議須教師覆核。</small>`:quizExpired?`<small>測驗時間已結束，無法再作答。</small>`:`<small>剩餘時間 <span class="quiz-clock" data-quiz-clock>--:--</span> · 到期自動封存，分數與 AI 建議須教師覆核。</small><div class="quiz-bar"><span data-quiz-bar="${a.durationMinutes*60}"></span></div>`}</div>${!quizStarted&&!quizExpired?`<button class="primary" id="start-quiz">開始測驗 ${icon('arrow')}</button>`:''}</div>`:''}${fix?`<div class="correction-banner"><div class="advice-heading">${icon('undo')}教師要求訂正（第 ${fix.round} 回合）</div><p>${esc(fix.note)}</p><small class="field-hint">教師於 ${dateText(fix.requestedAt)} 要求。請完成範圍內題目後按「提交訂正」；教師要求的訂正不受截止時間限制。${pendingFix?`目前尚有 ${pendingFix} 題未重新作答。`:'所有題目已重新作答，可以提交。'}</small></div>`:''}${submitted&&isQuiz?`<div class="quiz-result-banner${r.awaitingReview?' awaiting':''}"><div class="advice-heading">${icon(r.awaitingReview?'clock':'check')}測驗已完成${r.awaitingReview?' · 等待教師批閱':' · 教師已批閱'}</div>${r.awaitingReview?`<p>教師批閱後才會顯示分數與 AI 批閱結果。</p><small class="field-hint">已保存 ${map.size} / ${qs.length} 題 · 待教師批閱 ${r.pendingCount} 題，未當零分。</small>`:`<p class="quiz-result-score"><strong>${scoreText(r.score)}</strong> / ${r.maxScore} 分${r.percent!=null?`（${r.percent}%）`:''}</p><small class="field-hint">已評 ${r.gradedCount} / ${r.questionCount} 題${r.pendingCount?` · ${r.pendingCount} 題待教師批閱，未當零分`:''}。右側「學習建議」已按本次表現更新。</small>`}</div>`:''}${submitted&&r?.awaitingReview&&!isQuiz?`<div class="hint-box" style="margin-bottom:20px">${icon('clock')}作業已提交，等待教師批閱。教師批閱後才會顯示分數、AI 批閱結果、參考答案與學習建議。</div>`:''}${a.aiGrading?`<div class="hint-box" style="margin-bottom:20px">${icon('spark')}本份作業由教師設定使用 AI 建議評分（僅供教師覆核），最終分數以教師確認為準。</div>`:''}${a.description?`<div class="hint-box" style="margin-bottom:20px">${esc(a.description)}</div>`:''}${homeworkMetrics([['已保存題目',fix?`${qs.filter(q=>inFix(q)&&redone(q)).length} / ${fixIds.size}`:`${map.size} / ${qs.length}`,fix?'只計本回合訂正範圍的最新有效作答':'保存題目不等於正式交作業'],['已評得分',scoreText(r.score),r.awaitingReview?'教師批閱後才顯示':`僅涵蓋已評 ${r.totalScoredPoints} 分，非完整總分`],['待批閱題目',r.pendingCount,'未批閱不當零分'],['教師確認分',scoreText(r.confirmedScore),`已確認 ${r.confirmedCount} / ${qs.length} 題`]])}<div class="homework-layout"><section class="panel assignment-question-list"><div class="panel-heading"><h2>本份作業題目</h2><span class="small-text">${fix?'只可修改訂正範圍內的題目':submitted?'作答已鎖定':'可逐題保存並重做'}</span></div>${qs.map((q,i)=>{const at=map.get(q.id);return `<article class="assignment-question-row"><span class="question-number">${String(i+1).padStart(2,'0')}</span><div class="question-body"><div class="question-top"><h3>${mathText(q.title)}</h3><span class="badge">${q.points} 分</span></div>${stemHtml(q)}<span class="small-text">${at?(at.skipped?'已標示「本題不會」 · 等待教師處理':(at.awaitingReview?`${submitted?'已提交':'已保存'} · 等待教師批閱`:(at.status==='pending'?'已保存 · 待批閱':`已評 ${at.score}/${at.maxScore} · ${at.teacherReviewed?'教師確認':'尚未教師確認'}`))):'尚未作答'}${fix?(inFix(q)?(redone(q)?' · 已訂正待提交':' · 待訂正'):' · 不需訂正'):''}</span>${at&&(submitted||redone(q))?`${at.awaitingReview?'':`<p class="field-hint">${esc(at.feedback)}</p>`}<button class="text-button" data-review="${at.id}" style="font-size:calc(14px*var(--fs))">${at.awaitingReview?'查看我的作答':'查看手稿與學習建議'} ${icon('arrow')}</button>`:''}</div>${(!locked||(fix&&inFix(q)))&&!quizBlocked?`<div class="q-actions"><button class="practice-btn" data-assignment-q="${q.id}" ${late&&!a.allowLate&&!fix?'disabled':''}>${at?(at.skipped?'補作答':'修改作答'):'開始解題'} ${icon('arrow')}</button>${!at&&!isQuiz?`<button class="text-button skip-btn" data-skip-q="${q.id}" title="不會也沒關係，老師會看到">本題不會</button>`:''}</div>`:''}</article>`;}).join('')}<div class="assignment-submit"><p class="field-hint">${fix?`請完成訂正範圍內的 ${fixIds.size} 題後提交，教師會重新檢視你的推導。${pendingFix?`目前尚有 ${pendingFix} 題未重新作答。`:'所有題目已重新作答。'}`:submitted?`正式提交於 ${dateText(sub.submittedAt)}${sub.resubmittedAt?` · 最近訂正提交於 ${dateText(sub.resubmittedAt)}`:''}。你可查看結果，教師覆核後分數會更新。`:late&&!a.allowLate?'已超過截止時間，本份作業不接受補交。':'完成所有題目後正式交作業。含待批閱的手稿也可提交，不會自動記零分。'}</p>${fix?`<button class="primary" id="finalize-assignment" ${pendingFix?'disabled':''}>提交訂正 ${icon('check')}</button>`:!submitted?`<button class="primary" id="finalize-assignment" ${!quizExpired&&(map.size!==qs.length||(late&&!a.allowLate)||quizBlocked)?'disabled':''}>正式提交整份作業 ${icon('check')}</button>${(!fix&&!quizBlocked&&!(late&&!a.allowLate)&&map.size!==qs.length)?`<button class="secondary" id="skip-rest-submit">其餘 ${qs.length-map.size} 題標示「不會」並提交</button>`:''}`:`<button class="secondary" data-assignment="${a.id}">讀取最新批閱 ${icon('undo')}</button>`}</div></section><aside class="right-stack">${suggestionCard(r.suggestion)}<section class="panel right-panel"><h2>${icon('growth')}知識點表现</h2>${r.topicStats.map(t=>`<div class="topic-detail"><div class="knowledge-row"><span>${esc(t.topic)}</span><span>${t.percent===null?'待批閱':t.percent+'%'}</span></div><div class="progress-track"><div class="progress-fill" style="width:${t.percent||0}%"></div></div><small class="field-hint">已評 ${t.scoredCount} / ${t.totalCount} 題</small></div>`).join('')}</section></aside></div></div>`;for(const at of attempts){const idx=S.attempts.findIndex(x=>x.id===at.id);if(idx<0)S.attempts.push(at);else S.attempts[idx]=at;}if($('#start-quiz'))$('#start-quiz').onclick=async()=>{const request=viewTarget(),b=$('#start-quiz');b.disabled=true;try{await api(`/api/assignments/${id}/start`,{});if(!viewMatches(request))return;toast('已開始計時，請把握時間作答。');assignmentPage(id);}catch(e){if(viewMatches(request)){toast(e.message);b.disabled=false;}}};if(isQuiz&&quizStarted&&!submitted&&!fix)startQuizClock({kind:'assignment',id:a.id},sub.remainingSeconds,sub.expiresAt);else stopQuizClock();
  const skipRest=$('#skip-rest-submit');
  if(skipRest)skipRest.onclick=async()=>{
    const answered=new Set((assignmentDetail?.attempts||[]).map(x=>x.questionId));
    const missing=(assignmentQuestionScope()||[]).filter(q=>!answered.has(q.id));
    if(!missing.length)return;
    if(!confirm(`把剩下的 ${missing.length} 題標示為「不會」並立即提交？老師會看到哪幾題沒有作答，不會自動記零分。`))return;
    const b=skipRest;b.disabled=true;b.innerHTML=icon('clock')+'正在處理…';
    try{
      for(const q of missing)await api('/api/attempts',{questionId:q.id,skipped:true,assignmentId:id});
      await api(`/api/assignments/${id}/submit`,{});
      toast('已標示「不會」並正式提交，老師會看到哪幾題沒有作答。');
      assignmentPage(id);
    }catch(e){b.disabled=false;b.innerHTML=`其餘 ${missing.length} 題標示「不會」並提交`;toast(e.message);}
  };if($('#finalize-assignment'))$('#finalize-assignment').onclick=async()=>{
  if(!confirm(fix?'提交訂正後教師會重新檢視，確定提交？':'正式提交後不能修改作答，確定交作業？'))return;
  const request=viewTarget(),b=$('#finalize-assignment');b.disabled=true;
  const send=()=>api(`/api/assignments/${id}/submit`,{});
  try{
    try{await send();}
    catch(err){
      // 還有題目沒有交代：一次把剩下的標示「不會」，不必逐題回去點。
      if(!/還有 \d+ 題沒有作答/.test(err.message||''))throw err;
      if(!confirm(`${err.message}\n\n要把這些題目標示為「不會」並立即提交嗎？老師會看到這幾題沒有作答，不會自動記零分。`))throw err;
      const answered=new Set((assignmentDetail?.attempts||[]).map(x=>x.questionId));
      const missing=(assignmentQuestionScope()||[]).filter(q=>!answered.has(q.id));
      for(const q of missing)await api('/api/attempts',{questionId:q.id,skipped:true,assignmentId:id});
      await send();
    }
    if(!viewMatches(request))return;
    toast(fix?'訂正已提交，等待教師重新檢視。':'整份作業已正式提交，待批題目不會當零分。');
    assignmentPage(id);
  }catch(e){if(viewMatches(request)){toast(e.message);b.disabled=false;}}
};window.scrollTo({top:0});}catch(e){if(viewMatches(target))toast(e.message);}}
async function openAssignmentQuestion(qid){
  if(!assignmentDetail||busy||S.user?.role!=='student'||assignmentContext?.id!==assignmentDetail.assignment.id)return;
  const a=assignmentDetail.assignment,sub=assignmentDetail.mySubmission,fix=sub.correction;
  if(sub.status==='submitted'&&!fix)return toast('本份作業已提交，作答已鎖定。');
  if(fix&&!(fix.questionIds||[]).includes(Number(qid)))return toast('這道題不在本次訂正範圍內。');
  if(!fix){
    if(a.kind==='quiz'&&a.durationMinutes&&(!sub.startedAt||sub.expired||sub.remainingSeconds<=0||Date.parse(sub.expiresAt)<=Date.now()||(quizDeadlines.get(quizKey({kind:'assignment',id:a.id}))??Infinity)<=Date.now()))return toast('測驗尚未開始或已到期，不能作答。');
    if(new Date(a.dueAt)<new Date()&&!a.allowLate)return toast('已超過截止時間，本份作業不接受補交。');
  }
  const q=assignmentDetail.questions.find(q=>q.id===Number(qid));if(!q)return;
  preserveDraft();if(strokes.length&&!lastResult&&page==='practice'&&!confirm('目前手稿尚未提交，確定切換？'))return;
  mockContext=null;assignmentContext=a;if(fix)stopQuizClock();currentQuestion=q;lastResult=null;lastSolution=null;answerMode=q.options?.length?'choice':'hand';answerFile=null;selectedOption=null;strokes=[];redoStrokes=[];window.answerTextDraft='';recommendations=null;
  practice();const target=viewTarget();
  if(!fix&&a.kind==='quiz'&&a.durationMinutes)startQuizClock({kind:'assignment',id:a.id},sub.remainingSeconds,sub.expiresAt);else stopQuizClock();
  try{const rec=await api(`/api/questions/${qid}/recommendations`);if(!viewMatches(target))return;recommendations=rec;renderRecommendations();}catch(e){if(viewMatches(target))toast(e.message);}
  if(viewMatches(target))window.scrollTo({top:0});
}
async function resultsPage(id){if(busy)return;if(!S.user)return loginModal(()=>resultsPage(id));page='homework';shell();$('#sidebar').classList.remove('open');try{resultData=await api(`/api/assignments/${id}/results`);assignmentDetail=await api(`/api/assignments/${id}`);const {assignment:a,students,summary:s,topicStats:ts}=resultData;$('#main').innerHTML=`<div class="fade-in"><button class="text-button back-button" data-page="homework">${icon('back')}返回作業與成績</button>${heading('CLASS RESULTS',mathText(a.title),`${esc(a.className)} · ${a.questionCount} 題 / ${a.totalPoints} 分 · 截止 ${dateText(a.dueAt)}${a.aiGrading?' · 已啟用 AI 建議評分':''}`,`<button class="secondary" id="export-results">${icon('file')}匯出成績</button><button class="secondary" data-results="${id}">${icon('undo')}重新整理</button>${(a.aiGrading&&S.ai.configured)?`<button class="primary" id="ai-review-all">${icon('spark')}一鍵 AI 全部批閱</button>`:''}`)}${homeworkMetrics([['正式提交',`${s.submittedCount} / ${s.studentCount}`,s.correctionCount?`其中 ${s.correctionCount} 人訂正中 · 不計入平均`:'人數 · 未交者不計零分'],['全題已評平均',scoreText(s.averageScore),`${s.fullyGradedCount} 人 · 僅正式提交且全題已評`],['教師確認平均',scoreText(s.confirmedAverage),'只計全題教師確認的正式提交'],['待覆核題目',s.pendingReviewCount,'手稿待批及 AI 建議未確認'],['建議覆核題目',s.reviewFlagCount,'AI 建議分與規則核對不一致，建議優先看']])}<div class="import-warning" style="margin-bottom:20px">「已評得分」可能僅涵蓋部分題目，不能當完整總分或用於排名。AI 原建議分、規則原分及教師確認分分開保存；只採每題最新作答。</div><section class="panel results-panel"><div class="panel-heading"><h2>學生提交與成績</h2><span class="small-text">${students.length} 位學生</span></div><div class="results-filters" style="padding:0 22px 16px;display:flex;gap:12px;flex-wrap:wrap"><input id="results-search" placeholder="搜尋學生名稱或帳戶" aria-label="搜尋學生" style="padding:10px;border:1px solid var(--border);border-radius:6px"><select id="results-filter" aria-label="提交狀態篩選" style="padding:10px;border:1px solid var(--border);border-radius:6px"><option value="all">全部學生</option><option value="not_started">未開始</option><option value="in_progress">作答中</option><option value="submitted">已正式提交</option><option value="pending">有待批題目</option><option value="flagged">有建議覆核</option></select></div><div class="table-scroll"><table class="results-table"><thead><tr><th>學生</th><th>提交狀態</th><th>作答／待批</th><th>已評得分</th><th>AI 原分</th><th>規則原分</th><th>教師確認</th><th>回饋</th></tr></thead><tbody>${students.map(st=>`<tr data-result-user="${st.id}" data-status="${st.status}" data-pending="${st.pendingCount}" data-flags="${st.reviewFlagCount||0}"><td><strong>${esc(st.name)}</strong><small>${esc(st.username)}</small></td><td><span class="badge ${st.status==='submitted'?'':'l2'}">${statusText(st.status)}</span>${st.late?'<small>遲交</small>':''}${st.correction?`<small>第 ${st.correction.round} 回合訂正</small>`:''}</td><td>${st.answeredCount}/${a.questionCount}<small>待批 ${st.pendingCount} 題</small>${st.reviewFlagCount?`<small class="review-flag-note">建議覆核 ${st.reviewFlagCount} 題</small>`:''}</td><td>${scoreText(st.score)}<small>涵蓋 ${st.scoredPoints}/${a.totalPoints} 分值</small></td><td>${scoreText(st.aiScore)}</td><td>${scoreText(st.ruleScore)}</td><td>${scoreText(st.confirmedScore)}<small>${st.confirmedCount}/${a.questionCount} 題</small></td><td><button class="practice-btn" data-student-result="${st.id}">${st.pendingCount?`批閱與建議 ${icon('arrow')}`:`查看 ${icon('arrow')}`}</button></td></tr>`).join('')}</tbody></table></div></section><div class="growth-layout" style="margin-top:22px"><section class="panel growth-panel"><h2>班級知識點表現</h2><p>只統計最新已評題目；未作答或待批題目不算零分。</p>${ts.map(t=>`<div class="topic-detail"><div class="knowledge-row"><span>${esc(t.topic)}</span><span>${t.percent===null?'暫無已評數據':t.percent+'%'}</span></div><div class="progress-track"><div class="progress-fill" style="width:${t.percent||0}%"></div></div><small class="field-hint">已評 ${t.scoredCount}/${t.totalCount} 道學生題目</small></div>`).join('')}</section><section class="panel growth-panel"><h2>${icon('bulb')}每位學生，都有下一步</h2><p>點擊「批閱與建議」查看本次的具體回饋。AI 建議依本次批改及最多5次同主題記錄生成；未接入時提供明确標示的規則建議。</p><p>教師覆核後，建議會根據教師的真實評語更新，不把待批手稿當成錯題。</p></section></div></div>`;$$('[data-student-result]').forEach(b=>b.onclick=()=>studentResultModal(Number(b.dataset.studentResult)));const filterRows=()=>{const term=$('#results-search').value.trim().toLowerCase(),state=$('#results-filter').value;$$('[data-result-user]').forEach(row=>{row.hidden=!(row.textContent.toLowerCase().includes(term)&&(state==='all'||state==='pending'&&Number(row.dataset.pending)>0||state==='flagged'&&Number(row.dataset.flags)>0||row.dataset.status===state));});};$('#results-search').oninput=filterRows;$('#results-filter').onchange=filterRows;$('#export-results').onclick=exportResultsCsv;const all=$('#ai-review-all');if(all)all.onclick=()=>aiReviewAll(id);window.scrollTo({top:0});}catch(e){toast(e.message);}}
// 教師一鍵 AI 全部批閱：對尚未批閱的作答逐題 AI 評分並直接確認為教師批閱分數。
async function aiReviewAll(id){const btn=$('#ai-review-all');const external=S.ai.mode==='external';const message=external
  ?'將以 AI 批閱這份作業中所有尚未批閱的作答，作答內容（含手寫圖片）會傳送至學校配置的外部 AI，並直接標記為「教師已批閱」。確定繼續？'
  :'將以 AI 批閱這份作業中所有尚未批閱的作答，並直接標記為「教師已批閱」。確定繼續？';
if(!confirm(message))return;const original=btn.innerHTML;btn.disabled=true;btn.innerHTML=icon('clock')+'正在以 AI 批閱…';try{const r=await api(`/api/assignments/${id}/ai-review`,{consentExternal:external});const parts=[`已批閱 ${r.reviewed} 題`];if(r.failed)parts.push(`${r.failed} 題失敗`);if(r.skipped)parts.push(`${r.skipped} 題已被其他操作處理`);if(r.remaining)parts.push(`還有 ${r.remaining} 題，請再按一次`);toast(parts.join(' · ')+(r.errors?.length?`（${r.errors[0].error}）`:''));await resultsPage(id);}catch(e){toast(e.message);btn.disabled=false;btn.innerHTML=original;}}
function studentResultModal(uid){const st=resultData.students.find(s=>s.id===uid);if(!st)return;const latest=new Map();assignmentDetail.attempts.filter(at=>at.student?.id===uid).forEach(at=>{if(!latest.has(at.questionId)||latest.get(at.questionId).id<at.id)latest.set(at.questionId,at);});modal(`<p class="eyebrow">INDIVIDUAL FEEDBACK</p><h2>${esc(st.name)} · 本次作業</h2><p class="modal-intro">${statusText(st.status)} · 已評 ${scoreText(st.score)} 分（涵蓋 ${st.scoredPoints} 分值） · 教師確認 ${scoreText(st.confirmedScore)} 分</p>${suggestionCard(st.suggestion)}${st.correction?`<div class="correction-banner"><div class="advice-heading">${icon('undo')}訂正中（第 ${st.correction.round} 回合）</div><p>${esc(st.correction.note)}</p><small class="field-hint">已於 ${dateText(st.correction.requestedAt)} 要求訂正 ${st.correction.questionIds.length||assignmentDetail.questions.length} 題。學生重新提交前，此份作業不計入班級平均。</small></div>`:''}<h3 style="margin-top:22px">逐題查看與覆核</h3>${assignmentDetail.questions.map(q=>{const at=latest.get(q.id);return `<div class="student-review-row"><div><strong>${mathText(q.title)}</strong><small>${at?at.status==='pending'?'待批閱':`已評 ${at.score}/${q.points} · ${at.teacherReviewed?'已教師確認':'未教師確認'}`:'尚未作答'}${at?.reviewFlags?.length?' · <span class="badge review-flag">建議覆核</span>':''}</small></div>${at?`<button class="secondary" data-hw-review="${at.id}">查看／批閱</button>`:''}</div>`;}).join('')}${(assignmentDetail.assignment.aiGrading&&S.ai.configured)?`<div class="submit-row" style="margin-top:16px"><button class="secondary" id="adopt-student-ai">${icon('spark')}確認這位學生的全部 AI 建議</button><span class="small-text">只處理尚未覆核的題目；標示「不會」的空白題不會丟給模型。</span></div>`:''}<div class="correction-actions">${st.submittedAt&&!st.correction?`<button class="secondary" id="request-correction">${icon('undo')}退回訂正</button><span class="small-text">讓學生重新作答並再次提交</span>`:`<span class="small-text">${st.correction?'已有進行中的訂正要求。':'此學生尚未正式提交，無需退回訂正。'}</span>`}</div>`,true);for(const at of latest.values()){const idx=S.attempts.findIndex(x=>x.id===at.id);if(idx<0)S.attempts.push(at);else S.attempts[idx]=at;}const studentQueue=assignmentDetail.questions.map(q=>latest.get(q.id)).filter(Boolean).map(at=>at.id);
$$('[data-hw-review]').forEach(b=>b.onclick=()=>{const at=S.attempts.find(x=>x.id===Number(b.dataset.hwReview));closeModal();reviewModal(at.id,()=>resultsPage(resultData.assignment.id),assignmentDetail.questions.find(q=>q.id===at.questionId),studentQueue);});
const adoptAll=$('#adopt-student-ai');
if(adoptAll)adoptAll.onclick=async()=>{const external=S.ai.mode==='external';
  if(external&&!confirm('會把這位學生的作答（含手寫圖片）傳送給外部 AI，是否繼續？'))return;
  const label=adoptAll.innerHTML;adoptAll.disabled=true;adoptAll.innerHTML=icon('clock')+'正在確認…';
  try{const r=await api(`/api/assignments/${assignmentDetail.assignment.id}/ai-review`,{studentId:uid,consentExternal:external});
    const parts=[`已確認 ${r.reviewed} 題`];
    if(r.skipped)parts.push(`${r.skipped} 題留待你處理`);
    if(r.failed)parts.push(`${r.failed} 題失敗`);
    toast(parts.join('，')+'。');closeModal();resultsPage(resultData.assignment.id);
  }catch(e){adoptAll.disabled=false;adoptAll.innerHTML=label;toast(e.message);}};const rc=$('#request-correction');if(rc)rc.onclick=()=>{closeModal();correctionModal(st);};}
function correctionModal(st){const latest=new Map();assignmentDetail.attempts.filter(at=>at.student?.id===st.id).forEach(at=>{if(!latest.has(at.questionId)||latest.get(at.questionId).id<at.id)latest.set(at.questionId,at);});const weak=assignmentDetail.questions.filter(q=>{const at=latest.get(q.id);return at&&at.status==='graded'&&at.score!==null&&at.score<at.maxScore;});const preselect=new Set((weak.length?weak:assignmentDetail.questions).map(q=>q.id));
modal(`<p class="eyebrow">RETURN FOR CORRECTION</p><h2>退回訂正 · ${esc(st.name)}</h2><p class="modal-intro">學生會看到你的說明與批註，並可重新作答指定題目。原作答與分數仍保留在紀錄中，可作對照。</p><form id="correction-form"><div class="form-field"><label class="field-label" for="correction-note">訂正說明（學生會看到）</label><textarea class="answer-field" id="correction-note" style="min-height:110px" maxlength="2000" required placeholder="例如：第1題漏了第二個根。請寫出因式分解的完整過程，並代回檢查兩個解。"></textarea></div><div class="section-head" style="margin:18px 0 10px"><h2 style="font-size:calc(16px*var(--fs))">需要訂正的題目</h2><span class="small-text" id="correction-count">已選 ${preselect.size} 題</span></div><div class="assignment-question-picks">${assignmentDetail.questions.map((q,i)=>{const at=latest.get(q.id);return `<label class="pick-row"><input type="checkbox" name="correction-questions" value="${q.id}" ${preselect.has(q.id)?'checked':''}><span><strong>第 ${i+1} 題 · ${mathText(q.title)}</strong><small>${at?(at.status==='pending'?'目前待批閱':`目前 ${scoreText(at.score)} / ${at.maxScore} 分`):'尚未作答'}</small></span><span class="badge">${q.points} 分</span></label>`;}).join('')}</div><div class="import-warning">退回後學生可重新作答這些題目並再次提交。教師要求的訂正不受截止時間限制；學生重新提交前，這份作業不計入班級平均。</div><p class="error-text" id="correction-error"></p><button class="primary wide" type="submit">退回訂正 ${icon('arrow')}</button></form>`,true);
$$('[name=correction-questions]').forEach(x=>x.onchange=()=>{$('#correction-count').textContent=`已選 ${$$('[name=correction-questions]:checked').length} 題`;});
$('#correction-form').onsubmit=async e=>{e.preventDefault();const ids=$$('[name=correction-questions]:checked').map(x=>Number(x.value));if(!ids.length)return toast('請至少選擇一題。');const b=$('[type=submit]',e.target);b.disabled=true;try{await api(`/api/assignments/${resultData.assignment.id}/return`,{studentId:st.id,note:$('#correction-note').value,questionIds:ids});closeModal();toast('已退回訂正，學生會看到你的說明。');resultsPage(resultData.assignment.id);}catch(err){$('#correction-error').textContent=err.message;b.disabled=false;}};}
// ── 簡易計算機（學生作答時在畫面右下角，可縮成小按鈕）──
// 只做四則、括號、開方、次方與 π：幫忙算數，不解方程也不化簡代數，避免變成代做工具。
// 算式用自己寫的遞迴下降解析器計算，不用 eval，貼上的任何字串都不會被當成程式碼執行。
const CALC_KEYS=[['C','clear'],['⌫','back'],['(','('],[')',')'],['÷','÷'],
  ['7','7'],['8','8'],['9','9'],['√','sqrt'],['×','×'],
  ['4','4'],['5','5'],['6','6'],['^','^'],['−','-'],
  ['1','1'],['2','2'],['3','3'],['π','pi'],['+','+'],
  ['0','0'],['.','.'],['x²','square'],['=','equals',2]];
let calcExpr='',calcOpen=false;
try{calcOpen=localStorage.getItem('mathpath_calc_open')==='1';}catch{}
function calcEval(input){
  const s=String(input).replace(/[×✕]/g,'*').replace(/÷/g,'/').replace(/[−–]/g,'-').replace(/\s+/g,'');
  let i=0;
  const peek=()=>s[i];
  const expr=()=>{let v=term();for(;;){if(peek()==='+'){i++;v+=term();}else if(peek()==='-'){i++;v-=term();}else return v;}};
  const term=()=>{let v=power();for(;;){if(peek()==='*'){i++;v*=power();}else if(peek()==='/'){i++;const d=power();if(d===0)throw new Error('除數不可為 0');v/=d;}else return v;}};
  const power=()=>{const base=atom();return peek()==='^'?(i++,Math.pow(base,power())):base;};
  const atom=()=>{
    const c=peek();
    if(c==='-'){i++;return -atom();}
    if(c==='+'){i++;return atom();}
    if(c==='√'){i++;return Math.sqrt(atom());}
    if(c==='π'){i++;return Math.PI;}
    if(c==='('){i++;const v=expr();if(peek()!==')')throw new Error('括號沒有配對');i++;return v;}
    const start=i;
    while(i<s.length&&/[0-9.]/.test(s[i]))i++;
    if(i===start)throw new Error('算式不完整');
    const n=Number(s.slice(start,i));
    if(!Number.isFinite(n))throw new Error('數字格式有誤');
    return n;
  };
  const out=expr();
  if(i<s.length)throw new Error('算式無法辨識');
  if(!Number.isFinite(out))throw new Error('結果超出範圍');
  return Math.round(out*1e10)/1e10;
}
// 回傳 {value,error}：算式還沒寫完或除以零時，要讓學生看到原因，不能只顯示空白或 Infinity。
function calcEvaluate(){
  if(!String(calcExpr).trim())return {value:'',error:''};
  try{return {value:String(calcEval(calcExpr)),error:''};}
  catch(err){return {value:'',error:err.message||'算式無法辨識'};}
}
function calcWanted(){return S.user?.role==='student'&&page==='practice';}
function calcScreen(expr){
  const screen=$('#calc-screen');if(screen)screen.textContent=expr||'0';
  const line=$('#calc-live'),{value,error}=calcEvaluate();
  if(!line)return;
  line.textContent=value?'= '+value:(error||'');
  line.classList.toggle('bad',!value&&!!error);
}
function calcPress(key){
  if(key==='clear')calcExpr='';
  else if(key==='back')calcExpr=calcExpr.slice(0,-1);
  else if(key==='sqrt')calcExpr+='√(';
  else if(key==='pi')calcExpr+='π';
  else if(key==='square')calcExpr+='^2';
  else if(key==='equals'){
    const {value,error}=calcEvaluate();
    if(!value)return toast(error?`無法計算：${error}`:'算式還沒完成，先補齊再按等號。');
    calcExpr=value;
    calcScreen(calcExpr);
    return;
  }else calcExpr+=key;
  calcScreen(calcExpr);
}
function renderCalculator(){
  const root=$('#calc-root');
  if(!root)return;
  if(!calcWanted()){root.innerHTML='';return;}
  const remember=v=>{calcOpen=v;try{localStorage.setItem('mathpath_calc_open',v?'1':'0');}catch{}};
  if(!calcOpen){
    root.innerHTML=`<button type="button" class="calc-fab" id="calc-open" aria-label="打開計算機">${icon('calculator')}<span>計算機</span></button>`;
    $('#calc-open').onclick=()=>{remember(true);renderCalculator();};
    return;
  }
  root.innerHTML=`<section class="calc-panel" aria-label="簡易計算機">
<header class="calc-head"><strong>計算機</strong><button type="button" class="icon-btn" id="calc-close" aria-label="縮小計算機">−</button></header>
<output class="calc-screen" id="calc-screen">${esc(calcExpr||'0')}</output>
<p class="calc-live" id="calc-live"></p>
<div class="calc-keys">${CALC_KEYS.map(([label,key,span])=>`<button type="button" class="calc-key${key==='equals'?' equals':''}" data-calc="${key}"${span?` style="grid-column:span ${span}"`:''}>${label}</button>`).join('')}</div>
<small class="calc-note">四則、括號、√、^、π；只幫你算數，不會替你解題。</small>
</section>`;
  $('#calc-close').onclick=()=>{remember(false);renderCalculator();};
  $$('#calc-root [data-calc]').forEach(b=>b.onclick=()=>calcPress(b.dataset.calc));
  calcScreen(calcExpr);
}
async function init(){loadBookmarks();homeworkPage();try{const session=await api('/api/session');serverOnline=true;serverIssue='';if(session.user){await refresh();homeworkPage();}}catch(e){serverIssue=e.message;toast(/初始化/.test(e.message)?e.message:'無法連接網站服務；目前為訪客界面預覽。請確認網站服務狀態。');}}
init();
