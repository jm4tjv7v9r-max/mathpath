'use strict';
// PDF 模組（app-pdf.js）不在首屏載入：只有真的要下載 PDF 時才抓。
// 首屏少一個請求；載入後全域函式就跟原本一樣可用（第二次點直接命中）。
async function ensurePdfModule(){
  if(typeof window.downloadPaperPdf==='function')return;
  await new Promise((resolve,reject)=>{
    const el=document.createElement('script');
    el.src='/app-pdf.js';
    el.async=true;
    el.onload=()=>resolve();
    el.onerror=()=>reject(new Error('PDF 模組載入失敗，請重新整理再試。'));
    document.head.appendChild(el);
  });
  if(typeof window.downloadPaperPdf!=='function'){
    throw new Error('PDF 模組載入失敗，請重新整理再試。');
  }
}
// 紙本功課：獨立呈現，不混進做題數／正確率，也不進排行榜。
function paperJourneyHtml(st){
  const n=(st&&st.paperCount)||0;
  if(!n)return '';
  const avg=st.paperAverage==null?'—':st.paperAverage+' 分';
  const last=st.paperLastAt?dateText(st.paperLastAt):'—';
  return `<section class="panel panel-pad" style="margin-bottom:16px"><h2 style="margin-bottom:6px">紙本功課</h2>
    <p class="small-text" style="margin:0 0 12px">教師在課堂上批改的紙本功課，獨立統計：不計入上面的做題數與正確率，也不列入排行榜。</p>
    <div style="display:flex;gap:28px;flex-wrap:wrap">
      <div><div class="metric-value">${n}<small> 份</small></div><div class="metric-label">已批改</div></div>
      <div><div class="metric-value">${avg}</div><div class="metric-label">平均分（100 分制）</div></div>
      <div><div class="metric-value" style="font-size:calc(15px*var(--fs))">${last}</div><div class="metric-label">最近一次</div></div>
    </div></section>`;
}
// 卷面排版：記住範本的版式，把新卷套成同樣版面（公式以 Word 方程式保留）。
const DOCX_MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME='application/pdf';
function layoutTemplateHtml(list,current){
  if(!list.length)return '<p class="small-text">還沒有範本。上傳一份排版正確的 Word 開始。</p>';
  return list.map(t=>{const spec=t.spec||{};
    const pos=spec.marksPosition==='leading'?'配分在題號後':spec.marksPosition==='trailing'?'配分靠右':'沒有配分';
    return `<label class="layout-tpl${current&&t.id===current.id?' active':''}">
      <input type="radio" name="layout-tpl" value="${t.id}" ${current&&t.id===current.id?'checked':''}>
      <span class="layout-tpl-main"><strong>${esc(t.name)}</strong>
        <span class="small-text">${esc(String(t.createdAt||'').slice(0,10))} · ${pos} · 每行 ${spec.optionsPerLine||1} 個選項</span></span>
      <button type="button" class="text-button" data-del-tpl="${t.id}" style="color:#b8453b">刪除</button>
    </label>`;}).join('');
}
// 我的試卷：存好的卷可以搜尋、按年份／級別／學段篩選，一鍵把題目匯入題庫。
let paperFilter={q:'',year:'',grade:'',term:''};
// 我的試卷一頁 8 份：清單太長時要一直捲，找一份卷很花時間。
let paperPage=1;
// 剛剛生成過試卷：不論老師用「關閉」、✕ 還是 ESC 離開，回到列表都要立刻看到新卷。
let papersStale=false;
const PAPER_PER_PAGE=8;
const PAPER_GRADES=['小六','中一','中二','中三','中四','中五','中六'];
const PAPER_GRADE_ALIAS={初一:'中一',初二:'中二',初三:'中三',高一:'中四',高二:'中五',高三:'中六'};
// 出卷的年級選項：高中分普通班／職業班，兩者課程不同，出卷要分開。
const GEN_GRADES=['小六','初一','初二','初三',
  '高一（普通班）','高一（職業班）','高二（普通班）','高二（職業班）','高三（普通班）','高三（職業班）'];
// 出卷的參考方向：題目用語與命題風格依哪一套課程（後端 PAPER_REGIONS 要一致）。
const PAPER_REGIONS=['全國','北京','澳門'];
// 「高一（職業班）」→「高一」：入題庫時仍用「中四」這種統一寫法。
const paperGradeBase=g=>String(g||'').replace(/[（(][^）)]*[）)]/g,'').trim();
const bankGrade=g=>{const base=paperGradeBase(g);return PAPER_GRADES.includes(base)?base:(PAPER_GRADE_ALIAS[base]||'中三');};
// 卷名裡通常就寫了年份／級別／學段，保存時先幫老師填好
function guessPaperMeta(title){
  const s=String(title||'');
  return {title:s||'未命名試卷',
    year:(s.match(/20\d{2}/)||[''])[0],
    grade:(s.match(/(?:高[一二三]|初[一二三]|中[一二三四五六])(?:[（(][^）)]*[）)])?/)||[''])[0],
    term:(s.match(/第[一二三四]段/)||[''])[0]};
}
const PAPER_IMPORT_KEY='mathpath_paper_import';
const paperImportPrefs=()=>{try{return JSON.parse(localStorage.getItem(PAPER_IMPORT_KEY)||'{}');}catch(_){return {};}};
// 雙向細目表（生成時存進 papers.blueprint）：知識點 × 難度的題數與分數。
// 「我的試卷」裡隨時可展開重看，不必再回生成流程。
function blueprintTableHtml(b){
  if(!b||!Array.isArray(b.rows)||!b.rows.length)return '';
  const lv=b.levels||['易','中','難'];
  const cell=(topic,level)=>{const c=(topic.cells||{})[level];return c&&c.count
    ?`${c.count} 題<span class="bp-mark">${c.marks} 分</span>`:'<span class="bp-zero">—</span>';};
  const rows=b.rows.map(r=>`<tr><th scope="row">${esc(r.topic)}</th>`
    +lv.map(l=>`<td>${cell(r,l)}</td>`).join('')
    +`<td><strong>${r.count} 題</strong><span class="bp-mark">${r.marks} 分</span></td></tr>`).join('');
  const tot=(b.totals||{});
  const foot=lv.map(l=>{const t=tot[l]||{count:0,marks:0};
    return `<td>${t.count} 題<span class="bp-mark">${t.marks} 分</span></td>`;}).join('');
  const want=lv.map(l=>`${l} ${(b.expected||{})[l]||0}`).join('：');
  const actual=lv.map(l=>`${l} ${(tot[l]||{count:0}).count}`).join('：');
  const check=b.ok?`難度分佈：要求 ${want}；實際 ${actual}，符合 ✓`
    :`難度分佈：要求 ${want}；實際 ${actual}，相差 ${b.diff} 題`;
  return `<table class="bp-table">
    <caption>雙向細目表（知識點 × 難度）</caption>
    <thead><tr><th scope="col">知識點</th>${lv.map(l=>`<th scope="col">${esc(l)}</th>`).join('')}<th scope="col">小計</th></tr></thead>
    <tbody>${rows}<tr class="bp-total"><th scope="row">合計</th>${foot}
      <td><strong>${b.totalCount} 題</strong><span class="bp-mark">${b.totalMarks} 分</span></td></tr></tbody>
  </table>
  <p class="bp-check ${b.ok?'ok':'bad'}">${esc(check)}</p>`;
}
// 我的試卷：同一頁放多張卡片，顏色按年級分。中一／初一同一色，中四／高一同一色…
const GRADE_TONES=[['中一',0],['初一',0],['中二',1],['初二',1],['中三',2],['初三',2],
  ['中四',3],['高一',3],['中五',4],['高二',4],['中六',5],['高三',5]];
function gradeTone(grade){
  const g=String(grade||'').trim();
  const hit=GRADE_TONES.find(([k])=>g.startsWith(k));
  if(hit)return hit[1];
  let h=0;for(const ch of g)h=(h*31+ch.codePointAt(0))%6;   // 其他寫法（例如「中七」）給個穩定色
  return h;
}
// 「新」只屬於剛剛生成的那一份：再生成一份，前一份的「新」就自動消失。
function markNewPaper(id){try{if(id)localStorage.setItem('mathpath.newPaperId',String(id));}catch(e){}}
function newPaperId(){try{return Number(localStorage.getItem('mathpath.newPaperId')||0)||0;}catch(e){return 0;}}

function paperCardHtml(p,newId){
  const prefs=paperImportPrefs();
  const pickTopic=prefs.topic&&topics.includes(prefs.topic)?prefs.topic:topics[0];
  const pickGrade=prefs.grade&&PAPER_GRADES.includes(prefs.grade)?prefs.grade:bankGrade(p.grade);
  const pickLevel=String(prefs.level||2);
  // 年級已經在左上角的標籤，這裡只留年份與學段，卡片才不會重複同一件事
  const meta=[p.year,p.term].filter(Boolean).join(' · ');
  const tone=gradeTone(p.grade);
  const isNew=Number(newId)===Number(p.id);
  return `<article class="paper-card tone-${tone}${isNew?' is-new':''}" data-paper-card="${p.id}">
    <div class="paper-card-head">
      <span class="paper-grade" title="${esc(p.grade||'未分級')}">${esc(p.grade||'未分級')}</span>
      ${isNew?'<span class="paper-new" title="剛剛生成的試卷">新</span>':''}
      <span class="paper-count">${p.questionCount} 題${p.importedCount?` · 已匯入 ${p.importedCount}`:''}</span>
    </div>
    <h3 class="paper-title">${esc(p.title)}</h3>
    <p class="paper-meta">${esc(meta||'未填年份／學段')}</p>
    <div class="paper-actions">
      <button class="primary" data-paper-assign="${p.id}" ${!p.importedCount?'disabled title="這份試卷還沒匯入題庫；先按下方「一鍵匯入題庫」才能出作業"':''}>出作業</button>
      ${p.templateId?`<button class="secondary" data-paper-docx="${p.id}" title="用原範本重新下載 Word">Word</button>`:''}
      <button class="secondary" data-paper-pdf="${p.id}" title="下載 PDF">PDF</button>
      <button class="secondary" data-paper-tex="${p.id}" title="下載 LaTeX（.tex）">.tex</button>
      <button class="text-button" data-paper-del="${p.id}" style="color:#b8453b">刪除</button>
    </div>
    ${p.blueprint?`<details class="paper-blueprint">
      <summary class="text-button">雙向細目表（知識點 × 難度）</summary>
      <div class="gen-blueprint" style="margin-top:8px">${blueprintTableHtml(p.blueprint)}</div>
    </details>`:''}
    <details class="paper-import">
      <summary class="text-button">一鍵匯入題庫（${p.questionCount} 題）</summary>
      <div class="layout-row" style="margin-top:8px">
        <label class="small-text">分類<select data-paper-topic="${p.id}">${topics.map(t=>`<option ${t===pickTopic?'selected':''}>${esc(t)}</option>`).join('')}</select></label>
        <label class="small-text">年級<select data-paper-grade="${p.id}">${PAPER_GRADES.map(g=>`<option ${g===pickGrade?'selected':''}>${g}</option>`).join('')}</select></label>
        <label class="small-text">難度<select data-paper-level="${p.id}">${[['1','易'],['2','中'],['3','難']].map(([v,t])=>`<option value="${v}" ${v===pickLevel?'selected':''}>${t}</option>`).join('')}</select></label>
        <button class="primary" data-paper-import="${p.id}">確認匯入</button>
      </div>
      <p class="field-hint">AI 生成的題目會一併帶入答案與步驟；掃描舊卷拆出來的題目沒有答案，匯入後標成「待核驗」等你在題庫補。題型按有無選項自動判斷。</p>
    </details>
  </article>`;
}
async function papersPage(){
  if(S.user?.role!=='teacher')return bank();
  beginView();page='papers';shell();
  const target=viewTarget();
  const qs=new URLSearchParams();
  ['q','year','grade','term'].forEach(k=>{if(paperFilter[k])qs.set(k,paperFilter[k]);});
  const head=heading('PAPER LIBRARY','我的試卷','存好的卷可以在這裡搜尋、按年份／級別／學段篩選，一鍵把題目匯入題庫。',`<button class="primary" id="generate-paper">${icon('spark')}一鍵生成試卷</button>`);
  let data={papers:[],facets:{years:[],grades:[],terms:[]}};
  try{data=await api('/api/papers'+(qs.toString()?'?'+qs.toString():''));}
  catch(e){if(!viewMatches(target))return;
    $('#main').innerHTML=`<div class="fade-in">${head}<section class="panel"><div class="inline-error">${esc(e.message)}</div></section></div>`;return;}
  if(!viewMatches(target))return;
  const f=data.facets||{};
  // 一頁 8 份（一行兩份 × 4 排），其餘分頁
  const totalPages=Math.max(1,Math.ceil(data.papers.length/PAPER_PER_PAGE));
  if(paperPage>totalPages)paperPage=totalPages;
  if(paperPage<1)paperPage=1;
  const shown=data.papers.slice((paperPage-1)*PAPER_PER_PAGE, paperPage*PAPER_PER_PAGE);
  const newest=newPaperId();
  const pagerHtml=totalPages>1?`<div class="paper-pager">
      <button class="secondary" id="paper-prev"${paperPage<=1?' disabled':''}>← 上一頁</button>
      <span class="small-text">第 ${paperPage} / ${totalPages} 頁</span>
      <button class="secondary" id="paper-next"${paperPage>=totalPages?' disabled':''}>下一頁 →</button>
    </div>`:'';
  const pick=(list,cur,label)=>`<option value="">${label}</option>`+
    (list||[]).map(v=>`<option ${v===cur?'selected':''}>${esc(v)}</option>`).join('');
  $('#main').innerHTML=`<div class="fade-in">${head}
    <section class="panel panel-pad" style="margin-bottom:16px">
      <div class="layout-row">
        <input id="paper-q" placeholder="搜尋卷名或題目文字" value="${esc(paperFilter.q)}">
        <select id="paper-year">${pick(f.years,paperFilter.year,'全部年份')}</select>
        <select id="paper-grade">${pick(f.grades,paperFilter.grade,'全部級別')}</select>
        <select id="paper-term">${pick(f.terms,paperFilter.term,'全部學段')}</select>
        <button class="primary" id="paper-q-go">搜尋</button>
        <button class="secondary" id="paper-q-clear">清除</button>
      </div>
      <p class="field-hint" style="margin-top:8px">共 ${data.papers.length} 份試卷${data.papers.length>PAPER_PER_PAGE?`（每頁 ${PAPER_PER_PAGE} 份）`:''}</p>
    </section>
    ${data.papers.length?`<div class="paper-grid">${shown.map(p=>paperCardHtml(p,newest)).join('')}</div>`+pagerHtml
      :empty('還沒有試卷','在「卷面排版」排好一份卷之後，按「保存到我的試卷」就會出現在這裡。')}
  </div>`;
  const applyFilter=()=>{paperPage=1;papersPage();};
  const pv=$('#paper-prev'), nx=$('#paper-next');
  if(pv)pv.onclick=()=>{if(paperPage>1){paperPage--;papersPage();}};
  if(nx)nx.onclick=()=>{if(paperPage<totalPages){paperPage++;papersPage();}};
  const go=$('#paper-q-go');
  if(go)go.onclick=()=>{paperFilter.q=($('#paper-q').value||'').trim();applyFilter();};
  const box=$('#paper-q');
  if(box)box.onkeydown=e=>{if(e.key==='Enter'){paperFilter.q=(box.value||'').trim();applyFilter();}};
  [['#paper-year','year'],['#paper-grade','grade'],['#paper-term','term']].forEach(([sel,key])=>{
    const el=$(sel);if(el)el.onchange=()=>{paperFilter[key]=el.value;applyFilter();};});
  const clear=$('#paper-q-clear');
  if(clear)clear.onclick=()=>{paperFilter={q:'',year:'',grade:'',term:''};applyFilter();};
  $$('[data-paper-del]').forEach(b=>b.onclick=async()=>{
    if(await askCancel('刪除這份試卷？已匯入題庫的題目不受影響。'))return;
    try{await fetch('/api/papers/'+b.dataset.paperDel,{method:'DELETE',credentials:'same-origin'})
      .then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'刪除失敗');});
      toast('已刪除');papersPage();
    }catch(e){toast(e.message);}
  });
  const gp=$('#generate-paper');
  if(gp)gp.onclick=generatePaperModal;
  $$('[data-paper-assign]').forEach(b=>b.onclick=()=>paperAssignModal(b.dataset.paperAssign));
  $$('[data-paper-docx]').forEach(b=>b.onclick=async()=>{
    const old=b.textContent;b.disabled=true;b.textContent='產生中…';
    try{
      const res=await api('/api/papers/'+b.dataset.paperDocx+'/to-docx',{});
      const a=document.createElement('a');a.href=res.docx;a.download=res.filename;a.click();
    }catch(e){toast(e.message);}
    b.disabled=false;b.textContent=old;
  });
  $$('[data-paper-pdf]').forEach(b=>b.onclick=async()=>{
    const old=b.textContent;b.disabled=true;b.textContent='產生中…';
    try{
      // 先拿跟 Word 同一份 layout_plan，PDF 的卷頭／題號／配分／卷尾才一致。
      const [detail,pr]=await Promise.all([
        api('/api/papers/'+b.dataset.paperPdf),
        api('/api/papers/'+b.dataset.paperPdf+'/pdf-plan',{})
      ]);
      const p=detail.paper||{};
      await ensurePdfModule();
      await downloadPaperPdf({
        title:p.title||'', meta:{grade:p.grade,term:p.term}, sections:p.sections||[],
        plan:pr.plan||null,
        filename:(p.title||'試卷').replace(/[\\/:*?"<>|]/g,'_')+'.pdf',
        onStatus:t=>{b.textContent=t;}
      });
    }catch(e){toast(e.message);}
    b.disabled=false;b.textContent=old;
  });
  $$('[data-paper-tex]').forEach(b=>b.onclick=async()=>{
    const old=b.textContent;b.disabled=true;b.textContent='產生中…';
    try{
      const res=await api('/api/papers/'+b.dataset.paperTex+'/to-tex',{});
      // 有題目圖形時回 zip（.tex + figures/）；沒圖維持單一 .tex
      const a=document.createElement('a');
      if(res.texZip){a.href=res.texZip;a.download=res.filename.replace(/\.tex$/, '.zip');}
      else{a.href=URL.createObjectURL(new Blob([res.tex],{type:'text/x-tex;charset=utf-8'}));a.download=res.filename;}
      a.click();
    }catch(e){toast(e.message);}
    b.disabled=false;b.textContent=old;
  });
  $$('[data-paper-import]').forEach(b=>b.onclick=async()=>{
    const id=b.dataset.paperImport;
    const body={topic:$(`[data-paper-topic="${id}"]`).value,
                grade:$(`[data-paper-grade="${id}"]`).value,
                level:Number($(`[data-paper-level="${id}"]`).value)};
    const old=b.textContent;b.disabled=true;b.textContent='匯入中…';
    try{
      localStorage.setItem(PAPER_IMPORT_KEY,JSON.stringify(body));
      const res=await api('/api/papers/'+id+'/to-bank',body);
      toast(res.skipped?`已匯入 ${res.count} 題，略過 ${res.skipped} 題重複`
                        :`已匯入 ${res.count} 題到題庫`);
      await refresh().catch(()=>{});   // 題庫清單與側欄題數跟著更新
      papersPage();
    }catch(e){toast(e.message);b.disabled=false;b.textContent=old;}
  });
}
// 題庫匯出 CSV：匯出「目前篩選出來的」題目，老師可以拿去 Excel 統計或交給同事
function exportQuestionsCsv(){
  const list=filteredQuestions();
  if(!list.length)return toast('目前沒有符合條件的題目。');
  const head=['題號','標題','題目','分類','子分類','年級','難度','分值','題型','參考答案',
              '選項','標籤','來源','入庫時間','有圖形','核驗狀態'];
  const rows=[head];
  list.forEach(q=>rows.push([
    q.id, q.title, q.content, q.topic, q.subtopic||'', q.grade||'',
    levels[q.level]||q.level, q.points, q.qtype||'解答題', q.answer||'',
    (q.options||[]).map((o,i)=>`${'ABCDEFGHIJ'[i]}. ${o}`).join('  '),
    (q.tags||[]).join(' '), q.source||'',
    q.createdAt?fmtWhen(q.createdAt):'', q.figure?'有':'',
    needsReview(q)?'待核驗':'已核驗']));
  const csv='\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;
  link.download=`MathPath-題庫-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast(`已匯出 ${list.length} 題，可用試算表開啟`);
}
// 批次修改：一份卷匯入的題目常常跨多個知識點，逐題改太慢
function bulkEditModal(){
  const ids=[...pickedQuestions];
  if(!ids.length)return toast('先勾選要修改的題目。');
  modal(`<h2>批次修改</h2>
    <p class="field-hint">已選 ${ids.length} 題；只有你選的欄位會被改，其餘保持原樣。</p>
    <div class="form-field"><label class="field-label" for="bulk-topic">知識分類</label>
      <select id="bulk-topic"><option value="">不改</option>${topics.map(t=>`<option>${esc(t)}</option>`).join('')}</select></div>
    <div class="form-field"><label class="field-label" for="bulk-grade">年級</label>
      <select id="bulk-grade"><option value="">不改</option>${PAPER_GRADES.map(g=>`<option>${g}</option>`).join('')}</select></div>
    <div class="form-field"><label class="field-label" for="bulk-level">難度</label>
      <select id="bulk-level"><option value="">不改</option><option value="1">易</option><option value="2">中</option><option value="3">難</option></select></div>
    <button class="primary" id="bulk-submit">套用</button>`);
  $('#bulk-submit').onclick=async()=>{
    const patch={};
    const topic=$('#bulk-topic').value, grade=$('#bulk-grade').value, level=$('#bulk-level').value;
    if(topic)patch.topic=topic;
    if(grade)patch.grade=grade;
    if(level)patch.level=Number(level);
    if(!Object.keys(patch).length)return toast('沒有選要改的欄位。');
    const btn=$('#bulk-submit');const old=btn.textContent;btn.disabled=true;btn.textContent='套用中…';
    try{
      const res=await api('/api/questions/bulk',{ids,action:'update',patch});
      closeModal();
      pickedQuestions.clear();
      toast(`已修改 ${res.updated.length} 題${res.skipped.length?`，${res.skipped.length} 題略過`:''}`);
      await refresh().catch(()=>{});
      bank();
    }catch(e){toast(e.message);btn.disabled=false;btn.textContent=old;}
  };
}
async function bulkDeleteQuestions(){
  const ids=[...pickedQuestions];
  if(!ids.length)return toast('先勾選要刪除的題目。');
  if(await askCancel(`刪除已選的 ${ids.length} 題？\n已經有作答紀錄的題目不會被刪（作答是學生成績的一部分）。`))return;
  try{
    const res=await api('/api/questions/bulk',{ids,action:'delete'});
    pickedQuestions.clear();
    toast(`已刪除 ${res.removed.length} 題${res.skipped.length?`，${res.skipped.length} 題有作答紀錄沒有刪`:''}`);
    await refresh().catch(()=>{});
    bank();
  }catch(e){toast(e.message);}
}
// 反向組卷：從題庫勾選題目 → 直接出一份卷（存進「我的試卷」並下載）
async function buildPaperModal(){
  const ids=[...pickedQuestions];
  if(!ids.length)return toast('先勾選要組卷的題目。');
  const tpls=await api('/api/paper-templates').catch(()=>({templates:[]}));
  const list=tpls.templates||[];
  const now=new Date(), pad=n=>String(n).padStart(2,'0');
  const defaultTitle=`自選題試卷 ${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  modal(`<h2>組成試卷</h2>
    <p class="field-hint">已選 ${ids.length} 題，會按題型分成「一、選擇題 / 二、填空題…」，並存進「我的試卷」。</p>
    <div class="form-field"><label class="field-label" for="build-title">卷名</label>
      <input id="build-title" value="${esc(defaultTitle)}"></div>
    <div class="layout-row">
      <input id="build-year" list="build-year-list" value="${now.getFullYear()}" placeholder="年份" style="max-width:120px">
      <input id="build-grade" list="build-grade-list" placeholder="級別" style="max-width:120px">
      <input id="build-term" list="build-term-list" placeholder="學段" style="max-width:120px">
      <select id="build-template"><option value="">只出 LaTeX（不套範本）</option>
        ${list.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
    </div>
    <datalist id="build-year-list">${[0,1,2,3].map(i=>`<option>${now.getFullYear()-i}</option>`).join('')}</datalist>
    <datalist id="build-grade-list">${['初一','初二','初三','高一','高二','高三'].map(g=>`<option>${g}</option>`).join('')}</datalist>
    <datalist id="build-term-list">${['第一段','第二段','第三段'].map(t=>`<option>${t}</option>`).join('')}</datalist>
    <button class="primary" id="build-submit" style="margin-top:12px">建立並下載</button>`);
  $('#build-submit').onclick=async()=>{
    const btn=$('#build-submit');const old=btn.textContent;btn.disabled=true;btn.textContent='組卷中…';
    try{
      const tplId=Number($('#build-template').value)||undefined;
      const res=await api('/api/papers/from-questions',{
        questionIds:ids,
        title:($('#build-title').value||'').trim()||defaultTitle,
        year:($('#build-year').value||'').trim(),
        grade:($('#build-grade').value||'').trim(),
        term:($('#build-term').value||'').trim(),
        ...(tplId?{templateId:tplId}:{})});
      const a=document.createElement('a');
      if(res.docx){a.href=res.docx;a.download=res.docxName;}
      else{a.href=URL.createObjectURL(new Blob([res.tex],{type:'text/x-tex;charset=utf-8'}));a.download=res.texName;}
      a.click();
      closeModal();
      pickedQuestions.clear();
      toast(`已建立「${res.paper.title}」，可在「我的試卷」再下載或出作業`);
      bank();
    }catch(e){toast(e.message);btn.disabled=false;btn.textContent=old;}
  };
}
// 登入紀錄：管理員看全部（含教師），一般教師只看自己班上的學生
async function loginLogModal(){
  let data;
  try{data=await api('/api/logins');}catch(e){return toast(e.message);}
  const rows=(data.events||[]).map(e=>`<tr>
    <td>${esc(e.name)}<span class="small-text"> ${esc(e.username)}</span></td>
    <td>${e.role==='teacher'?'教師':'學生'}</td>
    <td>${esc(fmtWhen(e.at))}</td>
    <td>${esc(e.ip||'—')}</td></tr>`).join('');
  modal(`<p class="eyebrow">ACCESS LOG</p><h2>登入紀錄</h2>
    <p class="modal-intro">${data.scope==='all'
      ?'所有教師與學生的登入時間與 IP（最近 200 筆）。'
      :'你班上學生的登入時間與 IP（最近 200 筆）。'}</p>
    <div class="table-scroll"><table class="results-table">
      <thead><tr><th>帳號</th><th>身分</th><th>登入時間</th><th>IP</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="4">還沒有登入紀錄。</td></tr>'}</tbody></table></div>`,true);
}
// AI 批改品質：老師最想知道「AI 準不準、哪裡不準」。
// 只看「教師改過分」的案例——沒改分不代表 AI 一定對，但改了一定有原因。
async function aiQualityModal(){
  let d;
  try{d=await api('/api/ai-grading/stats');}catch(e){return toast(e.message);}
  const sign=v=>v==null?'—':`${v>0?'+':''}${v} 分`;
  const tone=v=>v==null?'':(v<0?'style="color:#b8453b"':'style="color:#1f7a52"');
  const head=`<p class="eyebrow">AI GRADING</p><h2>AI 批改品質</h2>
    <p class="modal-intro">用「教師改過分」的案例看 AI 判得準不準。平均調整為正＝AI 給低了（教師調高），為負＝AI 給高了。</p>`;
  if(!d.total){
    return modal(`${head}<div class="hint-box">${icon('help')}還沒有 AI 批改紀錄。先在佈置作業時啟用「AI 建議評分」，學生提交後再回來看。</div>`,true);
  }
  const metric=(label,value,foot)=>`<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></div>`;
  const rows=(d.byTopic||[]).map(t=>`<tr>
      <td>${esc(t.topic)}${t.qtype?` <span class="small-text">${esc(t.qtype)}</span>`:''}</td>
      <td>${t.n}</td>
      <td>${t.raised} / ${t.lowered}</td>
      <td ${tone(t.avgDelta)}>${sign(t.avgDelta)}</td></tr>`).join('');
  modal(`${head}
    <div class="metric-row">${[
      metric('AI 批改題數', d.total, `已由 AI 給分的作答`),
      metric('教師已覆核', d.reviewed, d.reviewed?`覆核率 ${Math.round(d.reviewed*100/d.total)}%`:'還沒有人覆核'),
      metric('教師改分比例', d.changeRate==null?'—':d.changeRate+'%', `改高 ${d.raised} 題 · 改低 ${d.lowered} 題`),
      metric('平均調整', sign(d.avgDelta), d.avgDelta==null?'沒有改分紀錄':(d.avgDelta<0?'AI 偏高':'AI 偏低'))
    ].join('')}</div>
    ${d.flagged?`<div class="hint-box">${icon('help')}有 <strong>${d.flagged}</strong> 題被系統標記「建議覆核」（AI 分數與規則核對衝突），建議優先看。</div>`:''}
    ${rows?`<table class="board-table" style="margin-top:14px">
      <thead><tr><th>知識點</th><th>改分次數</th><th>調高 / 調低</th><th>平均調整</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="field-hint">只列改分最多的前 12 個知識點。同一知識點反覆被調低，通常代表 AI 對這類題目給分偏寬。</p>`
    :'<p class="field-hint">還沒有教師改分的紀錄，所以看不出個別知識點的偏差。</p>'}
    <button class="secondary wide" style="margin-top:14px" data-page="homework">前往作業與成績 ${icon('arrow')}</button>`,true);
}
// 現在所屬學年的起始年：8 月開始算新學年（2026-08 → 2026/2027 → 回 2026）。
function guessSchoolYear(){
  const d=new Date(), y=d.getFullYear();
  return String(d.getMonth()+1>=8?y:y-1);
}
// 一鍵生成試卷：選範本 → 填範圍與配分 → AI 出題（伺服器會逐項核對）→ 排版存檔
async function generatePaperModal(){
  let tpls=[];
  // 配分覆核等提醒（來自 /api/papers/preview），要在預覽頁看得到
  let genWarnings=[];
  try{tpls=(await api('/api/paper-templates')).templates||[];}catch(e){return toast(e.message);}
  const rangeRow=(v='')=>`<div class="range-row"><input class="range-input" value="${esc(v)}" maxlength="120" placeholder="例如：直線的傾斜角與斜率"><button type="button" class="text-button range-del" aria-label="刪除這個範圍">✕</button></div>`;
  // 每個題型：勾選要不要，並直接填「幾題」。老師最常說的就是「選擇題 8 題、填空題 6 題…」。
  const QTYPE_DEFAULT_COUNT={'選擇題':8,'填空題':6,'解答題':4,'證明題':2,'附加題':1};
  const chip=(t)=>{
    const on=['選擇題','填空題','解答題'].includes(t);
    return `<div class="gen-chip${on?' on':''}">
      <label class="gen-chip-head"><input type="checkbox" class="gen-qtype" value="${t}" ${on?'checked':''}>${t}</label>
      <span class="gen-count-wrap"><input type="number" class="gen-count" data-type="${t}" min="0" max="40" value="${QTYPE_DEFAULT_COUNT[t]||0}" aria-label="${t}題數"><span class="small-text">題</span></span>
    </div>`;
  };
  modal(`<p class="eyebrow">AI PAPER</p><h2>一鍵生成試卷</h2>
    <p class="modal-intro">選範本 → 填範圍與配分 → 挑題目 → 確定。預設先從題庫挑題，分數不夠才由 AI 補；配分由程式核算，總分一定等於你填的分數。</p>
    <div id="gen-form-step">
    <div class="gen-tpl-row">
      <div class="form-field"><label class="field-label" for="gen-template">範本</label>
        <select id="gen-template">${tpls.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
      <div class="form-field">
        <div class="gen-tpl-actions">
          <button type="button" class="secondary" id="gen-upload">${icon('file')}上傳新範本（.docx／.pdf）</button>
          <button type="button" class="text-button danger-text" id="gen-tpl-del">刪除這個範本</button>
        </div>
        <input type="file" id="gen-tpl-file" accept=".docx,.pdf" hidden></div>
    </div>
    ${tpls.length?'':'<p class="field-hint" style="margin:6px 0 0">還沒有範本；先上傳一份學校的空白卷（.docx 或 .pdf），版式會原樣沿用。</p>'}
    <div class="form-field"><label class="field-label">測考範圍（可加多個）</label>
      <div id="gen-ranges">${rangeRow()}</div>
      <button type="button" class="text-button" id="gen-add-range">＋ 增加範圍</button></div>
    <div class="gen-grid">
      <div class="form-field"><label class="field-label" for="gen-year">學年</label><input id="gen-year" type="number" min="2000" max="2099" value="${guessSchoolYear()}" placeholder="例如 2026"></div>
      <div class="form-field"><label class="field-label" for="gen-duration">時間（分鐘）</label><input id="gen-duration" type="number" min="10" max="300" value="40"></div>
      <div class="form-field"><label class="field-label" for="gen-grade">年級</label><select id="gen-grade">${GEN_GRADES.map(g=>`<option>${g}</option>`).join('')}</select></div>
      <div class="form-field"><label class="field-label" for="gen-kind">類型</label><select id="gen-kind">${['練習','小測','大測','大測一','大測二','大測三','大測四','考試'].map(k=>`<option ${k==='大測'?'selected':''}>${k}</option>`).join('')}</select></div>
      <div class="form-field"><label class="field-label" for="gen-term">段</label><select id="gen-term"><option>第一段</option><option>第二段</option><option>第三段</option></select></div>
      <div class="form-field"><label class="field-label" for="gen-subject">科目</label><select id="gen-subject"><option>數學</option><option>幾何</option></select></div>
      <div class="form-field"><label class="field-label" for="gen-region">參考方向</label><select id="gen-region">${PAPER_REGIONS.map(r=>`<option ${r==='全國'?'selected':''}>${r}</option>`).join('')}</select></div>
      <div class="form-field"><label class="field-label" for="gen-total">總分（正卷）</label><input id="gen-total" type="number" min="10" max="300" value="100"></div>
    </div>
    <div class="gen-block" style="margin-top:14px">
      <div class="gen-block-head">
        <p class="field-label">題型要求</p>
        <div class="gen-inline" id="gen-options-row">選擇題選項
          <label><input type="radio" name="gen-opt" value="4" checked>4 個</label>
          <label><input type="radio" name="gen-opt" value="5">5 個</label></div>
      </div>
      <div class="gen-chips">${['選擇題','填空題','解答題','證明題','附加題'].map(chip).join('')}</div>
      <p class="field-hint" style="margin:6px 0 0">勾選題型並填題數；配分由程式平均分配（同一題型每題同分），總分一定等於你填的分數。
        同一題型會混用不同寫法：直接計算、情境應用、圖表資訊、逆向求證、開放探究、易錯辨析，預覽時每題都會標出來，不滿意的可以單題「更換」。</p>
    </div>
    <div class="gen-block" style="margin-top:12px">
      <div class="gen-block-head">
        <p class="field-label">參考文檔（選填，可多份）</p>
        <button type="button" class="text-button" id="gen-ref-add">＋ 加入 PDF／圖片</button>
      </div>
      <p class="field-hint" style="margin:0">舊卷、課程文件或題目截圖都可以：PDF 直接抽文字，圖片交給 AI 讀成摘要，出題時一併參考。</p>
      <div id="gen-ref-list" class="gen-ref-list"></div>
      <input type="file" id="gen-ref-file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif" multiple hidden>
    </div>
    <div class="gen-pair">
      <div class="gen-block"><p class="field-label">題目來源</p>
        <div class="gen-inline">
          <label><input type="radio" name="gen-source" value="bank" checked>題庫優先（不足才由 AI 補）</label>
          <label><input type="radio" name="gen-source" value="ai">全部由 AI 出題</label></div></div>
      <div class="gen-block"><p class="field-label">難度比例（易：中：難，合共 10）</p>
        <div class="gen-diff">
          <input id="gen-diff-easy" type="number" min="0" max="10" value="7" aria-label="易的比例"><span>：</span>
          <input id="gen-diff-mid" type="number" min="0" max="10" value="2" aria-label="中的比例"><span>：</span>
          <input id="gen-diff-hard" type="number" min="0" max="10" value="1" aria-label="難的比例">
          <span class="small-text gen-diff-sum" id="gen-diff-sum">合共 10</span></div></div>
    </div>
    <p class="field-hint" style="margin-top:12px">總分指「正卷」分數：填 100 分就是正卷 100 分，附加題另加 10 分（卷面 110 分），不佔正卷分數。</p>
    <p class="error-text" id="gen-error"></p>
    <button class="primary wide" id="gen-submit">列出題目 ${icon('spark')}</button>
    </div>
    <div id="gen-preview-step" hidden></div>`,'large gen-modal');
  const ranges=$('#gen-ranges');
  // 直接在這個視窗上傳範本：不必先跳去「卷面排版」，上傳完自動選好。
  $('#gen-upload').onclick=()=>$('#gen-tpl-file').click();
  $('#gen-tpl-file').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    // PDF 沒有結構，要靠 AI 讀版面；走外部模型前先明確問一次。
    const isPdf=/pdf$/i.test(file.name||'')||file.type===PDF_MIME;
    if(isPdf&&S.ai.mode==='external'&&
       await askCancel('PDF 範本要先交給 AI 分析版面（整份檔案會上傳到外部模型）。要繼續嗎？')){
      e.target.value='';return;
    }
    const btn=$('#gen-upload');const old=btn.innerHTML;
    btn.disabled=true;btn.innerHTML=isPdf?'AI 分析版面中…':'上傳中…';
    try{
      const data=await fileData(file,isPdf?[PDF_MIME]:[DOCX_MIME],12);
      const res=await api('/api/paper-templates',{
        name:(file.name||'').replace(/\.(docx|pdf)$/i,'')||'未命名範本',
        file:data,consentExternal:isPdf&&S.ai.mode==='external'});
      const sel=$('#gen-template');
      const opt=document.createElement('option');
      opt.value=res.template.id;opt.textContent=res.template.name;
      sel.appendChild(opt);sel.value=String(res.template.id);
      toast('範本已上傳，可以直接生成試卷');
    }catch(err){toast(err.message);}
    finally{btn.disabled=false;btn.innerHTML=old;e.target.value='';}
  };
  // 刪除範本：只刪這一個範本檔，已生成的試卷不受影響（它們各自存了內容）。
  $('#gen-tpl-del').onclick=async()=>{
    const sel=$('#gen-template');
    const id=Number(sel&&sel.value||0);
    if(!id)return toast('請先選一個範本。');
    const name=sel.options[sel.selectedIndex]?sel.options[sel.selectedIndex].textContent:'';
    if(await askCancel(`刪除範本「${name}」？刪除後要重新上傳才能再用它排版。`,
                       {root:'#modal-root-2',danger:true,confirmText:'刪除'}))return;
    try{
      await api(`/api/paper-templates/${id}`,{},'DELETE');
      sel.remove(sel.selectedIndex);
      toast(`已刪除範本「${name}」`);
      if(!sel.options.length){
        // 一個範本都不剩：把「上傳」推到最前面，避免老師對著空下拉按生成。
        const hint=document.createElement('p');
        hint.className='field-hint';
        hint.textContent='還沒有範本；先上傳一份學校的空白卷（.docx 或 .pdf），版式會原樣沿用。';
        sel.closest('.gen-tpl-row').after(hint);
      }
    }catch(e){toast(e.message);}
  };
  $('#gen-add-range').onclick=()=>{ranges.insertAdjacentHTML('beforeend',rangeRow());};
  ranges.addEventListener('click',e=>{
    const del=e.target.closest('.range-del');if(!del)return;
    if(ranges.children.length<=1)return toast('至少要有一個測考範圍。');
    del.closest('.range-row').remove();
  });
  const syncOptions=()=>{
    const on=[...document.querySelectorAll('.gen-qtype')].some(x=>x.value==='選擇題'&&x.checked);
    $('#gen-options-row').style.display=on?'flex':'none';
    // 勾選中的題型用實心樣式標示，一眼看得出選了哪幾個。
    $$('.gen-chip').forEach(chip=>{
      const box=$('input',chip);
      chip.classList.toggle('on',!!(box&&box.checked));
    });
  };
  $$('.gen-qtype').forEach(x=>x.onchange=syncOptions);syncOptions();
  // 難度比例：三格加起來必須是 10，邊打邊提示，不必等送出才發現。
  const diffInputs=['#gen-diff-easy','#gen-diff-mid','#gen-diff-hard'].map(s=>$(s));
  const diffSum=()=>diffInputs.reduce((n,i)=>n+(Number(i.value)||0),0);
  const syncDiff=()=>{
    const sum=diffSum();const el=$('#gen-diff-sum');
    el.textContent=sum===10?'合共 10':`合共 ${sum}，不等於 10`;
    el.style.color=sum===10?'':'#b8453b';
  };
  diffInputs.forEach(i=>i.oninput=syncDiff);syncDiff();
  // 附加題是額外的 10 分：總分改動時只更新提示，不自動勾選（勾不勾由老師決定）。
  // 參考文檔：上傳後立刻換成文字（PDF 抽文、圖片請視覺模型寫摘要），出題時一併交給 AI。
  const refs=[];
  const renderRefs=()=>{
    const box=$('#gen-ref-list');if(!box)return;
    box.innerHTML=refs.map((r,i)=>`<span class="gen-ref-chip">${esc(r.name)}<span class="small-text">${r.chars} 字</span><button type="button" class="gen-ref-del" data-ref-del="${i}" aria-label="移除 ${esc(r.name)}">✕</button></span>`).join('');
    $$('[data-ref-del]',box).forEach(b=>b.onclick=()=>{refs.splice(Number(b.dataset.refDel),1);renderRefs();});
  };
  $('#gen-ref-add').onclick=()=>$('#gen-ref-file').click();
  $('#gen-ref-file').onchange=async e=>{
    const files=[...(e.target.files||[])];
    if(!files.length)return;
    const btn=$('#gen-ref-add');const old=btn.innerHTML;
    for(const file of files){
      if(refs.length>=5){toast('最多 5 份參考文檔。');break;}
      btn.disabled=true;btn.innerHTML='讀取中…';
      try{
        const fixed=await normalizeHeicFile(file);
        const data=await readAsDataUrl(fixed||file);
        const res=await api('/api/papers/refs',{file:data,filename:file.name,
          consentExternal:S.ai.mode==='external'});
        refs.push({name:file.name,kind:res.kind,chars:res.chars,text:res.text});
        renderRefs();
      }catch(err){toast(`${file.name}：${err.message}`);}
      finally{btn.disabled=false;btn.innerHTML=old;}
    }
    e.target.value='';
  };

  // 把表單內容整理成一份請求；「列出題目」與「確定生成」都用同一份設定。
  const formPayload=()=>{
    const err=$('#gen-error');err.textContent='';
    const tplId=Number($('#gen-template').value||0);
    if(!tplId){err.textContent='請先上傳或選一個範本。';return null;}
    const list=[...ranges.querySelectorAll('.range-input')].map(i=>i.value.trim()).filter(Boolean);
    if(!list.length){err.textContent='請至少填一個測考範圍。';return null;}
    // 題型＋題數：勾了才算；題數填 0 當作不要這一種；留空＝由 AI 決定題數。
    const qtypes=[];
    document.querySelectorAll('.gen-qtype').forEach(box=>{
      if(!box.checked)return;
      const input=document.querySelector(`.gen-count[data-type="${box.value}"]`);
      const raw=input?input.value.trim():'';
      const n=raw===''?null:Number(raw);
      if(n===0)return;
      const entry={type:box.value};
      if(n&&n>0)entry.count=Math.min(40,n);
      qtypes.push(entry);
    });
    if(!qtypes.length){err.textContent='請至少選一種題型，並填上題數。';return null;}
    const total=Number($('#gen-total').value)||100;
    const extraOn=qtypes.some(t=>t.type==='附加題');
    const pickedCount=qtypes.reduce((a,t)=>a+(t.count||0),0);
    if(pickedCount&&pickedCount>total+(extraOn?10:0)){
      err.textContent=`題數共 ${pickedCount} 題，比總分 ${total} 分（附加題另加 10 分）還多；請減少題數或提高總分。`;
      return null;
    }
    const opt=document.querySelector('input[name=gen-opt]:checked');
    qtypes.forEach(t=>{if(t.type==='選擇題')t.optionCount=Number(opt?opt.value:4);});
    const difficulty={易:Number($('#gen-diff-easy').value)||0,
                      中:Number($('#gen-diff-mid').value)||0,
                      難:Number($('#gen-diff-hard').value)||0};
    if(difficulty.易+difficulty.中+difficulty.難!==10){
      err.textContent=`難度比例（易：中：難）相加要等於 10，現在是 ${difficulty.易+difficulty.中+difficulty.難}。`;return null;}
    const source=(document.querySelector('input[name=gen-source]:checked')||{}).value||'bank';
    return {templateId:tplId,ranges:list,
            year:Number($('#gen-year').value)||guessSchoolYear(),
            duration:Number($('#gen-duration').value)||40,
            grade:$('#gen-grade').value,examKind:$('#gen-kind').value,term:$('#gen-term').value,
            subject:$('#gen-subject').value,region:$('#gen-region').value,
            reference:refs.map(r=>`【${r.name}】\n${r.text}`).join('\n\n').slice(0,6000),
            qtypes,totalPoints:total,difficulty,source,
            // 請伺服器多跑一次「配分覆核」：總分由程式保證，這裡檢查單題配分合不合理
            reviewMarks:true,
            consentExternal:S.ai.mode==='external'};
  };

  let plan=null, base=null;   // plan＝預覽中的題目（每題有 on 表示是否選用）；base＝這份卷的設定

  // 雙向細目表：知識點 × 難度，順便核對難度比例是否符合要求。
  const blueprintHtml=()=>{
    if(!plan)return '';
    const levels=['易','中','難'];
    const chosen=plan.flatMap(sec=>sec.questions.filter(q=>q.on).map(q=>({...q,qtype:sec.qtype})));
    if(!chosen.length)return '<p class="field-hint">還沒有選任何題目。</p>';
    const rows=new Map();
    chosen.forEach(q=>{
      const topic=(q.topic||'').trim()||'（未標知識點）';
      if(!rows.has(topic))rows.set(topic,{易:[0,0],中:[0,0],難:[0,0]});
      const cell=rows.get(topic)[levels.includes(q.difficulty)?q.difficulty:'中'];
      cell[0]+=1;cell[1]+=Number(q.marks)||0;
    });
    const totals={易:[0,0],中:[0,0],難:[0,0]};
    const body=[...rows.entries()].map(([topic,cells])=>{
      levels.forEach(l=>{totals[l][0]+=cells[l][0];totals[l][1]+=cells[l][1];});
      const n=levels.reduce((a,l)=>a+cells[l][0],0),m=levels.reduce((a,l)=>a+cells[l][1],0);
      const tds=levels.map(l=>cells[l][0]
        ?`<td>${cells[l][0]} 題<span class="bp-mark">${cells[l][1]} 分</span></td>`:'<td class="bp-zero">—</td>').join('');
      return `<tr><th scope="row">${esc(topic)}</th>${tds}<td><strong>${n} 題</strong><span class="bp-mark">${m} 分</span></td></tr>`;
    }).join('');
    const tn=levels.reduce((a,l)=>a+totals[l][0],0),tm=levels.reduce((a,l)=>a+totals[l][1],0);
    const ratio=base.difficulty||{易:7,中:2,難:1};
    const sum=(ratio.易+ratio.中+ratio.難)||10;
    const exact=levels.map(l=>tn*ratio[l]/sum);
    const expect=exact.map(v=>Math.floor(v));
    let rest=tn-expect.reduce((a,b)=>a+b,0);
    exact.map((v,i)=>[v-Math.floor(v),i]).sort((a,b)=>b[0]-a[0])
      .forEach(([,i])=>{if(rest>0){expect[i]+=1;rest-=1;}});
    const ok=levels.every((l,i)=>totals[l][0]===expect[i]);
    const diff=levels.map((l,i)=>totals[l][0]-expect[i]).reduce((a,b)=>a+Math.abs(b),0);
    const actual=levels.map(l=>`${l} ${totals[l][0]}`).join('：');
    const want=levels.map((l,i)=>`${l} ${expect[i]}`).join('：');
    const foot=`<tr class="bp-total"><th scope="row">合計</th>${levels.map(l=>`<td>${totals[l][0]} 題<span class="bp-mark">${totals[l][1]} 分</span></td>`).join('')}<td><strong>${tn} 題</strong><span class="bp-mark">${tm} 分</span></td></tr>`;
    return `<table class="bp-table">
        <caption>雙向細目表（知識點 × 難度）</caption>
        <thead><tr><th scope="col">知識點</th>${levels.map(l=>`<th scope="col">${l}</th>`).join('')}<th scope="col">小計</th></tr></thead>
        <tbody>${body}${foot}</tbody>
      </table>
      <p class="bp-check ${ok?'ok':'bad'}">難度分佈：要求 ${want}；實際 ${actual}${ok?'，符合 ✓':`，相差 ${diff} 題`}</p>`;
  };

  const syncTotals=()=>{
    if(!plan)return;
    const all=plan.flatMap(s=>s.questions);
    const chosen=all.filter(q=>q.on);
    const sum=chosen.reduce((n,q)=>n+(Number(q.marks)||0),0);
    // 卷面總分＝正卷＋附加題（附加題另加 10 分，不佔正卷）。
    const paperTotal=base.totalPoints+(base.qtypes.some(t=>t.type==='附加題')?10:0);
    const picked=$('#gen-picked'), marks=$('#gen-marks'), note=$('#gen-marks-note');
    if(picked)picked.textContent=chosen.length;
    if(marks)marks.textContent=sum;
    if(note)note.textContent=sum===paperTotal?'':`（確定後會平均調整為 ${paperTotal} 分）`;
    const btn=$('#gen-confirm');
    if(btn)btn.disabled=!chosen.length;
    const bp=$('#gen-blueprint');
    if(bp)bp.innerHTML=blueprintHtml();
  };

  const renderPlan=()=>{
    const box=$('#gen-preview-step');if(!box)return;
    let n=0;
    const rows=plan.map((sec,si)=>{
      const on=sec.questions.filter(q=>q.on).length;
      return `<div class="gen-sec">
        <div class="gen-sec-head">
          <p class="gen-sec-title">${esc(sec.title||sec.qtype||'題目')}<span class="small-text">　${on} / ${sec.questions.length} 題</span></p>
          <button type="button" class="text-button" data-add="${si}">＋ 增加一題</button>
        </div>
        ${sec.questions.map((q,qi)=>{
          n+=1;
          return `<div class="gen-qrow${q.on?'':' off'}" data-row="${si}-${qi}">
            <label class="gen-qcheck"><input type="checkbox" data-check="${si}-${qi}" ${q.on?'checked':''} aria-label="選用第 ${n} 題"></label>
            <div class="gen-qbody">
              <p class="gen-qmeta">第 ${n} 題 · ${q.marks} 分${q.difficulty?` · ${q.difficulty}`:''}${q.style?` · ${esc(q.style)}`:''}${q.bankId?' · 題庫':''}${q.source&&!/^(校本題庫|AI 生成|自編)$/.test(q.source)?` · 來源：${esc(q.source)}`:''}</p>
              <p class="gen-qstem">${mathText(q.stem)}</p>
              ${(q.options||[]).length?`<p class="gen-qopts">${q.options.map(o=>mathText(o)).join('　')}</p>`:''}
              ${q.figure
                ? `<div class="gen-qfig"><img src="${q.figure}" alt="第 ${n} 題圖形"><button type="button" class="text-button" data-figure="${si}-${qi}">${icon('practice')}改圖</button><button type="button" class="text-button danger-text" data-figure-remove="${si}-${qi}" aria-label="移除第 ${n} 題圖形">${icon('trash')}刪圖</button></div>`
                : (q.needsFigure?`<div class="gen-qfig empty">
                    <span class="small-text">${q.figBusy?'AI 正在依題目畫圖…':'這題是平面幾何，還沒有圖'}</span>
                    <button type="button" class="secondary" data-figure="${si}-${qi}" ${q.figBusy?'disabled':''}>${icon('spark')}${q.figBusy?'畫圖中…':'AI 畫圖'}</button>
                  </div>`:'')}
              ${q.answer?`<p class="gen-qans">${icon('check')}<span>答案：${mathText(q.answer)}</span></p>`:''}
            </div>
            <span class="gen-qrow-actions">
              <button type="button" class="text-button gen-qreplace" data-replace="${si}-${qi}">更換</button>
              <button type="button" class="text-button danger-text" data-del="${si}-${qi}" aria-label="刪除第 ${n} 題">刪除</button>
            </span>
          </div>`;}).join('')}
      </div>`;}).join('');
    box.innerHTML=`<p class="eyebrow">STEP 2 / 2</p><h2>確認題目</h2>
      <p class="modal-intro">共 ${n} 題。可以取消勾選不要的題目、按「更換」請 AI 重出那一題、或按「刪除」整題拿掉；按「確定」才排版存檔。</p>
      ${genWarnings.length?`<div class="gen-warn">${genWarnings.map(w=>`<p>${esc(w)}</p>`).join('')}</div>`:''}
      <div id="gen-blueprint" class="gen-blueprint"></div>
      <div class="gen-preview">${rows}</div>
      <div class="gen-preview-foot">
        <span class="small-text">已選 <b id="gen-picked">0</b> / ${n} 題 · 合計 <b id="gen-marks">0</b> 分<span id="gen-marks-note"></span></span>
        <span class="gen-foot-actions">
          <button class="secondary" id="gen-back">返回修改</button>
          <button class="primary" id="gen-confirm">確定生成試卷</button>
        </span>
      </div>`;
    $$('[data-check]',box).forEach(el=>el.onchange=()=>{
      const [si,qi]=el.dataset.check.split('-').map(Number);
      plan[si].questions[qi].on=el.checked;
      const row=$(`[data-row="${si}-${qi}"]`,box);
      if(row)row.classList.toggle('off',!el.checked);
      const head=row&&row.parentElement.querySelector('.gen-sec-title .small-text');
      if(head){const sec=plan[si];head.textContent=`　${sec.questions.filter(q=>q.on).length} / ${sec.questions.length} 題`;}
      syncTotals();
    });
    $$('[data-replace]',box).forEach(el=>el.onclick=()=>replaceQuestion(el.dataset.replace,el));
    $$('[data-add]',box).forEach(el=>el.onclick=()=>addQuestion(Number(el.dataset.add),el));
    $$('[data-del]',box).forEach(el=>el.onclick=()=>deleteQuestion(el.dataset.del,el));
    $$('[data-figure]',box).forEach(el=>el.onclick=()=>openFigureForQuestion(el.dataset.figure));
    $$('[data-figure-remove]',box).forEach(el=>el.onclick=()=>removeFigureForQuestion(el.dataset.figureRemove));
    $('#gen-back').onclick=()=>{$('#gen-preview-step').hidden=true;$('#gen-form-step').hidden=false;};
    $('#gen-confirm').onclick=confirmGenerate;
    syncTotals();
  };

  // 題目圖形：AI 只算座標、由程式畫成 SVG 再轉 PNG（網站內同一套畫圖工具），
  // 8cm 寬剛好半頁，Word 與 .tex 都不會爆版。
  const FIGURE_CX=8*360000;
  let figAutoDone=false;
  const drawFigureFor=async (si,qi)=>{
    const q=plan[si].questions[qi];
    if(!q||q.figBusy)return;
    q.figBusy=true;renderPlan();
    try{
      const r=await api('/api/questions/ai-figure',{content:q.stem,topic:'幾何',
        qtype:plan[si].qtype||'解答題',consentExternal:S.ai?.mode==='external'});
      const png=await svgToPng(r.svg,700);
      q.figure=png.data;
      q.figureCx=Math.round((png.widthCm||8)*360000);
      if((r.issues||[]).length)toast('圖形仍有疑慮：'+r.issues[0]);
    }catch(e){toast(e.message);}
    q.figBusy=false;renderPlan();
  };
  // 老師按「改圖」：開同一套圖形工作室（疊在確認頁上面），改完寫回這一題
  const openFigureForQuestion=key=>{
    const [si,qi]=String(key).split('-').map(Number);
    const q=plan[si]&&plan[si].questions[qi];
    if(!q)return;
    openFigureStudio({
      title:(plan[si].title||'')+' · 第 '+(qi+1)+' 題',
      content:q.stem,topic:'幾何',subtopic:'',qtype:plan[si].qtype||'解答題',
      figure:q.figure||'',
      root:'#modal-root-2',
      apply:async figure=>{
        q.figure=figure||'';
        if(figure)q.figureCx=q.figureCx||FIGURE_CX;
        closeModal();
        renderPlan();
        toast(figure?'已更新這題的圖形':'已移除這題的圖形');
      }});
  };
  // 直接刪掉這一題的圖形（不用進工作室），删掉後若原本是需要圖的幾何題，
  // 就回到「還沒有圖」的提示，老師可再按 AI 畫圖補回來。
  const removeFigureForQuestion=key=>{
    const [si,qi]=String(key).split('-').map(Number);
    const q=plan[si]&&plan[si].questions[qi];
    if(!q||!q.figure)return;
    q.figure='';q.figureCx=0;q.figTried=false;
    renderPlan();
    toast('已移除這題的圖形');
  };
  // 確認頁一出來就自動為平面幾何題畫圖；一次最多 4 張（每張都是一次模型呼叫）
  const autoDrawGeometry=async ()=>{
    if(figAutoDone)return;
    figAutoDone=true;
    const queue=[];
    plan.forEach((sec,si)=>sec.questions.forEach((q,qi)=>{
      if(q.on&&q.needsFigure&&!q.figure&&!q.figTried)queue.push([si,qi]);}));
    for(const [si,qi] of queue.slice(0,4)){
      plan[si].questions[qi].figTried=true;
      await drawFigureFor(si,qi);
    }
  };

  const replaceQuestion=async (key,btn)=>{
    const [si,qi]=key.split('-').map(Number);
    const q=plan[si].questions[qi];
    const old=btn.textContent;btn.disabled=true;btn.textContent='更換中…';
    try{
      const res=await api('/api/papers/replace',{
        qtype:plan[si].qtype||'解答題',marks:q.marks,
        optionCount:(base.qtypes.find(t=>t.type==='選擇題')||{}).optionCount||4,
        ranges:base.ranges,difficulty:q.difficulty||'中',
        avoid:plan.flatMap(s=>s.questions.map(x=>x.stem)).slice(0,12),
        avoidStyles:[...new Set(plan[si].questions.filter((_,i)=>i!==qi).map(x=>x.style).filter(Boolean))],
        consentExternal:S.ai.mode==='external'});
      plan[si].questions[qi]={...res.question,on:q.on};
      renderPlan();
      toast('已更換一題');
    }catch(e){toast(e.message);btn.disabled=false;btn.textContent=old;}
  };

  // 預覽時「增加一題」：沿用該分部的題型與每題分數，只請 AI 再出這一題。
  const addQuestion=async (si,btn)=>{
    const sec=plan[si];if(!sec)return;
    const marks=sec.questions.length?Math.max(1,Math.round(Number(sec.questions[0].marks)||5)):5;
    const old=btn.textContent;btn.disabled=true;btn.textContent='出題中…';
    try{
      const res=await api('/api/papers/add-question',{
        qtype:sec.qtype||'解答題',marks,
        optionCount:(base.qtypes.find(t=>t.type==='選擇題')||{}).optionCount||4,
        ranges:base.ranges,difficulty:'中',
        avoid:plan.flatMap(s=>s.questions.map(x=>x.stem)).slice(0,16),
        avoidStyles:[...new Set(sec.questions.map(x=>x.style).filter(Boolean))],
        consentExternal:S.ai.mode==='external'});
      sec.questions.push({...res.question,on:true});
      renderPlan();
      toast(`已增加一題（${sec.title||sec.qtype}）`);
    }catch(e){toast(e.message);btn.disabled=false;btn.textContent=old;}
  };

  // 預覽時「刪除這題」：老師不想要的題目直接拿掉，不佔配分。
  // 整段刪完的題型會跟著從卷面消失（排版時跳過空分部）。
  const deleteQuestion=async (key)=>{
    const [si,qi]=String(key).split('-').map(Number);
    const sec=plan[si];if(!sec)return;
    sec.questions.splice(qi,1);
    // 整段刪空的分部跟著消失（排版時會重新編「一、二、三」）。
    plan=plan.filter(s=>s.questions.length);
    renderPlan();
    toast('已刪除一題');
  };

  const confirmGenerate=async ()=>{
    const btn=$('#gen-confirm');
    const chosen=plan.map(s=>({title:s.title,questions:s.questions.filter(q=>q.on)
        .map(q=>({stem:q.stem,marks:q.marks,options:q.options||[],lines:q.lines||[],
                  answer:q.answer||'',steps:q.steps||[],
                  difficulty:q.difficulty||'',topic:q.topic||'',source:q.source||'',
                  style:q.style||'',
                  figures:q.figure?[{data:q.figure,cx:q.figureCx||FIGURE_CX,cy:0}]:[]}))}))
      .filter(s=>s.questions.length);
    if(!chosen.length)return toast('請至少保留一題。');
    const old=btn.textContent;btn.disabled=true;btn.textContent='排版中…';
    try{
      const res=await api('/api/papers/generate',{...base,sections:chosen});
      // 不再自動下載：先給一張「已完成」的結果頁，老師要 Word 再按。
      // 以前按「確定」就跳下載，檔案去哪了、存到哪裡都看不清楚。
      const p=res.paper||{};
      const warn=(res.warnings||[]).slice(0,3);
      const box=$('#gen-preview-step');
      box.innerHTML=`<p class="eyebrow">DONE</p><h2>試卷已生成</h2>
        <p class="modal-intro">「${esc(p.title||'')}」共 ${p.questionCount||0} 題，已存進「我的試卷」。
        需要檔案再按下面的按鈕下載。</p>
        ${warn.length?`<div class="inline-error">${esc(warn.join('；'))}</div>`:''}
        <div class="gen-done-actions">
          <button class="primary" id="gen-dl-docx">${icon('file')}下載 Word</button>
          <button class="secondary" id="gen-dl-pdf">下載 PDF</button>
          <button class="secondary" id="gen-dl-tex">下載 LaTeX（.tex）</button>
          <button class="text-button" id="gen-done-close">關閉</button>
        </div>
        <p class="field-hint">之後也可以在「我的試卷」重新下載、出作業或一鍵匯入題庫。</p>`;
      const docx=res.docx, fname=res.filename, pid=p.id;
      markNewPaper(pid);
      papersStale=true;
      // 換掉內容後，原本的 h2 id 不見了；把 aria-labelledby 接回新的標題，
      // 讀屏才不會念出一個不存在的標題。
      const lbl=$('.modal')&&$('.modal').getAttribute('aria-labelledby');
      const h2=box.querySelector('h2');
      if(lbl&&h2)h2.id=lbl;
      if(h2){h2.tabIndex=-1;h2.focus();}   // 內容換過後焦點會掉到 body，ESC 就關不掉視窗
      $('#gen-dl-docx').onclick=()=>{
        const a=document.createElement('a');a.href=docx;a.download=fname;a.click();
      };
      $('#gen-dl-pdf').onclick=async ev=>{
        const b=ev.currentTarget, old2=b.textContent;
        b.disabled=true;b.textContent='排版中…';
        try{
          // 跟 Word/LaTeX 一樣用存檔時記住的範本排一份 plan 出來，PDF 才會是同一份卷。
          const pr=await api('/api/papers/'+pid+'/pdf-plan',{});
          await ensurePdfModule();
          await downloadPaperPdf({
            title:p.title||'', meta:base||{}, sections:chosen,
            plan:pr.plan||null,
            filename:fname.replace(/\.docx$/i,'.pdf'),
            onStatus:t=>{b.textContent=t;}
          });
        }catch(err){toast(err.message);}
        b.disabled=false;b.textContent=old2;
      };
      $('#gen-dl-tex').onclick=async ev=>{
        const b=ev.currentTarget, old2=b.textContent;
        b.disabled=true;b.textContent='產生中…';
        try{
          const r=await api('/api/papers/'+pid+'/to-tex',{});
          const a=document.createElement('a');
          if(r.texZip){a.href=r.texZip;a.download=r.filename.replace(/\.tex$/, '.zip');}
          else{a.href=URL.createObjectURL(new Blob([r.tex],{type:'text/x-tex;charset=utf-8'}));a.download=r.filename;}
          a.click();
        }catch(err){toast(err.message);}
        b.disabled=false;b.textContent=old2;
      };
      $('#gen-done-close').onclick=closeModal;
      toast('試卷已生成並存進「我的試卷」');
    }catch(e){toast(e.message);btn.disabled=false;btn.textContent=old;}
  };

  $('#gen-submit').onclick=async()=>{
    const payload=formPayload();
    if(!payload)return;
    const btn=$('#gen-submit');const old=btn.innerHTML;
    btn.disabled=true;
    btn.textContent=payload.source==='bank'?'挑題中…（題庫不足才會請 AI）':'AI 出題中…（約 20–60 秒）';
    try{
      const res=await api('/api/papers/preview',payload);
      base=payload;
      plan=(res.sections||[]).map(s=>({...s,questions:(s.questions||[]).map(q=>({...q,on:true}))}));
      if(!plan.length)throw new Error('沒有產生任何題目，請調整範圍或改用「全部由 AI 出題」。');
      genWarnings=res.warnings||[];
      if(genWarnings.length)toast(genWarnings[0]);
      $('#gen-form-step').hidden=true;
      $('#gen-preview-step').hidden=false;
      figAutoDone=false;
      renderPlan();
      autoDrawGeometry();
    }catch(e){toast(e.message);}
    btn.disabled=false;btn.innerHTML=old;
  };
}

// 從「我的試卷」直接出作業：用這份卷匯入題庫的那批題目。
// 作業端點有硬條件（每題要有答案、且不能掛「待核驗」），所以在這裡先檢查並說清楚。
async function paperAssignModal(paperId){
  let detail, homework;
  try{
    [detail,homework]=await Promise.all([api('/api/papers/'+paperId),api('/api/homework')]);
  }catch(e){return toast(e.message);}
  const ids=(detail.paper&&detail.paper.questionIds)||[];
  if(!ids.length)return toast('這份試卷還沒匯入題庫，先在卡片上按「一鍵匯入題庫」。');
  const classes=(homework.classes||[]).filter(c=>c.studentCount>0);
  if(!classes.length)return toast('還沒有可用的班級，請先在「作業與成績」建立班級與學生。');
  const missing=ids.filter(qid=>{
    const q=S.questions.find(x=>x.id===qid);
    return !q||!(q.answer||'').trim()||needsReview(q);
  });
  const due=new Date(Date.now()+7*86400000);
  due.setHours(18,0,0,0);
  const pad=n=>String(n).padStart(2,'0');
  const dueLocal=`${due.getFullYear()}-${pad(due.getMonth()+1)}-${pad(due.getDate())}T18:00`;
  const title=(detail.paper.title||'作業').slice(0,60);
  modal(`<h2>出作業</h2>
    <p class="field-hint">用「${esc(detail.paper.title)}」匯入題庫的 ${ids.length} 題，直接變出一份作業。</p>
    ${missing.length?`<div class="inline-error">有 ${missing.length} 題還沒有答案或還沒核驗，作業會建立失敗。
      <button type="button" class="text-button" id="assign-goto-bank" style="margin-left:6px">去題庫核驗 ${icon('arrow')}</button></div>`:''}
    <div class="form-field"><label class="field-label" for="assign-class">班級</label>
      <select id="assign-class">${classes.map(c=>`<option value="${c.id}">${esc(c.name)}（${c.studentCount} 人）</option>`).join('')}</select></div>
    <div class="form-field"><label class="field-label" for="assign-title">作業標題</label>
      <input id="assign-title" value="${esc(title)}"></div>
    <div class="form-field"><label class="field-label" for="assign-due">截止日期</label>
      <input id="assign-due" type="datetime-local" value="${dueLocal}"></div>
    <div class="form-field" style="margin:14px 0 6px"><label class="field-label">解題過程的作答方式（可多選）</label>
      <div class="mode-checks">
        <label class="checkbox-line"><input id="assign-mode-hand" type="checkbox" checked>手寫解題</label>
        <label class="checkbox-line"><input id="assign-mode-text" type="checkbox" checked>文字作答</label>
        <label class="checkbox-line"><input id="assign-mode-upload" type="checkbox" checked>上傳手稿</label>
      </div>
      <p class="field-hint">學生只能用你勾選的方式作答；選擇題一律用「點選作答」。</p></div>
    <label class="small-text" style="display:flex;gap:8px;align-items:center;margin:10px 0">
      <input id="assign-ai" type="checkbox"> 使用 AI 建議評分（教師仍可覆核）</label>
    <label class="small-text" style="display:flex;gap:8px;align-items:center;margin:0 0 10px 22px">
      <input id="assign-ai-confirm" type="checkbox"> AI 批閱後自動確認為教師分數（不建議）</label>
    <button class="primary" id="assign-submit" ${missing.length?'disabled':''}>建立作業</button>`);
  const go=$('#assign-goto-bank');
  if(go)go.onclick=()=>{closeModal();onlyReview=true;search='';topic='全部題目';currentPage=1;bank();};
  $('#assign-submit').onclick=async()=>{
    const btn=$('#assign-submit');const old=btn.textContent;btn.disabled=true;btn.textContent='建立中…';
    try{
      await api('/api/assignments',{
        title:($('#assign-title').value||'').trim()||title,
        classId:Number($('#assign-class').value),
        questionIds:ids,
        dueAt:new Date($('#assign-due').value).toISOString(),
        aiGrading:$('#assign-ai').checked,aiAutoConfirm:$('#assign-ai-confirm').checked,
        answerModes:['hand','text','upload'].filter(m=>{const el=$('#assign-mode-'+m);return !el||el.checked;})});
      closeModal();
      toast('作業已建立，可在「作業與成績」查看');
      homeworkPage();
    }catch(e){toast(e.message);btn.disabled=false;btn.textContent=old;}
  };
}
