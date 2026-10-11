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
  const student={id:1,name:'介面測試學生',username:'student',seat:'1',status:'not_started',answeredCount:0,pendingCount:0,score:null,totalPoints:6,scoredPoints:0,confirmedScore:null,confirmedCount:0,aiScore:null,ruleScore:null,suggestion:advice};
  const stamp='2026-10-08T08:00:00Z';
  const graded=(id,questionId,topic,score,maxScore)=>({id,questionId,questionTitle:'測試題',topic,score,maxScore,status:'graded',feedback:'規則評分。',submittedAt:stamp,answerText:'x=2或3',gradingMethod:'rule-final',steps:[],teacherReviewed:false});
  const handwritten={id:9,questionId:1,questionTitle:'因式分解解二次方程',topic:'一元二次方程',score:null,maxScore:6,status:'pending',feedback:'手寫圖片尚未批閱，等待教師評分。',submittedAt:stamp,answerText:'',gradingMethod:'pending-teacher',steps:[],teacherReviewed:false,image:'/api/attempts/9/image',student:{id:1,name:'介面測試學生',username:'student'},suggestion:advice};
  let annotated=false,studentSubmitted=false,aiMarked=false,aiAdjusted=null,autoImported=null,parsedSeen=null,savedKeySeen=null,aiConfigSaved=null,economySent=null,aiAnswerPayload=null,correction=null,returned=null,rememberSent=null,importedQuestions=null;
  let mockStarted=null,mockState=null,mockAttempt=null,mockAttemptBody=null;
  let calendarNotes=[],noteCreated=null;
  const assignmentQuestion={...q,qtype:'解答題',options:[]};
  const mockQuestion={id:11,title:'模擬題：直角三角形',content:'直角三角形兩邊長為3 cm及4 cm，求斜邊長。',topic:'幾何',level:1,grade:'中三',points:5,qtype:'解答題',hint:'用畢氏定理',source:'校本題庫',tags:['幾何']};
  const mockExam=()=>({id:7,topic:mockStarted&&mockStarted.topic||'幾何',level:null,qtype:'解答題',minutes:mockStarted?mockStarted.minutes:15,questionCount:1,createdAt:stamp,startedAt:stamp,expiresAt:stamp,submittedAt:mockState&&mockState.submitted?stamp:null,expired:false,status:mockState&&mockState.submitted?'submitted':'in_progress',remainingSeconds:mockState&&mockState.submitted?0:(mockStarted?mockStarted.minutes*60:900)});
  const mockReport=()=>({score:5,maxScore:5,percent:100,totalScoredPoints:5,pendingCount:0,confirmedScore:null,confirmedCount:0,aiScore:null,ruleScore:5,topicStats:[{topic:'幾何',scoredCount:1,totalCount:1,score:5,maxScore:5,percent:100}],suggestion:advice,answeredCount:1});
  let quizStarted=false,quizSubmitted=false,quizStartSeen=0,durationSent=null;
  let reviewSent=null,aiReviewSent=null,bulkSent=null,resetSent=null,vacuumCalled=0;
  let editSent=null;const restoreSent={};
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
    if(url.pathname==='/api/attempts/9/review'&&route.request().method()==='POST'){
      reviewSent=route.request().postDataJSON();
      const note=reviewSent.feedback?('教師已覆核：'+reviewSent.feedback):'教師已覆核（未填寫評語）。';
      return route.fulfill({json:{attempt:{...attemptFixture(),score:reviewSent.score,teacherReviewed:true,confirmedScore:reviewSent.score,feedback:note,gradingMethod:'teacher-reviewed'}}});
    }
    if(url.pathname==='/api/assignments/1/ai-review'&&route.request().method()==='POST'){
      aiReviewSent=route.request().postDataJSON();
      return route.fulfill({json:{reviewed:2,failed:0,skipped:0,remaining:0,errors:[]}});
    }
    if(url.pathname==='/api/attempts/9/annotation'&&route.request().method()==='POST'){const sent=route.request().postDataJSON();assert.ok(/^data:image\/(png|webp);base64,/.test(sent.image),'批註圖必須是 PNG 或 WebP');assert.ok(sent.image.length>2000,'批註圖應包含手稿與筆跡');annotated=true;return route.fulfill({json:{attempt:attemptFixture()}});}
    const user=role?{id:role==='teacher'?2:1,name:role==='teacher'?'介面測試教師':'介面測試學生',role}:null;
    if(url.pathname==='/api/session')data={user};
    else if(url.pathname==='/api/login'){const sent=route.request().postDataJSON();role=sent.username;rememberSent=sent.remember;data={user:{id:role==='teacher'?2:1,name:'介面測試',role}};}
    else if(url.pathname==='/api/logout'){role=null;data={user:null};}
    else if(url.pathname==='/api/state')data={user,questions:[role==='teacher'?q:{...q,answer:undefined,steps:undefined}],attempts:role==='teacher'?[]:[graded(1,1,'一元二次方程',6,6),graded(2,2,'幾何',0,5)],stats:{completed:2,accuracy:55,streak:1,minutes:10},ai,topics:['一元二次方程','幾何']};
    else if(url.pathname==='/api/homework')data={classes:[{id:1,name:'中三甲班',studentCount:2,studentIds:[1,3]}],assignments:[assignment,quizAssignment],students:role==='teacher'?[student]:undefined,ai};
    else if(url.pathname==='/api/ai-config'&&route.request().method()==='POST'){const sent=route.request().postDataJSON();savedKeySeen=sent.apiKey??null;aiConfigSaved=sent;const off=!sent.baseUrl&&!sent.model;return route.fulfill({json:{active:{configured:!off,model:off?'':'local-text',vision:off?'':'local-vision',mode:off?'off':'local',source:off?'none':'saved'},saved:off?null:{baseUrl:sent.baseUrl,model:sent.model,visionModel:sent.visionModel,keySet:true}}});}
    else if(url.pathname==='/api/questions/ai-answer'){aiAnswerPayload=route.request().postDataJSON();return route.fulfill({json:{answer:'$x=2$ 或 $x=3$',steps:['寫成標準形式 $x^2-5x+6=0$。','分解為 $(x-2)(x-3)=0$。','得 $x=2$ 或 $x=3$。'],analysis:'考因式分解法；常見錯誤是符號處理不當。',rubric:[{label:'正確列式',percent:30},{label:'因式分解正確',percent:40},{label:'寫出兩個根',percent:30}],qtype:'解答題',options:[],method:'AI 生成'}});}
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
    else if(url.pathname==='/api/users')data={users:[{id:1,username:'student',name:'介面測試學生',role:'student',seat:'1'}]};
    else if(/^\/api\/users\/\d+\/update$/.test(url.pathname)){editSent={id:Number(url.pathname.split('/')[3]),body:route.request().postDataJSON()};return route.fulfill({json:{user:{id:editSent.id,username:editSent.body.username||'student',name:editSent.body.name||'介面測試學生',role:'student',seat:editSent.body.seat===undefined?'1':editSent.body.seat},changed:Object.keys(editSent.body),passwordReset:!!editSent.body.password,sessionsRevoked:editSent.body.password?1:0}});}
    else if(url.pathname==='/api/admin/restore/questions'){restoreSent.questions={replace:url.searchParams.get('replace'),bytes:route.request().postDataBuffer().length};return route.fulfill({json:{inserted:3,skipped:13,mapped:16,total:16,replaced:url.searchParams.get('replace')==='1',notice:'已保留原編號'}});}
    else if(url.pathname==='/api/admin/restore/students'){restoreSent.students={password:url.searchParams.get('password'),bytes:route.request().postDataBuffer().length};return route.fulfill({json:{written:{student:2,class:1,assignment:1,attempt:1},skipped:{},credentials:[{username:'s3a01',name:'s3a01',seat:'1',password:'FjdatfcsXnig',generated:false}],usedSharedPassword:true,unreadableImages:0,questionMapApplied:true,notice:'歸檔不含密碼'}});}
    else if(url.pathname==='/api/admin/restore/db'){restoreSent.db={bytes:route.request().postDataBuffer().length};return route.fulfill({json:{restored:true,keptPreviousAs:'mathpath.replaced-test.sqlite3',counts:{questions:3000,attempts:2500,users:100},notice:'已用備份取代資料庫'}});}
    else if(url.pathname==='/api/admin/storage')data={database:{bytes:15728640,reclaimableBytes:1048576,walBytes:32768},counts:{questions:3000,attempts:2500,users:100,classes:3,assignments:5,mock_exams:0,calendar_notes:0,sessions:12},images:{handwriting:1500,annotation:300,questionFigure:40,inDatabaseBytes:45088768,inObjectStorage:0,storageMode:'db'},lastStudentReset:null,questionBankKeptAcrossYears:true};
    else if(url.pathname==='/api/admin/vacuum'){vacuumCalled+=1;return route.fulfill({json:{beforeBytes:15728640,afterBytes:10485760,savedBytes:5242880,at:stamp}});}
    else if(url.pathname==='/api/admin/reset/students'){resetSent=route.request().postDataJSON();return route.fulfill({json:{removed:{students:100,attempts:2500,classes:3,assignments:5,sessions:12},at:stamp,kept:{questions:3000,teachers:1,notice:'題庫、教師帳號、內建演示帳號與日曆提醒都保留。'},vacuum:{beforeBytes:15728640,afterBytes:1048576,savedBytes:14680064,at:stamp}}});}
    else if(url.pathname==='/api/users/bulk'){bulkSent=route.request().postDataJSON();return route.fulfill({json:{count:bulkSent.students.length,users:bulkSent.students.map((st,i)=>({id:5+i,username:st.username,name:st.name||st.username,role:'student',seat:st.seat||null}))}});}
    else if(url.pathname==='/api/classes')data={class:{id:2,name:route.request().postDataJSON().name,studentCount:2,studentIds:[5,6]}};
    else if(url.pathname==='/api/questions/1/recommendations')data={similar:[],advanced:[]};
    else if(url.pathname==='/api/assignments/1/return'){returned=route.request().postDataJSON();correction={round:1,note:returned.note,requestedAt:stamp,questionIds:returned.questionIds,minAttemptId:9};return route.fulfill({json:{correction,report:{score:6,maxScore:6,totalScoredPoints:6,pendingCount:0,confirmedScore:null,confirmedCount:0,topicStats:[],suggestion:advice}}});}
    else if(url.pathname==='/api/assignments/1/submit'){correction=null;studentSubmitted=true;return route.fulfill({json:{report:{score:12,maxScore:12,totalScoredPoints:12,pendingCount:0,confirmedScore:null,confirmedCount:0,topicStats:[],suggestion:advice},mySubmission:{status:'submitted',submittedAt:stamp,resubmittedAt:stamp,submitCount:2,late:false,correction:null}}});}
    else if(url.pathname==='/api/assignments/1/results')data={assignment,students:[{...student,status:correction?'correction':'submitted',submittedAt:stamp,correction},{...student,id:3,name:'第二位測試學生',username:'second',status:'in_progress',pendingCount:1}],summary:{studentCount:2,submittedCount:1,correctionCount:correction?1:0,fullyGradedCount:0,pendingReviewCount:1,averageScore:null,confirmedAverage:null},topicStats:[]};
    else if(url.pathname==='/api/assignments/1')data={assignment,questions:[assignmentQuestion],attempts:[attemptFixture()],mySubmission:{status:correction?'correction':(studentSubmitted?'submitted':'not_started'),submittedAt:studentSubmitted?stamp:null,resubmittedAt:studentSubmitted?stamp:null,submitCount:studentSubmitted?2:0,late:false,correction},report:{score:null,maxScore:6,totalScoredPoints:0,pendingCount:0,confirmedScore:null,confirmedCount:0,topicStats:[],suggestion:advice}};
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
  assert.equal(await page.locator('#hand-canvas').count(),1,'手寫解題應顯示書寫區');assert.equal(await page.locator('#math-keyboard').isVisible(),false,'手寫解題不應顯示數學鍵盤');await page.locator('[data-answer-mode=text]').click();assert.equal(await page.locator('#answer-process').count(),0,'文字作答不應再出現解題步驟輸入框');await page.locator('#final-answer').fill('x=2或3');
  await page.waitForFunction(()=>sessionStorage.getItem('mathpath_draft_1_1_1')?.includes('x=2或3'));
  await page.reload();await page.locator('[data-assignment]').first().click();await page.locator('[data-assignment-q]').click();assert.equal(await page.locator('#final-answer').inputValue(),'x=2或3');assert.equal(await page.locator('#answer-process').count(),0,'文字作答不應有解題步驟輸入框');assert.match(await page.locator('#draft-status').innerText(),/已恢復本分頁草稿/);
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
  // 日曆下方版面：分隔線標籤必須在面板中央，且各寬度／字級都不橫向溢出
  for(const fs of ['','large','xlarge']){
    for(const w of [1440,1024,768,390]){
      await page.setViewportSize({width:w,height:900});
      await page.evaluate(f=>{if(f)document.documentElement.dataset.fs=f;else delete document.documentElement.dataset.fs;},fs);
      await page.evaluate(()=>navigate('calendar'));
      await page.waitForTimeout(250);
      const geom=await page.evaluate(()=>{
        const de=document.documentElement,dv=document.querySelector('.divider-text'),panel=dv&&dv.closest('.panel');
        const mid=el=>{const r=el.getBoundingClientRect();return r.left+r.width/2;};
        // 內容不可貼著卡片左邊框：量測標題／表單相對於面板左緣的內縮
        const insets=[...document.querySelectorAll('#main .panel')].map(p=>{
          const b=p.getBoundingClientRect();
          const kid=[...p.querySelectorAll(':scope > *')].find(k=>k.getBoundingClientRect().height>1);
          return kid?Math.round(kid.getBoundingClientRect().left-b.left):null;
        });
        return {sw:de.scrollWidth,iw:innerWidth,label:dv&&dv.querySelector('span')?mid(dv.querySelector('span')):null,panel:panel?mid(panel):null,insets};
      });
      assert.ok(geom.sw<=geom.iw,`日曆在 ${w}px / ${fs||'normal'} 不應橫向溢出`);
      assert.ok(Math.abs(geom.label-geom.panel)<=1,`提醒事項分隔線標籤應在面板中央（${w}px / ${fs||'normal'}）`);
      for(const inset of geom.insets){
        assert.ok(inset>=15,`日曆卡片內容不應貼左邊框（${w}px / ${fs||'normal'} 實測內縮 ${inset}px）`);
      }
    }
  }
  await page.evaluate(()=>delete document.documentElement.dataset.fs);
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>navigate('calendar'));
  await page.waitForTimeout(300);
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
  // 選擇題在練習頁只能點選作答：題目區不重複列選項、沒有模式頁籤、沒有數學鍵盤
  await page.locator('#choice-picker').waitFor({timeout:5000});
  assert.equal(await page.locator('.practice-question .choice-options').count(), 0, '選擇題不應在題目區重複顯示選項清單');
  assert.equal(await page.locator('.practice-tabs').count(), 0, '選擇題只有一種作答方式，不應顯示模式頁籤');
  assert.equal(await page.locator('#math-keyboard').isVisible(), false, '選擇題不應出現數學鍵盤');
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
  assert.match(await page.locator('[data-field=analysis]').inputValue(),/題型為選擇題/,'應顯示題目分析');
  assert.equal((await page.locator('.draft-card [data-field=steps]').inputValue()).split('\n').filter(Boolean).length,1,'應顯示詳解步驟');
  assert.equal(await page.locator('.draft-card [data-rubric-label]').count(),0,'未提供評分標準時不應有項目');
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

  // 評分標準編輯器：可增刪、即時顯示總和、總和不是 100% 會標示
  assert.equal(await page.locator('[data-rubric-list="manual"] [data-rubric-label]').count(), 0, '預設沒有評分標準');
  await page.locator('[data-rubric-add="manual"]').click();
  await page.locator('[data-rubric-list="manual"] [data-rubric-label]').last().fill('正確列式');
  await page.locator('[data-rubric-list="manual"] [data-rubric-percent]').last().fill('60');
  assert.match(await page.locator('[data-rubric-total="manual"]').innerText(), /總和 60%/, '應即時顯示百分比總和');
  assert.ok(await page.locator('[data-rubric-total="manual"]').evaluate(el=>el.classList.contains('bad')), '總和不是 100% 應標示為錯誤');
  await page.locator('[data-rubric-add="manual"]').click();
  await page.locator('[data-rubric-list="manual"] [data-rubric-label]').last().fill('求解正確');
  await page.locator('[data-rubric-list="manual"] [data-rubric-percent]').last().fill('40');
  assert.match(await page.locator('[data-rubric-total="manual"]').innerText(), /總和 100%/, '總和 100% 應顯示正確');
  assert.equal(await page.locator('[data-rubric-total="manual"]').evaluate(el=>el.classList.contains('bad')), false, '總和 100% 不應標示錯誤');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-評分標準.png'),fullPage:true});

  // AI 生成答案：填入答案、詳解、詳細解釋與評分標準（百分比）
  await page.locator('#manual-answer').fill('');
  await page.locator('#manual-ai-answer').click();
  await page.locator('[data-rubric-list="manual"] [data-rubric-label]').first().waitFor({timeout:8000});
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#manual-answer').inputValue(), '$x=2$ 或 $x=3$', 'AI 應填入參考答案');
  assert.equal((await page.locator('#manual-steps').inputValue()).split('\n').filter(Boolean).length, 3, 'AI 應填入詳解步驟');
  assert.match(await page.locator('#manual-analysis').inputValue(), /因式分解/, 'AI 應填入詳細解釋');
  assert.equal(await page.locator('[data-rubric-list="manual"] [data-rubric-label]').count(), 3, 'AI 應填入 3 項評分標準');
  assert.match(await page.locator('[data-rubric-total="manual"]').innerText(), /總和 100%/, 'AI 的評分標準應正規化為 100%');
  assert.equal(aiAnswerPayload.consentExternal, true, '呼叫 AI 生成答案應帶外部上傳同意旗標');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-AI生成答案.png'),fullPage:true});

  await page.locator('#figure-canvas').scrollIntoViewIfNeeded();
  const fbox=await page.locator('#figure-canvas').boundingBox();
  await page.locator('[data-fig-tool=pen]').click();
  await page.mouse.move(fbox.x+70,fbox.y+40);await page.mouse.down();await page.mouse.move(fbox.x+200,fbox.y+150,{steps:8});await page.mouse.up();
  await page.mouse.move(fbox.x+200,fbox.y+150);await page.mouse.down();await page.mouse.move(fbox.x+70,fbox.y+150,{steps:8});await page.mouse.up();
  assert.match(await page.locator('#fig-status').innerText(),/已繪製圖形/,'畫圖後應提示已繪製');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-手動輸入題目.png'),fullPage:true});
  await page.locator('#manual-add').click();
  await page.locator('.draft-card').first().waitFor();
  assert.equal(await page.locator('.draft-card').count(),2,'應保留先前拆分草稿並加入手動題目');
  // 草稿卡保留 AI 產生的詳解、詳細解釋與評分標準；匯入前總和必須為 100%
  const manualCard = page.locator('.draft-card').last();
  assert.equal((await manualCard.locator('[data-field=steps]').inputValue()).split('\n').filter(Boolean).length, 3, '草稿卡應帶入詳解步驟');
  assert.match(await manualCard.locator('[data-field=analysis]').inputValue(), /因式分解/, '草稿卡應帶入詳細解釋');
  assert.equal(await manualCard.locator('[data-rubric-label]').count(), 3, '草稿卡應帶入 3 項評分標準');
  await manualCard.locator('[data-rubric-percent]').first().fill('10');
  await page.locator('#confirm-drafts').check();
  await page.locator('#save-drafts').click();
  await page.waitForTimeout(400);
  assert.match(await page.locator('#import-error').innerText(), /總和必須等於 100/, '評分標準總和錯誤應擋下匯入');
  await manualCard.locator('[data-rubric-percent]').first().fill('30');
  await page.waitForTimeout(200);
  assert.match(await manualCard.locator('[data-rubric-total]').innerText(), /總和 100%/, '修正後總和應為 100%');
  assert.match(await page.locator('.draft-figure img').getAttribute('src'),/^data:image\/(png|webp);base64,/,'草稿應顯示手繪圖形（PNG 或 WebP）');
  await page.locator('#confirm-drafts').check();
  await page.locator('#save-drafts').click();
  await page.locator('.success-panel').waitFor();
  assert.ok(importedQuestions&&importedQuestions.length===2,'應匯入2題（拆分草稿＋手動題目）');
  const manualQ=importedQuestions.find(q=>q.source==='手動輸入');
  assert.ok(manualQ,'應包含手動輸入的題目');
  assert.equal(manualQ.title,'直角三角形求斜邊');
  assert.equal(manualQ.qtype,'解答題','手動輸入應帶題型');
  assert.ok(/^data:image\/(png|webp);base64,/.test(manualQ.figure),'匯入必須帶題目圖形（PNG 或 WebP）');
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
  assert.deepEqual(bulkSent.students.map(x=>x.username),['s3a01','s3a02'],'批次匯入應送出學號');
  assert.deepEqual(bulkSent.students.map(x=>x.name),['陳大文','李小美'],'姓名應一併送出');

  // ── 只有學號、班內號、密碼（不匯入名字）──
  await page.locator('#bulk-order').selectOption('username_seat_password');
  await page.locator('#bulk-students').fill('s3a11,11,MathPass1234\ns3a12,12,MathPass1234\ns3a13,13');
  assert.equal(await page.locator('#bulk-error').innerText(),'','學號,班內號,密碼 不應有格式錯誤');
  const preview=await page.locator('#bulk-preview').innerText();
  assert.match(preview,/將建立 3 個帳戶/);
  assert.match(preview,/學號 · 班內號 · 密碼/);
  assert.match(preview,/3 個未填姓名（以學號顯示）/);
  assert.match(preview,/1 個自動產生密碼/);
  const previewRows=await page.locator('#bulk-preview-table tbody tr').allInnerTexts();
  assert.equal(previewRows.length,3,'預覽表應列出三列');
  assert.match(previewRows[0].replace(/\s+/g,' '),/s3a11 11 s3a11 已填/,'有班內號且未填姓名時，顯示名稱用學號');
  assert.match(previewRows[2].replace(/\s+/g,' '),/s3a13 13 s3a13 自動產生/);
  await page.screenshot({path:path.join(__dirname,'..','MathPath-學號班內號匯入.png'),fullPage:true});
  // 班內號格式錯誤要擋下來
  await page.locator('#bulk-students').fill('s3a41,四號,MathPass1234');
  assert.match(await page.locator('#bulk-error').innerText(),/班內號/);
  // 標題列會自動辨識欄位（自動判斷）
  await page.locator('#bulk-order').selectOption('auto');
  await page.locator('#bulk-students').fill('學號,班內號,密碼\ns3a21,21,MathPass1234\ns3a22,22');
  assert.equal(await page.locator('#bulk-error').innerText(),'','標題列應被辨識並略過');
  assert.match(await page.locator('#bulk-preview').innerText(),/將建立 2 個帳戶/);
  // 沒有標題列也要能自動判斷出 學號,班內號,密碼
  await page.locator('#bulk-students').fill('s3a31,31,MathPass1234');
  assert.equal(await page.locator('#bulk-error').innerText(),'','三欄英數格式應自動判斷為學號,班內號,密碼');
  assert.match(await page.locator('#bulk-preview').innerText(),/學號 · 班內號 · 密碼/);
  // 實際送出：班內號要帶上，姓名留空由伺服器以學號補上
  await page.locator('#bulk-order').selectOption('username_seat_password');
  await page.locator('#bulk-students').fill('s3a11,11,MathPass1234\ns3a12,12');
  await page.locator('#bulk-submit').click();
  // 等第二次匯入的結果（用學號辨識，避免讀到第一次的舊結果）
  await page.waitForFunction(()=>document.querySelector('#bulk-result').innerText.includes('s3a11'));
  assert.deepEqual(bulkSent.students.map(x=>x.username),['s3a11','s3a12']);
  assert.deepEqual(bulkSent.students.map(x=>x.seat),['11','12'],'班內號應一併送出');
  assert.deepEqual(bulkSent.students.map(x=>x.name),['',''],'姓名留空時送空字串，由伺服器以學號補上');
  const seatResult=await page.locator('#bulk-result').innerText();
  assert.match(seatResult,/2 個未填姓名，以學號顯示/);
  assert.match(seatResult,/學號\s+班內號\s+密碼/,'複製文字應含班內號欄');
  assert.match(seatResult,/s3a11\s+11/);

  // ── 編輯學生 ──
  const editBtn=page.locator('[data-edit-user]').first();
  assert.equal(await editBtn.count(),1,'每列學生要有編輯按鈕');
  await editBtn.click();
  await page.locator('#student-edit-form').waitFor();
  await page.locator('#edit-name').fill('陳大文');
  await page.locator('#edit-seat').fill('7');
  await page.locator('#student-edit-form button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#student-edit-form')===null);
  assert.deepEqual(editSent.body,{name:'陳大文',seat:'7'},'只送出有改動的欄位');
  // 重設密碼會一起送出，並提示已登出該生
  await page.locator('[data-edit-user]').first().click();
  await page.locator('#edit-password').fill('BrandNewPass99');
  await page.locator('#student-edit-form button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#student-edit-form')===null);
  assert.deepEqual(editSent.body,{password:'BrandNewPass99'});
  assert.match(await page.locator('#toast').innerText(),/已登出該生目前的登入/);

  await page.locator('[data-action=close-modal]').click();

  // ── 設定與隱私：資料管理（教師專用）──
  await page.waitForFunction(()=>{const el=document.querySelector('#admin-stats');return el&&/3000 題/.test(el.innerText);});
  const adminText=await page.locator('#admin-stats').innerText();
  assert.match(adminText,/題庫題目/);assert.match(adminText,/3000 題/);
  assert.match(adminText,/作答紀錄/);assert.match(adminText,/2500 筆/);
  assert.match(adminText,/15\.0 MB/,'資料庫大小應以可讀單位呈現');
  assert.match(adminText,/跨學年保留/);
  const downloads=await page.locator('[data-admin-download]').evaluateAll(els=>els.map(e=>e.dataset.adminDownload));
  assert.deepEqual(downloads,['/api/admin/backup/db','/api/admin/archive/questions',
    '/api/admin/archive/students','/api/admin/archive/students?images=0'],'應有四個下載入口');
  const dangerText=await page.locator('.danger-zone').innerText();
  assert.match(dangerText,/學生帳號、班級、作業、所有作答與手寫圖、模擬測驗、訂正紀錄/);
  assert.match(dangerText,/題庫（3000 題）、教師帳號、內建演示帳號、日曆提醒/,'要明講題庫保留');
  await page.locator('#admin-vacuum').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('已壓實'));
  assert.equal(vacuumCalled,1,'壓實資料庫應呼叫一次');
  // 未輸入確認字串不可重置
  await page.locator('#admin-reset').click();
  assert.match(await page.locator('#reset-error').innerText(),/RESET/);
  assert.equal(resetSent,null,'未輸入確認字串時不應送出重置請求');
  // 輸入 RESET 後才送出（會再跳一次確認對話框，測試已自動接受）
  await page.locator('#reset-confirm').fill('reset');
  await page.locator('#admin-reset').click();
  for(let i=0;i<50&&!resetSent;i++)await page.waitForTimeout(100);
  assert.deepEqual(resetSent,{confirm:'reset'},'重置應送出確認字串');
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('學年重置完成'));
  await page.screenshot({path:path.join(__dirname,'..','MathPath-資料管理.png'),fullPage:true});

  // ── 從歸檔還原 ──
  assert.equal(await page.locator('#restore-replace').count(),1);
  assert.equal(await page.locator('#restore-db-btn').count(),1);
  await page.locator('#restore-questions-file').setInputFiles({name:'questions.json',mimeType:'application/json',
    buffer:Buffer.from('{"format":"mathpath-question-archive","questions":[]}')});
  await page.locator('#restore-questions-btn').click();
  await page.waitForFunction(()=>document.querySelector('#restore-questions-result').innerText.includes('題庫還原完成'));
  assert.equal(restoreSent.questions.bytes>0,true,'題庫歸檔要真的上傳');
  assert.equal(restoreSent.questions.replace,null,'預設是合併，不帶 replace');
  assert.match(await page.locator('#restore-questions-result').innerText(),/新增 3 題/);
  // 勾選整批取代會帶上 replace=1（並跳一次確認對話框，測試已自動接受）
  await page.locator('#restore-replace').check();
  await page.locator('#restore-questions-btn').click();
  await page.waitForFunction(()=>document.querySelector('#restore-questions-result').innerText.includes('歸檔共 16 題'));
  assert.equal(restoreSent.questions.replace,'1');
  // 還原學生作業：帶共用密碼、顯示產生的帳密表
  await page.locator('#restore-password').fill('FjdatfcsXnig');
  await page.locator('#restore-students-file').setInputFiles({name:'students.jsonl',mimeType:'application/x-ndjson',
    buffer:Buffer.from('{"format":"mathpath-student-archive"}\n')});
  await page.locator('#restore-students-btn').click();
  await page.waitForFunction(()=>document.querySelector('#restore-students-result').innerText.includes('學生作業還原完成'));
  assert.equal(restoreSent.students.password,'FjdatfcsXnig');
  assert.equal(restoreSent.students.bytes>0,true,'學生歸檔要真的上傳');
  assert.match(await page.locator('#restore-students-result').innerText(),/s3a01/);
  assert.match(await page.locator('#restore-students-result').innerText(),/題號已依題庫還原對照表換算/);
  assert.equal(await page.locator('#restore-copy').count(),1,'要能複製帳密');
  await page.locator('#restore-students-result').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(__dirname,'..','MathPath-還原歸檔.png'),fullPage:true});

  // 學生看不到資料管理區塊
  await page.locator('#account').click();await page.locator('#logout-btn').click();await page.waitForSelector('#homework-login');
  await login('student');
  await page.locator('[data-page=settings]').first().click();
  await page.locator('.settings-layout').waitFor();
  assert.equal(await page.locator('#admin-reset').count(),0,'學生不應看到學年重置');
  assert.equal(await page.locator('[data-admin-download]').count(),0,'學生不應看到歸檔下載');
  await page.locator('#account').click();await page.locator('#logout-btn').click();await page.waitForSelector('#homework-login');
  await login('teacher');

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
  // AI 建議評分是教師的決定：佈置作業時由教師勾選，且必須明示「僅供教師覆核」。
  assert.equal(await page.locator('#assignment-ai').count(),1,'教師佈置作業應有 AI 建議評分選項');
  assert.equal(await page.locator('#assignment-ai').isDisabled(),false,'已接入 AI 時教師可啟用 AI 建議評分');
  assert.match(await page.locator('#assignment-ai').locator('xpath=..').innerText(),/僅供教師覆核/);
  await page.locator('#assignment-ai').check();
  await page.screenshot({path:path.join(__dirname,'..','MathPath-AI批改由教師選擇.png'),fullPage:true});
  await page.locator('[name=assignment-questions]').first().check();
  await page.locator('#assignment-form button[type=submit]').click();
  await page.waitForFunction(()=>!document.querySelector('#modal-root .modal'));
  assert.equal(durationSent.kind,'quiz','應以測驗類型發布');
  assert.equal(durationSent.durationMinutes,30,'教師設定的時間限制應送出');
  assert.equal(durationSent.aiGrading,true,'AI 建議評分應由教師決定並送出');

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
  assert.match(quizResult,/教師已批閱/);assert.match(quizResult,/6 \/ 6 分/);assert.match(quizResult,/100%/);
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
  // ── 填空題：只有手寫／文字作答，文字作答提供數學鍵盤與即時排版預覽 ──
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#account').click();await page.locator('#logout-btn').click();await page.locator('#homework-login').waitFor();
  await login('student');
  const blankQuestion={id:77,title:'填空題測試',content:'解方程 $x^2-9=0$，$x=$ ____。',topic:'一元二次方程',grade:'中三',
    points:4,level:1,qtype:'填空題',source:'校本題庫',tags:[],hint:'',answer:'$x=\\pm 3$',steps:[],options:[]};
  // 覆寫 /api/state：只回一題填空題（後註冊的路由優先）
  await page.route('**/api/state', route => route.fulfill({json:{
    user:{id:1,name:'介面測試學生',role:'student'},
    questions:[blankQuestion],
    attempts:[graded(1,1,'一元二次方程',6,6)],
    stats:{completed:1,accuracy:100,streak:1,minutes:5},
    ai:{configured:true,mode:'local'},
    topics:['一元二次方程']
  }}));
  await page.reload({waitUntil:'networkidle'});
  await page.locator('[data-page=bank]').first().click();
  await page.locator('.question-card').first().waitFor({timeout:8000});
  await page.locator('.question-card').first().locator('.practice-btn').click();
  await page.locator('#answer-area').waitFor({timeout:8000});
  assert.deepEqual((await page.locator('.practice-tabs button').allInnerTexts()).map(t=>t.trim()),
    ['手寫解題','文字作答'], '填空題應只有手寫解題與文字作答');
  // 自主練習（題庫直接練習）：一律 AI 即時評分並記錄分數，不需教師批閱；學生沒有 AI 批改選項。
  assert.equal(await page.locator('#use-ai').count(),0,'學生不應有「使用 AI 批改」的勾選項');
  assert.match(await page.locator('#main').innerText(),/自主練習由 AI 即時評分並記錄分數/);
  assert.match(await page.locator('#submit-answer').innerText(),/提交並評分/);
  await page.locator('[data-answer-mode=text]').click();
  await page.locator('#math-keyboard').waitFor({state:'visible',timeout:5000});
  assert.ok(await page.locator('.mk-key').count() >= 40, '數學鍵盤應提供多個符號鍵');
  assert.ok(await page.locator('.mk-tab').count() >= 5, '數學鍵盤應有多個分類');
  // 數學鍵盤必須位於最終答案輸入框上方
  const order = await page.evaluate(() => {
    const kb = document.querySelector('#math-keyboard'), input = document.querySelector('#final-answer');
    return kb.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING ? 'keyboard-first' : 'input-first';
  });
  assert.equal(order, 'keyboard-first', '數學鍵盤應出現在最終答案框上方');
  // 希臘字母分類（MathType 式直觀輸入）
  await page.locator('.mk-tab', {hasText:'希臘'}).click();
  assert.ok(await page.locator('.mk-panel[data-mk-panel=greek] .mk-key').count() >= 30, '希臘字母分類應有完整字母表');
  // 點「分數」插入 \frac{}{} 並把游標放進第一個大括號，補成 \frac{1}{2}
  await page.locator('.mk-tab', {hasText:'分數'}).click();
  await page.locator('.mk-key', {hasText:'分數'}).first().click();
  assert.equal(await page.locator('#final-answer').inputValue(), '\\frac{}{}', '應插入分數語法');
  const caret = await page.evaluate(() => { const i=document.querySelector('#final-answer'); const c=i.selectionStart;
    return {before:i.value.slice(0,c), at:i.value[c]}; });
  assert.equal(caret.before.endsWith('{'), true, '游標應落在第一個大括號內');
  assert.equal(caret.at, '}', '游標應緊貼大括號右邊界之前');
  await page.keyboard.type('1');
  await page.locator('#final-answer').evaluate(el => { const i=el.value.lastIndexOf('{}'); el.setSelectionRange(i+1,i+1); });
  await page.keyboard.type('2');
  assert.equal(await page.locator('#final-answer').inputValue(), '\\frac{1}{2}', '應完成分數輸入');
  assert.ok(await page.locator('#final-answer-preview .katex').count() > 0, '預覽應以 KaTeX 渲染輸入的數學式');
  // 切到「手寫解題」後鍵盤隱藏，但已輸入的數學式仍要以排版結果顯示，
  // 否則學生只會看到 \frac{1}{2} 這種原始語法（容易誤解成亂碼）。
  await page.locator('[data-answer-mode=hand]').click();
  assert.equal(await page.locator('#math-keyboard').isVisible(), false, '手寫解題不應顯示數學鍵盤');
  assert.equal(await page.locator('#final-answer-preview').isVisible(), true, '手寫解題仍應顯示排版預覽');
  assert.ok(await page.locator('#final-answer-preview .katex').count() > 0, '預覽應顯示已輸入數學式的排版結果');
  await page.locator('[data-answer-mode=text]').click();
  assert.equal(await page.locator('#math-keyboard').isVisible(), true, '切回文字作答應再顯示數學鍵盤');
  // 切換分類後可插入其他符號
  await page.locator('.mk-tab', {hasText:'集合'}).click();
  await page.locator('.mk-key', {hasText:'ℝ'}).click();
  assert.match(await page.locator('#final-answer').inputValue(), /\\mathbb\{R\}/, '應插入實數符號');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-數學鍵盤.png'),fullPage:true});

  // ── 是否由 AI 批改：由教師在佈置作業時決定，學生不能自行選擇 ──
  const studentState = extra => route => route.fulfill({json:{
    user:{id:1,name:'介面測試學生',role:'student'},
    questions:[blankQuestion],
    attempts:[graded(1,1,'一元二次方程',6,6)],
    stats:{completed:1,accuracy:100,streak:1,minutes:5},
    ai:{configured:true,mode:'external'},
    topics:['一元二次方程'],...extra}});
  const openAssignmentQuestion=async()=>{
    await page.locator('[data-assignment]').first().click();
    await page.locator('[data-assignment-q]').click();
    await page.locator('#answer-area').waitFor({timeout:8000});
  };
  const assignmentDetail = aiGrading => route => route.fulfill({json:{
    assignment:{...assignment,aiGrading},
    questions:[assignmentQuestion],
    attempts:[],
    mySubmission:{status:'not_started',submittedAt:null,resubmittedAt:null,submitCount:0,late:false,correction:null},
    report:{score:null,maxScore:6,totalScoredPoints:0,pendingCount:0,confirmedScore:null,confirmedCount:0,topicStats:[],suggestion:advice}}});

  // 情境一：教師沒有啟用 AI → 學生只看到唯讀說明，沒有可勾選的 AI 選項
  await page.route('**/api/state', studentState({}));
  await page.route('**/api/assignments/1', assignmentDetail(false));
  await page.reload({waitUntil:'networkidle'});
  await openAssignmentQuestion();
  assert.equal(await page.locator('#use-ai').count(),0,'學生不應再有「使用 AI 批改」的勾選項');
  assert.equal(await page.locator('#consent-ai').count(),0,'未啟用 AI 的作業不應要求外部 AI 同意');
  assert.match(await page.locator('#main').innerText(),/本份作業由教師設定不使用 AI 批改/);
  assert.equal((await page.locator('#submit-answer').innerText()).includes('批閱'),false,'未啟用 AI 時不應寫「提交與批閱」');
  assert.match(await page.locator('#submit-answer').innerText(),/提交作答/);

  // 情境二：教師啟用了 AI 建議評分 → 學生看到唯讀說明，外部模型仍需同意資料傳送
  await page.route('**/api/assignments/1', assignmentDetail(true));
  await page.reload({waitUntil:'networkidle'});
  await openAssignmentQuestion();
  assert.equal(await page.locator('#use-ai').count(),0,'學生仍不應有 AI 批改選項');
  assert.match(await page.locator('#main').innerText(),/由教師設定使用 AI 建議評分/);
  assert.match(await page.locator('#submit-answer').innerText(),/提交與批閱/);
  assert.equal(await page.locator('#consent-ai').count(),1,'外部模型需學生同意資料傳送');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-AI批改由教師決定.png'),fullPage:true});

  // ── 作業：做完題目並提交後，要等教師批閱才看得到評分與 AI 批閱結果 ──
  const awaitingAttempt = {...handwritten, score:null, status:'pending', gradingMethod:'awaiting-review',
    awaitingReview:true, feedback:'', steps:[], suggestion:null, aiScore:null, ruleScore:null, confirmedScore:null};
  const awaitingReport = {score:null,maxScore:6,totalScoredPoints:0,pendingCount:1,confirmedScore:null,
    confirmedCount:0,gradedCount:0,questionCount:1,percent:null,topicStats:[],suggestion:null,awaitingReview:true};
  await page.route('**/api/state', route => route.fulfill({json:{
    user:{id:1,name:'介面測試學生',role:'student'}, questions:[blankQuestion], attempts:[awaitingAttempt],
    stats:{completed:0,accuracy:0,streak:0,minutes:0}, ai:{configured:true,mode:'external'}, topics:['一元二次方程']}}));
  // 情境三：已提交但教師未批閱 → 作業頁與作答紀錄都看不到分數與 AI 結果
  await page.route('**/api/assignments/1', route => route.fulfill({json:{
    assignment:{...assignment,aiGrading:true}, questions:[assignmentQuestion], attempts:[awaitingAttempt],
    mySubmission:{status:'submitted',submittedAt:stamp,resubmittedAt:null,submitCount:1,late:false,correction:null},
    report:awaitingReport}}));
  await page.reload({waitUntil:'networkidle'});
  await page.locator('[data-assignment]').first().click();
  await page.locator('.assignment-question-row').first().waitFor({timeout:8000});
  const awaitingText = await page.locator('#main').innerText();
  assert.match(awaitingText, /等待教師批閱/);
  assert.match(awaitingText, /教師批閱後才會顯示分數/);
  assert.equal(/已評\s*\d/.test(awaitingText), false, '教師批閱前不應顯示已評分數');
  assert.match(await page.locator('[data-review]').first().innerText(), /查看我的作答/);
  await page.locator('[data-review]').first().click();
  const reviewText = await page.locator('#modal-root').innerText();
  assert.match(reviewText, /教師批閱後才會顯示分數/);
  assert.equal(reviewText.includes('AI 原建議分'), false, '批閱前不應顯示 AI 原建議分');
  await page.locator('[data-action=close-modal]').click();
  await page.screenshot({path:path.join(__dirname,'..','MathPath-作業等待教師批閱.png'),fullPage:true});

  // 情境四：在作業中提交一題 → 結果卡只顯示「等待教師批閱」，沒有分數與參考答案
  await page.route('**/api/attempts', route => route.request().method()==='POST'
    ? route.fulfill({json:{attempt:awaitingAttempt,solution:null}}) : route.fallback());
  await page.route('**/api/assignments/1', route => route.fulfill({json:{
    assignment:{...assignment,aiGrading:true}, questions:[assignmentQuestion], attempts:[],
    mySubmission:{status:'not_started',submittedAt:null,resubmittedAt:null,submitCount:0,late:false,correction:null},
    report:{...awaitingReport,pendingCount:0,awaitingReview:false}}}));
  await page.reload({waitUntil:'networkidle'});
  await openAssignmentQuestion();
  await page.locator('[data-answer-mode=text]').click();
  await page.locator('#final-answer').fill('x=2 或 x=3');
  await page.locator('#consent-ai').check();
  await page.locator('#submit-answer').click();
  await page.locator('#result-root .result').waitFor({timeout:8000});
  const submittedResult = await page.locator('#result-root').innerText();
  assert.match(submittedResult, /已提交，等待教師批閱/);
  assert.equal(await page.locator('#result-root .result-score').count(), 0, '結果卡不應顯示分數');
  assert.equal(await page.locator('#result-root .solution-box').count(), 0, '批閱前不應顯示參考答案與詳解');
  assert.equal(await page.locator('#result-root .result-step').count(), 0, '批閱前不應顯示逐項評分');

  // ── 教師批閱：評語可留空；一鍵 AI 全部批閱；教師側邊欄無自主練習 ──
  const practiceQuestions=[
    {id:101,title:'解一元二次方程',content:'解方程 $x^2-5x+6=0$。',topic:'一元二次方程',subtopic:'因式分解法',grade:'中三',points:6,level:1,qtype:'解答題',source:'校本題庫',tags:[],hint:''},
    {id:102,title:'選出正確的根',content:'下列何者為 $x^2=4$ 的根？',topic:'一元二次方程',subtopic:'因式分解法',grade:'中三',points:4,level:1,qtype:'選擇題',source:'校本題庫',tags:[],hint:'',options:['$x=2$','$x=-2$','$x=2$ 或 $x=-2$','$x=4$']},
    {id:103,title:'一次函數求值',content:'已知 $f(x)=2x+1$，求 $f(3)$。',topic:'函數',subtopic:'一次函數',grade:'中三',points:4,level:1,qtype:'填空題',source:'校本題庫',tags:[],hint:''},
  ];
  // 依目前登入身分回應狀態（覆寫前面學生情境用的固定狀態）。
  await page.route('**/api/state', route => route.fulfill({json:{
    user: role?{id:role==='teacher'?2:1,name:role==='teacher'?'介面測試教師':'介面測試學生',role}:null,
    questions:practiceQuestions, attempts:[], stats:{completed:0,accuracy:0,streak:0,minutes:0},
    ai:{configured:true,mode:'local'}, topics:['一元二次方程','函數']}}));
  await page.locator('#account').click();await page.locator('#logout-btn').click();await page.waitForSelector('#homework-login');
  await login('teacher');
  assert.equal(await page.locator('#nav [data-page=practice]').count(),0,'教師側邊欄不應出現自主練習');
  assert.equal(await page.locator('#nav [data-page=ai]').count(),1,'教師側邊欄應有模型端點');
  assert.equal(await page.locator('#nav [data-page=import]').count(),1,'教師側邊欄應有試卷拆題');
  const resultsFixture = aiGrading => route => route.fulfill({json:{
    assignment:{...assignment,aiGrading},
    students:[{...student,status:'submitted',submittedAt:stamp,answeredCount:1,pendingCount:1,score:null,scoredPoints:0,confirmedScore:null,confirmedCount:0}],
    summary:{studentCount:1,submittedCount:1,correctionCount:0,fullyGradedCount:0,pendingReviewCount:1,averageScore:null,confirmedAverage:null},
    topicStats:[]}});
  // 一鍵 AI 全部批閱（只有教師啟用 AI 評分的作業才有此按鈕）
  await page.route('**/api/assignments/1', route => route.fulfill({json:{
    assignment:{...assignment,aiGrading:true}, questions:[assignmentQuestion], attempts:[attemptFixture()],
    mySubmission:{status:'submitted',submittedAt:stamp,resubmittedAt:null,submitCount:1,late:false,correction:null},
    report:{score:null,maxScore:6,totalScoredPoints:0,pendingCount:1,confirmedScore:null,confirmedCount:0,topicStats:[],suggestion:advice}}}));
  await page.route('**/api/assignments/1/results', resultsFixture(true));
  await page.locator('[data-page=homework]').first().click();
  await page.locator('[data-results]').first().click();
  await page.locator('#ai-review-all').waitFor({timeout:8000});
  await page.locator('#ai-review-all').click();
  await page.waitForTimeout(600);
  assert.ok(aiReviewSent,'應呼叫一鍵 AI 批閱端點');
  assert.equal(aiReviewSent.consentExternal,false,'本機模型不需外部傳送同意');
  assert.match(await page.locator('#toast').innerText(),/已批閱 2 題/,'應回報批次結果');
  // 教師覆核：只填分數、不寫評語也要能送出
  await page.locator('[data-student-result]').first().click();
  await page.locator('[data-hw-review]').first().click();
  await page.locator('#review-score').waitFor({timeout:8000});
  assert.equal(await page.locator('#review-feedback').getAttribute('required'),null,'評語欄不應必填');
  assert.match(await page.locator('label[for=review-feedback]').innerText(),/可留空/);
  await page.locator('#review-score').fill('5');
  await page.locator('#review-form button[type=submit]').click();
  await page.waitForFunction(()=>!document.querySelector('#modal-root .modal'));
  assert.equal(reviewSent.score,5);
  assert.equal(reviewSent.feedback,'','未填評語時應送出空字串');
  // 未啟用 AI 評分的作業不應出現一鍵批閱
  await page.route('**/api/assignments/1/results', resultsFixture(false));
  await page.locator('[data-page=homework]').first().click();
  await page.locator('[data-results]').first().click();
  await page.locator('#export-results').waitFor({timeout:8000});
  assert.equal(await page.locator('#ai-review-all').count(),0,'未啟用 AI 評分的作業不應有一鍵批閱');

  // ── 自主練習：可選章節（主／子分類）與題型 ──
  await page.locator('#account').click();await page.locator('#logout-btn').click();await page.waitForSelector('#homework-login');
  await login('student');
  await page.reload({waitUntil:'networkidle'});
  await page.locator('#nav [data-page=practice]').click();
  await page.locator('#pr-topic').waitFor({timeout:8000});
  assert.deepEqual((await page.locator('#pr-topic option').allInnerTexts()).map(t=>t.trim()),
    ['全部章節','一元二次方程','函數'],'自主練習應可選章節');
  assert.match(await page.locator('#pr-count').innerText(),/3 題符合/);
  assert.equal(await page.locator('#pr-subtopic').isDisabled(),true,'未選章節時子分類應停用');
  await page.locator('#pr-topic').selectOption('一元二次方程');
  await page.locator('#pr-subtopic').waitFor();
  assert.equal(await page.locator('#pr-subtopic').isDisabled(),false,'選了章節後子分類應可用');
  assert.deepEqual((await page.locator('#pr-subtopic option').allInnerTexts()).map(t=>t.trim()),
    ['全部子分類','因式分解法'],'子分類應隨章節連動');
  await page.locator('#pr-qtype').selectOption('選擇題');
  assert.match(await page.locator('#pr-count').innerText(),/1 題符合/,'題型篩選應生效');
  assert.equal(await page.locator('[data-pr-q]').count(),1);
  // 換章節後原本的題型已不存在，應自動放寬而不是顯示 0 題
  await page.locator('#pr-topic').selectOption('函數');
  await page.locator('#pr-count').waitFor();
  assert.match(await page.locator('#pr-count').innerText(),/1 題符合/,'換章節應自動放寬不合用的題型');
  await page.locator('#pr-start').click();
  await page.locator('#answer-area').waitFor({timeout:8000});
  assert.match(await page.locator('#main').innerText(),/一次函數求值/,'應開啟符合範圍的題目');
  assert.match(await page.locator('#main').innerText(),/自主練習/);
  // 可回到範圍選擇（保留原本條件）
  await page.locator('#change-range').click();
  await page.locator('#pr-topic').waitFor({timeout:8000});
  assert.equal(await page.locator('#pr-topic').inputValue(),'函數','換範圍應保留原本的章節');
  assert.match(await page.locator('#pr-count').innerText(),/1 題符合/);
  await page.screenshot({path:path.join(__dirname,'..','MathPath-自主練習範圍.png'),fullPage:true});

  assert.deepEqual(errors,[]);await browser.close();
  console.log('PASS: answer modes (choice = click-only with single option list, fill-in = handwriting/text with math keyboard + always-visible rendered preview), AI grading policy (self-practice = AI instant score recorded without teacher review, no student use-ai toggle; teacher checkbox on assign, student read-only hint, external consent; homework/quiz scores, AI results, solution and advice hidden until the teacher reviews), self-practice range picker (chapter + sub-chapter + question type, linked options, auto-widening, change-range keeps filters), teacher review with optional feedback, one-click AI review of a whole assignment (only for AI-enabled assignments), teacher sidebar without self-practice, calendar lower panel (centred divider label, panel content never flush to the card border, no horizontal overflow at 4 widths x 3 font scales), font scale switch (guest, persisted, 3 levels, no mobile overflow), login page (role cards, remember checked, remembered account), calendar (marks + entry from homework), question type (card badge, filter, draft qtype, rule analysis), full-auto split+import, homework, draft save/reload/restore, logout cleanup, weak-topic drill-down, results filters, CSV export, teacher annotation (pen/ellipse/arrow/highlight/undo/clear/save), AI suggested annotation with student read-back and teacher drag-to-adjust saved positions, correction loop (teacher return with note, student banner, pending guard, resubmit), self-serve mock exam (setup, countdown, per-question answer with mockId, submit + instant score + advice), AI endpoint page (test/save, key never read back), bulk student import (column-order auto-detect + header row, student id only with seat number and no name, generated passwords, per-line errors, class creation), data management (usage cards, four download entries, vacuum, school-year reset gated by a typed confirmation and hidden from students), student editing (only changed fields submitted, password reset warns about logout), archive restore (question merge vs replace, student archive with shared password and credential table), mobile layout, no JS errors. Fixture API only; no server started.');
})().catch(e=>{console.error(e);process.exit(1)});
