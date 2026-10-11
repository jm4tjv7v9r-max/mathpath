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
    <div class="rubric-actions"><button type="button" class="text-button" data-rubric-add="${scope}">＋ 新增評分要點</button><span class="rubric-total" data-rubric-total="${scope}">總和 0%</span></div>`;
}
// 唯讀呈現（題目詳解、批閱視窗）
function rubricListHtml(items, points){
  if(!items||!items.length) return '';
  return `<ul class="rubric-view">${items.map(it=>{const pct=Number(it.percent)||0;
    return `<li><span class="rubric-view-label">${mathText(it.label||'')}</span><span class="rubric-view-percent">${pct}%${points?` · ${Math.round(points*pct)/100} 分`:''}</span></li>`;}).join('')}</ul>`;
}
const rubricStores = new Map();
function rubricRender(scope){
  const store = rubricStores.get(scope);
  const list = document.querySelector(`[data-rubric-list="${scope}"]`);
  if(!store || !list) return;
  const items = store.items;
  list.innerHTML = rubricRowsHtml(items, scope);
  const total = document.querySelector(`[data-rubric-total="${scope}"]`);
  if(total){
    const t = Math.round(rubricTotal(items)*100)/100;
    total.textContent = items.length ? `總和 ${t}%${Math.abs(t-100)>0.01?'（須為 100%）':''}` : '尚未設定';
    total.classList.toggle('bad', items.length>0 && Math.abs(t-100)>0.01);
  }
  list.querySelectorAll('[data-rubric-label]').forEach(inp=>inp.oninput=e=>{items[Number(e.target.dataset.rubricIndex)].label=e.target.value;});
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
 text:'<path d="M4 20 10 4h4l6 16M7 14h10"/>'
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
let importStage=1, drafts=[], importMethod='', paperFile=null, paperName='', paperText='', figStrokes=[], figTool='pen', figDrawing=null, historyFilter='all';
// 自主練習的範圍：先選章節（主分類／子分類）與題型，再開始練習。
let practiceRange={topic:'',subtopic:'',qtype:''};
let toastTimer, serverOnline=false, busy=false, answerFile=null, selectedOption=null;
let strokes=[], redoStrokes=[], activeStroke=null, penColor='#274b3b', eraser=false;
let bookmarks=new Set();
let assignmentContext=null, mockContext=null;
let draftTimer, draftUser=null;
function draftKey(){return S.user&&currentQuestion?`mathpath_draft_${S.user.id}_${assignmentContext?.id||'practice'}_${currentQuestion.id}`:null;}
function saveDraft(){const key=draftKey();if(!key||page!=='practice'||lastResult)return;const payload={mode:answerMode,strokes,process:$('#answer-process')?.value||window.answerTextDraft||'',final:$('#final-answer')?.value||'',image:answerFile,choice:selectedOption,updatedAt:new Date().toISOString()};try{sessionStorage.setItem(key,JSON.stringify(payload));draftUser=S.user.id;const label=$('#draft-status');if(label)label.textContent='草稿已暫存於本分頁 · 正式提交後才保存到伺服器';}catch{const label=$('#draft-status');if(label)label.textContent='草稿暫存失敗，請及時提交（圖片可能太大）';}}
function scheduleDraft(){clearTimeout(draftTimer);draftTimer=setTimeout(saveDraft,350);}
function restoreDraft(){const key=draftKey();if(!key)return;try{const d=JSON.parse(sessionStorage.getItem(key)||'null');if(!d)return;if(!['choice','hand','text','upload'].includes(d.mode)||!Array.isArray(d.strokes))return;answerMode=(d.mode==='choice'&&!(currentQuestion&&currentQuestion.options&&currentQuestion.options.length))?'hand':d.mode;strokes=d.strokes;window.answerTextDraft=d.process||'';answerFile=d.image||null;selectedOption=d.choice||null;renderAnswerArea();$$('[data-answer-mode]').forEach(b=>b.classList.toggle('active',b.dataset.answerMode===answerMode));$('#final-answer').value=d.final||'';$('#draft-status').textContent='已恢復本分頁草稿 · 未正式提交';syncMathKeyboard();}catch{toast('草稿無法恢復，請重新作答。');}}
function clearCurrentDraft(){const key=draftKey();if(key)try{sessionStorage.removeItem(key);}catch{}clearTimeout(draftTimer);}
function clearUserDrafts(uid){try{for(let i=sessionStorage.length-1;i>=0;i--){const k=sessionStorage.key(i);if(k?.startsWith(`mathpath_draft_${uid}_`))sessionStorage.removeItem(k);}}catch{}}
function preserveDraft(){if(page==='practice'&&!lastResult)saveDraft();}
window.addEventListener('pagehide',preserveDraft);
document.addEventListener('input',e=>{if(e.target.matches('#final-answer,#answer-process')){lastResult=null;scheduleDraft();}});
function suggestionCard(s){if(!s)return '';return `<section class="learning-advice"><div class="advice-heading">${icon('spark')}本次學習建議 <span class="badge">${s.source==='ai'?'AI 個別建議':'規則建議 · 非 AI'}</span></div><div class="advice-grid"><div><span>做得好的地方</span><p>${esc(s.strength)}</p></div><div><span>需要留意</span><p>${esc(s.focus)}</p></div><div><span>下一步練習</span><p>${esc(s.nextStep)}</p></div></div>${s.recommended?.length?`<div class="advice-links">${s.recommended.map(q=>`<button class="text-button" data-qid="${q.id}">${q.kind==='advanced'?'進階':'相似'} · ${mathText(q.title)} ${icon('arrow')}</button>`).join('')}</div>`:''}<small class="field-hint">${esc(s.notice||'建議依目前作答產生，不代表完整能力診斷。')}</small></section>`;}
function bookmarkKey(){return `mathpath_bookmarks_${S.user?.id || 'guest'}`;}
function loadBookmarks(){try{bookmarks=new Set(JSON.parse(localStorage.getItem(bookmarkKey()) || '[]'));}catch{bookmarks=new Set();}}
function saveBookmarks(){try{localStorage.setItem(bookmarkKey(),JSON.stringify([...bookmarks]));}catch{toast('瀏覽器未允許儲存收藏設定。');}}
const FONT_SCALES=[['normal','標準'],['large','大'],['xlarge','特大']];
function fontScale(){try{const v=localStorage.getItem('mathpath_font_scale');return FONT_SCALES.some(([id])=>id===v)?v:'normal';}catch{return 'normal';}}
function applyFontScale(v){if(!FONT_SCALES.some(([id])=>id===v))v='normal';if(v==='normal')delete document.documentElement.dataset.fs;else document.documentElement.dataset.fs=v;try{localStorage.setItem('mathpath_font_scale',v);}catch{}}
function fontScaleControl(){const cur=fontScale();return `<div class="font-scale" role="group" aria-label="字體大小">${icon('text')}<span>字體</span>${FONT_SCALES.map(([id,label])=>`<button type="button" data-font-scale="${id}" class="${cur===id?'active':''}" aria-pressed="${cur===id}" title="字體${label}">${label}</button>`).join('')}</div><p class="font-scale-note">免登入即可調整，只影響這台裝置。</p>`;}
applyFontScale(fontScale());
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),4200);}
async function api(path,body){let r;try{r=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin'});}catch{throw new Error('無法連接本地伺服器，請確認服務已啟動。');}let data;try{data=await r.json();}catch{throw new Error('伺服器回應無效，請透過啟動程式開啟網站。');}if(!r.ok){if(r.status===401 && !path.includes('login') && !path.includes('change-password')){S.user=null;loginModal();}throw new Error(data.error || '操作未完成，請再試。');}return data;}
async function refresh(){S=await api('/api/state');loadBookmarks();shell();}
function empty(title,desc,button=''){return `<div class="empty">${icon('bank')}<h3>${title}</h3><p>${desc}</p>${button}</div>`;}
function shell(){let nav=[['homework',S.user?.role==='teacher'?'作業與成績':'我的作業'],['calendar','日曆'],['mock','模擬測驗'],['bank','數學題庫'],['practice','自主練習'],['import','試卷拆題'],['mistakes',S.user?.role==='teacher'?'作答批閱':'我的錯題本'],['growth','學習足跡']];if(S.user?.role!=='student')nav=nav.filter(([id])=>id!=='mock');if(S.user?.role==='teacher'){nav=nav.filter(([id])=>id!=='practice');nav.push(['ai','模型端點']);}$('#nav').innerHTML=nav.map(([id,label])=>`<button class="nav-item ${page===id?'active':''}" data-page="${id}">${icon(id)}<span>${label}</span>${id==='bank'?`<span class="count">${S.user?S.questions.length:'示例'}</span>`:id==='import'?'<span class="new">教師</span>':''}</button>`).join('');$('#settings-nav').innerHTML=icon('settings')+'<span>設定與隱私</span>';$('#settings-nav').classList.toggle('active',page==='settings');$('#font-scale').innerHTML=fontScaleControl();$('#account').innerHTML=`<span class="avatar">${S.user?(S.user.role==='teacher'?'師':'學'):'M'}</span><span class="account-info">${S.user?esc(S.user.name):'訪客預覽'}<small>${S.user?(S.user.role==='teacher'?'教師工作空間':'中三數學學習者'):'登入後開始學習'}</small></span>${icon(S.user?'chevron':'logout')}`;$('#avatar').textContent=S.user?(S.user.role==='teacher'?'師':'學'):'M';const labels={homework:S.user?.role==='teacher'?'作業與成績':'我的作業',calendar:'日曆',mock:'模擬測驗',ai:'模型端點',bank:'數學題庫',practice:'自主練習',import:'試卷拆題',mistakes:S.user?.role==='teacher'?'作答批閱':'我的錯題本',growth:'學習足跡',settings:'設定與隱私'};$('#crumb').textContent=labels[page] || '數學題庫';}

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
const hw=list.filter(e=>e.kind!=='quiz'),qz=list.filter(e=>e.kind==='quiz');
const marks=[];
if(hw.length)marks.push(`<span class="cal-mark hw">作業 ${hw.length}</span>`);
if(qz.length)marks.push(`<span class="cal-mark quiz">測驗 ${qz.length}</span>`);
if(noteList.length)marks.push(`<span class="cal-mark note">提醒 ${noteList.length}</span>`);
return `<button class="cal-cell${date===todayStr?' today':''}${date===calSelected?' selected':''}" data-cal-date="${date}"><span class="cal-day">${d}</span><span class="cal-marks">${marks.join('')}</span></button>`;}).join('');
const selEvents=byDate[calSelected]||[];
const totalHw=events.filter(e=>e.kind!=='quiz').length,totalQz=events.filter(e=>e.kind==='quiz').length;
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
function hero(){return `<section class="hero"><div class="hero-copy"><div class="hero-eyebrow">${icon('spark')} EVERY STEP COUNTS</div><h2>讓每一步思考，都成為進步。</h2><p>從理解一道題，到掌握一類題。找到屬於你的數學學習路徑。</p><button class="text-button" data-action="start">開始今日練習 ${icon('arrow')}</button></div><div class="hero-visual" aria-hidden="true"><span class="formula f1">x² − 5x + 6 = 0</span><span class="formula f2">a² + b² = c²</span><svg viewBox="0 0 300 170"><ellipse cx="158" cy="148" rx="94" ry="9" fill="#dce7d2" opacity=".5"/><path d="m75 112 69-19 75 29-70 25Z" fill="#d0dfbe"/><path d="m75 112 74 28v7l-74-28Z" fill="#b4caa4"/><path d="m149 140 70-18v7l-70 18Z" fill="#e4ecd6"/><path d="m84 98 69-18 74 28-69 23Z" fill="#f5f7ec"/><path d="m84 98 74 26v7L84 105Z" fill="#dfe8cd"/><path d="m158 124 69-16v7l-69 16Z" fill="#c6d7b3"/><path d="m85 78 70-20 76 28-70 26Z" fill="#b2cda5"/><path d="m85 78 76 29v5L85 85Z" fill="#8fac88"/><path d="m161 107 70-21v5l-70 21Z" fill="#dce8c8"/><path d="m149 45 52 19-23 52-49-20Z" fill="#fffdf3" stroke="#d6dfc6"/><path d="m138 71 30 11m-34 1 24 9m-20-28 15 5" stroke="#c4d1b8" stroke-width="2"/><path d="m189 35 9 3-24 61-9-3Z" fill="#779c76"/><path d="m165 96 9 3-9 8Z" fill="#e3c7a0"/><path d="m166 104-2 4 4-2" stroke="#557158"/><circle cx="244" cy="44" r="15" fill="#e6edd7"/><path d="M236 44h16m-8-8v16" stroke="#a2b28e"/><path d="m43 78 6-6 6 6-6 6Z" fill="#c9d7b7"/><circle cx="251" cy="124" r="4" fill="#b8c6a3"/><path d="m101 31 3-6 3 6 6 3-6 3-3 6-3-6-6-3Z" fill="#ccd9b8"/></svg></div></section>`;}
function topicStats(t){const a=S.attempts.filter(a=>a.topic===t && a.status==='graded');const max=a.reduce((n,a)=>n+a.maxScore,0);return {n:a.length,value:max?Math.round(100*a.reduce((n,a)=>n+a.score,0)/max):0};}
function knowledge(){return `<section class="panel right-panel"><h2>${icon('growth')}知識點練習表現</h2><p class="panel-sub">以已批閱得分呈現，不等同能力診斷</p>${(()=>{const practiced=topics.map(t=>({t,st:topicStats(t)})).filter(x=>x.st.n>0).sort((a,b)=>a.st.value-b.st.value).slice(0,4);if(!practiced.length)return `<p class="panel-sub" style="margin:0">還沒有已批閱的練習，先做幾題就會顯示你的知識點表現。</p>`;return practiced.map(({t,st})=>`<div class="knowledge-row"><span>${esc(t)}</span><span>${st.value}%</span></div><div class="progress-track"><div class="progress-fill ${st.value<60?'gold':''}" style="width:${st.value}%"></div></div>`).join('');})()}<button class="text-button" data-page="growth" style="font-size:calc(13px*var(--fs))">查看完整學習足跡 ${icon('arrow')}</button></section>`;}
function rightBank(){return `<div class="right-stack"><section class="panel right-panel"><h2>${icon('spark')}你的下一步</h2><p class="panel-sub">圍繞同一知識點，循序建立解題能力</p><div class="roadmap"><div class="roadmap-item active"><span class="roadmap-circle">1</span>理解原題</div><div class="roadmap-item"><span class="roadmap-circle">2</span>相似鞏固</div><div class="roadmap-item"><span class="roadmap-circle">3</span>進階挑戰</div></div><div class="recommendation-mini"><div class="title-row"><span>今日建議</span><span>基礎 · 6 分</span></div><strong>從因式分解開始，<br>一步一步找出二次方程的根。</strong><button class="secondary wide" data-qid="1">進入練習 ${icon('arrow')}</button></div></section>${knowledge()}<section class="panel right-panel tip-panel"><h2>${icon('bulb')}解題小提示</h2><p>寫下你的思考，而不只是答案。<br>一個清楚的推導，比一次猜對更有價值。</p><button class="text-button" data-action="hand-demo">試試手寫解題 ${icon('arrow')}</button></section></div>`;}
function filteredQuestions(){return S.questions.filter(q=>(topic==='全部題目'||q.topic===topic||topic==='我的收藏'&&bookmarks.has(q.id))&&(!subtopic||q.subtopic===subtopic)&&(!grade||q.grade===grade)&&(!level||q.level===Number(level))&&(!qtype||(q.qtype||'解答題')===qtype)&&(!search||`${q.title} ${q.content} ${q.tags.join(' ')} ${q.source} ${q.subtopic||''}`.toLowerCase().includes(search.toLowerCase())));}
function questionCard(q,n){return `<article class="question-card"><span class="question-number">${String(n).padStart(2,'0')}</span><div class="question-body"><div class="question-top"><h3>${mathText(q.title)}</h3><span class="badge l${q.level}">${levels[q.level]}</span><span class="badge outline">${esc(q.qtype||'解答題')}</span><span class="badge outline">${q.points} 分</span></div><div class="question-formula">${mathText(q.content)}</div>${optionsHtml(q)}${q.figure?`<div class="question-figure"><img src="${q.figure}" alt="題目圖形" loading="lazy"></div>`:''}<div class="question-meta"><span>${esc(q.tags.slice(0,2).join(' · '))}</span><i class="separator"></i><span>${esc(q.source)}</span></div></div><div class="question-controls"><button class="bookmark ${bookmarks.has(q.id)?'saved':''}" data-save="${q.id}" aria-label="${bookmarks.has(q.id)?'取消收藏':'收藏題目'}" aria-pressed="${bookmarks.has(q.id)}">${icon('bookmark')}</button><button class="practice-btn" data-qid="${q.id}">開始練習 ${icon('chevron')}</button></div></article>`;}
function bank(){page='bank';shell();$('#main').innerHTML=`<div class="fade-in">${heading('QUESTION BANK','數學題庫','每一道題，都是通往理解的一步。',`<button class="secondary" data-action="collection">${icon('bookmark')}我的收藏</button><button class="primary" data-page="import">${icon('upload')}匯入試卷</button>`)}${!S.user?`<div class="field-hint" style="margin:-9px 0 17px">訪客預覽 · 以下為題庫示例，學習紀錄尚未開始。<button class="text-button" data-action="login" style="font-size:calc(13px*var(--fs));margin-left:8px">登入學習 ${icon('arrow')}</button></div>`:''}${hero()}${metrics()}<div class="bank-layout"><section class="panel bank-panel"><div class="panel-heading"><h2>精選題目 <span class="small-text" id="question-count"></span></h2><div class="segmented"><button data-view="list" class="${viewMode==='list'?'active':''}" aria-label="清單檢視">${icon('list')}</button><button data-view="grid" class="${viewMode==='grid'?'active':''}" aria-label="卡片檢視">${icon('bank')}</button></div></div><div class="filters"><label class="search-field">${icon('search')}<input id="question-search" value="${esc(search)}" placeholder="搜尋題目、知識點或試卷名稱…" aria-label="搜尋题目"></label><select id="grade-filter" aria-label="年級"><option value="">所有年級</option>${grades.map(g=>`<option ${grade===g?'selected':''}>${g}</option>`).join('')}</select><select id="level-filter" aria-label="難度"><option value="">所有難度</option>${[1,2,3].map(i=>`<option value="${i}" ${Number(level)===i?'selected':''}>${levels[i]}</option>`).join('')}</select><select id="qtype-filter" aria-label="題型"><option value="">所有題型</option>${qtypes.map(t=>`<option ${qtype===t?'selected':''}>${t}</option>`).join('')}</select></div><div class="topic-tabs">${['全部題目',...topics].map(t=>`<button class="topic-tab ${topic===t?'active':''}" data-topic="${t}">${t}</button>`).join('')}</div><div class="topic-tabs subtopic-tabs" style="display:${topic!=='全部題目'&&topic!=='我的收藏'&&subtopicsOf(topic).length?'flex':'none'}">${['全部子分類',...subtopicsOf(topic)].map(sb=>`<button class="subtopic-tab ${subtopic===sb?'active':''}" data-subtopic="${sb}">${sb}</button>`).join('')}</div><div class="question-list ${viewMode}" id="question-list"></div><div class="pagination" id="pagination"></div></section>${rightBank()}</div></div>`;renderList();$('#question-search').addEventListener('input',e=>{search=e.target.value;currentPage=1;renderList();});$('#grade-filter').addEventListener('change',e=>{grade=e.target.value;currentPage=1;renderList();});$('#level-filter').addEventListener('change',e=>{level=e.target.value;currentPage=1;renderList();});$('#qtype-filter').addEventListener('change',e=>{qtype=e.target.value;currentPage=1;renderList();});}
function renderList(){const list=filteredQuestions(),size=5,total=Math.ceil(list.length/size);currentPage=Math.max(1,Math.min(currentPage,total||1));$('#question-count').textContent=`${list.length} 題${topic==='我的收藏'?' · 我的收藏':''}`;$('#question-list').innerHTML=list.length?list.slice((currentPage-1)*size,currentPage*size).map((q,i)=>questionCard(q,(currentPage-1)*size+i+1)).join(''):empty('還沒有符合的題目','試試更換分類、難度或搜尋關鍵字。');$('#pagination').innerHTML=`<span>顯示 ${list.length?(currentPage-1)*size+1:0}–${Math.min(currentPage*size,list.length)} / 共 ${list.length} 題</span><div class="pagination-buttons"><button data-pagination="${currentPage-1}" ${currentPage<=1?'disabled':''} aria-label="上一頁">‹</button>${Array.from({length:Math.min(total,7)},(_,i)=>`<button data-pagination="${i+1}" class="${currentPage===i+1?'active':''}">${i+1}</button>`).join('')}<button data-pagination="${currentPage+1}" ${currentPage>=total?'disabled':''} aria-label="下一頁">›</button></div>`;}
function requireLogin(fn){if(S.user){fn();return true;}loginModal(fn);return false;}
function modal(html,large=false,dismiss=true){$('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal ${large?'large':''}" role="dialog" aria-modal="true" tabindex="-1">${dismiss?`<button class="icon-btn modal-close" data-action="close-modal" aria-label="關閉">×</button>`:''}${html}</section></div>`;$('.modal').focus();const prev=document.activeElement;const trap=e=>{if(e.key==='Escape'&&dismiss)closeModal();if(e.key==='Tab'){const focusable=$$('button:not(:disabled),input,textarea,select,a[href]', $('.modal'));if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}}};$('#modal-root').onkeydown=trap;}
function closeModal(){$('#modal-root').innerHTML='';$('#modal-root').onkeydown=null;}
function loginModal(after){const lastUser=(()=>{try{return localStorage.getItem('mathpath_last_user')||''}catch(_){return ''}})();modal(`<div class="login-brand"><span class="brand-symbol">m<span>↗</span></span>MathPath</div><h2>登入學習空間</h2><p class="modal-intro">先選擇身分，再輸入密碼。系統會記住你的帳戶，下次開啟不必重新輸入。</p><div class="role-cards"><button type="button" data-role="student" class="role-card active"><span class="role-card-icon">${icon('practice')}</span><strong>學生</strong><small>領取作業、手寫或打字解題、查看自己的分數與建議</small></button><button type="button" data-role="teacher" class="role-card"><span class="role-card-icon">${icon('import')}</span><strong>教師</strong><small>佈置作業與測驗、批閱、查看全班成績</small></button></div><form id="login-form"><div class="form-field"><label class="field-label" for="username">校內帳戶</label><input id="username" name="username" autocomplete="username" value="${esc(lastUser||'student')}" required maxlength="64">${lastUser?`<p class="field-hint login-remembered">已記住上次登入的帳戶：<strong>${esc(lastUser)}</strong></p>`:''}</div><div class="form-field"><label class="field-label" for="password">密碼</label><input id="password" type="password" name="password" autocomplete="current-password" placeholder="輸入帳戶密碼" required maxlength="256"></div><label class="checkbox-line remember-line login-remember"><input type="checkbox" id="remember" checked><span><strong>記住我（30 天）</strong><small>下次開啟不必重新登入；公用電腦請取消勾選。</small></span></label><p class="error-text" id="login-error"></p><button type="submit" class="primary wide login-submit">登入學習空間 ${icon('arrow')}</button></form><div class="demo-accounts">本地演示帳戶<br>學生：student / Math1234!<br>教師：teacher / Teach1234!<br>校內正式使用前，請先更換演示密碼。</div>`);$$('[data-role]').forEach(b=>b.onclick=()=>{$$('[data-role]').forEach(x=>x.classList.toggle('active',x===b));$('#username').value=b.dataset.role;$('#password').value='';$('#password').focus();});$$('[data-role]').forEach(x=>x.classList.toggle('active',x.dataset.role===(lastUser==='teacher'?'teacher':'student')));$('#login-form').onsubmit=async e=>{e.preventDefault();const btn=$('button[type="submit"]',e.target);btn.disabled=true;$('#login-error').textContent='';const uname=$('#username').value;try{await api('/api/login',{username:uname,password:$('#password').value,remember:$('#remember').checked});try{localStorage.setItem('mathpath_last_user',uname);}catch(_){}await refresh();closeModal();toast('已登入，本地學習紀錄已準備就緒。');if(after)after();else navigate(page);}catch(err){$('#login-error').textContent=err.message;}finally{btn.disabled=false;}};}
function accountModal(){if(!S.user)return loginModal();modal(`<h2>${esc(S.user.name)}</h2><p class="modal-intro">${S.user.role==='teacher'?'教師工作空間':'中三數學學習空間'} · 帳戶資料保存在本地伺服器</p>${S.notice?`<div class="import-warning">${esc(S.notice)}</div>`:''}<div class="result-actions"><button class="secondary" id="password-link">${icon('lock')}更換密碼</button><button class="secondary" id="logout-btn">${icon('logout')}登出</button></div>`);$('#password-link').onclick=()=>{closeModal();navigate('settings');};$('#logout-btn').onclick=async()=>{stopQuizClock();try{await api('/api/logout',{});clearUserDrafts(S.user.id);S={user:null,questions:preview,attempts:[],stats:{completed:0,accuracy:0,streak:0,minutes:0},ai:{configured:false,mode:'off'}};strokes=[];answerFile=null;lastResult=null;lastSolution=null;currentQuestion=null;assignmentContext=null;assignmentDetail=null;HW=null;resultData=null;closeModal();loadBookmarks();homeworkPage();toast('已登出。');}catch(e){toast(e.message);}};}
async function openQuestion(id){if(busy)return toast('正在保存作答，請等待完成。');preserveDraft();if(!S.user){loginModal(()=>openQuestion(id));return;}const q=S.questions.find(q=>q.id===Number(id));if(!q)return toast('找不到題目，請重新整理題庫。');if(currentQuestion&&currentQuestion.id!==q.id&&strokes.length&&!lastResult&&!confirm('目前手寫內容尚未提交，確定切換題目？'))return;assignmentContext=null;mockContext=null;currentQuestion=q;lastResult=null;lastSolution=null;answerMode=(q.options&&q.options.length)?'choice':'hand';answerFile=null;selectedOption=null;window.answerTextDraft='';strokes=[];redoStrokes=[];recommendations=null;practice();try{const rec=await api(`/api/questions/${q.id}/recommendations`);if(currentQuestion?.id===q.id){recommendations=rec;renderRecommendations();}}catch(e){toast(e.message);}}
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
  page='practice';shell();
  $('#main').innerHTML=`<div class="fade-in">${heading('FOCUSED PRACTICE','自主練習','先選章節與題型，再一次練一類題；每題由 AI 即時評分並記錄分數。')}${practicePickerHtml()}</div>`;
  bindPracticePicker();
}
function practice(){if(!S.user){return requireLogin(()=>practice());}if(!currentQuestion)return practicePicker();page='practice';shell();const q=currentQuestion;$('#main').innerHTML=`<div class="fade-in">${heading(mockContext?'MOCK EXAM':assignmentContext?'ASSIGNMENT PRACTICE':'FOCUSED PRACTICE',mockContext?'模擬測驗作答':assignmentContext?'作業解題':'自主練習',mockContext?esc(mockContext.title)+' · 本次作答計入模擬測驗':assignmentContext?esc(assignmentContext.title)+' · 此次保存將計入本份作業':'慢一點思考，清楚寫下每一步。理解，比速度更重要。')}${quizClockBadge()}${mockContext?`<button class="text-button back-button" data-mock="${mockContext.id}">${icon('back')}返回模擬測驗</button>`:assignmentContext?`<button class="text-button back-button" data-assignment="${assignmentContext.id}">${icon('back')}返回本份作業</button>`:`<button class="text-button back-button" data-page="bank">${icon('back')}返回題庫</button><button class="text-button back-button" id="change-range">${icon('practice')}換練習範圍</button>`}<div class="practice-layout"><section class="panel practice-panel"><div class="practice-question"><div class="question-top"><span class="badge">${q.grade} · ${esc(q.topic)}${q.subtopic?' · '+esc(q.subtopic):''}</span><span class="badge l${q.level}">${levels[q.level]}</span><span class="badge outline">${esc(q.qtype||'解答題')}</span><span class="badge outline">${q.points} 分</span><button class="bookmark ${bookmarks.has(q.id)?'saved':''}" style="margin-left:auto" data-save="${q.id}" aria-label="收藏題目">${icon('bookmark')}</button></div><h2>${mathText(q.title)}</h2><div class="question-formula">${mathText(q.content)}</div>${q.figure?`<div class="question-figure"><img src="${q.figure}" alt="題目圖形" loading="lazy"></div>`:''}<div class="question-meta">${esc(q.tags.join(' · '))}<i class="separator"></i>${esc(q.source)}</div></div><div class="section-head"><h2 style="font-size:calc(16px*var(--fs))">你的解題過程</h2><button class="text-button" id="hint-btn" style="font-size:calc(14px*var(--fs))">${icon('bulb')}給我一點提示</button></div><div id="hint-root"></div>${(()=>{const modes=practiceModes(q);if(modes.length<2)return '';return `<div class="practice-tabs">${modes.map(([id,ic,t])=>`<button data-answer-mode="${id}" class="${answerMode===id?'active':''}">${icon(ic)}${t}</button>`).join('')}</div>`;})()}<div id="answer-area"></div><div class="form-field">${mathKeyboardHtml()}<label class="field-label" for="final-answer">最終答案 <span class="small-text">· 文字作答必填，手寫作答可選填</span></label><input class="answer-field" id="final-answer" placeholder="例如：x=2 或 x=3，或按上方數學鍵盤輸入" maxlength="4000"><div class="math-preview" id="final-answer-preview" hidden></div></div>${aiGradingHtml()}${(aiGradedNow()&&S.ai.mode==='external')?`<label class="checkbox-line"><input type="checkbox" id="consent-ai">我同意將本題、作答及最多5次本人同知識點已評紀錄，傳送至學校配置的外部 AI 作批改與學習建議。</label>`:''}<div class="submit-row"><span class="small-text" id="draft-status">本分頁草稿暫存 · 提交後才保存至伺服器</span><button class="primary" id="submit-answer">${icon('check')}${submitLabel()}</button></div><div id="result-root"></div></section><div class="right-stack"><section class="panel right-panel"><h2>${icon('spark')}從一道題，到一類題</h2><p class="panel-sub">先鞏固相同解法，再挑戰更深的思考</p><div id="recommendations">${empty('正在找題','從校本題庫尋找同知識點練習')}</div></section><section class="panel right-panel tip-panel"><h2>${icon('bulb')}解題習慣</h2><p>① 先理解題目要找甚麼。<br>② 選擇方法，寫下理由。<br>③ 代回原題，檢查結果。<br><br>手寫評閱需要能辨認完整步驟；請保持字跡清楚。</p></section></div></div></div>`;renderAnswerArea();bindMathKeyboard();$('#hint-btn').onclick=()=>{$('#hint-root').innerHTML=`<div class="hint-box">${mathText(q.hint||'先圈出已知條件，再想想與哪一個知識點有關。')}</div>`;};$('#submit-answer').onclick=submitAnswer;const rangeBtn=$('#change-range');if(rangeBtn)rangeBtn.onclick=()=>{if(strokes.length&&!lastResult&&!confirm('目前手寫內容尚未提交，確定離開這一題？'))return;preserveDraft();currentQuestion=null;strokes=[];redoStrokes=[];lastResult=null;lastSolution=null;practicePicker();};restoreDraft();renderRecommendations();}
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
function mathKeyboardHtml(){
  const tabs = MATH_KEYBOARD.map(([id,label],i)=>
    `<button type="button" class="mk-tab ${i===0?'active':''}" data-mk-tab="${id}">${esc(label)}</button>`).join('');
  const panels = MATH_KEYBOARD.map(([id,label,keys],i)=>
    `<div class="mk-panel" data-mk-panel="${id}"${i===0?'':' hidden'}>${keys.map(([tex,text])=>
      `<button type="button" class="mk-key" data-mk-insert="${esc(tex)}" title="${esc(tex)}">${esc(text)}</button>`).join('')}</div>`).join('');
  return `<div class="math-keyboard" id="math-keyboard" hidden><div class="mk-head">${icon('practice')}<span class="mk-title">數學鍵盤</span><span class="small-text">點按插入符號，可在輸入框直接修改</span></div><div class="mk-tabs">${tabs}</div>${panels}</div>`;
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
function syncMathKeyboard(){
  const keyboard=$('#math-keyboard');
  if(!keyboard) return;
  // 數學鍵盤只在文字作答出現；排版預覽只要輸入框有內容就顯示（任何作答模式）。
  keyboard.hidden = answerMode !== 'text';
  updateMathPreview();
}
function bindMathKeyboard(){
  const keyboard=$('#math-keyboard');
  if(!keyboard) return;
  const input=$('#final-answer');
  if(input) input.addEventListener('input', updateMathPreview);
  keyboard.querySelectorAll('[data-mk-tab]').forEach(tab=>{
    tab.onclick=()=>{
      keyboard.querySelectorAll('[data-mk-tab]').forEach(other=>other.classList.toggle('active', other===tab));
      keyboard.querySelectorAll('[data-mk-panel]').forEach(panel=>{
        panel.hidden = panel.dataset.mkPanel !== tab.dataset.mkTab;
      });
    };
  });
  keyboard.querySelectorAll('[data-mk-insert]').forEach(key=>{
    key.onclick=()=>insertMathSnippet(key.dataset.mkInsert);
  });
  syncMathKeyboard();
}
function renderAnswerArea(){ensureAnswerMode();renderAnswerAreaInner();syncMathKeyboard();}
function renderAnswerAreaInner(){const area=$('#answer-area');if(!area)return;if(answerMode==='choice'){const opts=(currentQuestion&&currentQuestion.options)||[];area.innerHTML=`<label class="field-label">點選你的答案</label><div class="choice-picker" id="choice-picker">${opts.map((o,j)=>{const L=OPTION_LETTERS[j];return `<button type="button" class="choice-option ${selectedOption===L?'selected':''}" data-choice="${L}" aria-pressed="${selectedOption===L}"><span class="option-letter">${L}</span><span class="option-text">${mathText(o)}</span></button>`;}).join('')}</div><p class="field-hint">點選一項即完成作答；提交後會即時核對答案。</p>`;$$('[data-choice]').forEach(b=>b.addEventListener('click',()=>{selectedOption=b.dataset.choice;$('#final-answer').value=selectedOption;lastResult=null;renderAnswerArea();scheduleDraft();}));return;}if(answerMode==='hand'){area.innerHTML=`<div class="writing-toolbar"><div class="tool-group"><button class="icon-btn active" id="pen-btn" aria-label="畫筆">${icon('practice')}</button><button class="icon-btn" id="eraser-btn" aria-label="橡皮擦">${icon('eraser')}</button><span style="height:20px;border-right:1px solid var(--border);margin:0 4px"></span>${['#274b3b','#456bab','#b96c5d'].map(c=>`<button class="pen-color ${c===penColor?'selected':''}" style="background:${c}" data-color="${c}" aria-label="${c==='#274b3b'?'深綠':c==='#456bab'?'藍':'紅'}色畫筆"></button>`).join('')}<button class="icon-btn" id="undo-btn" aria-label="撤銷一筆">${icon('undo')}</button><button class="icon-btn" id="clear-btn" aria-label="清空畫布">${icon('trash')}</button></div><span class="small-text">觸控筆 / 滑鼠皆可</span></div><div class="canvas-wrap"><canvas id="hand-canvas" width="1200" height="700" aria-label="手寫解題畫布"></canvas><div class="canvas-placeholder" id="canvas-placeholder">在這裡寫下你的思考…</div></div><p class="field-hint">提示：先寫出算式，再補上推導。切換文字模式不會清除手寫內容。</p>`;initCanvas();$('#pen-btn').onclick=()=>setEraser(false);$('#eraser-btn').onclick=()=>setEraser(true);$('#undo-btn').onclick=()=>{if(strokes.length)redoStrokes.push(strokes.pop());drawCanvas();lastResult=null;scheduleDraft();};$('#clear-btn').onclick=()=>{if(!strokes.length)return;if(confirm('清空尚未提交的手寫內容？此動作無法復原。')){strokes=[];redoStrokes=[];drawCanvas();lastResult=null;scheduleDraft();}};$$('[data-color]').forEach(b=>b.onclick=()=>{penColor=b.dataset.color;setEraser(false);$$('[data-color]').forEach(x=>x.classList.toggle('selected',x===b));});}else if(answerMode==='text'){area.innerHTML=`<p class="field-hint">${icon('practice')}用下方數學鍵盤輸入數學式（例如分數、根號、次方），也可直接打字；輸入框下方會即時顯示排版結果。純文字作答（如 5 cm）同樣可以。</p>`;}else{area.innerHTML=`<label class="upload-answer" id="answer-drop">${answerFile?`<img src="${answerFile}" alt="待提交的手寫解題">`:`${icon('image')}<strong>上傳紙上的解題過程</strong><small>PNG / JPG，最多 10 MB；請保持完整、清晰</small>`}<input id="answer-upload" type="file" accept="image/png,image/jpeg" hidden></label>`;$('#answer-upload').onchange=async e=>{try{answerFile=await fileData(e.target.files[0],['image/png','image/jpeg']);lastResult=null;renderAnswerArea();scheduleDraft();}catch(err){toast(err.message);}};}}
function setEraser(value){eraser=value;$('#pen-btn')?.classList.toggle('active',!value);$('#eraser-btn')?.classList.toggle('active',value);}
function initCanvas(){const c=$('#hand-canvas');function pos(e){const r=c.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width*c.width,y:(e.clientY-r.top)/r.height*c.height,p:e.pressure||.5};}c.onpointerdown=e=>{if(e.button!==0&&e.pointerType==='mouse')return;e.preventDefault();c.setPointerCapture(e.pointerId);activeStroke={color:penColor,erase:eraser,points:[pos(e)]};strokes.push(activeStroke);redoStrokes=[];drawCanvas();};c.onpointermove=e=>{if(!activeStroke)return;e.preventDefault();activeStroke.points.push(pos(e));drawCanvas();};c.onpointerup=c.onpointercancel=c.onlostpointercapture=()=>{activeStroke=null;lastResult=null;scheduleDraft();};drawCanvas();}
function drawCanvas(){const c=$('#hand-canvas');if(!c)return;const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);for(const s of strokes){ctx.globalCompositeOperation=s.erase?'destination-out':'source-over';ctx.strokeStyle=s.color;ctx.fillStyle=s.color;ctx.lineWidth=s.erase?36:4;ctx.lineCap='round';ctx.lineJoin='round';if(s.points.length===1){const p=s.points[0];ctx.beginPath();ctx.arc(p.x,p.y,s.erase?18:2,0,Math.PI*2);ctx.fill();}else{ctx.beginPath();s.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();}}ctx.globalCompositeOperation='source-over';$('#canvas-placeholder').hidden=strokes.length>0;}
// 手寫圖、題目圖形與教師批註改用 WebP（實測比 PNG 小約三成；JPEG 對線條圖反而更大，故不採用）。
// 瀏覽器不支援 WebP 編碼時（部分較舊的 Safari）自動退回 PNG，功能不受影響。
let webpSupported=null;
function supportsWebp(){if(webpSupported===null){try{const probe=document.createElement('canvas');probe.width=probe.height=1;webpSupported=probe.toDataURL('image/webp').startsWith('data:image/webp');}catch{webpSupported=false;}}return webpSupported;}
function imageDataUrl(canvas){return supportsWebp()?canvas.toDataURL('image/webp',0.8):canvas.toDataURL('image/png');}
function canvasImage(){const c=$('#hand-canvas'),out=document.createElement('canvas');out.width=c.width;out.height=c.height;const ctx=out.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(c,0,0);return imageDataUrl(out);}
async function submitAnswer(){if(busy)return;const btn=$('#submit-answer');const final=$('#final-answer').value.trim();const process=answerMode==='text'?(($('#answer-process')?.value||'').trim()):'';const body={questionId:currentQuestion.id,answerText:process?(process+(final?'\n最終答案：'+final:'')):final,consentExternal:!!$('#consent-ai')?.checked};if(assignmentContext)body.assignmentId=assignmentContext.id;if(mockContext)body.mockId=mockContext.id;if(answerMode==='hand'&&strokes.some(s=>!s.erase))body.image=canvasImage();if(answerMode==='upload'&&answerFile)body.image=answerFile;if(!body.answerText&&!body.image)return toast('請先寫下答案或上傳手寫作答。');if(aiGradedNow()&&S.ai.mode==='external'&&!body.consentExternal)return toast(assignmentContext?'本份作業由教師設定使用外部 AI 評分，請先確認資料傳送同意。':'自主練習會把本題與作答傳送至外部 AI 即時評分，請先確認資料傳送同意。');busy=true;btn.disabled=true;btn.innerHTML=icon('clock')+(aiGradedNow()?'正在保存與評分…':'正在保存…');try{const {attempt,solution}=await api('/api/attempts',body);clearCurrentDraft();lastResult=attempt;lastSolution=solution||null;await refresh();renderResult();toast(attempt.status==='pending'?'作答已保存，等待教師批閱。':assignmentContext?'作答與批閱結果已保存。':'作答與即時評分已記錄。');$('#result-root').scrollIntoView({behavior:'smooth',block:'nearest'});}catch(e){toast(e.message);$('#result-root').innerHTML=`<div class="inline-error">${esc(e.message)}<br>${assignmentContext?'你的內容仍保留在頁面，可稍後重試；若持續失敗，教師仍可直接批閱你的作答。':'你的內容仍保留在頁面，可稍後重試；也可以按「給我一點提示」先自行核對。'}</div>`;}finally{busy=false;btn.disabled=false;btn.innerHTML=icon('check')+'再次提交作答';}}
function renderResult(){if(!lastResult||!$('#result-root'))return;const a=lastResult;if(a.awaitingReview){$('#result-root').innerHTML=`<div class="result pending"><div class="result-title">${icon('clock')}已提交，等待教師批閱</div><p>作答已保存。教師批閱後，你才會看到分數、AI 批閱結果、參考答案與學習建議。</p></div>`;return;}$('#result-root').innerHTML=`<div class="result ${a.status==='pending'?'pending':''}"><div class="result-title">${icon(a.status==='pending'?'clock':'check')}${a.status==='pending'?'已保存，等待批閱':a.gradingMethod==='rule-final'?'最終答案核對':a.gradingMethod==='ai-practice'?'AI 即時評分':a.teacherReviewed?'教師批閱':'AI 建議批閱'}${a.status==='graded'?`<span class="result-score">${a.score}<small> / ${a.maxScore}</small></span>`:''}</div><p>${mathText(a.feedback).replace(/\n/g,'<br>')}</p>${(a.steps||[]).map(s=>`<div class="result-step"><div><strong>${mathText(s.label)}</strong><p>${mathText(s.comment)}</p></div><span>${s.earned} / ${s.max}</span></div>`).join('')}${lastSolution&&(lastSolution.answer||(lastSolution.steps||[]).length||lastSolution.analysis||(lastSolution.rubric||[]).length)?`<details class="solution-box"><summary>${icon('bulb')}參考答案與詳解</summary>${lastSolution.answer?`<p class="solution-answer"><strong>參考答案：</strong>${mathText(lastSolution.answer)}</p>`:''}${(lastSolution.steps||[]).length?`<ol class="solution-steps">${lastSolution.steps.map(x=>`<li>${mathText(x)}</li>`).join('')}</ol>`:''}${lastSolution.analysis?`<p class="solution-analysis">${mathText(lastSolution.analysis)}</p>`:''}${rubricListHtml(lastSolution.rubric,a.maxScore)}</details>`:''}${suggestionCard(a.suggestion)}<div class="result-actions">${mockContext?`<button class="secondary" data-mock="${mockContext.id}">返回模擬測驗 ${icon('arrow')}</button>`:assignmentContext?`<button class="secondary" data-assignment="${assignmentContext.id}">返回作業，繼續下一題 ${icon('arrow')}</button>`:''}<button class="secondary" id="next-similar">相似題鞏固 ${icon('arrow')}</button><button class="secondary" data-page="mistakes">查看作答紀錄</button></div></div>`;$('#next-similar').onclick=()=>{const q=recommendations?.similar?.[0];if(q)openQuestion(q.id);else toast('此題目前沒有同難度的相似題，請選擇其他知識點練習。');};}
function renderRecommendations(){const r=$('#recommendations');if(!r)return;if(!recommendations){r.innerHTML='<p class="field-hint">正在讀取同知識點題目…</p>';return;}r.innerHTML=`<div class="recommend-label">02 · 相似題鞏固</div><div class="recommend-list">${recommendations.similar.length?recommendations.similar.map(q=>`<button data-qid="${q.id}"><strong>${mathText(q.title)}</strong><small>${levels[q.level]} · ${q.points} 分 · 題庫精選</small></button>`).join(''):'<p class="field-hint">暫無同難度的相似題。</p>'}</div><div class="recommend-label">03 · 進階挑戰</div><div class="recommend-list">${recommendations.advanced.length?recommendations.advanced.map(q=>`<button data-qid="${q.id}"><strong>${mathText(q.title)}</strong><small>${levels[q.level]} · ${q.points} 分 · 題庫精選</small></button>`).join(''):'<p class="field-hint">已達此知識點的目前最高難度。</p>'}</div><div style="border-top:1px solid var(--border);margin-top:18px;padding-top:14px"><p class="field-hint">${S.ai.configured?'AI 可按本题生成新題，內容須教師核驗。':'目前使用題庫推薦；接入 AI 後可生成全新變式題。'}</p><button class="text-button" data-generate="similar" style="font-size:calc(13px*var(--fs))">${icon('spark')}AI 生成相似題</button><button class="text-button" data-generate="advanced" style="font-size:calc(13px*var(--fs));margin-top:8px;display:flex">${icon('spark')}AI 生成進階題</button></div>`;}
async function generateQuestion(kind){if(!S.ai.configured)return toast('AI 尚未接入。請在「設定與隱私」查看管理員配置說明。');if(S.ai.mode==='external'&&!confirm('生成新題會將原題（不含學生作答）傳送至學校配置的外部 AI，是否繼續？'))return;const b=$(`[data-generate="${kind}"]`);b.disabled=true;b.textContent='正在生成，請稍候…';try{const {question}=await api(`/api/questions/${currentQuestion.id}/generate`,{kind,consentExternal:S.ai.mode==='external'});await refresh();toast('新題已保存並標示待教師核驗。');openQuestion(question.id);}catch(e){toast(e.message);renderRecommendations();}}
async function fileData(file,allowed){if(!file)throw new Error('請先選擇檔案。');if(!allowed.includes(file.type))throw new Error('不支援此檔案類型，請選擇 PDF、PNG 或 JPG。');if(file.size>10*1024*1024)throw new Error('檔案不可超過 10 MB。');return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('檔案讀取失敗。'));r.readAsDataURL(file);});}
function figureDataUrl(){const c=$('#figure-canvas');return c?imageDataUrl(c):'';}
function drawFigure(){const c=$('#figure-canvas');if(!c)return;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.strokeStyle='#e2ece6';ctx.lineWidth=1;for(let x=30;x<c.width;x+=30){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,c.height);ctx.stroke();}for(let y=30;y<c.height;y+=30){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(c.width,y);ctx.stroke();}ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#1d3b32';ctx.lineWidth=4;for(const st of figStrokes){if(!st.points||st.points.length<2)continue;ctx.beginPath();ctx.moveTo(st.points[0].x,st.points[0].y);for(const pt of st.points.slice(1))ctx.lineTo(pt.x,pt.y);ctx.stroke();}}
function setFigTool(tool){figTool=tool;$$('[data-fig-tool]').forEach(b=>b.classList.toggle('active',b.dataset.figTool===tool));}
function initFigureCanvas(){const c=$('#figure-canvas');if(!c)return;drawFigure();const pos=e=>{const r=c.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*c.width,y:(e.clientY-r.top)/r.height*c.height};};
$$('[data-fig-tool]').forEach(b=>b.onclick=()=>setFigTool(b.dataset.figTool));
c.onpointerdown=e=>{if(!e.isPrimary&&e.pointerType!=='mouse')return;e.preventDefault();const pt=pos(e);figDrawing={type:figTool,points:[pt]};if(figTool==='pen')figStrokes.push(figDrawing);try{c.setPointerCapture(e.pointerId);}catch(_){}};
c.onpointermove=e=>{if(!figDrawing)return;const pt=pos(e);figDrawing.points.push(pt);if(figDrawing.type==='pen')drawFigure();};
c.onpointerup=c.onpointercancel=()=>{if(!figDrawing)return;const d=figDrawing;figDrawing=null;if(d.type==='eraser'){const pts=d.points;figStrokes=figStrokes.filter(st=>!(st.points||[]).some(q=>pts.some(p=>Math.hypot(p.x-q.x,p.y-q.y)<26)));}drawFigure();const st=$('#fig-status');if(st)st.textContent=figStrokes.length?'已繪製圖形，會與題目一併儲存。':'圖形已清空；不畫圖也可直接加入題目。';};
const undo=$('#fig-undo'),clear=$('#fig-clear');
if(undo)undo.onclick=()=>{if(!figStrokes.length)return toast('沒有可撤銷的線條。');figStrokes.pop();drawFigure();};
if(clear)clear.onclick=()=>{if(!figStrokes.length)return;figStrokes=[];drawFigure();$('#fig-status').textContent='圖形已清空；不畫圖也可直接加入題目。';};}
function importPage(){page='import';shell();if(!S.user)return loginModal(importPage);if(S.user.role!=='teacher'){$('#main').innerHTML=heading('TEACHER WORKSPACE','試卷拆題','把一份試卷，變成可持續練習的知識庫。')+`<section class="panel">${empty('試卷匯入只限教師','學生可在題庫開始練習；教師可拆題、核驗及匯入新題。',`<button class="primary" data-page="bank">前往數學題庫 ${icon('arrow')}</button>`)}</section>`;return;}
$('#main').innerHTML=`<div class="fade-in">${heading('PAPER TO PRACTICE','試卷拆題','匯入試卷，自動分割題目與分類；確認後，建立校本題庫。')}<div class="import-layout"><section class="panel import-panel"><div class="stepper">${[[1,'匯入試卷'],[2,'拆題與核驗'],[3,'確認入庫']].map(([n,t])=>`<div class="step ${importStage===n?'active':''}"><span>${n}</span>${t}</div>`).join('')}</div><div id="import-content"></div></section><div class="right-stack"><section class="panel right-panel"><h2>${icon('file')}從試卷到學習路徑</h2><ul class="feature-list"><li><strong>${icon('import')}拆分獨立題目</strong>按題號辨識主題，子題保留在原題內；先預覽再匯入。</li><li><strong>${icon('bank')}建立知識分類</strong>分類、難度與參考答案均可修改，教師保有最後決定權。</li><li><strong>${icon('spark')}鞏固與加深</strong>同知識點題庫推薦，AI 接入後可生成變式與進階題。</li></ul></section><section class="panel right-panel tip-panel"><h2>${icon('lock')}資料與辨識說明</h2><p>文字型 PDF 可直接提取。<br>掃描卷與照片需接入視覺 AI；未接入時請貼上題目文字。<br><br>辨識、分類及 AI 答案皆需教師核验，不能直接作正式評核。</p></section></div></div></div>`;renderImportContent();}
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
async function aiFillManual(btn){
  const content = $('#manual-content').value.trim();
  if(!content) return toast('請先填寫題目內容，AI 才能生成答案。');
  if(!S.ai.configured) return toast('AI 尚未設定：請先設定模型端點，或手動填寫答案。');
  if(!aiConfirmExternal()) return;
  const qtype = $('#manual-qtype').value;
  const old = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = icon('clock') + 'AI 生成中…';
  try{
    const r = await aiGenerateForQuestion({title:$('#manual-title').value.trim(), content, qtype,
      options: qtype==='選擇題' ? manualOptions.map(o=>String(o||'').trim()).filter(Boolean) : [],
      points: Number($('#manual-points').value)||5,
      topic: $('#manual-topic').value, subtopic: $('#manual-subtopic').value}, true);
    if(r.answer) $('#manual-answer').value = r.answer;
    $('#manual-steps').value = (r.steps||[]).join('\n');
    $('#manual-analysis').value = r.analysis || '';
    if(qtype==='選擇題' && (r.options||[]).length && !manualOptions.filter(Boolean).length){
      manualOptions.length = 0; r.options.forEach(o=>manualOptions.push(o)); renderManualOptions();
    }
    const store = rubricStores.get('manual');
    const items = store ? store.items : null;
    if(items){ items.length = 0; (r.rubric||[]).forEach(x=>items.push(x)); }
    rubricRender('manual');
    toast('AI 已生成答案、詳解、詳細解釋與評分標準，請核驗後加入題目。');
  }catch(e){ toast(e.message); }
  finally{ btn.disabled = false; btn.innerHTML = old; }
}

// 手動輸入的選項編輯（僅選擇題）
let manualOptions=[];
let manualRubric=[];
function renderManualOptions(){
  const box=$('#manual-options');if(!box)return;
  box.innerHTML=manualOptions.map((o,j)=>`<div class="option-row"><span class="option-letter">${OPTION_LETTERS[j]}</span><input value="${esc(o)}" maxlength="600" data-manual-option="${j}" placeholder="選項 ${OPTION_LETTERS[j]}"><button type="button" class="icon-btn" data-manual-drop="${j}" aria-label="刪除選項 ${OPTION_LETTERS[j]}">${icon('trash')}</button></div>`).join('');
  const pv=$('#manual-options-preview');if(pv)pv.innerHTML=optionsPreviewHtml(manualOptions);
  box.querySelectorAll('[data-manual-option]').forEach(inp=>inp.addEventListener('input',e=>{
    manualOptions[Number(e.target.dataset.manualOption)]=e.target.value;
    const p=$('#manual-options-preview');if(p)p.innerHTML=optionsPreviewHtml(manualOptions);
  }));
  box.querySelectorAll('[data-manual-drop]').forEach(b=>b.addEventListener('click',()=>{
    manualOptions.splice(Number(b.dataset.manualDrop),1);renderManualOptions();
  }));
}

function renderImportContent(){const r=$('#import-content');if(importStage===1){r.innerHTML=`<div class="form-field"><label class="field-label" for="paper-name">試卷名稱</label><input id="paper-name" value="${esc(paperName)}" placeholder="例如：中三數學 · 第一學期測驗" maxlength="200"></div><label class="dropzone" id="paper-drop">${icon('upload')}<strong id="paper-filename">${paperFile?esc(paperFile.name):'點擊或拖入試卷檔案'}</strong><small>文字型 PDF / PNG / JPG · 最多 10 MB</small><input type="file" id="paper-upload" accept="application/pdf,image/png,image/jpeg" hidden></label><div class="divider-text"><span>或直接貼上題目文字</span></div><label class="field-label" for="paper-text">試卷內容<span class="small-text" style="font-weight:400">　數學式可用 LaTeX：$x^2-5x+6=0$、$\\frac{1}{2}$、$\\sqrt{3}$</span></label><textarea class="answer-field import-text" id="paper-text" placeholder="1. 解方程 $x^2-5x+6=0$。\n\n2. 直角三角形兩邊長為 $3\\text{cm}$ 及 $4\\text{cm}$，求斜邊長。\n\n3. 擲一枚公平骰子，求點數大於 4 的概率。" maxlength="79000">${esc(paperText)}</textarea><button class="text-button" id="sample-paper" style="font-size:calc(14px*var(--fs));margin-top:12px">填入示例試卷 ${icon('arrow')}</button>${S.ai.mode==='external'?`<label class="checkbox-line"><input type="checkbox" id="paper-consent">允許將試卷傳送到學校配置的外部 AI（未同意時，文字只用本地規則處理）</label>`:''}<div id="parse-error"></div><div class="submit-row"><span class="small-text">${S.ai.configured?'可用 AI 識別，仍需核驗':'本地規則拆題 · 分類結果需核驗'}</span><div class="row-actions"><button class="secondary" id="parse-paper">先拆分預覽 ${icon('spark')}</button><button class="primary" id="auto-import-paper">全自動拆分並匯入 ${icon('check')}</button></div></div><div class="divider-text"><span>或手動輸入題目並繪製圖形</span></div><div class="manual-entry"><div class="form-grid"><div class="form-field"><label class="field-label" for="manual-title">題目標題</label><input id="manual-title" maxlength="200" placeholder="例如：直角三角形求斜邊"></div><div class="form-field"><label class="field-label" for="manual-topic">知識分類</label><select id="manual-topic">${topics.map(t=>`<option>${t}</option>`).join('')}</select></div><div class="form-field"><label class="field-label" for="manual-subtopic">子分類</label><select id="manual-subtopic"></select></div><div class="form-field"><label class="field-label" for="manual-grade">年級</label><select id="manual-grade">${grades.map(g=>`<option${g==='中三'?' selected':''}>${g}</option>`).join('')}</select></div><div class="form-field"><label class="field-label" for="manual-level">難度</label><select id="manual-level">${[1,2,3].map(n=>`<option value="${n}">${levels[n]}</option>`).join('')}</select></div><div class="form-field"><label class="field-label" for="manual-qtype">題型</label><select id="manual-qtype">${qtypes.map(t=>`<option>${t}</option>`).join('')}</select></div><div class="form-field"><label class="field-label" for="manual-points">分值</label><input id="manual-points" type="number" min="1" max="100" value="5"></div></div><div class="form-field"><label class="field-label" for="manual-content">題目內容</label><textarea class="answer-field import-text" id="manual-content" maxlength="79000" placeholder="例如：直角三角形兩條直角邊長為 3 cm 和 4 cm，求斜邊長。"></textarea></div><div class="form-field" id="manual-options-field" style="display:none"><label class="field-label">選項（選擇題 · 可增刪修改）<span class="small-text" style="font-weight:400">　2 至 10 個，學生作答時可直接點選</span></label><div class="option-list" id="manual-options"></div><div class="option-actions"><button type="button" class="text-button" id="manual-add-option">＋ 新增選項</button></div><div class="math-preview" id="manual-options-preview"></div></div><div class="form-grid"><div class="form-field"><label class="field-label" for="manual-answer">參考答案（可留空）</label><input id="manual-answer" maxlength="4000" placeholder="例如：5 cm"></div><div class="form-field"><label class="field-label" for="manual-hint">解題提示</label><input id="manual-hint" maxlength="4000" placeholder="例如：用畢氏定理"></div></div><div class="form-field"><label class="field-label" for="manual-steps">詳解步驟（每行一步）<span class="small-text" style="font-weight:400">　支援 LaTeX：$x^2-5x+6=0$</span></label><textarea class="answer-field import-text" id="manual-steps" maxlength="40000" placeholder="第一步：設未知數…&#10;第二步：列式…&#10;第三步：求解並檢查…"></textarea></div><div class="form-field"><label class="field-label" for="manual-analysis">詳細解釋（考點 · 解題思路 · 常見錯誤）</label><textarea class="answer-field import-text" id="manual-analysis" maxlength="6000" placeholder="說明本題考什麼、解題關鍵與容易出錯的地方。"></textarea></div><div class="form-field">${rubricEditorHtml('manual', [])}</div><div class="ai-answer-row"><button type="button" class="secondary" id="manual-ai-answer">${icon('spark')}AI 生成答案與評分標準</button><span class="small-text">依題目內容自動產生答案、詳解、詳細解釋與評分標準百分比（可再修改）</span></div><div class="form-field"><label class="field-label">題目圖形（可選）</label><div class="writing-toolbar"><div class="tool-group"><button class="icon-btn active" data-fig-tool="pen" aria-label="畫筆">${icon('practice')}</button><button class="icon-btn" data-fig-tool="eraser" aria-label="橡皮擦">${icon('eraser')}</button><span style="height:20px;border-right:1px solid var(--border);margin:0 4px"></span><button class="icon-btn" id="fig-undo" aria-label="撤銷">${icon('undo')}</button><button class="icon-btn" id="fig-clear" aria-label="清除">${icon('trash')}</button></div><span class="small-text">在方格上畫出三角形、坐標軸等圖形</span></div><div class="canvas-wrap figure-canvas-wrap"><canvas id="figure-canvas" width="900" height="420" aria-label="題目圖形畫布"></canvas></div><p class="field-hint" id="fig-status">圖形會與題目一併儲存；不畫圖也可直接加入題目。</p></div><p class="error-text" id="manual-error"></p><button class="secondary wide" id="manual-add">${icon('check')}加入這道題目</button></div>`;$('#paper-name').oninput=e=>paperName=e.target.value;$('#paper-text').oninput=e=>{paperText=e.target.value;if(paperText.trim()){paperFile=null;$('#paper-filename').textContent='已使用貼上文字（不會同時提交檔案）';}};$('#sample-paper').onclick=()=>{paperName='中三數學 · 示例練習卷';paperText='1. 解方程 $x^2-5x+6=0$。\n\n2. 直角三角形兩條直角邊長為 $3\\text{ cm}$ 和 $4\\text{ cm}$，求斜邊長。\n\n3. 擲一枚公平骰子，求點數大於 4 的概率。\n\n4. 已知 $f(x)=2x+1$，求 $f(3)$。';paperFile=null;renderImportContent();};const select=async f=>{try{const dataUrl=await fileData(f,['application/pdf','image/png','image/jpeg']);paperFile={name:f.name,mime:f.type,dataUrl};paperText='';if(!paperName)paperName=f.name.replace(/\.[^.]+$/,'');renderImportContent();}catch(e){toast(e.message);}};$('#paper-upload').onchange=e=>select(e.target.files[0]);const d=$('#paper-drop');d.ondragover=e=>{e.preventDefault();d.classList.add('dragover');};d.ondragleave=()=>d.classList.remove('dragover');d.ondrop=e=>{e.preventDefault();select(e.dataTransfer.files[0]);};$('#parse-paper').onclick=parsePaper;$('#auto-import-paper').onclick=autoImportPaper;
initFigureCanvas();
const syncSub=()=>{const t=$('#manual-topic').value,sel=$('#manual-subtopic'),cur=sel.value;sel.innerHTML=subtopicsOf(t).map(v=>`<option${v===cur?' selected':''}>${esc(v)}</option>`).join('');};
$('#manual-topic').onchange=syncSub;syncSub();
if($('#manual-add-option'))$('#manual-add-option').onclick=()=>{
  if(manualOptions.length>=OPTION_LETTERS.length)return toast(`最多 ${OPTION_LETTERS.length} 個選項。`);
  manualOptions.push('');renderManualOptions();
  const box=$('#manual-options'),last=box&&box.querySelector('input:last-of-type');if(last)last.focus();
};
if($('#manual-qtype'))$('#manual-qtype').addEventListener('change',e=>{
  const isChoice=e.target.value==='選擇題';
  const f=$('#manual-options-field');if(f)f.style.display=isChoice?'block':'none';
  if(isChoice&&!manualOptions.length){manualOptions=['','','',''];renderManualOptions();}
});
renderManualOptions();
rubricBind('manual', manualRubric);
if($('#manual-ai-answer'))$('#manual-ai-answer').onclick=()=>aiFillManual($('#manual-ai-answer'));
$('#manual-add').onclick=()=>{const title=$('#manual-title').value.trim(),content=$('#manual-content').value.trim();
if(!title)return $('#manual-error').textContent='請填寫題目標題。';
if(!content)return $('#manual-error').textContent='請填寫題目內容。';
$('#manual-error').textContent='';
const mq=$('#manual-qtype').value;drafts.push({title,content,topic:$('#manual-topic').value,subtopic:$('#manual-subtopic').value,level:Number($('#manual-level').value),grade:$('#manual-grade').value,qtype:mq,points:Number($('#manual-points').value)||5,answer:$('#manual-answer').value.trim(),steps:$('#manual-steps').value.split('\n').map(x=>x.trim()).filter(Boolean),analysis:$('#manual-analysis').value.trim(),rubric:cleanRubric(manualRubric),options:mq==='選擇題'?manualOptions.map(o=>String(o||'').trim()).filter(Boolean):[],hint:$('#manual-hint').value.trim(),source:'手動輸入',tags:[],figure:figStrokes.length?figureDataUrl():undefined});
$('#manual-title').value='';$('#manual-content').value='';$('#manual-answer').value='';$('#manual-hint').value='';$('#manual-steps').value='';$('#manual-analysis').value='';manualOptions=[];renderManualOptions();manualRubric.length=0;rubricRender('manual');figStrokes=[];drawFigure();setFigTool('pen');
importStage=2;importPage();toast('已加入題目，請核驗後匯入。');};}else if(importStage===2){r.innerHTML=`<div class="section-head"><div><h2 style="font-size:calc(18px*var(--fs))">已拆分 ${drafts.length} 道題目</h2><p>請逐題確認原文、分類、難度、分值及參考答案。</p>${importMethod?`<p class="small-text">拆分方式：${esc(importMethod)}</p>`:''}</div></div><div class="import-warning">辨識結果不是答案核驗。參考答案空白的題目會交由教師批閱；若要啟用答案核對，請填寫正確答案。</div><div id="draft-list">${drafts.map((q,i)=>`<article class="draft-card" data-draft="${i}"><div class="draft-top"><strong>題目 ${String(i+1).padStart(2,'0')} · 待教師核驗</strong><button class="icon-btn" data-remove-draft="${i}" aria-label="移除此題">${icon('trash')}</button></div>${q.figure?`<div class="draft-figure"><img src="${q.figure}" alt="題目圖形"><button class="text-button" data-remove-figure="${i}">移除圖形</button></div>`:''}<div class="form-field"><label class="field-label">題目標題</label><input data-field="title" value="${esc(q.title)}" maxlength="200"></div><div class="form-field"><label class="field-label">題目內容（可修正分割結果）<span class="small-text" style="font-weight:400">　下方即時預覽渲染後的數學式</span></label><textarea class="answer-field" data-field="content" maxlength="60000">${esc(q.content)}</textarea><div class="math-preview" data-preview="${i}">${mathText(q.content)}</div></div><div class="form-grid"><div class="form-field"><label class="field-label">知識分類</label><select data-field="topic">${topics.map(t=>`<option ${q.topic===t?'selected':''}>${t}</option>`).join('')}</select></div><div class="form-field"><label class="field-label">子分類</label><select data-field="subtopic">${subtopicsOf(q.topic).map(v=>`<option ${(q.subtopic||'')===v?'selected':''}>${esc(v)}</option>`).join('')}</select></div><div class="form-field"><label class="field-label">題型</label><select data-field="qtype">${qtypes.map(t=>`<option ${(q.qtype||'解答題')===t?'selected':''}>${t}</option>`).join('')}</select></div><div class="form-field"><label class="field-label">難度</label><select data-field="level">${[1,2,3].map(n=>`<option value="${n}" ${q.level===n?'selected':''}>${levels[n]}</option>`).join('')}</select></div><div class="form-field"><label class="field-label">分值</label><input data-field="points" type="number" min="1" max="100" value="${q.points}"></div><div class="form-field"><label class="field-label">參考答案（可留空）</label><input data-field="answer" value="${esc(q.answer)}" maxlength="4000"></div></div><div class="form-field options-field" data-options-field="${i}" style="display:${q.qtype==='選擇題'?'block':'none'}"><label class="field-label">選項（選擇題 · 可增刪修改）</label><div class="option-list" data-option-list="${i}"></div><div class="option-actions"><button type="button" class="text-button" data-add-option="${i}">＋ 新增選項</button><span class="small-text">支援 2 至 10 個選項，學生作答時可直接點選</span></div></div><div class="form-field"><label class="field-label">解題提示</label><input data-field="hint" value="${esc(q.hint)}" maxlength="4000"></div><div class="form-field"><label class="field-label">詳解步驟（每行一步）<span class="small-text" style="font-weight:400">　支援 LaTeX：$x^2-5x+6=0$</span></label><textarea class="answer-field" data-field="steps" maxlength="40000">${esc((q.steps||[]).join('\n'))}</textarea><div class="math-preview" data-steps-preview="${i}">${(q.steps||[]).map(st=>`<div class="preview-option">${mathText(st)}</div>`).join('')}</div></div><div class="form-field"><label class="field-label">詳細解釋（考點 · 解題思路 · 常見錯誤）</label><textarea class="answer-field" data-field="analysis" maxlength="6000">${esc(q.analysis||'')}</textarea><div class="math-preview" data-analysis-preview="${i}">${mathText(q.analysis||'')}</div></div><div class="form-field">${rubricEditorHtml('draft-'+i, q.rubric||[])}</div><div class="ai-answer-row"><button type="button" class="secondary" data-ai-answer="${i}">${icon('spark')}AI 生成答案與評分標準</button><span class="small-text">依題目自動產生答案、詳解、詳細解釋與評分標準百分比（可再修改）</span></div></article>`).join('')}</div><label class="checkbox-line"><input type="checkbox" id="confirm-drafts">我已確認題目內容、分類與評分依據，允許加入校本題庫。</label><div id="import-error"></div><div class="submit-row"><button class="secondary" id="back-import">返回修改來源</button><button class="primary" id="save-drafts">確認匯入 ${drafts.length} 題 ${icon('check')}</button></div>`;$$('[data-field]').forEach(f=>f.oninput=e=>{const card=e.target.closest('[data-draft]'),i=Number(card.dataset.draft),k=e.target.dataset.field;drafts[i][k]=k==='steps'?e.target.value.split('\n').map(x=>x.trim()).filter(Boolean):['level','points'].includes(k)?Number(e.target.value):e.target.value;if(k==='steps'||k==='analysis'){const pv=card.querySelector(k==='steps'?'[data-steps-preview]':'[data-analysis-preview]');if(pv)pv.innerHTML=k==='steps'?(drafts[i].steps||[]).map(x=>`<div class="preview-option">${mathText(x)}</div>`).join(''):mathText(e.target.value);}});$$('[data-field="topic"]').forEach(f=>f.onchange=e=>{const card=e.target.closest('[data-draft]'),sub=card&&card.querySelector('[data-field="subtopic"]');if(sub){sub.innerHTML=subtopicsOf(e.target.value).map(v=>`<option>${esc(v)}</option>`).join('');drafts[Number(card.dataset.draft)].subtopic=sub.value;}});
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
  if(e.target.value==='選擇題'&&!(drafts[di].options||[]).length){drafts[di].options=[];renderDraftOptions(di);}
}));
drafts.forEach((q,i)=>{if(!Array.isArray(q.rubric))q.rubric=[];rubricBind('draft-'+i,q.rubric);});
$$('[data-ai-answer]').forEach(b=>b.onclick=()=>aiFillDraft(Number(b.dataset.aiAnswer),b));
$$('[data-remove-figure]').forEach(b=>b.onclick=()=>{delete drafts[Number(b.dataset.removeFigure)].figure;renderImportContent();});$('#back-import').onclick=()=>{importStage=1;importPage();};$('#save-drafts').onclick=saveDrafts;}else{r.innerHTML=`<div class="success-panel"><div class="success-icon">${icon('check')}</div><h2>試卷已轉化為練習題</h2><p>${drafts.length} 道題目已存入本地校本題庫，可供學生練習。</p><button class="primary" id="view-imported">查看新題目 ${icon('arrow')}</button><button class="text-button" id="new-import" style="display:flex;margin:20px auto;font-size:calc(15px*var(--fs))">繼續匯入其他試卷</button></div>`;$('#view-imported').onclick=()=>{search=paperName;topic='全部題目';level='';currentPage=1;bank();};$('#new-import').onclick=()=>{paperFile=null;paperName='';paperText='';drafts=[];importStage=1;importPage();};}}
async function parsePaper(){if(busy)return;if(!paperName.trim())return toast('請先填寫試卷名稱。');if(!paperFile&&!paperText.trim())return toast('請選擇試卷或貼上題目文字。');const body={name:paperName.trim(),consentExternal:!!$('#paper-consent')?.checked};if(paperFile)Object.assign(body,{dataUrl:paperFile.dataUrl,mime:paperFile.mime});else body.text=paperText.trim();busy=true;$('#parse-paper').disabled=true;$('#parse-paper').textContent='正在辨識與拆分…';try{const r=await api('/api/papers/parse',body);drafts=r.drafts;importMethod=r.method||'';importStage=2;importPage();toast(r.method.includes('AI')?'AI 已辨識，請逐題核驗。':'已用本地規則拆分，請核驗分類與答案。');}catch(e){$('#parse-error').innerHTML=`<div class="inline-error">${esc(e.message)}</div>`+`<p class="field-hint">若持續失敗，可先改用手動輸入；伺服器日誌（Render → Logs）會顯示 AI 的實際錯誤原因。</p>`;}finally{busy=false;if($('#parse-paper')){$('#parse-paper').disabled=false;$('#parse-paper').innerHTML='開始拆分題目 '+icon('spark');}}}
async function autoImportPaper(){if(busy)return;if(!paperName.trim())return toast('請先填寫試卷名稱。');if(!paperFile&&!paperText.trim())return toast('請選擇試卷或貼上題目文字。');if(!confirm('全自動拆分並直接寫入題庫？題目會標示為「自動匯入 · 待核驗」，可之後在題庫核對。'))return;const body={name:paperName.trim(),consentExternal:!!$('#paper-consent')?.checked};if(paperFile)Object.assign(body,{dataUrl:paperFile.dataUrl,mime:paperFile.mime});else body.text=paperText.trim();busy=true;const b=$('#auto-import-paper'),original=b.innerHTML;b.disabled=true;b.innerHTML=icon('clock')+'正在拆分並匯入…';try{const r=await api('/api/papers/auto-import',body);await refresh();drafts=[];paperText='';paperFile=null;importStage=1;toast(`已全自動匯入 ${r.count} 題（${r.method}），請在題庫核對題型與答案。`);bank();}catch(e){$('#parse-error').innerHTML=`<div class="inline-error">${esc(e.message)}</div>`;}finally{busy=false;if($('#auto-import-paper')){$('#auto-import-paper').disabled=false;$('#auto-import-paper').innerHTML=original;}}}

async function saveDrafts(){if(busy)return;if(!$('#confirm-drafts').checked)return toast('請確認已核驗題目及評分依據。');if(!drafts.length)return toast('沒有可匯入的題目。');const rp=drafts.map(q=>rubricProblem(q.rubric)).find(Boolean);if(rp)return $('#import-error').innerHTML=`<div class="inline-error">${esc(rp)}</div>`;busy=true;$('#save-drafts').disabled=true;try{const verified=drafts.map(q=>{const isChoice=q.qtype==='選擇題';const options=isChoice?(q.options||[]).map(o=>String(o||'').trim()).filter(Boolean):[];return {...q,options,rubric:cleanRubric(q.rubric),tags:(q.tags||[]).filter(t=>!/(?:待.*(?:確認|确认|核驗|核验|審核|审核))/.test(t))};});await api('/api/questions/import',{questions:verified});await refresh();importStage=3;importPage();toast('已成功保存到本地題庫。');}catch(e){$('#import-error').innerHTML=`<div class="inline-error">${esc(e.message)}</div>`;if($('#save-drafts'))$('#save-drafts').disabled=false;}finally{busy=false;}}
function recordsPage(){page='mistakes';shell();if(!S.user)return loginModal(recordsPage);const teacher=S.user.role==='teacher',filtered=S.attempts.filter(a=>historyFilter==='all'||historyFilter==='pending'&&a.status==='pending'||historyFilter==='wrong'&&a.status==='graded'&&a.score<a.maxScore||historyFilter==='saved'&&bookmarks.has(a.questionId));$('#main').innerHTML=`<div class="fade-in">${heading(teacher?'REVIEW & FEEDBACK':'REFLECT & IMPROVE',teacher?'作答批閱':'我的錯題本',teacher?'看見學生的推導，用簡短回饋引導下一步。':'錯題不是終點。回看思路，再用相似題鞏固理解。',`<button class="secondary" id="refresh-records">${icon('undo')}重新整理</button>`)}<div class="history-filters">${[['all',teacher?'全部作答':'全部紀錄'],['wrong','需要鞏固'],['pending','等待批閱'],['saved','已收藏題目']].map(([id,t])=>`<button data-history="${id}" class="${historyFilter===id?'active':''}">${t}</button>`).join('')}</div><section class="panel records-panel">${filtered.length?filtered.map(a=>`<article class="record"><div class="record-icon">${icon(a.status==='pending'?'clock':a.score<a.maxScore?'mistakes':'check')}</div><div class="record-main"><strong>${esc(a.questionTitle)}</strong> <span class="badge">${esc(a.topic)}</span><p>${mathText(a.feedback)}</p>${suggestionCard(a.suggestion)}<small>${esc(new Date(a.submittedAt).toLocaleString('zh-HK'))}${teacher&&a.student?' · '+esc(a.student.name):''} · ${a.teacherReviewed?'教師已覆核':a.gradingMethod==='awaiting-review'?'已提交 · 等待教師批閱':a.gradingMethod==='rule-final'?'規則核對 · 非步驟評分':a.gradingMethod==='ai-practice'?'AI 即時評分 · 不需教師批閱':a.gradingMethod==='ai-advisory'?'AI 建議 · 未教師覆核':'等待教師'}</small><div class="record-actions"><button class="secondary" data-qid="${a.questionId}">再練一次 ${icon('arrow')}</button><button class="secondary" data-review="${a.id}">${teacher?'查看與批閱':'查看作答'}</button></div></div><div class="record-score">${a.status==='pending'?'待批閱':`${a.score} <small>/ ${a.maxScore} 分</small>`}</div></article>`).join(''):empty(historyFilter==='wrong'?'目前沒有需鞏固的題目':'還沒有作答紀錄',historyFilter==='pending'?'提交手寫作答後，可在這裡查看批閱進度。':'開始一道練習，讓思考留下足跡。',`<button class="primary" data-action="start">開始練習 ${icon('arrow')}</button>`)}</section></div>`;$('#refresh-records').onclick=async()=>{try{await refresh();recordsPage();toast('已讀取最新批閱紀錄。');}catch(e){toast(e.message);}};}
function aiMarkLayer(a,drag){const ann=a.aiAnnotation;if(!ann||!ann.issues?.length)return '';return `<div class="ai-mark-layer${drag?' draggable':''}">${ann.issues.map((it,i)=>`<span class="ai-mark" data-ai-index="${i}" data-label="${esc(it.label)}" data-comment="${esc(it.comment)}" style="left:${(it.x*100).toFixed(2)}%;top:${(it.y*100).toFixed(2)}%" title="${esc(it.label)}：${esc(it.comment)}"><i>${i+1}</i></span>`).join('')}</div>`;}
function aiMarksBlock(a){const ann=a.aiAnnotation;if(!ann||!ann.issues?.length)return '';return `<div class="ai-annotation"><div class="advice-heading">${icon('spark')}AI 建議批註 <span class="badge">${ann.issues.length} 處 · 未經教師確認</span></div><p class="field-hint">AI 只標示它能從照片確認的位置；標記座標可能偏移，數學判斷也可能出錯，必須由教師覆核後才可作準。數字對應圖上的圓形標記。</p>${ann.summary?`<p class="ai-summary">${esc(ann.summary)}</p>`:''}<ol class="ai-issue-list">${ann.issues.map(it=>`<li><strong>${esc(it.label)}</strong><span>${esc(it.comment)}</span></li>`).join('')}</ol>${ann.at?`<small class="field-hint">AI 於 ${dateText(ann.at)} 產生</small>`:''}</div>`;}
function annotationBlock(a,editable){if(!a.image)return '';if(!editable)return `<div class="annotated-view">${a.annotation?`<span class="badge">教師批註</span>`:`<span class="badge outline">手寫原稿</span>`}<div class="mark-wrap"><img class="review-image" src="${a.annotation||a.image}" alt="學生手寫解題${a.annotation?'（含教師批註）':''}">${aiMarkLayer(a)}</div>${a.annotation&&a.annotationAt?`<small class="field-hint">教師批註於 ${dateText(a.annotationAt)}。紅圈與箭頭指出需要修改的地方。</small>`:`<small class="field-hint">教師尚未加上批註。</small>`}</div>${aiMarksBlock(a)}`;return `<div class="annotation-tool"><div class="writing-toolbar"><div class="tool-group"><button class="icon-btn active" data-ann-tool="pen" title="紅筆" aria-label="紅筆">${icon('practice')}</button><button class="icon-btn" data-ann-tool="ellipse" title="圈出錯處" aria-label="圈出錯處">◯</button><button class="icon-btn" data-ann-tool="arrow" title="箭頭指出錯處" aria-label="箭頭">↗</button><button class="icon-btn" data-ann-tool="highlight" title="螢光標示" aria-label="螢光標示">▬</button><button class="icon-btn" data-ann-tool="text" title="文字批註" aria-label="文字批註">A</button><button class="icon-btn" data-ann-tool="eraser" title="擦除批註" aria-label="擦除批註">${icon('eraser')}</button><span style="height:20px;border-right:1px solid var(--border);margin:0 4px"></span><button class="icon-btn" id="ann-undo" title="撤銷" aria-label="撤銷">${icon('undo')}</button><button class="icon-btn" id="ann-clear" title="清除全部批註" aria-label="清除全部批註">${icon('trash')}</button></div><span class="small-text">直接在學生手稿上標示</span></div><div class="canvas-wrap ann-canvas-wrap"><canvas id="ann-canvas" width="1200" height="800" aria-label="批註畫布"></canvas></div><div class="submit-row"><span class="small-text" id="ann-status">批註在按下「儲存批註」前不會保存</span><button class="secondary" id="ann-save">${icon('check')}儲存批註</button></div><div class="ai-tool-row">${S.ai.configured?`<button class="secondary" id="ai-annotate">${icon('spark')}${a.aiAnnotation?.issues?.length?'重新產生 AI 批註':'請 AI 建議批註位置'}</button>`:`<span class="small-text">AI 未接入，未能產生建議批註。</span>`}${a.aiAnnotation?.issues?.length?`<button class="text-button" id="ai-clear" style="font-size:calc(14px*var(--fs))">清除 AI 批註</button>`:''}</div>${a.aiAnnotation?.issues?.length?`<div class="mark-wrap ai-preview" data-attempt="${a.id}" data-summary="${esc(a.aiAnnotation.summary||'')}"><img class="review-image" src="${a.annotation||a.image}" alt="AI 建議批註位置">${aiMarkLayer(a,true)}</div><div class="submit-row"><span class="small-text" id="ai-adjust-status">${a.aiAnnotation.adjusted?'教師已調整標記位置':'可直接拖動圓形標記，修正 AI 標錯的位置'}</span><button class="secondary" id="ai-adjust-save">${icon('check')}儲存調整後位置</button></div>`:''}${aiMarksBlock(a)}</div>`;}
let ann={base:null,shapes:[],tool:'pen',drawing:null},annotationDone=null;
function annotationRefresh(attempt){if(ann.shapes?.length&&!confirm('畫面將重新載入，你尚未儲存的紅筆批註會遺失。確定繼續？'))return;closeModal();reviewModal(attempt.id,annotationDone);}
function redrawAnn(){const c=$('#ann-canvas');if(!c||!ann.base)return;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(ann.base,0,0,c.width,c.height);for(const s of ann.shapes)drawAnnShape(ctx,s);if(ann.drawing)drawAnnShape(ctx,ann.drawing);}
function drawAnnShape(ctx,s){ctx.save();ctx.lineCap='round';ctx.lineJoin='round';if(s.type==='pen'||s.type==='highlight'){ctx.strokeStyle=s.erase?'rgba(255,255,255,.92)':s.type==='highlight'?'rgba(255,206,0,.38)':'#d9453b';ctx.lineWidth=s.erase?30:s.type==='highlight'?26:5;ctx.beginPath();s.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();}else if(s.type==='ellipse'){const x=Math.min(s.a.x,s.b.x),y=Math.min(s.a.y,s.b.y),w=Math.abs(s.b.x-s.a.x),h=Math.abs(s.b.y-s.a.y);ctx.strokeStyle='#d9453b';ctx.lineWidth=5;ctx.beginPath();ctx.ellipse(x+w/2,y+h/2,Math.max(w/2,6),Math.max(h/2,6),0,0,Math.PI*2);ctx.stroke();}else if(s.type==='arrow'){const ang=Math.atan2(s.b.y-s.a.y,s.b.x-s.a.x),L=26;ctx.strokeStyle='#d9453b';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(s.a.x,s.a.y);ctx.lineTo(s.b.x,s.b.y);ctx.moveTo(s.b.x,s.b.y);ctx.lineTo(s.b.x-L*Math.cos(ang-0.42),s.b.y-L*Math.sin(ang-0.42));ctx.moveTo(s.b.x,s.b.y);ctx.lineTo(s.b.x-L*Math.cos(ang+0.42),s.b.y-L*Math.sin(ang+0.42));ctx.stroke();}else if(s.type==='text'){ctx.font='600 30px "PingFang TC","Microsoft JhengHei",sans-serif';ctx.lineWidth=8;ctx.strokeStyle='rgba(255,255,255,.94)';ctx.strokeText(s.text,s.x,s.y);ctx.fillStyle='#c0392b';ctx.fillText(s.text,s.x,s.y);}ctx.restore();}
function initAnnotation(a){const c=$('#ann-canvas');if(!c)return;const img=new Image();img.onload=()=>{const s=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));c.width=Math.max(1,Math.round(img.naturalWidth*s));c.height=Math.max(1,Math.round(img.naturalHeight*s));ann={base:img,shapes:[],tool:'pen',drawing:null};redrawAnn();};img.onerror=()=>{$('#ann-status').textContent='無法載入學生手稿，請關閉後重新整理。';};img.src=a.annotation||a.image;
function pos(e){const r=c.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*c.width,y:(e.clientY-r.top)/r.height*c.height};}
c.onpointerdown=e=>{if(!ann.base)return;if(e.button!==0&&e.pointerType==='mouse')return;e.preventDefault();const p=pos(e);if(ann.tool==='text'){const t=(prompt('輸入要寫在圖上的批註文字（例如：這裡漏了負號）')||'').trim();if(t)ann.shapes.push({type:'text',x:p.x,y:p.y,text:t.slice(0,120)});redrawAnn();$('#ann-status').textContent='已加入文字批註，記得儲存。';return;}c.setPointerCapture(e.pointerId);ann.drawing=ann.tool==='pen'||ann.tool==='highlight'||ann.tool==='eraser'?{type:'pen',points:[p],erase:ann.tool==='eraser'}:{type:ann.tool,a:p,b:p};redrawAnn();};
c.onpointermove=e=>{if(!ann.drawing)return;e.preventDefault();const p=pos(e);if(ann.drawing.points)ann.drawing.points.push(p);else ann.drawing.b=p;redrawAnn();};
c.onpointerup=c.onpointercancel=c.onlostpointercapture=()=>{const d=ann.drawing;ann.drawing=null;if(!d)return;if(d.type==='pen'&&d.erase){const pts=d.points;ann.shapes=ann.shapes.filter(s=>!(s.points||[]).some(q=>pts.some(p=>Math.hypot(p.x-q.x,p.y-q.y)<30)));}else if(d.type==='pen'){if(d.points.length>=2)ann.shapes.push(d);}else if(Math.hypot(d.b.x-d.a.x,d.b.y-d.a.y)>=12){ann.shapes.push(d);}redrawAnn();if(ann.shapes.length)$('#ann-status').textContent='批註尚未儲存';};
$$('[data-ann-tool]').forEach(b=>b.onclick=()=>{ann.tool=b.dataset.annTool;$$('[data-ann-tool]').forEach(x=>x.classList.toggle('active',x===b));});
$('#ann-undo').onclick=()=>{if(!ann.shapes.length)return toast('沒有可撤銷的批註。');ann.shapes.pop();redrawAnn();$('#ann-status').textContent='已撤銷一筆，記得儲存。';};
$('#ann-clear').onclick=()=>{if(!ann.shapes.length)return;if(!confirm('清除圖上所有批註？原有手寫內容不受影響。'))return;ann.shapes=[];redrawAnn();$('#ann-status').textContent='已清除全部批註，記得儲存。';};
$('#ann-save').onclick=async()=>{const b=$('#ann-save');b.disabled=true;$('#ann-status').textContent='正在儲存批註…';try{const {attempt}=await api(`/api/attempts/${a.id}/annotation`,{image:imageDataUrl(c)});const i=S.attempts.findIndex(x=>x.id===attempt.id);if(i<0)S.attempts.push(attempt);else S.attempts[i]=attempt;toast('批註已儲存，學生可查看。');closeModal();if(annotationDone)annotationDone();}catch(e){$('#ann-status').textContent=e.message;b.disabled=false;}};
const aiBtn=$('#ai-annotate');
if(aiBtn)aiBtn.onclick=async()=>{if(S.ai.mode==='external'&&!confirm('AI 批註會將這位學生的手寫照片及本題內容，傳送至學校配置的外部 AI 服務，是否繼續？'))return;const original=aiBtn.innerHTML;aiBtn.disabled=true;aiBtn.innerHTML=icon('clock')+'AI 正在看手稿…';try{const {attempt}=await api(`/api/attempts/${a.id}/ai-annotation`,{consentExternal:S.ai.mode==='external'});const i=S.attempts.findIndex(x=>x.id===attempt.id);if(i<0)S.attempts.push(attempt);else S.attempts[i]=attempt;const n=attempt.aiAnnotation?.issues?.length||0;toast(n?`AI 建議 ${n} 處，須由教師覆核。`:'AI 未標示任何錯處；這不代表作答正確，請教師自行檢視。');annotationRefresh(attempt);}catch(e){toast(e.message);aiBtn.disabled=false;aiBtn.innerHTML=original;}};
const aiClear=$('#ai-clear');
if(aiClear)aiClear.onclick=async()=>{if(!confirm('清除 AI 建議批註？教師自己的批註不受影響。'))return;try{const {attempt}=await api(`/api/attempts/${a.id}/ai-annotation`,{clear:true});const i=S.attempts.findIndex(x=>x.id===attempt.id);if(i<0)S.attempts.push(attempt);else S.attempts[i]=attempt;toast('已清除 AI 批註。');annotationRefresh(attempt);}catch(e){toast(e.message);}};}
let aiDrag=null;
document.addEventListener('pointerdown',e=>{const m=e.target&&e.target.closest?e.target.closest('.ai-mark-layer.draggable .ai-mark'):null;if(!m)return;const wrap=m.closest('.mark-wrap');if(!wrap)return;const r=wrap.getBoundingClientRect(),b=m.getBoundingClientRect();aiDrag={m,r,dx:e.clientX-(b.left+b.width/2),dy:e.clientY-(b.top+b.height/2)};try{m.setPointerCapture(e.pointerId);}catch(_){}e.preventDefault();});
document.addEventListener('pointermove',e=>{if(!aiDrag)return;const {m,r}=aiDrag;let x=e.clientX-aiDrag.dx-r.left,y=e.clientY-aiDrag.dy-r.top;x=Math.min(Math.max(x,0),r.width);y=Math.min(Math.max(y,0),r.height);m.style.left=(x/r.width*100)+'%';m.style.top=(y/r.height*100)+'%';const st=document.getElementById('ai-adjust-status');if(st)st.textContent='標記位置已改動，記得按「儲存調整後位置」。';});
['pointerup','pointercancel'].forEach(t=>document.addEventListener(t,()=>{aiDrag=null;}));
document.addEventListener('click',async e=>{const btn=e.target&&e.target.closest?e.target.closest('#ai-adjust-save'):null;if(!btn)return;const wrap=btn.closest('#modal-root')?.querySelector('.mark-wrap.ai-preview');if(!wrap)return;const aid=wrap.dataset.attempt,layer=wrap.querySelector('.ai-mark-layer.draggable');if(!aid||!layer)return;const r=wrap.getBoundingClientRect();const issues=[...layer.querySelectorAll('.ai-mark')].map(m=>{const b=m.getBoundingClientRect();return {x:Math.min(Math.max((b.left+b.width/2-r.left)/r.width,0),1),y:Math.min(Math.max((b.top+b.height/2-r.top)/r.height,0),1),label:m.dataset.label||'',comment:m.dataset.comment||''};});btn.disabled=true;const st=document.getElementById('ai-adjust-status');if(st)st.textContent='正在儲存調整後的位置…';try{const {attempt}=await api(`/api/attempts/${aid}/ai-annotation`,{marks:{issues,summary:wrap.dataset.summary||''}});const i=S.attempts.findIndex(x=>x.id===attempt.id);if(i<0)S.attempts.push(attempt);else S.attempts[i]=attempt;toast('已儲存調整後的標記位置。');annotationRefresh(attempt);}catch(err){if(st)st.textContent=err.message;btn.disabled=false;}});
function reviewModal(id,onDone=null,snapshot=null){const a=S.attempts.find(a=>a.id===Number(id));if(!a)return;const q=snapshot||(a.assignmentId&&assignmentDetail?.assignment?.id===a.assignmentId?assignmentDetail.questions.find(q=>q.id===a.questionId):null)||S.questions.find(q=>q.id===a.questionId),teacher=S.user.role==='teacher';modal(`<p class="eyebrow">${teacher?'TEACHER REVIEW':'YOUR THINKING'}</p><h2>${esc(a.questionTitle)}</h2><p class="modal-intro">${mathText(q?.content)} · ${a.maxScore} 分${a.student?' · '+esc(a.student.name):''}</p>${annotationBlock(a,teacher)}${a.answerText?`<div class="review-answer">${mathText(a.answerText)}</div>`:''}${teacher&&(q?.answer||q?.steps?.length||q?.analysis||q?.rubric?.length)?`<div class="hint-box"><strong>教師參考答案：</strong>${q?.answer?mathText(q.answer):'（未填）'}${(q?.steps||[]).length?`<ol class="solution-steps">${q.steps.map(x=>`<li>${mathText(x)}</li>`).join('')}</ol>`:''}${q?.analysis?`<p class="solution-analysis">${mathText(q.analysis)}</p>`:''}${rubricListHtml(q?.rubric,a.maxScore)}</div>`:''}${a.awaitingReview&&!teacher?`<div class="hint-box">${icon('clock')}教師批閱後才會顯示分數、AI 批閱結果、參考答案與學習建議。你的作答已保存。</div>`:`<p class="info-note">${mathText(a.feedback)}</p>${suggestionCard(a.suggestion)}<p class="field-hint">AI 原建議分：${scoreText(a.aiScore)} · 規則原分：${scoreText(a.ruleScore)} · 教師確認：${scoreText(a.confirmedScore)}</p>`}${teacher?`<form id="review-form"><div class="form-field"><label class="field-label" for="review-score">評分（0–${a.maxScore}）</label><input id="review-score" type="number" min="0" max="${a.maxScore}" step="0.5" value="${a.score??''}" required></div><div class="form-field"><label class="field-label" for="review-feedback">簡要評語 / 下一步建議 <span class="small-text">· 可留空</span></label><textarea class="answer-field" id="review-feedback" placeholder="可留空；若要寫，指出做得好的步驟，再給一個具體可改進的地方。" maxlength="12000"></textarea></div><p id="review-error" class="error-text"></p><button class="primary wide" type="submit">保存教師批閱 ${icon('check')}</button></form>`:`<button class="secondary wide" id="retry-from-review">再練一次 ${icon('arrow')}</button>`}`,true);if(teacher&&a.image){annotationDone=onDone||(()=>recordsPage());initAnnotation(a);}if(teacher)$('#review-form').onsubmit=async e=>{e.preventDefault();const b=$('[type="submit"]',e.target);b.disabled=true;try{await api(`/api/attempts/${a.id}/review`,{score:Number($('#review-score').value),feedback:$('#review-feedback').value});await refresh();closeModal();if(onDone)onDone();else recordsPage();toast('教師批閱已保存，學生可查看最新評語與建議。');}catch(err){$('#review-error').textContent=err.message;b.disabled=false;}};else $('#retry-from-review').onclick=()=>{closeModal();openQuestion(a.questionId);};}
function growthPage(){page='growth';shell();if(!S.user)return loginModal(growthPage);const days=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);const key=d.toLocaleDateString('en-CA');return {label:`${d.getMonth()+1}/${d.getDate()}`,n:S.attempts.filter(a=>new Date(a.submittedAt).toLocaleDateString('en-CA')===key).length};});const max=Math.max(1,...days.map(d=>d.n));$('#main').innerHTML=`<div class="fade-in">${heading('YOUR LEARNING JOURNEY','學習足跡','進步藏在每一次願意再想一步的練習裡。')}${metrics()}<div class="growth-layout"><section class="panel growth-panel"><h2>最近七天的練習</h2><p>提交次數（含待批閱） · 只呈現真實作答，不產生示例學習紀錄</p><div class="chart">${days.map(d=>`<div class="chart-column"><span class="bar-value">${d.n}</span><div class="bar" style="height:${d.n/max*145+3}px"></div><span class="bar-label">${d.label}</span></div>`).join('')}</div><div class="chart-caption">每一次練習都值得被看見。${S.attempts.length?'繼續保持，鞏固薄弱知識點。':'你還沒有提交練習，從第一道題開始吧。'}</div></section><section class="panel growth-panel"><h2>知識點練習表現</h2><p>得分率是練習表現，不代表能力的完整測量。</p>${(()=>{const practiced=topics.map(t=>({t,st:topicStats(t)})).filter(x=>x.st.n>0).sort((a,b)=>a.st.value-b.st.value);if(!practiced.length)return `<p class="chart-caption">還沒有任何知識點的練習記錄，先去做幾題吧。</p>`;return practiced.map(({t,st})=>`<div class="topic-detail"><div class="knowledge-row"><span>${esc(t)}</span><span>${st.n} 次 · ${st.value}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${st.value}%"></div></div></div>`).join('');})()}</section><section class="panel growth-panel"><h2>${icon('bulb')}下一步學習建議</h2><p>${S.attempts.some(a=>a.status==='graded'&&a.score<a.maxScore)?'從錯題本選擇一道需要鞏固的題目，先回看錯誤步驟，再做同知識點相似題。':'先完成一道基礎題；在能清楚解釋方法後，再挑戰進階題。'}</p><button class="text-button" data-action="start">前往自主練習 ${icon('arrow')}</button></section></div></div>`;}
let AICFG=null;
function aiCapability(label,ok,need){return `<li class="${ok?'ready':''}">${ok?icon('check'):icon('lock')}<div><strong>${esc(label)}</strong><small>${ok?'可用 · ':''}${esc(need)}</small></div></li>`;}
async function aiConfigPage(){page='ai';shell();if(!S.user)return loginModal(aiConfigPage);if(S.user.role!=='teacher'){$('#main').innerHTML=heading('AI ENDPOINT','模型端點','更換模型端點只限教師。')+`<section class="panel">${empty('此頁只限教師','模型端點涉及伺服器金鑰，只開放給教師。',`<button class="primary" data-page="homework">返回作業 ${icon('arrow')}</button>`)}</section>`;return;}$('#main').innerHTML=heading('AI ENDPOINT','模型端點','隨時更換 AI 服務，無需重新啟動。')+`<section class="panel">${empty('正在讀取模型設定','向本地伺服器查詢目前端點。')}</section>`;try{AICFG=await api('/api/ai-config');}catch(e){if(page==='ai')$('#main').innerHTML=heading('AI ENDPOINT','模型端點','讀取設定失敗。')+`<div class="inline-error">${esc(e.message)}</div>`;return;}if(page==='ai')renderAiConfigPage();}
function renderAiConfigPage(){const c=AICFG,a=c.active;const mode={local:'本機模型（可傳送作答）',external:'外部模型（每次需同意）',off:'未接入'}[a.mode]||a.mode;const source={env:'伺服器環境變數',saved:'介面儲存設定',none:'未設定'}[a.source]||a.source;const draft=c.saved||c.env,dis=c.canEdit?'':'disabled';
$('#main').innerHTML=`<div class="fade-in">${heading('AI ENDPOINT','模型端點','隨時更換 AI 服務，無需重新啟動。設定只保存在這台伺服器，金鑰不會傳到瀏覽器。')}<div class="metric-row">${[['目前模式',mode,''],['文字模型',a.model||'—','用於批改、學習建議、拆題與生成'],['視覺模型',a.vision||'—','用於手寫辨識與 AI 建議批註'],['設定來源',source,'已儲存設定優先於環境變數'],['計費模式',a.thinking?'精確模式（較貴）':'省錢模式（推薦）',a.thinking?'AI 先推理再作答，適合申論／證明題':'AI 直接作答，輸出 token 少，費用約三分之一']].map(([l,v,f])=>`<div class="metric"><div class="metric-label">${l}</div><div class="metric-value" style="font-size:calc(18px*var(--fs));line-height:1.6;word-break:break-all">${esc(v)}</div><div class="metric-foot">${f}</div></div>`).join('')}</div>${c.invalidSaved?`<div class="inline-error">已儲存的端點設定無效，系統已回退環境變數。請重新儲存一組可用的設定。</div>`:''}<div class="settings-layout"><section class="panel settings-panel"><h2>${icon('ai')}更換模型端點</h2><p class="info-note">支援任何 OpenAI 相容的 <code>/chat/completions</code> 端點。本機服務（127.0.0.1／localhost）可用 HTTP；其他主機必須 HTTPS。</p>${!c.canEdit?`<div class="import-warning">${c.tokenRequired?'此伺服器已設定 MATH_ADMIN_TOKEN，需要管理員權杖才能更換端點。':'只有從伺服器本機操作時才可直接更換端點。若需從校內其他電腦管理，請在伺服器設定 MATH_ADMIN_TOKEN 環境變數。'}</div>`:''}<form id="ai-form"><div class="form-field"><label class="field-label" for="ai-base">端點位址</label><input id="ai-base" value="${esc(draft.baseUrl||'')}" placeholder="例如：http://127.0.0.1:11434/v1" maxlength="500" ${dis}></div><div class="form-grid"><div class="form-field"><label class="field-label" for="ai-model">文字模型</label><input id="ai-model" value="${esc(draft.model||'')}" placeholder="例如：qwen2.5:14b" maxlength="200" ${dis}></div><div class="form-field"><label class="field-label" for="ai-vision">視覺模型（可留空）</label><input id="ai-vision" value="${esc(draft.visionModel||'')}" placeholder="須真實支援圖片輸入" maxlength="200" ${dis}></div></div><div class="form-field"><label class="field-label" for="ai-key">API 金鑰</label><input id="ai-key" type="password" autocomplete="new-password" placeholder="${draft.keySet?'已設定 · 留空表示不變更':'未設定 · 若端點無需認證可留空'}" maxlength="8192" ${dis}></div><div class="form-field"><label class="field-label" for="ai-thinking">計費模式</label><label class="checkbox-line"><input type="checkbox" id="ai-thinking" ${a.thinking?'':'checked'}> <b>省錢模式</b>（推薦）<small>關閉 AI 的「思考鏈」，輸出 token 大幅減少，費用約為原本的三分之一。適合選擇題、填空題、計算題與簡短作答。</small></label><p class="field-hint">取消勾選＝<b>精確模式</b>：AI 會先推理再作答，申論題／證明題較準確，但費用較高。此設定僅對 DeepSeek 等支援思考模式的模型有效，其他模型會自動忽略。</p></div>${c.tokenRequired?`<div class="form-field"><label class="field-label" for="ai-token">管理員權杖</label><input id="ai-token" type="password" autocomplete="off" placeholder="MATH_ADMIN_TOKEN" maxlength="256"></div>`:''}<p class="field-hint">金鑰只會送往本地伺服器並存於伺服器的資料庫；介面永遠不會讀回金鑰內容，只顯示是否已設定。</p><p class="error-text" id="ai-error"></p><div class="ai-config-actions"><button class="secondary" type="button" id="ai-test" ${dis}>${icon('check')}測試文字模型</button><button class="secondary" type="button" id="ai-test-vision" ${dis}>${icon('image')}測試視覺模型</button><button class="primary" type="submit" ${dis}>${icon('check')}儲存並立即啟用</button></div><div id="ai-test-result"></div></form>${c.canEdit?`<button class="text-button" id="ai-clear" style="font-size:calc(14px*var(--fs));margin-top:14px">清除已儲存設定，改用環境變數</button>`:''}</section><div><section class="panel settings-panel"><h2>${icon('spark')}這個端點能支援甚麼</h2><ul class="capability-list">${aiCapability('批改文字作答、產生學習建議',a.configured,'需要文字模型')}${aiCapability('拆題與生成相似／進階題',a.configured,'需要文字模型')}${aiCapability('手寫辨識與 AI 建議批註',!!a.vision,'需要視覺模型')}</ul></section><section class="panel settings-panel" style="margin-top:20px"><h2>${icon('lock')}安全說明</h2><ul><li>金鑰保存在伺服器的 SQLite 資料庫（檔案權限 600）。</li><li>金鑰不會回傳瀏覽器，介面只顯示是否已設定。</li><li>${c.tokenRequired?'更換端點需要管理員權杖。':'未設定 MATH_ADMIN_TOKEN 時，只有伺服器本機可以更換端點。'}</li><li>外部端點必須使用 HTTPS；非本機位址不接受 HTTP。</li><li>使用外部模型傳送學生作答前，系統會要求逐次同意。</li><li>AI 的數學判斷與批註只作教師覆核的提示，不可直接作為成績。</li></ul></section></div></div></div>`;
const body=()=>{const v={baseUrl:$('#ai-base').value.trim(),model:$('#ai-model').value.trim(),visionModel:$('#ai-vision').value.trim()};if($('#ai-key').value)v.apiKey=$('#ai-key').value;if($('#ai-token')?.value)v.adminToken=$('#ai-token').value;if($('#ai-thinking'))v.thinking=!$('#ai-thinking').checked;return v;};
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
function dataAdminHtml(){
  if(S.user?.role!=='teacher')return '';
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
  if(S.user?.role!=='teacher')return;
  try{ADMIN_STATS=await api('/api/admin/storage');
    const box=$('#admin-stats');if(box)box.innerHTML=adminStatsCards(ADMIN_STATS);
    const count=$('#admin-question-count');if(count)count.textContent=ADMIN_STATS.counts.questions;
    if(notify)toast('已更新用量。');}
  catch(e){if(notify)toast(e.message);}
}
function bindDataAdmin(){
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
  loadAdminStats();
}
function settingsPage(){page='settings';shell();$('#main').innerHTML=`<div class="fade-in">${heading('SAFE & LOCAL','設定與隱私','資料留在校內，AI 能力由學校選擇與管理。')}<div class="settings-layout"><section class="panel settings-panel"><h2>${icon('lock')}AI 批閱服務</h2><div class="settings-status"><strong><i class="status-dot"></i>${S.ai.configured?`已配置${S.ai.mode==='local'?'本地':'外部'}模型`:'尚未接入 AI 服務'}</strong><p>${S.ai.configured?'可用於拆題、生成相似或進階題、作答建議評分。模型：'+esc(S.ai.model):'現有題庫、規則拆題、手寫保存、教師批閱仍可使用。未接入時，不會生成假的 AI 成績或評語。'}</p></div>${S.user?.role==='teacher'?`<button class="secondary wide" id="ai-config-link" style="font-size:calc(14px*var(--fs));margin-bottom:16px">${icon('ai')}前往模型端點設定</button>`:''}<h3>管理員配置</h3><p class="info-note">由伺服器環境變數設定相容的 AI 介面，密鑰不會保存於瀏覽器。建議優先使用校內本地視覺模型。</p><pre class="code-block">MATH_AI_BASE_URL=http://127.0.0.1:11434/v1
MATH_AI_MODEL=你的文字模型名稱
MATH_AI_VISION_MODEL=你的視覺模型名稱
MATH_AI_API_KEY=伺服器端密鑰（若需要）</pre><p class="info-note">上述是配置格式示例，並非已安裝的模型。設定後需重新啟動伺服器；真實模型須由學校部署並測試。</p><div class="import-warning">作業的 AI 評分只是建議，不應直接決定正式考試成績；無法辨認的手寫、複雜證明及特殊解法，必須交由教師覆核。自主練習與自助模擬測驗由 AI 即時評分並記錄分數，不需教師批閱，分數只作個人練習紀錄。</div></section><div><section class="panel settings-panel"><h2>資料保護</h2><ul><li>題庫與學生作答保存在本地 SQLite 資料庫。</li><li>學生僅可讀取自己的作答；教師可查看及批閱。</li><li>手寫圖片受登入與角色權限保護。</li><li>外部 AI 作答與試卷傳送需逐次明確同意。</li><li>收藏只保存於本瀏覽器，不跨裝置同步。</li><li>校內正式部署需 HTTPS、防火牆與獨立學生帳戶。</li></ul>${S.user?.role==='teacher'?`<button class="secondary wide" id="manage-users" style="font-size:calc(14px*var(--fs));margin-bottom:14px">${icon('lock')}管理獨立學生帳戶</button>`:''}<button class="text-button" id="deployment-help" style="font-size:calc(14px*var(--fs))">查看啟動與內網使用方式 ${icon('arrow')}</button></section><section class="panel settings-panel" style="margin-top:20px"><h2>帳戶密碼</h2>${S.user?`<form id="password-form"><div class="form-field"><label class="field-label" for="old-password">目前密碼</label><input id="old-password" type="password" autocomplete="current-password" required maxlength="256"></div><div class="form-field"><label class="field-label" for="new-password">新密碼（至少10字）</label><input id="new-password" type="password" autocomplete="new-password" minlength="10" maxlength="256" required></div><p class="error-text" id="password-error"></p><button class="secondary" type="submit">更新密碼 ${icon('lock')}</button></form>`:`<p class="info-note">登入後可更換演示帳戶密碼。</p><button class="secondary" data-action="login">登入帳戶</button>`}</section></div></div>${dataAdminHtml()}</div>`;$('#deployment-help').onclick=deploymentHelp;if($('#ai-config-link'))$('#ai-config-link').onclick=()=>navigate('ai');if($('#manage-users'))$('#manage-users').onclick=manageUsers;bindDataAdmin();if($('#password-form'))$('#password-form').onsubmit=async e=>{e.preventDefault();const btn=$('[type="submit"]',e.target);btn.disabled=true;try{const r=await api('/api/change-password',{oldPassword:$('#old-password').value,newPassword:$('#new-password').value});await refresh();settingsPage();toast(r.notice);}catch(err){$('#password-error').textContent=err.message;btn.disabled=false;}};}
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
async function manageUsers(){try{const {users}=await api('/api/users');modal(`<p class="eyebrow">STUDENT ACCOUNTS</p><h2>獨立學生帳戶</h2><p class="modal-intro">每位學生使用獨立帳戶，作答與手寫圖片不與其他學生共用。</p><div class="review-answer" style="max-height:180px;overflow:auto">${users.filter(u=>u.role==='student').map(u=>`<div style="padding:7px;border-bottom:1px solid var(--border)">${u.seat?`<span class="seat-badge">${esc(u.seat)}</span>`:''}${esc(u.name)}${u.username===u.name?'':` <span class="small-text">${esc(u.username)}</span>`}</div>`).join('')}</div><form id="user-create-form"><div class="form-grid" style="margin-top:20px"><div class="form-field"><label class="field-label" for="student-name">姓名（可留空，預設用學號）</label><input id="student-name" maxlength="60" placeholder="例如：陳大文"></div><div class="form-field"><label class="field-label" for="student-username">學號（登入帳戶）</label><input id="student-username" minlength="3" maxlength="40" pattern="[A-Za-z0-9_.\\-]{3,40}" required placeholder="例如：s3a01" autocomplete="off"></div><div class="form-field"><label class="field-label" for="student-seat">班內號（可留空）</label><input id="student-seat" maxlength="20" placeholder="例如：3"></div></div><div class="form-field"><label class="field-label" for="student-password">初始密碼（至少10字）</label><input id="student-password" type="password" minlength="10" maxlength="256" required autocomplete="new-password"></div><p class="field-hint">學號只接受英文字母、數字、底線、點或連字號；<strong>姓名可以留空</strong>（不匯入名字），系統會以學號作為顯示名稱。請私下將初始密碼交給學生，提醒首次登入後更換。</p><p class="error-text" id="user-error"></p><button class="primary wide" type="submit">建立學生帳戶 ${icon('check')}</button></form><div class="divider-text"><span>或批次匯入一整班</span></div><div class="bulk-tools"><label class="secondary" for="bulk-file">${icon('upload')}上傳名單檔案</label><input id="bulk-file" type="file" accept=".csv,.txt,text/csv,text/plain" hidden><button class="text-button" id="bulk-template" type="button">${icon('file')}下載名單範本</button></div><div class="form-field" style="margin-top:14px"><label class="field-label" for="bulk-order">名單欄位順序</label><select id="bulk-order"><option value="auto">自動判斷（依內容或第一行標題）</option><option value="username_seat_password">學號,班內號,密碼</option><option value="name_username_password">姓名,學號,密碼</option><option value="username_password">學號,密碼</option></select></div><p class="field-hint"><strong>姓名可以完全省略</strong>（不匯入名字）：省略時以學號作為顯示名稱，名單上不會出現空白姓名。班內號與密碼都可留空（密碼留空會自動產生）。也接受 Tab、全角逗號或分號；第一行若是標題（如「學號,班內號,密碼」）會自動略過並依標題對應欄位。以 # 開頭的行會被忽略。名單檔案請存成 UTF-8 的 CSV 或 TXT。</p><textarea class="answer-field" id="bulk-students" style="min-height:150px;font-size:calc(15px*var(--fs))" placeholder="s3a01,1,MathPass1234&#10;s3a02,2,MathPass1234&#10;s3a03,3&#10;s3a04"></textarea><div id="bulk-preview" class="field-hint"></div><div id="bulk-preview-table"></div><label class="checkbox-line"><input type="checkbox" id="bulk-class-toggle">匯入後直接建立班級（把這批學生編入同一班）</label><div class="form-field" id="bulk-class-field" hidden><label class="field-label" for="bulk-class-name">班級名稱</label><input id="bulk-class-name" maxlength="100" placeholder="例如：中三甲班"></div><p class="error-text" id="bulk-error"></p><button class="secondary wide" id="bulk-submit" style="margin-top:6px">${icon('upload')}批次建立學生帳戶</button><div id="bulk-result"></div>`,true);$('#user-create-form').onsubmit=async e=>{e.preventDefault();const b=$('[type="submit"]',e.target);b.disabled=true;try{await api('/api/users',{username:$('#student-username').value,name:$('#student-name').value,seat:$('#student-seat').value,password:$('#student-password').value});toast('獨立學生帳戶已建立。');manageUsers();}catch(err){$('#user-error').textContent=err.message;b.disabled=false;}};
const bulkPreview=()=>{const {rows,errors,fields}=parseBulkStudents($('#bulk-students').value,$('#bulk-order')?$('#bulk-order').value:'auto');const generated=rows.filter(r=>r.generated).length,noName=rows.filter(r=>!r.name).length,seated=rows.filter(r=>r.seat).length;$('#bulk-preview').innerHTML=rows.length?`將建立 <strong>${rows.length}</strong> 個帳戶${fields?`（${fields.map(f=>BULK_FIELD_NAMES[f]).join(' · ')}）`:''}${generated?`，其中 ${generated} 個自動產生密碼`:''}${noName?`，${noName} 個未填姓名（以學號顯示）`:''}${seated?`，${seated} 個有班內號`:''}`:'請輸入學生名單，每行一位。';$('#bulk-error').innerHTML=errors.length?errors.slice(0,6).map(esc).join('<br>'):'';const table=$('#bulk-preview-table');if(table)table.innerHTML=rows.length?`<div class="table-scroll" style="margin-top:10px"><table class="results-table bulk-table"><thead><tr><th>學號</th><th>班內號</th><th>顯示名稱</th><th>密碼</th></tr></thead><tbody>${rows.slice(0,8).map(r=>`<tr><td>${esc(r.username)}</td><td>${r.seat?esc(r.seat):'—'}</td><td>${esc(r.name||r.username)}</td><td>${r.generated?'自動產生':'已填'}</td></tr>`).join('')}</tbody></table></div>${rows.length>8?`<p class="field-hint">…另有 ${rows.length-8} 位未顯示。</p>`:''}`:'';return{rows,errors};};
$('#bulk-students').oninput=bulkPreview;$('#bulk-students').onchange=bulkPreview;$('#bulk-order').onchange=bulkPreview;
$('#bulk-file').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(f.size>1024*1024)return toast('名單檔案不可超過 1 MB。');if(!/\.(csv|txt)$/i.test(f.name)&&!['text/csv','text/plain'].includes(f.type))return toast('請提供 CSV 或 TXT 名單檔案。');try{const raw=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error('檔案讀取失敗，請確認是 UTF-8 的 CSV 或 TXT。'));r.readAsText(f,'UTF-8');});$('#bulk-students').value=raw.replace(/^\ufeff/,'');bulkPreview();toast(`已載入名單：${f.name}`);}catch(err){toast(err.message);}e.target.value='';};
$('#bulk-template').onclick=()=>{const order=$('#bulk-order')?$('#bulk-order').value:'auto';const fields=order==='auto'?['username','seat','password']:(BULK_ORDERS[order]||['username','seat','password']);const sample={name:['陳大文','李小美','黃志強'],username:['s3a01','s3a02','s3a03'],seat:['1','2','3'],password:['MathPass1234','','']};const csv='\ufeff'+fields.map(f=>BULK_FIELD_NAMES[f]).join(',')+'\r\n'+sample.username.map((_,i)=>fields.map(f=>sample[f][i]).join(',')).join('\r\n')+'\r\n';const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='MathPath-學生名單範本.csv';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已下載名單範本（'+fields.map(f=>BULK_FIELD_NAMES[f]).join(',')+'），可用試算表填寫後另存為 CSV。');};
$('#bulk-class-toggle').onchange=e=>{$('#bulk-class-field').hidden=!e.target.checked;};
$('#bulk-submit').onclick=async()=>{const {rows,errors}=bulkPreview();if(errors.length)return toast('請先修正名單格式錯誤。');if(!rows.length)return toast('請輸入至少一位學生。');if(rows.length>200)return toast('每批最多200位學生。');const makeClass=$('#bulk-class-toggle').checked,className=$('#bulk-class-name').value.trim();if(makeClass&&!className)return toast('請填寫班級名稱，或取消建立班級。');const b=$('#bulk-submit');b.disabled=true;b.textContent='正在建立…';try{const {users:created}=await api('/api/users/bulk',{students:rows.map(r=>({username:r.username,name:r.name,seat:r.seat,password:r.password}))});let classNote='';if(makeClass){try{const {class:room}=await api('/api/classes',{name:className,studentIds:created.map(u=>u.id)});classNote=`<div class="hint-box" style="margin-top:12px">已同時建立班級「${esc(room.name)}」，共 ${room.studentCount} 位學生，可直接佈置作業。</div>`;}catch(err){classNote=`<div class="inline-error" style="margin-top:12px">帳戶已建立，但班級未建立：${esc(err.message)}可在「作業與成績」重新建立班級。</div>`;}}const merged=rows.map((r,i)=>({username:r.username,password:r.password,name:(created[i]&&created[i].name)||r.name||r.username,seat:(created[i]&&created[i].seat)||r.seat||''}));const hasName=merged.some(r=>r.name!==r.username),hasSeat=merged.some(r=>r.seat);const cols=[['學號',r=>r.username]].concat(hasName?[['姓名',r=>r.name]]:[],hasSeat?[['班內號',r=>r.seat]]:[],[['密碼',r=>r.password]]);const text=[cols.map(c=>c[0]).join('\t'),...merged.map(r=>cols.map(c=>c[1](r)).join('\t'))].join('\n');$('#bulk-result').innerHTML=`<div class="import-warning">已建立 ${created.length} 個帳戶${merged.some(r=>r.name===r.username)?`（${merged.filter(r=>r.name===r.username).length} 個未填姓名，以學號顯示）`:""}。密碼只會顯示這一次，請立即複製並私下發給學生。</div>${classNote}<pre class="code-block">${esc(text)}</pre><button class="secondary wide" id="bulk-copy" style="margin-top:10px">${icon('file')}複製帳號密碼</button>`;$('#bulk-copy').onclick=async()=>{try{await navigator.clipboard.writeText(text);toast('已複製，請妥善保管。');}catch{toast('無法自動複製，請手動選取。');}};$('#bulk-students').value='';$('#bulk-class-toggle').checked=false;$('#bulk-class-field').hidden=true;$('#bulk-class-name').value='';bulkPreview();toast(`已建立 ${created.length} 個學生帳戶。`);}catch(err){$('#bulk-error').textContent=err.message;}finally{b.disabled=false;b.innerHTML=icon('upload')+'批次建立學生帳戶';}};}catch(e){toast(e.message);}}
function deploymentHelp(){modal(`<p class="eyebrow">INTRANET SETUP</p><h2>本地啟動與校內使用</h2><p class="modal-intro">網站未發布至公網。請在校內伺服器運行交付目錄內的啟動程式。</p><h3>本機預覽</h3><p class="info-note">雙擊 start.command，或用 Python 3 啟動：</p><pre class="code-block">python3 server.py --host 127.0.0.1 --port 8765</pre><p class="info-note">瀏覽器開啟 http://127.0.0.1:8765。</p><h3>校內連線</h3><p class="info-note">由資訊人員將 --host 設為伺服器的校內 IP，並限制防火牆只允許校內來源；正式使用需反向代理 HTTPS。不要把演示帳戶直接用於全校。</p><h3>目前帳戶範圍</h3><p class="info-note">目前提供一個演示學生和一個演示教師帳戶。教師可在「設定與隱私」建立獨立學生帳戶，避免共用作答紀錄。可在「作業與成績」建立班級並發布作業；校內單一登入及批量帳戶管理仍可再擴充。</p><div class="import-warning">資料保存在 data/mathpath.sqlite3。備份及保存年限應按學校規定安排。AI 必須另行配置，未配置時手写作答由教師批閱。</div>`);}
function navigate(target){if(busy)return toast('目前操作正在進行，請等待完成。');preserveDraft();if(page==='practice'&&strokes.length&&target!=='practice'&&!lastResult&&!confirm('尚未提交的手寫內容未保存。確定離開？'))return;$('#sidebar').classList.remove('open');page=target;switch(target){case'homework':homeworkPage();break;case'calendar':calendarPage();break;case'mock':mockPage();break;case'ai':aiConfigPage();break;case'bank':bank();break;case'practice':practice();break;case'import':importPage();break;case'mistakes':recordsPage();break;case'growth':growthPage();break;case'settings':settingsPage();break;default:bank();}window.scrollTo({top:0,behavior:'instant'});}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;if(b.dataset.fontScale){applyFontScale(b.dataset.fontScale);shell();toast(`字體已設為「${FONT_SCALES.find(([id])=>id===b.dataset.fontScale)[1]}」，只影響這台裝置。`);return;}if(b.dataset.page)return navigate(b.dataset.page);if(b.dataset.assignment)return assignmentPage(Number(b.dataset.assignment));if(b.dataset.mock)return mockExamPage(Number(b.dataset.mock));if(b.dataset.mockQ)return openMockQuestion(Number(b.dataset.mockQ));if(b.dataset.results)return resultsPage(Number(b.dataset.results));if(b.dataset.assignmentQ)return openAssignmentQuestion(Number(b.dataset.assignmentQ));if(b.dataset.qid)return openQuestion(b.dataset.qid);if(b.dataset.topic){topic=b.dataset.topic;subtopic='';currentPage=1;return bank();}if(b.dataset.subtopic){subtopic=b.dataset.subtopic;currentPage=1;return bank();}if(b.dataset.pagination){currentPage=Number(b.dataset.pagination);return renderList();}if(b.dataset.view){viewMode=b.dataset.view;return bank();}if(b.dataset.save){const id=Number(b.dataset.save);if(bookmarks.has(id))bookmarks.delete(id);else bookmarks.add(id);saveBookmarks();b.classList.toggle('saved',bookmarks.has(id));b.setAttribute('aria-pressed',String(bookmarks.has(id)));toast(bookmarks.has(id)?'已收藏題目（本瀏覽器）':'已取消收藏');if(page==='bank'&&topic==='我的收藏')renderList();return;}if(b.dataset.answerMode){if(busy)return toast('正在保存作答，請等待完成。');preserveDraft();answerMode=b.dataset.answerMode;$$('[data-answer-mode]').forEach(x=>x.classList.toggle('active',x===b));renderAnswerArea();return;}if(b.dataset.generate)return generateQuestion(b.dataset.generate);if(b.dataset.removeDraft){drafts.splice(Number(b.dataset.removeDraft),1);return renderImportContent();}if(b.dataset.history){historyFilter=b.dataset.history;return recordsPage();}if(b.dataset.review)return reviewModal(b.dataset.review);switch(b.dataset.action){case'login':loginModal();break;case'close-modal':closeModal();break;case'collection':topic='我的收藏';search='';currentPage=1;bank();break;case'start':requireLogin(()=>{const a=S.attempts.find(a=>a.status==='graded'&&a.score<a.maxScore);openQuestion(a?.questionId||S.questions[0]?.id||1);});break;case'hand-demo':openQuestion(1);break;}});
$('#account').onclick=accountModal;$('#avatar').onclick=accountModal;$('#menu-btn').onclick=()=>$('#sidebar').classList.toggle('open');$('#help-btn').innerHTML=icon('help');$('#help-btn').onclick=()=>modal(`<p class="eyebrow">LEARN WITH MATHPATH</p><h2>讓練習真正帶來理解</h2><ul class="feature-list"><li><strong>01 · 選一個知識點</strong>在題庫搜尋、篩選難度，從基礎題開始。</li><li><strong>02 · 寫出解題過程</strong>用滑鼠或觸控筆手寫、輸入文字，或上傳紙本手稿。</li><li><strong>03 · 看回饋，再練一次</strong>接入 AI 可取得建議評分；教師可覆核並給簡要建議。</li><li><strong>04 · 相似鞏固，進階加深</strong>做同知識點題目，練到能說清楚原因，再挑戰進階題。</li></ul><div class="import-warning">本頁是內網本地版本。AI 未配置時不產生 AI 成績；手寫作答保存為待教師批閱。所有學習紀錄均來自實際提交。</div>`);
const scoreText=v=>v===null||v===undefined?'—':Number(v).toLocaleString('zh-HK',{maximumFractionDigits:1});
const dateText=v=>v?new Date(v).toLocaleString('zh-HK',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const statusText=v=>({not_started:'未開始',in_progress:'作答中',submitted:'已正式提交',correction:'需訂正'}[v]||v);
let HW=null,assignmentDetail=null,resultData=null;
function csvCell(v){const s=String(v??'').replace(/\r?\n/g,' ').trim();const safe=/^[=+\-@\t\r]/.test(s)?`'${s}`:s;return`"${safe.replace(/"/g,'""')}"`;}
function exportResultsCsv(){if(!resultData)return;const a=resultData.assignment,s=resultData.summary;const rows=[['作業',a.title],['班級',a.className],['題數',a.questionCount],['卷面總分',a.totalPoints],['正式提交',`${s.submittedCount} / ${s.studentCount}`],['全題已評平均',s.averageScore??''],['教師確認平均',s.confirmedAverage??''],['待覆核題目',s.pendingReviewCount],['說明','已評得分可能只涵蓋部分題目，不代表整卷總分；待批與未交不當零分。'],[],
['學生','帳號','提交狀態','遲交','已作答題數','待批題數','已評得分','已評涵蓋分值','卷面總分','AI原建議分','規則原分','教師確認分','教師確認題數','建議-做得好的地方','建議-需要留意','建議-下一步'],
...resultData.students.map(st=>[st.name,st.username,statusText(st.status),st.late?'是':'否',st.answeredCount,st.pendingCount,st.score??'',st.scoredPoints,st.totalPoints,st.aiScore??'',st.ruleScore??'',st.confirmedScore??'',st.confirmedCount,st.suggestion?.strength??'',st.suggestion?.focus??'',st.suggestion?.nextStep??''])];const csv='\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`${a.title}-成績.csv`.replace(/[\\/:*?"<>|]/g,'_');document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已匯出成績 CSV，可用試算表開啟。');}
function weakTopic(){const graded=S.attempts.filter(a=>a.status==='graded'&&a.score!==null&&a.maxScore>0);if(!graded.length)return null;const by={};graded.forEach(a=>{const t=by[a.topic]||(by[a.topic]={score:0,max:0,n:0});t.score+=a.score;t.max+=a.maxScore;t.n++;});return Object.entries(by).map(([topic,v])=>({topic,percent:Math.round(v.score*100/v.max),n:v.n})).sort((a,b)=>a.percent-b.percent||b.n-a.n)[0];}
function weakTopicPanel(){const wt=weakTopic();return `<section class="panel right-panel"><h2>${icon('target')}最需要鞏固</h2>${wt?`<p class="field-hint">依已批閱作答計算，不代表完整能力診斷。</p><div class="knowledge-row"><span>${esc(wt.topic)}</span><span>${wt.percent}%</span></div><div class="progress-track"><div class="progress-fill gold" style="width:${wt.percent}%"></div></div><p class="field-hint">已批閱 ${wt.n} 次。先重做錯題，再做同知識點的相似題，最後挑戰進階題。</p><button class="secondary wide" data-topic="${esc(wt.topic)}">開始針對練習 ${icon('arrow')}</button>`:`<p class="field-hint">還沒有已批閱的作答。完成作業或練習後，這裡會指出最需要鞏固的知識點。</p>`}</section>`;}
function homeworkMetrics(items){return `<div class="metric-row">${items.map(([label,value,foot])=>`<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></div>`).join('')}</div>`;}
async function homeworkPage(){page='homework';shell();assignmentContext=null;const teacher=S.user?.role==='teacher';$('#main').innerHTML=heading('ASSIGN · REVIEW · GROW',teacher?'作業與成績':'我的作業',teacher?'把每次作業，轉化為可跟進的學習回饋。':'領取作業，寫下思考，每次提交都有下一步建議。');if(!S.user){$('#main').innerHTML+=`<section class="hero homework-hero"><div><p class="eyebrow">MathPath · 數學作業研習室</p><h2>從一份作業，看見每個學生的進步。</h2><p>教師佈置 · 學生手寫 · AI 建議批閱 · 成績統計 · 個別學習建議</p><button class="primary" id="homework-login">登入作業空間 ${icon('arrow')}</button><button class="secondary" data-page="bank" style="margin-left:10px">瀏覽題庫</button></div></section><div class="homework-features">${[['import','教師佈置作業','建立班級，選題與截止日期，發布後保存題目及學生名單快照。'],['practice','學生寫下思考','逐題保存文字或手稿，完成所有題目後正式提交。'],['growth','批閱與學習建議','AI 接入後可建議評分；教師覆核，分數與每次建議分開記錄。']].map(([i,t,p])=>`<section class="panel"><div class="feature-icon">${icon(i)}</div><h2>${t}</h2><p>${p}</p></section>`).join('')}</div><div class="import-warning" style="margin-top:22px">目前為可運行的本地版本，尚未部署互聯網。未接入真實 AI 時，文字採規則核對、手稿待教師批閱，學習建議標示為規則建議。</div>`;$('#homework-login').onclick=()=>loginModal(homeworkPage);return;}$('#main').innerHTML+='<section class="panel">'+empty('正在讀取作業','從本地伺服器讀取班級與作業紀錄。')+'</section>';try{HW=await api('/api/homework');if(page!=='homework')return;const a=HW.assignments;const submitted=teacher?a.reduce((n,v)=>n+v.submittedCount,0):a.filter(v=>v.myStatus==='submitted').length;$('#main').innerHTML=`<div class="fade-in">${heading('ASSIGN · REVIEW · GROW',teacher?'作業與成績':'我的作業',teacher?'佈置、批阅、統計，用具體建議引導每個學生的下一步。':'依次完成作業，回看回饋，再鞏固最需要練習的知識點。',teacher?`<button class="secondary" id="create-class">${icon('bank')}建立班級</button><button class="primary" id="create-assignment">${icon('import')}佈置作業</button>`:`<button class="secondary" id="refresh-homework">${icon('undo')}重新整理</button>`)}${homeworkMetrics([['已發布作業',a.length,'只顯示你有權查看的作業'],['我的班級',HW.classes.length,teacher?'班級名單由教師建立':'作業只對指定學生開放'],[teacher?'正式提交人次':'已正式提交',submitted,'逐題保存後，需正式提交作業'],['AI 批閱服務',S.ai.configured?'已配置':'待接入',S.ai.configured?'建議分數仍需教師覆核':'手稿待批 · 文字規則核對']])}<div class="homework-layout"><section><div class="section-head"><h2>${teacher?'已發布的作業':'待辦與已交作業'}</h2><div class="section-head-actions"><span class="small-text">${a.length} 份</span><button class="secondary" data-page="calendar">${icon('calendar')}查看日曆</button></div></div><div class="assignment-list">${a.length?a.map(v=>`<article class="panel assignment-card"><div class="assignment-card-head"><span class="assignment-icon">${icon('file')}</span><div><span class="badge">${esc(v.className)}</span><h2>${mathText(v.title)}</h2></div><span class="badge ${new Date(v.dueAt)<new Date()?'l2':''}">${teacher?'已發布':statusText(v.myStatus)}</span></div><div class="assignment-meta"><span>${v.questionCount} 題 · ${v.totalPoints} 分</span><span>${icon('clock')}截止 ${dateText(v.dueAt)}</span></div><div class="assignment-bottom"><span class="small-text">${v.kind==='quiz'?'測驗':'作業'}${v.durationMinutes?` · 限時 ${v.durationMinutes} 分鐘`:''} · ${teacher?`已交 ${v.submittedCount} / ${v.studentCount} 人 · 全題已評 ${v.gradedCount} 人`:`目前已評得分 ${scoreText(v.myScore)} · 教師確認 ${scoreText(v.myConfirmedScore)}`}</span><button class="${teacher?'secondary':'primary'}" ${teacher?'data-results':'data-assignment'}="${v.id}">${teacher?'查看成績與建議':v.myStatus==='submitted'?'查看批閱與建議':'開始／繼續作業'} ${icon('arrow')}</button></div></article>`).join(''):`<section class="panel">${empty(teacher?'還沒有發布作業':'目前沒有指派給你的作業',teacher?'先建立班級，再从題庫選題發布。':'教師發布到你的班級後，作業會出現在這裡。')}</section>`}</div></section><aside class="right-stack">${teacher?'':weakTopicPanel()}<section class="panel right-panel"><h2>${icon('bank')}${teacher?'我的班級':'所屬班級'}</h2>${HW.classes.length?HW.classes.map(c=>`<div class="class-mini"><strong>${esc(c.name)}</strong><span>${c.studentCount} 位學生</span></div>`).join(''):'<p class="field-hint">尚未加入班級。</p>'}${teacher?`<button class="text-button" id="class-manage-link" style="font-size:calc(14px*var(--fs))">建立班級 ${icon('arrow')}</button>`:''}</section><section class="panel right-panel tip-panel"><h2>${icon('bulb')}分數不是學習的終點</h2><p>每次作答都有學習建議：<br>做得好的地方 → 需要留意 → 下一步練習。<br><br>待批阅不當零分；AI 建議分與教師確認分分開保存。</p></section><section class="panel right-panel"><h2>${icon('lock')}運行狀態</h2><p class="field-hint">目前服務在本地運行，未公開到互聯網。AI ${S.ai.configured?'已配置，仍需真實效果核驗':'尚未接入，不產生假評分'}。</p></section></aside></div></div>`;if(teacher){$('#create-class').onclick=createClassModal;$('#class-manage-link').onclick=createClassModal;$('#create-assignment').onclick=createAssignmentModal;}else $('#refresh-homework').onclick=homeworkPage;}catch(e){if(page==='homework')$('#main').innerHTML+=`<div class="inline-error">${esc(e.message)}</div>`;}}
function createClassModal(){if(!HW.students?.length){toast('請先建立獨立學生帳戶。');return navigate('settings');}modal(`<p class="eyebrow">CLASSROOM</p><h2>建立班級</h2><p class="modal-intro">選擇已建立的學生帳戶。每份作業發布時會保存收件名單快照。</p><form id="class-form"><div class="form-field"><label class="field-label" for="class-name">班級名稱</label><input id="class-name" placeholder="例如：中三甲班" maxlength="100" required></div><div class="student-picks">${HW.students.map(s=>`<label class="pick-row"><input type="checkbox" name="students" value="${s.id}"><span>${s.seat?`<span class="seat-badge">${esc(s.seat)}</span>`:''}${esc(s.name)}${s.username===s.name?'':`<small>${esc(s.username)}</small>`}</span></label>`).join('')}</div><p class="error-text" id="class-error"></p><button class="primary wide" type="submit">建立班級 ${icon('check')}</button></form>`);$('#class-form').onsubmit=async e=>{e.preventDefault();const b=$('[type=submit]',e.target);b.disabled=true;try{await api('/api/classes',{name:$('#class-name').value,studentIds:$$('[name=students]:checked').map(x=>Number(x.value))});closeModal();toast('班級已保存。');homeworkPage();}catch(err){$('#class-error').textContent=err.message;b.disabled=false;}};}
function createAssignmentModal(){if(!HW.classes.length)return createClassModal();const qs=S.questions.filter(q=>q.answer?.trim()&&!/待.*(?:核驗|核验|審核|审核|確認|确认)/.test(q.source+' '+q.tags.join(' ')));const due=new Date();due.setDate(due.getDate()+7);due.setHours(23,59,0,0);const local=new Date(due.getTime()-due.getTimezoneOffset()*60000).toISOString().slice(0,16);modal(`<p class="eyebrow">ASSIGN HOMEWORK</p><h2>佈置作業或測驗</h2><p class="modal-intro">題目及分值發布後固定；每題需要已核验參考答案，AI 待核驗題不會列入。</p><form id="assignment-form"><div class="form-grid"><div class="form-field"><label class="field-label" for="assignment-title">作業名稱</label><input id="assignment-title" placeholder="例如：因式分解鞏固練習" maxlength="200" required></div><div class="form-field"><label class="field-label" for="assignment-class">指派班級</label><select id="assignment-class">${HW.classes.map(c=>`<option value="${c.id}">${esc(c.name)} · ${c.studentCount} 人</option>`).join('')}</select></div><div class="form-field"><label class="field-label" for="assignment-due">截止時間（本地時區）</label><input id="assignment-due" type="datetime-local" value="${local}" required></div><div class="form-field"><label class="field-label" for="assignment-kind">類型</label><select id="assignment-kind"><option value="homework">作業</option><option value="quiz">測驗</option></select></div><div class="form-field"><label class="field-label" for="assignment-duration">時間限制（分鐘）</label><input id="assignment-duration" type="number" min="1" max="300" placeholder="留空＝不限時"><p class="field-hint">模擬測驗建議設定 20–45 分鐘；學生按「開始測驗」後倒數，時間到自動提交。</p></div><div class="form-field"><label class="field-label" for="assignment-description">作業說明</label><input id="assignment-description" maxlength="4000" placeholder="寫出完整步驟，並代回檢查。"></div></div><div class="section-head" style="margin:24px 0 12px"><h2 style="font-size:calc(16px*var(--fs))">選擇題目</h2><span class="small-text" id="selected-question-count">已選 0 題</span></div><div class="assignment-question-picks">${qs.map(q=>`<label class="pick-row"><input type="checkbox" name="assignment-questions" value="${q.id}" data-points="${q.points}"><span><strong>${mathText(q.title)}</strong><small>${mathText(q.content)}</small></span><span class="badge l${q.level}">${levels[q.level]} · ${q.points} 分</span></label>`).join('')}</div><label class="checkbox-line"><input id="assignment-late" type="checkbox">允許截止時間後補交（會記錄遲交）</label><label class="checkbox-line"><input id="assignment-ai" type="checkbox" ${S.ai.configured?'':'disabled'}>使用 AI 建議評分與簡評（僅供教師覆核，不直接作正式成績；${S.ai.configured?(S.ai.mode==='local'?'本地模型':'外部模型'):'尚未接入 AI，無法啟用'}）</label><div class="import-warning">學生逐題保存作答後，需正式提交整份作業。正式提交後作答鎖定，教師仍可覆核。上限30題。</div><p class="error-text" id="assignment-error"></p><button class="primary wide" type="submit">發布給班級 ${icon('arrow')}</button></form>`,true);$$('[name=assignment-questions]').forEach(x=>x.onchange=()=>{const chosen=$$('[name=assignment-questions]:checked');$('#selected-question-count').textContent=`已選 ${chosen.length} 題 · ${chosen.reduce((n,x)=>n+Number(x.dataset.points),0)} 分`;});$('#assignment-form').onsubmit=async e=>{e.preventDefault();const b=$('[type=submit]',e.target);b.disabled=true;try{const raw=$('#assignment-due').value,dt=new Date(raw);if(!raw||!Number.isFinite(dt.getTime()))throw new Error('請填寫有效的截止時間。');const durRaw=$('#assignment-duration').value.trim();if(durRaw){const d=Number(durRaw);if(!Number.isInteger(d)||d<1||d>300)throw new Error('時間限制必須是 1 至 300 的整數分鐘。');}await api('/api/assignments',{title:$('#assignment-title').value,kind:$('#assignment-kind').value,classId:Number($('#assignment-class').value),questionIds:$$('[name=assignment-questions]:checked').map(x=>Number(x.value)),dueAt:dt.toISOString(),description:$('#assignment-description').value,allowLate:$('#assignment-late').checked,aiGrading:$('#assignment-ai').checked,durationMinutes:durRaw?Number(durRaw):null});closeModal();toast('作業已發布到指定班級。');homeworkPage();}catch(err){$('#assignment-error').textContent=err.message;b.disabled=false;}};}
let quizClock=null;
function stopQuizClock(){if(quizClock&&quizClock.timer)clearInterval(quizClock.timer);quizClock=null;}
function fmtClock(total){const m=Math.floor(total/60),sec=total%60;return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;}
function quizActive(){return !!(quizClock&&S.user&&S.user.role==='student');}
function startQuizClock(target,remainingSeconds){stopQuizClock();if(!Number.isFinite(remainingSeconds))return;quizClock={target,deadline:Date.now()+remainingSeconds*1000,timer:null};
const tick=()=>{if(!quizClock)return;const left=Math.max(0,Math.round((quizClock.deadline-Date.now())/1000));quizClock.left=left;
document.querySelectorAll('[data-quiz-clock]').forEach(el=>{el.textContent=fmtClock(left);el.classList.toggle('urgent',left<=300);});
document.querySelectorAll('[data-quiz-bar]').forEach(el=>{const total=Number(el.dataset.quizBar)||1;el.style.width=Math.max(0,Math.min(100,left*100/total))+'%';});
if(left<=0){const expiredTarget=quizClock.target;stopQuizClock();autoSubmitQuiz(expiredTarget);}};
tick();quizClock.timer=setInterval(tick,1000);}
async function autoSubmitQuiz(target){toast('測驗時間已結束，系統自動提交並即時計分。');
const url=target.kind==='mock'?`/api/mock/${target.id}/submit`:`/api/assignments/${target.id}/submit`;
try{await api(url,{});}catch(e){/* 可能仍有未作答題目或已提交，仍顯示結果 */}
if(!S.user||S.user.role!=='student')return;
if(target.kind==='mock')mockExamPage(target.id);else if(page==='homework')assignmentPage(target.id);}
function quizClockBadge(){return quizActive()?`<div class="quiz-clock-chip">${icon('clock')}<span data-quiz-clock class="${(quizClock.left??0)<=300?'quiz-clock urgent':'quiz-clock'}">${fmtClock(quizClock.left??0)}</span></div>`:'';}
let mockData=null, mockDetail=null;
function mockTopicPanel(stats){if(!stats||!stats.length)return '';return `<section class="panel right-panel"><h2>${icon('growth')}知識點表現</h2>${stats.map(t=>`<div class="topic-detail"><div class="knowledge-row"><span>${esc(t.topic)}</span><span>${t.percent===null?'待批閱':t.percent+'%'}</span></div><div class="progress-track"><div class="progress-fill" style="width:${t.percent||0}%"></div></div><small class="field-hint">已評 ${t.scoredCount} / ${t.totalCount} 題</small></div>`).join('')}</section>`;}
async function mockPage(){if(!S.user)return loginModal(mockPage);page='mock';shell();stopQuizClock();mockContext=null;
if(S.user.role!=='student'){$('#main').innerHTML=`<div class="fade-in">${heading('MOCK EXAM','模擬測驗','學生自助的限時測驗。')}<section class="panel">${empty('模擬測驗供學生使用','教師請在「作業與成績」為班級佈置限時測驗。')}</section></div>`;return;}
try{mockData=await api('/api/mock');}catch(e){$('#main').innerHTML=`<div class="fade-in">${heading('MOCK EXAM','模擬測驗','')}<section class="panel"><div class="inline-error">${esc(e.message)}</div></section></div>`;return;}
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
<p class="field-hint">題目只從答案已核驗的題庫抽選；按「開始」後即開始倒數，時間到會自動提交並即時計分。${S.ai.configured?'已接入 AI：文字與手寫作答都會即時批閱。':'未接入 AI：文字作答即時核對最終答案；手寫作答會列為待批閱，不計入總分（不會當零分）。'}</p>
<div id="mock-error"></div><button class="primary" id="mock-start">開始模擬測驗 ${icon('arrow')}</button></section>
<section class="panel panel-pad"><div class="section-head"><h2>我的模擬測驗紀錄</h2><span class="small-text">${exams.length} 場</span></div>
${exams.length?`<div class="record-list">${exams.map(e=>`<article class="record"><span class="record-icon">${icon('mock')}</span><div class="record-body"><strong>${esc(e.topic)}${e.subtopic?` › ${esc(e.subtopic)}`:''} · ${e.questionCount} 題 · 限時 ${e.minutes} 分鐘</strong><p>${e.status==='submitted'?`已提交 · ${scoreText(e.score)} / ${e.maxScore} 分${e.percent!=null?`（${e.percent}%）`:''}${e.expired?' · 逾時自動提交':''}${e.pendingCount?` · ${e.pendingCount} 題待批閱`:''}`:`進行中 · 剩餘 ${fmtClock(e.remainingSeconds||0)}`}</p><small>${dateText(e.startedAt)}</small></div><button class="secondary" data-mock="${e.id}">${e.status==='submitted'?'查看結果':'繼續作答'}</button></article>`).join('')}</div>`:'<p class="field-hint">還沒有紀錄。選擇上面的條件開始第一場模擬測驗。</p>'}
</section></div>`;
const syncMockSub=()=>{const sel=$('#mock-subtopic');if(!sel)return;const subs=(o.subtopics||{})[$('#mock-topic').value]||[];sel.innerHTML='<option value="">全部子分類</option>'+subs.map(v=>`<option>${esc(v)}</option>`).join('');};$('#mock-topic').onchange=syncMockSub;syncMockSub();
$('#mock-start').onclick=async()=>{const b=$('#mock-start');b.disabled=true;$('#mock-error').innerHTML='';const body={count:Number($('#mock-count').value),minutes:Number($('#mock-minutes').value)};const topic=$('#mock-topic').value,level=$('#mock-level').value,qtype=$('#mock-qtype').value;if(topic)body.topic=topic;const sub=$('#mock-subtopic')?$('#mock-subtopic').value:'';if(sub)body.subtopic=sub;if(level)body.level=Number(level);if(qtype)body.qtype=qtype;try{const r=await api('/api/mock',body);toast('模擬測驗已開始，請把握時間。');mockExamPage(r.exam.id);}catch(e){$('#mock-error').innerHTML=`<div class="inline-error">${esc(e.message)}</div>`;b.disabled=false;}};}
function openMockQuestion(qid){if(!mockDetail||busy)return;preserveDraft();const q=mockDetail.questions.find(x=>x.id===Number(qid));if(!q)return;if(currentQuestion&&currentQuestion.id!==q.id&&strokes.length&&!lastResult&&!confirm('目前手寫內容尚未提交，確定切換題目？'))return;assignmentContext=null;mockContext={id:mockDetail.exam.id,title:'模擬測驗 · '+mockDetail.exam.topic};currentQuestion=q;lastResult=null;lastSolution=null;answerMode=(q.options&&q.options.length)?'choice':'hand';answerFile=null;selectedOption=null;window.answerTextDraft='';strokes=[];redoStrokes=[];recommendations=null;practice();}
async function mockExamPage(id){if(!S.user)return loginModal(()=>mockExamPage(id));if(S.user.role!=='student')return toast('只有學生可以作答模擬測驗。');if(busy)return toast('請先等待作答保存完成。');preserveDraft();page='mock';shell();$('#sidebar').classList.remove('open');
try{mockDetail=await api(`/api/mock/${id}`);}catch(e){$('#main').innerHTML=`<div class="fade-in"><button class="text-button back-button" data-page="mock">${icon('back')}返回模擬測驗</button>${heading('MOCK EXAM','模擬測驗','')}<section class="panel"><div class="inline-error">${esc(e.message)}</div></section></div>`;return;}
const exam=mockDetail.exam,questions=mockDetail.questions||[],attempts=mockDetail.attempts||[],report=mockDetail.report;
const latest=new Map();attempts.forEach(a=>{if(!latest.has(a.questionId)||latest.get(a.questionId).id<a.id)latest.set(a.questionId,a);});
const submitted=exam.status==='submitted',remaining=exam.remainingSeconds||0,expired=!submitted&&remaining<=0;
const answered=[...latest.keys()].length;
const banner=submitted?`<section class="quiz-banner done"><strong>${icon('check')}測驗已完成 · 即時計分</strong><div class="quiz-score">${scoreText(report?.score)} / ${report?.maxScore} 分${report?.percent!=null?`（${report.percent}%）`:''}</div><small>已評 ${report?.scoredPoints??0} 分${report?.pendingCount?` · ${report.pendingCount} 題待批閱，不計入總分`:''}${exam.expired?' · 逾時自動提交':''}</small></section>`
:expired?`<section class="quiz-banner expired"><strong>${icon('clock')}時間已結束</strong><small>已不能再作答，請提交以取得成績。</small></section>`
:`<section class="quiz-banner"><strong>${icon('clock')}模擬測驗進行中 · 限時 ${exam.minutes} 分鐘</strong><small>剩餘時間 <span class="quiz-clock" data-quiz-clock>${fmtClock(remaining)}</span> · 時間到會自動提交並即時計分。</small><div class="quiz-bar"><span data-quiz-bar="${exam.minutes*60}"></span></div></section>`;
$('#main').innerHTML=`<div class="fade-in"><button class="text-button back-button" data-page="mock">${icon('back')}返回模擬測驗</button>
${heading('MOCK EXAM','模擬測驗 · '+esc(exam.topic),`${exam.questionCount} 題 · 限時 ${exam.minutes} 分鐘${exam.level?' · 難度 '+levels[exam.level]:''}`)}
${banner}
${homeworkMetrics([['已保存題目',`${answered} / ${questions.length}`,'逐題保存不等於正式提交'],['已評得分',report?scoreText(report.score):'—',`僅涵蓋已評 ${report?report.scoredPoints:0} 分，非完整總分`],['待批題目',report?report.pendingCount:0,'待批閱不當零分'],['教師確認分',report?scoreText(report.confirmedScore):'—',`已確認 ${report?report.confirmedCount:0} 題`]])}
<section class="panel panel-pad"><div class="section-head"><h2>本份測驗題目</h2><span class="small-text">${submitted?'已提交，作答已鎖定':expired?'已逾時，不能作答':'可逐題作答與修改'}</span></div>
<div class="assignment-questions">${questions.map((q,i)=>{const at=latest.get(q.id);return `<article class="assignment-question-row"><span class="q-index">${String(i+1).padStart(2,'0')}</span><div class="q-body"><strong>${mathText(q.title)}</strong><span class="badge outline">${esc(q.qtype||'解答題')}</span><span class="badge l${q.level}">${levels[q.level]}</span><span class="small-text">${q.points} 分</span><p class="question-text">${mathText(q.content)}</p><span class="small-text">${at?(at.status==='pending'?'已保存 · 待批閱':`已評 ${scoreText(at.score)} / ${at.maxScore} · ${at.teacherReviewed?'教師確認':'尚未教師確認'}`):'尚未作答'}</span></div>${submitted?`<button class="secondary" data-review="${at?at.id:''}" ${at?'':'disabled'}>查看</button>`:`<button class="practice-btn" data-mock-q="${q.id}" ${expired?'disabled':''}>${at?'修改作答':'開始解題'} ${icon('arrow')}</button>`}</article>`;}).join('')}</div>
<div class="assignment-submit"><p class="field-hint">${submitted?'已提交。模擬測驗只供你本人檢視，不會計入正式成績。':expired?'時間已結束，提交後即時計分。':'完成所有題目後按「提交並即時計分」；含待批閱的手稿也可提交，不會自動記零分。'}</p>${submitted?`<button class="secondary" data-page="mock">返回模擬測驗</button>`:`<button class="primary" id="mock-submit" ${answered?'':'disabled'}>提交並即時計分 ${icon('check')}</button>`}</div></section>
${report?`<div class="result-layout"><section class="panel panel-pad">${suggestionCard(report.suggestion)}</section><aside class="right-stack">${mockTopicPanel(report.topicStats)}</aside></div>`:''}</div>`;
if(!submitted&&!expired&&remaining>0)startQuizClock({kind:'mock',id:exam.id},remaining);else stopQuizClock();
const sb=$('#mock-submit');
if(sb)sb.onclick=async()=>{if(!confirm('提交後不能修改作答，確定提交？'))return;const b=sb;b.disabled=true;try{await api(`/api/mock/${exam.id}/submit`,{});stopQuizClock();toast('已提交並即時計分。');mockExamPage(exam.id);}catch(e){toast(e.message);b.disabled=false;}};}
async function assignmentPage(id){if(busy)return toast('請先等待作答保存完成。');preserveDraft();if(!S.user)return loginModal(()=>assignmentPage(id));if(S.user.role==='teacher')return resultsPage(id);page='homework';shell();$('#sidebar').classList.remove('open');try{const data=await api(`/api/assignments/${id}`);assignmentDetail=data;assignmentContext=null;const {assignment:a,report:r,mySubmission:sub,questions:qs,attempts}=data;const map=new Map();attempts.forEach(x=>{if(!map.has(x.questionId)||map.get(x.questionId).id<x.id)map.set(x.questionId,x);});const submitted=sub.status==='submitted';const late=new Date(a.dueAt)<new Date();const fix=sub.correction;const isQuiz=a.kind==='quiz'&&!!a.durationMinutes;const quizStarted=!!sub.startedAt;const quizExpired=!!sub.expired;const quizBlocked=isQuiz&&!submitted&&!sub.correction&&(!quizStarted||quizExpired);const fixIds=new Set(fix?fix.questionIds:[]);const locked=submitted||!!fix;const inFix=q=>!fix||fixIds.size===0||fixIds.has(q.id);const redone=q=>{const at=map.get(q.id);return!!(at&&fix&&at.id>(fix.minAttemptId??-1));};const pendingFix=fix?qs.filter(inFix).filter(q=>!redone(q)).length:0;$('#main').innerHTML=`<div class="fade-in"><button class="text-button back-button" data-page="homework">${icon('back')}返回我的作業</button>${heading('YOUR ASSIGNMENT',mathText(a.title),`${esc(a.className)} · 截止 ${dateText(a.dueAt)} · ${a.questionCount} 題 / ${a.totalPoints} 分`,`<span class="badge ${submitted?'':'l2'}">${statusText(sub.status)}${sub.late?' · 遲交':''}${sub.submitCount>1?` · 第 ${sub.submitCount} 次提交`:''}</span>`)}${isQuiz&&!submitted?`<div class="quiz-banner${quizExpired?' expired':''}">${icon('clock')}<div class="quiz-banner-body"><strong>模擬測驗 · 限時 ${a.durationMinutes} 分鐘</strong>${!quizStarted?`<small>按「開始測驗」後開始倒數；時間到會自動提交並即時計分。</small>`:quizExpired?`<small>測驗時間已結束，無法再作答。</small>`:`<small>剩餘時間 <span class="quiz-clock" data-quiz-clock>--:--</span> · 時間到會自動提交並即時計分。</small><div class="quiz-bar"><span data-quiz-bar="${a.durationMinutes*60}"></span></div>`}</div>${!quizStarted&&!quizExpired?`<button class="primary" id="start-quiz">開始測驗 ${icon('arrow')}</button>`:''}</div>`:''}${fix?`<div class="correction-banner"><div class="advice-heading">${icon('undo')}教師要求訂正（第 ${fix.round} 回合）</div><p>${esc(fix.note)}</p><small class="field-hint">教師於 ${dateText(fix.requestedAt)} 要求。請完成範圍內題目後按「提交訂正」；教師要求的訂正不受截止時間限制。${pendingFix?`目前尚有 ${pendingFix} 題未重新作答。`:'所有題目已重新作答，可以提交。'}</small></div>`:''}${submitted&&isQuiz?`<div class="quiz-result-banner${r.awaitingReview?' awaiting':''}"><div class="advice-heading">${icon(r.awaitingReview?'clock':'check')}測驗已完成${r.awaitingReview?' · 等待教師批閱':' · 教師已批閱'}</div>${r.awaitingReview?`<p>教師批閱後才會顯示分數與 AI 批閱結果。</p><small class="field-hint">已保存 ${map.size} / ${qs.length} 題 · 待教師批閱 ${r.pendingCount} 題，未當零分。</small>`:`<p class="quiz-result-score"><strong>${scoreText(r.score)}</strong> / ${r.maxScore} 分${r.percent!=null?`（${r.percent}%）`:''}</p><small class="field-hint">已評 ${r.gradedCount} / ${r.questionCount} 題${r.pendingCount?` · ${r.pendingCount} 題待教師批閱，未當零分`:''}。右側「學習建議」已按本次表現更新。</small>`}</div>`:''}${submitted&&r?.awaitingReview&&!isQuiz?`<div class="hint-box" style="margin-bottom:20px">${icon('clock')}作業已提交，等待教師批閱。教師批閱後才會顯示分數、AI 批閱結果、參考答案與學習建議。</div>`:''}${a.aiGrading?`<div class="hint-box" style="margin-bottom:20px">${icon('spark')}本份作業由教師設定使用 AI 建議評分（僅供教師覆核），最終分數以教師確認為準。</div>`:''}${a.description?`<div class="hint-box" style="margin-bottom:20px">${esc(a.description)}</div>`:''}${homeworkMetrics([['已保存題目',`${map.size} / ${qs.length}`,'保存題目不等於正式交作業'],['已評得分',scoreText(r.score),r.awaitingReview?'教師批閱後才顯示':`僅涵蓋已評 ${r.totalScoredPoints} 分，非完整總分`],['待批閱題目',r.pendingCount,'未批閱不當零分'],['教師確認分',scoreText(r.confirmedScore),`已確認 ${r.confirmedCount} / ${qs.length} 題`]])}<div class="homework-layout"><section class="panel assignment-question-list"><div class="panel-heading"><h2>本份作業題目</h2><span class="small-text">${submitted?'作答已鎖定':fix?'只可修改訂正範圍內的題目':'可逐題保存並重做'}</span></div>${qs.map((q,i)=>{const at=map.get(q.id);return `<article class="assignment-question-row"><span class="question-number">${String(i+1).padStart(2,'0')}</span><div class="question-body"><div class="question-top"><h3>${mathText(q.title)}</h3><span class="badge">${q.points} 分</span></div><div class="question-formula">${mathText(q.content)}</div>${optionsHtml(q)}<span class="small-text">${at?(at.awaitingReview?`${submitted?'已提交':'已保存'} · 等待教師批閱`:(at.status==='pending'?'已保存 · 待批閱':`已評 ${at.score}/${at.maxScore} · ${at.teacherReviewed?'教師確認':'尚未教師確認'}`)):'尚未作答'}${fix?(inFix(q)?(redone(q)?' · 已訂正待提交':' · 待訂正'):' · 不需訂正'):''}</span>${at&&(submitted||redone(q))?`${at.awaitingReview?'':`<p class="field-hint">${esc(at.feedback)}</p>`}<button class="text-button" data-review="${at.id}" style="font-size:calc(14px*var(--fs))">${at.awaitingReview?'查看我的作答':'查看手稿與學習建議'} ${icon('arrow')}</button>`:''}</div>${(!locked||(fix&&inFix(q)))&&!quizBlocked?`<button class="practice-btn" data-assignment-q="${q.id}" ${late&&!a.allowLate&&!fix?'disabled':''}>${at?'修改作答':'開始解題'} ${icon('arrow')}</button>`:''}</article>`;}).join('')}<div class="assignment-submit"><p class="field-hint">${fix?`請完成訂正範圍內的 ${fixIds.size||qs.length} 題後提交，教師會重新檢視你的推導。${pendingFix?`目前尚有 ${pendingFix} 題未重新作答。`:'所有題目已重新作答。'}`:submitted?`正式提交於 ${dateText(sub.submittedAt)}${sub.resubmittedAt?` · 最近訂正提交於 ${dateText(sub.resubmittedAt)}`:''}。你可查看結果，教師覆核後分數會更新。`:late&&!a.allowLate?'已超過截止時間，本份作業不接受補交。':'完成所有題目後正式交作業。含待批閱的手稿也可提交，不會自動記零分。'}</p>${fix?`<button class="primary" id="finalize-assignment" ${pendingFix?'disabled':''}>提交訂正 ${icon('check')}</button>`:!submitted?`<button class="primary" id="finalize-assignment" ${map.size!==qs.length||(late&&!a.allowLate)?'disabled':''}>正式提交整份作業 ${icon('check')}</button>`:`<button class="secondary" data-assignment="${a.id}">讀取最新批閱 ${icon('undo')}</button>`}</div></section><aside class="right-stack">${suggestionCard(r.suggestion)}<section class="panel right-panel"><h2>${icon('growth')}知識點表现</h2>${r.topicStats.map(t=>`<div class="topic-detail"><div class="knowledge-row"><span>${esc(t.topic)}</span><span>${t.percent===null?'待批閱':t.percent+'%'}</span></div><div class="progress-track"><div class="progress-fill" style="width:${t.percent||0}%"></div></div><small class="field-hint">已評 ${t.scoredCount} / ${t.totalCount} 題</small></div>`).join('')}</section></aside></div></div>`;for(const at of attempts){const idx=S.attempts.findIndex(x=>x.id===at.id);if(idx<0)S.attempts.push(at);else S.attempts[idx]=at;}if($('#start-quiz'))$('#start-quiz').onclick=async()=>{const b=$('#start-quiz');b.disabled=true;try{await api(`/api/assignments/${id}/start`,{});toast('已開始計時，請把握時間作答。');assignmentPage(id);}catch(e){toast(e.message);b.disabled=false;}};if(isQuiz&&quizStarted&&!submitted&&!quizExpired)startQuizClock({kind:'assignment',id:a.id},sub.remainingSeconds);else stopQuizClock();if($('#finalize-assignment'))$('#finalize-assignment').onclick=async()=>{if(!confirm(fix?'提交訂正後教師會重新檢視，確定提交？':'正式提交後不能修改作答，確定交作業？'))return;const b=$('#finalize-assignment');b.disabled=true;try{await api(`/api/assignments/${id}/submit`,{});toast(fix?'訂正已提交，等待教師重新檢視。':'整份作業已正式提交，待批題目不會當零分。');assignmentPage(id);}catch(e){toast(e.message);b.disabled=false;}};window.scrollTo({top:0});}catch(e){toast(e.message);}}
async function openAssignmentQuestion(qid){if(!assignmentDetail||busy)return;preserveDraft();const q=assignmentDetail.questions.find(q=>q.id===qid);if(!q)return;if(strokes.length&&!lastResult&&page==='practice'&&!confirm('目前手稿尚未提交，確定切換？'))return;assignmentContext=assignmentDetail.assignment;if(assignmentContext.kind==='quiz'&&assignmentContext.durationMinutes&&assignmentDetail.mySubmission.startedAt&&!assignmentDetail.mySubmission.expired)startQuizClock({kind:'assignment',id:assignmentContext.id},assignmentDetail.mySubmission.remainingSeconds);currentQuestion=q;lastResult=null;lastSolution=null;answerMode=(q.options&&q.options.length)?'choice':'hand';answerFile=null;selectedOption=null;strokes=[];redoStrokes=[];window.answerTextDraft='';recommendations=null;practice();try{recommendations=await api(`/api/questions/${qid}/recommendations`);renderRecommendations();}catch(e){toast(e.message);}window.scrollTo({top:0});}
async function resultsPage(id){if(busy)return;if(!S.user)return loginModal(()=>resultsPage(id));page='homework';shell();$('#sidebar').classList.remove('open');try{resultData=await api(`/api/assignments/${id}/results`);assignmentDetail=await api(`/api/assignments/${id}`);const {assignment:a,students,summary:s,topicStats:ts}=resultData;$('#main').innerHTML=`<div class="fade-in"><button class="text-button back-button" data-page="homework">${icon('back')}返回作業與成績</button>${heading('CLASS RESULTS',mathText(a.title),`${esc(a.className)} · ${a.questionCount} 題 / ${a.totalPoints} 分 · 截止 ${dateText(a.dueAt)}${a.aiGrading?' · 已啟用 AI 建議評分':''}`,`<button class="secondary" id="export-results">${icon('file')}匯出成績</button><button class="secondary" data-results="${id}">${icon('undo')}重新整理</button>${(a.aiGrading&&S.ai.configured)?`<button class="primary" id="ai-review-all">${icon('spark')}一鍵 AI 全部批閱</button>`:''}`)}${homeworkMetrics([['正式提交',`${s.submittedCount} / ${s.studentCount}`,s.correctionCount?`其中 ${s.correctionCount} 人訂正中 · 不計入平均`:'人數 · 未交者不計零分'],['全題已評平均',scoreText(s.averageScore),`${s.fullyGradedCount} 人 · 僅正式提交且全題已評`],['教師確認平均',scoreText(s.confirmedAverage),'只計全題教師確認的正式提交'],['待覆核題目',s.pendingReviewCount,'手稿待批及 AI 建議未確認']])}<div class="import-warning" style="margin-bottom:20px">「已評得分」可能僅涵蓋部分題目，不能當完整總分或用於排名。AI 原建議分、規則原分及教師確認分分開保存；只採每題最新作答。</div><section class="panel results-panel"><div class="panel-heading"><h2>學生提交與成績</h2><span class="small-text">${students.length} 位學生</span></div><div class="results-filters" style="padding:0 22px 16px;display:flex;gap:12px;flex-wrap:wrap"><input id="results-search" placeholder="搜尋學生名稱或帳戶" aria-label="搜尋學生" style="padding:10px;border:1px solid var(--border);border-radius:6px"><select id="results-filter" aria-label="提交狀態篩選" style="padding:10px;border:1px solid var(--border);border-radius:6px"><option value="all">全部學生</option><option value="not_started">未開始</option><option value="in_progress">作答中</option><option value="submitted">已正式提交</option><option value="pending">有待批題目</option></select></div><div class="table-scroll"><table class="results-table"><thead><tr><th>學生</th><th>提交狀態</th><th>作答／待批</th><th>已評得分</th><th>AI 原分</th><th>規則原分</th><th>教師確認</th><th>回饋</th></tr></thead><tbody>${students.map(st=>`<tr data-result-user="${st.id}" data-status="${st.status}" data-pending="${st.pendingCount}"><td><strong>${esc(st.name)}</strong><small>${esc(st.username)}</small></td><td><span class="badge ${st.status==='submitted'?'':'l2'}">${statusText(st.status)}</span>${st.late?'<small>遲交</small>':''}${st.correction?`<small>第 ${st.correction.round} 回合訂正</small>`:''}</td><td>${st.answeredCount}/${a.questionCount}<small>待批 ${st.pendingCount} 題</small></td><td>${scoreText(st.score)}<small>涵蓋 ${st.scoredPoints}/${a.totalPoints} 分值</small></td><td>${scoreText(st.aiScore)}</td><td>${scoreText(st.ruleScore)}</td><td>${scoreText(st.confirmedScore)}<small>${st.confirmedCount}/${a.questionCount} 題</small></td><td><button class="practice-btn" data-student-result="${st.id}">批閱與建議 ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div></section><div class="growth-layout" style="margin-top:22px"><section class="panel growth-panel"><h2>班級知識點表現</h2><p>只統計最新已評題目；未作答或待批題目不算零分。</p>${ts.map(t=>`<div class="topic-detail"><div class="knowledge-row"><span>${esc(t.topic)}</span><span>${t.percent===null?'暫無已評數據':t.percent+'%'}</span></div><div class="progress-track"><div class="progress-fill" style="width:${t.percent||0}%"></div></div><small class="field-hint">已評 ${t.scoredCount}/${t.totalCount} 道學生題目</small></div>`).join('')}</section><section class="panel growth-panel"><h2>${icon('bulb')}每位學生，都有下一步</h2><p>點擊「批閱與建議」查看本次的具體回饋。AI 建議依本次批改及最多5次同主題記錄生成；未接入時提供明确標示的規則建議。</p><p>教師覆核後，建議會根據教師的真實評語更新，不把待批手稿當成錯題。</p></section></div></div>`;$$('[data-student-result]').forEach(b=>b.onclick=()=>studentResultModal(Number(b.dataset.studentResult)));const filterRows=()=>{const term=$('#results-search').value.trim().toLowerCase(),state=$('#results-filter').value;$$('[data-result-user]').forEach(row=>{row.hidden=!(row.textContent.toLowerCase().includes(term)&&(state==='all'||state==='pending'&&Number(row.dataset.pending)>0||row.dataset.status===state));});};$('#results-search').oninput=filterRows;$('#results-filter').onchange=filterRows;$('#export-results').onclick=exportResultsCsv;const all=$('#ai-review-all');if(all)all.onclick=()=>aiReviewAll(id);window.scrollTo({top:0});}catch(e){toast(e.message);}}
// 教師一鍵 AI 全部批閱：對尚未批閱的作答逐題 AI 評分並直接確認為教師批閱分數。
async function aiReviewAll(id){const btn=$('#ai-review-all');const external=S.ai.mode==='external';const message=external
  ?'將以 AI 批閱這份作業中所有尚未批閱的作答，作答內容（含手寫圖片）會傳送至學校配置的外部 AI，並直接標記為「教師已批閱」。確定繼續？'
  :'將以 AI 批閱這份作業中所有尚未批閱的作答，並直接標記為「教師已批閱」。確定繼續？';
if(!confirm(message))return;const original=btn.innerHTML;btn.disabled=true;btn.innerHTML=icon('clock')+'正在以 AI 批閱…';try{const r=await api(`/api/assignments/${id}/ai-review`,{consentExternal:external});const parts=[`已批閱 ${r.reviewed} 題`];if(r.failed)parts.push(`${r.failed} 題失敗`);if(r.skipped)parts.push(`${r.skipped} 題已被其他操作處理`);if(r.remaining)parts.push(`還有 ${r.remaining} 題，請再按一次`);toast(parts.join(' · ')+(r.errors?.length?`（${r.errors[0].error}）`:''));await resultsPage(id);}catch(e){toast(e.message);btn.disabled=false;btn.innerHTML=original;}}
function studentResultModal(uid){const st=resultData.students.find(s=>s.id===uid);if(!st)return;const latest=new Map();assignmentDetail.attempts.filter(at=>at.student?.id===uid).forEach(at=>{if(!latest.has(at.questionId)||latest.get(at.questionId).id<at.id)latest.set(at.questionId,at);});modal(`<p class="eyebrow">INDIVIDUAL FEEDBACK</p><h2>${esc(st.name)} · 本次作業</h2><p class="modal-intro">${statusText(st.status)} · 已評 ${scoreText(st.score)} 分（涵蓋 ${st.scoredPoints} 分值） · 教師確認 ${scoreText(st.confirmedScore)} 分</p>${suggestionCard(st.suggestion)}${st.correction?`<div class="correction-banner"><div class="advice-heading">${icon('undo')}訂正中（第 ${st.correction.round} 回合）</div><p>${esc(st.correction.note)}</p><small class="field-hint">已於 ${dateText(st.correction.requestedAt)} 要求訂正 ${st.correction.questionIds.length||assignmentDetail.questions.length} 題。學生重新提交前，此份作業不計入班級平均。</small></div>`:''}<h3 style="margin-top:22px">逐題查看與覆核</h3>${assignmentDetail.questions.map(q=>{const at=latest.get(q.id);return `<div class="student-review-row"><div><strong>${mathText(q.title)}</strong><small>${at?at.status==='pending'?'待批閱':`已評 ${at.score}/${q.points} · ${at.teacherReviewed?'已教師確認':'未教師確認'}`:'尚未作答'}</small></div>${at?`<button class="secondary" data-hw-review="${at.id}">查看／批閱</button>`:''}</div>`;}).join('')}<div class="correction-actions">${st.submittedAt&&!st.correction?`<button class="secondary" id="request-correction">${icon('undo')}退回訂正</button><span class="small-text">讓學生重新作答並再次提交</span>`:`<span class="small-text">${st.correction?'已有進行中的訂正要求。':'此學生尚未正式提交，無需退回訂正。'}</span>`}</div>`,true);for(const at of latest.values()){const idx=S.attempts.findIndex(x=>x.id===at.id);if(idx<0)S.attempts.push(at);else S.attempts[idx]=at;}$$('[data-hw-review]').forEach(b=>b.onclick=()=>{const at=S.attempts.find(x=>x.id===Number(b.dataset.hwReview));closeModal();reviewModal(at.id,()=>resultsPage(resultData.assignment.id),assignmentDetail.questions.find(q=>q.id===at.questionId));});const rc=$('#request-correction');if(rc)rc.onclick=()=>{closeModal();correctionModal(st);};}
function correctionModal(st){const latest=new Map();assignmentDetail.attempts.filter(at=>at.student?.id===st.id).forEach(at=>{if(!latest.has(at.questionId)||latest.get(at.questionId).id<at.id)latest.set(at.questionId,at);});const weak=assignmentDetail.questions.filter(q=>{const at=latest.get(q.id);return at&&at.status==='graded'&&at.score!==null&&at.score<at.maxScore;});const preselect=new Set((weak.length?weak:assignmentDetail.questions).map(q=>q.id));
modal(`<p class="eyebrow">RETURN FOR CORRECTION</p><h2>退回訂正 · ${esc(st.name)}</h2><p class="modal-intro">學生會看到你的說明與批註，並可重新作答指定題目。原作答與分數仍保留在紀錄中，可作對照。</p><form id="correction-form"><div class="form-field"><label class="field-label" for="correction-note">訂正說明（學生會看到）</label><textarea class="answer-field" id="correction-note" style="min-height:110px" maxlength="2000" required placeholder="例如：第1題漏了第二個根。請寫出因式分解的完整過程，並代回檢查兩個解。"></textarea></div><div class="section-head" style="margin:18px 0 10px"><h2 style="font-size:calc(16px*var(--fs))">需要訂正的題目</h2><span class="small-text" id="correction-count">已選 ${preselect.size} 題</span></div><div class="assignment-question-picks">${assignmentDetail.questions.map((q,i)=>{const at=latest.get(q.id);return `<label class="pick-row"><input type="checkbox" name="correction-questions" value="${q.id}" ${preselect.has(q.id)?'checked':''}><span><strong>第 ${i+1} 題 · ${mathText(q.title)}</strong><small>${at?(at.status==='pending'?'目前待批閱':`目前 ${scoreText(at.score)} / ${at.maxScore} 分`):'尚未作答'}</small></span><span class="badge">${q.points} 分</span></label>`;}).join('')}</div><div class="import-warning">退回後學生可重新作答這些題目並再次提交。教師要求的訂正不受截止時間限制；學生重新提交前，這份作業不計入班級平均。</div><p class="error-text" id="correction-error"></p><button class="primary wide" type="submit">退回訂正 ${icon('arrow')}</button></form>`,true);
$$('[name=correction-questions]').forEach(x=>x.onchange=()=>{$('#correction-count').textContent=`已選 ${$$('[name=correction-questions]:checked').length} 題`;});
$('#correction-form').onsubmit=async e=>{e.preventDefault();const ids=$$('[name=correction-questions]:checked').map(x=>Number(x.value));if(!ids.length)return toast('請至少選擇一題。');const b=$('[type=submit]',e.target);b.disabled=true;try{await api(`/api/assignments/${resultData.assignment.id}/return`,{studentId:st.id,note:$('#correction-note').value,questionIds:ids});closeModal();toast('已退回訂正，學生會看到你的說明。');resultsPage(resultData.assignment.id);}catch(err){$('#correction-error').textContent=err.message;b.disabled=false;}};}
async function init(){loadBookmarks();homeworkPage();try{const session=await api('/api/session');serverOnline=true;if(session.user){await refresh();homeworkPage();}}catch(e){toast('尚未連接本地服務；目前為訪客界面預覽。登入需要先啟動伺服器。');}}
init();
