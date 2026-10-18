"""标准库 API 回归测试：所有服务器和 data 均位于临时目录及回环地址。"""
import base64
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import http.client
import io
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import re
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
import storage


PYTHON = '/Users/laokunleng/.workbuddy-ai/binaries/python/envs/default/bin/python'


def png_url():
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    raw = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(b'\x00\xff\xff\xff')) + chunk(b'IEND', b''))
    return 'data:image/png;base64,' + base64.b64encode(raw).decode()


def jpeg_bytes(pad=6000):
    """最小但合法的 JPEG（用 COM 區段撐到 5 KB 以上，模擬掃描檔內嵌的相片）。"""
    size = min(65535, max(4, pad))
    com = b'\xff\xfe' + struct.pack('>H', size) + b'x' * (size - 2)
    sof = (b'\xff\xc0' + struct.pack('>H', 17) + bytes([8]) + struct.pack('>HH', 1, 1)
           + bytes([3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]))
    sos = b'\xff\xda' + struct.pack('>H', 12) + bytes([3, 1, 0, 2, 0, 3, 0, 0, 63, 0])
    return b'\xff\xd8' + com + sof + sos + b'\x00' + b'\xff\xd9'


def make_pdf(objects):
    """把物件列表組成一份帶正確 xref 的最小 PDF。"""
    out = bytearray(b'%PDF-1.4\n')
    offsets = []
    for index, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b'%d 0 obj\n' % index + body + b'\nendobj\n'
    startxref = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objects) + 1)
    for offset in offsets:
        out += b'%010d 00000 n \n' % offset
    out += (b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n'
            % (len(objects) + 1, startxref))
    return bytes(out)


def pdf_url(objects):
    return 'data:application/pdf;base64,' + base64.b64encode(make_pdf(objects)).decode()


def text_pdf_url(text='x=3'):
    """有文字層的 PDF（打字後匯出）。"""
    content = ('BT /F1 24 Tf 20 100 Td (%s) Tj ET' % text).encode()
    return pdf_url([
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] '
        b'/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        b'<< /Length %d >>\nstream\n' % len(content) + content + b'\nendstream',
    ])


def scanned_pdf_url(page_count=1):
    """掃描檔：沒有文字層，只有內嵌的 JPEG；可指定頁數。"""
    jpeg = jpeg_bytes()
    content = b'q 100 0 0 100 0 0 cm /Im0 Do Q'
    first_page = 3
    image_id = first_page + page_count
    content_ids = [image_id + 1 + i for i in range(page_count)]
    page_ids = [first_page + i for i in range(page_count)]
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
               b'<< /Type /Pages /Kids [' + b' '.join(b'%d 0 R' % p for p in page_ids) + b'] /Count %d >>' % page_count]
    for index, pid in enumerate(page_ids):
        objects.append(b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] '
                       b'/Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>'
                       % (image_id, content_ids[index]))
    objects.append(b'<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB '
                   b'/BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n' % len(jpeg) + jpeg + b'\nendstream')
    for _ in content_ids:
        objects.append(b'<< /Length %d >>\nstream\n' % len(content) + content + b'\nendstream')
    return pdf_url(objects)


def png_size(data):
    """讀 PNG 的 IHDR 取得 (寬, 高)，用來驗證多頁是否真的都渲染進去。"""
    return struct.unpack('>II', data[16:24])


def blank_pdf_url():
    """既沒有文字層也沒有圖片的 PDF。"""
    content = b' '
    return pdf_url([
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>',
        b'<< /Length %d >>\nstream\n' % len(content) + content + b'\nendstream',
    ])


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
        self.assertEqual(state['stats'], {'completed': 0, 'accuracy': 0, 'score': 0, 'maxScore': 0,
                                      'streak': 0, 'minutes': 0})
        self.assertEqual(state['ai'], {'configured': False, 'model': '', 'vision': '', 'draw': '', 'drawCustom': False, 'mode': 'off', 'source': 'none', 'thinking': False})
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
        # AI 生成題目只限教師：學生即使未設定 AI 也先被擋下（403，而非 409）。
        self.request('POST', '/api/questions/1/generate', {'kind': 'similar'}, cookie=self.student, expect=403)

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

    def test_competition_topic_exists_with_subtopics(self):
        # 課外比賽題獨立成一個主分類，子分類依比賽／來源區分；
        # 這是教師用來按來源挑題的依據，不能被誤刪。
        self.assertEqual(server.TOPIC_TREE.get('比賽題'), ['金蓮花', '校際', 'AIMO', '思維', '其他'])
        self.assertIn('比賽題', server.TOPICS)
        for sub in ('金蓮花', '校際', 'AIMO', '思維', '其他'):
            self.assertIn(sub, server.SUBTOPICS)
        # 主分類 + 正確子分類要能匯入；子分類不屬於它就要被擋。
        good = dict(self.draft, topic='比賽題', subtopic='AIMO')
        self.request('POST', '/api/questions/import', {'questions': [good]}, cookie=self.teacher, expect=200)
        self.request('POST', '/api/questions/import',
                     {'questions': [dict(self.draft, topic='比賽題', subtopic='圓周角定理')]},
                     cookie=self.teacher, expect=400)

    def test_teacher_can_update_every_question_setting(self):
        # 教師可以修改題目的所有設定（含題解、評分標準）；驗證沿用 question_valid，不因修改而放寬。
        _, imported, _ = self.request('POST', '/api/questions/import', {'questions': [self.draft]},
                                      cookie=self.teacher, expect=200)
        qid = imported['questions'][0]['id']
        changed = dict(self.draft, title='改過的標題', content='改過的內容 $x=1$。',
                       topic='比賽題', subtopic='AIMO', level=3, grade='中六', points=12,
                       qtype='解答題', options=[], answer='$x=1$',
                       steps=['第一步：移項。', '第二步：求解。'], analysis='考點說明',
                       hint='提示', source='教師修訂',
                       rubric=[{'label': '過程', 'percent': 60}, {'label': '答案', 'percent': 40}])
        _, result, _ = self.request('POST', f'/api/questions/{qid}/update', {'question': changed},
                                    cookie=self.teacher, expect=200)
        q = result['question']
        self.assertEqual(q['title'], '改過的標題')
        self.assertEqual((q['topic'], q['subtopic']), ('比賽題', 'AIMO'))
        self.assertEqual((q['level'], q['grade'], q['points']), (3, '中六', 12))
        self.assertEqual(q['steps'], ['第一步：移項。', '第二步：求解。'])
        self.assertEqual([r['label'] for r in q['rubric']], ['過程', '答案'])
        # 讀回來要一致，不是只有回應好看。
        _, state, _ = self.request('GET', '/api/state', cookie=self.teacher, expect=200)
        stored = next(x for x in state['questions'] if x['id'] == qid)
        self.assertEqual(stored['title'], '改過的標題')
        self.assertEqual(stored['analysis'], '考點說明')
        self.assertEqual(stored['source'], '教師修訂')
        # 學生不能改。
        self.request('POST', f'/api/questions/{qid}/update', {'question': changed},
                     cookie=self.student, expect=403)
        # 子分類不屬於該主分類要擋下來。
        self.request('POST', f'/api/questions/{qid}/update',
                     {'question': dict(changed, subtopic='圓周角定理')}, cookie=self.teacher, expect=400)
        # 找不到的題目回 404。
        self.request('POST', '/api/questions/999999/update', {'question': changed},
                     cookie=self.teacher, expect=404)

    def test_question_figure_can_be_replaced_and_removed(self):
        # 沒帶 figure＝保留原圖；帶空字串＝移除；帶新圖＝取代。
        _, imported, _ = self.request('POST', '/api/questions/import',
                                      {'questions': [dict(self.draft, figure=png_url())]},
                                      cookie=self.teacher, expect=200)
        qid = imported['questions'][0]['id']
        self.assertTrue(imported['questions'][0]['figure'], '匯入時應該有圖形')
        _, kept, _ = self.request('POST', f'/api/questions/{qid}/update',
                                  {'question': dict(self.draft, title='只改標題')},
                                  cookie=self.teacher, expect=200)
        self.assertTrue(kept['question']['figure'], '沒動圖形就要保留原本那張')
        _, gone, _ = self.request('POST', f'/api/questions/{qid}/update',
                                  {'question': dict(self.draft, title='移除圖形'), 'figure': ''},
                                  cookie=self.teacher, expect=200)
        self.assertFalse(gone['question'].get('figure'), '送空字串要移除圖形')

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
        self.assertEqual(body['active'], {'configured': False, 'model': '', 'vision': '', 'draw': '', 'drawCustom': False, 'mode': 'off', 'source': 'none', 'thinking': False})
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
        # createdBy 記錄是誰建立的（內建 teacher 是 id=2），用來判斷一般教師能改哪些帳號。
        self.assertEqual(created, {'id': 3, 'username': body['username'], 'name': body['name'],
                                   'role': 'student', 'seat': None, 'grade': None, 'createdBy': 2})
        self.request('POST', '/api/users', body, cookie=self.teacher, expect=409)
        self.request('POST', '/api/users', dict(body, username='student'), cookie=self.teacher, expect=409)
        _, listing, _ = self.request('GET', '/api/users', cookie=self.teacher, expect=200)
        self.assertEqual(set(listing), {'users', 'ownerId'})
        self.assertEqual(listing['users'][-1], created)
        for user in listing['users']:
            self.assertEqual(set(user), {'id', 'username', 'name', 'role', 'seat', 'grade', 'createdBy'})
        self.assertEqual(listing['ownerId'], 2, 'ownerId 是最早建立的教師（內建 teacher）')
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
        # /api/session 與 /api/login 都會附 isOwner（前端靠它決定要不要顯示管理員功能）。
        self.assertEqual(session['user'],
                         {**{k: created[k] for k in ('id', 'name', 'role', 'seat', 'grade')}, 'isOwner': False})
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
        self.request('POST', '/api/questions/1/generate', {'kind': 'fake'}, cookie=self.teacher, expect=400)
        self.request('GET', '/api/questions/99999/recommendations', cookie=self.student, expect=404)

    def test_request_and_file_limits(self):
        self.request('POST', '/api/attempts', raw=b'{}', cookie=self.student,
                     extra={'Content-Length': str(server.MAX_BODY + 1)}, expect=413)
        huge = 'data:image/png;base64,' + base64.b64encode(b'x' * (server.MAX_FILE + 1)).decode()
        self.request('POST', '/api/attempts', {'questionId': 1, 'answerText': '', 'image': huge},
                     cookie=self.student, expect=413)
        broken = png_url().replace('data:image/png;', 'data:image/jpeg;')
        self.request('POST', '/api/attempts', {'questionId': 1, 'answerText': '', 'image': broken}, cookie=self.student, expect=400)

    def test_teacher_moves_and_rewrites_ai_annotation(self):
        """教師可以搬動印章／批語並改寫 AI 的說明；位置以 0 至 1 的相對座標保存，壞座標不寫入。"""
        attempt = self.submit('', image=png_url())
        aid = attempt['id']
        marks = {'issues': [{'x': 0.3, 'y': 0.4, 'label': '符號錯誤', 'comment': '這裡應為負號'}],
                 'summary': '主要在符號處理',
                 'placements': {'issue:0': {'x': 0.62, 'y': 0.18}, 'summary': {'x': 0.5, 'y': 0.9}}}
        _, result, _ = self.request('POST', f'/api/attempts/{aid}/ai-annotation', {'marks': marks},
                                    cookie=self.teacher, expect=200)
        ann = result['attempt']['aiAnnotation']
        self.assertTrue(ann['adjusted'])
        self.assertEqual(ann['placements']['issue:0'], {'x': 0.62, 'y': 0.18})
        self.assertEqual(ann['issues'][0]['comment'], '這裡應為負號')
        self.assertEqual(ann['summary'], '主要在符號處理')
        # 教師改寫說明：文字直接沿用同一條路徑保存。
        rewritten = {**marks, 'issues': [{**marks['issues'][0], 'comment': '這裡應為負號，而且在移項之後。'}]}
        _, again, _ = self.request('POST', f'/api/attempts/{aid}/ai-annotation', {'marks': rewritten},
                                   cookie=self.teacher, expect=200)
        self.assertEqual(again['attempt']['aiAnnotation']['issues'][0]['comment'], '這裡應為負號，而且在移項之後。')
        # 壞座標要擋下來，不能把壞資料寫進資料庫。
        for bad in ({'issue:0': {'x': 1.4, 'y': 0.2}}, {'issue:99': {'x': 0.2, 'y': 0.2}}, {'note': {'x': 0.2, 'y': 0.2}}):
            self.request('POST', f'/api/attempts/{aid}/ai-annotation', {'marks': {**marks, 'placements': bad}},
                         cookie=self.teacher, expect=400)
        # 學生不能調整教師的批註。
        self.request('POST', f'/api/attempts/{aid}/ai-annotation', {'marks': marks}, cookie=self.student, expect=403)

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

    def test_invalid_env_password_fails_loudly_instead_of_hanging(self):
        # 真實踩過的坑：把演示密碼（9 字）填進 MATH_STUDENT_PASSWORD，初始化會失敗，
        # 但前端只看到「伺服器正在初始化」而永遠等不到結果。這裡要求失敗要說清楚原因。
        with patch.dict('os.environ', {'MATH_STUDENT_PASSWORD': 'Math1234!'}):
            broken = server.Application(self.root / 'bad-password-data')
            broken.safe_initialize()
        self.assertIsNotNone(broken.init_error, '密碼不合規時初始化應該失敗並留下原因')
        self.assertIn('MATH_STUDENT_PASSWORD', broken.init_error)
        self.assertIn('10', broken.init_error)
        self.assertNotIn('ValueError', broken.init_error, '給使用者看的訊息不應該是 repr')
        health, _ = broken.dispatch('GET', '/api/health', None, None, None, '127.0.0.1')
        self.assertEqual(health['status'], 'error')
        self.assertIn('MATH_STUDENT_PASSWORD', health['error'])
        with self.assertRaises(server.APIError) as ctx:
            broken.dispatch('POST', '/api/login', {'username': 'student', 'password': 'x'},
                            None, None, '127.0.0.1')
        self.assertEqual(ctx.exception.status, 503)
        self.assertIn('初始化失敗', ctx.exception.message)
        self.assertIn('MATH_STUDENT_PASSWORD', ctx.exception.message)
        # 沒設定環境變數時沿用內建演示密碼，仍可正常啟動。
        fallback = server.Application(self.root / 'fallback-data')
        fallback.safe_initialize()
        self.assertIsNone(fallback.init_error)

    def test_long_paper_is_chunked_merged_and_reported(self):
        # 長試卷分段呼叫 AI：每段只處理本段題目，結果合併，並在拆分方式回報分段數。
        self.app.ai.configured = True
        self.app.ai.mode = 'local'
        paper = '\n'.join(f'{i}. 第 {i} 題 ' + 'x' * 130 for i in range(1, 61))
        seen = []

        def fake_call(instruction, payload, image=None, model=None, timeout=None):
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

        def flaky(instruction, payload, image=None, model=None, timeout=None):
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

    def test_student_can_upload_pdf_answer(self):
        # 學生可以用 PDF 交作答：有文字層就讀文字，掃描檔就取內嵌的 JPEG 當作答圖片。
        text_attempt = self.submit('', image=text_pdf_url('x=3'))
        with self.app.db() as db:
            row = db.execute('SELECT answer_text, image FROM attempts WHERE id=?',
                             (text_attempt['id'],)).fetchone()
        self.assertIn('x=3', row['answer_text'])
        self.assertIsNone(row['image'])
        scanned_attempt = self.submit('', image=scanned_pdf_url())
        self.assertIsNotNone(scanned_attempt.get('image'), '掃描 PDF 應取出內嵌圖片當作答')
        with self.app.db() as db:
            row2 = db.execute('SELECT image, image_mime FROM attempts WHERE id=?',
                              (scanned_attempt['id'],)).fetchone()
        self.assertTrue(bytes(row2['image']).startswith(b'\x89PNG'))
        self.assertEqual(row2['image_mime'], 'image/png')
        # 多頁掃描檔必須完整渲染每一頁，不能只留第一張內嵌圖片。
        two = self.submit('', image=scanned_pdf_url(2))
        with self.app.db() as db:
            row3 = db.execute('SELECT image FROM attempts WHERE id=?', (two['id'],)).fetchone()
        one_size = png_size(bytes(row2['image']))
        two_size = png_size(bytes(row3['image']))
        self.assertEqual(two_size[0], one_size[0], '兩頁寬度應一致')
        self.assertGreater(two_size[1], one_size[1] * 1.8, '兩頁高度應接近單頁兩倍（兩頁都保留）')
        # 沒有文字也沒有圖片時要講清楚怎麼做，不能假裝成功。
        self.request('POST', '/api/attempts', {'questionId': 1, 'answerText': '', 'image': blank_pdf_url()},
                     cookie=self.student, expect=400)
        # 學生仍可用文字＋PDF 一起交（文字在前、PDF 文字接在後）。
        both = self.submit('先寫結論', image=text_pdf_url('x=3'))
        with self.app.db() as db:
            merged = db.execute('SELECT answer_text FROM attempts WHERE id=?', (both['id'],)).fetchone()[0]
        self.assertIn('先寫結論', merged)
        self.assertIn('x=3', merged)

    def test_ai_json_with_unescaped_latex_is_recovered(self):
        # 模型常在 JSON 字串裡直接寫 LaTeX（\sqrt 不是合法跳脫）或夾帶原始換行，
        # 這些都必須救回來，不能讓學生看到「不是有效 JSON」而丟掉整次批改。
        raw = '{"feedback": "答案 $\\sqrt{3}$ 要注意", "items": [{"percent": 100, "comment": "第一行\n第二行"}]}'
        with self.assertRaises(ValueError):
            json.loads(raw)
        decoded = server.extract_json(raw)
        self.assertIsNotNone(decoded)
        self.assertIn('\\sqrt{3}', decoded['feedback'])
        self.assertEqual(decoded['items'][0]['comment'], '第一行\n第二行')
        # 正常的 JSON 不應該被改動。
        plain = '{"score": 4, "feedback": "很好"}'
        self.assertEqual(server.escape_json_strings(plain), plain)

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

    def test_handwritten_verdict_for_full_partial_and_wrong(self):
        # 手寫作答要有整體判定（全對／全錯／部分正確），前端據此在手稿上蓋紅剔／紅叉／紅剔加一撇。
        self.app.ai.configured = True
        self.app.ai.mode = 'local'
        self.app.ai.vision = 'vision'
        aid = self.ai_assignment([1])

        def graded(score):
            return {'score': score, 'feedback': '評語。',
                    'steps': [{'label': '過程', 'earned': score, 'max': 6, 'comment': ''}]}

        for score, verdict in ((6, 'correct'), (0, 'wrong'), (3, 'partial')):
            with self.subTest(score=score):
                with patch.object(self.app.ai, 'call', return_value=graded(score)):
                    attempt = self.submit('x=2 或 x=3', image=png_url(), assignmentId=aid)
                self.assertNotIn('verdict', attempt, '教師批閱前不揭露判定')
                stored = self.teacher_attempt(aid, attempt['id'])
                self.assertEqual(stored['verdict'], verdict)
                self.assertEqual(stored['score'], score)
                self.assertEqual(stored['image'], f"/api/attempts/{attempt['id']}/image")
        # 教師批閱後，學生看到的判定必須與分數一致。
        last = stored['id']
        self.request('POST', f'/api/attempts/{last}/review', {'score': 3, 'feedback': ''},
                     cookie=self.teacher, expect=200)
        _, detail, _ = self.request('GET', f'/api/assignments/{aid}', cookie=self.student, expect=200)
        own = next(a for a in detail['attempts'] if a['id'] == last)
        self.assertEqual(own['score'], 3)
        self.assertEqual(own['verdict'], 'partial')
        # 純文字作答沒有手寫稿，不產生印章判定。
        text = self.submit('x=2 或 x=3', assignmentId=aid)
        self.assertNotIn('verdict', self.teacher_attempt(aid, text['id']))
        # 未評分（等待批閱）不蓋章，避免出現沒有分數依據的判定。
        self.app.ai.configured = False
        pending = self.submit('x=2 或 x=3', image=png_url(), assignmentId=aid)
        stored = self.teacher_attempt(aid, pending['id'])
        self.assertEqual(stored['status'], 'pending')
        self.assertNotIn('verdict', stored)

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
        # 項目數不符時不偽造分數，但作答一定要保住：改為等待教師批閱，不自動用規則給分。
        with patch.object(self.app.ai, 'call', return_value={'feedback': 'x', 'items': [{'percent': 50, 'comment': 'a'}]}):
            _, failed, _ = self.request('POST', '/api/attempts',
                                        {'questionId': qid, 'answerText': 'x=2', 'assignmentId': aid},
                                        cookie=self.student, expect=200)
            stored = self.teacher_attempt(aid, failed['attempt']['id'])
            self.assertEqual(stored['gradingMethod'], 'pending-teacher')
            self.assertIsNone(stored['score'])
            self.assertIn('AI 建議評分暫時無法使用', stored['feedback'])
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
        # 真的無法使用的輸出（分數超範圍／不是數字、評語不是文字）才不偽造分數，
        # 學生的作答一律保住，改為等待教師批閱。
        invalid_results = [dict(result, score=1000), dict(result, score=-1), dict(result, score=True),
                           dict(result, score=float('nan')), dict(result, feedback=[])]
        for invalid in invalid_results:
            with patch.object(self.app.ai, 'call', return_value=invalid):
                _, fallback, _ = self.request('POST', '/api/attempts', dict(body, consentExternal=True),
                                              cookie=self.student, expect=200)
            stored = self.teacher_attempt(aid, fallback['attempt']['id'])
            self.assertEqual(stored['gradingMethod'], 'pending-teacher')
            self.assertIsNone(stored['score'])
            self.assertIn('AI 建議評分暫時無法使用', stored['feedback'])
        # 只是「算術不穩」的輸出不再整筆作廢：配分與步驟得分由伺服器歸一化，
        # 總分以模型自報的 score 為準，步驟分項換算成與總分一致。
        recoverable = [
            (dict(result, score=5), 5),                     # score 與步驟得分加總不一致
            (dict(result, steps=[]), 4),                    # 沒有步驟分項 → 合成單一步驟
            (dict(result, steps=[{'label': 'x', 'earned': 7, 'max': 6, 'comment': 'x'}]), 4),  # earned 超過 max
        ]
        for payload, want_score in recoverable:
            with patch.object(self.app.ai, 'call', return_value=payload):
                _, fixed, _ = self.request('POST', '/api/attempts', dict(body, consentExternal=True),
                                           cookie=self.student, expect=200)
            stored = self.teacher_attempt(aid, fixed['attempt']['id'])
            self.assertEqual(stored['gradingMethod'], 'ai-advisory')
            self.assertEqual(stored['score'], want_score)
            self.assertEqual(sum(s['max'] for s in stored['steps']), 6, '步驟配分總和要等於題目總分')
            self.assertEqual(sum(s['earned'] for s in stored['steps']), want_score, '步驟得分總和要等於總分')
            self.assertTrue(all(s['earned'] <= s['max'] for s in stored['steps']), '步驟得分不可超過配分')
            self.assertIn('已由系統按題目總分換算', stored['feedback'])
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0],
                             1 + len(invalid_results) + len(recoverable))
        with patch.object(self.app.ai, 'call') as ai:
            _, parsed, _ = self.request('POST', '/api/papers/parse', {'name': '文本', 'text': '1. 解 x²−5x+6=0。'}, cookie=self.teacher, expect=200)
            self.assertEqual(parsed['method'], '規則拆題')
            ai.assert_not_called()
        self.app.ai.vision = 'vision'
        with patch.object(self.app.ai, 'call') as ai:
            self.request('POST', '/api/papers/parse', {'name': '圖片', 'dataUrl': png_url(), 'mime': 'image/png'}, cookie=self.teacher, expect=403)
            ai.assert_not_called()

    def test_figure_box_rejects_unusable_boxes(self):
        # 圖形範圍只做基本檢查；真正換算與裁切在瀏覽器（那裡才有原圖尺寸）。
        good = {'x': 0.1, 'y': 0.2, 'w': 0.3, 'h': 0.4}
        self.assertEqual(server.figure_box(good), good)
        # 像素座標也接受（前端按原圖尺寸換算）。
        self.assertEqual(server.figure_box({'x': 120, 'y': 40, 'w': 300, 'h': 200}),
                         {'x': 120.0, 'y': 40.0, 'w': 300.0, 'h': 200.0})
        for bad in (None, 'x', [], 3,
                    {'x': 0.1, 'y': 0.2, 'w': 0.3},
                    {'x': 0.1, 'y': 0.2, 'w': 0, 'h': 0.4},
                    {'x': -0.1, 'y': 0.2, 'w': 0.3, 'h': 0.4},
                    {'x': True, 'y': 0, 'w': 1, 'h': 1},
                    {'x': float('nan'), 'y': 0, 'w': 1, 'h': 1},
                    {'x': 0, 'y': 0, 'w': 10 ** 6, 'h': 1}):
            self.assertIsNone(server.figure_box(bad), bad)

    def test_paper_split_reports_figure_boxes_without_storing_them(self):
        # 拆題（圖片）時要求模型回報圖形範圍：草稿帶 figureBox，題目本身不帶圖，
        # 圖形範圍也不會被當成題目欄位寫進 payload。
        self.app.ai.configured = True
        self.app.ai.mode = 'local'
        self.app.ai.vision = 'vision'
        with_figure = {**self.draft, 'title': '附圖題', 'figure': {'x': 0.6, 'y': 0.2, 'w': 0.3, 'h': 0.25}}
        without = {**self.draft, 'title': '無圖題', 'figure': None}
        with patch.object(self.app.ai, 'call', return_value={'drafts': [with_figure, without]}) as ai:
            _, result, _ = self.request('POST', '/api/papers/parse',
                                        {'name': '圖片卷', 'dataUrl': png_url(), 'mime': 'image/png'},
                                        cookie=self.teacher, expect=200)
        self.assertEqual(ai.call_args[1]['model'], 'vision', '圖片要走視覺模型')
        self.assertIn('figure', ai.call_args[0][0], '圖片拆題的提示要要求圖形範圍')
        self.assertEqual(result['drafts'][0]['figureBox'], {'x': 0.6, 'y': 0.2, 'w': 0.3, 'h': 0.25})
        self.assertNotIn('figureBox', result['drafts'][1], '沒有圖形的題目不應有 figureBox')
        self.assertNotIn('figure', result['drafts'][0], '圖形範圍不是題目欄位，不應混進題目')
        self.assertIn('圖形', result['method'], '拆分方式要說明偵測到圖形')
        # 模型回報的範圍不合法時當作沒有圖形，而不是整題失敗。
        with patch.object(self.app.ai, 'call',
                          return_value={'drafts': [{**self.draft, 'title': '壞框', 'figure': {'x': 1}}]}):
            _, broken, _ = self.request('POST', '/api/papers/parse',
                                        {'name': '圖片卷', 'dataUrl': png_url(), 'mime': 'image/png'},
                                        cookie=self.teacher, expect=200)
        self.assertNotIn('figureBox', broken['drafts'][0])
        # 貼上文字時不可能有圖形範圍，提示也不該要求 figure。
        with patch.object(self.app.ai, 'call', return_value={'drafts': [without]}) as ai:
            self.request('POST', '/api/papers/parse', {'name': '文字卷', 'text': '1. 解 $x^2=1$。'},
                         cookie=self.teacher, expect=200)
            self.assertNotIn('figure', ai.call_args[0][0])

    def test_scanned_pdf_paper_is_rendered_page_by_page(self):
        # 掃描版試卷沒有文字層：由伺服器逐頁渲染成圖片交給視覺模型，
        # 不要叫教師自己轉檔。頁面圖只存在伺服器，前端沒有原圖可裁，
        # 所以不要求模型回報圖形範圍（否則會回一個前端用不到的框）。
        self.app.ai.configured = True
        self.app.ai.mode = 'local'
        self.app.ai.vision = 'vision'
        page = {**self.draft, 'title': '掃描題'}
        with patch.object(self.app.ai, 'call', return_value={'drafts': [page]}) as ai:
            _, result, _ = self.request('POST', '/api/papers/parse',
                                        {'name': '掃描卷', 'dataUrl': scanned_pdf_url(page_count=2),
                                         'mime': 'application/pdf'},
                                        cookie=self.teacher, expect=200)
        self.assertEqual(ai.call_count, 2, '兩頁要各呼叫一次視覺模型')
        for call in ai.call_args_list:
            self.assertEqual(call[1]['model'], 'vision', '掃描版要走視覺模型')
            self.assertTrue(call[1]['image'].startswith('data:image/png;base64,'), '每頁要送渲染後的 PNG')
            self.assertNotIn('figure', call[0][0], '前端裁不到原圖，不應要求圖形範圍')
        self.assertEqual(len(result['drafts']), 2, '兩頁的結果都要併入')
        self.assertIn('逐頁識別', result['method'], '拆分方式要說明是逐頁識別，不能說成長試卷切段')
        self.assertNotIn('長試卷', result['method'])

    def test_parse_stops_at_time_budget_and_reports_partial(self):
        # 拆題要控制在 Cloudflare 的 125 秒來源逾時之內：超過預算就停下來回報已完成的段落，
        # 不要讓整個請求被網路層切斷（那樣前端只會看到「伺服器回應無效」）。
        self.app.ai.configured = True
        self.app.ai.mode = 'local'
        paper = '\n'.join(f'{i}. 第 {i} 題 ' + 'x' * 130 for i in range(1, 61))
        calls = []

        def slow_call(instruction, payload, image=None, model=None, timeout=None):
            calls.append(timeout)
            time.sleep(0.05)
            return {'drafts': [{'title': f'第 {len(calls)} 段', 'content': '解 $x^2-1=0$。',
                                'topic': '一元二次方程', 'level': 1, 'points': 5, 'answer': '$x=1$'}]}

        with patch.object(server, 'PARSE_BUDGET_SECONDS', 0.12), \
                patch.object(self.app.ai, 'call', side_effect=slow_call):
            _, body, _ = self.request('POST', '/api/papers/parse', {'name': '長卷', 'text': paper},
                                      cookie=self.teacher, expect=200)
        self.assertGreater(len(calls), 0, '至少要處理一段')
        self.assertLess(len(calls), server.PARSE_MAX_CHUNKS, '不該把每一段都跑完')
        self.assertIn('已達單次處理時間上限', body['method'])
        self.assertEqual(len(body['drafts']), len(calls), '已完成的段落都要保留，不能整批丟掉')
        self.assertTrue(all(t is not None for t in calls), '每次呼叫都要帶逾時，才能控制總時間')

    def test_auto_import_returns_figure_boxes_for_the_browser_to_crop(self):
        # 全自動匯入：題目已寫入題庫，圖形改由前端裁好後用 /api/questions/figures 補上。
        self.app.ai.configured = True
        self.app.ai.mode = 'local'
        self.app.ai.vision = 'vision'
        box = {'x': 0.5, 'y': 0.5, 'w': 0.2, 'h': 0.2}
        with patch.object(self.app.ai, 'call',
                          return_value={'drafts': [{**self.draft, 'title': '附圖題', 'figure': box}]}):
            _, result, _ = self.request('POST', '/api/papers/auto-import',
                                        {'name': '圖片卷', 'dataUrl': png_url(), 'mime': 'image/png'},
                                        cookie=self.teacher, expect=200)
        self.assertEqual(result['count'], 1)
        self.assertEqual(result['figureBoxes'], [box])
        qid = result['questions'][0]['id']
        with self.app.db() as db:
            payload = json.loads(db.execute('SELECT payload FROM questions WHERE id=?', (qid,)).fetchone()[0])
        self.assertNotIn('figureBox', payload, '圖形範圍不可以寫進題目 payload')
        # 前端裁好圖後批次貼回題目。
        _, applied, _ = self.request('POST', '/api/questions/figures',
                                     {'figures': [{'id': qid, 'figure': png_url()}]},
                                     cookie=self.teacher, expect=200)
        self.assertEqual(applied['updated'], 1)
        with self.app.db() as db:
            stored = db.execute('SELECT figure,figure_mime FROM questions WHERE id=?', (qid,)).fetchone()
        self.assertIsNotNone(stored['figure'], '設定圖形後題目要有圖形')
        self.assertEqual(stored['figure_mime'], 'image/png')
        # 學生不能設定題目圖形；參數與題號都要檢查。
        self.request('POST', '/api/questions/figures',
                     {'figures': [{'id': qid, 'figure': png_url()}]}, cookie=self.student, expect=403)
        self.request('POST', '/api/questions/figures', {'figures': []}, cookie=self.teacher, expect=400)
        self.request('POST', '/api/questions/figures', {'figures': [{'id': qid}]},
                     cookie=self.teacher, expect=400)
        self.request('POST', '/api/questions/figures', {'figures': [{'id': qid, 'figure': png_url()}] * 101},
                     cookie=self.teacher, expect=400)
        self.request('POST', '/api/questions/figures',
                     {'figures': [{'id': 999999, 'figure': png_url()}]}, cookie=self.teacher, expect=404)
        with self.app.db() as db:
            self.assertIsNotNone(db.execute('SELECT figure FROM questions WHERE id=?', (qid,)).fetchone()[0],
                                 '題號不存在時不可先改到其他題目')
        # 空字串＝清空圖形（教師可以拿掉 AI 框錯的圖）。
        _, cleared, _ = self.request('POST', '/api/questions/figures',
                                     {'figures': [{'id': qid, 'figure': ''}]},
                                     cookie=self.teacher, expect=200)
        self.assertEqual(cleared['updated'], 1)
        with self.app.db() as db:
            self.assertIsNone(db.execute('SELECT figure FROM questions WHERE id=?', (qid,)).fetchone()[0])

    def test_sanitize_svg_keeps_geometry_and_drops_everything_else(self):
        # AI 畫的圖會直接畫進教師端頁面，所以只保留白名單的幾何元素與屬性。
        good = ("<svg viewBox='0 0 400 300' width='400' height='300'>"
                "<line x1='20' y1='280' x2='380' y2='280' stroke='#1f2d24' stroke-width='2'/>"
                "<text x='370' y='296' font-size='14'>x</text></svg>")
        out = server.sanitize_svg(good)
        self.assertIn('<line', out)
        self.assertIn('xmlns="http://www.w3.org/2000/svg"', out, '轉成圖片需要命名空間')
        self.assertIsNotNone(server.sanitize_svg("```xml\n" + good + "\n```"), '模型用圍欄包住也要能取出')
        unsafe = ("<svg viewBox='0 0 10 10'><script>alert(1)</script><line x1='1' y1='1' x2='9' y2='9' stroke='#000'/></svg>",
                  "<svg viewBox='0 0 10 10' onload='alert(1)'><rect x='1' y='1' width='9' height='9' fill='#000'/></svg>",
                  "<svg viewBox='0 0 10 10'><image href='https://x/y.png'/><circle cx='5' cy='5' r='4' stroke='#000'/></svg>",
                  "<svg viewBox='0 0 10 10'><foreignObject><div>x</div></foreignObject><circle cx='5' cy='5' r='4' stroke='#000'/></svg>",
                  "<svg viewBox='0 0 10 10'><rect x='1' y='1' width='9' height='9' fill='url(#evil)'/><circle cx='5' cy='5' r='4' stroke='#000'/></svg>",
                  "<svg viewBox='0 0 10 10' foo='bar'><circle cx='5' cy='5' r='4' stroke='#000' onclick='x()'/></svg>")
        for raw in unsafe:
            cleaned = server.sanitize_svg(raw)
            self.assertIsNotNone(cleaned, raw)
            for bad in ('script', 'onload', 'onclick', 'href', 'foreignObject', 'url(', 'foo='):
                self.assertNotIn(bad, cleaned, f'{bad} 不應留在消毒後的 SVG：{cleaned}')
        # 沒有圖形、不是 SVG、壞掉的一律回 None（寧可沒有圖，也不要畫錯或畫出危險內容）。
        for raw in ('', '<html><body>x</body></html>', "<svg viewBox='0 0 10 10'><g></g></svg>",
                    "<svg viewBox='0 0 10 10'><circle cx='5' cy='5'", None, 123, 'x' * 70000):
            self.assertIsNone(server.sanitize_svg(raw), raw)

    def test_ai_figure_endpoint_builds_svg_from_spec(self):
        self.app.ai.configured = False
        self.request('POST', '/api/questions/ai-figure', {'content': '兩直角邊 3、4，求斜邊。'},
                     cookie=self.teacher, expect=409)
        self.app.ai.configured = True
        self.app.ai.mode = 'local'
        spec = {'needed': True, 'kind': 'triangle',
                'points': [{'name': 'A', 'x': 0, 'y': 0}, {'name': 'B', 'x': 4, 'y': 0},
                           {'name': 'C', 'x': 0, 'y': 3}],
                'segments': [{'from': 'A', 'to': 'B'}, {'from': 'B', 'to': 'C'}, {'from': 'C', 'to': 'A'}],
                'marks': [{'type': 'right-angle', 'at': 'A', 'a': 'B', 'c': 'C'}],
                'labels': [{'text': '4', 'on': ['A', 'B']}],
                'givens': [{'key': 'AB', 'value': '4'}, {'key': 'AC', 'value': '3'}]}
        with patch.object(self.app.ai, 'call', return_value=spec) as ai:
            _, result, _ = self.request('POST', '/api/questions/ai-figure',
                                        {'title': '直角三角形', 'content': '兩直角邊 3、4，求斜邊。',
                                         'topic': '幾何', 'qtype': '解答題'},
                                        cookie=self.teacher, expect=200)
            self.assertIn('<svg', result['svg'])
            self.assertIn('xmlns="http://www.w3.org/2000/svg"', result['svg'])
            self.assertEqual(result['method'], 'AI 生成')
            self.assertEqual(result['issues'], [], '規格本身正確時不該留下疑慮')
            self.assertEqual(result['spec']['kind'], 'triangle')
            self.assertEqual(len(result['spec']['points']), 3)
            instructions = [call.args[0] for call in ai.call_args_list]
            self.assertTrue(any('數學座標' in one for one in instructions),
                            '要告訴模型用數學座標，不要自己算像素')
            self.assertTrue(any('不要輸出 SVG' in one for one in instructions))
        # 只有教師可以生成題目圖形；參數要檢查。
        self.request('POST', '/api/questions/ai-figure', {'content': 'x'}, cookie=self.student, expect=403)
        self.request('POST', '/api/questions/ai-figure', {}, cookie=self.teacher, expect=400)
        self.request('POST', '/api/questions/ai-figure', {'content': 'x', 'consentExternal': 'yes'},
                     cookie=self.teacher, expect=400)
        # 模型說不需要圖形、回不出可用規格，都不會流到瀏覽器。
        # （要用幾何題材，否則會先被題材檢查擋下。）
        geo = {'content': 'x', 'topic': '幾何'}
        with patch.object(self.app.ai, 'call', return_value={'needed': False}):
            self.request('POST', '/api/questions/ai-figure', geo, cookie=self.teacher, expect=422)
        with patch.object(self.app.ai, 'call', return_value={'answer': 'x'}) as ai:
            self.request('POST', '/api/questions/ai-figure', geo, cookie=self.teacher, expect=502)
            self.assertEqual(ai.call_count, server.FIGURE_SPEC_ATTEMPTS, '畫不出來時要重試到上限')
        with patch.object(self.app.ai, 'call',
                          return_value={'points': [{'name': 'A', 'x': 0, 'y': 0}], 'segments': []}):
            self.request('POST', '/api/questions/ai-figure', geo, cookie=self.teacher, expect=502)

    def test_ai_figure_spec_drops_unusable_parts(self):
        # 不合法或引用不存在頂點的內容一律丟掉，寧可少畫一個元素，也不要畫錯位置。
        spec = server.figure_spec({
            'points': [{'name': 'A', 'x': 0, 'y': 0}, {'name': 'B', 'x': '4', 'y': 0},
                       {'name': 'C', 'x': 'x', 'y': 1}, {'name': 'A', 'x': 9, 'y': 9},
                       {'name': '1bad!', 'x': 1, 'y': 1}],
            'segments': [{'from': 'A', 'to': 'B'}, {'from': 'A', 'to': 'Z'}, ['B', 'B'], ['A', 'B', 'C']],
            'circles': [{'center': 'A', 'through': 'B'}, {'center': 'Q', 'through': 'B'}],
            'marks': [{'type': 'tick', 'from': 'A', 'to': 'B', 'count': 9},
                      {'type': 'nope', 'from': 'A', 'to': 'B'}],
            'labels': [{'text': '4', 'on': ['A', 'B']}, {'text': 'x', 'at': 'Q'}, {'text': ''}],
            'givens': [{'key': 'AB', 'value': 4}, {'key': '', 'value': '1'}]})
        self.assertEqual([p['name'] for p in spec['points']], ['A', 'B'])
        self.assertEqual(spec['segments'], [{'from': 'A', 'to': 'B', 'dashed': False}])
        self.assertEqual(spec['circles'], [{'center': 'A', 'through': 'B'}])
        self.assertEqual(spec['marks'], [{'type': 'tick', 'from': 'A', 'to': 'B', 'count': 1}])
        self.assertEqual(spec['labels'], [{'text': '4', 'on': ['A', 'B']}])
        self.assertEqual(spec['givens'], [{'key': 'AB', 'value': '4'}])
        # 沒有頂點、沒有形狀、不是字典，都回 None。
        for bad in ({'points': [{'name': 'A', 'x': 0, 'y': 0}]}, {'points': []}, {'points': 'x'}, None, 5):
            self.assertIsNone(server.figure_spec(bad), bad)

    def test_render_spec_svg_keeps_proportions_and_passes_the_whitelist(self):
        spec = server.figure_spec({
            'points': [{'name': 'A', 'x': 0, 'y': 0}, {'name': 'B', 'x': 4, 'y': 0},
                       {'name': 'C', 'x': 0, 'y': 3}],
            'segments': [{'from': 'A', 'to': 'B'}, {'from': 'B', 'to': 'C'}, {'from': 'C', 'to': 'A'}],
            'labels': [{'text': '4', 'on': ['A', 'B']}, {'text': '3', 'on': ['A', 'C']}]})
        svg = server.render_spec_svg(spec)
        self.assertIn('xmlns="http://www.w3.org/2000/svg"', svg)
        cleaned = server.sanitize_svg(svg)
        self.assertIsNotNone(cleaned, '程式自己畫的圖必須直接通過消毒白名單')
        self.assertEqual(cleaned.count('<line'), 3, '三條邊都要留下來')
        # 4:3:5 的三角形，畫出來的像素長度比也必須是 4:3:5（同一個比例尺，不會被拉歪）。
        sides = sorted(((float(x2) - float(x1)) ** 2 + (float(y2) - float(y1)) ** 2) ** 0.5
                       for x1, y1, x2, y2 in re.findall(
                           r'<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"', svg))
        self.assertEqual(len(sides), 3)
        self.assertAlmostEqual(sides[0] / sides[1], 3 / 4, places=2)
        self.assertAlmostEqual(sides[1] / sides[2], 4 / 5, places=2)

    def test_verify_spec_flags_only_definite_errors(self):
        base = {'points': [{'name': 'A', 'x': 0, 'y': 0}, {'name': 'B', 'x': 4, 'y': 0},
                           {'name': 'C', 'x': 0, 'y': 3}],
                'segments': [{'from': 'A', 'to': 'B'}, {'from': 'B', 'to': 'C'}, {'from': 'C', 'to': 'A'}],
                'marks': [{'type': 'right-angle', 'at': 'A', 'a': 'B', 'c': 'C'}],
                'givens': [{'key': 'AB', 'value': '4'}, {'key': '∠BAC', 'value': '90°'}]}

        def make(**over):
            return server.figure_spec({**base, **over})

        self.assertEqual(server.verify_spec(make()), [], '正確的圖不可以被誤判，否則會白白重畫')
        # 標了直角但實際不是直角。
        not_right = {'points': [{'name': 'A', 'x': 0, 'y': 0}, {'name': 'B', 'x': 4, 'y': 0},
                                {'name': 'C', 'x': 3, 'y': 3}]}
        self.assertIn('直角', '；'.join(server.verify_spec(make(**not_right))))
        # 題目說 AB=4，規格卻把兩點畫在距離 9 的位置。
        self.assertIn('AB', '；'.join(server.verify_spec(make(givens=[{'key': 'AB', 'value': '9'}]))))
        # 角度弧線寫的度數與實際夾角不符。
        self.assertIn('60°', '；'.join(server.verify_spec(
            make(marks=[{'type': 'angle', 'at': 'A', 'a': 'B', 'c': 'C', 'text': '60°'}], givens=[]))))
        # 兩個頂點畫在同一個位置。
        self.assertIn('同一個位置', '；'.join(server.verify_spec(make(
            points=[{'name': 'A', 'x': 0, 'y': 0}, {'name': 'B', 'x': 0, 'y': 0}, {'name': 'C', 'x': 0, 'y': 3}],
            marks=[], givens=[]))))
        # 標了等長記號，但兩邊長度不同。
        ticks = {'points': [{'name': 'A', 'x': 0, 'y': 0}, {'name': 'B', 'x': 4, 'y': 0},
                            {'name': 'C', 'x': 0, 'y': 3}, {'name': 'D', 'x': 0, 'y': 6}],
                 'segments': [{'from': 'A', 'to': 'B'}, {'from': 'A', 'to': 'C'}, {'from': 'C', 'to': 'D'}],
                 'marks': [{'type': 'tick', 'from': 'A', 'to': 'B', 'count': 1},
                           {'type': 'tick', 'from': 'A', 'to': 'C', 'count': 1}],
                 'givens': []}
        self.assertIn('等長', '；'.join(server.verify_spec(make(**ticks))))
        # 標了平行記號，但兩條線不平行。
        self.assertIn('平行', '；'.join(server.verify_spec(make(**{
            'marks': [{'type': 'parallel', 'from': 'A', 'to': 'B', 'count': 1},
                      {'type': 'parallel', 'from': 'B', 'to': 'C', 'count': 1}], 'givens': []}))))

    def test_ai_figure_only_for_geometry_and_vector_topics(self):
        # 只有幾何與向量題材才畫圖；其他題材硬畫只會畫出與題目無關的圖。
        self.app.ai.configured = True
        self.app.ai.mode = 'local'
        for topic in server.FIGURE_TOPICS:
            self.assertTrue(server.figure_needed(topic), topic)
        for topic in ('代數', '一元二次方程', '統計', '概率', '函數', '數列與級數', ''):
            self.assertFalse(server.figure_needed(topic), topic)
        spec = {'points': [{'name': 'A', 'x': 0, 'y': 0}, {'name': 'B', 'x': 4, 'y': 0}],
                'segments': [{'from': 'A', 'to': 'B'}]}
        with patch.object(self.app.ai, 'call') as ai:
            for topic in ('代數', '統計', '概率', ''):
                _, result, _ = self.request('POST', '/api/questions/ai-figure',
                                            {'content': '解方程 $x^2=1$。', 'topic': topic},
                                            cookie=self.teacher, expect=422)
                self.assertIn('幾何', result['error'])
                self.assertIn('手動插入', result['error'], '要告訴教師可以改用什麼')
            ai.assert_not_called()
        with patch.object(self.app.ai, 'call', return_value=spec) as ai:
            self.request('POST', '/api/questions/ai-figure',
                         {'content': '兩直角邊 3、4，求斜邊。', 'topic': '幾何'},
                         cookie=self.teacher, expect=200)
            # 一次生成＝一次規格 ＋ 一次獨立讀題核對。
            self.assertEqual(ai.call_count, 2)
            self.assertTrue(any('數學座標' in call.args[0] for call in ai.call_args_list))

    def test_ai_figure_revision_uses_the_check_issues(self):
        # 核對出問題後重畫：問題原文要進到提示，要求這次務必修正。
        self.app.ai.configured = True
        self.app.ai.mode = 'local'
        spec = {'points': [{'name': 'A', 'x': 0, 'y': 0}, {'name': 'B', 'x': 4, 'y': 0},
                           {'name': 'C', 'x': 0, 'y': 3}],
                'segments': [{'from': 'A', 'to': 'B'}, {'from': 'B', 'to': 'C'}, {'from': 'C', 'to': 'A'}]}
        with patch.object(self.app.ai, 'call', return_value=spec) as ai:
            self.request('POST', '/api/questions/ai-figure',
                         {'content': '兩直角邊 3、4，求斜邊。', 'topic': '幾何',
                          'issues': ['圖上標成 4、5', '缺少直角標記']},
                         cookie=self.teacher, expect=200)
            instructions = [call.args[0] for call in ai.call_args_list]
            self.assertTrue(any('圖上標成 4、5' in one for one in instructions))
            self.assertTrue(any('缺少直角標記' in one for one in instructions))
        # issues 必須是清單；空清單不改變提示。
        self.request('POST', '/api/questions/ai-figure',
                     {'content': 'x', 'topic': '幾何', 'issues': '不是清單'},
                     cookie=self.teacher, expect=400)
        with patch.object(self.app.ai, 'call', return_value=spec) as ai:
            self.request('POST', '/api/questions/ai-figure',
                         {'content': 'x', 'topic': '幾何', 'issues': []}, cookie=self.teacher, expect=200)
            self.assertFalse(any('上一版圖形' in call.args[0] for call in ai.call_args_list))

    def test_ai_figure_check_compares_question_and_figure_readings(self):
        # 反向謄寫核對：模型分別讀出「題目說的」與「圖上畫的」，差異由程式比對出來。
        self.app.ai.configured = True
        self.app.ai.mode = 'local'
        self.app.ai.vision = ''
        self.request('POST', '/api/questions/ai-figure-check',
                     {'content': '兩直角邊 3、4，求斜邊。', 'image': png_url()},
                     cookie=self.teacher, expect=409)
        self.app.ai.vision = 'vision'
        reading = {
            'question': {'shape': '直角三角形',
                         'values': [{'key': 'AB', 'value': '4'}, {'key': '∠BAC', 'value': '90°'}],
                         'marks': ['直角記號']},
            'figure': {'shape': '等腰三角形', 'values': [{'key': 'AB', 'value': '5'}], 'marks': []}}
        with patch.object(self.app.ai, 'call', return_value=reading) as ai:
            _, result, _ = self.request('POST', '/api/questions/ai-figure-check',
                                        {'title': '直角三角形', 'content': '兩直角邊 3、4，求斜邊。',
                                         'image': png_url()}, cookie=self.teacher, expect=200)
            self.assertEqual(ai.call_args[1]['model'], 'vision', '核對要走視覺模型')
            self.assertFalse(result['ok'])
            joined = '；'.join(result['issues'])
            self.assertIn('AB', joined, '標錯的數值要指出來')
            self.assertIn('直角', joined, '題目是直角三角形、圖卻不是，要指出來')
            self.assertIn('∠BAC', joined, '圖上缺了題目給的標示，要指出來')
            self.assertIn('重畫', result['advice'])
            self.assertEqual(result['figure']['shape'], '等腰三角形', '要回傳模型實際讀到的內容')
            instruction = ai.call_args[0][0]
            self.assertIn('分別', instruction, '要要求模型分開讀，不要互相遷就')
        # 兩邊讀出來一致時就是通過。
        same = {'question': reading['question'],
                'figure': {'shape': '直角三角形',
                           'values': [{'key': 'AB', 'value': '4'}, {'key': '∠BAC', 'value': '90°'}],
                           'marks': ['直角記號']}}
        with patch.object(self.app.ai, 'call', return_value=same):
            _, result, _ = self.request('POST', '/api/questions/ai-figure-check',
                                        {'content': 'x', 'image': png_url()}, cookie=self.teacher, expect=200)
            self.assertTrue(result['ok'])
            self.assertEqual(result['issues'], [])
        # 只有教師可以核對；參數要檢查。
        self.request('POST', '/api/questions/ai-figure-check',
                     {'content': 'x', 'image': png_url()}, cookie=self.student, expect=403)
        self.request('POST', '/api/questions/ai-figure-check', {'content': 'x'}, cookie=self.teacher, expect=400)
        self.request('POST', '/api/questions/ai-figure-check',
                     {'content': 'x', 'image': 'not-an-image'}, cookie=self.teacher, expect=400)
        self.request('POST', '/api/questions/ai-figure-check',
                     {'content': 'x', 'image': png_url(), 'consentExternal': 'yes'},
                     cookie=self.teacher, expect=400)
        # 回應格式不對時要明確失敗，不能默默當成「沒問題」。
        for bad_result in ({'figure': {'shape': '三角形', 'values': [], 'marks': []}},
                           {'question': {'shape': 'x'}}, {'figure': {'shape': '', 'values': [], 'marks': []},
                                                          'question': {'shape': 'x'}},
                           {'figure': 'x', 'question': 'x'}, 'x'):
            with patch.object(self.app.ai, 'call', return_value=bad_result):
                self.request('POST', '/api/questions/ai-figure-check',
                             {'content': 'x', 'image': png_url()}, cookie=self.teacher, expect=502)

    def test_compare_readings_reports_explainable_differences(self):
        reading = server.figure_read({
            'question': {'shape': '直角三角形',
                         'values': [{'key': 'AB', 'value': '4'}, {'key': '∠BAC', 'value': '90°'}],
                         'marks': ['直角記號']},
            'figure': {'shape': '等腰三角形', 'values': [{'key': 'AB', 'value': '5'}], 'marks': []}})
        issues, advice = server.compare_readings(reading)
        joined = '；'.join(issues)
        self.assertIn('AB', joined)
        self.assertIn('直角', joined)
        self.assertIn('∠BAC', joined)
        self.assertIn('重畫', advice)
        # 兩邊一致時沒有問題。
        same = server.figure_read({
            'question': {'shape': '直角三角形', 'values': [{'key': 'AB', 'value': '4'}], 'marks': []},
            'figure': {'shape': '直角三角形', 'values': [{'key': 'AB', 'value': '4'}], 'marks': []}})
        self.assertEqual(server.compare_readings(same), ([], ''))
        # 圖上多出來的標示不算問題（多標不會誤導學生）。
        extra = server.figure_read({
            'question': {'shape': '', 'values': [], 'marks': []},
            'figure': {'shape': '圓', 'values': [{'key': 'r', 'value': '3'}], 'marks': []}})
        self.assertEqual(server.compare_readings(extra), ([], ''))
        # 讀不出圖形內容時視為核對失敗，不能當成「沒問題」。
        self.assertIsNone(server.figure_read(
            {'question': {'shape': 'x'}, 'figure': {'shape': '', 'values': [], 'marks': []}}))
        self.assertIsNone(server.figure_read('x'))

    def test_verify_against_question_catches_a_figure_that_ignores_the_data(self):
        # 模型漏填 givens 時還是要抓到「圖跟題目差很遠」——靠獨立讀題的數據比對。
        bare = server.figure_spec({'kind': 'triangle',
                                   'points': [{'name': 'A', 'x': 0, 'y': 0}, {'name': 'B', 'x': 6, 'y': 0},
                                              {'name': 'C', 'x': 6, 'y': 8}],
                                   'segments': [{'from': 'A', 'to': 'B'}, {'from': 'B', 'to': 'C'},
                                                {'from': 'C', 'to': 'A'}]})
        facts = {'shape': '直角三角形',
                 'values': [{'key': 'AB', 'value': '6'}, {'key': 'BC', 'value': '8'},
                            {'key': '∠B', 'value': '90°'}],
                 'marks': ['直角']}
        joined = '；'.join(server.verify_against_question(facts, bare))
        self.assertIn('AB = 6 沒有標在圖上', joined)
        self.assertIn('BC = 8 沒有標在圖上', joined)
        self.assertIn('沒有直角記號', joined)
        # 標齊了就沒有問題（直角用直角記號表示即可，不必另外寫 90°）。
        good = server.figure_spec({'kind': 'triangle',
                                   'points': [{'name': 'A', 'x': 0, 'y': 0}, {'name': 'B', 'x': 6, 'y': 0},
                                              {'name': 'C', 'x': 6, 'y': 8}],
                                   'segments': [{'from': 'A', 'to': 'B'}, {'from': 'B', 'to': 'C'},
                                                {'from': 'C', 'to': 'A'}],
                                   'marks': [{'type': 'right-angle', 'at': 'B', 'a': 'A', 'c': 'C'}],
                                   'labels': [{'text': '6', 'on': ['A', 'B']}, {'text': '8', 'on': ['B', 'C']}],
                                   'givens': [{'key': 'AB', 'value': '6'}, {'key': 'BC', 'value': '8'}]})
        self.assertEqual(server.verify_against_question(facts, good), [])
        # 題目是圓、圖卻畫成三角形。
        self.assertIn('沒有畫圓', '；'.join(server.verify_against_question(
            {'shape': '圓', 'values': [], 'marks': []}, bare)))
        # 規格自己寫的 givens 與題目不符。
        self.assertIn('卻寫成 4', '；'.join(server.verify_against_question(
            {'shape': '', 'values': [{'key': 'AB', 'value': '6'}], 'marks': []},
            server.figure_spec({'points': [{'name': 'A', 'x': 0, 'y': 0}, {'name': 'B', 'x': 4, 'y': 0}],
                                'segments': [{'from': 'A', 'to': 'B'}],
                                'givens': [{'key': 'AB', 'value': '4'}]}))))
        # 沒有讀到題目資料時不亂報。
        self.assertEqual(server.verify_against_question(None, bare), [])

    def test_verify_no_extras_catches_invented_points(self):
        # 教師最直接感受到的「圖跟題文差很遠」：模型自己加了輔助點或輔助線。
        content = '在直角三角形 ABC 中，AB = 6，AC = 8，∠A = 90°，求 BC。'

        def make(**over):
            base = {'kind': 'triangle',
                    'points': [{'name': 'A', 'x': 0, 'y': 0}, {'name': 'B', 'x': 6, 'y': 0},
                               {'name': 'C', 'x': 0, 'y': 8}],
                    'segments': [{'from': 'A', 'to': 'B'}, {'from': 'B', 'to': 'C'},
                                 {'from': 'C', 'to': 'A'}],
                    'marks': [{'type': 'right-angle', 'at': 'A', 'a': 'B', 'c': 'C'}]}
            base.update(over)
            return server.figure_spec(base)

        self.assertEqual(server.verify_no_extras(content, make()), [],
                         '乾淨的圖不可以被誤判，否則會白白重畫')
        extra = make(points=[{'name': 'A', 'x': 0, 'y': 0}, {'name': 'B', 'x': 6, 'y': 0},
                             {'name': 'C', 'x': 0, 'y': 8}, {'name': 'D', 'x': 3, 'y': 4}],
                     segments=[{'from': 'A', 'to': 'B'}, {'from': 'B', 'to': 'C'},
                               {'from': 'C', 'to': 'A'}, {'from': 'A', 'to': 'D'}])
        self.assertIn('D', '；'.join(server.verify_no_extras(content, extra)))
        # 題目沒有替頂點命名時，模型自己取名字不算多餘。
        self.assertEqual(server.verify_no_extras('兩直角邊分別為 3 與 4，求斜邊。', extra), [])
        # 孤立的點（沒有連到任何線）。
        self.assertIn('沒有連到任何線', '；'.join(server.verify_no_extras(content, make(
            points=[{'name': 'A', 'x': 0, 'y': 0}, {'name': 'B', 'x': 6, 'y': 0},
                    {'name': 'C', 'x': 0, 'y': 8}, {'name': 'Z', 'x': 9, 'y': 9}],
            segments=[{'from': 'A', 'to': 'B'}, {'from': 'B', 'to': 'C'}, {'from': 'C', 'to': 'A'}]))))
        # 題目沒提到圓或座標軸，圖上就不該有。
        joined = '；'.join(server.verify_no_extras(content, make(
            points=[{'name': 'A', 'x': 0, 'y': 0}, {'name': 'B', 'x': 6, 'y': 0}],
            segments=[{'from': 'A', 'to': 'B'}], marks=[],
            circles=[{'center': 'A', 'through': 'B'}], axes={'x': True, 'y': True, 'origin': 'A'})))
        self.assertIn('畫了圓', joined)
        self.assertIn('坐標軸', joined)
        # 座標題畫座標軸是合理的。
        self.assertEqual(server.verify_no_extras('已知 A(3,1)、B(1,3)，求 AB。', make(
            points=[{'name': 'A', 'x': 3, 'y': 1}, {'name': 'B', 'x': 1, 'y': 3}],
            segments=[{'from': 'A', 'to': 'B'}], marks=[],
            axes={'x': True, 'y': True, 'origin': 'A'})), [])
        # 點名抽取：△ABC、AB、∠ABC 與單一字母都要算進去。
        self.assertLessEqual({'A', 'B', 'C'}, server.question_point_names('△ABC 中，AB = 6，∠ABC = 90°'))

    def test_ai_draw_model_can_be_set_separately(self):
        # 畫圖比批改更吃模型能力，所以可以另外指定繪圖模型；沒指定就沿用文字模型。
        self.app.ai.configure({'base_url': 'https://api.example.com', 'model': 'text-model',
                               'vision_model': 'vision-model', 'draw_model': 'draw-model'})
        self.assertEqual(self.app.ai.draw, 'draw-model')
        self.assertEqual(self.app.ai.public()['draw'], 'draw-model')
        self.assertTrue(self.app.ai.public()['drawCustom'])
        spec = {'points': [{'name': 'A', 'x': 0, 'y': 0}, {'name': 'B', 'x': 6, 'y': 0},
                           {'name': 'C', 'x': 0, 'y': 8}],
                'segments': [{'from': 'A', 'to': 'B'}, {'from': 'B', 'to': 'C'}, {'from': 'C', 'to': 'A'}],
                'labels': [{'text': '6', 'on': ['A', 'B']}, {'text': '8', 'on': ['A', 'C']}],
                'givens': [{'key': 'AB', 'value': '6'}, {'key': 'AC', 'value': '8'}]}
        with patch.object(self.app.ai, 'call', return_value=spec) as ai:
            self.request('POST', '/api/questions/ai-figure',
                         {'content': '在直角三角形 ABC 中，AB = 6，AC = 8。', 'topic': '幾何',
                          'consentExternal': True},
                         cookie=self.teacher, expect=200)
            draws = [call for call in ai.call_args_list if '數學座標' in call.args[0]]
            self.assertTrue(draws, '要有一次繪圖呼叫')
            self.assertEqual(draws[0].kwargs.get('model'), 'draw-model', '畫圖要走指定的繪圖模型')
        # 沒設定繪圖模型時沿用文字模型（由 AIClient 決定），對外顯示成文字模型。
        self.app.ai.configure({'base_url': 'https://api.example.com', 'model': 'text-model'})
        self.assertEqual(self.app.ai.draw, '')
        self.assertEqual(self.app.ai.public()['draw'], 'text-model')
        self.assertFalse(self.app.ai.public()['drawCustom'])

    def test_ai_figure_redraws_when_the_figure_ignores_the_question(self):
        # 端到端：圖跟題目差很遠時要自動帶著問題重畫，而不是把錯的圖交給教師。
        self.app.ai.configured = True
        self.app.ai.mode = 'local'
        spec = {'kind': 'triangle',
                'points': [{'name': 'A', 'x': 0, 'y': 0}, {'name': 'B', 'x': 6, 'y': 0},
                           {'name': 'C', 'x': 6, 'y': 8}],
                'segments': [{'from': 'A', 'to': 'B'}, {'from': 'B', 'to': 'C'}, {'from': 'C', 'to': 'A'}]}
        facts = {'shape': '直角三角形', 'values': [{'key': 'AB', 'value': '6'}], 'marks': ['直角']}
        seen = []

        def fake(instruction, payload, image=None, model=None, temperature=None):
            seen.append(instruction)
            return facts if '只讀出題目' in instruction else spec

        with patch.object(self.app.ai, 'call', side_effect=fake):
            _, result, _ = self.request('POST', '/api/questions/ai-figure',
                                        {'content': '直角三角形中 AB = 6，求斜邊。', 'topic': '幾何'},
                                        cookie=self.teacher, expect=200)
        self.assertIn('沒有標在圖上', '；'.join(result['issues']))
        self.assertIn('務必人工核對', result['notice'], '還有疑慮時要提醒教師')
        redraws = [one for one in seen if '上一版圖形' in one]
        self.assertTrue(redraws, '要帶著問題重畫')
        self.assertIn('沒有標在圖上', redraws[0])
        self.assertEqual(len([one for one in seen if '只讀出題目' in one]), 1, '題目不會變，讀一次就夠')

    def test_generate_external_consent_required_before_model_call(self):
        for index, base in enumerate(('https://external.invalid/v1', 'https://192.168.1.2/v1'), 1):
            # 每次用不同標題，避免第二輪因為「與先前生成過的題目重複」而被擋下。
            generated = dict(self.draft, title=f'外部 AI 新題{index}')
            with patch.dict('os.environ', {'MATH_AI_BASE_URL': base, 'MATH_AI_MODEL': 'model'}, clear=True):
                self.app.ai = server.AIClient()
            self.assertEqual(self.app.ai.mode, 'external')
            # 生成題目只限教師：學生一律 403，且不會呼叫外部模型。
            with patch.object(self.app.ai, 'call', return_value={'question': generated}) as ai:
                self.request('POST', '/api/questions/1/generate', {'kind': 'similar', 'consentExternal': True},
                             cookie=self.student, expect=403)
                ai.assert_not_called()
            with patch.object(self.app.ai, 'call', return_value={'question': generated}) as ai:
                for patch_body, status in (({}, 403), ({'consentExternal': False}, 403),
                                           ({'consentExternal': 'true'}, 400), ({'consentExternal': 1}, 400),
                                           ({'consentExternal': None}, 400), ({'unknown': True}, 400)):
                    self.request('POST', '/api/questions/1/generate', {'kind': 'similar', **patch_body},
                                 cookie=self.teacher, expect=status)
                ai.assert_not_called()
                with self.app.db() as db:
                    before = db.execute('SELECT count(*) FROM questions').fetchone()[0]
                _, result, _ = self.request('POST', '/api/questions/1/generate',
                                            {'kind': 'similar', 'consentExternal': True}, cookie=self.teacher, expect=200)
                # 同一道題第二次生成時會要求避開先前的題目，可能重試一次，故只確認確實呼叫過模型。
                self.assertTrue(ai.called)
                # 草稿只回傳、不寫入題庫；教師可看到答案與詳解以便核驗。
                self.assertEqual(result['draft']['source'], 'AI 生成 · 待核驗')
                self.assertIn('answer', result['draft'])
                self.assertNotIn('id', result['draft'])
                with self.app.db() as db:
                    self.assertEqual(db.execute('SELECT count(*) FROM questions').fetchone()[0], before)

    def test_generated_question_draft_not_saved_until_teacher_confirms(self):
        self.app.ai.configured = True
        self.app.ai.mode = 'local'
        generated = dict(self.draft, title='AI 新題')
        with patch.object(self.app.ai, 'call', return_value={'question': generated}):
            _, result, _ = self.request('POST', '/api/questions/1/generate', {'kind': 'similar'},
                                        cookie=self.teacher, expect=200)
        draft = result['draft']
        # 草稿尚未加入題庫：沒有編號，題庫數量不變。
        self.assertNotIn('id', draft)
        self.assertEqual(draft['source'], 'AI 生成 · 待核驗')
        self.assertIn('answer', draft)
        self.assertIn('steps', draft)
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM questions').fetchone()[0], 16)
        # 教師核驗後決定加入題庫，才透過題庫匯入寫入，並可取回新題編號。
        _, imported, _ = self.request('POST', '/api/questions/import', {'questions': [draft]},
                                      cookie=self.teacher, expect=200)
        self.assertEqual(imported['count'], 1)
        self.assertEqual(imported['questions'][0]['title'], 'AI 新題')
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM questions').fetchone()[0], 17)
            stored = self.app.get_question(db, imported['questions'][0]['id'])
            self.assertEqual(stored['answer'], generated['answer'])
        # 學生不能生成題目，也不能藉此把題目寫進題庫。
        with patch.object(self.app.ai, 'call', return_value={'question': generated}) as ai:
            self.request('POST', '/api/questions/1/generate', {'kind': 'similar'}, cookie=self.student, expect=403)
            ai.assert_not_called()
        with patch.object(self.app.ai, 'call', return_value={'question': dict(generated, level=3)}):
            self.request('POST', '/api/questions/1/generate', {'kind': 'similar'}, cookie=self.teacher, expect=502)
        with patch.object(self.app.ai, 'call', return_value={'question': dict(generated, title='AI 進階題', level=2)}):
            _, result, _ = self.request('POST', '/api/questions/1/generate', {'kind': 'advanced'},
                                        cookie=self.teacher, expect=200)
            self.assertIn('answer', result['draft'])
        with patch.object(self.app.ai, 'call', return_value={'drafts': [generated]}):
            _, parsed, _ = self.request('POST', '/api/papers/parse', {'name': '試卷', 'text': '1. 解方程'}, cookie=self.teacher, expect=200)
            self.assertEqual(parsed['method'], 'AI 識別')

    def test_objective_questions_do_not_get_a_rubric(self):
        # 選擇題／填空題是客觀題：作答只有對或錯，不需要評分標準，也就不會產生 AI 評分步驟。
        self.app.ai.configured = True
        self.app.ai.mode = 'local'
        # 1) 拆題提示要講清楚：客觀題的 rubric 一律留空
        instruction = server.parse_instruction()
        self.assertIn('客觀題', instruction)
        self.assertIn('rubric 一律留空陣列', instruction)
        # 2) 模型若硬生評分標準，拆題與 AI 生成答案都會清掉
        choice = dict(self.draft, title='客觀選擇題', qtype='選擇題', options=['$1$', '$2$'], answer='B',
                      rubric=[{'label': '正確選項', 'percent': 60}, {'label': '推理依據', 'percent': 40}])
        self.assertEqual(server.coerce_ai_draft(choice)['rubric'], [])
        blank = dict(self.draft, title='客觀填空題', qtype='填空題', options=[],
                     rubric=[{'label': '答案正確', 'percent': 100}])
        self.assertEqual(server.coerce_ai_draft(blank)['rubric'], [])
        essay = dict(self.draft, title='主觀解答題', qtype='解答題',
                     rubric=[{'label': '列式', 'percent': 50}, {'label': '求解', 'percent': 50}])
        self.assertEqual(len(server.coerce_ai_draft(essay)['rubric']), 2, '解答題仍要保留評分標準')
        with patch.object(self.app.ai, 'call', return_value={'answer': 'B', 'steps': ['代入求解。', '得 B。'],
                                                             'analysis': '考點是代數運算。',
                                                             'rubric': [{'label': '正確選項', 'percent': 100}]}) as ai:
            _, result, _ = self.request('POST', '/api/questions/ai-answer',
                                        {'content': '下列何者正確？ (A) 1 (B) 2', 'qtype': '選擇題',
                                         'options': ['1', '2'], 'points': 5}, cookie=self.teacher, expect=200)
            self.assertEqual(result['rubric'], [], '選擇題不應回傳評分標準')
            self.assertEqual(result['qtype'], '選擇題')
            self.assertIn('空陣列', ai.call_args[0][0], '提示要說明客觀題的 rubric 留空')
        # 3) 拆題（AI 識別）出來的選擇題草稿也沒有評分標準
        ai_choice = dict(self.draft, title='AI 拆出的選擇題', qtype='選擇題', options=['$1$', '$2$'], answer='A',
                         rubric=[{'label': '正確選項', 'percent': 100}])
        with patch.object(self.app.ai, 'call', return_value={'drafts': [ai_choice]}):
            _, parsed, _ = self.request('POST', '/api/papers/parse', {'name': '試卷', 'text': '1. 解方程'},
                                        cookie=self.teacher, expect=200)
        self.assertEqual(parsed['drafts'][0]['qtype'], '選擇題')
        self.assertEqual(parsed['drafts'][0]['rubric'], [])

    def test_generate_asks_for_a_new_variant_each_time(self):
        # 同一道參考題連續生成時，必須要求模型換一題，而不是每次都拿到相同的題目。
        self.app.ai.configured = True
        self.app.ai.mode = 'local'
        first = dict(self.draft, title='AI變式甲')
        second = dict(self.draft, title='AI變式乙')
        third = dict(self.draft, title='AI變式丙')
        with patch.object(self.app.ai, 'call', return_value={'question': first}) as ai:
            _, result, _ = self.request('POST', '/api/questions/1/generate', {'kind': 'similar'},
                                        cookie=self.teacher, expect=200)
            self.assertEqual(result['draft']['title'], 'AI變式甲')
            self.assertEqual(ai.call_count, 1)
            # 生成用較高 temperature；批改仍維持 0（可重現）。
            self.assertGreater(ai.call_args[1]['temperature'], 0)
            # 相似題要把參考題當模板，並明寫難度與題型，確保「夠類似」。
            text = ai.call_args[0][0]
            self.assertIn('相似題', text)
            self.assertIn('level 必須是 1', text)
            self.assertIn('請把參考題當作模板', text)
            self.assertIn('不可以變得更難', text)
            self.assertIn('題型（解答題）', text)
        # 第二次生成：先前的題目摘要會進到提示，並帶上隨機變化方向。
        with patch.object(self.app.ai, 'call', return_value={'question': second}) as ai:
            _, result, _ = self.request('POST', '/api/questions/1/generate', {'kind': 'similar'},
                                        cookie=self.teacher, expect=200)
            instruction = ai.call_args[0][0]
            self.assertIn('AI變式甲', instruction)
            self.assertIn('本次變化方向', instruction)
            self.assertEqual(result['draft']['title'], 'AI變式乙')
        # 前端也可以自己帶 avoid 清單（例如重新載入後仍記得）。
        with patch.object(self.app.ai, 'call', return_value={'question': third}) as ai:
            self.request('POST', '/api/questions/1/generate', {'kind': 'similar', 'avoid': ['別重複的題目']},
                         cookie=self.teacher, expect=200)
            self.assertIn('別重複的題目', ai.call_args[0][0])
        # 進階題：提示要寫明比參考題高一級。
        with patch.object(self.app.ai, 'call',
                          return_value={'question': dict(third, title='AI進階丁', level=2)}) as ai:
            self.request('POST', '/api/questions/1/generate', {'kind': 'advanced'}, cookie=self.teacher, expect=200)
            advanced_text = ai.call_args[0][0]
            self.assertIn('進階題', advanced_text)
            self.assertIn('level 必須是 2', advanced_text)
        # 難度不符（相似題卻回高一級）：重試一次，兩次都不符就明確拒絕。
        with patch.object(self.app.ai, 'call', return_value={'question': dict(first, level=2)}) as ai:
            self.request('POST', '/api/questions/1/generate', {'kind': 'similar'}, cookie=self.teacher, expect=502)
            self.assertEqual(ai.call_count, 2)
        # 相似題必須與參考題同題型（題型跑掉就重試，兩次都跑掉就拒絕）。
        with patch.object(self.app.ai, 'call',
                          return_value={'question': dict(first, title='AI變式戊', qtype='選擇題')}) as ai:
            self.request('POST', '/api/questions/1/generate', {'kind': 'similar'}, cookie=self.teacher, expect=502)
            self.assertEqual(ai.call_count, 2)
        # 模型仍生成與先前完全相同的題目時，會再試一次；兩次都相同就拒絕，不會默默回傳重複題。
        with patch.object(self.app.ai, 'call', return_value={'question': first}) as ai:
            self.request('POST', '/api/questions/1/generate', {'kind': 'similar'}, cookie=self.teacher, expect=502)
            self.assertEqual(ai.call_count, 2)
        # avoid 格式錯誤要在呼叫模型前擋下。
        with patch.object(self.app.ai, 'call') as ai:
            self.request('POST', '/api/questions/1/generate', {'kind': 'similar', 'avoid': '不是清單'},
                         cookie=self.teacher, expect=400)
            self.request('POST', '/api/questions/1/generate', {'kind': 'similar', 'avoid': [1, 2]},
                         cookie=self.teacher, expect=400)
            self.request('POST', '/api/questions/1/generate',
                         {'kind': 'similar', 'avoid': ['x'] * 21}, cookie=self.teacher, expect=400)
            ai.assert_not_called()


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

    def test_scale_env_defaults_and_clamps(self):
        """併發、資料庫逾時、一鍵全批、備份上限都要能靠環境變數調整，且夾在安全範圍內。"""
        with patch.dict('os.environ', {}, clear=True):
            self.assertEqual(server.ai_concurrency(), 16)
            self.assertEqual(server.db_timeout(), 30.0)
            self.assertEqual(server.ai_review_limit(), 200)
            self.assertEqual(storage.max_backup_object(), 512 * 1024 * 1024)
            self.assertEqual(storage.backup_timeout(), 300)
        with patch.dict('os.environ', {'MATH_AI_CONCURRENCY': '32', 'MATH_DB_TIMEOUT': '60',
                                       'MATH_AI_REVIEW_LIMIT': '500', 'MATH_BACKUP_MAX_MB': '4096',
                                       'MATH_BACKUP_TIMEOUT': '900'}, clear=True):
            self.assertEqual(server.ai_concurrency(), 32)
            self.assertEqual(server.db_timeout(), 60.0)
            self.assertEqual(server.ai_review_limit(), 500)
            self.assertEqual(storage.max_backup_object(), 4096 * 1024 * 1024)
            self.assertEqual(storage.backup_timeout(), 900)
        with patch.dict('os.environ', {'MATH_AI_CONCURRENCY': '99999', 'MATH_DB_TIMEOUT': '99999',
                                       'MATH_AI_REVIEW_LIMIT': '99999', 'MATH_BACKUP_MAX_MB': '99999',
                                       'MATH_BACKUP_TIMEOUT': '99999'}, clear=True):
            self.assertEqual(server.ai_concurrency(), 128)
            self.assertEqual(server.db_timeout(), 300.0)
            self.assertEqual(server.ai_review_limit(), 2000)
            # 超過 R2 單次 PUT 的上限就沒有意義，所以夾在 5120 MB。
            self.assertEqual(storage.max_backup_object(), 5120 * 1024 * 1024)
            self.assertEqual(storage.backup_timeout(), 3600)
        with patch.dict('os.environ', {'MATH_AI_CONCURRENCY': '0', 'MATH_DB_TIMEOUT': '0',
                                       'MATH_AI_REVIEW_LIMIT': '0', 'MATH_BACKUP_MAX_MB': '0',
                                       'MATH_BACKUP_TIMEOUT': '0'}, clear=True):
            self.assertEqual(server.ai_concurrency(), 1)
            self.assertEqual(server.db_timeout(), 1.0)
            self.assertEqual(server.ai_review_limit(), 1)
            self.assertEqual(storage.max_backup_object(), 16 * 1024 * 1024)
            self.assertEqual(storage.backup_timeout(), 30)
        with patch.dict('os.environ', {'MATH_AI_CONCURRENCY': 'abc', 'MATH_DB_TIMEOUT': 'abc',
                                       'MATH_AI_REVIEW_LIMIT': 'abc', 'MATH_BACKUP_MAX_MB': 'abc',
                                       'MATH_BACKUP_TIMEOUT': 'abc'}, clear=True):
            self.assertEqual(server.ai_concurrency(), 16)
            self.assertEqual(server.db_timeout(), 30.0)
            self.assertEqual(server.ai_review_limit(), 200)
            self.assertEqual(storage.max_backup_object(), 512 * 1024 * 1024)
            self.assertEqual(storage.backup_timeout(), 300)

    def test_public_origins_include_render_url(self):
        """自訂網域與 Render 的 onrender.com 必須同時放行，否則健康檢查會被擋成 403。"""
        with patch.dict('os.environ', {}, clear=True):
            self.assertEqual(server.public_origins_from_env(), [])
        with patch.dict('os.environ', {'RENDER_EXTERNAL_URL': 'https://mathpath-s5hr.onrender.com'}, clear=True):
            self.assertEqual(server.public_origins_from_env(), ['https://mathpath-s5hr.onrender.com'])
        with patch.dict('os.environ', {'MATH_PUBLIC_ORIGIN': 'https://mathshomework.link',
                                       'RENDER_EXTERNAL_URL': 'https://mathpath-s5hr.onrender.com'}, clear=True):
            self.assertEqual(server.public_origins_from_env(),
                             ['https://mathshomework.link', 'https://mathpath-s5hr.onrender.com'])
        # 逗號分隔多個自訂網域，空白的項目要忽略。
        with patch.dict('os.environ', {'MATH_PUBLIC_ORIGIN': 'https://a.example.com, ,https://b.example.com'}, clear=True):
            self.assertEqual(server.public_origins_from_env(),
                             ['https://a.example.com', 'https://b.example.com'])
        # 同一個來源不重複加入。
        with patch.dict('os.environ', {'MATH_PUBLIC_ORIGIN': 'https://mathpath-s5hr.onrender.com',
                                       'RENDER_EXTERNAL_URL': 'https://mathpath-s5hr.onrender.com'}, clear=True):
            self.assertEqual(server.public_origins_from_env(), ['https://mathpath-s5hr.onrender.com'])


class HostAllowlistTests(unittest.TestCase):
    """對外部署的 Host 白名單：自訂網域與平台的 onrender.com 網址必須同時放行。"""

    class App:
        secure_cookie = False

    def build(self, address, origins):
        app = self.App()
        httpd = server.MathServer(address, app, origins)
        self.addCleanup(httpd.server_close)
        return httpd, app

    def test_single_origin_restricts_host_and_secures_cookie(self):
        httpd, app = self.build(('127.0.0.1', 0), ['https://mathshomework.link'])
        self.assertIn('mathshomework.link', httpd.hosts)
        self.assertIn('https://mathshomework.link', httpd.origins)
        self.assertFalse(httpd.wildcard_host)
        self.assertFalse(httpd.wildcard_origin)
        self.assertTrue(app.secure_cookie)

    def test_custom_domain_and_render_url_are_both_allowed(self):
        # 只放行其中一個會讓另一個被擋成 403：自訂網域進不來，或 Render 的健康檢查失敗。
        httpd, app = self.build(('127.0.0.1', 0),
                                ['https://mathshomework.link', 'https://mathpath-s5hr.onrender.com'])
        self.assertIn('mathshomework.link', httpd.hosts)
        self.assertIn('mathpath-s5hr.onrender.com', httpd.hosts)
        self.assertIn('https://mathshomework.link', httpd.origins)
        self.assertIn('https://mathpath-s5hr.onrender.com', httpd.origins)

    def test_no_origin_keeps_wildcard_for_platform_health_checks(self):
        httpd, app = self.build(('0.0.0.0', 0), [])
        self.assertTrue(httpd.wildcard_host)
        self.assertTrue(httpd.wildcard_origin)
        self.assertFalse(app.secure_cookie)

    def test_rejects_non_https_or_pathed_origin(self):
        for bad in ('http://mathshomework.link', 'https://mathshomework.link/path',
                    'https://user:pw@mathshomework.link'):
            with self.assertRaises(ValueError):
                server.MathServer(('127.0.0.1', 0), self.App(), [bad])


class PaperPdfTests(unittest.TestCase):
    """掃描版 PDF 的拆題支援：由伺服器逐頁渲染成圖片，不要叫教師自己轉檔。"""

    @staticmethod
    def decode(url):
        return base64.b64decode(url.split(',', 1)[1])

    def test_scanned_pdf_renders_one_image_per_page(self):
        data = self.decode(scanned_pdf_url(page_count=2))
        # 沒有文字層：預設要報錯（免得默默產生空題目），empty_ok 時才回空字串。
        with self.assertRaises(server.APIError):
            server.pdf_text(data)
        self.assertEqual(server.pdf_text(data, empty_ok=True), '')
        images = server.pdf_page_images(data)
        self.assertEqual(len(images), 2, '兩頁要各渲染成一張圖')
        for image in images:
            self.assertTrue(image.startswith('data:image/png;base64,'))
            png = self.decode(image)
            self.assertTrue(png.startswith(b'\x89PNG\r\n\x1a\n'))
            self.assertGreater(png_size(png)[0], 0)

    def test_text_pdf_is_not_rendered(self):
        # 有文字層的 PDF 直接抽文字就好，不必浪費一次渲染。
        self.assertIn('x=3', server.pdf_text(self.decode(text_pdf_url()), empty_ok=True))

    def test_page_limit_is_enforced(self):
        data = self.decode(scanned_pdf_url(page_count=3))
        with self.assertRaises(server.APIError) as ctx:
            server.pdf_page_images(data, max_pages=2)
        self.assertEqual(ctx.exception.status, 413)

    def test_broken_pdf_fails_clearly_instead_of_500(self):
        # 損壞或非 PDFium 認得的檔案要回 422 並說清楚，不能變成 500。
        with self.assertRaises(server.APIError) as ctx:
            server.pdf_page_images(b'%PDF-1.4\n%%EOF')
        self.assertEqual(ctx.exception.status, 422)
        self.assertIn('逐頁', ctx.exception.message)


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

    def test_rule_verdict_says_unknown_instead_of_wrong(self):
        """無法判定時要說「不知道」，不可以硬判成「答錯」。

        硬判會連帶讓 AI 給對分時被誤標成「建議覆核」（規則說不等價但 AI 給滿分），
        變成教師收到一堆假警報。這是基準測試量出來的問題，見 grade_bench.py。
        """
        ref = {'answer': '$x=2$ 或 $x=3$'}
        self.assertIs(server.rule_verdict(ref, 'x=2或x=3', None), True)
        self.assertIs(server.rule_verdict(ref, 'x=2', None), False)
        # 無法判定：整句文字作答、參考答案是長敘述、沒有參考答案、沒有作答、手寫圖片。
        self.assertIsNone(server.rule_verdict(ref, '先因式分解，得 (x-2)(x-3)=0，所以 x=2 或 x=3', None))
        self.assertIsNone(server.rule_verdict(
            {'answer': '過一個頂點作對邊的平行線，利用內錯角相等，把三個內角拼成平角。'}, 'x=2或x=3', None))
        self.assertIsNone(server.rule_verdict({'answer': ''}, 'x=2或x=3', None))
        self.assertIsNone(server.rule_verdict(ref, '', None))
        self.assertIsNone(server.rule_verdict(ref, 'x=2或x=3', 'data:image/webp;base64,x'))

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

    def test_webp_image_validation(self):
        """WebP 是手寫圖的預設格式（比 PNG 小約三成）；驗證要能接受三種編碼並擋下壞檔。"""

        def riff(*chunks):
            body = b'WEBP' + b''.join(chunks)
            return b'RIFF' + struct.pack('<I', len(body)) + body

        def chunk(fourcc, payload):
            return fourcc + struct.pack('<I', len(payload)) + payload + (b'\x00' if len(payload) % 2 else b'')

        def data_url(raw, mime='image/webp'):
            return 'data:%s;base64,%s' % (mime, base64.b64encode(raw).decode())

        bits = (800 - 1) | ((600 - 1) << 14)
        lossless = riff(chunk(b'VP8L', b'\x2f' + struct.pack('<I', bits)))
        simple = riff(chunk(b'VP8 ', b'\x00\x00\x00\x9d\x01\x2a' + struct.pack('<HH', 640, 480)))
        extended = riff(chunk(b'VP8X', b'\x00' * 4 + (1200 - 1).to_bytes(3, 'little')
                             + (700 - 1).to_bytes(3, 'little')))
        self.assertEqual(server.webp_size(lossless), (800, 600))
        self.assertEqual(server.webp_size(simple), (640, 480))
        self.assertEqual(server.webp_size(extended), (1200, 700))
        for raw in (lossless, simple, extended):
            data, mime = server.validate_image(data_url(raw))
            self.assertEqual(mime, 'image/webp')
            self.assertEqual(data, raw)
        # 壞檔一律拒絕：RIFF 長度不符、截斷、把 PNG 標成 WebP、超過像素上限。
        broken = bytearray(extended)
        broken[4:8] = struct.pack('<I', 999_999)
        huge = riff(chunk(b'VP8X', b'\x00' * 4 + (20000 - 1).to_bytes(3, 'little')
                          + (20000 - 1).to_bytes(3, 'little')))
        for raw in (bytes(broken), extended[:24], b'', huge):
            with self.subTest(raw=raw[:16]):
                with self.assertRaises(server.APIError):
                    server.validate_image(data_url(raw))
        with self.assertRaises(server.APIError):
            server.validate_image(data_url(lossless, 'image/png'))
        # 題目圖形也接受 WebP。
        data, mime = server.decode_figure(data_url(extended))
        self.assertEqual((len(data), mime), (len(extended), 'image/webp'))

    def test_ai_annotation_placements_only_from_teacher_adjustments(self):
        """AI 回應不接受 placements（免得模型亂塞欄位）；教師儲存調整時才接受，座標一律 0 至 1。"""
        marks = {'issues': [{'x': 0.2, 'y': 0.3, 'label': '符號錯誤', 'comment': '這裡應為負號'}],
                 'summary': '主要在符號處理'}
        with self.assertRaises(server.APIError):
            server.ai_annotation_valid({**marks, 'placements': {'issue:0': {'x': 0.5, 'y': 0.5}}})
        result = server.ai_annotation_valid(
            {**marks, 'placements': {'stamp': {'x': 0.9, 'y': 0.1}, 'summary': {'x': 0.5, 'y': 0.9},
                                     'issue:0': {'x': 0.42, 'y': 0.31}}},
            allow_placements=True)
        self.assertEqual(result['placements']['issue:0'], {'x': 0.42, 'y': 0.31})
        self.assertEqual(result['placements']['stamp'], {'x': 0.9, 'y': 0.1})
        # 只改文字、沒有搬動任何東西時，不必帶 placements。
        self.assertNotIn('placements', server.ai_annotation_valid(marks, allow_placements=True))
        # 位置鍵與座標都要嚴格檢查，壞資料一律拒絕寫入。
        for bad in ({'note': {'x': 0.5, 'y': 0.5}}, {'issue:99': {'x': 0.5, 'y': 0.5}},
                    {'issue:x': {'x': 0.5, 'y': 0.5}}, {'issue:-1': {'x': 0.5, 'y': 0.5}},
                    {'issue:0': {'x': 1.2, 'y': 0.5}}, {'issue:0': {'x': 0.5}},
                    {'issue:0': {'x': 0.5, 'y': 0.5, 'z': 1}}, {'issue:0': {'x': True, 'y': 0.5}},
                    {'issue:0': 'x'}, 'x'):
            with self.subTest(bad=bad):
                with self.assertRaises(server.APIError):
                    server.ai_annotation_valid({**marks, 'placements': bad}, allow_placements=True)

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


class DataAdminTests(unittest.TestCase):
    """資料管理：用量統計、資料庫備份、題庫／學生作業歸檔、VACUUM 與學年重置。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='mathpath-admin-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.env = patch.dict('os.environ', {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.app = server.Application(self.root / 'data', static_dir=self.root)
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

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=3)

    def request(self, method, path, body=None, cookie=None, expect=None, raw=None,
                ctype='application/json'):
        conn = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=60)
        headers = {'Origin': self.origin}
        if cookie:
            headers['Cookie'] = cookie
        if raw is not None:
            data, headers['Content-Type'] = raw, ctype
        else:
            data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
            headers['Content-Type'] = 'application/json'
        try:
            conn.request(method, path, data, headers)
            response = conn.getresponse()
            payload = response.read()
            content_type = response.getheader('Content-Type', '')
            result = json.loads(payload) if content_type.startswith('application/json') else payload
            status, head = response.status, dict(response.getheaders())
        finally:
            conn.close()
        if expect is not None:
            self.assertEqual(status, expect, result)
        return status, result, head

    def login(self, username, password):
        _, body, headers = self.request('POST', '/api/login',
                                        {'username': username, 'password': password}, expect=200)
        return headers['Set-Cookie'].split(';', 1)[0]

    def scenario(self):
        """建立班級、作業與一筆帶手寫圖的作答，回傳 (classId, assignmentId, studentIds)。"""
        created = self.request('POST', '/api/users/bulk', {'students': [
            {'username': 'y7a01', 'password': 'ArchivePass12', 'seat': '1'},
            {'username': 'y7a02', 'password': 'ArchivePass12', 'seat': '2'}]},
            cookie=self.teacher, expect=200)[1]
        ids = [u['id'] for u in created['users']]
        cid = self.request('POST', '/api/classes', {'name': '七甲', 'studentIds': ids},
                           cookie=self.teacher, expect=200)[1]['class']['id']
        aid = self.request('POST', '/api/assignments', {
            'title': '歸檔測試作業', 'classId': cid, 'questionIds': [1, 2],
            'dueAt': '2099-01-01T00:00:00Z', 'aiGrading': False},
            cookie=self.teacher, expect=200)[1]['assignment']['id']
        cookie = self.login('y7a01', 'ArchivePass12')
        self.request('POST', '/api/attempts',
                     {'questionId': 1, 'answerText': 'x=2或3', 'assignmentId': aid,
                      'image': png_url()}, cookie=cookie, expect=200)
        return cid, aid, ids

    def test_admin_endpoints_require_teacher(self):
        cases = [('GET', '/api/admin/storage', None),
                 ('POST', '/api/admin/vacuum', {}),
                 ('POST', '/api/admin/backup/upload', {}),
                 ('POST', '/api/admin/reset/students', {'confirm': 'RESET'}),
                 ('GET', '/api/admin/backup/db', None),
                 ('GET', '/api/admin/archive/questions', None),
                 ('GET', '/api/admin/archive/students', None),
                 ('POST', '/api/users/1/update', {'name': 'x'}),
                 ('POST', '/api/admin/restore/db', None),
                 ('POST', '/api/admin/restore/questions', None),
                 ('POST', '/api/admin/restore/students', None)]
        for method, path, body in cases:
            with self.subTest(path=path, role='student'):
                self.request(method, path, body, cookie=self.student, expect=403)
            with self.subTest(path=path, role='anonymous'):
                self.request(method, path, body, cookie=None, expect=401)
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM users').fetchone()[0], 2)

    def fake_netdisk(self):
        """把物件儲存換成記憶體版本，讓備份測試不必真的連 R2。"""
        uploaded, deleted = {}, []
        self.addCleanup(setattr, self.app.storage, 'mode', 'db')
        self.app.storage.mode = 'r2'
        self.app.storage.bucket = 'mathpath-test'

        def put(folder, name, data, mime):
            key = f'{folder}/{name}'
            uploaded[key] = {'bytes': len(data), 'mime': mime, 'data': data}
            return key

        self.app.storage.put_object = put
        self.app.storage.delete = lambda key: (deleted.append(key), True)[1]
        return uploaded, deleted

    def test_backup_to_netdisk_needs_storage_configured(self):
        """沒設定網盤時要明確拒絕，不能假裝備份成功。"""
        _, result, _ = self.request('POST', '/api/admin/backup/upload', {}, cookie=self.teacher, expect=409)
        self.assertIn('網盤', result['error'])
        _, stats, _ = self.request('GET', '/api/admin/storage', cookie=self.teacher, expect=200)
        self.assertFalse(stats['backup']['configured'])
        self.assertEqual(stats['backup']['count'], 0)

    def test_backup_to_netdisk_uploads_db_and_question_bank(self):
        """資料庫快照與題庫歸檔都要上網盤；題庫歸檔要能直接餵回題庫匯入。"""
        self.scenario()                      # 先建立情境（手寫圖先走原本的資料庫後端）
        uploaded, _ = self.fake_netdisk()
        _, result, _ = self.request('POST', '/api/admin/backup/upload', {}, cookie=self.teacher, expect=200)
        files = {f['kind']: f for f in result['entry']['files']}
        self.assertEqual(set(files), {'db', 'questions'}, '備份要有資料庫快照與題庫歸檔')
        self.assertTrue(files['db']['name'].endswith('.sqlite3'))
        self.assertTrue(files['questions']['name'].endswith('.json'))
        self.assertEqual(uploaded[files['db']['key']]['mime'], 'application/vnd.sqlite3')
        self.assertEqual(uploaded[files['questions']['key']]['mime'], 'application/json')
        archive = json.loads(uploaded[files['questions']['key']]['data'])
        self.assertEqual(archive['format'], 'mathpath-question-archive')
        self.assertGreaterEqual(archive['count'], 1)
        self.assertEqual(len(archive['sourceIds']), len(archive['questions']))
        # 快照要是一份可用的 SQLite 檔（檔頭正確、能開）
        snapshot = uploaded[files['db']['key']]['data']
        self.assertTrue(snapshot.startswith(b'SQLite format 3'))
        # 狀態與紀錄
        status = result['status']
        self.assertTrue(status['configured'])
        self.assertEqual(status['count'], 1)
        self.assertEqual(status['lastTrigger'], 'manual')
        self.assertTrue(status['lastAt'])
        self.assertEqual([f for f in status['lastFiles']], [files['db']['name'], files['questions']['name']])

    def test_backup_keeps_recent_runs_and_never_deletes_live_files(self):
        """保留策略：超過上限就刪最舊的；檔名不得重用，否則會刪掉最新那份仍在引用的物件。"""
        uploaded, deleted = self.fake_netdisk()
        with patch.dict('os.environ', {'MATH_BACKUP_KEEP': '2'}):
            for _ in range(4):
                self.request('POST', '/api/admin/backup/upload', {}, cookie=self.teacher, expect=200)
        with self.app.db() as db:
            history = self.app.dataadmin.backup_history(db)
        self.assertEqual(len(history), 2, '只保留最近 2 份')
        self.assertEqual(len({x['stamp'] for x in history}), 2, '每次備份的檔名不可重複')
        live = {f['key'] for x in history for f in x['files']}
        self.assertEqual([k for k in deleted if k in live], [], '不可刪到仍在引用的物件')
        self.assertEqual(len(deleted), 4, '被擠掉的 2 份 × 每份 2 個檔案')
        self.assertEqual(len(uploaded), 8)

    def test_backup_scheduler_gate_and_due(self):
        """自動備份：預設關閉；設定間隔且已接網盤才會啟動，且只在上次備份逾期時才跑。"""
        self.fake_netdisk()
        with patch.dict('os.environ', {}, clear=True):
            self.assertEqual(self.app.backup_interval_hours(), 0.0)
            self.assertFalse(self.app.backup_due(), '沒設間隔就不該備份')
            self.assertFalse(self.app.start_backup_scheduler(), '沒設間隔不啟動排程')
            self.assertIsNone(self.app.backup_thread)
        with patch.dict('os.environ', {'MATH_BACKUP_HOURS': '6'}):
            self.assertEqual(self.app.backup_interval_hours(), 6.0)
            self.assertTrue(self.app.backup_due(), '從來沒備份過就要補一次')
            self.assertTrue(self.app.start_backup_scheduler())
            self.assertTrue(self.app.backup_thread.is_alive())
            self.assertFalse(self.app.start_backup_scheduler(), '不重複啟動')
            self.app.stop_backup_scheduler()
            self.assertIsNone(self.app.backup_thread)
            # 備份過之後不該再備；把時間推回過去就該再備
            self.app.stopping = False
            self.request('POST', '/api/admin/backup/upload', {}, cookie=self.teacher, expect=200)
            self.assertFalse(self.app.backup_due(), '剛備份過不該再備')
            with self.app.db() as db:
                history = self.app.dataadmin.backup_history(db)
                history[0]['at'] = '2020-01-01T00:00:00Z'
                db.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('backup_history',?)",
                           (json.dumps(history, ensure_ascii=False),))
            self.assertTrue(self.app.backup_due(), '逾期就要補備份')

    def test_storage_stats_and_vacuum(self):
        self.scenario()
        _, stats, _ = self.request('GET', '/api/admin/storage', cookie=self.teacher, expect=200)
        self.assertEqual(stats['counts']['questions'], 16)
        self.assertEqual(stats['counts']['attempts'], 1)
        self.assertEqual(stats['counts']['users'], 4)
        self.assertEqual(stats['images']['handwriting'], 1)
        self.assertGreater(stats['images']['inDatabaseBytes'], 0)
        self.assertEqual(stats['images']['storageMode'], 'db')
        self.assertIsNone(stats['lastStudentReset'])
        self.assertTrue(stats['questionBankKeptAcrossYears'])
        self.assertGreater(stats['database']['bytes'], 0)
        _, vacuum, _ = self.request('POST', '/api/admin/vacuum', {}, cookie=self.teacher, expect=200)
        self.assertGreaterEqual(vacuum['beforeBytes'], vacuum['afterBytes'])
        self.assertGreaterEqual(vacuum['savedBytes'], 0)
        self.assertTrue(vacuum['at'])

    def test_question_archive_is_importable(self):
        _, payload, headers = self.request('GET', '/api/admin/archive/questions',
                                           cookie=self.teacher, expect=200)
        self.assertIn('attachment', headers['Content-Disposition'])
        # 題庫歸檔是 application/json，測試輔助會直接解析成 dict。
        doc = payload if isinstance(payload, dict) else json.loads(payload)
        self.assertEqual(doc['format'], 'mathpath-question-archive')
        self.assertEqual(doc['count'], 16)
        self.assertEqual(len(doc['questions']), 16)
        # 題庫歸檔不含學生資料，且題目形狀與題庫匯入完全相容（可直接餵回去）。
        self.assertNotIn('students', doc)
        item = doc['questions'][0]
        self.request('POST', '/api/questions/import', {'questions': [item]},
                     cookie=self.teacher, expect=200)
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM questions').fetchone()[0], 17)

    def test_student_archive_jsonl_images_toggle_and_no_password(self):
        self.scenario()
        _, payload, _ = self.request('GET', '/api/admin/archive/students',
                                     cookie=self.teacher, expect=200)
        rows = [json.loads(line) for line in payload.decode().strip().split('\n')]
        head, items = rows[0], rows[1:]
        self.assertEqual(head['format'], 'mathpath-student-archive')
        self.assertEqual(head['counts']['attempts'], 1)
        kinds = Counter(row['type'] for row in items)
        self.assertEqual(kinds['student'], 4)
        self.assertEqual(kinds['class'], 1)
        self.assertEqual(kinds['attempt'], 1)
        self.assertEqual(kinds['assignmentRecipient'], 2)
        # 學生帳號的密碼雜湊絕不外流。
        self.assertFalse(any('password' in row for row in items))
        student = next(row for row in items if row['type'] == 'student' and row['username'] == 'y7a01')
        self.assertEqual(student['seat'], '1')
        attempt = next(row for row in items if row['type'] == 'attempt')
        self.assertEqual(attempt['answer_text'], 'x=2或3')
        self.assertTrue(attempt['image'].startswith('data:image/'))
        # images=0 只匯出文字，檔案明顯較小且不含圖。
        _, text_only, _ = self.request('GET', '/api/admin/archive/students?images=0',
                                       cookie=self.teacher, expect=200)
        rows2 = [json.loads(line) for line in text_only.decode().strip().split('\n')]
        self.assertFalse(any('image' in row for row in rows2[1:]))
        self.assertLess(len(text_only), len(payload))

    def test_database_backup_is_valid_snapshot(self):
        self.scenario()
        before = set(Path(tempfile.gettempdir()).glob('mathpath-backup-*'))
        _, payload, headers = self.request('GET', '/api/admin/backup/db',
                                           cookie=self.teacher, expect=200)
        self.assertIn('.sqlite3', headers['Content-Disposition'])
        self.assertEqual(int(headers['Content-Length']), len(payload))
        self.assertTrue(payload.startswith(b'SQLite format 3\x00'))
        snapshot = self.root / 'snapshot.sqlite3'
        snapshot.write_bytes(payload)
        db = sqlite3.connect(snapshot)
        try:
            self.assertEqual(db.execute('SELECT count(*) FROM questions').fetchone()[0], 16)
            self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT count(*) FROM users').fetchone()[0], 4)
        finally:
            db.close()
        # 匯出後暫存檔必須清乾淨，不在伺服器留檔。
        # 伺服器是在回應送出後才刪除暫存目錄，因此這裡輪詢等待而非立即斷言。
        for _ in range(50):
            if set(Path(tempfile.gettempdir()).glob('mathpath-backup-*')) == before:
                break
            time.sleep(0.1)
        self.assertEqual(set(Path(tempfile.gettempdir()).glob('mathpath-backup-*')), before)

    def archives(self):
        """匯出三份檔案（題庫歸檔、學生歸檔、資料庫備份）供還原測試使用。"""
        _, questions, _ = self.request('GET', '/api/admin/archive/questions',
                                       cookie=self.teacher, expect=200)
        if isinstance(questions, dict):
            questions = json.dumps(questions, ensure_ascii=False).encode()
        _, students, _ = self.request('GET', '/api/admin/archive/students',
                                      cookie=self.teacher, expect=200)
        _, backup, _ = self.request('GET', '/api/admin/backup/db', cookie=self.teacher, expect=200)
        return questions, students, backup

    def test_update_student_fields_and_password_reset(self):
        _, created, _ = self.request('POST', '/api/users/bulk', {'students': [
            {'username': 'u1a01', 'password': 'UpdatePass123', 'seat': '1'},
            {'username': 'u1a02', 'password': 'UpdatePass123', 'seat': '2'}]},
            cookie=self.teacher, expect=200)
        uid = created['users'][0]['id']
        path = f'/api/users/{uid}/update'
        _, out, _ = self.request('POST', path, {'name': '陳大文', 'seat': '9'},
                                 cookie=self.teacher, expect=200)
        self.assertEqual(out['user'], {'id': uid, 'username': 'u1a01', 'name': '陳大文',
                                       'role': 'student', 'seat': '9'})
        self.assertEqual(out['changed'], ['姓名', '班內號'])
        # 改學號；被別人用掉要 409
        _, out, _ = self.request('POST', path, {'username': 'u1a01x'}, cookie=self.teacher, expect=200)
        self.assertEqual(out['user']['username'], 'u1a01x')
        self.request('POST', path, {'username': 'u1a02'}, cookie=self.teacher, expect=409)
        # 重設密碼會撤銷該生所有登入工作階段
        self.login('u1a01x', 'UpdatePass123')
        _, out, _ = self.request('POST', path, {'password': 'BrandNewPass99'},
                                 cookie=self.teacher, expect=200)
        self.assertTrue(out['passwordReset'])
        self.assertEqual(out['sessionsRevoked'], 1)
        self.request('POST', '/api/login', {'username': 'u1a01x', 'password': 'UpdatePass123'}, expect=401)
        self.login('u1a01x', 'BrandNewPass99')
        # 姓名清空會回到學號；班內號可以清空
        _, out, _ = self.request('POST', path, {'name': '   ', 'seat': ''},
                                 cookie=self.teacher, expect=200)
        self.assertEqual(out['user']['name'], 'u1a01x')
        self.assertIsNone(out['user']['seat'])
        # 各種無效輸入
        self.request('POST', path, {}, cookie=self.teacher, expect=400)
        self.request('POST', path, {'role': 'teacher'}, cookie=self.teacher, expect=400)
        self.request('POST', path, {'username': 'ab'}, cookie=self.teacher, expect=400)
        self.request('POST', path, {'password': 'short'}, cookie=self.teacher, expect=400)
        # 教師帳號現在也能編輯（見 test_teacher_accounts_can_be_created_and_edited），
        # 但學生專屬的班內號欄位會被拒絕。
        self.request('POST', f'/api/users/{self.teacher_id()}/update', {'seat': '1'},
                     cookie=self.teacher, expect=400)
        self.request('POST', '/api/users/999999/update', {'name': 'x'}, cookie=self.teacher, expect=404)
        self.request('POST', '/api/users/0/update', {'name': 'x'}, cookie=self.teacher, expect=404)

    def test_teacher_accounts_can_be_created_and_edited(self):
        """教師可在「設定與隱私 → 帳號管理」新增其他教師，並編輯帳號、姓名與重設密碼。

        這解決了「忘了教師密碼就只能開 Render Shell 重設」的問題：只要還有另一位
        教師能登入，就能幫忙重設。
        """
        body = {'username': 'coteacher', 'name': '李老師', 'password': 'CoTeacherPass1'}
        _, out, _ = self.request('POST', '/api/teachers', body, cookie=self.teacher, expect=200)
        made = out['user']
        self.assertEqual(made['role'], 'teacher')
        self.assertIsNone(made['seat'], '教師不屬於任何班級，不該有班內號')
        # 新教師真的能登入，而且拿到教師權限。
        cookie = self.login('coteacher', 'CoTeacherPass1')
        _, state, _ = self.request('GET', '/api/state', cookie=cookie, expect=200)
        self.assertEqual(state['user']['role'], 'teacher')
        self.request('GET', '/api/users', cookie=cookie, expect=200)
        # 帳號名稱撞號 409；缺姓名、帶班內號、未知角色一律 400。
        self.request('POST', '/api/teachers', dict(body, name='重複'), cookie=self.teacher, expect=409)
        self.request('POST', '/api/teachers', {'username': 'noname', 'password': 'CoTeacherPass1'},
                     cookie=self.teacher, expect=400)
        self.request('POST', '/api/teachers', {'username': 'blank', 'name': '   ',
                                              'password': 'CoTeacherPass1'}, cookie=self.teacher, expect=400)
        self.request('POST', '/api/teachers', dict(body, username='seated', seat='3'),
                     cookie=self.teacher, expect=400)
        self.request('POST', '/api/teachers', dict(body, username='admin1', role='admin'),
                     cookie=self.teacher, expect=400)
        self.request('POST', '/api/teachers', dict(body, username='admin2', role='Teacher'),
                     cookie=self.teacher, expect=400)
        # 編輯教師：改姓名與帳號
        path = f"/api/users/{made['id']}/update"
        _, out, _ = self.request('POST', path, {'name': '李大明', 'username': 'coteacher2'},
                                 cookie=self.teacher, expect=200)
        self.assertEqual(out['user']['name'], '李大明')
        self.assertEqual(out['user']['username'], 'coteacher2')
        self.assertEqual(out['changed'], ['帳號', '姓名'])
        # 教師沒有班內號，也不允許把姓名清空
        self.request('POST', path, {'seat': '1'}, cookie=self.teacher, expect=400)
        self.request('POST', path, {'name': '   '}, cookie=self.teacher, expect=400)
        self.request('POST', path, {}, cookie=self.teacher, expect=400)
        # 重設教師密碼會撤銷他目前的登入
        self.login('coteacher2', 'CoTeacherPass1')
        _, out, _ = self.request('POST', path, {'password': 'CoTeacherPass2'},
                                 cookie=self.teacher, expect=200)
        self.assertTrue(out['passwordReset'])
        self.assertEqual(out['sessionsRevoked'], 2, '這位教師先後登入兩次，兩個工作階段都要撤銷')
        self.request('POST', '/api/login',
                     {'username': 'coteacher2', 'password': 'CoTeacherPass1'}, expect=401)
        self.login('coteacher2', 'CoTeacherPass2')
        # 學生既不能新增也不能編輯教師帳號
        self.request('POST', '/api/teachers',
                     {'username': 'sneaky', 'name': '偷加', 'password': 'SneakyPass123'},
                     cookie=self.student, expect=403)
        self.request('POST', path, {'name': '偷改'}, cookie=self.student, expect=403)
        # 學年重置只清學生，教師帳號要留下來（否則重置後沒人能登入）。
        with self.app.db() as db:
            self.app.dataadmin.reset_students(db, 'RESET')
            kept = db.execute("SELECT count(*) FROM users WHERE role='teacher'").fetchone()[0]
        self.assertEqual(kept, 2)

    def test_teacher_account_permissions_and_deletion(self):
        """管理員（最早建立的教師）可管所有帳號；一般教師只能改自己與自己建立的學生。

        刪除帳號只有管理員能做，且要輸入確認字串。
        """
        _, out, _ = self.request('POST', '/api/teachers',
                                 {'username': 'coteacher', 'name': '李老師', 'password': 'CoTeacherPass1'},
                                 cookie=self.teacher, expect=200)
        mate = out['user']
        mate_cookie = self.login('coteacher', 'CoTeacherPass1')
        # 一般教師不能新增教師——不能自己擴權。
        self.request('POST', '/api/teachers',
                     {'username': 'sneaky', 'name': '偷加', 'password': 'SneakyPass123'},
                     cookie=mate_cookie, expect=403)
        # 一般教師不能碰資料管理（備份、歸檔、還原、壓實、學年重置）。
        self.request('GET', '/api/admin/storage', cookie=mate_cookie, expect=403)
        self.request('GET', '/api/admin/backup/db', cookie=mate_cookie, expect=403)
        for path, body in (('/api/admin/vacuum', {}), ('/api/admin/backup/upload', {}),
                           ('/api/admin/reset/students', {'confirm': 'RESET'})):
            self.request('POST', path, body, cookie=mate_cookie, expect=403)
        # 自己建立的學生可以改。
        _, out, _ = self.request('POST', '/api/users',
                                 {'username': 'm1a01', 'name': '他的學生', 'password': 'MateStudent12'},
                                 cookie=mate_cookie, expect=200)
        own_student = out['user']
        self.assertEqual(own_student['createdBy'], mate['id'], '要記錄建立者')
        self.request('POST', f"/api/users/{own_student['id']}/update", {'seat': '5'},
                     cookie=mate_cookie, expect=200)
        # 管理員建立的學生不能改（created_by 不是他）。
        _, out, _ = self.request('POST', '/api/users',
                                 {'username': 'a1b2c3', 'name': '管理員的學生', 'password': 'OwnerStudent12'},
                                 cookie=self.teacher, expect=200)
        boss_student = out['user']
        self.request('POST', f"/api/users/{boss_student['id']}/update", {'seat': '9'},
                     cookie=mate_cookie, expect=403)
        # 不能改別的教師，也不能改管理員；自己的帳號可以改。
        self.request('POST', f"/api/users/{self.teacher_id()}/update", {'name': '偷改'},
                     cookie=mate_cookie, expect=403)
        self.request('POST', f"/api/users/{mate['id']}/update", {'name': '李大明'},
                     cookie=mate_cookie, expect=200)
        # 一般教師不能刪除任何帳號。
        self.request('POST', f"/api/users/{boss_student['id']}/delete", {'confirm': 'DELETE'},
                     cookie=mate_cookie, expect=403)
        # 管理員刪除要輸入確認字串，且不能刪自己。
        self.request('POST', f"/api/users/{boss_student['id']}/delete", {'confirm': 'nope'},
                     cookie=self.teacher, expect=400)
        self.request('POST', f"/api/users/{self.teacher_id()}/delete", {'confirm': 'DELETE'},
                     cookie=self.teacher, expect=400)
        _, out, _ = self.request('POST', f"/api/users/{boss_student['id']}/delete",
                                 {'confirm': 'DELETE'}, cookie=self.teacher, expect=200)
        self.assertEqual(out['deleted']['username'], 'a1b2c3')
        self.assertEqual(out['removed']['users'], 1)
        self.request('POST', f"/api/users/{boss_student['id']}/update", {'name': 'x'},
                     cookie=self.teacher, expect=404)
        # 刪除學生會連同他的作答一起刪掉。
        _, _, ids = self.scenario()
        with self.app.db() as db:
            before = db.execute('SELECT count(*) FROM attempts WHERE user_id=?',
                                (ids[0],)).fetchone()[0]
        self.assertGreater(before, 0, '情境資料應該有一筆作答')
        _, out, _ = self.request('POST', f'/api/users/{ids[0]}/delete', {'confirm': 'DELETE'},
                                 cookie=self.teacher, expect=200)
        self.assertEqual(out['removed']['attempts'], before)
        with self.app.db() as db:
            left = db.execute('SELECT count(*) FROM attempts WHERE user_id=?', (ids[0],)).fetchone()[0]
        self.assertEqual(left, 0)
        # 刪除教師：他的班級與作業轉給管理員，他建立的學生改為無歸屬（不會被連帶刪除）。
        _, out, _ = self.request('POST', '/api/teachers',
                                 {'username': 'leaving', 'name': '離職老師', 'password': 'LeavingPass12'},
                                 cookie=self.teacher, expect=200)
        leaver = out['user']
        leaver_cookie = self.login('leaving', 'LeavingPass12')
        _, out, _ = self.request('POST', '/api/users',
                                 {'username': 'l1a01', 'name': '他的學生', 'password': 'LeaverStudent1'},
                                 cookie=leaver_cookie, expect=200)
        leaver_student = out['user']
        _, room, _ = self.request('POST', '/api/classes',
                                  {'name': '離職班', 'studentIds': [leaver_student['id']]},
                                  cookie=leaver_cookie, expect=200)
        _, out, _ = self.request('POST', f"/api/users/{leaver['id']}/delete", {'confirm': 'DELETE'},
                                 cookie=self.teacher, expect=200)
        self.assertEqual(out['deleted']['role'], 'teacher')
        with self.app.db() as db:
            row = db.execute('SELECT teacher_id FROM classes WHERE id=?',
                             (room['class']['id'],)).fetchone()
            self.assertEqual(row['teacher_id'], self.teacher_id(), '班級要轉給管理員')
            kept = db.execute('SELECT created_by FROM users WHERE id=?',
                              (leaver_student['id'],)).fetchone()
            self.assertIsNone(kept['created_by'], '教師刪除後他的學生改為無歸屬，但帳號要保留')

    def test_leaderboard_by_grade_and_month(self):
        """每月每級前 10：得分榜（該月／開學至今／累積）與進步榜（本月 ÷ 上月）。"""
        students = {}
        for uname, name, grade in (('l3a', '中三甲', '中三'), ('l3b', '中三乙', '中三'), ('l2a', '中二甲', '中二')):
            _, out, _ = self.request('POST', '/api/users',
                                     {'username': uname, 'name': name, 'password': 'LeaderPass12', 'grade': grade},
                                     cookie=self.teacher, expect=200)
            students[uname] = out['user']
            self.assertEqual(out['user']['grade'], grade, '年級要寫入')
        # 年級不合法要 400
        self.request('POST', '/api/users',
                     {'username': 'lbad', 'name': '壞年級', 'password': 'LeaderPass12', 'grade': '中七'},
                     cookie=self.teacher, expect=400)
        with self.app.db() as db:
            qid = db.execute('SELECT id FROM questions LIMIT 1').fetchone()['id']

            def add(uid, score, day):
                db.execute("INSERT INTO attempts(user_id,question_id,answer_text,max_score,status,feedback,"
                           "submitted_at,method,score) VALUES(?,?,?,?,?,?,?,?,?)",
                           (uid, qid, 'x', 10, 'graded', '', day + 'T10:00:00Z', 'rule', score))

            # 本月（2026-10）：中三甲 30 分、中三乙 12 分、中二甲 50 分
            add(students['l3a']['id'], 30, '2026-10-05')
            add(students['l3b']['id'], 12, '2026-10-06')
            add(students['l2a']['id'], 50, '2026-10-07')
            # 上月（2026-09）：中三甲 10 分、中三乙 12 分 → 進步比例 3.0 vs 1.0
            add(students['l3a']['id'], 10, '2026-09-10')
            add(students['l3b']['id'], 12, '2026-09-11')
            # 上學年（2026-03）：只計入累積，不計入開學至今
            add(students['l3a']['id'], 7, '2026-03-01')

        _, board, _ = self.request('GET', '/api/leaderboard/2026-10', cookie=self.teacher, expect=200)
        self.assertEqual(board['month'], '2026-10')
        self.assertEqual(board['prevMonth'], '2026-09')
        self.assertEqual(board['termStart'], '2026-09-01', '學年從 9/1 起算')

        # 得分榜：中三按本月得分排，中三甲 30 > 中三乙 12
        s3 = board['score']['中三']
        self.assertEqual([x['name'] for x in s3], ['中三甲', '中三乙'])
        self.assertEqual(s3[0]['rank'], 1)
        self.assertEqual(s3[0]['monthScore'], 30)
        self.assertEqual(s3[0]['termScore'], 40, '開學至今＝9 月 10 + 10 月 30')
        self.assertEqual(s3[0]['totalScore'], 47, '累積含上學年的 7 分')
        self.assertEqual(board['score']['中二'][0]['name'], '中二甲', '不同年級分開排')

        # 進步榜：中三甲 30/10 = 3.0，中三乙 12/12 = 1.0
        p3 = board['progress']['中三']
        self.assertEqual(p3[0]['name'], '中三甲')
        self.assertEqual(p3[0]['ratio'], 3.0)
        self.assertEqual(p3[1]['ratio'], 1.0)
        self.assertNotIn('中二', board['progress'], '中二甲上月沒有分數，不列入進步榜')

        # 月份格式錯誤要 400
        self.request('GET', '/api/leaderboard/2026-13', cookie=self.teacher, expect=400)
        self.request('GET', '/api/leaderboard/abc', cookie=self.teacher, expect=404)  # 路徑不匹配 → 404

    def test_paper_grade_scores_by_average_per_question(self):
        """紙本批改：逐頁辨識 → 每題平均 → 100 分制；看不清的不算分母。"""
        _, out, _ = self.request('POST', '/api/users',
                                 {'username': 'pg1', 'name': '紙本學生', 'password': 'PaperPass12',
                                  'grade': '中三'}, cookie=self.teacher, expect=200)
        sid = out['user']['id']

        class StubAI:
            mode = 'external'; vision = 'vision-model'; draw = None; configured = True
            def __init__(self, replies): self.replies = list(replies); self.calls = []
            def consent(self, value): return True
            def call(self, instruction, payload, **kw):
                self.calls.append((instruction, payload))
                return self.replies.pop(0)

        original = self.app.ai
        stub = StubAI([
            {'questions': [
                {'number': '1', 'question': '1+1', 'studentAnswer': '2', 'correct': True, 'reason': ''},
                {'number': '2', 'question': '2+2', 'studentAnswer': '5', 'correct': False, 'reason': '應為 4'}]},
            {'questions': [
                {'number': '3', 'question': '3+3', 'studentAnswer': '6', 'correct': True, 'reason': ''},
                {'number': '4', 'question': '4+4', 'studentAnswer': '?', 'correct': None, 'reason': '無法辨認'}]},
        ])
        self.app.ai = stub
        try:
            _, out, _ = self.request('POST', '/api/paper-grades', {
                'studentId': sid, 'title': '第一次功課',
                'pages': [png_url(), png_url()], 'consentExternal': True},
                cookie=self.teacher, expect=200)
        finally:
            self.app.ai = original
        g = out['grade']
        self.assertEqual(len(stub.calls), 2, '每頁一次 AI 呼叫')
        self.assertEqual(g['totalQuestions'], 3, '看不清的不計入分母')
        self.assertEqual(g['correctCount'], 2)
        self.assertEqual(g['unreadable'], 1)
        self.assertAlmostEqual(g['score'], 66.7, places=1)
        self.assertEqual(g['studentName'], '紙本學生')
        _, listing, _ = self.request('GET', '/api/paper-grades', cookie=self.teacher, expect=200)
        self.assertEqual(listing['grades'][0]['title'], '第一次功課')
        self.assertEqual(len(listing['grades'][0]['questions']), 4)
        self.request('POST', '/api/paper-grades',
                     {'studentId': sid, 'title': 'x', 'pages': [png_url()] * 11},
                     cookie=self.teacher, expect=400)
        self.request('POST', '/api/paper-grades',
                     {'studentId': sid, 'title': 'x', 'pages': [png_url()]},
                     cookie=self.student, expect=403)

    def test_paper_grade_uses_marked_points_and_teacher_judgement(self):
        """有標示分數就按分值；沒標示用平均；AI 看不清的等教師補判後重算。"""
        _, out, _ = self.request('POST', '/api/users',
                                 {'username': 'pg2', 'name': '分值學生', 'password': 'PaperPass12'},
                                 cookie=self.teacher, expect=200)
        sid = out['user']['id']

        class StubAI:
            mode = 'external'; vision = 'vision-model'; draw = None; configured = True
            def __init__(self, replies): self.replies = list(replies)
            def consent(self, value): return True
            def call(self, instruction, payload, **kw): return self.replies.pop(0)

        original = self.app.ai
        self.app.ai = StubAI([{'questions': [
            # 10 分、答對
            {'number': '1', 'question': 'A', 'studentAnswer': 'x', 'correct': True, 'reason': '',
             'points': 10, 'box': {'x': 0.1, 'y': 0.1, 'w': 0.5, 'h': 0.2}},
            # 20 分、答錯
            {'number': '2', 'question': 'B', 'studentAnswer': 'y', 'correct': False, 'reason': '錯',
             'points': 20, 'box': {'x': 0.1, 'y': 0.4, 'w': 0.5, 'h': 0.2}},
            # 沒標分數、看不清 → 等教師
            {'number': '3', 'question': 'C', 'studentAnswer': '?', 'correct': None, 'reason': '無法辨認',
             'points': None, 'box': None}]}])
        try:
            _, out, _ = self.request('POST', '/api/paper-grades', {
                'studentId': sid, 'title': '分值功課',
                'pages': [png_url()], 'consentExternal': True},
                cookie=self.teacher, expect=200)
        finally:
            self.app.ai = original
        g = out['grade']
        # 3 題：10、20、沒標示（先給 33.3）→ 總和 63.3 → 縮放到 100
        # 可判斷的是前兩題（15.8 + 31.6 = 47.4），答對第一題（15.8）→ 33.3 分
        self.assertAlmostEqual(g['score'], 33.3, places=1)
        self.assertEqual(g['pending'], 1, '看不清的那題要標成待教師判定')
        self.assertEqual(g['questions'][2]['points'], None)
        self.assertIsNotNone(g['questions'][0]['box'], '要回報題目位置，才能在照片上標批閱')

        # 教師補判第 3 題為「對」→ 重算：可判斷三題全算，答對兩題（15.8 + 52.6 = 68.4）
        _, out, _ = self.request('POST', f"/api/paper-grades/{g['id']}/judge",
                                 {'index': 2, 'correct': True}, cookie=self.teacher, expect=200)
        g2 = out['grade']
        self.assertEqual(g2['pending'], 0, '補判後不應再有待判定')
        self.assertEqual(g2['questions'][2]['judgedByTeacher'], True)
        self.assertAlmostEqual(g2['score'], 68.4, places=1)
        # 判定必須是布林
        self.request('POST', f"/api/paper-grades/{g['id']}/judge",
                     {'index': 2, 'correct': 'yes'}, cookie=self.teacher, expect=400)
        # 序號超出範圍
        self.request('POST', f"/api/paper-grades/{g['id']}/judge",
                     {'index': 99, 'correct': True}, cookie=self.teacher, expect=400)

    def teacher_id(self):
        with self.app.db() as db:
            return db.execute("SELECT id FROM users WHERE role='teacher' ORDER BY id").fetchone()[0]

    def test_restore_questions_merge_and_replace_preserves_ids(self):
        self.scenario()
        questions, _, _ = self.archives()
        document = json.loads(questions)
        self.assertEqual(len(document['sourceIds']), 16, '題庫歸檔要帶原編號')
        # 合併：題目都已存在 → 全部跳過，但仍記錄編號對照
        _, merged, _ = self.request('POST', '/api/admin/restore/questions', raw=questions,
                                    ctype='application/octet-stream', cookie=self.teacher, expect=200)
        self.assertEqual((merged['inserted'], merged['skipped']), (0, 16))
        self.assertEqual(merged['mapped'], 16)
        # 取代：先清空題庫再以原編號寫回（有作答引用時應被擋下）
        self.request('POST', '/api/admin/restore/questions?replace=1', raw=questions,
                     ctype='application/octet-stream', cookie=self.teacher, expect=409)
        self.request('POST', '/api/admin/reset/students', {'confirm': 'RESET'},
                     cookie=self.teacher, expect=200)
        _, replaced, _ = self.request('POST', '/api/admin/restore/questions?replace=1', raw=questions,
                                      ctype='application/octet-stream', cookie=self.teacher, expect=200)
        self.assertEqual(replaced['inserted'], 16)
        self.assertTrue(replaced['replaced'])
        with self.app.db() as db:
            ids = [row[0] for row in db.execute('SELECT id FROM questions ORDER BY id')]
        self.assertEqual(ids, document['sourceIds'], '取代模式要保留原編號')

    def test_restore_students_round_trip(self):
        _, aid, _ = self.scenario()
        _, students, _ = self.archives()
        records = [json.loads(line) for line in students.decode().strip().split('\n')]
        attempt_record = next(r for r in records if r.get('type') == 'attempt')
        self.assertTrue(attempt_record['image'].startswith('data:image/'))
        self.request('POST', '/api/admin/reset/students', {'confirm': 'RESET'},
                     cookie=self.teacher, expect=200)
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM users').fetchone()[0], 2)
        # 用共用初始密碼還原
        _, out, _ = self.request('POST', '/api/admin/restore/students?password=RestoredPass99',
                                 raw=students, ctype='application/octet-stream',
                                 cookie=self.teacher, expect=200)
        self.assertEqual(out['written']['student'], 2)
        self.assertEqual(out['written']['class'], 1)
        self.assertEqual(out['written']['assignment'], 1)
        self.assertEqual(out['written']['attempt'], 1)
        self.assertEqual(out['written']['classStudent'], 2)
        self.assertTrue(out['usedSharedPassword'])
        self.assertEqual(out['unreadableImages'], 0)
        self.assertEqual([c['username'] for c in out['credentials']], ['y7a01', 'y7a02'])
        self.assertEqual([c['seat'] for c in out['credentials']], ['1', '2'])
        # 還原後的學生可以登入，並看到原本的作業與作答
        cookie = self.login('y7a01', 'RestoredPass99')
        _, homework, _ = self.request('GET', '/api/homework', cookie=cookie, expect=200)
        self.assertEqual(len(homework['assignments']), 1)
        restored_id = homework['assignments'][0]['id']
        _, detail, _ = self.request('GET', f'/api/assignments/{restored_id}', cookie=cookie, expect=200)
        self.assertEqual(len(detail['attempts']), 1)
        self.assertEqual(detail['attempts'][0]['answerText'], 'x=2或3')
        self.assertTrue(detail['attempts'][0]['image'])
        # 圖片真的可以讀出來（重新驗證 PNG）
        image = self.request('GET', f"/api/attempts/{detail['attempts'][0]['id']}/image",
                             cookie=cookie, expect=200)[1]
        self.assertTrue(image.startswith(b'\x89PNG\r\n\x1a\n'))
        # 同名帳號不會被覆蓋，第二次還原只會跳過
        _, again, _ = self.request('POST', '/api/admin/restore/students?password=RestoredPass99',
                                   raw=students, ctype='application/octet-stream',
                                   cookie=self.teacher, expect=200)
        self.assertEqual(again['written'].get('student', 0), 0)
        # 歸檔含演示學生 + 兩位測試學生，都已存在 → 全部跳過；演示教師另計。
        self.assertEqual(again['skipped']['student'], 3)
        self.assertEqual(again['skipped']['teacherRecord'], 1)

    def test_restore_students_generates_passwords_without_shared_one(self):
        self.scenario()
        _, students, _ = self.archives()
        self.request('POST', '/api/admin/reset/students', {'confirm': 'RESET'},
                     cookie=self.teacher, expect=200)
        _, out, _ = self.request('POST', '/api/admin/restore/students', raw=students,
                                 ctype='application/octet-stream', cookie=self.teacher, expect=200)
        self.assertFalse(out['usedSharedPassword'])
        for item in out['credentials']:
            self.assertTrue(item['generated'])
            self.assertGreaterEqual(len(item['password']), 10)
        self.login(out['credentials'][0]['username'], out['credentials'][0]['password'])
        # 共用密碼太短要擋下來
        self.request('POST', '/api/admin/restore/students?password=short', raw=students,
                     ctype='application/octet-stream', cookie=self.teacher, expect=400)

    def test_restore_database_replaces_and_keeps_previous(self):
        self.scenario()
        _, _, backup = self.archives()
        with self.app.db() as db:
            before = db.execute('SELECT count(*) FROM attempts').fetchone()[0]
        self.request('POST', '/api/admin/reset/students', {'confirm': 'RESET'},
                     cookie=self.teacher, expect=200)
        _, out, _ = self.request('POST', '/api/admin/restore/db', raw=backup,
                                 ctype='application/octet-stream', cookie=self.teacher, expect=200)
        self.assertTrue(out['restored'])
        self.assertEqual(out['counts']['attempts'], before)
        self.assertTrue(out['keptPreviousAs'].startswith('mathpath.replaced-'))
        self.assertTrue((self.root / 'data' / out['keptPreviousAs']).exists(), '舊資料庫要保留')
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0], before)
        # 換檔後教師仍可登入
        self.login('teacher', 'Teach1234!')

    def test_restore_rejects_invalid_uploads(self):
        cases = [('/api/admin/restore/db', b'not a database' * 50),
                 ('/api/admin/restore/questions', b'{"format":"other"}'),
                 ('/api/admin/restore/students', b'{"type":"student"}\n')]
        for path, payload in cases:
            with self.subTest(path=path):
                self.request('POST', path, raw=payload, ctype='application/octet-stream',
                             cookie=self.teacher, expect=400)
        # 空檔案與超額大小
        self.request('POST', '/api/admin/restore/db', raw=b'', ctype='application/octet-stream',
                     cookie=self.teacher, expect=413)
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM questions').fetchone()[0], 16)

    def test_reset_requires_phrase_and_keeps_question_bank(self):
        self.scenario()
        for bad in ('', 'RESET NOW', '重置', 'reset me'):
            with self.subTest(confirm=bad):
                self.request('POST', '/api/admin/reset/students', {'confirm': bad},
                             cookie=self.teacher, expect=400)
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0], 1)
        # 確認字串不分大小寫，小寫也接受（避免手機自動大寫造成困擾）。
        _, result, _ = self.request('POST', '/api/admin/reset/students', {'confirm': ' reset '},
                                    cookie=self.teacher, expect=200)
        self.assertEqual(result['removed']['students'], 2)
        self.assertEqual(result['removed']['attempts'], 1)
        self.assertEqual(result['removed']['assignments'], 1)
        self.assertEqual(result['removed']['classes'], 1)
        self.assertEqual(result['kept']['questions'], 16)
        self.assertEqual(result['kept']['teachers'], 1)
        self.assertIn('vacuum', result)
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM questions').fetchone()[0], 16)
            self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT count(*) FROM assignments').fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT count(*) FROM users WHERE role='student'").fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT count(*) FROM users').fetchone()[0], 2)
            self.assertEqual(db.execute("SELECT value FROM meta WHERE key='last_student_reset'").fetchone()[0],
                             result['at'])
        # 舊學生帳號不能再用；教師帳號不受影響。
        self.request('POST', '/api/login', {'username': 'y7a01', 'password': 'ArchivePass12'}, expect=401)
        self.request('GET', '/api/admin/storage', cookie=self.teacher, expect=200)
        # 題庫仍在，新的學生可以重新匯入名單。
        self.request('POST', '/api/users/bulk', {'students': [
            {'username': 'y8a01', 'password': 'NextYear1234', 'seat': '1'}]},
            cookie=self.teacher, expect=200)


if __name__ == '__main__':
    unittest.main(verbosity=2)
