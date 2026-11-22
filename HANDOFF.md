# 交接提示：MathPath 專案繼續重構（dispatch 拆分）

> 用途：把這份文件整份貼給另一個 WorkBuddy 帳號／新任務，即可無縫接手。

---

## 一、專案基本資料

| 項目 | 值 |
|---|---|
| 本機路徑 | `/Users/laokunleng/WorkBuddy AI/2026-11-12-11-55-37/mathpath` |
| 技術棧 | Python 標準庫 `http.server` + SQLite + 原生 JS（無框架、無打包器） |
| 入口 | `server.py`（後端）、`app.js`（前端 8585 行）、`index.html` |
| Git | `git@github.com:jm4tjv7v9r-max/mathpath.git`，主分支 `main` |
| 雲端部署 | Render，網域 **https://mathshomework.link**（推 `main` 會自動重新部署，約 1–2 分鐘） |
| 資料 | 雲端：Render 持久磁碟 SQLite + R2 網盤（圖片/備份）；本機 `data/mathpath.sqlite3` 只是開發副本 |
| 目前 HEAD | `bdb50af`（dispatch 拆分第 19 步，2026-11-22 已上線） |

**重要**：使用者實際在用的是雲端 `mathshomework.link`。本機 `data/` 是測試庫，可隨意造/清測試資料，**不會影響雲端**。

---

## 二、目前進度

`server.py` 的 `dispatch()` 是唯一的路由分發方法，原本 **3618 行、104 個頂層 if 分支**，是最大架構風險。

已完成 **19 步**拆分（HANDOFF 原列的 8 組全部清空），`dispatch` 降到 **154 行（減 96%）**，抽出 **20 個內聚方法、約 100 條路由**：

| 方法 | 領域 | 路由數 |
|---|---|---|
| `_dispatch_health` | 健康檢查 | 1 |
| `_dispatch_paper_keys` | 題目卷 | 4 |
| `_dispatch_score_grid` | 成績總表 | 10 |
| `_dispatch_paper_grades` | 紙本批改 | 5 |
| `_dispatch_papers` | 試卷 | 9 |
| `_dispatch_users` | 帳戶管理 | 7 |
| `_dispatch_classroom` | 課堂互動 | 6 |
| `_dispatch_attempts` | 作答紀錄 | 6 |
| `_dispatch_paper_grades_batch` | 批改批次／掃描 | 2 |
| `_dispatch_questions` | 題庫題目 | 20 |
| `_dispatch_drafts` | 批改草稿（清單／開啟／二次配對／卷面／方向／確認／刪除） | 7 |
| `_dispatch_paper_templates` | 卷面範本 | 4 |
| `_dispatch_auth` | session／login／比賽列表與寫入 | 4 |
| `_dispatch_ai_config` | AI 端點設定／測試／計費 | 3 |
| `_dispatch_ai_grading` | AI 批改品質統計 | 1 |
| `_dispatch_logins` | 登入紀錄 | 1 |
| `_dispatch_state` | 初始狀態（題庫／作答／統計／金幣） | 1 |
| `_dispatch_papers_to_tex` | 試卷轉 LaTeX | 1 |
| `_dispatch_coins` | 金幣（查詢／全班／獎勵） | 3 |
| `_dispatch_admin` | 管理員工具（health／storage／backup／vacuum／reset） | 5 |

每次拆分都是**純結構調整、行為不變**，並跑完 **550 個測試**才提交。第 10～19 步已於 2026-11-22 上線（`bdb50af`）。

---

## 三、必須遵守的慣例

1. **註解與 commit 訊息用繁體中文**，風格參考現有 commit（說明「為什麼」而不只是「做什麼」）。
2. **每次只抽一個內聚路由組**，跑完全量測試才提交，一次一個 commit，可單點回退。
3. 不改行為：抽出的方法沒有命中就回 `None`，讓 `dispatch` 繼續往下試。
4. 不要動 `data/` 以外的測試資料到雲端；不要 `git push --force`。
5. 提交前必跑：
   ```bash
   cd "/Users/laokunleng/WorkBuddy AI/2026-11-12-11-55-37/mathpath"
   python3 -m unittest test_server test_paper_templates test_latex test_storage test_homework
   # 期望：Ran 550 tests ... OK
   ```

---

## 四、抽取方法（照這個做，已驗證）

以抽 `paper-templates` 為例：

```python
path='server.py'
src=open(path,encoding='utf-8').read()
lines=src.split('\n')
# 1) 用「唯一且完整」的錨點定位塊的起、止（起點含、終點不含）
start_txt = "        if path == '/api/paper-templates' and method in ('GET', 'POST'):"
end_txt   = "        # ---------- 我的試卷：存起來、搜尋篩選、一鍵匯入題庫 ----------"
si = next(i for i,l in enumerate(lines) if l == start_txt)
ei = next(i for i,l in enumerate(lines) if l == end_txt)
block = lines[si:ei]
body = '\n'.join(block).rstrip('\n')

# 2) 先把 dispatch 裡的塊換成呼叫（順序很重要：先換再插入，否則塊文本會出現兩次）
call_txt = ('        hit = self._dispatch_paper_templates(method, path, body, user, token_hash, ip, headers)\n'
            '        if hit is not None:\n'
            '            return hit')
assert src.count(body) == 1
src = src.replace(body, call_txt, 1)

# 3) 再在 def dispatch 前插入新方法（方法體縮進保持 8 空格，千萬不要 dedent）
new_method = (
'    def _dispatch_paper_templates(self, method, path, body, user, token_hash, ip, headers):\n'
'        """卷面範本：列表／建立／刪除／套用版式。\n'
'\n'
'        從 dispatch 抽出的內聚路由組；沒有命中回 None，讓 dispatch 繼續往下試。\n'
'        """\n'
+ body + '\n'
'        return None\n'
)
disp_anchor = "    def dispatch(self, method, path, body, user, token_hash, ip, query=''):"
assert src.count(disp_anchor) == 1
src = src.replace(disp_anchor, new_method + '\n' + disp_anchor, 1)
open(path,'w',encoding='utf-8').write(src)
```

### ⚠️ 已踩過的坑（務必避開）

1. **不要 dedent**：`dispatch` 和新方法都是類別方法（縮進 4），方法體都是 8 空格。之前誤 dedent 成 4 導致 `IndentationError` / `'return' outside function`。
2. **docstring 縮進 8 空格**（方法體內），不是 4。
3. **末尾 `return None` 縮進 8 空格**（方法級），不是 12（否則只在最後一個 if 內執行）。
4. **替換順序**：先 `replace(block, call)` 再插入新方法；反過來 `src.count(body)` 會變 2 而斷言失敗。
5. **簽名要帶齊塊內用到的 dispatch 局部變數**：`token_hash`、`ip`、`query`、`headers`。漏了會在執行時 `NameError`（測試會抓到）。
6. **錨點要唯一**：用完整的 `if method == ... and path == '...'` 整行，不要用片段。
7. 抽完先 `python3 -c "import ast; ast.parse(open('server.py').read())"` 驗證語法，再跑測試。

---

## 五、剩餘零星路由（可選收尾）

HANDOFF 原列的 8 組已全部抽完。`dispatch` 只剩 4 個零星路由（約 55 行），可再合成一個 `_dispatch_misc`，把 `dispatch` 降到 100 行以內：

| 順序 | 路由 | 起點錨點（8 空格縮進） | 行數 | 依賴變數 |
|---|---|---|---|---|
| 1 | 紙本批改紀錄列表 | `if method == 'GET' and path == '/api/paper-grades':` | 21 | user, headers |
| 2 | 排行榜 | `if method == 'GET' and board_path:` | 7 | user, headers |
| 3 | 登出 | `if method == 'POST' and path == '/api/logout':` | 6 | body, token_hash, headers |
| 4 | 改密碼 | `if method == 'POST' and path == '/api/change-password':` | 21 | body, user, token_hash, headers |

> 注意：這 4 條都在「登入守衛 `if user is None:`」之後，抽出的方法呼叫點也必須放在守衛之後，否則未登入會繞過 401。
> 抽完後 `dispatch` 應只剩：初始化守衛、登入守衛、homework/mock 委派、12～13 個 `_dispatch_*` 呼叫。
> 若不想再抽，現狀 154 行也已足夠清楚，可直接轉向第八節的其他待辦。

### 查詢剩餘塊的指令（可重跑）

```bash
cd "/Users/laokunleng/WorkBuddy AI/2026-11-12-11-55-37/mathpath"
python3 - <<'PY'
import re
src=open('server.py',encoding='utf-8').read()
m=re.search(r'\n    def dispatch\(self.*?\n    def ', src, re.S)
body=m.group(0); lines=body.split('\n')
start_abs=src[:m.start()].count('\n')+2
print('dispatch 行數:', len(lines))
for i,l in enumerate(lines):
    if re.match(r'^        (if |match = |# ----------)', l):
        print(f'  L{start_abs+i}  {l.strip()[:78]}')
PY
```

---

## 六、本機開發／驗證環境

```bash
cd "/Users/laokunleng/WorkBuddy AI/2026-11-12-11-55-37/mathpath"

# 1) 起 mock AI（假的 OpenAI 相容端點，供離線測試出題/畫圖）
cd /tmp && python3 mock_ai2.py          # 監聽 127.0.0.1:8899

# 2) 起本機服務，指向 mock
cd "/Users/laokunleng/WorkBuddy AI/2026-11-12-11-55-37/mathpath"
MATH_AI_BASE_URL=http://127.0.0.1:8899/v1 MATH_AI_MODEL=mock-model \
MATH_AI_VISION_MODEL=mock-vision python3 server.py --port 8771
# 瀏覽 http://127.0.0.1:8771 ，教師帳號 teacher / Teach1234!（演示帳號）
```

> 這兩個長駐程序請用**背景任務**啟動（不要 `nohup`），否則會被回收。
> 若 `mock_ai2.py` 不存在，可用 `/tmp` 內既有的版本，或直接用真實 AI（需環境變數金鑰）。

### 驗證抽取是否成功的三個層次
1. `ast.parse` 語法 OK。
2. 全量 550 測試 OK。
3. 起服務後抽查被抽的端點，例如：
   ```bash
   curl -s -X POST http://127.0.0.1:8771/api/login -H 'Content-Type: application/json' \
     -H 'Origin: http://127.0.0.1:8771' -H 'Referer: http://127.0.0.1:8771/' \
     -d '{"username":"teacher","password":"Teach1234!"}' -c /tmp/cj
   curl -s http://127.0.0.1:8771/api/paper-templates -b /tmp/cj -H 'Origin: http://127.0.0.1:8771'
   ```

---

## 七、提交與部署

```bash
git add server.py
git commit -m "重構（dispatch 拆分第 10 步）：把 <領域> 的 N 個路由抽成 _dispatch_xxx，dispatch 只留呼叫。純結構調整，550 tests 全過。dispatch 累計 3618→<目前> 行"
git push origin main
```

推送後 Render 自動重新部署。約 1–2 分鐘後驗證：

```bash
curl -s https://mathshomework.link/api/health
# 期望：{"status":"ok",...,"questions":110,...}
```

> 部署中會短暫回 `502` 或空回應，屬正常，稍等再查。

---

## 八、其他待辦（非 dispatch，可選）

- `SELECT *` 已優化主要熱點（papers 列表、questions 列表改讀 `has_figure` 布林值，不讀圖片 BLOB）；其餘多為 `WHERE id=?` 詳情查詢，需完整欄位，不必改。
- `app.js`（8585 行）模組化：可用原生 ES module 按 pages/components 拆分（改動面大，建議獨立一輪）。
- AI 繪圖失敗率：雲端 `/api/health` 可看 `aiFailures`；若偏高，需要真實 DeepSeek 的錯誤日誌才能定位。

---

## 九、近期已修復的重要 Bug（避免重複踩）

1. **生產事故：整站初始化失敗 `FOREIGN KEY constraint failed`**
   根因：`initialize()` 回填 `paper_questions` 時，若 `questions.paper_id` 指向已刪除的卷（孤兒），在 `PRAGMA foreign_keys=ON` 下會失敗。
   已修：回填改 `JOIN papers` 只回填卷仍存在的題目；並在回填前**自癒清理孤兒**（`UPDATE questions SET paper_id=NULL ...`、`DELETE FROM paper_questions WHERE ... NOT IN (...)`）。
2. **刪除「已匯入題庫」的試卷失敗**（503）：刪卷時要先刪 `paper_questions` 關聯、並把 `questions.paper_id` 設 NULL。
3. **試卷卡片排版**：`.paper-grid` 用 `minmax(min(100%,330px),1fr)`；卡片內雙向細目表 `overflow-x:auto` + 儲存格 `nowrap`；隱藏表格 `caption`（summary 已寫標題）；按鈕 `flex-shrink:0`。改 CSS 後記得同步更新 `index.html` 的 `?v=` 版本號。
4. **圖形工作室外部 AI 同意框覆蓋預覽頁**：確認框要用 `modalRootAbove()` 開在當前層之上，並在 `aiCloseModal` 後還原 `figStudio`。
5. **XeLaTeX 匯出**：中文文本裡的裸希臘字母（λ、μ…）要包進數學模式，否則中文字體缺字形印成空白。

---

## 十、開場建議（貼完這份後可直接說）

> 「`dispatch` 拆分已完成 19 步、HANDOFF 原列的 8 組全部抽完（3618→154 行，20 個 `_dispatch_*`，線上 `bdb50af`）。
> 請先跑一次 550 測試確認基線，然後可選：把剩餘 4 個零星路由（paper-grades 列表／排行榜／logout／change-password）合成 `_dispatch_misc`，呼叫點要放在登入守衛之後；完成後 `dispatch` 可降到 100 行以內。
> 之後轉向第八節的其他待辦：`app.js` 模組化、AI 繪圖失敗率、題庫答案核驗流程。」
