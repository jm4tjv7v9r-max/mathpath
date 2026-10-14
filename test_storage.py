"""檔案儲存層測試：預設資料庫後端，設定 R2 後改存物件儲存。

用本機假 S3 端點驗證：上傳／讀取往返、資料庫只保留 key 字串（不存二進位）、
簽名標頭格式，以及設定不完整或端點不可用時的行為。所有資料都在臨時目錄。
"""
import base64
from contextlib import contextmanager
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

    def test_region_defaults_to_auto_and_is_used_in_signature(self):
        """Cloudflare R2 的簽名 region 固定是 auto。"""
        app = self.make_app(self.r2_env())
        self.assertEqual(app.storage.public()['region'], 'auto')
        student, _ = self.users(app)
        self.call(app, 'POST', '/api/attempts',
                  {'questionId': 1, 'answerText': '', 'image': PNG}, student)
        self.assertIn('/auto/s3/aws4_request', FakeS3.requests[-1][2]['authorization'])

    def test_custom_endpoint_accepts_other_providers_region(self):
        """改用 AWS S3／Backblaze B2／Wasabi 等：自訂端點時可省略 R2_ACCOUNT_ID，region 由 R2_REGION 決定。

        這些服務會檢查 Credential scope 裡的 region 是否與 bucket 相符，
        填錯會回 AuthorizationHeaderMalformed，所以一定要能設定。
        """
        env = self.r2_env(R2_REGION='ap-southeast-1')
        env.pop('R2_ACCOUNT_ID')
        app = self.make_app(env)
        self.assertEqual(app.storage.mode, 'r2')
        self.assertEqual(app.storage.public()['region'], 'ap-southeast-1')
        student, _ = self.users(app)
        attempt = self.call(app, 'POST', '/api/attempts',
                            {'questionId': 1, 'answerText': '', 'image': PNG}, student)['attempt']
        self.assertIn('/ap-southeast-1/s3/aws4_request', FakeS3.requests[-1][2]['authorization'])
        with app.db() as db:
            row = db.execute('SELECT image_key FROM attempts WHERE id=?', (attempt['id'],)).fetchone()
        self.assertTrue(row['image_key'].startswith('attempts/'))

    def test_default_endpoint_still_needs_account_id(self):
        env = self.r2_env()
        env.pop('R2_ENDPOINT')
        env.pop('R2_ACCOUNT_ID')
        app = self.make_app(env)
        self.assertEqual(app.storage.mode, 'db')
        self.assertIn('不完整', app.storage.public()['error'])

    def test_invalid_region_is_rejected(self):
        app = self.make_app(self.r2_env(R2_REGION='ap southeast 1'))
        self.assertEqual(app.storage.mode, 'db')
        self.assertIn('R2_REGION', app.storage.public()['error'])

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


class RestoreAuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='mathpath-restore-audit-')
        self.addCleanup(self.tmp.cleanup)
        env = patch.dict('os.environ', {}, clear=True)
        env.start()
        self.addCleanup(env.stop)
        self.app = server.Application(Path(self.tmp.name) / 'data')
        self.app.safe_initialize()
        self.assertIsNone(self.app.init_error)
        self.assertEqual(self.app.storage.mode, 'db')
        with self.app.db() as db:
            self.teacher = db.execute('SELECT * FROM users WHERE id=2').fetchone()
            self.snapshot = self.app.get_question(db, 1)
            self.snapshot.update(id=100, title='归档题目快照', content='归档题面不能替换成当前题库')
            for qid in (200, 201, 202):
                payload = dict(server.seed_questions()[0], title=f'当前题库 {qid}')
                db.execute('INSERT INTO questions(id,payload) VALUES(?,?)', (qid, json.dumps(payload)))
            db.execute('INSERT INTO meta(key,value) VALUES(?,?)',
                       ('question_id_map', json.dumps({'100': 200, '101': 201, '102': 202, '103': 200})))
        self.stamp = '2020-01-01T00:00:00Z'

    def call(self, method, path, body=None, user=None):
        if user is None:
            with self.app.db() as db:
                user = db.execute("SELECT * FROM users WHERE username='archive_student'").fetchone()
        return self.app.dispatch(method, path, body or {}, user, None, '127.0.0.1')[0]

    def records(self):
        return [
            {'type': 'student', 'id': 10, 'username': 'archive_student', 'role': 'student'},
            {'type': 'class', 'id': 20, 'name': '归档班级'},
            {'type': 'classStudent', 'class_id': 20, 'user_id': 10},
            {'type': 'assignment', 'id': 30, 'class_id': 20, 'title': '归档作业', 'due_at': self.stamp},
            self.question(),
            {'type': 'assignmentRecipient', 'assignment_id': 30, 'user_id': 10,
             'submitted_at': self.stamp, 'submit_count': 1},
        ]

    def question(self, qid=100, kind='assignmentQuestion', **overrides):
        payload = dict(self.snapshot, id=qid)
        record = {'type': kind, 'question_id': qid, 'position': qid, 'payload': json.dumps(payload)}
        record['assignment_id' if kind == 'assignmentQuestion' else 'exam_id'] = 30 if kind == 'assignmentQuestion' else 40
        return {**record, **overrides}

    def correction(self, minimum=1000, qids=(100,), **overrides):
        return {'type': 'correction', 'assignment_id': 30, 'user_id': 10, 'note': '请重新作答',
                'question_ids': json.dumps(list(qids)), 'min_attempt_id': minimum,
                'round': 1, 'requested_at': self.stamp, **overrides}

    def attempt(self, old_id=1000, **overrides):
        return {'type': 'attempt', 'id': old_id, 'user_id': 10, 'question_id': 100,
                'assignment_id': 30, 'answer_text': str(old_id), 'max_score': 6, 'score': 6,
                'status': 'graded', 'method': 'rule-final', 'submitted_at': self.stamp,
                'teacher_reviewed': 1, 'teacher_confirmed_score': 6, **overrides}

    def exam(self, **overrides):
        return {'type': 'mockExam', 'id': 40, 'user_id': 10, 'minutes': 30, 'question_count': 1,
                'created_at': self.stamp, 'started_at': self.stamp, 'expires_at': self.stamp,
                'submitted_at': self.stamp, **overrides}

    def restore(self, records):
        path = Path(self.tmp.name) / 'students.jsonl'
        with path.open('wb') as handle:
            handle.write(json.dumps({'format': 'mathpath-student-archive', 'version': 1}).encode() + b'\n')
            for record in records:
                handle.write(self.app.dataadmin.line(record['type'], record))
        return self.app.dataadmin.restore_students(path, self.teacher['id'], 'Restore-test-password')

    def ids(self):
        with self.app.db() as db:
            aid = db.execute('SELECT id FROM assignments ORDER BY id LIMIT 1').fetchone()[0]
            uid = db.execute("SELECT id FROM users WHERE username='archive_student'").fetchone()[0]
        return aid, uid

    def test_remapped_snapshots_reports_and_open_correction_can_finish(self):
        records = self.records() + [
            self.correction(1000, round=1, resolved_at=self.stamp),
            self.correction(1001, round=2),
            self.exam(), self.question(kind='mockQuestion'),
            self.attempt(1000), self.attempt(1001),
            self.attempt(1002, assignment_id=None, mock_id=40),
        ]
        out = self.restore(records)
        self.assertEqual(out['written']['correction'], 2)
        self.assertTrue(out['questionMapApplied'])
        aid, uid = self.ids()
        with self.app.db() as db:
            for table in ('assignment_questions', 'mock_questions'):
                row = db.execute(f'SELECT question_id,payload FROM {table}').fetchone()
                self.assertEqual(row['question_id'], 200)
                self.assertEqual(json.loads(row['payload']), dict(self.snapshot, id=200))
            attempts = db.execute('SELECT * FROM attempts WHERE assignment_id=? ORDER BY id', (aid,)).fetchall()
            self.assertLess(attempts[0]['id'], 1000)
            corrections = db.execute('SELECT * FROM corrections ORDER BY id').fetchall()
            self.assertEqual([c['min_attempt_id'] for c in corrections], [a['id'] for a in attempts])
            self.assertGreater(attempts[1]['id'], corrections[0]['min_attempt_id'])
            self.assertIsNotNone(corrections[0]['resolved_at'])
            self.assertIsNone(corrections[1]['resolved_at'])
            self.assertTrue(all(json.loads(c['question_ids']) == [200] for c in corrections))
            self.assertTrue(all(c['requested_by'] == self.teacher['id'] and c['user_id'] == uid for c in corrections))
            eid = db.execute('SELECT id FROM mock_exams').fetchone()[0]
        # 经真实 API 读回报告，旧快照 id 会在 topic_stats 中触发 KeyError。
        for user in (None, self.teacher):
            detail = self.call('GET', f'/api/assignments/{aid}', user=user)
            self.assertEqual(detail['questions'][0]['id'], 200)
            if user is None:
                self.assertEqual(detail['report']['score'], 6)
                self.assertEqual(detail['mySubmission']['correction']['minAttemptId'], attempts[1]['id'])
        self.assertEqual(self.call('GET', f'/api/assignments/{aid}/results', user=self.teacher)['summary']['correctionCount'], 1)
        self.assertEqual(self.call('GET', f'/api/mock/{eid}')['report']['score'], 6)
        # 不能沿用阈值内的旧作答，重新作答后才可完成开放订正。
        with self.assertRaises(server.APIError) as error:
            self.call('POST', f'/api/assignments/{aid}/submit')
        self.assertEqual(error.exception.status, 400)
        fresh = self.call('POST', '/api/attempts', {'assignmentId': aid, 'questionId': 200,
                                                 'answerText': 'x=2或3'})['attempt']
        self.assertGreater(fresh['id'], attempts[1]['id'])
        done = self.call('POST', f'/api/assignments/{aid}/submit')
        self.assertEqual(done['mySubmission']['status'], 'submitted')
        self.assertEqual(done['mySubmission']['submitCount'], 2)
        self.assertIsNone(done['mySubmission']['correction'])
        with self.app.db() as db:
            self.assertIsNotNone(db.execute('SELECT resolved_at FROM corrections WHERE round=2').fetchone()[0])

    def test_threshold_uses_only_restored_assignment_student_and_original_boundary(self):
        records = self.records() + [
            {'type': 'student', 'id': 11, 'username': 'other_archive_student', 'role': 'student'},
            {'type': 'assignment', 'id': 31, 'class_id': 20, 'title': '其他作业'},
            self.question(assignment_id=31), self.question(102), self.exam(), self.question(kind='mockQuestion'),
        ]
        for minimum in (0, 950, 975, 1000, 1050, 1100):
            records.append(self.correction(minimum, note=str(minimum), resolved_at=self.stamp))
        records += [self.attempt(900), self.attempt(975, question_id=102), self.attempt(1000), self.attempt(1100),
                    self.attempt(1001, user_id=11), self.attempt(1002, assignment_id=31),
                    self.attempt(1003, assignment_id=None), self.attempt(1004, assignment_id=None, mock_id=40),
                    self.attempt(1049, question_id=999)]
        out = self.restore(records)
        self.assertEqual(out['skipped']['attempt'], 1)
        aid, uid = self.ids()
        with self.app.db() as db:
            own = {int(r['answer_text']): r['id'] for r in db.execute(
                'SELECT * FROM attempts WHERE assignment_id=? AND user_id=?', (aid, uid))}
            markers = {int(r['note']): r['min_attempt_id'] for r in db.execute('SELECT * FROM corrections')}
        self.assertEqual(markers, {0: 0, 950: own[900], 975: own[975], 1000: own[1000],
                                   1050: own[1000], 1100: own[1100]})
        self.assertGreater(own[1100], markers[1050], '原阈值之后的恢复作答仍是新订正作答')

    def test_archived_post_threshold_attempt_can_finish_correction_without_another_attempt(self):
        self.restore(self.records() + [self.correction(1000), self.attempt(1000), self.attempt(1001)])
        aid, _ = self.ids()
        with self.app.db() as db:
            marker = db.execute('SELECT min_attempt_id FROM corrections').fetchone()[0]
            latest = db.execute('SELECT MAX(id) FROM attempts').fetchone()[0]
        self.assertGreater(latest, marker)
        self.assertEqual(self.call('POST', f'/api/assignments/{aid}/submit')['mySubmission']['status'], 'submitted')
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0], 2)

    def test_existing_student_is_reused_but_previous_restore_attempts_do_not_set_new_threshold(self):
        records = self.records() + [self.correction(1000), self.attempt(1000)]
        self.restore(records)
        _, uid = self.ids()
        out = self.restore(records)
        self.assertEqual(out['skipped']['student'], 1)
        self.assertEqual(out['credentials'], [])
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM users WHERE id=?', (uid,)).fetchone()[0], 1)
            rows = db.execute('SELECT * FROM corrections ORDER BY id').fetchall()
            for row in rows:
                self.assertEqual(row['user_id'], uid)
                own_max = db.execute('SELECT MAX(id) FROM attempts WHERE assignment_id=? AND user_id=?',
                                     (row['assignment_id'], uid)).fetchone()[0]
                self.assertEqual(row['min_attempt_id'], own_max)
            self.assertGreater(rows[1]['min_attempt_id'], rows[0]['min_attempt_id'])

    def test_threshold_is_maximum_new_id_not_nearest_old_id(self):
        self.restore(self.records() + [self.correction(1000, resolved_at=self.stamp),
                                       self.attempt(1000), self.attempt(900)])
        with self.app.db() as db:
            maximum = db.execute('SELECT MAX(id) FROM attempts').fetchone()[0]
            self.assertEqual(db.execute('SELECT min_attempt_id FROM corrections').fetchone()[0], maximum)

    def test_invalid_snapshots_and_unrestored_questions_are_reported_not_fabricated(self):
        records = self.records() + [self.exam(), self.question(kind='mockQuestion')]
        invalid = ('not-json', '[]', 'null', '{}', json.dumps({'id': 101, 'title': '缺字段'}), None)
        for payload in invalid:
            records.extend([self.question(101, payload=payload), self.question(101, kind='mockQuestion', payload=payload)])
        # 103 与 100 映射到同一题，INSERT OR IGNORE 不算成功恢复的 103。
        records += [self.question(103), self.question(103, kind='mockQuestion'),
                    self.question(999), self.question(999, kind='mockQuestion'),
                    self.correction(qids=(100, 101, 103, 2, 999)),
                    self.correction(qids=(101,)), self.correction(qids=(103,)),
                    self.correction(qids=(), note='旧空范围代表全部'),
                    self.correction(question_ids='not-json'), self.correction(question_ids='{}'),
                    self.correction(question_ids='[true]'),
                    self.attempt(), self.attempt(1001, question_id=101),
                    self.attempt(1002, question_id=101, assignment_id=None, mock_id=40)]
        out = self.restore(records)
        self.assertEqual(out['written']['assignmentQuestion'], 1)
        self.assertEqual(out['written']['mockQuestion'], 1)
        self.assertEqual(out['skipped']['assignmentQuestion'], len(invalid) + 2)
        self.assertEqual(out['skipped']['mockQuestion'], len(invalid) + 2)
        self.assertEqual(out['skipped']['attempt'], 2)
        self.assertEqual(out['skipped']['correction'], 5)
        with self.app.db() as db:
            rows = db.execute('SELECT question_ids FROM corrections').fetchall()
            self.assertEqual([json.loads(r[0]) for r in rows], [[200], [200]])
            self.assertEqual(db.execute('SELECT count(*) FROM assignment_questions').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT count(*) FROM mock_questions').fetchone()[0], 1)

    def test_unrestored_assignment_or_mock_attempt_never_becomes_public_practice(self):
        records = self.records() + [
            {'type': 'assignment', 'id': 99, 'class_id': 999},
            self.exam(id=98, user_id=999),
            self.attempt(1000, assignment_id=99, image=PNG),
            self.attempt(1001, assignment_id=None, mock_id=98, image=PNG),
            self.attempt(1002, assignment_id=0),
            self.attempt(1003, assignment_id=None, mock_id=0),
            self.attempt(1004, assignment_id=None),
        ]
        with patch.object(self.app.dataadmin, 'decode_optional_image', wraps=self.app.dataadmin.decode_optional_image) as decode:
            out = self.restore(records)
        self.assertEqual(out['skipped']['assignment'], 1)
        self.assertEqual(out['skipped']['mockExam'], 1)
        self.assertEqual(out['skipped']['attempt'], 4)
        self.assertEqual(decode.call_count, 2, '跳过所属对象丢失的作答时，不解码或上传图片')
        with self.app.db() as db:
            rows = db.execute('SELECT * FROM attempts').fetchall()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['answer_text'], '1004')
            self.assertIsNone(rows[0]['assignment_id'])
            self.assertIsNone(rows[0]['mock_id'])

    def test_existing_teacher_username_is_not_mapped_to_student(self):
        records = self.records()
        records[0]['username'] = self.teacher['username']
        records += [self.exam(), self.correction(), self.attempt()]
        before = dict(self.teacher)
        out = self.restore(records)
        self.assertEqual(out['credentials'], [])
        self.assertEqual(out['skipped']['student'], 1)
        for kind in ('classStudent', 'assignmentRecipient', 'mockExam', 'correction', 'attempt'):
            self.assertEqual(out['skipped'][kind], 1)
        with self.app.db() as db:
            self.assertEqual(dict(db.execute('SELECT * FROM users WHERE id=?', (before['id'],)).fetchone()), before)
            self.assertEqual(db.execute('SELECT count(*) FROM users').fetchone()[0], 2)
            for table in ('class_students', 'assignment_recipients', 'mock_exams', 'corrections', 'attempts'):
                self.assertEqual(db.execute(f'SELECT count(*) FROM {table}').fetchone()[0], 0)

    def test_images_remain_streamed_and_deferred_corrections_commit_in_400_batches(self):
        real_db, real_iter = self.app.db, self.app.dataadmin.iter_jsonl
        commits, decoded = [], []
        total = 405

        class Connection:
            def __init__(self, db):
                self.db = db

            def execute(self, *args):
                return self.db.execute(*args)

            def commit(self):
                commits.append((self.db.execute('SELECT count(*) FROM attempts').fetchone()[0],
                                self.db.execute('SELECT count(*) FROM corrections').fetchone()[0]))
                self.db.commit()

        @contextmanager
        def tracked_db():
            with real_db() as db:
                yield Connection(db)

        def streaming(path):
            count = 0
            for record in real_iter(path):
                if record.get('type') == 'attempt':
                    self.assertEqual(len(decoded), count, '读取下一张图片前，上一笔必须已经解码并写入')
                    count += 1
                yield record
            if count:
                self.assertEqual(len(decoded), total)

        def decode(value):
            if value:
                decoded.append(value)
                return PNG_BYTES, 'image/png'
            return None, None

        records = self.records() + [self.correction(1000, resolved_at=self.stamp, round=i + 1) for i in range(total)]
        records += [self.attempt(1000 + i, image=PNG) for i in range(total)]
        with patch.object(self.app, 'db', tracked_db), patch.object(self.app.dataadmin, 'iter_jsonl', streaming), \
                patch.object(self.app.dataadmin, 'decode_optional_image', side_effect=decode):
            out = self.restore(records)
        self.assertEqual(out['written']['attempt'], total)
        self.assertEqual(out['written']['correction'], total)
        # 含文件头共817行，原流在400、800行提交；延迟订正阶段在累计1200处再次提交。
        self.assertEqual(commits, [(0, 0), (387, 0), (405, 382)])
        with real_db() as db:
            self.assertEqual(db.execute('SELECT count(image) FROM attempts').fetchone()[0], total)
            self.assertEqual(db.execute('SELECT count(*) FROM corrections').fetchone()[0], total)
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
