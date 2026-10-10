"""标准库 API 回归测试：所有服务器和 data 均位于临时目录及回环地址。"""
import base64
from concurrent.futures import ThreadPoolExecutor
import http.client
import io
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import sqlite3
import subprocess
import struct
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import zlib

import server


PYTHON = '/Users/laokunleng/.workbuddy-ai/binaries/python/envs/default/bin/python'


def png_url():
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    raw = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(b'\x00\xff\xff\xff')) + chunk(b'IEND', b''))
    return 'data:image/png;base64,' + base64.b64encode(raw).decode()


class APITests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='mathpath-api-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.env = patch.dict('os.environ', {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.app = server.Application(self.root / 'data', static_dir=self.root)
        # 測試同步等待初始化完成（生產環境於背景執行緒跑）。
        self.app.safe_initialize()
        if self.app.init_error:
            raise RuntimeError(f'初始化失敗：{self.app.init_error}')
        self.httpd = server.MathServer(('127.0.0.1', 0), self.app)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)
        self.origin = f'http://127.0.0.1:{self.httpd.server_port}'
        self.student = self.login('student', 'Math1234!')
        self.teacher = self.login('teacher', 'Teach1234!')
        self.draft = server.seed_questions()[0]

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=3)

    def request(self, method, path, body=None, cookie=None, origin=True, extra=None, raw=None, expect=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=10)
        headers = {'Content-Type': 'application/json'}
        if origin is True:
            headers['Origin'] = self.origin
        elif isinstance(origin, str):
            headers['Origin'] = origin
        if cookie:
            headers['Cookie'] = cookie
        if extra:
            headers.update(extra)
        data = raw if raw is not None else (json.dumps(body, ensure_ascii=False).encode() if body is not None else None)
        try:
            conn.request(method, path, data, headers)
            response = conn.getresponse()
            result_bytes = response.read()
            result_headers = dict(response.getheaders())
            if response.getheader('Content-Type', '').startswith('application/json'):
                result = json.loads(result_bytes)
            else:
                result = result_bytes
            status = response.status
        finally:
            conn.close()
        if expect is not None:
            self.assertEqual(status, expect, result)
        if status >= 400:
            self.assertIsInstance(result.get('error'), str)
            self.assertEqual(set(result), {'error'})
        return status, result, result_headers

    def login(self, username, password):
        _, body, headers = self.request('POST', '/api/login', {'username': username, 'password': password}, expect=200)
        self.assertIn(body['user']['role'], ('student', 'teacher'))
        return headers['Set-Cookie'].split(';', 1)[0]

    def submit(self, answer='x=2或3', image=None, **kwargs):
        body = {'questionId': 1, 'answerText': answer, 'useAi': False}
        if image:
            body['image'] = image
        body.update(kwargs)
        return self.request('POST', '/api/attempts', body, cookie=self.student, expect=200)[1]['attempt']

    def test_login_session_logout_and_cookie(self):
        self.request('GET', '/api/session', expect=200)
        self.request('GET', '/api/state', expect=401)
        self.request('POST', '/api/login', {'username': "' OR 1=1 --", 'password': 'x'}, expect=401)
        self.request('POST', '/api/login', {'username': 'student', 'password': 'bad'}, expect=401)
        _, body, headers = self.request('POST', '/api/login', {'username': 'student', 'password': 'Math1234!'}, expect=200)
        self.assertIn('演示帳戶', body['notice'])
        cookie = headers['Set-Cookie']
        for flag in ('HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=43200'):
            self.assertIn(flag, cookie)
        self.assertNotIn('Secure', cookie)
        token = cookie.split('=', 1)[1].split(';', 1)[0]
        self.assertEqual(len(token), 43)
        _, data, _ = self.request('GET', '/api/session', cookie=cookie.split(';')[0], expect=200)
        self.assertEqual(data['user']['role'], 'student')
        self.request('POST', '/api/logout', {}, cookie=cookie.split(';')[0], expect=200)
        _, data, _ = self.request('GET', '/api/session', cookie=cookie.split(';')[0], expect=200)
        self.assertIsNone(data['user'])
        with self.app.db() as db:
            self.assertFalse(db.execute('SELECT 1 FROM sessions WHERE token_hash=?', (token,)).fetchone())

    def test_login_remember_extends_session_cookie(self):
        for payload, expected in (
                ({'username': 'student', 'password': 'Math1234!', 'remember': True}, 'Max-Age=2592000'),
                ({'username': 'student', 'password': 'Math1234!', 'remember': False}, 'Max-Age=43200'),
                ({'username': 'student', 'password': 'Math1234!'}, 'Max-Age=43200')):
            with self.subTest(payload=payload):
                _, body, headers = self.request('POST', '/api/login', payload, expect=200)
                self.assertIn(expected, headers['Set-Cookie'])
                cookie = headers['Set-Cookie'].split(';', 1)[0]
                _, session, _ = self.request('GET', '/api/session', cookie=cookie, expect=200)
                self.assertEqual(session['user'], body['user'])
        # remember=true 的到期時間確實延長為 30 天。
        with self.app.db() as db:
            db.execute('DELETE FROM sessions')
        _, body, headers = self.request('POST', '/api/login', {'username': 'student', 'password': 'Math1234!', 'remember': True}, expect=200)
        with self.app.db() as db:
            expires = db.execute('SELECT expires FROM sessions').fetchone()[0]
        self.assertGreater(expires - time.time(), server.SESSION_SECONDS + 3600)
        # remember 必須是布林值，其他型別一律 400。
        for bad in (1, 0, 'true', None, [], {}, 'yes'):
            with self.subTest(bad=bad):
                self.request('POST', '/api/login', {'username': 'student', 'password': 'Math1234!', 'remember': bad}, expect=400)

    def test_question_figure_import_serving_and_validation(self):
        data_url = png_url()
        raw = base64.b64decode(data_url.split(',')[1])
        self.request('POST', '/api/questions/import', {'questions': [dict(self.draft, figure=data_url)]},
                     cookie=self.student, expect=403)
        _, result, _ = self.request('POST', '/api/questions/import', {'questions': [dict(self.draft, figure=data_url)]},
                                    cookie=self.teacher, expect=200)
        self.assertEqual(result['count'], 1)
        with self.app.db() as db:
            qid = db.execute('SELECT max(id) FROM questions').fetchone()[0]
            row = db.execute('SELECT * FROM questions WHERE id=?', (qid,)).fetchone()
        self.assertEqual(row['figure_mime'], 'image/png')
        self.assertEqual(bytes(row['figure']), raw)
        payload = json.loads(row['payload'])
        self.assertNotIn('figure', payload)
        self.assertNotIn('figure_mime', payload)
        self.assertNotIn(data_url, row['payload'])
        self.assertNotIn('data:image', row['payload'])
        path = f'/api/questions/{qid}/figure'
        # 未登入 401；學生與教師都可讀取（學生要解題）。
        self.request('GET', path, expect=401)
        for cookie in (self.student, self.teacher):
            _, content, headers = self.request('GET', path, cookie=cookie, expect=200)
            self.assertEqual(headers['Content-Type'], 'image/png')
            self.assertEqual(headers['Content-Disposition'], 'inline')
            self.assertEqual(content, raw)
        # 題目 payload 帶圖形連結，但不含二進位或 dataURL；文字欄位與 answer 不受污染。
        _, state, _ = self.request('GET', '/api/state', cookie=self.student, expect=200)
        saved = next(q for q in state['questions'] if q['id'] == qid)
        self.assertEqual(saved['figure'], path)
        self.assertNotIn('answer', saved)
        self.assertEqual(saved['title'], self.draft['title'])
        _, tstate, _ = self.request('GET', '/api/state', cookie=self.teacher, expect=200)
        tsaved = next(q for q in tstate['questions'] if q['id'] == qid)
        self.assertEqual(tsaved['figure'], path)
        self.assertEqual(tsaved['answer'], self.draft['answer'])
        self.assertNotIn(data_url, json.dumps(tstate, ensure_ascii=False))
        # 無圖題目與不存在題目都 404。
        self.request('GET', '/api/questions/1/figure', cookie=self.student, expect=404)
        self.request('GET', '/api/questions/99999/figure', cookie=self.student, expect=404)
        # 非 PNG/JPEG、超大小與非字串圖形一律 400，且不新增題目。
        big = 'data:image/png;base64,' + base64.b64encode(b'x' * (server.MAX_FIGURE + 1)).decode()
        for figure in ('data:image/gif;base64,R0lGODlhAQABAAAAACw=', big, 123, True):
            with self.subTest(figure=str(figure)[:32]):
                self.request('POST', '/api/questions/import', {'questions': [dict(self.draft, figure=figure)]},
                             cookie=self.teacher, expect=400)
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM questions').fetchone()[0], 17)

    def test_seed_state_privacy_and_recommendations(self):
        _, state, _ = self.request('GET', '/api/state', cookie=self.student, expect=200)
        self.assertEqual(len(state['questions']), 16)
        self.assertEqual(state['attempts'], [])
        self.assertEqual(state['stats'], {'completed': 0, 'accuracy': 0, 'streak': 0, 'minutes': 0})
        self.assertEqual(state['ai'], {'configured': False, 'model': '', 'vision': '', 'mode': 'off', 'source': 'none', 'thinking': False})
        for q in state['questions']:
            self.assertNotIn('answer', q)
            self.assertNotIn('steps', q)
            self.assertEqual(q['grade'], '中三')
        _, state, _ = self.request('GET', '/api/state', cookie=self.teacher, expect=200)
        self.assertEqual(state['questions'][0]['answer'], 'x=2或3')
        self.assertEqual(state['questions'][0]['points'], 6)
        self.assertEqual(sum(q['topic'] == '一元二次方程' for q in state['questions']), 5)
        _, recommendations, _ = self.request('GET', '/api/questions/1/recommendations', cookie=self.student, expect=200)
        self.assertEqual(recommendations['similar'][0]['id'], 2)
        self.assertTrue(recommendations['advanced'])
        for q in recommendations['similar'] + recommendations['advanced']:
            self.assertNotIn('answer', q)
            self.assertNotIn('steps', q)
            self.assertEqual(q['topic'], '一元二次方程')
        self.request('POST', '/api/questions/1/generate', {'kind': 'similar'}, cookie=self.student, expect=409)

    def test_teacher_rbac_parse_import(self):
        body = {'name': '測驗', 'text': '1. 解 x²−5x+6=0。\n2、求三角形內角。\n3) 求平均數。\nQ4 probability of a die\n第5题 求 f(x)=2x+1。'}
        self.request('POST', '/api/papers/parse', body, cookie=self.student, expect=403)
        self.request('POST', '/api/questions/import', {'questions': [self.draft]}, cookie=self.student, expect=403)
        _, parsed, _ = self.request('POST', '/api/papers/parse', body, cookie=self.teacher, expect=200)
        self.assertEqual(parsed['method'], '規則拆題')
        self.assertEqual(len(parsed['drafts']), 5)
        self.assertEqual([q['topic'] for q in parsed['drafts']], ['一元二次方程', '幾何', '統計', '概率', '函數'])
        self.assertTrue(parsed['notice'].startswith('需要教師確認'))
        for q in parsed['drafts']:
            self.assertNotIn('id', q)
            self.assertEqual(q['answer'], '')
        parsed['drafts'][0]['answer'] = 'x=2或3'
        _, result, _ = self.request('POST', '/api/questions/import', {'questions': parsed['drafts']}, cookie=self.teacher, expect=200)
        self.assertEqual(result['count'], 5)
        _, state, _ = self.request('GET', '/api/state', cookie=self.teacher, expect=200)
        self.assertEqual(len(state['questions']), 21)
        self.assertEqual(state['questions'][16]['answer'], 'x=2或3')

    def test_question_type_classification_and_auto_import(self):
        # 題型規則判斷：只做可解釋的判斷，不確定時回解答題。
        cases = [
            ('下列何者正確？ (A) 1 (B) 2 (C) 3 (D) 4', '選擇題'),
            ('若 x + 3 = 7，則 x = ____。', '填空題'),
            ('證明三角形的內角和是 180°。', '證明題'),
            ('解方程 x²−5x+6=0，並寫出完整過程。', '解答題'),
        ]
        for content, expect in cases:
            with self.subTest(content=content):
                self.assertEqual(server.classify_type(content), expect)
        text = ('1. 下列何者正確？ (A) 1 (B) 2 (C) 3 (D) 4\n'
                '2. 若 x + 3 = 7，則 x = ____。\n'
                '3. 證明三角形的內角和是 180°。\n'
                '4. 解方程 x²−5x+6=0。')
        body = {'name': '自動卷', 'text': text}
        # 只有教師可以全自動匯入
        self.request('POST', '/api/papers/auto-import', body, cookie=self.student, expect=403)
        _, parsed, _ = self.request('POST', '/api/papers/parse', body, cookie=self.teacher, expect=200)
        self.assertEqual([q['qtype'] for q in parsed['drafts']],
                         ['選擇題', '填空題', '證明題', '解答題'])
        self.assertTrue(parsed['drafts'][0]['analysis'].startswith('規則分析'))
        _, result, _ = self.request('POST', '/api/papers/auto-import', body, cookie=self.teacher, expect=200)
        self.assertEqual(result['count'], 4)
        self.assertEqual(result['method'], '規則拆題')
        self.assertIn('自動匯入', result['questions'][0]['tags'])
        self.assertIn('待核驗', result['questions'][0]['tags'])
        self.assertIn('待核驗', result['notice'])
        _, state, _ = self.request('GET', '/api/state', cookie=self.teacher, expect=200)
        self.assertEqual(len(state['questions']), 20)
        self.assertEqual(state['questions'][16]['qtype'], '選擇題')
        self.assertEqual(state['questions'][19]['qtype'], '解答題')
        # 題型必須是四種之一，其他值拒絕
        bad = dict(self.draft, qtype='是非題')
        self.request('POST', '/api/questions/import', {'questions': [bad]}, cookie=self.teacher, expect=400)
        # 學生端不應看到題目分析（可能含解法）與答案
        _, student_state, _ = self.request('GET', '/api/state', cookie=self.student, expect=200)
        for q in student_state['questions']:
            self.assertNotIn('analysis', q)
            self.assertNotIn('answer', q)
            self.assertIn('qtype', q)

    def test_import_atomic_validation(self):
        for invalid in [dict(self.draft, level=0), dict(self.draft, points=True), dict(self.draft, topic='任意'),
                        dict(self.draft, tags='abc'), dict(self.draft, steps=[1]), dict(self.draft, grade='中一'),
                        dict(self.draft, title='<title>', unknown='x'), dict(self.draft, content=''),
                        dict(self.draft, level=1.5), dict(self.draft, answer=None)]:
            self.request('POST', '/api/questions/import', {'questions': [self.draft, invalid]}, cookie=self.teacher, expect=400)
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM questions').fetchone()[0], 16)
        self.request('POST', '/api/questions/import', {'questions': []}, cookie=self.teacher, expect=400)
        self.request('POST', '/api/questions/import', {'questions': [self.draft] * 101}, cookie=self.teacher, expect=400)

    def test_rule_final_scoring_and_real_stats(self):
        attempt = self.submit('x=3或2')
        self.assertEqual(attempt['score'], 6)
        self.assertEqual(attempt['status'], 'graded')
        self.assertEqual(attempt['gradingMethod'], 'rule-final')
        self.assertEqual(attempt['steps'], [])
        self.assertIn('未批改推導步驟', attempt['feedback'])
        self.assertFalse(attempt['teacherReviewed'])
        wrong = self.submit('x=2')
        self.assertEqual(wrong['score'], 0)
        self.assertEqual(wrong['status'], 'graded')
        _, state, _ = self.request('GET', '/api/state', cookie=self.student, expect=200)
        self.assertEqual(state['stats']['completed'], 2)
        self.assertEqual(state['stats']['accuracy'], 50)
        self.assertEqual(state['stats']['streak'], 1)
        self.assertEqual(state['stats']['minutes'], 0)

    def test_final_answer_last_line_scoring(self):
        derivation = '移項並因式分解：\nx²−5x+6=0\n(x−2)(x−3)=0\n'
        for label in ('最終答案：', '最終答案:', '最终答案：', '最终答案:', 'Final answer:'):
            answer = derivation + label + ' x=2 或 x=3\n \t\n'
            with self.subTest(label=label):
                attempt = self.submit(answer)
                self.assertEqual(attempt['score'], 6)
                self.assertEqual(attempt['gradingMethod'], 'rule-final')
                self.assertEqual(attempt['answerText'], answer.strip())
                self.assertEqual(attempt['steps'], [])
        for answer in (
            derivation + '最終答案：x=2 或 x=3\n所以 x=4',
            derivation + '最終答案：x=2 或 x=3\n其它文字',
            derivation + '最終答案：x=2 或 x=3\nx=2 或 x=3',
            derivation + '最終答案：x=2 或 x=3\n最終答案：x=4',
            derivation + '途中最終答案：x=2 或 x=3',
            derivation + '最終答案：x=2 或 x=3；其它文字',
            derivation + '最終答案：',
            derivation + 'x=2 或 x=3',
        ):
            with self.subTest(answer=answer):
                self.assertEqual(self.submit(answer)['score'], 0)

    def test_pending_image_review_and_image_owner(self):
        data_url = png_url()
        attempt = self.submit('', image=data_url)
        self.assertEqual(attempt['status'], 'pending')
        self.assertIsNone(attempt['score'])
        self.assertEqual(attempt['gradingMethod'], 'pending-teacher')
        self.assertIn('等待教師', attempt['feedback'])
        self.request('GET', attempt['image'], expect=401)
        for cookie in (self.student, self.teacher):
            _, content, headers = self.request('GET', attempt['image'], cookie=cookie, expect=200)
            self.assertEqual(headers['Content-Type'], 'image/png')
            self.assertEqual(content, base64.b64decode(data_url.split(',')[1]))
        path = f'/api/attempts/{attempt["id"]}/review'
        self.request('POST', path, {'score': 5, 'feedback': '很好'}, cookie=self.student, expect=403)
        self.request('POST', path, {'score': 7, 'feedback': '很好'}, cookie=self.teacher, expect=400)
        _, body, _ = self.request('POST', path, {'score': 5, 'feedback': '因式分解正確'}, cookie=self.teacher, expect=200)
        self.assertEqual(body['attempt']['score'], 5)
        self.assertEqual(body['attempt']['status'], 'graded')
        self.assertTrue(body['attempt']['teacherReviewed'])
        self.assertEqual(body['attempt']['gradingMethod'], 'teacher-reviewed')
        with self.app.db() as db:
            row = db.execute('SELECT * FROM attempts').fetchone()
            self.assertEqual(row['reviewed_by'], 2)
            self.assertIsNotNone(row['reviewed_at'])
        _, state, _ = self.request('GET', '/api/state', cookie=self.teacher, expect=200)
        self.assertEqual(state['attempts'][0]['student']['id'], 1)

    def test_owner_isolation(self):
        attempt = self.submit('', image=png_url())
        self.request('POST', '/api/users', {'username': 'other', 'name': '另一學生', 'password': 'OtherPass123!'},
                     cookie=self.teacher, expect=200)
        other = self.login('other', 'OtherPass123!')
        self.request('GET', attempt['image'], cookie=other, expect=404)
        _, state, _ = self.request('GET', '/api/state', cookie=other, expect=200)
        self.assertEqual(state['attempts'], [])
        self.assertNotIn('演示學生', json.dumps(state, ensure_ascii=False))
        other_attempt = self.request('POST', '/api/attempts', {'questionId': 1, 'answerText': 'x=2或3', 'useAi': False}, cookie=other, expect=200)[1]['attempt']
        _, state, _ = self.request('GET', '/api/state', cookie=self.student, expect=200)
        self.assertEqual([a['id'] for a in state['attempts']], [attempt['id']])
        self.assertNotIn('student', state['attempts'][0])
        _, state, _ = self.request('GET', '/api/state', cookie=self.teacher, expect=200)
        self.assertEqual({a['id'] for a in state['attempts']}, {attempt['id'], other_attempt['id']})

    def test_annotation_marking_over_http_and_access(self):
        attempt = self.submit('', image=png_url())
        aid = attempt['id']
        self.assertNotIn('annotation', attempt)
        path = f'/api/attempts/{aid}/annotation'
        marked = png_url()
        self.request('GET', path, expect=401)
        self.request('POST', path, {'image': marked}, expect=401)
        self.request('POST', path, {'image': marked}, cookie=self.student, expect=403)
        self.request('POST', path, {'image': 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='}, cookie=self.teacher, expect=400)
        self.request('POST', path, {'image': marked, 'extra': 1}, cookie=self.teacher, expect=400)
        _, body, _ = self.request('POST', path, {'image': marked}, cookie=self.teacher, expect=200)
        self.assertEqual(body['attempt']['annotation'], path)
        self.assertTrue(body['attempt']['annotationAt'])
        # 批註圖與原始手稿都可讀取，且只限本人與教師。
        for cookie in (self.student, self.teacher):
            _, content, headers = self.request('GET', path, cookie=cookie, expect=200)
            self.assertEqual(headers['Content-Type'], 'image/png')
            self.assertEqual(content, base64.b64decode(marked.split(',')[1]))
            _, original, _ = self.request('GET', attempt['image'], cookie=cookie, expect=200)
            self.assertEqual(original, base64.b64decode(png_url().split(',')[1]))
        # 沒有手寫圖片的作答不能加批註。
        text_attempt = self.submit('x=2或3')
        self.request('POST', f"/api/attempts/{text_attempt['id']}/annotation", {'image': marked},
                     cookie=self.teacher, expect=400)
        # 批註不影響原有分數與作答內容。
        _, state, _ = self.request('GET', '/api/state', cookie=self.student, expect=200)
        saved = next(a for a in state['attempts'] if a['id'] == aid)
        self.assertIsNone(saved['score'])
        self.assertEqual(saved['status'], 'pending')
        self.assertEqual(saved['annotation'], path)

    def test_teacher_can_toggle_economy_mode_without_admin_token(self):
        # 計費模式不含憑證，教師應能在沒有 MATH_ADMIN_TOKEN、且非本機的環境下切換。
        with patch.dict('os.environ', {'MATH_AI_BASE_URL': 'https://api.deepseek.com/v1',
                                       'MATH_AI_MODEL': 'deepseek-flash',
                                       'MATH_AI_API_KEY': 'sk-test'}, clear=True):
            self.app.reload_ai()
            self.assertFalse(self.app.ai.thinking, '預設應為省錢模式')
            # 學生不可切換
            self.request('POST', '/api/ai-config/economy', {'economy': True},
                         cookie=self.student, expect=403)
            # 教師切換為精確模式
            _, body, _ = self.request('POST', '/api/ai-config/economy', {'economy': False},
                                      cookie=self.teacher, expect=200)
            self.assertTrue(body['active']['thinking'])
            self.assertFalse(body['economy'])
            # 端點設定不能被覆寫掉
            self.assertEqual(body['active']['model'], 'deepseek-flash')
            # 切回省錢模式
            _, body, _ = self.request('POST', '/api/ai-config/economy', {'economy': True},
                                      cookie=self.teacher, expect=200)
            self.assertFalse(body['active']['thinking'])
            self.assertTrue(body['economy'])
            # 非布林值應被拒
            self.request('POST', '/api/ai-config/economy', {'economy': 'yes'},
                         cookie=self.teacher, expect=400)

    def test_deepseek_thinking_toggle_is_endpoint_safe(self):
        # 省錢模式（thinking=False）只對 DeepSeek 帶上開關，其他供應商不帶，避免未知欄位造成 400。
        captured = []

        class Recorder(BaseHTTPRequestHandler):
            def do_POST(self):
                captured.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                body = json.dumps({'choices': [{'message': {'content': '{"ok":true}'}}]}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *a):
                pass

        httpd = ThreadingHTTPServer(('127.0.0.1', 0), Recorder)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(httpd.shutdown)
        base = f'http://127.0.0.1:{httpd.server_address[1]}/v1'
        client = server.AIClient()
        def send(model, thinking):
            client.configure({'base_url': base, 'model': model, 'api_key': 'k',
                              'vision_model': '', 'thinking': thinking})
            client.call('只回傳 {"ok":true}', {'probe': 'text'})
            return captured[-1].get('thinking')
        self.assertEqual(send('deepseek-flash', False), {'type': 'disabled'})
        self.assertIsNone(send('deepseek-flash', True))
        self.assertIsNone(send('gpt-4o-mini', False))
        # 環境變數：預設為省錢（關閉思考）
        with patch.dict('os.environ', {}, clear=True):
            self.assertFalse(server.env_ai_config()['thinking'])
        with patch.dict('os.environ', {'MATH_AI_THINKING': 'on'}, clear=True):
            self.assertTrue(server.env_ai_config()['thinking'])

    def test_ai_config_endpoint_management(self):
        path = '/api/ai-config'
        self.request('GET', path, cookie=self.student, expect=403)
        self.request('POST', path, {'baseUrl': 'http://127.0.0.1:11434/v1', 'model': 'm'},
                     cookie=self.student, expect=403)
        _, body, _ = self.request('GET', path, cookie=self.teacher, expect=200)
        self.assertEqual(body['active'], {'configured': False, 'model': '', 'vision': '', 'mode': 'off', 'source': 'none', 'thinking': False})
        self.assertTrue(body['canEdit'], '本機且未設權杖時應可編輯')
        self.assertFalse(body['tokenRequired'])
        self.assertFalse(body['env']['keySet'])
        self.assertIsNone(body['saved'])
        self.assertFalse(body['invalidSaved'])
        # 無效端點：非本機必須 HTTPS、不可內嵌憑證、不可含查詢字串、欄位長度受限。
        for bad in ({'baseUrl': 'http://models.example.com/v1', 'model': 'm'},
                    {'baseUrl': 'https://user:pw@models.example.com/v1', 'model': 'm'},
                    {'baseUrl': 'https://models.example.com/v1?q=1', 'model': 'm'},
                    {'baseUrl': 'https://models.example.com/v1', 'model': 'x' * 300},
                    {'baseUrl': 'not-a-url', 'model': 'm'}):
            with self.subTest(bad=bad):
                self.request('POST', path, bad, cookie=self.teacher, expect=400)
        self.request('POST', path, {'baseUrl': 'https://models.example.com/v1', 'model': 'm', 'unknown': 1},
                     cookie=self.teacher, expect=400)
        self.request('POST', path, {}, cookie=self.teacher, expect=400)
        self.request('POST', path, {'clearKey': 'yes'}, cookie=self.teacher, expect=400)
        # 儲存本機端點並即時生效；金鑰絕不回傳瀏覽器。
        _, saved, _ = self.request('POST', path, {'baseUrl': 'http://127.0.0.1:11434/v1', 'model': 'local-text',
                                                 'visionModel': 'local-vision', 'apiKey': 'secret-key-123'},
                                   cookie=self.teacher, expect=200)
        self.assertEqual(saved['active']['configured'], True)
        self.assertEqual(saved['active']['mode'], 'local')
        self.assertEqual(saved['active']['model'], 'local-text')
        self.assertEqual(saved['active']['vision'], 'local-vision')
        self.assertEqual(saved['active']['source'], 'saved')
        self.assertTrue(saved['saved']['keySet'])
        self.assertNotIn('secret-key-123', json.dumps(saved, ensure_ascii=False))
        _, again, _ = self.request('GET', path, cookie=self.teacher, expect=200)
        self.assertNotIn('secret-key-123', json.dumps(again, ensure_ascii=False))
        self.assertEqual(again['active']['mode'], 'local')
        self.assertTrue(again['saved']['keySet'])
        # 未提供 apiKey 時保留原有金鑰；不需要重啟即反映在狀態。
        self.request('POST', path, {'baseUrl': 'http://127.0.0.1:11434/v1', 'model': 'local-text-2'},
                     cookie=self.teacher, expect=200)
        with self.app.db() as db:
            self.assertEqual(db.execute("SELECT value FROM meta WHERE key='ai_api_key'").fetchone()[0], 'secret-key-123')
        _, state, _ = self.request('GET', '/api/state', cookie=self.teacher, expect=200)
        self.assertEqual(state['ai']['configured'], True)
        self.assertEqual(state['ai']['source'], 'saved')
        self.assertEqual(state['ai']['model'], 'local-text-2')
        # 外部端點會被標示為 external，提交個人作答前需要同意。
        _, external, _ = self.request('POST', path, {'baseUrl': 'https://models.example.com/v1', 'model': 'remote'},
                                      cookie=self.teacher, expect=200)
        self.assertEqual(external['active']['mode'], 'external')
        # 清除設定即取消 AI，並移除已儲存金鑰。
        _, cleared, _ = self.request('POST', path, {'baseUrl': '', 'model': ''}, cookie=self.teacher, expect=200)
        self.assertEqual(cleared['active']['configured'], False)
        self.assertEqual(cleared['active']['source'], 'none')
        self.assertIsNone(cleared['saved'])
        with self.app.db() as db:
            self.assertIsNone(db.execute("SELECT value FROM meta WHERE key='ai_api_key'").fetchone())
        # 連線測試需要端點與模型，並會實際呼叫模型。
        self.request('POST', '/api/ai-config/test', {'baseUrl': 'http://127.0.0.1:11434/v1'},
                     cookie=self.teacher, expect=400)
        with patch.object(server.AIClient, 'probe', return_value='ok') as probe:
            _, tested, _ = self.request('POST', '/api/ai-config/test',
                                        {'baseUrl': 'http://127.0.0.1:11434/v1', 'model': 'm',
                                         'visionModel': 'v', 'vision': True},
                                        cookie=self.teacher, expect=200)
        self.assertEqual(tested, {'ok': True, 'mode': 'local', 'model': 'm', 'testedVision': True})
        self.assertEqual(probe.call_args.kwargs, {'vision': True})
        # 設定 MATH_ADMIN_TOKEN 後，必須提供正確權杖才能更換端點。
        with patch.dict('os.environ', {'MATH_ADMIN_TOKEN': 'admin-token-1234'}):
            self.request('POST', path, {'baseUrl': 'http://127.0.0.1:11434/v1', 'model': 'm'},
                         cookie=self.teacher, expect=403)
            self.request('POST', path, {'baseUrl': 'http://127.0.0.1:11434/v1', 'model': 'm',
                                        'adminToken': 'wrong-token'}, cookie=self.teacher, expect=403)
            self.request('POST', '/api/ai-config/test',
                         {'baseUrl': 'http://127.0.0.1:11434/v1', 'model': 'm'}, cookie=self.teacher, expect=403)
            self.request('POST', path, {'baseUrl': 'http://127.0.0.1:11434/v1', 'model': 'm',
                                        'adminToken': 'admin-token-1234'}, cookie=self.teacher, expect=200)
            _, guarded, _ = self.request('GET', path, cookie=self.teacher, expect=200)
        self.assertFalse(guarded['canEdit'])
        self.assertTrue(guarded['tokenRequired'])
        # 已儲存設定優先於環境變數，且服務重啟後仍然生效。
        with patch.dict('os.environ', {'MATH_AI_BASE_URL': 'http://127.0.0.1:9/v1', 'MATH_AI_MODEL': 'env-model'}):
            restarted = server.Application(self.app.data_dir)
            restarted.safe_initialize()
            self.assertEqual(restarted.ai.model, 'm')
            self.assertEqual(restarted.ai.source, 'saved')
        with self.app.db() as db:
            db.execute("UPDATE meta SET value='http://models.example.com/v1' WHERE key='ai_base_url'")
        restarted = server.Application(self.app.data_dir)
        restarted.safe_initialize()
        self.assertFalse(restarted.ai.configured, '已損壞的設定應回退環境變數而不是讓服務無法啟動')
        self.assertTrue(restarted.ai.invalid_saved)

    def test_users_bulk_over_http_and_atomic_rollback(self):
        students = [{'username': f'b3a{i:02d}', 'name': f'三甲{i:02d}', 'password': 'BulkPass1234'} for i in range(1, 4)]
        for cookie, status in ((None, 401), (self.student, 403)):
            self.request('POST', '/api/users/bulk', {'students': students}, cookie=cookie, expect=status)
        self.request('POST', '/api/users/bulk', {'students': students[:1] + [dict(students[1], password='short')]},
                     cookie=self.teacher, expect=400)
        self.request('POST', '/api/users/bulk', {'students': students[:1] + [students[0]]},
                     cookie=self.teacher, expect=400)
        self.request('POST', '/api/users/bulk', {'students': students[:1] + [dict(students[1], username='student')]},
                     cookie=self.teacher, expect=409)
        self.request('POST', '/api/users/bulk', {'students': [dict(students[0], role='teacher')]},
                     cookie=self.teacher, expect=400)
        self.request('POST', '/api/users/bulk', {'students': []}, cookie=self.teacher, expect=400)
        with self.app.db() as db:
            self.assertIsNone(db.execute("SELECT 1 FROM users WHERE username LIKE 'b3a%'").fetchone())
        _, result, _ = self.request('POST', '/api/users/bulk', {'students': students}, cookie=self.teacher, expect=200)
        self.assertEqual(result['count'], 3)
        self.assertEqual([u['role'] for u in result['users']], ['student'] * 3)
        self.assertEqual([u['username'] for u in result['users']], [s['username'] for s in students])
        with self.app.db() as db:
            rows = db.execute("SELECT username,role,password,demo FROM users WHERE username LIKE 'b3a%' ORDER BY username").fetchall()
        self.assertEqual(len(rows), 3)
        for row in rows:
            self.assertEqual((row['role'], row['demo']), ('student', 0))
            self.assertNotIn('BulkPass1234', row['password'])
        self.assertTrue(server.password_matches('BulkPass1234', rows[0]['password']))
        # 新帳戶可登入並可被編入班級。
        cookie = self.login('b3a01', 'BulkPass1234')
        _, session, _ = self.request('GET', '/api/session', cookie=cookie, expect=200)
        self.assertEqual(session['user']['role'], 'student')
        ids = [u['id'] for u in result['users']]
        _, classroom, _ = self.request('POST', '/api/classes',
                                       {'name': '三甲', 'studentIds': ids}, cookie=self.teacher, expect=200)
        self.assertEqual(classroom['class']['studentCount'], 3)
        self.request('POST', '/api/users/bulk', {'students': [{'username': 'b3a01', 'name': '重複', 'password': 'BulkPass1234'}]},
                     cookie=self.teacher, expect=409)
        # 同源驗證仍然適用。
        self.request('POST', '/api/users/bulk', {'students': students}, cookie=self.teacher,
                     origin='http://evil.example', expect=403)

    def test_users_creation_login_and_teacher_only_listing(self):
        body = {'username': 'Class_3.A-01', 'name': '獨立學生', 'password': 'StudentPass123!'}
        for cookie, status in ((None, 401), (self.student, 403)):
            self.request('GET', '/api/users', cookie=cookie, expect=status)
            self.request('POST', '/api/users', body, cookie=cookie, expect=status)
        _, result, _ = self.request('POST', '/api/users', body, cookie=self.teacher, expect=200)
        created = result['user']
        self.assertEqual(created, {'id': 3, 'username': body['username'], 'name': body['name'], 'role': 'student'})
        self.request('POST', '/api/users', body, cookie=self.teacher, expect=409)
        self.request('POST', '/api/users', dict(body, username='student'), cookie=self.teacher, expect=409)
        _, listing, _ = self.request('GET', '/api/users', cookie=self.teacher, expect=200)
        self.assertEqual(set(listing), {'users'})
        self.assertEqual(listing['users'][-1], created)
        for user in listing['users']:
            self.assertEqual(set(user), {'id', 'username', 'name', 'role'})
        with self.app.db() as db:
            row = db.execute('SELECT * FROM users WHERE id=?', (created['id'],)).fetchone()
            self.assertEqual(row['demo'], 0)
            self.assertEqual(row['role'], 'student')
            self.assertNotEqual(row['password'], body['password'])
            self.assertRegex(row['password'], r'^[0-9a-f]{32}:[0-9a-f]{128}$')
            self.assertTrue(server.password_matches(body['password'], row['password']))
            self.assertNotEqual(row['password'], server.password_hash(body['password']))
        self.request('POST', '/api/login', {'username': body['username'], 'password': 'WrongPass123!'}, expect=401)
        cookie = self.login(body['username'], body['password'])
        _, session, _ = self.request('GET', '/api/session', cookie=cookie, expect=200)
        self.assertEqual(session['user'], {k: created[k] for k in ('id', 'name', 'role')})
        self.assertEqual(session['notice'], '')
        self.request('GET', '/api/users', cookie=cookie, expect=403)
        self.request('POST', '/api/users', dict(body, username='forbidden'), cookie=cookie, expect=403)
        self.request('POST', '/api/questions/import', {'questions': [self.draft]}, cookie=cookie, expect=403)
        self.request('POST', '/api/papers/parse', {'name': '試卷', 'text': '1. 解方程'}, cookie=cookie, expect=403)
        self.request('POST', '/api/attempts/1/review', {'score': 6, 'feedback': '測試'}, cookie=cookie, expect=403)
        again = server.Application(self.root / 'data')
        with again.db() as db:
            self.assertEqual(db.execute('SELECT username FROM users WHERE id=3').fetchone()[0], body['username'])

    def test_users_validation_and_no_role_injection(self):
        body = {'username': 'new-student', 'name': '學生', 'password': 'ValidPass123!'}
        invalid = [dict(body, username=value) for value in (
            'ab', 'a' * 41, '學生123', 'ＡＢＣ', 'abc def', ' abc', 'abc ', 'abc/def', 'abc\\def',
            "abc' OR 1=1", '', None, 123, 'abc\x00')]
        invalid += [dict(body, name=value) for value in ('', ' ', '名' * 61, None, [], '名\x00')]
        invalid += [dict(body, password=value) for value in ('short1234', 'x' * 257, ' ' * 10, None, [], 'pass\x00word123')]
        invalid += [dict(body, role=role) for role in ('teacher', 'student', 'admin', None)]
        invalid += [dict(body, id=99), dict(body, demo=1), dict(body, unknown=True),
                    dict(body, password_hash='fake'), {k: v for k, v in body.items() if k != 'name'}]
        for candidate in invalid:
            with self.subTest(candidate=candidate):
                self.request('POST', '/api/users', candidate, cookie=self.teacher, expect=400)
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM users').fetchone()[0], 2)
        for i, candidate in enumerate((dict(body, username='A_1', name='名', password='p' * 10),
                                       dict(body, username='a' * 40, name='名' * 60, password='p' * 256))):
            self.request('POST', '/api/users', candidate, cookie=self.teacher, expect=200)
            cookie = self.login(candidate['username'], candidate['password'])
            _, session, _ = self.request('GET', '/api/session', cookie=cookie, expect=200)
            self.assertEqual(session['user']['id'], 3 + i)

    def test_users_same_origin_and_concurrent_unique_conflict(self):
        body = {'username': 'unique-user', 'name': '學生', 'password': 'UniquePass123!'}
        for origin in (False, 'null', 'https://evil.invalid', 'http://localhost:' + str(self.httpd.server_port)):
            self.request('POST', '/api/users', body, cookie=self.teacher, origin=origin, expect=403)
        self.request('POST', '/api/users', body, cookie=self.teacher,
                     extra={'Sec-Fetch-Site': 'cross-site'}, expect=403)
        self.request('POST', '/api/users', body, cookie=self.teacher, origin=False,
                     extra={'Referer': self.origin + '/index.html'}, expect=200)
        concurrent = dict(body, username='concurrent-user')
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda _: self.request('POST', '/api/users', concurrent, cookie=self.teacher), range(2)))
        self.assertEqual(sorted(response[0] for response in responses), [200, 409])
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM users WHERE username=?', (concurrent['username'],)).fetchone()[0], 1)

    def test_password_change_and_session_revocation(self):
        second = self.login('student', 'Math1234!')
        self.request('POST', '/api/change-password', {'oldPassword': 'bad', 'newPassword': 'NewMathPass123!'}, cookie=self.student, expect=401)
        self.request('POST', '/api/change-password', {'oldPassword': 'Math1234!', 'newPassword': 'short'}, cookie=self.student, expect=400)
        _, body, headers = self.request('POST', '/api/change-password', {'oldPassword': 'Math1234!', 'newPassword': 'NewMathPass123!'}, cookie=self.student, expect=200)
        self.assertIn('密碼已更新', body['notice'])
        self.request('GET', '/api/state', cookie=second, expect=401)
        self.request('GET', '/api/state', cookie=self.student, expect=401)
        self.request('GET', '/api/state', cookie=headers['Set-Cookie'].split(';')[0], expect=200)
        self.request('POST', '/api/login', {'username': 'student', 'password': 'Math1234!'}, expect=401)
        new_cookie = self.login('student', 'NewMathPass123!')
        _, state, _ = self.request('GET', '/api/state', cookie=new_cookie, expect=200)
        self.assertEqual(state['notice'], '')
        with self.app.db() as db:
            hashed = db.execute('SELECT password FROM users WHERE id=1').fetchone()[0]
            self.assertNotIn('NewMathPass123!', hashed)
            self.assertTrue(server.password_matches('NewMathPass123!', hashed))
            self.assertNotEqual(server.password_hash('NewMathPass123!'), hashed)

    def test_csrf_host_and_referer(self):
        body = {'username': 'student', 'password': 'Math1234!'}
        self.request('POST', '/api/login', body, origin=False, expect=403)
        self.request('POST', '/api/login', body, origin='https://evil.invalid', expect=403)
        self.request('POST', '/api/login', body, origin='null', expect=403)
        self.request('POST', '/api/login', body, extra={'Sec-Fetch-Site': 'cross-site'}, expect=403)
        self.request('GET', '/api/session', extra={'Host': 'evil.invalid'}, expect=403)
        self.request('POST', '/api/login', body, origin=False, extra={'Referer': self.origin + '/index.html'}, expect=200)
        self.request('POST', '/api/login', body, origin=False, extra={'Referer': self.origin + '.evil.invalid/'}, expect=403)
        self.request('POST', '/api/login', body, origin='http://localhost:' + str(self.httpd.server_port), expect=403)
        self.request('POST', '/api/login', body, origin=False, extra={'Referer': 'https://evil.invalid/'}, expect=403)

    def test_invalid_json_and_inputs(self):
        for raw in (b'{', b'[]', b'{"useAi":NaN}', b'{"a":1,"a":2}', b'\xff', b'{"answerText":"\\ud800"}'):
            self.request('POST', '/api/attempts', cookie=self.student, raw=raw, expect=400)
        self.request('POST', '/api/login', {'username': 'student', 'password': 'x'}, extra={'Content-Type': 'text/plain'}, expect=415)
        for patch_body in [{'questionId': True}, {'questionId': -1}, {'questionId': '1'}, {'useAi': 'false'},
                           {'answerText': []}, {'consentExternal': 'yes'}, {'image': 'data:image/png;base64,YWJj'}, {'answerText': ''},
                           {'questionId': 1e100}, {'answerText': 'a\x00b'}, {'answerText': 'x' * 80001}]:
            body = {'questionId': 1, 'answerText': 'x=2或3', 'useAi': False, **patch_body}
            self.request('POST', '/api/attempts', body, cookie=self.student, expect=400)
        self.request('POST', '/api/attempts', {'questionId': 99999, 'answerText': 'x', 'useAi': False}, cookie=self.student, expect=404)
        self.request('POST', '/api/questions/1/generate', {'kind': 'fake'}, cookie=self.student, expect=400)
        self.request('GET', '/api/questions/99999/recommendations', cookie=self.student, expect=404)

    def test_request_and_file_limits(self):
        self.request('POST', '/api/attempts', raw=b'{}', cookie=self.student,
                     extra={'Content-Length': str(server.MAX_BODY + 1)}, expect=413)
        huge = 'data:image/png;base64,' + base64.b64encode(b'x' * (server.MAX_FILE + 1)).decode()
        self.request('POST', '/api/attempts', {'questionId': 1, 'answerText': '', 'useAi': False, 'image': huge},
                     cookie=self.student, expect=413)
        broken = png_url().replace('data:image/png;', 'data:image/jpeg;')
        self.request('POST', '/api/attempts', {'questionId': 1, 'answerText': '', 'useAi': False, 'image': broken}, cookie=self.student, expect=400)

    def test_no_ai_handwritten_and_missing_answer_pending(self):
        self.assertEqual(self.submit('x=2或3', image=png_url(), useAi=True)['status'], 'pending')
        self.assertEqual(self.submit('x=2或3', useAi=True)['gradingMethod'], 'rule-final')
        self.request('POST', '/api/questions/import', {'questions': [dict(self.draft, answer='')]}, cookie=self.teacher, expect=200)
        result = self.request('POST', '/api/attempts', {'questionId': 17, 'answerText': '2', 'useAi': False}, cookie=self.student, expect=200)[1]['attempt']
        self.assertEqual(result['status'], 'pending')
        self.assertIsNone(result['score'])

    def test_pdf_and_vision_do_not_fake_success(self):
        self.request('POST', '/api/papers/parse', {'name': '圖像', 'dataUrl': png_url(), 'mime': 'image/png'}, cookie=self.teacher, expect=409)
        fake_pdf = 'data:application/pdf;base64,' + base64.b64encode(b'not pdf').decode()
        self.request('POST', '/api/papers/parse', {'name': 'PDF', 'dataUrl': fake_pdf, 'mime': 'application/pdf'}, cookie=self.teacher, expect=400)
        pdf = 'data:application/pdf;base64,' + base64.b64encode(b'%PDF-1.4\n%%EOF').decode()
        with patch.dict('sys.modules', {'pypdf': None}):
            _, result, _ = self.request('POST', '/api/papers/parse', {'name': 'PDF', 'dataUrl': pdf, 'mime': 'application/pdf'}, cookie=self.teacher, expect=422)
            self.assertIn('貼上', result['error'])
        class Page:
            def extract_text(self):
                return ''
        class Reader:
            is_encrypted = False
            pages = [Page()]
            def __init__(self, *args):
                pass
        fake_module = type('Module', (), {'PdfReader': Reader})
        with patch.dict('sys.modules', {'pypdf': fake_module}):
            _, result, _ = self.request('POST', '/api/papers/parse', {'name': 'PDF', 'dataUrl': pdf, 'mime': 'application/pdf'}, cookie=self.teacher, expect=422)
            self.assertIn('逐頁', result['error'])
        class TextPage:
            def extract_text(self):
                return '1. 解 x²−5x+6=0。\n2、求中位數。'
        Reader.pages = [TextPage()]
        with patch.dict('sys.modules', {'pypdf': fake_module}):
            _, result, _ = self.request('POST', '/api/papers/parse', {'name': 'PDF', 'dataUrl': pdf, 'mime': 'application/pdf'}, cookie=self.teacher, expect=200)
            self.assertEqual(len(result['drafts']), 2)
            self.assertEqual(result['method'], '規則拆題')

    def test_real_pypdf_text_upload(self):
        try:
            from pypdf import PdfWriter
            from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
        except ImportError:
            self.skipTest('此备用解释器未安装可选 pypdf')
        writer = PdfWriter()
        page = writer.add_blank_page(width=300, height=300)
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'),
                                 NameObject('/Subtype'): NameObject('/Type1'),
                                 NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font})})
        stream = DecodedStreamObject()
        stream.set_data(b'BT /F1 12 Tf 20 250 Td (1. Solve x^2-5x+6=0.) Tj 0 -20 Td (2. Find the median.) Tj ET')
        page[NameObject('/Contents')] = stream
        output = io.BytesIO()
        writer.write(output)
        pdf = output.getvalue()
        self.assertTrue(pdf.startswith(b'%PDF-'))
        self.assertIn('Solve', server.pdf_text(pdf))
        data_url = 'data:application/pdf;base64,' + base64.b64encode(pdf).decode()
        _, result, _ = self.request('POST', '/api/papers/parse', {'name': '真實 PDF', 'dataUrl': data_url, 'mime': 'application/pdf'},
                                    cookie=self.teacher, expect=200)
        self.assertEqual(result['method'], '規則拆題')
        self.assertEqual(len(result['drafts']), 2)
        self.assertEqual([q['topic'] for q in result['drafts']], ['一元二次方程', '統計'])
        self.assertIn('Solve x^2-5x+6=0.', result['drafts'][0]['content'])

    def test_static_allowlist_and_no_source_leak(self):
        for path in ['/server.py', '/test_server.py', '/deployment.txt', '/data/mathpath.sqlite3', '/data/',
                     '/%2e%2e/server.py', '/../../server.py', '/api/unknown', '/index.html']:
            self.request('GET', path, cookie=self.teacher, expect=404)
        for filename, mime in [('index.html', 'text/html'), ('app.js', 'text/javascript'), ('styles.css', 'text/css')]:
            (self.root / filename).write_text('test-static', encoding='utf-8')
            _, data, headers = self.request('GET', '/' + filename, expect=200)
            self.assertEqual(data, b'test-static')
            self.assertTrue(headers['Content-Type'].startswith(mime))
        (self.root / 'app.js').unlink()
        (self.root / 'secret').write_text('never-public', encoding='utf-8')
        (self.root / 'app.js').symlink_to(self.root / 'secret')
        self.request('GET', '/app.js', expect=404)
        self.request('GET', '/api/session?x=1', expect=400)
        self.request('DELETE', '/api/logout', {}, cookie=self.student, expect=405)

    def test_expired_session_and_login_rate_limit(self):
        with self.app.db() as db:
            db.execute('UPDATE sessions SET expires=? WHERE user_id=1', (time.time() - 1,))
        self.request('GET', '/api/state', cookie=self.student, expect=401)
        for _ in range(9):
            self.request('POST', '/api/login', {'username': 'student', 'password': 'wrong'}, expect=401)
        self.request('POST', '/api/login', {'username': 'student', 'password': 'wrong'}, expect=429)

    def test_persistence_and_first_creation_password_override(self):
        attempt = self.submit('x=2或3')
        again = server.Application(self.root / 'data')
        with again.db() as db:
            self.assertEqual(db.execute('PRAGMA journal_mode').fetchone()[0], 'wal')
            self.assertEqual(db.execute('SELECT count(*) FROM questions').fetchone()[0], 16)
            self.assertEqual(db.execute('SELECT id FROM attempts').fetchone()[0], attempt['id'])
            self.assertEqual(db.execute('SELECT count(*) FROM users').fetchone()[0], 2)
        with patch.dict('os.environ', {'MATH_STUDENT_PASSWORD': 'CustomStudent123!', 'MATH_TEACHER_PASSWORD': 'CustomTeacher123!'}):
            custom = server.Application(self.root / 'custom-data')
            custom.safe_initialize()
            with custom.db() as db:
                rows = db.execute('SELECT * FROM users ORDER BY id').fetchall()
                self.assertTrue(server.password_matches('CustomStudent123!', rows[0]['password']))
                self.assertTrue(server.password_matches('CustomTeacher123!', rows[1]['password']))
                self.assertEqual(rows[0]['demo'], 0)
            server.Application(self.root / 'data')
        with self.app.db() as db:
            self.assertTrue(server.password_matches('Math1234!', db.execute('SELECT password FROM users WHERE id=1').fetchone()[0]))

    def test_external_consent_and_ai_grade_validation(self):
        self.app.ai.configured = True
        self.app.ai.mode = 'external'
        result = {'score': 4, 'feedback': '步驟部分正確', 'steps': [{'label': '因式分解', 'earned': 4, 'max': 6, 'comment': '需補兩根'}]}
        body = {'questionId': 1, 'answerText': 'x=2', 'useAi': True}
        with patch.object(self.app.ai, 'call', return_value=result) as ai:
            self.request('POST', '/api/attempts', body, cookie=self.student, expect=403)
            ai.assert_not_called()
            _, response, _ = self.request('POST', '/api/attempts', dict(body, consentExternal=True), cookie=self.student, expect=200)
            self.assertEqual(response['attempt']['gradingMethod'], 'ai-advisory')
            self.assertEqual(response['attempt']['score'], 4)
            self.assertIn('僅供教師復核', response['attempt']['feedback'])
            self.assertFalse(response['attempt']['teacherReviewed'])
            self.assertEqual(response['attempt']['steps'][0]['earned'], 4)
        for invalid in [dict(result, score=1000), dict(result, score=-1), dict(result, score=True),
                        dict(result, score=float('nan')), dict(result, score=5), dict(result, steps=[]),
                        dict(result, feedback=[]), dict(result, steps=[{'label': 'x', 'earned': 7, 'max': 6, 'comment': 'x'}])]:
            with patch.object(self.app.ai, 'call', return_value=invalid):
                self.request('POST', '/api/attempts', dict(body, consentExternal=True), cookie=self.student, expect=502)
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0], 1)
        with patch.object(self.app.ai, 'call') as ai:
            _, parsed, _ = self.request('POST', '/api/papers/parse', {'name': '文本', 'text': '1. 解 x²−5x+6=0。'}, cookie=self.teacher, expect=200)
            self.assertEqual(parsed['method'], '規則拆題')
            ai.assert_not_called()
        self.app.ai.vision = 'vision'
        with patch.object(self.app.ai, 'call') as ai:
            self.request('POST', '/api/papers/parse', {'name': '圖片', 'dataUrl': png_url(), 'mime': 'image/png'}, cookie=self.teacher, expect=403)
            ai.assert_not_called()

    def test_generate_external_consent_required_before_model_call(self):
        generated = dict(self.draft, title='外部 AI 新題')
        for base in ('https://external.invalid/v1', 'https://192.168.1.2/v1'):
            with patch.dict('os.environ', {'MATH_AI_BASE_URL': base, 'MATH_AI_MODEL': 'model'}, clear=True):
                self.app.ai = server.AIClient()
            self.assertEqual(self.app.ai.mode, 'external')
            for cookie in (self.student, self.teacher):
                with patch.object(self.app.ai, 'call', return_value={'question': generated}) as ai:
                    for patch_body, status in (({}, 403), ({'consentExternal': False}, 403),
                                               ({'consentExternal': 'true'}, 400), ({'consentExternal': 1}, 400),
                                               ({'consentExternal': None}, 400), ({'unknown': True}, 400)):
                        self.request('POST', '/api/questions/1/generate', {'kind': 'similar', **patch_body},
                                     cookie=cookie, expect=status)
                    ai.assert_not_called()
                    with self.app.db() as db:
                        before = db.execute('SELECT count(*) FROM questions').fetchone()[0]
                    _, result, _ = self.request('POST', '/api/questions/1/generate',
                                                {'kind': 'similar', 'consentExternal': True}, cookie=cookie, expect=200)
                    ai.assert_called_once()
                    self.assertEqual(result['question']['source'], 'AI 生成 · 待核驗')
                    self.assertEqual('answer' in result['question'], cookie == self.teacher)
                    with self.app.db() as db:
                        self.assertEqual(db.execute('SELECT count(*) FROM questions').fetchone()[0], before + 1)

    def test_generated_question_storage_and_student_solution_hidden(self):
        self.app.ai.configured = True
        self.app.ai.mode = 'local'
        generated = dict(self.draft, title='AI 新題')
        with patch.object(self.app.ai, 'call', return_value={'question': generated}):
            _, result, _ = self.request('POST', '/api/questions/1/generate', {'kind': 'similar'}, cookie=self.student, expect=200)
        q = result['question']
        self.assertEqual(q['id'], 17)
        self.assertEqual(q['source'], 'AI 生成 · 待核驗')
        self.assertNotIn('answer', q)
        self.assertNotIn('steps', q)
        with self.app.db() as db:
            stored = self.app.get_question(db, 17)
            self.assertEqual(stored['answer'], generated['answer'])
        with patch.object(self.app.ai, 'call', return_value={'question': dict(generated, level=3)}):
            self.request('POST', '/api/questions/1/generate', {'kind': 'similar'}, cookie=self.teacher, expect=502)
        with patch.object(self.app.ai, 'call', return_value={'question': dict(generated, level=2)}):
            _, result, _ = self.request('POST', '/api/questions/1/generate', {'kind': 'advanced'}, cookie=self.teacher, expect=200)
            self.assertIn('answer', result['question'])
        with patch.object(self.app.ai, 'call', return_value={'drafts': [generated]}):
            _, parsed, _ = self.request('POST', '/api/papers/parse', {'name': '試卷', 'text': '1. 解方程'}, cookie=self.teacher, expect=200)
            self.assertEqual(parsed['method'], 'AI 識別')


class PureTests(unittest.TestCase):
    def test_start_command_interpreter_priority_and_fallbacks(self):
        root = Path(__file__).resolve().parent
        script = root / 'start.command'
        subprocess.run(['/bin/zsh', '-n', str(script)], check=True, capture_output=True, text=True)
        result = subprocess.run(['/bin/zsh', '-x', str(script), '--help'], check=True, capture_output=True, text=True)
        self.assertIn('usage:', result.stdout)
        if os.access(PYTHON, os.X_OK):
            self.assertIn('> ' + PYTHON + ' ', result.stderr)
        source = script.read_text(encoding='utf-8')
        with tempfile.TemporaryDirectory(prefix='mathpath-start-') as tmp:
            directory = Path(tmp)
            preferred, managed, generic = [directory / name for name in ('preferred', 'managed', 'python3')]
            isolated = directory / 'start.command'
            isolated.write_text(source.replace(PYTHON, str(preferred)).replace(
                '/Users/laokunleng/.workbuddy-ai/binaries/python/versions/3.13.12/bin/python3', str(managed)), encoding='utf-8')
            for executable in (preferred, managed, generic):
                executable.write_text('#!/bin/zsh\nprintf "%s\\n" "$0" "$@"\n', encoding='utf-8')
                executable.chmod(0o700)
            for executable in (preferred, managed, generic):
                result = subprocess.run(['/bin/zsh', str(isolated), '--port', '9876'],
                                        env={**os.environ, 'PATH': str(directory) + ':/usr/bin:/bin'},
                                        check=True, capture_output=True, text=True)
                self.assertEqual(result.stdout.splitlines(), [str(executable), str(directory / 'server.py'), '--port', '9876'])
                executable.unlink()

    def test_strict_equivalent_final_answers(self):
        for a, b in [('x=3或2', 'x=2或3'), ('{2,3}', 'x=2或3'), ('2/6', '1/3'),
                     ('0.3', '3/10'), ('x=5.0', 'x=5'), ('5厘米', '5 cm'), ('36 cm²', '36 cm²')]:
            self.assertTrue(server.final_correct(a, b), (a, b))
        for a, b in [('x=2', 'x=2或3'), ('y=2或3', 'x=2或3'), ('x=2或3或4', 'x=2或3'),
                     ('2/0', '2'), ('0.3333333', '1/3'), ('先分解，得到x=2或3', 'x=2或3'),
                     ('5', '5 cm'), ('36 cm', '36 cm²'), ('{2,3', 'x=2或3'), ('3 6', '36'), ('__import__("os")', '1')]:
            self.assertFalse(server.final_correct(a, b), (a, b))

    def test_final_answer_prefix_only_on_last_nonempty_line(self):
        reference = 'x=2或3'
        for answer in ('推導\n最終答案：x=2 或 x=3', '推導\n最终答案:x=3 或 x=2\n\n',
                       '推導\n  Final answer: x=2 or x=3  \n \t', '最終答案：x=2 或 x=3'):
            self.assertTrue(server.final_correct(answer, reference), answer)
        for answer in ('途中最終答案：x=2 或 x=3', 'My Final answer: x=2 or x=3',
                       '最終答案為：x=2 或 x=3', '最終答案 x=2 或 x=3',
                       'Final answers: x=2 or x=3', 'Final answer：x=2 or x=3',
                       '最終答案：x=2 或 x=3\n其他文字', '最終答案：x=2 或 x=3\nx=4',
                       '最終答案：x=2 或 x=3\nx=2 或 x=3', '最終答案：x=2 或 x=3\n最終答案：x=4',
                       '推導\n最終答案：x=2 或 x=3，附註', '推導\n最終答案：'):
            self.assertFalse(server.final_correct(answer, reference), answer)

    def test_seed_answers_mathematically_verified(self):
        q = server.seed_questions()
        coefficients = [(1, -5, 6), (1, -7, 12), (1, -6, 9), (1, -4, 4), (1, 1, -6)]
        for i, (a, b, c) in enumerate(coefficients):
            roots = server.canonical_answer(q[i]['answer'])[2] if i != 3 else {2}
            for x in roots:
                self.assertEqual(a*x*x + b*x + c, 0)
        self.assertEqual(server.canonical_answer(q[5]['answer'])[2], {7})
        self.assertEqual(server.canonical_answer(q[6]['answer'])[2], {2})
        self.assertEqual((3**2 + 4**2)**0.5, 5)
        self.assertEqual(180 - 50 - 60, 70)
        self.assertEqual(sum([2, 4, 6, 8, 10])/5, 6)
        self.assertEqual(sorted([9, 3, 7, 11, 5])[2], 7)
        self.assertEqual(q[0]['points'], 6)

    def test_ai_local_openai_protocol_and_no_redirect(self):
        captured = []
        class FakeAI(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                captured.append((self.path, self.headers.get('Authorization'), body))
                result = {'choices': [{'message': {'content': json.dumps({'ok': True})}}]}
                data = json.dumps(result).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            def log_message(self, *args):
                pass
        httpd = ThreadingHTTPServer(('127.0.0.1', 0), FakeAI)
        worker = threading.Thread(target=httpd.serve_forever, daemon=True)
        worker.start()
        try:
            with patch.dict('os.environ', {'MATH_AI_BASE_URL': f'http://127.0.0.1:{httpd.server_port}/v1',
                                           'MATH_AI_MODEL': 'test-model', 'MATH_AI_API_KEY': 'never-browser-secret'}, clear=True):
                client = server.AIClient()
                self.assertEqual(client.mode, 'local')
                self.assertEqual(client.call('測試', {'text': '數學'}), {'ok': True})
                self.assertNotIn('never-browser-secret', json.dumps(client.public()))
                client.call('視覺測試', {'text': ''}, image=png_url(), model='test-vision')
            self.assertEqual(captured[0][0], '/v1/chat/completions')
            self.assertEqual(captured[0][1], 'Bearer never-browser-secret')
            self.assertEqual(captured[0][2]['model'], 'test-model')
            self.assertEqual(captured[1][2]['model'], 'test-vision')
            self.assertEqual(captured[1][2]['messages'][1]['content'][1]['type'], 'image_url')
        finally:
            httpd.shutdown()
            httpd.server_close()
            worker.join(timeout=3)
        self.assertIsNone(server.NoRedirect().redirect_request(None, None, 302, None, None, 'https://untrusted.invalid'))

    def test_ai_configuration_requires_https_external(self):
        for base in ('http://192.168.1.2/v1', 'http://external.invalid/v1', 'https://user:pass@external.invalid/v1',
                     'file:///tmp/model', 'https://external.invalid/v1?key=secret'):
            with patch.dict('os.environ', {'MATH_AI_BASE_URL': base, 'MATH_AI_MODEL': 'model'}, clear=True):
                with self.assertRaises(ValueError):
                    server.AIClient()
        with patch.dict('os.environ', {'MATH_AI_BASE_URL': 'https://external.invalid/v1', 'MATH_AI_MODEL': 'model'}, clear=True):
            self.assertEqual(server.AIClient().mode, 'external')
        with patch.dict('os.environ', {}, clear=True):
            self.assertEqual(server.AIClient().mode, 'off')


if __name__ == '__main__':
    unittest.main(verbosity=2)
