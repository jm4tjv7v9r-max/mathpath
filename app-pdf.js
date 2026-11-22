'use strict';
// 一鍵下載 PDF：把試卷排成 A4 列印版 → html2canvas 截圖 → pdf-lib 組合成多頁 PDF。
//
// 為什麼在瀏覽器做、不在伺服器做：
//   - 中文由瀏覽器字型畫（不須在 Render 裝字型）；數學用已載入的 KaTeX；
//   - 題目圖形本來就是 data URL，直接放進 <img> 就能截進去；
//   - 所見即所得：老師在畫面看到的公式／圖，PDF 就長那樣。
// 代價：PDF 裡的文字是圖片，不能選取或搜尋（Was the trade-off the user chose）。

// A4 在 96dpi 的像素尺寸；預留的內容區扣除上下左右留白。
const PDF_A4_W = 794, PDF_A4_H = 1123;
const PDF_MARGIN = 48;              //約 12.7 mm
const PDF_CONTENT_H = PDF_A4_H - PDF_MARGIN * 2;
const PDF_SCALE = 2;                //截圖解析度（2x 轉成 PDF 才不會糊）

let pdfExportPromise = null;
function pdfLoadScript(src){
  return new Promise((resolve,reject)=>{
    if([...document.scripts].some(s=>(s.getAttribute('src')||'').split('?')[0]===src))return resolve();
    const el=document.createElement('script');el.src=src;el.async=false;
    el.onload=()=>resolve();
    el.onerror=()=>reject(new Error('PDF 元件載入失敗。'));
    document.head.appendChild(el);
  });
}
async function ensurePdfExportLibs(onStatus){
  if(window.html2canvas && window.PDFLib)return;
  if(!pdfExportPromise){
    pdfExportPromise=(async()=>{
      if(onStatus)onStatus('載入 PDF 元件…');
      const jobs=[];
      if(!window.html2canvas)jobs.push(pdfLoadScript('/vendor/html2canvas.min.js'));
      if(!window.PDFLib)jobs.push(pdfLoadScript('/vendor/pdfjs/pdf-lib.min.js'));
      await Promise.all(jobs);
      if(!window.html2canvas||!window.PDFLib)throw new Error('PDF 元件未能載入，請重新整理後再試。');
    })();
  }
  try{await pdfExportPromise;}catch(e){pdfExportPromise=null;throw e;}
}

// 把一題的 stem／選項／圖形／作答線轉成 HTML（數學走 KaTeX）。
// opts: {planMode, marksPos, answerLines, answerRule, number}
//   planMode=true 表示吃後端 layout_plan 的題目：題號／配分位置都照範本，
//   不再於此重編。舊模式（planMode=false）仍自己算，供沒有範本的舊卷回退。
function pdfQuestionHtml(q, opts){
  const o=opts||{};
  const stem=mathText(q.stem||'');
  let marksHtml='';
  if(q.marks!==null&&q.marks!==undefined){
    const m=`（${q.marks} 分）`;
    const pos=o.marksPos||'leading';
    if(pos==='trailing')marksHtml=`<span class="pdfq-marks-trail">${m}</span>`;
    else if(pos!=='none')marksHtml=`<span class="pdfq-marks-lead">${m}　</span>`;
  }
  // 順序跟 Word 一致：題幹 → 附圖 → 選項 → 作答線；配分照 marksPos 放前或後。
  let html;
  if(o.planMode&&o.marksPos==='trailing'){
    html=`<div class="pdfq-stem with-trail">${stem}${marksHtml}</div>`;
  }else{
    html=`<div class="pdfq-stem">${marksHtml}${stem}</div>`;
  }
  (q.figures||[]).forEach(fig=>{
    const src=fig.data||fig.blob||'';
    if(typeof src!=='string'||!src)return;
    const w=fig.cx?Math.max(120,Math.min(520,Math.round(fig.cx/360000*37.8))):340;
    html+=`<div class="pdfq-fig"><img src="${src}" style="max-width:${w}px"></div>`;
  });
  // q.lines：題目後面接著的補充行（Word 照範本複製）
  (q.lines||[]).forEach(line=>{html+=`<div class="pdfq-extra">${mathText(line)}</div>`;});
  const opts2=q.options||[];
  if(opts2.length){
    // 選項一律打橫：一行最多 4 個，太長自動換行（跟 LaTeX 一致）
    const perLine=opts2.some(x=>String(x).length>18)?2:4;
    for(let i=0;i<opts2.length;i+=perLine){
      html+=`<div class="pdfq-opts">${opts2.slice(i,i+perLine).map(x=>mathText(x)).join('　　')}</div>`;
    }
  }
  if(!opts2.length){
    // 解答題的作答空間：plan 模式照範本的 answerLines 行數，舊模式固定兩行。
    const lines=o.planMode?(Number(q.answerLines)||0):2;
    if(lines){
      const rule=o.answerRule?' pdfq-line-rule':'';
      html+=`<div class="pdfq-lines">${'<span class="'+rule.trim()+'"></span>'.repeat(lines)}</div>`;
    }
  }
  return html;
}

// 整份卷的 HTML：卷頭、分部、題目、卷尾。回傳塊陣列，方便分頁。
function pdfPaperBlocks(title, meta, sections){
  const blocks=[];
  blocks.push(`<div class="pdfp-title">${esc(title||'試卷')}</div>`);
  const bits=[];
  const grade=meta&&meta.grade, term=meta&&meta.term;
  if(grade||term)bits.push([grade,term].filter(Boolean).join(' · '));
  if(meta&&meta.duration)bits.push(`限時 ${Number(meta.duration)} 分鐘`);
  if(bits.length)blocks.push(`<div class="pdfp-sub">${esc(bits.join('　'))}</div>`);
  blocks.push('<div class="pdfp-info">班別：____________　姓名：____________　學號：____________　得分：________</div>');
  blocks.push('<div class="pdfp-rule"></div>');
  let n=1;
  (sections||[]).forEach(sec=>{
    if(sec.title)blocks.push(`<div class="pdfp-sec">${esc(sec.title)}</div>`);
    (sec.questions||[]).forEach(q=>{
      const body=pdfQuestionHtml(q);
      // 題號用外掛，內文交給 KaTeX：避免整段被 mathText 當成數學式
      blocks.push(`<div class="pdfp-q"><span class="pdfp-num">${n++}.</span><div class="pdfp-qbody">${body}</div></div>`);
    });
  });
  blocks.push('<div class="pdfp-end">— 試卷完 —</div>');
  return blocks;
}

// 用後端 layout_plan 排版：卷頭逐段照範本（含換過的標題、橫線）、
// 分部標題照範本措辭、題號用 plan 的 number、配分位置照 marksPos、
// 卷尾照 closing。這樣 PDF 跟「下載 Word」「下載 .tex」是同一份卷。
function pdfPaperBlocksFromPlan(plan){
  const blocks=[];
  const alignClass=a=>a==='left'?' pdfp-left':(a==='right'?' pdfp-right':'');
  (plan.head||[]).forEach(item=>{
    const text=item.text||'';
    if(text.trim()){
      const size=item.size?`font-size:${item.size}pt;`:'';
      const bold=item.bold?'font-weight:700;':'';
      blocks.push(`<div class="pdfp-head${alignClass(item.align)}" style="${size}${bold}">${mathText(text)}</div>`);
    }
    if(item.rule)blocks.push('<div class="pdfp-rule"></div>');
  });
  (plan.sections||[]).forEach(sec=>{
    if(sec.heading){
      const sz=sec.headingSize?`font-size:${sec.headingSize}pt;`:'';
      const bd=sec.headingBold===false?'font-weight:400;':'';
      blocks.push(`<div class="pdfp-sec" style="${sz}${bd}">${mathText(sec.heading)}</div>`);
    }
    (sec.questions||[]).forEach(q=>{
      const body=pdfQuestionHtml(q,{planMode:true, marksPos:sec.marksPos,
        answerRule:plan.answerRule});
      blocks.push(`<div class="pdfp-q"><span class="pdfp-num">${q.number||''}.</span><div class="pdfp-qbody">${body}</div></div>`);
    });
  });
  (plan.closing||[]).forEach(text=>{
    blocks.push(`<div class="pdfp-end">${mathText(text)}</div>`);
  });
  return blocks;
}

// 把塊依內容高度裝頁：不把同一題切到兩頁。
function pdfPaginate(container, blocks){
  container.innerHTML=blocks.map(b=>`<div class="pdfp-measure">${b}</div>`).join('');
  const nodes=[...container.querySelectorAll('.pdfp-measure')];
  const pages=[];
  let cur=[], used=0;
  nodes.forEach((node,i)=>{
    const h=node.getBoundingClientRect().height;
    if(cur.length&&used+h>PDF_CONTENT_H){
      pages.push(cur);cur=[];used=0;
    }
    cur.push(blocks[i]);used+=h;
  });
  if(cur.length)pages.push(cur);
  return pages;
}

async function pdfWaitImages(root){
  const imgs=[...root.querySelectorAll('img')];
  await Promise.all(imgs.map(img=>{
    if(img.complete&&img.naturalWidth)return Promise.resolve();
    return new Promise(res=>{img.onload=img.onerror=res;});
  }));
}

function dataUrlToBytes(url){
  const comma=url.indexOf(',');
  const b64=url.slice(comma+1);
  const bin=atob(b64);
  const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  return bytes;
}

/**
 * 建立 PDF（Uint8Array）。title/meta/sections 由呼叫端傳（生成完成頁或我的試卷）。
 */
async function buildPaperPdf({title, meta, sections, plan, onStatus}){
  await ensurePdfExportLibs(onStatus);
  if(document.fonts&&document.fonts.ready)await document.fonts.ready;

  const container=document.createElement('div');
  container.id='pdf-export-stage';
  document.body.appendChild(container);
  try{
    // 有後端排版計畫就照它排（跟 Word 一致）；沒有才用舊的簡化排版回退。
    const blocks=plan?pdfPaperBlocksFromPlan(plan):pdfPaperBlocks(title, meta, sections);
    if(onStatus)onStatus('排出試卷版面…');
    const pages=pdfPaginate(container, blocks);

    const pdfDoc=await window.PDFLib.PDFDocument.create();
    const A4=[595.28,841.89];    // A4 的點（pt）尺寸
    for(let i=0;i<pages.length;i++){
      if(onStatus)onStatus(`產生 PDF… 第 ${i+1} / ${pages.length} 頁`);
      container.innerHTML=pages[i].join('');
      await pdfWaitImages(container);
      // 固定成整張 A4 再截，空白留白才會在 PDF 裡佔對位置。
      container.style.height=PDF_A4_H+'px';
      const canvas=await window.html2canvas(container,{
        scale:PDF_SCALE, backgroundColor:'#ffffff', useCORS:true, logging:false,
        width:PDF_A4_W, height:PDF_A4_H, windowWidth:PDF_A4_W, windowHeight:PDF_A4_H
      });
      const bytes=dataUrlToBytes(canvas.toDataURL('image/png'));
      const img=await pdfDoc.embedPng(bytes);
      const page=pdfDoc.addPage(A4);
      page.drawImage(img,{x:0,y:0,width:A4[0],height:A4[1]});
    }
    if(onStatus)onStatus('完成');
    return await pdfDoc.save();
  }finally{
    container.remove();
  }
}

async function downloadPaperPdf({title, meta, sections, plan, filename, onStatus}){
  try{
    const bytes=await buildPaperPdf({title, meta, sections, plan, onStatus});
    const blob=new Blob([bytes],{type:'application/pdf'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=filename||((title||'試卷').replace(/[\\/:*?"<>|]/g,'_')+'.pdf');
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
    return true;
  }catch(e){
    toast('PDF 產生失敗：'+e.message);
    return false;
  }
}
