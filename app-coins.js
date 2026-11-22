'use strict';
// ── 金幣 ────────────────────────────────────────────────────────────────
// 學生：看自己的金幣與來源；教師：看全班金幣，並可獎勵 10／20／50。
async function coinsPage(){
  page='coins';shell();
  if(!S.user)return loginModal(coinsPage);
  if(S.user.role==='teacher')return teacherCoinsPage();
  $('#main').innerHTML=`<div class="fade-in">${heading('COINS','我的金幣','每得 1 分就有 1 枚金幣，每天第一次登入再送 10 枚；金幣會一直累積。')}<section class="panel panel-pad"><p class="small-text">載入中…</p></section></div>`;
  let data;
  try{data=await api('/api/coins');}
  catch(err){$('#main').innerHTML=`<div class="fade-in">${heading('COINS','我的金幣','')}${empty('讀取金幣失敗',err.message,'')}</div>`;return;}
  const c=data.coins,events=data.events||[];
  const rows=events.map(e=>`<div class="coin-row"><span class="coin-amount">+${e.amount}</span><span class="coin-why">${esc(e.reason||'金幣')}</span><span class="small-text">${esc(e.day||'')}</span></div>`).join('');
  $('#main').innerHTML=`<div class="fade-in">${heading('COINS','我的金幣','每得 1 分就有 1 枚金幣，每天第一次登入再送 10 枚；金幣會一直累積。')}
    <section class="panel panel-pad coin-hero">
      <div class="coin-total"><span class="coin-badge">${icon('coin')}</span><strong>${c.total}</strong><small>枚金幣</small></div>
      <div class="coin-split">
        <div><span>得分換來</span><strong>${c.scoreCoins}</strong></div>
        <div><span>每日登入</span><strong>${c.dailyCoins}</strong></div>
        <div><span>老師獎勵</span><strong>${c.manualCoins}</strong></div>
      </div>
      <p class="field-hint" style="margin:12px 0 0">${c.todayClaimed?`今天已領取每日 ${c.dailyBonus} 枚。`:`今天的每日 ${c.dailyBonus} 枚還沒領，下次登入時會自動發放。`}</p>
    </section>
    <div class="coin-cards">
      <section class="panel panel-pad"><h2>${icon('target')}得分換金幣</h2><p class="small-text">每得 1 分自動 +1 枚。作業要老師批閱後才算；分數有小數時向下取整（7.5 分 → 7 枚）。</p></section>
      <section class="panel panel-pad"><h2>${icon('clock')}每日登入</h2><p class="small-text">每天第一次登入 +${c.dailyBonus} 枚；同一天再登入不會重複發。</p></section>
      <section class="panel panel-pad"><h2>${icon('spark')}老師獎勵</h2><p class="small-text">老師可以在「金幣」頁額外送你 10、20 或 50 枚。</p></section>
    </div>
    <section class="panel panel-pad" style="margin-top:16px"><h2 style="margin-bottom:10px">最近紀錄</h2>
      ${rows||'<p class="small-text">還沒有每日登入或老師獎勵的紀錄。</p>'}
      <p class="field-hint" style="margin-top:12px">得分換來的金幣會即時反映在上面的總數，不逐筆列出。</p></section>
    </div>`;
}

async function teacherCoinsPage(){
  $('#main').innerHTML=`<div class="fade-in">${heading('COINS','金幣','')}<section class="panel panel-pad"><p class="small-text">載入中…</p></section></div>`;
  let data;
  try{data=await api('/api/coins/students');}
  catch(err){$('#main').innerHTML=`<div class="fade-in">${heading('COINS','金幣','')}${empty('讀取金幣失敗',err.message,'')}</div>`;return;}
  const students=data.students||[],grants=data.grants||[10,20,50],classes=data.classes||[];
  // 點「總計」表頭排序：0=原始順序、1=金幣由高至低、-1=由低至高。
  let sortDir=0;
  const sortArrow=()=>sortDir===1?' ↓':sortDir===-1?' ↑':'';
  const classChips=(s)=>{const cs=s.classNames||[];return cs.length
    ?cs.map(c=>`<span class="roster-class">${esc(c)}</span>`).join(' ')
    :'<span class="small-text roster-class">未分班</span>';};
  const rowHtml=(s)=>`<tr data-coin-row="${s.id}">
      <td>${s.seat?esc(s.seat):'—'}</td>
      <td>${esc(s.name)}${s.username===s.name?'':` <span class="small-text">${esc(s.username)}</span>`}${s.disabled?' <span class="role-badge off">已停用</span>':''}</td>
      <td>${classChips(s)}</td>
      <td>${esc(s.grade||'—')}</td>
      <td>${s.scoreCoins}</td><td>${s.dailyCoins}</td><td data-coin-manual>${s.manualCoins}</td>
      <td><strong data-coin-total>${s.coins}</strong></td>
      <td class="coin-actions">${grants.map(g=>`<button class="text-button" data-coin-grant="${s.id}" data-coin-amount="${g}" data-coin-name="${esc(s.name)}">+${g}</button>`).join('')}</td>
    </tr>`;
  // 篩選：關鍵字（姓名／學號／座號／班別）＋ 班別下拉。
  // 一個學年幾百人，捲動找學生太慢；姓名是遮蔽過的，查詢字串也要遮蔽一次才比得上。
  const listHtml=(kw,cid)=>{
    if(!students.length)return '<p class="small-text">還沒有學生帳號。</p>';
    const q=(kw||'').trim().toLowerCase(),qm=maskNameLike(q).toLowerCase();
    const cls=cid&&cid!=='__none'?classes.find(c=>String(c.id)===cid):null;
    const list=students.filter(s=>{
      const cs=s.classNames||[];
      if(cid==='__none'&&cs.length)return false;      // 只看未分班
      if(cls&&!cs.includes(cls.name))return false;    // 只看某一班
      if(!q)return true;
      return [s.name,s.username,s.seat,s.grade,cs.join(' ')]
        .some(v=>{const t=String(v||'').toLowerCase();return t.includes(q)||t.includes(qm);});
    });
    if(sortDir!==0)list.sort((a,b)=>-sortDir*(a.coins-b.coins)||(a.seat||'').localeCompare(b.seat||'',undefined,{numeric:true}));
    const count=$('#coin-count');
    if(count)count.textContent=`顯示 ${list.length} / ${students.length} 位`;
    if(!list.length)return '<p class="small-text" style="padding:14px 0">沒有符合條件的學生。</p>';
    return `<div class="table-scroll"><table class="results-table coin-table"><thead><tr><th>座號</th><th>學生</th><th>班別</th><th>年級</th><th>得分</th><th>每日</th><th>獎勵</th><th class="coin-sortable" data-coin-sort title="按一下依總計排序">總計${sortArrow()}</th><th>加金幣</th></tr></thead><tbody>${list.map(rowHtml).join('')}</tbody></table></div>`;
  };
  $('#main').innerHTML=`<div class="fade-in">${heading('COINS','金幣','學生每得 1 分 = 1 枚金幣，每天第一次登入 +10；你可以再獎勵 10、20 或 50 枚。')}
    <section class="panel panel-pad"><div class="roster-filter"><label class="search-field">${icon('search')}<input id="coin-search" placeholder="搜尋姓名、學號、座號或班別…" aria-label="搜尋學生"></label><select id="coin-class" aria-label="班別"><option value="">全部班別</option><option value="__none">未分班</option>${classes.map(c=>`<option value="${c.id}">${esc(c.name)}（${c.studentCount}）</option>`).join('')}</select><span class="small-text" id="coin-count"></span></div>
    <div id="coin-body">${listHtml('','')}</div>
    <p class="field-hint" style="margin-top:12px">「得分」是已批閱的分數換來的（作業要老師批閱過才算）；「每日」是每天第一次登入的 +10；「獎勵」是老師額外給的。</p></section></div>`;
  const bind=()=>{$$('[data-coin-grant]').forEach(b=>{
    b.onclick=async()=>{
      const uid=Number(b.dataset.coinGrant),amount=Number(b.dataset.coinAmount);
      if(b.disabled)return;
      b.disabled=true;
      try{
        const r=await api('/api/coins/grant',{userId:uid,amount});
        const st=students.find(s=>s.id===uid);
        if(st){st.manualCoins=r.coins.manualCoins;st.coins=r.coins.total;}
        // 就地更新那一列（重畫整張表會讓搜尋框失焦）
        const row=$(`[data-coin-row="${uid}"]`);
        if(row){
          const man=row.querySelector('[data-coin-manual]'),tot=row.querySelector('[data-coin-total]');
          if(man)man.textContent=r.coins.manualCoins;
          if(tot)tot.textContent=r.coins.total;
        }
        // 已依金幣排序時，加完後順序可能變，重繪以保持正確排序。
        if(sortDir!==0)repaint();
        toast(`已給 ${r.student.name} +${amount} 枚金幣（目前 ${r.coins.total} 枚）。`);
      }catch(err){toast(err.message);}
      finally{b.disabled=false;}
    };
  });};
  const repaint=()=>{
    $('#coin-body').innerHTML=listHtml($('#coin-search')?$('#coin-search').value:'',
                                       $('#coin-class')?$('#coin-class').value:'');
    bind();
    // 每次重繪都會重建表頭，要在新節點上重新綁排序。
    if($('[data-coin-sort]'))$('[data-coin-sort]').onclick=()=>{
      sortDir=sortDir===1?-1:(sortDir===0?1:0);
      repaint();
    };
  };
  repaint();
  if($('#coin-search'))$('#coin-search').oninput=repaint;
  if($('#coin-class'))$('#coin-class').onchange=repaint;
}
