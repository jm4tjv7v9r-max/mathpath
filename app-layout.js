'use strict';
async function paperLayoutPage(){
  // 卷面排版是教師功能：學生連入口都不該看到，直接回題庫（側欄也不會出現）
  if(S.user?.role!=='teacher')return bank();
  page='layout';shell();
  const out=await api('/api/paper-templates').catch(()=>({templates:[]}));
  const list=out.templates||[];
  const saved=Number(sessionStorage.getItem('layoutTemplate')||0);
  const current=list.find(t=>t.id===saved)||list[0];
  $('#main').innerHTML=`<div class="fade-in">
    ${heading('PAPER LAYOUT','卷面排版','給一份範本記住版式；之後每份新卷都照它排。')}
    <section class="panel panel-pad" style="margin-bottom:16px">
      <h2 style="margin-bottom:6px">① 範本</h2>
      <p class="field-hint">上傳一份「排版正確」的卷：Word（.docx）直接讀結構；PDF 會用 AI 看版面（頁邊、字級、題號、配分位置、選項欄數）。</p>
      <div class="layout-row">
        <input id="tpl-name" placeholder="範本名稱，例如：培華高一測驗">
        <input id="tpl-file" type="file" accept=".docx,.pdf">
        <button class="primary" id="tpl-save">儲存為範本</button>
      </div>
      <div id="tpl-file-chip" class="small-text" style="margin-top:8px" hidden></div>
      <label class="small-text" style="display:flex;gap:8px;align-items:center;margin-top:12px">
        <input id="pdf-consent" type="checkbox" checked>
        PDF 需要把頁面影像送給外部 AI 分析（Word 不需要）
      </label>
      <div id="tpl-list" class="layout-list">${layoutTemplateHtml(list,current)}</div>
    </section>
    <section class="panel panel-pad">
      <h2 style="margin-bottom:6px">② 新卷</h2>
      <p class="field-hint">上傳內容正確、排版未整理的卷（.docx 或 .pdf）。Word 的方程式會原樣保留；PDF 會先由 AI 轉寫成題目（需在 ① 勾選「送給外部 AI 分析」）。</p>
      <div class="layout-row">
        <input id="paper-file" type="file" accept=".docx,.pdf">
        <button class="primary" id="paper-apply">排版並下載</button>
      </div>
      <div id="paper-file-chip" class="small-text" style="margin-top:8px" hidden></div>
      <label class="small-text" style="display:flex;gap:8px;align-items:center;margin-top:10px">
        <input id="paper-math-text" type="checkbox">
        數學符號用 LaTeX 代碼輸出（<code>$…$</code>，不轉成 Word 方程式）
      </label>
      <label class="small-text" style="display:flex;gap:8px;align-items:center;margin-top:8px">
        題號
        <select id="paper-numbering" style="padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:var(--paper);color:var(--ink)">
          <option value="continuous">全卷連續（1、2、3…）</option>
          <option value="section">每個分部由 1 重新開始</option>
        </select>
      </label>
      <div id="paper-result" style="margin-top:12px"></div>
    </section>
    <section class="panel panel-pad" style="margin-top:16px">
      <h2 style="margin-bottom:6px">③ 或直接要 LaTeX（Overleaf）</h2>
      <p class="field-hint">同一份 Word，直接輸出 .tex：題號連續、選擇題選項打橫（一行 4 個，太長自動變 2 個）、公式全部轉成 LaTeX。用 XeLaTeX 編譯。會沿用 ① 選定的範本，卷頭、大題標題、配分與卷尾都跟「排版並下載」的 Word 一樣。</p>
      <div class="layout-row">
        <label class="small-text">配分位置
          <select id="tex-marks" style="margin-left:6px;padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:var(--paper);color:var(--ink)">
            <option value="trailing">靠右</option>
            <option value="leading">題號後</option>
          </select></label>
        <button class="secondary" id="tex-apply">下載 LaTeX（.tex）</button>
      </div>
      <details style="margin-top:10px">
        <summary class="small-text">自訂 preamble（可貼你 Overleaf 的導言區）</summary>
        <textarea id="tex-preamble" rows="8" spellcheck="false" style="width:100%;margin-top:8px;font-family:ui-monospace,Menlo,monospace;font-size:12px;line-height:1.5;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--paper);color:var(--ink)"></textarea>
        <p class="field-hint" style="margin-top:6px">留空就用預設（ctexart + A4 + 1.27cm 邊界）。不要包含 \begin{document}。</p>
      </details>
      <div id="tex-result" style="margin-top:12px"></div>
    </section>
  </div>`;
  const pick=()=>Number($('input[name=layout-tpl]:checked')?.value||0);
  // 選了檔案後顯示檔名，右邊一個 ✕ 可以直接清掉（不用重新整理頁面）
  const bindFileChip=(inputSel,chipSel)=>{
    const input=$(inputSel),chip=$(chipSel);
    const sync=()=>{
      const f=input.files&&input.files[0];
      chip.hidden=!f;
      chip.innerHTML=f?`已選：<strong>${esc(f.name)}</strong><button type="button" class="text-button" style="margin-left:10px;color:#b8453b">✕ 刪除</button>`:'';
      const btn=chip.querySelector('button');
      if(btn)btn.onclick=()=>{input.value='';sync();};
    };
    input.onchange=sync;sync();
  };
  bindFileChip('#tpl-file','#tpl-file-chip');
  bindFileChip('#paper-file','#paper-file-chip');
  $$('input[name=layout-tpl]').forEach(r=>r.onchange=()=>{
    sessionStorage.setItem('layoutTemplate',r.value);
    // 只切換選中的樣式：整頁重畫會把① ② 已經選好的檔案清空，老師得重揀一次
    $$('.layout-tpl').forEach(el=>el.classList.toggle('active',el.contains(r)));
  });
  // 刪除範本：不用 confirm()——內嵌預覽的 iframe 常常直接封鎖對話框，
  // 按下去會「完全沒有反應」。改成兩段式：第一次按變成「再按一次刪除」。
  $$('[data-del-tpl]').forEach(b=>{
    let armed=false,timer=null;
    const reset=()=>{armed=false;b.disabled=false;b.textContent='刪除';};
    b.onclick=async ev=>{
      ev.preventDefault();ev.stopPropagation();
      if(!armed){
        armed=true;b.textContent='再按一次刪除';
        timer=setTimeout(reset,4000);
        return;
      }
      clearTimeout(timer);
      b.disabled=true;b.textContent='刪除中…';
      try{
        const r=await fetch('/api/paper-templates/'+b.dataset.delTpl,{method:'DELETE',credentials:'same-origin'});
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.error||'刪除失敗');
        if(String(sessionStorage.getItem('layoutTemplate')||'')===String(b.dataset.delTpl))
          sessionStorage.removeItem('layoutTemplate');
        toast('已刪除');paperLayoutPage();
      }catch(e){toast(e.message);reset();}
    };
  });
  $('#tpl-save').onclick=async()=>{
    const file=$('#tpl-file').files[0];
    if(!file)return toast('請先選擇範本檔（.docx）。');
    const name=($('#tpl-name').value||'').trim()||(file.name||'').replace(/\.(docx|pdf)$/i,'')||'未命名範本';
    const btn=$('#tpl-save');const old=btn.textContent;btn.disabled=true;btn.textContent='儲存中…';
    try{
      const isPdf=/pdf$/i.test(file.name||'')||file.type===PDF_MIME;
      if(isPdf&&!$('#pdf-consent').checked)throw new Error('PDF 需要先勾選「送給外部 AI 分析」。');
      const data=await fileData(file,[DOCX_MIME,PDF_MIME],12);
      const res=await api('/api/paper-templates',{name,file:data,consentExternal:isPdf});
      sessionStorage.setItem('layoutTemplate',res.template.id);
      toast('範本已儲存');paperLayoutPage();
    }catch(e){toast(e.message);btn.disabled=false;btn.textContent=old;}
  };
  $('#paper-apply').onclick=async()=>{
    const tid=pick();const file=$('#paper-file').files[0];
    if(!tid)return toast('請先選一個範本。');
    if(!file)return toast('請先選擇新卷（.docx）。');
    const btn=$('#paper-apply');const old=btn.textContent;btn.disabled=true;btn.textContent='排版中…';
    try{
      const isPdf=/pdf$/i.test(file.name||'')||file.type===PDF_MIME;
      if(isPdf&&!$('#pdf-consent').checked)throw new Error('PDF 需要先勾選「送給外部 AI 分析」。');
      const data=await fileData(file,[DOCX_MIME,PDF_MIME],12);
      const mathAsText=$('#paper-math-text').checked;
      const numbering=$('#paper-numbering').value;
      localStorage.setItem('mathpath_numbering',numbering);
      const res=await apiJob(`/api/paper-templates/${tid}/apply`,
        {file:data,consentExternal:isPdf,mathAsText,numbering},
        job=>{btn.textContent=`排版中… ${Math.round(job.elapsed||0)} 秒`;});
      const st=res.stats||{};
      // 保存到「我的試卷」：年份／級別／學段先從卷名猜，老師改一下就能存
      const guess=guessPaperMeta(res.content?.title||res.filename);
      if(!guess.year)guess.year=String(new Date().getFullYear());
      // 一次寫完再綁事件：用 innerHTML += 會把上面剛綁好的下載按鈕換掉，點了沒反應
      $('#paper-result').innerHTML=`<div class="layout-result">
        <div><strong>排好了</strong><span class="small-text">${st.sections||0} 個分部 · ${st.questions||0} 題 · ${st.formulas||0} 條公式${st.figures?` · ${st.figures} 張圖`:''}${st.tables?` · ⚠️ 範本有 ${st.tables} 個表格未帶入`:''}${st.oleObjects?` · ⚠️ 有 ${st.oleObjects} 個 Word 公式物件（MathType 等）讀不到（請先轉成 Word 方程式或 PDF）`:''}</span></div>
        <button class="primary" id="dl-paper">下載 ${esc(res.filename)}</button></div>
      ${scoreCheckHtml(st.score)}
      ${(res.geometry||[]).length?`<div class="geo-ask">
        <div><strong>有 ${res.geometry.length} 題看起來需要圖，但目前沒有圖</strong>
          <span class="small-text">勾選要畫的題目。AI 會先算座標、再照座標畫圖，畫完自查一次；沒勾的不會動。</span></div>
        <div class="geo-list">${res.geometry.map(g=>`<label class="geo-item">
          <input type="checkbox" data-geo="${g.number}" checked>
          <span class="geo-no">${g.number}.</span>
          <span class="geo-stem">${esc(String(g.stem||'').replace(/\$/g,''))}</span></label>`).join('')}</div>
        <div class="geo-actions"><button class="secondary" id="draw-geo">為已選的 ${res.geometry.length} 題畫圖</button></div>
      </div>`:''}
      <div class="panel" style="margin-top:12px;padding:12px">
        <p class="field-hint" style="margin:0 0 8px">保存到「我的試卷」：之後可以搜尋、按年份／級別／學段篩選，也能一鍵匯入題庫。</p>
        <div class="layout-row">
          <input id="save-paper-title" value="${esc(guess.title)}" placeholder="卷名">
          <input id="save-paper-year" list="paper-year-list" value="${esc(guess.year)}" placeholder="年份（2026）" style="max-width:130px">
          <input id="save-paper-grade" list="paper-grade-list" value="${esc(guess.grade)}" placeholder="級別（高二）" style="max-width:130px">
          <input id="save-paper-term" list="paper-term-list" value="${esc(guess.term)}" placeholder="學段（第一段）" style="max-width:130px">
          <button class="secondary" id="save-paper">保存到我的試卷</button>
        </div>
        <datalist id="paper-year-list">${[0,1,2,3].map(i=>`<option>${new Date().getFullYear()-i}</option>`).join('')}</datalist>
        <datalist id="paper-grade-list">${['初一','初二','初三','高一','高二','高三'].map(g=>`<option>${g}</option>`).join('')}</datalist>
        <datalist id="paper-term-list">${['第一段','第二段','第三段'].map(t=>`<option>${t}</option>`).join('')}</datalist>
        <div id="save-paper-result" class="small-text" style="margin-top:8px"></div>
      </div>`;
      if((st.score?.warnings||[]).length)toast('⚠️ '+st.score.warnings[0]);
      const drawBtn=$('#draw-geo');
      const geoBoxes=$$('[data-geo]');
      const pickedGeo=()=>geoBoxes.filter(b=>b.checked).map(b=>Number(b.dataset.geo));
      const syncGeoBtn=()=>{const n=pickedGeo().length;
        drawBtn.textContent=n?`為已選的 ${n} 題畫圖`:'請先勾選題目';
        drawBtn.disabled=!n;};
      geoBoxes.forEach(b=>b.onchange=syncGeoBtn);
      if(geoBoxes.length)syncGeoBtn();
      if(drawBtn)drawBtn.onclick=async()=>{
        const all=res.geometry||[];
        const picked=pickedGeo();
        const list=all.filter(g=>picked.includes(g.number));
        if(!list.length)return toast('請先勾選要畫圖的題目。');
        const old=drawBtn.textContent;drawBtn.disabled=true;
        try{
          const figures={};
          for(let i=0;i<list.length;i++){
            drawBtn.textContent=`畫圖中… ${i+1}/${list.length}`;
            const fig=await api('/api/questions/ai-figure',{
              content:list[i].stem,topic:'幾何',qtype:'解答題',
              consentExternal:S.ai?.mode==='external'});
            figures[list[i].number]=await svgToPng(fig.svg);
          }
          drawBtn.textContent='重新排版中…';
          const again=await apiJob(`/api/paper-templates/${tid}/apply`,
            {file:data,consentExternal:isPdf,mathAsText,numbering,figures},
            job=>{drawBtn.textContent=`重新排版中… ${Math.round(job.elapsed||0)} 秒`;});
          const a=document.createElement('a');a.href=again.docx;a.download=again.filename;a.click();
          toast(`已加入 ${Object.keys(figures).length} 張圖，重新下載`);
        }catch(e){toast(e.message);}
        drawBtn.disabled=false;drawBtn.textContent=old;
      };
      $('#dl-paper').onclick=()=>{const a=document.createElement('a');a.href=res.docx;a.download=res.filename;a.click();};
      $('#save-paper').onclick=async()=>{
        const btn=$('#save-paper');const old=btn.textContent;btn.disabled=true;btn.textContent='保存中…';
        try{
          const out=await api('/api/papers',{
            title:($('#save-paper-title').value||'').trim()||guess.title,
            year:($('#save-paper-year').value||'').trim(),
            grade:($('#save-paper-grade').value||'').trim(),
            term:($('#save-paper-term').value||'').trim(),
            templateId:tid,
            sections:res.content?.sections||[]});
          markNewPaper(out.paper&&out.paper.id);
          btn.textContent='已保存';btn.disabled=true;
          $('#save-paper-result').innerHTML=`已存進「我的試卷」：<button class="text-button" data-page="papers">去看看</button>`;
          const go=$('#save-paper-result [data-page=papers]');
          if(go)go.onclick=()=>papersPage();
          toast(`已保存（${out.paper?.questionCount||0} 題）`);
          return;
        }catch(e){toast(e.message);}
        btn.disabled=false;btn.textContent=old;
      };
      btn.disabled=false;btn.textContent=old;
    }catch(e){toast(e.message);btn.disabled=false;btn.textContent=old;}
  };
  // ③ LaTeX：preamble 與配分位置記在這台裝置，下次不用重貼。
  const mathText=$('#paper-math-text');
  mathText.checked=localStorage.getItem('mathpath_math_text')==='1';
  mathText.onchange=()=>localStorage.setItem('mathpath_math_text',mathText.checked?'1':'0');
  const numberingSel=$('#paper-numbering');
  numberingSel.value=localStorage.getItem('mathpath_numbering')||'continuous';
  const pre=$('#tex-preamble'), marks=$('#tex-marks');
  pre.value=localStorage.getItem('mathpath_tex_preamble')||'';
  pre.oninput=()=>localStorage.setItem('mathpath_tex_preamble',pre.value);
  marks.value=localStorage.getItem('mathpath_tex_marks')||'trailing';
  marks.onchange=()=>localStorage.setItem('mathpath_tex_marks',marks.value);
  $('#tex-apply').onclick=async()=>{
    const file=$('#paper-file').files[0];
    if(!file)return toast('請先在上方「新卷」選一份 .docx 或 PDF。');
    const btn=$('#tex-apply');const old=btn.textContent;btn.disabled=true;btn.textContent='產生中…';
    try{
      const isPdf=/pdf$/i.test(file.name||'')||file.type===PDF_MIME;
      if(isPdf&&!$('#pdf-consent').checked)throw new Error('PDF 需要先勾選「送給外部 AI 分析」。');
      const data=await fileData(file,[DOCX_MIME,PDF_MIME],12);
      const body={file:data,marksPosition:marks.value,consentExternal:isPdf,
                  numbering:$('#paper-numbering').value};
      // 有選範本就跟 Word 用同一份版面（卷頭、大題標題、配分、卷尾）
      const tplId=pick();if(tplId)body.templateId=tplId;
      if(pre.value.trim())body.preamble=pre.value;
      const res=await apiJob('/api/papers/to-tex',body,
        job=>{btn.textContent=`產生中… ${Math.round(job.elapsed||0)} 秒`;});
      const a=document.createElement('a');
      if(res.texZip){a.href=res.texZip;a.download=res.filename.replace(/\.tex$/, '.zip');}
      else{a.href=URL.createObjectURL(new Blob([res.tex],{type:'text/x-tex;charset=utf-8'}));a.download=res.filename;}
      a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),2000);
      const st=res.stats||{};
      $('#tex-result').innerHTML=`<div class="layout-result"><div><strong>TeX 已下載</strong>
        <span class="small-text">${st.sections||0} 個分部 · ${st.questions||0} 題 · ${st.formulas||0} 條公式 · ${esc(res.filename)}</span></div></div>`;
      btn.disabled=false;btn.textContent=old;
    }catch(e){toast(e.message);btn.disabled=false;btn.textContent=old;}
  };
}
