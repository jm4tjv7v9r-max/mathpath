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
        body = {'questionId': 1, 'answerText': answer}
        if image:
            body['image'] = image
        body.update(kwargs)
        return self.request('POST', '/api/attempts', body, cookie=self.student, expect=200)[1]['attempt']

    def student_id(self, username='student'):
        with self.app.db() as db:
            return db.execute('SELECT id FROM users WHERE username=?', (username,)).fetchone()[0]

    def ai_assignment(self, question_ids, ai_grading=True, duration=None, kind='homework'):
        """建立一份作業並由教師決定是否啟用 AI 建議評分；回傳作業編號。"""
        _, classroom, _ = self.request('POST', '/api/classes',
                                       {'name': 'AI 測試班', 'studentIds': [self.student_id()]},
                                       cookie=self.teacher, expect=200)
        body = {'title': 'AI 作業', 'classId': classroom['class']['id'], 'questionIds': question_ids,
                'dueAt': '2099-01-01T00:00:00Z', 'aiGrading': ai_grading, 'kind': kind,
                'durationMinutes': duration}
        _, created, _ = self.request('POST', '/api/assignments', body, cookie=self.teacher, expect=200)
        return created['assignment']['id']

    def teacher_attempt(self, aid, attempt_id):
        """以教師視角讀取作業作答：學生在教師批閱前看不到分數與 AI 批閱結果。"""
        _, detail, _ = self.request('GET', f'/api/assignments/{aid}', cookie=self.teacher, expect=200)
        return next(a for a in detail['attempts'] if a['id'] == attempt_id)

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
        self.assertEqual(state['questions'][0]['answer'], '$x=2$ 或 $x=3$')
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

    def test_ai_draft_coercion_tolerates_imperfect_model_output(self):
        # AI 常有多餘欄位、型別不符、自創分類；這些都應該被寬容修正而不是整批失敗。
        base = {'title': 'T', 'content': '解 x²−5x+6=0。', 'topic': '一元二次方程',
                'level': 1, 'points': 5, 'answer': 'a', 'grade': '中三'}
        # 多餘欄位 + level/points 是字串 + 自創子分類
        messy = dict(base, level='2', points='6', subtopic='因式分解法求解', extra='x')
        fixed = server.coerce_ai_draft(messy)
        self.assertEqual(fixed['topic'], '一元二次方程')
        self.assertEqual(fixed['subtopic'], '因式分解法', '應模糊對應到合法子分類')
        self.assertEqual(fixed['level'], 2)
        self.assertEqual(fixed['points'], 6)
        self.assertNotIn('extra', fixed)
        # AI 把子分類誤填到 topic
        fixed2 = server.coerce_ai_draft(dict(base, topic='因式分解法'))
        self.assertEqual(fixed2['topic'], '一元二次方程')
        self.assertEqual(fixed2['subtopic'], '因式分解法')
        # 完全自創的子分類 → 清空但保留主分類
        fixed3 = server.coerce_ai_draft(dict(base, subtopic='神奇的解法'))
        self.assertEqual(fixed3['subtopic'], '')
        # answer 是數字、steps 是字串 → 型別修正
        fixed4 = server.coerce_ai_draft(dict(base, answer=5, steps='分解'))
        self.assertEqual(fixed4['answer'], '5')
        self.assertEqual(fixed4['steps'], ['分解'])
        # level 超範圍 → 回預設 1
        self.assertEqual(server.coerce_ai_draft(dict(base, level=99))['level'], 1)
        # 缺 title/content 或無法辨識分類 → None（跳過該題）
        self.assertIsNone(server.coerce_ai_draft(dict(base, title='')))
        self.assertIsNone(server.coerce_ai_draft(dict(base, topic='完全不相關的分類')))

    def test_two_level_topic_tree_validation(self):
        # 兩層分類：主分類必須在樹內，子分類若填了必須屬於該主分類。
        self.assertTrue(len(server.TOPIC_TREE) >= 20)
        self.assertTrue(all(server.TOPIC_TREE.values()), '每個主分類都要有子分類')
        # 主分類 + 正確子分類 → 成功
        good = dict(self.draft, topic='圓', subtopic='圓周角定理', grade='中五')
        _, body, _ = self.request('POST', '/api/questions/import', {'questions': [good]},
                                  cookie=self.teacher, expect=200)
        self.assertEqual(body['count'], 1)
        # 子分類不屬於該主分類 → 400
        self.request('POST', '/api/questions/import',
                     {'questions': [dict(self.draft, topic='圓', subtopic='一元一次方程')]},
                     cookie=self.teacher, expect=400)
        # 子分類留空（選填）→ 成功
        self.request('POST', '/api/questions/import',
                     {'questions': [dict(self.draft, topic='圓', subtopic='')]},
                     cookie=self.teacher, expect=200)
        # 主分類不在樹內 → 400
        self.request('POST', '/api/questions/import',
                     {'questions': [dict(self.draft, topic='不存在的分類', subtopic='')]},
                     cookie=self.teacher, expect=400)
        # /api/state 回傳完整分類樹與年級
        _, state, _ = self.request('GET', '/api/state', cookie=self.student, expect=200)
        self.assertEqual(state['topicTree'], server.TOPIC_TREE)
        self.assertEqual(state['grades'], server.GRADES)

    def test_import_atomic_validation(self):
        for invalid in [dict(self.draft, level=0), dict(self.draft, points=True), dict(self.draft, topic='任意'),
                        dict(self.draft, tags='abc'), dict(self.draft, steps=[1]), dict(self.draft, grade='小六'),
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
        other_attempt = self.request('POST', '/api/attempts', {'questionId': 1, 'answerText': 'x=2或3'}, cookie=other, expect=200)[1]['attempt']
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
        self.assertEqual(created, {'id': 3, 'username': body['username'], 'name': body['name'],
                                   'role': 'student', 'seat': None})
        self.request('POST', '/api/users', body, cookie=self.teacher, expect=409)
        self.request('POST', '/api/users', dict(body, username='student'), cookie=self.teacher, expect=409)
        _, listing, _ = self.request('GET', '/api/users', cookie=self.teacher, expect=200)
        self.assertEqual(set(listing), {'users'})
        self.assertEqual(listing['users'][-1], created)
        for user in listing['users']:
            self.assertEqual(set(user), {'id', 'username', 'name', 'role', 'seat'})
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
        self.assertEqual(session['user'], {k: created[k] for k in ('id', 'name', 'role', 'seat')})
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
        invalid += [dict(body, name=value) for value in ('名' * 61, [], '名\x00')]
        invalid += [dict(body, password=value) for value in ('short1234', 'x' * 257, ' ' * 10, None, [], 'pass\x00word123')]
        invalid += [dict(body, seat=value) for value in ('x' * 21, '三號', '3 號', '3/4', [], 'a\x00')]
        invalid += [dict(body, role=role) for role in ('teacher', 'student', 'admin', None)]
        invalid += [dict(body, id=99), dict(body, demo=1), dict(body, unknown=True),
                    dict(body, password_hash='fake')]
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
        # 姓名與班內號都可省略：只有學號的名單會以學號作為顯示名稱。
        _, minimal, _ = self.request('POST', '/api/users',
                                     {'username': 'only-id-01', 'password': 'OnlyIdPass12'},
                                     cookie=self.teacher, expect=200)
        self.assertEqual(minimal['user']['name'], 'only-id-01')
        self.assertIsNone(minimal['user']['seat'])
        _, named, _ = self.request('POST', '/api/users',
                                   {'username': 'only-id-02', 'password': 'OnlyIdPass12', 'name': '   ',
                                    'seat': ' 07 '}, cookie=self.teacher, expect=200)
        self.assertEqual(named['user']['name'], 'only-id-02')
        self.assertEqual(named['user']['seat'], '07')
        self.login('only-id-02', 'OnlyIdPass12')

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
        for raw in (b'{', b'[]', b'{"questionId":NaN}', b'{"a":1,"a":2}', b'\xff', b'{"answerText":"\\ud800"}'):
            self.request('POST', '/api/attempts', cookie=self.student, raw=raw, expect=400)
        self.request('POST', '/api/login', {'username': 'student', 'password': 'x'}, extra={'Content-Type': 'text/plain'}, expect=415)
        for patch_body in [{'questionId': True}, {'questionId': -1}, {'questionId': '1'}, {'assignmentId': 'x'},
                           {'answerText': []}, {'consentExternal': 'yes'}, {'image': 'data:image/png;base64,YWJj'}, {'answerText': ''},
                           {'questionId': 1e100}, {'answerText': 'a\x00b'}, {'answerText': 'x' * 80001}]:
            body = {'questionId': 1, 'answerText': 'x=2或3', **patch_body}
            self.request('POST', '/api/attempts', body, cookie=self.student, expect=400)
        self.request('POST', '/api/attempts', {'questionId': 99999, 'answerText': 'x'}, cookie=self.student, expect=404)
        self.request('POST', '/api/questions/1/generate', {'kind': 'fake'}, cookie=self.student, expect=400)
        self.request('GET', '/api/questions/99999/recommendations', cookie=self.student, expect=404)

    def test_request_and_file_limits(self):
        self.request('POST', '/api/attempts', raw=b'{}', cookie=self.student,
                     extra={'Content-Length': str(server.MAX_BODY + 1)}, expect=413)
        huge = 'data:image/png;base64,' + base64.b64encode(b'x' * (server.MAX_FILE + 1)).decode()
        self.request('POST', '/api/attempts', {'questionId': 1, 'answerText': '', 'image': huge},
                     cookie=self.student, expect=413)
        broken = png_url().replace('data:image/png;', 'data:image/jpeg;')
        self.request('POST', '/api/attempts', {'questionId': 1, 'answerText': '', 'image': broken}, cookie=self.student, expect=400)

    def test_no_ai_handwritten_and_missing_answer_pending(self):
        # 自主練習（不屬於任何作業）不會使用 AI 批改。
        self.assertEqual(self.submit('x=2或3', image=png_url())['status'], 'pending')
        self.assertEqual(self.submit('x=2或3')['gradingMethod'], 'rule-final')
        self.request('POST', '/api/questions/import', {'questions': [dict(self.draft, answer='')]}, cookie=self.teacher, expect=200)
        result = self.request('POST', '/api/attempts', {'questionId': 17, 'answerText': '2'}, cookie=self.student, expect=200)[1]['attempt']
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

    def test_long_paper_is_chunked_merged_and_reported(self):
        # 長試卷分段呼叫 AI：每段只處理本段題目，結果合併，並在拆分方式回報分段數。
        self.app.ai.configured = True
        self.app.ai.mode = 'local'
        paper = '\n'.join(f'{i}. 第 {i} 題 ' + 'x' * 130 for i in range(1, 61))
        seen = []

        def fake_call(instruction, payload, image=None, model=None):
            seen.append(instruction)
            number = payload['text'].strip().split('\n')[0].split('.')[0]
            return {'drafts': [{'title': f'第 {number} 題', 'content': '解 $x^2-1=0$。',
                                'topic': '一元二次方程', 'level': 1, 'points': 5, 'answer': '$x=1$'}]}

        with patch.object(self.app.ai, 'call', side_effect=fake_call):
            _, body, _ = self.request('POST', '/api/papers/parse', {'name': '長卷', 'text': paper},
                                      cookie=self.teacher, expect=200)
        self.assertGreater(len(seen), 1, '長試卷應分段呼叫 AI')
        self.assertEqual(len(body['drafts']), len(seen), '每段結果都應併入')
        self.assertIn('長試卷已分', body['method'])
        self.assertIn('第 2 段', seen[1], '第二段應提示只處理本段')

    def test_parse_reports_truncation_and_keeps_earlier_chunks(self):
        self.app.ai.configured = True
        self.app.ai.mode = 'local'
        paper = '\n'.join(f'{i}. 第 {i} 題 ' + 'y' * 130 for i in range(1, 61))
        draft = {'title': '題', 'content': '解 $x^2-1=0$。', 'topic': '一元二次方程',
                 'level': 1, 'points': 5, 'answer': '$x=1$'}
        state = {'n': 0}

        def flaky(instruction, payload, image=None, model=None):
            state['n'] += 1
            if state['n'] == 1:
                self.app.ai.truncated = True
                return {'drafts': [dict(draft, title='第一段題目')]}
            raise server.APIError(502, 'AI 服務回應錯誤')

        with patch.object(self.app.ai, 'call', side_effect=flaky):
            _, body, _ = self.request('POST', '/api/papers/parse', {'name': '長卷', 'text': paper},
                                      cookie=self.teacher, expect=200)
        self.assertEqual([d['title'] for d in body['drafts']], ['第一段題目'], '應保留先前段落的結果')
        self.assertIn('曾被截斷', body['method'])
        self.assertIn('未能處理', body['method'])
        # 第一段就失敗時，整批失敗（不假裝成功）
        with patch.object(self.app.ai, 'call', side_effect=server.APIError(502, 'AI 服務回應錯誤')):
            _, error, _ = self.request('POST', '/api/papers/parse', {'name': '長卷', 'text': paper},
                                       cookie=self.teacher, expect=502)
        self.assertIn('AI 服務回應錯誤', error['error'])

    def test_ai_answer_endpoint_generates_answer_and_rubric(self):
        # 教師新增題目時可請 AI 產生答案、詳解、詳細解釋與評分標準。
        canned = {'answer': '$x=2$ 或 $x=3$', 'steps': ['分解為 $(x-2)(x-3)=0$。', '得 $x=2$ 或 $x=3$。'],
                  'analysis': '考因式分解法；常見錯誤是符號處理不當。',
                  'rubric': [{'label': '因式分解正確', 'percent': 60}, {'label': '寫出兩個根', 'percent': 40}]}
        payload = {'title': 'T', 'content': '解方程 $x^2-5x+6=0$。', 'qtype': '解答題', 'options': [],
                   'points': 6, 'topic': '一元二次方程'}
        self.app.ai.configured = True
        with patch.object(self.app.ai, 'call', return_value=canned) as ai:
            # 學生不可使用
            self.request('POST', '/api/questions/ai-answer', payload, cookie=self.student, expect=403)
            ai.assert_not_called()
            _, body, _ = self.request('POST', '/api/questions/ai-answer', payload, cookie=self.teacher, expect=200)
        self.assertEqual(body['answer'], '$x=2$ 或 $x=3$')
        self.assertEqual(len(body['steps']), 2)
        self.assertIn('因式分解', body['analysis'])
        self.assertEqual(body['rubric'], [{'label': '因式分解正確', 'percent': 60.0},
                                          {'label': '寫出兩個根', 'percent': 40.0}])
        self.assertEqual(body['method'], 'AI 生成')
        # 選擇題：答案必須落在選項字母範圍內
        choice = dict(payload, qtype='選擇題', options=['$1$', '$2$', '$3$'])
        with patch.object(self.app.ai, 'call', return_value=dict(canned, answer='選項 B 正確')):
            _, body2, _ = self.request('POST', '/api/questions/ai-answer', choice, cookie=self.teacher, expect=200)
        self.assertIn(body2['answer'], list('ABC'))
        # AI 回不出可用內容 → 502
        with patch.object(self.app.ai, 'call', return_value={'answer': '', 'steps': [], 'analysis': '', 'rubric': []}):
            self.request('POST', '/api/questions/ai-answer', payload, cookie=self.teacher, expect=502)
        # 未設定 AI → 409
        self.app.ai.configured = False
        self.request('POST', '/api/questions/ai-answer', payload, cookie=self.teacher, expect=409)

    def test_ai_grading_follows_rubric_percentages(self):
        # 有評分標準時，配分由伺服器按百分比計算；AI 只回報每項達成百分比與評語。
        question = dict(self.draft, title='評分標準題', content='解方程 $x^2-5x+6=0$。', answer='$x=2$ 或 $x=3$',
                        points=6, qtype='解答題', rubric=[{'label': '列出方程', 'percent': 30},
                                                           {'label': '因式分解', 'percent': 40},
                                                           {'label': '寫出兩個根', 'percent': 30}])
        _, imported, _ = self.request('POST', '/api/questions/import', {'questions': [question]},
                                      cookie=self.teacher, expect=200)
        self.assertEqual(imported['count'], 1)
        _, state, _ = self.request('GET', '/api/state', cookie=self.teacher, expect=200)
        qid = [q['id'] for q in state['questions'] if q['title'] == '評分標準題'][0]
        self.assertEqual([r['percent'] for r in state['questions'][-1]['rubric']], [30.0, 40.0, 30.0])

        self.app.ai.configured = True
        self.app.ai.mode = 'local'
        aid = self.ai_assignment([qid])
        graded = {'feedback': '整體不錯，但漏了一個根。',
                  'items': [{'percent': 100, 'comment': '方程正確。'},
                            {'percent': 100, 'comment': '分解正確。'},
                            {'percent': 50, 'comment': '只寫出一個根。'}]}
        with patch.object(self.app.ai, 'call', return_value=graded) as ai:
            _, response, _ = self.request('POST', '/api/attempts',
                                          {'questionId': qid, 'answerText': 'x=2', 'assignmentId': aid},
                                          cookie=self.student, expect=200)
        # 作業要等教師批閱後才揭露：學生端只看到「等待批閱」。
        attempt = response['attempt']
        self.assertEqual(attempt['gradingMethod'], 'awaiting-review')
        self.assertIsNone(attempt['score'])
        self.assertIsNone(attempt['suggestion'])
        self.assertIsNone(response['solution'], '批閱前不揭露參考答案與詳解')
        # 教師端才是真實的 AI 建議評分。
        attempt = self.teacher_attempt(aid, attempt['id'])
        # 6 分 × 30/40/30% → 各項配分 1.8 / 2.4 / 1.8；達成 100/100/50% → 1.8 + 2.4 + 0.9 = 5.1
        self.assertEqual(attempt['gradingMethod'], 'ai-advisory')
        self.assertAlmostEqual(attempt['score'], 5.1, places=6)
        self.assertEqual([s['label'] for s in attempt['steps']], ['列出方程', '因式分解', '寫出兩個根'])
        self.assertEqual([s['max'] for s in attempt['steps']], [1.8, 2.4, 1.8])
        self.assertAlmostEqual(sum(s['earned'] for s in attempt['steps']), 5.1, places=6)
        self.assertIn('評分標準', attempt['feedback'])
        # 教師批閱後，學生才看到分數與教師確認分。
        self.request('POST', f"/api/attempts/{attempt['id']}/review",
                     {'score': 5, 'feedback': '步驟清楚'}, cookie=self.teacher, expect=200)
        _, detail, _ = self.request('GET', f'/api/assignments/{aid}', cookie=self.student, expect=200)
        own = next(a for a in detail['attempts'] if a['id'] == attempt['id'])
        self.assertEqual(own['score'], 5)
        self.assertEqual(own['confirmedScore'], 5)
        self.assertNotIn('awaitingReview', own)
        # 項目數不符 → 502，不保存成績
        with patch.object(self.app.ai, 'call', return_value={'feedback': 'x', 'items': [{'percent': 50, 'comment': 'a'}]}):
            self.request('POST', '/api/attempts', {'questionId': qid, 'answerText': 'x=2', 'assignmentId': aid},
                         cookie=self.student, expect=502)
        # 百分比超範圍會被夾在 0–100
        clamped = {'feedback': 'y', 'items': [{'percent': 999, 'comment': 'a'}, {'percent': -5, 'comment': 'b'},
                                             {'percent': 50, 'comment': 'c'}]}
        with patch.object(self.app.ai, 'call', return_value=clamped):
            _, r2, _ = self.request('POST', '/api/attempts',
                                    {'questionId': qid, 'answerText': 'x=2', 'assignmentId': aid},
                                    cookie=self.student, expect=200)
        self.assertAlmostEqual(self.teacher_attempt(aid, r2['attempt']['id'])['score'], 1.8 + 0 + 0.9, places=6)
        # 同一題放在「教師未啟用 AI」的作業中：完全不呼叫模型，退回規則評分。
        plain = self.ai_assignment([qid], ai_grading=False)
        with patch.object(self.app.ai, 'call') as ai2:
            _, no_ai, _ = self.request('POST', '/api/attempts',
                                       {'questionId': qid, 'answerText': '$x=2$ 或 $x=3$', 'assignmentId': plain},
                                       cookie=self.student, expect=200)
        ai2.assert_not_called()
        self.assertEqual(no_ai['attempt']['gradingMethod'], 'awaiting-review')
        stored = self.teacher_attempt(plain, no_ai['attempt']['id'])
        self.assertEqual(stored['gradingMethod'], 'rule-final')
        self.assertEqual(stored['score'], 6)

    def test_attempt_solution_only_when_graded_and_rubric_hidden_from_students(self):
        # 未批閱的作答不揭露詳解
        self.app.ai.configured = False
        _, pending, _ = self.request('POST', '/api/attempts',
                                     {'questionId': 1, 'answerText': '', 'image': png_url()},
                                     cookie=self.student, expect=200)
        self.assertEqual(pending['attempt']['status'], 'pending')
        self.assertIsNone(pending['solution'])
        # 學生看到的題目不包含答案、詳解與評分標準
        self.request('POST', '/api/questions/import',
                     {'questions': [dict(self.draft, title='隱藏測試', rubric=[{'label': 'A', 'percent': 100}])]},
                     cookie=self.teacher, expect=200)
        _, state, _ = self.request('GET', '/api/state', cookie=self.student, expect=200)
        hidden = [q for q in state['questions'] if q['title'] == '隱藏測試'][0]
        for key in ('answer', 'steps', 'analysis', 'rubric'):
            self.assertNotIn(key, hidden)
        _, tstate, _ = self.request('GET', '/api/state', cookie=self.teacher, expect=200)
        visible = [q for q in tstate['questions'] if q['title'] == '隱藏測試'][0]
        self.assertEqual(visible['rubric'], [{'label': 'A', 'percent': 100.0}])

    def test_external_consent_and_ai_grade_validation(self):
        self.app.ai.configured = True
        self.app.ai.mode = 'external'
        result = {'score': 4, 'feedback': '步驟部分正確', 'steps': [{'label': '因式分解', 'earned': 4, 'max': 6, 'comment': '需補兩根'}]}
        aid = self.ai_assignment([1])
        body = {'questionId': 1, 'answerText': 'x=2', 'assignmentId': aid}
        with patch.object(self.app.ai, 'call', return_value=result) as ai:
            self.request('POST', '/api/attempts', body, cookie=self.student, expect=403)
            ai.assert_not_called()
            _, response, _ = self.request('POST', '/api/attempts', dict(body, consentExternal=True), cookie=self.student, expect=200)
            # 學生端看不到分數與 AI 批閱結果，要由教師視角驗證。
            self.assertEqual(response['attempt']['gradingMethod'], 'awaiting-review')
            self.assertIsNone(response['attempt']['score'])
            self.assertIsNone(response['solution'])
            stored = self.teacher_attempt(aid, response['attempt']['id'])
            self.assertEqual(stored['gradingMethod'], 'ai-advisory')
            self.assertEqual(stored['score'], 4)
            self.assertIn('僅供教師復核', stored['feedback'])
            self.assertFalse(stored['teacherReviewed'])
            self.assertEqual(stored['steps'][0]['earned'], 4)
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


class AIFailureTests(unittest.TestCase):
    """AI 連線／回應異常時的診斷訊息與救援行為。"""

    def serve(self, handler):
        srv = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=srv.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(srv.shutdown)
        self.addCleanup(srv.server_close)
        return srv

    def client(self, srv, model='deepseek-flash'):
        client = server.AIClient()
        client.configure({'base_url': f'http://127.0.0.1:{srv.server_address[1]}/v1', 'model': model,
                          'api_key': 'k', 'vision_model': '', 'thinking': False})
        return client

    @staticmethod
    def reply(content=None, status=None, body=None, finish=None, calls=None):
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers.get('Content-Length', 0)))
                if calls is not None:
                    calls.append(self.path)
                if status is not None:
                    payload = body if isinstance(body, bytes) else json.dumps(body or {}).encode()
                    self.send_response(status)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                    return
                out = json.dumps({'choices': [{'message': {'content': content}, 'finish_reason': finish}]}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(out)))
                self.end_headers()
                self.wfile.write(out)
            def log_message(self, *a):
                pass
        return Handler

    def message_for(self, handler, model='deepseek-flash'):
        srv = self.serve(handler)
        with self.assertRaises(server.APIError) as ctx:
            self.client(srv, model).call('只回傳 {"ok":true}', {'probe': 'text'})
        self.assertEqual(ctx.exception.status, 502)
        return ctx.exception.message

    def test_http_errors_map_to_actionable_messages(self):
        self.assertIn('金鑰', self.message_for(self.reply(status=401, body={'error': 'Authentication Fails'})))
        self.assertIn('餘額', self.message_for(self.reply(status=402, body={'error': 'Insufficient Balance'})))
        self.assertIn('模型名稱', self.message_for(self.reply(status=404, body={'error': 'Model Not Exist'})))
        self.assertIn('頻密', self.message_for(self.reply(status=429, body={'error': 'rate limit'})))
        self.assertIn('HTTP 500', self.message_for(self.reply(status=500, body={'error': 'oops'})))
        self.assertIn('HTTP 400', self.message_for(self.reply(status=400, body={'error': 'bad'})))

    def test_server_errors_and_rate_limits_are_retried_once(self):
        calls = []
        self.message_for(self.reply(status=500, body={'error': 'oops'}, calls=calls))
        self.assertEqual(len(calls), 2, '5xx 應重試一次')
        calls2 = []
        self.message_for(self.reply(status=429, body={'error': 'rate limit'}, calls=calls2))
        self.assertEqual(len(calls2), 2, '429 應重試一次')
        calls3 = []
        self.message_for(self.reply(status=401, body={'error': 'bad key'}, calls=calls3))
        self.assertEqual(len(calls3), 1, '401 不應重試')

    def test_network_failure_message(self):
        client = server.AIClient()
        client.configure({'base_url': 'http://127.0.0.1:9/v1', 'model': 'm', 'api_key': 'k',                          'vision_model': '', 'thinking': False})
        with self.assertRaises(server.APIError) as ctx:
            client.call('x', {})
        self.assertIn('無法連線 AI 服務', ctx.exception.message)

    def test_invalid_or_empty_responses(self):
        self.assertIn('空白內容', self.message_for(self.reply(content='   ')))
        self.assertIn('不是 JSON', self.message_for(self.reply(status=200, body=b'<html>bad gateway</html>')))
        self.assertIn('沒有回傳結果', self.message_for(self.reply(status=200, body={'choices': []})))
        self.assertIn('不是有效 JSON',
                      self.message_for(self.reply(content='這不是 JSON，只是一段說明文字。', finish='stop')))
        # 尾端多一個逗號之類的小瑕疵會被救援，不應該整批失敗
        srv = self.serve(self.reply(content='{"drafts":[{"title":"a"},]}', finish='stop'))
        self.assertEqual(self.client(srv).call('x', {})['drafts'], [{'title': 'a'}])

    def test_json_failure_is_retried_with_stricter_instruction(self):
        bodies = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
                bodies.append(payload)
                content = '我先說明一下：這題我不確定。' if len(bodies) == 1 else '{"ok": true}'
                out = json.dumps({'choices': [{'message': {'content': content}, 'finish_reason': 'stop'}]}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(out)))
                self.end_headers()
                self.wfile.write(out)

            def log_message(self, *a):
                pass

        srv = self.serve(Handler)
        self.assertEqual(self.client(srv).call('x', {}), {'ok': True})
        self.assertEqual(len(bodies), 2, '不是有效 JSON 時應重試一次')
        self.assertIn('只輸出單一 JSON 物件', bodies[1]['messages'][0]['content'])

    def test_truncated_response_is_salvaged(self):
        srv = self.serve(self.reply(content='```json\n{"drafts":[{"title":"a"},{"title":"b"}', finish='length'))
        client = self.client(srv)
        result = client.call('x', {})
        self.assertEqual([d['title'] for d in result['drafts']], ['a', 'b'])
        self.assertTrue(client.truncated, '被截斷時應標記 truncated')
        # 完全無法救援時給出明確訊息
        message = self.message_for(self.reply(content='{"drafts":[{"title":', finish='length'))
        self.assertIn('長度上限被截斷', message)

    def test_salvage_json_handles_strings_and_brackets(self):
        self.assertEqual(server.salvage_json('{"drafts":[{"a":1},{"b":2}')['drafts'][1], {'b': 2})
        self.assertEqual(server.salvage_json('{"drafts":[{"a":"}{"},{"b":2}]}')['drafts'][0]['a'], '}{')
        self.assertEqual(server.salvage_json('{"drafts":[{"a":1},{"b":')['drafts'], [{'a': 1}])
        self.assertIsNone(server.salvage_json('完全不是 JSON'))
        self.assertIsNone(server.salvage_json('{"a": "未收尾'))
        self.assertIsNone(server.salvage_json('{"a": NaN}'))

    def test_extract_json_recovers_noisy_model_output(self):
        # 模型常先寫一句說明、或用 markdown 圍欄、或用全形引號，這些都應能取回。
        self.assertEqual(server.extract_json('好的，以下是結果：\n{"score": 4, "feedback": "不錯"}'),
                         {'score': 4, 'feedback': '不錯'})
        self.assertEqual(server.extract_json('```json\n{"a": 1}\n```'), {'a': 1})
        self.assertEqual(server.extract_json('{“score”: 4, “feedback”: “不錯”}'), {'score': 4, 'feedback': '不錯'})
        self.assertEqual(server.extract_json('{"a": 1,}'), {'a': 1})
        self.assertEqual(server.extract_json('{"a": 1，"b": 2}'), {'a': 1, 'b': 2})
        # 結構位置的全形標點會被修正，但字串內容裡的中文標點必須原樣保留。
        self.assertEqual(server.extract_json('{"feedback"："第一步：化簡，先乘開"}'),
                         {'feedback': '第一步：化簡，先乘開'})
        # 真的不是 JSON 時仍要回 None，不能硬掰出內容。
        self.assertIsNone(server.extract_json('這不是 JSON，只是一段說明文字。'))
        self.assertIsNone(server.extract_json('{"a": "未收尾'))
        self.assertIsNone(server.extract_json(''))

    def test_paper_chunks_split_on_question_numbers_without_losing_text(self):
        self.assertEqual(server.paper_chunks('1. 短題目'), ['1. 短題目'])
        text = '\n'.join(f'{i}. 第 {i} 題 ' + 'x' * 120 for i in range(1, 61))
        chunks = server.paper_chunks(text)
        self.assertGreater(len(chunks), 1)
        self.assertEqual(''.join(chunks), text, '分段不得遺漏任何文字')
        self.assertTrue(all(c.lstrip().split('.')[0].isdigit() for c in chunks), '應在題號邊界切分')
        # 超過上限時併入最後一塊，不丟資料
        many = '\n'.join(f'{i}. 第 {i} 題 ' + 'y' * 900 for i in range(1, 41))
        capped = server.paper_chunks(many)
        self.assertLessEqual(len(capped), server.PARSE_MAX_CHUNKS)
        self.assertEqual(''.join(capped), many)
        # 沒有題號時以換行硬切，仍不丟資料
        plain = ('沒有編號的長段落。' * 60 + '\n') * 20
        hard = server.paper_chunks(plain)
        self.assertEqual(''.join(hard), plain)

    def test_parse_instruction_mentions_segment_and_compactness(self):
        single = server.parse_instruction(1, 0)
        self.assertNotIn('第 1 段', single)
        self.assertIn('rubric', single)
        self.assertIn('不超過 40 字', single)
        second = server.parse_instruction(3, 1)
        self.assertIn('第 2 段（共 3 段）', second)

    def test_timeout_and_max_tokens_env(self):
        with patch.dict('os.environ', {}, clear=True):
            self.assertEqual(server.ai_timeout(), 120.0)
            self.assertIsNone(server.ai_max_tokens())
        with patch.dict('os.environ', {'MATH_AI_TIMEOUT': '30', 'MATH_AI_MAX_TOKENS': '4096'}, clear=True):
            self.assertEqual(server.ai_timeout(), 30.0)
            self.assertEqual(server.ai_max_tokens(), 4096)
        with patch.dict('os.environ', {'MATH_AI_TIMEOUT': '99999', 'MATH_AI_MAX_TOKENS': '10'}, clear=True):
            self.assertEqual(server.ai_timeout(), 600.0)
            self.assertIsNone(server.ai_max_tokens())
        with patch.dict('os.environ', {'MATH_AI_TIMEOUT': 'abc', 'MATH_AI_MAX_TOKENS': 'abc'}, clear=True):
            self.assertEqual(server.ai_timeout(), 120.0)
            self.assertIsNone(server.ai_max_tokens())


class RubricTests(unittest.TestCase):
    """評分標準（百分比）的整理、驗證與配分換算。"""

    def test_normalize_rubric_rescales_to_100(self):
        # AI 的總和常不精準，應按比例縮放到 100，並把四捨五入誤差補到最大項。
        self.assertEqual(server.normalize_rubric([{'label': 'A', 'percent': 60}, {'label': 'B', 'percent': 40}]),
                         [{'label': 'A', 'percent': 60.0}, {'label': 'B', 'percent': 40.0}])
        three = server.normalize_rubric([{'label': 'A', 'percent': 33}, {'label': 'B', 'percent': 33},
                                         {'label': 'C', 'percent': 33}])
        self.assertEqual(round(sum(x['percent'] for x in three), 2), 100.0)
        # 支援 dict、[label, percent] 陣列、別名欄位
        self.assertEqual(server.normalize_rubric({'步驟一': 50, '步驟二': 50}),
                         [{'label': '步驟一', 'percent': 50.0}, {'label': '步驟二', 'percent': 50.0}])
        self.assertEqual(server.normalize_rubric([['列式', 30], ['求解', 70]]),
                         [{'label': '列式', 'percent': 30.0}, {'label': '求解', 'percent': 70.0}])
        self.assertEqual(server.normalize_rubric([{'criterion': '理解題意', 'weight': '100%'}]),
                         [{'label': '理解題意', 'percent': 100.0}])
        # 無法使用的情況回空清單
        for bad in ('x', [], None, [{'label': '', 'percent': 50}], [{'label': 'A', 'percent': 0}]):
            self.assertEqual(server.normalize_rubric(bad), [])

    def test_validate_rubric_is_strict_for_teacher_input(self):
        ok = server.validate_rubric([{'label': '列式', 'percent': 50}, {'label': '求解', 'percent': 50}])
        self.assertEqual(ok, [{'label': '列式', 'percent': 50.0}, {'label': '求解', 'percent': 50.0}])
        self.assertEqual(server.validate_rubric(None), [])
        self.assertEqual(server.validate_rubric([]), [])
        for bad in ([{'label': 'A', 'percent': 50}],                       # 總和 50
                    [{'label': 'A', 'percent': 50}, {'label': 'B', 'percent': 60}],
                    [{'label': '', 'percent': 100}],
                    [{'label': 'A', 'percent': 0}],
                    [{'label': 'A', 'percent': 101}],
                    [{'label': 'A', 'percent': True}],
                    'x', [{'label': 'A'}]):
            with self.assertRaises(server.APIError):
                server.validate_rubric(bad)
        too_many = [{'label': f'第{i}項', 'percent': 100 / 13} for i in range(13)]
        with self.assertRaises(server.APIError):
            server.validate_rubric(too_many)

    def test_rubric_steps_allocate_points_exactly(self):
        for points in (1, 5, 6, 7, 100):
            for rubric in ([{'label': 'A', 'percent': 30}, {'label': 'B', 'percent': 40}, {'label': 'C', 'percent': 30}],
                           [{'label': 'A', 'percent': 33.34}, {'label': 'B', 'percent': 33.33}, {'label': 'C', 'percent': 33.33}],
                           [{'label': 'A', 'percent': 100}]):
                steps = server.rubric_steps(rubric, points)
                self.assertAlmostEqual(sum(s['max'] for s in steps), points, places=6,
                                       msg=f'{rubric} 於 {points} 分配分誤差')
                self.assertTrue(all(s['max'] >= 0 for s in steps))
        self.assertEqual(server.rubric_steps([], 5), [])

    def test_question_valid_accepts_and_validates_rubric(self):
        base = {'title': 'T', 'content': '解 $x^2-1=0$。', 'topic': '一元二次方程',
                'level': 1, 'points': 6, 'answer': 'a'}
        q = server.question_valid(dict(base, rubric=[{'label': '列式', 'percent': 50},
                                                     {'label': '求解', 'percent': 50}]))
        self.assertEqual(q['rubric'], [{'label': '列式', 'percent': 50.0}, {'label': '求解', 'percent': 50.0}])
        self.assertEqual(server.question_valid(base)['rubric'], [])
        with self.assertRaises(server.APIError):
            server.question_valid(dict(base, rubric=[{'label': '只有一項', 'percent': 80}]))
        # 混進 KaTeX HTML 的說明會被還原成 $LaTeX$
        q2 = server.question_valid(dict(base, rubric=[{'label': '使用 <span class="katex">x</span>', 'percent': 100}]))
        self.assertNotIn('<span', q2['rubric'][0]['label'])

    def test_coerce_ai_draft_handles_rubric_and_field_aliases(self):
        raw = {'title': 'T', 'content': '解 $x^2-1=0$。', 'topic': '一元二次方程', 'level': 1, 'points': 6,
               'answer': 'a', 'qtype': '解答題',
               'detailedAnswer': ['第一步', '第二步'],
               'detailedExplanation': '這是詳細解釋。',
               'gradingCriteria': [{'label': '列式', 'percent': 50}, {'label': '求解', 'percent': 50}]}
        d = server.coerce_ai_draft(raw)
        self.assertEqual(d['steps'], ['第一步', '第二步'])
        self.assertEqual(d['analysis'], '這是詳細解釋。')
        self.assertEqual(len(d['rubric']), 2)
        self.assertEqual(round(sum(x['percent'] for x in d['rubric']), 2), 100.0)
        # solution 是字串 → 當作單一步驟
        d2 = server.coerce_ai_draft({'title': 'T', 'content': 'C', 'topic': '圓', 'level': 1,
                                     'points': 5, 'answer': 'a', 'solution': '完整解法'})
        self.assertEqual(d2['steps'], ['完整解法'])


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

    def test_latex_answers_grade_against_plain_text(self):
        # 參考答案可用 LaTeX 撰寫，規則評分仍要能與學生輸入的純文字對應。
        cases = [
            ('$x=2$ 或 $x=3$', 'x=2或3'),
            ('$\\dfrac{1}{3}$', '1/3'),
            ('$5\\text{ cm}$', '5 cm'),
            ('$70^\\circ$', '70°'),
            ('$36\\text{ cm}^2$', '36 cm²'),
            ('$x=-3$ 或 $x=2$', 'x=-3或2'),
            ('$k=2$', 'k=2'),
        ]
        for ref, student in cases:
            self.assertTrue(server.final_correct(ref, student), f'{ref} 應等於 {student}')
        # 單位不同仍不可互換
        self.assertFalse(server.final_correct('$5\\text{ cm}$', '5 m'))
        self.assertFalse(server.final_correct('$36\\text{ cm}^2$', '36 cm'))
        # 非 LaTeX 的純文字不受影響：括號不平衡仍視為無效
        self.assertFalse(server.final_correct('{2,3', 'x=2或3'))

    def test_choice_question_options_and_letter_answers(self):
        # 選擇題：選項 2–10 個、只有選擇題可設選項、答案統一成字母
        base = {'title': '選一題', 'content': '下列何者正確？', 'topic': '圓', 'level': 1,
                'points': 5, 'qtype': '選擇題'}
        q = server.question_valid(dict(base, options=['$1$', '$2$', '$3$', '$4$'], answer='C'))
        self.assertEqual(q['options'], ['$1$', '$2$', '$3$', '$4$'])
        self.assertEqual(q['answer'], 'C')
        # 教師填選項內容或小寫也能正規化
        self.assertEqual(server.question_valid(dict(base, options=['1', '2', '3'], answer='3'))['answer'], 'C')
        self.assertEqual(server.question_valid(dict(base, options=['1', '2', '3'], answer='(b)'))['answer'], 'B')
        # 只有一個選項、超過 10 個 → 拒絕
        self.assertRaises(server.APIError, server.question_valid, dict(base, options=['1'], answer='A'))
        self.assertRaises(server.APIError, server.question_valid,
                          dict(base, options=[str(i) for i in range(11)], answer='A'))
        # 非選擇題不可帶選項
        self.assertRaises(server.APIError, server.question_valid,
                          dict(base, qtype='解答題', options=['1', '2'], answer='A'))
        # 沒帶 options 的一般題目不受影響
        plain = server.question_valid(dict(base, qtype='解答題', answer='42'))
        self.assertEqual(plain['options'], [])

    def test_split_inline_options_from_content(self):
        stem, opts = server.split_inline_options('下列何者正確？ (A) $x=1$ (B) $x=2$ (C) $x=3$ (D) $x=4$')
        self.assertEqual(stem, '下列何者正確？')
        self.assertEqual(opts, ['$x=1$', '$x=2$', '$x=3$', '$x=4$'])
        # 五個選項
        _, five = server.split_inline_options('選一項：A. 1 B. 2 C. 3 D. 4 E. 5')
        self.assertEqual(five, ['1', '2', '3', '4', '5'])
        # 沒有選項的文字原樣回傳
        self.assertEqual(server.split_inline_options('解方程 $x^2-5x+6=0$。'), ('解方程 $x^2-5x+6=0$。', []))
        # 只有一個標號不算選項
        self.assertEqual(server.split_inline_options('選項 A 是對的。'), ('選項 A 是對的。', []))

    def test_ai_draft_auto_splits_choice_options(self):
        # AI 沒拆選項時，從題幹自動拆出來，並把答案轉成字母
        d = server.coerce_ai_draft({'title': 'T', 'content': '下列何者正確？ (A) $x=1$ (B) $x=2$ (C) $x=3$ (D) $x=4$',
                                    'topic': '一元二次方程', 'level': 1, 'points': 5, 'answer': '$x=3$',
                                    'qtype': '選擇題'})
        self.assertEqual(d['content'], '下列何者正確？')
        self.assertEqual(d['options'], ['$x=1$', '$x=2$', '$x=3$', '$x=4$'])
        self.assertEqual(d['answer'], 'C')
        # AI 已拆好就直接沿用
        d2 = server.coerce_ai_draft({'title': 'T', 'content': 'Q？', 'topic': '圓', 'level': 1, 'points': 5,
                                     'answer': 'B', 'qtype': '選擇題', 'options': ['a', 'b', 'c']})
        self.assertEqual(d2['options'], ['a', 'b', 'c'])
        self.assertEqual(d2['answer'], 'B')

    def test_choice_answer_grading(self):
        # 學生點選字母即作答，與參考答案字母比對
        self.assertTrue(server.final_correct('C', 'C'))
        self.assertTrue(server.final_correct('c', 'C'))
        self.assertFalse(server.final_correct('A', 'C'))
        # 種子題庫的選擇題答案應為字母且選項齊全
        seed = [q for q in server.seed_questions() if q.get('options')]
        self.assertTrue(seed, '種子題庫應至少有一題選擇題示範')
        for q in seed:
            self.assertEqual(q['qtype'], '選擇題')
            self.assertIn(q['answer'], server.OPTION_LETTERS[:len(q['options'])])

    def test_repair_katex_html_restores_latex(self):
        # 前端若誤把 KaTeX 渲染後的 HTML 存進題目欄位，應還原成 $LaTeX$ 而不是留下 HTML。
        html = ('<span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>A</mi></mrow>'
                '<annotation encoding="application/x-tex">A=\\{x\\mid -1&lt;x\\le 3\\}</annotation>'
                '</semantics></math></span><span class="katex-html" aria-hidden="true">'
                '<span class="base"><span class="mord">A</span></span></span></span>')
        fixed = server.repair_katex_html('已知集合 ' + html + '，求元素個數。')
        self.assertEqual(fixed, '已知集合 $A=\\{x\\mid -1<x\\le 3\\}$，求元素個數。')
        self.assertNotIn('<span', fixed)
        self.assertNotIn('&lt;', fixed)
        # 未損壞的內容必須原樣保留
        for text in ('解方程 $x^2-5x+6=0$。', '純文字題目', 'x²−5x+6=0', ''):
            self.assertEqual(server.repair_katex_html(text), text)
        # 經 question_valid 匯入時也會自動修復
        q = server.question_valid({'title': 'T', 'content': '設 ' + html + '。', 'topic': '圓',
                                   'level': 1, 'points': 5, 'answer': 'a', 'grade': '中三'})
        self.assertNotIn('<span', q['content'])
        self.assertIn('$A=', q['content'])

    def test_latex_to_plain_only_touches_latex_like_text(self):
        self.assertEqual(server.latex_to_plain('x=2或3'), 'x=2或3', '純文字不應被改動')
        self.assertEqual(server.latex_to_plain('{2,3'), '{2,3', '不平衡括號不應被清理')
        self.assertEqual(server.latex_to_plain('$\\frac{1}{2}$'), '1/2')
        self.assertEqual(server.latex_to_plain('$70^\\circ$'), '70°')
        self.assertEqual(server.latex_to_plain('$3\\text{ cm}$'), '3 cm')

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
