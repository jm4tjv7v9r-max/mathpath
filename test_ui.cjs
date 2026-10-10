const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
function makePng(w,h){
  const crcTable=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;return c>>>0;});
  const crc=buf=>{let c=0xffffffff;for(const b of buf)c=crcTable[(c^b)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const cr=Buffer.alloc(4);cr.writeUInt32BE(crc(td));return Buffer.concat([len,td,cr]);};
  const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){for(let x=0;x<w;x++){const o=y*(w*3+1)+1+x*3;raw[o]=238;raw[o+1]=244;raw[o+2]=238;}}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const HANDWRITING=makePng(400,300);
(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true,args:['--disable-features=Rlz','--disable-background-networking','--disable-breakpad','--no-first-run','--no-default-browser-check']});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.emulateMedia({reducedMotion:'reduce'});
  let role=null;
  const q={id:1,title:'因式分解解二次方程',content:'解方程 $x^2-5x+6=0$。',topic:'一元二次方程',grade:'中三',points:6,level:1,qtype:'選擇題',source:'校本題庫',tags:['因式分解'],hint:'利用零乘積性質。',answer:'C',options:['$x=1$ 或 $x=6$','$x=-2$ 或 $x=-3$','$x=2$ 或 $x=3$','$x=1$ 或 $x=-6$'],steps:['分解為 $(x-2)(x-3)=0$。','概率為 $\\dfrac{1}{3}$，長度 $5\\text{ cm}$。']};
  const ai={configured:true,mode:'local',model:'test-vision'};
  const advice={source:'rules',strength:'本次一元二次方程已評分：6/6分。',focus:'推導步驟尚未批閱。',nextStep:'再做同知識點相似題。',recommended:[],notice:'測試資料，非真實成績。'};
  const assignment={id:1,title:'二次方程鞏固作業',classId:1,className:'中三甲班',questionCount:1,totalPoints:6,studentCount:2,submittedCount:0,gradedCount:0,dueAt:'2099-01-01T15:59:00Z',myStatus:'not_started',myScore:null,myConfirmedScore:null};
  const quizAssignment={id:2,title:'一元二次方程模擬測驗',kind:'quiz',durationMinutes:30,classId:1,className:'中三甲班',questionCount:1,totalPoints:6,studentCount:2,submittedCount:0,gradedCount:0,dueAt:'2099-01-01T15:59:00Z',myStatus:'not_started',myScore:null,myConfirmedScore:null};
  const student={id:1,name:'介面測試學生',username:'student',status:'not_started',answeredCount:0,pendingCount:0,score:null,totalPoints:6,scoredPoints:0,confirmedScore:null,confirmedCount:0,aiScore:null,ruleScore:null,suggestion:advice};
  const stamp='2026-10-08T08:00:00Z';
  const graded=(id,questionId,topic,score,maxScore)=>({id,questionId,questionTitle:'測試題',topic,score,maxScore,status:'graded',feedback:'規則評分。',submittedAt:stamp,answerText:'x=2或3',gradingMethod:'rule-final',steps:[],teacherReviewed:false});
  const handwritten={id:9,questionId:1,questionTitle:'因式分解解二次方程',topic:'一元二次方程',score:null,maxScore:6,status:'pending',feedback:'手寫圖片尚未批閱，等待教師評分。',submittedAt:stamp,answerText:'',gradingMethod:'pending-teacher',steps:[],teacherReviewed:false,image:'/api/attempts/9/image',student:{id:1,name:'介面測試學生',username:'student'},suggestion:advice};
  let annotated=false,studentSubmitted=false,aiMarked=false,aiAdjusted=null,autoImported=null,parsedSeen=null,savedKeySeen=null,aiConfigSaved=null,economySent=null,correction=null,returned=null,rememberSent=null,importedQuestions=null;
  let mockStarted=null,mockState=null,mockAttempt=null,mockAttemptBody=null;
  let calendarNotes=[],noteCreated=null;
  const mockQuestion={id:11,title:'模擬題：直角三角形',content:'直角三角形兩邊長為3 cm及4 cm，求斜邊長。',topic:'幾何',level:1,grade:'中三',points:5,qtype:'解答題',hint:'用畢氏定理',source:'校本題庫',tags:['幾何']};
  const mockExam=()=>({id:7,topic:mockStarted&&mockStarted.topic||'幾何',level:null,qtype:'解答題',minutes:mockStarted?mockStarted.minutes:15,questionCount:1,createdAt:stamp,startedAt:stamp,expiresAt:stamp,submittedAt:mockState&&mockState.submitted?stamp:null,expired:false,status:mockState&&mockState.submitted?'submitted':'in_progress',remainingSeconds:mockState&&mockState.submitted?0:(mockStarted?mockStarted.minutes*60:900)});
  const mockReport=()=>({score:5,maxScore:5,percent:100,totalScoredPoints:5,pendingCount:0,confirmedScore:null,confirmedCount:0,aiScore:null,ruleScore:5,topicStats:[{topic:'幾何',scoredCount:1,totalCount:1,score:5,maxScore:5,percent:100}],suggestion:advice,answeredCount:1});
  let quizStarted=false,quizSubmitted=false,quizStartSeen=0,durationSent=null;
  const quizReport=()=>({score:quizSubmitted?6:null,maxScore:6,totalScoredPoints:quizSubmitted?6:0,pendingCount:0,confirmedScore:null,confirmedCount:0,gradedCount:quizSubmitted?1:0,questionCount:1,percent:quizSubmitted?100:null,aiScore:null,ruleScore:quizSubmitted?6:null,topicStats:[],suggestion:advice});
  const quizSub=()=>({status:quizSubmitted?'submitted':'not_started',submittedAt:quizSubmitted?stamp:null,resubmittedAt:null,submitCount:quizSubmitted?1:0,late:false,correction:null,startedAt:quizStarted?stamp:null,expiresAt:quizStarted?'2099-01-01T00:30:00Z':null,remainingSeconds:quizStarted?1800:null,timeUsedSeconds:quizStarted?0:null,expired:false});
  const AI_ISSUE={x:0.3,y:0.4,label:'符號錯誤',comment:'這裡應為負號'};
  const attemptFixture=()=>({...handwritten,...(annotated?{annotation:'/api/attempts/9/annotation',annotationAt:stamp}:{}),...(aiMarked?{aiAnnotation:{issues:aiAdjusted?aiAdjusted.issues:[AI_ISSUE],summary:aiAdjusted?aiAdjusted.summary:'主要在符號處理',...(aiAdjusted?{adjusted:true}:{}),at:stamp}}:{})});
  await page.route('https://mathpath.test/**',async route=>{
    const url=new URL(route.request().url());let data;
    if(url.pathname==='/'){return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'index.html'),'utf8')});}
    if(['/app.js','/styles.css'].includes(url.pathname))return route.fulfill({contentType:url.pathname.endsWith('js')?'application/javascript':'text/css',body:fs.readFileSync(path.join(__dirname,url.pathname.slice(1)),'utf8')});
    if(url.pathname.startsWith('/vendor/katex/')){const rel=url.pathname.slice(1);const mime=rel.endsWith('.js')?'application/javascript':rel.endsWith('.css')?'text/css':rel.endsWith('.woff2')?'font/woff2':'application/octet-stream';return route.fulfill({contentType:mime,body:fs.readFileSync(path.join(__dirname,rel))});}
    if(url.pathname.startsWith('/vendor/katex/')){const rel=url.pathname.slice(1);const mime=rel.endsWith('.js')?'application/javascript':rel.endsWith('.css')?'text/css':rel.endsWith('.woff2')?'font/woff2':'application/octet-stream';return route.fulfill({contentType:mime,body:fs.readFileSync(path.join(__dirname,rel))});}
    if(url.pathname==='/api/attempts/9/image')return route.fulfill({contentType:'image/png',body:HANDWRITING});
    if(url.pathname==='/api/calendar/notes'&&route.request().method()==='POST'){noteCreated=route.request().postDataJSON();const created={id:41,date:noteCreated.date,title:noteCreated.title,note:noteCreated.note||'',kind:'reminder',createdAt:stamp};calendarNotes=calendarNotes.concat([created]);return route.fulfill({json:{note:created}});}
    if(url.pathname==='/api/calendar/notes/41/delete'){calendarNotes=calendarNotes.filter(n=>n.id!==41);return route.fulfill({json:{deleted:41}});}
    if(url.pathname==='/api/mock'&&route.request().method()==='GET'){return route.fulfill({json:{exams:mockState&&mockState.submitted?[{id:7,topic:'幾何',level:1,qtype:'解答題',minutes:15,questionCount:1,createdAt:stamp,startedAt:stamp,expiresAt:stamp,submittedAt:stamp,expired:false,status:'submitted',score:5,maxScore:5,percent:100,pendingCount:0}]:[],options:{topics:['幾何','代數','統計'],subtopics:{'幾何':['勾股定理','相似'],'代數':['一元一次方程']},counts:[5,10,15,20],minutes:[5,10,15,20,30,45,60],maxQuestions:20,maxMinutes:180,available:16,qtypes:['解答題']},ai}});}
    if(url.pathname==='/api/mock'&&route.request().method()==='POST'){mockStarted=route.request().postDataJSON();mockState={submitted:false};return route.fulfill({json:{exam:mockExam(),questions:[mockQuestion],notice:'已開始計時。'}});}
    if(url.pathname==='/api/mock/7'&&route.request().method()==='GET'){return route.fulfill({json:{exam:mockExam(),questions:[mockQuestion],attempts:mockAttempt?[mockAttempt]:[],report:mockState&&mockState.submitted?mockReport():null,notice:'只供你本人查看。'}});}
    if(url.pathname==='/api/mock/7/submit'){mockState={submitted:true};return route.fulfill({json:{exam:mockExam(),report:mockReport(),notice:'已提交並即時計分。'}});}
    if(url.pathname==='/api/attempts'&&route.request().method()==='POST'){mockAttemptBody=route.request().postDataJSON();mockAttempt={id:31,questionId:11,questionTitle:'模擬題：直角三角形',topic:'幾何',score:5,maxScore:5,status:'graded',feedback:'規則評分：最終答案與參考答案嚴格等價。',submittedAt:stamp,answerText:'5 cm',gradingMethod:'rule-final',steps:[],teacherReviewed:false,mockId:7,suggestion:advice};return route.fulfill({json:{attempt:mockAttempt}});}
    if(url.pathname==='/api/attempts/9/ai-annotation'){
      const body=route.request().postDataJSON();
      if(body.marks){
        assert.ok(Array.isArray(body.marks.issues)&&body.marks.issues.length===1,'教師調整須送出完整標記');
        for(const it of body.marks.issues)assert.ok(it.x>=0&&it.x<=1&&it.y>=0&&it.y<=1,'調整後座標須在0至1之間');
        aiAdjusted=body.marks;aiMarked=true;
        return route.fulfill({json:{attempt:attemptFixture()}});
      }
      assert.notEqual(body.consentExternal,undefined,'前端必須帶上外部傳送同意欄位');
      aiMarked=!body.clear;if(body.clear)aiAdjusted=null;
      return route.fulfill({json:{attempt:attemptFixture()}});
    }
    if(url.pathname==='/api/attempts/9/annotation'&&route.request().method()==='POST'){const sent=route.request().postDataJSON();assert.ok(sent.image.startsWith('data:image/png;base64,'),'批註必須以 PNG 儲存');assert.ok(sent.image.length>2000,'批註圖應包含手稿與筆跡');annotated=true;return route.fulfill({json:{attempt:attemptFixture()}});}
    const user=role?{id:role==='teacher'?2:1,name:role==='teacher'?'介面測試教師':'介面測試學生',role}:null;
    if(url.pathname==='/api/session')data={user};
    else if(url.pathname==='/api/login'){const sent=route.request().postDataJSON();role=sent.username;rememberSent=sent.remember;data={user:{id:role==='teacher'?2:1,name:'介面測試',role}};}
    else if(url.pathname==='/api/logout'){role=null;data={user:null};}
    else if(url.pathname==='/api/state')data={user,questions:[role==='teacher'?q:{...q,answer:undefined,steps:undefined}],attempts:role==='teacher'?[]:[graded(1,1,'一元二次方程',6,6),graded(2,2,'幾何',0,5)],stats:{completed:2,accuracy:55,streak:1,minutes:10},ai,topics:['一元二次方程','幾何']};
    else if(url.pathname==='/api/homework')data={classes:[{id:1,name:'中三甲班',studentCount:2,studentIds:[1,3]}],assignments:[assignment,quizAssignment],students:role==='teacher'?[student]:undefined,ai};
    else if(url.pathname==='/api/ai-config'&&route.request().method()==='POST'){const sent=route.request().postDataJSON();savedKeySeen=sent.apiKey??null;aiConfigSaved=sent;const off=!sent.baseUrl&&!sent.model;return route.fulfill({json:{active:{configured:!off,model:off?'':'local-text',vision:off?'':'local-vision',mode:off?'off':'local',source:off?'none':'saved'},saved:off?null:{baseUrl:sent.baseUrl,model:sent.model,visionModel:sent.visionModel,keySet:true}}});}
    else if(url.pathname==='/api/ai-config/economy'){const sent=route.request().postDataJSON();economySent=sent.economy;return route.fulfill({json:{active:{configured:true,model:'local-text',vision:'',mode:'local',source:'env',thinking:!sent.economy},economy:sent.economy}});}
    else if(url.pathname==='/api/ai-config/test'){const sent=route.request().postDataJSON();if(!sent.baseUrl||!sent.model)return route.fulfill({status:400,json:{error:'請提供端點與模型。'}});return route.fulfill({json:{ok:true,mode:'local',model:sent.model,testedVision:!!sent.vision}});}
    else if(url.pathname==='/api/ai-config')data={active:{configured:!!aiConfigSaved,model:aiConfigSaved?'local-text':'',vision:aiConfigSaved?'local-vision':'',mode:aiConfigSaved?'local':'off',source:aiConfigSaved?'saved':'none'},canEdit:true,tokenRequired:false,invalidSaved:false,env:{baseUrl:'',model:'',visionModel:'',keySet:false},saved:aiConfigSaved?{baseUrl:aiConfigSaved.baseUrl,model:aiConfigSaved.model,visionModel:aiConfigSaved.visionModel,keySet:true}:null};
    else if(url.pathname==='/api/calendar'){const from=url.searchParams.get('from')||'';const pre=from.slice(0,8);const teacher=role==='teacher';
      data={from,to:url.searchParams.get('to'),events:[
        {date:`${pre}15`,event:'due',kind:'homework',title:'二次方程鞏固作業',assignmentId:1,classId:1,className:'中三甲班',dueAt:stamp,...(teacher?{submittedCount:1,studentCount:2}:{myStatus:'not_started'})},
        {date:`${pre}20`,event:'published',kind:'quiz',title:'一元二次方程測驗',assignmentId:2,classId:1,className:'中三甲班',dueAt:stamp,...(teacher?{submittedCount:0,studentCount:2}:{myStatus:'not_started'})}
      ],notes:calendarNotes};}
    else if(url.pathname==='/api/papers/parse'){parsedSeen=route.request().postDataJSON();data={method:'規則拆題',notice:'需要教師確認題目內容、分類、難度、分值和參考答案後才可匯入；識別不代表答案已核驗。',drafts:[{title:'自動卷 · 第1題',content:'已知集合 $A=\\{x\\mid -1<x\\le 3\\}$，求元素個數。',topic:'代數',subtopic:'',level:1,grade:'中三',qtype:'選擇題',points:6,answer:'$3$',steps:['元素為 $0,1,2,3$。'],hint:'數一數。',analysis:'規則分析：題型為選擇題，知識點為代數；參考答案留空，需教師核對。',source:'自動卷',tags:['教師待確認']}]};}
    else if(url.pathname==='/api/papers/auto-import'){autoImported=route.request().postDataJSON();return route.fulfill({json:{count:2,method:'規則拆題',questions:[],notice:'已全自動拆分並匯入題庫，全部標示為「自動匯入 · 待核驗」；請在題庫核對題型、分類與參考答案。'}});}
    else if(url.pathname==='/api/assignments/2/start'){quizStartSeen++;quizStarted=true;return route.fulfill({json:{mySubmission:quizSub()}});}
    else if(url.pathname==='/api/assignments/2/submit'){quizSubmitted=true;return route.fulfill({json:{report:{score:6,maxScore:6,totalScoredPoints:6,pendingCount:0,confirmedScore:null,confirmedCount:0,gradedCount:1,questionCount:1,percent:100,aiScore:null,ruleScore:6,topicStats:[],suggestion:advice},mySubmission:quizSub()}});}
    else if(url.pathname==='/api/assignments/2')data={assignment:quizAssignment,questions:[q],attempts:quizStarted?[graded(21,1,'一元二次方程',6,6)]:[],mySubmission:quizSub(),report:quizReport()};
    else if(url.pathname==='/api/assignments'&&route.request().method()==='POST'){durationSent=route.request().postDataJSON();return route.fulfill({json:{assignment:quizAssignment}});}
    else if(url.pathname==='/api/questions/import'){importedQuestions=route.request().postDataJSON().questions;return route.fulfill({json:{count:importedQuestions.length}});}
    else if(url.pathname==='/api/users')data={users:[{id:1,username:'student',name:'介面測試學生',role:'student'}]};
    else if(url.pathname==='/api/users/bulk')data={count:2,users:[{id:5,username:'s3a01',name:'陳大文',role:'student'},{id:6,username:'s3a02',name:'李小美',role:'student'}]};
    else if(url.pathname==='/api/classes')data={class:{id:2,name:route.request().postDataJSON().name,studentCount:2,studentIds:[5,6]}};
    else if(url.pathname==='/api/questions/1/recommendations')data={similar:[],advanced:[]};
    else if(url.pathname==='/api/assignments/1/return'){returned=route.request().postDataJSON();correction={round:1,note:returned.note,requestedAt:stamp,questionIds:returned.questionIds,minAttemptId:9};return route.fulfill({json:{correction,report:{score:6,maxScore:6,totalScoredPoints:6,pendingCount:0,confirmedScore:null,confirmedCount:0,topicStats:[],suggestion:advice}}});}
    else if(url.pathname==='/api/assignments/1/submit'){correction=null;studentSubmitted=true;return route.fulfill({json:{report:{score:12,maxScore:12,totalScoredPoints:12,pendingCount:0,confirmedScore:null,confirmedCount:0,topicStats:[],suggestion:advice},mySubmission:{status:'submitted',submittedAt:stamp,resubmittedAt:stamp,submitCount:2,late:false,correction:null}}});}
    else if(url.pathname==='/api/assignments/1/results')data={assignment,students:[{...student,status:correction?'correction':'submitted',submittedAt:stamp,correction},{...student,id:3,name:'第二位測試學生',username:'second',status:'in_progress',pendingCount:1}],summary:{studentCount:2,submittedCount:1,correctionCount:correction?1:0,fullyGradedCount:0,pendingReviewCount:1,averageScore:null,confirmedAverage:null},topicStats:[]};
    else if(url.pathname==='/api/assignments/1')data={assignment,questions:[q],attempts:[attemptFixture()],mySubmission:{status:correction?'correction':(studentSubmitted?'submitted':'not_started'),submittedAt:studentSubmitted?stamp:null,resubmittedAt:studentSubmitted?stamp:null,submitCount:studentSubmitted?2:0,late:false,correction},report:{score:null,maxScore:6,totalScoredPoints:0,pendingCount:0,confirmedScore:null,confirmedCount:0,topicStats:[],suggestion:advice}};
    else return route.fulfill({status:404,json:{error:'未設定的測試路由'}});
    return route.fulfill({json:data});
  });
  const login=async who=>{await page.locator('#homework-login').click();await page.locator(`[data-role=${who}]`).click();await page.locator('#password').fill('testing-password');await page.locator('#login-form button[type=submit]').click();try{await page.locator('.modal').waitFor({state:'hidden'});}catch(err){console.error('LOGIN FAILED',who,JSON.stringify(await page.locator('.modal').innerText()),errors);throw err;}};
  await page.goto('https://mathpath.test');await page.locator('#homework-login').waitFor();
  await page.screenshot({path:path.join(__dirname,'..','MathPath-作业版预览.png'),fullPage:true});

  // 字級切換：不需登入即可使用，並記住選擇
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.fs),undefined,'訪客預設應為標準字級');
  const h1Size=()=>page.evaluate(()=>parseFloat(getComputedStyle(document.querySelector('h1')).fontSize));
  const normalSize=await h1Size();
  assert.ok(normalSize>=30,`標準字級已放大，h1 應 ≥30px（實際 ${normalSize}）`);
  await page.locator('[data-font-scale=xlarge]').click();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.fs),'xlarge');
  assert.equal(await page.evaluate(()=>localStorage.getItem('mathpath_font_scale')),'xlarge');
  const xlargeSize=await h1Size();
  assert.ok(xlargeSize>normalSize,'特大字級應大於標準');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-字級特大.png'),fullPage:true});
  await page.reload();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.fs),'xlarge','重新載入後應保持字級');
  assert.equal(await page.evaluate(()=>document.querySelector('[data-font-scale=xlarge]').classList.contains('active')),true);
  await page.locator('[data-font-scale=large]').click();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'「大」字級在手機不應橫向溢出');
  await page.locator('#menu-btn').click();
  await page.locator('[data-font-scale=xlarge]').click();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.fs),'xlarge');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'「特大」字級在手機不應橫向溢出');
  await page.locator('[data-font-scale=normal]').click();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.fs),undefined,'可切回標準');
  await page.setViewportSize({width:1440,height:1000});

  // 登入頁：清楚列出學生／教師身分卡，並預設記住我
  await page.locator('#homework-login').click();
  await page.locator('.role-cards').waitFor();
  assert.equal(await page.locator('.role-card').count(),2,'應清楚列出學生與教師兩種身分');
  assert.match(await page.locator('.role-card.active').innerText(),/學生/);
  assert.equal(await page.locator('#remember').isChecked(),true,'記住我應預設勾選');
  await page.locator('.role-card[data-role=teacher]').click();
  assert.match(await page.locator('.role-card.active').innerText(),/教師/);
  assert.equal(await page.locator('#username').inputValue(),'teacher','選教師應帶入教師帳戶');
  await page.locator('.role-card[data-role=student]').click();
  assert.equal(await page.locator('#username').inputValue(),'student');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-登入頁.png'),fullPage:true});
  await page.locator('[data-action=close-modal]').click();
  await login('student');
  assert.equal(rememberSent,true,'登入應預設勾選記住我');
  assert.equal(await page.evaluate(()=>localStorage.getItem('mathpath_last_user')),'student','應記住上次登入帳號');
  await page.locator('[data-assignment]').first().click();await page.locator('[data-assignment-q]').click();
  await page.locator('[data-answer-mode=text]').click();await page.locator('#answer-process').fill('把二次式因式分解。');await page.locator('#final-answer').fill('x=2或3');
  await page.waitForFunction(()=>sessionStorage.getItem('mathpath_draft_1_1_1')?.includes('x=2或3'));
  await page.reload();await page.locator('[data-assignment]').first().click();await page.locator('[data-assignment-q]').click();assert.equal(await page.locator('#final-answer').inputValue(),'x=2或3');assert.equal(await page.locator('#answer-process').inputValue(),'把二次式因式分解。');assert.match(await page.locator('#draft-status').innerText(),/已恢復本分頁草稿/);
  await page.locator('#account').click();await page.locator('#logout-btn').click();await page.locator('#homework-login').waitFor();assert.equal(await page.evaluate(()=>sessionStorage.getItem('mathpath_draft_1_1_1')),null);
  await page.locator('#homework-login').click();
  await page.locator('.login-remembered').waitFor();
  assert.match(await page.locator('.login-remembered').innerText(),/student/,'應顯示已記住的登入帳戶');
  await page.locator('[data-action=close-modal]').click();

  await login('student');
  const weak=page.locator('.right-panel',{hasText:'最需要鞏固'});
  await weak.waitFor();assert.match(await weak.innerText(),/幾何/);assert.match(await weak.innerText(),/0%/);
  await weak.locator('[data-topic]').click();await page.locator('.topic-tab.active').waitFor();assert.equal(await page.locator('#crumb').innerText(),'數學題庫');assert.equal(await page.locator('.topic-tab.active').innerText(),'幾何');
  await page.locator('#account').click();await page.locator('#logout-btn').click();

  await login('teacher');await page.locator('[data-results]').first().click();
  await page.locator('#results-filter').selectOption('pending');assert.equal(await page.locator('[data-result-user]:visible').count(),1);
  await page.locator('#results-search').fill('不存在');assert.equal(await page.locator('[data-result-user]:visible').count(),0);
  await page.locator('#results-search').fill('');await page.locator('#results-filter').selectOption('all');
  assert.equal(await page.locator('[data-result-user]:visible').count(),2);
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export-results').click()]);
  const csv=fs.readFileSync(await download.path(),'utf8');
  assert.ok(csv.startsWith('\ufeff'),'CSV 需要 BOM 以便試算表正確顯示中文');
  for(const cell of ['學生','介面測試學生','待批與未交不當零分','教師確認平均'])assert.ok(csv.includes(cell),`CSV 缺少 ${cell}`);

  await page.locator('[data-student-result]').first().click();
  await page.locator('[data-hw-review]').first().click();
  await page.locator('#ann-canvas').waitFor();
  await page.locator('#ai-annotate').click();
  await page.locator('.ai-annotation').waitFor();
  const aiText=await page.locator('.ai-annotation').innerText();
  assert.match(aiText,/AI 建議批註/);assert.match(aiText,/未經教師確認/);assert.match(aiText,/符號錯誤/);assert.match(aiText,/這裡應為負號/);
  assert.equal(await page.locator('.ai-mark').count(),1,'AI 應在圖上標出1處');
  assert.equal(await page.locator('.ai-mark').innerText(),'1');
  await page.locator('.ai-annotation').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(__dirname,'..','MathPath-AI批注.png'),fullPage:true});
  await page.locator('#ann-canvas').waitFor();
  await page.waitForFunction(()=>document.querySelector('#ann-canvas').width===400);
  // 教師可直接拖動 AI 標記修正位置，再儲存（須待畫布與標記就緒）。
  await page.locator('.ai-mark').first().scrollIntoViewIfNeeded();
  await page.locator('.ai-mark').first().hover();
  const markBox=await page.locator('.ai-mark').first().boundingBox();
  await page.mouse.down();
  await page.mouse.move(markBox.x+markBox.width/2+45,markBox.y+markBox.height/2+35,{steps:10});
  await page.mouse.up();
  assert.match(await page.locator('#ai-adjust-status').innerText(),/改動/,'拖動後應提示尚未儲存');
  await page.locator('#ai-adjust-save').click();
  await page.waitForFunction(()=>document.querySelector('#ai-adjust-status')?.textContent.includes('教師已調整標記位置'));
  assert.ok(aiAdjusted&&aiAdjusted.issues.length===1,'應送出調整後的標記');
  assert.ok(Math.abs(aiAdjusted.issues[0].x-AI_ISSUE.x)>0.01||Math.abs(aiAdjusted.issues[0].y-AI_ISSUE.y)>0.01,'標記座標應已改變');
  assert.equal(aiAdjusted.issues[0].label,'符號錯誤','調整位置不應改動標籤內容');
  assert.equal(await page.locator('.ai-mark').count(),1,'調整後仍應只有1個標記');
  await page.locator('#ai-adjust-status').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(__dirname,'..','MathPath-AI批注调整位置.png'),fullPage:true});
  await page.locator('#ai-adjust-status').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(__dirname,'..','MathPath-AI批注调整位置.png'),fullPage:true});
  await page.locator('#ann-canvas').scrollIntoViewIfNeeded();
  const box=await page.locator('#ann-canvas').boundingBox();
  await page.locator('[data-ann-tool=pen]').click();
  await page.mouse.move(box.x+30,box.y+30);await page.mouse.down();await page.mouse.move(box.x+130,box.y+95,{steps:8});await page.mouse.up();
  await page.locator('[data-ann-tool=ellipse]').click();
  await page.mouse.move(box.x+50,box.y+40);await page.mouse.down();await page.mouse.move(box.x+170,box.y+130,{steps:8});await page.mouse.up();
  await page.locator('[data-ann-tool=highlight]').click();
  await page.mouse.move(box.x+40,box.y+200);await page.mouse.down();await page.mouse.move(box.x+220,box.y+200,{steps:8});await page.mouse.up();
  await page.locator('[data-ann-tool=pen]').click();
  await page.mouse.move(box.x+30,box.y+30);await page.mouse.down();await page.mouse.move(box.x+140,box.y+100,{steps:8});await page.mouse.up();
  assert.match(await page.locator('#ann-status').innerText(),/尚未儲存/);
  await page.screenshot({path:path.join(__dirname,'..','MathPath-教师批注.png'),fullPage:true});
  await page.locator('#ann-save').click();
  await page.waitForFunction(()=>!document.querySelector('#modal-root .modal'));
  assert.equal(annotated,true,'批註應已送出');

  studentSubmitted=true;
  await page.locator('#account').click();await page.locator('#logout-btn').click();await page.locator('#homework-login').waitFor();
  await login('student');
  await page.locator('[data-assignment]').first().click();
  await page.locator('[data-review]').first().click();
  await page.locator('.annotated-view .badge').waitFor();
  assert.match(await page.locator('.annotated-view').innerText(),/教師批註/);
  assert.match(await page.locator('.annotated-view img').getAttribute('src'),/\/api\/attempts\/9\/annotation$/);
  assert.match(await page.locator('.annotated-view').innerText(),/紅圈與箭頭指出需要修改的地方/);
  // 學生同時看得到 AI 建議批註，並清楚標示未經教師確認。
  assert.match(await page.locator('.ai-annotation').innerText(),/未經教師確認/);
  assert.equal(await page.locator('.ai-mark').count(),1);
  await page.locator('[data-action=close-modal]').click();
  await page.locator('#account').click();await page.locator('#logout-btn').click();

  await login('teacher');
  // 作業頁應有日曆入口
  await page.locator('[data-page=homework]').first().click();
  await page.locator('.section-head-actions [data-page=calendar]').waitFor();
  assert.match(await page.locator('.section-head-actions').innerText(),/查看日曆/,'作業頁應有日曆入口');
  await page.locator('.section-head-actions [data-page=calendar]').click();
  // 日曆：標出作業與測驗
  await page.locator('[data-page=calendar]').first().click();
  await page.locator('.cal-grid').waitFor();
  assert.match(await page.locator('.cal-mark.hw').first().innerText(),/作業 1/,'日曆應標出作業');
  assert.match(await page.locator('.cal-mark.quiz').first().innerText(),/測驗 1/,'日曆應標出測驗');
  await page.locator('.cal-cell:has(.cal-mark.quiz)').click();
  await page.locator('.cal-event.quiz').waitFor();
  const quizText=await page.locator('.cal-event.quiz').innerText();
  assert.match(quizText,/一元二次方程測驗/);assert.match(quizText,/發布/);assert.match(quizText,/已交 0 \/ 2 人/);
  await page.locator('.cal-cell:has(.cal-mark.hw)').click();
  await page.locator('.cal-event.hw').waitFor();
  assert.match(await page.locator('.cal-event.hw').innerText(),/截止/);
  // 教師可在日曆加入提醒事項
  await page.locator('#note-title').fill('收齊作業');
  await page.locator('#note-body').fill('下午三點前完成');
  await page.locator('#note-form button[type=submit]').click();
  await page.locator('.cal-note').waitFor();
  assert.ok(noteCreated&&noteCreated.title==='收齊作業','應送出提醒標題');
  assert.match(noteCreated.date,/^\d{4}-\d{2}-\d{2}$/,'提醒須帶日期');
  assert.match(await page.locator('.cal-note').innerText(),/收齊作業/);
  assert.match(await page.locator('.cal-mark.note').first().innerText(),/提醒 1/,'日曆格子應標出提醒');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-日曆提醒.png'),fullPage:true});
  await page.locator('[data-note-del="41"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.cal-note').length===0);
  assert.equal(calendarNotes.length,0,'刪除後不應再有提醒');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-日曆.png'),fullPage:true});
  // 題庫：顯示題型，並可依題型篩選
  await page.locator('[data-page=bank]').first().click();
  await page.locator('[data-topic="全部題目"]').click();
  await page.locator('.question-card').first().waitFor();
  assert.match(await page.locator('.question-card').first().innerText(),/選擇題/,'題目卡應顯示題型');
  // 數學式子以 KaTeX 排版：$...$ 應被渲染，且頁面不得殘留原始 $ 標記
  assert.ok(await page.locator('.question-card .katex').count() > 0, '題目卡的數學式應以 KaTeX 渲染');
  // 選擇題：題目卡要列出可選項（數學式渲染、A/B/C/D 標號）
  assert.equal(await page.locator('.question-card .choice-options li').count(), 4, '選擇題應顯示 4 個選項');
  assert.equal(await page.locator('.question-card .choice-options .option-letter').first().innerText(), 'A');
  assert.ok(await page.locator('.question-card .choice-options .katex').count() > 0, '選項的數學式也應渲染');
  assert.equal(await page.evaluate(() => /\$[^$]{1,60}\$/.test(document.querySelector('#question-list').innerText)), false, '不應殘留未渲染的 $ 數學標記');
  assert.equal(await page.evaluate(() => !!(window.katex && window.katex.renderToString)), true, 'KaTeX 應已載入');
  await page.locator('.question-card').first().locator('.practice-btn').click();
  await page.locator('#answer-area').waitFor({timeout:8000});
  await page.locator('#main .katex').first().waitFor({timeout:5000});
  assert.ok(await page.locator('#main .katex').count() > 0, '題目頁的數學式應以 KaTeX 渲染');
  // 選擇題在練習頁應預設「點選作答」，可點選項並帶入最終答案
  await page.locator('#choice-picker').waitFor({timeout:5000});
  assert.match(await page.locator('.practice-tabs').innerText(), /點選作答/, '選擇題應有點選作答模式');
  assert.equal(await page.locator('.choice-option').count(), 4, '應有 4 個可點選項');
  await page.locator('.choice-option').nth(2).click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.choice-option.selected .option-letter').innerText(), 'C', '點選後應標示為已選');
  assert.equal(await page.locator('#final-answer').inputValue(), 'C', '點選應帶入最終答案');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-選擇題作答.png'),fullPage:true});
  await page.screenshot({path:path.join(__dirname,'..','MathPath-數學式子.png'),fullPage:true});
  await page.locator('[data-page=bank]').first().click();
  await page.locator('.question-card').first().waitFor();

  assert.equal(await page.locator('.question-figure').count(),0,'沒有圖形的題目不應渲染圖形區塊（避免破圖）');
  await page.locator('#qtype-filter').selectOption('解答題');
  assert.equal(await page.locator('.question-card').count(),0,'依題型篩選應生效');
  await page.locator('#qtype-filter').selectOption('選擇題');
  assert.equal(await page.locator('.question-card').count(),1);
  await page.screenshot({path:path.join(__dirname,'..','MathPath-題型篩選.png'),fullPage:true});
  await page.locator('#qtype-filter').selectOption('');
  // 兩層知識分類：所有主分類頁籤都要完整顯示（換行，不得被裁掉），選主分類後出現子分類
  const mainTabCount = await page.locator('.topic-tab').count();
  assert.ok(mainTabCount >= 27, `主分類頁籤應至少 27 個，實際 ${mainTabCount}`);
  const clippedTabs = await page.evaluate(() => {
    const box = document.querySelector('.topic-tabs').getBoundingClientRect();
    return [...document.querySelectorAll('.topic-tab')]
      .filter(t => { const r = t.getBoundingClientRect(); return r.right > box.right + 1 || r.left < box.left - 1; })
      .map(t => t.textContent);
  });
  assert.equal(clippedTabs.length, 0, `分類頁籤不應被裁掉，卻有：${clippedTabs.join('、')}`);
  // 年級篩選要有中一至中六
  const bankGradeOpts = await page.locator('#grade-filter option').allInnerTexts();
  assert.deepEqual(bankGradeOpts, ['所有年級','中一','中二','中三','中四','中五','中六'], '年級篩選應為中一至中六');
  // 選「圓」→ 子分類頁籤出現且可篩選
  await page.locator('.topic-tab', {hasText:'圓'}).first().click();
  await page.locator('.subtopic-tabs').waitFor({timeout:5000});
  const subTabCount = await page.locator('.subtopic-tab').count();
  assert.ok(subTabCount > 5, `「圓」的子分類頁籤應多於 5 個，實際 ${subTabCount}`);
  await page.locator('.subtopic-tab').nth(1).click();
  assert.match(await page.locator('.subtopic-tab.active').innerText(), /^圓的基本概念$/, '子分類應可選中');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-兩層分類.png'),fullPage:true});
  // 右側知識點面板不應再寫死只顯示前 4 個分類
  assert.match(await page.locator('.right-panel').nth(1).innerText(), /知識點練習表現/);
  await page.locator('[data-topic="全部題目"]').click();
  // 兩層知識分類：所有主分類頁籤都要完整顯示（換行，不得被裁掉），選主分類後出現子分類
  const tabCount = await page.locator('.topic-tab').count();
  assert.ok(tabCount >= 27, `主分類頁籤應至少 27 個，實際 ${tabCount}`);
  const clipped = await page.evaluate(() => {
    const box = document.querySelector('.topic-tabs').getBoundingClientRect();
    return [...document.querySelectorAll('.topic-tab')]
      .filter(t => { const r = t.getBoundingClientRect(); return r.right > box.right + 1 || r.left < box.left - 1; })
      .map(t => t.textContent);
  });
  assert.equal(clipped.length, 0, `分類頁籤不應被裁掉，卻有：${clipped.join('、')}`);
  // 年級篩選要有中一至中六
  const gradeOpts = await page.locator('#grade-filter option').allInnerTexts();
  assert.deepEqual(gradeOpts, ['所有年級','中一','中二','中三','中四','中五','中六'], '年級篩選應為中一至中六');
  // 選「圓」→ 子分類頁籤出現且可篩選
  await page.locator('.topic-tab', {hasText:'圓'}).first().click();
  await page.locator('.subtopic-tabs').waitFor({timeout:5000});
  const subCount = await page.locator('.subtopic-tab').count();
  assert.ok(subCount > 5, `「圓」的子分類頁籤應多於 5 個，實際 ${subCount}`);
  await page.locator('.subtopic-tab').nth(1).click();
  assert.match(await page.locator('.subtopic-tab.active').innerText(), /^圓的基本概念$/, '子分類應可選中');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-兩層分類.png'),fullPage:true});
  // 右側知識點面板不應再寫死只顯示前 4 個分類
  assert.match(await page.locator('.right-panel').nth(1).innerText(), /知識點練習表現/);
  await page.locator('[data-topic="全部題目"]').click();

  // 全自動拆分並匯入：一次完成拆分、題型分類與入庫
  await page.locator('[data-page=import]').first().click();
  await page.locator('#sample-paper').click();
  await page.locator('#auto-import-paper').click();
  await page.waitForTimeout(500);
  assert.ok(autoImported&&autoImported.name,'全自動匯入應送出試卷名稱');
  assert.match(autoImported.text,/解方程/,'全自動匯入應帶上試卷文字');
  assert.equal(await page.locator('#question-list').count(),1,'匯入後應回到題庫');

  // 先拆分預覽：草稿應帶入題型並顯示題目分析
  await page.locator('[data-page=import]').first().click();
  await page.locator('#sample-paper').click();
  await page.locator('#parse-paper').click();
  await page.locator('.draft-card').waitFor();
  assert.equal(await page.locator('[data-field=qtype]').inputValue(),'選擇題','草稿應帶入題型');
  assert.match(await page.locator('.draft-analysis').innerText(),/題型為選擇題/,'應顯示題目分析');
  // 拆題編輯頁的表單欄位必須顯示「原始 LaTeX 文字」，不可把渲染後的 KaTeX HTML 塞進輸入框
  const draftTex = await page.locator('[data-field=content]').inputValue();
  assert.ok(draftTex.includes('$A=\\{x\\mid -1<x\\le 3\\}$'), `題目內容應為原始 LaTeX，實際：${draftTex.slice(0,80)}`);
  assert.equal(/<span|<math|class="katex/.test(draftTex), false, '題目內容不得含渲染後的 HTML');
  assert.equal(await page.locator('[data-field=content] span').count(), 0, 'textarea 內不得有 KaTeX 元素');
  assert.equal(await page.locator('[data-field=answer]').inputValue(), '$3$', '答案欄應為原始 LaTeX');
  // 拆題編輯頁的表單欄位必須顯示「原始 LaTeX 文字」，不可把渲染後的 KaTeX HTML 塞進輸入框
  const draftContent = await page.locator('[data-field=content]').inputValue();
  assert.ok(draftContent.includes('$A=\\{x\\mid -1<x\\le 3\\}$'), `題目內容應為原始 LaTeX，實際：${draftContent.slice(0,80)}`);
  assert.equal(/<span|<math|class="katex/.test(draftContent), false, '題目內容不得含渲染後的 HTML');
  assert.equal(await page.locator('[data-field=content] span').count(), 0, 'textarea 內不得有 KaTeX 元素');
  assert.equal(await page.locator('[data-field=answer]').inputValue(), '$3$', '答案欄應為原始 LaTeX');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-題型分類.png'),fullPage:true});
  await page.locator('#back-import').click();
  await page.locator('#manual-title').waitFor();

  // 教師手動輸入題目並繪製圖形
  await page.locator('[data-page=import]').first().click();
  await page.locator('#manual-title').fill('直角三角形求斜邊');
  await page.locator('#manual-content').fill('直角三角形兩條直角邊長為 3 cm 和 4 cm，求斜邊長。');
  await page.locator('#manual-topic').selectOption('幾何');
  await page.locator('#manual-answer').fill('5 cm');
  // 手動新增選擇題：切到選擇題應出現選項編輯，可增刪並即時預覽
  await page.locator('#manual-qtype').selectOption('選擇題');
  await page.locator('#manual-options-field').waitFor({state:'visible',timeout:5000});
  assert.equal(await page.locator('#manual-options [data-manual-option]').count(), 4, '選擇題預設 4 個選項欄');
  await page.locator('#manual-add-option').click();
  assert.equal(await page.locator('#manual-options [data-manual-option]').count(), 5, '可新增第 5 個選項');
  await page.locator('#manual-options [data-manual-option]').last().fill('$x=6$');
  await page.waitForTimeout(200);
  assert.ok(await page.locator('#manual-options-preview .katex').count() > 0, '選項預覽應渲染數學式');
  await page.locator('#manual-options [data-manual-drop]').last().click();
  assert.equal(await page.locator('#manual-options [data-manual-option]').count(), 4, '可刪除選項');
  await page.locator('#manual-qtype').selectOption('解答題');
  assert.equal(await page.locator('#manual-options-field').isVisible(), false, '非選擇題應隱藏選項編輯');
  const fbox=await page.locator('#figure-canvas').boundingBox();
  await page.locator('[data-fig-tool=pen]').click();
  await page.mouse.move(fbox.x+70,fbox.y+40);await page.mouse.down();await page.mouse.move(fbox.x+200,fbox.y+150,{steps:8});await page.mouse.up();
  await page.mouse.move(fbox.x+200,fbox.y+150);await page.mouse.down();await page.mouse.move(fbox.x+70,fbox.y+150,{steps:8});await page.mouse.up();
  assert.match(await page.locator('#fig-status').innerText(),/已繪製圖形/,'畫圖後應提示已繪製');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-手動輸入題目.png'),fullPage:true});
  await page.locator('#manual-add').click();
  await page.locator('.draft-card').first().waitFor();
  assert.equal(await page.locator('.draft-card').count(),2,'應保留先前拆分草稿並加入手動題目');
  assert.match(await page.locator('.draft-figure img').getAttribute('src'),/^data:image\/png;base64,/,'草稿應顯示手繪圖形');
  await page.locator('#confirm-drafts').check();
  await page.locator('#save-drafts').click();
  await page.locator('.success-panel').waitFor();
  assert.ok(importedQuestions&&importedQuestions.length===2,'應匯入2題（拆分草稿＋手動題目）');
  const manualQ=importedQuestions.find(q=>q.source==='手動輸入');
  assert.ok(manualQ,'應包含手動輸入的題目');
  assert.equal(manualQ.title,'直角三角形求斜邊');
  assert.equal(manualQ.qtype,'解答題','手動輸入應帶題型');
  assert.ok(manualQ.figure.startsWith('data:image/png;base64,'),'匯入必須帶題目圖形');
  await page.locator('[data-page=settings]').first().click();await page.locator('#manage-users').click();  await page.locator('#bulk-students').fill('陳大文,s3a01\n李小美,s3a02\n黃志強,s3\n壞行');
  assert.match(await page.locator('#bulk-preview').innerText(),/將建立 2 個帳戶/);
  assert.match(await page.locator('#bulk-error').innerText(),/第 3 行/);assert.match(await page.locator('#bulk-error').innerText(),/第 4 行/);
  await page.locator('#bulk-file').setInputFiles({name:'名單.csv',mimeType:'text/csv',buffer:Buffer.from('\ufeff姓名,帳號,密碼\n陳大文,s3a01\n李小美,s3a02\n')});
  await page.waitForFunction(()=>document.querySelector('#bulk-students').value.includes('陳大文'));
  assert.equal(await page.locator('#bulk-error').innerText(),'');
  assert.match(await page.locator('#bulk-preview').innerText(),/將建立 2 個帳戶/);
  assert.doesNotMatch(await page.locator('#bulk-preview').innerText(),/3 個/);
  await page.locator('#bulk-class-toggle').check();assert.equal(await page.locator('#bulk-class-field').isVisible(),true);
  await page.locator('#bulk-class-name').fill('中三甲班');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-账号汇入.png'),fullPage:true});
  await page.locator('#bulk-submit').click();await page.locator('#bulk-result .code-block').waitFor();
  const result=await page.locator('#bulk-result').innerText();
  assert.match(result,/已建立 2 個帳戶/);assert.match(result,/s3a01/);assert.match(result,/密碼只會顯示這一次/);assert.match(result,/已同時建立班級「中三甲班」/);

  await page.locator('[data-action=close-modal]').click();

  // 模型端點頁面：可隨時更換並測試，金鑰不回讀到瀏覽器。
  await page.locator('[data-page=ai]').first().click();
  await page.locator('#ai-form').waitFor();
  assert.match(await page.locator('.metric').first().innerText(),/未接入/);
  assert.match(await page.locator('.capability-list').innerText(),/未能使用|需要文字模型/);
  await page.locator('#ai-base').fill('http://127.0.0.1:11434/v1');
  await page.locator('#ai-model').fill('local-text');
  await page.locator('#ai-vision').fill('local-vision');
  await page.locator('#ai-key').fill('secret-key-123');
  await page.locator('#ai-test').click();
  await page.locator('#ai-test-result .hint-box').waitFor();
  assert.match(await page.locator('#ai-test-result').innerText(),/連線成功/);
  await page.locator('#ai-test-vision').click();
  await page.waitForFunction(()=>document.querySelector('#ai-test-result').innerText.includes('不證明辨識準確度'));
  await page.locator('#ai-form button[type=submit]').click();
  await page.waitForFunction(()=>document.body.innerText.includes('介面儲存設定'));
  assert.equal(savedKeySeen,'secret-key-123','伺服器應收到金鑰');
  assert.equal(aiConfigSaved.visionModel,'local-vision');
  assert.equal(await page.locator('#ai-key').inputValue(),'','金鑰不得回讀到瀏覽器');
  assert.match(await page.locator('#ai-key').getAttribute('placeholder'),/已設定/);
  assert.ok(!(await page.locator('body').innerText()).includes('secret-key-123'),'金鑰不得顯示在頁面');
  // 計費模式：勾選框必須反映生效狀態，切換後立即呼叫 economy 端點且不被重繪還原
  assert.equal(await page.locator('#ai-thinking').isChecked(),true,'預設應為省錢模式（已勾選）');
  await page.locator('#ai-thinking').click();
  await page.waitForFunction(()=>document.querySelector('#ai-thinking')&&!document.querySelector('#ai-thinking').checked);
  assert.equal(economySent,false,'取消勾選應送出 economy:false（精確模式）');
  assert.equal(await page.locator('#ai-thinking').isChecked(),false,'切換後不得被重繪還原');
  await page.locator('#ai-thinking').click();
  await page.waitForFunction(()=>document.querySelector('#ai-thinking')&&document.querySelector('#ai-thinking').checked);
  assert.equal(economySent,true,'重新勾選應送出 economy:true（省錢模式）');
  assert.match(await page.locator('.metric').first().innerText(),/本機模型/);
  assert.match(await page.locator('.capability-list').innerText(),/手寫辨識與 AI 建議批註/);
  await page.screenshot({path:path.join(__dirname,'..','MathPath-模型端点.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'模型端點頁在手機不應橫向溢出');
  await page.setViewportSize({width:1440,height:1000});

  // 教師佈置限時模擬測驗：可設定時間限制
  await page.locator('[data-page=homework]').first().click();
  await page.locator('#create-assignment').click();
  await page.locator('#assignment-title').fill('一元二次方程模擬測驗');
  await page.locator('#assignment-title').fill('一元二次方程模擬測驗');
  await page.locator('#assignment-kind').selectOption('quiz');
  await page.locator('#assignment-duration').fill('30');
  await page.locator('[name=assignment-questions]').first().check();
  await page.locator('#assignment-form button[type=submit]').click();
  await page.waitForFunction(()=>!document.querySelector('#modal-root .modal'));
  assert.equal(durationSent.kind,'quiz','應以測驗類型發布');
  assert.equal(durationSent.durationMinutes,30,'教師設定的時間限制應送出');

  // 訂正重做閉環：教師退回 → 學生看到要求 → 完成訂正後提交。
  await page.locator('[data-page=homework]').first().click();
  await page.locator('[data-results]').first().click();
  await page.locator('[data-student-result]').first().click();
  await page.locator('#request-correction').click();
  await page.locator('#correction-form').waitFor();
  assert.match(await page.locator('#correction-count').innerText(),/已選 1 題/);
  await page.locator('#correction-note').fill('第1題漏了第二個根，請重新寫出因式分解過程。');
  await page.locator('#correction-form button[type=submit]').click();
  await page.waitForFunction(()=>document.body.innerText.includes('第 1 回合訂正'));
  assert.equal(returned.studentId,1);
  assert.deepEqual(returned.questionIds,[1]);
  assert.match(returned.note,/漏了第二個根/);
  assert.match(await page.locator('.metric-row').innerText(),/1 人訂正中/);

  await page.locator('#account').click();await page.locator('#logout-btn').click();await page.locator('#homework-login').waitFor();
  await login('student');
  await page.locator('[data-assignment]').first().click();
  await page.locator('.correction-banner').waitFor();
  const banner=await page.locator('.correction-banner').innerText();
  assert.match(banner,/教師要求訂正（第 1 回合）/);assert.match(banner,/漏了第二個根/);assert.match(banner,/尚有 1 題未重新作答/);
  assert.match(await page.locator('.page-heading').innerText(),/需訂正/);
  assert.match(await page.locator('#finalize-assignment').innerText(),/提交訂正/);
  assert.equal(await page.locator('#finalize-assignment').isDisabled(),true,'未完成訂正前不可提交');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-订正重做.png'),fullPage:true});
  // 完成訂正後即可提交
  correction={...correction,minAttemptId:8};
  await page.locator('[data-page=homework]').first().click();
  await page.locator('[data-assignment]').first().click();
  await page.locator('#finalize-assignment').waitFor();
  assert.equal(await page.locator('#finalize-assignment').isDisabled(),false);
  assert.match(await page.locator('.correction-banner').innerText(),/所有題目已重新作答/);
  await page.locator('#finalize-assignment').click();
  await page.waitForFunction(()=>document.body.innerText.includes('第 2 次提交'));
  assert.equal(correction,null,'提交後訂正回合應結束');
  // 模擬測驗：未開始不可作答、倒數計時、提交後即時計分
  await page.locator('[data-page=homework]').first().click();
  await page.locator('[data-assignment="2"]').click();
  await page.locator('.quiz-banner').waitFor();
  assert.match(await page.locator('.quiz-banner').innerText(),/模擬測驗 · 限時 30 分鐘/);
  assert.match(await page.locator('.quiz-banner').innerText(),/按「開始測驗」後開始倒數/);
  assert.equal(await page.locator('[data-assignment-q]').count(),0,'未開始前不可作答');
  await page.locator('#start-quiz').click();
  await page.waitForFunction(()=>{const el=document.querySelector('[data-quiz-clock]');return !!el&&/^\d{2}:\d{2}$/.test(el.textContent);});
  assert.equal(quizStartSeen,1,'應呼叫開始測驗一次');
  assert.match(await page.locator('[data-quiz-clock]').first().innerText(),/^(29|30):[0-5]\d$/,'倒數應由 30 分鐘開始');
  await page.locator('[data-assignment-q]').first().click();
  await page.locator('.quiz-clock-chip').waitFor();
  assert.match(await page.locator('.quiz-clock-chip').innerText(),/^\d{2}:\d{2}$/,'解題頁應顯示倒數');
  await page.locator('.back-button[data-assignment]').click();
  await page.locator('#finalize-assignment').waitFor();
  await page.locator('#finalize-assignment').click();
  await page.locator('.quiz-result-banner').waitFor();
  const quizResult=await page.locator('.quiz-result-banner').innerText();
  assert.match(quizResult,/即時計分/);assert.match(quizResult,/6 \/ 6 分/);assert.match(quizResult,/100%/);
  assert.equal(quizSubmitted,true,'測驗應已提交');
  assert.match(await page.locator('.learning-advice').first().innerText(),/下一步練習/,'提交後應顯示提升建議');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-模擬測驗.png'),fullPage:true});

  // 學生自助模擬測驗：自選條件、限時、即時計分與提升建議
  await page.locator('[data-page=mock]').first().click();
  await page.locator('#mock-start').waitFor();
  await page.locator('#mock-topic').selectOption('幾何');
  // 兩層分類：選主分類後子分類應連動出現
  await page.locator('#mock-subtopic').selectOption('勾股定理');
  await page.locator('#mock-count').selectOption('5');
  await page.locator('#mock-minutes').selectOption('15');
  await page.locator('#mock-start').click();
  await page.locator('.quiz-banner').waitFor();
  assert.match(await page.locator('.quiz-banner').innerText(),/模擬測驗進行中 · 限時 15 分鐘/);
  assert.match(await page.locator('.quiz-clock').innerText(),/^\d{2}:\d{2}$/,'應顯示倒數');
  assert.equal(mockStarted.topic,'幾何');assert.equal(mockStarted.subtopic,'勾股定理');assert.equal(mockStarted.count,5);assert.equal(mockStarted.minutes,15);
  assert.equal(await page.locator('#mock-submit').isDisabled(),true,'未作答不能提交');
  await page.locator('[data-mock-q]').first().click();
  await page.locator('[data-answer-mode=text]').click();
  await page.locator('#final-answer').fill('5 cm');
  await page.locator('#submit-answer').click();
  await page.locator('.result-score').first().waitFor();
  assert.equal(mockAttemptBody.mockId,7,'作答必須帶上模擬測驗編號');
  assert.ok(!('assignmentId' in mockAttemptBody),'模擬測驗不應帶作業編號');
  await page.locator('[data-mock="7"]').first().click();
  await page.locator('#mock-submit').waitFor();
  assert.equal(await page.locator('#mock-submit').isDisabled(),false,'已作答後可提交');
  await page.locator('#mock-submit').click();
  await page.locator('.quiz-banner.done').waitFor();
  assert.match(await page.locator('.quiz-banner.done').innerText(),/即時計分/);
  assert.match(await page.locator('.quiz-score').innerText(),/5 \/ 5 分/);
  assert.match(await page.locator('.learning-advice').first().innerText(),/下一步建議|下一步練習/,'提交後應顯示提升建議');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-自助模擬測驗.png'),fullPage:true});

  await page.locator('#account').click();await page.locator('#logout-btn').click();await page.locator('#homework-login').waitFor();
  await login('teacher');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#menu-btn').click();await page.locator('[data-page=homework]').first().click();await page.locator('.assignment-card').first().waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);await browser.close();
  console.log('PASS: font scale switch (guest, persisted, 3 levels, no mobile overflow), login page (role cards, remember checked, remembered account), calendar (marks + entry from homework), question type (card badge, filter, draft qtype, rule analysis), full-auto split+import, homework, draft save/reload/restore, logout cleanup, weak-topic drill-down, results filters, CSV export, teacher annotation (pen/ellipse/arrow/highlight/undo/clear/save), AI suggested annotation with student read-back and teacher drag-to-adjust saved positions, correction loop (teacher return with note, student banner, pending guard, resubmit), self-serve mock exam (setup, countdown, per-question answer with mockId, submit + instant score + advice), AI endpoint page (test/save, key never read back), bulk account parse/errors/create, mobile layout, no JS errors. Fixture API only; no server started.');
})().catch(e=>{console.error(e);process.exit(1)});
