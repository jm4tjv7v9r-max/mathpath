'use strict';
let S={user:null,questions:preview,attempts:[],stats:{completed:0,accuracy:0,streak:0,minutes:0},ai:{configured:false,mode:'off'},notice:''};
let page='bank', topic='全部題目', subtopic='', search='', grade='', level='', qtype='', currentPage=1, viewMode='list', sortBy='', currentQuestion=null, recommendations=null, answerMode='hand', lastResult=null, lastSolution=null;
let importStage=1, drafts=[], importMethod='', paperFile=null, paperName='', paperText='', figImage=null, figSketch=null, figCanvasTools=null, historyFilter='all',historyFilterTouched=false;
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
// 切換作答方式時要判斷「這一種方式有沒有內容」，有就提示會清除
function hasProcessContent(mode){
  const typed=()=>{
    const fa=$('#final-answer'),pr=$('#answer-process');
    return !!((fa&&fa.value.trim())||(pr&&pr.value.trim())||(window.answerTextDraft||'').trim());
  };
  if(mode==='hand')return strokes.length>0;
  if(mode==='upload')return !!answerFile;
  if(mode==='choice')return !!selectedOption;
  return typed();   // 文字作答：連「最終答案」輸入框也算解題內容
}
function clearProcessForMode(mode){
  if(mode==='hand'){strokes=[];redoStrokes=[];}
  else if(mode==='upload'){answerFile=null;}
  else if(mode==='text'){
    const fa=$('#final-answer'),pr=$('#answer-process');
    if(fa)fa.value='';if(pr)pr.value='';
    window.answerTextDraft='';
  }
}
// 「修改作答」：把這一題的作答整個清掉，重新寫一次
function clearAnswerState(){
  strokes=[];redoStrokes=[];lastResult=null;lastSolution=null;selectedOption=null;answerFile=null;
  window.answerTextDraft='';
  const fa=$('#final-answer');if(fa)fa.value='';
  const pr=$('#answer-process');if(pr)pr.value='';
}
function preserveDraft(){if(page==='practice'&&!lastResult)saveDraft();}
window.addEventListener('pagehide',preserveDraft);
document.addEventListener('input',e=>{if(e.target.matches('#final-answer,#answer-process')){lastResult=null;scheduleDraft();}});
// 手機上計算器是浮動的，會蓋住作答輸入框；一開始打字就先收起來，避免擋住與誤觸。
document.addEventListener('focusin',e=>{if(e.target.matches('#final-answer,#answer-process'))document.body.classList.add('typing-answer');});
document.addEventListener('focusout',e=>{if(e.target.matches('#final-answer,#answer-process'))document.body.classList.remove('typing-answer');});
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
async function api(path,body,method){let r;try{r=await fetch(path,{method:method||(body===undefined?'GET':'POST'),headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin'});}catch{throw new Error('無法連接網站伺服器，請確認服務已啟動。');}let data;try{data=await r.json();}catch{throw new Error(r.status===524?'AI 處理超過兩分鐘，已被網路層中斷。請縮短試卷、分批上傳，或稍後再試。':`伺服器回應無效（HTTP ${r.status}），請稍後再試；伺服器日誌會有實際原因。`);}if(!r.ok){if(r.status===401 && !path.includes('login') && !path.includes('change-password')){S.user=null;loginModal();}throw new Error(data.error || '操作未完成，請再試。');}serverIssue='';return data;}
// 長 AI 工作（PDF 轉寫會超過 30 秒）：先拿 jobId，再輪詢 /api/jobs/{id}。
// timeoutMs 可調：整班批改一份一份送，每份都短；但單份 10 頁仍可能很久。
async function apiJob(path,body,onTick,timeoutMs){
  const {jobId}=await api(path,{...body,async:true});
  const started=Date.now();
  const limit=Number(timeoutMs)>0?Number(timeoutMs):5*60*1000;
  for(;;){
    await new Promise(r=>setTimeout(r,1200));
    if(Date.now()-started>limit)throw new Error(`處理超過 ${Math.round(limit/60000)} 分鐘仍未完成；伺服器可能仍在處理，請稍後按「重新取得結果」查看，或縮短試卷再試。`);
    const job=await api('/api/jobs/'+encodeURIComponent(jobId));
    if(onTick)onTick(job);
    if(job.status==='done')return job.result;
    if(job.status==='error')throw new Error(job.error||'處理失敗，請稍後再試。');
  }
}
// 全班紙本批閱：PDF 以「原始二進位」上傳（不經 base64 JSON），
// 避免 base64 膨脹 4/3 倍讓部署代理層在到達應用前就回 413；其餘與 apiJob 相同。
async function apiJobRaw(path,fileBytes,params,onTick){
  const qs=new URLSearchParams();
  for(const [k,v] of Object.entries(params||{})){if(v!==null&&v!==undefined&&v!=='')qs.set(k,v);}
  const url=path+'?'+qs.toString();
  let r;
  try{
    r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/pdf'},
      body:fileBytes,credentials:'same-origin'});
  }catch{throw new Error('無法連接網站伺服器，請確認服務已啟動。');}
  let data;
  try{data=await r.json();}catch{
    throw new Error(r.status===524?'AI 處理超過兩分鐘，已被網路層中斷。請縮短試卷、分批上傳，或稍後再試。'
      :`伺服器回應無效（HTTP ${r.status}），請稍後再試；伺服器日誌會有實際原因。`);
  }
  if(!r.ok){if(r.status===401){S.user=null;loginModal();}throw new Error(data.error||'操作未完成，請再試。');}
  const {jobId}=data;
  const started=Date.now();
  for(;;){
    await new Promise(res=>setTimeout(res,1200));
    if(Date.now()-started>5*60*1000)throw new Error('處理超過 5 分鐘，請縮短試卷再試。');
    const job=await api('/api/jobs/'+encodeURIComponent(jobId));
    if(onTick)onTick(job);
    if(job.status==='done')return job.result;
    if(job.status==='error')throw new Error(job.error||'處理失敗，請稍後再試。');
  }
}
async function refresh(){S=await api('/api/state');loadBookmarks();shell();}
function empty(title,desc,button=''){return `<div class="empty">${icon('bank')}<h3>${title}</h3><p>${desc}</p>${button}</div>`;}
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
  const ready=practiceRangeReady();
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
    <p class="field-hint">${!ready
      ? '先選章節、子分類（該章節有子分類時）與題型，再按「開始練習」；想直接練就按「隨機一題」。'
      : pool.length
        ? `符合條件 ${pool.length} 題${fresh.length?`，其中 ${fresh.length} 題還沒練過`:''}。「開始練習」會優先挑沒練過的題目。`
        : '目前題庫沒有符合這個範圍的題目，請放寬章節或題型。'}</p>
    <div class="practice-setup-actions">
      <button class="primary" id="pr-start"${ready&&pool.length?'':' disabled'}>開始練習 ${icon('arrow')}</button>
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
// 「開始練習」要先選好章節（有子分類的話也要選）與題型；「隨機一題」不受限制。
function practiceRangeReady(){
  const topic=practiceRange.topic;
  if(!topic)return false;
  const subs=[...new Set((S.questions||[]).filter(q=>q.topic===topic).map(q=>q.subtopic).filter(Boolean))];
  return (!subs.length||!!practiceRange.subtopic)&&!!practiceRange.qtype;
}
function practiceStart(random){
  const pool=practicePool(false);
  if(!pool.length)return toast('目前沒有符合這個範圍的題目。');
  if(!random&&!practiceRangeReady())return toast('請先選好章節、子分類與題型；想直接練可以按「隨機一題」。');
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
function practice(){if(!S.user){return requireLogin(()=>practice());}if(!currentQuestion)return practicePicker();beginView();page='practice';shell();const q=currentQuestion;$('#main').innerHTML=`<div class="fade-in">${heading(mockContext?'MOCK EXAM':assignmentContext?'ASSIGNMENT PRACTICE':'FOCUSED PRACTICE',mockContext?'模擬測驗作答':assignmentContext?'作業解題':'自主練習',mockContext?esc(mockContext.title)+' · 本次作答計入模擬測驗':assignmentContext?esc(assignmentContext.title)+' · 此次保存將計入本份作業':'慢一點思考，清楚寫下每一步。理解，比速度更重要。')}${quizClockBadge()}${mockContext?`<button class="text-button back-button" data-mock="${mockContext.id}">${icon('back')}返回模擬測驗</button>`:assignmentContext?`<button class="text-button back-button" data-assignment="${assignmentContext.id}">${icon('back')}返回本份作業</button>`:`<button class="text-button back-button" data-page="bank">${icon('back')}返回題庫</button><button class="text-button back-button" id="change-range">${icon('practice')}換練習範圍</button>`}<div class="practice-layout"><section class="panel practice-panel"><div class="practice-question"><div class="question-top"><span class="badge">${q.grade} · ${esc(q.topic)}${q.subtopic?' · '+esc(q.subtopic):''}</span><span class="badge l${q.level}">${levels[q.level]}</span><span class="badge outline">${esc(q.qtype||'解答題')}</span><span class="badge outline">${q.points} 分</span><button class="bookmark ${bookmarks.has(q.id)?'saved':''}" style="margin-left:auto" data-save="${q.id}" aria-label="收藏題目">${icon('bookmark')}</button></div><h2>${mathText(q.title)}</h2>${stemHtml(q,{options:false})}<div class="question-meta">${esc(q.tags.join(' · '))}<i class="separator"></i>${esc(q.source)}</div></div><div class="section-head"><h2 style="font-size:calc(16px*var(--fs))">你的解題過程</h2><button class="text-button" id="hint-btn" style="font-size:calc(14px*var(--fs))">${icon('bulb')}給我一點提示</button></div><div id="hint-root"></div>${(()=>{const modes=practiceModes(q);if(modes.length<2)return '';return `<div class="practice-tabs">${modes.map(([id,ic,t])=>`<button data-answer-mode="${id}" class="${answerMode===id?'active':''}">${icon(ic)}${t}</button>`).join('')}</div>`;})()}<div id="answer-area"></div><div class="form-field"><div class="final-answer-head"><label class="field-label" for="final-answer">最終答案 <span class="small-text">· 文字作答必填，手寫作答可選填</span></label></div><button type="button" class="math-editor-open" id="open-math-editor">${icon('calculator')}開啟公式編輯器（分數、根號、次方）</button><input class="answer-field" id="final-answer" placeholder="例如：x=2 或 x=3，或按上方數學鍵盤輸入" maxlength="4000"><div class="math-preview" id="final-answer-preview" hidden></div></div>${aiGradingHtml()}${(aiGradedNow()&&S.ai.mode==='external')?`<label class="checkbox-line"><input type="checkbox" id="consent-ai">我同意將本題、作答及最多5次本人同知識點已評紀錄，傳送至學校配置的外部 AI 作批改與學習建議。</label>`:''}<div class="submit-row answer-submit"><span class="small-text" id="draft-status">本分頁草稿暫存 · 提交後才保存至伺服器</span>${assignmentContext?`<button class="secondary" id="skip-answer" title="不會也沒關係，老師會看到">本題不會</button>`:''}<button class="primary" id="submit-answer">${icon('check')}${submitLabel()}</button></div><div id="result-root"></div></section><div class="right-stack"><section class="panel right-panel"><h2>${icon('spark')}從一道題，到一類題</h2><p class="panel-sub">先鞏固相同解法，再挑戰更深的思考</p><div id="recommendations">${empty('正在找題','從校本題庫尋找同知識點練習')}</div></section><section class="panel right-panel tip-panel"><h2>${icon('bulb')}解題習慣</h2><p>① 先理解題目要找甚麼。<br>② 選擇方法，寫下理由。<br>③ 代回原題，檢查結果。<br><br>手寫評閱需要能辨認完整步驟；請保持字跡清楚。</p></section></div></div></div>`;renderAnswerArea();bindMathKeyboard();$('#hint-btn').onclick=()=>{$('#hint-root').innerHTML=`<div class="hint-box">${mathText(q.hint||'先圈出已知條件，再想想與哪一個知識點有關。')}</div>`;};$('#submit-answer').onclick=submitAnswer;
  const skipBtn=$('#skip-answer');if(skipBtn)skipBtn.onclick=markCurrentSkipped;const rangeBtn=$('#change-range');if(rangeBtn)rangeBtn.onclick=async()=>{if(strokes.length&&!lastResult&&await askCancel('目前手寫內容尚未提交，確定離開這一題？'))return;preserveDraft();currentQuestion=null;strokes=[];redoStrokes=[];lastResult=null;lastSolution=null;practicePicker();};restoreDraft();renderRecommendations();}
// ── 作答模式與數學鍵盤 ──
// 選擇題只可點選作答；填空題只手寫或文字作答；解答題／證明題保留上傳手稿。
function practiceModes(q){
  if(q && q.options && q.options.length) return [['choice','check','點選作答']];
  const modes = [['hand','practice','手寫解題'], ['text','file','文字作答']];
  if(!q || q.qtype !== '填空題') modes.push(['upload','image','上傳手稿']);
  // 老師佈置作業時可以限制作答方式（手寫／文字／上傳手稿）；
  // 沒限制（空清單，包含所有舊作業）就三種都可用。
  const allowed = assignmentContext && Array.isArray(assignmentContext.answerModes)
    ? assignmentContext.answerModes : [];
  if(!allowed.length) return modes;
  const kept = modes.filter(([id])=>allowed.includes(id));
  // 萬一老師只勾了某題型不支援的方式（例如填空題只准上傳手稿），
  // 不要讓學生無從作答——退回全部，至少還能寫。
  return kept.length ? kept : modes;
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
  modal(`<p class="eyebrow">MATH EDITOR</p><h2>公式編輯器</h2>
  <p class="modal-intro">像在 Word 裡打公式：直接輸入 LaTeX，或按輸入區右側的鍵盤圖標開啟數學符號。分數、根號、次方的結構會即時排版。每次開啟都是空白；完成後按「插入答案」覆蓋作答欄（按「取消」不會動到原本的答案）。</p>
  <div class="math-editor-host"><math-field id="math-editor-field" virtual-keyboard-mode="auto"></math-field></div>
  <p class="error-text" id="math-editor-error"></p>
  <div class="submit-row"><button class="primary" id="math-editor-ok">${icon('check')}插入答案</button><button class="secondary" data-action="close-modal">取消</button></div>`);
  const field=$('#math-editor-field');
  if(!field){toast('公式編輯器無法啟動，請改用數學鍵盤輸入。');return;}
  // 每次開啟都是空白（使用者要求）：避免舊內容與新輸入混在一起。
  // 按「取消」不會動到作答欄；只有按「插入答案」才會覆蓋。
  field.value='';
  // 焦點要真的落在輸入區：MathLive 升級元素、載入字體都可能晚一幀才完成，
  // 只 focus 一次有時會落在視窗標題上，之後打的第一個字就被吃掉。
  const focusField=()=>{try{field.focus();}catch(_){}};
  focusField();requestAnimationFrame(focusField);setTimeout(focusField,150);
  // 有些輸入法／浮動鍵盤在第一個字元後會把焦點搶走，看起來像「只打得出一個字」；
  // 這裡在每次輸入後檢查一次，焦點跑了就還回去。
  field.addEventListener('input',()=>{if(document.activeElement!==field)focusField();});
  watchMathKeyboard();
  $('#math-editor-ok').onclick=()=>{
    const latex=(field.value||'').trim();
    input.value=latex;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    closeModal();
    toast(latex?'已插入公式，可繼續微調。':'已清空最終答案。');
  };
}
// ── 公式編輯器的數學鍵盤 ────────────────────────────────────────────────
// MathLive 把虛擬鍵盤動態掛到 body（div.ML__keyboard），預設貼死螢幕底部：
// 手機上最底一行（左下、右下角的鍵）會被瀏覽器工具列／安全區切掉按不到，
// 而且整塊會蓋住編輯器視窗的「插入答案」。這裡量出鍵盤實際佔掉的高度，
// 讓編輯器視窗往上讓位（鍵盤本身由 CSS 抬起，見 styles.css）。
let mathKbTimer=null;
function watchMathKeyboard(){
  const sync=()=>{
    if(!document.getElementById('math-editor-field')){    // 編輯器關了：收工
      if(mathKbTimer){clearInterval(mathKbTimer);mathKbTimer=null;}
      document.body.classList.remove('math-kb-open');
      document.documentElement.style.removeProperty('--math-kb');
      return;
    }
    const plate=document.querySelector('.ML__keyboard .MLK__plate');
    const rect=plate?plate.getBoundingClientRect():null;
    const h=rect&&rect.height>0?Math.max(0,Math.round(window.innerHeight-rect.top)):0;
    document.body.classList.toggle('math-kb-open',h>0);
    document.documentElement.style.setProperty('--math-kb',h+'px');
  };
  sync();
  if(!mathKbTimer)mathKbTimer=setInterval(sync,300);
}
function syncMathKeyboard(){
  // 數學鍵盤已經從作答頁移除（改用「開啟公式編輯器」），這裡保留只是為了相容舊結構。
  const keyboard=$('#math-keyboard');
  if(keyboard) keyboard.hidden = answerMode !== 'text';
  // 「最終答案」只在文字作答時需要（手寫解題、上傳手稿都由圖片本身作答）。
  // ⚠️ 用 hidden 而不是移除 DOM——`#final-answer` 的值要保留，切回文字作答時還在。
  const input=$('#final-answer');
  const box=input&&input.closest?input.closest('.form-field'):null;
  if(box) box.hidden = answerMode !== 'text';
  updateMathPreview();
}
function bindMathKeyboard(root, insert){
  const keyboard=root||$('#math-keyboard');
  // ⚠️ 輸入框的即時預覽不能綁在鍵盤存在與否上——作答頁已經沒有鍵盤了，
  // 若在這裡 return，學生打字時預覽就永遠不會更新。
  const input=$('#final-answer');
  if(!root && input) input.addEventListener('input', updateMathPreview);
  if(!keyboard) return;
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
function renderAnswerAreaInner(){const area=$('#answer-area');if(!area)return;if(answerMode==='choice'){const opts=(currentQuestion&&currentQuestion.options)||[];area.innerHTML=`<label class="field-label">點選你的答案</label><div class="choice-picker" id="choice-picker">${opts.map((o,j)=>{const L=OPTION_LETTERS[j];return `<button type="button" class="choice-option ${selectedOption===L?'selected':''}" data-choice="${L}" aria-pressed="${selectedOption===L}"><span class="option-letter">${L}</span><span class="option-text">${mathText(o)}</span></button>`;}).join('')}</div><p class="field-hint">點選一項即完成作答；自主練習提交後可即時核對，作業結果須教師覆核。</p>`;$$('[data-choice]').forEach(b=>b.addEventListener('click',()=>{selectedOption=b.dataset.choice;$('#final-answer').value=selectedOption;lastResult=null;renderAnswerArea();scheduleDraft();}));return;}if(answerMode==='hand'){area.innerHTML=`<div class="writing-toolbar"><div class="tool-group"><button class="icon-btn active" id="pen-btn" aria-label="畫筆">${icon('practice')}</button><button class="icon-btn" id="eraser-btn" aria-label="橡皮擦">${icon('eraser')}</button><span style="height:20px;border-right:1px solid var(--border);margin:0 4px"></span>${['#274b3b','#456bab','#b96c5d'].map(c=>`<button class="pen-color ${c===penColor?'selected':''}" style="background:${c}" data-color="${c}" aria-label="${c==='#274b3b'?'深綠':c==='#456bab'?'藍':'紅'}色畫筆"></button>`).join('')}<button class="icon-btn" id="undo-btn" aria-label="撤銷一筆">${icon('undo')}</button><button class="icon-btn" id="clear-btn" aria-label="清空畫布">${icon('trash')}</button></div><span class="small-text">觸控筆 / 滑鼠皆可</span></div><div class="canvas-wrap hand-canvas-wrap"><canvas id="hand-canvas" width="${handSize()[2]}" height="${handSize()[3]}" aria-label="手寫解題畫布"></canvas><div class="canvas-placeholder" id="canvas-placeholder">在這裡寫下你的思考…</div></div><div class="hand-size-row">${handSizeControl()}<span class="small-text">步驟多就換大一點；已寫的內容會保留。</span></div><p class="field-hint">提示：先寫出算式，再補上推導。切換文字模式不會清除手寫內容。</p>`;initCanvas();const sizeSel=$('#hand-size');if(sizeSel)sizeSel.onchange=async()=>{const next=HAND_SIZES.find(([id])=>id===sizeSel.value);if(!next)return;const current=handSize();if(strokes.length&&next[3]<current[3]&&await askCancel(`縮小後，超出範圍的筆跡不會出現在送出的圖片上（畫布內仍保留，可再放大回來）。仍要換成「${next[1]}」？`)){renderAnswerArea();return;}try{localStorage.setItem('mathpath_hand_size',next[0]);}catch{}renderAnswerArea();toast(`書寫區已換成「${next[1]}」。`);};$('#pen-btn').onclick=()=>setEraser(false);$('#eraser-btn').onclick=()=>setEraser(true);$('#undo-btn').onclick=()=>{if(strokes.length)redoStrokes.push(strokes.pop());drawCanvas();lastResult=null;scheduleDraft();};$('#clear-btn').onclick=async()=>{if(!strokes.length)return;if(await askConfirm('清空尚未提交的手寫內容？此動作無法復原。')){strokes=[];redoStrokes=[];drawCanvas();lastResult=null;scheduleDraft();}};$$('[data-color]').forEach(b=>b.onclick=()=>{penColor=b.dataset.color;setEraser(false);$$('[data-color]').forEach(x=>x.classList.toggle('selected',x===b));});}else if(answerMode==='text'){area.innerHTML=`<p class="field-hint">${icon('practice')}可以直接打字，或按上方「開啟公式編輯器」用分數、根號、次方的結構輸入。純文字（如 5 cm）同樣可以。</p>`;}else{const isPdf=!!answerFile&&answerFile.indexOf('data:application/pdf')===0;area.innerHTML=`<label class="upload-answer" id="answer-drop">${isPdf?`<span class="upload-file">${icon('file')}<strong>已選擇 PDF 作答</strong><small>提交時會先讀取 PDF 的文字；掃描檔會取用內嵌的圖片</small></span>`:answerFile?`<img src="${answerFile}" alt="待提交的手寫解題">`:`${icon('image')}<strong>上傳紙上的解題過程</strong><small>相片 JPG / PNG 最多 25 MB（上傳前會自動壓縮）、PDF 最多 20 MB；請保持完整、清晰</small>`}<input id="answer-upload" type="file" accept="image/*,application/pdf" hidden></label><div class="upload-actions"><button type="button" class="secondary" id="answer-select">選擇檔案</button><button type="button" class="secondary" id="answer-camera">${icon('image')}用手機拍照</button><button type="button" class="secondary" id="answer-remove" ${answerFile||uploadReading?'':'disabled'}>移除檔案</button><span class="small-text" id="answer-read-status" role="status">${uploadReading?'正在讀取並壓縮相片，請稍候…':answerFile?(isPdf?'已選擇 PDF 作答，提交時會先讀取 PDF 文字':'相片已壓縮至約 '+fmtBytes(dataUrlBytes(answerFile))+'，送出更快'):'可選擇檔案或用手機相機拍照。'}</span><input id="answer-capture" type="file" accept="image/*" capture="environment" hidden></div>`;
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
// 題目圖形要用 PNG：Word（python-docx）不認得 WebP，手繪圖存成 WebP 會在匯出 Word 時消失。
function figurePngDataUrl(canvas){return canvas.toDataURL('image/png');}
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
      // 題目圖形一律存 PNG：WebP 進不了 Word（python-docx 不支援）。
      resolve(figurePngDataUrl(c));
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
// 確認框要開在「目前最上面一層」的再上面一層：
// 圖形工作室疊在第二層時，確認框若開在預設的第一層，會把底下一鍵生成的預覽頁整層換掉。
function modalRootAbove(){return '#modal-root-' + (modalStack.length + 1);}
// 外部模型要先取得同意；生成與核對都會把題目內容（及圖形）送出。
async function aiExternalOk(what){
  if(S.ai.mode!=='external')return true;
  const saved=figStudio;   // 確認框關閉會走 closeModal、把 figStudio 清掉；先留一盞燈
  const cancelled=await askCancel(`${what}會將題目內容與圖形（不含學生作答）傳送至學校配置的外部 AI，是否繼續？`,
                                   {root:modalRootAbove()});
  figStudio=saved;
  return !cancelled;
}

function openFigureStudio(ctx){
  figStudio={ctx,figure:ctx.figure||'',original:ctx.figure||'',check:null,busy:'',manual:false,
             spec:null,issues:[],specIssues:[],rounds:0,history:[],
             drawing:false,sketch:newSketch(),sketchTools:null,
             // 從「確認題目」打開時疊在第二層，關掉圖形視窗要回到卷的預覽
             root:ctx.root||'#modal-root'};
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
    ${figureToolbarHtml('fig-studio','AI 畫得不對時，可以直接在方格上自己畫：拖曳畫直線／虛線／圓／矩形／正方形／平行四邊形／菱形／正多邊形，端點靠近會自動連接；選「點名稱」再點畫布放置，選「選擇」可拖曳移動、並用「縮放／旋轉」調整大小與角度')}
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
  <div class="submit-row"><span class="small-text">按「${willRemove?'移除這張圖形':'使用這張圖形'}」才會寫回題目</span><div class="row-actions"><button class="primary" id="fig-apply" ${figure||willRemove?'':'disabled'}>${icon('check')}${willRemove?'移除這張圖形':'使用這張圖形'}</button><button class="secondary" id="fig-close">關閉</button></div></div>`,true,true,figStudio.root||'#modal-root');
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
      // 固定用 PNG：WebP 圖形存進題庫後，匯出 Word 時 python-docx 畫不出來會直接消失。
      const data=figurePngDataUrl(sketchCanvas);
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
    if(studio.issues.length&&await askCancel(`這張圖仍有 ${studio.issues.length} 個疑慮：\n\n`
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
  if(!(await aiExternalOk('生成圖形與核對圖形')))return;
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
  if(!(await aiExternalOk('核對圖形')))return;
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
  if(await askCancel('確定移除這道題目的圖形？'))return;
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
  if(!opts.silent&&await askCancel('標示「本題不會」？老師會看到這題你沒有作答，不會自動記零分。'))return null;
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
  if(S.ai.mode==='external'&&await askCancel('生成新題會將原題（不含學生作答）傳送至學校配置的外部 AI，是否繼續？'))return;
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
    if(await askCancel('我已核對題目內容、分類、參考答案、詳解與評分標準，確認將這道題標記為「教師已核驗」並加入題庫。'))return;
    const verified=structuredClone(draft);
    verified.tags=(verified.tags||[]).filter(t=>!/待.*(?:核驗|核验|審核|审核|確認|确认)/.test(t));
    verified.source='AI 生成 · 教師已核驗';
    const target=viewTarget(),dialog=$('.modal'),b=$('#ai-draft-save');b.disabled=true;b.textContent='正在加入題庫…';
    try{
      await api('/api/questions/import',{questions:[verified],teacher:true,dedupe:true});
      if(!viewMatches(target)||$('.modal')!==dialog)return;
      const state=await api('/api/state');if(!viewMatches(target)||$('.modal')!==dialog)return;
      S=state;loadBookmarks();shell();closeModal();
      toast('已加入題庫。');
      // 不跳轉到新題：教師留在原本的位置，可以繼續生成或挑下一道參考題。
      if(page==='bank')bank();
    }catch(e){if(viewMatches(target)&&$('.modal')===dialog){b.disabled=false;b.innerHTML=icon('check')+'加入題庫';toast(e.message);}}
  };
}
async function fileData(file,allowed,maxMB){if(!file)throw new Error('請先選擇檔案。');const type=file.type||'';const ok=allowed.includes(type)||allowed.some(a=>a[0]==='.'&&new RegExp('\\'+a+'$','i').test(file.name||''));if(!ok)throw new Error('不支援此檔案類型，請選擇 PDF、Word (.docx)、PNG、JPG 或 WebP。');const limit=maxMB||(type==='application/pdf'?20:10);if(file.size>limit*1024*1024)throw new Error(`檔案不可超過 ${limit} MB。`);return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('檔案讀取失敗。'));r.readAsDataURL(file);});}
// 題目圖形：優先用教師上傳／貼上的圖片（課本截圖、GeoGebra 匯出等），
// 沒有圖片才用方格畫布的手繪圖。
function figureDataUrl(){if(figImage)return figImage;const c=$('#figure-canvas');return c?figurePngDataUrl(c):'';}
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
// 端點自動連接：畫線／多邊形時，終點靠近既有端點這個距離內就吸過去。
const FIGURE_SNAP=14;
// 工具代號 → 圖形種類（畫法都是「拖曳決定外接框」，共用 points 結構）。
const FIGURE_SHAPE_TOOLS={rectangle:'rectangle',square:'square',parallelogram:'parallelogram',
                          rhombus:'rhombus',polygon:'polygon'};

// 由外接框兩點算出圖形的實際頂點。橡皮、命中、選取框、自動連接都靠它，
// 所以每一種圖形只要在這裡定義一次頂點，其他地方不必逐個改。
function figureShapeVertices(shape,a,b,sides){
  const x0=Math.min(a.x,b.x),x1=Math.max(a.x,b.x),y0=Math.min(a.y,b.y),y1=Math.max(a.y,b.y);
  const cx=(x0+x1)/2,cy=(y0+y1)/2;
  if(shape==='square'){
    // 以起點為角、往拖曳方向畫正方形，邊長取水平／垂直較大者。
    const s=Math.max(x1-x0,y1-y0),sx=b.x>=a.x?1:-1,sy=b.y>=a.y?1:-1;
    const bx=a.x+sx*s,by=a.y+sy*s;
    return [{x:a.x,y:a.y},{x:bx,y:a.y},{x:bx,y:by},{x:a.x,y:by}];
  }
  if(shape==='rectangle')return [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
  if(shape==='parallelogram'){
    // 上邊向右錯開約 1/3 寬，形成平行四邊形；拖曳方向相反時也一致。
    const skew=(x1-x0)*0.35;
    return [{x:x0+skew,y:y0},{x:x1+skew,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
  }
  if(shape==='rhombus')return [{x:cx,y:y0},{x:x1,y:cy},{x:cx,y:y1},{x:x0,y:cy}];
  if(shape==='polygon'){
    const n=Math.max(3,Math.min(12,Math.round(Number(sides)||6)));
    const r=Math.min(x1-x0,y1-y0)/2,out=[];
    for(let i=0;i<n;i++){
      const ang=-Math.PI/2+i*2*Math.PI/n;
      out.push({x:cx+r*Math.cos(ang),y:cy+r*Math.sin(ang)});
    }
    return out;
  }
  return [{x:x0,y:y0},{x:x1,y:y1}];
}

// 一項圖形所有「可以拿來連接的端點」：線兩端、多邊形頂點、圓的上下左右、
// 標籤位置、自由筆首尾。縮放／旋轉過的項目要換算回畫面座標再比對。
function figureAllVertices(item){
  const pts=(item&&item.points)||[];
  if(!pts.length)return [];
  if(item.type==='shape'){
    const raw=figureShapeVertices(item.shape,pts[0],pts[1]||pts[0],item.sides);
    return raw.map(p=>figureItemToWorld(item,p));
  }
  if(item.type==='circle'){
    const c=pts[0],e=pts[1]||pts[0],r=Math.hypot(e.x-c.x,e.y-c.y);
    return [{x:c.x-r,y:c.y},{x:c.x+r,y:c.y},{x:c.x,y:c.y-r},{x:c.x,y:c.y+r}]
      .map(p=>figureItemToWorld(item,p));
  }
  if(item.type==='label')return [figureItemToWorld(item,pts[0])];
  if(item.type==='line')return [figureItemToWorld(item,pts[0]),figureItemToWorld(item,pts[1]||pts[0])];
  return [figureItemToWorld(item,pts[0]),figureItemToWorld(item,pts[pts.length-1])];
}
// 把指標吸到附近既有端點；exclude 是正在畫、還沒定案的那一項。
function snapFigurePoint(pt,strokes,exclude){
  let best=null,bestDist=FIGURE_SNAP;
  for(const item of strokes||[]){
    if(item===exclude)continue;
    for(const q of figureAllVertices(item)){
      const d=Math.hypot(q.x-pt.x,q.y-pt.y);
      if(d<bestDist){bestDist=d;best=q;}
    }
  }
  return best?{x:best.x,y:best.y}:pt;
}

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
  // 多邊形類用實際頂點算外框（平行四邊形的斜邊會超出兩點外接框）。
  const verts=item.type==='shape'?figureShapeVertices(item.shape,pts[0],pts[1]||pts[0],item.sides):pts;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const p of verts){x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y);}
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
  if(item.type==='shape'){
    // 多邊形：任一條邊夠近就算命中（跟直線、圓周一致，點圖形輪廓來選它）。
    const v=figureShapeVertices(item.shape,own[0],own[1]||own[0],item.sides);
    if(v.length<3)return false;
    return pts.some(p=>{
      for(let i=0;i<v.length;i++){
        if(pointSegmentDistance(p,v[i],v[(i+1)%v.length])<FIGURE_HIT)return true;
      }
      return false;
    });
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
      }else if(item.type==='shape'){
        const v=figureShapeVertices(item.shape,pts[0],pts[1]||pts[0],item.sides);
        if(v.length<3)return;
        ctx.beginPath();ctx.moveTo(v[0].x,v[0].y);
        for(const p of v.slice(1))ctx.lineTo(p.x,p.y);
        ctx.closePath();ctx.stroke();
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
      // 直線／多邊形起點也吸附既有端點，方便首尾相接到同一個頂點。
      const connectable=tool==='line'||tool==='dashed'||!!FIGURE_SHAPE_TOOLS[tool];
      const start=connectable?snapFigurePoint(pt,state.strokes,null):pt;
      const shape=FIGURE_SHAPE_TOOLS[tool];
      const item=tool==='line'?{type:'line',dashed:false,points:[start,start]}
        :tool==='dashed'?{type:'line',dashed:true,points:[start,start]}
        :tool==='circle'?{type:'circle',points:[pt,pt]}
        :shape?{type:'shape',shape:shape,points:[start,start],
                sides:shape==='polygon'?((state.polygonSides&&state.polygonSides())||6):undefined}
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
    if(d.type==='line'||d.type==='circle'||d.type==='shape'){
      // 拖曳終點靠近既有端點就吸附過去（排除自己，避免吸到自己的起點）。
      const snap=d.type==='circle'?pt:snapFigurePoint(pt,state.strokes,d);
      d.points[1]=snap;
    }else d.points.push(pt);
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
    }else if(d.type==='shape'){
      const a=d.points[0],b=d.points[1];
      // 太小就看不出是圖形，當作誤觸丟掉。
      if(Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y))<8)state.strokes=state.strokes.filter(x=>x!==d);
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
    <button type="button" class="icon-btn" data-tool="rectangle" aria-label="矩形">${icon('rectangle')}</button>
    <button type="button" class="icon-btn" data-tool="square" aria-label="正方形">${icon('square')}</button>
    <button type="button" class="icon-btn" data-tool="parallelogram" aria-label="平行四邊形">${icon('parallelogram')}</button>
    <button type="button" class="icon-btn" data-tool="rhombus" aria-label="菱形">${icon('rhombus')}</button>
    <button type="button" class="icon-btn" data-tool="polygon" aria-label="正多邊形">${icon('polygon')}</button>
    <button type="button" class="icon-btn" data-tool="label" aria-label="加入點名稱">${icon('label')}</button>
    <button type="button" class="icon-btn" data-tool="select" aria-label="選擇並移動">${icon('select')}</button>
    <span style="height:20px;border-right:1px solid var(--border);margin:0 4px"></span>
    <button type="button" class="icon-btn" data-tool="eraser" aria-label="橡皮擦">${icon('eraser')}</button>
    <button type="button" class="icon-btn" id="${scope}-undo" aria-label="撤銷">${icon('undo')}</button>
    <button type="button" class="icon-btn" id="${scope}-clear" aria-label="清除">${icon('trash')}</button>
    <span class="label-name-field" id="${scope}-label-field">點名稱<input id="${scope}-label-text" maxlength="4" value="A" aria-label="點名稱">字級<input id="${scope}-label-size" type="range" min="16" max="48" step="2" value="26" aria-label="字母大小"><span class="label-size-value" id="${scope}-label-size-value">26</span></span>
    <span class="polygon-sides-field" id="${scope}-polygon-field" title="選「正多邊形」後決定的邊數">邊數<input id="${scope}-polygon-sides" type="number" min="3" max="12" step="1" value="6" aria-label="正多邊形邊數"></span>
    <span class="item-transform-field" id="${scope}-transform-field" title="先用「選擇」點一下圖形，再拖這裡調整">縮放<input id="${scope}-item-scale" type="range" min="40" max="250" step="5" value="100" aria-label="所選圖形縮放" disabled><span class="label-size-value" id="${scope}-item-scale-value">—</span>旋轉<input id="${scope}-item-rotate" type="range" min="-180" max="180" step="5" value="0" aria-label="所選圖形旋轉" disabled><span class="label-size-value" id="${scope}-item-rotate-value">—</span></span>
  </div><span class="small-text">${esc(hint||'拖曳畫直線／虛線／圓／矩形／正方形／平行四邊形／菱形／正多邊形（邊數可調）；端點靠近會自動連接；選「點名稱」點畫布放置；選「選擇」可拖曳移動、用「縮放／旋轉」調整大小與角度，按 Delete 刪除')}</span></div>`;
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
  const sidesInput=$('#'+scope+'-polygon-sides');
  state.polygonSides=()=>Math.max(3,Math.min(12,Math.round(Number(sidesInput&&sidesInput.value)||6)));
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
async function goToImportStep(n){
  if(importStage!==2||n!==1)return;
  if(drafts.length&&await askCancel(`回到「匯入試卷」會清掉已拆分的 ${drafts.length} 道題目，確定嗎？`))return;
  drafts=[];importMethod='';importStage=1;
  importPage();
  toast('已回到第一步。');
}
function importPage(){page='import';shell();if(!S.user)return loginModal(importPage);if(importStage===1)figImage=null;if(S.user.role!=='teacher'){$('#main').innerHTML=heading('TEACHER WORKSPACE','試卷拆題','教師可匯入試卷，自動拆成獨立題目並分類；核對後存入校本題庫。')+`<section class="panel">${empty('試卷匯入只限教師','學生可在題庫開始練習；教師可拆題、核驗及匯入新題。',`<button class="primary" data-page="bank">前往數學題庫 ${icon('arrow')}</button>`)}</section>`;return;}
$('#main').innerHTML=`<div class="fade-in">${heading('PAPER TO PRACTICE','試卷拆題','匯入試卷，自動分割題目與分類；確認後，建立校本題庫。')}<div class="import-layout"><section class="panel import-panel"><div class="stepper">${[[1,'匯入試卷'],[2,'拆題與核驗'],[3,'確認入庫']].map(([n,t])=>`<button type="button" class="step ${importStage===n?'active':''}${n<importStage?' done':''}" data-import-step="${n}"${n===1&&importStage===2?'':' disabled'}${importStage===n?' aria-current="step"':''}><span>${n}</span>${t}</button>`).join('')}</div><div id="import-content"></div></section><div class="right-stack"><section class="panel right-panel"><h2>${icon('file')}從試卷到學習路徑</h2><ul class="feature-list"><li><strong>${icon('import')}拆分獨立題目</strong>按題號辨識主題，子題保留在原題內；先預覽再匯入。</li><li><strong>${icon('bank')}建立知識分類</strong>分類、難度與參考答案均可修改，教師保有最後決定權。</li><li><strong>${icon('spark')}鞏固與加深</strong>同知識點題庫推薦，AI 接入後可生成變式與進階題。</li></ul></section><section class="panel right-panel tip-panel"><h2>${icon('lock')}資料與辨識說明</h2><p>文字型 PDF 直接提取文字；Word（.docx）把方程式轉成 LaTeX 後同樣直接提取。<br>掃描版 PDF 會由伺服器逐頁轉成圖片，連同照片一起交給視覺 AI 識別；未接入視覺 AI 時請貼上題目文字。<br><br>辨識、分類及 AI 答案皆需教師核验，不能直接作正式評核。</p></section></div></div></div>`;$$('[data-import-step]').forEach(b=>b.onclick=()=>goToImportStep(Number(b.dataset.importStep)));renderImportContent();}
// ── AI 生成答案（答案／詳解／詳細解釋／評分標準）──
async function aiGenerateForQuestion(payload, consent){
  return api('/api/questions/ai-answer', {...payload, consentExternal: !!consent});
}
async function aiConfirmExternal(){
  if(S.ai.mode !== 'external') return true;
  return await askConfirm('將題目內容傳送到外部 AI 產生答案與評分標準，是否繼續？');
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
  if(!(await aiConfirmExternal())) return;
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
  if(!(await aiConfirmExternal())) return;
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

// 只補評分標準：用題目「現有的」答案與詳解拆出評分要點，不會改動答案。
// 給已經有題目、只缺 rubric 的情況用（重生成答案會把教師核對過的解法換掉）。
async function aiFillRubric(prefix, state, btn, qid){
  if(!qid) return;
  if(!S.ai.configured) return toast('AI 尚未設定：請先設定模型端點。');
  if(!(await aiConfirmExternal())) return;
  const old = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = icon('clock') + '生成中…';
  try{
    const r = await api(`/api/questions/${qid}/rubric`, {consentExternal:true});
    state.rubric = (r.rubric||[]).map(x=>({label:x.label||'', percent:Number(x.percent)||0}));
    rubricBind(prefix, state.rubric);
    toast(r.notice || '已生成評分標準草稿，請核對後再儲存。');
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
  $('#main').innerHTML=`<div class="fade-in">${heading('NEW QUESTION','新增題目','不必先匯入整份試卷，直接建立一道題目；圖形可以用 AI 生成、自己手繪或上傳圖片。')}<div class="import-layout"><section class="panel import-panel"><div class="form-field"><label class="field-label">題目圖形（可選）</label><div class="fig-source-row"><button type="button" class="secondary" id="newq-figure-btn">${icon('image')}開啟題目圖形</button><button type="button" class="secondary" id="newq-figure-clear">移除圖形</button><span class="small-text">AI 生成、核對、手繪、貼上或上傳圖片都在同一個工作室</span></div><div id="newq-figure-preview" class="fig-image-preview"></div></div><div class="ai-gen-box"><label class="field-label" for="newq-brief">AI 生成題目</label><div class="ai-gen-row"><input id="newq-brief" maxlength="600" placeholder="一句話說明想要什麼題目，例如：用超巿折扣情境考一元一次方程"><button type="button" class="secondary" id="newq-ai-gen">${icon('spark')}AI 生成題目</button></div><p class="field-hint">會依下面選的知識分類、子分類、年級、難度與題型生成一道新題，直接填入題目內容、選項、答案與詳解；生成後仍可自行修改。</p></div>${questionFormHtml('newq',{submitLabel:'建立題目'})}</section><div class="right-stack"><section class="panel right-panel"><h2>${icon('bulb')}出題小提示</h2><ul class="feature-list"><li><strong>${icon('spark')}AI 生成答案</strong>填好題目內容後可按「AI 生成答案與評分標準」，產生的內容仍可自行修改。</li><li><strong>${icon('image')}題目圖形</strong>AI 畫得不對時，可以在工作室裡直接手繪，也可以上傳課本截圖或貼上圖片。</li><li><strong>${icon('check')}建立之後</strong>題目直接進入題庫，可以立即用來佈置作業或讓學生練習。</li></ul></section></div></div></div>`;
  renderNewQuestionFigure();
  $('#newq-figure-btn').onclick=()=>openFigureStudio({
    title:$('#newq-title').value.trim(),content:$('#newq-content').value.trim(),
    topic:$('#newq-topic').value,subtopic:$('#newq-subtopic').value,qtype:$('#newq-qtype').value,
    figure:newQuestionFigure||'',
    apply:async figure=>{newQuestionFigure=figure||'';closeModal();renderNewQuestionFigure();
      toast(figure?'已設定題目圖形。':'已移除題目圖形。');}});
  $('#newq-figure-clear').onclick=()=>{newQuestionFigure='';renderNewQuestionFigure();toast('已移除題目圖形。');};
  // AI 出題：只給方向（分類／年級／難度／題型＋一句話要求），由 AI 出整道題；
  // 生成結果直接填進下面的表單，老師核對、修改後才按「建立題目」。
  $('#newq-ai-gen').onclick=async()=>{
    if(!S.ai.configured)return toast('AI 尚未設定：請先設定模型端點，或手動輸入題目。');
    if(!(await aiConfirmExternal()))return;
    const btn=$('#newq-ai-gen'),old=btn.innerHTML;
    btn.disabled=true;btn.innerHTML=icon('clock')+'AI 出題中…';
    $('#newq-error').textContent='';
    try{
      const r=await api('/api/questions/ai-generate',{
        topic:$('#newq-topic').value,subtopic:$('#newq-subtopic').value,
        grade:$('#newq-grade').value,level:Number($('#newq-level').value),
        qtype:$('#newq-qtype').value,points:Number($('#newq-points').value)||5,
        brief:$('#newq-brief').value.trim(),consentExternal:true});
      if(r.title)$('#newq-title').value=r.title;
      $('#newq-content').value=r.content||'';
      $('#newq-answer').value=r.answer||'';
      $('#newq-steps').value=(r.steps||[]).join('\n');
      $('#newq-analysis').value=r.analysis||'';
      if($('#newq-qtype').value==='選擇題'&&(r.options||[]).length){
        state.options.length=0;r.options.forEach(o=>state.options.push(o));renderQuestionOptions('newq',state);
      }
      const store=rubricStores.get('newq'),items=store?store.items:null;
      if(items){items.length=0;(r.rubric||[]).forEach(x=>items.push(x));}
      rubricRender('newq');
      toast('AI 已生成題目、選項、答案與詳解；請核對後按「建立題目」。');
    }catch(e){$('#newq-error').textContent=e.message;}
    finally{btn.disabled=false;btn.innerHTML=old;}
  };
  wireQuestionForm('newq',state,{figure:()=>newQuestionFigure||undefined,onSubmit:async draft=>{
    const btn=$('#newq-add');
    btn.disabled=true;btn.textContent='正在建立…';
    try{
      const made=await api('/api/questions/import',{questions:[draft],dedupe:true});
      if(!made.count){
        throw new Error(`題庫已經有這道題（${(made.skipped&&made.skipped[0]&&made.skipped[0].reason)||'內容相同'}），沒有重複加入。`);
      }
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
  return `<div class="form-grid form-grid-3">
    <div class="form-field"><label class="field-label" for="${prefix}-title">題目標題</label><input id="${prefix}-title" maxlength="200" placeholder="例如：直角三角形求斜邊"></div>
    <div class="form-field"><label class="field-label" for="${prefix}-topic">知識分類</label><select id="${prefix}-topic">${topics.map(t=>`<option>${t}</option>`).join('')}</select></div>
    <div class="form-field"><label class="field-label" for="${prefix}-subtopic">子分類</label><select id="${prefix}-subtopic"></select></div>
  </div>
  <div class="form-grid form-grid-4">
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
  ${rubricFieldHtml(prefix, [], qtype, o.qid)}
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
  if(el('ai-rubric'))el('ai-rubric').onclick=()=>aiFillRubric(prefix,state,el('ai-rubric'),o.qid);
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
      hint:el('hint').value.trim(),source:o.source||'手動輸入',tags:o.tags||[],
      figure:o.figure?o.figure():undefined});
  };
  // 初次載入也要跑一次 change：預設題型是選擇題，選項欄本來就該顯示（不然要切一次題型才看得到）。
  if(el('qtype'))el('qtype').dispatchEvent(new Event('change',{bubbles:true}));
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
async function verifyQuestion(qid){
  // 老師看過答案後按一下：拿掉「待核驗」，這題才能佈置作業
  try{
    const res=await api('/api/questions/verify',{ids:[Number(qid)]});
    if(!res.verified.length)return toast('這題已經核驗過了。');
    toast('已核驗，可以佈置作業了');
    await refresh().catch(()=>{});
    if(page==='bank')bank();
  }catch(e){toast(e.message);}
}
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
  modal(`<h2>編輯題目</h2><p class="field-hint">修改後直接更新題庫。已經批閱過的分數不變，但學生之後看到的題目會是新的版本。</p>${questionFormHtml('editq',{submitLabel:'儲存修改',figureHtml,qid:q.id})}`,true);
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
    qid:q.id,
    // 表單沒有「標籤／來源」欄位；不沿用原本的值，一存檔就會把
    // 「待核驗」洗掉（等於繞過核驗），來源也會變成「手動輸入」。
    source:q.source,
    tags:q.tags||[],
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
  const manualForm=questionFormHtml('manual',{submitLabel:'加入這道題目',figureHtml:manualFigureHtml});r.innerHTML=`<div class="form-field"><label class="field-label" for="paper-name">試卷名稱</label><input id="paper-name" value="${esc(paperName)}" placeholder="例如：中三數學 · 第一學期測驗" maxlength="200"></div><label class="dropzone" id="paper-drop">${icon('upload')}<strong id="paper-filename">${paperFile?esc(paperFile.name):'點擊或拖入試卷檔案'}</strong><small>文字型 PDF / PNG / JPG / Word（.docx）· 最多 10 MB · 掃描版 PDF 自動逐頁轉圖 · Word 方程式會轉成 LaTeX · 圖片會自動框出題目圖形並裁到題目右邊</small><input type="file" id="paper-upload" accept="application/pdf,image/png,image/jpeg,image/heic,image/heif,.heic,.heif,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" hidden></label><div class="divider-text"><span>或直接貼上題目文字</span></div><label class="field-label" for="paper-text">試卷內容<span class="small-text" style="font-weight:400">　數學式可用 LaTeX：$x^2-5x+6=0$、$\\frac{1}{2}$、$\\sqrt{3}$</span></label><textarea class="answer-field import-text" id="paper-text" placeholder="1. 解方程 $x^2-5x+6=0$。\n\n2. 直角三角形兩邊長為 $3\\text{cm}$ 及 $4\\text{cm}$，求斜邊長。\n\n3. 擲一枚公平骰子，求點數大於 4 的概率。" maxlength="79000">${esc(paperText)}</textarea><button class="text-button" id="sample-paper" style="font-size:calc(14px*var(--fs));margin-top:12px">填入示例試卷 ${icon('arrow')}</button>${S.ai.mode==='external'?`<label class="checkbox-line"><input type="checkbox" id="paper-consent">允許將試卷傳送到學校配置的外部 AI（未同意時，文字只用本地規則處理）</label>`:''}<div id="parse-error"></div><div class="submit-row"><span class="small-text">${S.ai.configured?'可用 AI 識別，仍需核驗':'本地規則拆題 · 分類結果需核驗'}</span><div class="row-actions"><button class="secondary" id="parse-paper">先拆分預覽 ${icon('spark')}</button><button class="primary" id="auto-import-paper">全自動拆分並匯入 ${icon('check')}</button></div></div><div class="divider-text"><span>或手動輸入題目並繪製圖形</span></div><div class="manual-entry">${manualForm}</div>`;$('#paper-name').oninput=e=>paperName=e.target.value;$('#paper-text').oninput=e=>{paperText=e.target.value;if(paperText.trim()){paperFile=null;$('#paper-filename').textContent='已使用貼上文字（不會同時提交檔案）';}};$('#sample-paper').onclick=()=>{paperName='中三數學 · 示例練習卷';paperText='1. 解方程 $x^2-5x+6=0$。\n\n2. 直角三角形兩條直角邊長為 $3\\text{ cm}$ 和 $4\\text{ cm}$，求斜邊長。\n\n3. 擲一枚公平骰子，求點數大於 4 的概率。\n\n4. 已知 $f(x)=2x+1$，求 $f(3)$。';paperFile=null;renderImportContent();};const select=async f=>{try{f=await normalizeHeicFile(f);const dataUrl=await fileData(f,['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.wordprocessingml.document','.docx']);const mime=/\.docx$/i.test(f.name||'')&&!f.type?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':f.type;paperFile={name:f.name,mime,dataUrl};paperText='';if(!paperName)paperName=f.name.replace(/\.[^.]+$/,'');renderImportContent();}catch(e){toast(e.message);}};$('#paper-upload').onchange=e=>select(e.target.files[0]);const d=$('#paper-drop');d.ondragover=e=>{e.preventDefault();d.classList.add('dragover');};d.ondragleave=()=>d.classList.remove('dragover');d.ondrop=e=>{e.preventDefault();select(e.dataTransfer.files[0]);};$('#parse-paper').onclick=parsePaper;$('#auto-import-paper').onclick=autoImportPaper;
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
async function autoImportPaper(){if(busy)return;if(!paperName.trim())return toast('請先填寫試卷名稱。');if(!paperFile&&!paperText.trim())return toast('請選擇試卷或貼上題目文字。');if(await askCancel('全自動拆分並直接寫入題庫？題目會標示為「自動匯入 · 待核驗」，可之後在題庫核對。'))return;const body={name:paperName.trim(),consentExternal:!!$('#paper-consent')?.checked};if(paperFile)Object.assign(body,{dataUrl:paperFile.dataUrl,mime:paperFile.mime});else body.text=paperText.trim();busy=true;const b=$('#auto-import-paper'),original=b.innerHTML;b.disabled=true;b.innerHTML=icon('clock')+'正在拆分並匯入…';try{const source=paperImageSource();const r=await api('/api/papers/auto-import',body);
    // 題目已寫入題庫，圖形改由 POST /api/questions/figures 補上（一次批次送出）。
    const cropped=await attachFigureBoxes(r.questions||[],r.figureBoxes||[],source);
    if(cropped){const figures=(r.questions||[]).filter(q=>q.figure).map(q=>({id:q.id,figure:q.figure}));if(figures.length)await api('/api/questions/figures',{figures});}
    await refresh();drafts=[];paperText='';paperFile=null;importStage=1;
    toast(`已全自動匯入 ${r.count} 題（${r.method}）${cropped?`，並自動裁出 ${cropped} 題圖形`:''}，請在題庫核對題型與答案。`);bank();}catch(e){$('#parse-error').innerHTML=`<div class="inline-error">${esc(e.message)}</div>`;}finally{busy=false;if($('#auto-import-paper')){$('#auto-import-paper').disabled=false;$('#auto-import-paper').innerHTML=original;}}}

async function saveDrafts(){if(busy)return;if(!$('#confirm-drafts').checked)return toast('請確認已核驗題目及評分依據。');if(!drafts.length)return toast('沒有可匯入的題目。');const rp=drafts.map(q=>isObjectiveQtype(q.qtype)?'':rubricProblem(q.rubric)).find(Boolean);if(rp)return $('#import-error').innerHTML=`<div class="inline-error">${esc(rp)}</div>`;busy=true;$('#save-drafts').disabled=true;try{const verified=drafts.map(q=>{const isChoice=q.qtype==='選擇題';const options=isChoice?(q.options||[]).map(o=>String(o||'').trim()).filter(Boolean):[];return {...q,options,rubric:isObjectiveQtype(q.qtype)?[]:cleanRubric(q.rubric),tags:(q.tags||[]).filter(t=>!/(?:待.*(?:確認|确认|核驗|核验|審核|审核))/.test(t))};});const imp=await api('/api/questions/import',{questions:verified,dedupe:true});await refresh();importStage=3;importPage();
      const skip=(imp.skipped||[]).length;
      toast(skip?`已保存 ${imp.count} 題；另有 ${skip} 題題庫已有，已略過。`:'已成功保存到本地題庫。');}catch(e){$('#import-error').innerHTML=`<div class="inline-error">${esc(e.message)}</div>`;if($('#save-drafts'))$('#save-drafts').disabled=false;}finally{busy=false;}}
// 「新批閱」：教師批閱後學生還沒點開看過。用 reviewedAt 當版本號記在 localStorage，
// 教師日後再改分數 reviewedAt 會變，就會重新標一次；只記這台裝置，不上傳。
function reviewSeenMap(){
  try{const raw=localStorage.getItem('mathpath_review_seen');const v=raw?JSON.parse(raw):{};return v&&typeof v==='object'?v:{};}catch{return {};}
}
function isNewReview(a){
  if(!a||!S.user||S.user.role!=='student')return false;
  if(!a.teacherReviewed||!a.reviewedAt)return false;
  return reviewSeenMap()[a.id]!==a.reviewedAt;
}
function markReviewSeen(a){
  if(!a||!a.reviewedAt||!S.user||S.user.role!=='student')return;
  const seen=reviewSeenMap();seen[a.id]=a.reviewedAt;
  // 只留最近 300 筆：localStorage 有配額，久遠的紀錄留著也沒人會看。
  const ids=Object.keys(seen);
  if(ids.length>300)ids.sort((x,y)=>Number(x)-Number(y)).slice(0,ids.length-300).forEach(id=>delete seen[id]);
  try{localStorage.setItem('mathpath_review_seen',JSON.stringify(seen));}catch{}
}
const NEW_REVIEW_BADGE='<span class="badge new-review">新批閱</span>';
// 批閱頁「載入更多」：/api/state 只帶最近 200 筆，其餘靠 /api/reviews 一頁頁補。
let reviewLoadedAll=false;
function recordsPage(){page='mistakes';shell();if(!S.user)return loginModal(recordsPage);const teacher=S.user.role==='teacher';
  // 教師每天真正要做的是「批閱待批的」——第一次進來就先篩這個，不必手動切。
  // 一旦自己切換過篩選，就尊重他的選擇，不再自動改。
  if(teacher&&!historyFilterTouched)historyFilter='pending';
  const filtered=S.attempts.filter(a=>historyFilter==='all'||historyFilter==='pending'&&a.needsReview||historyFilter==='wrong'&&a.status==='graded'&&a.score<a.maxScore||historyFilter==='saved'&&bookmarks.has(a.questionId));// 教師批閱時用「畫面上這份清單」當待批佇列，存檔後一路批到完。
// 建議覆核的題目排前面：教師一打開就先看到最需要判斷的那幾題（其餘順序不變）。
const ordered=teacher?[...filtered].sort((x,y)=>(y.reviewFlags?.length?1:0)-(x.reviewFlags?.length?1:0)):filtered;
const reviewQueue=teacher?ordered.map(x=>x.id).join(','):'';$('#main').innerHTML=`<div class="fade-in">${heading(teacher?'REVIEW & FEEDBACK':'REFLECT & IMPROVE',teacher?'作答批閱':'我的錯題本',teacher?'看見學生的推導，用簡短回饋引導下一步。':'錯題不是終點。回看思路，再用相似題鞏固理解。',`<button class="secondary" id="refresh-records">${icon('undo')}重新整理</button>`)}<div class="history-filters">${[['all',teacher?'全部作答':'全部紀錄'],['wrong','需要鞏固'],['pending','等待批閱'],['saved','已收藏題目']].map(([id,t])=>`<button data-history="${id}" class="${historyFilter===id?'active':''}">${t}</button>`).join('')}</div><section class="panel records-panel">${filtered.length?filtered.map(a=>`<article class="record"><div class="record-icon">${icon(a.status==='pending'?'clock':a.score<a.maxScore?'mistakes':'check')}</div><div class="record-main"><strong>${esc(a.questionTitle)}</strong> <span class="badge">${esc(a.topic)}</span>${teacher&&a.reviewFlags?.length?'<span class="badge review-flag">建議覆核</span>':''}${!teacher&&isNewReview(a)?NEW_REVIEW_BADGE:''}${teacher&&!a.assignmentId&&!a.mockId?'<span class="badge self-practice">自主練習 · 不需批閱</span>':''}<p>${mathText(a.feedback)}</p>${teacher?(a.suggestion?`<details class="record-advice"><summary>學習建議與推薦題目</summary>${suggestionCard(a.suggestion)}</details>`:''):suggestionCard(a.suggestion)}<small>${esc(new Date(a.submittedAt).toLocaleString('zh-HK'))}${teacher&&a.student?' · '+esc(a.student.name):''} · ${teacher&&!a.assignmentId&&!a.mockId?'學生自主練習 · 不計入作業成績':a.teacherReviewed?'教師已覆核':a.gradingMethod==='awaiting-review'?'已提交 · 等待教師批閱':a.gradingMethod==='rule-final'?'規則核對 · 非步驟評分':a.gradingMethod==='ai-practice'?'AI 即時評分 · 不需教師批閱':a.gradingMethod==='ai-advisory'?'AI 建議 · 未教師覆核':'等待教師'}</small><div class="record-actions">${teacher?'':`<button class="secondary" data-qid="${a.questionId}">再練一次 ${icon('arrow')}</button>`}${teacher&&!a.assignmentId&&!a.mockId?`<button class="secondary" data-review="${a.id}" data-review-view="1">查看作答</button>`:`<button class="${teacher?'primary':'secondary'}" data-review="${a.id}" data-review-queue="${reviewQueue}">${teacher?'查看與批閱':'查看作答'}</button>`}</div></div><div class="record-score">${a.status==='pending'?'待批閱':`${a.score} <small>/ ${a.maxScore} 分</small>`}</div></article>`).join(''):empty(historyFilter==='wrong'?'目前沒有需鞏固的題目':'還沒有作答紀錄',historyFilter==='pending'?'提交手寫作答後，可在這裡查看批閱進度。':'開始一道練習，讓思考留下足跡。',`${teacher?`<button class="secondary" data-page="bank">前往數學題庫 ${icon('arrow')}</button>`:''}`)}</section>${teacher&&S.attemptsTruncated&&!reviewLoadedAll?`<div class="records-more"><button class="secondary" id="records-more">載入更多（目前顯示最近 ${S.attempts.length} 筆）</button></div>`:''}</div>`;$('#refresh-records').onclick=async()=>{try{await refresh();reviewLoadedAll=false;recordsPage();toast('已讀取最新批閱紀錄。');}catch(e){toast(e.message);}};
  const moreBtn=$('#records-more');
  if(moreBtn)moreBtn.onclick=async()=>{
    const ids=S.attempts.filter(a=>a.assignmentId).map(a=>a.id);
    const before=ids.length?Math.min(...ids):0;
    const old=moreBtn.textContent;moreBtn.disabled=true;moreBtn.textContent='載入中…';
    try{
      const res=await api(`/api/reviews?status=all&limit=100${before?`&before=${before}`:''}`);
      (res.items||[]).forEach(at=>{const i=S.attempts.findIndex(x=>x.id===at.id);if(i<0)S.attempts.push(at);else S.attempts[i]=at;});
      reviewLoadedAll=!res.hasMore;
      recordsPage();
    }catch(e){toast(e.message);moreBtn.disabled=false;moreBtn.textContent=old;}
  };}
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
async function annotationRefresh(attempt){if(ann.shapes?.length&&await askCancel('畫面將重新載入，你尚未儲存的紅筆批註會遺失。確定繼續？'))return;closeModal();reviewModal(attempt.id,annotationDone);}
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
c.onpointerdown=async e=>{if(!ann.base)return;if(e.button!==0&&e.pointerType==='mouse')return;e.preventDefault();const p=pos(e);if(ann.tool==='select'){const hit=annHitShape(p);ann.selected=hit>=0?hit:null;ann.dragging=hit>=0?{index:hit,last:p}:null;if(hit>=0)try{c.setPointerCapture(e.pointerId);}catch(_){}syncAnnSelection();redrawAnn();return;}if(ann.tool==='text'){const t=(await askPrompt('輸入要寫在圖上的批註文字（例如：這裡漏了負號）')||'').trim();if(t)ann.shapes.push({type:'text',x:p.x,y:p.y,text:t.slice(0,120)});redrawAnn();$('#ann-status').textContent='已加入文字批註，記得儲存。';return;}c.setPointerCapture(e.pointerId);ann.drawing=ann.tool==='pen'||ann.tool==='highlight'||ann.tool==='eraser'?{type:ann.tool==='highlight'?'highlight':'pen',points:[p],erase:ann.tool==='eraser'}:{type:ann.tool,a:p,b:p};redrawAnn();};
c.onpointermove=e=>{if(ann.dragging){e.preventDefault();const p=pos(e),s=ann.shapes[ann.dragging.index];if(s){annTranslate(s,p.x-ann.dragging.last.x,p.y-ann.dragging.last.y);ann.dragging.last=p;redrawAnn();$('#ann-status').textContent='批註尚未儲存';}return;}if(!ann.drawing)return;e.preventDefault();const p=pos(e);if(ann.drawing.points)ann.drawing.points.push(p);else ann.drawing.b=p;redrawAnn();};
c.onpointerup=c.onpointercancel=c.onlostpointercapture=()=>{ann.dragging=null;const d=ann.drawing;ann.drawing=null;if(!d)return;if(d.type==='pen'&&d.erase){const pts=d.points;ann.shapes=ann.shapes.filter(s=>!(s.points||[]).some(q=>pts.some(p=>Math.hypot(p.x-q.x,p.y-q.y)<30)));}else if(d.points){if(d.points.length>=2)ann.shapes.push(d);}else if(Math.hypot(d.b.x-d.a.x,d.b.y-d.a.y)>=12){ann.shapes.push(d);}ann.selected=null;syncAnnSelection();redrawAnn();if(ann.shapes.length)$('#ann-status').textContent='批註尚未儲存';};
$$('[data-ann-tool]').forEach(b=>b.onclick=()=>{ann.tool=b.dataset.annTool;$$('[data-ann-tool]').forEach(x=>x.classList.toggle('active',x===b));if(ann.tool!=='select')ann.selected=null;syncAnnSelection();});
$('#ann-delete').onclick=deleteAnnSelected;
$('#ann-edit-text').onclick=async()=>{const s=ann.selected!=null?ann.shapes[ann.selected]:null;if(!s||s.type!=='text')return;const next=await askPrompt('修改這則文字批註',s.text);if(next===null)return;const t=next.trim();if(!t)return toast('文字不可留空；要移除請用「刪除選取」。');s.text=t.slice(0,120);redrawAnn();$('#ann-status').textContent='文字已修改，記得儲存。';};
const annSize=$('#ann-item-size');
if(annSize)annSize.oninput=()=>{const s=ann.selected!=null?ann.shapes[ann.selected]:null;if(!s)return;s.size=Number(annSize.value);const v=$('#ann-item-size-value');if(v)v.textContent=String(s.size);redrawAnn();$('#ann-status').textContent='批註尚未儲存';};
syncAnnSelection();
$('#ann-undo').onclick=()=>{if(!ann.shapes.length)return toast('沒有可撤銷的批註。');ann.shapes.pop();ann.selected=null;syncAnnSelection();redrawAnn();$('#ann-status').textContent='已撤銷一筆，記得儲存。';};
$('#ann-clear').onclick=async()=>{if(!ann.shapes.length)return;if(await askCancel('清除圖上所有批註？原有手寫內容不受影響。'))return;ann.shapes=[];ann.selected=null;syncAnnSelection();redrawAnn();$('#ann-status').textContent='已清除全部批註，記得儲存。';};
$('#ann-save').onclick=async()=>{const b=$('#ann-save');b.disabled=true;$('#ann-status').textContent='正在儲存批註…';try{const {attempt}=await api(`/api/attempts/${a.id}/annotation`,{image:imageDataUrl(c)});const i=S.attempts.findIndex(x=>x.id===attempt.id);if(i<0)S.attempts.push(attempt);else S.attempts[i]=attempt;toast('批註已儲存，學生可查看。');closeModal();if(annotationDone)annotationDone();}catch(e){$('#ann-status').textContent=e.message;b.disabled=false;}};
const aiBtn=$('#ai-annotate');
if(aiBtn)aiBtn.onclick=async()=>{if(S.ai.mode==='external'&&await askCancel('AI 批註會將這位學生的手寫照片及本題內容，傳送至學校配置的外部 AI 服務，是否繼續？'))return;const original=aiBtn.innerHTML;aiBtn.disabled=true;aiBtn.innerHTML=icon('clock')+'AI 正在看手稿…';try{const {attempt}=await api(`/api/attempts/${a.id}/ai-annotation`,{consentExternal:S.ai.mode==='external'});const i=S.attempts.findIndex(x=>x.id===attempt.id);if(i<0)S.attempts.push(attempt);else S.attempts[i]=attempt;const n=attempt.aiAnnotation?.issues?.length||0;toast(n?`AI 建議 ${n} 處，須由教師覆核。`:'AI 未標示任何錯處；這不代表作答正確，請教師自行檢視。');annotationRefresh(attempt);}catch(e){toast(e.message);aiBtn.disabled=false;aiBtn.innerHTML=original;}};
const aiClear=$('#ai-clear');
if(aiClear)aiClear.onclick=async()=>{if(await askCancel('清除 AI 建議批註？教師自己的批註不受影響。'))return;try{const {attempt}=await api(`/api/attempts/${a.id}/ai-annotation`,{clear:true});const i=S.attempts.findIndex(x=>x.id===attempt.id);if(i<0)S.attempts.push(attempt);else S.attempts[i]=attempt;toast('已清除 AI 批註。');annotationRefresh(attempt);}catch(e){toast(e.message);}};}
let aiDrag=null,aiJustDragged=false;
// 教師可以直接拖動：圓形標記、AI 批語框、印章。三種都寫回同一組相對座標。
const aiMovableTarget=e=>e.target&&e.target.closest?e.target.closest('.ai-mark-layer.draggable .ai-mark, .ai-ink-layer.editable .movable'):null;
document.addEventListener('pointerdown',e=>{const m=aiMovableTarget(e);if(!m)return;const wrap=m.closest('.mark-wrap');if(!wrap)return;const r=wrap.getBoundingClientRect(),b=m.getBoundingClientRect();aiDrag={m,r,dx:e.clientX-(b.left+b.width/2),dy:e.clientY-(b.top+b.height/2),x0:e.clientX,y0:e.clientY,moved:false};try{m.setPointerCapture(e.pointerId);}catch(_){}e.preventDefault();});
document.addEventListener('pointermove',e=>{if(!aiDrag)return;const {m,r}=aiDrag;if(Math.abs(e.clientX-aiDrag.x0)+Math.abs(e.clientY-aiDrag.y0)>4)aiDrag.moved=true;let x=e.clientX-aiDrag.dx-r.left,y=e.clientY-aiDrag.dy-r.top;x=Math.min(Math.max(x,0),r.width);y=Math.min(Math.max(y,0),r.height);m.style.left=(x/r.width*100)+'%';m.style.top=(y/r.height*100)+'%';const st=document.getElementById('ai-adjust-status');if(st)st.textContent='位置已改動，記得按「儲存調整」。';});
// 拖曳結束後緊接著的 click 要忽略，否則一放手就跳出修改文字。
['pointerup','pointercancel'].forEach(t=>document.addEventListener(t,()=>{if(aiDrag&&aiDrag.moved){aiJustDragged=true;setTimeout(()=>{aiJustDragged=false;},400);}aiDrag=null;}));
// 點一下（沒有拖動）批語就改文字：教師可以直接改寫 AI 的說法，不必整組重來。
document.addEventListener('click',async e=>{
  const el=e.target&&e.target.closest?e.target.closest('.ai-ink-layer.editable .ai-callout'):null;
  if(!el||aiJustDragged)return;
  const layer=el.closest('.ai-ink-layer'),data=layer&&AI_INK_DATA.get(Number(layer.dataset.ink));
  if(!data)return;
  const key=el.dataset.place||'';
  if(key==='summary'){
    const next=await askPrompt('修改 AI 總結（會直接寫在學生的手稿上）',data.summary);
    if(next===null)return;
    const t=next.trim();
    if(!t)return toast('總結不可留空；如要移除整組批註，請按「清除 AI 批註」。');
    data.summary=t.slice(0,80);
  }else if(key.startsWith('issue:')){
    const it=data.issues[Number(key.slice(6))];
    if(!it)return;
    const next=await askPrompt('修改這則批註（格式：標籤 | 說明）',`${it.label} | ${it.comment}`);
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
// 分數異動紀錄：誰在何時把幾分改成幾分。有爭議時就靠這個說清楚。
async function loadReviewHistory(attemptId){
  const box=$('#review-history');
  if(!box)return;
  try{
    const r=await api(`/api/attempts/${attemptId}/history`);
    if(!box.isConnected)return;          // 佇列已經跳到下一題，別把紀錄寫進新彈窗
    const rows=r.reviews||[];
    if(!rows.length)return;
    box.innerHTML=`<details class="review-history-box"><summary>分數異動紀錄（${rows.length} 次）</summary><ul>${rows.map(x=>{
      const when=esc(String(x.createdAt||'').replace('T',' ').slice(0,16));
      const from=x.oldScore==null?'—':scoreText(x.oldScore);
      return `<li><span class="small-text">${when} · ${esc(x.teacherName||'未知')}</span>　${from} → <strong>${scoreText(x.newScore)}</strong>${x.feedback?`<span class="small-text">　${esc(x.feedback)}</span>`:''}</li>`;
    }).join('')}</ul></details>`;
  }catch(e){ if(box.isConnected)box.innerHTML=''; }
}

async function reviewModal(id,onDone=null,snapshot=null,queue=null,viewOnly=false){
  let a=S.attempts.find(a=>a.id===Number(id));if(!a)return;
  // 列表只帶摘要（答案全文／詳解／建議在詳情端點），開視窗前先補齊。
  if(a.lite){
    try{
      const full=await api(`/api/attempts/${a.id}`);
      // 詳情端點不會帶 student（那是列表才有），合併時要保留，否則視窗上沒有學生名。
      const merged={...full.attempt, student:a.student, lite:false};
      const i=S.attempts.findIndex(x=>x.id===a.id);
      if(i>=0)S.attempts[i]=merged;
      a=merged;
    }catch(e){return toast(e.message);}
  }
  // 先判斷「是不是新批閱」再標記已讀，否則一進彈窗就自己把標記吃掉。
  const freshReview=isNewReview(a);
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
  modal(`<p class="eyebrow">${teacher?'TEACHER REVIEW':'YOUR THINKING'}</p><h2>${esc(a.questionTitle)}</h2><p class="modal-intro">${a.maxScore} 分${a.student?' · '+esc(a.student.name):''}${progress?' · '+progress:''}${freshReview?' '+NEW_REVIEW_BADGE:''}</p>${q&&(q.content||q.figure)?stemHtml(q,{options:false}):''}${annotationBlock(a,teacher)}${a.skipped&&teacher?`<div class="hint-box">${icon('help')}學生標示本題不會，沒有作答內容。可以給 0 分，或用「退回訂正」要求他重做。</div>`:''}${teacher&&a.reviewFlags?.length?`<div class="hint-box review-flag-box">${icon('help')}<div><strong>建議覆核</strong><ul class="review-flag-list">${a.reviewFlags.map(f=>`<li>${esc(f.message)}</li>`).join('')}</ul><small>這是系統的交叉檢查提示，不是自動改分；請以你看到的推導為準。</small></div></div>`:''}${a.answerText?`<div class="review-answer">${mathText(a.answerText)}</div>`:''}${teacher&&(q?.answer||q?.steps?.length||q?.analysis||q?.rubric?.length)?`<div class="hint-box"><strong>教師參考答案：</strong>${q?.answer?mathText(q.answer):'（未填）'}${(q?.steps||[]).length?`<ol class="solution-steps">${q.steps.map(x=>`<li>${mathText(x)}</li>`).join('')}</ol>`:''}${q?.analysis?`<p class="solution-analysis">${mathText(q.analysis)}</p>`:''}${rubricChecklistHtml(q?.rubric,a.maxScore)}</div>`:''}${a.awaitingReview&&!teacher?`<div class="hint-box">${icon('clock')}教師批閱後才會顯示分數、AI 批閱結果、參考答案與學習建議。你的作答已保存。</div>`:`<p class="info-note${feedbackClass(a.feedback)}">${mathText(a.feedback)}</p>${suggestionCard(a.suggestion)}<p class="field-hint">AI 原建議分：${scoreText(a.aiScore)} · 規則原分：${scoreText(a.ruleScore)} · 教師確認：${scoreText(a.confirmedScore)}</p>${teacher?'<div id="review-history"></div>':''}`}${teacher?`<form id="review-form"><div class="form-field"><label class="field-label" for="review-score">評分（0–${a.maxScore}）</label><input id="review-score" type="number" min="0" max="${a.maxScore}" step="any" value="${a.score??''}" required></div><div class="form-field"><label class="field-label" for="review-feedback">簡要評語 / 下一步建議 <span class="small-text">· 可留空</span></label><textarea class="answer-field" id="review-feedback" placeholder="可留空；若要寫，指出做得好的步驟，再給一個具體可改進的地方。" maxlength="12000"></textarea></div><p id="review-error" class="error-text"></p>${a.aiScore!=null?`<button class="secondary wide" type="button" id="adopt-ai">${icon('spark')}採用 AI 建議（${a.aiScore} 分）</button>`:''}<button class="primary wide" type="submit">${nextId?'保存並看下一題':'保存教師批閱'} ${icon('check')}</button></form>`:`${showRetry?`<button class="secondary wide" id="retry-from-review">再練一次 ${icon('arrow')}</button>`:''}`}`,true);
  // 給手機版樣式一個掛鉤：手稿放大、評分欄貼底。
  const reviewBox=$('#modal-root .modal');if(reviewBox)reviewBox.classList.add('review-modal');
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
    // 評分要點勾選：勾完自動加總填進分數欄。一項都沒勾時不動分數欄，
    // 免得把教師已經打好的分數清掉（開啟已批過的作答時就是這種情況）。
    const rubricBox=$('#review-rubric');
    if(rubricBox){
      const boxes=()=>[...rubricBox.querySelectorAll('input[type=checkbox]')];
      const hint=$('#rubric-total-hint');
      const refresh=()=>{
        const picked=boxes().filter(b=>b.checked);
        const sum=picked.reduce((s,b)=>s+(Number(b.dataset.rubricPoints)||0),0);
        const total=Math.round(sum*10)/10;
        if(hint)hint.textContent=`已勾 ${picked.length}/${boxes().length} 項 · 合計 ${total} 分`;
        if(picked.length)$('#review-score').value=String(total);
      };
      boxes().forEach(b=>b.onchange=refresh);
      const all=$('#rubric-all'),none=$('#rubric-none');
      if(all)all.onclick=()=>{boxes().forEach(b=>b.checked=true);refresh();};
      if(none)none.onclick=()=>{boxes().forEach(b=>b.checked=false);refresh();};
    }
    $('#review-form').onsubmit=async e=>{e.preventDefault();await saveReview(Number($('#review-score').value),$('#review-feedback').value);};
    loadReviewHistory(a.id);
    const adopt=$('#adopt-ai');
    if(adopt)adopt.onclick=()=>{$('#review-score').value=a.aiScore;saveReview(a.aiScore,$('#review-feedback').value);};
  }else{const retry=$('#retry-from-review');if(retry)retry.onclick=()=>{closeModal();openQuestion(a.questionId);};}
  paintAllAiInk();
  // 學生已經看到這次批閱（含分數與評語），下次不再標「新批閱」。
  markReviewSeen(a);
}
// 紙本批改：教師上傳整份功課（題目 + 學生手寫答案），AI 逐題判斷並以 100 分制評分。
async function paperPageData(file){
  // HEIC／HEIF（iPhone 預設格式）：先轉成 WebP。Safari 原生支援，其他瀏覽器用 heic2any。
  if(/^image\/hei[cf]/i.test(file.type)||/\.hei[cf]$/i.test(file.name||'')){
    return await heicToWebp(file);
  }
  // PDF：不在前端轉圖（可能多頁），原樣交給後端渲染。
  if(file.type==='application/pdf'||/\.pdf$/i.test(file.name||'')){
    return await fileData(file,['application/pdf'],20);
  }
  const raw=await fileData(file,['image/png','image/jpeg','image/webp'],12);
  const img=await loadImageDataUrl(raw,'這頁無法辨識，請改用 JPG／PNG 或重新拍照。');
  const scale=Math.min(1,2000/Math.max(img.naturalWidth,img.naturalHeight));
  const out=document.createElement('canvas');
  out.width=Math.max(1,Math.round(img.naturalWidth*scale));
  out.height=Math.max(1,Math.round(img.naturalHeight*scale));
  const ctx=out.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);
  ctx.drawImage(img,0,0,out.width,out.height);
  return imageDataUrl(out);
}
let paperPages=[],paperGradeId=null,paperCurrentGrade=null;
// 批次批改的結果（給「教師改判後即時更新列表」用）
let paperBatchGrades=null;
// 教師按「判對／判錯」或直接改分後，批次結果列表的那一行也要跟著更新：
// 分數、答對題數、還有幾題待判。否則卷面改了、列表仍是舊數字，老師會以為沒生效。
function updatePaperRow(g){
  if(!g||g.id==null)return;
  const tr=$(`tr[data-grade-row="${g.id}"]`);
  if(tr){
    const cells=tr.children;
    if(cells[1])cells[1].innerHTML=`<strong>${g.score==null?'—':fmtScore(g.score)}</strong> <span class="small-text">/ 100</span>`;
    if(cells[2]){
      const pending=g.pending?` · <span class="paper-pending">${g.pending} 題待判</span>`:'';
      cells[2].innerHTML=`${g.totalQuestions==null?'—':g.totalQuestions} 題 · 對 ${g.correctCount==null?'—':g.correctCount}${pending}`;
    }
  }
  if(paperBatchGrades){
    const hit=paperBatchGrades.find(x=>String((x.grade||{}).id)===String(g.id));
    if(hit)hit.grade=Object.assign({},hit.grade,g);
  }
}
// 五級鼓勵句：同一份功課內不重複（用 used 集合挑沒用過的）。
const PAPER_PRAISE={
  excellent:['完全正確，思路很清楚！','這題漂亮，答案和過程都對。','做得很好，繼續保持這個水準。','完全正確，看得出你掌握了方法。','答對了，而且寫得很完整。','這題難不倒你，很好。'],
  good:['大致正確，注意小細節就更好了。','方向對了，再檢查最後一步。','很接近了，把單位或格式補上。','思路正確，只是小地方疏忽。','答得不錯，細節再留心一點。','差一點點就完美，繼續。'],
  partial:['一半對，關鍵步驟你抓到了。','部分正確，把錯的那半再算一次。','有對有錯，這是進步的空間。','抓住重點了一半，再加把勁。','思路有一半是對的，值得肯定。','部分對了，把後面的補完。'],
  weak:['有一點對，別灰心，慢慢來。','先看清楚題目要求，再試一次。','這題偏難，你已經找到一個切入點。','大部分錯了，但錯在哪裡很值得看。','再從第一步想一次，你可以的。','卡住了沒關係，明天再試。'],
  wrong:['這題不影響你的努力，繼續前進。','答案不對，但願意嘗試就值得肯定。','先讀懂題目，再想解法的第一步。','錯了不要緊，重點是找出原因。','這題先放一放，回頭再來看。','換個角度想，可能會通。'],
  unreadable:['這題看不清，已請教師判定。','照片有點模糊，這題先不算分。','字跡看不清楚，等教師確認。']
};
function paperPraise(level,used){
  const pool=PAPER_PRAISE[level]||[];
  if(!pool.length)return '';
  const start=Math.floor(Math.random()*pool.length);
  for(let k=0;k<pool.length;k++){
    const i=(start+k)%pool.length,key=level+':'+i;
    if(!used.has(key)){used.add(key);return pool[i];}
  }
  return pool[start];
}
const PAPER_LEVEL_LABEL={excellent:'完全正確',good:'大致正確',partial:'部分正確',weak:'少部分正確',wrong:'完全錯誤',unreadable:'無法辨認'};
function paperResultHtml(g){
  paperCurrentGrade=g;
  const qs=g.questions||[];
  const confirmed=!!g.confirmed;
  const used=new Set();   // 同一份功課內，鼓勵句不重複
  const levelOf=(q)=>q.level||(q.correct===null?'unreadable':q.correct===true?'excellent':q.correct==='partial'?'partial':'wrong');
  const markOf=(q)=>{
    const lv=levelOf(q);
    if(lv==='unreadable')return '<span class="paper-pending">待判定</span>';
    const label=PAPER_LEVEL_LABEL[lv]||'';
    const doll=lv==='excellent'?' <span class="paper-doll" title="完全正確">🎉</span>':'';
    return `<span class="paper-level">${label}</span>${doll}`;
  };
  const rows=qs.map((q,i)=>{
    const lv=levelOf(q);
    const praise=paperPraise(lv,used);
    const fix=(q.correct===null&&!confirmed)?`<div class="paper-judge"><button class="text-button" data-paper-judge="${i}" data-paper-verdict="1">判對</button><button class="text-button" data-paper-judge="${i}" data-paper-verdict="0">判錯</button></div>`:'';
    // 這題實際得分（0–points）：老師可以直接改，改完分數與等級會一起重算
    const earned=(q.points!=null&&q.credit!=null)?Math.round(q.points*q.credit*10)/10:null;
    const scoreCell=q.points
      ? `<input class="paper-score-input" type="number" min="0" max="${q.points}" step="0.5"
           data-score-index="${i}" data-max="${q.points}" data-orig="${earned??''}"
           value="${earned??''}" title="可直接改這題得分（0–${q.points}）"${confirmed?' disabled':''}><span class="small-text"> / ${q.points}</span>`
      : '<span class="small-text">平均</span>';
    const noteText=esc(q.note||q.reason||'');
    // 二次批閱的痕跡：已補判的標出信心；仍待判但二次有猜測的，直接把「最可能」寫給老師看
    const secondTag=q.secondPass
      ? `<div class="pb-second-tag" title="${esc((q.secondGuess&&q.secondGuess.reason)||'二次批閱')}">二次批閱${q.secondConfidence!=null?` ${Math.round(q.secondConfidence*100)}%`:''}</div>`
      : (q.correct===null&&q.secondGuess
        ? `<div class="pb-second-guess">最可能：${q.secondGuess.correct===true?'對':q.secondGuess.correct===false?'錯':'部分正確'}（信心 ${Math.round((q.secondGuess.confidence||0)*100)}%）</div>`
        : '');
    // data-label：手機上表格會變成卡片，用 ::before 顯示欄位名稱
    const noteCell=confirmed
      ? `<td class="small-text pq-note" data-label="批註">${noteText}</td>`
      : `<td class="small-text paper-note-cell pq-note" contenteditable="true" data-note-index="${i}"
        data-label="批註" data-orig="${noteText}" title="點一下可直接改批註">${noteText}</td>`;
    return `<tr>
      <td class="pq-no" data-label="題號">${esc(q.number)}</td>
      <td class="pq-q" data-label="題目">${mathText(q.question||'')}</td>
      <td class="pq-ans" data-label="學生答案">${mathText(q.studentAnswer||'—')}</td>
      <td class="pq-score" data-label="配分">${scoreCell}</td>
      <td class="pq-mark" data-label="判定">${markOf(q)}${fix}${secondTag}${praise?`<div class="paper-praise">${esc(praise)}</div>`:''}</td>
      ${noteCell}</tr>`;
  }).join('');
  const pagesHtml=(paperPages||[]).map((src,i)=>{
    const pageQs=qs.filter(q=>q.page===i+1);
    // 題目框：虛線、透明底；框內左上角題號、左邊判定符號；可拖動調整位置
    const marks=pageQs.filter(q=>q.box).map(q=>{
      const b=q.box;
      const lv=q.level||(q.correct===null?'unreadable':q.correct===true?'excellent':q.correct==='partial'?'partial':'wrong');
      const sym=lv==='unreadable'?'?':lv==='excellent'?'✓':lv==='good'?'◑':lv==='partial'?'◐':lv==='weak'?'◔':'✗';
      const doll=lv==='excellent'?'🎉':'';
      const idx=qs.indexOf(q);
      return `<span class="paper-mark" data-box-index="${idx}" style="left:${b.x*100}%;top:${b.y*100}%;width:${b.w*100}%;height:${b.h*100}%" title="拖動可移動這個框">
        <span class="paper-mark-no">${esc(q.number)}</span>
        <span class="paper-mark-sym">${sym}${doll}</span>
        <span class="paper-mark-resize" title="拖動右下角可調整大小"></span>
      </span>`;
    }).join('');
    // 評註：預設放在該題框的右下角；老師拖過就以拖動的位置為準（noteBoxTeacher）
    const notes=pageQs.filter(q=>q.box).map(q=>{
      const raw=(q.note||q.reason||'').trim();
      if(!raw)return '';
      const b=q.box;
      const nb=(q.noteBoxTeacher&&q.noteBox&&typeof q.noteBox.x==='number')?q.noteBox:null;
      const left=nb?nb.x:b.x+b.w*0.5;
      const top=nb?nb.y:b.y+b.h*0.55;
      const width=nb?(nb.w||0.3):Math.max(0.22,b.w*0.5);
      const idx=qs.indexOf(q);
      return `<div class="paper-note" data-note-index="${idx}" style="left:${left*100}%;top:${top*100}%;width:${width*100}%" title="拖動可移動評註">${esc(raw)}</div>`;
    }).join('');
    // 成績在第一頁右上角（30px）
    const badge=i===0?`<div class="paper-score-badge">${g.score}<small>/100</small></div>`:'';
    // 整份作業一題都判定不了：第一頁右下角用橙色大字提醒
    const allUnreadable=qs.length>0&&qs.every(q=>q.level==='unreadable'||q.correct===null);
    const warn=(i===0&&allUnreadable)?`<div class="paper-warn"><strong>AI 無法辨識這份作業</strong><span>請教師逐題判定，或重新上傳更清晰的照片</span></div>`:'';
    // 左邊批改卷（標記＋評語）、右邊原卷（乾淨，方便對照）
    const gradedFig=`<figure class="paper-page"><img src="${src}" alt="批改卷 第 ${i+1} 頁"><figcaption>批改卷 · 第 ${i+1} 頁</figcaption>${badge}${warn}<div class="paper-marks">${marks}</div>${notes}</figure>`;
    const rawFig=`<figure class="paper-page paper-page-raw"><img src="${src}" alt="原卷 第 ${i+1} 頁"><figcaption>原卷 · 第 ${i+1} 頁</figcaption></figure>`;
    return `<div class="paper-compare-row">${gradedFig}${rawFig}</div>`;
  }).join('');
  return `<section class="panel panel-pad" style="margin-top:16px">
    <p class="small-text">${esc(g.studentName||'')} · ${esc(g.title)} · ${g.pages} 頁 · 可判斷 ${g.totalQuestions} 題、答對 ${g.correctCount} 題${g.pending?` · <strong class="paper-pending">${g.pending} 題待教師判定</strong>`:''}</p>
    ${(g.failedPages||[]).length?`<div class="paper-page-warnings"><div class="paper-warn-line"><strong>⚠️ 第 ${g.failedPages.map(f=>f.page).join('、')} 頁沒有批改到</strong>模型在這一頁失敗（${esc(g.failedPages[0].error||'無法辨識')}）。這些頁的題目沒有計分，請重新上傳這幾頁，或請教師手動補分。</div></div>`:''}
    ${(g.pageWarnings||[]).length?`<div class="paper-page-warnings">${g.pageWarnings.map(w=>`<div class="paper-warn-line"><strong>⚠️ 第 ${w.page} 頁可能跨頁</strong>${esc(w.text)}</div>`).join('')}</div>`:''}
    ${pagesHtml?`<div class="paper-compare">
      <p class="small-text" style="margin:0">左：批改卷（AI 標記與批註，可拖動）　右：原卷（對照用）</p>
      ${pagesHtml}</div>`:''}
    <table class="board-table paper-q-table" style="margin-top:10px"><thead><tr><th>題號</th><th>題目</th><th>學生答案</th><th>配分</th><th>判定</th><th>批註</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="field-hint">AI 判定僅供參考，請教師覆核後才當作正式成績。待判定的題目請按「判對／判錯」，分數會立即重算。批註可直接拖動到合適位置。</p>
    <div class="paper-confirm-bar">
      <span class="small-text">${confirmed
        ? '✅ 已確認分數，這份卷已鎖定。要修改請按右邊「更改分數」。'
        : '核對無誤後按「確認學生分數」，這份卷會鎖定，避免之後誤改。'}</span>
      <button class="${confirmed?'secondary':'primary'}" data-paper-confirm="${confirmed?'0':'1'}">${confirmed?'更改分數':'確認學生分數'}</button>
    </div></section>`;
}
// 拖動：批註、題目框可移動；題目框右下角把手可調整大小。放開後保存。
let paperDrag=null;
document.addEventListener('pointerdown',e=>{
  if(!e.target.closest||!paperGradeId)return;
  const handle=e.target.closest('.paper-mark-resize');
  const note=handle?null:e.target.closest('.paper-note');
  const mark=note?null:(handle?handle.closest('.paper-mark'):e.target.closest('.paper-mark'));
  const el=note||mark;
  if(!el)return;
  const fig=el.closest('.paper-page'),img=fig&&fig.querySelector('img');
  if(!img)return;
  e.preventDefault();
  paperDrag={kind:handle?'resize':(note?'note':'mark'),el,img,
             startX:e.clientX,startY:e.clientY,
             left:el.offsetLeft,top:el.offsetTop,
             startW:el.offsetWidth,startH:el.offsetHeight,
             index:Number(note?el.dataset.noteIndex:el.dataset.boxIndex)};
  el.classList.add('dragging');
  try{el.setPointerCapture(e.pointerId);}catch(_){}
});
document.addEventListener('pointermove',e=>{
  if(!paperDrag)return;
  const dx=e.clientX-paperDrag.startX,dy=e.clientY-paperDrag.startY;
  if(paperDrag.kind==='resize'){
    paperDrag.el.style.width=Math.max(40,paperDrag.startW+dx)+'px';
    paperDrag.el.style.height=Math.max(28,paperDrag.startH+dy)+'px';
    return;
  }
  paperDrag.el.style.left=(paperDrag.left+dx)+'px';
  paperDrag.el.style.top=(paperDrag.top+dy)+'px';
});
document.addEventListener('pointerup',async()=>{
  if(!paperDrag)return;
  const {kind,el,img,index}=paperDrag;paperDrag=null;
  el.classList.remove('dragging');
  const w=img.clientWidth||1,h=img.clientHeight||1;
  const box={x:Math.max(0,Math.min(1,el.offsetLeft/w)),y:Math.max(0,Math.min(1,el.offsetTop/h)),
             w:Math.max(0.05,Math.min(1,el.offsetWidth/w)),h:Math.max(0.02,Math.min(1,el.offsetHeight/h))};
  try{
    await api(`/api/paper-grades/${paperGradeId}/notes`,
      kind==='note'?{index,noteBox:box}:{index,box});
    toast(kind==='note'?'評註位置已保存。':(kind==='resize'?'題目框大小已保存。':'題目框位置已保存。'));
  }
  catch(err){toast(err.message);}
});

// 教師直接改 AI 的評分與批註：失焦就存，值沒變就不送。
document.addEventListener('focusout',async e=>{
  const el=e.target;
  if(!el||!paperGradeId||!el.classList)return;
  if(el.classList.contains('paper-score-input')){
    const i=Number(el.dataset.scoreIndex),max=Number(el.dataset.max||0);
    const raw=(el.value||'').trim();
    if(raw===''||!max)return;
    const val=Number(raw);
    if(!Number.isFinite(val)||val<0||val>max){
      toast(`分數請介於 0 到 ${max}`);el.value=el.dataset.orig||'';return;
    }
    if(raw===String(el.dataset.orig||''))return;
    try{
      const r=await api(`/api/paper-grades/${paperGradeId}/judge`,{index:i,credit:val/max});
      const box=$('#pb-viewer')||$('#pb-sheet-viewer')||$('#paper-result');
      if(box)box.innerHTML=paperResultHtml(r.grade);
      updatePaperRow(r.grade);
      toast(`已改分：這題 ${val} 分，總分 ${r.grade.score} / 100`);
    }catch(err){toast(err.message);el.value=el.dataset.orig||'';}
    return;
  }
  if(el.classList.contains('paper-note-cell')){
    const i=Number(el.dataset.noteIndex);
    const note=(el.textContent||'').trim();
    if(note===String(el.dataset.orig||''))return;
    try{
      const r=await api(`/api/paper-grades/${paperGradeId}/judge`,{index:i,note});
      el.dataset.orig=note;
      // 卷上框內的評語也要跟著更新，不能只改表格
      const box=$('#pb-viewer')||$('#pb-sheet-viewer')||$('#paper-result');
      if(box&&r.grade)box.innerHTML=paperResultHtml(r.grade);
      updatePaperRow(r.grade);
      toast('批註已更新');
    }catch(err){toast(err.message);}
  }
});

// 批改紀錄：按功課名稱分組，一眼看出「批了誰、還缺誰、上次批到哪」。
// 未批名單要靠班級名冊才算得出來；沒選班級就只列已批的人，並提示選班級。
function paperHistoryHtml(history,classes,roster,classId){
  if(!history.length)return '<p class="small-text" style="margin:0">還沒有批改紀錄。批完第一位學生就會出現在這裡。</p>';
  const groups=new Map();
  history.forEach(g=>{const list=groups.get(g.title)||[];list.push(g);groups.set(g.title,list);});
  const cls=classes.find(c=>String(c.id)===String(classId));
  const classIds=cls&&Array.isArray(cls.studentIds)?new Set(cls.studentIds.map(Number)):null;
  const student=id=>roster.find(u=>u.id===id);
  return [...groups.entries()].map(([title,list])=>{
    const done=new Set(list.map(g=>g.studentId));
    const avg=list.reduce((s,g)=>s+(Number(g.score)||0),0)/list.length;
    const latest=list.reduce((a,b)=>String(a.createdAt||'')>=String(b.createdAt||'')?a:b,list[0]);
    const missing=classIds?[...classIds].filter(id=>!done.has(id)):null;
    const rows=list.slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))
      .map(g=>`<tr><td>${esc(g.studentName)}</td><td><strong>${g.score}</strong></td><td class="small-text">${esc((g.createdAt||'').replace('T',' ').slice(0,16))}</td></tr>`).join('');
    const missingHtml=missing===null
      ? '<p class="small-text">選上面的班級，就會列出還沒批的學生。</p>'
      : missing.length
        ? `<p class="small-text">未批 ${missing.length} 人：${missing.slice(0,20).map(id=>{const s=student(id);return esc(s?s.name:`#${id}`)+(s&&s.seat?`（座號 ${esc(s.seat)}）`:'');}).join('、')}${missing.length>20?`…等 ${missing.length} 人`:''}</p>`
        : '<p class="small-text">這個班級都批完了。</p>';
    return `<details class="paper-history-group"><summary>
      <strong>${esc(title)}</strong>
      <span class="small-text">已批 ${list.length} 人 · 平均 ${avg.toFixed(1)} 分 · 上次批到 ${esc(latest.studentName||'')}（${esc((latest.createdAt||'').slice(0,10))}）</span>
      ${missing===null?'':`<span class="badge ${missing.length?'paper-missing':'paper-done'}">${missing.length?`未批 ${missing.length} 人`:'全班批完'}</span>`}
    </summary><div class="paper-history-body">
      <table class="board-table"><thead><tr><th>學生</th><th>得分</th><th>批改時間</th></tr></thead><tbody>${rows}</tbody></table>
      ${missingHtml}
    </div></details>`;
  }).join('');
}
// 讀檔成 dataURL（沒有現成 helper，這裡自己包一個 Promise）
function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error('讀取檔案失敗'));
    reader.readAsDataURL(file);
  });
}

// ── 大檔前端壓縮 ────────────────────────────────────────────────────
// 掃描版 PDF 常是「一頁一張高解析圖」（36 頁／109 MB 很常見），遠超部署代理
// （Cloudflare／Render）約 100 MB 的請求上限，上傳時會拿到非 JSON 的 HTTP 413。
// 超過門檻就在瀏覽器用 pdf.js 逐頁重畫成 JPEG（長邊 1600px），再用 pdf-lib
// 組成新 PDF；字跡仍清楚，但檔案通常只剩原來的 1/10。
const PDF_COMPRESS_THRESHOLD = 60 * 1024 * 1024;
const PDF_TARGET_LONG_SIDE = 1600;
const PDF_JPEG_QUALITY = 0.75;
let pdfLibsPromise = null;
function loadScriptOnce(src){
  return new Promise((resolve,reject)=>{
    if([...document.scripts].some(s=>(s.getAttribute('src')||'')===src))return resolve();
    const el=document.createElement('script');
    el.src=src;el.async=false;
    el.onload=()=>resolve();
    el.onerror=()=>reject(new Error('無法載入 PDF 處理元件。'));
    document.head.appendChild(el);
  });
}
async function ensurePdfLibs(onStatus){
  if(window.pdfjsLib&&window.PDFLib)return;
  if(!pdfLibsPromise){
    pdfLibsPromise=(async()=>{
      if(onStatus)onStatus('載入 PDF 處理元件…');
      await loadScriptOnce('/vendor/pdfjs/pdf.min.js');
      await loadScriptOnce('/vendor/pdfjs/pdf-lib.min.js');
      if(!window.pdfjsLib||!window.PDFLib)throw new Error('PDF 處理元件未能載入。');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.min.js';
    })();
  }
  try{await pdfLibsPromise;}catch(e){pdfLibsPromise=null;throw e;}
}
// 把掃描版 PDF 壓成較小的 PDF（維持頁面尺寸與順序）
async function compressScannedPdf(file,onStatus){
  await ensurePdfLibs(onStatus);
  const src=await file.arrayBuffer();
  const doc=await window.pdfjsLib.getDocument({data:new Uint8Array(src)}).promise;
  const out=await window.PDFLib.PDFDocument.create();
  for(let i=1;i<=doc.numPages;i++){
    if(onStatus)onStatus(`壓縮中… 第 ${i} / ${doc.numPages} 頁`);
    const page=await doc.getPage(i);
    const base=page.getViewport({scale:1});               // 原始頁面尺寸（pt）
    const scale=Math.min(2,PDF_TARGET_LONG_SIDE/Math.max(base.width,base.height));
    const vp=page.getViewport({scale});
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(vp.width));
    canvas.height=Math.max(1,Math.round(vp.height));
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
    await page.render({canvasContext:ctx,viewport:vp}).promise;
    const jpg=canvas.toDataURL('image/jpeg',PDF_JPEG_QUALITY);
    const img=await out.embedJpg(jpg);
    const added=out.addPage([base.width,base.height]);
    added.drawImage(img,{x:0,y:0,width:base.width,height:base.height});
    page.cleanup();
    canvas.width=0;canvas.height=0;                        // 立刻釋放畫布記憶體
  }
  const bytes=await out.save();
  if(onStatus)onStatus(`已壓縮 ${(file.size/1024/1024).toFixed(0)} MB → ${(bytes.length/1024/1024).toFixed(1)} MB`);
  return new File([bytes],file.name.replace(/\.pdf$/i,'')+'-壓縮.pdf',{type:'application/pdf'});
}
// 只在檔案過大時才壓縮；壓縮失敗就回原檔，由上傳端顯示真正原因。
async function maybeCompressPdf(file,onStatus){
  if(!file||file.size<=PDF_COMPRESS_THRESHOLD)return file;
  try{
    return await compressScannedPdf(file,onStatus);
  }catch(e){
    if(onStatus)onStatus('');
    toast(`本機壓縮未完成（${e.message}），改用原檔上傳。`);
    return file;
  }
}

// 全班紙本批閱：一次上傳整疊 PDF（≤80 頁），自動切卷、自動認人，
// 認不出來的由老師在下拉裡指派（座號優先、姓名相似度輔助）。
function growthPage(){page='growth';shell();if(!S.user)return loginModal(growthPage);const days=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);const key=d.toLocaleDateString('en-CA');return {label:`${d.getMonth()+1}/${d.getDate()}`,n:S.attempts.filter(a=>new Date(a.submittedAt).toLocaleDateString('en-CA')===key).length};});const max=Math.max(1,...days.map(d=>d.n));$('#main').innerHTML=`<div class="fade-in">${heading('YOUR LEARNING JOURNEY','學習足跡','進步藏在每一次願意再想一步的練習裡。')}${metrics()}${paperJourneyHtml(S.stats)}<div class="growth-layout"><section class="panel growth-panel"><h2>最近七天的練習</h2><p>提交次數（含待批閱） · 只呈現真實作答，不產生示例學習紀錄</p><div class="chart">${days.map(d=>`<div class="chart-column"><span class="bar-value">${d.n}</span><div class="bar" style="height:${d.n/max*145+3}px"></div><span class="bar-label">${d.label}</span></div>`).join('')}</div><div class="chart-caption">每一次練習都值得被看見。${S.attempts.length?'繼續保持，鞏固薄弱知識點。':'你還沒有提交練習，從第一道題開始吧。'}</div></section><section class="panel growth-panel"><h2>知識點練習表現</h2><p>得分率是練習表現，不代表能力的完整測量。</p>${(()=>{const practiced=topics.map(t=>({t,st:topicStats(t)})).filter(x=>x.st.n>0).sort((a,b)=>a.st.value-b.st.value);if(!practiced.length)return `<p class="chart-caption">還沒有任何知識點的練習記錄，先去做幾題吧。</p>`;return practiced.map(({t,st})=>`<div class="topic-detail"><div class="knowledge-row"><span>${esc(t)}</span><span>${st.n} 次 · ${st.value}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${st.value}%"></div></div></div>`).join('');})()}</section><section class="panel growth-panel"><h2>${icon('bulb')}下一步學習建議</h2><p>${S.attempts.some(a=>a.status==='graded'&&a.score<a.maxScore)?'從錯題本選擇一道需要鞏固的題目，先回看錯誤步驟，再做同知識點相似題。':'先完成一道基礎題；在能清楚解釋方法後，再挑戰進階題。'}</p><button class="text-button" data-action="start">前往自主練習 ${icon('arrow')}</button></section></div></div>`;}
let AICFG=null;
function randomPassword(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';const a=new Uint32Array(12);crypto.getRandomValues(a);return[...a].map(n=>chars[n%chars.length]).join('');}
const BULK_FIELD_NAMES={name:'姓名',username:'學號',seat:'班內號',password:'密碼'};
const BULK_HEADERS={name:/^(姓名|名字|名稱|名称|學生|学生|name)$/i,username:/^(學號|学号|帳號|帐号|账号|登入帳號|登入帐号|username|account|login|id)$/i,seat:/^(班內號|班内号|班號|班号|座號|座号|seat|no|number)$/i,password:/^(密碼|密码|password|passwd|pass|pwd)$/i};
const BULK_ORDERS={name_username_seat_password:['name','username','seat','password'],name_username_password:['name','username','password'],username_seat_password:['username','seat','password'],username_password:['username','password']};
// 標題列：每一欄都能辨識且不重複時，直接依標題決定欄位順序（例如「學號,班內號,密碼」）。
function bulkHeaderFields(cells){const kinds=cells.map(v=>Object.keys(BULK_HEADERS).find(f=>BULK_HEADERS[f].test(v))||null);return kinds.some(k=>!k)||new Set(kinds).size!==kinds.length?null:kinds;}
// 沒有標題列時的猜測：學號是3–40個英數字；班內號是短號碼（1、03、3A）。
function bulkGuessFields(parts){const isUser=v=>/^[A-Za-z0-9_.-]{3,40}$/.test(v),isSeat=v=>/^[A-Za-z]{0,2}\d{1,3}$/.test(v)||/^[A-Za-z]\d{0,2}$/.test(v),isPw=v=>v.length>=10||(v.length>=6&&/\d/.test(v)&&/[A-Za-z]/.test(v));if(parts.length===4){if(isUser(parts[1])&&isSeat(parts[2]))return['name','username','seat','password'];return null;}if(parts.length===3){if(isUser(parts[0])&&isSeat(parts[1]))return['username','seat','password'];if(isUser(parts[1]))return['name','username','password'];return null;}if(parts.length===2){if(isUser(parts[0])&&(!parts[1]||isPw(parts[1])))return['username','password'];if(isUser(parts[1]))return['name','username'];return null;}if(parts.length===1&&isUser(parts[0]))return['username'];return null;}
// 名單解析：姓名可以完全省略（只有學號、班內號、密碼也能匯入）；密碼省略時自動產生。
function parseBulkStudents(text,order='auto'){const rows=[],errors=[];let fields=BULK_ORDERS[order]||null;const fixed=!!fields;String(text||'').split(/\r?\n/).forEach((line,i)=>{const raw=line.trim();if(!raw||raw.startsWith('#'))return;const parts=raw.split(/[,\t，;；]/).map(v=>v.trim());const header=bulkHeaderFields(parts);if(header){if(!fixed)fields=header;return;}if(!fields)fields=bulkGuessFields(parts);if(!fields){errors.push(`第 ${i+1} 行格式不正確：需要「學號,班內號,密碼」或「姓名,學號,密碼」，每行一位學生。`);return;}const least=fields[fields.length-1]==='password'?fields.length-1:fields.length;if(parts.length<least||parts.length>fields.length){errors.push(`第 ${i+1} 行欄位數不正確，需要「${fields.map(f=>BULK_FIELD_NAMES[f]).join(',')}」。`);return;}const rec={};fields.forEach((f,idx)=>{rec[f]=(parts[idx]||'').trim();});if(!rec.username){errors.push(`第 ${i+1} 行學號不可留空。`);return;}if(!/^[A-Za-z0-9_.-]{3,40}$/.test(rec.username)){errors.push(`第 ${i+1} 行學號須為3至40個英文字母、數字或 _ . -。`);return;}if(rec.seat&&!/^[A-Za-z0-9-]{1,20}$/.test(rec.seat)){errors.push(`第 ${i+1} 行班內號只接受1至20個英文字母、數字或連字號。`);return;}if(rec.password&&rec.password.length<10){errors.push(`第 ${i+1} 行密碼必須至少10字。`);return;}rows.push({name:rec.name||'',username:rec.username,seat:rec.seat||'',password:rec.password||randomPassword(),generated:!rec.password});});return{rows,errors,fields};}
let ROSTER_USERS=[],ROSTER_OWNER=null;
// 班級清單與「學生 → 班別」對照：帳號管理可按班別篩選／搜尋學生。
let ROSTER_CLASSES=[],ROSTER_CLASS_OF=new Map();
// 記住目前開的是哪一頁（學生／教師／全部），編輯、刪除、停用、清除手寫圖完成後
// 要回到同一頁，而不是每次都跳回「帳號管理」。
let ROSTER_FOCUS='all';
// 誰能改這個帳號：管理員可改全部；教師可改自己與自己建立的學生；其餘只可檢視。
function canEditAccount(u){return !!S.user?.isOwner||u.id===S.user?.id||(u.role==='student'&&u.createdBy===S.user?.id);}
// 學生姓名在資料庫是遮蔽的（陳大文 → 陳X文）。老師搜尋時輸入的是全名，
// 所以查詢字串也要用同一套規則遮蔽一次再比對，否則「李小明」永遠搜不到「李X明」。
function maskNameLike(text){
  const t=String(text||'').trim();
  if(t.length<=1)return t;
  if(t.length===2)return t[0]+'X';
  return t[0]+'X'.repeat(t.length-2)+t[t.length-1];
}
// 誰可以刪這個帳號：教師→只有管理員（且不能刪自己與管理員）；學生→匯入老師或管理員。
function canDeleteAccount(u){
  if(!S.user||!u)return false;
  if(u.role==='teacher')return !!S.user.isOwner&&u.id!==S.user.id&&u.id!==ROSTER_OWNER;
  return !!S.user.isOwner||u.createdBy===S.user.id;
}
// 誰可以停用／啟用：與刪除同一套規則，但不能停用自己與管理員。
function canDisableAccount(u){
  if(!S.user||!u)return false;
  if(u.id===S.user.id||u.id===ROSTER_OWNER)return false;
  if(u.role==='teacher')return !!S.user.isOwner;
  return !!S.user.isOwner||u.createdBy===S.user.id;
}
function accountRow(u){
  const teacher=u.role==='teacher',admin=u.id===ROSTER_OWNER,mine=canEditAccount(u);
  const maker=(!mine&&u.createdBy)?ROSTER_USERS.find(x=>x.id===u.createdBy):null;
  return `<div class="roster-row${u.disabled?' is-disabled':''}"><span class="roster-who">${admin?'<span class="role-badge admin">管理員</span>':teacher?'<span class="role-badge">教師</span>':u.seat?`<span class="seat-badge">${esc(u.seat)}</span>`:''}${esc(u.name)}${u.disabled?'<span class="role-badge off">已停用</span>':''}${u.username===u.name?'':`<span class="small-text">${esc(u.username)}</span>`}${u.role==='student'?(()=>{const cs=ROSTER_CLASS_OF.get(u.id)||[];return cs.length?`<span class="roster-class">${cs.map(esc).join('、')}</span>`:'<span class="small-text roster-class">未分班</span>';})():''}${maker?`<span class="small-text">由 ${esc(maker.name)} 建立</span>`:''}</span><span style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${mine?`<button class="text-button" data-edit-user="${u.id}">編輯</button>`:'<span class="small-text">僅可檢視</span>'}${u.role==='student'&&canDeleteAccount(u)?`<button class="text-button" data-purge-img="${u.id}" data-purge-name="${esc(u.name)}" title="清除這位學生所有的手寫圖與批註圖（作答與分數保留）" style="color:#b87333">清除學生手寫圖</button>`:''}${canDisableAccount(u)?`<button class="text-button" data-disable-user="${u.id}" data-disable-to="${u.disabled?0:1}" data-disable-name="${esc(u.name)}">${u.disabled?'重新啟用':'停用'}</button>`:''}${canDeleteAccount(u)?`<button class="text-button" data-del-user="${u.id}" data-del-uname="${esc(u.name)}" data-del-role="${u.role}" style="color:#b8453b">刪除</button>`:''}</span></div>`;
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
  ${teacher?'':`<div class="form-field"><label class="field-label" for="edit-seat">班內號（可留空）</label><input id="edit-seat" value="${esc(u.seat||'')}" maxlength="20"></div>
  <div class="form-field"><label class="field-label" for="edit-grade">年級（排行榜用）</label><select id="edit-grade">${['','中一','中二','中三','中四','中五','中六'].map(g=>`<option value="${g}"${(u.grade||'')===g?' selected':''}>${g||'未設定'}</option>`).join('')}</select></div>`}</div>
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
  $('#edit-cancel').onclick=()=>manageUsers(ROSTER_FOCUS);
  if($('#delete-account'))$('#delete-account').onclick=async()=>{
    const typed=$('#delete-confirm').value;
    if(typed.trim().toUpperCase()!=='DELETE'){$('#delete-error').textContent='請輸入 DELETE 確認。';return;}
    if(await askCancel(`確定要刪除「${u.name}」的帳號嗎？此操作無法還原。`))return;
    const b=$('#delete-account');b.disabled=true;$('#delete-error').textContent='';
    try{const r=await api(`/api/users/${id}/delete`,{confirm:typed});
      toast(`已刪除 ${r.deleted.name} 的帳號：${r.removed.attempts} 筆作答${r.imagesDeleted?`、${r.imagesDeleted} 張圖片`:''}。`);
      await manageUsers(ROSTER_FOCUS);}
    catch(err){$('#delete-error').textContent=err.message;b.disabled=false;}
  };
  $('#account-edit-form').onsubmit=async e=>{
    e.preventDefault();
    const body={};
    const username=$('#edit-username').value.trim(),name=$('#edit-name').value,pw=$('#edit-password').value;
    const seatField=$('#edit-seat');
    if(username!==u.username)body.username=username;
    if(seatField&&seatField.value.trim()!==(u.seat||''))body.seat=seatField.value.trim();
    const gradeField=$('#edit-grade');
    if(gradeField&&gradeField.value!==(u.grade||''))body.grade=gradeField.value;
    if(name!==u.name)body.name=name;
    if(pw)body.password=pw;
    if(!Object.keys(body).length){$('#edit-error').textContent='沒有變更的欄位。';return;}
    const b=$('#account-edit-form button[type=submit]');b.disabled=true;$('#edit-error').textContent='';
    try{const r=await api(`/api/users/${id}/update`,body);
      // 重設自己的密碼會刪掉目前這個登入，直接回到登入畫面，免得後續請求全部 401。
      if(body.password&&self){closeModal();S.user=null;shell();loginModal();toast('密碼已更新，請用新密碼重新登入。');return;}
      toast(`已更新 ${r.user.username} 的${r.changed.join('、')}。${r.passwordReset?`已登出${teacher?'該教師':'該生'}目前的登入。`:''}`);
      await manageUsers(ROSTER_FOCUS);}
    catch(err){$('#edit-error').textContent=err.message;b.disabled=false;}
  };
}
// focus：'all' 顯示全部（相容舊入口）、'teacher' 只顯示教師、'student' 只顯示學生
// 匯出學生名單：先問班級——名單是「某一班」的名單，沒指定班級就不知道要匯出誰。
async function exportRosterModal(){
  let classes=[];
  try{const d=await api('/api/homework');classes=(d.classes||[]).filter(c=>(c.studentCount||0)>0);}
  catch(err){return toast(err.message);}
  if(!classes.length){
    modal(`<p class="eyebrow">EXPORT</p><h2>匯出學生名單</h2>
<p class="modal-intro">還沒有可匯出的班級。請先在「作業與成績」建立班級並加入學生，再回來匯出。</p>
<div class="submit-row"><button class="secondary" data-action="close-modal">知道了</button></div>`);
    return;
  }
  modal(`<p class="eyebrow">EXPORT</p><h2>匯出學生名單</h2>
<p class="modal-intro">請先選擇要匯出哪一班的學生名單。內容為學號、姓名、班內號、年級與狀態，<strong>不含密碼</strong>（密碼加密儲存，無法取回）。</p>
<div class="form-field"><label class="field-label" for="export-class">班級</label>
<select id="export-class"><option value="">請選擇班級…</option>${classes.map(c=>`<option value="${c.id}">${esc(c.name)}（${c.studentCount} 人）</option>`).join('')}</select></div>
<p class="field-hint" id="export-hint">選好班級後按「匯出 CSV」。</p>
<p class="error-text" id="export-error"></p>
<div class="submit-row"><button class="primary" id="export-go" disabled>${icon('file')}匯出 CSV</button><button class="secondary" data-action="close-modal">取消</button></div>`);
  const sel=$('#export-class'),go=$('#export-go');
  sel.onchange=()=>{go.disabled=!sel.value;
    $('#export-hint').textContent=sel.value?'按「匯出 CSV」即可下載名單。':'選好班級後按「匯出 CSV」。';};
  go.onclick=async()=>{
    const cid=sel.value;if(!cid)return;
    const old=go.innerHTML;go.disabled=true;go.textContent='正在匯出…';$('#export-error').textContent='';
    try{
      const {class:room,students}=await api(`/api/classes/${cid}/roster`);
      if(!students.length){$('#export-error').textContent='這一班還沒有學生，沒有可匯出的名單。';go.disabled=false;go.innerHTML=old;return;}
      const rows=[['學號','姓名','班內號','年級','狀態'],
        ...students.map(s=>[s.username,s.name||s.username,s.seat||'',s.grade||'',s.disabled?'已停用':'正常'])];
      const csv='\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';
      const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
      const link=document.createElement('a');
      link.href=url;link.download=`${room.name}-學生名單.csv`.replace(/[\\/:*?"<>|]/g,'_');
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      toast(`已匯出「${room.name}」的 ${students.length} 位學生名單。`);
      go.disabled=false;go.innerHTML=old;
    }catch(err){$('#export-error').textContent=err.message;go.disabled=false;go.innerHTML=old;}
  };
}
async function manageUsers(focus='all'){ROSTER_FOCUS=focus;try{
// 班級清單跟帳號清單一起抓：要按「班別」篩選學生，沒有班級資料就只能搜姓名。
const [{users,ownerId},classData]=await Promise.all([
  api('/api/users'),
  api('/api/classes').catch(()=>({classes:[]}))]);
ROSTER_USERS=users;ROSTER_OWNER=ownerId;
ROSTER_CLASSES=classData.classes||[];
ROSTER_CLASS_OF=new Map();
for(const c of ROSTER_CLASSES)for(const sid of (c.studentIds||[])){
  if(!ROSTER_CLASS_OF.has(sid))ROSTER_CLASS_OF.set(sid,[]);
  ROSTER_CLASS_OF.get(sid).push(c.name);
}
const teachers=users.filter(u=>u.role==='teacher'),students=users.filter(u=>u.role==='student');
const canAddTeacher=!!S.user?.isOwner;
const headHtml=`<p class="eyebrow">ACCOUNTS</p><h2>${focus==='teacher'?'教師帳號':focus==='student'?'學生帳號':'帳號管理'}</h2>
<p class="modal-intro">${focus==='teacher'
  ?(canAddTeacher?'管理員可以建立教師帳號，並修改任何帳號。':'只有管理員可以新增教師；你可以檢視現有教師帳號。')
  :(canAddTeacher
    ?'建立學生帳號，或把整班名單批次匯入；姓名可以留空（以學號顯示）。'
    :'你可以建立學生帳號，並修改自己建立的學生；其他帳號只可檢視。')}</p>
`;
const teacherHtml=`<p class="account-group">教師帳號（${teachers.length}）</p>
<div class="review-answer" style="max-height:150px;overflow:auto">${teachers.map(accountRow).join('')}</div>
${canAddTeacher?`<form id="teacher-create-form">
<div class="form-grid" style="margin-top:14px"><div class="form-field"><label class="field-label" for="teacher-name">姓名</label><input id="teacher-name" maxlength="60" required placeholder="例如：陳老師"></div>
<div class="form-field"><label class="field-label" for="teacher-username">帳號（登入名稱）</label><input id="teacher-username" minlength="3" maxlength="40" pattern="[A-Za-z0-9_.\\-]{3,40}" required placeholder="例如：teacher2" autocomplete="off"></div></div>
<div class="form-field"><label class="field-label" for="teacher-password">初始密碼（至少10字）</label><input id="teacher-password" type="password" minlength="10" maxlength="256" required autocomplete="new-password"></div>
<p class="field-hint">教師權限與你相同：可佈置作業、批閱、匯入題庫、管理資料，也能重設其他帳號的密碼。請只發給信任的同事，並提醒首次登入後更換密碼。</p>
<p class="error-text" id="teacher-error"></p>
<button class="primary wide" type="submit">建立教師帳號 ${icon('check')}</button></form>`:'<p class="info-note" style="margin-top:14px">只有<strong>管理員帳號</strong>（學校最早建立的那個教師帳號）能新增教師。需要新同事的帳號時，請找管理員協助。</p>'}
`;
const studentHtml=`<div class="divider-text"><span>學生帳號</span></div>
<p class="account-group">獨立學生帳戶（${students.length}）</p>
<div class="roster-filter"><label class="search-field">${icon('search')}<input id="roster-search" placeholder="搜尋姓名、學號、座號或班別…" aria-label="搜尋學生"></label><select id="roster-class" aria-label="班別"><option value="">全部班別</option><option value="__none">未分班</option>${ROSTER_CLASSES.map(c=>`<option value="${c.id}">${esc(c.name)}（${c.studentCount}）</option>`).join('')}</select><span class="small-text" id="roster-count"></span></div>
<div class="review-answer" id="roster-list" style="max-height:180px;overflow:auto"></div><form id="user-create-form"><div class="form-grid" style="margin-top:20px"><div class="form-field"><label class="field-label" for="student-name">姓名（可留空，預設用學號）</label><input id="student-name" maxlength="60" placeholder="例如：陳大文"></div><div class="form-field"><label class="field-label" for="student-username">學號（登入帳戶）</label><input id="student-username" minlength="3" maxlength="40" pattern="[A-Za-z0-9_.\\-]{3,40}" required placeholder="例如：s3a01" autocomplete="off"></div><div class="form-field"><label class="field-label" for="student-seat">班內號（可留空）</label><input id="student-seat" maxlength="20" placeholder="例如：3"></div></div><div class="form-field"><label class="field-label" for="student-password">初始密碼（至少10字）</label><input id="student-password" type="password" minlength="10" maxlength="256" required autocomplete="new-password"></div><p class="field-hint">學號只接受英文字母、數字、底線、點或連字號；<strong>姓名可以留空</strong>（不匯入名字），系統會以學號作為顯示名稱。請私下將初始密碼交給學生，提醒首次登入後更換。</p><p class="error-text" id="user-error"></p><button class="primary wide" type="submit">建立學生帳戶 ${icon('check')}</button></form><div class="divider-text"><span>或批次匯入一整班</span></div><div class="bulk-tools"><label class="secondary" for="bulk-file">${icon('upload')}上傳名單檔案</label><input id="bulk-file" type="file" accept=".csv,.txt,text/csv,text/plain" hidden><button class="text-button" id="bulk-template" type="button">${icon('file')}下載名單範本</button></div><div class="form-field" style="margin-top:14px"><label class="field-label" for="bulk-order">名單欄位順序</label><select id="bulk-order"><option value="auto">自動判斷（依內容或第一行標題）</option><option value="name_username_seat_password">姓名,學號,班內號,密碼</option><option value="username_seat_password">學號,班內號,密碼</option><option value="name_username_password">姓名,學號,密碼</option><option value="username_password">學號,密碼</option></select></div><p class="field-hint"><strong>姓名可以放第一欄</strong>（例：<code>陳大文,s3a01,1,密碼</code>），也可以完全省略：省略時以學號作為顯示名稱，名單上不會出現空白姓名。班內號與密碼都可留空（密碼留空會自動產生）。也接受 Tab、全角逗號或分號；第一行若是標題（如「學號,班內號,密碼」）會自動略過並依標題對應欄位。以 # 開頭的行會被忽略。名單檔案請存成 UTF-8 的 CSV 或 TXT。</p><textarea class="answer-field" id="bulk-students" style="min-height:150px;font-size:calc(15px*var(--fs))" placeholder="陳大文,s3a01,1,MathPass1234&#10;李小明,s3a02,2&#10;s3a03,3&#10;s3a04"></textarea><div id="bulk-preview" class="field-hint"></div><div id="bulk-preview-table"></div><label class="checkbox-line"><input type="checkbox" id="bulk-class-toggle">匯入後直接建立班級（把這批學生編入同一班）</label><div class="form-field" id="bulk-class-field" hidden><label class="field-label" for="bulk-class-name">班級名稱</label><input id="bulk-class-name" maxlength="100" placeholder="例如：中三甲班"></div><p class="error-text" id="bulk-error"></p><button class="secondary wide" id="bulk-submit" style="margin-top:6px">${icon('upload')}批次建立學生帳戶</button><div id="bulk-result"></div><div class="divider-text"><span>匯出學生名單</span></div><p class="field-hint">把某一班的學生名單匯出成 CSV（學號、姓名、班內號、年級、狀態），可交班主任點名或存檔。密碼是加密儲存的，無法匯出。</p><button class="secondary wide" id="export-roster" type="button">${icon('file')}匯出學生名單</button>`;
modal(headHtml+(focus==='student'?'':teacherHtml)+(focus==='teacher'?'':studentHtml),true);
// 學生名單可按班別／關鍵字篩選：一百多位學生用捲動找太慢。
if($('#roster-list')){
  const paintRoster=()=>{
    const q=($('#roster-search').value||'').trim().toLowerCase();
    const qm=maskNameLike(q).toLowerCase();   // 全名 → 遮蔽後的名字，才比得上資料庫
    const cid=$('#roster-class')?$('#roster-class').value:'';
    const cls=cid&&cid!=='__none'?ROSTER_CLASSES.find(c=>String(c.id)===cid):null;
    const list=students.filter(u=>{
      const names=ROSTER_CLASS_OF.get(u.id)||[];
      if(cid==='__none'&&names.length)return false;      // 只看未分班
      if(cls&&!names.includes(cls.name))return false;    // 只看某一班
      if(!q)return true;
      const hay=[u.name,u.username,u.seat,names.join(' ')].map(v=>String(v||'').toLowerCase());
      return hay.some(v=>v.includes(q))||hay.some(v=>v.includes(qm));
    });
    $('#roster-count').textContent=`顯示 ${list.length} / ${students.length} 位`;
    $('#roster-list').innerHTML=list.length?list.map(accountRow).join('')
      :'<p class="small-text" style="padding:14px 0">沒有符合條件的學生。</p>';
  };
  $('#roster-search').oninput=paintRoster;
  if($('#roster-class'))$('#roster-class').onchange=paintRoster;
  paintRoster();
}
if($('#teacher-create-form'))$('#teacher-create-form').onsubmit=async e=>{e.preventDefault();const b=$('[type="submit"]',e.target);b.disabled=true;$('#teacher-error').textContent='';try{const {user:made}=await api('/api/teachers',{username:$('#teacher-username').value,name:$('#teacher-name').value,password:$('#teacher-password').value});toast(`教師帳號「${made.name}」已建立，請把帳號與初始密碼私下交給對方。`);manageUsers(focus);}catch(err){$('#teacher-error').textContent=err.message;b.disabled=false;}};if($('#user-create-form')){$('#user-create-form').onsubmit=async e=>{e.preventDefault();const b=$('[type="submit"]',e.target);if(($('#student-name').value||'').trim()&&!(await askNameMask()))return;b.disabled=true;try{await api('/api/users',{username:$('#student-username').value,name:$('#student-name').value,seat:$('#student-seat').value,password:$('#student-password').value});toast('獨立學生帳戶已建立。');manageUsers(focus);}catch(err){$('#user-error').textContent=err.message;b.disabled=false;}};
const bulkPreview=()=>{const {rows,errors,fields}=parseBulkStudents($('#bulk-students').value,$('#bulk-order')?$('#bulk-order').value:'auto');const generated=rows.filter(r=>r.generated).length,noName=rows.filter(r=>!r.name).length,seated=rows.filter(r=>r.seat).length;$('#bulk-preview').innerHTML=rows.length?`將建立 <strong>${rows.length}</strong> 個帳戶${fields?`（${fields.map(f=>BULK_FIELD_NAMES[f]).join(' · ')}）`:''}${generated?`，其中 ${generated} 個自動產生密碼`:''}${noName?`，${noName} 個未填姓名（以學號顯示）`:''}${seated?`，${seated} 個有班內號`:''}`:'請輸入學生名單，每行一位。';$('#bulk-error').innerHTML=errors.length?errors.slice(0,6).map(esc).join('<br>'):'';const table=$('#bulk-preview-table');if(table)table.innerHTML=rows.length?`<div class="table-scroll" style="margin-top:10px"><table class="results-table bulk-table"><thead><tr><th>學號</th><th>班內號</th><th>顯示名稱</th><th>密碼</th></tr></thead><tbody>${rows.slice(0,8).map(r=>`<tr><td>${esc(r.username)}</td><td>${r.seat?esc(r.seat):'—'}</td><td>${esc(r.name||r.username)}</td><td>${r.generated?'自動產生':'已填'}</td></tr>`).join('')}</tbody></table></div>${rows.length>8?`<p class="field-hint">…另有 ${rows.length-8} 位未顯示。</p>`:''}`:'';return{rows,errors};};
$('#bulk-students').oninput=bulkPreview;$('#bulk-students').onchange=bulkPreview;$('#bulk-order').onchange=bulkPreview;
$('#bulk-file').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(f.size>1024*1024)return toast('名單檔案不可超過 1 MB。');if(!/\.(csv|txt)$/i.test(f.name)&&!['text/csv','text/plain'].includes(f.type))return toast('請提供 CSV 或 TXT 名單檔案。');try{const raw=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error('檔案讀取失敗，請確認是 UTF-8 的 CSV 或 TXT。'));r.readAsText(f,'UTF-8');});$('#bulk-students').value=raw.replace(/^\ufeff/,'');bulkPreview();toast(`已載入名單：${f.name}`);}catch(err){toast(err.message);}e.target.value='';};
$('#bulk-template').onclick=()=>{const order=$('#bulk-order')?$('#bulk-order').value:'auto';const fields=order==='auto'?['username','seat','password']:(BULK_ORDERS[order]||['username','seat','password']);const sample={name:['陳大文','李小美','黃志強'],username:['s3a01','s3a02','s3a03'],seat:['1','2','3'],password:['MathPass1234','','']};const csv='\ufeff'+fields.map(f=>BULK_FIELD_NAMES[f]).join(',')+'\r\n'+sample.username.map((_,i)=>fields.map(f=>sample[f][i]).join(',')).join('\r\n')+'\r\n';const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='MathPath-學生名單範本.csv';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已下載名單範本（'+fields.map(f=>BULK_FIELD_NAMES[f]).join(',')+'），可用試算表填寫後另存為 CSV。');};
$('#bulk-class-toggle').onchange=e=>{$('#bulk-class-field').hidden=!e.target.checked;};
if($('#export-roster'))$('#export-roster').onclick=()=>exportRosterModal();
$('#bulk-submit').onclick=async()=>{const {rows,errors}=bulkPreview();if(errors.length)return toast('請先修正名單格式錯誤。');if(!rows.length)return toast('請輸入至少一位學生。');if(rows.length>200)return toast('每批最多200位學生。');const makeClass=$('#bulk-class-toggle').checked,className=$('#bulk-class-name').value.trim();if(makeClass&&!className)return toast('請填寫班級名稱，或取消建立班級。');const b=$('#bulk-submit');b.disabled=true;b.textContent='正在建立…';try{const {users:created}=await api('/api/users/bulk',{students:rows.map(r=>({username:r.username,name:r.name,seat:r.seat,password:r.password}))});let classNote='';if(makeClass){try{const {class:room}=await api('/api/classes',{name:className,studentIds:created.map(u=>u.id)});classNote=`<div class="hint-box" style="margin-top:12px">已同時建立班級「${esc(room.name)}」，共 ${room.studentCount} 位學生，可直接佈置作業。</div>`;}catch(err){classNote=`<div class="inline-error" style="margin-top:12px">帳戶已建立，但班級未建立：${esc(err.message)}可在「作業與成績」重新建立班級。</div>`;}}const merged=rows.map((r,i)=>({username:r.username,password:r.password,name:(created[i]&&created[i].name)||r.name||r.username,seat:(created[i]&&created[i].seat)||r.seat||''}));const hasName=merged.some(r=>r.name!==r.username),hasSeat=merged.some(r=>r.seat);const cols=[['學號',r=>r.username]].concat(hasName?[['姓名',r=>r.name]]:[],hasSeat?[['班內號',r=>r.seat]]:[],[['密碼',r=>r.password]]);const text=[cols.map(c=>c[0]).join('\t'),...merged.map(r=>cols.map(c=>c[1](r)).join('\t'))].join('\n');$('#bulk-result').innerHTML=`<div class="import-warning">已建立 ${created.length} 個帳戶${merged.some(r=>r.name===r.username)?`（${merged.filter(r=>r.name===r.username).length} 個未填姓名，以學號顯示）`:""}。密碼只會顯示這一次，請立即複製並私下發給學生。</div>${classNote}<pre class="code-block">${esc(text)}</pre><button class="secondary wide" id="bulk-copy" style="margin-top:10px">${icon('file')}複製帳號密碼</button>`;$('#bulk-copy').onclick=async()=>{try{await navigator.clipboard.writeText(text);toast('已複製，請妥善保管。');}catch{toast('無法自動複製，請手動選取。');}};$('#bulk-students').value='';$('#bulk-class-toggle').checked=false;$('#bulk-class-field').hidden=true;$('#bulk-class-name').value='';bulkPreview();toast(`已建立 ${created.length} 個學生帳戶。`);}catch(err){$('#bulk-error').textContent=err.message;}finally{b.disabled=false;b.innerHTML=icon('upload')+'批次建立學生帳戶';}};}}catch(e){toast(e.message);}}
function deploymentHelp(){modal(`<p class="eyebrow">SERVER SETUP</p><h2>啟動與部署說明</h2><p class="modal-intro">資料保存在網站伺服器；實際位置由管理員確認。以下是可選部署方式，不代表目前網站的部署狀態。</p><h3>本機預覽</h3><p class="info-note">雙擊 start.command，或用 Python 3 啟動：</p><pre class="code-block">python3 server.py --host 127.0.0.1 --port 8765</pre><p class="info-note">瀏覽器開啟 http://127.0.0.1:8765。</p><h3>校內連線</h3><p class="info-note">由資訊人員將 --host 設為伺服器的校內 IP，並限制防火牆只允許校內來源；正式使用需反向代理 HTTPS。不要把演示帳戶直接用於全校。</p><h3>目前帳戶範圍</h3><p class="info-note">初始演示配置包含學生與教師帳戶；實際帳戶由管理員確認。教師可在「設定與隱私」建立獨立學生帳戶，避免共用作答紀錄。可在「作業與成績」建立班級並發布作業；校內單一登入及批量帳戶管理仍可再擴充。</p><div class="import-warning">資料保存在網站伺服器；實際位置由管理員確認。預設資料庫路徑為 data/mathpath.sqlite3；備份及保存年限應按學校規定安排。AI 必須另行配置，未配置時手写作答由教師批閱。</div>`);}
async function navigate(target){if(busy)return toast('目前操作正在進行，請等待完成。');if(crStudentTimer){clearInterval(crStudentTimer);crStudentTimer=null;}preserveDraft();if(page==='practice'&&strokes.length&&target!=='practice'&&!lastResult&&await askCancel('尚未提交的手寫內容未保存。確定離開？'))return;beginView();$('#sidebar').classList.remove('open');if(target!=='practice'){assignmentContext=null;mockContext=null;stopQuizClock();}page=target;switch(target){case'guide':guidePage();break;
case'homework':homeworkPage();break;case'scores':scoreGridPage();break;case'paperbatch':paperBatchPage();break;
case'classroom':classroomPage();break;case'classroomRecords':classroomRecordsPage();break;case'calendar':calendarPage();break;case'board':leaderboardPage();break;case'mock':mockPage();break;case'contests':contestsPage();break;case'ai':aiConfigPage();break;case'bank':bank();break;case'practice':practice();break;case'import':importPage();break;case'newq':newQuestionPage();break;case'mistakes':recordsPage();break;case'paper':paperGradePage();break;case'layout':paperLayoutPage();break;case'papers':papersPage();break;case'growth':growthPage();break;case'coins':coinsPage();break;case'settings':settingsPage();break;default:bank();}window.scrollTo({top:0,behavior:'instant'});}
// 切字體／版面後重新渲染目前頁面主體，讓按鈕的 .active 狀態跟得上（不然字體變了、
// 但「標準／大／特大」的選中樣式還停在舊的）。頁面函式會自己呼叫 shell()。
function renderCurrentPage(){switch(page){case'guide':guidePage();break;case'homework':homeworkPage();break;case'scores':scoreGridPage();break;case'paperbatch':paperBatchPage();break;case'classroom':classroomPage();break;case'classroomRecords':classroomRecordsPage();break;case'calendar':calendarPage();break;case'board':leaderboardPage();break;case'mock':mockPage();break;case'contests':contestsPage();break;case'ai':aiConfigPage();break;case'bank':bank();break;case'practice':practice();break;case'import':importPage();break;case'newq':newQuestionPage();break;case'mistakes':recordsPage();break;case'paper':paperGradePage();break;case'layout':paperLayoutPage();break;case'papers':papersPage();break;case'growth':growthPage();break;case'coins':coinsPage();break;case'settings':settingsPage();break;default:bank();}}
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b||b.disabled)return;if(b.dataset.fontScale){applyFontScale(b.dataset.fontScale);renderCurrentPage();toast(`字體已設為「${FONT_SCALES.find(([id])=>id===b.dataset.fontScale)[1]}」，只影響這台裝置。`);return;}
if(b.dataset.themeId){applyTheme(b.dataset.themeId);renderCurrentPage();toast(`版面已設為「${THEMES.find(([id])=>id===b.dataset.themeId)[1]}」，只影響這台裝置。`);return;}
if(b.id==='open-math-editor'){openMathEditor();return;}
  if(b.dataset.manageClass){manageClassModal(Number(b.dataset.manageClass));return;}
  if(b.dataset.purgeImg){
    const uid=Number(b.dataset.purgeImg),uname=b.dataset.purgeName||'';
    if(await askCancel(`清除「${uname}」的所有手寫圖與批註圖？\n\n⚠️ 會刪除網盤上的圖片檔，無法復原。\n作答紀錄與分數會保留。`))return;
    b.disabled=true;
    api(`/api/users/${uid}/images/delete`,{}).then(r=>{toast(`已清除 ${r.images} 個圖片、${r.attempts} 筆作答的圖片欄位。`);manageUsers(ROSTER_FOCUS);})
      .catch(err=>{b.disabled=false;toast(err.message);});
    return;
  }
  if(b.dataset.disableUser){
    // 停用比刪除溫和：作答、分數、班級都留著，只是不能再登入；停用後現有登入立即失效。
    const uid=Number(b.dataset.disableUser),off=b.dataset.disableTo==='1',uname=b.dataset.disableName||'';
    const ask=off?`停用「${uname}」？\n\n他將無法登入，目前的登入也會立即失效。\n作答、分數與班級都會保留，之後可以再啟用。`
                 :`重新啟用「${uname}」？\n\n他可以再次登入，先前的作答與分數都還在。`;
    if(await askCancel(ask))return;
    b.disabled=true;
    api(`/api/users/${uid}/disabled`,{disabled:off})
      .then(()=>{toast(off?'已停用，該帳號目前的登入已失效。':'已重新啟用。');manageUsers(ROSTER_FOCUS);})
      .catch(err=>{b.disabled=false;toast(err.message);});
    return;
  }
  if(b.dataset.delUser){
    const uid=Number(b.dataset.delUser),uname=b.dataset.delUname||'',urole=b.dataset.delRole||'student';
    const warn=urole==='teacher'
      ? `刪除教師「${uname}」？\n\n他的班級與作業會轉給管理員；他建立的學生改為無歸屬。\n\n請輸入 DELETE 確認：`
      : `刪除學生「${uname}」？\n\n⚠️ 會一併刪除他的所有作答、手寫圖、批改紀錄、班級成員與模擬測驗，無法復原。\n\n請輸入 DELETE 確認：`;
    const typed=await askPrompt(warn);
    if(typed===null)return;
    if(typed.trim()!=='DELETE')return toast('未輸入 DELETE，已取消。');
    b.disabled=true;
    api(`/api/users/${uid}/delete`,{confirm:'DELETE'}).then(()=>{toast('帳號已刪除。');manageUsers(ROSTER_FOCUS);})
      .catch(err=>{b.disabled=false;toast(err.message);});
    return;
  }
  if(b.dataset.delAssign){
    const aid=Number(b.dataset.delAssign),atitle=b.dataset.delTitle||'';
    if(await askCancel(`確定刪除作業「${atitle}」？\n\n⚠️ 這會一併刪除所有學生在這份作業的作答、分數與批閱紀錄，無法復原。`))return;
    b.disabled=true;
    api(`/api/assignments/${aid}/delete`,{}).then(r=>{toast(`作業已刪除${r.attempts?`（含 ${r.attempts} 筆作答）`:''}。`);homeworkPage();})
      .catch(err=>{b.disabled=false;toast(err.message);});
    return;
  }
  if(b.dataset.delClass){
    const cid=Number(b.dataset.delClass),cname=b.dataset.delName||'';
    if(await askCancel(`確定刪除班級「${cname}」？\n\n只會刪除班級與名單，不會刪除學生帳戶。\n有作業的班級無法刪除。`))return;
    b.disabled=true;
    api(`/api/classes/${cid}/delete`,{}).then(()=>{toast('班級已刪除。');homeworkPage();})
      .catch(err=>{b.disabled=false;toast(err.message);});
    return;
  }
  if(b.dataset.paperConfirm!==undefined&&paperGradeId){
    const next=b.dataset.paperConfirm==='1';
    b.disabled=true;
    try{
      const r=await api(`/api/paper-grades/${paperGradeId}/confirm`,{confirmed:next});
      if(paperCurrentGrade){
        paperCurrentGrade.confirmed=next;
        const box=$('#pb-viewer')||$('#pb-sheet-viewer')||$('#paper-result');
        if(box)box.innerHTML=paperResultHtml(paperCurrentGrade);
      }
      toast(next
        ? (r.assignmentId?'已確認分數，並匯入成績總表。':'已確認分數（這位學生沒有班級，未匯入成績總表）。')
        : '已解鎖，可以再修改。');
    }catch(err){b.disabled=false;toast(err.message);}
    return;
  }
  if(b.dataset.paperJudge!==undefined&&paperGradeId){
    const index=Number(b.dataset.paperJudge),verdict=b.dataset.paperVerdict==='1';
    b.disabled=true;
    api(`/api/paper-grades/${paperGradeId}/judge`,{index,correct:verdict})
      .then(r=>{
        // 單份批改用 #paper-result；全班批閱的結果在 #pb-viewer，以前只找前者就報
        // Cannot set properties of null (setting 'innerHTML')
        const box=$('#pb-viewer')||$('#pb-sheet-viewer')||$('#paper-result');
        if(box)box.innerHTML=paperResultHtml(r.grade);
        // 列表那一行也要更新：分數、對幾題、還剩幾題待判
        updatePaperRow(r.grade);
        toast(`已更新：${r.grade.score} / 100`);
      })
      .catch(err=>{b.disabled=false;toast(err.message);});
    return;
  }if(b.dataset.page)return navigate(b.dataset.page);if(b.dataset.assignment)return assignmentPage(Number(b.dataset.assignment));if(b.dataset.mock)return mockExamPage(Number(b.dataset.mock));
if(b.dataset.mockDel){
  const id=Number(b.dataset.mockDel);
  if(await askCancel('刪除這場未完成的模擬測驗？已作答的內容會一併清除。'))return;
  return api(`/api/mock/${id}/delete`,{}).then(()=>{toast('已刪除這場模擬測驗。');return mockPage();}).catch(e=>toast(e.message));
}if(b.dataset.mockQ)return openMockQuestion(Number(b.dataset.mockQ));if(b.dataset.results)return resultsPage(Number(b.dataset.results));if(b.dataset.skipQ)return skipQuestionFromList(b.dataset.skipQ);
if(b.dataset.assignmentQ){
  const qid=Number(b.dataset.assignmentQ);
  const done=(assignmentDetail?.attempts||[]).some(x=>x.questionId===qid);
  if(done&&await askCancel('這題已經作答過。重新作答會清除先前的答案，確定嗎？'))return;
  const go=openAssignmentQuestion(qid);
  if(done)Promise.resolve(go).then(()=>{clearAnswerState();clearCurrentDraft();renderAnswerArea();toast('已清除先前的作答，可以重新寫一次。');});
  return go;
}if(b.dataset.nextQuestion)return openAssignmentQuestion(Number(b.dataset.nextQuestion));if(b.dataset.prevQuestion)return openAssignmentQuestion(Number(b.dataset.prevQuestion));if(b.dataset.qid)return openQuestion(b.dataset.qid);if(b.dataset.topic){topic=b.dataset.topic;subtopic='';currentPage=1;return bank();}if(b.dataset.subtopic){subtopic=b.dataset.subtopic;currentPage=1;return bank();}if(b.dataset.pagination){currentPage=Number(b.dataset.pagination);return renderList();}if(b.dataset.view){viewMode=b.dataset.view;return bank();}if(b.dataset.save){const id=Number(b.dataset.save);if(bookmarks.has(id))bookmarks.delete(id);else bookmarks.add(id);saveBookmarks();b.classList.toggle('saved',bookmarks.has(id));b.setAttribute('aria-pressed',String(bookmarks.has(id)));toast(bookmarks.has(id)?'已收藏題目（本瀏覽器）':'已取消收藏');if(page==='bank'&&topic==='我的收藏')renderList();return;}if(b.dataset.answerMode){
  if(busy)return toast('正在保存作答，請等待完成。');
  const next=b.dataset.answerMode;
  if(next!==answerMode&&hasProcessContent(answerMode)){
    if(await askCancel('切換作答方式會清除目前的解題過程，確定嗎？'))return;
    clearProcessForMode(answerMode);
  }
  preserveDraft();answerMode=next;$$('[data-answer-mode]').forEach(x=>x.classList.toggle('active',x===b));renderAnswerArea();scheduleDraft();return;
}if(b.dataset.generate)return generateQuestion(b.dataset.generate,currentQuestion&&currentQuestion.id);if(b.dataset.navToggle){const k=b.dataset.navToggle;const cur=b.getAttribute('aria-expanded')==='true';navOpen[k]=!cur;shell();return;}if(b.dataset.editq)return editQuestionModal(b.dataset.editq);if(b.dataset.verify)return verifyQuestion(b.dataset.verify);if(b.dataset.aigen)return aiGenerateModal(b.dataset.aigen);if(b.dataset.aifig)return openFigureStudioForQuestion(b.dataset.aifig);if(b.dataset.aifigManual)return openFigureStudioForQuestion(b.dataset.aifigManual,true);if(b.dataset.aifigClear)return clearQuestionFigure(b.dataset.aifigClear);if(b.dataset.genKind)return generateQuestion(b.dataset.genKind,b.dataset.genQid);if(b.dataset.removeDraft){drafts.splice(Number(b.dataset.removeDraft),1);return renderImportContent();}if(b.dataset.history){historyFilter=b.dataset.history;historyFilterTouched=true;return recordsPage();}if(b.dataset.review)return reviewModal(b.dataset.review,null,null,(b.dataset.reviewQueue||'').split(',').map(Number).filter(n=>n),b.dataset.reviewView==='1');
if(b.dataset.editUser)return editAccountModal(Number(b.dataset.editUser));switch(b.dataset.action){case'login':loginModal();break;case'close-modal':closeReviewAware();break;case'collection':topic='我的收藏';search='';currentPage=1;bank();break;case'start':requireLogin(()=>{const a=S.attempts.find(a=>a.status==='graded'&&a.score<a.maxScore);openQuestion(a?.questionId||S.questions[0]?.id||1);});break;case'hand-demo':openQuestion(1);break;}});
$('#account').onclick=accountModal;$('#avatar').onclick=accountModal;$('#menu-btn').onclick=()=>$('#sidebar').classList.toggle('open');
  // 點側欄以外的任何地方（遮罩）或按 Esc 就收起；手機上側欄會蓋住 ☰，沒有這個就只能重整。
  const scrim=$('#nav-scrim');
  if(scrim)scrim.onclick=()=>$('#sidebar').classList.remove('open');
  if(!navEscBound){   // shell() 每次導覽都會跑，監聽只綁一次
    navEscBound=true;
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&!document.querySelector('.modal'))$('#sidebar').classList.remove('open');
    });
  }$('#help-btn').innerHTML=icon('help');$('#help-btn').onclick=()=>{modal(`<p class="eyebrow">LEARN WITH MATHPATH</p><h2>讓練習真正帶來理解</h2><ul class="feature-list"><li><strong>01 · 選一個知識點</strong>在題庫搜尋、篩選難度，從基礎題開始。</li><li><strong>02 · 寫出解題過程</strong>用滑鼠或觸控筆手寫、輸入文字，或上傳紙本手稿。</li><li><strong>03 · 看回饋，再練一次</strong>接入 AI 可取得建議評分；教師可覆核並給簡要建議。</li><li><strong>04 · 相似鞏固，進階加深</strong>做同知識點題目，練到能說清楚原因，再挑戰進階題。</li></ul><button class="primary wide" id="help-guide">看圖文版新手上路 ${icon('arrow')}</button><div class="import-warning">資料保存在網站伺服器；實際位置由管理員確認。作業分數與 AI 建議須教師覆核；自主練習可即時評分，未配置 AI 的手稿待批閱。所有學習紀錄均來自實際提交。</div>`);$('#help-guide').onclick=()=>{closeModal();guidePage();};};
const scoreText=v=>v===null||v===undefined?'—':Number(v).toLocaleString('zh-HK',{maximumFractionDigits:1});
const dateText=v=>v?new Date(v).toLocaleString('zh-HK',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const statusText=v=>({not_started:'未開始',in_progress:'作答中',submitted:'已正式提交',correction:'需訂正'}[v]||v);
// 截止前提醒：24 小時內還沒交就標出來，剩不到 2 小時轉警示色。
// 只做站內提示（不引外部通知服務）；已提交的一律不標。
function dueSoonBadge(dueAt,status){
  if(!dueAt||status==='submitted')return '';
  const ms=new Date(dueAt).getTime()-Date.now();
  if(!(ms>0)||ms>24*3600*1000)return '';
  const hours=Math.floor(ms/3600000),mins=Math.max(1,Math.round((ms%3600000)/60000));
  const text=hours>=1?`剩 ${hours} 小時`:`剩 ${mins} 分鐘`;
  return `<span class="badge due-soon${ms<=2*3600*1000?' urgent':''}">${icon('clock')}快截止 · ${text}</span>`;
}
let HW=null,assignmentDetail=null,resultData=null;
function csvCell(v){const s=String(v??'').replace(/\r?\n/g,' ').trim();const safe=/^[=+\-@\t\r]/.test(s)?`'${s}`:s;return`"${safe.replace(/"/g,'""')}"`;}
function exportResultsCsv(){if(!resultData)return;const a=resultData.assignment,s=resultData.summary;const rows=[['作業',a.title],['班級',a.className],['題數',a.questionCount],['卷面總分',a.totalPoints],['正式提交',`${s.submittedCount} / ${s.studentCount}`],['全題已評平均',s.averageScore??''],['教師確認平均',s.confirmedAverage??''],['待覆核題目',s.pendingReviewCount],['建議覆核題目',s.reviewFlagCount],['說明','已評得分可能只涵蓋部分題目，不代表整卷總分；待批與未交不當零分。'],[],
['學生','帳號','提交狀態','遲交','已作答題數','待批題數','已評得分','已評涵蓋分值','卷面總分','AI原建議分','規則原分','教師確認分','教師確認題數','建議覆核題數','建議-做得好的地方','建議-需要留意','建議-下一步'],
...resultData.students.map(st=>[st.name,st.username,statusText(st.status),st.late?'是':'否',st.answeredCount,st.pendingCount,st.score??'',st.scoredPoints,st.totalPoints,st.aiScore??'',st.ruleScore??'',st.confirmedScore??'',st.confirmedCount,st.reviewFlagCount??0,st.suggestion?.strength??'',st.suggestion?.focus??'',st.suggestion?.nextStep??''])];const csv='\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`${a.title}-成績.csv`.replace(/[\\/:*?"<>|]/g,'_');document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已匯出成績 CSV，可用試算表開啟。');}
function weakTopic(){const graded=S.attempts.filter(a=>a.status==='graded'&&a.score!==null&&a.maxScore>0);if(!graded.length)return null;const by={};graded.forEach(a=>{const t=by[a.topic]||(by[a.topic]={score:0,max:0,n:0});t.score+=a.score;t.max+=a.maxScore;t.n++;});return Object.entries(by).map(([topic,v])=>({topic,percent:Math.round(v.score*100/v.max),n:v.n})).sort((a,b)=>a.percent-b.percent||b.n-a.n)[0];}
function weakTopicPanel(){const wt=weakTopic();return `<section class="panel right-panel"><h2>${icon('target')}最需要鞏固</h2>${wt?`<p class="field-hint">依已批閱作答計算，不代表完整能力診斷。</p><div class="knowledge-row"><span>${esc(wt.topic)}</span><span>${wt.percent}%</span></div><div class="progress-track"><div class="progress-fill gold" style="width:${wt.percent}%"></div></div><p class="field-hint">已批閱 ${wt.n} 次。先重做錯題，再做同知識點的相似題，最後挑戰進階題。</p><button class="secondary wide" data-topic="${esc(wt.topic)}">開始針對練習 ${icon('arrow')}</button>`:`<p class="field-hint">還沒有已批閱的作答。完成作業或練習後，這裡會指出最需要鞏固的知識點。</p>`}</section>`;}
function homeworkMetrics(items){return `<div class="metric-row">${items.map(([label,value])=>`<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></div>`).join('')}</div>`;}
// 數學比賽：每週二早上由排程自動搜尋，這裡只負責顯示；預設排序是澳門 → 中國 → 外國。
let contestData=null, contestQuery='', contestRegion='', contestSort='open', contestView='list';
const CONTEST_REGION_ORDER={'澳門':0,'中國':1,'外國':2};
function contestStatus(c){
  if(!c.deadline)return 'pending';            // 主辦還沒公佈報名期
  const today=new Date();today.setHours(0,0,0,0);
  const due=new Date(`${c.deadline}T23:59:59`);
  if(Number.isNaN(due.getTime()))return 'pending';
  return due>=today?'open':'closed';
}
const CONTEST_STATUS_TEXT={open:'可報名',pending:'待公佈',closed:'已截止'};
const CONTEST_STATUS_RANK={open:0,pending:1,closed:2};
function contestSorted(){
  const list=(contestData?.contests||[]).filter(c=>{
    if(contestRegion&&c.region!==contestRegion)return false;
    if(!contestQuery)return true;
    const hay=`${c.title} ${c.organizer} ${c.audience} ${c.summary} ${c.location||''} ${c.source||''}`.toLowerCase();
    return hay.includes(contestQuery.toLowerCase());
  });
  const byRegion=(a,b)=>CONTEST_REGION_ORDER[a.region]-CONTEST_REGION_ORDER[b.region];
  const byDate=(a,b)=>(a.deadline||'9999-12-31').localeCompare(b.deadline||'9999-12-31');
  const byStatus=(a,b)=>CONTEST_STATUS_RANK[contestStatus(a)]-CONTEST_STATUS_RANK[contestStatus(b)];
  if(contestSort==='date')return list.sort((a,b)=>byDate(a,b)||byRegion(a,b));
  if(contestSort==='title')return list.sort((a,b)=>a.title.localeCompare(b.title,'zh-Hant'));
  if(contestSort==='region')return list.sort((a,b)=>byRegion(a,b)||byStatus(a,b)||byDate(a,b));
  // 預設：可以報名的排前，其次待公佈，最後已截止；同組內澳門優先、再看截止日
  return list.sort((a,b)=>byStatus(a,b)||byRegion(a,b)||byDate(a,b));
}
function daysLeft(deadline){
  if(!deadline)return null;
  const today=new Date();today.setHours(0,0,0,0);
  const due=new Date(`${deadline}T23:59:59`);
  if(Number.isNaN(due.getTime()))return null;
  return Math.ceil((due-today)/86400000);
}
function renderContests(){
  const list=contestSorted(), box=$('#contest-list');
  if(!box)return;
  const count=$('#contest-count');if(count)count.textContent=`${list.length} 項`;
  if(!list.length){box.innerHTML=empty('沒有符合的比賽','換個關鍵字或把地區改成「全部地區」。');return;}
  box.innerHTML=`<div class="record-list${contestView==='grid'?' two-col':''}">${list.map(c=>{
    const st=contestStatus(c), left=daysLeft(c.deadline);
    const deadlineText=c.deadline
      ?`${esc(c.deadline)}${st==='open'&&left!==null?`（還有 ${left} 天）`:'（已截止）'}`
      :'待主辦公佈';
    return `<article class="record contest-row ${st}">
      <span class="record-icon">${icon('target')}</span>
      <div class="record-body">
        <strong>${esc(c.title)}</strong>
        <p>${esc(c.organizer||'主辦機構待確認')}${c.audience?` · ${esc(c.audience)}`:''}</p>
        <dl class="contest-facts">
          <div><dt>報名截止</dt><dd>${deadlineText}</dd></div>
          <div><dt>比賽時間</dt><dd>${c.eventDate?esc(c.eventDate):'待主辦公佈'}</dd></div>
          <div><dt>比賽地點</dt><dd>${c.location?esc(c.location):'待主辦公佈'}</dd></div>
          <div><dt>出處</dt><dd>${esc(c.source||'未標明')}${c.url?` · <a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">官方網站</a>`:''}</dd></div>
        </dl>
        <p class="small-text">${esc(c.summary)}</p>
      </div>
      <div class="contest-side">
        <span class="contest-status ${st}">${CONTEST_STATUS_TEXT[st]}</span>
        <span class="badge l${CONTEST_REGION_ORDER[c.region]+1}">${esc(c.region)}</span>
      </div>
    </article>`;}).join('')}</div>`;
}
async function contestsPage(){
  beginView();page='contests';assignmentContext=null;mockContext=null;stopQuizClock();shell();
  const target=viewTarget();
  $('#main').innerHTML=`<div class="fade-in">${heading('MATH CONTESTS','數學比賽',
    '每週二早上 9:00 自動搜尋澳門學生可以參加的數學比賽；排序預設澳門優先，可自行更改。')}
    <section class="panel"><div class="panel-heading"><h2>${icon('target')}比賽清單 <span class="small-text" id="contest-count"></span></h2>
      <span class="small-text" id="contest-updated"></span></div>
    <div class="filters">
      <label class="search-field">${icon('search')}<input id="contest-search" placeholder="搜尋比賽、主辦或關鍵字…" aria-label="搜尋比賽"></label>
      <select id="contest-region" aria-label="地區"><option value="">全部地區</option>${['澳門','中國','外國'].map(r=>`<option ${contestRegion===r?'selected':''}>${r}</option>`).join('')}</select>
      <select id="contest-sort" aria-label="排序"><option value="open" ${contestSort==='open'?'selected':''}>可報名優先</option><option value="region" ${contestSort==='region'?'selected':''}>地區優先</option><option value="date" ${contestSort==='date'?'selected':''}>截止日期</option><option value="title" ${contestSort==='title'?'selected':''}>名稱</option></select>
      <div class="segmented text contest-view" role="group" aria-label="顯示方式">
        <button data-contest-view="list" class="${contestView==='list'?'active':''}">單欄</button>
        <button data-contest-view="grid" class="${contestView==='grid'?'active':''}">雙欄</button>
      </div>
    </div>
    <div id="contest-list">${empty('正在讀取比賽清單','從網站伺服器取得最新資料。')}</div>
    <p class="field-hint">預設「可報名優先」：可以報名的排前面，其次是待公佈，最後是已截止。「地區優先」＝澳門 → 中國 → 外國；右邊可切換「單欄／雙欄」顯示。資料由每週排程自動整理，報名日期與資格請以主辦機構公佈為準。</p>
    </section></div>`;
  $('#contest-search').addEventListener('input',e=>{contestQuery=e.target.value;renderContests();});
  $('#contest-region').addEventListener('change',e=>{contestRegion=e.target.value;renderContests();});
  $('#contest-sort').addEventListener('change',e=>{contestSort=e.target.value;renderContests();});
  $$('[data-contest-view]').forEach(b=>b.onclick=()=>{
    contestView=b.dataset.contestView;
    $$('[data-contest-view]').forEach(x=>x.classList.toggle('active',x===b));
    renderContests();
  });
  try{
    const data=await api('/api/contests');
    if(!viewMatches(target))return;
    contestData=data;
    const up=$('#contest-updated');
    if(up)up.textContent=data.updatedAt?`最後更新 ${fmtWhen(data.updatedAt)}`:'尚未更新';
    renderContests();
  }catch(e){
    if(!viewMatches(target))return;
    $('#contest-list').innerHTML=`<div class="inline-error">${esc(e.message)}</div>`;
  }
}
// 教師查閱每個學生成績：先選班級 → 每個學生一列 → 點進去看各份作業的分數
const GRADE_STATUS={submitted:'已提交',in_progress:'進行中',not_started:'未開始'};
async function classGradesModal(cid){
  const classes=(HW&&HW.classes)||[];
  if(!classes.length)return toast('還沒有班級，請先按「建立班級」。');
  const id=Number(cid)||classes[0].id;
  let data;
  try{data=await api(`/api/classes/${id}/report`);}catch(e){return toast(e.message);}
  const list=data.students||[];
  const rows=list.map(st=>{
    const done=st.assignments.filter(a=>a.status==='submitted').length;
    const total=st.assignments.length;
    return `<tr>
      <td>${esc(st.name)}${st.seat?` <span class="small-text">座號 ${esc(st.seat)}</span>`:''}</td>
      <td>${done} / ${total}</td>
      <td>${st.pending?`<span class="badge l2">${st.pending}</span>`:'0'}</td>
      <td>${st.averagePercent==null?'—':`${st.averagePercent}%`}</td>
      <td>${st.lastLoginAt?esc(fmtWhen(st.lastLoginAt)):'未登入'}</td>
      <td><button class="secondary" data-stu="${st.id}">查看</button></td>
    </tr>`;
  }).join('');
  modal(`<h2>學生成績</h2>
    <p class="field-hint">按學生查看每個人的作業與分數。「待批」是已提交但還沒批閱的題數，不計入平均。</p>
    <div class="form-field"><label class="field-label" for="grade-class">班級</label>
      <select id="grade-class">${classes.map(c=>`<option value="${c.id}" ${c.id===id?'selected':''}>${esc(c.name)}（${c.studentCount} 人）</option>`).join('')}</select></div>
    <div class="table-scroll"><table class="results-table">
      <thead><tr><th>學生</th><th>已交</th><th>待批</th><th>平均</th><th>最後登入</th><th></th></tr></thead>
      <tbody>${rows||'<tr><td colspan="6">這個班還沒有學生。</td></tr>'}</tbody>
    </table></div>`,true);
  $('#grade-class').onchange=e=>classGradesModal(e.target.value);
  $$('[data-stu]').forEach(b=>b.onclick=()=>{
    const st=list.find(x=>String(x.id)===b.dataset.stu);
    if(st)studentGradesModal(id,st);
  });
}
function studentGradesModal(cid,st){
  const rows=st.assignments.map(a=>`<tr>
      <td>${esc(a.title)}</td>
      <td>${a.status==='submitted'
        ?(a.score==null?'<span class="small-text">待批</span>':`${a.score} / ${a.totalPoints}`)
        :(GRADE_STATUS[a.status]||'—')}</td>
      <td>${a.pendingCount?`<span class="badge l2">${a.pendingCount}</span>`:'0'}</td>
      <td>${a.minutes==null?'—':`${a.minutes} 分鐘`}</td>
      <td>${a.submittedAt?esc(String(a.submittedAt).slice(0,10)):'—'}${a.late?' <span class="badge">遲交</span>':''}</td>
    </tr>`).join('');
  modal(`<h2>${esc(st.name)}</h2>
    <p class="field-hint">${st.seat?`座號 ${esc(st.seat)} · `:''}已交 ${st.submitted} 份${st.pending?` · 待批 ${st.pending} 題`:''}${st.averagePercent==null?'':` · 平均 ${st.averagePercent}%`}</p>
    <div class="table-scroll"><table class="results-table">
      <thead><tr><th>作業</th><th>分數</th><th>待批</th><th>用時</th><th>提交</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="5">還沒有作業。</td></tr>'}</tbody>
    </table></div>
    <button class="secondary" id="back-grades" style="margin-top:14px">← 回班級總表</button>`,true);
  $('#back-grades').onclick=()=>classGradesModal(cid);
}
// 提醒事項的「時間 · 地點 · 出處」，日曆與彈出視窗共用同一組欄位。
function noteMeta(n){
  return [n.startTime,n.location,n.source].filter(Boolean).join(' · ');
}
// 按下某一天：把當天所有事項的完整內容一次列出來。
function dayDetailModal(date,notes){
  const [,mm,dd]=date.split('-');
  const rows=(notes||[]).map(n=>{
    const facts=[['時間',n.startTime],['地點',n.location],['出處',n.source]].filter(([,v])=>v);
    return `<div class="day-detail">
      <strong>${esc(n.title)}</strong>
      ${facts.length?`<dl class="day-facts">${facts.map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`:''}
      ${n.note?`<p class="day-note">${esc(n.note)}</p>`:'<p class="field-hint" style="margin:8px 0 0">沒有補充說明。</p>'}
    </div>`;}).join('');
  modal(`<p class="eyebrow">SCHEDULE</p><h2>${Number(mm)} 月 ${Number(dd)} 日的事項</h2>
    <p class="modal-intro">共 ${(notes||[]).length} 項。按「打開日曆」可以看同一個月的其他日子。</p>
    ${rows}
    <button class="secondary wide" id="day-open-calendar" style="margin-top:14px">${icon('calendar')}打開日曆 ${icon('arrow')}</button>`);
  const btn=$('#day-open-calendar');
  if(btn)btn.onclick=()=>{
    // 連月份一起跳過去，否則跨月的那幾天會被日曆重設回本月。
    const [y,m]=date.split('-').map(Number);
    closeModal();calCursor=new Date(y,m-1,1);calSelected=date;navigate('calendar');
  };
}
async function homeworkPage(){beginView();page='homework';assignmentContext=null;mockContext=null;currentQuestion=null;stopQuizClock();shell();const target=viewTarget();const teacher=S.user?.role==='teacher';$('#main').innerHTML=heading('ASSIGN · REVIEW · GROW',teacher?'作業與成績':'我的作業',teacher?'把每次作業，轉化為可跟進的學習回饋。':'領取作業，寫下思考，每次提交都有下一步建議。');if(!S.user){$('#main').innerHTML+=`<div class="lp-wrap">
  <section class="lp-left">
    <p class="lp-eyebrow">數學練習 · 批改 · 成績</p>
    <h2 class="lp-title">做題，<br>由今天開始。</h2>
    <p class="lp-lead">這是一個數學練習與批改網站。學生在這裡做題、交作業；教師在這裡出題、批改、看成績。</p>
    <div class="lp-steps">
      <div class="lp-step"><span class="lp-step-n">1</span><div><strong>先登入</strong><span>用教師或學生帳戶登入</span></div></div>
      <div class="lp-step"><span class="lp-step-n">2</span><div><strong>做題或出題</strong><span>學生做練習與作業；教師匯入試卷、佈置作業</span></div></div>
      <div class="lp-step"><span class="lp-step-n">3</span><div><strong>看批改與建議</strong><span>每題都有評分與說明，可逐題複習</span></div></div>
    </div>
  </section>
  <aside class="lp-right">
    <div class="lp-card">
      <p class="lp-card-label">學生入口</p>
      <h3 class="lp-card-title">開始今天的練習</h3>
      <p class="lp-card-hint">登入後即可做題、交作業，並查看每題的批改與建議。</p>
      <button class="primary lp-cta" id="homework-login">立即登入開始使用 ${icon('arrow')}</button>
      <button class="secondary lp-cta2" data-page="guide">先看新手上路</button>
      <div class="lp-preview">
        <div class="lp-preview-head"><span class="lp-dot d1"></span><span class="lp-dot d2"></span><span class="lp-dot d3"></span><span class="lp-preview-tag">即時批改</span></div>
        <p class="lp-preview-q">解方程 <b>x² − 5x + 6 = 0</b></p>
        <div class="lp-preview-row"><span>得分 <b>6 / 6</b></span><span>用時 <b>1 分 20 秒</b></span></div>
      </div>
    </div>
  </aside>
</div>
<div class="homework-features">${[['practice','如果你是學生','登入後按「開始今日練習」或「我的作業」開始做題；不會的題目可以按「本題不會」，老師會看到，不會記零分。'],['import','如果你是教師','登入後可上傳試卷（PDF、Word、圖片）自動拆題入庫，再從題庫選題佈置作業給班級。'],['growth','批改與成績','選擇題與填空題由系統自動核對；解答題由教師批閱，或由 AI 先給建議分、教師再覆核。']].map(([i,t,p])=>`<section class="panel"><div class="feature-icon">${icon(i)}</div><h2>${t}</h2><p>${p}</p></section>`).join('')}</div>
<div class="import-warning" style="margin-top:22px">資料保存在網站伺服器；實際位置由管理員確認。作業分數與 AI 建議須教師覆核；自主練習可即時核對文字答案，未接入 AI 的手稿待批閱。</div>`;$('#homework-login').onclick=()=>loginModal(homeworkPage);return;}$('#main').innerHTML+='<section class="panel">'+empty('正在讀取作業','從網站伺服器讀取班級與作業紀錄。')+'</section>';try{const data=await api('/api/homework');if(!viewMatches(target))return;HW=data;const a=HW.assignments;const submitted=teacher?a.reduce((n,v)=>n+v.submittedCount,0):a.filter(v=>v.myStatus==='submitted').length;$('#main').innerHTML=`<div class="fade-in">${heading('ASSIGN · REVIEW · GROW',teacher?'作業與成績':'我的作業',teacher?'佈置、批阅、統計，用具體建議引導每個學生的下一步。':'依次完成作業，回看回饋，再鞏固最需要練習的知識點。',teacher?`<button class="secondary" id="import-calendar">${icon('upload')}匯入行事曆</button><button class="secondary" id="class-grades">${icon('list')}學生成績</button><button class="secondary" id="create-class">${icon('bank')}建立班級</button><button class="primary" id="create-assignment">${icon('import')}佈置作業</button>`:`<button class="secondary" id="refresh-homework">${icon('undo')}重新整理</button>`)}${homeworkMetrics([['已發布作業',a.length,'只顯示你有權查看的作業'],['我的班級',HW.classes.length,teacher?'班級名單由教師建立':'作業只對指定學生開放'],[teacher?'正式提交人次':'已正式提交',submitted,'逐題保存後，需正式提交作業'],['AI 批閱服務',S.ai.configured?'已配置':'待接入',S.ai.configured?'建議分數仍需教師覆核':'手稿待批 · 文字規則核對']])}<div class="homework-layout"><section><div class="section-head"><h2>${teacher?'已發布的作業':'待辦與已交作業'}</h2><div class="section-head-actions"><span class="small-text">${a.length} 份</span><button class="secondary" data-page="calendar">${icon('calendar')}查看日曆</button></div></div><div class="assignment-list">${a.length?a.map(v=>`<article class="panel assignment-card"><div class="assignment-card-head"><span class="assignment-icon">${icon('file')}</span><div><span class="badge">${esc(v.className)}</span><h2>${mathText(v.title)}</h2></div><span class="badge ${new Date(v.dueAt)<new Date()?'l2':''}">${teacher?'已發布':statusText(v.myStatus)}</span></div><div class="assignment-meta"><span>${v.questionCount} 題 · ${v.totalPoints} 分</span><span>${icon('clock')}截止 ${dateText(v.dueAt)}</span>${teacher?'':dueSoonBadge(v.dueAt,v.myStatus)}</div><div class="assignment-bottom"><span class="small-text">${v.kind==='quiz'?'測驗':'作業'}${v.durationMinutes?` · 限時 ${v.durationMinutes} 分鐘`:''} · ${teacher?`已交 ${v.submittedCount} / ${v.studentCount} 人 · 全題已評 ${v.gradedCount} 人`:`目前已評得分 ${scoreText(v.myScore)} · 教師確認 ${scoreText(v.myConfirmedScore)}`}</span>${!teacher&&S.attempts.some(a=>a.assignmentId===v.id&&isNewReview(a))?NEW_REVIEW_BADGE:''}<div style="display:flex;gap:8px;align-items:center">${teacher&&(v.teacherId===S.user?.id||S.user?.isOwner)?`<button class="text-button" data-del-assign="${v.id}" data-del-title="${esc(v.title)}" style="font-size:calc(13px*var(--fs));color:#b8453b">刪除</button>`:''}<button class="primary" ${teacher?'data-results':'data-assignment'}="${v.id}">${teacher?'查看成績與建議':v.myStatus==='submitted'?'查看批閱與建議':'開始／繼續作業'} ${icon('arrow')}</button></div></div></article>`).join(''):`<section class="panel">${empty(teacher?'還沒有發布作業':'目前沒有指派給你的作業',teacher?'先建立班級，再从題庫選題發布。':'教師發布到你的班級後，作業會出現在這裡；你也可以先自行練習。',teacher?'':`<div class="empty-cta"><button class="primary primary-xl" data-action="start">開始今日練習 ${icon('arrow')}</button><button class="secondary" data-page="bank" style="margin-left:10px">瀏覽題庫</button></div>`)}</section>`}</div></section><aside class="right-stack">${teacher?'':weakTopicPanel()}<section class="panel right-panel"><h2>${icon('bank')}${teacher?'我的班級':'所屬班級'}</h2>${HW.classes.length?HW.classes.map(c=>{const canDel=teacher&&(c.teacherId===S.user?.id||S.user?.isOwner);return `<div class="class-mini"><div><strong>${esc(c.name)}</strong><span>${c.studentCount} 位學生</span></div><div style="display:flex;gap:10px">${teacher?`<button class="text-button" data-manage-class="${c.id}" style="font-size:calc(13px*var(--fs))">管理學生</button>`:''}${canDel?`<button class="text-button" data-del-class="${c.id}" data-del-name="${esc(c.name)}" style="font-size:calc(13px*var(--fs));color:#b8453b">刪除</button>`:''}</div></div>`;}).join(''):'<p class="field-hint">尚未加入班級。</p>'}${teacher?`<button class="text-button" id="class-manage-link" style="font-size:calc(14px*var(--fs))">建立班級 ${icon('arrow')}</button>`:''}</section><section class="panel right-panel tip-panel"><h2>${icon('bulb')}成績怎麼看</h2><p>每次作答都有學習建議：<br>做得好的地方 → 需要留意 → 下一步練習。<br><br>待批阅不當零分；AI 建議分與教師確認分分開保存。</p></section><section class="panel right-panel"><h2>${icon('lock')}運行狀態</h2><p class="field-hint">資料保存在網站伺服器；實際位置由管理員確認。AI ${S.ai.configured?'已配置，仍需真實效果核驗':'尚未接入，不產生假評分'}。</p></section></aside></div></div>`;if(teacher){
  const calBtn=$('#import-calendar');
  if(calBtn){
    const picker=document.createElement('input');
    picker.type='file';picker.id='calendar-file';picker.hidden=true;
    picker.accept='.pdf,.docx,.xlsx,.jpg,.jpeg,.png,.webp,.heic,.heif';
    document.body.appendChild(picker);
    calBtn.onclick=()=>picker.click();
    picker.onchange=async e=>{
      const raw=e.target.files&&e.target.files[0];
      if(!raw)return;
      if(raw.size>15*1024*1024)return toast('檔案不可超過 15 MB。');
      const old=calBtn.textContent;calBtn.disabled=true;calBtn.textContent='AI 分析中…';
      try{
        const file=await normalizeHeicFile(raw);
        const data=await readAsDataUrl(file||raw);
        const res=await api('/api/calendar/import',{file:data,filename:raw.name,consentExternal:S.ai.mode==='external'});
        const added=res.added||[],skipped=res.skipped||[];
        toast(`已加入 ${added.length} 項${skipped.length?`，${skipped.length} 項略過`:''}`);
        if(skipped.length)console.info('略過的行事曆事項',skipped);
      }catch(err){toast(err.message);}
      calBtn.disabled=false;calBtn.textContent=old;picker.value='';
    };
  }
  $('#create-class').onclick=createClassModal;const cgBtn=$('#class-grades');if(cgBtn)cgBtn.onclick=()=>classGradesModal();$('#class-manage-link').onclick=createClassModal;$('#create-assignment').onclick=createAssignmentModal;}else $('#refresh-homework').onclick=homeworkPage;}catch(e){if(viewMatches(target))$('#main').innerHTML+=`<div class="inline-error">${esc(e.message)}</div>`;}}
// 建立班級：只填名稱（不必先選學生）。之後從「管理學生」加入名單。
function createClassModal(){
  modal(`<p class="eyebrow">CLASSROOM</p><h2>建立班級</h2>
    <p class="modal-intro">先填班級名稱；也可以順便把學生帳號一起建立，一次編進這一班。每份作業發布時會保存收件名單快照。</p>
    <form id="class-form">
      <div class="form-field"><label class="field-label" for="class-name">班級名稱</label>
        <input id="class-name" placeholder="例如：中三甲班" maxlength="100" required></div>
      <div class="divider-text"><span>同時建立學生帳號（可留空）</span></div>
      <div class="form-field"><label class="field-label" for="class-students">學生名單</label>
        <textarea id="class-students" class="answer-field" style="min-height:120px;font-size:calc(15px*var(--fs))"
          placeholder="每行一位：學號,姓名,班內號&#10;s3a01,陳大文,1&#10;s3a02,李小美,2"></textarea></div>
      <div class="form-field"><label class="field-label" for="class-password">初始密碼（至少 10 字；留空＝每人自動產生）</label>
        <input id="class-password" maxlength="256" placeholder="例如：MathPass1234" autocomplete="off"></div>
      <div class="bulk-tools"><label class="secondary" for="class-file">${icon('upload')}上傳名單檔案</label>
        <input id="class-file" type="file" accept=".csv,.txt,text/csv,text/plain" hidden>
        <button class="text-button" id="class-template" type="button">${icon('file')}下載名單範本</button></div>
      <p class="field-hint">學號只接受英文字母、數字、底線、點或連字號；<strong>姓名與班內號可以留空</strong>（姓名留空就以學號顯示）。</p>
      <p class="field-hint">姓名會以遮蔽形式存入（陳大文 → 陳X文），全名不會保留、無法還原。</p>
      <p class="error-text" id="class-error"></p>
      <button class="primary wide" type="submit">建立班級 ${icon('check')}</button>
    </form>`);
  const fileInput=$('#class-file');
  if(fileInput)fileInput.onchange=async e=>{
    const file=e.target.files&&e.target.files[0];
    if(!file)return;
    if(file.size>1024*1024)return toast('名單檔案不可超過 1 MB。');
    try{
      const text=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error('讀取失敗'));r.readAsText(file,'UTF-8');});
      $('#class-students').value=String(text||'').replace(/^\ufeff/,'');
      toast(`已載入名單：${file.name}`);
    }catch(err){toast(err.message);}
    e.target.value='';
  };
  const tplBtn=$('#class-template');
  if(tplBtn)tplBtn.onclick=()=>{
    const csv='\ufeff學號,姓名,班內號\r\ns3a01,陳大文,1\r\ns3a02,李小美,2\r\n';
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='MathPath-班級名單範本.csv';
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast('已下載名單範本，可用試算表填寫後另存 CSV。');
  };
  $('#class-form').onsubmit=async e=>{
    e.preventDefault();
    const b=$('[type=submit]',e.target);
    const errBox=$('#class-error');errBox.textContent='';
    const name=($('#class-name').value||'').trim();
    const raw=($('#class-students').value||'').trim();
    const typed=($('#class-password').value||'');
    let students=[];
    if(raw){
      // 格式：學號[,姓名][,班內號]；密碼在上面的欄位統一指定（留空＝每人自動產生）
      let lines=raw.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#'));
      if(lines.length&&/學號|帳號/.test(lines[0])&&/姓名|班內號|密碼/.test(lines[0]))lines=lines.slice(1);
      const bad=[];
      students=lines.map((line,i)=>{
        const parts=line.split(/[,，;；\t]/).map(x=>x.trim());
        const username=parts[0]||'';
        if(!/^[A-Za-z0-9_.-]{3,40}$/.test(username)){
          bad.push(`第 ${i+1} 行學號「${username}」格式不對（只能是英文字母、數字、_ . -）`);
          return null;
        }
        let name=parts[1]||'',seat=parts[2]||'';
        if(!seat&&/^\d{1,3}$/.test(name)){seat=name;name='';}   // 只寫「學號,3」時當班內號
        return {username,name,seat,password:typed||''};
      }).filter(Boolean);
      if(bad.length){errBox.innerHTML=bad.slice(0,4).map(esc).join('<br>');return;}
      if(!students.length){errBox.textContent='名單裡沒有可用的學生。';return;}
      if(students.length>200){errBox.textContent='一次最多建立 200 位學生。';return;}
    }
    if(students.some(x=>x.name)&&!(await askNameMask()))return;
    b.disabled=true;
    try{
      let created=[];
      if(students.length){
        const payload=students.map(x=>({...x,
          password:x.password||`Math${String(Math.floor(100000+Math.random()*900000))}`}));
        const out=await api('/api/users/bulk',{students:payload});
        created=out.users||[];
      }
      await api('/api/classes',{name,studentIds:created.map(u=>u.id)});
      closeModal();
      if(created.length){
        toast(typed
          ?`已建立「${name}」，並加入 ${created.length} 位學生；初始密碼：${typed}`
          :`已建立「${name}」，並加入 ${created.length} 位學生（密碼各自自動產生，可在「學生帳號」查看／重設）`);
      }else{
        toast('班級已建立，可再到「管理學生」加入名單。');
      }
      homeworkPage();
    }catch(err){errBox.textContent=err.message;b.disabled=false;}
  };
}

// 管理班級學生：名稱預設唯讀（按「改名」才可編輯）；可按匯入老師篩選學生。
function manageClassModal(id){
  const cls=(HW.classes||[]).find(c=>c.id===id);
  if(!cls){toast('找不到這個班級。');return;}
  const list=HW.students||[];
  const picked=new Set(cls.studentIds||[]);      // 真正的名單（不受畫面篩選影響）
  const makers=[...new Set(list.map(s=>s.createdBy).filter(v=>v!==null&&v!==undefined))];
  const makerName=(v)=>{const s=list.find(x=>x.createdBy===v);return (s&&s.createdByName)||'（未記錄）';};

  const renderPicks=(filter)=>{
    const shown=filter?list.filter(s=>String(s.createdBy)===String(filter)):list;
    const box=$('#class-picks');
    if(!box)return;
    box.innerHTML=shown.length?shown.map(s=>`<label class="pick-row"><input type="checkbox" name="students" value="${s.id}"${picked.has(s.id)?' checked':''}><span>${s.seat?`<span class="seat-badge">${esc(s.seat)}</span>`:''}${esc(s.name)}${s.username===s.name?'':`<small>${esc(s.username)}</small>`}${s.createdByName?`<small>· 由 ${esc(s.createdByName)} 匯入</small>`:''}</span></label>`).join('')
      :'<p class="field-hint">這個老師名下還沒有學生。</p>';
    $$('#class-picks [name=students]').forEach(cb=>{
      cb.onchange=()=>{const v=Number(cb.value);if(cb.checked)picked.add(v);else picked.delete(v);};
    });
  };

  modal(`<p class="eyebrow">CLASSROOM</p><h2>管理學生 · ${esc(cls.name)}</h2><p class="modal-intro">勾選要加入這個班級的學生。名單在發布作業時會保存快照。</p>
  <form id="class-form">
    <div class="form-field">
      <label class="field-label" for="class-name">班級名稱</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="class-name" value="${esc(cls.name)}" maxlength="100" readonly style="flex:1">
        <button type="button" class="secondary" id="class-rename">改名</button>
      </div>
      <p class="field-hint" id="class-rename-hint">班級名稱不會隨便改動；要改請按「改名」。</p>
    </div>
    <div class="form-field">
      <label class="field-label" for="class-maker">匯入老師</label>
      <select id="class-maker"><option value="">全部老師</option>${makers.map(v=>`<option value="${v}">${esc(makerName(v))}</option>`).join('')}</select>
    </div>
    <div class="student-picks" id="class-picks"></div>
    <p class="error-text" id="class-error"></p>
    <button class="primary wide" type="submit">儲存名單 ${icon('check')}</button>
  </form>`, 'class-modal');

  renderPicks('');
  $('#class-maker').onchange=e=>renderPicks(e.target.value);
  $('#class-rename').onclick=()=>{
    const f=$('#class-name');
    f.readOnly=false;f.focus();f.select();
    $('#class-rename').disabled=true;
    $('#class-rename-hint').textContent='現在可以修改名稱了；儲存後生效。';
  };
  $('#class-form').onsubmit=async e=>{
    e.preventDefault();const b=$('[type=submit]',e.target);b.disabled=true;
    try{
      await api(`/api/classes/${id}`,{name:$('#class-name').value,studentIds:[...picked]});
      closeModal();toast('班級名單已更新。');homeworkPage();
    }catch(err){$('#class-error').textContent=err.message;b.disabled=false;}
  };
}

function createAssignmentModal(){if(!HW.classes.length)return createClassModal();let qs=S.questions.filter(q=>q.answer?.trim()&&!/待.*(?:核驗|核验|審核|审核|確認|确认)/.test(q.source+' '+q.tags.join(' ')));
  // 挑題：先選章節（主分類／子分類），或直接輸入關鍵字搜尋，再勾選要佈置的題目。
  const qById=new Map(qs.map(q=>[q.id,q]));
  const pickState={topic:'',subtopic:'',search:'',picked:new Set(),page:1};
  let pickTopics=[...new Set(qs.map(q=>q.topic))].sort();
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
  // ── AI 生成作業題：一次多題 ──
  // 依老師選的章節／子分類／年級／難度／題型，請 AI 生成 N 道新題，
  // 生成後自動加入「已選」清單（老師可再移除）。逐題呼叫，失敗一題不影響其他。
  const genState={count:3,busy:false};
  const aiGenCount=()=>Math.max(1,Math.min(10,Number($('#assign-gen-count')?.value)||3));
  const aiGen=async()=>{
    if(genState.busy)return;
    if(!S.ai.configured)return toast('尚未接入 AI，無法生成題目。請先到「模型端點」設定。');
    const topic=$('#assign-gen-topic')?.value||'',subtopic=$('#assign-gen-subtopic')?.value||'';
    const grade=$('#assign-gen-grade')?.value||'中三',level=Number($('#assign-gen-level')?.value)||2;
    const qtype=$('#assign-gen-qtype')?.value||'解答題',points=Number($('#assign-gen-points')?.value)||5;
    const brief=($('#assign-gen-brief')?.value||'').trim();
    const count=aiGenCount();
    if(pickState.picked.size+count>30)return toast(`每份作業最多 30 題，目前已選 ${pickState.picked.size} 題，無法再生成 ${count} 題。`);
    genState.busy=true;
    const btn=$('#assign-gen-btn'),status=$('#assign-gen-status');
    if(btn)btn.disabled=true;
    if(status)status.textContent=`正在生成第 1 / ${count} 題…`;
    let ok=0;
    for(let i=1;i<=count;i++){
      try{
        const r=await api('/api/questions/ai-generate',{
          topic,subtopic,grade,level,qtype,points,
          brief:brief?`${brief}（這是本份作業第 ${i} 題）`:'',
          consentExternal:S.ai.mode==='external'});
        if(r.title){
          // 生成後需入題庫才能佈置 → 直接建立題目（AI 生成已核對內容，來源標「AI 生成」）。
          const created=await api('/api/questions/import',{dedupe:false,questions:[{
            title:r.title,content:r.content,topic,subtopic,grade,level,qtype,
            points,answer:r.answer,steps:r.steps||[],analysis:r.analysis||'',
            options:r.options||[],rubric:r.rubric||[],tags:['AI 生成作業題'],source:'AI 生成'}]});
          const qid=created.questions&&created.questions[0]?.id;
          if(qid){
            pickState.picked.add(qid);ok++;
            // 把新題加進可選清單（讓老師能再次看到／選它）。
            const newQ={id:qid,title:r.title,content:r.content,topic,subtopic,grade,level,qtype,
              points,answer:r.answer,steps:r.steps||[],analysis:r.analysis||'',options:r.options||[],
              rubric:r.rubric||[],tags:['AI 生成作業題'],source:'AI 生成'};
            qs.push(newQ);qById.set(qid,newQ);
            pickTopics=[...new Set(qs.map(q=>q.topic))].sort();
            const pt=$('#assign-gen-topic'),pt2=$('#pick-topic');
            if(pt&&!pt.querySelector(`option[value="${CSS.escape(topic)}"]`)){
              pt.insertAdjacentHTML('beforeend',`<option value="${esc(topic)}">${esc(topic)}</option>`);}
            if(pt2&&!pt2.querySelector(`option[value="${CSS.escape(topic)}"]`)){
              pt2.insertAdjacentHTML('beforeend',`<option value="${esc(topic)}">${esc(topic)}（${pickCount(topic)} 題）</option>`);}
          }
        }
      }catch(err){toast(`第 ${i} 題生成失敗：${err.message}`);}
      if(status)status.textContent=ok<count?`已生成 ${ok} / ${count} 題，正在繼續…`:`已生成 ${ok} 題，加入已選清單。`;
    }
    genState.busy=false;
    if(btn)btn.disabled=false;
    if(status)status.textContent=ok?`✅ 已生成 ${ok} 題並加入已選清單（共 ${pickState.picked.size} 題）。`:'未能生成任何題目。';
    renderPickList();renderPickCount();renderPickedChips();
    // 回到題庫頁刷新題庫列表
    await refresh().catch(()=>{});
  };
  const renderPickList=()=>{const box=$('#assignment-picks');if(!box)return;const pool=pickPool(),pages=Math.max(1,Math.ceil(pool.length/PICK_LIMIT));pickState.page=Math.max(1,Math.min(pickState.page,pages));const shown=pool.slice((pickState.page-1)*PICK_LIMIT,pickState.page*PICK_LIMIT);
    box.innerHTML=shown.length?shown.map(q=>`<label class="pick-row"><input type="checkbox" name="assignment-questions" value="${q.id}" ${pickState.picked.has(q.id)?'checked':''}><span><strong>${mathText(q.title)}</strong><small>${esc(q.topic)}${q.subtopic?' · '+esc(q.subtopic):''} · ${mathText(q.content)}</small></span><span class="badge l${q.level}">${levels[q.level]} · ${q.points} 分</span></label>`).join('')
      :`<p class="pick-empty">沒有符合條件的題目，請換一個章節或關鍵字。</p>`;
    box.insertAdjacentHTML('beforeend',`<div class="pick-pagination"><button type="button" class="secondary" data-pick-page="${pickState.page-1}" ${pickState.page<=1?'disabled':''}>上一頁</button><span class="small-text">第 ${pickState.page} / ${pages} 頁</span><button type="button" class="secondary" data-pick-page="${pickState.page+1}" ${pickState.page>=pages?'disabled':''}>下一頁</button></div>`);const hint=$('#pick-hint');if(hint)hint.textContent=`符合條件 ${pool.length} 題，顯示 ${shown.length} 題 · 可佈置題目共 ${qs.length} 題 · 最多選 30 題`;};const due=new Date();due.setDate(due.getDate()+7);due.setHours(23,59,0,0);const local=new Date(due.getTime()-due.getTimezoneOffset()*60000).toISOString().slice(0,16);modal(`<p class="eyebrow">ASSIGN HOMEWORK</p><h2>佈置作業或測驗</h2><p class="modal-intro">題目及分值發布後固定；每題需要已核驗參考答案，AI 待核驗題不會列入。</p><form id="assignment-form"><div class="form-grid"><div class="form-field"><label class="field-label" for="assignment-title">作業名稱</label><input id="assignment-title" placeholder="例如：因式分解鞏固練習" maxlength="200" required></div><div class="form-field"><label class="field-label" for="assignment-class">指派班級</label><select id="assignment-class">${HW.classes.map(c=>`<option value="${c.id}">${esc(c.name)} · ${c.studentCount} 人</option>`).join('')}</select></div><div class="form-field"><label class="field-label" for="assignment-due">截止時間（本地時區）</label><input id="assignment-due" type="datetime-local" value="${local}" required></div><div class="form-field"><label class="field-label" for="assignment-kind">類型</label><select id="assignment-kind"><option value="homework">作業</option><option value="quiz">測驗</option></select></div><div class="form-field"><label class="field-label" for="assignment-duration">時間限制（分鐘）</label><input id="assignment-duration" type="number" min="1" max="300" placeholder="留空＝不限時"><p class="field-hint">模擬測驗建議設定 20–45 分鐘；學生按「開始測驗」後倒數，時間到自動提交。</p></div><div class="form-field"><label class="field-label" for="assignment-description">作業說明</label><input id="assignment-description" maxlength="4000" placeholder="寫出完整步驟，並代回檢查。"></div></div><div class="section-head" style="margin:24px 0 12px"><h2 style="font-size:calc(16px*var(--fs))">選擇題目</h2><span class="small-text" id="selected-question-count">已選 0 題</span></div><div class="pick-filters"><div class="form-field"><label class="field-label" for="pick-topic">章節（主分類）</label><select id="pick-topic"><option value="">全部章節</option>${pickTopics.map(t=>`<option value="${esc(t)}">${esc(t)}（${pickCount(t)} 題）</option>`).join('')}</select></div><div class="form-field"><label class="field-label" for="pick-subtopic">子分類</label><select id="pick-subtopic"><option value="">全部子分類</option></select></div><div class="form-field"><label class="field-label" for="pick-search">搜尋題目</label><input id="pick-search" placeholder="輸入關鍵字，例如：因式分解、三角形面積" maxlength="60"></div><div class="form-field pick-select-all"><label class="field-label">&nbsp;</label><button type="button" class="secondary" id="pick-select-all">全選目前篩選結果</button></div></div><div class="ai-gen-box" style="margin:14px 0 10px"><label class="field-label" for="assign-gen-brief">🤖 AI 生成作業題（一次多題）</label><div class="ai-gen-row"><input id="assign-gen-brief" maxlength="600" placeholder="一句話說明想要什麼題目，例如：用超巿折扣情境考一元一次方程"><select id="assign-gen-count" aria-label="生成題數"><option value="1">1 題</option><option value="3" selected>3 題</option><option value="5">5 題</option><option value="10">10 題</option></select><button type="button" class="secondary" id="assign-gen-btn">${icon('spark')}AI 生成並加入</button></div><div class="ai-gen-fields"><select id="assign-gen-topic">${pickTopics.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select><select id="assign-gen-subtopic"></select><select id="assign-gen-grade">${grades.map(g=>`<option${g==='中三'?' selected':''}>${g}</option>`).join('')}</select><select id="assign-gen-level">${[1,2,3].map(n=>`<option value="${n}">${levels[n]}</option>`).join('')}</select><select id="assign-gen-qtype">${qtypes.map(t=>`<option>${t}</option>`).join('')}</select><input id="assign-gen-points" type="number" min="1" max="100" value="5" aria-label="分值"></div><p class="field-hint" id="assign-gen-status">依下面的章節／年級／難度／題型生成新題，自動加入已選清單；生成後仍可移除。</p></div><div class="assignment-question-picks" id="assignment-picks"></div><p class="field-hint" id="pick-hint"></p><div id="picked-chips" class="picked-chips"></div><div class="form-field" style="margin:18px 0 6px"><label class="field-label">解題過程的作答方式（可多選）</label><div class="mode-checks"><label class="checkbox-line"><input id="assignment-mode-hand" type="checkbox" checked>手寫解題</label><label class="checkbox-line"><input id="assignment-mode-text" type="checkbox" checked>文字作答</label><label class="checkbox-line"><input id="assignment-mode-upload" type="checkbox" checked>上傳手稿</label></div><p class="field-hint">學生只能用你勾選的方式作答；選擇題一律用「點選作答」。至少要保留一種。</p></div><label class="checkbox-line"><input id="assignment-late" type="checkbox">允許截止時間後補交（會記錄遲交）</label><label class="checkbox-line"><input id="assignment-ai" type="checkbox" ${S.ai.configured?'':'disabled'}>使用 AI 建議評分與簡評（僅供教師覆核，不直接作正式成績；${S.ai.configured?(S.ai.mode==='local'?'本地模型':'外部模型'):'尚未接入 AI，無法啟用'}）</label><label class="checkbox-line" style="margin-left:22px"><input id="assignment-ai-confirm" type="checkbox" ${S.ai.configured?'':'disabled'}>AI 批閱後自動確認為教師分數<span class="small-text">（不建議：分數會直接計入成績，教師未看過）</span></label><div class="import-warning">學生逐題保存作答後，需正式提交整份作業。正式提交後作答鎖定，教師仍可覆核。上限30題。</div><p class="error-text" id="assignment-error"></p><button class="primary wide" type="submit">發布給班級 ${icon('arrow')}</button></form>`,true);
$('#pick-topic').onchange=e=>{pickState.topic=e.target.value;pickState.subtopic='';pickState.page=1;syncPickSubtopics();renderPickList();};
$('#pick-subtopic').onchange=e=>{pickState.subtopic=e.target.value;pickState.page=1;renderPickList();};
$('#pick-search').oninput=e=>{pickState.search=e.target.value.trim().toLowerCase();pickState.page=1;renderPickList();};
// 全選目前篩選結果：一次勾完當前篩選（章節／子分類／搜尋）下的所有題目，省去逐頁勾選。
if($('#pick-select-all'))$('#pick-select-all').onclick=()=>{
  const pool=pickPool();
  if(!pool.length)return toast('目前篩選下沒有題目。');
  if(pickState.picked.size+pool.length>30)return toast(`全選會選 ${pool.length} 題，超過上限 30 題；請先移除或縮小篩選範圍。`);
  pool.forEach(q=>pickState.picked.add(q.id));
  renderPickList();renderPickCount();renderPickedChips();
  toast(`已全選 ${pool.length} 題（目前共 ${pickState.picked.size} 題）。`);
};
// 勾選狀態存在 pickState.picked，篩選後仍保留已選題目（不會因換章節而漏掉）。
$('#assignment-picks').onchange=e=>{const cb=e.target.closest('input[name=assignment-questions]');if(!cb)return;const id=Number(cb.value);if(cb.checked){if(pickState.picked.size>=30){cb.checked=false;toast('每份作業最多選 30 題，請先移除已選題目。');return;}pickState.picked.add(id);}else pickState.picked.delete(id);renderPickCount();renderPickedChips();};
$('#assignment-picks').onclick=e=>{const b=e.target.closest('[data-pick-page]');if(!b||b.disabled)return;pickState.page=Number(b.dataset.pickPage);renderPickList();};
$('#picked-chips').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.id==='pick-clear')pickState.picked.clear();else if(b.dataset.unpick)pickState.picked.delete(Number(b.dataset.unpick));else return;renderPickList();renderPickCount();renderPickedChips();};
syncPickSubtopics();renderPickList();renderPickCount();
// AI 生成作業題：章節切換時同步子分類；按鈕觸發生成。
if($('#assign-gen-topic'))$('#assign-gen-topic').onchange=e=>{
  const t=e.target.value,sel=$('#assign-gen-subtopic');
  if(sel){const list=[...new Set(qs.filter(q=>q.topic===t).map(q=>q.subtopic).filter(Boolean))].sort();
    sel.innerHTML=`<option value="">全部子分類</option>`+list.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');}
};
if($('#assign-gen-btn'))$('#assign-gen-btn').onclick=aiGen;
$('#assignment-form').onsubmit=async e=>{e.preventDefault();const b=$('[type=submit]',e.target);b.disabled=true;try{const raw=$('#assignment-due').value,dt=new Date(raw);if(!raw||!Number.isFinite(dt.getTime()))throw new Error('請填寫有效的截止時間。');const durRaw=$('#assignment-duration').value.trim();if(durRaw){const d=Number(durRaw);if(!Number.isInteger(d)||d<1||d>300)throw new Error('時間限制必須是 1 至 300 的整數分鐘。');}const modes=['hand','text','upload'].filter(m=>{const el=$('#assignment-mode-'+m);return !el||el.checked;});if(!modes.length)throw new Error('至少要保留一種作答方式。');await api('/api/assignments',{title:$('#assignment-title').value,kind:$('#assignment-kind').value,classId:Number($('#assignment-class').value),questionIds:[...pickState.picked],dueAt:dt.toISOString(),description:$('#assignment-description').value,allowLate:$('#assignment-late').checked,aiGrading:$('#assignment-ai').checked,aiAutoConfirm:$('#assignment-ai-confirm').checked,durationMinutes:durRaw?Number(durRaw):null,answerModes:modes});closeModal();toast('作業已發布到指定班級。');homeworkPage();}catch(err){$('#assignment-error').textContent=err.message;b.disabled=false;}};}
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
${exams.length?`<div class="record-list">${exams.map(e=>`<article class="record"><span class="record-icon">${icon('mock')}</span><div class="record-body"><strong>${esc(e.topic)}${e.subtopic?` › ${esc(e.subtopic)}`:''} · ${e.questionCount} 題 · 限時 ${e.minutes} 分鐘</strong><p>${e.status==='submitted'?`已提交 · ${scoreText(e.score)} / ${e.maxScore} 分${e.percent!=null?`（${e.percent}%）`:''}${e.expired?' · 逾時自動提交':''}${e.pendingCount?` · ${e.pendingCount} 題待批閱`:''}`:`進行中 · 剩餘 ${fmtClock(e.remainingSeconds||0)}`}</p><small>${dateText(e.startedAt)}</small></div><div class="mock-actions"><button class="secondary" data-mock="${e.id}">${e.status==='submitted'?'查看結果':'繼續作答'}</button>${e.status==='submitted'?'':`<button class="text-button" data-mock-del="${e.id}" style="color:#b8453b">刪除</button>`}</div></article>`).join('')}</div>`:'<p class="field-hint">還沒有紀錄。選擇上面的條件開始第一場模擬測驗。</p>'}
</section></div>`;
const syncMockSub=()=>{const sel=$('#mock-subtopic');if(!sel)return;const subs=(o.subtopics||{})[$('#mock-topic').value]||[];sel.innerHTML='<option value="">全部子分類</option>'+subs.map(v=>`<option>${esc(v)}</option>`).join('');};$('#mock-topic').onchange=syncMockSub;syncMockSub();
$('#mock-start').onclick=async()=>{const b=$('#mock-start');b.disabled=true;$('#mock-error').innerHTML='';const body={count:Number($('#mock-count').value),minutes:Number($('#mock-minutes').value)};const topic=$('#mock-topic').value,level=$('#mock-level').value,qtype=$('#mock-qtype').value;if(topic)body.topic=topic;const sub=$('#mock-subtopic')?$('#mock-subtopic').value:'';if(sub)body.subtopic=sub;if(level)body.level=Number(level);if(qtype)body.qtype=qtype;const request=viewTarget();try{const r=await api('/api/mock',body);if(!viewMatches(request))return;toast('模擬測驗已開始，請把握時間。');mockExamPage(r.exam.id);}catch(e){if(!viewMatches(request))return;$('#mock-error').innerHTML=`<div class="inline-error">${esc(e.message)}</div>`;b.disabled=false;}};}
async function openMockQuestion(qid){if(!mockDetail||busy||mockContext?.id!==mockDetail.exam.id)return;if(mockDetail.exam.status==='submitted'||mockDetail.exam.remainingSeconds<=0||Date.parse(mockDetail.exam.expiresAt)<=Date.now()||quizTargetExpired())return toast('本份測驗已提交或到期，不能再作答。');preserveDraft();const q=mockDetail.questions.find(x=>x.id===Number(qid));if(!q)return;if(currentQuestion&&currentQuestion.id!==q.id&&strokes.length&&!lastResult&&await askCancel('目前手寫內容尚未提交，確定切換題目？'))return;assignmentContext=null;mockContext={id:mockDetail.exam.id,title:'模擬測驗 · '+mockDetail.exam.topic};currentQuestion=q;lastResult=null;lastSolution=null;answerMode=(q.options&&q.options.length)?'choice':'hand';answerFile=null;selectedOption=null;window.answerTextDraft='';strokes=[];redoStrokes=[];recommendations=null;practice();}
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
if(sb)sb.onclick=async()=>{if(await askCancel('提交後不能修改作答，確定提交？'))return;const request=viewTarget(),b=sb;b.disabled=true;try{await api(`/api/mock/${exam.id}/submit`,{});if(!viewMatches(request))return;stopQuizClock();toast('已提交並即時計分。');mockExamPage(exam.id);}catch(e){if(viewMatches(request)){toast(e.message);b.disabled=false;}}};}
async function assignmentPage(id){if(busy)return toast('請先等待作答保存完成。');preserveDraft();if(!S.user)return loginModal(()=>assignmentPage(id));if(S.user.role==='teacher')return resultsPage(id);beginView();stopQuizClock();page='homework';mockContext=null;assignmentContext={id:Number(id)};assignmentDetail=null;currentQuestion=null;shell();$('#sidebar').classList.remove('open');const target=viewTarget();try{const data=await api(`/api/assignments/${id}`);if(!viewMatches(target))return;assignmentDetail=data;assignmentContext=data.assignment;const {assignment:a,report:r,mySubmission:sub,questions:qs,attempts}=data;const map=new Map();attempts.forEach(x=>{if(!map.has(x.questionId)||map.get(x.questionId).id<x.id)map.set(x.questionId,x);});const submitted=sub.status==='submitted';const late=new Date(a.dueAt)<new Date();const fix=sub.correction;const isQuiz=a.kind==='quiz'&&!!a.durationMinutes;const quizStarted=!!sub.startedAt;const quizExpired=!!sub.expired||(quizStarted&&(sub.remainingSeconds<=0||Date.parse(sub.expiresAt)<=Date.now()));const quizBlocked=isQuiz&&!submitted&&!sub.correction&&(!quizStarted||quizExpired);const fixIds=new Set(fix?fix.questionIds:[]);const locked=submitted||!!fix;const inFix=q=>!fix||fixIds.has(q.id);const redone=q=>{const at=map.get(q.id);return!!(at&&fix&&at.id>(fix.minAttemptId??-1));};const pendingFix=fix?qs.filter(inFix).filter(q=>!redone(q)).length:0;$('#main').innerHTML=`<div class="fade-in"><button class="text-button back-button" data-page="homework">${icon('back')}返回我的作業</button>${heading('YOUR ASSIGNMENT',mathText(a.title),`${esc(a.className)} · 截止 ${dateText(a.dueAt)} · ${a.questionCount} 題 / ${a.totalPoints} 分`,`<span class="badge ${submitted?'':'l2'}">${statusText(sub.status)}${sub.late?' · 遲交':''}${sub.submitCount>1?` · 第 ${sub.submitCount} 次提交`:''}</span>`)}${isQuiz&&!submitted?`<div class="quiz-banner${quizExpired?' expired':''}">${icon('clock')}<div class="quiz-banner-body"><strong>模擬測驗 · 限時 ${a.durationMinutes} 分鐘</strong>${!quizStarted?`<small>按「開始測驗」後開始倒數；到期自動封存，分數與 AI 建議須教師覆核。</small>`:quizExpired?`<small>測驗時間已結束，無法再作答。</small>`:`<small>剩餘時間 <span class="quiz-clock" data-quiz-clock>--:--</span> · 到期自動封存，分數與 AI 建議須教師覆核。</small><div class="quiz-bar"><span data-quiz-bar="${a.durationMinutes*60}"></span></div>`}</div>${!quizStarted&&!quizExpired?`<button class="primary" id="start-quiz">開始測驗 ${icon('arrow')}</button>`:''}</div>`:''}${fix?`<div class="correction-banner"><div class="advice-heading">${icon('undo')}教師要求訂正（第 ${fix.round} 回合）</div><p>${esc(fix.note)}</p><small class="field-hint">教師於 ${dateText(fix.requestedAt)} 要求。請完成範圍內題目後按「提交訂正」；教師要求的訂正不受截止時間限制。${pendingFix?`目前尚有 ${pendingFix} 題未重新作答。`:'所有題目已重新作答，可以提交。'}</small></div>`:''}${submitted&&isQuiz?`<div class="quiz-result-banner${r.awaitingReview?' awaiting':''}"><div class="advice-heading">${icon(r.awaitingReview?'clock':'check')}測驗已完成${r.awaitingReview?' · 等待教師批閱':' · 教師已批閱'}</div>${r.awaitingReview?`<p>教師批閱後才會顯示分數與 AI 批閱結果。</p><small class="field-hint">已保存 ${map.size} / ${qs.length} 題 · 待教師批閱 ${r.pendingCount} 題，未當零分。</small>`:`<p class="quiz-result-score"><strong>${scoreText(r.score)}</strong> / ${r.maxScore} 分${r.percent!=null?`（${r.percent}%）`:''}</p><small class="field-hint">已評 ${r.gradedCount} / ${r.questionCount} 題${r.pendingCount?` · ${r.pendingCount} 題待教師批閱，未當零分`:''}。右側「學習建議」已按本次表現更新。</small>`}</div>`:''}${submitted&&r?.awaitingReview&&!isQuiz?`<div class="hint-box" style="margin-bottom:20px">${icon('clock')}作業已提交，等待教師批閱。教師批閱後才會顯示分數、AI 批閱結果、參考答案與學習建議。</div>`:''}${a.aiGrading?`<div class="hint-box" style="margin-bottom:20px">${icon('spark')}本份作業由教師設定使用 AI 建議評分（僅供教師覆核），最終分數以教師確認為準。</div>`:''}${a.description?`<div class="hint-box" style="margin-bottom:20px">${esc(a.description)}</div>`:''}${homeworkMetrics([['已保存題目',fix?`${qs.filter(q=>inFix(q)&&redone(q)).length} / ${fixIds.size}`:`${map.size} / ${qs.length}`,fix?'只計本回合訂正範圍的最新有效作答':'保存題目不等於正式交作業'],['已評得分',scoreText(r.score),r.awaitingReview?'教師批閱後才顯示':`僅涵蓋已評 ${r.totalScoredPoints} 分，非完整總分`],['待批閱題目',r.pendingCount,'未批閱不當零分'],['教師確認分',scoreText(r.confirmedScore),`已確認 ${r.confirmedCount} / ${qs.length} 題`]])}<div class="homework-layout"><section class="panel assignment-question-list"><div class="panel-heading"><h2>本份作業題目</h2><span class="small-text">${fix?'只可修改訂正範圍內的題目':submitted?'作答已鎖定':'可逐題保存並重做'}</span></div>${qs.map((q,i)=>{const at=map.get(q.id);return `<article class="assignment-question-row"><span class="question-number">${String(i+1).padStart(2,'0')}</span><div class="question-body"><div class="question-top"><h3>${mathText(q.title)}</h3><span class="badge">${q.points} 分</span></div>${stemHtml(q)}<span class="small-text">${at?(at.skipped?'已標示「本題不會」 · 等待教師處理':(at.awaitingReview?`${submitted?'已提交':'已保存'} · 等待教師批閱`:(at.status==='pending'?'已保存 · 待批閱':`已評 ${at.score}/${at.maxScore} · ${at.teacherReviewed?'教師確認':'尚未教師確認'}`))):'尚未作答'}${fix?(inFix(q)?(redone(q)?' · 已訂正待提交':' · 待訂正'):' · 不需訂正'):''}</span>${at&&(submitted||redone(q))?`${at.awaitingReview?'':`<p class="field-hint">${esc(at.feedback)}</p>`}<button class="text-button" data-review="${at.id}" style="font-size:calc(14px*var(--fs))">${at.awaitingReview?'查看我的作答':'查看手稿與學習建議'} ${icon('arrow')}</button>`:''}</div>${(!locked||(fix&&inFix(q)))&&!quizBlocked?`<div class="q-actions"><button class="practice-btn" data-assignment-q="${q.id}" ${late&&!a.allowLate&&!fix?'disabled':''}>${at?(at.skipped?'補作答':'修改作答'):'開始解題'} ${icon('arrow')}</button>${!at&&!isQuiz?`<button class="text-button skip-btn" data-skip-q="${q.id}" title="不會也沒關係，老師會看到">本題不會</button>`:''}</div>`:''}</article>`;}).join('')}<div class="assignment-submit"><p class="field-hint">${fix?`請完成訂正範圍內的 ${fixIds.size} 題後提交，教師會重新檢視你的推導。${pendingFix?`目前尚有 ${pendingFix} 題未重新作答。`:'所有題目已重新作答。'}`:submitted?`正式提交於 ${dateText(sub.submittedAt)}${sub.resubmittedAt?` · 最近訂正提交於 ${dateText(sub.resubmittedAt)}`:''}。你可查看結果，教師覆核後分數會更新。`:late&&!a.allowLate?'已超過截止時間，本份作業不接受補交。':'完成所有題目後正式交作業。含待批閱的手稿也可提交，不會自動記零分。'}</p>${fix?`<button class="primary" id="finalize-assignment" ${pendingFix?'disabled':''}>提交訂正 ${icon('check')}</button>`:!submitted?`<button class="primary" id="finalize-assignment" ${!quizExpired&&(map.size!==qs.length||(late&&!a.allowLate)||quizBlocked)?'disabled':''}>正式提交整份作業 ${icon('check')}</button>${(!fix&&!quizBlocked&&!(late&&!a.allowLate)&&map.size!==qs.length)?`<button class="secondary" id="skip-rest-submit">其餘 ${qs.length-map.size} 題標示「不會」並提交</button>`:''}`:`<button class="secondary" data-assignment="${a.id}">讀取最新批閱 ${icon('undo')}</button>`}</div></section><aside class="right-stack">${suggestionCard(r.suggestion)}<section class="panel right-panel"><h2>${icon('growth')}知識點表现</h2>${r.topicStats.map(t=>`<div class="topic-detail"><div class="knowledge-row"><span>${esc(t.topic)}</span><span>${t.percent===null?'待批閱':t.percent+'%'}</span></div><div class="progress-track"><div class="progress-fill" style="width:${t.percent||0}%"></div></div><small class="field-hint">已評 ${t.scoredCount} / ${t.totalCount} 題</small></div>`).join('')}</section></aside></div></div>`;for(const at of attempts){const idx=S.attempts.findIndex(x=>x.id===at.id);if(idx<0)S.attempts.push(at);else S.attempts[idx]=at;}if($('#start-quiz'))$('#start-quiz').onclick=async()=>{const request=viewTarget(),b=$('#start-quiz');b.disabled=true;try{await api(`/api/assignments/${id}/start`,{});if(!viewMatches(request))return;toast('已開始計時，請把握時間作答。');assignmentPage(id);}catch(e){if(viewMatches(request)){toast(e.message);b.disabled=false;}}};if(isQuiz&&quizStarted&&!submitted&&!fix)startQuizClock({kind:'assignment',id:a.id},sub.remainingSeconds,sub.expiresAt);else stopQuizClock();
  const skipRest=$('#skip-rest-submit');
  if(skipRest)skipRest.onclick=async()=>{
    const answered=new Set((assignmentDetail?.attempts||[]).map(x=>x.questionId));
    const missing=(assignmentQuestionScope()||[]).filter(q=>!answered.has(q.id));
    if(!missing.length)return;
    if(await askCancel(`把剩下的 ${missing.length} 題標示為「不會」並立即提交？老師會看到哪幾題沒有作答，不會自動記零分。`))return;
    const b=skipRest;b.disabled=true;b.innerHTML=icon('clock')+'正在處理…';
    try{
      for(const q of missing)await api('/api/attempts',{questionId:q.id,skipped:true,assignmentId:id});
      await api(`/api/assignments/${id}/submit`,{});
      toast('已標示「不會」並正式提交，老師會看到哪幾題沒有作答。');
      assignmentPage(id);
    }catch(e){b.disabled=false;b.innerHTML=`其餘 ${missing.length} 題標示「不會」並提交`;toast(e.message);}
  };if($('#finalize-assignment'))$('#finalize-assignment').onclick=async()=>{
  if(await askCancel(fix?'提交訂正後教師會重新檢視，確定提交？':'正式提交後不能修改作答，確定交作業？'))return;
  const request=viewTarget(),b=$('#finalize-assignment');b.disabled=true;
  const send=()=>api(`/api/assignments/${id}/submit`,{});
  try{
    try{await send();}
    catch(err){
      // 還有題目沒有交代：一次把剩下的標示「不會」，不必逐題回去點。
      if(!/還有 \d+ 題沒有作答/.test(err.message||''))throw err;
      if(await askCancel(`${err.message}\n\n要把這些題目標示為「不會」並立即提交嗎？老師會看到這幾題沒有作答，不會自動記零分。`))throw err;
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
  preserveDraft();if(strokes.length&&!lastResult&&page==='practice'&&await askCancel('目前手稿尚未提交，確定切換？'))return;
  mockContext=null;assignmentContext=a;if(fix)stopQuizClock();currentQuestion=q;lastResult=null;lastSolution=null;answerMode=q.options?.length?'choice':'hand';answerFile=null;selectedOption=null;strokes=[];redoStrokes=[];window.answerTextDraft='';recommendations=null;
  practice();const target=viewTarget();
  if(!fix&&a.kind==='quiz'&&a.durationMinutes)startQuizClock({kind:'assignment',id:a.id},sub.remainingSeconds,sub.expiresAt);else stopQuizClock();
  try{const rec=await api(`/api/questions/${qid}/recommendations`);if(!viewMatches(target))return;recommendations=rec;renderRecommendations();}catch(e){if(viewMatches(target))toast(e.message);}
  if(viewMatches(target))window.scrollTo({top:0});
}
// 逐題表現：知識點平均看不出「哪一題要重教」——同一知識點裡可能一題全班錯、一題大家都對。
function questionStatsHtml(rows){
  const list=(rows||[]).filter(Boolean).slice().sort((a,b)=>{
    const ra=a.rate==null?101:a.rate, rb=b.rate==null?101:b.rate;
    return ra-rb;
  });
  if(!list.length)return '';
  return `<section class="panel panel-pad" style="margin-bottom:16px"><h2 style="margin-bottom:6px">逐題表現</h2><p class="small-text" style="margin:0 0 12px">由得分率低到高排。「要重教」＝得分率低於 50% 且已批 2 人以上；待批與未作答分開列，不當零分。</p>
    <table class="board-table"><thead><tr><th>題目</th><th>知識點</th><th>得分率</th><th>平均</th><th>已批</th><th>待批</th><th>未作答</th></tr></thead><tbody>${list.map(q=>{
      const weak=q.rate!=null&&q.rate<50&&q.graded>=2;
      return `<tr class="${weak?'question-weak':''}"><td><strong>第 ${q.index} 題</strong> ${mathText(q.title)}${weak?'<span class="badge paper-missing">要重教</span>':''}</td><td class="small-text">${esc(q.topic||'')}</td><td>${q.rate==null?'—':q.rate+'%'}</td><td>${q.average==null?'—':`${q.average} / ${q.points}`}</td><td>${q.graded}</td><td>${q.pending}</td><td>${q.unanswered}</td></tr>`;
    }).join('')}</tbody></table></section>`;
}
async function resultsPage(id){if(busy)return;if(!S.user)return loginModal(()=>resultsPage(id));page='homework';shell();$('#sidebar').classList.remove('open');try{resultData=await api(`/api/assignments/${id}/results`);assignmentDetail=await api(`/api/assignments/${id}`);const {assignment:a,students,summary:s,topicStats:ts,questionStats:qs}=resultData;$('#main').innerHTML=`<div class="fade-in"><button class="text-button back-button" data-page="homework">${icon('back')}返回作業與成績</button>${heading('CLASS RESULTS',mathText(a.title),`${esc(a.className)} · ${a.questionCount} 題 / ${a.totalPoints} 分 · 截止 ${dateText(a.dueAt)}${a.aiGrading?' · 已啟用 AI 建議評分':''}`,`<button class="secondary" id="export-results">${icon('file')}匯出成績</button><button class="secondary" data-results="${id}">${icon('undo')}重新整理</button>${s.pendingReviewCount?`<button class="primary" id="review-all-pending">${icon('check')}連續批閱（${s.pendingReviewCount} 題）</button><button class="secondary" id="bulk-score">${icon('list')}批次給分</button>`:''}${(a.aiGrading&&S.ai.configured)?`<button class="secondary" id="ai-review-all">${icon('spark')}${a.aiAutoConfirm?'一鍵 AI 批閱並確認':'AI 預批（分數待教師確認）'}</button>`:''}`)}${homeworkMetrics([['正式提交',`${s.submittedCount} / ${s.studentCount}`,s.correctionCount?`其中 ${s.correctionCount} 人訂正中 · 不計入平均`:'人數 · 未交者不計零分'],['全題已評平均',scoreText(s.averageScore),`${s.fullyGradedCount} 人 · 僅正式提交且全題已評`],['教師確認平均',scoreText(s.confirmedAverage),'只計全題教師確認的正式提交'],['待覆核題目',s.pendingReviewCount,'手稿待批及 AI 建議未確認'],['建議覆核題目',s.reviewFlagCount,'AI 建議分與規則核對不一致，建議優先看']])}<div class="import-warning" style="margin-bottom:20px">「已評得分」可能僅涵蓋部分題目，不能當完整總分或用於排名。AI 原建議分、規則原分及教師確認分分開保存；只採每題最新作答。</div>${questionStatsHtml(qs)}<section class="panel results-panel"><div class="panel-heading"><h2>學生提交與成績</h2><span class="small-text">${students.length} 位學生</span></div><div class="results-filters" style="padding:0 22px 16px;display:flex;gap:12px;flex-wrap:wrap"><input id="results-search" placeholder="搜尋學生名稱或帳戶" aria-label="搜尋學生" style="padding:10px;border:1px solid var(--border);border-radius:6px"><select id="results-filter" aria-label="提交狀態篩選" style="padding:10px;border:1px solid var(--border);border-radius:6px"><option value="all">全部學生</option><option value="not_started">未開始</option><option value="in_progress">作答中</option><option value="submitted">已正式提交</option><option value="pending">有待批題目</option><option value="flagged">有建議覆核</option></select></div><div class="table-scroll"><table class="results-table"><thead><tr><th>學生</th><th>提交狀態</th><th>作答／待批</th><th>已評得分</th><th>AI 原分</th><th>規則原分</th><th>教師確認</th><th>回饋</th></tr></thead><tbody>${students.map(st=>`<tr data-result-user="${st.id}" data-status="${st.status}" data-pending="${st.pendingCount}" data-flags="${st.reviewFlagCount||0}"><td><strong>${esc(st.name)}</strong><small>${esc(st.username)}</small></td><td><span class="badge ${st.status==='submitted'?'':'l2'}">${statusText(st.status)}</span>${st.late?'<small>遲交</small>':''}${st.correction?`<small>第 ${st.correction.round} 回合訂正</small>`:''}</td><td>${st.answeredCount}/${a.questionCount}<small>待批 ${st.pendingCount} 題</small>${st.reviewFlagCount?`<small class="review-flag-note">建議覆核 ${st.reviewFlagCount} 題</small>`:''}</td><td>${scoreText(st.score)}<small>涵蓋 ${st.scoredPoints}/${a.totalPoints} 分值</small></td><td>${scoreText(st.aiScore)}</td><td>${scoreText(st.ruleScore)}</td><td>${scoreText(st.confirmedScore)}<small>${st.confirmedCount}/${a.questionCount} 題</small></td><td><button class="practice-btn" data-student-result="${st.id}">${st.pendingCount?`批閱與建議 ${icon('arrow')}`:`查看 ${icon('arrow')}`}</button></td></tr>`).join('')}</tbody></table></div></section><div class="growth-layout" style="margin-top:22px"><section class="panel growth-panel"><h2>班級知識點表現</h2><p>只統計最新已評題目；未作答或待批題目不算零分。</p>${ts.map(t=>`<div class="topic-detail"><div class="knowledge-row"><span>${esc(t.topic)}</span><span>${t.percent===null?'暫無已評數據':t.percent+'%'}</span></div><div class="progress-track"><div class="progress-fill" style="width:${t.percent||0}%"></div></div><small class="field-hint">已評 ${t.scoredCount}/${t.totalCount} 道學生題目</small></div>`).join('')}</section><section class="panel growth-panel"><h2>${icon('bulb')}每位學生，都有下一步</h2><p>點擊「批閱與建議」查看本次的具體回饋。AI 建議依本次批改及最多5次同主題記錄生成；未接入時提供明确標示的規則建議。</p><p>教師覆核後，建議會根據教師的真實評語更新，不把待批手稿當成錯題。</p></section></div></div>`;$$('[data-student-result]').forEach(b=>b.onclick=()=>studentResultModal(Number(b.dataset.studentResult)));const filterRows=()=>{const term=$('#results-search').value.trim().toLowerCase(),state=$('#results-filter').value;$$('[data-result-user]').forEach(row=>{row.hidden=!(row.textContent.toLowerCase().includes(term)&&(state==='all'||state==='pending'&&Number(row.dataset.pending)>0||state==='flagged'&&Number(row.dataset.flags)>0||row.dataset.status===state));});};$('#results-search').oninput=filterRows;$('#results-filter').onchange=filterRows;$('#export-results').onclick=exportResultsCsv;const all=$('#ai-review-all');if(all)all.onclick=()=>aiReviewAll(id);
  const walk=$('#review-all-pending');if(walk)walk.onclick=()=>startClassReview(id);
  const bulk=$('#bulk-score');if(bulk)bulk.onclick=()=>bulkScoreModal(id);
  window.scrollTo({top:0});}catch(e){toast(e.message);}}
// 批次給分：一次過把整班待批的題目給分（預設滿分），不必逐筆開視窗。
// 一班 30 人 × 5 題要點 150 次是日常痛點；這裡一次存完，之後仍可逐題改。
function bulkScoreModal(assignmentId){
  const pending=(assignmentDetail?.attempts||[]).filter(a=>a.needsReview&&a.student);
  if(!pending.length)return toast('沒有待批的作答。');
  const groups=new Map();
  pending.forEach(a=>{
    if(!groups.has(a.questionId))groups.set(a.questionId,{title:a.questionTitle,max:a.maxScore||0,items:[]});
    groups.get(a.questionId).items.push(a);
  });
  const rowHtml=(a,max)=>`<label class="bulk-row">
      <span class="bulk-who">${esc(a.student?.name||'')}${a.student?.seat?`<span class="small-text"> 座號 ${esc(a.student.seat)}</span>`:''}</span>
      <input type="number" class="bulk-input" data-attempt="${a.id}" min="0" max="${max}" step="any"
             value="${max}" aria-label="${esc(a.student?.name||'')} 的分數">
      <span class="small-text">/ ${max} 分</span>
    </label>`;
  const body=[...groups.values()].map(g=>`<section class="bulk-group">
      <div class="bulk-head"><strong>${mathText(g.title||'題目')}</strong>
        <span class="small-text">${g.items.length} 筆 · 滿分 ${g.max} 分</span>
        <button type="button" class="text-button" data-fill="${g.max}">全部給 ${g.max} 分</button></div>
      ${g.items.map(a=>rowHtml(a,g.max)).join('')}
    </section>`).join('');
  modal(`<p class="eyebrow">BATCH SCORE</p><h2>批次給分</h2>
    <p class="modal-intro">共 ${pending.length} 筆待批。分數已預設為滿分，可直接改；把某一格清空就代表這次不給分（留著待批）。</p>
    <div class="bulk-list">${body}</div>
    <p class="error-text" id="bulk-error"></p>
    <button class="primary wide" id="bulk-save">儲存全部 ${icon('check')}</button>`,true);
  const box=$('.bulk-list');
  $$('[data-fill]',box).forEach(btn=>btn.onclick=()=>{
    const group=btn.closest('.bulk-group');
    $$('.bulk-input',group).forEach(i=>{i.value=btn.dataset.fill;});
  });
  $('#bulk-save').onclick=async()=>{
    const btn=$('#bulk-save');const err=$('#bulk-error');err.textContent='';
    const rows=$$('.bulk-input',box).filter(i=>String(i.value).trim()!=='');
    if(!rows.length){err.textContent='至少要給一筆分數。';return;}
    const old=btn.textContent;btn.disabled=true;
    let done=0;
    try{
      for(const input of rows){
        btn.textContent=`儲存中… ${done+1}/${rows.length}`;
        await api(`/api/attempts/${input.dataset.attempt}/review`,
                  {score:Number(input.value),feedback:''});
        done+=1;
      }
      closeModal();
      toast(`已為 ${done} 筆作答給分。`);
      await refresh();
      resultsPage(assignmentId);
    }catch(e){
      err.textContent=done?`已存 ${done} 筆，之後失敗：${e.message}`:e.message;
      btn.disabled=false;btn.textContent=old;
    }
  };
}
// 整班連續批閱：把所有「尚未教師批閱」的最新作答排成一條佇列，存檔即跳下一題。
// 手機上不必一題一題開關——手稿看完、給分、按「保存並看下一題」，一路滑完一班。
function startClassReview(assignmentId){
  const latest=new Map();
  (assignmentDetail?.attempts||[]).forEach(at=>{
    const sid=at.student?.id; if(!sid)return;
    const key=`${sid}:${at.questionId}`;
    const prev=latest.get(key);
    if(!prev||prev.id<at.id)latest.set(key,at);      // 只取每題最新一次作答
  });
  const qOrder=new Map((assignmentDetail?.questions||[]).map((q,i)=>[q.id,i]));
  const seatOf=at=>{const s=resultData?.students?.find(x=>x.id===at.student?.id);
    return s&&s.seat?Number(s.seat)||999:999;};
  const queue=[...latest.values()].filter(at=>!at.teacherReviewed)
    .sort((a,b)=>seatOf(a)-seatOf(b)||((qOrder.get(a.questionId)||0)-(qOrder.get(b.questionId)||0)));
  if(!queue.length)return toast('這份作業沒有待批閱的作答。');
  // reviewModal 是從 S.attempts 找資料的，先把這批塞進去
  queue.forEach(at=>{const i=S.attempts.findIndex(x=>x.id===at.id);
    if(i<0)S.attempts.push(at);else S.attempts[i]=at;});
  const first=queue[0];
  reviewModal(first.id,()=>resultsPage(assignmentId),
    (assignmentDetail.questions||[]).find(q=>q.id===first.questionId),
    queue.map(at=>at.id));
}

// 教師一鍵 AI 全部批閱：對尚未批閱的作答逐題 AI 評分並直接確認為教師批閱分數。
async function aiReviewAll(id){
  const btn=$('#ai-review-all');const external=S.ai.mode==='external';
  // 這份作業有沒有開「AI 批閱後自動確認」：沒開就只是預批，分數要老師自己確認才算數。
  const auto=!!(assignmentDetail?.assignment?.aiAutoConfirm);
  const tail=auto?'，並直接標記為「教師已批閱」':'；分數只作建議，仍要你確認才算正式成績';
  const message=(external
    ?'將以 AI 批閱這份作業中所有尚未批閱的作答，作答內容（含手寫圖片）會傳送至學校配置的外部 AI'
    :'將以 AI 批閱這份作業中所有尚未批閱的作答')+tail+'。確定繼續？';
if(await askCancel(message))return;const original=btn.innerHTML;btn.disabled=true;btn.innerHTML=icon('clock')+'正在以 AI 批閱…';try{const r=await api(`/api/assignments/${id}/ai-review`,{consentExternal:external});const parts=[r.autoConfirm?`已批閱並確認 ${r.reviewed} 題`:`AI 已預批 ${r.graded} 題（待你確認）`];if(r.failed)parts.push(`${r.failed} 題失敗`);if(r.skipped)parts.push(`${r.skipped} 題已被其他操作處理`);if(r.remaining)parts.push(`還有 ${r.remaining} 題，請再按一次`);toast(parts.join(' · ')+(r.errors?.length?`（${r.errors[0].error}）`:''));await resultsPage(id);}catch(e){toast(e.message);btn.disabled=false;btn.innerHTML=original;}}
function studentResultModal(uid){const st=resultData.students.find(s=>s.id===uid);if(!st)return;const latest=new Map();assignmentDetail.attempts.filter(at=>at.student?.id===uid).forEach(at=>{if(!latest.has(at.questionId)||latest.get(at.questionId).id<at.id)latest.set(at.questionId,at);});modal(`<p class="eyebrow">INDIVIDUAL FEEDBACK</p><h2>${esc(st.name)} · 本次作業</h2><p class="modal-intro">${statusText(st.status)} · 已評 ${scoreText(st.score)} 分（涵蓋 ${st.scoredPoints} 分值） · 教師確認 ${scoreText(st.confirmedScore)} 分</p>${suggestionCard(st.suggestion)}${st.correction?`<div class="correction-banner"><div class="advice-heading">${icon('undo')}訂正中（第 ${st.correction.round} 回合）</div><p>${esc(st.correction.note)}</p><small class="field-hint">已於 ${dateText(st.correction.requestedAt)} 要求訂正 ${st.correction.questionIds.length||assignmentDetail.questions.length} 題。學生重新提交前，此份作業不計入班級平均。</small></div>`:''}<h3 style="margin-top:22px">逐題查看與覆核</h3>${assignmentDetail.questions.map(q=>{const at=latest.get(q.id);return `<div class="student-review-row"><div><strong>${mathText(q.title)}</strong><small>${at?at.status==='pending'?'待批閱':`已評 ${at.score}/${q.points} · ${at.teacherReviewed?'已教師確認':'未教師確認'}`:'尚未作答'}${at?.reviewFlags?.length?' · <span class="badge review-flag">建議覆核</span>':''}</small></div>${at?`<button class="secondary" data-hw-review="${at.id}">查看／批閱</button>`:''}</div>`;}).join('')}${(assignmentDetail.assignment.aiGrading&&S.ai.configured)?`<div class="submit-row" style="margin-top:16px"><button class="secondary" id="adopt-student-ai">${icon('spark')}確認這位學生的全部 AI 建議</button><span class="small-text">只處理尚未覆核的題目；標示「不會」的空白題不會丟給模型。</span></div>`:''}<div class="correction-actions">${st.submittedAt&&!st.correction?`<button class="secondary" id="request-correction">${icon('undo')}退回訂正</button><span class="small-text">讓學生重新作答並再次提交</span>`:`<span class="small-text">${st.correction?'已有進行中的訂正要求。':'此學生尚未正式提交，無需退回訂正。'}</span>`}</div>`,true);for(const at of latest.values()){const idx=S.attempts.findIndex(x=>x.id===at.id);if(idx<0)S.attempts.push(at);else S.attempts[idx]=at;}const studentQueue=assignmentDetail.questions.map(q=>latest.get(q.id)).filter(Boolean).map(at=>at.id);
$$('[data-hw-review]').forEach(b=>b.onclick=()=>{const at=S.attempts.find(x=>x.id===Number(b.dataset.hwReview));closeModal();reviewModal(at.id,()=>resultsPage(resultData.assignment.id),assignmentDetail.questions.find(q=>q.id===at.questionId),studentQueue);});
const adoptAll=$('#adopt-student-ai');
if(adoptAll)adoptAll.onclick=async()=>{const external=S.ai.mode==='external';
  if(external&&await askCancel('會把這位學生的作答（含手寫圖片）傳送給外部 AI，是否繼續？'))return;
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
// 左上角品牌＝回首頁。首頁依角色而定，但兩者都是同一個頁面（標題會自己換）：
// 學生看到「我的作業」，教師看到「作業與成績」。
// 它原本只是 <a href="#bank">，本專案沒有 hash 路由，點下去只改網址、畫面不動，
// 重新整理反而被帶回預設頁。這裡接成真正的頁內導覽，並擋掉預設的 hash 行為。
const brandLink=$('#brand');
if(brandLink)brandLink.addEventListener('click',e=>{
  e.preventDefault();
  if(busy)return toast('目前操作正在進行，請等待完成。');
  navigate('homework');
});
async function init(){loadBookmarks();homeworkPage();try{const session=await api('/api/session');serverOnline=true;serverIssue='';if(session.user){await refresh();homeworkPage();}}catch(e){serverIssue=e.message;toast(/初始化/.test(e.message)?e.message:'無法連接網站服務；目前為訪客界面預覽。請確認網站服務狀態。');}}
init();
