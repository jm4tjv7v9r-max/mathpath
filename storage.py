"""檔案儲存層：預設把二進位存進 SQLite；設定 Cloudflare R2 後改存物件儲存。

重點（對應部署要求）：
- 二進位檔案**不寫入伺服器本機資料夾**。預設後端把 bytes 存在 SQLite 的 BLOB 欄位（單一檔案、可備份、離線可用）；
  設定 R2 後，bytes 上傳到 Cloudflare R2，資料庫只保留 key 字串（例如 `attempts/9f3c….png`）。
- 讀取一律經由本服務的 API（`/api/attempts/:id/image` 等），沿用原有登入與權限檢查；
  bucket 保持私有，不開放公開讀取，也不在前端暴露 R2 憑證。
- 只用 Python 標準庫實作 S3 相容簽名（SigV4），不新增依賴。

環境變數（設定齊全才會啟用 R2；否則維持資料庫後端）：
    R2_ACCESS_KEY_ID      R2 API Token 的 Access Key ID
    R2_SECRET_ACCESS_KEY  R2 API Token 的 Secret Access Key
    R2_BUCKET             bucket 名稱
    R2_ACCOUNT_ID         Cloudflare 帳號 ID（用預設端點時必填；改自訂端點時可省略）
    R2_REGION             可選，簽名用的 region（預設 auto，Cloudflare R2 固定用 auto；
                         改用 AWS S3／Backblaze B2／Wasabi 等服務時要填該 bucket 的 region）
    R2_ENDPOINT           可選，自訂 S3 相容端點（本機測試或自架 MinIO 用；http 只允許 localhost）
    R2_PREFIX             可選，物件 key 的前綴（預設空）
"""
import hashlib
import hmac
import secrets
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPHandler, HTTPSHandler, ProxyHandler, Request, build_opener

MAX_OBJECT = 12 * 1024 * 1024
# 備份檔（資料庫快照／題庫歸檔）不是圖片，走另一條路徑與上限。
MAX_BACKUP_OBJECT = 512 * 1024 * 1024
BACKUP_TIMEOUT = 300
ALLOWED_MIME = ('image/png', 'image/jpeg', 'image/webp')
EXTENSIONS = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'}


class StorageError(Exception):
    pass


def _sha256(data):
    return hashlib.sha256(data).hexdigest()


def _hmac(key, message):
    return hmac.new(key, message.encode(), hashlib.sha256).digest()


class Storage:
    """物件儲存抽象層。mode 為 'db' 時由呼叫端直接寫 BLOB，本類別只提供 key 產生與讀寫。"""

    def __init__(self, fail):
        self.fail = fail
        self.mode = 'db'
        self.bucket = ''
        self.endpoint = ''
        self.host = ''
        self.region = 'auto'
        self.prefix = ''
        self.access_key = ''
        self.secret_key = ''
        self.last_error = ''
        self.opener = build_opener(ProxyHandler({}), HTTPSHandler(), HTTPHandler())
        self.configure_from_env()

    # ---------- 設定 ----------
    def configure_from_env(self):
        import os
        account = os.environ.get('R2_ACCOUNT_ID', '').strip()
        self.access_key = os.environ.get('R2_ACCESS_KEY_ID', '').strip()
        self.secret_key = os.environ.get('R2_SECRET_ACCESS_KEY', '').strip()
        self.bucket = os.environ.get('R2_BUCKET', '').strip()
        self.prefix = os.environ.get('R2_PREFIX', '').strip().strip('/')
        self.region = os.environ.get('R2_REGION', '').strip() or 'auto'
        custom = os.environ.get('R2_ENDPOINT', '').strip().rstrip('/')
        required = (self.access_key, self.secret_key, self.bucket)
        if not any((account, custom) + required):
            self.mode = 'db'
            return
        # 端點有兩種來源：Cloudflare 帳號 ID 組出預設端點，或直接給一個 S3 相容端點。
        if not all(required) or not (account or custom):
            self.last_error = ('R2 設定不完整（需要 R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY、R2_BUCKET，'
                               '以及 R2_ACCOUNT_ID 或 R2_ENDPOINT 其中一項）。')
            self.mode = 'db'
            return
        if account and not all(c.isalnum() or c in '-_' for c in account):
            self.last_error = 'R2_ACCOUNT_ID 格式不正確。'
            self.mode = 'db'
            return
        if not all(c.isalnum() or c in '-_' for c in self.region):
            self.last_error = 'R2_REGION 格式不正確。'
            self.mode = 'db'
            return
        if custom:
            parsed = urlsplit(custom)
            local = parsed.hostname in ('127.0.0.1', 'localhost')
            if parsed.scheme not in ('http', 'https') or not parsed.hostname or (parsed.scheme == 'http' and not local):
                self.last_error = 'R2_ENDPOINT 無效；非本機端點必須使用 HTTPS。'
                self.mode = 'db'
                return
            self.endpoint = custom
        else:
            self.endpoint = f'https://{account}.r2.cloudflarestorage.com'
        self.host = urlsplit(self.endpoint).netloc
        self.mode = 'r2'
        self.opener = build_opener(ProxyHandler({}), HTTPSHandler(), HTTPHandler())

    def public(self):
        return {'mode': self.mode, 'bucket': self.bucket if self.mode == 'r2' else '',
                'region': self.region if self.mode == 'r2' else '',
                'endpoint': self.host if self.mode == 'r2' else '',
                'configured': self.mode == 'r2', 'error': self.last_error}

    # ---------- key ----------
    def new_key(self, folder, mime):
        ext = EXTENSIONS.get(mime, 'bin')
        name = f'{folder}/{time.strftime("%Y%m")}/{secrets.token_hex(16)}.{ext}'
        return f'{self.prefix}/{name}' if self.prefix else name

    @staticmethod
    def mime_from_key(key):
        lowered = key.lower()
        if lowered.endswith(('.jpg', '.jpeg')):
            return 'image/jpeg'
        if lowered.endswith('.webp'):
            return 'image/webp'
        return 'image/png'

    # ---------- 寫入 / 讀取 ----------
    def put(self, folder, data, mime):
        if mime not in ALLOWED_MIME:
            self.fail(400, '只接受 PNG、JPEG 或 WebP 圖片。')
        if len(data) > MAX_OBJECT:
            self.fail(400, '檔案過大。')
        key = self.new_key(folder, mime)
        try:
            self._request('PUT', key, data, mime)
        except StorageError as exc:
            self.fail(503, f'物件儲存暫時無法使用，未保存檔案：{exc}')
        return key

    def key_for(self, folder, name):
        """組出物件 key（套用 R2_PREFIX）。備份檔名由呼叫端決定，方便日後辨識。"""
        path = f'{folder}/{name}'
        return f'{self.prefix}/{path}' if self.prefix else path

    def put_object(self, folder, name, data, mime):
        """上傳非圖片物件（例如備份檔）。

        圖片有嚴格的白名單與 12MB 上限；備份走這條路徑，只檢查大小。
        檔名由呼叫端決定並帶時間戳，這樣即使資料庫整份遺失，
        也能只憑網盤上的檔名判斷哪一份最新。
        """
        if len(data) > MAX_BACKUP_OBJECT:
            self.fail(400, f'備份檔過大（超過 {MAX_BACKUP_OBJECT // 1024 // 1024} MB），未上傳。')
        key = self.key_for(folder, name)
        try:
            self._request('PUT', key, data, mime, timeout=BACKUP_TIMEOUT)
        except StorageError as exc:
            self.fail(503, f'物件儲存暫時無法使用，備份未上傳：{exc}')
        return key

    def get(self, key):
        try:
            return self._request('GET', key)
        except StorageError as exc:
            self.fail(503, f'讀取物件儲存失敗：{exc}')

    def delete(self, key):
        try:
            self._request('DELETE', key)
        except StorageError:
            # 刪除失敗不影響主要流程；殘留物件可由生命週期規則清理。
            return False
        return True

    # ---------- S3 相容請求（SigV4） ----------
    def _sign(self, method, key, payload_hash, amz_date, date_stamp):
        host = self.host
        canonical_uri = '/' + self.bucket + '/' + key
        canonical_headers = (f'host:{host}\n'
                             f'x-amz-content-sha256:{payload_hash}\n'
                             f'x-amz-date:{amz_date}\n')
        signed_headers = 'host;x-amz-content-sha256;x-amz-date'
        canonical_request = '\n'.join([method, canonical_uri, '', canonical_headers, signed_headers, payload_hash])
        scope = f'{date_stamp}/{self.region}/s3/aws4_request'
        string_to_sign = '\n'.join(['AWS4-HMAC-SHA256', amz_date, scope, _sha256(canonical_request.encode())])
        signing_key = _hmac(_hmac(_hmac(_hmac(('AWS4' + self.secret_key).encode(), date_stamp), self.region), 's3'), 'aws4_request')
        signature = hmac.new(signing_key, string_to_sign.encode(), hashlib.sha256).hexdigest()
        return (f'AWS4-HMAC-SHA256 Credential={self.access_key}/{scope}, '
                f'SignedHeaders={signed_headers}, Signature={signature}')

    def _request(self, method, key, data=None, mime=None, timeout=30):
        now = datetime.now(timezone.utc)
        amz_date = now.strftime('%Y%m%dT%H%M%SZ')
        date_stamp = now.strftime('%Y%m%d')
        payload = data or b''
        payload_hash = _sha256(payload)
        url = f'{self.endpoint}/{self.bucket}/{key}'
        headers = {'Host': self.host, 'x-amz-content-sha256': payload_hash,
                   'x-amz-date': amz_date, 'Authorization': self._sign(method, key, payload_hash, amz_date, date_stamp)}
        if mime:
            headers['Content-Type'] = mime
        request = Request(url, data=payload if method in ('PUT', 'POST') else None, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=timeout) as response:
                body = response.read()
                return (body, response.headers.get('Content-Type') or self.mime_from_key(key)) if method == 'GET' else True
        except HTTPError as exc:
            raise StorageError(f'HTTP {exc.code}') from None
        except (URLError, OSError, ValueError) as exc:
            raise StorageError(str(exc)[:120]) from None
