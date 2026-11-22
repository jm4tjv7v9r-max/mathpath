'use strict';
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

let navEscBound=false;
let navOpen={};   // 側欄分組展開狀態（key → bool）；沒設定就跟著當前頁面
function shell(){// 「新手上路」放最後——那是第一次來看的，不是每天要點的。
// 日曆、排行榜、新手上路已移到頂欄快速連結，側欄只留其餘功能（按使用頻率排）。
// 教師側欄只有五大類；「題庫與入題」「批閱」是按下去才向下展開的分組。
  // 展開狀態記在 navOpen：沒設定過就跟著當前頁面（在裡面就展開）。
  const navRow=(id,label,active,child,iconId)=>`<button class="nav-item${child?' child':''} ${active?'active':''}" data-page="${id}">${icon(iconId||id)}<span>${label}</span>${id==='bank'?`<span class="count">${S.user?S.questions.length:'示例'}</span>`:''}${id==='coins'&&S.coins?`<span class="count" title="目前金幣">${S.coins.total}</span>`:''}</button>`;
  const TEACHER_NAV=[
    {key:'homework',label:'作業成績',iconId:'homework',
     children:[['homework','作業成績','list'],['scores','成績總表','papers']]},
    {id:'coins',label:'金幣',iconId:'coin'},
    {key:'review',label:'批閱',iconId:'edit',
     children:[['mistakes','作業批閱'],['paper','紙本批閱'],['paperbatch','全班紙本批閱']]},
    {key:'bank',label:'題庫與入題',iconId:'bank',
     children:[['bank','題庫','list'],['import','試卷拆題入庫'],['newq','新增題目']]},
    {key:'classroom',label:'課堂應用',iconId:'board',
     children:[['classroom','開始上課'],['classroomRecords','課堂紀錄']]},
    {id:'layout',label:'試卷修正排版'},
    {id:'papers',label:'我的試卷'},
  ];
  let navHtml='';
  if(S.user?.role==='teacher'){
    navHtml=TEACHER_NAV.map(g=>{
      if(!g.children)return navRow(g.id,g.label,page===g.id,false);
      const inside=g.children.some(([c])=>c===page);
      const open=g.key in navOpen?navOpen[g.key]:inside;
      // 「批閱」有待批的作答時顯示數量，老師不必自己點進去找。
      const badge=g.key==='review'&&S.pendingReviews?`<span class="count due" title="待批閱 ${S.pendingReviews} 題">${S.pendingReviews}</span>`:'';
      const head=`<button class="nav-item nav-parent" data-nav-toggle="${g.key}" aria-expanded="${open}" aria-controls="nav-${g.key}">${icon(g.iconId)}<span>${g.label}</span>${badge}<span class="chev">${icon('chevron')}</span></button>`;
      const kids=`<div class="nav-children" id="nav-${g.key}"${open?'':' hidden'}>${g.children.map(([c,l,ic])=>navRow(c,l,page===c,true,ic)).join('')}</div>`;
      return head+kids;
    }).join('');
  }else{
    let nav=[['classroom','課堂'],['homework','我的作業'],['mock','模擬測驗'],['bank','數學題庫'],['practice','自主練習'],['mistakes','我的錯題本'],['coins','我的金幣'],['growth','學習足跡']];
    if(S.user?.role!=='student')nav=nav.filter(([id])=>id!=='mock');
    navHtml=nav.map(([id,label])=>navRow(id,label,page===id,false)).join('');
  }
  // 依登入角色設定主題色：未登入=綠，學生=紫，教師=藍
  if(S.user?.role==='teacher'||S.user?.role==='student'){document.documentElement.dataset.role=S.user.role;}
  else{delete document.documentElement.dataset.role;}
  $('#nav').innerHTML=navHtml;$('#settings-nav').innerHTML=icon('settings')+'<span>設定與隱私</span>';$('#settings-nav').classList.toggle('active',page==='settings');$('#account').innerHTML=`<span class="avatar">${S.user?(S.user.role==='teacher'?'師':'學'):'M'}</span><span class="account-info">${S.user?esc(S.user.name):'訪客預覽'}<small>${S.user?(S.user.role==='teacher'?'教師工作空間':'中三數學學習者'):'登入後開始學習'}</small></span>${icon(S.user?'chevron':'logout')}`;$('#avatar').textContent=S.user?(S.user.role==='teacher'?'師':'學'):'M';const labels={contests:'數學比賽',guide:'新手上路',homework:S.user?.role==='teacher'?'作業成績':'我的作業',calendar:'日曆',board:'排行榜',mock:'模擬測驗',ai:'模型端點',bank:'數學題庫',practice:'自主練習',import:'試卷拆題入庫',mistakes:S.user?.role==='teacher'?'作業批閱':'我的錯題本',paper:'紙本批閱',paperbatch:'全班紙本批閱',classroom:(S.user?.role==='teacher'?'課堂應用':'課堂'),classroomRecords:'課堂紀錄',layout:'試卷修正排版',papers:'我的試卷',growth:'學習足跡',newq:'新增題目',coins:'金幣',settings:'設定與隱私'};$('#crumb').textContent=labels[page] || '數學題庫';renderCalculator();}

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
if(noteList.length){
  // 日曆格只寫「事項本身」的簡短文字，不要寫「1 則提醒」這種沒有資訊的計數。
  const first=(noteList[0].title||'').trim();
  const brief=first.length>6?first.slice(0,6)+'…':first;
  const more=noteList.length>1?` +${noteList.length-1}`:'';
  marks.push(`<span class="cal-mark note" title="${esc(noteList.map(n=>n.title).join('、'))}">${esc(brief)}${more}</span>`);
}
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
<section class="panel panel-pad" style="margin-top:20px"><h2>${icon('file')}${esc(calSelected)}</h2>${detail}<div class="divider-text"><span>提醒事項</span></div>${selNotes.length?selNotes.map(n=>`<div class="cal-note"><span class="cal-event-tag note">提醒</span><div><strong>${esc(n.title)}</strong>${noteMeta(n)?`<p class="field-hint">${esc(noteMeta(n))}</p>`:''}${n.note?`<p class="field-hint">${esc(n.note)}</p>`:''}</div><button class="icon-btn" data-note-del="${n.id}" title="刪除提醒" aria-label="刪除提醒">${icon('trash')}</button></div>`).join(''):'<p class="field-hint">這一天還沒有提醒事項。</p>'}<form id="note-form" style="margin-top:14px"><div class="form-grid"><div class="form-field"><label class="field-label" for="note-title">新增提醒標題</label><input id="note-title" maxlength="120" placeholder="例如：收齊作業、教研會議" required></div><div class="form-field"><label class="field-label" for="note-body">內容（可留空）</label><input id="note-body" maxlength="2000" placeholder="例如：下午三點前完成"></div></div><p class="field-hint">提醒事項只會出現在你自己的日曆，不會顯示給學生或其他教師。</p><p class="error-text" id="note-error"></p><button class="secondary" type="submit">${icon('check')}加入 ${esc(calSelected)} 的提醒</button></form></section></div>`;
$('#cal-prev').onclick=()=>{calCursor=new Date(y,m-1,1);calendarPage();};
$('#cal-next').onclick=()=>{calCursor=new Date(y,m+1,1);calendarPage();};
$('#cal-today').onclick=()=>{calCursor=new Date(now.getFullYear(),now.getMonth(),1);calSelected=calFmt(now);calendarPage();};
$$('[data-cal-date]').forEach(b=>b.onclick=()=>{calSelected=b.dataset.calDate;calendarPage();});
$$('[data-cal-open]').forEach(b=>b.onclick=()=>navigate('homework'));
$$('[data-note-del]').forEach(b=>b.onclick=async()=>{if(await askCancel('刪除這則提醒？'))return;try{await api(`/api/calendar/notes/${b.dataset.noteDel}/delete`,{});toast('提醒已刪除。');calendarPage();}catch(e){toast(e.message);}});
const nf=$('#note-form');
if(nf)nf.onsubmit=async e=>{e.preventDefault();const b=$('button[type=submit]',e.target);b.disabled=true;$('#note-error').textContent='';
try{await api('/api/calendar/notes',{date:calSelected,title:$('#note-title').value.trim(),note:$('#note-body').value.trim()});toast('提醒已加入。');calendarPage();}
catch(err){$('#note-error').textContent=err.message;b.disabled=false;}};
window.scrollTo({top:0});}
function heading(eyebrow,title,sub,actions=''){return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtitle">${sub}</p></div>${actions?`<div class="actions">${actions}</div>`:''}</div>`;}
function metrics(){const s=S.stats, items=[['check','已完成練習',s.completed,'題',S.user?'以已批閱作答計算':'登入後記錄你的每次進步'],['target','練習得分率',s.completed?s.accuracy:'—',s.completed?'%':'',s.completed?`累積 ${s.score} / ${s.maxScore} 分`:'依批閱分數計算 · 非掌握率'],['flame','連續練習',s.streak,'天','每天一小步，理解更深入'],['clock','學習時長估算',s.minutes,'分鐘','依同日提交間隔估算']];return `<div class="metric-row">${items.map(([ic,label,value,unit,foot])=>`<div class="metric"><div class="metric-label">${icon(ic)}${label}</div><div class="metric-value">${value}<small>${unit}</small></div><div class="metric-foot">${foot}</div><div class="metric-spark">${[8,13,11,18,15,22].map(h=>`<i style="height:${h}px"></i>`).join('')}</div></div>`).join('')}</div>`;}
function hero(){return `<section class="hero"><div class="hero-copy"><h2>開始今天的數學練習</h2><p>從一道題開始，逐步累積理解；每一題都對應知識分類，方便日後複習。</p><div class="hero-actions">${S.user?.role==='teacher'?`<button class="primary" data-page="import">匯入試卷，建立校本題庫 ${icon('arrow')}</button><button class="secondary" data-page="bank">瀏覽題庫</button>`:`<button class="primary" data-action="start">開始今日練習 ${icon('arrow')}</button><button class="secondary" data-page="bank">瀏覽題庫</button>`}</div></div><div class="hero-visual" aria-hidden="true"><span class="formula f1">x² − 5x + 6 = 0</span><span class="formula f2">a² + b² = c²</span><svg viewBox="0 0 300 170"><ellipse cx="158" cy="148" rx="94" ry="9" fill="#dce7d2" opacity=".5"/><path d="m75 112 69-19 75 29-70 25Z" fill="#d0dfbe"/><path d="m75 112 74 28v7l-74-28Z" fill="#b4caa4"/><path d="m149 140 70-18v7l-70 18Z" fill="#e4ecd6"/><path d="m84 98 69-18 74 28-69 23Z" fill="#f5f7ec"/><path d="m84 98 74 26v7L84 105Z" fill="#dfe8cd"/><path d="m158 124 69-16v7l-69 16Z" fill="#c6d7b3"/><path d="m85 78 70-20 76 28-70 26Z" fill="#b2cda5"/><path d="m85 78 76 29v5L85 85Z" fill="#8fac88"/><path d="m161 107 70-21v5l-70 21Z" fill="#dce8c8"/><path d="m149 45 52 19-23 52-49-20Z" fill="#fffdf3" stroke="#d6dfc6"/><path d="m138 71 30 11m-34 1 24 9m-20-28 15 5" stroke="#c4d1b8" stroke-width="2"/><path d="m189 35 9 3-24 61-9-3Z" fill="#779c76"/><path d="m165 96 9 3-9 8Z" fill="#e3c7a0"/><path d="m166 104-2 4 4-2" stroke="#557158"/><circle cx="244" cy="44" r="15" fill="#e6edd7"/><path d="M236 44h16m-8-8v16" stroke="#a2b28e"/><path d="m43 78 6-6 6 6-6 6Z" fill="#c9d7b7"/><circle cx="251" cy="124" r="4" fill="#b8c6a3"/><path d="m101 31 3-6 3 6 6 3-6 3-3 6-3-6-6-3Z" fill="#ccd9b8"/></svg></div></section>`;}
function topicStats(t){const a=S.attempts.filter(a=>a.topic===t && a.status==='graded');const max=a.reduce((n,a)=>n+a.maxScore,0);return {n:a.length,value:max?Math.round(100*a.reduce((n,a)=>n+a.score,0)/max):0};}
function knowledge(){return `<section class="panel right-panel"><h2>${icon('growth')}知識點練習表現</h2><p class="panel-sub">以已批閱得分呈現，不等同能力診斷</p>${(()=>{const practiced=topics.map(t=>({t,st:topicStats(t)})).filter(x=>x.st.n>0).sort((a,b)=>a.st.value-b.st.value).slice(0,4);if(!practiced.length)return `<p class="panel-sub" style="margin:0">還沒有已批閱的練習，先做幾題就會顯示你的知識點表現。</p>`;return practiced.map(({t,st})=>`<div class="knowledge-row"><span>${esc(t)}</span><span>${st.value}%</span></div><div class="progress-track"><div class="progress-fill ${st.value<60?'gold':''}" style="width:${st.value}%"></div></div>`).join('');})()}<button class="text-button" data-page="growth" style="font-size:calc(13px*var(--fs))">查看完整學習足跡 ${icon('arrow')}</button></section>`;}
function rightBank(){return `<div class="right-stack"><section class="panel right-panel"><h2>${icon('spark')}練習建議</h2><p class="panel-sub">依同一知識點推薦相似題與進階題</p><div class="roadmap"><div class="roadmap-item active"><span class="roadmap-circle">1</span>理解原題</div><div class="roadmap-item"><span class="roadmap-circle">2</span>相似鞏固</div><div class="roadmap-item"><span class="roadmap-circle">3</span>進階挑戰</div></div><div class="recommendation-mini"><div class="title-row"><span>今日建議</span><span>基礎 · 6 分</span></div><strong>從因式分解開始，<br>一步一步找出二次方程的根。</strong><button class="secondary wide" data-qid="1">進入練習 ${icon('arrow')}</button></div></section>${knowledge()}<section class="panel right-panel tip-panel"><h2>${icon('bulb')}解題小提示</h2><p>寫下你的解題步驟與思路，<br>教師批閱時更容易看出哪裡需要調整。</p><button class="text-button" data-action="hand-demo">試試手寫解題 ${icon('arrow')}</button></section></div>`;}
function filteredQuestions(){
  const list=S.questions.filter(q=>(topic==='全部題目'||q.topic===topic||topic==='我的收藏'&&bookmarks.has(q.id))&&(!subtopic||q.subtopic===subtopic)&&(!grade||q.grade===grade)&&(!level||q.level===Number(level))&&(!qtype||(q.qtype||'解答題')===qtype)&&(!search||`${q.title} ${q.content} ${q.tags.join(' ')} ${q.source} ${q.subtopic||''}`.toLowerCase().includes(search.toLowerCase()))&&(!onlyReview||needsReview(q)));
  if(sortBy==='new'||sortBy==='old'){
    // 有入庫時間就照時間排；舊題目沒記錄時間，退回用 id（id 就是入庫順序）
    const at=q=>q.createdAt||'';
    list.sort((a,b)=>{const x=at(a),y=at(b);
      if(x&&y&&x!==y)return sortBy==='new'?y.localeCompare(x):x.localeCompare(y);
      return sortBy==='new'?b.id-a.id:a.id-b.id;});
  }
  return list;
}
let pickedQuestions=new Set();
let onlyReview=false;   // 題庫只看待核驗的題目（作業端點會擋待核驗，這是補答案後的收尾動作）
const needsReview=q=>/待.*(?:核驗|核验|審核|审核|確認|确认)/.test(`${q.source||''} ${(q.tags||[]).join(' ')}`);
function fmtWhen(iso){
  if(!iso)return '未記錄';
  const d=new Date(iso);if(isNaN(d.getTime()))return '未記錄';
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
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
function questionCard(q,n){return `<article class="question-card">${S.user?.role==='teacher'?`<label class="pick-box"><input type="checkbox" data-pick="${q.id}" ${pickedQuestions.has(q.id)?'checked':''} aria-label="選取第 ${n} 題"></label>`:''}<span class="question-number">${String(n).padStart(2,'0')}</span><div class="question-body"><div class="question-top"><h3>${mathText(q.title)}</h3><span class="badge l${q.level}">${levels[q.level]}</span><span class="badge outline">${esc(q.qtype||'解答題')}</span><span class="badge outline">${q.points} 分</span></div>${stemHtml(q)}<div class="question-meta"><span>${esc(q.tags.slice(0,2).join(' · '))}</span><i class="separator"></i><span>${esc(q.source)}</span>${q.createdAt?`<i class="separator"></i><span>入庫 ${fmtWhen(q.createdAt)}</span>`:''}</div></div><div class="question-controls"><button class="bookmark ${bookmarks.has(q.id)?'saved':''}" data-save="${q.id}" aria-label="${bookmarks.has(q.id)?'取消收藏':'收藏題目'}" aria-pressed="${bookmarks.has(q.id)}">${icon('bookmark')}</button><button class="practice-btn" data-qid="${q.id}">${S.user?.role==='teacher'?'檢視題目':'開始練習'} ${icon('chevron')}</button>${S.user?.role==='teacher'&&needsReview(q)?`<button class="text-button" data-verify="${q.id}" style="font-size:calc(12px*var(--fs));color:#b8453b">核驗通過</button>`:''}${S.user?.role==='teacher'?`<button class="text-button" data-editq="${q.id}" style="font-size:calc(12px*var(--fs))">${icon('edit')}編輯題目</button><button class="text-button ai-gen-entry" data-aigen="${q.id}" style="font-size:calc(12px*var(--fs))">${icon('spark')}AI 生成類似題</button><button class="text-button" data-aifig="${q.id}" style="font-size:calc(12px*var(--fs))">${icon('spark')}${q.figure?'重新生成圖形':'AI 生成圖形'}</button><button class="text-button" data-aifig-manual="${q.id}" style="font-size:calc(12px*var(--fs))">${icon('upload')}手動插入圖形</button>${q.figure?`<button class="text-button" data-aifig-clear="${q.id}" style="font-size:calc(12px*var(--fs))">移除圖形</button>`:''}`:''}</div></article>`;}
function bank(){beginView();page='bank';assignmentContext=null;mockContext=null;stopQuizClock();shell();
const missingAnswers=S.user?.role==='teacher'?S.questions.filter(q=>!(q.answer||'').trim()).length:0;
const missingReview=S.user?.role==='teacher'?S.questions.filter(needsReview).length:0;
pickedQuestions.clear();$('#main').innerHTML=`<div class="fade-in">${heading('QUESTION BANK','數學題庫','依知識分類收錄的題目；可搜尋、篩選，教師可核對答案並匯入作業。',`<button class="secondary" data-action="collection">${icon('bookmark')}我的收藏</button>${S.user?.role==='teacher'?`${missingAnswers?`<button class="secondary" id="ai-fill-answers">${icon('spark')}AI 補答案（${missingAnswers} 題）</button>`:''}<button class="secondary" data-page="newq">${icon('plus')}新增題目</button><button class="secondary" id="export-latex">${icon('file')}匯出 LaTeX</button><button class="secondary" id="export-questions">${icon('download')}匯出 CSV</button>`:''}<button class="primary" data-page="import">${icon('upload')}匯入試卷</button>`)}${!S.user?`<div class="field-hint" style="margin:-9px 0 17px">訪客預覽 · 以下為題庫示例，學習紀錄尚未開始。<button class="text-button" data-action="login" style="font-size:calc(13px*var(--fs));margin-left:8px">登入學習 ${icon('arrow')}</button></div>`:''}${hero()}${metrics()}<div class="bank-layout"><section class="panel bank-panel"><div class="panel-heading"><h2>精選題目 <span class="small-text" id="question-count"></span></h2><div class="segmented"><button data-view="list" class="${viewMode==='list'?'active':''}" aria-label="清單檢視">${icon('list')}</button><button data-view="grid" class="${viewMode==='grid'?'active':''}" aria-label="卡片檢視">${icon('bank')}</button></div></div><div class="filters"><label class="search-field">${icon('search')}<input id="question-search" value="${esc(search)}" placeholder="搜尋題目、知識點或試卷名稱…" aria-label="搜尋题目"></label><select id="grade-filter" aria-label="年級"><option value="">所有年級</option>${grades.map(g=>`<option ${grade===g?'selected':''}>${g}</option>`).join('')}</select><select id="level-filter" aria-label="難度"><option value="">所有難度</option>${[1,2,3].map(i=>`<option value="${i}" ${Number(level)===i?'selected':''}>${levels[i]}</option>`).join('')}</select><select id="qtype-filter" aria-label="題型"><option value="">所有題型</option>${qtypes.map(t=>`<option ${qtype===t?'selected':''}>${t}</option>`).join('')}</select>${S.user?.role==='teacher'&&missingReview?`<button class="topic-tab ${onlyReview?'active':''}" id="review-chip" aria-pressed="${onlyReview}">待核驗 ${missingReview}</button>`:''}<select id="sort-filter" aria-label="排序"><option value="">預設排序</option><option value="new" ${sortBy==='new'?'selected':''}>最新入庫</option><option value="old" ${sortBy==='old'?'selected':''}>最舊入庫</option></select></div><div class="filters"><select id="topic-filter" aria-label="分類">${['全部題目',...topics,'我的收藏'].map(t=>`<option ${topic===t?'selected':''}>${esc(t)}</option>`).join('')}</select>${subtopicsOf(topic).length?`<select id="subtopic-filter" aria-label="子分類">${['全部子分類',...subtopicsOf(topic)].map(sb=>`<option ${subtopic===sb?'selected':''}>${esc(sb)}</option>`).join('')}</select>`:''}</div><div class="pick-bar" id="pick-bar" hidden><span id="pick-count"></span><button class="primary" id="pick-build">組成試卷</button><button class="secondary" id="pick-verify" hidden>核驗已選</button><button class="secondary" id="pick-edit">批次修改</button><button class="text-button" id="pick-delete" style="color:#b8453b">刪除</button><button class="secondary" id="pick-clear">清除</button></div><div class="question-list ${viewMode}" id="question-list"></div><div class="pagination" id="pagination"></div></section>${rightBank()}</div></div>`;renderList();
const pendingPicked=()=>[...pickedQuestions].filter(id=>{const q=S.questions.find(x=>x.id===id);return q&&needsReview(q);});
const syncPickBar=()=>{
  const bar=$('#pick-bar');if(!bar)return;
  bar.hidden=pickedQuestions.size===0;
  const c=$('#pick-count');if(c)c.textContent=`已選 ${pickedQuestions.size} 題`;
  const v=$('#pick-verify');
  if(v){const n=pendingPicked().length;v.hidden=n===0;v.textContent=`核驗已選（${n}）`;}
};
syncPickBar();
$('#question-list').addEventListener('change',e=>{
  const box=e.target.closest('[data-pick]');if(!box)return;
  const id=Number(box.dataset.pick);
  if(box.checked)pickedQuestions.add(id);else pickedQuestions.delete(id);
  syncPickBar();
});
$('#pick-clear').onclick=()=>{pickedQuestions.clear();renderList();syncPickBar();};
$('#pick-build').onclick=()=>buildPaperModal();
$('#pick-edit').onclick=()=>bulkEditModal();
$('#pick-verify').onclick=async()=>{
  const ids=pendingPicked();
  if(!ids.length)return toast('選的題目都核驗過了。');
  const btn=$('#pick-verify');const old=btn.textContent;btn.disabled=true;btn.textContent='核驗中…';
  try{
    const res=await api('/api/questions/verify',{ids});
    pickedQuestions.clear();
    toast(`已核驗 ${res.verified.length} 題，可以出作業了`);
    await refresh().catch(()=>{});
    bank();
  }catch(e){toast(e.message);btn.disabled=false;btn.textContent=old;}
};
const reviewChip=$('#review-chip');
if(reviewChip)reviewChip.onclick=()=>{onlyReview=!onlyReview;bank();};
$('#pick-delete').onclick=()=>bulkDeleteQuestions();
$('#question-search').addEventListener('input',e=>{search=e.target.value;currentPage=1;renderList();});$('#grade-filter').addEventListener('change',e=>{grade=e.target.value;currentPage=1;renderList();});$('#level-filter').addEventListener('change',e=>{level=e.target.value;currentPage=1;renderList();});$('#qtype-filter').addEventListener('change',e=>{qtype=e.target.value;currentPage=1;renderList();});$('#sort-filter').addEventListener('change',e=>{sortBy=e.target.value;currentPage=1;renderList();});
$('#topic-filter').addEventListener('change',e=>{topic=e.target.value;subtopic='';currentPage=1;bank();});
const subFilter=$('#subtopic-filter');
if(subFilter)subFilter.addEventListener('change',e=>{subtopic=e.target.value;currentPage=1;renderList();});const fillBtn=$('#ai-fill-answers');
if(fillBtn)fillBtn.onclick=async()=>{
  const ids=S.questions.filter(q=>!(q.answer||'').trim()).map(q=>q.id);
  if(!ids.length)return toast('題庫裡的題目都有答案了。');
  if(await askCancel(`要讓 AI 逐題解這 ${ids.length} 題，把答案、詳解與評分標準填進去嗎？\n（每批 5 題，共 ${Math.ceil(ids.length/5)} 次模型呼叫；已經有答案的題目不會被覆蓋。）`))return;
  const old=fillBtn.textContent;fillBtn.disabled=true;
  let done=0,failed=0;
  for(let i=0;i<ids.length;i+=5){
    fillBtn.textContent=`解題中… ${done}/${ids.length}`;
    try{
      const res=await api('/api/questions/solve',{ids:ids.slice(i,i+5),consentExternal:S.ai.mode==='external'});
      done+=res.solved.length;failed+=res.failed.length;
    }catch(e){toast(e.message);break;}
  }
  fillBtn.textContent=old;fillBtn.disabled=false;
  toast(`AI 已補 ${done} 題${failed?`，${failed} 題沒補成功`:''}`);
  await refresh().catch(()=>{});
  bank();
};
const lb=$('#export-latex');if(lb)lb.onclick=exportLatexDialog;const eq=$('#export-questions');if(eq)eq.onclick=exportQuestionsCsv;}
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
// ── 站內確認框（取代 window.confirm / window.prompt）──────────────
// 內嵌預覽的 iframe 會封鎖原生對話框：confirm() 靜靜回 false、prompt() 回 null，
// 按下去看起來「完全沒有反應」。所以全部改用站內 modal，回傳 Promise。
let askSeq = 0;
function askDialog(opts) {
  const o = opts || {};
  return new Promise(resolve => {
    const id = `ask-${++askSeq}`;
    const message = o.message
      ? `<p class="ask-message">${esc(o.message).replace(/\n/g, '<br>')}</p>` : '';
    const field = o.input
      ? `<div class="form-field"><label class="field-label" for="${id}-in">${esc(o.label || '內容')}</label>
           <input id="${id}-in" value="${esc(o.value || '')}" placeholder="${esc(o.placeholder || '')}"
                  maxlength="${Number(o.maxlength) || 200}"></div>`
      : '';
    // opts.root：要疊在哪一層。在一個大視窗（例如一鍵生成試卷）裡問「確定嗎？」時，
    // 傳 '#modal-root-2' 才不會把底下的視窗換掉——否則一按確定，整個表單就消失了。
    const rootSel = o.root || '#modal-root';
    modal(`<p class="eyebrow">請確認</p><h2>${esc(o.title || '請確認')}</h2>${message}${field}
      <div class="ask-actions">
        <button class="text-button" id="${id}-no">${esc(o.cancelText || '取消')}</button>
        <button class="${o.danger ? 'danger' : 'primary'}" id="${id}-yes">${esc(o.confirmText || '確定')}</button>
      </div>`, false, true, rootSel);
    const root = modalRootEl(rootSel);
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      obs.disconnect();
      closeModal();
      resolve(value);
    };
    // 使用者按 Esc 或點背景關掉時，modal 會被移除 —— 這裡補回「取消」。
    const obs = new MutationObserver(() => { if (!root.children.length) finish(o.input ? null : false); });
    obs.observe(root, { childList: true });
    $(`#${id}-no`).onclick = () => finish(o.input ? null : false);
    $(`#${id}-yes`).onclick = () => finish(o.input ? String($(`#${id}-in`).value || '') : true);
    if (o.input) {
      const input = $(`#${id}-in`);
      input.focus();
      input.select();
      input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); finish(String(input.value || '')); } };
    }
  });
}
// askConfirm('訊息') → Promise<boolean>；askPrompt('標題', 預設值) → Promise<string|null>
function askConfirm(message, opts) {
  return askDialog({ ...(opts || {}), title: (opts && opts.title) || '請確認', message });
}
function askPrompt(label, value, opts) {
  return askDialog({ ...(opts || {}), input: true, title: label,
                     label: (opts && opts.label) || '內容', value });
}
// askCancel：原本寫 `!confirm(...)` 的地方用它 —— 使用者按取消／關掉時回 true。
// 這樣替換時不用改括號結構（`!await askConfirm()` 是語法錯誤）。
function askCancel(message, opts) {
  return askConfirm(message, opts).then(ok => !ok);
}
// 姓名一存入資料庫就遮蔽（陳大文 → 陳X文），全名不留；這件事只提醒一次，
// 之後用 localStorage 記住，免得每次匯入都被攔一次。
const NAME_MASK_ACK = 'mathpath_name_mask_ack';
async function askNameMask() {
  try { if (localStorage.getItem(NAME_MASK_ACK) === '1') return true; } catch (e) {}
  const ok = await askConfirm(
    '為保護學生隱私，姓名在存入資料庫時就會遮蔽（例：陳大文 → 陳X文、歐陽修文 → 歐XX文），'
    + '全名不會保留，之後也無法還原。\n\n建議先自行保留一份原始名單。',
    { title: '姓名會以遮蔽形式存入', confirmText: '了解，繼續', cancelText: '取消' });
  if (ok) { try { localStorage.setItem(NAME_MASK_ACK, '1'); } catch (e) {} }
  return ok;
}

// 視窗可以疊：一鍵生成的「確認題目」上面要能再開「題目圖形」工作室。
// 每一層用自己的容器，關掉上層就回到下層，不會把整份卷的預覽弄丟。
let modalStack=['#modal-root'];
function modalRootEl(sel){
  let host=$(sel);
  if(!host){
    host=document.createElement('div');
    host.id=sel.slice(1);
    host.className='modal-layer';
    document.body.appendChild(host);
  }
  return host;
}
function modal(html,large=false,dismiss=true,rootSel='#modal-root'){
  // large 可以是 true（一般大視窗）或直接給 class 字串（例如 'large gen-modal'）。
  const size=typeof large==='string'?large:(large?'large':'');
  if(!$('.modal'))modalReturnFocus=document.activeElement;
  const titleId=`modal-title-${++modalSeq}`;
  const host=modalRootEl(rootSel);
  if(!modalStack.includes(rootSel))modalStack.push(rootSel);
  host.innerHTML=`<div class="modal-backdrop"><section class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1">${dismiss?`<button class="icon-btn modal-close" data-action="close-modal" aria-label="關閉">×</button>`:''}${html}</section></div>`;
  const dialog=$('.modal',host),title=$('h2',dialog);
  if(title){title.id=titleId;title.tabIndex=-1;title.focus();}else{dialog.removeAttribute('aria-labelledby');dialog.setAttribute('aria-label','操作視窗');dialog.focus();}
  host.onkeydown=e=>{
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
function closeModal(){const prev=modalReturnFocus;modalReturnFocus=null;figStudio=null;
  // 只關最上面那一層；下面那層（例如確認題目）原樣留著。
  const sel=modalStack.length?modalStack.pop():'#modal-root';
  const host=$(sel);
  if(host){host.innerHTML='';host.onkeydown=null;if(sel!=='#modal-root')host.remove();}
  if(!modalStack.length)modalStack=['#modal-root'];
  if(prev?.isConnected)prev.focus();else $('#main').focus();
  // 生成完的卷已經存進資料庫；離開視窗就重讀列表，不要讓老師看到舊清單。
  if(papersStale){papersStale=false;if(page==='papers'){paperPage=1;paperFilter={q:'',year:'',grade:'',term:''};papersPage();window.scrollTo({top:0,behavior:'smooth'});}}}
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
function loginModal(after){const lastUser=(()=>{try{return localStorage.getItem('mathpath_last_user')||''}catch(_){return ''}})();modal(`<div class="login-brand"><span class="brand-symbol">m<span>↗</span></span>MathPath</div><h2>登入學習空間</h2><p class="modal-intro">先選擇身分，再輸入密碼。系統會記住你的帳戶，下次開啟不必重新輸入。</p><div class="role-cards"><button type="button" data-role="student" class="role-card active"><span class="role-card-icon">${icon('practice')}</span><strong>學生</strong><small>領取作業、手寫或打字解題、查看自己的分數與建議</small></button><button type="button" data-role="teacher" class="role-card"><span class="role-card-icon">${icon('import')}</span><strong>教師</strong><small>佈置作業與測驗、批閱、查看全班成績</small></button></div><form id="login-form"><div class="form-field"><label class="field-label" for="username">校內帳戶</label><input id="username" name="username" autocomplete="username" value="${esc(lastUser||'student')}" required maxlength="64">${lastUser?`<p class="field-hint login-remembered">已記住上次登入的帳戶：<strong>${esc(lastUser)}</strong></p>`:''}</div><div class="form-field"><label class="field-label" for="password">密碼</label><input id="password" type="password" name="password" autocomplete="current-password" placeholder="輸入帳戶密碼" required maxlength="256"></div><label class="checkbox-line remember-line login-remember"><input type="checkbox" id="remember" checked><span><strong>記住我（30 天）</strong><small>下次開啟不必重新登入；公用電腦請取消勾選。</small></span></label><p class="error-text" id="login-error" role="alert"></p><button type="submit" class="primary wide login-submit">登入學習空間 ${icon('arrow')}</button></form>${demoAccountsHtml()}`);if(serverDemo===null)loadServerDemo();$$('[data-role]').forEach(b=>b.onclick=()=>{$$('[data-role]').forEach(x=>x.classList.toggle('active',x===b));$('#username').value=b.dataset.role;$('#password').value='';$('#password').focus();});$$('[data-role]').forEach(x=>x.classList.toggle('active',x.dataset.role===(lastUser==='teacher'?'teacher':'student')));$('#login-form').onsubmit=async e=>{e.preventDefault();const btn=$('button[type="submit"]',e.target);btn.disabled=true;$('#login-error').textContent='';const uname=$('#username').value;try{const logged=await api('/api/login',{username:uname,password:$('#password').value,remember:$('#remember').checked});try{localStorage.setItem('mathpath_last_user',uname);}catch(_){}await refresh();closeModal();toast(logged&&logged.dailyCoins?`已登入，今日登入 +${logged.dailyCoins} 枚金幣！`:'已登入，學習紀錄已準備就緒。');if(after)after();else navigate('homework');/* 登入後直接到作業頁：學生先知道有沒有作業要交，教師先看批閱 */}catch(err){$('#login-error').textContent=err.message;}finally{btn.disabled=false;}};if(serverIssue){const box=$('#login-error');if(box)box.textContent=serverIssue;}}
function accountModal(){if(!S.user)return loginModal();modal(`<h2>${esc(S.user.name)}</h2><p class="modal-intro">${S.user.role==='teacher'?'教師工作空間':'中三數學學習空間'} · 資料保存在網站伺服器；實際位置由管理員確認</p>${S.notice?`<div class="import-warning">${esc(S.notice)}</div>`:''}<div class="result-actions"><button class="secondary" id="password-link">${icon('lock')}更換密碼</button><button class="secondary" id="logout-btn">${icon('logout')}登出</button></div>`);$('#password-link').onclick=()=>{closeModal();navigate('settings');};$('#logout-btn').onclick=async()=>{beginView();stopQuizClock();pendingQuizSubmission=null;quizDeadlines.clear();try{await api('/api/logout',{});clearUserDrafts(S.user.id);S={user:null,questions:preview,attempts:[],stats:{completed:0,accuracy:0,streak:0,minutes:0},ai:{configured:false,mode:'off'}};strokes=[];answerFile=null;lastResult=null;lastSolution=null;currentQuestion=null;assignmentContext=null;assignmentDetail=null;HW=null;resultData=null;closeModal();loadBookmarks();homeworkPage();toast('已登出。');}catch(e){toast(e.message);}};}
async function openQuestion(id){if(busy)return toast('正在保存作答，請等待完成。');preserveDraft();if(!S.user){loginModal(()=>openQuestion(id));return;}const q=S.questions.find(q=>q.id===Number(id));if(!q)return toast('找不到題目，請重新整理題庫。');if(currentQuestion&&currentQuestion.id!==q.id&&strokes.length&&!lastResult&&await askCancel('目前手寫內容尚未提交，確定切換題目？'))return;assignmentContext=null;mockContext=null;currentQuestion=q;lastResult=null;lastSolution=null;answerMode=(q.options&&q.options.length)?'choice':'hand';answerFile=null;selectedOption=null;window.answerTextDraft='';strokes=[];redoStrokes=[];recommendations=null;stopQuizClock();practice();const target=viewTarget();try{const rec=await api(`/api/questions/${q.id}/recommendations`);if(viewMatches(target)){recommendations=rec;renderRecommendations();}}catch(e){if(viewMatches(target))toast(e.message);}}
