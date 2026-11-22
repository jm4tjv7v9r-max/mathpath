'use strict';
// 分數檢查：總分要 110；選擇題「總分 ÷ 題數」要是整數，否則會出現半分的題。
function scoreCheckHtml(score){
  if(!score||score.total===undefined)return '';
  const c=score.choice||{};
  const fmt=n=>Number.isInteger(Number(n))?String(Number(n)):Number(n).toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
  const totalOk=!!score.ok, eachOk=!c.count||!!c.even;
  const good=totalOk&&eachOk&&!(score.warnings||[]).length;
  return `<div class="score-check ${good?'ok':'warn'}">
    <div class="score-head">${icon(good?'check':'warn')}<strong>分數檢查</strong>
      <span class="score-pill ${totalOk?'ok':'bad'}">總分 ${fmt(score.total)} 分${totalOk?'　＝ '+fmt(score.target)+' 分':'　（要求 '+fmt(score.target)+' 分）'}</span>
      ${c.count?`<span class="score-pill ${eachOk?'ok':'bad'}">選擇題 ${fmt(c.total)} 分 ÷ ${c.count} 題 ＝ ${fmt(c.each)} 分${eachOk?'':'（不是整數）'}</span>`:''}
    </div>
    ${(score.warnings||[]).map(w=>`<div class="score-line">${icon('warn')}<span>${esc(w)}</span></div>`).join('')}
  </div>`;
}

// AI 回傳的是 SVG；Word 要的是點陣圖，所以在瀏覽器用 canvas 轉成 PNG。
function svgToPng(svg,widthPx=900){
  return new Promise((resolve,reject)=>{
    const blob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const img=new Image();
    img.onload=()=>{
      const ratio=img.height&&img.width?img.height/img.width:0.75;
      const canvas=document.createElement('canvas');
      canvas.width=widthPx;canvas.height=Math.round(widthPx*ratio);
      const ctx=canvas.getContext('2d');
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      URL.revokeObjectURL(url);
      // AI 畫圖失敗時會回一張全白 SVG，轉成 PNG 後塞進 Word 就是一條橫貫整行的
      // 空位。抽樣看有沒有非白像素：全白就當畫圖失敗，不要讓它進確認頁／Word。
      try{
        const px=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        let ink=false;
        for(let i=0;i<px.length;i+=4){ // 逐像素，找到第一個非白點就停（有圖很快就停）
          if(px[i]<245||px[i+1]<245||px[i+2]<245){ink=true;break;}
        }
        if(!ink){reject(new Error('AI 畫出的圖是空白的，已略過；可試「更換」或手動上傳圖片。'));return;}
      }catch(e){/* 讀不到像素就照舊放行 */}
      resolve({data:canvas.toDataURL('image/png'),widthCm:7.5});
    };
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('圖形轉檔失敗'));};
    img.src=url;
  });
}

// 成績總表：像 Excel 的網格——列是學生、欄是作業，最右邊是平均分與未完成次數。
// 格子直接改，離開格子就存（存成教師調整，不動學生原始作答）。
async function scoreGridPage(){
  if(S.user?.role!=='teacher')return bank();
  page='scores';shell();
  const classes=await api('/api/score-grid/classes').catch(()=>({classes:[]}));
  const classList=classes.classes||classes||[];
  const cid=Number(sessionStorage.getItem('scoreClass')||0)||null;
  const grid=await api('/api/score-grid'+(cid?`?classId=${cid}`:''))
    .catch(e=>({error:e.message,columns:[],students:[]}));
  if(grid.error){$('#main').innerHTML=`<div class="inline-error">${esc(grid.error)}</div>`;return;}
  const cols=grid.columns||[],rows=grid.students||[];
  const head=cols.map(c=>`<th class="sg-col"><span class="sg-date">${esc(c.date||'—')}</span><span class="sg-title">${esc(c.title||'')}</span></th>`).join('');
  const body=rows.map(r=>`<tr data-row="${r.id}">
    <td class="sg-seat${cid?' editable':''}" data-u="${r.id}"${cid?' contenteditable="true"':''}
        title="${cid?'點一下可直接改學號':'選擇班別後可改學號'}">${r.seat??''}</td>
    <td class="sg-name" title="${esc(r.fullName||r.name||'')}">${esc(r.name||'')}</td>
    ${r.cells.map((c,i)=>`<td class="sg-cell${c.overridden?' edited':''}${c.score===null?' empty':''}"
        contenteditable="true" data-a="${cols[i].id}" data-u="${r.id}"
        title="${c.overridden?'教師調整過（按右鍵還原）':'系統依作答計算'}">${c.score===null?'':fmtScore(c.score)}</td>`).join('')}
    <td class="sg-avg">${r.average===null?'—':fmtScore(r.average)}</td>
    <td class="sg-miss">${r.missing}</td></tr>`).join('');
  $('#main').innerHTML=`<div class="fade-in">
    ${heading('SCORE SHEET','成績總表','列是學生、欄是作業；分數由系統依作答自動填入，可直接改。')}
    <div class="panel panel-pad">
      <div class="sg-toolbar">
        <label class="small-text">班別
          <select id="sg-class"><option value="">全部學生</option>
            ${classList.map(c=>`<option value="${c.id}"${cid===c.id?' selected':''}>${esc(c.name||'')}</option>`).join('')}
          </select>
        </label>
        <span class="sg-newcol" id="sg-newcol" hidden>
          <input id="sg-newcol-title" placeholder="欄位名稱，如：小測三" maxlength="40">
          <input id="sg-newcol-date" type="date">
          <button class="primary" id="sg-newcol-ok">確定</button>
        </span>
        <button class="secondary" id="sg-addcol">＋ 新增分數欄位</button>
        <button class="secondary" id="sg-bulk">首次整班匯入</button>
        <button class="secondary" id="sg-export">下載整班分紙 Excel</button>
      </div>
      <div class="sg-bulkbox" id="sg-bulkbox" hidden>
        <p class="small-text">一行一個學生，格式「座號 姓名」或只寫姓名；已有的同名學生會自動跳過。</p>
        <p class="small-text sg-mask-note">姓名存入時會遮蔽（陳大文 → 陳X文），全名不會保留、無法還原；請自留原始名單。</p>
        <textarea id="sg-bulk-text" rows="6" placeholder="1 陳大文&#10;2 李小明&#10;3 王美玲"></textarea>
        <div class="sg-bulk-actions" style="justify-content:space-between;gap:8px;flex-wrap:wrap">
          <span class="small-text">或用 Excel 名單：<input type="file" id="sg-bulk-file" accept=".xlsx,.xlsm" style="display:inline-block;width:auto">
            <button class="secondary" id="sg-bulk-import">匯入 Excel</button></span>
          <button class="primary" id="sg-bulk-ok">開始匯入</button></div>
        <div id="sg-bulk-result"></div>
      </div>
      <div class="sg-wrap"><table class="score-grid">
        <thead><tr><th class="sg-seat" title="${cid?'點一下學號可直接修改':'選擇班別後可改學號'}">號</th><th class="sg-name">姓名</th>${head}
          <th class="sg-avg">平均分</th><th class="sg-miss">未完成</th></tr></thead>
        <tbody>${body||`<tr><td colspan="${cols.length+4}" class="sg-empty">還沒有作業資料</td></tr>`}</tbody>
        ${cid?`<tfoot><tr class="sg-addrow">
          <td colspan="2"><input id="sg-stu-seat" type="number" min="1" max="999" placeholder="號"></td>
          <td colspan="${Math.max(1,cols.length)}" class="sg-addcell">
            <input id="sg-stu-name" placeholder="新增學生姓名" maxlength="40">
            <button class="primary" id="sg-stu-ok">＋ 新增學生</button>
          </td>
          <td colspan="2"></td></tr></tfoot>`:''}
      </table></div>
      <p class="field-hint">點格子直接改分數，按 Enter 或點別處即儲存；改過的格子會變淡黃，右鍵可還原成系統分數。清空格子＝還原。</p>
      ${cid?'<p class="field-hint">「號」欄點一下可直接改學號（1–999，同班不可重複）；只改班內編號，學生登入帳號不變。</p>':''}
    </div></div>`;
  $('#sg-class').onchange=async ev=>{
    sessionStorage.setItem('scoreClass',ev.target.value);
    await scoreGridPage();
  };
  // 不用 prompt()：內嵌預覽的 iframe 會封鎖對話框，改用行內表單
  const stuOk=$('#sg-stu-ok');
  if(stuOk)stuOk.onclick=async()=>{
    const name=($('#sg-stu-name').value||'').trim();
    if(!name)return toast('請填姓名。');
    if(!(await askNameMask()))return;
    try{
      const out=await api('/api/score-grid/student',
        {classId:cid,name,seat:Number($('#sg-stu-seat').value)||null});
      const st=out.student;
      toast(`已新增 ${st.name}（${st.seat?st.seat+'號 ' : ''}帳號 ${st.username}／密碼 ${st.password}）`);
      await scoreGridPage();
    }catch(e){toast(e.message);}
  };
  $('#sg-bulk').onclick=()=>{
    if(!cid)return toast('請先選擇一個班別。');
    const box=$('#sg-bulkbox');box.hidden=!box.hidden;
    if(!box.hidden)$('#sg-bulk-text').focus();
  };
  $('#sg-bulk-ok').onclick=async()=>{
    const lines=($('#sg-bulk-text').value||'').split('\n').map(l=>l.trim()).filter(Boolean);
    if(!lines.length)return toast('請貼上學生名單。');
    if(!(await askConfirm(
      `將匯入 ${lines.length} 位學生（姓名會以遮蔽形式存入）。\n\n是否要匯入？`,
      {title:'匯入整班學生',confirmText:'確定匯入',cancelText:'取消'})))return;
    const students=lines.map(line=>{
      const m=line.match(/^(\d{1,3})[\s,，、.\t]+(.+)$/);
      return m?{seat:Number(m[1]),name:m[2].trim()}:{name:line.replace(/^[\s,，、.]+/,'').trim()};
    }).filter(x=>x.name);
    if(!students.length)return toast('名單裡找不到姓名。');
    if(!(await askNameMask()))return;
    try{
      const out=await api('/api/score-grid/students',{classId:cid,students});
      const rows=(out.created||[]).map(st=>`<tr><td>${st.seat??''}</td><td>${esc(st.name)}</td>
        <td>${esc(st.username)}</td><td>${esc(st.password)}</td></tr>`).join('');
      $('#sg-bulk-result').innerHTML=rows?`<p class="small-text">新增 ${out.created.length} 人${out.skipped.length?`，略過同名 ${out.skipped.length} 人`:''}。帳號密碼只顯示這一次，請先抄下。</p>
        <table class="bulk-result"><thead><tr><th>號</th><th>姓名</th><th>帳號</th><th>密碼</th></tr></thead><tbody>${rows}</tbody></table>`
        :`<p class="small-text">沒有新增任何人（全部同名或格式不對）。</p>`;
      toast(`已匯入 ${out.created.length} 人`);
      await scoreGridPage();
    }catch(e){toast(e.message);}
  };
  const showBulk=out=>{
    const rows=(out.created||[]).map(st=>`<tr><td>${st.seat??''}</td><td>${esc(st.name)}</td>
      <td>${esc(st.username)}</td><td>${esc(st.password)}</td></tr>`).join('');
    $('#sg-bulk-result').innerHTML=rows?`<p class="small-text">新增 ${out.created.length} 人${out.skipped.length?`，略過同名 ${out.skipped.length} 人`:''}。帳號密碼只顯示這一次，請先抄下。</p>
      <table class="bulk-result"><thead><tr><th>號</th><th>姓名</th><th>帳號</th><th>密碼</th></tr></thead><tbody>${rows}</tbody></table>`
      :`<p class="small-text">沒有新增任何人（全部同名或格式不對）。</p>`;
  };
  $('#sg-bulk-import').onclick=async()=>{
    if(!cid)return toast('請先選擇一個班別。');
    const file=$('#sg-bulk-file').files[0];
    if(!file)return toast('請先選一個 Excel 檔（.xlsx）。');
    if(!(await askConfirm(
      `將匯入「${file.name}」的整班學生名單（姓名會以遮蔽形式存入）。\n\n是否要匯入？`,
      {title:'匯入整班學生',confirmText:'確定匯入',cancelText:'取消'})))return;
    if(!(await askNameMask()))return;
    const btn=$('#sg-bulk-import');btn.disabled=true;btn.textContent='匯入中…';
    try{
      const data=await fileToDataUrl(file);
      const out=await api('/api/score-grid/students/import',{classId:cid,file:data});
      showBulk(out);toast(`已匯入 ${out.created.length} 人`);
      await scoreGridPage();
    }catch(e){toast(e.message);}
    btn.disabled=false;btn.textContent='匯入 Excel';
  };
  $('#sg-addcol').onclick=()=>{
    if(!cid)return toast('請先選擇一個班別，再新增分數欄位。');
    const box=$('#sg-newcol');
    box.hidden=!box.hidden;
    if(!box.hidden)$('#sg-newcol-title').focus();
  };
  $('#sg-newcol-ok').onclick=async()=>{
    const title=($('#sg-newcol-title').value||'').trim();
    if(!title)return toast('請填欄位名稱。');
    try{
      await api('/api/score-grid/column',{classId:cid,title,date:$('#sg-newcol-date').value||''});
      toast('已新增分數欄位');await scoreGridPage();
    }catch(e){toast(e.message);}
  };
  $('#sg-export').onclick=async ev=>{
    const btn=ev.target;const old=btn.textContent;btn.disabled=true;btn.textContent='匯出中…';
    try{
      const out=await api('/api/score-grid/export'+(cid?`?classId=${cid}`:''));
      const a=document.createElement('a');a.href=out.file;a.download=out.filename;a.click();
      toast('已匯出 Excel');
    }catch(e){toast(e.message);}
    btn.disabled=false;btn.textContent=old;
  };
  // 改一格就只更新那一格、那一列的平均與未完成次數。
  // 以前每次存檔都 scoreGridPage() 整頁重載：畫面閃一下、捲動位置跳回頂端，
  // 30 人 × 10 欄還要全部重算一次。
  const rowById=new Map(rows.map(r=>[r.id,r]));
  const colIndex=new Map(cols.map((c,i)=>[c.id,i]));
  const paintRow=(row,tr)=>{
    if(!row||!tr)return;
    let sum=0,done=0;
    row.cells.forEach(c=>{
      if(c.score!==null&&c.score!==undefined&&Number.isFinite(Number(c.score))){sum+=Number(c.score);done+=1;}
    });
    row.done=done;
    row.missing=Math.max(0,cols.length-done);
    row.average=done?sum/done:null;
    tr.querySelector('.sg-avg').textContent=row.average===null?'—':fmtScore(row.average);
    tr.querySelector('.sg-miss').textContent=row.missing;
  };
  const applyCell=(td,row,idx,value)=>{
    if(!row||idx===undefined||!row.cells[idx])return;
    row.cells[idx]={score:value,overridden:value!==null};
    td.textContent=value===null?'':fmtScore(value);
    td.classList.toggle('edited',value!==null);
    td.classList.toggle('empty',value===null);
    td.title=value!==null?'教師調整過（按右鍵還原）':'系統依作答計算';
    // 存檔後閃一下綠底，讓老師看得出「這一格剛存好」（同一格連續改也重播）
    td.classList.remove('saved');
    void td.offsetWidth;
    td.classList.add('saved');
    clearTimeout(td._savedTimer);
    td._savedTimer=setTimeout(()=>td.classList.remove('saved'),950);
  };
  // 右鍵「還原系統分數」要把系統算的分數抓回來（本地不知道原始分數是多少），
  // 只重抓資料並更新那一列，不整頁重畫。
  const reloadRow=async uid=>{
    try{
      const fresh=(await api('/api/score-grid'+(cid?`?classId=${cid}`:''))).students||[];
      const row=fresh.find(r=>r.id===uid);
      if(!row)return;
      rowById.set(uid,row);
      const tr=$(`tr[data-row="${uid}"]`);
      if(!tr||!tr.querySelectorAll)return;
      const tds=tr.querySelectorAll('.sg-cell');
      row.cells.forEach((c,i)=>{
        const cell=tds[i];
        if(!cell)return;
        cell.textContent=c.score===null?'':fmtScore(c.score);
        cell.classList.toggle('edited',!!c.overridden);
        cell.classList.toggle('empty',c.score===null);
        cell.title=c.overridden?'教師調整過（按右鍵還原）':'系統依作答計算';
      });
      paintRow(row,tr);
    }catch(e){/* 抓不到就維持現狀，下次進頁面會是對的 */}
  };
  $$('.sg-cell').forEach(td=>{
    let before=td.textContent;
    td.onfocus=()=>{before=td.textContent;};
    const store=async value=>{
      const uid=Number(td.dataset.u),idx=colIndex.get(Number(td.dataset.a));
      await api('/api/score-grid/score',{assignmentId:Number(td.dataset.a),userId:uid,score:value});
      applyCell(td,rowById.get(uid),idx,value);
      paintRow(rowById.get(uid),td.closest('tr'));
    };
    const save=async()=>{
      const raw=td.textContent.trim();
      if(raw===String(before||'').trim())return;          // 沒改就不送
      const value=raw===''?null:Number(raw);
      if(value!==null&&!Number.isFinite(value)){toast('請輸入數字');td.textContent=before;return;}
      if(value!==null&&(value<0||value>1000)){toast('分數請介於 0 到 1000');td.textContent=before;return;}
      try{
        await store(value);
        before=td.textContent;
      }catch(e){toast(e.message);td.textContent=before;}
    };
    td.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();td.blur();}};
    td.onblur=save;
    td.oncontextmenu=async ev=>{
      ev.preventDefault();
      try{
        await store(null);
        await reloadRow(Number(td.dataset.u));
        before='';
        toast('已還原系統分數');
      }catch(e){toast(e.message);}
    };
  });
  // ── 改學號：座號欄直接編輯，存檔後只重排這張表，不整頁重載 ──────────────
  const resortRows=()=>{
    const tbody=$('.score-grid tbody');
    if(!tbody||!tbody.querySelectorAll)return;
    const trs=[...tbody.querySelectorAll('tr[data-row]')];
    const key=tr=>{
      const v=rowById.get(Number(tr.dataset.row))?.seat;
      return (v===null||v===undefined||v==='')?999:Number(v);
    };
    trs.sort((a,b)=>key(a)-key(b)||Number(a.dataset.row)-Number(b.dataset.row));
    trs.forEach(tr=>tbody.appendChild(tr));
  };
  if(!cid)$$('tbody .sg-seat').forEach(td=>{
    td.onclick=()=>toast('請先在上方選擇班別，再改學號。');
  });
  if(cid)$$('.sg-seat.editable').forEach(td=>{
    let before=td.textContent.trim();
    const restore=()=>{td.textContent=before;};
    const save=async()=>{
      const raw=td.textContent.replace(/\s+/g,'');
      if(raw===before)return;
      let value=null;
      if(raw!==''){
        if(!/^\d{1,3}$/.test(raw)||Number(raw)<1){toast('學號請填 1 到 999 的數字');restore();return;}
        value=Number(raw);
      }
      const uid=Number(td.dataset.u);
      const row=rowById.get(uid);
      try{
        const out=await api('/api/score-grid/student/seat',
          {classId:cid,userId:uid,seat:value});
        const saved=out.student?out.student.seat:value;
        if(row)row.seat=saved;
        td.textContent=(saved===null||saved===undefined)?'':String(saved);
        before=td.textContent;
        resortRows();
        toast(value===null?`已清空 ${row?.name||''} 的學號`:`已將 ${row?.name||''} 的學號改為 ${value}`);
      }catch(e){toast(e.message);restore();}
    };
    td.onfocus=()=>{
      before=td.textContent.trim();
      // 已有號碼就整格選起來，直接打字即覆蓋，不用先刪
      if(before){
        const range=document.createRange();
        range.selectNodeContents(td);
        const sel=window.getSelection();
        sel.removeAllRanges();sel.addRange(range);
      }
    };
    td.onkeydown=ev=>{
      if(ev.key==='Enter'){ev.preventDefault();td.blur();}
      else if(ev.key==='Escape'){restore();td.blur();}
    };
    td.onblur=save;
  });
}
function fmtScore(n){const v=Number(n);return Number.isInteger(v)?String(v):v.toFixed(1);}
