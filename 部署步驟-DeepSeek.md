# MathPath 部署步驟（Render + DeepSeek）

適用：已經有 DeepSeek API key，要把 MathPath 放到公網並接上 AI。

---

## 第 1 步：推送程式碼到 GitHub

用 **GitHub Desktop**：

1. 開啟 GitHub Desktop
2. 左上角確認 Repository 是 **mathpath**
3. 按上方 **Push origin**（有 2 個待推送 commit）
4. 等到沒有待推送項目，表示完成

> 若用終端機：
> ```bash
> cd "/Users/laokunleng/WorkBuddy AI/2026-10-08-13-04-13/outputs/mathpath"
> git push https://<你的TOKEN>@github.com/jm4tjv7v9r-max/mathpath.git main
> ```

---

## 第 2 步：到 Render 設定環境變數

1. 開啟 https://dashboard.render.com
2. 點你的 **mathpath** 服務（Web Service）
3. 左邊選單點 **Environment**
4. 按 **Add Environment Variable**，逐筆加入下面表格
5. 全部加完後 Render 會自動重新部署

| Key | Value | 必填 |
|---|---|---|
| `PYTHON_VERSION` | `3.13` | ✅ |
| `MATH_AI_BASE_URL` | `https://api.deepseek.com/v1` | ✅ |
| `MATH_AI_MODEL` | `deepseek-flash` | ✅ |
| `MATH_AI_VISION_MODEL` | `deepseek-flash` | ✅ |
| `MATH_AI_API_KEY` | `sk-xxxxx...`（你的 DeepSeek 金鑰）| ✅ |
| `MATH_AI_THINKING` | `off` | 建議 |
| `MATH_ADMIN_TOKEN` | 自己想一組長密碼 | 強烈建議 |
| `MATH_STUDENT_PASSWORD` | 學生的新密碼（至少 10 字）| 強烈建議 |
| `MATH_TEACHER_PASSWORD` | 教師的新密碼（至少 10 字）| 強烈建議 |

> **為什麼要用 `deepseek-flash`？**
> DeepSeek 官方文件：Vision（圖片辨識）**只有 flash 支援**，pro 不支援。
> MathPath 需要看學生手寫答案和題目圖形，所以必須用 flash。

> **MATH_AI_THINKING=off 是什麼？**
> DeepSeek-V4 預設開「思考模式」，輸出 token 會暴增，而輸出比輸入貴 4 倍。
> 設 `off` 可省約 2/3 費用。教師之後可在網站上自行切換。

---

## 第 3 步：等待部署完成

1. Render 服務頁 → **Events** 頁籤
2. 看到 `Deploy succeeded` 或狀態變成綠色 **Live** 即完成
3. 首次約 3–5 分鐘，之後更新約 1–2 分鐘

若失敗，看 **Logs** 頁籤的紅字錯誤。

---

## 第 4 步：驗證上線

打開你的網址（Render 服務頁頂部，例如 `https://mathpath-s5hr.onrender.com`）：

| 檢查 | 網址 | 預期結果 |
|---|---|---|
| 1. 健康檢查 | `網址/api/health` | 出現 `{"status":"ok",...}` |
| 2. 首頁 | `網址` | 黑色 MathPath 登入頁 |
| 3. 教師登入 | 用 `teacher` + 你的新密碼 | 進入教師首頁 |
| 4. 模型端點 | 教師 →「模型端點」頁 | 文字模型顯示 `deepseek-flash` |
| 5. AI 測試 | 按「測試文字模型」 | 出現「測試通過」|
| 6. 省錢模式 | 同一頁勾選框 | 「省錢模式」已勾選，可隨時切換 |

---

## 第 5 步：上線後必做

1. ✅ 改掉 `student`、`teacher` 的預設密碼（用環境變數或登入後改）
2. ✅ 設定 `MATH_ADMIN_TOKEN`（鎖住端點設定頁，避免別人亂改）
3. ✅ 到 DeepSeek 後台設定用量上限，避免超支

---

## 費用參考（DeepSeek 官方定價，USD / 1M token）

| | deepseek-flash |
|---|---|
| 輸入（快取未中）離峰 / 尖峰 | $0.15 / $0.3 |
| 輸出 離峰 / 尖峰 | $0.6 / $1.2 |

- 尖峰時段：週一至五 01:00–04:00 及 06:00–10:00 UTC
  = **香港時間 09:00–12:00、14:00–18:00**（正好是上課時間）
- 離峰半價

**一班 40 人、每天批改一份作業（省錢模式）**：約 HKD 12–40／月

---

## 常見問題

**Q：網站第一次開很慢？**
A：Render 免費版 15 分鐘沒人訪問會休眠，下次訪問要等 20–30 秒喚醒。正常現象。

**Q：重新部署後資料不見？**
A：Render 免費版的 SQLite 會在重新部署時清空。正式使用需換 Postgres。

**Q：教師改不了 AI 設定？**
A：「省錢模式」任何教師都能切換。端點／金鑰需要 `MATH_ADMIN_TOKEN`。

**Q：AI 沒反應？**
A：檢查 `MATH_AI_BASE_URL` 是否為 `https://api.deepseek.com/v1`、金鑰是否正確、
   DeepSeek 帳戶是否有餘額。
