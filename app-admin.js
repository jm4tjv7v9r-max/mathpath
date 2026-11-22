'use strict';
function aiCapability(label,ok,need){return `<li class="${ok?'ready':''}">${ok?icon('check'):icon('lock')}<div><strong>${esc(label)}</strong><small>${ok?'可用 · ':''}${esc(need)}</small></div></li>`;}
async function aiConfigPage(){page='ai';shell();if(!S.user)return loginModal(aiConfigPage);if(S.user.role!=='teacher'){$('#main').innerHTML=heading('AI ENDPOINT','模型端點','更換模型端點只限教師。')+`<section class="panel">${empty('此頁只限教師','模型端點涉及伺服器金鑰，只開放給教師。',`<button class="primary" data-page="homework">返回作業 ${icon('arrow')}</button>`)}</section>`;return;}$('#main').innerHTML=heading('AI ENDPOINT','模型端點','隨時更換 AI 服務，無需重新啟動。')+`<section class="panel">${empty('正在讀取模型設定','向網站伺服器查詢目前端點。')}</section>`;try{AICFG=await api('/api/ai-config');}catch(e){if(page==='ai')$('#main').innerHTML=heading('AI ENDPOINT','模型端點','讀取設定失敗。')+`<div class="inline-error">${esc(e.message)}</div>`;return;}if(page==='ai')renderAiConfigPage();}
function renderAiConfigPage(){const c=AICFG,a=c.active;const mode={local:'本機模型（可傳送作答）',external:'外部模型（每次需同意）',off:'未接入'}[a.mode]||a.mode;const source={env:'伺服器環境變數',saved:'介面儲存設定',none:'未設定'}[a.source]||a.source;const draft=c.saved||c.env,dis=c.canEdit?'':'disabled';
$('#main').innerHTML=`<div class="fade-in">${heading('AI ENDPOINT','模型端點','隨時更換 AI 服務，無需重新啟動。設定只保存在這台伺服器，金鑰不會傳到瀏覽器。')}<div class="metric-row">${[['目前模式',mode,''],['文字模型',a.model||'—','用於批改、學習建議、拆題與生成'],['視覺模型',a.vision||'—','用於手寫辨識與 AI 建議批註'],['繪圖模型',a.draw||'—',a.drawCustom?'另外指定，用於 AI 依題目畫幾何圖形':'沿用文字模型，用於 AI 依題目畫幾何圖形'],['設定來源',source,'已儲存設定優先於環境變數'],['計費模式',a.thinking?'精確模式（較貴）':'省錢模式（推薦）',a.thinking?'AI 先推理再作答，適合申論／證明題':'AI 直接作答，輸出 token 少，費用約三分之一']].map(([l,v,f])=>`<div class="metric"><div class="metric-label">${l}</div><div class="metric-value" style="font-size:calc(18px*var(--fs));line-height:1.6;word-break:break-all">${esc(v)}</div><div class="metric-foot">${f}</div></div>`).join('')}</div>${c.invalidSaved?`<div class="inline-error">已儲存的端點設定無效，系統已回退環境變數。請重新儲存一組可用的設定。</div>`:''}<div class="settings-layout"><section class="panel settings-panel"><h2>${icon('ai')}更換模型端點</h2><p class="info-note">支援任何 OpenAI 相容的 <code>/chat/completions</code> 端點。本機服務（127.0.0.1／localhost）可用 HTTP；其他主機必須 HTTPS。</p>${!c.canEdit?`<div class="import-warning">${c.tokenRequired?'此伺服器已設定 MATH_ADMIN_TOKEN，需要管理員權杖才能更換端點。':'只有從伺服器本機操作時才可直接更換端點。若需從校內其他電腦管理，請在伺服器設定 MATH_ADMIN_TOKEN 環境變數。'}</div>`:''}<form id="ai-form"><div class="form-field"><label class="field-label" for="ai-base">端點位址</label><input id="ai-base" value="${esc(draft.baseUrl||'')}" placeholder="例如：http://127.0.0.1:11434/v1" maxlength="500" ${dis}></div><div class="form-grid"><div class="form-field"><label class="field-label" for="ai-model">文字模型</label><input id="ai-model" value="${esc(draft.model||'')}" placeholder="例如：qwen2.5:14b" maxlength="200" ${dis}></div><div class="form-field"><label class="field-label" for="ai-vision">視覺模型（可留空）</label><input id="ai-vision" value="${esc(draft.visionModel||'')}" placeholder="須真實支援圖片輸入" maxlength="200" ${dis}></div></div><div class="form-field"><label class="field-label" for="ai-draw">繪圖模型（可留空）</label><input id="ai-draw" value="${esc(draft.drawModel||'')}" placeholder="留空＝沿用文字模型" maxlength="200" ${dis}><small class="field-hint">AI 依題目畫幾何圖形時使用。畫圖是「讀題 → 輸出座標」的推理工作，比批改更吃模型能力；留空就沿用上面的文字模型。</small></div><div class="form-field"><label class="field-label" for="ai-reasoning">推理模型（可留空）</label><input id="ai-reasoning" value="${esc(draft.reasoningModel||'')}" placeholder="留空＝不啟用；例：deepseek-reasoner" maxlength="200" ${dis}><small class="field-hint">只有「幾何／向量的證明題、解答題」會改用這支模型（長鏈推理比較準，但輸出 token 是 3～5 倍）；其他題目照用文字模型。</small></div><div class="form-field"><label class="field-label" for="ai-key">API 金鑰</label><input id="ai-key" type="password" autocomplete="new-password" placeholder="${draft.keySet?'已設定 · 留空表示不變更':'未設定 · 若端點無需認證可留空'}" maxlength="8192" ${dis}></div><div class="form-field"><label class="field-label" for="ai-thinking">計費模式</label><label class="checkbox-line"><input type="checkbox" id="ai-thinking" ${a.thinking?'':'checked'}> <b>省錢模式</b>（推薦）<small>關閉 AI 的「思考鏈」，輸出 token 大幅減少，費用約為原本的三分之一。適合選擇題、填空題、計算題與簡短作答。</small></label><p class="field-hint">取消勾選＝<b>精確模式</b>：AI 會先推理再作答，申論題／證明題較準確，但費用較高。此設定僅對 DeepSeek 等支援思考模式的模型有效，其他模型會自動忽略。</p></div>${c.tokenRequired?`<div class="form-field"><label class="field-label" for="ai-token">管理員權杖</label><input id="ai-token" type="password" autocomplete="off" placeholder="MATH_ADMIN_TOKEN" maxlength="256"></div>`:''}<p class="field-hint">金鑰只會送往網站伺服器並存於伺服器的資料庫；介面永遠不會讀回金鑰內容，只顯示是否已設定。</p><p class="error-text" id="ai-error"></p><div class="ai-config-actions"><button class="secondary" type="button" id="ai-test" ${dis}>${icon('check')}測試文字模型</button><button class="secondary" type="button" id="ai-test-vision" ${dis}>${icon('image')}測試視覺模型</button><button class="primary" type="submit" ${dis}>${icon('check')}儲存並立即啟用</button></div><div id="ai-test-result"></div></form>${c.canEdit?`<button class="text-button" id="ai-clear" style="font-size:calc(14px*var(--fs));margin-top:14px">清除已儲存設定，改用環境變數</button>`:''}</section><div><section class="panel settings-panel"><h2>${icon('spark')}這個端點能支援甚麼</h2><ul class="capability-list">${aiCapability('批改文字作答、產生學習建議',a.configured,'需要文字模型')}${aiCapability('拆題與生成相似／進階題',a.configured,'需要文字模型')}${aiCapability('手寫辨識與 AI 建議批註',!!a.vision,'需要視覺模型')}</ul></section><section class="panel settings-panel" style="margin-top:20px"><h2>${icon('lock')}安全說明</h2><ul><li>金鑰保存在伺服器的 SQLite 資料庫（檔案權限 600）。</li><li>金鑰不會回傳瀏覽器，介面只顯示是否已設定。</li><li>${c.tokenRequired?'更換端點需要管理員權杖。':'未設定 MATH_ADMIN_TOKEN 時，只有伺服器本機可以更換端點。'}</li><li>外部端點必須使用 HTTPS；非本機位址不接受 HTTP。</li><li>使用外部模型傳送學生作答前，系統會要求逐次同意。</li><li>AI 的數學判斷與批註只作教師覆核的提示，不可直接作為成績。</li></ul></section></div></div></div>`;
const body=()=>{const v={baseUrl:$('#ai-base').value.trim(),model:$('#ai-model').value.trim(),visionModel:$('#ai-vision').value.trim(),drawModel:$('#ai-draw').value.trim(),reasoningModel:$('#ai-reasoning').value.trim()};if($('#ai-key').value)v.apiKey=$('#ai-key').value;if($('#ai-token')?.value)v.adminToken=$('#ai-token').value;if($('#ai-thinking'))v.thinking=!$('#ai-thinking').checked;return v;};
$('#ai-form').onsubmit=async e=>{e.preventDefault();const b=$('#ai-form button[type=submit]');b.disabled=true;$('#ai-error').textContent='';try{await api('/api/ai-config',body());toast('模型端點已更新並立即生效。');aiConfigPage();}catch(err){$('#ai-error').textContent=err.message;b.disabled=false;}};
const runTest=async vision=>{const btn=$(vision?'#ai-test-vision':'#ai-test'),original=btn.innerHTML;btn.disabled=true;btn.innerHTML=icon('clock')+'測試中…';$('#ai-test-result').innerHTML='';try{const payload=body();if(vision)payload.vision=true;const r=await api('/api/ai-config/test',payload);$('#ai-test-result').innerHTML=`<div class="hint-box">連線成功（${r.mode==='local'?'本機':'外部'} · ${esc(r.model)}）${r.testedVision?'；端點接受了圖片輸入，但這不證明辨識準確度。':''}</div>`;}catch(err){$('#ai-test-result').innerHTML=`<div class="inline-error">連線失敗：${esc(err.message)}</div>`;}finally{btn.disabled=false;btn.innerHTML=original;}};
$('#ai-test').onclick=()=>runTest(false);$('#ai-test-vision').onclick=()=>runTest(true);
if($('#ai-thinking'))$('#ai-thinking').onchange=async e=>{const on=e.target.checked;e.target.disabled=true;try{const r=await api('/api/ai-config/economy',{economy:on});AICFG.active=r.active;toast(on?'已切換為省錢模式：AI 直接作答，費用約三分之一。':'已切換為精確模式：AI 先推理再作答，費用較高。');renderAiConfigPage();}catch(err){toast(err.message);e.target.checked=!on;}finally{e.target.disabled=false;}};
if($('#ai-clear'))$('#ai-clear').onclick=async()=>{if(await askCancel('清除已儲存的模型設定？AI 功能將停用，除非環境變數另有設定。'))return;try{await api('/api/ai-config',{baseUrl:'',model:''});toast('已清除已儲存的設定。');aiConfigPage();}catch(e){toast(e.message);}};}
let ADMIN_STATS=null;
function formatBytes(value){const n=Number(value)||0;if(n<=0)return '0 B';const units=['B','KB','MB','GB','TB'];const i=Math.min(units.length-1,Math.floor(Math.log(n)/Math.log(1024)));return (n/Math.pow(1024,i)).toFixed(i?1:0)+' '+units[i];}
// 用量卡片：讓教師知道題庫、作答與圖片各佔多少，以及還有多少空間可以回收。
function adminStatsCards(stats){
  if(!stats)return `<div class="metric"><div class="metric-label">用量</div><div class="metric-value">讀取中…</div><div class="metric-foot">正在查詢本機資料庫</div></div>`;
  const d=stats.database,c=stats.counts,img=stats.images;
  const cards=[['資料庫檔案',formatBytes(d.bytes),`可回收 ${formatBytes(d.reclaimableBytes)} · WAL ${formatBytes(d.walBytes)}`],
    ['題庫題目',`${c.questions} 題`,`跨學年保留 · 題目圖形 ${img.questionFigure} 張`],
    ['作答紀錄',`${c.attempts} 筆`,`手寫圖 ${img.handwriting} 張 · 教師批註 ${img.annotation} 張`],
    ['圖片占用',formatBytes(img.inDatabaseBytes),img.storageMode==='r2'?`另有 ${img.inObjectStorage} 張在物件儲存`:'目前存在資料庫內（可設定 R2 搬出）'],
    ['最近學年重置',stats.lastStudentReset?dateText(stats.lastStudentReset):'尚未執行','重置只清學生資料，題庫保留']];
  return cards.map(([label,value,foot])=>`<div class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(String(value))}</div><div class="metric-foot">${esc(foot)}</div></div>`).join('');
}
// 網盤備份：手寫圖／題目圖形／批註在上傳當下就已進網盤；這裡再把資料庫快照與題庫歸檔送上去。
function backupZoneHtml(b){
  if(!b)return `<h3>${icon('upload')}網盤備份</h3><p class="field-hint">正在讀取備份狀態…</p>`;
  const rows=[[ '網盤', b.bucket||'已設定', b.endpoint?`${b.endpoint}${b.region?` · region ${b.region}`:''}`:'S3 相容端點'],
              [ '最近備份', b.lastAt?dateText(b.lastAt):'尚未備份',
                b.lastTrigger==='scheduled'?'由排程自動執行':b.lastTrigger==='manual'?'手動執行':'—'],
              [ '保留份數', `${b.count} / ${b.keep}`, '超過就自動刪掉最舊的一份'],
              [ '自動備份', b.intervalHours?`每 ${b.intervalHours} 小時`:'未啟用',
                b.intervalHours?'由 MATH_BACKUP_HOURS 設定':'在部署平台設定 MATH_BACKUP_HOURS 即會開啟']];
  return `<h3>${icon('upload')}網盤備份</h3>
  <p class="field-hint">學生手寫圖、題目圖形與教師批註在<strong>上傳當下</strong>就已經存進網盤；這裡再把<strong>資料庫快照</strong>（帳號、班級、作業、作答、分數）與<strong>題庫歸檔</strong>一起送上去。兩者都在網盤上，就算伺服器整台消失也能還原。</p>
  ${b.configured?`<div class="metric-row">${rows.map(([l,v,f])=>`<div class="metric"><div class="metric-label">${esc(l)}</div><div class="metric-value" style="font-size:calc(17px*var(--fs))">${esc(String(v))}</div><div class="metric-foot">${esc(f)}</div></div>`).join('')}</div>
  <div class="admin-actions"><button class="secondary" id="admin-backup-now">${icon('upload')}立即備份到網盤</button></div>`
  :`<div class="import-warning">尚未設定網盤。在部署平台加入 <code>R2_ACCOUNT_ID</code>、<code>R2_ACCESS_KEY_ID</code>、<code>R2_SECRET_ACCESS_KEY</code>、<code>R2_BUCKET</code> 四個環境變數後重新部署，手寫圖與備份就會自動存到網盤。改用 AWS S3、Backblaze B2、Wasabi 或自架 MinIO 時，改填 <code>R2_ENDPOINT</code>（＋<code>R2_REGION</code>），並可省略 <code>R2_ACCOUNT_ID</code>。${b.error?`<br>目前狀態：${esc(b.error)}`:''}</div>`}
  ${(b.history||[]).length?`<details class="backup-history"><summary>最近 ${b.history.length} 次備份</summary><ul>${b.history.map(h=>`<li><strong>${dateText(h.at)}</strong> · ${h.trigger==='scheduled'?'排程':'手動'} · ${formatBytes(h.bytes)}<br><code>${esc((h.files||[]).join(' , '))}</code></li>`).join('')}</ul></details>`:''}`;
}
function bindBackupZone(){
  const b=$('#admin-backup-now');
  if(!b)return;
  b.onclick=async()=>{const original=b.innerHTML;b.disabled=true;b.innerHTML=icon('clock')+'正在備份…';
    try{const r=await api('/api/admin/backup/upload',{});ADMIN_STATS=ADMIN_STATS||{};ADMIN_STATS.backup=r.status;
      $('#admin-backup-zone').innerHTML=backupZoneHtml(r.status);bindBackupZone();
      toast(`已備份到網盤（${formatBytes(r.entry.bytes)}，保留 ${r.kept} 份）。`);}
    catch(e){toast(e.message);b.disabled=false;b.innerHTML=original;}};
}
// 還原是「新增」資料：不刪現有內容、不覆蓋同名帳號。歸檔不含密碼，還原後要重新發密碼。
function restoreHtml(){
  return `<div class="restore-zone">
  <h3>${icon('upload')}從歸檔還原</h3>
  <p class="field-hint">還原只會<strong>新增</strong>資料，不會刪掉現有內容；同名的學生帳號會跳過不覆蓋。建議順序：<strong>先還原題庫 → 再還原學生作業</strong>，這樣題號才對得上。歸檔不含密碼，還原後的學生需要新密碼。</p>
  <div class="restore-grid">
    <div class="restore-card"><strong>1 · 還原題庫歸檔</strong>
      <p class="field-hint">上傳題庫歸檔 <code>.json</code>。預設只補上缺少的題目（依標題比對）。</p>
      <label class="checkbox-line"><input type="checkbox" id="restore-replace">整批取代現有題庫（會保留原編號；題庫已被作答引用時會被擋下）</label>
      <input id="restore-questions-file" type="file" accept=".json,application/json">
      <button class="secondary" id="restore-questions-btn">${icon('upload')}還原題庫</button>
      <div class="restore-result" id="restore-questions-result"></div></div>
    <div class="restore-card"><strong>2 · 還原學生作業歸檔</strong>
      <p class="field-hint">上傳學生歸檔 <code>.jsonl</code>，會重建學生帳號、班級、作業、作答與手寫圖。</p>
      <div class="form-field"><label class="field-label" for="restore-password">還原後學生的初始密碼（留空＝每人自動產生）</label><input id="restore-password" type="password" minlength="10" maxlength="256" autocomplete="new-password" placeholder="至少 10 字"></div>
      <input id="restore-students-file" type="file" accept=".jsonl,.txt,application/x-ndjson">
      <button class="secondary" id="restore-students-btn">${icon('upload')}還原學生作業</button>
      <div class="restore-result" id="restore-students-result"></div></div>
    <div class="restore-card"><strong>3 · 還原完整資料庫備份</strong>
      <p class="field-hint">上傳 <code>.sqlite3</code> 備份，<strong>會取代整個資料庫</strong>（題庫＋學生＋作答＋圖片一次還原）。目前的資料庫會自動保留一份。</p>
      <input id="restore-db-file" type="file" accept=".sqlite3,.db,application/vnd.sqlite3,application/octet-stream">
      <button class="danger" id="restore-db-btn">${icon('upload')}取代並還原資料庫</button>
      <div class="restore-result" id="restore-db-result"></div></div>
  </div></div>`;
}
async function uploadFile(path,file){
  if(!file)throw new Error('請先選擇要上傳的檔案。');
  const response=await fetch(path,{method:'POST',body:file,credentials:'same-origin',
    headers:{'Content-Type':'application/octet-stream'}});
  const text=await response.text();
  let data=null;try{data=JSON.parse(text);}catch(e){data=null;}
  if(!response.ok)throw new Error((data&&data.error)||`上傳失敗（HTTP ${response.status}）`);
  return data||{};
}
function countList(obj){if(!obj)return '';return Object.entries(obj).filter(([,v])=>v).map(([k,v])=>`${k} ${v}`).join(' · ');}
function dataAdminHtml(){
  if(S.user?.role!=='teacher')return '';
  // 備份、歸檔、還原與學年重置都會動到全校資料，只限管理員（最早建立的教師帳號）。
  if(!S.user.isOwner)return `<section class="panel panel-pad" style="margin-top:20px"><h2>${icon('file')}資料管理</h2>
  <p class="info-note">資料備份、歸檔、還原與學年重置都會影響<strong>全校</strong>的資料，只限<strong>管理員帳號</strong>（學校最早建立的那個教師帳號）使用。需要備份或匯出時，請找管理員協助。</p></section>`;
  return `<section class="panel panel-pad" style="margin-top:20px"><h2>${icon('file')}資料管理</h2>
  <p class="field-hint">題庫歸檔與學生作業歸檔是分開的：<strong>題庫跨學年保留</strong>，學生資料每學年重新設定。下載的檔案由你自行保存，伺服器不會留存。</p>
  <div class="metric-row" id="admin-stats">${adminStatsCards(ADMIN_STATS)}</div>
  <div class="admin-actions">
    <button class="secondary" data-admin-download="/api/admin/backup/db">${icon('file')}下載完整資料庫備份</button>
    <button class="secondary" data-admin-download="/api/admin/archive/questions">${icon('upload')}匯出題庫歸檔（JSON）</button>
    <button class="secondary" data-admin-download="/api/admin/archive/students">${icon('upload')}匯出學生作業歸檔（含手寫圖）</button>
    <button class="secondary" data-admin-download="/api/admin/archive/students?images=0">${icon('file')}只匯出文字成績紀錄</button>
    <button class="secondary" id="admin-refresh">${icon('undo')}重新整理用量</button>
    <button class="secondary" id="admin-vacuum">${icon('check')}壓實資料庫</button>
  </div>
  <p class="field-hint">「壓實資料庫」把刪除後留下的空間還給系統；資料量大時可能需要數十秒，期間請勿關閉頁面。</p>
  <div class="backup-zone" id="admin-backup-zone">${backupZoneHtml(ADMIN_STATS&&ADMIN_STATS.backup)}</div>
  ${restoreHtml()}
  <div class="danger-zone">
    <h3>${icon('trash')}學年重置（新學年開始前使用）</h3>
    <p>會清空：<strong>學生帳號、班級、作業、所有作答與手寫圖、模擬測驗、訂正紀錄</strong>。</p>
    <p>一律保留：<strong>題庫（<span id="admin-question-count">…</span> 題）、教師帳號、內建演示帳號、日曆提醒</strong>。</p>
    <p class="field-hint">執行前請先下載「學生作業歸檔」；刪除後無法還原。歸檔不含密碼，新學年的學生要重新匯入名單並發新密碼。</p>
    <div class="form-field" style="max-width:280px"><label class="field-label" for="reset-confirm">輸入 RESET 以確認</label><input id="reset-confirm" maxlength="20" placeholder="RESET" autocomplete="off"></div>
    <p class="error-text" id="reset-error"></p>
    <button class="danger" id="admin-reset">${icon('trash')}執行學年重置</button>
  </div></section>`;
}
// AI 呼叫的健康狀況：失敗率與平均耗時，讓管理員不必翻 Render Logs。
function aiHealthCard(m){
  if(!m)return '';
  const badge=m.aiFailures
    ? `<span class="badge paper-missing">失敗 ${m.aiFailures} 次（${m.aiFailureRate}%）</span>`
    : '<span class="badge paper-done">沒有失敗</span>';
  const last=m.lastAiError
    ? ` · 最後錯誤：${esc(m.lastAiError)}（${esc(String(m.lastAiErrorAt||'').replace('T',' ').slice(0,16))}）`
    : '';
  return `<div style="border-top:1px solid var(--border);margin-top:14px;padding-top:14px">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
      <strong style="font-size:calc(15px*var(--fs))">AI 呼叫</strong>${badge}</div>
    <p class="small-text" style="margin:0">共 ${m.aiCalls} 次 · 平均 ${m.aiAvgMs} ms${last}</p>
    <p class="small-text" style="margin:6px 0 0">從伺服器啟動起算，重啟歸零——用來看「現在是不是在壞」，不是帳單。</p></div>`;
}
async function loadAdminStats(notify){
  if(S.user?.role!=='teacher'||!S.user.isOwner)return;
  try{ADMIN_STATS=await api('/api/admin/storage');
    // 健康檢查是加分項：舊版伺服器沒有 metrics 時就只是不顯示那張卡。
    const health=await api('/api/health').catch(()=>null);
    const box=$('#admin-stats');if(box)box.innerHTML=adminStatsCards(ADMIN_STATS)+aiHealthCard(health&&health.metrics);
    const count=$('#admin-question-count');if(count)count.textContent=ADMIN_STATS.counts.questions;
    const zone=$('#admin-backup-zone');if(zone){zone.innerHTML=backupZoneHtml(ADMIN_STATS.backup);bindBackupZone();}
    if(notify)toast('已更新用量。');}
  catch(e){if(notify)toast(e.message);}
}
function bindDataAdmin(){
  // 非管理員看到的是提示區塊，底下沒有任何資料管理控制項可以綁。
  if(S.user?.role!=='teacher'||!S.user.isOwner)return;
  bindBackupZone();
  $$('[data-admin-download]').forEach(b=>b.onclick=()=>{const a=document.createElement('a');a.href=b.dataset.adminDownload;a.rel='noopener';document.body.appendChild(a);a.click();a.remove();toast('已開始下載，請查看瀏覽器的下載項目。');});
  if($('#admin-refresh'))$('#admin-refresh').onclick=()=>loadAdminStats(true);
  if($('#admin-vacuum'))$('#admin-vacuum').onclick=async()=>{const b=$('#admin-vacuum'),original=b.innerHTML;b.disabled=true;b.innerHTML=icon('clock')+'壓實中…';try{const r=await api('/api/admin/vacuum',{});toast(`已壓實：${formatBytes(r.beforeBytes)} → ${formatBytes(r.afterBytes)}，回收 ${formatBytes(r.savedBytes)}。`);await loadAdminStats();}catch(e){toast(e.message);}finally{b.disabled=false;b.innerHTML=original;}};
  if($('#admin-reset'))$('#admin-reset').onclick=async()=>{
    const typed=$('#reset-confirm').value.trim();
    if(typed.toUpperCase()!=='RESET'){$('#reset-error').textContent='請先輸入 RESET 才能執行學年重置。';return;}
    if(await askCancel('確定清空這一學年的學生帳號、班級、作業與所有作答嗎？題庫會保留，但刪除後無法還原。'))return;
    const b=$('#admin-reset');b.disabled=true;$('#reset-error').textContent='';
    try{const r=await api('/api/admin/reset/students',{confirm:typed});
      toast(`學年重置完成：刪除 ${r.removed.students} 個學生帳號、${r.removed.attempts} 筆作答；題庫 ${r.kept.questions} 題保留。`);
      $('#reset-confirm').value='';await refresh();settingsPage();}
    catch(e){$('#reset-error').textContent=e.message;b.disabled=false;}
  };
  const restoreQuestions=$('#restore-questions-btn');
  if(restoreQuestions)restoreQuestions.onclick=async()=>{
    const replace=$('#restore-replace').checked;
    if(replace&&await askCancel('整批取代會先清空現有題庫，再寫入歸檔內容。確定嗎？'))return;
    const box=$('#restore-questions-result');box.innerHTML='';
    const original=restoreQuestions.innerHTML;restoreQuestions.disabled=true;restoreQuestions.innerHTML=icon('clock')+'還原中…';
    try{const r=await uploadFile('/api/admin/restore/questions'+(replace?'?replace=1':''),$('#restore-questions-file').files[0]);
      box.innerHTML=`<div class="hint-box">題庫還原完成：新增 <strong>${r.inserted}</strong> 題、略過 ${r.skipped} 題（已存在），歸檔共 ${r.total} 題。${esc(r.notice)}</div>`;
      await loadAdminStats();}
    catch(e){box.innerHTML=`<div class="inline-error">${esc(e.message)}</div>`;}
    finally{restoreQuestions.disabled=false;restoreQuestions.innerHTML=original;}
  };
  const restoreStudents=$('#restore-students-btn');
  if(restoreStudents)restoreStudents.onclick=async()=>{
    const password=$('#restore-password').value;
    if(password&&password.length<10){$('#restore-students-result').innerHTML='<div class="inline-error">初始密碼至少 10 字。</div>';return;}
    if(await askCancel('將依歸檔重建學生帳號、班級、作業與作答（不會刪除現有資料）。確定嗎？'))return;
    const box=$('#restore-students-result');box.innerHTML='';
    const original=restoreStudents.innerHTML;restoreStudents.disabled=true;restoreStudents.innerHTML=icon('clock')+'還原中…';
    try{const path='/api/admin/restore/students'+(password?'?password='+encodeURIComponent(password):'');
      const r=await uploadFile(path,$('#restore-students-file').files[0]);
      const rows=(r.credentials||[]).map(c=>`${c.username}\t${c.seat||''}\t${c.password}`).join('\n');
      const header=r.usedSharedPassword?'學號\t班內號\t密碼（你設定的初始密碼）':'學號\t班內號\t自動產生的密碼';
      box.innerHTML=`<div class="hint-box">學生作業還原完成：${countList(r.written)}。${countList(r.skipped)?`略過：${countList(r.skipped)}。`:''}${r.unreadableImages?`有 ${r.unreadableImages} 張圖片無法讀取，已略過。`:''}${r.questionMapApplied?'題號已依題庫還原對照表換算。':''}</div>`
      +(rows?`<div class="import-warning">請把下面的密碼交給學生（只顯示這一次）。</div><pre class="code-block">${esc(header+'\n'+rows)}</pre><button class="secondary" id="restore-copy">${icon('file')}複製帳號密碼</button>`:'');
      const copy=$('#restore-copy');
      if(copy)copy.onclick=async()=>{try{await navigator.clipboard.writeText(header+'\n'+rows);toast('已複製，請妥善保管。');}catch(e){toast('無法自動複製，請手動選取。');}};
      await loadAdminStats();}
    catch(e){box.innerHTML=`<div class="inline-error">${esc(e.message)}</div>`;}
    finally{restoreStudents.disabled=false;restoreStudents.innerHTML=original;}
  };
  const restoreDb=$('#restore-db-btn');
  if(restoreDb)restoreDb.onclick=async()=>{
    if(await askCancel('這會用備份檔取代目前的整個資料庫（題庫、學生、作答、圖片全部換成備份內容）。目前的資料庫會自動保留一份。確定嗎？'))return;
    const box=$('#restore-db-result');box.innerHTML='';
    const original=restoreDb.innerHTML;restoreDb.disabled=true;restoreDb.innerHTML=icon('clock')+'還原中…';
    try{const r=await uploadFile('/api/admin/restore/db',$('#restore-db-file').files[0]);
      box.innerHTML=`<div class="hint-box">資料庫已還原：題庫 ${r.counts.questions} 題、作答 ${r.counts.attempts} 筆、帳號 ${r.counts.users} 個。<br>${esc(r.notice)}<br>畫面即將重新載入；若顯示未登入，請用原本的帳密登入。</div>`;
      setTimeout(()=>location.reload(),2600);}
    catch(e){box.innerHTML=`<div class="inline-error">${esc(e.message)}</div>`;restoreDb.disabled=false;restoreDb.innerHTML=original;}
  };
  loadAdminStats();
}
function settingsPage(){page='settings';shell();$('#main').innerHTML=`<div class="fade-in">${heading('SETTINGS','設定與隱私','調整字體大小與版面配色；兩者都只影響這台裝置，隨時可切回。')}<section class="panel settings-panel display-panel"><h2>${icon('settings')}顯示設定</h2><div class="display-grid"><div class="display-item">${fontScaleControl()}</div><div class="display-item">${themeControl()}</div></div></section><div class="settings-layout"><section class="panel settings-panel"><h2>${icon('lock')}AI 批閱服務</h2><div class="settings-status"><strong><i class="status-dot"></i>${S.ai.configured?`已配置${S.ai.mode==='local'?'本地':'外部'}模型`:'尚未接入 AI 服務'}</strong><p>${S.ai.configured?'可用於拆題、生成相似或進階題、作答建議評分。模型：'+esc(S.ai.model):'現有題庫、規則拆題、手寫保存、教師批閱仍可使用。未接入時，不會生成假的 AI 成績或評語。'}</p></div>${S.user?.role==='teacher'?`<button class="secondary wide" id="ai-config-link" style="font-size:calc(14px*var(--fs));margin-bottom:8px">${icon('ai')}前往模型端點設定</button><button class="text-button" id="ai-quality" style="font-size:calc(14px*var(--fs));margin-bottom:16px">查看 AI 批改品質 ${icon('arrow')}</button>`:''}<details class="settings-details"><summary>管理員配置（環境變數，部署參考）</summary><p class="info-note">由伺服器環境變數設定相容的 AI 介面，密鑰不會保存於瀏覽器。建議優先使用校內本地視覺模型。</p><pre class="code-block">MATH_AI_BASE_URL=http://127.0.0.1:11434/v1
MATH_AI_MODEL=你的文字模型名稱
MATH_AI_VISION_MODEL=你的視覺模型名稱
MATH_AI_DRAW_MODEL=你的繪圖模型名稱（選用，留空沿用文字模型）
MATH_AI_API_KEY=伺服器端密鑰（若需要）</pre><p class="info-note">上述是配置格式示例，並非已安裝的模型。設定後需重新啟動伺服器；真實模型須由學校部署並測試。</p></details><div class="import-warning">作業的 AI 評分只是建議，不應直接決定正式考試成績；無法辨認的手寫、複雜證明及特殊解法，必須交由教師覆核。自主練習與自助模擬測驗由 AI 即時評分並記錄分數，不需教師批閱，分數只作個人練習紀錄。</div></section><div><section class="panel settings-panel"><h2>資料保護</h2><details class="settings-details"><summary>我們如何保護資料</summary><ul><li>資料保存在網站伺服器；實際位置由管理員確認。</li><li>學生僅可讀取自己的作答；教師可查看及批閱。</li><li>手寫圖片受登入與角色權限保護。</li><li>外部 AI 作答與試卷傳送需逐次明確同意。</li><li>收藏只保存於本瀏覽器，不跨裝置同步。</li><li>正式部署需 HTTPS、存取限制與獨立學生帳戶。</li></ul></details>${S.user?.role==='teacher'?`<button class="secondary wide" id="manage-teachers" style="font-size:calc(14px*var(--fs));margin-bottom:8px">${icon('edit')}教師帳號</button><button class="secondary wide" id="manage-students" style="font-size:calc(14px*var(--fs));margin-bottom:8px">${icon('list')}學生帳號</button><button class="secondary wide" id="login-log" style="font-size:calc(14px*var(--fs));margin-bottom:14px">${icon('clock')}登入紀錄</button>`:''}${S.user?.role==='teacher'?`<button class="text-button" id="deployment-help" style="font-size:calc(14px*var(--fs))">查看啟動與內網使用方式 ${icon('arrow')}</button>`:''}</section><section class="panel settings-panel" style="margin-top:20px"><h2>帳戶密碼</h2>${S.user?`<form id="password-form"><div class="form-field"><label class="field-label" for="old-password">目前密碼</label><input id="old-password" type="password" autocomplete="current-password" required maxlength="256"></div><div class="form-field"><label class="field-label" for="new-password">新密碼（至少10字）</label><input id="new-password" type="password" autocomplete="new-password" minlength="10" maxlength="256" required></div><p class="error-text" id="password-error"></p><button class="secondary" type="submit">更新密碼 ${icon('lock')}</button></form>`:`<p class="info-note">登入後可更換演示帳戶密碼。</p><button class="secondary" data-action="login">登入帳戶</button>`}</section></div></div>${dataAdminHtml()}</div>`;if($('#deployment-help'))$('#deployment-help').onclick=deploymentHelp;if($('#ai-config-link'))$('#ai-config-link').onclick=()=>navigate('ai');if($('#manage-teachers'))$('#manage-teachers').onclick=()=>manageUsers('teacher');
if($('#manage-students'))$('#manage-students').onclick=()=>manageUsers('student');
if($('#manage-users'))$('#manage-users').onclick=manageUsers;
if($('#login-log'))$('#login-log').onclick=loginLogModal;
if($('#ai-quality'))$('#ai-quality').onclick=aiQualityModal;bindDataAdmin();if($('#password-form'))$('#password-form').onsubmit=async e=>{e.preventDefault();const btn=$('[type="submit"]',e.target);btn.disabled=true;try{const r=await api('/api/change-password',{oldPassword:$('#old-password').value,newPassword:$('#new-password').value});await refresh();settingsPage();toast(r.notice);}catch(err){$('#password-error').textContent=err.message;btn.disabled=false;}};}
