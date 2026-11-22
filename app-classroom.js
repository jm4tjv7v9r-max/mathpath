'use strict';
// ── 課堂應用（分組教學）────────────────────────────────────────────
// 所有課堂功能都只在「課堂應用」之下：分組 → 任務 → 開始（教師確認）→ 進行 → 紀錄。
let crTimerId = null;
let crStudentTimer = null;
// 離線時先把「加分／標記」排隊，網路回來再依序補送（只排隊，不改伺服器邏輯）
const CR_OUTBOX = 'crOutbox';
function crIsOffline(e) {
  return /無法連接|Failed to fetch|NetworkError|Load failed|network/i.test(String((e && e.message) || e));
}
function crOutbox() {
  try { return JSON.parse(localStorage.getItem(CR_OUTBOX) || '[]'); } catch (e) { return []; }
}
function crOutboxSave(list) {
  try { localStorage.setItem(CR_OUTBOX, JSON.stringify(list)); } catch (e) {}
}
function crEnqueue(url, body) {
  const list = crOutbox();
  list.push({ url, body, at: Date.now() });
  crOutboxSave(list);
}
async function crFlushOutbox() {
  const list = crOutbox();
  let done = 0;
  while (list.length) {
    const op = list[0];
    try { await api(op.url, op.body); list.shift(); done += 1; }
    catch (e) {
      if (crIsOffline(e)) break;   // 還是離線：留著下次再送
      list.shift();                // 其他錯誤（例如課已結束）就丟掉，免得卡住整條佇列
    }
  }
  crOutboxSave(list);
  return done;
}
// 手寫照片縮到 900px、JPEG 0.7（課堂提交用；伺服器上限 400KB）
function crShrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const ratio = Math.min(1, 900 / (img.width || 900));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round((img.width || 900) * ratio);
      canvas.height = Math.round((img.height || 600) * ratio);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('讀取圖片失敗')); };
    img.src = url;
  });
}
// 常見的課堂流程：一鍵把任務排好，不用每次重打
const CR_TEMPLATES = [
  { id: 'flow', name: '小測 → 討論 → 發表 → 互評', tasks: [
    { title: '個人小測', text: '先各自完成黑板上的題目，不討論。', minutes: 5 },
    { title: '小組討論', text: '比較組員的答案：找出不同解法，以及大家都犯的錯。', minutes: 8 },
    { title: '小組發表', text: '派一位組員說明你們的解法（每組 1 分鐘）。', minutes: 6 },
    { title: '組間互評', text: '用三個面向評分：解法正確、表達清楚、合作參與。', minutes: 4 },
  ] },
  { id: 'race', name: '解題競賽', tasks: [
    { title: '第一輪', text: '各組同時解題；最快完成而且正確的組加分。', minutes: 6 },
    { title: '第二輪', text: '換一題較難的：組內先討論兩分鐘，再派代表寫答案。', minutes: 8 },
  ] },
  { id: 'jigsaw', name: '拼圖法（各組不同題）', tasks: [
    { title: '專家組', text: '每組負責一題，先把這一題的解法完全弄懂。', minutes: 8 },
    { title: '回原組教學', text: '每人把自己那一題教給同組其他成員。', minutes: 10 },
  ] },
];
function crFmt(sec) {
  const m = Math.floor(Math.max(0, sec) / 60), s = Math.max(0, sec) % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

async function classroomPage() {
  if (S.user?.role !== 'teacher') return classroomStudentPage();
  page = 'classroom'; shell();
  if (crTimerId) { clearInterval(crTimerId); crTimerId = null; }
  const classes = await api('/api/score-grid/classes').catch(() => ({ classes: [] }));
  const list = classes.classes || [];
  const cid = Number(sessionStorage.getItem('crClass') || 0) || (list[0] ? list[0].id : null);
  const state = { cid, groups: [], tasks: [], className: '' };

  $('#main').innerHTML = `<div class="fade-in">
    ${heading('CLASSROOM', '課堂應用', '分組、任務、計時、計分。所有操作都先在這裡準備，按「開始課堂」才正式開始。')}
    <section class="panel panel-pad">
      <div class="form-grid">
        <div class="form-field"><label class="field-label" for="cr-class">班別</label>
          <select id="cr-class">${list.map(c => `<option value="${c.id}"${c.id === cid ? ' selected' : ''}>${esc(c.name || '')}</option>`).join('')}</select></div>
        <div class="form-field"><label class="field-label" for="cr-size">每組人數</label>
          <input id="cr-size" type="number" min="2" max="8" value="4"></div>
        <div class="form-field"><label class="field-label" for="cr-mode">分組方式</label>
          <select id="cr-mode"><option value="random">隨機分組</option><option value="mixed">依最近成績異質分組</option></select></div>
        <div class="form-field"><label class="field-label" for="cr-title">課堂名稱</label>
          <input id="cr-title" maxlength="120" placeholder="例如：二次函數小組探究"></div>
      </div>
      <div class="cr-toolbar">
        <button class="secondary" id="cr-make">產生分組</button>
        <button class="secondary" id="cr-again" hidden>重新分組</button>
        <span class="small-text" id="cr-hint">選好班別與人數，先產生分組。</span>
      </div>
      <div id="cr-groups" class="cr-groups"></div>

      <div class="cr-tasks-head"><strong>課堂任務</strong>
        <span style="display:flex;gap:8px">
          <button class="secondary" id="cr-frombank">從題庫加入</button>
          <button class="secondary" id="cr-addtask">＋ 新增任務</button>
        </span></div>
      <div class="cr-tpls" id="cr-tpls">${CR_TEMPLATES.map(t =>
        `<button type="button" class="cr-tpl" data-tpl="${t.id}">${esc(t.name)}</button>`).join('')}</div>
      <div id="cr-tasks" class="cr-tasks"></div>

      <div class="cr-startbar">
        <span class="small-text">按「開始課堂」才會正式開始（會先請你確認）。開始後可以投影、計時、抽組、計分。</span>
        <button class="primary" id="cr-start">開始課堂</button>
      </div>
    </section></div>`;

  const renderGroups = () => {
    const box = $('#cr-groups');
    if (!state.groups.length) { box.innerHTML = ''; return; }
    box.innerHTML = state.groups.map((g, gi) => `<div class="cr-group" data-g="${gi}">
      <div class="cr-group-head">
        <input class="cr-gname" data-g="${gi}" value="${esc(g.name || '')}" maxlength="20" aria-label="組名">
        <span class="small-text">${g.members.length} 人</span>
      </div>
      <div class="cr-members">${g.members.map((m, mi) => `<button type="button" class="cr-chip${g.leader === m.id ? ' leader' : ''}" data-g="${gi}" data-m="${mi}" title="點一下設為組長">${esc(m.name || '')}${m.seat ? ` · ${esc(String(m.seat))}` : ''}</button>`).join('')}</div>
    </div>`).join('');
    $$('.cr-gname').forEach(inp => inp.onchange = () => {
      state.groups[Number(inp.dataset.g)].name = inp.value.trim().slice(0, 20) || `第 ${Number(inp.dataset.g) + 1} 組`;
    });
    $$('.cr-chip').forEach(b => b.onclick = () => {
      const g = state.groups[Number(b.dataset.g)];
      const m = g.members[Number(b.dataset.m)];
      g.leader = g.leader === m.id ? null : m.id;
      renderGroups();
    });
  };

  const renderTasks = () => {
    const box = $('#cr-tasks');
    box.innerHTML = state.tasks.map((t, i) => `<div class="cr-task" data-t="${i}">
      <div class="cr-task-head">
        <input class="cr-ttitle" data-t="${i}" value="${esc(t.title || '')}" maxlength="60" aria-label="任務名稱">
        <label class="small-text">限時 <input class="cr-tmin" data-t="${i}" type="number" min="1" max="120" value="${Number(t.minutes) || 8}"> 分鐘</label>
        <button class="text-button cr-tdel" data-t="${i}">刪除</button>
      </div>
      <textarea class="cr-ttext" data-t="${i}" rows="3" placeholder="題目或任務說明…">${esc(t.text || '')}</textarea>
    </div>`).join('') || `<p class="small-text">還沒有任務；可以先「新增任務」或「從題庫加入」。</p>`;
    $$('.cr-ttitle').forEach(i => i.onchange = () => { state.tasks[Number(i.dataset.t)].title = i.value.trim(); });
    $$('.cr-ttext').forEach(i => i.oninput = () => { state.tasks[Number(i.dataset.t)].text = i.value; });
    $$('.cr-tmin').forEach(i => i.onchange = () => { state.tasks[Number(i.dataset.t)].minutes = Math.max(1, Math.min(120, Number(i.value) || 8)); });
    $$('.cr-tdel').forEach(b => b.onclick = () => { state.tasks.splice(Number(b.dataset.t), 1); renderTasks(); });
  };

  const makeGroups = async () => {
    if (!state.cid) return toast('請先選擇班別。');
    try {
      const out = await api('/api/classroom/groups',
        { classId: state.cid, size: Number($('#cr-size').value) || 4, mode: $('#cr-mode').value });
      state.groups = out.groups || [];
      state.className = out.className || '';
      $('#cr-again').hidden = false;
      $('#cr-hint').textContent = `${state.className}：分成 ${state.groups.length} 組。點成員可設為組長。`;
      renderGroups();
    } catch (e) { toast(e.message); }
  };

  $('#cr-class').onchange = ev => {
    state.cid = Number(ev.target.value) || null;
    sessionStorage.setItem('crClass', String(state.cid || ''));
    state.groups = []; $('#cr-groups').innerHTML = ''; $('#cr-again').hidden = true;
    $('#cr-hint').textContent = '班別已切換，請重新產生分組。';
  };
  $('#cr-make').onclick = makeGroups;
  $('#cr-again').onclick = makeGroups;
  $$('[data-tpl]').forEach(b => b.onclick = async () => {
    const tpl = CR_TEMPLATES.find(t => t.id === b.dataset.tpl);
    if (!tpl) return;
    if (state.tasks.length && !(await askConfirm(
      `套用「${tpl.name}」會取代目前 ${state.tasks.length} 個任務，確定嗎？`,
      { title: '套用課堂流程', confirmText: '套用' }))) return;
    state.tasks = tpl.tasks.map((t, i) => ({ id: i + 1, ...t }));
    renderTasks();
    toast(`已套用「${tpl.name}」`);
  });
  $('#cr-addtask').onclick = () => {
    state.tasks.push({ id: state.tasks.length + 1, title: `任務 ${state.tasks.length + 1}`, text: '', minutes: 8 });
    renderTasks();
  };
  $('#cr-frombank').onclick = () => {
    if (!S.questions?.length) return toast('題庫還沒有題目。');
    modal(`<p class="eyebrow">FROM BANK</p><h2>從題庫加入任務</h2>
      <input id="cr-q" placeholder="搜尋題目或知識點…" style="width:100%;margin:6px 0 10px">
      <div id="cr-qlist" class="cr-qlist"></div>`);
    const draw = () => {
      const kw = ($('#cr-q').value || '').trim();
      const items = S.questions.filter(q => !kw || (q.content || '').includes(kw) || (q.topic || '').includes(kw)).slice(0, 20);
      $('#cr-qlist').innerHTML = items.map(q => `<button type="button" class="cr-qitem" data-q="${q.id}">
        <span class="cr-qtag">${esc(q.topic || '')}</span>${esc(String(q.content || '').slice(0, 60))}</button>`).join('') || '<p class="small-text">沒有符合的題目。</p>';
      $$('.cr-qitem').forEach(b => b.onclick = () => {
        const q = S.questions.find(x => x.id === Number(b.dataset.q));
        if (!q) return;
        state.tasks.push({ id: state.tasks.length + 1, title: q.topic || '題目', text: String(q.content || ''), minutes: 8 });
        renderTasks(); closeModal(); toast('已加入任務');
      });
    };
    $('#cr-q').oninput = draw;
    draw();
  };
  $('#cr-start').onclick = async () => {
    if (!state.cid) return toast('請先選擇班別。');
    if (!state.groups.length) return toast('請先產生分組。');
    if (!state.tasks.length) return toast('至少加一個課堂任務。');
    const ok = await askConfirm(
      `即將開始「${($('#cr-title').value || '未命名課堂').trim()}」：${state.className || ''}、${state.groups.length} 組、${state.tasks.length} 個任務。\n\n開始後才會進入課堂畫面（投影、計時、計分）。`,
      { title: '開始課堂？', confirmText: '開始課堂' });
    if (!ok) return;
    try {
      const out = await api('/api/classroom/sessions', {
        classId: state.cid, title: ($('#cr-title').value || '').trim(),
        groups: state.groups, tasks: state.tasks,
      });
      const { session } = await api('/api/classroom/sessions/' + out.sessionId);
      crLive(session);
    } catch (e) { toast(e.message); }
  };

  renderTasks();
}

// 課堂進行中：全螢幕投影畫面（題目、計時、計分板、抽組）
function crLive(session) {
  if (document.getElementById('cr-live')) document.getElementById('cr-live').remove();
  const st = { session, idx: 0, left: 0, running: false, drawn: null };
  const box = document.createElement('div');
  box.id = 'cr-live';
  box.className = 'cr-live';
  document.body.appendChild(box);
  document.body.classList.add('cr-live-on');

  const task = () => st.session.tasks[st.idx] || { title: '課堂', text: '', minutes: 0 };
  // 投影字級與淺／深色：記在這台裝置，下一堂課沿用
  st.scale = Math.min(1.6, Math.max(0.8, Number(localStorage.getItem('crScale')) || 1));
  box.style.setProperty('--fs', st.scale.toFixed(2));
  const setScale = v => {
    st.scale = Math.min(1.6, Math.max(0.8, Math.round(v * 10) / 10));
    box.style.setProperty('--fs', st.scale.toFixed(2));
    try { localStorage.setItem('crScale', st.scale.toFixed(2)); } catch (e) {}
  };
  const setLight = on => {
    box.classList.toggle('cr-light', !!on);
    const b = $('#cr-theme');
    if (b) b.textContent = on ? '深色' : '淺色';
    try { localStorage.setItem('crLight', on ? '1' : '0'); } catch (e) {}
  };
  if (localStorage.getItem('crLight') === '1') box.classList.add('cr-light');
  const groupName = gid => ((st.session.groups || []).find(g => String(g.id) === String(gid)) || {}).name || '';
  // 互評平均：每筆先取三個面向平均；三筆以上去掉最高最低（避免人情分）
  const reviewAvg = gid => {
    const vals = (st.session.reviews || []).filter(r => String(r.to) === String(gid))
      .map(r => (Number(r.correct) + Number(r.express) + Number(r.coop)) / 3);
    if (!vals.length) return null;
    const use = vals.length >= 3 ? vals.slice().sort((a, b) => a - b).slice(1, -1) : vals;
    return use.reduce((a, b) => a + b, 0) / use.length;
  };
  // 手寫照片先縮到 900px、JPEG 0.7，避免把整堂課的紀錄撐大
  const shrink = file => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const ratio = Math.min(1, 900 / (img.width || 900));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round((img.width || 900) * ratio);
      canvas.height = Math.round((img.height || 600) * ratio);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('讀取圖片失敗')); };
    img.src = url;
  });
  const resetTimer = () => {
    if (crTimerId) { clearInterval(crTimerId); crTimerId = null; }
    st.running = false;
    st.left = (Number(task().minutes) || 0) * 60;
  };

  const render = () => {
    const s = st.session, g = s.groups || [], scores = s.scores || {}, stat = s.statuses || {};
    box.innerHTML = `<div class="cr-live-inner">
      <header class="cr-live-head">
        <div><p class="eyebrow">CLASSROOM</p><h2>${esc(s.title || '課堂')}</h2>
          <p class="cr-code">課堂碼 <strong>${esc(s.code || '—')}</strong></p>
          ${crOutbox().length ? `<p class="cr-net">離線 · ${crOutbox().length} 筆待同步</p>` : ''}</div>
        <div class="cr-clock" id="cr-clock">${crFmt(st.left)}</div>
        <div class="cr-live-btns">
          <button class="secondary" id="cr-fs-minus" title="字小一點">A−</button>
          <button class="secondary" id="cr-fs-plus" title="字大一點">A＋</button>
          <button class="secondary" id="cr-theme">${box.classList.contains('cr-light') ? '深色' : '淺色'}</button>
          <button class="secondary" id="cr-full">全屏</button>
          <button class="secondary" id="cr-tstart">${st.running ? '暫停' : '開始計時'}</button>
          <button class="secondary" id="cr-draw">抽一組</button>
          <button class="secondary" id="cr-undo">復原</button>
          <button class="secondary" id="cr-apply">互評併入總分</button>
          <button class="danger" id="cr-end">結束課堂</button>
        </div>
      </header>
      <main class="cr-live-main">
        <section class="cr-stage">
          <div class="cr-tasknav">
            <button class="text-button" id="cr-prev">← 上一題</button>
            <span class="small-text">任務 ${st.idx + 1} / ${(s.tasks || []).length || 1}</span>
            <button class="text-button" id="cr-next">下一題 →</button>
          </div>
          <h1 class="cr-stage-title">${esc(task().title || '')}</h1>
          <div class="cr-stage-text">${esc(task().text || '（尚未填寫題目）')}</div>
        </section>
        <aside class="cr-board">
          <div class="cr-drawbox" id="cr-drawbox">${st.drawn ? `<span>抽到</span><strong>${esc(st.drawn)}</strong>` : '<span>按「抽一組」</span>'}</div>
          <div class="cr-rows">${g.map(x => {
            const gid = String(x.id), sc = scores[gid] || 0, sg = stat[gid] || {};
            return `<div class="cr-row" data-gid="${gid}">
              <span class="cr-row-name">${esc(x.name || '')}</span>
              <span class="cr-row-score">${sc}</span>
              <span class="cr-row-flags">${sg.submitted ? '已交' : ''}${sg.help ? ' 求助' : ''}${reviewAvg(x.id) !== null ? ` · 互評 ${reviewAvg(x.id).toFixed(1)}` : ''}</span>
              <span class="cr-row-btns">
                <button data-delta="1" data-gid="${gid}">+1</button>
                <button data-delta="2" data-gid="${gid}">+2</button>
                <button data-delta="-1" data-gid="${gid}">-1</button>
                <button data-sub="${gid}">${sg.submitted ? '取消已交' : '標記已交'}</button>
                <button data-help="${gid}">${sg.help ? '取消求助' : '求助'}</button>
                <button data-submit="${gid}">${(st.session.submissions || {})[gid] ? '看／改提交' : '提交'}</button>
                <button data-review="${gid}">互評</button>
              </span></div>`;
          }).join('')}</div>
        </aside>
      </main>
    </div>`;
    bind();
  };

  const paintClock = () => {
    const el = $('#cr-clock');
    if (!el) return;
    el.textContent = crFmt(st.left);
    el.classList.toggle('warn', st.left <= 30);
    el.classList.toggle('done', st.left === 0);
  };

  const openSubmit = gid => {
    const cur = (st.session.submissions || {})[gid] || {};
    modal(`<p class="eyebrow">SUBMIT</p><h2>${esc(groupName(gid))} 提交</h2>
      <textarea id="cr-sub-text" rows="4" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 10px;line-height:1.7"
        placeholder="寫下這組的答案或結論…">${esc(cur.text || '')}</textarea>
      <div style="margin:10px 0 6px"><label class="small-text">手寫照片（可選）
        <input id="cr-sub-file" type="file" accept="image/*" style="margin-left:6px"></label></div>
      <div id="cr-sub-prev">${cur.image ? `<img src="${cur.image}" alt="提交的照片">` : ''}</div>
      <div class="cr-modal-actions">
        <button class="text-button" id="cr-sub-cancel">取消</button>
        <button class="primary" id="cr-sub-ok">儲存</button></div>`);
    let image = cur.image || '';
    $('#cr-sub-cancel').onclick = () => closeModal();
    $('#cr-sub-file').onchange = async ev => {
      const file = ev.target.files[0];
      if (!file) return;
      try { image = await shrink(file); $('#cr-sub-prev').innerHTML = `<img src="${image}" alt="提交的照片">`; }
      catch (e) { toast(e.message); }
    };
    $('#cr-sub-ok').onclick = async () => {
      try {
        const { session } = await api(`/api/classroom/sessions/${st.session.id}/submit`,
          { groupId: Number(gid), text: $('#cr-sub-text').value, image });
        st.session = session; closeModal(); render(); toast('已記錄這組的提交');
      } catch (e) { toast(e.message); }
    };
  };

  const openReview = to => {
    const groups = st.session.groups || [];
    if (groups.length < 2) return toast('至少要兩組才能互評。');
    const from = String(groups.find(g => String(g.id) !== String(to)).id);
    const marks = { correct: 3, express: 3, coop: 3 };
    const row = (key, label) => `<div class="cr-mark" data-k="${key}">
      <span>${label}</span>
      ${[1, 2, 3, 4, 5].map(n => `<button type="button" data-k="${key}" data-n="${n}"${n === marks[key] ? ' class="on"' : ''}>${n}</button>`).join('')}
    </div>`;
    const paint = () => {
      modal(`<p class="eyebrow">PEER REVIEW</p><h2>互評：${esc(groupName(to))}</h2>
        <p class="small-text">由哪一組評？</p>
        <select id="cr-rv-from" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px">
          ${groups.filter(g => String(g.id) !== String(to)).map(g => `<option value="${g.id}"${String(g.id) === from ? ' selected' : ''}>${esc(g.name || '')}</option>`).join('')}
        </select>
        <div class="cr-marks">${row('correct', '解法正確')}${row('express', '表達清楚')}${row('coop', '合作參與')}</div>
        <div class="cr-modal-actions">
          <button class="text-button" id="cr-rv-cancel">取消</button>
          <button class="primary" id="cr-rv-ok">儲存</button></div>`);
      $('#cr-rv-from').onchange = ev => { fromSel = String(ev.target.value); };
      $$('.cr-mark button').forEach(b => b.onclick = () => {
        marks[b.dataset.k] = Number(b.dataset.n);
        $$(`.cr-mark[data-k="${b.dataset.k}"] button`).forEach(x => x.classList.toggle('on', x === b));
      });
      $('#cr-rv-cancel').onclick = () => closeModal();
      $('#cr-rv-ok').onclick = async () => {
        try {
          const { session } = await api(`/api/classroom/sessions/${st.session.id}/review`,
            { from: Number($('#cr-rv-from').value), to: Number(to), ...marks });
          st.session = session; closeModal(); render(); toast('已記錄互評');
        } catch (e) { toast(e.message); }
      };
    };
    let fromSel = from;
    paint();
  };

  const bind = () => {
    $('#cr-fs-minus').onclick = () => setScale((st.scale || 1) - 0.1);
    $('#cr-fs-plus').onclick = () => setScale((st.scale || 1) + 0.1);
    $('#cr-theme').onclick = () => setLight(!box.classList.contains('cr-light'));
    $('#cr-full').onclick = () => {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.();
    };
    $('#cr-tstart').onclick = () => {
      if (st.running) {
        clearInterval(crTimerId); crTimerId = null; st.running = false;
        $('#cr-tstart').textContent = '繼續計時';
        return;
      }
      if (st.left <= 0) st.left = (Number(task().minutes) || 0) * 60;
      st.running = true;
      $('#cr-tstart').textContent = '暫停';
      crTimerId = setInterval(() => {
        st.left -= 1;
        paintClock();
        if (st.left <= 0) {
          clearInterval(crTimerId); crTimerId = null; st.running = false;
          const b = $('#cr-tstart'); if (b) b.textContent = '時間到';
          toast('時間到');
        }
      }, 1000);
    };
    const syncTask = () => api(`/api/classroom/sessions/${st.session.id}/update`,
      { currentTask: st.idx }).catch(() => {});
    $('#cr-prev').onclick = () => { if (st.idx > 0) { st.idx -= 1; resetTimer(); render(); syncTask(); } };
    $('#cr-next').onclick = () => {
      if (st.idx < (st.session.tasks || []).length - 1) { st.idx += 1; resetTimer(); render(); syncTask(); }
    };
    $('#cr-draw').onclick = () => {
      const pool = (st.session.groups || []).map(g => g.name).filter(n => n !== st.drawn);
      const pick = (pool.length ? pool : (st.session.groups || []).map(g => g.name))[Math.floor(Math.random() * (pool.length || st.session.groups.length))];
      st.drawn = pick;
      const el = $('#cr-drawbox');
      if (el) el.innerHTML = `<span>抽到</span><strong class="cr-pop">${esc(pick || '')}</strong>`;
    };
    $$('[data-delta]').forEach(b => b.onclick = () => crScore(Number(b.dataset.delta), b.dataset.gid));
    $$('[data-sub]').forEach(b => b.onclick = () => {
      const gid = b.dataset.sub, cur = (st.session.statuses[gid] || {}).submitted;
      crStatus(gid, { submitted: !cur });
    });
    $$('[data-help]').forEach(b => b.onclick = () => {
      const gid = b.dataset.help, cur = (st.session.statuses[gid] || {}).help;
      crStatus(gid, { help: !cur });
    });
    $$('[data-submit]').forEach(b => b.onclick = () => openSubmit(b.dataset.submit));
    $$('[data-review]').forEach(b => b.onclick = () => openReview(b.dataset.review));
    $('#cr-apply').onclick = async () => {
      if (!(st.session.reviews || []).length) return toast('還沒有任何互評。');
      const ok = await askConfirm('把各組互評平均加進總分？每堂課只能併入一次。', { title: '互評併入總分' });
      if (!ok) return;
      try {
        const { session } = await api(`/api/classroom/sessions/${st.session.id}/apply-reviews`, {});
        st.session = session; render(); toast('已併入互評分');
      } catch (e) { toast(e.message); }
    };
    $('#cr-undo').onclick = async () => {
      try { const { session } = await api(`/api/classroom/sessions/${st.session.id}/undo`, {}); st.session = session; render(); }
      catch (e) {
        if (!crIsOffline(e)) return toast(e.message);
        // 離線復原：只退得掉「還在佇列裡」的那一筆
        const list = crOutbox();
        const last = list[list.length - 1];
        if (!last || last.body.delta === undefined) return toast('離線時只能復原剛才加的分数。');
        list.pop();
        crOutboxSave(list);
        const gid = String(last.body.groupId);
        st.session.scores[gid] = (st.session.scores[gid] || 0) - last.body.delta;
        st.session.log.pop();
        render(); toast('已復原（離線）');
      }
    };
    $('#cr-end').onclick = async () => {
      const ok = await askConfirm('結束這堂課？結束後不能再加分，紀錄會保存在「課堂紀錄」。', { title: '結束課堂', confirmText: '結束' });
      if (!ok) return;
      try {
        await api(`/api/classroom/sessions/${st.session.id}/end`, {});
        closeLive();
        toast('課堂已結束，紀錄已保存');
        classroomRecordsPage();
      } catch (e) { toast(e.message); }
    };
  };

  const crScore = async (delta, gid) => {
    try {
      const { session } = await api(`/api/classroom/sessions/${st.session.id}/score`,
        { groupId: Number(gid), delta, text: delta > 0 ? '加分' : '扣分' });
      st.session = session; render();
    } catch (e) {
      if (!crIsOffline(e)) return toast(e.message);
      // 離線：先在本機加分，並排進佇列，等網路回來補送
      st.session.scores[gid] = (st.session.scores[gid] || 0) + delta;
      st.session.log.push({ at: Date.now() / 1000, groupId: String(gid), delta, text: '離線' });
      crEnqueue(`/api/classroom/sessions/${st.session.id}/score`,
        { groupId: Number(gid), delta, text: '離線加分' });
      render(); toast('離線中：已先記下，網路恢復會自動補送');
    }
  };
  const crStatus = async (gid, patch) => {
    try {
      const { session } = await api(`/api/classroom/sessions/${st.session.id}/status`,
        { groupId: Number(gid), ...patch });
      st.session = session; render();
    } catch (e) {
      if (!crIsOffline(e)) return toast(e.message);
      const cur = st.session.statuses[gid] || { submitted: false, help: false };
      st.session.statuses[gid] = { ...cur, ...patch };
      crEnqueue(`/api/classroom/sessions/${st.session.id}/status`,
        { groupId: Number(gid), ...patch });
      render();
    }
  };

  const closeLive = () => {
    if (crTimerId) { clearInterval(crTimerId); crTimerId = null; }
    document.body.classList.remove('cr-live-on');
    box.remove();
  };
  document.addEventListener('keydown', function esc(ev) {
    if (!document.getElementById('cr-live')) { document.removeEventListener('keydown', esc); return; }
    if (ev.key === 'Escape') closeLive();
  });

  // 網路回來就補送離線期間的操作，然後重抓一次課堂狀態
  const syncOutbox = async () => {
    if (!crOutbox().length) return;
    const done = await crFlushOutbox();
    if (!done) return;
    try {
      const { session } = await api('/api/classroom/sessions/' + st.session.id);
      st.session = session;
    } catch (e) { /* 仍然離線就等下一次 */ }
    render();
    toast(`已補送 ${done} 筆離線操作`);
  };
  window.addEventListener('online', syncOutbox);
  const outboxTimer = setInterval(() => {
    if (!document.getElementById('cr-live')) { clearInterval(outboxTimer); window.removeEventListener('online', syncOutbox); return; }
    syncOutbox();
  }, 20000);
  syncOutbox();

  resetTimer();
  render();
  // 每 15 秒同步一次：學生提交後，計分板上的「已交」會自己更新
  const poll = setInterval(async () => {
    if (!document.getElementById('cr-live')) { clearInterval(poll); return; }
    try {
      const { session } = await api('/api/classroom/sessions/' + st.session.id);
      if (session.status === 'running') { st.session = session; render(); }
      else clearInterval(poll);
    } catch (e) { /* 網路不穩就跳過這次 */ }
  }, 15000);
}

async function classroomStudentPage() {
  if (!S.user) return loginModal(classroomStudentPage);
  if (S.user.role === 'teacher') return classroomPage();
  page = 'classroom'; shell();
  if (crStudentTimer) { clearInterval(crStudentTimer); crStudentTimer = null; }
  let saved = '';
  try { saved = localStorage.getItem('crJoinCode') || ''; } catch (e) {}
  $('#main').innerHTML = `<div class="fade-in">
    ${heading('CLASSROOM', '課堂', '輸入老師給的 6 位課堂碼加入；加入後看目前任務、交你們組的答案。')}
    <section class="panel panel-pad">
      <div class="cr-join">
        <input id="cr-code" inputmode="numeric" maxlength="6" placeholder="6 位課堂碼" value="${esc(saved)}">
        <button class="primary" id="cr-join-btn">加入課堂</button>
        <span class="small-text" id="cr-join-msg">${saved ? '' : '課堂碼由老師在投影畫面上顯示。'}</span>
      </div>
      <div id="cr-student"></div>
    </section></div>`;

  let current = null;
  const renderStudent = session => {
    current = session;
    const t = (session.tasks || [])[session.currentTask] || {};
    const sub = session.submission || null;
    const groups = session.groups || [];
    $('#cr-student').innerHTML = `
      <div class="cr-stu-head">
        <div><strong>${esc(session.title || '')}</strong>
          <span class="small-text">${esc(session.myGroup.name || '')} · ${esc((session.myGroup.members || []).join('、'))}</span></div>
        <span class="cr-stu-code">課堂碼 ${esc(session.code || '')}</span>
      </div>
      <div class="cr-stu-task">
        <p class="eyebrow">目前任務 ${session.currentTask + 1} / ${(session.tasks || []).length || 1}</p>
        <h2>${esc(t.title || '（老師還沒開始）')}</h2>
        <p class="cr-stu-text">${esc(t.text || '')}</p>
      </div>
      <div class="cr-stu-submit">
        <label class="field-label" for="cr-stu-text">你們組的答案</label>
        <textarea id="cr-stu-text" rows="4" placeholder="寫下討論結果或解題過程…">${esc((sub && sub.text) || '')}</textarea>
        <div class="cr-stu-actions">
          <label class="small-text">手寫照片（可選）<input id="cr-stu-file" type="file" accept="image/*"></label>
          <span class="small-text" id="cr-stu-status">${sub ? '已提交（可修改）' : '尚未提交'}</span>
          <button class="primary" id="cr-stu-ok">${sub ? '更新提交' : '提交'}</button>
        </div>
        <div id="cr-stu-prev">${sub && sub.image ? `<img src="${sub.image}" alt="已提交的照片">` : ''}</div>
      </div>
      <p class="small-text" style="margin-top:10px">各組分數：${groups.map(g => `${esc(g.name)} ${g.score}`).join(' · ')}</p>`;
    let image = (sub && sub.image) || '';
    $('#cr-stu-file').onchange = async ev => {
      const file = ev.target.files[0];
      if (!file) return;
      try { image = await crShrink(file); $('#cr-stu-prev').innerHTML = `<img src="${image}" alt="待提交的照片">`; }
      catch (e) { toast(e.message); }
    };
    $('#cr-stu-ok').onclick = async () => {
      const btn = $('#cr-stu-ok');
      btn.disabled = true; btn.textContent = '提交中…';
      try {
        const out = await api('/api/classroom/student/submit',
          { code: current.code, text: $('#cr-stu-text').value, image });
        renderStudent(out.session);
        toast('已提交，老師會看到你們組的答案');
      } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = sub ? '更新提交' : '提交'; }
    };
  };

  const join = async (code, silent) => {
    try {
      const out = await api('/api/classroom/join', { code });
      try { localStorage.setItem('crJoinCode', code); } catch (e) {}
      $('#cr-join-msg').textContent = '';
      renderStudent(out.session);
      return true;
    } catch (e) {
      if (!silent) toast(e.message);
      return false;
    }
  };

  $('#cr-join-btn').onclick = async () => {
    const code = ($('#cr-code').value || '').replace(/\D/g, '').slice(0, 6);
    if (code.length !== 6) return toast('請輸入 6 位數字的課堂碼。');
    if (await join(code)) {
      if (crStudentTimer) clearInterval(crStudentTimer);
      // 每 10 秒同步一次：老師換任務、或課堂結束時，學生端會跟著更新
      crStudentTimer = setInterval(async () => {
        if (page !== 'classroom' || !current) { clearInterval(crStudentTimer); crStudentTimer = null; return; }
        const ok = await join(current.code, true);
        if (!ok) { clearInterval(crStudentTimer); crStudentTimer = null; }
      }, 10000);
    }
  };
  $('#cr-code').onkeydown = ev => { if (ev.key === 'Enter') $('#cr-join-btn').click(); };
  if (saved) $('#cr-join-btn').click();
}

async function classroomRecordsPage() {
  if (S.user?.role !== 'teacher') return bank();
  page = 'classroomRecords'; shell();
  const out = await api('/api/classroom/sessions').catch(e => ({ error: e.message, sessions: [] }));
  if (out.error) { $('#main').innerHTML = `<div class="inline-error">${esc(out.error)}</div>`; return; }
  const rows = out.sessions || [];
  $('#main').innerHTML = `<div class="fade-in">
    ${heading('CLASSROOM LOG', '課堂紀錄', '每一堂課的分組、任務與各組得分；可查看詳情或刪除。')}
    <section class="panel panel-pad">
      <div class="cr-records">${rows.map(s => `<div class="cr-record" data-s="${s.id}">
        <div><strong>${esc(s.title || '未命名課堂')}</strong>
          <span class="small-text">${new Date((s.startedAt || 0) * 1000).toLocaleString()} · ${esc(s.className || '')} · ${s.groups} 組 · 合計 ${s.points} 分${s.status === 'running' ? ' · 進行中' : ''}</span></div>
        <div class="cr-record-btns">
          ${s.graded ? '<span class="small-text">已匯出成績</span>'
                     : (s.status === 'ended' ? `<button class="secondary" data-grade="${s.id}">匯出成績</button>` : '')}
          <button class="secondary" data-open="${s.id}">查看</button>
          <button class="text-button" data-del="${s.id}">刪除</button></div>
      </div>`).join('') || '<p class="small-text">還沒有課堂紀錄。</p>'}</div>
    </section></div>`;
  $$('[data-open]').forEach(b => b.onclick = async () => {
    try {
      const { session } = await api('/api/classroom/sessions/' + b.dataset.open);
      const scores = session.scores || {};
      modal(`<p class="eyebrow">CLASSROOM</p><h2>${esc(session.title || '')}</h2>
        <p class="small-text">${new Date((session.startedAt || 0) * 1000).toLocaleString()}${session.endedAt ? ' · 已結束' : ' · 進行中'}</p>
        <table class="bulk-result"><thead><tr><th>組別</th><th>成員</th><th>得分</th></tr></thead><tbody>
        ${(session.groups || []).map(g => `<tr><td>${esc(g.name || '')}</td>
          <td>${(g.members || []).map(m => esc(m.name || '')).join('、')}</td>
          <td>${scores[String(g.id)] || 0}</td></tr>`).join('')}</tbody></table>
        <p class="small-text" style="margin-top:10px">任務：${(session.tasks || []).map(t => esc(t.title || '')).join('、') || '—'}</p>`);
    } catch (e) { toast(e.message); }
  });
  // 匯出課堂成績：在成績總表新增一欄，組員各得該組分數（之後仍可手改）
  $$('[data-grade]').forEach(b => b.onclick = async () => {
    const ok = await askConfirm(
      '在成績總表新增一欄「課堂表現」，各組成員會得到自己所屬組別的分數。\n\n之後仍可在成績總表逐格修改。',
      { title: '匯出課堂成績', confirmText: '匯出' });
    if (!ok) return;
    try {
      const out = await api(`/api/classroom/sessions/${b.dataset.grade}/to-grade`, {});
      toast(`已寫入 ${out.students} 位學生（${out.title}）`);
      classroomRecordsPage();
    } catch (e) { toast(e.message); }
  });
  $$('[data-del]').forEach(b => b.onclick = async () => {
    if (!(await askConfirm('刪除這筆課堂紀錄？各組得分與任務內容會一併刪除。'))) return;
    try { await api('/api/classroom/sessions/' + b.dataset.del, {}, 'DELETE'); toast('已刪除'); classroomRecordsPage(); }
    catch (e) { toast(e.message); }
  });
}

async function paperBatchPage(){
  if(S.user?.role!=='teacher')return bank();
  page='paperbatch';shell();
  const classes=await api('/api/homework').then(d=>d.classes||[]).catch(()=>[]);
  $('#main').innerHTML=`<div class="fade-in">
    ${heading('BATCH GRADING','全班紙本批閱','一次上傳全部學生的卷（PDF，最多 80 頁）。AI 會切卷並認人，認不出來的由你指派。')}
    <section class="panel panel-pad" id="pb-drafts-panel" hidden>
      <h2 style="margin-bottom:6px">未完成的批閱</h2>
      <p class="small-text" style="margin:0 0 10px">切好的卷存在伺服器七天內；按「繼續」直接接下去批，不必重掃。</p>
      <div id="pb-drafts"></div>
    </section>
    <section class="panel panel-pad">
      <div class="form-grid">
        <div class="form-field"><label class="field-label" for="pb-class">班級</label>
          <select id="pb-class"><option value="">全部學生</option>
            ${classes.map(c=>`<option value="${c.id}">${esc(c.name||'')}</option>`).join('')}</select></div>
        <div class="form-field"><label class="field-label" for="pb-title">功課名稱</label>
          <input id="pb-title" maxlength="200" placeholder="例如：第三次功課"></div>
        <div class="form-field"><label class="field-label" for="pb-file">PDF（≤80 頁）</label>
          <input id="pb-file" type="file" accept="application/pdf"></div>
        <div class="form-field"><label class="field-label" for="pb-split">切卷方式</label>
          <select id="pb-split">
            <option value="auto">自動（AI 判斷卷頭）</option>
            <option value="1">每頁一份</option>
            <option value="2">每兩頁一份</option>
            <option value="3">每三頁一份</option>
            <option value="4">每四頁一份</option>
          </select></div>
        <div class="form-field"><label class="field-label" for="pb-rotate">掃描前旋轉</label>
          <select id="pb-rotate">
            <option value="auto">自動（AI 判斷方向）</option>
            <option value="0">不轉</option>
            <option value="90">順時針 90°</option>
            <option value="180">上下顛倒 180°</option>
            <option value="270">逆時針 90°</option>
          </select></div>
      </div>
      <p class="field-hint">切卷方式選「自動」時 AI 會找卷頭（標題、姓名、得分欄）；如果 AI 把整疊切成一份，改成「每頁一份」或「每兩頁一份」就一定正確。旋轉角度選固定值時會跳過 AI 判方向（省一半呼叫），之後仍可在配對表逐份微調。</p>
      <div style="margin-top:10px"><button class="primary" id="pb-go">開始掃描</button>
        <span class="small-text" id="pb-status"></span></div>

      <div class="pb-import">
        <div class="pb-import-head">
          <div><strong>全班學生名單</strong>
            <span class="small-text" id="pb-roster-info"></span></div>
          <button class="secondary" id="pb-import-toggle">＋ 匯入全班學生</button>
        </div>
        <div class="pb-import-box" id="pb-import-box" hidden>
          <p class="small-text" style="margin:0 0 8px">先選班級再匯入。一行一個學生（「座號 姓名」或只寫姓名），也可以直接上傳 Excel 名單；同班同名同座號會自動跳過。</p>
          <p class="small-text sg-mask-note">姓名存入時會遮蔽（陳大文 → 陳X文），全名不會保留、無法還原。</p>
          <textarea id="pb-bulk-text" rows="5" placeholder="1 陳大文&#10;2 李小明&#10;3,王美玲"></textarea>
          <div class="pb-import-actions">
            <span class="small-text">或用 Excel：<input type="file" id="pb-bulk-file" accept=".xlsx,.xlsm"></span>
            <span style="display:flex;gap:8px">
              <button class="secondary" id="pb-bulk-import">匯入 Excel</button>
              <button class="primary" id="pb-bulk-ok">匯入文字名單</button>
            </span>
          </div>
          <div id="pb-bulk-result"></div>
        </div>
      </div>

      <div id="pb-result"></div>
    </section></div>`;
  $('#pb-go').onclick=async()=>{
    const picked=$('#pb-file').files[0];
    if(!picked)return toast('請先選一份 PDF。');
    const btn=$('#pb-go');btn.disabled=true;$('#pb-status').textContent='準備中…';
    try{
      // 大檔先在瀏覽器壓縮（掃描檔一頁一張高解析圖，常超過代理層的請求上限）。
      const file=await maybeCompressPdf(picked,msg=>{$('#pb-status').textContent=msg;});
      $('#pb-status').textContent='掃描中，80 頁大約要 3–8 分鐘…';
      // 以原始二進位上傳（不 base64 膨脹），避免大掃描檔在代理層就被 413 擋下。
      const res=await apiJobRaw('/api/paper-grades/scan-raw',file,
        {classId:Number($('#pb-class').value)||null,title:($('#pb-title').value||'').trim(),
         split:$('#pb-split').value,rotate:$('#pb-rotate').value,
         consentExternal:S.ai?.mode==='external'},
        job=>{$('#pb-status').textContent=`掃描中… ${Math.round(job.elapsed||0)} 秒`;});
      renderBatch(res);
      // 只留 File 物件，不預先轉 base64：60 MB 的掃描檔轉成 dataURL 是 80 MB 字串，
      // 每次掃描都佔著不放會讓低配裝置／手機瀏覽器直接崩頁。真的有需要
      // （草稿沒存成功、要用 JSON 走 /api/paper-grades/batch）時才在批改前轉。
      lastScan={file,res,draftId:res.draftId||null};
      $('#pb-roster-info').textContent=(res.roster||[]).length?`（目前 ${res.roster.length} 人）`:'（還沒有學生）';
      $('#pb-status').textContent=`共 ${res.pages} 頁、切成 ${res.summary.papers} 份卷；認出 ${res.summary.matched} 份。`
        +(res.draftId?'（已存成草稿，可離開頁面稍後再批）':'')
        +((res.summary.papers===1&&res.pages>3&&$('#pb-split').value==='auto')
          ?'　⚠️ 只切成 1 份卷，AI 可能沒認出卷頭；請把「切卷方式」改成「每頁一份」或「每兩頁一份」再掃一次。':'')
        +((res.unreadPages||[]).length
          ?`　⚠️ 有 ${res.unreadPages.length} 頁讀不到姓名（第 ${res.unreadPages.slice(0,8).join('、')}${res.unreadPages.length>8?'…':''} 頁），請用右邊下拉指派。`
          :'');
      await loadDrafts();
    }catch(e){toast(e.message);$('#pb-status').textContent='';}
    btn.disabled=false;
  };
  let lastScan=null;

  // 未完成的批閱：清單＋續批。切卷結果存在伺服器，重新整理也不會消失。
  async function loadDrafts(){
    const panel=$('#pb-drafts-panel'),box=$('#pb-drafts');
    if(!panel||!box)return;
    let list=[];
    try{list=(await api('/api/paper-grades/drafts')).drafts||[];}catch(e){list=[];}
    panel.hidden=!list.length;
    if(!list.length){box.innerHTML='';return;}
    box.innerHTML=list.map(d=>{
      const done=d.gradedCount||0;
      const tag=d.status==='graded'
        ? `<span class="pb-badge done">已批 ${done}/${d.papers}</span>`
        : (done?`<span class="pb-badge doing">批到一半 ${done}/${d.papers}</span>`
               :'<span class="pb-badge">未批</span>');
      return `<div class="pb-draft">
      <div class="pb-draft-main">
        <strong>${esc(d.title||'（未命名）')} ${tag}</strong>
        <span class="small-text">${new Date((d.createdAt||0)*1000).toLocaleDateString()} · ${d.pages} 頁 · ${d.papers} 份卷${d.unmatched?` · ${d.unmatched} 份未認出`:''}${d.className?` · ${esc(d.className)}`:''}</span>
      </div>
      <div class="pb-draft-actions">
        <button class="secondary" data-resume="${d.id}">${d.status==='graded'?'查看進度':'繼續'}</button>
        <button class="text-button" data-drop="${d.id}">刪除</button>
      </div></div>`;}).join('');
    $$('[data-resume]').forEach(b=>b.onclick=()=>resumeDraft(Number(b.dataset.resume)));
    $$('[data-drop]').forEach(b=>b.onclick=async()=>{
      if(!(await askConfirm('刪除這份草稿？之後要批就得重新掃描（會再花一次 AI 費用）。')))return;
      try{
        await api('/api/paper-grades/drafts/'+b.dataset.drop,{} ,'DELETE');
        toast('草稿已刪除');
        if(lastScan&&Number(lastScan.draftId)===Number(b.dataset.drop)){lastScan=null;$('#pb-result').innerHTML='';}
        await loadDrafts();
      }catch(e){toast(e.message);}
    });
  }
  async function resumeDraft(id){
    try{
      const {draft}=await api('/api/paper-grades/drafts/'+id);
      if(draft.classId)$('#pb-class').value=String(draft.classId);
      if(draft.title)$('#pb-title').value=draft.title;
      lastScan={draftId:draft.id,res:draft};
      renderBatch(draft);
      await refreshRoster();
      $('#pb-status').textContent=`已載入草稿：${draft.pages} 頁、${(draft.sheets||[]).length} 份卷。確認指派後按下面「確認並開始批改」。`;
      $('#pb-result').scrollIntoView({block:'nearest'});
    }catch(e){toast(e.message);}
  }

  // 名冊（給「指派給」下拉用）：匯入學生後要能立刻出現在下拉裡，
  // 否則老師得重新掃一次 80 頁的 PDF 才看得到新學生。
  async function refreshRoster(){
    const cid=$('#pb-class').value;
    try{
      const g=await api('/api/score-grid'+(cid?`?classId=${cid}`:''));
      const roster=(g.students||[]).map(s=>({id:s.id,name:s.name,seat:s.seat}));
      $('#pb-roster-info').textContent=roster.length?`（目前 ${roster.length} 人）`:'（還沒有學生）';
      if(!lastScan)return;
      const keep={};
      $$('[data-sheet]').forEach(sel=>{keep[sel.dataset.sheet]=sel.value;});
      lastScan.res.roster=roster;
      renderBatch(lastScan.res,keep);
    }catch(e){/* 沒有班級或權限不足時靜靜略過 */}
  }

  const showBulk=out=>{
    const rows=(out.created||[]).map(st=>`<tr><td>${st.seat??''}</td><td>${esc(st.name)}</td>
      <td>${esc(st.username)}</td><td>${esc(st.password)}</td></tr>`).join('');
    $('#pb-bulk-result').innerHTML=rows?`<p class="small-text">新增 ${out.created.length} 人${(out.skipped||[]).length?`，略過 ${out.skipped.length} 人（同名同座號）`:''}。帳號密碼只顯示這一次，請先抄下。</p>
      <table class="bulk-result"><thead><tr><th>號</th><th>姓名</th><th>帳號</th><th>密碼</th></tr></thead><tbody>${rows}</tbody></table>`
      :`<p class="small-text">沒有新增任何人（全部同名同座號，或格式不對）。</p>`;
  };

  $('#pb-import-toggle').onclick=()=>{
    const box=$('#pb-import-box');box.hidden=!box.hidden;
    if(!box.hidden)$('#pb-bulk-text').focus();
  };
  $('#pb-bulk-ok').onclick=async()=>{
    const cid=$('#pb-class').value;
    if(!cid)return toast('請先選擇班級，再匯入學生。');
    const lines=($('#pb-bulk-text').value||'').split('\n').map(l=>l.trim()).filter(Boolean);
    if(!lines.length)return toast('請貼上學生名單。');
    const students=lines.map(line=>{
      const m=line.match(/^(\d{1,3})[\s,，、.\t]+(.+)$/);
      return m?{seat:Number(m[1]),name:m[2].trim()}:{name:line.replace(/^[\s,，、.]+/,'').trim()};
    }).filter(x=>x.name);
    if(!students.length)return toast('名單裡找不到姓名。');
    if(!(await askNameMask()))return;
    const btn=$('#pb-bulk-ok');btn.disabled=true;btn.textContent='匯入中…';
    try{
      const out=await api('/api/score-grid/students',{classId:Number(cid),students});
      showBulk(out);toast(`已匯入 ${(out.created||[]).length} 人`);
      await refreshRoster();
    }catch(e){toast(e.message);}
    btn.disabled=false;btn.textContent='匯入文字名單';
  };
  $('#pb-bulk-import').onclick=async()=>{
    const cid=$('#pb-class').value;
    if(!cid)return toast('請先選擇班級，再匯入學生。');
    const file=$('#pb-bulk-file').files[0];
    if(!file)return toast('請先選一個 Excel 檔（.xlsx）。');
    if(!(await askNameMask()))return;
    const btn=$('#pb-bulk-import');btn.disabled=true;btn.textContent='匯入中…';
    try{
      const data=await fileToDataUrl(file);
      const out=await api('/api/score-grid/students/import',{classId:Number(cid),file:data});
      showBulk(out);toast(`已匯入 ${(out.created||[]).length} 人`);
      await refreshRoster();
    }catch(e){toast(e.message);}
    btn.disabled=false;btn.textContent='匯入 Excel';
  };

  // 換班級就換名冊
  $('#pb-class').onchange=()=>{lastScan=null;$('#pb-result').innerHTML='';refreshRoster();};
  refreshRoster();
  loadDrafts();

  async function gradeBatch(res){
    const title=($('#pb-title').value||'').trim();
    if(!title)return toast('請先填功課名稱。');
    const sheets=[];
    let unconfirmed=0,already=0;
    const doneIds=new Set((res.graded||[]).map(g=>Number(g.studentId)));
    $$('[data-sheet]').forEach(sel=>{
      const i=Number(sel.dataset.sheet);
      if(!sel.value)return;
      if(!(res.sheets[i]&&res.sheets[i].confirmed)){unconfirmed+=1;return;}
      // 續批時跳過先前已批過的學生，避免重複花 AI 費用
      if(doneIds.has(Number(sel.value))){already+=1;return;}
      sheets.push({studentId:Number(sel.value),pages:res.sheets[i].pages});
    });
    if(!sheets.length){
      return toast(already?'這些卷都已經批改過了（可按「查看」逐份核對）。':'請先逐份按「確認」鎖定配對，確認後才能批改。');
    }
    const skipped=[];
    if(unconfirmed)skipped.push(`${unconfirmed} 份未確認`);
    if(already)skipped.push(`${already} 份先前已批改`);
    if(skipped.length)toast(`已跳過：${skipped.join('、')}。`);
    const btn=$('#pb-grade');btn.disabled=true;btn.textContent='批改中…';
    // 由老師決定要不要二次批閱；不勾就維持一次批改，不花額外的 AI 呼叫
    const secondGrade=!!($('#pb-second-grade')&&$('#pb-second-grade').checked);
    try{localStorage.setItem('paperSecondGrade',secondGrade?'1':'0');}catch(_){}
    try{
      // 沒有草稿才需要把 PDF 塞進 JSON 走 batch：只有這條路徑才轉 base64。
      const payload=lastScan.draftId
        ? {draftId:lastScan.draftId,title,sheets,consentExternal:S.ai?.mode==='external'}
        : {file:await fileToDataUrl(lastScan.file),title,sheets,consentExternal:S.ai?.mode==='external'};
      if(secondGrade)payload.secondGrade=true;
      // 整班批改要「一份一份」跑 AI，36 份可能要二十分鐘以上；
      // 以前上限 5 分鐘，時間一到只閃一個 toast、版面完全沒變，看起來像當機。
      // 現在放寬到 30 分鐘，並把「已批 x / n 份」的進度直接寫在按鈕與狀態列。
      const out=await apiJob('/api/paper-grades/batch',payload,
        job=>{
          const p=job&&job.progress;
          const txt=p?`批改中… ${p.done} / ${p.total} 份（${Math.round(job.elapsed||0)} 秒）`
                     :`批改中… ${Math.round((job&&job.elapsed)||0)} 秒`;
          btn.textContent=txt;
          $('#pb-status').textContent=txt;
        }, 30*60*1000);
      const imported=(out.summary&&out.summary.imported)||0;
      const notImported=(out.summary&&out.summary.notImported)||[];
      toast(`已批改 ${out.summary.graded} 份${out.summary.failed?`，${out.summary.failed} 份失敗`:''}`
        +(imported?`，${imported} 份已匯入成績總表`:''));
      // 失敗原因要看得見，不然只會看到「0 份成功」卻不知道為什麼
      const reasons=[...new Set((out.failed||[]).map(f=>f.reason).filter(Boolean))];
      // 二次批閱的成效也要講清楚：補判了幾題、還有幾題要老師自己看
      const sg=out.summary&&out.summary.secondGrade;
      const secondText=sg&&(sg.changed||sg.compared)
        ? `<br><span class="small-text">二次批閱：補判 ${sg.changed} 題`
          +`${sg.compared>sg.changed?`，仍有 ${sg.compared-sg.changed} 題看不清（已記下最可能的猜測）`:''}。</span>`
        : (secondGrade?'<br><span class="small-text">二次批閱：沒有需要補判的題目。</span>':'');
      // 匯入結果：成功就講明「已進成績總表」；沒班級的學生要點名，否則老師以為漏了
      const importText = imported
        ? `<br><span class="small-text">✓ ${imported} 份分數已即時寫入「成績總表」（同名功課共用一欄，可再手改）。</span>`
        : '';
      const noClassText = notImported.length
        ? `<br><span class="small-text" style="color:#b8453b">⚠️ ${notImported.length} 位學生未匯入（沒有班級）：`
          +`${esc(notImported.slice(0,6).map(x=>x.studentName||('#'+x.studentId)).join('、'))}`
          +`${notImported.length>6?'…':''}　請先把學生加入班級，再按「查看卷面」逐份確認匯入。</span>`
        : '';
      $('#pb-status').innerHTML=`批改完成：${out.summary.graded} 份成功、${out.summary.failed} 份失敗。`
        +(reasons.length?`<br><span class="small-text">失敗原因：${esc(reasons.slice(0,3).join('；'))}</span>`:'')
        +importText+noClassText+secondText;
      // 把本次批改併進 res.graded：之後再按批改會跳過這些學生，
      // 結果列表也才看得到「先前批過的」而不會消失。
      // 批完即視為已確認（配對在批改前已由老師確認、分數同步進了成績總表），
      // 續批的清單才不會把它們當成「還沒確認」而重複批一次。
      res.graded=(res.graded||[]).concat((out.graded||[]).map(x=>({
        gradeId:x.grade&&x.grade.id, studentId:x.studentId,
        score:x.grade&&x.grade.score, confirmed:true})));
      renderBatchResults(out);
      // 不把 lastScan 清空：還有未確認的卷可以接著批
      await loadDrafts();
      $('#pb-result').scrollIntoView({block:'nearest'});
    }catch(e){
      // 失敗（逾時／AI 未配置／伺服器重啟弄丟工作）不能只閃一個 toast：
      // 老師會以為「什麼都沒發生、版面怎麼沒變」。把原因寫在狀態列常駐，
      // 並講明哪些卷已經批、哪些要重批，讓版面跟現實一致。
      const msg=e.message||'批改未完成。';
      const timedOut=/超過|逾時|timeout/i.test(msg)||/處理超過/.test(msg);
      $('#pb-status').innerHTML=`<span style="color:#b8453b">⚠️ 批改未完成：${esc(msg)}</span>`
        +`<br><span class="small-text">${timedOut
          ?'時間超過上限，但伺服器可能仍在跑。可以稍後按「繼續」載入草稿看已批完的卷，或再按一次「確認並開始批改」重批未完成的。'
          :'可先檢查 AI 服務是否已配置、再按一次「確認並開始批改」。已確認的配對不會消失。'}</span>`;
      // 把已批過的（續批清單有）與尚未批的分開講清楚
      const already=(res.graded||[]).length;
      if(already)$('#pb-status').innerHTML+=`<br><span class="small-text">（此前已成功批改 ${already} 份；本次未完成的請稍後重批）</span>`;
      // 逾時時伺服器往往已經批好幾份（分數都存好了）。給一個按鈕直接把
      // 已完成的結果拉回來顯示，不必重花 AI 費用。
      if(timedOut&&lastScan&&lastScan.draftId){
        $('#pb-status').innerHTML+=`<br><button class="secondary" id="pb-recover" style="margin-top:8px">重新取得已完成的分數</button>`;
        const rec=$('#pb-recover');
        if(rec)rec.onclick=async()=>{
          rec.disabled=true;rec.textContent='讀取中…';
          try{
            const {draft}=await api('/api/paper-grades/drafts/'+lastScan.draftId);
            const doneList=(draft.graded||[]).filter(g=>g.gradeId);
            if(!doneList.length){toast('伺服器還沒有任何完成的分數，請稍後再試。');rec.disabled=false;rec.textContent='重新取得已完成的分數';return;}
            res.graded=(res.graded||[]).concat(doneList.map(g=>({
              gradeId:g.gradeId,studentId:g.studentId,score:g.score,confirmed:!!g.confirmed})));
            renderBatchResults({graded:doneList.map(g=>({studentId:g.studentId,
              grade:{id:g.gradeId,studentId:g.studentId,score:g.score,confirmed:true,syncedToGrid:!!g.confirmed}})),failed:[]});
            $('#pb-status').innerHTML=`已取回 ${doneList.length} 份已完成的分數（已寫入成績總表）。`;
            toast(`已取回 ${doneList.length} 份結果`);
          }catch(e){toast(e.message);rec.disabled=false;rec.textContent='重新取得已完成的分數';}
        };
      }
      $('#pb-status').scrollIntoView({block:'nearest'});
      toast(msg);
    }
    btn.disabled=false;btn.textContent='確認並開始批改';
  }
  // 批改結果：每份一行，可打開該學生的原卷逐題核對（原卷由掃描草稿重新渲染）。
  // 續批時也要列出「先前批過的」，不能只顯示這一次的。
  function renderBatchResults(out){
    const roster=(lastScan&&lastScan.res&&lastScan.res.roster)||[];
    const nameOf=id=>{
      const r=roster.find(x=>Number(x.id)===Number(id));
      return r?r.name:`學生 ${id}`;
    };
    const graded=out.graded||[],failed=out.failed||[];
    // 教師改判後要回頭更新這裡的資料，否則再按「查看卷面」會看到舊分數
    paperBatchGrades=graded;
    const doneIds=new Set(graded.map(x=>Number(x.studentId)));
    const prev=((lastScan&&lastScan.res&&lastScan.res.graded)||[])
      .filter(g=>!doneIds.has(Number(g.studentId)));
    const rows=graded.map(x=>{
      const g=x.grade||{};
      const pending=g.pending?` · <span class="paper-pending">${g.pending} 題待判</span>`:'';
      // 批完即時匯入總表：成功的標「已匯入」，沒班級的明講原因，不要讓老師猜
      const sync=g.syncedToGrid?`<span class="pb-badge done">已匯入總表</span>`
        :`<span class="pb-badge" title="這位學生沒有班級，分數無法寫進成績總表">未匯入（無班級）</span>`;
      return `<tr data-grade-row="${g.id||''}">
        <td>${esc(g.studentName||nameOf(x.studentId))}</td>
        <td><strong>${g.score==null?'—':fmtScore(g.score)}</strong> <span class="small-text">/ 100</span></td>
        <td class="small-text">${g.totalQuestions==null?'—':g.totalQuestions} 題 · 對 ${g.correctCount==null?'—':g.correctCount}${pending}</td>
        <td>${sync}</td>
        <td>${g.id?`<button class="secondary" data-view-grade="${g.id}">查看卷面</button>`:''}</td></tr>`;
    }).join('');
    // 先前批過的（續批）：只有分數，按「查看」再去拉完整紀錄
    const prevRows=prev.map(g=>`<tr data-grade-row="${g.gradeId}">
      <td>${esc(nameOf(g.studentId))}</td>
      <td><strong>${g.score==null?'—':fmtScore(g.score)}</strong> <span class="small-text">/ 100</span></td>
      <td class="small-text">先前批改${g.confirmed?' · 已確認':''}</td>
      <td class="small-text">${g.confirmed?'<span class="pb-badge done">已匯入總表</span>':'—'}</td>
      <td><button class="secondary" data-view-grade="${g.gradeId}">查看卷面</button></td></tr>`).join('');
    const failRows=failed.map(x=>`<tr><td>${esc(nameOf(x.studentId))}</td>
      <td colspan="3" class="small-text" style="color:#b8453b">${esc(x.reason||'批改失敗')}</td><td></td></tr>`).join('');
    $('#pb-result').innerHTML=`<section class="panel panel-pad" style="margin-top:12px">
      <h2 style="margin-bottom:8px">批改結果（${graded.length+prev.length} 份）</h2>
      <table class="board-table"><thead><tr><th>學生</th><th>分數</th><th>判定</th><th>成績總表</th><th></th></tr></thead>
        <tbody>${rows}${prevRows}${failRows}</tbody></table>
      <p class="field-hint">配對在你按下「確認」時就已定案，所以批完的分數會自動寫進「成績總表」（同名功課共用一欄，可再手改）。按「查看卷面」可逐題核對 AI 的判斷，改判後總表分數會同步更新。</p>
      <div id="pb-viewer"></div></section>`;
    $$('[data-view-grade]').forEach(b=>b.onclick=()=>{
      const hit=graded.find(x=>String((x.grade||{}).id)===b.dataset.viewGrade);
      if(hit)return openPaperPages(hit.grade);
      return openGradeById(Number(b.dataset.viewGrade));
    });
  }
  // 先前批過的紀錄只有編號：從列表拉回完整內容再顯示
  async function openGradeById(gid){
    try{
      const all=(await api('/api/paper-grades')).grades||[];
      const g=all.find(x=>Number(x.id)===Number(gid));
      if(!g)return toast('找不到這筆批改紀錄。');
      await openPaperPages(g);
    }catch(e){toast(e.message);}
  }
  async function openPaperPages(grade){
    // 批改結果在 #pb-viewer；配對表的卷面預覽區是 #pb-sheet-viewer
    const box=$('#pb-viewer')||$('#pb-sheet-viewer');
    if(!box||!grade)return;
    box.innerHTML='<p class="small-text">載入原卷…</p>';
    try{
      const out=await api(`/api/paper-grades/${grade.id}/pages`);
      if(!(out.pages||[]).length){
        box.innerHTML=`<p class="small-text">${esc(out.notice||'這份卷沒有留存原圖，只能看下面的逐題紀錄。')}</p>`;
        paperPages=[];paperGradeId=grade.id;
        box.insertAdjacentHTML('beforeend',paperResultHtml(grade));
        return;
      }
      paperPages=out.pages;paperGradeId=grade.id;
      box.innerHTML=paperResultHtml(grade);
      box.scrollIntoView({block:'start',behavior:'smooth'});
    }catch(e){box.innerHTML=`<p class="error-text">${esc(e.message)}</p>`;}
  }
  function renderBatch(res,keep){
    const pick=(i,cur)=>String((keep&&keep[i])||cur||'');
    const opts=(i,cur)=>`<option value="">（未指派）</option>`+
      (res.roster||[]).map(u=>`<option value="${u.id}"${String(u.id)===pick(i,cur)?' selected':''}>${esc(u.name)}${u.seat?' · '+esc(u.seat):''}</option>`).join('');
    // 卷面預覽要靠草稿裡的 PDF；掃描結果是 draftId，續批載入的草稿是 id
    const viewId=res.draftId||res.id||null;
    // 每一份卷自己的角度：取該份第一頁的設定，沒有就退回整份的值
    const rotOf=sh=>{
      const list=Array.isArray(res.rotations)?res.rotations:[];
      const r=list[sh.pages[0]-1];
      return (r===0||r===90||r===180||r===270)?r:(res.rotation||0);
    };
    const rotOpts=cur=>[0,90,180,270].map(r=>`<option value="${r}"${cur===r?' selected':''}>${r}°</option>`).join('');
    const rows=(res.sheets||[]).map((sh,i)=>{
      const locked=!!sh.confirmed;
      const dis=locked?' disabled':'';
      // 這份卷是否已經批過（續批時要一眼看出還欠誰）
      const done=(res.graded||[]).find(g=>Number(g.studentId)===Number(sh.studentId));
      const cls=[locked?'pb-locked':'',done?'pb-graded':'',sh.secondPass&&sh.needsReview?'pb-review':''].filter(Boolean).join(' ');
      // 二次配對：不只寫「座號／姓名」，要讓老師看得出這是放寬條件後認出來的，要覆核
      const how=sh.matchedBy==='seat'?'座號':sh.matchedBy==='name'?'姓名'
        :sh.matchedBy==='ai2'?'二次比對':sh.matchedBy==='remaining'?'唯一剩餘'
        :sh.matchedBy==='order'?'暫配':'';
      const tag=sh.secondPass
        ?`<span class="pb-second-tag${sh.needsReview?' pb-second-warn':''}" title="${esc(sh.matchReason||'二次配對，請覆核')}">${Math.round((sh.confidence||0)*100)}%</span>`
        :'';
      return `<tr data-sheet-row="${i}"${cls?` class="${cls}"`:''}>
      <td class="pb-no" data-label="#">${i+1}${done?` <span class="pb-done-mark" title="已批改 ${fmtScore(done.score)} 分">✓</span>`:''}</td>
      <td class="pb-pages" data-label="頁碼">${sh.pages.join('、')}</td>
      <td class="pb-view" data-label="卷面">${done?`<button class="text-button" data-view-grade-btn="${done.gradeId}">查看批改</button>`
        :(viewId?`<button class="text-button" data-view-sheet="${i}">查看</button>`:'<span class="small-text">—</span>')}</td>
      <td class="pb-rot" data-label="方向"><select class="sg-rot" data-sheet-rot="${i}"${dis}>${rotOpts(rotOf(sh))}</select></td>
      <td class="pb-seat" data-label="讀到座號">${sh.seat??''}</td>
      <td class="pb-name" data-label="讀到姓名">${esc(sh.name||'')}</td>
      <td class="pb-match" data-label="配對方式">${how}${tag}</td>
      <td class="pb-assign" data-label="指派給"><select data-sheet="${i}"${dis}>${opts(i,sh.studentId)}</select></td>
      <td class="pb-confirm" data-label="確認"><button class="text-button" data-confirm="${i}">${locked?'更改':'確認'}</button></td></tr>`;
    }).join('');
    $('#pb-result').innerHTML=`<div class="sg-toolbar" style="margin-top:12px">
      <label class="small-text">全部卷面方向
        <select id="pb-rot">
          <option value="0"${(res.rotation||0)===0?' selected':''}>正常</option>
          <option value="90"${res.rotation===90?' selected':''}>順時針 90°</option>
          <option value="180"${res.rotation===180?' selected':''}>上下顛倒 180°</option>
          <option value="270"${res.rotation===270?' selected':''}>逆時針 90°</option>
        </select>
      </label>
      <span class="small-text">AI 已先判斷；某一份卷不對就改它那一行的「方向」，只影響該學生。</span>
      <button class="secondary" id="pb-rematch" title="讀不到座號／姓名時，改從「還沒配對的學生名單」反查">二次檢視配對</button>
      <button class="secondary" id="pb-confirm-all">全部確認</button>
    </div>
    <div class="sg-wrap pb-sheet-wrap" style="margin-top:8px"><table class="score-grid pb-sheet-table">
      <thead><tr><th>#</th><th>頁碼</th><th>卷面</th><th>方向</th><th>讀到座號</th><th>讀到姓名</th><th>配對方式</th><th>指派給</th><th>確認</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <p class="field-hint">逐份核對「指派給」是否正確，按「確認」鎖住（確認後才能批改）；發現錯了按「更改」解鎖。按「查看」可先看這份卷的實際畫面。認不出人的卷可按「二次檢視配對」，系統會放寬條件，從尚未配對的學生名單裡找。</p>
      <div id="pb-unmatched"></div>
      <div id="pb-sheet-viewer"></div>
      <div class="sg-bulk-actions">
        <label class="pb-second-opt" title="只對「看不清／待判定」的題目再看一次（每頁最多多一次 AI 呼叫），不是整份重批">
          <input type="checkbox" id="pb-second-grade">
          <span>二次 AI 批閱<small>補判看不清的題目，取最可能的情況</small></span>
        </label>
        <button class="primary" id="pb-grade">確認並開始批改</button>
      </div>`;
    let viewing=-1;
    const loadSheet=async i=>{
      const sh=(res.sheets||[])[i];
      const box=$('#pb-sheet-viewer');
      if(!sh||!box)return;
      viewing=i;
      box.innerHTML='<p class="small-text">載入卷面…</p>';
      try{
        const out=await api(`/api/paper-grades/drafts/${viewId}/pages?nums=${sh.pages.join(',')}`);
        const pages=out.pages||[];
        box.innerHTML=pages.length
          ? `<div class="paper-pages">${pages.map((src,k)=>`<figure class="paper-page"><img src="${src}" alt="第 ${sh.pages[k]} 頁"><figcaption>第 ${sh.pages[k]} 頁</figcaption></figure>`).join('')}</div>`
          : `<p class="small-text">${esc(out.notice||'沒有可顯示的頁面。')}</p>`;
        box.scrollIntoView({block:'nearest'});
      }catch(e){box.innerHTML=`<p class="error-text">${esc(e.message)}</p>`;}
    };
    // 整份一起轉
    $('#pb-rot').onchange=async ev=>{
      const rot=Number(ev.target.value);
      if(!viewId){toast('這份卷沒有存草稿，無法改方向。');return;}
      try{
        const out=await api(`/api/paper-grades/drafts/${viewId}/rotation`,{rotation:rot});
        res.rotation=rot;
        res.rotations=out.rotations||res.rotations;
        $$('[data-sheet-rot]').forEach(sel=>{sel.value=String(rot);});
        $('#pb-sheet-viewer').innerHTML='';
        viewing=-1;
        toast('全部卷面方向已更新，按「查看」重新載入。');
      }catch(e){toast(e.message);}
    };
    // 只轉某一份卷（某個學生的答卷）
    $$('[data-sheet-rot]').forEach(sel=>sel.onchange=async()=>{
      const i=Number(sel.dataset.sheetRot),sh=(res.sheets||[])[i];
      const rot=Number(sel.value);
      if(!viewId||!sh){toast('這份卷沒有存草稿，無法改方向。');return;}
      try{
        const out=await api(`/api/paper-grades/drafts/${viewId}/rotation`,
          {rotation:rot,pages:sh.pages});
        res.rotations=out.rotations||res.rotations;
        toast(`第 ${i+1} 份卷已轉 ${rot}°`);
        if(viewing===i)await loadSheet(i);
      }catch(e){toast(e.message);}
    });
    $$('[data-view-sheet]').forEach(b=>b.onclick=()=>loadSheet(Number(b.dataset.viewSheet)));
    // 已批改的學生：直接打開批改結果（帶紅框、✓、評註），不是乾淨的原卷
    $$('[data-view-grade-btn]').forEach(b=>b.onclick=()=>openGradeById(Number(b.dataset.viewGradeBtn)));
    // 逐份確認：確認後鎖住這一行的指派與方向，要改再按「更改」
    const applyLock=i=>{
      const tr=$(`tr[data-sheet-row="${i}"]`),sh=(res.sheets||[])[i];
      if(!tr||!sh)return;
      tr.classList.toggle('pb-locked',!!sh.confirmed);
      tr.querySelectorAll('[data-sheet],[data-sheet-rot]').forEach(el=>{el.disabled=!!sh.confirmed;});
      const btn=tr.querySelector('[data-confirm]');
      if(btn)btn.textContent=sh.confirmed?'更改':'確認';
    };
    $$('[data-confirm]').forEach(btn=>btn.onclick=async()=>{
      const i=Number(btn.dataset.confirm),sh=(res.sheets||[])[i];
      if(!sh)return;
      const next=!sh.confirmed;
      // 草稿沒存成功（磁碟滿、DB 鎖住…）時仍要能確認：批改端只讀前端送出的配對，
      // 不依賴草稿裡的確認狀態。以前這裡直接擋住，整批就永遠批不了。
      if(!viewId){
        sh.confirmed=next;
        applyLock(i);
        toast(next?`第 ${i+1} 份已確認（此份未存草稿，離開頁面後要重新掃描）`:`第 ${i+1} 份已解鎖，可再更改`);
        return;
      }
      try{
        await api(`/api/paper-grades/drafts/${viewId}/confirm`,{index:i,confirmed:next});
        sh.confirmed=next;
        applyLock(i);
        toast(next?`第 ${i+1} 份已確認並鎖定`:`第 ${i+1} 份已解鎖，可再更改`);
      }catch(e){toast(e.message);}
    });
    $('#pb-confirm-all').onclick=async()=>{
      if(!viewId){
        (res.sheets||[]).forEach((sh,i)=>{sh.confirmed=true;applyLock(i);});
        toast('已全部確認（未存草稿，離開頁面後要重新掃描）');
        return;
      }
      try{
        const out=await api(`/api/paper-grades/drafts/${viewId}/confirm`,{all:true,confirmed:true});
        res.sheets=out.sheets||res.sheets;
        (res.sheets||[]).forEach((_,i)=>applyLock(i));
        toast('已全部確認並鎖定');
      }catch(e){toast(e.message);}
    };
    // 二次批閱：記住老師的選擇（預設不勾，避免每次批改都多花 AI 呼叫）
    const secondEl=$('#pb-second-grade');
    try{if(secondEl)secondEl.checked=localStorage.getItem('paperSecondGrade')==='1';}catch(_){}
    // 二次檢視配對：不重掃 PDF，只把「還沒配對的卷」從剩餘名單反查；
    // 已確認鎖住的卷不動，結果仍要老師逐份覆核。
    const rematchBtn=$('#pb-rematch');
    if(rematchBtn)rematchBtn.onclick=async()=>{
      if(!viewId)return toast('這份卷沒有存草稿，無法重新配對。');
      const keep={};
      $$('[data-sheet]').forEach(sel=>{keep[sel.dataset.sheet]=sel.value;});
      rematchBtn.disabled=true;rematchBtn.textContent='比對中…';
      try{
        const out=await api(`/api/paper-grades/drafts/${viewId}/rematch`,
          {consentExternal:S.ai?.mode==='external'});
        const st=out.secondMatch||{};
        renderBatch(Object.assign({},res,{sheets:out.sheets||res.sheets,secondMatch:st}),keep);
        toast(st.matched
          ?`二次配對：新認出 ${st.matched} 份（AI 比對 ${st.byAi||0}、唯一剩餘 ${st.byRemaining||0}、暫配 ${st.byOrder||0}），請逐份覆核。`
          :'二次配對完成：沒有新的配對，請手動指派。');
      }catch(e){
        rematchBtn.disabled=false;rematchBtn.textContent='二次檢視配對';
        toast(e.message);
      }
    };
    // 該班還沒配到卷的學生：沒交、沒掃到，或 AI 沒認出來。
    // 每次改「指派給」都重算，老師一眼看得出還欠誰。
    const updateUnmatched=()=>{
      const box=$('#pb-unmatched');
      if(!box)return;
      const roster=res.roster||[];
      if(!roster.length){box.innerHTML='';return;}
      const taken=new Set($$('[data-sheet]').map(s=>Number(s.value)).filter(Boolean));
      const missing=roster.filter(u=>!taken.has(u.id));
      box.innerHTML=missing.length
        ? `<div class="pb-unmatched"><strong>尚未配對 ${missing.length} 人</strong>
            <span class="small-text">（沒交、沒掃到，或 AI 沒認出）</span>
            <div class="pb-unmatched-list">${missing.map(u=>
              `<span class="pb-chip">${esc(u.name)}${u.seat?' · '+esc(u.seat):''}</span>`).join('')}</div></div>`
        : `<p class="small-text">全班 ${roster.length} 人都已配對到卷。</p>`;
    };
    $$('[data-sheet]').forEach(sel=>sel.addEventListener('change',updateUnmatched));
    updateUnmatched();
    $('#pb-grade').onclick=()=>gradeBatch(res);
  }
}

async function paperGradePage(){
  page='paper';shell();
  if(S.user?.role!=='teacher')return bank();
  // 確認答案卷或重新載入時，不要把教師填過的功課名稱／班級弄丟。
  const savedTitle=sessionStorage.getItem('paperTitle')||'';
  const savedClass=sessionStorage.getItem('paperClass')||'';
  $('#main').innerHTML=`<div class="fade-in">${heading('PAPER GRADING','紙本批改','上傳整份功課（題目＋學生手寫答案），AI 逐題判斷對錯，以 100 分為滿分。')}<section class="panel panel-pad"><p class="small-text">載入中…</p></section></div>`;
  let roster=[],history=[],keys=[],classes=[];
  try{
    const [a,b,c,d]=await Promise.all([api('/api/users'),api('/api/paper-grades'),
      api('/api/paper-keys'),api('/api/homework')]);
    roster=a.users.filter(u=>u.role==='student');history=b.grades;
    keys=c.keys.filter(k=>k.confirmed);classes=d.classes||[];
  }
  catch(err){toast(err.message);}
  const options=roster.map(u=>`<option value="${u.id}">${esc(u.name)}${u.seat?` · 座號 ${esc(u.seat)}`:''}${u.grade?` · ${esc(u.grade)}`:''}</option>`).join('');
  const historyHtml=`<section class="panel panel-pad" style="margin-top:16px"><h2 style="margin-bottom:6px">批改紀錄</h2><p class="small-text" style="margin:0 0 10px">按功課名稱分組；選了班級就會列出還沒批的學生。</p><div id="paper-history">${paperHistoryHtml(history,classes,roster,savedClass)}</div></section>`;
  $('#main').innerHTML=`<div class="fade-in">${heading('PAPER GRADING','紙本批改','上傳整份功課（題目＋學生手寫答案），AI 逐題判斷對錯，以 100 分為滿分。')}
    <section class="panel panel-pad" style="margin-bottom:16px">
      <h2 style="margin-bottom:6px">這份功課（填一次就好）</h2>
      <p class="small-text" style="margin:0 0 10px">功課名稱與班級只要填一次，之後逐個學生上傳時不必再填。</p>
      <div class="form-grid">
        <div class="form-field"><label class="field-label" for="paper-title">功課名稱</label><input id="paper-title" maxlength="200" value="${esc(savedTitle)}" placeholder="例如：第三次功課"></div>
        <div class="form-field"><label class="field-label" for="paper-class">班級</label><select id="paper-class"><option value="">全部學生（不分班）</option>${classes.map(c=>`<option value="${c.id}"${String(c.id)===savedClass?' selected':''}>${esc(c.name)}（${c.studentCount} 人）</option>`).join('')}</select></div>
      </div>
      <label class="consent-check"><input type="checkbox" id="paper-consent">
        <span>我同意把這份功課（題目與學生作答）傳送給外部 AI 模型辨識與批改。同一份功課只需勾一次，換功課時請重新確認。</span></label>
      <label class="pb-second-opt" style="margin-top:10px" title="只對「看不清／待判定」的題目再看一次（每頁最多多一次 AI 呼叫），不是整份重批">
        <input type="checkbox" id="paper-second-grade">
        <span>二次 AI 批閱<small>補判看不清的題目，取最可能的情況（可選）</small></span>
      </label>
    </section>
    <section class="panel panel-pad" style="margin-bottom:16px">
      <h2 style="margin-bottom:6px">第一步：建立答案卷（建議先做）</h2>
      <p class="small-text" style="margin:0 0 10px">上傳**空白題目**（練習紙／試卷）→ AI 生成標準答案 → 你核對後確認。之後批改會以這份答案為準，比讓 AI 自己解題準得多。</p>
      <div class="form-field"><label class="field-label" for="key-files">空白題目（1–10 頁，可 PDF）</label><input id="key-files" type="file" accept="image/*,application/pdf,.heic,.heif" multiple></div>
      <p class="error-text" id="key-error"></p>
      <button class="secondary" id="key-build">${icon('spark')}生成標準答案</button>
      <div id="key-result"></div>
      <div id="key-answers"></div>
    </section>
    <section class="panel panel-pad">
      <h2 style="margin-bottom:10px">第二步：批改學生作業</h2>
      <div class="form-grid">
        <div class="form-field"><label class="field-label" for="paper-student">學號／學生</label><select id="paper-student">${options||'<option value="">（還沒有學生帳號）</option>'}</select></div>
        <div class="form-field"><label class="field-label" for="paper-key">使用答案卷（建議）</label><select id="paper-key"><option value="">不使用（AI 自行解題）</option>${keys.map(k=>`<option value="${k.id}">${esc(k.title)}（${k.questions.length} 題，已確認）</option>`).join('')}</select></div>
      </div>
      <div class="import-warning paper-notice">
        <strong>⚠️ 重要提醒：同一題的解題過程不可跨頁</strong>
        <p>請確認每一題的作答（連同解題過程）都完整落在同一頁。若一題的過程被切到下一頁，AI 只看得到半題，會誤判為錯或無法辨認——這是最常見的批改失準原因。</p>
      </div>
      <div class="form-field"><label class="field-label" for="paper-files">功課照片（1–10 頁，含題目與學生答案）</label><input id="paper-files" type="file" accept="image/*,application/pdf,.heic,.heif" multiple></div>
      <p class="field-hint">同一份功課可以逐個學生上傳：批改完換學生再按一次即可，功課名稱會保留。支援手機拍照（含 iPhone 的 HEIC）、JPG／PNG／WebP 與 PDF。拍照請保持整頁清晰、四角完整。最多 10 頁（PDF 會自動拆頁計算），每頁各呼叫一次 AI，約需 10–30 秒。</p>
      <p class="error-text" id="paper-error"></p>
      <button class="primary" id="paper-submit">${icon('spark')}開始 AI 批改</button>
      <div id="paper-result"></div>
    </section>${historyHtml}</div>`;
  // ── 第一步：建立答案卷 ──
  $('#key-build').onclick=async()=>{
    const title=$('#paper-title').value.trim(),files=[...($('#key-files').files||[])];
    const err=$('#key-error'),btn=$('#key-build');
    err.textContent='';
    // 「這是學生已作答的卷」勾選框：勾了只抽題目，之後再叫 AI 出答案
    if($('#key-build')&&!$('#key-from-student')){
      $('#key-build').insertAdjacentHTML('beforebegin',
        '<label class="small-text" style="display:block;margin:0 0 6px">' +
        '<input type="checkbox" id="key-from-student"> 這是學生已作答的卷（只抽題目，不需空白卷）</label>');
    }
    if(!title)return err.textContent='請填寫功課名稱。';
    if(!files.length)return err.textContent='請上傳空白題目。';
    if(files.length>10)return err.textContent='最多 10 頁。';
    if(!$('#paper-consent').checked)return err.textContent='請先勾選「同意傳送給外部 AI 模型」。';
    btn.disabled=true;const original=btn.innerHTML;
    try{
      const pages=[];
      for(let i=0;i<files.length;i++){btn.innerHTML=`${icon('clock')}處理第 ${i+1}/${files.length} 頁…`;pages.push(await paperPageData(files[i]));}
      btn.innerHTML=`${icon('spark')}AI 生成答案中…`;
      const fromStudent=!!$('#key-from-student')?.checked;
      const out=await api('/api/paper-keys',
        {title,pages,consentExternal:true,source:fromStudent?'student':'blank'});
      let key=out.key;
      if(fromStudent){
        // 學生卷只抽題目；教師確認前先由 AI 依抽到的題目生成答案
        btn.innerHTML=`${icon('spark')}AI 生成答案中…`;
        key=(await api(`/api/paper-keys/${key.id}/answers`,
          {questions:key.questions,consentExternal:true})).key;
      }
      $('#key-result').innerHTML=`<div class="paper-key-editor">
        <p class="small-text">AI 生成的標準答案如下。請逐題核對，可直接修改；確認後才能拿來批改。</p>
        <table class="board-table"><thead><tr><th>題號</th><th>題目</th><th>標準答案（可修改）</th></tr></thead><tbody>
        ${key.questions.map((q,i)=>`<tr><td>${esc(q.number)}</td><td>${mathText(q.question||'')}</td>
          <td><input class="key-answer" data-key-index="${i}" value="${esc(q.answer||'')}" placeholder="（無法辨識，請自行填寫）"></td></tr>`).join('')}
        </tbody></table>
        <p class="error-text" id="key-confirm-error"></p>
        <div class="row-actions" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button class="primary" id="key-confirm">${icon('check')}確認這份答案卷（${key.questions.length} 題）</button>
          <label class="field-label" for="key-import-topic" style="margin:0">匯入分類</label>
          <select id="key-import-topic" style="max-width:180px">${Object.keys(topicTree).map(t=>`<option value="${esc(t)}"${t==='代數'?' selected':''}>${esc(t)}</option>`).join('')}</select>
          <button class="secondary" id="key-import">${icon('upload')}匯入題庫</button>
        </div>
        <p class="field-hint">核對後按「確認」才能用於批改；也可以直接匯入題庫（會用上面修改後的答案）。</p></div>`;
      $('#key-import').onclick=()=>{
        const qs=key.questions.map((q,i)=>({number:q.number,question:q.question,points:q.points,
          answer:$(`.key-answer[data-key-index="${i}"]`).value.trim()}));
        importKeyToBank(key,qs);
      };
      $('#key-confirm').onclick=async()=>{
        const questions=key.questions.map((q,i)=>({number:q.number,question:q.question,points:q.points,
          answer:$(`.key-answer[data-key-index="${i}"]`).value.trim()}));
        const btn2=$('#key-confirm');btn2.disabled=true;
        try{
          await api(`/api/paper-keys/${key.id}`,{questions,confirm:true});
          toast('答案卷已確認，之後批改會以它為準。');
          // 只把新確認的答案卷加進下拉，不重載整頁——重載會把功課名稱與班級洗掉。
          const sel=$('#paper-key');
          if(sel&&!Array.from(sel.options).some(o=>o.value===String(key.id))){
            const opt=document.createElement('option');
            opt.value=String(key.id);opt.textContent=`${title}（${questions.length} 題，已確認）`;
            sel.appendChild(opt);
          }
          if(sel)sel.value=String(key.id);
          $('#key-result').innerHTML=`<div class="paper-key-editor"><p class="small-text">✅ 答案卷已確認（${questions.length} 題），已自動選用於批改。</p></div>`;
        }catch(e2){$('#key-confirm-error').textContent=e2.message;btn2.disabled=false;}
      };
    }catch(e){err.textContent=e.message;}
    finally{btn.disabled=false;btn.innerHTML=original;}
  };
  // 班級切換 → 學號下拉只列該班學生
  const fillStudents=()=>{
    const cid=Number($('#paper-class').value||0);
    const cls=classes.find(c=>c.id===cid);
    const ids=cls&&cls.studentIds?new Set(cls.studentIds):null;
    const list=ids?roster.filter(u=>ids.has(u.id)):roster;
    $('#paper-student').innerHTML=list.length
      ? list.map(u=>`<option value="${u.id}">${esc(u.name)}${u.seat?` · ${esc(u.seat)}`:''}${u.grade?` · ${esc(u.grade)}`:''}</option>`).join('')
      : '<option value="">（這個班還沒有學生）</option>';
  };
  // 匯入題庫（生成後與已確認的答案卷共用）
  const importKeyToBank=async(key,questions)=>{
    const btn=$('#key-import');if(btn)btn.disabled=true;
    try{
      const topic=($('#key-import-topic')||{}).value||'代數';
      const payload=questions.map(q=>({
        title:`${key.title} 第 ${q.number} 題`,
        content:q.question||`第 ${q.number} 題`,
        answer:q.answer||'',
        topic, grade:'中三', qtype:'解答題',
        points:q.points||5, level:2, source:`紙本批改 · ${key.title}`
      }));
      const r=await api('/api/questions/import',{questions:payload,dedupe:true});
      await refresh();
      const sk=(r.skipped||[]).length;
      toast(sk?`已匯入 ${r.count} 題，${sk} 題題庫已有已略過。`:`已匯入 ${r.count||payload.length} 題到題庫（分類與難度請再到題庫調整）`);
    }catch(e){toast(e.message);if(btn)btn.disabled=false;}
  };

  // 選了答案卷 → 列出標準答案（可修改、可儲存、可匯入）
  const renderKeyAnswers=()=>{
    const id=Number($('#paper-key').value||0);
    const key=keys.find(k=>k.id===id);
    const box=$('#key-answers');
    if(!box)return;
    // 已確認的答案卷不能再重新生成（只可修改），避免覆蓋教師核對過的答案。
    const buildBtn=$('#key-build');
    if(buildBtn){
      buildBtn.disabled=!!key;
      buildBtn.title=key?'已確認的答案卷只可修改，不能重新生成':'';
    }
    if(!key){box.innerHTML='';return;}
    box.innerHTML=`<div class="paper-key-editor">
      <h3 style="margin:0 0 8px;font-size:calc(16px*var(--fs))">已確認的標準答案 · ${esc(key.title)}（${key.questions.length} 題）</h3>
      <p class="small-text" style="margin:0 0 8px">已確認的答案卷**不能重新生成**，但可以直接修改答案後儲存。</p>
      <table class="board-table"><thead><tr><th>題號</th><th>題目</th><th>標準答案（可修改）</th><th>配分</th></tr></thead><tbody>
      ${key.questions.map((q,i)=>`<tr><td>${esc(q.number)}</td><td>${mathText(q.question||'')}</td>
        <td><input class="key-answer" data-key-index="${i}" value="${esc(q.answer||'')}" placeholder="（未填，請自行填寫）"></td>
        <td>${q.points?q.points+' 分':'<span class="small-text">平均</span>'}</td></tr>`).join('')}
      </tbody></table>
      <div class="row-actions" style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="primary" id="key-save">${icon('check')}儲存修改</button>
        <label class="field-label" for="key-import-topic" style="margin:0">匯入分類</label>
        <select id="key-import-topic" style="max-width:180px">${Object.keys(topicTree).map(t=>`<option value="${esc(t)}"${t==='代數'?' selected':''}>${esc(t)}</option>`).join('')}</select>
        <button class="secondary" id="key-import">${icon('upload')}匯入題庫</button>
      </div>
      <p class="field-hint">儲存後會立刻用於之後的批改。匯入題庫後可在題庫編輯難度、詳解與子分類。</p></div>`;
    const readEdited=()=>key.questions.map((q,i)=>({number:q.number,question:q.question,points:q.points,
      answer:($(`.key-answer[data-key-index="${i}"]`)||{}).value!==undefined?$(`.key-answer[data-key-index="${i}"]`).value.trim():(q.answer||'')}));
    $('#key-save').onclick=async()=>{
      const btn=$('#key-save');btn.disabled=true;
      try{
        await api(`/api/paper-keys/${key.id}`,{questions:readEdited(),confirm:true});
        toast('答案已儲存，之後批改會用新答案。');
        const fresh=await api('/api/paper-keys');
        keys=fresh.keys.filter(k=>k.confirmed);
      }catch(e){toast(e.message);}
      finally{btn.disabled=false;}
    };
    $('#key-import').onclick=()=>importKeyToBank(key,readEdited());
  };
  $('#paper-key').onchange=renderKeyAnswers;
  renderKeyAnswers();
  $('#paper-class').onchange=()=>{sessionStorage.setItem('paperClass',$('#paper-class').value);fillStudents();
    const box=$('#paper-history');if(box)box.innerHTML=paperHistoryHtml(history,classes,roster,$('#paper-class').value);};
  $('#paper-title').oninput=()=>sessionStorage.setItem('paperTitle',$('#paper-title').value);
  fillStudents();
  $('#paper-submit').onclick=async()=>{
    const studentId=Number($('#paper-student').value||0);
    const title=$('#paper-title').value.trim();
    const files=[...($('#paper-files').files||[])];
    const err=$('#paper-error'),btn=$('#paper-submit');
    err.textContent='';
    if(!studentId)return err.textContent='請先選擇學生。';
    if(!title)return err.textContent='請填寫功課名稱。';
    if(!files.length)return err.textContent='請至少上傳一頁。';
    if(files.length>10)return err.textContent='最多 10 頁。';
    if(!$('#paper-consent').checked)return err.textContent='請先勾選「同意傳送給外部 AI 模型」。';
    btn.disabled=true;const original=btn.innerHTML;
    try{
      const pages=[];
      for(let i=0;i<files.length;i++){btn.innerHTML=`${icon('clock')}處理第 ${i+1}/${files.length} 頁…`;pages.push(await paperPageData(files[i]));}
      btn.innerHTML=`${icon('spark')}AI 判斷中…`;
      const keyId=Number($('#paper-key').value||0);
      const secondGrade=!!($('#paper-second-grade')&&$('#paper-second-grade').checked);
      const out=await api('/api/paper-grades',{studentId,title,pages,consentExternal:true,
        ...(keyId?{paperKeyId:keyId}:{}),...(secondGrade?{secondGrade:true}:{})});
      paperPages=pages;paperGradeId=out.grade.id;
      $('#paper-result').innerHTML=paperResultHtml(out.grade);
      // 同一份功課要逐個學生上傳：功課名稱與班級保留，學號與檔案清空，直接換下一位。
      $('#paper-title').value=title;
      $('#paper-files').value='';
      fillStudents();
      $('#paper-student').selectedIndex=0;
      // 剛批完的這一筆直接進「批改紀錄」，不必重新整理才知道還缺誰。
      if(out.grade&&out.grade.title){history.unshift({...out.grade,createdAt:new Date().toISOString()});const box=$('#paper-history');
        if(box)box.innerHTML=paperHistoryHtml(history,classes,roster,$('#paper-class').value);}
      toast(`批改完成：${out.grade.score} / 100 · 請選下一位學生（功課名稱與班級已保留）`);
    }catch(e){err.textContent=e.message;}
    finally{btn.disabled=false;btn.innerHTML=original;}
  };
}
async function leaderboardPage(month){
  page='board';shell();
  if(!S.user)return loginModal(leaderboardPage);
  const now=new Date();
  const m=month||`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  $('#main').innerHTML=`<div class="fade-in">${heading('LEADERBOARD','排行榜','每月每年級前 10 名。只顯示姓名、座號與分數——作答內容不會公開。')}<section class="panel panel-pad"><p class="small-text">載入中…</p></section></div>`;
  let data;
  try{data=await api(`/api/leaderboard/${m}`);}
  catch(err){$('#main').innerHTML=`<div class="fade-in">${heading('LEADERBOARD','排行榜','')}${empty('讀取排行榜失敗',err.message,'')}</div>`;return;}
  const rankCell=(x)=>`<td class="board-rank ${x.rank<=3?'top':''}">${x.rank}</td>`;
  const who=(x)=>`<td>${esc(x.name)}${x.seat?` <span class="small-text">座號 ${esc(x.seat)}</span>`:''}</td>`;
  const scoreTable=(list)=>list.length?`<table class="board-table"><thead><tr><th>名次</th><th>學生</th><th>本月得分</th><th>開學至今</th><th>累積總分</th></tr></thead><tbody>${list.map(x=>`<tr>${rankCell(x)}${who(x)}<td><strong>${x.monthScore}</strong></td><td>${x.termScore}</td><td class="small-text">${x.totalScore}</td></tr>`).join('')}</tbody></table>`:`<p class="small-text">這個年級本月還沒有計分紀錄。</p>`;
  const progressTable=(list)=>list.length?`<table class="board-table"><thead><tr><th>名次</th><th>學生</th><th>本月</th><th>上月</th><th>成長倍數</th></tr></thead><tbody>${list.map(x=>`<tr>${rankCell(x)}${who(x)}<td><strong>${x.monthScore}</strong></td><td>${x.prevScore}</td><td><strong>${x.ratio}×</strong></td></tr>`).join('')}</tbody></table>`:`<p class="small-text">這個年級上月沒有分數，無法比較進步。</p>`;
  const block=(title,render)=>data.grades.length?data.grades.map(g=>`<section class="panel panel-pad" style="margin-top:16px"><h2 style="margin-bottom:10px">${esc(g)}</h2>${render(data[title][g]||[])}</section>`).join(''):empty('還沒有排行資料','學生要有年級與計分紀錄才會上榜。','');
  $('#main').innerHTML=`<div class="fade-in">${heading('LEADERBOARD','排行榜','每月每年級前 10 名。只顯示姓名、座號與分數——作答內容不會公開。',
    `<label class="field-label" for="board-month" style="margin:0 8px 0 0">月份</label><input id="board-month" type="month" value="${m}" style="max-width:170px">`)}
    <p class="small-text" style="margin:0 0 6px">開學至今：${esc(data.termStart)} 起算 · 上月：${esc(data.prevMonth)}</p>
    <div class="board-tabs segmented text" style="margin:14px 0 4px"><button data-board-tab="score" class="active">得分榜</button><button data-board-tab="progress">進步榜</button></div>
    <div id="board-body">${block('score',scoreTable)}</div></div>`;
  $('#board-month').onchange=e=>leaderboardPage(e.target.value||m);
  const body=$('#board-body');
  $$('[data-board-tab]').forEach(b=>b.onclick=()=>{
    $$('[data-board-tab]').forEach(x=>x.classList.toggle('active',x===b));
    body.innerHTML=block(b.dataset.boardTab,b.dataset.boardTab==='score'?scoreTable:progressTable);
  });
}
