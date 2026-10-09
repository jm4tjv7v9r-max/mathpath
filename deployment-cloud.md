# 免費部署架構改造說明（Cloudflare R2 + 免費平台）

> 先講清楚：**本專案是 Python 標準庫後端 + SQLite，不是 Node.js。**
> 提示詞裡的 Node.js、Neon Postgres 假設不成立，所以下面會標明「哪些照做、哪些要改做法」。
> 原有業務邏輯（登入、佈置作業、作答、批改、評分、模擬測驗）全部保留，只動「檔案存哪裡」。

---

## 一、修改清單（對照你的專案）

### 新增檔案

| 檔案 | 作用 |
|---|---|
| `storage.py` | 檔案儲存層。預設存資料庫；設定 R2 後改存 Cloudflare R2。內含 S3 SigV4 簽名（純標準庫，不加依賴） |
| `test_storage.py` | 儲存層測試（用本機假 S3 端點驗證上傳／讀取／簽名） |

### 修改的檔案

| 檔案 | 改了什麼 |
|---|---|
| `server.py` | ① 新增 `self.storage = Storage(fail)`；② `questions` 表增量加 `figure_key`；③ 上傳作答圖片、教師批註、題目圖形時，若啟用 R2 就上傳物件、資料庫只存 key；④ 讀取圖片／批註／圖形時，有 key 就從 R2 取回；⑤ `question_row`／`attempt_public` 把「有 key」也算作「有檔案」；⑥ AI 批註送模型前，若圖片在 R2 先取回；⑦ 新增 `GET /api/health` |
| `homework.py` | `attempts` 表增量加 `image_key`、`annotation_key` |
| `deployment.txt` | 補上第 22～24 條（物件儲存、環境變數、健康檢查） |

### 關於「移除本機資料夾儲存」

**本專案原本就沒有把上傳檔案寫到伺服器資料夾**——圖片是以 BLOB 存在 SQLite 裡。
所以這次不是「移除本機儲存」，而是**把二進位從資料庫搬到 R2**：

| | 之前 | 啟用 R2 後 |
|---|---|---|
| 作答手寫照片 | `attempts.image`（BLOB） | `attempts.image_key`（字串，例：`attempts/202610/9f3c….png`） |
| 教師批註圖 | `attempts.annotation`（BLOB） | `attempts.annotation_key` |
| 題目圖形 | `questions.figure`（BLOB） | `questions.figure_key` |

兩者都**不寫入伺服器本機資料夾**。差別在：R2 模式讓資料庫保持輕量，且檔案不會隨容器重啟而消失。

---

## 二、R2 連接設定

### 1. 在 Cloudflare 建立 R2

1. Cloudflare 後台 → **R2** → Create bucket，例如 `mathpath`
2. **不要**開啟 Public access（本專案由後端 API 讀取，bucket 保持私有）
3. R2 → **Manage API Tokens** → Create API Token，權限選 **Object Read & Write**，範圍限定該 bucket
4. 記下：**Access Key ID**、**Secret Access Key**、你的 **Account ID**

### 2. 環境變數

```bash
R2_ACCOUNT_ID=你的帳號ID
R2_ACCESS_KEY_ID=你的AccessKeyID
R2_SECRET_ACCESS_KEY=你的SecretAccessKey
R2_BUCKET=mathpath
# 可選：物件 key 前綴，例如不同學校分開
# R2_PREFIX=school-a
# 可選：自訂 S3 相容端點（本機測試／自架 MinIO；http 只允許 localhost）
# R2_ENDPOINT=
```

四個必填變數**只要少一個，就自動退回資料庫後端**（不會上傳到一半才失敗），
並在 `/api/health` 的 `storage.error` 說明原因。

### 3. 確認是否生效

```bash
curl http://127.0.0.1:8765/api/health
```

```json
{"status":"ok","storage":{"mode":"r2","bucket":"mathpath","configured":true,"error":""},"ai":{...},"questions":16}
```

`mode` 是 `db` 代表仍存在資料庫；是 `r2` 代表已上傳到物件儲存。

---

## 三、部署步驟（全部免費方案）

| 元件 | 平台 | 免費額度重點 |
|---|---|---|
| 前端靜態檔 | Cloudflare Pages | 無限流量、`*.pages.dev` 二級域名 |
| 後端 | Render Free Web Service | 750 小時/月，**閒置會休眠，冷啟動約 30–60 秒** |
| 檔案 | Cloudflare R2 | 10 GB 儲存、每月 100 萬次讀 + 100 萬次寫（Class A/B） |
| 資料庫 | （見下方警告） | — |

### 步驟

1. **上傳程式碼到 GitHub**
2. **Render → New Web Service**，連接該 repo
   - Build Command：`pip install -r requirements.txt`（本專案無第三方依賴，可留空或 `pip install pypdf`）
   - Start Command：`python server.py --host 0.0.0.0 --port $PORT`
   - 加入上面四個 `R2_*` 環境變數
   - Health Check Path：`/api/health`
3. **Cloudflare Pages**：連接同一 repo，Build 留空，Output 目錄填專案根目錄（`index.html`、`app.js`、`styles.css`）
4. 開啟 `https://<你的服務>.onrender.com`，用 `/api/health` 確認 `storage.mode` 是 `r2`

> `--host 0.0.0.0` 僅供平台容器內使用；本機內網請照原本用內網 IP。

---

## 四、⚠️ 三個必須先知道的限制

### 1. 資料庫不是 Postgres，是 SQLite（最重要）

本專案用 SQLite 單一檔案。**Render 免費版沒有持久磁碟**，容器重啟後資料庫會被清空——這比檔案遺失更嚴重（帳號、作業、分數都會消失）。

三個選擇：

| 方案 | 說明 | 免費？ |
|---|---|---|
| **A. 先只上 R2，資料庫留在本機/校內主機** | 最省事，維持現狀 | ✅ |
| **B. Render 付費 Persistent Disk** | 掛載 `/var/data`，SQLite 放那裡 | ❌ 需付費 |
| **C. 改用 Neon Postgres** | 需要改寫資料層（`sqlite3` → `psycopg`），**這是另一個獨立工作，不是改幾行** | ✅ |

**建議先做 A**：R2 解決了「檔案會消失」的問題，資料庫先放在有磁碟的地方。
要搬到 Neon 我可以另外做，但那是重寫資料存取層，不是設定調整。

### 2. 前後端拆開會導致「登不進去」

本專案的登入用 cookie，目前是 `SameSite=Lax`。若前端放 `xxx.pages.dev`、後端在 `xxx.onrender.com`，屬於**跨站**，瀏覽器會擋掉 cookie，結果是「登入成功但馬上又變訪客」。

要拆開就得同時改：`SameSite=None; Secure`、CORS 允許來源並帶 credentials、CSRF 檢查放行該來源——安全性設定會變複雜，**不建議學生專案這樣做**。

**建議：前端與後端都放 Render（同源），不要用 Pages 當主要入口。** Pages 只當備份或純展示。

### 3. 學生手寫照片屬於個人資料

把學生手寫作答上傳到 Cloudflare R2，等於**把個人資料傳送到第三方雲端**（且可能出境）。學校使用前需要告知學生與家長並取得同意；本專案原有的「外部 AI 傳送需同意」機制是針對模型，不含檔案儲存，請自行在政策上補上。

---

## 五、測試結果

```
python3 -B -m unittest discover -s . -p 'test_*.py'
Ran 91 tests ... OK      # 84 原有 + 7 新增儲存層測試
```

新增測試涵蓋：
- 預設為資料庫後端，且不上傳到物件儲存
- R2 設定不完整 → 退回資料庫並說明原因
- 自訂端點用 http 且非 localhost → 拒絕
- 上傳後**資料庫只留 key、BLOB 為 NULL**，物件端點收到帶 SigV4 簽名的 PUT
- 讀取往返內容一致（作答圖片、題目圖形、教師批註）
- R2 不可用時回 503 且**不寫入任何作答紀錄**
- `R2_PREFIX` 正確套用到 key 與請求路徑

---

## 六、一步一步：把網站放到網上並真正運行（Render 免費版）

> 這是**單一服務**做法：前端與後端都由同一個 Render 服務提供。
> 千萬不要拆成 Cloudflare Pages + Render——跨網域會讓登入 cookie 失效，結果「登得進去卻馬上變訪客」。

### 第 0 步：決定用哪一份資料夾

`outputs/` 底下有多份副本。請**只用 `outputs/mathpath`**（正本）。
要先搬資料的話：`cp "outputs/MathPath 5/data/mathpath.sqlite3" "outputs/mathpath/data/"`。

### 第 1 步：準備 GitHub 儲存庫

```bash
cd "outputs/mathpath"
git init
git add .
git commit -m "MathPath 數學作業平台"
```

**確認沒有把資料庫加進去**（這一步很重要，裡面有密碼）：

```bash
git status --short | grep data/     # 應該沒有任何輸出
```

在 GitHub 建立新的空 repository（**不要**勾選 README / .gitignore），然後：

```bash
git remote add origin https://github.com/你的帳號/你的repo.git
git branch -M main
git push -u origin main
```

> 已內建 `.gitignore` 排除 `data/`、`__pycache__/`。
> 已內建 `requirements.txt`（只有 pypdf）與 `render.yaml`。

### 第 2 步：在 Render 建立服務

1. 到 https://render.com 用 GitHub 登入
2. **New → Blueprint**，選你剛建立的 repo（它會讀 `render.yaml`）
   - 若不想用 Blueprint：**New → Web Service**，手動填：
     - Runtime：`Python`
     - Build Command：`pip install -r requirements.txt`
     - Start Command：`python server.py --host 0.0.0.0 --port $PORT`
     - Plan：`Free`
     - Health Check Path：`/api/health`
3. `PYTHON_VERSION` 設 `3.13`
4. 按 **Create Web Service**，等 3–5 分鐘

### 第 3 步：確認網站活著

Render 會給你一個網址，例如 `https://mathpath-xxxx.onrender.com`。

開這兩個網址檢查：

```
https://mathpath-xxxx.onrender.com/api/health      → 應看到 {"status":"ok",...}
https://mathpath-xxxx.onrender.com/                → 應看到登入畫面
```

### 第 4 步：立刻做的安全設定

1. 用 `teacher / Teach1234!` 登入
2. 到「設定與隱私」→ **更換密碼**（兩組示範帳號都要換）
3. 若要使用 R2：在 Render 的 Environment 加入 `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET`，重新部署後 `/api/health` 的 `storage.mode` 會變成 `r2`

### 第 5 步：以後要更新程式

```bash
git add .
git commit -m "更新"
git push
```

Render 會自動重新部署。

---

## ⚠️ 免費版三個一定會遇到的事

1. **首次開啟很慢**：免費服務閒置會休眠，第一次載入要等 30–60 秒。
2. **資料會在重新部署時清空**：SQLite 存在容器裡，Render 免費版沒有持久磁碟。
   重新部署、`git push`、或服務重啟後，自建的班級／作業／學生帳號都會不見（16 題示範題庫會自動重建）。
   **示範可以，真正要用必須換資料庫**——最穩的是改成 Neon Postgres，但那需要改寫資料層（另一個工作）。
3. **AI 沒接**：要接模型直接在「模型端點」頁填，不用重新部署。
