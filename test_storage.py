"""檔案儲存層測試：預設資料庫後端，設定 R2 後改存物件儲存。

用本機假 S3 端點驗證：上傳／讀取往返、資料庫只保留 key 字串（不存二進位）、
簽名標頭格式，以及設定不完整或端點不可用時的行為。所有資料都在臨時目錄。
"""
import base64
import hashlib
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import server
import test_server

PNG = test_server.png_url()
PNG_BYTES = base64.b64decode(PNG.split(',', 1)[1])


class FakeS3(BaseHTTPRequestHandler):
    store = {}
    requests = []

    def log_message(self, *args):
        pass

    def _key(self):
        return self.path.lstrip('/')

    def do_PUT(self):
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(length)
        FakeS3.store[self._key()] = (body, self.headers.get('Content-Type'))
        FakeS3.requests.append(('PUT', self.path, {k.lower(): v for k, v in self.headers.items()}))
        self.send_response(200)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        item = FakeS3.store.get(self._key())
        if not item:
            self.send_response(404)
            self.end_headers()
            return
        body, mime = item
        self.send_response(200)
        self.send_header('Content-Type', mime or 'application/octet-stream')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_DELETE(self):
        FakeS3.store.pop(self._key(), None)
        self.send_response(204)
        self.end_headers()


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='mathpath-storage-')
        self.addCleanup(self.tmp.cleanup)
        FakeS3.store, FakeS3.requests = {}, []
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), FakeS3)
        self.addCleanup(self.server.server_close)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.thread.join, 2)
        self.endpoint = f'http://127.0.0.1:{self.server.server_address[1]}'

    def make_app(self, env=None):
        with patch.dict('os.environ', env or {}, clear=True):
            app = server.Application(Path(self.tmp.name) / 'data')
            app.safe_initialize()
            return app

    def r2_env(self, **overrides):
        env = {'R2_ACCOUNT_ID': 'abc123', 'R2_ACCESS_KEY_ID': 'key-id',
               'R2_SECRET_ACCESS_KEY': 'secret', 'R2_BUCKET': 'mathpath',
               'R2_ENDPOINT': self.endpoint}
        env.update(overrides)
        return env

    def call(self, app, method, path, body, user):
        return app.dispatch(method, path, body or {}, user, None, '127.0.0.1')[0]

    def users(self, app):
        with app.db() as db:
            return (db.execute('SELECT * FROM users WHERE id=1').fetchone(),
                    db.execute('SELECT * FROM users WHERE id=2').fetchone())

    # ---------- 預設後端 ----------
    def test_default_is_database_backend_and_health_reports_it(self):
        app = self.make_app()
        self.assertEqual(app.storage.mode, 'db')
        health = self.call(app, 'GET', '/api/health', {}, None)
        self.assertEqual(health['status'], 'ok')
        self.assertEqual(health['storage']['mode'], 'db')
        self.assertFalse(health['storage']['configured'])
        # 未設定 R2 時，圖片照樣可用，只是存在資料庫（不寫入伺服器資料夾）。
        student, _ = self.users(app)
        attempt = self.call(app, 'POST', '/api/attempts',
                            {'questionId': 1, 'answerText': '', 'image': PNG}, student)['attempt']
        with app.db() as db:
            row = db.execute('SELECT image,image_key FROM attempts WHERE id=?', (attempt['id'],)).fetchone()
        self.assertIsNotNone(row['image'])
        self.assertIsNone(row['image_key'])
        self.assertEqual(FakeS3.store, {}, '未設定 R2 時不應上傳到物件儲存')

    def test_incomplete_config_falls_back_to_database(self):
        app = self.make_app({'R2_ACCOUNT_ID': 'abc123', 'R2_BUCKET': 'mathpath'})
        self.assertEqual(app.storage.mode, 'db')
        self.assertIn('不完整', app.storage.public()['error'])

    def test_insecure_custom_endpoint_is_rejected(self):
        app = self.make_app(self.r2_env(R2_ENDPOINT='http://storage.example.com'))
        self.assertEqual(app.storage.mode, 'db')
        self.assertIn('HTTPS', app.storage.public()['error'])

    # ---------- R2 後端 ----------
    def test_r2_upload_keeps_only_key_and_streams_back(self):
        app = self.make_app(self.r2_env())
        self.assertEqual(app.storage.mode, 'r2')
        self.assertEqual(self.call(app, 'GET', '/api/health', {}, None)['storage']['bucket'], 'mathpath')
        student, teacher = self.users(app)
        attempt = self.call(app, 'POST', '/api/attempts',
                            {'questionId': 1, 'answerText': '', 'image': PNG}, student)['attempt']
        with app.db() as db:
            row = db.execute('SELECT image,image_key FROM attempts WHERE id=?', (attempt['id'],)).fetchone()
        # 資料庫只存 key，不存二進位。
        self.assertIsNone(row['image'], '啟用 R2 後資料庫不應再存 BLOB')
        self.assertTrue(row['image_key'].startswith('attempts/'))
        self.assertTrue(row['image_key'].endswith('.png'))
        # 物件確實上傳，且帶 S3 簽名標頭。
        self.assertEqual(len(FakeS3.store), 1)
        method, path, headers = FakeS3.requests[0]
        self.assertEqual(method, 'PUT')
        self.assertEqual(path, '/mathpath/' + row['image_key'])
        self.assertIn('AWS4-HMAC-SHA256', headers.get('authorization', ''))
        self.assertIn('Credential=key-id/', headers.get('authorization', ''))
        self.assertEqual(headers.get('x-amz-content-sha256'), hashlib.sha256(PNG_BYTES).hexdigest())
        # 讀取仍經由本服務的儲存層（HTTP 路由沿用原有登入與權限檢查）。
        data, mime = app.storage.get(row['image_key'])
        self.assertEqual(data, PNG_BYTES)
        self.assertEqual(mime, 'image/png')

    def test_r2_question_figure_and_annotation_roundtrip(self):
        app = self.make_app(self.r2_env())
        _, teacher = self.users(app)
        self.call(app, 'POST', '/api/questions/import',
                  {'questions': [{'title': '直角三角形', 'content': '求斜邊。', 'topic': '幾何', 'level': 1,
                                  'points': 5, 'answer': '5 cm', 'figure': PNG}]}, teacher)
        with app.db() as db:
            row = db.execute('SELECT figure,figure_key FROM questions ORDER BY id DESC LIMIT 1').fetchone()
        self.assertIsNone(row['figure'])
        self.assertTrue(row['figure_key'].startswith('figures/'))
        body, mime = app.storage.get(row['figure_key'])
        self.assertEqual(body, PNG_BYTES)
        self.assertEqual(mime, 'image/png')
        # 教師批註同樣只存 key。
        student, _ = self.users(app)
        attempt = self.call(app, 'POST', '/api/attempts',
                            {'questionId': 1, 'answerText': '', 'image': PNG}, student)['attempt']
        self.call(app, 'POST', f"/api/attempts/{attempt['id']}/annotation", {'image': PNG}, teacher)
        with app.db() as db:
            ann = db.execute('SELECT annotation,annotation_key FROM attempts WHERE id=?', (attempt['id'],)).fetchone()
        self.assertIsNone(ann['annotation'])
        self.assertTrue(ann['annotation_key'].startswith('annotations/'))

    def test_r2_unreachable_returns_503_and_saves_nothing(self):
        app = self.make_app(self.r2_env(R2_ENDPOINT='http://127.0.0.1:1'))
        student, _ = self.users(app)
        with self.assertRaises(server.APIError) as context:
            self.call(app, 'POST', '/api/attempts',
                      {'questionId': 1, 'answerText': '', 'image': PNG}, student)
        self.assertEqual(context.exception.status, 503)
        with app.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM attempts').fetchone()[0], 0)

    def test_r2_prefix_is_applied(self):
        app = self.make_app(self.r2_env(R2_PREFIX='school-a'))
        student, _ = self.users(app)
        attempt = self.call(app, 'POST', '/api/attempts',
                            {'questionId': 1, 'answerText': '', 'image': PNG}, student)['attempt']
        with app.db() as db:
            key = db.execute('SELECT image_key FROM attempts WHERE id=?', (attempt['id'],)).fetchone()['image_key']
        self.assertTrue(key.startswith('school-a/attempts/'))
        self.assertTrue(any(p.startswith('/mathpath/school-a/') for _, p, _ in FakeS3.requests))


if __name__ == '__main__':
    unittest.main(verbosity=2)
