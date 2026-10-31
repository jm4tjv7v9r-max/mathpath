const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
function pngFrom(w,h,pixel){
  const crcTable=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;return c>>>0;});
  const crc=buf=>{let c=0xffffffff;for(const b of buf)c=crcTable[(c^b)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const cr=Buffer.alloc(4);cr.writeUInt32BE(crc(td));return Buffer.concat([len,td,cr]);};
  const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){for(let x=0;x<w;x++){const [r,g,b]=pixel(x,y);const o=y*(w*3+1)+1+x*3;raw[o]=r;raw[o+1]=g;raw[o+2]=b;}}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
function makePng(w,h){return pngFrom(w,h,()=>[238,244,238]);}
// 上方 60% 是「筆跡」、下方 40% 是空白紙：用來驗證 AI 印章與批語只落在空白處。
function makeInkPng(w,h,inkRatio=0.6){return pngFrom(w,h,(x,y)=>y<h*inkRatio?(y%6<4?[50,50,60]:[250,250,248]):[250,250,248]);}
const HANDWRITING=makePng(400,300);
const INK_HANDWRITING=makeInkPng(400,300);
const FULL_INK_HANDWRITING=makeInkPng(400,300,1);
// 試卷圖片：白底，右下角一塊紅色（模擬題目圖形）；用來驗證拆題只裁出圖形那一塊。
const PAPER_PNG=pngFrom(400,300,(x,y)=>(x>=200&&x<280&&y>=150&&y<210)?[220,40,40]:[252,252,250]);
(async () => {
  const browser = await chromium.launch({headless:true,args:['--disable-features=Rlz','--disable-background-networking','--disable-breakpad','--no-first-run','--no-default-browser-check']});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[],dialogs=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.message());d.accept();});
  await page.emulateMedia({reducedMotion:'reduce'});
  let role=null;
  const q={id:1,title:'因式分解解二次方程',content:'解方程 $x^2-5x+6=0$。',topic:'一元二次方程',grade:'中三',points:6,level:1,qtype:'選擇題',source:'校本題庫',tags:['因式分解'],hint:'利用零乘積性質。',answer:'C',createdAt:'2026-10-20T02:30:00Z',options:['$x=1$ 或 $x=6$','$x=-2$ 或 $x=-3$','$x=2$ 或 $x=3$','$x=1$ 或 $x=-6$'],steps:['分解為 $(x-2)(x-3)=0$。','概率為 $\\dfrac{1}{3}$，長度 $5\\text{ cm}$。']};
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
  let mockDeadline=new Date(Date.now()+900000).toISOString(),quizDeadline=new Date(Date.now()+1800000).toISOString();
  let calendarNotes=[],noteCreated=null;
  const assignmentQuestion={...q,qtype:'解答題',options:[]};
  const mockQuestion={id:11,title:'模擬題：直角三角形',content:'直角三角形兩邊長為3 cm及4 cm，求斜邊長。',topic:'幾何',level:1,grade:'中三',points:5,qtype:'解答題',hint:'用畢氏定理',source:'校本題庫',tags:['幾何']};
  const mockExam=()=>({id:7,topic:mockStarted&&mockStarted.topic||'幾何',level:null,qtype:'解答題',minutes:mockStarted?mockStarted.minutes:15,questionCount:1,createdAt:stamp,startedAt:stamp,expiresAt:mockDeadline,submittedAt:mockState&&mockState.submitted?stamp:null,expired:false,status:mockState&&mockState.submitted?'submitted':'in_progress',remainingSeconds:mockState&&mockState.submitted?0:(mockStarted?mockStarted.minutes*60:900)});
  const mockReport=()=>({score:5,maxScore:5,percent:100,totalScoredPoints:5,pendingCount:0,confirmedScore:null,confirmedCount:0,aiScore:null,ruleScore:5,topicStats:[{topic:'幾何',scoredCount:1,totalCount:1,score:5,maxScore:5,percent:100}],suggestion:advice,answeredCount:1});
  let quizStarted=false,quizSubmitted=false,quizStartSeen=0,durationSent=null;
  let reviewSent=null,aiReviewSent=null,bulkSent=null,resetSent=null,vacuumCalled=0,backupCalled=0;
  let editSent=null;const restoreSent={};let aiGenerated=null;let teacherCreated=null;
  const quizReport=()=>({score:quizSubmitted?6:null,maxScore:6,totalScoredPoints:quizSubmitted?6:0,pendingCount:0,confirmedScore:null,confirmedCount:0,gradedCount:quizSubmitted?1:0,questionCount:1,percent:quizSubmitted?100:null,aiScore:null,ruleScore:quizSubmitted?6:null,topicStats:[],suggestion:advice});
  const quizSub=()=>({status:quizSubmitted?'submitted':'not_started',submittedAt:quizSubmitted?stamp:null,resubmittedAt:null,submitCount:quizSubmitted?1:0,late:false,correction:null,startedAt:quizStarted?stamp:null,expiresAt:quizStarted?quizDeadline:null,remainingSeconds:quizStarted?1800:null,timeUsedSeconds:quizStarted?0:null,expired:false});
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
    if(url.pathname==='/api/mock'&&route.request().method()==='POST'){mockStarted=route.request().postDataJSON();mockDeadline=new Date(Date.now()+mockStarted.minutes*60000).toISOString();mockState={submitted:false};return route.fulfill({json:{exam:mockExam(),questions:[mockQuestion],notice:'已開始計時。'}});}
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
    const user=role?{id:role==='teacher'?2:1,name:role==='teacher'?'介面測試教師':'介面測試學生',role,isOwner:role==='teacher'}:null;
    if(url.pathname==='/api/session')data={user};
    else if(url.pathname==='/api/login'){const sent=route.request().postDataJSON();role=sent.username;rememberSent=sent.remember;data={user:{id:role==='teacher'?2:1,name:'介面測試',role,isOwner:role==='teacher'}};}
    else if(url.pathname==='/api/logout'){role=null;data={user:null};}
    else if(url.pathname==='/api/state')data={user,questions:[role==='teacher'?q:{...q,answer:undefined,steps:undefined}],attempts:role==='teacher'?[]:[graded(1,1,'一元二次方程',6,6),graded(2,2,'幾何',0,5)],stats:{completed:2,accuracy:55,streak:1,minutes:10},ai,topics:['一元二次方程','幾何']};
    else if(url.pathname==='/api/homework')data={classes:[{id:1,name:'中三甲班',studentCount:2,studentIds:[1,3]}],assignments:[assignment,quizAssignment],students:role==='teacher'?[student]:undefined,ai};
    else if(url.pathname==='/api/ai-config'&&route.request().method()==='POST'){const sent=route.request().postDataJSON();savedKeySeen=sent.apiKey??null;aiConfigSaved=sent;const off=!sent.baseUrl&&!sent.model;return route.fulfill({json:{active:{configured:!off,model:off?'':'local-text',vision:off?'':'local-vision',draw:off?'':'local-draw',drawCustom:!off,mode:off?'off':'local',source:off?'none':'saved'},saved:off?null:{baseUrl:sent.baseUrl,model:sent.model,visionModel:sent.visionModel,keySet:true}}});}
    else if(url.pathname==='/api/questions/ai-answer'){aiAnswerPayload=route.request().postDataJSON();return route.fulfill({json:{answer:'$x=2$ 或 $x=3$',steps:['寫成標準形式 $x^2-5x+6=0$。','分解為 $(x-2)(x-3)=0$。','得 $x=2$ 或 $x=3$。'],analysis:'考因式分解法；常見錯誤是符號處理不當。',rubric:[{label:'正確列式',percent:30},{label:'因式分解正確',percent:40},{label:'寫出兩個根',percent:30}],qtype:'解答題',options:[],method:'AI 生成'}});}
    else if(url.pathname==='/api/ai-config/economy'){const sent=route.request().postDataJSON();economySent=sent.economy;return route.fulfill({json:{active:{configured:true,model:'local-text',vision:'',mode:'local',source:'env',thinking:!sent.economy},economy:sent.economy}});}
    else if(url.pathname==='/api/ai-config/test'){const sent=route.request().postDataJSON();if(!sent.baseUrl||!sent.model)return route.fulfill({status:400,json:{error:'請提供端點與模型。'}});return route.fulfill({json:{ok:true,mode:'local',model:sent.model,testedVision:!!sent.vision}});}
    else if(url.pathname==='/api/ai-config')data={active:{configured:!!aiConfigSaved,model:aiConfigSaved?'local-text':'',vision:aiConfigSaved?'local-vision':'',draw:aiConfigSaved?'local-draw':'',drawCustom:!!aiConfigSaved,mode:aiConfigSaved?'local':'off',source:aiConfigSaved?'saved':'none'},canEdit:true,tokenRequired:false,invalidSaved:false,env:{baseUrl:'',model:'',visionModel:'',drawModel:'',keySet:false},saved:aiConfigSaved?{baseUrl:aiConfigSaved.baseUrl,model:aiConfigSaved.model,visionModel:aiConfigSaved.visionModel,drawModel:aiConfigSaved.drawModel,keySet:true}:null};
    else if(url.pathname==='/api/calendar'){const from=url.searchParams.get('from')||'';const pre=from.slice(0,8);const teacher=role==='teacher';
      data={from,to:url.searchParams.get('to'),events:[
        {date:`${pre}15`,event:'due',kind:'homework',title:'二次方程鞏固作業',assignmentId:1,classId:1,className:'中三甲班',dueAt:stamp,...(teacher?{submittedCount:1,studentCount:2}:{myStatus:'not_started'})},
        {date:`${pre}20`,event:'published',kind:'quiz',title:'一元二次方程測驗',assignmentId:2,classId:1,className:'中三甲班',dueAt:stamp,...(teacher?{submittedCount:0,studentCount:2}:{myStatus:'not_started'})}
      ],notes:calendarNotes};}
    else if(url.pathname==='/api/papers/parse'){parsedSeen=route.request().postDataJSON();data={method:'規則拆題',notice:'需要教師確認題目內容、分類、難度、分值和參考答案後才可匯入；識別不代表答案已核驗。',drafts:[{title:'自動卷 · 第1題',content:'已知集合 $A=\\{x\\mid -1<x\\le 3\\}$，求元素個數。',topic:'代數',subtopic:'',level:1,grade:'中三',qtype:'選擇題',points:6,answer:'$3$',steps:['元素為 $0,1,2,3$。'],hint:'數一數。',analysis:'規則分析：題型為選擇題，知識點為代數；參考答案留空，需教師核對。',source:'自動卷',tags:['教師待確認']}]};}
    else if(url.pathname==='/api/papers/auto-import'){autoImported=route.request().postDataJSON();return route.fulfill({json:{count:2,method:'規則拆題',questions:[],notice:'已全自動拆分並匯入題庫，全部標示為「自動匯入 · 待核驗」；請在題庫核對題型、分類與參考答案。'}});}
    else if(url.pathname==='/api/assignments/2/start'){quizStartSeen++;quizDeadline=new Date(Date.now()+1800000).toISOString();quizStarted=true;return route.fulfill({json:{mySubmission:quizSub()}});}
    else if(url.pathname==='/api/assignments/2/submit'){quizSubmitted=true;return route.fulfill({json:{report:{score:6,maxScore:6,totalScoredPoints:6,pendingCount:0,confirmedScore:null,confirmedCount:0,gradedCount:1,questionCount:1,percent:100,aiScore:null,ruleScore:6,topicStats:[],suggestion:advice},mySubmission:quizSub()}});}
    else if(url.pathname==='/api/assignments/2')data={assignment:quizAssignment,questions:[q],attempts:quizStarted?[graded(21,1,'一元二次方程',6,6)]:[],mySubmission:quizSub(),report:quizReport()};
    else if(url.pathname==='/api/assignments'&&route.request().method()==='POST'){durationSent=route.request().postDataJSON();return route.fulfill({json:{assignment:quizAssignment}});}
    else if(url.pathname==='/api/questions/import'){importedQuestions=route.request().postDataJSON().questions;return route.fulfill({json:{count:importedQuestions.length,questions:importedQuestions.map((qq,i)=>({id:50+i,...qq}))}});}
    else if(url.pathname==='/api/users')data={users:[{id:1,username:'student',name:'介面測試學生',role:'student',seat:'1',createdBy:2}],ownerId:2};
    else if(/^\/api\/users\/\d+\/update$/.test(url.pathname)){editSent={id:Number(url.pathname.split('/')[3]),body:route.request().postDataJSON()};return route.fulfill({json:{user:{id:editSent.id,username:editSent.body.username||'student',name:editSent.body.name||'介面測試學生',role:'student',seat:editSent.body.seat===undefined?'1':editSent.body.seat},changed:Object.keys(editSent.body),passwordReset:!!editSent.body.password,sessionsRevoked:editSent.body.password?1:0}});}
    else if(url.pathname==='/api/admin/restore/questions'){restoreSent.questions={replace:url.searchParams.get('replace'),bytes:route.request().postDataBuffer().length};return route.fulfill({json:{inserted:3,skipped:13,mapped:16,total:16,replaced:url.searchParams.get('replace')==='1',notice:'已保留原編號'}});}
    else if(url.pathname==='/api/admin/restore/students'){restoreSent.students={password:url.searchParams.get('password'),bytes:route.request().postDataBuffer().length};return route.fulfill({json:{written:{student:2,class:1,assignment:1,attempt:1},skipped:{},credentials:[{username:'s3a01',name:'s3a01',seat:'1',password:'FjdatfcsXnig',generated:false}],usedSharedPassword:true,unreadableImages:0,questionMapApplied:true,notice:'歸檔不含密碼'}});}
    else if(url.pathname==='/api/admin/restore/db'){restoreSent.db={bytes:route.request().postDataBuffer().length};return route.fulfill({json:{restored:true,keptPreviousAs:'mathpath.replaced-test.sqlite3',counts:{questions:3000,attempts:2500,users:100},notice:'已用備份取代資料庫'}});}
    else if(url.pathname==='/api/admin/storage')data={database:{bytes:15728640,reclaimableBytes:1048576,walBytes:32768},counts:{questions:3000,attempts:2500,users:100,classes:3,assignments:5,mock_exams:0,calendar_notes:0,sessions:12},images:{handwriting:1500,annotation:300,questionFigure:40,inDatabaseBytes:45088768,inObjectStorage:0,storageMode:'db'},lastStudentReset:null,questionBankKeptAcrossYears:true,backup:{storageMode:'db',configured:false,error:'',keep:14,count:0,lastAt:null,lastBytes:null,lastTrigger:null,lastFiles:[],intervalHours:0,history:[]}};
    else if(url.pathname==='/api/admin/backup/upload'){backupCalled++;
      return route.fulfill({json:{entry:{at:stamp,stamp:'20261014-1630-ab12',trigger:'manual',bytes:156281,
        files:[{kind:'db',name:'mathpath-db-20261014-1630-ab12.sqlite3',bytes:147456,key:'backups/mathpath-db-20261014-1630-ab12.sqlite3'},
               {kind:'questions',name:'mathpath-questions-20261014-1630-ab12.json',bytes:8825,key:'backups/mathpath-questions-20261014-1630-ab12.json'}]},
        kept:1,keep:14,pruned:0,
        status:{storageMode:'r2',configured:true,error:'',keep:14,count:1,lastAt:stamp,lastBytes:156281,lastTrigger:'manual',
          lastFiles:['mathpath-db-20261014-1630-ab12.sqlite3','mathpath-questions-20261014-1630-ab12.json'],intervalHours:6,
          history:[{at:stamp,bytes:156281,trigger:'manual',files:['mathpath-db-20261014-1630-ab12.sqlite3','mathpath-questions-20261014-1630-ab12.json']}]}}});}
    else if(url.pathname==='/api/admin/vacuum'){vacuumCalled+=1;return route.fulfill({json:{beforeBytes:15728640,afterBytes:10485760,savedBytes:5242880,at:stamp}});}
    else if(url.pathname==='/api/admin/reset/students'){resetSent=route.request().postDataJSON();return route.fulfill({json:{removed:{students:100,attempts:2500,classes:3,assignments:5,sessions:12},at:stamp,kept:{questions:3000,teachers:1,notice:'題庫、教師帳號、內建演示帳號與日曆提醒都保留。'},vacuum:{beforeBytes:15728640,afterBytes:1048576,savedBytes:14680064,at:stamp}}});}
    else if(url.pathname==='/api/users/bulk'){bulkSent=route.request().postDataJSON();return route.fulfill({json:{count:bulkSent.students.length,users:bulkSent.students.map((st,i)=>({id:5+i,username:st.username,name:st.name||st.username,role:'student',seat:st.seat||null}))}});}
    else if(url.pathname==='/api/classes')data={class:{id:2,name:route.request().postDataJSON().name,studentCount:2,studentIds:[5,6]}};
    else if(/^\/api\/questions\/\d+\/recommendations$/.test(url.pathname))data={similar:[],advanced:[]};
    else if(/^\/api\/questions\/\d+\/generate$/.test(url.pathname)){aiGenerated=route.request().postDataJSON();aiGenerated.qid=Number(url.pathname.split('/')[3]);return route.fulfill({json:{kind:aiGenerated.kind,notice:'這是 AI 生成的草稿，尚未加入題庫。請核對題目內容、分類與參考答案後，再決定是否加入。',draft:{title:'AI 生成 · 相似題',content:'解方程 $x^2-7x+12=0$。',topic:'一元二次方程',subtopic:'因式分解法',level:1,grade:'中三',points:6,qtype:'解答題',options:[],answer:'$x=3$ 或 $x=4$',steps:['分解為 $(x-3)(x-4)=0$。','得 $x=3$ 或 $x=4$。'],analysis:'考點是因式分解法，注意常數項與一次項的配對。',rubric:[{label:'正確分解 $x^2-7x+12=(x-3)(x-4)$',percent:60},{label:'寫出兩個根 $x=3$ 或 $x=4$',percent:40}],hint:'找乘積為 12、和為 7 的兩數。',tags:['待教師核驗'],source:'AI 生成 · 待核驗'}}});}
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

  // 新手上路：訪客就看得到（入口在頂欄快速連結，側欄已移除）
  assert.ok(await page.locator('.topbar-link[data-page=guide]').count() >= 1, '頂欄要有新手上路快速連結');
  assert.ok(await page.locator('.topbar-link[data-page=calendar]').count() >= 1, '頂欄要有日曆快速連結');
  assert.ok(await page.locator('.topbar-link[data-page=board]').count() >= 1, '頂欄要有排行榜快速連結');
  await page.locator('.topbar-link[data-page=guide]').click();
  await page.locator('.guide-step').first().waitFor({timeout:8000});
  assert.equal(await page.locator('.guide-step').count(),6,'新手上路應有 6 個步驟');
  assert.equal(await page.locator('.guide-svg').count(),6,'每一步都要有一張插圖');
  assert.equal(await page.locator('.guide-tip').count(),3,'要有「三個要知道的事」');
  assert.match(await page.locator('#crumb').innerText(),/新手上路/,'麵包屑要跟著換');
  assert.match(await page.locator('#main').innerText(),/訪客預覽/,'訪客要看到登入提示');
  assert.match(await page.locator('.guide-text h3').first().innerText(),/教師/,'訪客預設看第一版（老師）');
  await page.locator('[data-guide-role=student]').click();
  await page.locator('.guide-text h3').first().waitFor();
  assert.match(await page.locator('.guide-text h3').first().innerText(),/學生/,'可切到學生版');
  assert.match(await page.locator('#main').innerText(),/正式提交/,'學生版要提到提交');
  // 插圖用色系變數上色；變數沒生效時會退成黑色，這裡擋住那種情況
  const guideFills=await page.evaluate(()=>[...document.querySelectorAll('.guide-svg path,.guide-svg rect,.guide-svg circle')].map(e=>getComputedStyle(e).fill));
  assert.ok(!guideFills.includes('rgb(0, 0, 0)'),'插圖不應有未上色的黑色填色');
  // 說明彈窗也能進到指引頁
  await page.locator('#help-btn').click();
  await page.locator('#help-guide').click();
  await page.locator('.guide-step').first().waitFor({timeout:8000});
  assert.equal(await page.locator('.guide-step').count(),6,'從說明彈窗進入仍要有完整步驟');
  console.log('PASS: 新手上路（訪客可見、角色切換、每步一張插圖、說明彈窗可進入）');

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
  await page.locator('[data-assignment]').first().click();
  // 「開始解題」是每張題目卡片唯一的動作，要大到一眼看到（主色、白字、明顯比其他按鈕大）。
  const startBtn=page.locator('.assignment-question-row .practice-btn').first();
  await startBtn.waitFor({timeout:8000});
  const startStyle=await startBtn.evaluate(el=>{const s=getComputedStyle(el);return {bg:s.backgroundColor,color:s.color,size:parseFloat(s.fontSize),pad:parseFloat(s.paddingTop)};});
  assert.equal(startStyle.bg,'rgb(25, 124, 104)','「開始解題」要用主色');
  assert.equal(startStyle.color,'rgb(255, 255, 255)','主色按鈕要白字');
  assert.ok(startStyle.size>=15,`「開始解題」字級要加大（實際 ${startStyle.size}px）`);
  assert.ok(startStyle.pad>=10,`「開始解題」要加大內距（實際 ${startStyle.pad}px）`);
  await page.screenshot({path:path.join(__dirname,'..','MathPath-開始解題按鈕.png'),fullPage:true});
  await page.locator('[data-assignment-q]').click();
  assert.equal(await page.locator('#hand-canvas').count(),1,'手寫解題應顯示書寫區');assert.equal(await page.locator('#math-keyboard').count(),0,'作答頁已不再有數學鍵盤');await page.locator('[data-answer-mode=text]').click();assert.equal(await page.locator('#answer-process').count(),0,'文字作答不應再出現解題步驟輸入框');await page.locator('#final-answer').fill('x=2或3');
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
  // 待批 0 題的學生不需要「批閱與建議」，避免教師以為還有東西要批。
  const resultBtnTexts=await page.$$eval('.results-table [data-student-result]',bs=>bs.map(b=>b.innerText.trim()));
  assert.match(resultBtnTexts[0],/查看/,'待批 0 題時只寫「查看」');
  assert.doesNotMatch(resultBtnTexts[0],/批閱與建議/,'待批 0 題不該出現「批閱與建議」');
  assert.match(resultBtnTexts[1],/批閱與建議/,'有待批題目時才寫「批閱與建議」');

  await page.locator('[data-student-result]').first().click();
  await page.locator('[data-hw-review]').first().click();
  await page.locator('#ann-canvas').waitFor();
  await page.locator('#ai-annotate').click();
  await page.locator('.ai-annotation').waitFor();
  const aiText=await page.locator('.ai-annotation').innerText();
  assert.match(aiText,/AI 建議批註/);assert.match(aiText,/未經教師確認/);assert.match(aiText,/符號錯誤/);assert.match(aiText,/這裡應為負號/);
  assert.equal(await page.locator('#calc-root .calc-fab').count(),0,'計算機只給學生作答時用，教師不應看到');
  assert.equal(await page.locator('.ai-callout').count(),2,'AI 批語與總結都要畫在手稿上');
  assert.ok(await page.locator('.ai-callout.movable').count()>=1,'教師端的 AI 批語要能拖動');
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

  // 教師也可以直接拖動 AI 批語框（不只是圓標），並改寫 AI 寫錯的說明文字。
  const callout=page.locator('.ai-callout.issue').first();
  await callout.scrollIntoViewIfNeeded();
  const calloutBefore=await callout.boundingBox();
  await page.mouse.move(calloutBefore.x+calloutBefore.width/2,calloutBefore.y+calloutBefore.height/2);
  await page.mouse.down();
  await page.mouse.move(calloutBefore.x+calloutBefore.width/2-45,calloutBefore.y+calloutBefore.height/2+30,{steps:8});
  await page.mouse.up();
  assert.match(await page.locator('#ai-adjust-status').innerText(),/改動/,'拖動批語框後應提示尚未儲存');
  const calloutAfter=await callout.boundingBox();
  assert.ok(Math.abs(calloutAfter.x-calloutBefore.x)>10,'批語框要真的跟著移動');
  await page.waitForTimeout(450);   // 拖曳剛結束的 click 會被忽略，等它過去再點
  await page.evaluate(()=>{window.prompt=(msg,def)=>'符號錯誤 | 這裡應為負號，而且在移項之後。';});
  await callout.click();
  await page.waitForFunction(()=>document.getElementById('ai-adjust-status')?.textContent.includes('批註文字已修改'));
  assert.match(await callout.innerText(),/移項之後/,'圖上的批語要換成教師改寫的文字');
  await page.evaluate(()=>{delete window.prompt;});
  await page.locator('#ai-adjust-save').click();
  for(let i=0;i<40&&!(aiAdjusted.placements&&aiAdjusted.placements['issue:0']);i++)await page.waitForTimeout(50);
  assert.equal(aiAdjusted.issues[0].comment,'這裡應為負號，而且在移項之後。','教師改寫的說明要一起送出');
  assert.equal(aiAdjusted.issues[0].label,'符號錯誤','只改說明時標籤要保持不變');
  assert.ok(aiAdjusted.placements&&aiAdjusted.placements['issue:0'],'批語框的位置要一起保存');
  assert.ok(Math.abs(aiAdjusted.placements['issue:0'].x-AI_ISSUE.x)>0.005||Math.abs(aiAdjusted.placements['issue:0'].y-AI_ISSUE.y)>0.005,'保存的是拖動後的位置');
  await page.locator('.ai-annotation').waitFor();
  assert.match(await page.locator('.ai-annotation').innerText(),/教師已調整/,'調整後要標明教師已調整，不能還寫「未經教師確認」');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-AI批注修改文字.png'),fullPage:true});

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

  // ── 教師批註可以「選取單一項」來移動／改文字／刪除，不必整份重來 ──
  assert.equal(await page.locator('#ann-item-size').count(),1,'粗細欄位要常駐顯示，不能選取時才出現（會讓畫布跳動）');
  assert.deepEqual(await page.evaluate(()=>ann.shapes.map(s=>s.type)),['pen','ellipse','highlight','pen'],
    '先畫一筆紅筆、一個圈、一條螢光、再一筆紅筆');
  // 螢光標示要存成 highlight，否則 drawAnnShape 會當成紅筆畫成紅線（曾經的 bug）。
  assert.equal(await page.evaluate(()=>annShapeSize(ann.shapes[2])),26,'螢光標示的預設寬度要是 26');
  await page.locator('[data-ann-tool=select]').click();
  assert.match(await page.locator('#ann-select-status').innerText(),/用「選取」工具/);
  assert.equal(await page.locator('#ann-delete').isDisabled(),true,'還沒選取時刪除鈕要停用');
  await page.mouse.click(box.x+80,box.y+60);
  assert.equal(await page.evaluate(()=>ann.selected),3,'點到最上面那一筆批註');
  assert.equal(await page.locator('#ann-delete').isDisabled(),false,'選取後刪除鈕要可用');
  // 拖曳＝平移整筆，形狀不變
  const beforePts=await page.evaluate(()=>ann.shapes[3].points.map(p=>({x:p.x,y:p.y})));
  await page.mouse.move(box.x+80,box.y+60);await page.mouse.down();
  await page.mouse.move(box.x+150,box.y+140,{steps:8});await page.mouse.up();
  const afterPts=await page.evaluate(()=>ann.shapes[3].points.map(p=>({x:p.x,y:p.y})));
  assert.ok(afterPts[0].x-beforePts[0].x>20&&afterPts[0].y-beforePts[0].y>20,
    `拖曳要平移整筆批註（dx=${Math.round(afterPts[0].x-beforePts[0].x)} dy=${Math.round(afterPts[0].y-beforePts[0].y)}）`);
  assert.ok(Math.abs((afterPts[afterPts.length-1].x-afterPts[0].x)-(beforePts[beforePts.length-1].x-beforePts[0].x))<2,
    '平移不應改變筆畫本身的形狀');
  // 粗細／字級可調
  await page.locator('#ann-item-size').evaluate(el=>{el.value='14';el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await page.evaluate(()=>ann.shapes[3].size),14,'調整粗細要寫進這一筆批註');
  // 文字批註：加入後可以改文字，不必刪掉重打
  await page.locator('[data-ann-tool=text]').click();
  await page.evaluate(()=>{window.prompt=()=>'你寫什麼';});
  await page.mouse.click(box.x+260,box.y+250);
  await page.evaluate(()=>{delete window.prompt;});
  assert.deepEqual(await page.evaluate(()=>ann.shapes.map(s=>s.type)),['pen','ellipse','highlight','pen','text']);
  await page.locator('[data-ann-tool=select]').click();
  await page.mouse.click(box.x+280,box.y+245);
  assert.equal(await page.evaluate(()=>ann.selected),4,'點到文字批註');
  assert.equal(await page.locator('#ann-edit-text').isDisabled(),false,'文字批註才可以改文字');
  await page.evaluate(()=>{window.prompt=()=>'這裡漏了負號';});
  await page.locator('#ann-edit-text').click();
  await page.evaluate(()=>{delete window.prompt;});
  assert.equal(await page.evaluate(()=>ann.shapes[4].text),'這裡漏了負號','要改成教師新寫的文字');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-批註選取移動.png'),fullPage:true});
  // 選取後按 Delete 直接刪除
  await page.keyboard.press('Delete');
  assert.deepEqual(await page.evaluate(()=>ann.shapes.map(s=>s.type)),['pen','ellipse','highlight','pen'],'Delete 要刪掉選取的那一筆');
  assert.equal(await page.evaluate(()=>ann.selected),null);
  assert.equal(await page.locator('#ann-delete').isDisabled(),true,'刪除後要回到未選取狀態');

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
  // 學生同時看得到 AI 建議批註；教師調整過就要如實標示，不能還寫「未經教師確認」。
  assert.match(await page.locator('.ai-annotation').innerText(),/教師已調整位置／文字/);
  assert.doesNotMatch(await page.locator('.ai-annotation').innerText(),/未經教師確認/);
  assert.equal(await page.locator('.ai-mark').count(),1);
  await page.locator('[data-action=close-modal]').click();

  // ── AI 暫時無法辨識手寫時，評語要紅色粗體加大，不能混在一般說明文字裡 ──
  assert.equal(await page.evaluate(()=>feedbackClass('AI 暫時無法辨識手寫內容，作答已保存；此題需教師批閱。')),' ai-unavailable');
  assert.equal(await page.evaluate(()=>feedbackClass('規則評分：最終答案與參考答案嚴格等價。')),'','一般評語不套用警示樣式');
  const originalFeedback=await page.evaluate(()=>S.attempts.find(x=>x.id===9)?.feedback);
  await page.evaluate(()=>{const a=S.attempts.find(x=>x.id===9);if(a)a.feedback='AI 暫時無法辨識手寫內容，作答已保存；此題需教師批閱。';});
  await page.locator('[data-review]').first().click();
  const noteStyle=await page.locator('#modal-root .info-note.ai-unavailable').evaluate(el=>{const s=getComputedStyle(el);return {color:s.color,weight:Number(s.fontWeight),size:parseFloat(s.fontSize)};});
  assert.equal(noteStyle.color,'rgb(184, 69, 59)','AI 失效訊息要紅色');
  assert.ok(noteStyle.weight>=700,`要粗體（實際 ${noteStyle.weight}）`);
  assert.ok(noteStyle.size>=17,`要加大（實際 ${noteStyle.size}px）`);
  assert.match(await page.locator('#modal-root .info-note.ai-unavailable').innerText(),/AI 暫時無法辨識手寫內容/);
  await page.screenshot({path:path.join(__dirname,'..','MathPath-AI暫時無法批改.png'),fullPage:true});
  await page.locator('[data-action=close-modal]').click();
  await page.evaluate(f=>{const a=S.attempts.find(x=>x.id===9);if(a)a.feedback=f;},originalFeedback);

  // ── 手寫判定印章與 AI 批語：貼在手稿上，但只落在空白處，不遮住學生的字 ──
  // 測試圖片上方 60% 是筆跡、下方 40% 是空白紙，所以印章與批語必須全部落在 60% 以下。
  const inkAttempt=verdict=>({...handwritten,id:12,verdict,score:verdict==='correct'?6:verdict==='wrong'?0:3,status:'graded',
    gradingMethod:'teacher-reviewed',teacherReviewed:true,image:'/api/attempts/12/image',
    aiAnnotation:{issues:[{x:0.35,y:0.25,label:'符號錯誤',comment:'這裡應為負號'},
                          {x:0.6,y:0.42,label:'漏寫第二個根',comment:'兩個解都要寫出來'}],
                  summary:'思路正確，符號與根的數目要再檢查。',at:stamp}});
  // 只在這一節生效：其他情境（例如後面的訂正重跑）要交還給原本的路由，不能攔下來。
  let inkMode=null;
  await page.route('**/api/attempts/12/image', route => inkMode
    ? route.fulfill({contentType:'image/png', body:inkMode.image}) : route.fallback());
  await page.route('**/api/assignments/1', route => inkMode
    ? route.fulfill({json:inkMode.detail}) : route.fallback());
  const showInkAttempt=async(attempt,image)=>{
    inkMode={image, detail:{
      assignment:{...assignment,aiGrading:true}, questions:[assignmentQuestion], attempts:[attempt],
      mySubmission:{status:'submitted',submittedAt:stamp,resubmittedAt:null,submitCount:1,late:false,correction:null},
      report:{score:attempt.score,maxScore:6,totalScoredPoints:6,pendingCount:0,confirmedScore:attempt.score,
        confirmedCount:1,gradedCount:1,questionCount:1,percent:50,topicStats:[],suggestion:advice,awaitingReview:false}}};
    await page.reload({waitUntil:'networkidle'});
    await page.locator('[data-assignment]').first().click();
    await page.locator('[data-review]').first().click();
    await page.locator('.annotated-view .ai-ink-layer').waitFor({timeout:8000});
  };
  await showInkAttempt(inkAttempt('partial'),INK_HANDWRITING);
  await page.waitForFunction(()=>document.querySelectorAll('.annotated-view .ai-callout').length>=3);
  const inkLayout=await page.evaluate(()=>{
    const wrap=document.querySelector('.annotated-view .mark-wrap');
    const r=wrap.querySelector('img.review-image').getBoundingClientRect();
    const frac=el=>{const b=el.getBoundingClientRect();
      return {cls:el.className,top:(b.top-r.top)/r.height,bottom:(b.bottom-r.top)/r.height,left:(b.left-r.left)/r.width,right:(b.right-r.left)/r.width};};
    return {boxes:[...wrap.querySelectorAll('.verdict-stamp,.ai-callout')].map(frac),
      leaders:wrap.querySelectorAll('.ai-leaders line').length,
      pins:wrap.querySelectorAll('.ai-mark').length};
  });
  assert.equal(inkLayout.boxes.filter(b=>b.cls.includes('verdict-stamp')).length,1,'手稿上應有 1 個判定印章');
  assert.equal(inkLayout.boxes.filter(b=>b.cls.includes('ai-callout')).length,3,'2 則 AI 批語＋1 則總結都要貼在手稿上');
  assert.equal(inkLayout.pins,2,'AI 標記仍要標在它指出的位置');
  assert.ok(inkLayout.leaders>=1,'批語與標記之間要有引線指回位置');
  for(const b of inkLayout.boxes){
    assert.ok(b.top>=0.58,`印章與批語不可蓋住手寫內容（${b.cls} 的 top=${b.top.toFixed(3)}）`);
    assert.ok(b.bottom<=1.001&&b.left>=-0.001&&b.right<=1.001,`印章與批語不可超出圖片（${b.cls}）`);
  }
  assert.match(await page.locator('.annotated-view .badge.verdict').innerText(),/部分正確/);
  assert.equal(await page.locator('.annotated-view .verdict-stamp.partial').count(),1,'部分正確要蓋紅剔加一撇');
  assert.equal(await page.locator('.annotated-view .verdict-stamp path').count(),2,'紅剔加一撇是兩筆路徑');
  assert.match(await page.locator('.annotated-view').innerText(),/紅色剔＝全對、紅色叉＝全錯、紅色剔加一撇＝部分正確/);
  assert.match(await page.locator('.annotated-view').innerText(),/3 \/ 6 分/);
  await page.locator('.annotated-view').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(__dirname,'..','MathPath-手寫判定印章.png'),fullPage:true});
  // 全對＝紅剔（一筆）；全錯＝紅叉（兩筆）
  for(const [verdict,label,paths] of [['correct','全對',1],['wrong','全錯',2]]){
    await showInkAttempt(inkAttempt(verdict),INK_HANDWRITING);
    await page.waitForFunction(()=>document.querySelector('.annotated-view .verdict-stamp'));
    assert.match(await page.locator('.annotated-view .badge.verdict').innerText(),new RegExp(label),`判定應為${label}`);
    assert.equal(await page.locator(`.annotated-view .verdict-stamp.${verdict} path`).count(),paths,`${label}印章的筆畫數`);
  }
  // 手稿寫滿整張紙（沒有空白處）時：印章與批語都不畫在圖上，改由上方標籤與下方清單呈現，
  // 絕不會壓住學生的字。
  await showInkAttempt(inkAttempt('partial'),FULL_INK_HANDWRITING);
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.annotated-view .ai-ink-layer > *').count(),0,'沒有空白處時不可把批語壓在手寫上');
  assert.match(await page.locator('.annotated-view .badge.verdict').innerText(),/部分正確/,'判定仍要以標籤顯示');
  assert.match(await page.locator('.ai-annotation').innerText(),/符號錯誤/,'批語仍要完整列在下方清單');
  inkMode=null;
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
  // 同一份作業的「發布」與「截止」是兩筆事件：標記要講清楚是哪一種，
  // 「本月作業／本月測驗」也只能算一份（之前把事件數當作業數，一份作業會被算成兩份）。
  const calMetrics=await page.locator('.metric-row').innerText();
  assert.match(calMetrics,/本月作業\s*1\s*項/,'本月作業只能算一份（實際：'+calMetrics.replace(/\s+/g,' ')+'）');
  assert.match(calMetrics,/本月測驗\s*1\s*項/,'本月測驗只能算一份');
  assert.match(calMetrics,/本月事件\s*2\s*項/,'事件數仍把發布與截止分開算');
  assert.match(await page.locator('.cal-mark.due').first().innerText(),/1 項作業截止/,'作業截止日要標明是作業且截止');
  assert.match(await page.locator('.cal-mark.quiz').first().innerText(),/1 項測驗/,'日曆要標出測驗');
  await page.locator('.cal-cell:has(.cal-mark.quiz)').click();
  await page.locator('.cal-event.quiz').waitFor();
  const quizText=await page.locator('.cal-event.quiz').innerText();
  assert.match(quizText,/一元二次方程測驗/);assert.match(quizText,/發布/);assert.match(quizText,/已交 0 \/ 2 人/);
  await page.locator('.cal-cell:has(.cal-mark.due)').click();
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
  assert.match(await page.locator('.cal-mark.note').first().innerText(),/1 則提醒/,'日曆格子應標出提醒');
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
  assert.equal(await page.locator('#math-keyboard').count(), 0, '選擇題更不應出現數學鍵盤');
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

  // 課外比賽題：獨立成一個主分類，子分類依比賽／來源區分（前端分類樹要跟後端一致）
  await page.locator('.topic-tab', {hasText:'比賽題'}).first().click();
  await page.locator('.subtopic-tabs').waitFor({timeout:5000});
  assert.deepEqual(await page.locator('.subtopic-tab').allInnerTexts(),
    ['全部子分類','金蓮花','校際','AIMO','思維','其他'],
    '比賽題的子分類應為金蓮花／校際／AIMO／思維／其他');
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
  // 選擇題／填空題是客觀題：不需要評分標準（也就不會產生 AI 評分步驟）
  assert.equal(await page.locator('[data-rubric-field="draft-0"]').isVisible(),false,'選擇題草稿應隱藏評分標準');
  assert.equal(await page.locator('[data-objective-note="draft-0"]').isVisible(),true,'選擇題草稿應說明不需要評分標準');
  assert.match(await page.locator('[data-objective-note="draft-0"]').innerText(),/客觀題/);
  await page.locator('[data-field=qtype]').selectOption('解答題');
  assert.equal(await page.locator('[data-rubric-field="draft-0"]').isVisible(),true,'改成解答題後應顯示評分標準');
  assert.equal(await page.locator('[data-objective-note="draft-0"]').isVisible(),false,'解答題不應顯示客觀題說明');
  await page.locator('[data-field=qtype]').selectOption('填空題');
  assert.equal(await page.locator('[data-rubric-field="draft-0"]').isVisible(),false,'填空題草稿也應隱藏評分標準');
  await page.locator('[data-field=qtype]').selectOption('選擇題');
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
  assert.equal(await page.locator('#manual-options [data-option-index]').count(), 4, '選擇題預設 4 個選項欄');
  await page.locator('#manual-add-option').click();
  assert.equal(await page.locator('#manual-options [data-option-index]').count(), 5, '可新增第 5 個選項');
  await page.locator('#manual-options [data-option-index]').last().fill('$x=6$');
  await page.waitForTimeout(200);
  assert.ok(await page.locator('#manual-options-preview .katex').count() > 0, '選項預覽應渲染數學式');
  await page.locator('#manual-options [data-option-drop]').last().click();
  assert.equal(await page.locator('#manual-options [data-option-index]').count(), 4, '可刪除選項');
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
  // 評分標準的排版預覽：輸入框保留原始 LaTeX，下方要顯示排版後的式子
  await page.locator('[data-rubric-list="manual"] [data-rubric-label]').first().fill('正確解出 $x=2$ 或 $x=3$');
  await page.locator('[data-rubric-preview="manual"] .katex').first().waitFor({timeout:5000});
  assert.ok(await page.locator('[data-rubric-preview="manual"] .katex').count()>0,'評分標準的數學式應以 KaTeX 排版');
  assert.equal(await page.locator('[data-rubric-list="manual"] [data-rubric-label]').first().inputValue(),
    '正確解出 $x=2$ 或 $x=3$','輸入框仍要顯示原始 LaTeX，方便教師修改');
  assert.equal(await page.locator('[data-rubric-preview="manual"]').evaluate(el=>/\$[^$]{1,60}\$/.test(el.innerText)),
    false,'評分標準預覽不應殘留未渲染的 $ 標記');
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
  await page.locator('#fig-toolbar [data-tool=pen]').click();
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
  const draftFigSide=await page.evaluate(()=>{
    const card=[...document.querySelectorAll('.draft-card')].find(c=>c.querySelector('.draft-figure'));
    if(!card)return null;
    const stem=card.querySelector('.question-stem');
    if(!stem)return null;
    const t=stem.querySelector('.question-stem-text').getBoundingClientRect();
    const f=stem.querySelector('.draft-figure').getBoundingClientRect();
    return f.left>=t.right-2;
  });
  assert.equal(draftFigSide,true,'匯入草稿卡的題目圖形也要放在題目內容的右邊');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-拆題草稿圖形靠右.png'),fullPage:true});
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
  await page.locator('#account-edit-form').waitFor();
  await page.locator('#edit-name').fill('陳大文');
  await page.locator('#edit-seat').fill('7');
  await page.locator('#account-edit-form button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#account-edit-form')===null);
  assert.deepEqual(editSent.body,{name:'陳大文',seat:'7'},'只送出有改動的欄位');
  // 重設密碼會一起送出，並提示已登出該生
  await page.locator('[data-edit-user]').first().click();
  await page.locator('#edit-password').fill('BrandNewPass99');
  await page.locator('#account-edit-form button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#account-edit-form')===null);
  assert.deepEqual(editSent.body,{password:'BrandNewPass99'});
  assert.match(await page.locator('#toast').innerText(),/已登出該生目前的登入/);

  await page.locator('[data-action=close-modal]').click();

  // ── 帳號管理：新增與編輯教師帳號（教師專用）──
  // 後註冊的 route 先匹配，所以只覆蓋 /api/users，其餘 fallback 回原本的模擬。
  await page.route('https://mathpath.test/**',route=>{const url=new URL(route.request().url());
    if(url.pathname==='/api/teachers'&&route.request().method()==='POST'){teacherCreated=route.request().postDataJSON();
      return route.fulfill({json:{user:{id:9,username:teacherCreated.username,name:teacherCreated.name,role:'teacher',seat:null}}});}
    if(url.pathname==='/api/users')return route.fulfill({json:{ownerId:2,users:[
      {id:9,username:'teacher2',name:'李老師',role:'teacher',seat:null,createdBy:2},
      {id:1,username:'student',name:'介面測試學生',role:'student',seat:'1',createdBy:2}]}});
    return route.fallback();});
  await page.locator('#manage-users').click();
  await page.locator('#teacher-create-form').waitFor();
  const rosterRows=(await page.locator('.roster-row').allInnerTexts()).map(t=>t.replace(/\s+/g,' ').trim());
  assert.equal(rosterRows.length,2,'帳號管理要同時列出教師與學生');
  assert.match(rosterRows[0],/教師.*李老師.*teacher2.*編輯/,'教師列要有「教師」角色標籤與帳號');
  assert.match(await page.locator('.account-group').first().innerText(),/教師帳號（1）/);
  assert.match(await page.locator('.account-group').last().innerText(),/獨立學生帳戶（1）/);
  // 建立教師帳號：要送出 role=teacher
  await page.locator('#teacher-name').fill('王老師');
  await page.locator('#teacher-username').fill('teacher3');
  await page.locator('#teacher-password').fill('NewTeacherPass1');
  await page.locator('#teacher-create-form button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('教師帳號'));
  assert.deepEqual(teacherCreated,{username:'teacher3',name:'王老師',password:'NewTeacherPass1'},'建立教師要送出帳號、姓名與初始密碼');
  assert.match(await page.locator('#toast').innerText(),/請把帳號與初始密碼私下交給對方/);
  // 編輯教師：沒有班內號欄位、姓名必填
  await page.locator('[data-edit-user]').first().click();
  await page.locator('#account-edit-form').waitFor();
  assert.match(await page.locator('#modal-root h2').innerText(),/編輯教師帳號/);
  assert.equal(await page.locator('#edit-seat').count(),0,'教師沒有班內號欄位');
  assert.equal(await page.locator('#edit-name').getAttribute('required'),'','教師姓名必填');
  assert.equal(await page.locator('#edit-username').inputValue(),'teacher2');
  await page.locator('#edit-password').fill('AnotherPass123');
  await page.locator('#account-edit-form button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#account-edit-form')===null);
  assert.deepEqual(editSent.body,{password:'AnotherPass123'},'教師只送出有改動的欄位');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-教師帳號管理.png'),fullPage:true});
  await page.locator('[data-action=close-modal]').click();

  // ── 一般教師（非管理員）：不能新增教師、看不到資料管理 ──
  // 直接在瀏覽器裡切換 isOwner（不動路由），測完再切回來。
  await page.evaluate(()=>{S.user.isOwner=false;settingsPage();});
  await page.locator('#manage-users').click();
  await page.locator('#user-create-form').waitFor();
  assert.equal(await page.locator('#teacher-create-form').count(),0,'一般教師不應看到新增教師表單');
  assert.match(await page.locator('.modal').innerText(),/只有\s*管理員帳號/,'要說明只有管理員能新增教師');
  assert.match(await page.locator('.modal').innerText(),/修改自己建立的學生/,'要說明一般教師只能改自己建立的學生');
  await page.locator('[data-action=close-modal]').click();
  assert.equal(await page.locator('#admin-reset').count(),0,'一般教師不應看到學年重置');
  assert.equal(await page.locator('#admin-vacuum').count(),0,'一般教師不應看到壓實資料庫');
  assert.equal(await page.locator('[data-admin-download]').count(),0,'一般教師不應看到備份下載');
  assert.match(await page.locator('#main').innerText(),/只限\s*管理員帳號/,'資料管理區要說明權限');
  await page.route('**/api/health', route => route.fulfill({json:{status:'ok',
    metrics:{startedAt:'2026-10-19T09:00:00Z',aiCalls:12,aiFailures:1,aiFailureRate:8.3,
             aiAvgMs:850,lastAiError:'模型逾時',lastAiErrorAt:'2026-10-19T10:00:00Z'}}}));
  await page.evaluate(()=>{S.user.isOwner=true;settingsPage();});
  console.log('PASS: 一般教師不能新增教師、也看不到資料管理');

  // ── 設定與隱私：資料管理（教師專用）──
  await page.waitForFunction(()=>{const el=document.querySelector('#admin-stats');return el&&/3000 題/.test(el.innerText);});
  // 健康檢查是非同步補上的，要等它到位再讀文字（不然只會拿到舊的統計卡）
  await page.waitForFunction(()=>/AI 呼叫/.test(document.querySelector('#admin-stats')?.innerText||''),{timeout:8000});
  const adminText=await page.locator('#admin-stats').innerText();
  assert.match(adminText,/題庫題目/);assert.match(adminText,/3000 題/);
  assert.match(adminText,/作答紀錄/);assert.match(adminText,/2500 筆/);
  assert.match(adminText,/15\.0 MB/,'資料庫大小應以可讀單位呈現');
  assert.match(adminText,/跨學年保留/);
  // AI 健康狀況：失敗率與平均耗時要看得到，不必翻 Render Logs
  assert.match(adminText,/AI 呼叫/,'資料管理要顯示 AI 呼叫狀況');
  assert.match(adminText,/失敗 1 次（8\.3%）/,'要看得出失敗次數與比例');
  assert.match(adminText,/平均 850 ms/,'要看得出平均耗時');
  assert.match(adminText,/模型逾時/,'要看得到最後一次錯誤');
  const downloads=await page.locator('[data-admin-download]').evaluateAll(els=>els.map(e=>e.dataset.adminDownload));
  assert.deepEqual(downloads,['/api/admin/backup/db','/api/admin/archive/questions',
    '/api/admin/archive/students','/api/admin/archive/students?images=0'],'應有四個下載入口');
  const dangerText=await page.locator('.danger-zone').innerText();
  assert.match(dangerText,/學生帳號、班級、作業、所有作答與手寫圖、模擬測驗、訂正紀錄/);
  assert.match(dangerText,/題庫（3000 題）、教師帳號、內建演示帳號、日曆提醒/,'要明講題庫保留');
  // 網盤備份：未設定時要講清楚要加哪四個環境變數，不可以假裝已備份
  const backupZone=await page.locator('#admin-backup-zone').innerText();
  assert.match(backupZone,/網盤備份/);
  assert.match(backupZone,/R2_ACCOUNT_ID/,'未設定時要指出要加哪個環境變數');
  assert.equal(await page.locator('#admin-backup-now').count(),0,'未設定網盤時不該出現備份按鈕');
  // 換成已設定網盤的狀態：出現按鈕、按下去會上傳並更新狀態
  await page.route('https://mathpath.test/**',route=>{const url=new URL(route.request().url());
    if(url.pathname==='/api/admin/storage')return route.fulfill({json:{database:{bytes:15728640,reclaimableBytes:1048576,walBytes:32768},counts:{questions:3000,attempts:2500,users:100,classes:3,assignments:5,mock_exams:0,calendar_notes:0,sessions:12},images:{handwriting:1500,annotation:300,questionFigure:40,inDatabaseBytes:0,inObjectStorage:1840,storageMode:'r2'},lastStudentReset:null,questionBankKeptAcrossYears:true,backup:{storageMode:'r2',configured:true,error:'',keep:14,count:0,lastAt:null,lastBytes:null,lastTrigger:null,lastFiles:[],intervalHours:6,history:[]}}});
    return route.fallback();});
  await page.locator('#admin-refresh').click();
  await page.waitForFunction(()=>document.querySelector('#admin-backup-now'));
  const readyText=await page.locator('#admin-backup-zone').innerText();
  assert.match(readyText,/尚未備份/,'還沒備份過要如實顯示');
  assert.match(readyText,/每 6 小時/,'要顯示自動備份間隔');
  await page.locator('#admin-backup-now').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('已備份到網盤'));
  assert.equal(backupCalled,1,'備份按鈕應呼叫一次上傳端點');
  const doneText=await page.locator('#admin-backup-zone').innerText();
  assert.match(doneText,/保留份數/);assert.match(doneText,/1 \/ 14/,'要顯示已保留份數');
  assert.match(doneText,/最近 1 次備份/,'要能展開看最近幾次備份');
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
  // 側欄不再放模型端點，改由「設定與隱私」進入。
  await page.locator('#settings-nav').click();
  await page.locator('#ai-config-link').waitFor({timeout:8000});
  await page.locator('#ai-config-link').click();
  await page.locator('#ai-form').waitFor();
  assert.match(await page.locator('.metric').first().innerText(),/未接入/);
  assert.match(await page.locator('.capability-list').innerText(),/未能使用|需要文字模型/);
  await page.locator('#ai-base').fill('http://127.0.0.1:11434/v1');
  await page.locator('#ai-model').fill('local-text');
  await page.locator('#ai-vision').fill('local-vision');
  await page.locator('#ai-draw').fill('local-draw');
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
  assert.equal(aiConfigSaved.drawModel,'local-draw','繪圖模型要能另外指定');
  assert.match(await page.locator('.metric-row').innerText(),/繪圖模型/,'要顯示目前用哪個模型畫圖');
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
  // 挑題：可先選章節（主／子分類），或直接輸入關鍵字搜尋；已勾選的題目在換篩選後仍保留。
  const pickerQuestions=[
    {...assignmentQuestion,id:1,title:'因式分解解二次方程',topic:'一元二次方程',subtopic:'因式分解法'},
    {...assignmentQuestion,id:2,title:'配方法解二次方程',topic:'一元二次方程',subtopic:'配方法'},
    {...assignmentQuestion,id:3,title:'三角形面積',topic:'幾何',subtopic:'面積'},
    {...assignmentQuestion,id:4,title:'畢氏定理應用',topic:'幾何',subtopic:'畢氏定理'}
  ];
  // 依登入身分回應，避免後面的學生情境拿到教師身分
  await page.route('**/api/state', route => route.fulfill({json:{
    user: role?{id:role==='teacher'?2:1,name:role==='teacher'?'介面測試教師':'介面測試學生',role,isOwner:role==='teacher'}:null,
    questions: role==='teacher'?pickerQuestions:pickerQuestions.map(x=>({...x,answer:undefined,steps:undefined})),
    attempts: role==='teacher'?[]:[graded(1,1,'一元二次方程',6,6),graded(2,2,'幾何',0,5)],
    stats:{completed:2,accuracy:55,streak:1,minutes:10}, ai, topics:['一元二次方程','幾何']}}));
  await page.reload({waitUntil:'networkidle'});
  await page.locator('[data-page=homework]').first().click();
  await page.locator('#create-assignment').click();
  await page.locator('#pick-topic').waitFor({timeout:8000});
  assert.equal(await page.locator('#assignment-picks .pick-row').count(),4,'預設應列出全部可佈置題目');
  assert.match(await page.locator('#pick-hint').innerText(),/可佈置題目共 4 題/);
  assert.equal(await page.locator('#pick-topic option').count(),3,'章節下拉應為全部＋兩個章節');
  assert.match(await page.locator('#pick-topic').innerText(),/一元二次方程（2 題）/,'章節要標示題數');
  await page.locator('#pick-topic').selectOption({label:'一元二次方程（2 題）'});
  assert.equal(await page.locator('#assignment-picks .pick-row').count(),2,'選章節後只顯示該章節的題目');
  assert.match(await page.locator('#pick-subtopic').innerText(),/配方法/,'子分類要跟著章節連動');
  await page.locator('#pick-subtopic').selectOption('配方法');
  assert.equal(await page.locator('#assignment-picks .pick-row').count(),1,'選子分類後再收窄');
  await page.locator('#pick-topic').selectOption('');
  await page.locator('#pick-search').fill('畢氏');
  assert.equal(await page.locator('#assignment-picks .pick-row').count(),1,'搜尋關鍵字應只留下符合的題目');
  assert.match(await page.locator('#assignment-picks').innerText(),/畢氏定理應用/);
  await page.locator('#pick-search').fill('不存在的關鍵字');
  assert.equal(await page.locator('.pick-empty').count(),1,'找不到題目時要說明');
  await page.locator('#pick-search').fill('畢氏');
  // 勾選後換篩選條件，已選題目不能消失
  await page.locator('#assignment-picks input[type=checkbox]').check();
  assert.match(await page.locator('#selected-question-count').innerText(),/已選 1 題 · 6 分/);
  await page.locator('#pick-search').fill('');
  await page.locator('#pick-topic').selectOption({label:'幾何（2 題）'});
  assert.match(await page.locator('#selected-question-count').innerText(),/已選 1 題/,'換章節不應清掉已選題目');
  assert.match(await page.locator('#picked-chips').innerText(),/畢氏定理應用/,'已選題目要以標籤列出');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-佈置作業挑題.png'),fullPage:true});
  await page.locator('.pick-chip').first().click();
  assert.match(await page.locator('#selected-question-count').innerText(),/已選 0 題/,'標籤可移除已選題目');
  await page.locator('#pick-topic').selectOption('');
  assert.equal(await page.locator('#assignment-picks .pick-row').count(),4);
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
  assert.deepEqual(durationSent.questionIds,[1],'勾選的題目要正確送出（不受篩選影響）');

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
  const assignmentDeadlineBefore=await page.evaluate(()=>quizClock.deadline);
  await page.locator('[data-assignment-q]').first().click();
  await page.locator('.quiz-clock-chip').waitFor();
  assert.equal(await page.evaluate(()=>quizClock.deadline),assignmentDeadlineBefore,'切题不得延长作业时限');
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
  // 上傳作答：可用手機拍照，也可上傳相片或 PDF（PDF 最多 20 MB）
  await page.locator('[data-answer-mode=upload]').click();
  await page.locator('#answer-upload').waitFor({state:'attached',timeout:5000});
  assert.match(await page.locator('#answer-upload').getAttribute('accept'),/application\/pdf/,'檔案選擇要接受 PDF');
  assert.equal(await page.locator('#answer-capture').getAttribute('capture'),'environment','手機拍照要用後置鏡頭');
  assert.match(await page.locator('.upload-answer').innerText(),/PDF 最多 20 MB/,'要寫明 PDF 的大小上限');
  await page.locator('#answer-upload').setInputFiles({name:'作答.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%test\n')});
  await page.locator('.upload-file').waitFor({timeout:5000});
  assert.match(await page.locator('.upload-file').innerText(),/已選擇 PDF 作答/,'選了 PDF 要顯示檔案提示');
  assert.equal(await page.locator('.upload-answer img').count(),0,'PDF 不應用圖片預覽');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-上傳作答.png'),fullPage:true});
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

  // 版面：內容較少的頁面不應在頁尾之前留下大片空白
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-page=mistakes]').first().click();
  await page.locator('.page-heading').first().waitFor();
  const footerGap = await page.evaluate(() => {
    const main = document.querySelector('#main');
    const kids = [...main.children].filter(el => el.getBoundingClientRect().height > 0);
    const first = kids[0], last = kids[kids.length - 1], foot = document.querySelector('.app-footer');
    const cs = getComputedStyle(main);
    return { mainH: Math.round(main.getBoundingClientRect().height),
      contentH: Math.round(last.getBoundingClientRect().bottom - first.getBoundingClientRect().top
        + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)),
      gap: Math.round(foot.getBoundingClientRect().top - last.getBoundingClientRect().bottom) };
  });
  assert.ok(footerGap.gap < 60, `內容與頁尾之間不應留下大片空白（實際 ${footerGap.gap}px）`);
  assert.ok(footerGap.mainH - footerGap.contentH < 80,
    `主內容不應被強制撐滿視窗高度（內容 ${footerGap.contentH}px，區塊 ${footerGap.mainH}px）`);

  await page.locator('#account').click();await page.locator('#logout-btn').click();await page.locator('#homework-login').waitFor();
  await login('teacher');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#menu-btn').click();await page.locator('[data-page=homework]').first().click();await page.locator('.assignment-card').first().waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // 側欄抽屜：點側欄以外（遮罩）或按 Esc 都要收起——手機上側欄會蓋住 ☰
  await page.locator('#menu-btn').click();
  await page.locator('#sidebar.open').waitFor({timeout:4000});
  await page.locator('#nav-scrim').click({position:{x:340,y:600}});
  assert.equal(await page.evaluate(()=>document.querySelector('#sidebar').classList.contains('open')),false,'點側欄以外要收起');
  await page.locator('#menu-btn').click();
  await page.locator('#sidebar.open').waitFor({timeout:4000});
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>document.querySelector('#sidebar').classList.contains('open')),false,'按 Esc 要收起');
  console.log('PASS: 手機側欄點外面或按 Esc 會收起');
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
  // 作答頁不再放數學鍵盤（改由「開啟公式編輯器」彈窗提供），避免一整片按鈕把題目擠下去。
  assert.equal(await page.locator('#math-keyboard').count(), 0, '作答頁不應再出現數學鍵盤');
  assert.equal(await page.locator('#open-math-editor').isVisible(), true, '文字作答要有「開啟公式編輯器」入口');
  // 入口要在最終答案輸入框「上方」
  const order = await page.evaluate(() => {
    const btn = document.querySelector('#open-math-editor'), input = document.querySelector('#final-answer');
    return btn.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING ? 'button-first' : 'input-first';
  });
  assert.equal(order, 'button-first', '「開啟公式編輯器」要在最終答案上方');
  // 純文字作答仍可直接打字
  await page.locator('#final-answer').fill('x=2 或 x=3');
  assert.equal(await page.locator('#final-answer').inputValue(), 'x=2 或 x=3', '純文字作答仍可直接打字');
  // 切到「手寫解題」：整個「最終答案」區塊隱藏（手寫由圖片作答，不需要再填答案欄）。
  await page.locator('[data-answer-mode=hand]').click();
  assert.equal(await page.locator('#final-answer').isVisible(), false, '手寫解題不應顯示最終答案');
  await page.locator('[data-answer-mode=text]').click();
  assert.equal(await page.locator('#final-answer').isVisible(), true, '切回文字作答要再顯示最終答案');
  assert.equal(await page.evaluate(()=>document.querySelector('#final-answer').value), 'x=2 或 x=3', '切換模式不能弄丟已輸入的答案');

  // 公式編輯器（MathLive）：點開後所見即所得，插入的 LaTeX 要寫回作答欄並即時渲染。
  // 測試沒有真實伺服器，先把 MathLive 注入（正式環境是點按鈕才動態載入 vendor/mathlive.min.js）。
  if(await page.evaluate(()=>!window.MathLive))
    await page.addScriptTag({path:path.join(__dirname,'vendor','mathlive.min.js')});
  await page.locator('#open-math-editor').click();
  await page.locator('#math-editor-field').waitFor({timeout:30000});
  // 每次開啟都應該是空白——作答欄已經有內容（x=2 或 x=3），但編輯器不帶入。
  assert.equal(await page.evaluate(()=>document.querySelector('#math-editor-field').value), '',
    '每次開啟公式編輯器都要是空白，不帶入作答欄現有內容');
  await page.evaluate(()=>{const f=document.querySelector('#math-editor-field');f.value='\\frac{3}{4}';});
  await page.screenshot({path:path.join(__dirname,'..','MathPath-公式編輯器.png'),fullPage:false});
  await page.locator('#math-editor-ok').click();
  assert.equal(await page.locator('#final-answer').inputValue(),'\\frac{3}{4}','公式編輯器要把 LaTeX 寫回作答欄');
  await page.waitForFunction(()=>!!document.querySelector('#final-answer-preview .katex'),null,{timeout:8000});
  console.log('PASS: 公式編輯器（MathLive）插入後寫回作答欄並即時渲染');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-數學鍵盤.png'),fullPage:true});

  // ── 學生可以自己調整手寫書寫區大小（題目長、步驟多就換大一點），筆跡要保留 ──
  await page.locator('[data-answer-mode=hand]').click();
  await page.locator('#hand-canvas').waitFor();
  assert.equal(await page.locator('#hand-canvas').getAttribute('height'),'700','預設書寫區是 1200 × 700');
  const handBox0=await page.locator('#hand-canvas').boundingBox();
  await page.mouse.move(handBox0.x+60,handBox0.y+60);await page.mouse.down();await page.mouse.move(handBox0.x+170,handBox0.y+130,{steps:6});await page.mouse.up();
  assert.equal(await page.evaluate(()=>strokes.length),1,'應記下一筆手寫');
  await page.locator('#hand-size').selectOption('tall');
  await page.waitForFunction(()=>document.getElementById('hand-canvas').height===1000);
  assert.equal(await page.evaluate(()=>strokes.length),1,'換尺寸不應清掉筆跡');
  const handBox1=await page.locator('#hand-canvas').boundingBox();
  assert.ok(Math.abs(handBox1.height/handBox1.width-1000/1200)<0.03,'畫布要依內建比例顯示，不能被壓扁');
  assert.ok(handBox1.height>handBox0.height,'加高後畫面也要真的變高');
  await page.locator('#hand-size').selectOption('normal');   // 縮小要確認，對話框會自動接受
  await page.waitForFunction(()=>document.getElementById('hand-canvas').height===700);
  assert.equal(await page.evaluate(()=>strokes.length),1,'縮小後筆跡仍保留在畫布內');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-書寫區大小.png'),fullPage:true});
  await page.evaluate(()=>{strokes=[];redoStrokes=[];drawCanvas();});

  // ── 簡易計算機：學生作答時在右下角，可縮小；算式自己算（不用 eval），除以零要說清楚 ──
  await page.locator('#calc-open').click();
  await page.locator('.calc-panel').waitFor();
  await page.locator('[data-calc="7"]').click();
  await page.locator('[data-calc="×"]').click();
  await page.locator('[data-calc="8"]').click();
  assert.equal(await page.locator('#calc-screen').innerText(),'7×8');
  assert.equal(await page.locator('#calc-live').innerText(),'= 56','要先顯示即時結果');
  await page.locator('[data-calc="equals"]').click();
  assert.equal(await page.locator('#calc-screen').innerText(),'56','按等號後以結果取代算式，方便接著算');
  await page.locator('[data-calc="clear"]').click();
  await page.locator('[data-calc="sqrt"]').click();
  await page.locator('[data-calc="9"]').click();
  await page.locator('[data-calc=")"]').click();
  assert.equal(await page.locator('#calc-live').innerText(),'= 3','√ 要能算');
  await page.locator('[data-calc="clear"]').click();
  await page.locator('[data-calc="5"]').click();
  await page.locator('[data-calc="÷"]').click();
  await page.locator('[data-calc="0"]').click();
  assert.match(await page.locator('#calc-live').innerText(),/除數不可為 0/,'除以零要說明原因，不能顯示 Infinity');
  await page.locator('[data-calc="back"]').click();
  await page.locator('[data-calc="2"]').click();
  assert.equal(await page.locator('#calc-live').innerText(),'= 2.5');
  await page.locator('#calc-close').click();
  assert.equal(await page.locator('.calc-panel').count(),0,'縮小後應收起面板');
  assert.equal(await page.locator('#calc-open').count(),1,'縮小後留下一個小按鈕');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-計算機.png'),fullPage:true});
  await page.locator('#calc-open').click();
  await page.locator('.calc-panel').waitFor();
  assert.equal(await page.locator('#calc-screen').innerText(),'5÷2','縮小再打開要保留剛才的算式');
  await page.evaluate(()=>{calcExpr='';});
  await page.locator('#calc-close').click();
  await page.locator('[data-answer-mode=text]').click();

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

  // 情境四之三：學生不會某題 → 標示「本題不會」即可交代，不必亂填也能提交
  const skipBodies=[],skipAttempts=[];let finalizeCalls=0;
  await page.route('**/api/attempts', route => {
    if(route.request().method()!=='POST')return route.fallback();
    const body=route.request().postDataJSON();skipBodies.push(body);
    const attempt=body.skipped
      ? {...awaitingAttempt,id:500+skipBodies.length,questionId:body.questionId,skipped:true,status:'pending',score:null,
         feedback:'學生標示本題不會，等待教師處理；未自動記零分。'}
      : {...awaitingAttempt,id:500+skipBodies.length,questionId:body.questionId};
    skipAttempts.push(attempt);
    return route.fulfill({json:{attempt,solution:null}});
  });
  await page.route('**/api/assignments/1/submit', route => {
    finalizeCalls++;
    return route.fulfill({json:{report:{...awaitingReport,pendingCount:2},
      mySubmission:{status:'submitted',submittedAt:stamp,resubmittedAt:null,submitCount:1,late:false,correction:null}}});
  });
  const twoQuestions=[{...assignmentQuestion,id:1,title:'第1題：因式分解解方程'},
                      {...assignmentQuestion,id:2,title:'第2題：配方法解方程'}];
  await page.route('**/api/assignments/1', route => route.fulfill({json:{
    assignment:{...assignment,aiGrading:false,questionCount:2,totalPoints:12}, questions:twoQuestions,
    attempts:skipAttempts,
    mySubmission:{status:'not_started',submittedAt:null,resubmittedAt:null,submitCount:0,late:false,correction:null},
    report:{...awaitingReport,pendingCount:0,awaitingReview:false,questionCount:2}}}));
  await page.reload({waitUntil:'networkidle'});
  await page.locator('[data-assignment]').first().click();
  await page.locator('.assignment-question-row').first().waitFor({timeout:8000});
  assert.equal(await page.locator('[data-skip-q]').count(),2,'未作答的題目都要有「本題不會」');
  assert.match(await page.locator('#skip-rest-submit').innerText(),/其餘 2 題/,'未答完時要能一次標示其餘題目');
  assert.equal(await page.locator('#finalize-assignment').isDisabled(),true,'未交代完不能正式提交');
  // 作答頁也有「本題不會」：標示後直接前往下一題還沒交代的
  await page.locator('[data-assignment-q]').first().click();
  await page.locator('#answer-area').waitFor({timeout:8000});
  assert.equal(await page.locator('#skip-answer').count(),1,'作業作答頁要有「本題不會」');
  // 「本題不會」要移到右邊、緊貼「提交」，不要孤零零掛在最左邊。
  const submitRow=await page.locator('.answer-submit').boundingBox();
  const skipBox=await page.locator('#skip-answer').boundingBox();
  const submitBox=await page.locator('#submit-answer').boundingBox();
  assert.ok(skipBox.x>submitRow.x+submitRow.width*0.5,
    `「本題不會」要在右半邊（按鈕 x=${Math.round(skipBox.x)}，列起點 ${Math.round(submitRow.x)}，寬 ${Math.round(submitRow.width)}）`);
  assert.ok(submitBox.x-(skipBox.x+skipBox.width)<44,'「本題不會」要緊貼「提交」');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-本題不會右移.png'),fullPage:true});
  await page.locator('#skip-answer').click();
  await page.waitForFunction(()=>document.querySelector('#answer-area')&&/第2題/.test(document.querySelector('#main').textContent),{timeout:8000});
  assert.equal(skipBodies[0].skipped,true,'要送出 skipped');
  assert.equal(skipBodies[0].questionId,1,'標示的是第 1 題');
  assert.equal(skipBodies[0].answerText,undefined,'標示不會時不帶作答內容');
  // 剩下第 2 題用「其餘題目標示不會並提交」一次處理
  await page.evaluate(()=>assignmentPage(1));
  await page.locator('.assignment-question-row').first().waitFor({timeout:8000});
  assert.match(await page.locator('.assignment-question-row').first().innerText(),/已標示「本題不會」/,'題目列要顯示已標示');
  assert.equal(await page.locator('[data-skip-q]').count(),1,'已標示的題目不用再顯示按鈕');
  await page.locator('#skip-rest-submit').click();
  await page.waitForFunction(()=>/已標示「不會」並正式提交/.test(document.querySelector('#toast').textContent),{timeout:8000});
  assert.equal(skipBodies.length,2,'第二題也標示了不會');
  assert.equal(skipBodies[1].questionId,2);
  assert.equal(finalizeCalls,1,'標示完就直接提交');
  console.log('PASS: 「本題不會」留空作答（題目列／作答頁／其餘題目一次標示並提交、不記零分）');

  // 情境五：作業有多題時，提交一題後可直接按「下一題」，不必先回到本份作業
  const threeQuestions=[
    {...assignmentQuestion,id:1,title:'第1題：因式分解解方程'},
    {...assignmentQuestion,id:2,title:'第2題：配方法解方程'},
    {...assignmentQuestion,id:3,title:'第3題：公式法解方程'}
  ];
  const justSubmitted={...awaitingAttempt,questionId:1,questionTitle:'第1題：因式分解解方程'};
  await page.route('**/api/assignments/1', route => route.fulfill({json:{
    assignment:{...assignment,aiGrading:true,questionCount:3,totalPoints:18}, questions:threeQuestions, attempts:[],
    mySubmission:{status:'not_started',submittedAt:null,resubmittedAt:null,submitCount:0,late:false,correction:null},
    report:{...awaitingReport,questionCount:3,pendingCount:0,awaitingReview:false}}}));
  await page.route('**/api/attempts', route => route.request().method()==='POST'
    ? route.fulfill({json:{attempt:justSubmitted,solution:null}}) : route.fallback());
  await page.reload({waitUntil:'networkidle'});
  await page.locator('[data-assignment]').first().click();
  await page.locator('[data-assignment-q]').first().click();
  await page.locator('#answer-area').waitFor({timeout:8000});
  assert.match(await page.locator('.practice-question h2').innerText(),/第1題/,'應從第 1 題開始');
  await page.locator('[data-answer-mode=text]').click();
  await page.locator('#final-answer').fill('x=2 或 x=3');
  await page.locator('#consent-ai').check();
  await page.locator('#submit-answer').click();
  await page.locator('.assignment-nav').waitFor({timeout:8000});
  assert.match(await page.locator('.assignment-nav').innerText(),/已完成 1 \/ 3 題/,'提交後要顯示本份作業進度');
  assert.match(await page.locator('[data-next-question]').innerText(),/下一題（第 2 \/ 3 題）/,'提交後要能直接前往下一題');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'作業逐題導覽在手機不應橫向溢出');
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:path.join(__dirname,'..','MathPath-作業下一題.png'),fullPage:true});
  await page.locator('[data-next-question]').click();
  await page.locator('.practice-question h2').filter({hasText:'第2題'}).waitFor({timeout:8000});
  assert.equal(await page.locator('#final-answer').inputValue(),'','換到下一題要清空答案欄');
  assert.equal(await page.locator('.assignment-nav').count(),0,'尚未提交下一題前不顯示導覽');
  // 最後一題提交後，改為提示可以正式提交
  await page.route('**/api/assignments/1', route => route.fulfill({json:{
    assignment:{...assignment,aiGrading:true,questionCount:3,totalPoints:18}, questions:threeQuestions,
    attempts:[justSubmitted,{...justSubmitted,id:2,questionId:2},{...justSubmitted,id:3,questionId:3}],
    mySubmission:{status:'not_started',submittedAt:null,resubmittedAt:null,submitCount:0,late:false,correction:null},
    report:{...awaitingReport,questionCount:3,pendingCount:0,awaitingReview:false}}}));
  await page.reload({waitUntil:'networkidle'});
  await page.locator('[data-assignment]').first().click();
  await page.locator('[data-assignment-q]').nth(2).click();
  await page.locator('#answer-area').waitFor({timeout:8000});
  await page.locator('[data-answer-mode=text]').click();
  await page.locator('#final-answer').fill('x=1');
  await page.locator('#consent-ai').check();
  await page.locator('#submit-answer').click();
  await page.locator('.assignment-nav').waitFor({timeout:8000});
  assert.match(await page.locator('.assignment-nav').innerText(),/已完成 3 \/ 3 題/);
  assert.equal(await page.locator('[data-next-question]').count(),0,'全部作答完不應再給下一題');
  assert.match(await page.locator('.assignment-nav [data-assignment]').innerText(),/返回本份作業提交/);

  // ── 教師批閱：評語可留空；一鍵 AI 全部批閱；教師側邊欄無自主練習 ──
  const practiceQuestions=[
    {id:101,title:'解一元二次方程',content:'解方程 $x^2-5x+6=0$。',topic:'一元二次方程',subtopic:'因式分解法',grade:'中三',points:6,level:1,qtype:'解答題',source:'校本題庫',tags:[],hint:''},
    {id:102,title:'選出正確的根',content:'下列何者為 $x^2=4$ 的根？',topic:'一元二次方程',subtopic:'因式分解法',grade:'中三',points:4,level:1,qtype:'選擇題',source:'校本題庫',tags:[],hint:'',options:['$x=2$','$x=-2$','$x=2$ 或 $x=-2$','$x=4$']},
    {id:103,title:'一次函數求值',content:'已知 $f(x)=2x+1$，求 $f(3)$。',topic:'函數',subtopic:'一次函數',grade:'中三',points:4,level:1,qtype:'填空題',source:'校本題庫',tags:[],hint:''},
  ];
  // 依目前登入身分回應狀態（覆寫前面學生情境用的固定狀態）。
  await page.route('**/api/state', route => route.fulfill({json:{
    user: role?{id:role==='teacher'?2:1,name:role==='teacher'?'介面測試教師':'介面測試學生',role,isOwner:role==='teacher'}:null,
    questions:practiceQuestions, attempts:[], stats:{completed:0,accuracy:0,streak:0,minutes:0},
    ai:{configured:true,mode:'local'}, topics:['一元二次方程','函數']}}));
  await page.locator('#account').click();await page.locator('#logout-btn').click();await page.waitForSelector('#homework-login');
  await login('teacher');
  assert.equal(await page.locator('#nav [data-page=practice]').count(),0,'教師側邊欄不應出現自主練習');
  assert.equal(await page.locator('#nav [data-page=ai]').count(),0,'教師側邊欄不該出現模型端點');
  assert.equal(await page.locator('#nav [data-page=import]').count(),1,'試卷拆題入庫要收在「題庫」下面');
  const teacherNav=await page.locator('#nav').innerText();
  for(const t of ['作業成績','題庫','批閱','試卷修正排版','我的試卷']) assert.ok(teacherNav.includes(t),`側欄要有「${t}」`);
  assert.equal(await page.locator('#nav .nav-group').count(),1,'「批閱」是分組標題');
  assert.ok(await page.locator('#nav .nav-item.child').count()>=4,'子項要縮排顯示');
  const resultsFixture = aiGrading => route => route.fulfill({json:{
    assignment:{...assignment,aiGrading},
    students:[{...student,status:'submitted',submittedAt:stamp,answeredCount:1,pendingCount:1,score:null,scoredPoints:0,confirmedScore:null,confirmedCount:0}],
    summary:{studentCount:1,submittedCount:1,correctionCount:0,fullyGradedCount:0,pendingReviewCount:1,averageScore:null,confirmedAverage:null},
    topicStats:[],
    questionStats:[
      {id:1,index:1,title:'因式分解解二次方程',topic:'一元二次方程',points:6,answered:2,graded:2,
       pending:0,skipped:0,unanswered:1,average:2,rate:33.3},
      {id:2,index:2,title:'求斜邊長',topic:'幾何',points:5,answered:1,graded:1,
       pending:0,skipped:0,unanswered:1,average:5,rate:100}]}});
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

  // 批閱佇列：存檔後直接換下一題（不關窗、不整頁重抓），最後一題才收尾；
  // 有 AI 建議分時可以一鍵採用。
  const queueQuestions=[1,2,3].map(n=>({...assignmentQuestion,id:n,title:`第${n}題：因式分解`}));
  const queueAttempts=[1,2,3].map(n=>({...handwritten,id:100+n,questionId:n,questionTitle:`第${n}題：因式分解`,
    aiScore:5,maxScore:6,score:null,status:'pending',teacherReviewed:false,
    ...(n===1?{reviewFlags:[{code:'rule-higher',message:'最終答案與參考答案等價，但 AI 只給 2/6 分，建議確認是否漏給過程分。'}]}:{})}));
  const queueResults={json:{assignment:{...assignment,aiGrading:true,questionCount:3,totalPoints:18},
    students:[{...student,status:'submitted',submittedAt:stamp,answeredCount:3,pendingCount:3,score:null,scoredPoints:0,confirmedScore:null,confirmedCount:0,reviewFlagCount:1}],
    summary:{studentCount:1,submittedCount:1,correctionCount:0,fullyGradedCount:0,pendingReviewCount:3,reviewFlagCount:1,averageScore:null,confirmedAverage:null},
    topicStats:[],
    questionStats:[
      {id:1,index:1,title:'第1題：因式分解',topic:'一元二次方程',points:6,answered:2,graded:2,
       pending:0,skipped:0,unanswered:0,average:2,rate:33.3},
      {id:2,index:2,title:'第2題：因式分解',topic:'一元二次方程',points:6,answered:1,graded:1,
       pending:0,skipped:0,unanswered:0,average:6,rate:100}]}};
  await page.route('**/api/assignments/1', route => route.fulfill({json:{
    assignment:{...assignment,aiGrading:true,questionCount:3,totalPoints:18}, questions:queueQuestions,
    attempts:queueAttempts,
    mySubmission:{status:'submitted',submittedAt:stamp,resubmittedAt:null,submitCount:1,late:false,correction:null},
    report:{score:null,maxScore:18,totalScoredPoints:0,pendingCount:3,confirmedScore:null,confirmedCount:0,topicStats:[],suggestion:advice}}}));
  await page.route('**/api/assignments/1/results', route => route.fulfill(queueResults));
  const queueBodies=[];
  await page.route('**/api/attempts/*/review', route => {
    const body=route.request().postDataJSON();queueBodies.push(body);
    const id=Number(new URL(route.request().url()).pathname.split('/')[3]);
    const at=queueAttempts.find(x=>x.id===id)||queueAttempts[0];
    return route.fulfill({json:{attempt:{...at,score:body.score,teacherReviewed:true,confirmedScore:body.score,
      feedback:'教師已覆核（未填寫評語）。',gradingMethod:'teacher-reviewed'}}});
  });
  await page.locator('[data-page=homework]').first().click();
  await page.locator('[data-results]').first().click();
  await page.locator('[data-student-result]').first().click();
  await page.locator('[data-hw-review]').first().click();
  await page.locator('#review-score').waitFor({timeout:8000});
  assert.match(await page.locator('.modal').innerText(),/待批閱佇列：第 1 \/ 3 題/,'要顯示佇列進度');
  assert.match(await page.locator('#review-form button[type=submit]').innerText(),/保存並看下一題/,'還有下一題時要能一路批下去');
  assert.equal(await page.locator('#adopt-ai').count(),1,'有 AI 建議分時要能一鍵採用');
  // 「建議覆核」：AI 建議分與規則核對衝突時，批閱彈窗要說明原因（不自動改分）
  assert.equal(await page.locator('.review-flag-box').count(),1,'有旗標時要顯示建議覆核提示');
  assert.match(await page.locator('.review-flag-box').innerText(),/等價/,'要說明衝突原因');
  await page.locator('#adopt-ai').click();
  await page.waitForFunction(()=>{const m=document.querySelector('#modal-root .modal');return m&&/第 2 \/ 3 題/.test(m.textContent);},{timeout:8000});
  assert.equal(await page.locator('.review-flag-box').count(),0,'沒有旗標的題目不該顯示提示');
  assert.equal(queueBodies.length,1,'採用 AI 建議也是存檔一次');
  assert.equal(queueBodies[0].score,5,'採用的是 AI 建議分');
  await page.locator('#review-score').fill('6');
  await page.locator('#review-form button[type=submit]').click();
  await page.waitForFunction(()=>{const m=document.querySelector('#modal-root .modal');return m&&/第 3 \/ 3 題/.test(m.textContent);},{timeout:8000});
  assert.match(await page.locator('#review-form button[type=submit]').innerText(),/保存教師批閱/,'最後一題要能收尾');
  await page.locator('#review-score').fill('4');
  await page.locator('#review-form button[type=submit]').click();
  await page.waitForFunction(()=>!document.querySelector('#modal-root .modal'),{timeout:8000});
  assert.equal(queueBodies.length,3,'三題都要存檔');
  assert.deepEqual(queueBodies.map(b=>b.score),[5,6,4],'每題存的分數各自正確');
  // 再走一次，但批完一題就直接關窗：上一層的成績表要自動重抓，
  // 否則教師會看到舊數字，誤以為分數沒存到（其實已經寫進資料庫）。
  await page.evaluate(()=>{window.__reviewRefresh=0;const orig=window.resultsPage;window.resultsPage=function(...a){window.__reviewRefresh++;return orig.apply(this,a);};});
  await page.locator('[data-student-result]').first().click();
  await page.locator('[data-hw-review]').first().click();
  await page.locator('#review-score').waitFor({timeout:8000});
  await page.locator('#review-score').fill('3');
  await page.locator('#review-form button[type=submit]').click();
  await page.waitForFunction(()=>{const m=document.querySelector('#modal-root .modal');return m&&/第 2 \/ 3 題/.test(m.textContent);},{timeout:8000});
  await page.locator('[data-action=close-modal]').click();
  await page.waitForFunction(()=>window.__reviewRefresh>0,{timeout:8000});
  assert.ok(await page.evaluate(()=>window.__reviewRefresh)>0,'批完一題直接關窗也要重抓成績表');
  assert.equal(queueBodies.length,4,'這次只批了第一題');
  // 成績頁要看得到「建議覆核題目」，教師才知道哪幾題要優先看
  await page.locator('.metric').first().waitFor({timeout:8000});
  assert.match(await page.locator('#main').innerText(),/建議覆核題目/,'成績頁要有建議覆核指標');
  assert.match(await page.locator('#main').innerText(),/建議覆核 1 題/,'學生列要標出建議覆核題數');
  assert.equal(await page.locator('#results-filter option[value=flagged]').count(),1,'要能只看有建議覆核的學生');
  // 逐題表現：由得分率低到高，低於 50% 且已批 2 人以上標「要重教」
  const qStats=page.locator('#main section.panel', {hasText:'逐題表現'});
  await qStats.waitFor({timeout:8000});
  const qRows=await qStats.locator('tbody tr').allInnerTexts();
  assert.match(qRows[0],/第 1 題/,'得分率最低的排最前');
  assert.match(qRows[0],/33\.3%/);
  assert.match(qRows[0],/要重教/,'低分且已批 2 人以上要標出來');
  // 整班連續批閱：所有待批作答排成一條佇列，存檔即跳下一題（手機一路滑完一班）
  await page.locator('#review-all-pending').waitFor({timeout:8000});
  assert.match(await page.locator('#review-all-pending').innerText(),/連續批閱（3 題）/,
               '要有整班連續批閱的入口，並顯示待批題數');
  await page.locator('#review-all-pending').click();
  await page.waitForFunction(()=>/待批閱佇列：第 1 \/ 3 題/.test(document.querySelector('#modal-root .modal')?.textContent||''),{timeout:8000});
  assert.ok(await page.locator('#modal-root .modal.review-modal').count()>0,'批閱彈窗要有 review-modal 類別（手機樣式用）');
  await page.locator('[data-action=close-modal]').click();
  console.log('PASS: 整班連續批閱（待批作答排成一條佇列，存檔即跳下一題）');
  console.log('PASS: 教師批閱佇列（存檔即換下一題、最後一題收尾、可採用 AI 建議、顯示建議覆核）');

  // 評分要點勾選計分：勾選即自動加總填入分數欄（仍可手動微調），全選／清除可用。
  // 修的是「rubric 只能看不能勾」——教師不必自己算百分比，也就不會打錯分。
  const rubricQuestion={...assignmentQuestion,rubric:[
    {label:'正確列式 $x^2-5x+6=0$',percent:30},
    {label:'因式分解正確',percent:40},
    {label:'寫出兩個根',percent:30}]};
  const rubricAttempt={...handwritten,id:301,questionId:1,aiScore:null,score:null,status:'pending',teacherReviewed:false,reviewFlags:[]};
  await page.route('**/api/assignments/1/results', resultsFixture(false));
  await page.route('**/api/assignments/1', route => route.fulfill({json:{
    assignment:{...assignment,aiGrading:false}, questions:[rubricQuestion], attempts:[rubricAttempt],
    mySubmission:{status:'submitted',submittedAt:stamp,resubmittedAt:null,submitCount:1,late:false,correction:null},
    report:{score:null,maxScore:6,totalScoredPoints:0,pendingCount:1,confirmedScore:null,confirmedCount:0,topicStats:[],suggestion:advice}}}));
  await page.route('**/api/attempts/*/history', route => route.fulfill({json:{reviews:[
    {id:1,teacherId:2,teacherName:'介面測試教師',oldScore:4,newScore:3,maxScore:6,
     feedback:'教師已覆核：只寫了因式分解。',method:'teacher-reviewed',createdAt:'2026-10-18T09:00:00Z'},
    {id:2,teacherId:2,teacherName:'介面測試教師',oldScore:3,newScore:5,maxScore:6,
     feedback:'教師已覆核：補上兩個根。',method:'teacher-reviewed',createdAt:'2026-10-19T10:00:00Z'}]}}));
  await page.locator('[data-page=homework]').first().click();
  await page.locator('[data-results]').first().click();
  await page.locator('[data-student-result]').first().click();
  await page.locator('[data-hw-review]').first().click();
  await page.locator('#review-rubric').waitFor({timeout:8000});
  assert.equal(await page.locator('#review-rubric .rubric-check-row').count(),3,'三個評分要點都要列出來');
  const rubricBoxes=page.locator('#review-rubric input[type=checkbox]');
  await rubricBoxes.nth(0).check();
  assert.equal(await page.locator('#review-score').inputValue(),'1.8','勾第一項要填入 30% × 6 分');
  await rubricBoxes.nth(1).check();
  assert.equal(await page.locator('#review-score').inputValue(),'4.2','兩項要加總成 70% × 6 分');
  assert.match(await page.locator('#rubric-total-hint').innerText(),/已勾 2\/3 項 · 合計 4\.2 分/,'要顯示已勾幾項與合計分數');
  assert.ok(await page.locator('#review-rubric .katex').count()>0,'評分要點裡的數學式要排版');
  // 分數異動紀錄：誰在何時把幾分改成幾分
  await page.locator('#review-history details').waitFor({timeout:8000});
  assert.match(await page.locator('#review-history summary').innerText(),/分數異動紀錄（2 次）/);
  const reviewHistoryText=await page.locator('#review-history').evaluate(el=>el.textContent);
  assert.match(reviewHistoryText,/4 → 3/,'要看得出舊分與新分');
  assert.match(reviewHistoryText,/3 → 5/);
  assert.match(reviewHistoryText,/介面測試教師/,'要記下是誰改的');
  await page.locator('#rubric-all').click();
  assert.equal(await page.locator('#review-score').inputValue(),'6','全選要剛好滿分');
  await page.locator('#rubric-none').click();
  assert.equal(await page.locator('#review-score').inputValue(),'6','取消勾選不應把已填的分數清掉');
  await page.locator('#review-score').fill('4.5');
  await page.locator('#review-form button[type=submit]').click();
  await page.waitForFunction(()=>!document.querySelector('#modal-root .modal'),{timeout:8000});
  assert.equal(queueBodies[queueBodies.length-1].score,4.5,'勾完仍可手動微調再送出');
  console.log('PASS: 評分要點可勾選計分（勾完自動加總、全選／清除、仍可微調）');

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
  // 學生在練習頁右側「從一道題，到一類題」看不到 AI 生成按鈕（只有教師可生成並加入題庫）
  await page.locator('#recommendations .recommend-label').first().waitFor({timeout:8000});
  assert.equal(await page.locator('#recommendations [data-generate]').count(),0,'學生不應看到 AI 生成題目的按鈕');
  // 可回到範圍選擇（保留原本條件）
  await page.locator('#change-range').click();
  await page.locator('#pr-topic').waitFor({timeout:8000});
  assert.equal(await page.locator('#pr-topic').inputValue(),'函數','換範圍應保留原本的章節');
  assert.match(await page.locator('#pr-count').innerText(),/1 題符合/);
  await page.screenshot({path:path.join(__dirname,'..','MathPath-自主練習範圍.png'),fullPage:true});

  // ── 教師：依題目由 AI 生成類似題，核驗後才決定是否加入題庫 ──
  await page.locator('#account').click();await page.locator('#logout-btn').click();await page.waitForSelector('#homework-login');
  await login('teacher');
  await page.reload({waitUntil:'networkidle'});
  await page.locator('#nav [data-page=bank]').click();
  const genBtn=page.locator('[data-aigen]').first();
  await genBtn.waitFor({timeout:8000});
  const importBefore=importedQuestions?importedQuestions.length:0;
  let verifiedImport=null;
  await page.route('**/api/questions/import',async route=>{verifiedImport=route.request().postDataJSON();await route.fallback();});
  await genBtn.click();
  await page.locator('[data-gen-kind=similar]').waitFor();
  await page.locator('[data-gen-kind=similar]').click();
  await page.locator('#ai-draft-save').waitFor({timeout:8000});
  const draftText=await page.locator('.modal').innerText();
  assert.equal(aiGenerated.kind,'similar','「生成相似題」應送出 kind=similar');
  assert.match(await page.locator('.modal h2').innerText(),/相似題/,'按「生成相似題」時彈窗要標示相似題');
  assert.match(draftText,/同難度/,'相似題要標示與參考題同難度，不能寫成進階題');
  // 可直接展開對照參考題，方便教師判斷「夠不夠類似」
  assert.equal(await page.locator('.modal .ref-compare').count(),1,'草稿彈窗應可展開對照參考題');
  assert.match(await page.locator('.modal .ref-compare summary').innerText(),/對照參考題/);
  assert.match(draftText,/尚未加入題庫/,'AI 生成後應先顯示草稿，並說明尚未加入題庫');
  assert.match(draftText,/參考答案/,'草稿應顯示參考答案供教師核驗');
  assert.match(draftText,/評分標準/,'草稿應顯示評分標準供教師核驗');
  // 評分標準要顯示排版後的數學式，不能只丟原始 LaTeX（$...$）
  assert.ok(await page.locator('.modal .draft-section .katex').count()>0,'評分標準的數學式應以 KaTeX 排版');
  const rubricText=await page.locator('.modal .draft-section').last().innerText();
  assert.equal(/\$[^$]{1,60}\$/.test(rubricText),false,'評分標準不應殘留未渲染的 $ 標記');
  assert.equal(importedQuestions?importedQuestions.length:0,importBefore,'教師未按「加入題庫」前，不應送出任何題目');
  assert.equal(aiGenerated.kind,'similar','應依教師選擇生成相似題');
  assert.ok(aiGenerated.qid>0,'應以教師點選的那道題為參考題');
  assert.equal(aiGenerated.consentExternal,false,'內部模型不應要求外部上傳同意');
  await page.locator('#ai-draft-save').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(__dirname,'..','MathPath-AI生成題目草稿.png'),fullPage:true});
  await page.locator('#ai-draft-save').click();
  await page.locator('.modal').waitFor({state:'detached',timeout:8000});
  assert.equal(importedQuestions.length,1,'教師確認後才把草稿送進題庫匯入');
  assert.equal(importedQuestions[0].title,'AI 生成 · 相似題');
  assert.equal(verifiedImport.teacher,true,'核驗匯入必須使用教師模式');
  assert.equal(importedQuestions[0].source,'AI 生成 · 教師已核驗','加入題庫後應標示為教師已核驗');
  assert.deepEqual(importedQuestions[0].tags,[],'教師核驗後應清除待核驗標籤');
  // 加入題庫後不應跳轉到該題：教師留在題庫頁，可以繼續生成或挑下一道參考題。
  assert.match(await page.locator('#main').innerText(),/數學題庫/,'加入題庫後應留在題庫頁，不跳轉到題目');
  assert.equal(await page.locator('#answer-area').count(),0,'加入題庫後不應跳到作答頁');
  // 同一道題再生成一次：這次要帶上已生成過的摘要，避免又拿到相同題目。
  await page.locator('[data-aigen]').first().click();
  await page.locator('[data-gen-kind=similar]').click();
  await page.locator('#ai-draft-save').waitFor({timeout:8000});
  assert.ok(Array.isArray(aiGenerated.avoid)&&aiGenerated.avoid.length>=1,
    '再次生成時應帶上已生成過的題目摘要，避免重複生成同一道題');
  await page.locator('#ai-draft-cancel').click();
  await page.locator('.modal').waitFor({state:'detached',timeout:8000});
  assert.equal(importedQuestions.length,1,'按「放棄」不應把草稿送進題庫');
  // 進階題：必須送出 kind=advanced，彈窗標示「高一級」，與相似題明確區分
  await page.locator('[data-aigen]').first().click();
  await page.locator('[data-gen-kind=advanced]').click();
  await page.locator('#ai-draft-save').waitFor({timeout:8000});
  assert.equal(aiGenerated.kind,'advanced','「生成進階題」應送出 kind=advanced');
  assert.match(await page.locator('.modal h2').innerText(),/進階題/,'按「生成進階題」時彈窗要標示進階題');
  assert.match(await page.locator('.modal .modal-intro').innerText(),/高一級/,'進階題要標示比參考題高一級');
  await page.locator('#ai-draft-cancel').click();
  await page.locator('.modal').waitFor({state:'detached',timeout:8000});
  // 練習頁右側面板的「AI 生成相似題／進階題」也要送出正確的 kind（兩者不可混在一起）
  await page.locator('.question-card').first().locator('.practice-btn').click();
  await page.locator('#answer-area').waitFor({timeout:8000});
  await page.locator('[data-generate=similar]').waitFor({timeout:8000});
  await page.locator('[data-generate=similar]').click();
  await page.locator('#ai-draft-save').waitFor({timeout:8000});
  assert.equal(aiGenerated.kind,'similar','練習頁面板的「AI 生成相似題」應送出 kind=similar');
  assert.match(await page.locator('.modal .modal-intro').innerText(),/同難度/);
  await page.locator('#ai-draft-cancel').click();
  await page.locator('.modal').waitFor({state:'detached',timeout:8000});
  await page.locator('[data-generate=advanced]').click();
  await page.locator('#ai-draft-save').waitFor({timeout:8000});
  assert.equal(aiGenerated.kind,'advanced','練習頁面板的「AI 生成進階題」應送出 kind=advanced');
  assert.match(await page.locator('.modal .modal-intro').innerText(),/高一級/);
  await page.locator('#ai-draft-cancel').click();
  await page.locator('.modal').waitFor({state:'detached',timeout:8000});
  // ── 本轮限定前端修复回归 ──
  await page.locator('#avatar').focus();await page.keyboard.press('Enter');
  await page.locator('.modal').waitFor();
  assert.equal(await page.locator('#avatar').evaluate(el=>el.tagName),'BUTTON','头像必须可通过键盘操作');
  assert.equal(await page.locator('.modal').evaluate(el=>el.getAttribute('aria-labelledby')===el.querySelector('h2').id),true);
  assert.equal(await page.locator('.modal h2').evaluate(el=>document.activeElement===el),true,'初始焦点应落在标题');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#logout-btn').evaluate(el=>document.activeElement===el),true,'标题按 Shift+Tab 应转到最后一个控件');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#avatar').evaluate(el=>document.activeElement===el),true,'关闭后恢复头像焦点');
  const contrast=await page.evaluate(()=>{
    const rgb=s=>s.match(/\d+/g).slice(0,3).map(Number),lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    const f=lum(rgb(getComputedStyle(document.querySelector('.field-hint')).color));return (1.05)/(f+.05);
  });
  assert.ok(contrast>=4.5,'次要文字对白色背景至少 4.5:1');
  assert.match(await page.locator('.app-footer').innerText(),/資料保存在網站伺服器；實際位置由管理員確認/);
  assert.doesNotMatch(await page.locator('#main').innerText(),/未公开|未公開到互聯網|尚未部署互聯網/);

  // 核验必须复制草稿，不能修改原对象。
  await page.evaluate(()=>{
    window.originalVerifiedDraft={title:'副本核验测试',content:'1+1',topic:'代數',grade:'中三',qtype:'填空題',points:1,level:1,answer:'2',source:'AI 生成 · 待核驗',tags:['待教師核驗','保留标签'],steps:[]};
    window.originalVerifiedJson=JSON.stringify(window.originalVerifiedDraft);aiDraftModal(window.originalVerifiedDraft,'similar',1);
  });
  await page.locator('#ai-draft-save').click();await page.locator('.modal').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>JSON.stringify(window.originalVerifiedDraft)===window.originalVerifiedJson),true,'原始草稿不可变');
  assert.deepEqual(verifiedImport.questions[0].tags,['保留标签']);assert.equal(verifiedImport.teacher,true);

  // 75 题分页；第 31 个选择被主动拒绝，筛选保留已选并回到第一页。
  await page.evaluate(()=>{
    window.savedRegressionQuestions=S.questions;
    S.questions=Array.from({length:75},(_,i)=>({id:200+i,title:`分页题 ${i+1}`,content:'1+1',topic:i<60?'代數':'幾何',subtopic:'',qtype:'填空題',grade:'中三',level:1,points:1,answer:'2',source:'教師已核驗',tags:[]}));
    HW={classes:[{id:1,name:'测试班',studentCount:1}]};createAssignmentModal();
  });
  assert.equal(await page.locator('#assignment-picks .pick-row').count(),60);
  await page.locator('[data-pick-page="2"]').click();assert.equal(await page.locator('#assignment-picks .pick-row').count(),15);
  await page.locator('[name=assignment-questions]').first().check();
  await page.locator('[data-pick-page="1"]').click();
  for(let i=0;i<29;i++)await page.locator('[name=assignment-questions]').nth(i).check();
  await page.locator('[name=assignment-questions]').nth(29).click();
  assert.equal(await page.locator('[name=assignment-questions]').nth(29).isChecked(),false,'不能选第 31 题');
  assert.match(await page.locator('#selected-question-count').innerText(),/已選 30 題/);
  await page.locator('[data-pick-page="2"]').click();await page.locator('#pick-search').fill('分页题 61');
  assert.equal(await page.locator('[name=assignment-questions]').first().isChecked(),true,'筛选不得丢掉第 61 题选择');
  assert.match(await page.locator('.pick-pagination').innerText(),/第 1 \/ 1 頁/);
  await page.keyboard.press('Escape');await page.evaluate(()=>{S.questions=window.savedRegressionQuestions;});

  await page.locator('#account').click();await page.locator('#logout-btn').click();await page.waitForSelector('#homework-login');await login('student');
  // 旧模测列表／详情、作业详情和推荐响应不得覆盖已切换的题库。
  for(const [url,expression] of [['**/api/mock','mockPage()'],['**/api/mock/7','mockExamPage(7)'],['**/api/assignments/1','assignmentPage(1)'],['**/api/questions/101/recommendations','openQuestion(101)']]){
    let release,started;const gate=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{started=resolve;});
    const delayed=async route=>{started();await gate;await route.fallback();};await page.route(url,delayed);
    await page.evaluate(expr=>{window.staleRequest=eval(expr);},expression);await seen;
    await page.evaluate(()=>navigate('bank'));release();await page.evaluate(()=>window.staleRequest);
    assert.equal(await page.evaluate(()=>page),'bank','旧响应不能改变当前页面');
    assert.match(await page.locator('#main h1').innerText(),/數學題庫/);await page.unroute(url,delayed);
  }

  // 订正范围只计最新 id > minAttemptId，拒绝内部越界、已提交、未开始／已到期入口。
  await page.evaluate(()=>{
    window.regressionQs=Array.from({length:3},(_,i)=>({...S.questions[0],id:301+i,title:`订正题 ${i+1}`,qtype:'解答題',options:[]}));
    assignmentDetail={assignment:{id:91,title:'范围测试',kind:'quiz',durationMinutes:1,dueAt:'2000-01-01',allowLate:false},questions:window.regressionQs,attempts:[{id:21,questionId:301},{id:10,questionId:302},{id:99,questionId:303},{id:9,questionId:301}],mySubmission:{status:'submitted',startedAt:null,expired:true,correction:{questionIds:[301,302],minAttemptId:10}}};
    assignmentContext=assignmentDetail.assignment;
  });
  assert.deepEqual(await page.evaluate(()=>[...assignmentAnsweredIds()]),[301]);
  await page.evaluate(()=>{assignmentDetail.mySubmission.correction.questionIds=[];});
  assert.deepEqual(await page.evaluate(()=>[...assignmentAnsweredIds()]),[],'空订正范围不能误作全部题目');
  await page.evaluate(()=>{assignmentDetail.mySubmission.correction.questionIds=[301,302];});
  await page.evaluate(()=>openAssignmentQuestion(303));assert.equal(await page.locator('#answer-area').count(),0,'订正范围外不能进入');
  await page.evaluate(()=>openAssignmentQuestion(301));await page.locator('#answer-area').waitFor();
  assert.equal(await page.evaluate(()=>mockContext),null,'作业入口必须清理模测上下文');
  assert.match(await page.evaluate(()=>assignmentNavHtml()),/已完成 1 \/ 2 題/);
  assert.doesNotMatch(await page.evaluate(()=>assignmentNavHtml()),/data-next-question="303"|data-prev-question="303"/);
  await page.evaluate(()=>{assignmentDetail.mySubmission.correction=null;});
  await page.evaluate(()=>openAssignmentQuestion(302));assert.equal(await page.evaluate(()=>currentQuestion.id),301,'已提交非订正必须锁定');
  await page.evaluate(()=>{assignmentDetail.mySubmission.status='not_started';});
  await page.evaluate(()=>openAssignmentQuestion(302));assert.equal(await page.evaluate(()=>currentQuestion.id),301,'尚未开始不能进入');
  await page.evaluate(()=>{assignmentDetail.mySubmission.startedAt=new Date().toISOString();});
  await page.evaluate(()=>openAssignmentQuestion(302));assert.equal(await page.evaluate(()=>currentQuestion.id),301,'已到期不能进入');

  // 同一题的三种草稿键隔离，保留旧作业／自主练习键。
  assert.deepEqual(await page.evaluate(()=>{
    const out=[];assignmentContext={id:91};mockContext=null;out.push(draftKey());assignmentContext=null;mockContext={id:7};out.push(draftKey());mockContext=null;out.push(draftKey());return out;
  }),['mathpath_draft_1_91_301','mathpath_draft_1_mock_7_301','mathpath_draft_1_practice_301']);

  if(errors.length)throw new Error('PAGE ERRORS: '+errors.join(' || '));
  // 延迟 FileReader：读取时阻止提交，切题丢弃结果，键盘可选／移除并保留恢复逻辑。
  await page.evaluate(()=>{assignmentContext=null;mockContext=null;currentQuestion=window.regressionQs[0];practice();answerMode='upload';renderAnswerArea();window.realFileData=fileData;fileData=()=>new Promise(resolve=>{window.releaseFileRead=resolve;});});
  // practice() 是非同步的，可能在 focus 之後重繪作答區把焦點搶掉；
  // 這裡重試幾次，免得競態變成隨機失敗（鍵盤可用性本身仍要驗）。
  let fileChooser=null;
  for(let attempt=0;attempt<4&&!fileChooser;attempt++){
    await page.locator('#answer-select').focus();
    fileChooser=await Promise.all([page.waitForEvent('filechooser',{timeout:3000}),page.keyboard.press('Enter')])
      .then(([c])=>c).catch(()=>null);
  }
  assert.ok(fileChooser,'「選擇檔案」用鍵盤 Enter 也要能開檔案選擇器');
  await fileChooser.setFiles({name:'slow.png',mimeType:'image/png',buffer:HANDWRITING});
  assert.match(await page.locator('#answer-read-status').innerText(),/正在讀取/);assert.equal(await page.locator('#submit-answer').isDisabled(),true);
  await page.evaluate(()=>{currentQuestion=window.regressionQs[1];answerFile=null;practice();window.releaseFileRead('data:image/png;base64,c3RhbGU=');});
  assert.equal(await page.evaluate(()=>answerFile),null,'旧题读取结果应丢弃');
  await page.evaluate(()=>{fileData=window.realFileData;answerMode='upload';renderAnswerArea();});
  await page.locator('#answer-upload').setInputFiles({name:'fresh.png',mimeType:'image/png',buffer:HANDWRITING});
  await page.waitForFunction(()=>!!answerFile&&!uploadReading);await page.evaluate(()=>saveDraft());
  await page.evaluate(()=>{answerFile=null;restoreDraft();});assert.equal(await page.locator('#answer-area img').count(),1,'上传草稿仍能恢复');
  await page.locator('#answer-remove').focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>answerFile),null);

  // 學生相片作答要在瀏覽器先縮圖轉 WebP：原檔 MB 級、送出 KB 級（直接影響網盤空間與上傳時間）。
  const photoDataUrl=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=2400;c.height=3200;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,2400,3200);g.addColorStop(0,'#f7f3ea');g.addColorStop(1,'#d8d2c4');x.fillStyle=g;x.fillRect(0,0,2400,3200);x.strokeStyle='#333';x.lineWidth=6;for(let i=0;i<160;i++){x.beginPath();x.moveTo(150,150+i*18);x.lineTo(2250,140+i*19);x.stroke();}return c.toDataURL('image/jpeg',0.95);});
  const photoBuffer=Buffer.from(photoDataUrl.split(',')[1],'base64');
  assert.ok(photoBuffer.length>800000,`測試相片要有 MB 級（實際 ${photoBuffer.length}）`);
  await page.locator('#answer-upload').setInputFiles({name:'homework.jpg',mimeType:'image/jpeg',buffer:photoBuffer});
  await page.waitForFunction(()=>!!answerFile&&!uploadReading);
  const compressed=await page.evaluate(()=>({url:answerFile,bytes:dataUrlBytes(answerFile)}));
  assert.match(compressed.url,/^data:image\/webp;base64,/,'相片要先轉成 WebP 再送出');
  assert.ok(compressed.bytes<400000,`壓縮後要在 400 KB 以內（實際 ${compressed.bytes}）`);
  assert.ok(compressed.bytes*5<photoBuffer.length,`至少要縮到原檔的五分之一（原檔 ${photoBuffer.length}、送出 ${compressed.bytes}）`);
  assert.match(await page.locator('#answer-read-status').innerText(),/已壓縮至約/,'要告訴學生相片已壓縮、送出更快');
  await page.evaluate(()=>{answerFile=null;renderAnswerArea();});

  // iPhone 預設用 HEIC 拍照，Chrome／Firefox 無法解碼：要自動轉成 WebP 再送出。
  // 測試先把轉換器注入（正式環境是選到 HEIC 才動態載入 vendor/heic2any.min.js）。
  await page.addScriptTag({path:path.join(__dirname,'vendor','heic2any.min.js')});
  assert.equal(await page.evaluate(()=>typeof window.heic2any),'function','轉換器要能載入並掛在 window 上');
  const heicBuffer=fs.readFileSync(path.join(__dirname,'bench','sample-heic.heic'));
  assert.ok(heicBuffer.length>1000,'測試用的 HEIC 檔案應存在（bench/sample-heic.heic）');
  await page.locator('#answer-upload').setInputFiles({name:'iphone.heic',mimeType:'image/heic',buffer:heicBuffer});
  await page.waitForFunction(()=>!!answerFile&&!uploadReading,null,{timeout:30000});
  const heicOut=await page.evaluate(()=>({url:answerFile,bytes:dataUrlBytes(answerFile)}));
  assert.match(heicOut.url,/^data:image\/webp;base64,/,'HEIC 要自動轉成 WebP 再送出（後端只接受 PNG／JPEG／WebP）');
  assert.ok(heicOut.bytes>0&&heicOut.bytes<400000,`HEIC 轉換後大小要合理（實際 ${heicOut.bytes}）`);
  assert.equal(await page.locator('#answer-area img').count(),1,'轉換後要顯示預覽，讓學生確認照片');
  await page.evaluate(()=>{answerFile=null;renderAnswerArea();});
  console.log('PASS: HEIC 相片自動轉成 WebP（Chrome 也能上傳 iPhone 照片）');

  // deadline 使用服务器时间；相同 target 切题／返回不得延长；到零不访问 null。
  await page.evaluate(()=>{navigate('bank');startQuizClock({kind:'assignment',id:92},60,new Date(Date.now()+5000).toISOString());window.deadlineBefore=quizClock.deadline;startQuizClock({kind:'assignment',id:92},999);});
  assert.equal(await page.evaluate(()=>quizClock.deadline===window.deadlineBefore),true);
  const serverDeadlineUsed=await page.evaluate(()=>quizClock.deadline-Date.now());assert.ok(serverDeadlineUsed>0&&serverDeadlineUsed<=5000,'应优先采用服务端绝对截止时间，而非 remainingSeconds');
  await page.evaluate(()=>stopQuizClock());
  let expiryCount=0;
  const expiryRoute=route=>{expiryCount++;return route.fulfill({json:{ok:true}});};await page.route('**/api/assignments/92/submit',expiryRoute);
  await page.evaluate(()=>{window.expiryPromise=startQuizClock({kind:'assignment',id:92},99,new Date(Date.now()-1).toISOString());});
  await page.waitForFunction(()=>quizSubmitting.size===0);assert.equal(expiryCount,1);assert.equal(await page.evaluate(()=>quizClock),null);
  await page.route('**/api/assignments/93/submit',route=>route.fulfill({status:503,json:{error:'封存服务测试失败'}}));
  await page.evaluate(()=>autoSubmitQuiz({kind:'assignment',id:93}));assert.match(await page.locator('#toast').innerText(),/自動封存失敗.*封存服务测试失败/);
  assert.doesNotMatch(await page.locator('#toast').innerText(),/即時計分/);

  // 保存中的作答先结束，再自动封存；不并发提交、不循环等待。
  let finishAttempt,attemptSeen;const saving=new Promise(resolve=>{finishAttempt=resolve;}),saveSeen=new Promise(resolve=>{attemptSeen=resolve;});let autoAfterSave=0;
  const heldAttempt=async route=>{attemptSeen();await saving;await route.fulfill({json:{attempt:{...graded(800,301,'代數',1,1),assignmentId:94}}});};
  await page.route('**/api/attempts',heldAttempt);
  await page.route('**/api/assignments/94/submit',route=>{autoAfterSave++;return route.fulfill({status:503,json:{error:'封存重试测试'}});});
  await page.evaluate(()=>{assignmentDetail={assignment:{id:94,title:'busy 测试'},mySubmission:{},questions:window.regressionQs,attempts:[]};assignmentContext=assignmentDetail.assignment;mockContext=null;currentQuestion=window.regressionQs[0];answerFile=null;practice();$('#final-answer').value='2';window.savingAnswer=submitAnswer();});await saveSeen;
  await page.evaluate(()=>startQuizClock({kind:'assignment',id:94},0,new Date(Date.now()-1).toISOString()));
  assert.equal(autoAfterSave,0,'busy 时不能提前封存');assert.equal(await page.evaluate(()=>pendingQuizSubmission.id),94);
  finishAttempt();await page.evaluate(()=>window.savingAnswer);assert.equal(autoAfterSave,1,'保存结束后应封存一次');
  assert.equal(await page.evaluate(()=>pendingQuizSubmission),null);assert.equal(await page.evaluate(()=>busy),false);
  assert.match(await page.locator('#result-root').innerText(),/自動封存失敗/);await page.unroute('**/api/attempts',heldAttempt);
  await page.evaluate(()=>{preserveDraft();navigate('bank');});
  console.log('PASS: 本轮订正边界、绝对截止时间、busy 封存协调、异步页面与上传防串、草稿隔离、75题分页/30题上限、AI核验副本、键盘焦点与文字对比度回归');

  // 拆題（圖片）：AI 框出的題目圖形要自動裁好、放在題目右邊，匯入時一併帶上
  await page.route('**/api/session',route=>route.fulfill({json:{user:{id:2,name:'介面測試教師',role:'teacher',isOwner:true}}}));
  await page.route('**/api/homework',route=>route.fulfill({json:{classes:[{id:1,name:'中三甲班',studentCount:1,studentIds:[1]}],assignments:[],students:[student]}}));
  await page.route('**/api/state',route=>route.fulfill({json:{user:{id:2,name:'介面測試教師',role:'teacher',isOwner:true},
    questions:[q,{...q,id:2,title:'直角三角形求斜邊',topic:'幾何',subtopic:'點、線、面、體'}],attempts:[],stats:{completed:0,accuracy:0,streak:0,minutes:0},ai:{...ai,vision:'test-vision'},topics:['一元二次方程','幾何']}}));
  await page.route('**/api/papers/parse',route=>route.fulfill({json:{
    method:'AI 識別（1 題偵測到圖形，將自動裁到題目右邊）',
    notice:'需要教師確認題目內容、分類、難度、分值和參考答案後才可匯入；識別不代表答案已核驗。',
    drafts:[{title:'附圖題',content:'如圖，求斜邊長。',topic:'幾何',subtopic:'點、線、面、體',level:1,grade:'中三',
             points:5,qtype:'解答題',options:[],answer:'$5\\\\text{ cm}$',steps:['用畢氏定理 $a^2+b^2=c^2$。'],
             hint:'先寫出 $c^2=3^2+4^2$。',analysis:'考點是畢氏定理。',source:'自動卷',tags:['待教師核驗'],
             figureBox:{x:0.5,y:0.5,w:0.2,h:0.2}}]}}));
  await page.reload({waitUntil:'networkidle'});
  await page.evaluate(()=>navigate('import'));
  await page.locator('#paper-drop').waitFor({timeout:8000});
  assert.match(await page.locator('.dropzone small').innerText(),/自動框出題目圖形/,'上傳圖片時要說明會自動框出題目圖形');
  await page.locator('#paper-upload').setInputFiles({name:'試卷.png',mimeType:'image/png',buffer:PAPER_PNG});
  await page.waitForFunction(()=>paperFile&&paperFile.name==='試卷.png');
  await page.locator('#parse-paper').click();
  await page.locator('.draft-card').waitFor({timeout:8000});
  await page.waitForFunction(()=>{const i=document.querySelector('.draft-card .draft-figure img');return !!(i&&i.complete&&i.naturalWidth>0);},{timeout:8000});
  assert.match(await page.locator('#main').innerText(),/偵測到圖形/,'拆分方式要說明偵測到圖形');
  const crop=await page.evaluate(()=>{
    const stem=document.querySelector('.draft-card .question-stem');
    const field=stem.querySelector('.question-stem-text').getBoundingClientRect();
    const fig=stem.querySelector('.draft-figure').getBoundingClientRect();
    const img=stem.querySelector('.draft-figure img');
    const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    const d=ctx.getImageData(0,0,c.width,c.height).data;
    let r=0,g=0,b=0,n=0;
    for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2];n++;}
    return {rightOfText:fig.left>=field.right-2,w:img.naturalWidth,h:img.naturalHeight,r:r/n,g:g/n,b:b/n};
  });
  assert.equal(crop.rightOfText,true,'拆題裁出的圖形要放在題目內容的右邊');
  assert.ok(crop.w>0&&crop.w<200,`只應裁出圖形範圍，不是整張試卷（實際 ${crop.w}px）`);
  assert.ok(crop.r>170&&crop.g<130&&crop.b<130,
    `裁出的圖形應是試卷上那塊紅色區域（實測 rgb ${Math.round(crop.r)},${Math.round(crop.g)},${Math.round(crop.b)}）`);
  // figureBox 只是拆題的中間產物，匯入前必須清掉，否則會被後端擋下。
  assert.equal(await page.locator('.draft-card [data-ai-figure]').count(),1,'拆題草稿卡要有「AI 生成圖形」');
  assert.equal(await page.evaluate(()=>drafts[0].figureBox),undefined,'匯入前必須清掉 figureBox');
  assert.match(await page.evaluate(()=>drafts[0].figure),/^data:image\/(webp|png);base64,/,'草稿要帶上裁好的圖形');
  assert.equal(await page.evaluate(()=>drafts[0].content),'如圖，求斜邊長。','題目文字不可被圖形影響');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-拆題圖形靠右.png'),fullPage:true});
  // 拆題步驟可以點回上一步：走錯了不必從頭再匯入一次。
  assert.equal(await page.locator('.stepper .step').count(),3,'拆題要有三個步驟');
  assert.match(await page.locator('.stepper .step.active').innerText(),/拆題與核驗/,'第二步要標成目前步驟');
  assert.equal(await page.locator('.stepper [data-import-step="3"]').isDisabled(),true,'不能跳到還沒到的步驟');
  assert.equal(await page.locator('.stepper [data-import-step="1"]').isDisabled(),false,'上一步要能點');
  await page.locator('.stepper [data-import-step="1"]').click();   // 有草稿時會先確認，對話框自動接受
  await page.waitForFunction(()=>!!document.querySelector('#paper-drop'),{timeout:8000});
  assert.equal(await page.evaluate(()=>importStage),1,'要回到第一步');
  assert.equal(await page.evaluate(()=>drafts.length),0,'回到第一步要清掉已拆分的題目');
  assert.match(await page.locator('#paper-filename').innerText(),/試卷\.png/,'第一步要保留剛選的試卷檔名');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-拆題回到上一步.png'),fullPage:true});
  console.log('PASS: 拆題（圖片）自動框出題目圖形、裁好放在題目右邊、匯入前清掉 figureBox');

  // 全自動匯入：題目先寫入題庫，圖形再由前端裁好後批次補上
  let figuresSent=null;
  await page.route('**/api/papers/auto-import',route=>route.fulfill({json:{count:1,
    method:'AI 識別（1 題偵測到圖形，將自動裁到題目右邊）',
    questions:[{id:77,title:'附圖題',topic:'幾何',level:1,grade:'中三',points:5,qtype:'解答題',
                tags:['自動匯入','待核驗'],source:'自動卷'}],
    figureBoxes:[{x:0.5,y:0.5,w:0.2,h:0.2}],notice:'已全自動拆分並匯入題庫。'}}));
  await page.route('**/api/questions/figures',route=>{figuresSent=route.request().postDataJSON();return route.fulfill({json:{updated:figuresSent.figures.length}});});
  await page.evaluate(()=>{importStage=1;navigate('import');});
  await page.locator('#paper-drop').waitFor({timeout:8000});
  await page.locator('#paper-upload').setInputFiles({name:'試卷.png',mimeType:'image/png',buffer:PAPER_PNG});
  await page.waitForFunction(()=>paperFile&&paperFile.name==='試卷.png');
  await page.locator('#auto-import-paper').click();
  await page.locator('#question-list').waitFor({timeout:8000});
  assert.ok(figuresSent,'全自動匯入後要把裁好的圖形補回題目');
  assert.equal(figuresSent.figures.length,1,'只送有圖形的題目');
  assert.equal(figuresSent.figures[0].id,77,'圖形要對應到剛匯入的題號');
  assert.match(figuresSent.figures[0].figure,/^data:image\/(webp|png);base64,/,'送出的必須是裁好的圖形');
  console.log('PASS: 全自動匯入後由前端批次補上題目圖形');

  // 題目圖形工作室：AI 只輸出規格（程式繪圖）→ 自動核對 → 不符就自動重畫
  let aiFigureSent=null,figureDraws=[],checkSent=null,checkCount=0,figureSaves=0;
  const FIGURE_SPEC={kind:'circle',points:[{name:'O',x:0,y:0},{name:'A',x:3,y:0}],
    segments:[],circles:[{center:'O',through:'A'}],marks:[],labels:[],givens:[]};
  await page.route('**/api/questions/ai-figure',route=>{
    figureDraws.push(route.request().postDataJSON());
    return route.fulfill({json:{svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">`+
      `<line x1='20' y1='280' x2='380' y2='280' stroke='#1f2d24' stroke-width='2'/>`+
      `<circle cx='200' cy='140' r='${figureDraws.length===1?60:70}' stroke='#1f2d24' stroke-width='2' fill='none'/>`+
      `<text x='196' y='146' font-size='14'>O</text></svg>`,
      spec:FIGURE_SPEC,issues:[],rounds:1,method:'AI 生成',notice:'這是草稿'}});});
  // 第一次核對故意不通過，用來驗證「自動重畫並複驗」的迴圈；
  // 之後（第 3 次起）也一律不通過，用來驗證「還有疑慮時存檔要先確認」。
  await page.route('**/api/questions/ai-figure-check',route=>{
    checkSent=route.request().postDataJSON();checkCount++;
    const bad=checkCount===1||checkCount>=3;
    return route.fulfill({json:{ok:!bad,
      issues:bad?['圖上把 3 標成 4','缺少直角標記']:[],
      advice:bad?'請依下列不符之處重畫：圖上把 3 標成 4。':'',
      question:{shape:'直角三角形',values:[{key:'AB',value:'3'}],marks:['直角記號']},
      figure:bad?{shape:'三角形',values:[{key:'AB',value:'4'}],marks:[]}
                :{shape:'直角三角形',values:[{key:'AB',value:'3'}],marks:['直角記號']},
      method:'AI 核對'}});});
  await page.route('**/api/questions/figures',route=>{aiFigureSent=route.request().postDataJSON();figureSaves++;return route.fulfill({json:{updated:1}});});
  await page.evaluate(()=>navigate('bank'));
  await page.locator('[data-aifig]').first().waitFor({timeout:8000});
  // 非幾何／向量題材：AI 畫圖停用並說明原因，但仍可手動插入圖片
  await page.locator('[data-aifig="1"]').click();
  await page.locator('.fig-preview').waitFor({timeout:8000});
  assert.equal(await page.locator('#fig-draw').isDisabled(),true,'非幾何／向量題材不應能用 AI 畫圖');
  assert.match(await page.locator('.modal').innerText(),/不是幾何或向量題材/,'要說明為什麼不能畫');
  assert.equal(await page.locator('#fig-check').isDisabled(),true,'沒有圖形時不能核對');
  assert.equal(await page.locator('#fig-apply').isDisabled(),true,'沒有圖形時不能套用');
  // 「手動插入圖片」要是真正的按鈕：鍵盤 Enter 也能開檔案選擇器
  const manualChooser=page.waitForEvent('filechooser',{timeout:4000}).catch(()=>null);
  await page.locator('#fig-manual-btn').focus();
  await page.keyboard.press('Enter');
  assert.ok(await manualChooser,'「手動插入圖片」用鍵盤 Enter 也要能開檔案選擇器');
  // 不支援的格式要說清楚怎麼做，不能只丟一句看不懂的錯誤
  await page.locator('#fig-manual').setInputFiles({name:'p.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4')});
  await page.waitForTimeout(250);
  assert.match(await page.locator('#toast').innerText(),/HEIC/,'不支援的格式要說明改用什麼');
  assert.equal(await page.locator('.fig-preview img').count(),0,'不支援的格式不應被當成圖形');
  // 教師端也要吃 HEIC（用 iPhone 拍題目）：走同一個 fitFigureImage，先轉 JPEG 再縮圖。
  if(await page.evaluate(()=>typeof window.heic2any)!=='function')
    await page.addScriptTag({path:path.join(__dirname,'vendor','heic2any.min.js')});
  await page.locator('#fig-manual').setInputFiles({name:'題目.heic',mimeType:'image/heic',
    buffer:fs.readFileSync(path.join(__dirname,'bench','sample-heic.heic'))});
  await page.waitForFunction(()=>{const i=document.querySelector('.fig-preview img');return !!(i&&i.complete&&i.naturalWidth>0);},{timeout:30000});
  assert.equal(await page.locator('#fig-apply').isDisabled(),false,'HEIC 轉換後也要能按「使用這張圖形」');
  assert.match(await page.locator('#toast').innerText(),/已插入/,'HEIC 要正常插入，不能跳「不支援」');
  console.log('PASS: 教師端 HEIC 圖片（題目圖形／圖形工作室）自動轉換');
  await page.locator('#fig-manual').setInputFiles({name:'圖.png',mimeType:'image/png',buffer:HANDWRITING});
  await page.waitForFunction(()=>{const i=document.querySelector('.fig-preview img');return !!(i&&i.complete&&i.naturalWidth>0);},{timeout:8000});
  assert.equal(await page.locator('#fig-apply').isDisabled(),false,'插入圖片後才能使用');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-手動插入圖形.png'),fullPage:true});
  await page.locator('#fig-apply').click();
  for(let i=0;i<50&&!aiFigureSent;i++)await page.waitForTimeout(100);
  assert.ok(aiFigureSent,'手動插入的圖形要寫回題目');
  assert.equal(aiFigureSent.figures[0].id,1,'圖形要對應到該題');
  assert.match(aiFigureSent.figures[0].figure,/^data:image\/(webp|png);base64,/);
  // 幾何題：一次按下就自動「畫圖 → 核對 → 不符就帶著問題重畫 → 再核對」
  await page.locator('[data-aifig="2"]').click();
  await page.locator('#fig-draw').waitFor({timeout:8000});
  assert.equal(await page.locator('#fig-draw').isDisabled(),false,'幾何題要能用 AI 畫圖');
  assert.match(await page.locator('#fig-draw').innerText(),/AI 生成圖形/);
  await page.locator('#fig-draw').click();
  await page.waitForFunction(()=>!!document.querySelector('.fig-check.ok'),{timeout:20000});
  assert.equal(figureDraws.length,2,'核對不通過時要自動重畫一次');
  assert.equal(figureDraws[0].content,'解方程 $x^2-5x+6=0$。','要把題目內容送給 AI');
  assert.equal(figureDraws[0].issues.length,0,'第一次生成不帶核對問題');
  assert.deepEqual(figureDraws[1].issues,['圖上把 3 標成 4','缺少直角標記'],'重畫要把核對問題帶上');
  assert.equal(checkSent.content,'解方程 $x^2-5x+6=0$。','核對要送題目內容');
  assert.match(checkSent.image,/^data:image\/(webp|png);base64,/,'核對要送圖形');
  assert.equal(await page.locator('#fig-fix').count(),0,'沒有疑慮時不顯示重畫按鈕');
  // 核對結果要能看到「題目說的」與「圖上畫的」兩份讀數，教師才知道系統憑什麼判斷
  await page.locator('.fig-read summary').first().click();
  assert.match(await page.locator('.fig-read-grid').innerText(),/題目說的/);
  assert.match(await page.locator('.fig-read-grid').innerText(),/圖上畫的/);
  assert.match(await page.locator('#toast').innerText(),/核對通過/,'要告訴教師已經自動核對通過');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-題圖核對.png'),fullPage:true});
  // AI 畫得不對時，教師可以直接在方格上自己畫，套用後取代 AI 的圖
  const aiFigureSrc=await page.locator('.fig-preview img').getAttribute('src');
  assert.equal(await page.locator('.fig-draw-panel').isHidden(),true,'手繪畫布預設收起');
  await page.locator('#fig-sketch-btn').click();
  await page.waitForFunction(()=>!document.querySelector('.fig-draw-panel').hidden);
  assert.match(await page.locator('#fig-sketch-btn').innerText(),/收起手繪畫布/);
  // 畫布在畫面上會被縮放，所以一律用「佔畫布幾成」的相對座標，不要用固定像素。
  const sketchBox=async()=>{
    await page.locator('#fig-studio-canvas').scrollIntoViewIfNeeded();
    return await page.locator('#fig-studio-canvas').boundingBox();
  };
  const at=(b,fx,fy)=>[b.x+b.width*fx,b.y+b.height*fy];
  const dragOnSketch=async(tool,from,to)=>{
    await page.locator(`#fig-studio-toolbar [data-tool=${tool}]`).click();
    const b=await sketchBox();
    const p0=at(b,...from),p1=at(b,...to);
    await page.mouse.move(p0[0],p0[1]);await page.mouse.down();
    await page.mouse.move(p1[0],p1[1],{steps:6});await page.mouse.up();
  };
  const penOnSketch=async()=>{
    const b=await sketchBox();
    const p0=at(b,0.10,0.15),p1=at(b,0.35,0.55),p2=at(b,0.10,0.55);
    await page.mouse.move(p0[0],p0[1]);await page.mouse.down();await page.mouse.move(p1[0],p1[1],{steps:8});await page.mouse.up();
    await page.mouse.move(p1[0],p1[1]);await page.mouse.down();await page.mouse.move(p2[0],p2[1],{steps:8});await page.mouse.up();
  };
  await page.locator('#fig-studio-toolbar [data-tool=pen]').click();
  await penOnSketch();
  assert.equal(await page.evaluate(()=>figStudio.sketch.strokes.length),2,'手繪線條要記錄在工作室狀態裡');
  assert.equal(await page.evaluate(()=>figStudio.sketch.strokes.every(x=>x.type==='pen')),true,'自由筆的型別要是 pen');
  // 直線、虛線、圓：拖曳就畫出來
  await dragOnSketch('line',[0.08,0.78],[0.42,0.78]);
  await dragOnSketch('dashed',[0.08,0.90],[0.42,0.90]);
  await dragOnSketch('circle',[0.62,0.45],[0.76,0.45]);
  assert.deepEqual(await page.evaluate(()=>figStudio.sketch.strokes.map(x=>x.type+(x.dashed?'-dashed':''))),
    ['pen','pen','line','line-dashed','circle'],'要有自由筆、直線、虛線與圓');
  // 畫布會被縮放，所以只驗「圓的半徑是拖曳出來的實際長度」而不是固定像素。
  assert.ok(await page.evaluate(()=>{const c=figStudio.sketch.strokes[4];
    return Math.hypot(c.points[1].x-c.points[0].x,c.points[1].y-c.points[0].y)>40;}),'圓要有實際半徑');
  // 點名稱：選了才出現輸入框，放完自動換下一個字母
  assert.equal(await page.locator('#fig-studio-label-field').isVisible(),true,'點名稱與字級欄位固定顯示');
  await page.locator('#fig-studio-toolbar [data-tool=label]').click();
  assert.equal(await page.locator('#fig-studio-label-text').inputValue(),'A','預設要放 A');
  const lbox=await sketchBox();
  const l0=at(lbox,0.15,0.20),l1=at(lbox,0.30,0.35);
  await page.mouse.click(l0[0],l0[1]);
  await page.mouse.click(l1[0],l1[1]);
  assert.deepEqual(await page.evaluate(()=>figStudio.sketch.strokes.filter(x=>x.type==='label').map(x=>x.text)),
    ['A','B'],'放完 A 要自動換 B');
  assert.equal(await page.locator('#fig-studio-label-text').inputValue(),'C','連續放第三個要換 C');
  const labelBefore=await page.evaluate(()=>{const l=figStudio.sketch.strokes.filter(x=>x.type==='label')[0];
    return {x:l.points[0].x,y:l.points[0].y,size:l.size};});
  assert.equal(labelBefore.size,26,'新放的點名稱要有預設字級');
  // 選擇工具：點一下選取、拖曳移動整項
  await page.locator('#fig-studio-toolbar [data-tool=select]').click();
  assert.equal(await page.locator('#fig-studio-label-field').isVisible(),true,'點名稱與字級欄位要固定顯示，工具列才不會跳動');
  const mv1=await sketchBox();
  await page.mouse.click(at(mv1,0.15,0.20)[0],at(mv1,0.15,0.20)[1]);
  assert.equal(await page.evaluate(()=>figStudio.sketch.selected?figStudio.sketch.selected.type:null),'label','點到點名稱要選取它');
  assert.equal(await page.locator('#fig-studio-label-text').inputValue(),'A','選到點名稱時欄位要顯示它的名字');
  assert.equal(await page.locator('#fig-studio-label-size').inputValue(),'26','選到點名稱時字級要顯示它的字級');
  // 點按鈕或截圖都可能捲動頁面，拖曳前重新量一次畫布位置。
  const mv1b=await sketchBox();
  const m0=at(mv1b,0.15,0.20),m1=at(mv1b,0.28,0.20);
  await page.mouse.move(m0[0],m0[1]);await page.mouse.down();
  await page.mouse.move(m1[0],m1[1],{steps:6});await page.mouse.up();
  const labelAfter=await page.evaluate(()=>{const l=figStudio.sketch.strokes.filter(x=>x.type==='label')[0];
    return {x:l.points[0].x,y:l.points[0].y};});
  // 畫布會被縮放，所以位移要換算回畫布座標（0.13 × 900）。
  assert.ok(Math.abs(labelAfter.x-labelBefore.x-0.13*900)<5,'拖曳要水平移動整個點名稱');
  assert.ok(Math.abs(labelAfter.y-labelBefore.y)<2,'拖曳不應影響另一個軸');
  // 字級滑桿：選取中的點名稱要跟著變，之後新放的也用新字級
  await page.locator('#fig-studio-label-size').evaluate(el=>{el.value='40';el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await page.evaluate(()=>figStudio.sketch.selected.size),40,'改字級要套用到選取的點名稱');
  assert.equal(await page.locator('#fig-studio-label-size-value').innerText(),'40','字級數值要同步顯示');
  assert.equal(await page.evaluate(()=>figStudio.sketch.labelSize),40,'新放的點名稱也要用新字級');
  // Delete 刪掉選取中的圖形
  await page.locator('#fig-studio-canvas').focus();
  await page.keyboard.press('Delete');
  assert.equal(await page.evaluate(()=>figStudio.sketch.strokes.filter(x=>x.type==='label').length),1,'Delete 要刪掉選取的點名稱');
  assert.equal(await page.evaluate(()=>figStudio.sketch.selected),null,'刪除後要取消選取');
  // 直線也能選取並整條拖曳；點空白處要取消選取
  const lineBefore=await page.evaluate(()=>{const l=figStudio.sketch.strokes.find(x=>x.type==='line');return {y:l.points[0].y};});
  const mv2=await sketchBox();
  await page.mouse.click(at(mv2,0.25,0.78)[0],at(mv2,0.25,0.78)[1]);
  assert.equal(await page.evaluate(()=>figStudio.sketch.selected?figStudio.sketch.selected.type:null),'line','點到直線要選取它');
  const mv2b=await sketchBox();
  const g0=at(mv2b,0.25,0.78),g1=at(mv2b,0.25,0.88);
  await page.mouse.move(g0[0],g0[1]);await page.mouse.down();
  await page.mouse.move(g1[0],g1[1],{steps:6});await page.mouse.up();
  const lineAfter=await page.evaluate(()=>{const l=figStudio.sketch.strokes.find(x=>x.type==='line');return {y:l.points[0].y};});
  // 畫布是 900×420，垂直位移要用高度換算（0.10 × 420）。
  assert.ok(Math.abs(lineAfter.y-lineBefore.y-0.10*420)<5,'拖曳要垂直移動整條直線');

  // 縮放與旋轉：選取圖形後才能用，欄位值跟著選取項同步；命中判定也要跟著變換。
  assert.equal(await page.locator('#fig-studio-item-scale').isDisabled(),false,'選取圖形後縮放可用');
  assert.equal(await page.locator('#fig-studio-item-rotate').isDisabled(),false,'選取圖形後旋轉可用');
  await page.locator('#fig-studio-item-scale').evaluate(el=>{el.value='160';el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await page.evaluate(()=>figStudio.sketch.selected.scale),1.6,'縮放要套用到選取項');
  assert.equal(await page.locator('#fig-studio-item-scale-value').innerText(),'160%','縮放數值要同步顯示');
  await page.locator('#fig-studio-item-rotate').evaluate(el=>{el.value='90';el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await page.evaluate(()=>figStudio.sketch.selected.rotate),90,'旋轉要套用到選取項');
  assert.equal(await page.locator('#fig-studio-item-rotate-value').innerText(),'90°','旋轉數值要同步顯示');
  const hitByTransform=await page.evaluate(()=>{
    const it=figStudio.sketch.strokes.find(x=>x.type==='line');
    const c=figureItemCenter(it);
    return {onAxis:!!topmostFigureItem([it],{x:c.x,y:c.y-200}),offAxis:!!topmostFigureItem([it],{x:c.x+400,y:c.y})};
  });
  assert.equal(hitByTransform.onAxis,true,'旋轉 90° 後，沿著旋轉後的方向要選得到');
  assert.equal(hitByTransform.offAxis,false,'旋轉後不該再沿著原本方向選到（命中範圍要跟著轉）');
  await page.evaluate(()=>{const it=figStudio.sketch.strokes.find(x=>x.type==='line');it.rotate=0;});
  const hitBeforeRotate=await page.evaluate(()=>{
    const it=figStudio.sketch.strokes.find(x=>x.type==='line');
    const c=figureItemCenter(it);
    return {offAxis:!!topmostFigureItem([it],{x:c.x,y:c.y-200})};
  });
  assert.equal(hitBeforeRotate.offAxis,false,'未旋轉時，垂直方向不該選到水平線');
  // 可以調回原狀
  await page.locator('#fig-studio-item-scale').evaluate(el=>{el.value='100';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#fig-studio-item-rotate').evaluate(el=>{el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await page.evaluate(()=>figStudio.sketch.selected.scale),1,'可以調回 100%');
  assert.equal(await page.evaluate(()=>figStudio.sketch.selected.rotate),0,'可以調回 0°');
  console.log('PASS: 手繪可縮放與旋轉所選圖形（命中判定跟著變換）');
  const mv3=await sketchBox();
  await page.mouse.click(mv3.x+mv3.width*0.93,mv3.y+mv3.height*0.07);
  assert.equal(await page.evaluate(()=>figStudio.sketch.selected),null,'點空白處要取消選取');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-教師手繪圖形.png'),fullPage:true});
  const countBefore=await page.evaluate(()=>figStudio.sketch.strokes.length);
  await page.locator('#fig-studio-undo').click();
  assert.equal(await page.evaluate(()=>figStudio.sketch.strokes.length),countBefore-1,'撤銷要拿掉最後一筆');
  await page.locator('#fig-studio-clear').click();
  assert.equal(await page.evaluate(()=>figStudio.sketch.strokes.length),0,'清除要清空畫布');
  await page.locator('#fig-sketch-apply').click();
  assert.match(await page.locator('#toast').innerText(),/畫布是空的/,'空畫布不能套用');
  // 再畫一版（自由筆＋直線＋圓）套用，取代 AI 的圖
  await page.locator('#fig-studio-toolbar [data-tool=pen]').click();
  await penOnSketch();
  await dragOnSketch('line',[0.08,0.78],[0.42,0.78]);
  await dragOnSketch('circle',[0.62,0.45],[0.76,0.45]);
  assert.equal(await page.evaluate(()=>figStudio.sketch.strokes.length),4,'重畫要有自由筆、直線與圓');
  await page.locator('#fig-sketch-apply').click();
  await page.waitForFunction(prev=>{const i=document.querySelector('.fig-preview img');return !!(i&&i.complete&&i.naturalWidth>0&&i.src!==prev);},aiFigureSrc,{timeout:8000});
  assert.equal(await page.locator('.fig-draw-panel').isHidden(),true,'套用後畫布要收起');
  assert.match(await page.locator('#fig-sketch-btn').innerText(),/手繪圖形/);
  assert.match(await page.locator('#toast').innerText(),/已套用手繪圖形/);
  assert.equal(await page.locator('.fig-check').count(),0,'手繪圖沒有規格可比對，舊的自動檢查結果要清掉');
  await page.locator('#fig-apply').click();
  for(let i=0;i<50&&aiFigureSent.figures[0].id!==2;i++)await page.waitForTimeout(100);
  assert.equal(aiFigureSent.figures[0].id,2,'幾何題的圖形要寫回該題');
  // 自動重畫也救不回來時（圖仍與題目差很遠）：還是可以存，但必須先把疑慮講清楚、要求確認
  const drawsBeforeLimit=figureDraws.length,checksBeforeLimit=checkCount;
  await page.locator('[data-aifig="2"]').click();
  await page.locator('#fig-draw').waitFor({timeout:8000});
  await page.locator('#fig-draw').click();
  await page.waitForFunction(()=>!!document.querySelector('.fig-check.bad'),{timeout:20000});
  assert.match(await page.locator('.fig-check.bad').innerText(),/圖上把 3 標成 4/,'要列出還剩下的疑慮');
  // 生成後最多檢驗兩次圖文是否相符：一直不合格也只畫兩輪、核對兩次。
  assert.equal(figureDraws.length-drawsBeforeLimit,2,'生成後最多畫兩輪');
  assert.equal(checkCount-checksBeforeLimit,2,'圖文相符最多核對兩次');
  assert.match(await page.locator('#toast').innerText(),/請人工核對/,'要提醒教師還有疑慮');
  const dialogsBefore=dialogs.length,savesBefore=figureSaves;
  await page.locator('#fig-apply').click();
  for(let i=0;i<50&&dialogs.length===dialogsBefore;i++)await page.waitForTimeout(100);
  assert.ok(dialogs.length>dialogsBefore,'還有疑慮時存檔要先確認');
  assert.match(dialogs[dialogs.length-1],/疑慮/);
  for(let i=0;i<50&&figureSaves===savesBefore;i++)await page.waitForTimeout(100);
  assert.equal(figureSaves,savesBefore+1,'確認後仍要能存檔');
  // 用 × 關閉後狀態要清掉：否則之後在任何地方貼上圖片都會把工作室叫回來、還把貼上事件吃掉
  await page.locator('[data-aifig="2"]').click();
  await page.locator('.fig-preview').waitFor({timeout:8000});
  await page.locator('[data-action=close-modal]').click();
  await page.waitForFunction(()=>figStudio===null,{timeout:5000});
  const afterClose=await page.evaluate(async b64=>{
    const bin=atob(b64);const arr=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
    const dt=new DataTransfer();
    dt.items.add(new File([arr],'p.png',{type:'image/png'}));
    const ev=new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true});
    document.dispatchEvent(ev);
    await new Promise(r=>setTimeout(r,300));
    return {open:!!document.querySelector('.fig-preview'),prevented:ev.defaultPrevented};
  }, HANDWRITING.toString('base64'));
  assert.equal(afterClose.open,false,'關閉工作室後貼上圖片不應把視窗叫回來');
  assert.equal(afterClose.prevented,false,'未開工作室時不應攔掉貼上事件');
  console.log('PASS: 題目圖形工作室（AI 只出規格、程式繪圖、自動核對與重畫、手動插入圖片、關閉後不留狀態）');

  // AI 變式題草稿：生成／重新生成圖形後，草稿彈窗要看得見那張圖。
  // （以前只把圖寫進 draft.figure，預覽卻沒有輸出圖形，畫面上完全看不出來有沒有更新。）
  let draftDraws=0;
  await page.route('**/api/questions/2/generate',route=>route.fulfill({json:{draft:{
    title:'相似：三角形求斜邊',content:'如圖，直角三角形兩邊長 3 cm 與 4 cm，求斜邊。',topic:'幾何',subtopic:'三角形',
    grade:'中三',points:6,level:1,qtype:'解答題',options:[],answer:'5 cm',steps:['用畢氏定理'],hint:'畢氏定理。',
    analysis:'畢氏定理。',rubric:[],source:'AI 生成 · 待核驗',tags:['AI 生成'],figure:''}}}));
  await page.route('**/api/questions/ai-figure',route=>{draftDraws++;
    return route.fulfill({json:{svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">`+
      `<circle cx='200' cy='140' r='${draftDraws===1?60:70}' stroke='#1f2d24' stroke-width='2' fill='none'/>`+
      `<text x='196' y='146' font-size='14'>O</text></svg>`,
      spec:FIGURE_SPEC,issues:[],rounds:1,method:'AI 生成',notice:'這是草稿'}});});
  await page.route('**/api/questions/ai-figure-check',route=>route.fulfill({json:{ok:true,issues:[],advice:'',
    question:{shape:'直角三角形',values:[{key:'AB',value:'3'}],marks:['直角記號']},
    figure:{shape:'直角三角形',values:[{key:'AB',value:'3'}],marks:['直角記號']},method:'AI 核對'}}));
  await page.evaluate(()=>navigate('bank'));
  await page.locator('[data-aigen="2"]').click();
  await page.locator('[data-gen-kind="similar"]').first().click();
  await page.locator('.draft-card').waitFor({timeout:8000});
  assert.equal(await page.locator('.draft-figure img').count(),0,'草稿剛生成時不應有圖形');
  await page.locator('#ai-draft-figure').click();
  await page.locator('#fig-draw').waitFor({timeout:8000});
  await page.locator('#fig-draw').click();
  await page.waitForFunction(()=>!!document.querySelector('.fig-preview img'),{timeout:20000});
  await page.locator('#fig-apply').click();
  await page.locator('.draft-figure img').waitFor({timeout:8000});
  const draftSrc=await page.locator('.draft-figure img').getAttribute('src');
  assert.match(draftSrc,/^data:image\//,'生成圖形後草稿彈窗要顯示圖形');
  assert.match(await page.locator('#ai-draft-figure').innerText(),/重新生成圖形/,'有圖形後按鈕要改成「重新生成圖形」');
  // 重新生成：彈窗裡的圖要真的換掉（這正是「重畫時沒有更新」的回歸測試）
  await page.locator('#ai-draft-figure').click();
  await page.locator('#fig-draw').waitFor({timeout:8000});
  await page.locator('#fig-draw').click();
  await page.waitForFunction(prev=>{const i=document.querySelector('.fig-preview img');
    return !!(i&&i.complete&&i.src!==prev);},draftSrc,{timeout:20000});
  await page.locator('#fig-apply').click();
  await page.waitForFunction(prev=>{const i=document.querySelector('.draft-figure img');
    return !!i&&i.src!==prev;},draftSrc,{timeout:10000});
  console.log('PASS: AI 變式題草稿生成／重新生成圖形後彈窗即時顯示新圖');
  // 移除圖形：工作室清空後「使用這張圖形」要還能按，才把移除送得出去
  await page.locator('#ai-draft-figure').click();
  await page.locator('#fig-draw').waitFor({timeout:8000});
  await page.locator('#fig-clear').click();
  await page.waitForFunction(()=>!!document.querySelector('.fig-empty'),{timeout:8000});
  assert.equal(await page.locator('#fig-apply').isDisabled(),false,'清空圖形後「移除這張圖形」要能按');
  assert.match(await page.locator('#fig-apply').innerText(),/移除這張圖形/,'清空後按鈕要說明是移除');
  await page.locator('#fig-apply').click();
  await page.waitForFunction(()=>!document.querySelector('.draft-figure img'),{timeout:10000});
  assert.match(await page.locator('#ai-draft-figure').innerText(),/AI 生成圖形/,'移除後按鈕要回到「AI 生成圖形」');
  await page.locator('[data-action=close-modal]').first().click();
  await page.locator('.modal').waitFor({state:'hidden'});
  console.log('PASS: 圖形工作室移除圖形可正常送出');

  // 教師手動新增題目：不必先匯入整份試卷，圖形用工作室（AI 生成／手繪／上傳）
  await page.locator('[data-page=newq]').first().click();
  await page.locator('#newq-title').waitFor({timeout:8000});
  assert.equal(await page.locator('#newq-title').count(),1,'題庫要能進到「新增題目」表單');
  await page.locator('#newq-title').fill('圓的切線長度');
  await page.locator('#newq-content').fill('已知圓 O 的半徑為 3 cm，P 為圓外一點，PT 為切線，OP = 5 cm，求 PT。');
  await page.locator('#newq-topic').selectOption('幾何');
  await page.locator('#newq-qtype').selectOption('解答題');
  await page.locator('#newq-points').fill('6');
  await page.locator('#newq-answer').fill('4 cm');
  // 圖形：開工作室 → 手繪 → 套用 → 使用這張圖形；工作室是彈窗，關掉後表單內容要還在
  await page.locator('#newq-figure-btn').click();
  await page.locator('#fig-sketch-btn').waitFor({timeout:8000});
  await page.locator('#fig-sketch-btn').click();
  await page.locator('#fig-studio-canvas').scrollIntoViewIfNeeded();
  const nbox=await page.locator('#fig-studio-canvas').boundingBox();
  await page.mouse.move(nbox.x+60,nbox.y+60);await page.mouse.down();await page.mouse.move(nbox.x+220,nbox.y+160,{steps:8});await page.mouse.up();
  await page.locator('#fig-sketch-apply').click();
  assert.match(await page.locator('.fig-preview img').getAttribute('src'),/^data:image\/(webp|png);base64,/,'手繪圖形要成為工作室目前的圖');
  await page.locator('#fig-apply').click();
  await page.waitForFunction(()=>!!document.querySelector('#newq-figure-preview img'),{timeout:8000});
  assert.match(await page.locator('#newq-figure-preview img').getAttribute('src'),/^data:image\/(webp|png);base64,/,'手繪圖形要顯示在新增題目的表單上');
  assert.equal(await page.locator('#newq-title').inputValue(),'圓的切線長度','關閉工作室後表單內容要保留');
  assert.equal(await page.locator('#newq-points').inputValue(),'6','關閉工作室後表單內容要保留');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-新增題目.png'),fullPage:true});
  const beforeNew=importedQuestions?importedQuestions.length:0;
  await page.locator('#newq-add').click();
  for(let i=0;i<60&&(importedQuestions?importedQuestions.length:0)===beforeNew;i++)await page.waitForTimeout(100);
  const created=importedQuestions[importedQuestions.length-1];
  assert.equal(created.title,'圓的切線長度','要送出剛填的題目');
  assert.equal(created.topic,'幾何');
  assert.equal(created.qtype,'解答題');
  assert.equal(created.points,6);
  assert.equal(created.source,'手動輸入');
  assert.match(created.figure,/^data:image\/(webp|png);base64,/,'圖形要一起送出');
  assert.match(await page.locator('#toast').innerText(),/已新增題目/,'建立後要提示');
  assert.equal(await page.locator('#question-list').count(),1,'建立後要回到題庫');
  console.log('PASS: 教師手動新增題目（表單、工作室手繪圖形、建立後直接進題庫）');



  // 有圖形的題目：圖形要放在題目右邊（不再排在題目下方），點一下可放大檢視
  const FIG='data:image/png;base64,'+HANDWRITING.toString('base64');
  await page.route('**/api/session',route=>route.fulfill({json:{user:{id:1,name:'介面測試學生',role:'student'}}}));
  await page.route('**/api/state',route=>route.fulfill({json:{user:{id:1,name:'介面測試學生',role:'student'},
    questions:[{...q,answer:undefined,steps:undefined,figure:FIG}],attempts:[],
    stats:{completed:0,accuracy:0,streak:0,minutes:0},ai,topics:['一元二次方程','幾何']}}));
  await page.reload({waitUntil:'networkidle'});
  await page.locator('[data-page=bank]').first().click();
  await page.locator('.question-card').first().waitFor({timeout:8000});
  await page.waitForFunction(()=>{const i=document.querySelector('.question-card .question-figure img');return !!(i&&i.complete&&i.naturalWidth>0);},{timeout:8000});
  const figBox=await page.evaluate(()=>{
    const stem=document.querySelector('.question-card .question-stem');
    if(!stem)return null;
    const t=stem.querySelector('.question-stem-text').getBoundingClientRect();
    const f=stem.querySelector('.question-figure').getBoundingClientRect();
    return {rightOfText:f.left>=t.right-2,rowAligned:Math.abs(f.top-t.top)<80,width:Math.round(f.width)};
  });
  assert.ok(figBox,'有圖形的題目應產生 .question-stem（題面與圖形並排）');
  assert.equal(figBox.rightOfText,true,'題目圖形要在題目文字的右邊');
  assert.equal(figBox.rowAligned,true,'圖形要與題目文字同一列（並排），不是排在題目下方');
  assert.ok(figBox.width>=120&&figBox.width<=470,`圖形寬度要合理（實際 ${figBox.width}px）`);
  assert.equal(await page.locator('.question-card .question-figure').count(),1,'圖形只渲染一次');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-題目圖形靠右.png'),fullPage:true});
  await page.locator('.question-card .question-figure img').first().click();
  await page.locator('.figure-zoom').waitFor({timeout:5000});
  assert.equal(await page.locator('.figure-zoom img').count(),1,'放大檢視要顯示圖形');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-題目圖形放大.png')});
  await page.keyboard.press('Escape');
  await page.locator('.figure-zoom').waitFor({state:'detached',timeout:5000});
  // 練習頁同樣並排，且作答區不重複列選項
  await page.locator('.question-card .practice-btn').first().click();
  await page.locator('.practice-question').waitFor({timeout:8000});
  const practiceFig=await page.evaluate(()=>{
    const stem=document.querySelector('.practice-question .question-stem');
    if(!stem)return null;
    const t=stem.querySelector('.question-stem-text').getBoundingClientRect();
    const f=stem.querySelector('.question-figure').getBoundingClientRect();
    return {rightOfText:f.left>=t.right-2};
  });
  assert.ok(practiceFig&&practiceFig.rightOfText,'練習頁的題目圖形同樣要在題目右邊');
  assert.equal(await page.locator('.practice-question .choice-options').count(),0,'題目區不因加入圖形而重複列選項');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-練習頁圖形靠右.png'),fullPage:true});
  await page.evaluate(()=>navigate('bank'));
  console.log('PASS: 題目圖形（有圖形的題目把圖形排在題目右邊、練習頁一致、點擊可放大檢視）');

  // 教師的「作答批閱」不應出現「再練一次」（那是學生的錯題本功能）
  // 前兩筆是作業（要教師批閱），第三筆是學生的自主練習（不屬教師批閱範圍）。
  const teacherAttempts=[{...graded(5,1,'一元二次方程',6,6),assignmentId:1,student:{id:1,name:'介面測試學生',username:'student'}},
                         {...handwritten,id:9,assignmentId:1},
                         {...graded(7,2,'幾何',0,5),student:{id:1,name:'介面測試學生',username:'student'}}];
  await page.route('**/api/session',route=>route.fulfill({json:{user:{id:2,name:'介面測試教師',role:'teacher',isOwner:true}}}));
  await page.route('**/api/state', route => route.fulfill({json:{user:{id:2,name:'介面測試教師',role:'teacher',isOwner:true},
    questions:[q,{...q,id:2,title:'直角三角形求斜邊',topic:'幾何'}],attempts:teacherAttempts,
    stats:{completed:2,accuracy:55,streak:1,minutes:10},ai,topics:['一元二次方程','幾何']}}));
  await page.reload({waitUntil:'networkidle'});
  await page.evaluate(()=>navigate('mistakes'));
  await page.locator('.record').first().waitFor({timeout:8000});
  // 教師第一次進來預設篩「等待批閱」（那才是每天要做的事）；測試資料都是已批閱，
  // 這裡先確認預設狀態，再切到「全部作答」看紀錄。
  assert.equal(await page.locator('.history-filters [data-history=pending]').getAttribute('class'), 'active', '教師批閱頁預設要停在「等待批閱」');
  await page.locator('.history-filters [data-history=all]').click();
  assert.match(await page.locator('#main').innerText(),/作答批閱/,'教師要進入作答批閱頁');
  assert.ok((await page.locator('.record').count())>=2,'教師要看到學生的作答紀錄');
  assert.equal(await page.locator('.record-actions [data-qid]').count(),0,'教師的作答批閱不應出現「再練一次」');
  assert.match(await page.locator('.record-actions').first().innerText(),/查看與批閱/,'教師要有「查看與批閱」');
  // 「查看與批閱」是教師批閱清單裡的主要動作，要用主色並放大（學生的「查看作答」維持次要樣式）。
  const reviewBtnStyle=await page.locator('.record-actions .primary').first().evaluate(el=>{const s=getComputedStyle(el);return {bg:s.backgroundColor,size:parseFloat(s.fontSize),pad:parseFloat(s.paddingTop)};});
  assert.equal(reviewBtnStyle.bg,'rgb(25, 124, 104)','「查看與批閱」要用主色');
  assert.ok(reviewBtnStyle.size>=15,`「查看與批閱」要放大字級（實際 ${reviewBtnStyle.size}px）`);
  assert.ok(reviewBtnStyle.pad>=11,`「查看與批閱」要加大內距（實際 ${reviewBtnStyle.pad}px）`);
  await page.screenshot({path:path.join(__dirname,'..','MathPath-查看與批閱按鈕.png'),fullPage:true});
  // 按鈕文字要清楚：主要動作 600、篩選籤至少 500
  const weightOf=sel=>page.locator(sel).first().evaluate(el=>Number(getComputedStyle(el).fontWeight));
  assert.ok(await weightOf('.record-actions .primary')>=600,'批閱按鈕要粗體');
  assert.ok(await weightOf('.history-filters button')>=500,'篩選籤字重不能太輕');
  assert.ok(await weightOf('button.secondary')>=600,'次要按鈕也要清楚');
  // 學生的自主練習不屬教師批閱範圍：要標示清楚，而且只能看、不能打分。
  const selfRow=page.locator('.record').filter({hasText:'自主練習'});
  assert.equal(await selfRow.count(),1,'教師要看到學生的自主練習紀錄');
  assert.match(await selfRow.innerText(),/不需批閱/);
  assert.match(await selfRow.locator('.record-actions').innerText(),/查看作答/,'自主練習不該出現「查看與批閱」');
  assert.equal(await selfRow.locator('.record-actions .primary').count(),0,'自主練習不該用主色批閱按鈕');
  // 教師的清單很長：學習建議預設收合成一行（學生的錯題本仍直接展開）
  assert.equal(await page.locator('.record-advice').count(),await page.locator('.record').count(),'教師清單每一筆的學習建議都要收合');
  assert.equal(await page.locator('.record-advice').first().evaluate(el=>el.open),false,'收合要預設關起來');
  await selfRow.locator('[data-review]').click();
  await page.locator('#modal-root .modal').waitFor({timeout:8000});
  assert.equal(await page.locator('#review-score').count(),0,'自主練習不該出現教師評分表單');
  assert.equal(await page.locator('#ann-canvas').count(),0,'自主練習不該出現教師批註工具');
  assert.equal(await page.locator('#modal-root #retry-from-review').count(),0,'教師看學生的自主練習也不該出現「再練一次」');
  assert.equal((await page.locator('#modal-root .eyebrow').innerText()).trim(),'YOUR THINKING','自主練習用學生視角呈現');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-自主練習只讀.png'),fullPage:true});
  await page.locator('[data-action=close-modal]').click();
  // 教師在題庫是「檢視題目」——教師不進行自主練習，寫「開始練習」會誤導。
  await page.evaluate(()=>navigate('bank'));
  await page.locator('.question-card').first().waitFor({timeout:8000});
  const bankBtn=page.locator('.question-card button[data-qid]').first();
  assert.match(await bankBtn.innerText(),/檢視題目/,'教師的題庫卡片要寫「檢視題目」');
  assert.doesNotMatch(await bankBtn.innerText(),/開始練習/,'教師不該看到「開始練習」');
  assert.doesNotMatch(await page.locator('.hero').innerText(),/開始今日練習/,'教師的題庫首屏也不該出現「開始今日練習」');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-教師題庫檢視題目.png'),fullPage:true});
  // 教師可以在題庫直接編輯題目：表單要帶入現值（含題解與選項），存檔送出完整設定。
  let questionUpdate=null;
  await page.route('**/api/questions/1/update',route=>{
    questionUpdate=route.request().postDataJSON();
    return route.fulfill({json:{question:{...questionUpdate.question,id:1}}});
  });
  await page.locator('.question-card [data-editq]').first().click();
  await page.locator('#editq-title').waitFor({timeout:8000});
  assert.equal(await page.locator('#editq-title').inputValue(),q.title,'編輯表單要帶入現有標題');
  assert.equal(await page.locator('#editq-topic').inputValue(),q.topic,'要帶入主分類');
  assert.equal(await page.locator('#editq-answer').inputValue(),q.answer,'要帶入參考答案');
  assert.equal(await page.locator('#editq-points').inputValue(),'6','要帶入分值');
  assert.match(await page.locator('#editq-steps').inputValue(),/零乘積|分解/,'要帶入詳解步驟（題解）');
  assert.equal(await page.locator('#editq-options input').count(),4,'選擇題要帶入四個選項');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-編輯題目.png'),fullPage:true});
  await page.locator('#editq-title').fill('改過的標題');
  await page.locator('#editq-points').fill('9');
  await page.locator('#editq-add').click();
  await page.locator('#modal-root .modal').waitFor({state:'detached',timeout:8000});
  assert.equal(questionUpdate.question.title,'改過的標題','要送出改過的標題');
  assert.equal(questionUpdate.question.points,9,'要送出改過的分值');
  assert.equal(questionUpdate.question.answer,q.answer,'沒改的欄位也要一起送出（整份設定）');
  assert.ok(questionUpdate.question.steps.length>0,'詳解步驟要一起送出');
  assert.equal(questionUpdate.question.options.length,4,'選項要一起送出');
  assert.equal(questionUpdate.figure,undefined,'沒有動圖形時不該送 figure（保留原本那張）');
  assert.deepEqual(questionUpdate.question.tags,q.tags,'標籤要沿用原值（否則「待核驗」會被洗掉）');
  assert.equal(questionUpdate.question.source,q.source,'來源要沿用原值');
  console.log('PASS: 教師可在題庫編輯題目（所有設定帶入現值、存檔送出完整設定、不動圖形就不送 figure、標籤與來源不被洗掉）');
  // 只生成評分標準：已有答案的題目可以只補 rubric，不會改動答案。
  await page.route('**/api/questions/*/rubric', route => route.fulfill({json:{
    rubric:[{label:'列出 $180-55-65$ 的算式',percent:60},
            {label:'求出 $60^\\circ$ 並寫出單位',percent:40}],
    notice:'這是 AI 草稿：請逐項核對文字與百分比，確認後再儲存題目。'}}));
  await page.locator('.question-card [data-editq]').first().click();
  await page.locator('#editq-title').waitFor({timeout:8000});
  // 選擇題是客觀題，評分標準欄位是隱藏的；改成解答題才會出現「只生成評分標準」。
  await page.locator('#editq-qtype').selectOption('解答題');
  await page.locator('#editq-ai-rubric').waitFor({timeout:8000});
  await page.locator('#editq-ai-rubric').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-rubric-list="editq"] .rubric-row').length===2,{timeout:8000});
  assert.equal(await page.locator('[data-rubric-list="editq"] .rubric-label').first().inputValue(),
               '列出 $180-55-65$ 的算式','生成的要點要填進編輯器，讓教師可修改');
  assert.match(await page.locator('[data-rubric-total="editq"]').innerText(),/總和 100%/,'生成的百分比要加總成 100');
  await page.locator('#modal-root .modal [data-action=close-modal]').click();
  console.log('PASS: 只生成評分標準（用現有答案拆評分要點、不動答案、百分比加總 100）');
  // 對照：學生的錯題本仍保留「再練一次」
  await page.route('**/api/session',route=>route.fulfill({json:{user:{id:1,name:'介面測試學生',role:'student'}}}));
  await page.route('**/api/state', route => route.fulfill({json:{user:{id:1,name:'介面測試學生',role:'student'},
    questions:[q,{...q,id:2,title:'直角三角形求斜邊',topic:'幾何'}],attempts:teacherAttempts,
    stats:{completed:2,accuracy:55,streak:1,minutes:10},ai,topics:['一元二次方程','幾何']}}));
  await page.reload({waitUntil:'networkidle'});
  await page.evaluate(()=>navigate('mistakes'));
  await page.locator('.record-actions [data-qid]').first().waitFor({timeout:8000});
  assert.match(await page.locator('.record-actions').first().innerText(),/再練一次/,'學生的錯題本仍要能再練一次');
  console.log('PASS: 教師作答批閱不顯示「再練一次」（學生的錯題本仍保留）');

  // 日曆：同一份作業的「發布」與「截止」是兩筆事件，
  // 不該被數成兩份作業、也不該看起來像同一份作業重複列在好幾天。
  const calNow=new Date(),calY=calNow.getFullYear(),calM=calNow.getMonth();
  const calDim=new Date(calY,calM+1,0).getDate();
  const calIso=d=>`${calY}-${String(calM+1).padStart(2,'0')}-${String(Math.min(d,calDim)).padStart(2,'0')}`;
  const calEvents=[
    {date:calIso(8),event:'published',kind:'homework',title:'課後練習一',assignmentId:1,classId:1,className:'中三甲班',dueAt:`${calIso(20)}T23:59`,myStatus:'pending'},
    {date:calIso(20),event:'due',kind:'homework',title:'課後練習一',assignmentId:1,classId:1,className:'中三甲班',dueAt:`${calIso(20)}T23:59`,myStatus:'pending'},
    {date:calIso(13),event:'due',kind:'quiz',title:'模擬測驗二',assignmentId:2,classId:1,className:'中三甲班',dueAt:`${calIso(13)}T20:00`,myStatus:null},
  ];
  // ⚠️ `**/api/calendar` 這種 glob 不會匹配帶 `?from=...&to=...` 的網址，
  // 要用完整主機樣式並在處理式裡判斷路徑；後註冊的路由優先（見 route 探測）。
  await page.route('https://mathpath.test/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname!=='/api/calendar')return route.fallback();
    return route.fulfill({json:{events:calEvents,notes:[]}});
  });
  await page.evaluate(()=>navigate('calendar'));
  await page.locator('.cal-grid').waitFor({timeout:8000});
  const metricText=await page.locator('.metric-row').innerText();
  assert.match(metricText,/本月作業\s*1\s*項/,'同一份作業的發布與截止只能算一份作業（實際：'+metricText.replace(/\s+/g,' ')+'）');
  assert.match(metricText,/本月測驗\s*1\s*項/,'測驗也只能算一份');
  assert.match(metricText,/本月事件\s*3\s*項/,'事件數仍要把發布與截止分開算');
  const cellMark=async d=>{
    const cell=page.locator(`.cal-cell[data-cal-date="${calIso(d)}"]`);
    return (await cell.locator('.cal-mark').allInnerTexts()).join('+');
  };
  assert.equal(await cellMark(8),'1 項作業','發布日要寫明是作業，不是「作業 1」這種像名稱的寫法');
  assert.equal(await cellMark(13),'1 項測驗截止','測驗截止日要寫明是測驗且是截止');
  assert.equal(await cellMark(20),'1 項作業截止','作業截止日要寫明是截止，看起來才不像同一份作業重複出現');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-日曆發布與截止.png'),fullPage:true});
  // 點截止日，詳細資訊要標明「截止」，讓教師知道為什麼這天也有這份作業
  await page.locator(`.cal-cell[data-cal-date="${calIso(20)}"]`).click();
  await page.locator('.cal-event').first().waitFor({timeout:8000});
  assert.match(await page.locator('.cal-event').first().innerText(),/截止/,'截止日的詳細資訊要標明截止');
  assert.match(await page.locator('.cal-event').first().innerText(),/課後練習一/,'詳細資訊仍要列出作業名稱');
  console.log('PASS: 日曆把發布與截止分開標示，作業數不再把同一份作業算兩次');

  // 題與題之間的區分：同一個清單裡連續多題時，每一題有自己的色系（四色循環），
  // 連續好幾題才看得出「一題到哪裡結束、下一題從哪裡開始」。
  const hexToRgb=h=>`rgb(${parseInt(h.slice(1,3),16)}, ${parseInt(h.slice(3,5),16)}, ${parseInt(h.slice(5,7),16)})`;
  const fourQuestions=[1,2,3,4].map(n=>({...assignmentQuestion,id:n,title:`第${n}題：因式分解`,figure:undefined}));
  await page.route('**/api/assignments/1', route => route.fulfill({json:{
    assignment:{...assignment,questionCount:4,totalPoints:24}, questions:fourQuestions, attempts:[],
    mySubmission:{status:'not_started',submittedAt:null,resubmittedAt:null,submitCount:0,late:false,correction:null},
    report:{score:null,maxScore:24,totalScoredPoints:0,pendingCount:0,confirmedScore:null,confirmedCount:0,
            gradedCount:0,questionCount:4,percent:null,aiScore:null,ruleScore:null,topicStats:[],suggestion:advice}}}));
  await page.evaluate(()=>assignmentPage(1));
  await page.locator('.assignment-question-row').first().waitFor({timeout:8000});
  const rowStyles=await page.$$eval('.assignment-question-list > article.assignment-question-row',rows=>rows.map(r=>{
    const cs=getComputedStyle(r),badge=r.querySelector('.question-number,.q-index');
    return {accent:cs.getPropertyValue('--q-accent').trim(),tint:cs.backgroundColor,
            border:cs.borderLeftColor,width:cs.borderLeftWidth,
            badge:badge?getComputedStyle(badge).color:''};
  }));
  assert.equal(rowStyles.length,4,'四題都要列出來');
  assert.equal(new Set(rowStyles.map(r=>r.accent)).size,4,'連續的題目要用不同色系區分');
  assert.equal(rowStyles[0].accent,'#2f6d55','第一題要是第一個色系（不能被清單標題佔位而從第二色開始）');
  assert.equal(rowStyles[1].accent,'#2c6a8e','第二題要用第二個色系');
  assert.equal(new Set(rowStyles.map(r=>r.tint)).size,4,'底色也要交替，題目的界線才看得出來');
  rowStyles.forEach((r,i)=>{
    assert.equal(r.width,'4px',`第 ${i+1} 題要有左側色條`);
    assert.equal(r.border,hexToRgb(r.accent),`第 ${i+1} 題的色條要跟色系一致`);
    assert.equal(r.badge,hexToRgb(r.accent),`第 ${i+1} 題的編號顏色要跟色系一致`);
  });
  // 題庫卡片同樣要一題一色
  await page.evaluate(()=>navigate('bank'));
  await page.locator('.question-card').first().waitFor({timeout:8000});
  const cardAccents=await page.$$eval('.question-list > article.question-card',
    cards=>cards.map(c=>getComputedStyle(c).getPropertyValue('--q-accent').trim()));
  assert.ok(cardAccents.length>=2,'題庫要有題目卡片');
  assert.equal(new Set(cardAccents).size,cardAccents.length,'題庫相鄰卡片也要用不同色系');
  assert.equal(cardAccents[0],'#2f6d55','題庫第一張卡片要是第一個色系');
  console.log('PASS: 題與題之間用四色循環區分（色條＋編號＋底色交替）');

  // 版面配色：可切到「墨夜」（深色），記在 localStorage，切回「晨光」也正常。
  await page.locator('#theme-switch [data-theme-id=night]').click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='night');
  assert.equal(await page.evaluate(()=>localStorage.getItem('mathpath_theme')),'night','切換後要記住');
  const nightBg=await page.evaluate(()=>getComputedStyle(document.body).backgroundColor);
  assert.notEqual(nightBg,'rgb(248, 250, 249)','墨夜的背景要和晨光不同');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-版面墨夜.png'),fullPage:true});
  await page.locator('#theme-switch [data-theme-id=day]').click();
  await page.waitForFunction(()=>!document.documentElement.dataset.theme);
  assert.equal(await page.evaluate(()=>localStorage.getItem('mathpath_theme')),'day','要能切回晨光');
  console.log('PASS: 版面配色可切換（晨光／墨夜）並記在這台裝置');

  // 「新批閱」：教師批完、學生還沒看過就要標出來；點開看過就消失；教師改分會再標一次。
  // 注意：前面有多個 /api/state 覆寫，這裡要自己再註冊一次（後註冊的路由優先）。
  const reviewedAttempt={...graded(3,1,'一元二次方程',5,6),teacherReviewed:true,reviewedAt:'2026-10-19T02:00:00Z',
    gradingMethod:'teacher-reviewed',confirmedScore:5,feedback:'教師已覆核：步驟清楚。'};
  const studentStateWith=attempts=>route=>route.fulfill({json:{
    user:{id:1,name:'介面測試學生',role:'student'},
    questions:[{...q,answer:undefined,steps:undefined}], attempts,
    stats:{completed:1,accuracy:83,score:5,maxScore:6,streak:1,minutes:10}, ai, topics:['一元二次方程','幾何']}});
  await page.route('**/api/state', studentStateWith([reviewedAttempt]));
  await page.locator('#account').click();await page.locator('#logout-btn').click();
  await page.waitForSelector('#homework-login');
  await login('student');
  // 等「我的錯題本」真的畫出來（上一頁也有 .record，只等 .record 會抓到舊 DOM）。
  const waitRecords=()=>page.waitForFunction(()=>{const m=document.querySelector('#main');
    return m&&/我的錯題本/.test(m.textContent)&&m.querySelectorAll('.record').length>0;},{timeout:8000});
  await page.locator('[data-page=mistakes]').first().click();
  await waitRecords();
  assert.equal(await page.locator('#main .badge.new-review').count(),1,'教師批完且學生未看過要標「新批閱」');
  assert.match(await page.locator('#main .badge.new-review').first().innerText(),/新批閱/);
  await page.locator('[data-review]').first().click();
  await page.locator('#modal-root .modal').waitFor({timeout:8000});
  assert.equal(await page.locator('#modal-root .badge.new-review').count(),1,'彈窗裡也要標示這是新批閱');
  await page.locator('[data-action=close-modal]').click();
  await page.reload({waitUntil:'networkidle'});
  await page.locator('[data-page=mistakes]').first().click();
  await waitRecords();
  assert.equal(await page.locator('#main .badge.new-review').count(),0,'看過之後不應再標新批閱');
  // 教師日後改了分數（reviewedAt 變了）→ 應該再標一次，學生才知道要重看。
  await page.route('**/api/state', studentStateWith([{...reviewedAttempt,score:6,confirmedScore:6,reviewedAt:'2026-10-19T03:00:00Z'}]));
  await page.reload({waitUntil:'networkidle'});
  await page.locator('[data-page=mistakes]').first().click();
  await waitRecords();
  assert.equal(await page.locator('#main .badge.new-review').count(),1,'教師改分後要再標一次');
  console.log('PASS: 「新批閱」標記（批閱後標出、看過消失、改分再標）');

  // 截止前提醒：24 小時內未交才標「快截止」；剩不到 2 小時轉警示色；已提交不標。
  // 時間用 floor 取整（寧可顯示得少，也不要讓學生以為還很久）。
  const originalDue=assignment.dueAt;
  // 前面有測試把 /api/homework 覆寫成「教師、沒有作業」，這裡要換回學生的兩份作業。
  await page.route('**/api/homework', route => route.fulfill({json:{
    classes:[{id:1,name:'中三甲班',studentCount:2,studentIds:[1,3]}],
    assignments:[assignment,quizAssignment], ai}}));
  const setDue=async(ms,status)=>{
    assignment.dueAt=new Date(Date.now()+ms).toISOString();
    assignment.myStatus=status;
    await page.reload({waitUntil:'networkidle'});
    await page.locator('[data-assignment]').first().waitFor({timeout:8000});
  };
  await setDue(3*3600*1000+60000,'not_started');
  assert.equal(await page.locator('.badge.due-soon').count(),1,'24 小時內未交要提醒快截止');
  assert.match(await page.locator('.badge.due-soon').first().innerText(),/剩 3 小時/);
  assert.equal(await page.locator('.badge.due-soon.urgent').count(),0,'剩 3 小時還不算緊急');
  await setDue(45*60*1000+1000,'in_progress');
  assert.match(await page.locator('.badge.due-soon').first().innerText(),/剩 45 分鐘/,'不足一小時要講分鐘');
  assert.equal(await page.locator('.badge.due-soon.urgent').count(),1,'剩不到 2 小時要轉警示色');
  await setDue(30*3600*1000,'not_started');
  assert.equal(await page.locator('.badge.due-soon').count(),0,'超過 24 小時不必提醒');
  await setDue(3*3600*1000,'submitted');
  assert.equal(await page.locator('.badge.due-soon').count(),0,'已提交的作業不提醒');
  assignment.dueAt=originalDue;assignment.myStatus='not_started';
  await page.reload({waitUntil:'networkidle'});
  console.log('PASS: 截止前提醒（24 小時內標示、2 小時內轉警示、已提交不標）');

  // 紙本批改紀錄：按功課名稱分組，看得出「批了誰、還缺誰、上次批到哪」。
  await page.locator('#account').click();await page.locator('#logout-btn').click();
  await page.waitForSelector('#homework-login');
  await login('teacher');
  // 前面的測試把 /api/state 換成學生身分，這裡要換回教師，否則側欄不會有「紙本批改」。
  await page.route('**/api/state', route => route.fulfill({json:{
    user:{id:2,name:'介面測試教師',role:'teacher',isOwner:true},
    questions:[q], attempts:[], stats:{completed:0,accuracy:0,streak:0,minutes:0},
    ai, topics:['一元二次方程','幾何']}}));
  await page.reload({waitUntil:'networkidle'});
  const paperRoster=[
    {id:1,name:'介面測試學生',role:'student',seat:'1',grade:'中三'},
    {id:3,name:'陳大文',role:'student',seat:'2',grade:'中三'},
    {id:4,name:'李小明',role:'student',seat:'3',grade:'中三'}];
  await page.route('**/api/users', route => route.fulfill({json:{users:paperRoster}}));
  await page.route('**/api/paper-keys', route => route.fulfill({json:{keys:[]}}));
  await page.route('**/api/homework', route => route.fulfill({json:{
    classes:[{id:1,name:'中三甲班',studentCount:3,studentIds:[1,3,4]}],
    assignments:[assignment,quizAssignment], ai}}));
  await page.route('**/api/paper-grades', route => {
    if(route.request().method()!=='GET')return route.fallback();
    return route.fulfill({json:{grades:[
      {id:2,studentId:1,studentName:'介面測試學生',title:'第三次功課',pages:2,totalQuestions:5,
        correctCount:4,score:80,createdAt:'2026-10-18T09:00:00Z',questions:[]},
      {id:1,studentId:3,studentName:'陳大文',title:'第二次功課',pages:1,totalQuestions:4,
        correctCount:2,score:50,createdAt:'2026-10-17T09:00:00Z',questions:[]}]}});
  });
  await page.evaluate(()=>sessionStorage.removeItem('paperClass'));
  await page.locator('[data-page=paper]').first().click();
  await page.locator('#paper-history .paper-history-group').first().waitFor({timeout:8000});
  assert.equal(await page.locator('#paper-history .paper-history-group').count(),2,'同一份功課要合成一組');
  const firstGroup=page.locator('#paper-history .paper-history-group').first();
  assert.match(await firstGroup.locator('summary').innerText(),/第三次功課/);
  assert.match(await firstGroup.locator('summary').innerText(),/已批 1 人 · 平均 80\.0 分/,'要看得出批了幾人與平均');
  assert.match(await firstGroup.locator('summary').innerText(),/上次批到 介面測試學生/,'要知道上次批到哪一位');
  // 未展開的 details 取 innerText 只有摘要，所以這裡讀 textContent。
  const historyText=await page.locator('#paper-history').evaluate(el=>el.textContent);
  assert.match(historyText,/選上面的班級/,'沒選班級時說明怎麼看未批名單');
  await page.locator('#paper-class').selectOption('1');
  await page.waitForFunction(()=>/未批 2 人/.test(document.querySelector('#paper-history')?.textContent||''),{timeout:8000});
  assert.match(await firstGroup.locator('summary').innerText(),/未批 2 人/,'選了班級就要算出還缺幾人');
  await firstGroup.locator('summary').click();
  assert.equal(await firstGroup.locator('tbody tr').count(),1,'展開後列出已批的學生');
  assert.match(await firstGroup.locator('.paper-history-body').innerText(),/陳大文（座號 2）、李小明（座號 3）/,'要列出未批的是哪幾位');
  console.log('PASS: 紙本批改紀錄（按功課分組、算未批人數與名單、看得出上次批到誰）');

  // 卷面排版只給老師：學生側欄不該有入口，直接呼叫也只會回到題庫。
  // 新卷選了檔案要顯示檔名，右邊的 ✕ 一點就清掉（不用重新整理）。
  const studentNav=await page.evaluate(()=>{const old=S.user;S.user={...old,role:'student'};shell();
    const text=document.querySelector('#nav').textContent;S.user=old;shell();return text;});
  assert.ok(!/卷面排版/.test(studentNav),'學生側欄不該出現卷面排版');
  const studentMain=await page.evaluate(async()=>{const old=S.user;S.user={...old,role:'student'};
    await paperLayoutPage();const text=document.querySelector('#main').textContent;S.user=old;return text;});
  assert.ok(!/PAPER LAYOUT/.test(studentMain),'學生直接呼叫 paperLayoutPage 也進不去');
  await page.evaluate(()=>paperLayoutPage());
  await page.locator('#paper-file').waitFor({timeout:8000});
  await page.locator('#paper-file').setInputFiles({name:'新卷.docx',
    mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer:Buffer.from('PK\u0003\u0004測試')});
  await page.locator('#paper-file-chip').waitFor({state:'visible',timeout:4000});
  assert.match(await page.locator('#paper-file-chip').innerText(),/新卷\.docx/,'選了檔案要顯示檔名');
  await page.locator('#paper-file-chip button').click();
  await page.locator('#paper-file-chip').waitFor({state:'hidden',timeout:4000});
  assert.equal(await page.evaluate(()=>document.querySelector('#paper-file').files.length),0,
    '按 ✕ 要把已選檔案清掉');
  console.log('PASS: 卷面排版只給老師（學生側欄沒入口、直接呼叫回題庫），新卷選了檔案可按 ✕ 刪除');

  // 我的試卷：存好的卷可以搜尋、按年份／級別／學段篩選，一鍵匯入題庫
  let paperQuery='',importBody=null,saveBody=null;
  const paperFixture=[
    {id:11,title:'培華高二大測一',year:'2026',grade:'高二',term:'第一段',questionCount:12,
      importedCount:0,importedAt:null,templateId:7,createdAt:stamp},
    {id:12,title:'培華初三小測',year:'2025',grade:'初三',term:'第二段',questionCount:8,
      importedCount:0,importedAt:null,createdAt:stamp}];
  const paperFacets={years:['2026','2025'],grades:['高二','初三'],terms:['第一段','第二段']};
  const papersList=route=>{
    const url=new URL(route.request().url());
    if(route.request().method()==='POST'){
      saveBody=route.request().postDataJSON();
      return route.fulfill({json:{paper:{...paperFixture[0],id:13,questionCount:2}}});
    }
    paperQuery=url.search;
    return route.fulfill({json:{papers:paperFixture,facets:paperFacets}});
  };
  await page.route(/\/api\/papers$/,papersList);
  await page.route(/\/api\/papers\?/,papersList);
  await page.route(/\/api\/papers\/\d+\/to-bank$/,route=>{
    importBody=route.request().postDataJSON();
    return route.fulfill({json:{count:12,questions:[]}});
  });
  await page.route(/\/api\/papers\/\d+\/to-tex$/,route=>route.fulfill({json:{
    tex:'\\documentclass{ctexart}\n\\begin{document}x\\end{document}',
    filename:'培華高二大測一.tex'}}));
  await page.route(/\/api\/papers\/\d+\/to-docx$/,route=>route.fulfill({json:{
    docx:'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,'
      +Buffer.from('PK\u0003\u0004demo').toString('base64'),
    filename:'培華高二大測一.docx'}}));
  const waitFor=async(fn,ms=8000)=>{const t0=Date.now();
    while(Date.now()-t0<ms){if(fn())return true;await new Promise(r=>setTimeout(r,80));}return false;};
  await page.locator('[data-page=papers]').first().click();
  await page.locator('[data-paper-card]').first().waitFor({timeout:8000});
  assert.equal(await page.locator('[data-paper-card]').count(),2,'兩份試卷都要列出來');
  assert.match(await page.locator('#main').innerText(),/培華高二大測一/);
  assert.match(await page.locator('#main').innerText(),/12 題/,'要顯示題數');
  await page.locator('#paper-year').selectOption('2026');
  assert.ok(await waitFor(()=>/year=2026/.test(paperQuery)),'選年份要帶進查詢：'+paperQuery);
  await page.locator('#paper-q').fill('大測');
  await page.locator('#paper-q-go').click();
  assert.ok(await waitFor(()=>/q=%E5%A4%A7%E6%B8%AC/.test(paperQuery)),'搜尋字要帶進查詢：'+paperQuery);
  assert.equal(await page.locator('[data-paper-card]').count(),2,'篩選後清單要還在');
  const [wordFile]=await Promise.all([
    page.waitForEvent('download',{timeout:6000}),
    page.locator('[data-paper-docx="11"]').click()]);
  assert.match(wordFile.suggestedFilename(),/\.docx$/,'記住範本的試卷要能重出 Word');
  const [texFile]=await Promise.all([
    page.waitForEvent('download',{timeout:6000}),
    page.locator('[data-paper-tex="11"]').click()]);
  assert.match(texFile.suggestedFilename(),/\.tex$/,'我的試卷要能下載 .tex');

  await page.locator('[data-paper-card]').first().locator('summary').click();
  const gradePick=await page.locator('[data-paper-grade="11"]').inputValue();
  assert.equal(gradePick,'中五','高二要對應題庫的中五');
  await page.locator('[data-paper-import="11"]').click();
  await page.waitForFunction(()=>/已匯入 12 題/.test(document.body.textContent||''),{timeout:8000});
  assert.equal(importBody.topic,'數與數系','預設分類是題庫第一個');
  assert.equal(importBody.grade,'中五');
  assert.equal(importBody.level,2);
  console.log('PASS: 我的試卷（搜尋＋年份／級別／學段篩選、一鍵匯入題庫並帶入年級對應）');
  // 出作業：用這份卷匯入的題目直接建立作業
  let assignBody=null;
  await page.route(/\/api\/papers\/11$/,route=>route.fulfill({json:{
    paper:{...paperFixture[0],questionIds:[1]}}}));
  await page.route('**/api/homework',route=>route.fulfill({json:{
    classes:[{id:1,name:'中三甲班',studentCount:3,studentIds:[1]}],assignments:[],ai}}));
  await page.route('**/api/assignments',route=>{
    assignBody=route.request().postDataJSON();
    return route.fulfill({json:{assignment:{id:9,title:assignBody.title}}});
  });
  await page.locator('[data-paper-assign="11"]').click();
  await page.locator('#assign-submit').waitFor({timeout:8000});
  assert.equal(await page.locator('#assign-submit').isDisabled(),false,'題目都有答案且已核驗時可以建立');
  await page.locator('#assign-submit').click();
  await page.waitForFunction(()=>/作業已建立/.test(document.body.textContent||''),{timeout:8000});
  assert.deepEqual(assignBody.questionIds,[1],'要帶入這份卷匯入的題目');
  assert.ok(assignBody.dueAt,'要有截止時間');
  console.log('PASS: 我的試卷可以直接出作業（帶入這份卷匯入的題目、班級與截止時間）');

  // 排版完成後的「下載」要真的能按：曾經用 innerHTML += 追加保存表單，
  // 把剛綁好事件的按鈕換成新的（沒有 onclick），點了完全沒反應。
  const demoDocx='data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,'
    +Buffer.from('PK\u0003\u0004demo').toString('base64');
  await page.route('**/api/paper-templates',route=>route.fulfill({json:{templates:[
    {id:7,name:'測試範本',createdAt:stamp,spec:{marksPosition:'leading',optionsPerLine:4}}]}}));
  const applyResult={
    docx:demoDocx,filename:'培華中學2026年度第一段高二級數學科大測一.docx',
    stats:{sections:1,questions:2,formulas:1},
    content:{title:'培華中學2026年度第一段高二級數學科大測一',sections:[{title:'一、選擇題',
      questions:[{stem:'斜率 $k=$？',marks:3,options:['A. $1$'],lines:[]}]}]}};
  // 排版改成背景工作：async 請求先回 jobId，前端輪詢 /api/jobs/{id}
  await page.route('**/api/paper-templates/7/apply',route=>{
    const body=route.request().postDataJSON();
    if(body.async)return route.fulfill({json:{jobId:'job7'}});
    return route.fulfill({json:applyResult});
  });
  await page.route('**/api/jobs/job7',route=>route.fulfill({json:{
    status:'done',elapsed:1.4,result:applyResult}}));
  await page.evaluate(()=>paperLayoutPage());
  await page.locator('#paper-file').waitFor({timeout:8000});
  await page.locator('#paper-file').setInputFiles({name:'新卷.docx',
    mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer:Buffer.from('PK\u0003\u0004demo')});
  await page.locator('#paper-apply').click();
  await page.locator('#dl-paper').waitFor({timeout:8000});
  assert.ok(await page.evaluate(()=>typeof document.querySelector('#dl-paper').onclick==='function'),
    '下載按鈕要綁到事件（不能被後面的 innerHTML 換掉）');
  const [downloaded]=await Promise.all([
    page.waitForEvent('download',{timeout:6000}),
    page.locator('#dl-paper').click()]);
  assert.match(downloaded.suggestedFilename(),/\.docx$/,'按了下載要真的產生檔案');
  assert.equal(await page.locator('#save-paper-year').inputValue(),'2026','年份要從卷名猜出來');
  assert.equal(await page.locator('#save-paper-grade').inputValue(),'高二','級別要從卷名猜出來');
  assert.equal(await page.locator('#save-paper-term').inputValue(),'第一段','學段要從卷名猜出來');
  await page.locator('#save-paper').click();
  await page.waitForFunction(()=>/已保存|已存進/.test(document.body.textContent||''),{timeout:8000});
  assert.equal(saveBody.templateId,7,'保存要記住用哪個範本，之後才能重出 Word');
  assert.equal(saveBody.year,'2026','年份要一起送出去');
  console.log('PASS: 排版完成後可以下載 Word，保存表單自動帶出年份／級別／學段');

  // 題庫：每題顯示入庫時間，可以按入庫時間排序
  await page.locator('[data-page=bank]').first().click();
  await page.locator('#sort-filter').waitFor({timeout:8000});
  assert.match(await page.locator('#question-list').innerText(),/入庫 \d{4}-\d{2}-\d{2}/,
    '題庫卡片要顯示入庫時間');
  await page.locator('#sort-filter').selectOption('new');
  assert.equal(await page.locator('#sort-filter').inputValue(),'new','排序選單要記住選擇');
  assert.match(await page.locator('#question-list').innerText(),/因式分解解二次方程/,'排序後清單還在');
  await page.locator('#sort-filter').selectOption('');
  console.log('PASS: 題庫顯示入庫時間，可按入庫時間（新→舊／舊→新）排序');

  // AI 補答案：題目都有答案時不出現；有缺才出現（避免老師誤按）
  assert.equal(await page.locator('#ai-fill-answers').count(),0,'都有答案時不該出現');
  const fillShown=await page.evaluate(()=>{
    const old=S.questions;
    S.questions=old.map(q=>({...q,answer:''}));
    bank();
    const n=document.querySelectorAll('#ai-fill-answers').length;
    S.questions=old;bank();
    return n;
  });
  assert.equal(fillShown,1,'有缺答案時要出現「AI 補答案」按鈕');
  console.log('PASS: 題庫「AI 補答案」按鈕只在有題目缺答案時出現');

  // 待核驗的題目要有「核驗通過」按鈕（老師按了才能出作業）
  assert.equal(await page.locator('[data-verify]').count(),0,'已核驗的題目不該再出現核驗按鈕');
  const verifyShown=await page.evaluate(()=>{
    const old=S.questions;
    S.questions=[{...old[0],tags:['試卷匯入','待核驗']}];
    bank();
    const n=document.querySelectorAll('[data-verify]').length;
    S.questions=old;bank();
    return n;
  });
  assert.equal(verifyShown,1,'待核驗的題目要有核驗按鈕');
  console.log('PASS: 題庫待核驗的題目有「核驗通過」按鈕，核驗後才能出作業');

  // 反向組卷：勾選題目 → 組成試卷（存進我的試卷並下載）
  await page.locator('[data-page=bank]').first().click();
  await page.locator('[data-pick]').first().waitFor({timeout:8000});
  assert.equal(await page.locator('#pick-bar').isHidden(),true,'沒勾題時不該出現工具列');
  await page.locator('[data-pick]').first().check();
  await page.locator('#pick-bar').waitFor({state:'visible',timeout:4000});
  assert.match(await page.locator('#pick-count').innerText(),/已選 1 題/);
  let buildBody=null;
  await page.route('**/api/papers/from-questions',route=>{
    buildBody=route.request().postDataJSON();
    return route.fulfill({json:{paper:{id:21,title:buildBody.title},
      tex:'\\documentclass{ctexart}',texName:'自選題試卷.tex'}});
  });
  await page.locator('#pick-build').click();
  await page.locator('#build-submit').waitFor({timeout:8000});
  const [builtFile]=await Promise.all([
    page.waitForEvent('download',{timeout:6000}),
    page.locator('#build-submit').click()]);
  assert.match(builtFile.suggestedFilename(),/\.tex$/,'沒選範本時下載 .tex');
  assert.deepEqual(buildBody.questionIds,[1],'要把勾選的題目帶去組卷');
  assert.ok(buildBody.title,'要有卷名');
  console.log('PASS: 題庫勾題即可組成試卷（工具列顯示已選題數、沒選範本時下載 .tex）');

  // 批次修改：一份卷匯入的題目常常跨多個知識點
  let bulkBody=null;
  await page.route('**/api/questions/bulk',route=>{
    bulkBody=route.request().postDataJSON();
    return route.fulfill({json:{updated:bulkBody.ids,removed:[],skipped:[]}});
  });
  await page.locator('[data-pick]').first().check();
  await page.locator('#pick-edit').click();
  await page.locator('#bulk-submit').waitFor({timeout:8000});
  await page.locator('#bulk-topic').selectOption({index:1});
  await page.locator('#bulk-submit').click();
  await page.waitForFunction(()=>/已修改/.test(document.body.textContent||''),{timeout:8000});
  assert.equal(bulkBody.action,'update');
  assert.deepEqual(bulkBody.ids,[1]);
  assert.ok(bulkBody.patch.topic,'要帶分類');
  assert.equal(bulkBody.patch.grade,undefined,'沒選的欄位不要送');
  console.log('PASS: 題庫可批次修改分類／年級／難度（只送有選的欄位）');

  // 待核驗快捷篩選 + 批次核驗（作業端點會擋待核驗，這是補答案後的收尾）
  const reviewUi=await page.evaluate(()=>{
    const old=S.questions;
    S.questions=[{...old[0],tags:['試卷匯入','待核驗']},old[0]];
    onlyReview=false;bank();
    const chip=document.querySelector('#review-chip');
    const chipText=chip?chip.textContent.trim():'';
    if(chip)chip.click();
    const filtered=document.querySelectorAll('.question-card').length;
    const box=document.querySelector('[data-pick]');
    if(box){box.checked=true;box.dispatchEvent(new Event('change',{bubbles:true}));}
    const vb=document.querySelector('#pick-verify');
    const verifyShown=!!vb&&!vb.hidden;
    S.questions=old;onlyReview=false;bank();
    return {chipText,filtered,verifyShown};
  });
  assert.match(reviewUi.chipText,/待核驗 1/,'篩選列要顯示待核驗題數');
  assert.equal(reviewUi.filtered,1,'勾了待核驗篩選只該剩那一題');
  assert.ok(reviewUi.verifyShown,'選到待核驗題目要出現「核驗已選」');
  console.log('PASS: 題庫「待核驗」快捷篩選與「核驗已選」批次核驗');

  // 題庫匯出 CSV（匯出目前篩選出來的題目）
  const [csvFile]=await Promise.all([
    page.waitForEvent('download',{timeout:6000}),
    page.locator('#export-questions').click()]);
  assert.match(csvFile.suggestedFilename(),/^MathPath-題庫-\d{4}-\d{2}-\d{2}\.csv$/,
    '要下載 CSV，檔名帶日期');
  console.log('PASS: 題庫可匯出 CSV（檔名帶日期，匯出目前篩選結果）');

  // 帳號停用：管理員看得到「停用」，已停用的顯示「已停用」與「重新啟用」；
  // 不能停用自己與管理員（按鈕不出現）。實際的登入攔阻由後端測試驗證。
  const rosterHtml=await page.evaluate(()=>[
    accountRow({id:3,name:'陳大文',role:'student',createdBy:2,disabled:false}),
    accountRow({id:4,name:'李小明',role:'student',createdBy:2,disabled:true}),
    accountRow({id:2,name:'介面測試教師',role:'teacher',createdBy:null,disabled:false})]);
  assert.match(rosterHtml[0],/data-disable-user="3"[^>]*>停用</,'一般帳號要有「停用」');
  assert.doesNotMatch(rosterHtml[0],/已停用/,'未停用的帳號不該顯示已停用');
  assert.match(rosterHtml[1],/已停用/,'停用的帳號要標出來');
  assert.match(rosterHtml[1],/data-disable-to="0"[^>]*>重新啟用</,'停用後要能重新啟用');
  assert.match(rosterHtml[1],/is-disabled/,'整列要淡一點，一眼看得出');
  assert.doesNotMatch(rosterHtml[2],/data-disable-user/,'不能停用自己（管理員）');
  console.log('PASS: 帳號停用（停用／重新啟用按鈕、已停用標記、不能停用自己）');

  // 紙本功課在學習足跡獨立呈現：不混進做題數與正確率，也不進排行榜。
  await page.route('**/api/state', route => route.fulfill({json:{
    user:{id:1,name:'介面測試學生',role:'student'},
    questions:[{...q,answer:undefined,steps:undefined}], attempts:[],
    stats:{completed:0,accuracy:0,score:0,maxScore:0,streak:0,minutes:0,
           paperCount:3,paperAverage:78.5,paperLastAt:'2026-10-18T09:00:00Z'},
    ai, topics:['一元二次方程','幾何']}}));
  await page.reload({waitUntil:'networkidle'});
  await page.locator('[data-page=growth]').first().click();
  await page.waitForFunction(()=>/紙本功課/.test(document.querySelector('#main')?.textContent||''),{timeout:8000});
  const paperCard=page.locator('#main section.panel', {hasText:'紙本功課'});
  const paperText=await paperCard.innerText();
  assert.match(paperText,/3\s*份/,'要顯示已批幾份');
  assert.match(paperText,/78\.5 分/,'要顯示平均分');
  assert.match(paperText,/不計入上面的做題數/, '要說清楚不混進做題數');
  console.log('PASS: 學習足跡顯示紙本功課（獨立統計，不混進做題數與排行榜）');

  // 伺服器初始化失敗時，登入視窗要直接顯示原因，不能只說「正在初始化」
  await page.route('**/api/session', route => route.fulfill({status:503,json:{error:'伺服器初始化失敗：MATH_STUDENT_PASSWORD 必須是 10 至 256 個字元、且不可只有空白的密碼。'}}));
  await page.reload({waitUntil:'networkidle'});
  await page.locator('#homework-login').click();
  await page.locator('#login-error').waitFor({timeout:8000});
  const issueText=await page.locator('#login-error').innerText();
  assert.match(issueText,/初始化失敗/,'登入視窗要顯示伺服器初始化失敗的原因，不能只說正在初始化');
  assert.match(issueText,/MATH_STUDENT_PASSWORD/,'要指出是哪個環境變數有問題');
  await page.screenshot({path:path.join(__dirname,'..','MathPath-初始化失敗提示.png'),fullPage:true});

  assert.deepEqual(errors,[]);await browser.close();
  console.log('PASS: answer modes (choice = click-only with single option list, fill-in = handwriting/text with math keyboard + always-visible rendered preview, upload = photo/PDF with a rear-camera button), AI grading policy (self-practice = AI instant score recorded without teacher review, no student use-ai toggle; teacher checkbox on assign, student read-only hint, external consent; homework/quiz scores, AI results, solution and advice hidden until the teacher reviews), the figure studio (AI drawing only for geometry/vector topics, question-vs-figure checking by the vision model, redraw from the check issues, keyboard-reachable manual image insert with a clear message for unsupported formats, no leftover state after closing so pasting an image elsewhere is never hijacked), paper splitting with an image (the figure box reported by the vision model is cropped in the browser, placed to the right of the stem, figureBox stripped before import), question figures (a question that has a figure renders it to the right of the stem, same row, sized sanely, one figure per question, same on the practice page, click to open a zoom overlay dismissed by Esc), AI similar-question drafting (teacher-only entry on bank card and practice panel, similar = same level and same question type vs advanced = one level up, distinct kind sent and labelled in the dialog, reference question expandable for comparison, draft preview with answer/steps/rubric, rubric shown with typeset math while the editor keeps raw LaTeX, nothing imported until the teacher confirms, no navigation after adding, repeated generation sends the previous summaries so the next draft differs), self-practice range picker (chapter + sub-chapter + question type, linked options, auto-widening, change-range keeps filters), teacher review with optional feedback, one-click AI review of a whole assignment (only for AI-enabled assignments), teacher sidebar without self-practice, calendar lower panel (centred divider label, panel content never flush to the card border, no horizontal overflow at 4 widths x 3 font scales), font scale switch (guest, persisted, 3 levels, no mobile overflow), login page (role cards, remember checked, remembered account), calendar (marks + entry from homework), question type (card badge, filter, draft qtype, rule analysis), full-auto split+import, homework (per-question navigation: next/previous question after submitting, progress count, submit prompt when all questions are done; assignment question picker filtered by chapter, sub-chapter and keyword with selection kept across filters), draft save/reload/restore, logout cleanup, weak-topic drill-down, results filters, CSV export, teacher annotation (pen/ellipse/arrow/highlight/undo/clear/save, plus a select tool that moves a shape, changes its thickness or font size, rewrites a text note, and deletes it with the button or the Delete key; highlights stay yellow instead of turning into red pen lines), prominent per-row action buttons (the question row start button uses the primary colour and a larger size, the assignment answer page keeps the cannot-answer button next to Submit on the right, the teacher review list uses a primary View and mark button), and the AI-unavailable notice rendered in bold red at a larger size, self-practice records in the teacher review list labelled as read-only with no score form and no retry button, the results table refetched when the review dialog is closed after saving, the teacher review list collapsing each advice card, and every action button set to a clear bold weight, AI suggested annotation with student read-back and teacher drag-to-adjust saved positions, handwritten verdict stamp (red tick = all correct, red cross = all wrong, red tick with a stroke = partly correct) and AI comments placed on the sheet only where the paper is blank (never over the handwriting; dense pages fall back to the badge and the list below), correction loop (teacher return with note, student banner, pending guard, resubmit), self-serve mock exam (setup, countdown, per-question answer with mockId, submit + instant score + advice), AI endpoint page (test/save, key never read back), bulk student import (column-order auto-detect + header row, student id only with seat number and no name, generated passwords, per-line errors, class creation), data management (usage cards, four download entries, vacuum, school-year reset gated by a typed confirmation and hidden from students), student editing (only changed fields submitted, password reset warns about logout), archive restore (question merge vs replace, student archive with shared password and credential table), no dead space before the footer on short pages, mobile layout, no JS errors. Fixture API only; no server started.');
})().catch(e=>{console.error(e);process.exit(1)});
