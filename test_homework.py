"""作业 API 回归测试：直接调度请求，所有数据库均位于临时目录。"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import server
import test_server


class HomeworkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='mathpath-homework-')
        self.addCleanup(self.tmp.cleanup)
        env = patch.dict('os.environ', {}, clear=True)
        env.start()
        self.addCleanup(env.stop)
        self.app = server.Application(Path(self.tmp.name) / 'data')
        self.app.safe_initialize()
        with self.app.db() as db:
            self.student = db.execute('SELECT * FROM users WHERE id=1').fetchone()
            self.teacher = db.execute('SELECT * FROM users WHERE id=2').fetchone()
            # 测试账户仅写入临时数据库。
            db.execute('INSERT INTO users(id,username,name,role,password) VALUES(3,?,?,?,?)',
                       ('other', 'A学生', 'student', self.student['password']))
            db.execute('INSERT INTO users(id,username,name,role,password) VALUES(4,?,?,?,?)',
                       ('teacher2', '另一教师', 'teacher', self.teacher['password']))
            self.other = db.execute('SELECT * FROM users WHERE id=3').fetchone()
            self.teacher2 = db.execute('SELECT * FROM users WHERE id=4').fetchone()
        self.cid = self.call('POST', '/api/classes', {'name': '三年级', 'studentIds': [1, 3]}, self.teacher)['class']['id']

    def call(self, method, path, body=None, user=None):
        return self.app.dispatch(method, path, body or {}, self.student if user is None else user, None, '127.0.0.1')[0]

    def error(self, status, method, path, body=None, user=None):
        with self.assertRaises(server.APIError) as context:
            self.call(method, path, body, user)
        self.assertEqual(context.exception.status, status)

    def assignment(self, questions=(1, 2), **kwargs):
        body = {'title': '课后练习', 'classId': self.cid, 'questionIds': list(questions),
                'dueAt': (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
                'description': '写出完整步骤', 'allowLate': False, **kwargs}
        return self.call('POST', '/api/assignments', body, self.teacher)['assignment']['id']

    def attempt(self, aid=None, qid=1, answer='x=2或3', user=None, **kwargs):
        body = {'questionId': qid, 'answerText': answer, **kwargs}
        if aid is not None:
            body['assignmentId'] = aid
        return self.call('POST', '/api/attempts', body, user)['attempt']

    def latest_by_question(self, aid):
        """教師視角的「每題最新一筆」作答（attempts 是 id 由新到舊）。"""
        latest = {}
        for a in self.detail(aid, self.teacher)['attempts']:
            if a['questionId'] not in latest or latest[a['questionId']]['id'] < a['id']:
                latest[a['questionId']] = a
        return latest

    def detail(self, aid, user=None):
        return self.call('GET', f'/api/assignments/{aid}', user=user)

    def teacher_attempt(self, aid, attempt_id, user=None):
        """以教師視角讀取作業作答。

        作業／測驗在教師批閱前不會向學生揭露分數與 AI 批閱結果，
        因此要驗證真實成績時一律走教師視角。
        """
        data = self.call('GET', f'/api/assignments/{aid}', user=self.teacher if user is None else user)
        return next(a for a in data['attempts'] if a['id'] == attempt_id)

    def student_attempt(self, aid, attempt_id):
        return next(a for a in self.detail(aid)['attempts'] if a['id'] == attempt_id)

    def ai_assignment(self, questions=(1,)):
        """建立一份教師已啟用 AI 建議評分的作業（呼叫前需先 configure_ai）。"""
        return self.assignment(questions, aiGrading=True)

    def calendar(self, frm, to, user=None):
        return self.app.dispatch('GET', '/api/calendar', {}, self.student if user is None else user,
                                 None, '127.0.0.1', f'from={frm}&to={to}')[0]

    def calendar_error(self, frm, to, user=None):
        with self.assertRaises(server.APIError) as context:
            self.calendar(frm, to, user)
        self.assertEqual(context.exception.status, 400)

    def results(self, aid, user=None):
        return self.call('GET', f'/api/assignments/{aid}/results', user=self.teacher if user is None else user)

    def finalize(self, aid, user=None):
        return self.call('POST', f'/api/assignments/{aid}/submit', user=user)

    def review(self, attempt, score=5, user=None):
        return self.call('POST', f'/api/attempts/{attempt["id"]}/review',
                         {'score': score, 'feedback': '过程正确，需补充最终结论'}, self.teacher if user is None else user)

    def expire(self, aid):
        with self.app.db() as db:
            db.execute('UPDATE assignments SET due_at=? WHERE id=?', ('2000-01-01T00:00:00Z', aid))

    def ai_result(self, score=4):
        return {'score': score, 'feedback': '需要补充两根',
                'steps': [{'label': '因式分解', 'earned': score, 'max': 6, 'comment': '需补结论'}]}

    def configure_ai(self, external=False):
        self.app.ai.configured = True
        self.app.ai.mode = 'external' if external else 'local'

    def test_classes_dedup_and_directory_privacy(self):
        result = self.call('POST', '/api/classes', {'name': "班级' OR 1=1", 'studentIds': [1, 1]}, self.teacher)
        self.assertEqual(result['class']['studentIds'], [1])
        teacher = self.call('GET', '/api/homework', user=self.teacher)
        self.assertEqual(len(teacher['students']), 2)
        self.assertEqual(set(teacher['students'][0]), {'id', 'name', 'username', 'seat'})
        student = self.call('GET', '/api/homework')
        self.assertNotIn('students', student)
        self.assertTrue(all(c['studentIds'] == [] for c in student['classes']))
        self.assertNotIn('password', json.dumps(teacher))

    def test_classes_invalid_members_atomic_and_role(self):
        for members in ([], [2], [4], [1, 999], [True], ['1'], [0], list(range(1, 1002))):
            self.error(400, 'POST', '/api/classes', {'name': '班', 'studentIds': members}, self.teacher)
        self.error(403, 'POST', '/api/classes', {'name': '班', 'studentIds': [1]})
        self.error(400, 'POST', '/api/classes', {'name': ' ', 'studentIds': [1]}, self.teacher)
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM classes').fetchone()[0], 1)

    def test_owner_and_recipient_rbac(self):
        aid = self.assignment()
        self.error(403, 'GET', f'/api/assignments/{aid}', user=self.teacher2)
        self.error(403, 'GET', f'/api/assignments/{aid}/results')
        self.error(403, 'GET', f'/api/assignments/{aid}/results', user=self.teacher2)
        body = {'title': '冒充', 'classId': self.cid, 'questionIds': [1],
                'dueAt': (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()}
        self.error(403, 'POST', '/api/assignments', body, self.teacher2)
        self.error(403, 'POST', '/api/assignments', body)
        self.error(403, 'POST', '/api/attempts', {'assignmentId': aid, 'questionId': 1, 'answerText': '2'}, self.teacher)
        self.error(403, 'POST', f'/api/assignments/{aid}/submit', user=self.teacher)
        self.assertEqual(self.call('GET', '/api/homework', user=self.teacher2)['assignments'], [])
        self.assertEqual(self.call('GET', '/api/homework', user=self.teacher2)['classes'], [])

    def test_authentication_unchanged(self):
        for method, path, body in [('GET', '/api/homework', {}), ('POST', '/api/classes', {'name': '班', 'studentIds': [1]}),
                                   ('GET', '/api/assignments/1', {}), ('POST', '/api/assignments/1/submit', {})]:
            with self.assertRaises(server.APIError) as context:
                self.app.dispatch(method, path, body, None, None, '127.0.0.1')
            self.assertEqual(context.exception.status, 401)

    def test_assignment_validates_lengths_and_fields(self):
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        base = {'title': '作业', 'classId': self.cid, 'questionIds': [1], 'dueAt': future}
        for patch_body in ({'title': ''}, {'title': 'x' * 201}, {'description': 'x' * 4001},
                           {'allowLate': 1}, {'questionIds': []}, {'questionIds': list(range(1, 32))},
                           {'questionIds': [True]}, {'questionIds': ['1']}, {'classId': True}, {'teacher_id': 4}):
            self.error(400, 'POST', '/api/assignments', {**base, **patch_body}, self.teacher)
        self.error(404, 'POST', '/api/assignments', {**base, 'classId': 999}, self.teacher)
        self.error(404, 'POST', '/api/assignments', {**base, 'questionIds': [999]}, self.teacher)
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM assignments').fetchone()[0], 0)
        aid = self.assignment((1,), title='x' * 200, description='x' * 4000)
        self.assertEqual(len(self.detail(aid)['assignment']['description']), 4000)

    def test_ai_grading_is_decided_by_teacher_not_student(self):
        # 只有教師可以決定是否使用 AI 建議評分；AI 未接入時不得啟用。
        base = {'title': '作业', 'classId': self.cid, 'questionIds': [1], 'dueAt': '2099-01-01T00:00:00Z'}
        self.error(409, 'POST', '/api/assignments', {**base, 'aiGrading': True}, self.teacher)
        for bad in (1, 0, 'true', None, [], {}):
            self.error(400, 'POST', '/api/assignments', {**base, 'aiGrading': bad}, self.teacher)
        self.assertFalse(self.detail(self.assignment((1,)))['assignment']['aiGrading'])
        self.configure_ai()
        aid = self.ai_assignment((1,))
        self.assertTrue(self.detail(aid)['assignment']['aiGrading'])
        self.assertTrue(self.detail(aid, self.teacher)['assignment']['aiGrading'])
        # 學生不得自行指定 useAi：不認識的欄位一律 400，不能繞過教師設定。
        self.error(400, 'POST', '/api/attempts', {'assignmentId': aid, 'questionId': 1, 'answerText': 'x=2', 'useAi': True})
        with patch.object(self.app.ai, 'call', return_value=self.ai_result()) as ai:
            attempt = self.attempt(aid, answer='x=2')
        self.assertTrue(ai.called)
        # 學生在教師批閱前看不到分數與 AI 批閱結果；教師端才看得到。
        self.assertEqual(attempt['gradingMethod'], 'awaiting-review')
        self.assertIsNone(attempt['score'])
        self.assertIsNone(attempt['suggestion'])
        self.assertTrue(attempt['awaitingReview'])
        self.assertEqual(self.teacher_attempt(aid, attempt['id'])['gradingMethod'], 'ai-advisory')

    def test_assignment_scores_hidden_until_teacher_reviews(self):
        """作業／測驗：教師批閱前，學生看不到分數、AI 批閱結果、詳解與學習建議。"""
        self.configure_ai()
        aid = self.ai_assignment((1,))
        with patch.object(self.app.ai, 'call', side_effect=[self.ai_result(),
                                                            {'strength': 'a', 'focus': 'b', 'nextStep': 'c'}]):
            attempt = self.attempt(aid, answer='x=2')
        # 學生端：只有「等待批閱」，沒有分數、步驟、建議、AI 原分。
        self.assertEqual(attempt['status'], 'pending')
        self.assertEqual(attempt['gradingMethod'], 'awaiting-review')
        self.assertTrue(attempt['awaitingReview'])
        self.assertEqual(attempt['feedback'], '')
        self.assertEqual(attempt['steps'], [])
        for key in ('score', 'aiScore', 'ruleScore', 'confirmedScore', 'suggestion'):
            self.assertIsNone(attempt[key], key)
        # 作業報告同樣不揭露，只看得到批閱進度。
        report = self.detail(aid)['report']
        self.assertIsNone(report['score'])
        self.assertIsNone(report['aiScore'])
        self.assertIsNone(report['percent'])
        self.assertIsNone(report['suggestion'])
        self.assertEqual(report['pendingCount'], 1)
        self.assertTrue(report['awaitingReview'])
        # 學習足跡的統計也不提早計入未批閱的作業。
        state = self.call('GET', '/api/state')
        self.assertEqual(state['stats']['completed'], 0)
        self.assertEqual([a['status'] for a in state['attempts']], ['pending'])
        # 教師端仍看得到真實的 AI 建議分。
        stored = self.teacher_attempt(aid, attempt['id'])
        self.assertEqual(stored['score'], 4)
        self.assertEqual(stored['aiScore'], 4)
        self.assertEqual(stored['suggestion']['source'], 'ai')
        # 教師批閱後才揭露分數與教師確認分。
        self.review(attempt, 5)
        revealed = self.student_attempt(aid, attempt['id'])
        self.assertEqual(revealed['score'], 5)
        self.assertEqual(revealed['confirmedScore'], 5)
        self.assertNotIn('awaitingReview', revealed)
        self.assertEqual(self.detail(aid)['report']['score'], 5)
        self.assertEqual(self.call('GET', '/api/state')['stats']['completed'], 1)

    def test_review_feedback_can_be_empty(self):
        # 教師只想確認分數時可以不寫評語。
        aid = self.assignment((1,))
        attempt = self.attempt(aid, answer='x=2或3')
        reviewed = self.call('POST', f"/api/attempts/{attempt['id']}/review", {'score': 5}, self.teacher)['attempt']
        self.assertEqual(reviewed['score'], 5)
        self.assertTrue(reviewed['teacherReviewed'])
        self.assertIn('未填寫評語', reviewed['feedback'])
        # 只有空白字元同樣視為留空。
        other = self.attempt(aid, qid=1, answer='x=2')
        blank = self.call('POST', f"/api/attempts/{other['id']}/review",
                          {'score': 3, 'feedback': '   '}, self.teacher)['attempt']
        self.assertEqual(blank['score'], 3)
        self.assertIn('未填寫評語', blank['feedback'])
        # 有寫評語時照舊顯示。
        written = self.attempt(aid, qid=1, answer='x=2或3')
        noted = self.call('POST', f"/api/attempts/{written['id']}/review",
                          {'score': 6, 'feedback': '步驟清楚'}, self.teacher)['attempt']
        self.assertEqual(noted['feedback'], '教師已覆核：步驟清楚')
        # 分數仍是必填，評語型別仍要正確。
        self.error(400, 'POST', f"/api/attempts/{written['id']}/review", {'feedback': '只有評語'}, self.teacher)
        self.error(400, 'POST', f"/api/attempts/{written['id']}/review", {'score': 3, 'feedback': 5}, self.teacher)

    def test_teacher_one_click_ai_review_all(self):
        self.configure_ai()
        aid = self.ai_assignment((1, 2))
        suggestion = {'strength': 'a', 'focus': 'b', 'nextStep': 'c'}
        with patch.object(self.app.ai, 'call', side_effect=[self.ai_result(), suggestion,
                                                            self.ai_result(), suggestion]):
            first = self.attempt(aid, qid=1, answer='x=2')
            second = self.attempt(aid, qid=2, answer='x=3或4')
        # 批閱前學生看不到分數。
        self.assertIsNone(first['score'])
        self.assertIsNone(self.detail(aid)['report']['score'])
        # 學生不能自己觸發一鍵批閱。
        self.error(403, 'POST', f'/api/assignments/{aid}/ai-review', {}, self.student)
        result = self.call('POST', f'/api/assignments/{aid}/ai-review', {}, self.teacher)
        self.assertEqual(result['reviewed'], 2)
        self.assertEqual(result['failed'], 0)
        # 一鍵批閱後學生才看到分數，且標記為教師批閱。
        own = self.student_attempt(aid, first['id'])
        self.assertEqual(own['score'], 4)
        self.assertTrue(own['teacherReviewed'])
        self.assertIn('AI 批閱（教師一鍵批閱）', own['feedback'])
        self.assertNotIn('awaitingReview', own)
        self.assertEqual(self.detail(aid)['report']['score'], 8)
        self.assertEqual(self.results(aid)['summary']['pendingReviewCount'], 0)
        # 已經全部批閱：再按一次不會重複呼叫模型。
        with patch.object(self.app.ai, 'call') as ai:
            again = self.call('POST', f'/api/assignments/{aid}/ai-review', {}, self.teacher)
        ai.assert_not_called()
        self.assertEqual(again['reviewed'], 0)
        # 沒有由教師啟用 AI 評分的作業不能一鍵 AI 批閱。
        plain = self.assignment((1,))
        self.error(409, 'POST', f'/api/assignments/{plain}/ai-review', {}, self.teacher)

    def test_one_click_ai_review_uses_existing_ai_score_and_survives_failure(self):
        self.configure_ai()
        aid = self.ai_assignment((1, 2))
        suggestion = {'strength': 'a', 'focus': 'b', 'nextStep': 'c'}
        # 第一題已由 AI 建議評分（尚未教師確認）。
        with patch.object(self.app.ai, 'call', side_effect=[self.ai_result(), suggestion]):
            first = self.attempt(aid, qid=1, answer='x=2')
        # 第二題在 AI 暫時未接入時提交 → 只有規則分、待批閱。
        self.app.ai.configured = False
        second = self.attempt(aid, qid=2, answer='x=3或4')
        self.app.ai.configured = True
        self.assertEqual(self.teacher_attempt(aid, first['id'])['aiScore'], 4)
        self.assertEqual(self.teacher_attempt(aid, second['id'])['gradingMethod'], 'rule-final')
        # 一鍵批閱：第一題直接採用既有 AI 分數（不呼叫模型），第二題才呼叫一次。
        with patch.object(self.app.ai, 'call', return_value=self.ai_result()) as ai:
            result = self.call('POST', f'/api/assignments/{aid}/ai-review', {}, self.teacher)
        self.assertEqual(ai.call_count, 1, '已有 AI 原分的作答不應重複呼叫模型')
        self.assertEqual(result['reviewed'], 2)
        self.assertEqual(self.student_attempt(aid, first['id'])['score'], 4)
        self.assertIn('採用先前 AI 建議分數', self.student_attempt(aid, first['id'])['feedback'])
        self.assertEqual(self.student_attempt(aid, second['id'])['score'], 4)
        # 模型失敗時其他題仍要批閱完成，並回報錯誤。
        aid2 = self.ai_assignment((1, 2))
        self.app.ai.configured = False
        self.attempt(aid2, qid=1, answer='x=2')
        self.attempt(aid2, qid=2, answer='x=3或4')
        self.app.ai.configured = True
        with patch.object(self.app.ai, 'call', side_effect=[server.APIError(502, '壞了'), self.ai_result()]):
            partial = self.call('POST', f'/api/assignments/{aid2}/ai-review', {}, self.teacher)
        self.assertEqual(partial['reviewed'], 1)
        self.assertEqual(partial['failed'], 1)
        self.assertEqual(partial['errors'][0]['error'], '壞了')
        self.assertEqual(self.detail(aid2)['report']['pendingCount'], 1)

    def test_one_click_ai_review_external_requires_consent(self):
        self.configure_ai(external=True)
        aid = self.ai_assignment((1,))
        with patch.object(self.app.ai, 'call') as ai:
            self.error(403, 'POST', f'/api/assignments/{aid}/ai-review', {}, self.teacher)
            ai.assert_not_called()

    def test_practice_always_ai_graded_and_recorded_without_teacher(self):
        # 自主練習（沒有作業編號）：一律 AI 即時評分、記錄分數，不需教師批閱。
        self.configure_ai()
        with patch.object(self.app.ai, 'call', return_value=self.ai_result()) as ai:
            attempt = self.attempt(None, qid=1, answer='x=2或3')
        self.assertTrue(ai.called, '自主練習應呼叫模型即時評分')
        self.assertEqual(attempt['gradingMethod'], 'ai-practice')
        self.assertEqual(attempt['status'], 'graded')
        self.assertEqual(attempt['score'], 4)
        self.assertEqual(attempt['aiScore'], 4)
        self.assertIsNone(attempt['ruleScore'])
        self.assertFalse(attempt['teacherReviewed'], '自主練習不需教師批閱')
        self.assertIn('不需教師批閱', attempt['feedback'])
        self.assertNotIn('僅供教師復核', attempt['feedback'])
        # 分數與作答都要寫進紀錄（學生自己看得到，不需教師再處理）。
        state = self.call('GET', '/api/state')
        saved = next(a for a in state['attempts'] if a['id'] == attempt['id'])
        self.assertEqual(saved['score'], 4)
        self.assertEqual(saved['gradingMethod'], 'ai-practice')
        self.assertIn('不需教师批阅', saved['suggestion']['notice'])

    def test_practice_ai_failure_falls_back_to_rule_and_still_records_score(self):
        # 自主練習以「即時評分、記錄分數」為目的；模型暫時失敗時退回規則核對，不能沒有分數。
        self.configure_ai()
        with patch.object(self.app.ai, 'call', side_effect=server.APIError(502, '模型暫時失敗')):
            attempt = self.attempt(None, qid=1, answer='x=2或3')
        self.assertEqual(attempt['gradingMethod'], 'rule-final')
        self.assertEqual(attempt['status'], 'graded')
        self.assertEqual(attempt['score'], 6)
        self.assertEqual(attempt['ruleScore'], 6)
        self.assertIsNone(attempt['aiScore'], '退回規則核對時不得留下 AI 原分')
        self.assertIn('AI 暫時無法使用', attempt['feedback'])

    def test_practice_ai_failure_on_handwriting_still_saves(self):
        self.configure_ai()
        with patch.object(self.app.ai, 'call', side_effect=server.APIError(502, '模型暫時失敗')):
            attempt = self.attempt(None, qid=1, answer='', image=test_server.png_url())
        self.assertEqual(attempt['gradingMethod'], 'pending-teacher')
        self.assertEqual(attempt['status'], 'pending')
        self.assertIsNone(attempt['score'])
        self.assertIn('AI 暫時無法辨識手寫內容', attempt['feedback'])

    def test_practice_without_ai_keeps_rule_and_pending(self):
        # 未接入 AI 時不得偽造分數：文字規則核對，手寫列為待教師批閱。
        text = self.attempt(None, qid=1, answer='x=2或3')
        self.assertEqual(text['gradingMethod'], 'rule-final')
        handwritten = self.attempt(None, qid=1, answer='', image=test_server.png_url())
        self.assertEqual(handwritten['gradingMethod'], 'pending-teacher')
        self.assertIsNone(handwritten['score'])
        self.assertEqual(handwritten['status'], 'pending')

    def test_assignment_without_ai_grading_never_calls_model(self):
        # 教師沒有啟用 AI 的作業：即使 AI 已接入，也不能由學生觸發模型。
        self.configure_ai()
        aid = self.assignment((1,))
        with patch.object(self.app.ai, 'call') as ai:
            attempt = self.attempt(aid, answer='x=2或3')
        ai.assert_not_called()
        stored = self.teacher_attempt(aid, attempt['id'])
        self.assertEqual(stored['gradingMethod'], 'rule-final')
        self.assertIsNone(stored['aiScore'])
        self.assertEqual(stored['score'], 6)
        # 規則核對也一樣：教師批閱前學生看不到分數。
        self.assertEqual(attempt['gradingMethod'], 'awaiting-review')
        self.assertIsNone(attempt['score'])

    def test_practice_external_model_requires_consent(self):
        # 自主練習用外部模型時，學生的資料傳送同意仍是必要條件。
        self.configure_ai(external=True)
        with patch.object(self.app.ai, 'call') as ai:
            self.error(403, 'POST', '/api/attempts', {'questionId': 1, 'answerText': '2'})
            ai.assert_not_called()
        with patch.object(self.app.ai, 'call', return_value=self.ai_result()):
            attempt = self.attempt(None, qid=1, answer='2', consentExternal=True)
        self.assertEqual(attempt['gradingMethod'], 'ai-practice')
        self.assertEqual(attempt['score'], 4)

    def test_mock_exam_uses_instant_ai_grading_without_teacher(self):
        # 自助模擬測驗同樣不是教師佈置的作業：AI 即時評分、不需教師批閱。
        self.configure_ai()
        started = self.mock(topic='一元二次方程', count=1, minutes=30)
        exam, questions = started['exam'], started['questions']
        with patch.object(self.app.ai, 'call', return_value={**self.ai_result(),
                                                            'steps': [{'label': '因式分解', 'earned': 4,
                                                                       'max': questions[0]['points'],
                                                                       'comment': '需补结论'}]}) as ai:
            attempt = self.call('POST', '/api/attempts',
                                {'questionId': questions[0]['id'], 'answerText': 'x=2或3', 'mockId': exam['id']})['attempt']
        self.assertTrue(ai.called)
        self.assertEqual(attempt['gradingMethod'], 'ai-practice')
        self.assertFalse(attempt['teacherReviewed'])

    def test_deadlines_require_future_valid_timezone(self):
        for due in ('garbage', '2099-01-01', '2099-01-01T12:00:00', '2000-01-01T00:00:00Z',
                    '2099-02-30T12:00:00Z', '2099-01-01T12:00:00+24:00', '2099-01-01T12:00:00+01:60'):
            self.error(400, 'POST', '/api/assignments', {'title': '作业', 'classId': self.cid, 'questionIds': [1], 'dueAt': due}, self.teacher)
        aid = self.assignment((1,), dueAt='2099-01-01T08:30:00+08:00')
        self.assertEqual(self.detail(aid)['assignment']['dueAt'], '2099-01-01T00:30:00Z')

    def test_empty_class_and_unreviewed_questions_rejected(self):
        with self.app.db() as db:
            db.execute('DELETE FROM class_students WHERE class_id=?', (self.cid,))
        self.error(400, 'POST', '/api/assignments', {'title': '作业', 'classId': self.cid, 'questionIds': [1], 'dueAt': '2099-01-01T00:00:00Z'}, self.teacher)
        with self.app.db() as db:
            db.execute('INSERT INTO class_students VALUES(?,?)', (self.cid, 1))
        for extra in ({'answer': ''}, {'source': 'AI 生成 · 待核驗'}, {'tags': ['待教师核验']}):
            with self.app.db() as db:
                q = self.app.insert_question(db, {**server.seed_questions()[0], **extra})
            self.error(400, 'POST', '/api/assignments', {'title': '作业', 'classId': self.cid, 'questionIds': [q['id']], 'dueAt': '2099-01-01T00:00:00Z'}, self.teacher)

    def test_snapshot_question_scoring_title_and_topic_immutable(self):
        aid = self.assignment((1,))
        with self.app.db() as db:
            q = self.app.get_question(db, 1)
            q.update(answer='100', points=99, title='新标题', topic='函數', steps=['变更'], hint='新提示')
            db.execute('UPDATE questions SET payload=? WHERE id=1', (json.dumps(q),))
        attempt = self.attempt(aid)
        stored = self.teacher_attempt(aid, attempt['id'])
        self.assertEqual(stored['score'], 6)
        self.assertEqual(stored['maxScore'], 6)
        self.assertEqual(stored['questionTitle'], '因式分解解二次方程')
        self.assertEqual(stored['topic'], '一元二次方程')
        # 學生端仍看得到題目資訊，但教師批閱前沒有分數。
        self.assertIsNone(attempt['score'])
        self.assertEqual(attempt['maxScore'], 6)
        self.assertEqual(attempt['questionTitle'], '因式分解解二次方程')
        self.assertEqual(attempt['topic'], '一元二次方程')
        self.assertEqual(self.attempt()['score'], 0)
        detail = self.detail(aid)
        self.assertNotIn('answer', detail['questions'][0])
        self.assertNotIn('steps', detail['questions'][0])
        self.assertEqual(self.detail(aid, self.teacher)['questions'][0]['answer'], '$x=2$ 或 $x=3$')
        self.assertEqual(self.results(aid)['assignment']['totalPoints'], 6)

    def test_recipients_immutable_after_class_change(self):
        aid = self.assignment((1,))
        with self.app.db() as db:
            db.execute('DELETE FROM class_students WHERE class_id=?', (self.cid,))
            db.execute('INSERT INTO users(id,username,name,role,password) VALUES(5,?,?,?,?)',
                       ('newstudent', '新学生', 'student', self.student['password']))
            db.execute('INSERT INTO class_students VALUES(?,5)', (self.cid,))
            db.execute('UPDATE classes SET name=? WHERE id=?', ('改名', self.cid))
            new = db.execute('SELECT * FROM users WHERE id=5').fetchone()
        self.assertEqual(self.detail(aid)['assignment']['className'], '三年级')
        self.attempt(aid)
        self.attempt(aid, user=self.other)
        self.error(403, 'GET', f'/api/assignments/{aid}', user=new)
        self.error(403, 'POST', '/api/attempts', {'assignmentId': aid, 'questionId': 1, 'answerText': '2'}, new)
        self.assertEqual(self.call('GET', '/api/homework', user=new)['assignments'], [])
        self.assertEqual(len(self.results(aid)['students']), 2)

    def test_wrong_question_and_invalid_assignment_id(self):
        aid = self.assignment((1,))
        self.error(403, 'POST', '/api/attempts', {'assignmentId': aid, 'questionId': 2, 'answerText': '3'})
        for value in (True, None, '1', 0):
            self.error(400, 'POST', '/api/attempts', {'assignmentId': value, 'questionId': 1, 'answerText': '2'})
        self.error(404, 'GET', '/api/assignments/999')

    def test_formal_incomplete_idempotent_and_finalized(self):
        aid = self.assignment()
        self.assertEqual(self.detail(aid)['mySubmission']['status'], 'not_started')
        self.error(400, 'POST', f'/api/assignments/{aid}/submit')
        self.attempt(aid)
        self.assertEqual(self.detail(aid)['mySubmission']['status'], 'in_progress')
        self.error(400, 'POST', f'/api/assignments/{aid}/submit')
        self.attempt(aid, 2, 'x=3或4')
        first = self.finalize(aid)
        self.assertEqual(first, self.finalize(aid))
        self.assertEqual(first['mySubmission']['status'], 'submitted')
        self.error(403, 'POST', '/api/attempts', {'assignmentId': aid, 'questionId': 1, 'answerText': '2'})
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM assignment_recipients WHERE assignment_id=? AND submitted_at IS NOT NULL', (aid,)).fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0], 2)

    def test_skip_question_records_pending_and_allows_submit(self):
        """「本題不會」：留空作答但明確記錄，不自動記零分，也不必逼學生亂填。"""
        aid = self.assignment((1, 2))
        self.attempt(aid, qid=1, answer='x=2')
        # 只答一題還不能提交；錯誤訊息要指出是哪一題、並提示可以標示「不會」。
        with self.assertRaises(server.APIError) as ctx:
            self.finalize(aid)
        self.assertIn('第 2 題', ctx.exception.message)
        self.assertIn('本題不會', ctx.exception.message)
        skipped = self.call('POST', '/api/attempts',
                            {'questionId': 2, 'skipped': True, 'assignmentId': aid})['attempt']
        self.assertTrue(skipped['skipped'])
        self.assertEqual(skipped['status'], 'pending')
        self.assertIsNone(skipped['score'])
        teacher_rows = self.latest_by_question(aid)
        self.assertTrue(teacher_rows[2]['skipped'])
        self.assertIsNone(teacher_rows[2]['score'], '標示「不會」不可以自動記零分')
        self.assertIn('未自動記零分', teacher_rows[2]['feedback'])
        # 標示「不會」時不接受附帶作答內容，型別也要檢查。
        self.error(400, 'POST', '/api/attempts',
                   {'questionId': 1, 'skipped': True, 'answerText': 'x', 'assignmentId': aid})
        self.error(400, 'POST', '/api/attempts', {'questionId': 1, 'skipped': 'yes', 'assignmentId': aid})
        # 想通了要改成真的作答也可以（最新一筆為準，覆蓋「不會」）。
        again = self.attempt(aid, 2, 'x=3或4')
        self.assertFalse(again['skipped'])
        self.finalize(aid)
        teacher_rows = self.latest_by_question(aid)
        self.assertFalse(teacher_rows[2]['skipped'], '最新一筆是真的作答')
        self.assertIsNone(self.detail(aid)['report']['score'], '教師批閱前學生看不到分數')

    def test_skip_requires_open_assignment(self):
        """已正式提交的作業不能再補標示「不會」（否則等於偷偷改答案）。"""
        aid = self.assignment((1,))
        self.attempt(aid)
        self.finalize(aid)
        self.error(403, 'POST', '/api/attempts', {'questionId': 1, 'skipped': True, 'assignmentId': aid})

    def test_ai_review_can_target_one_student_and_skips_blank(self):
        """一鍵 AI 批閱可以只針對一位學生；標示「不會」的空白題不丟給模型。"""
        self.configure_ai()
        aid = self.ai_assignment((1,))
        with patch.object(self.app.ai, 'call', return_value=self.ai_result()):
            self.attempt(aid)                                  # 學生 1：正常作答，有 AI 建議分
        self.call('POST', '/api/attempts', {'questionId': 1, 'skipped': True, 'assignmentId': aid},
                  self.other)                                      # 學生 3：標示「不會」
        with patch.object(self.app.ai, 'call', return_value=self.ai_result()) as model:
            one = self.call('POST', f'/api/assignments/{aid}/ai-review', {'studentId': 1}, self.teacher)
        self.assertEqual(one['reviewed'], 1, '只覆核指定的那位學生')
        self.assertEqual(model.call_count, 0, '已有 AI 原分的作答不重呼模型')
        rows = {a['student']['id']: a for a in self.detail(aid, self.teacher)['attempts']}
        self.assertTrue(rows[1]['teacherReviewed'])
        self.assertFalse(rows[3]['teacherReviewed'], '其他學生不受影響')
        with patch.object(self.app.ai, 'call', return_value=self.ai_result()):
            rest = self.call('POST', f'/api/assignments/{aid}/ai-review', {}, self.teacher)
        self.assertEqual(rest['reviewed'], 0, '沒有其他可評分的作答')
        self.assertEqual(rest['skipped'], 1, '標示「不會」的空白題留給教師自己處理')
        rows = {a['student']['id']: a for a in self.detail(aid, self.teacher)['attempts']}
        self.assertIsNone(rows[3]['score'], '空白題不能被模型給分')
        self.assertFalse(rows[3]['teacherReviewed'])

    def test_ai_grading_normalization_and_cross_check(self):
        """AI 批改的精度：配分歸一化、規則交叉驗證旗標、教師覆核後清除。

        模型算術不穩不該讓整筆評分作廢；但 AI 建議分與可重現的規則核對衝突時，
        要留下「建議覆核」訊號讓教師優先看那一題，而且旗標只給教師看。
        """
        self.configure_ai()
        aid = self.ai_assignment((1,))

        # 1) 模型 max 加總 8 ≠ 題目 6、earned 也超過配分：由伺服器換算，不整筆作廢。
        messy = {'score': 5, 'feedback': '大致正確',
                 'steps': [{'label': '因式分解', 'earned': 4, 'max': 4, 'comment': ''},
                           {'label': '得根', 'earned': 4, 'max': 4, 'comment': ''}]}
        with patch.object(self.app.ai, 'call', return_value=messy):
            stored = self.teacher_attempt(aid, self.attempt(aid, 1)['id'])
        self.assertEqual(stored['gradingMethod'], 'ai-advisory')
        self.assertEqual(stored['score'], 5, '總分以模型自報的 score 為準')
        self.assertEqual(sum(s['max'] for s in stored['steps']), 6, '步驟配分總和要等於題目總分')
        self.assertEqual(sum(s['earned'] for s in stored['steps']), 5)
        self.assertTrue(all(s['earned'] <= s['max'] for s in stored['steps']))
        self.assertIn('已由系統按題目總分換算', stored['feedback'])
        self.assertEqual(stored['reviewFlags'], [], '只是換算不該被標成建議覆核')

        # 2) 沒有步驟分項時合成單一步驟，保住分數與評語。
        with patch.object(self.app.ai, 'call', return_value={'score': 4, 'feedback': '部分正確'}):
            plain = self.teacher_attempt(aid, self.attempt(aid, 1)['id'])
        self.assertEqual(plain['score'], 4)
        self.assertEqual(plain['steps'], [{'label': '整體表現', 'earned': 4, 'max': 6.0, 'comment': ''}])

        # 3) 最終答案與參考答案等價，但 AI 只給 2/6 → 標記建議覆核（不自動改分）。
        low = {'score': 2, 'feedback': '過程簡略', 'steps': [{'label': '整體', 'earned': 2, 'max': 6, 'comment': ''}]}
        with patch.object(self.app.ai, 'call', return_value=low):
            flagged = self.teacher_attempt(aid, self.attempt(aid, 1)['id'])
        self.assertEqual(flagged['score'], 2, '旗標只作提示，不改分數')
        self.assertEqual([f['code'] for f in flagged['reviewFlags']], ['rule-higher'])
        self.assertIn('等價', flagged['reviewFlags'][0]['message'])
        # 旗標是教師的覆核提示，不是學生的成績資訊。
        self.assertNotIn('reviewFlags', self.student_attempt(aid, flagged['id']))
        results = self.results(aid)
        by_id = {s['id']: s for s in results['students']}
        self.assertEqual(results['summary']['reviewFlagCount'], 1)
        self.assertEqual(by_id[1]['reviewFlagCount'], 1)
        self.assertEqual(by_id[3]['reviewFlagCount'], 0, '其他學生不受影響')
        # 教師覆核後旗標清除：已定案就不需要再提示。
        self.review(flagged, score=6)
        self.assertEqual(self.teacher_attempt(aid, flagged['id'])['reviewFlags'], [])
        self.assertEqual(self.results(aid)['summary']['reviewFlagCount'], 0)

        # 4) 反方向：答案不對但 AI 給接近滿分 → 另一個旗標。
        full = {'score': 6, 'feedback': '很好', 'steps': [{'label': '整體', 'earned': 6, 'max': 6, 'comment': ''}]}
        with patch.object(self.app.ai, 'call', return_value=full):
            lower = self.teacher_attempt(aid, self.attempt(aid, 1, answer='x=1或6')['id'])
        self.assertEqual([f['code'] for f in lower['reviewFlags']], ['rule-lower'])

        # 5) 學生自主練習即時評分：沒有教師覆核這一步，不需要旗標。
        with patch.object(self.app.ai, 'call', return_value=low):
            practice = self.attempt(None, 1, answer='x=2或3')
        self.assertEqual(practice['gradingMethod'], 'ai-practice')
        with self.app.db() as db:
            raw = db.execute('SELECT review_flags FROM attempts WHERE id=?', (practice['id'],)).fetchone()[0]
        self.assertEqual(raw, '[]', '自主練習不產生建議覆核旗標')

    def test_ai_grading_prompt_states_policy_and_rule_hint(self):
        """批改提示要寫明評分政策，並把可重現的規則核對結果當提示（不是當答案）。"""
        self.configure_ai()
        aid = self.ai_assignment((1,))
        payload = {'score': 6, 'feedback': '全對', 'steps': [{'label': '整體', 'earned': 6, 'max': 6, 'comment': ''}]}
        with patch.object(self.app.ai, 'call', return_value=payload) as ai:
            self.attempt(aid, 1, answer='x=2或3')
        instruction, sent = ai.call_args_list[0][0][0], ai.call_args_list[0][0][1]
        for line in ('評分政策', '數學等價', '不要推測', '選擇題以選項字母判對', '輸出前請再檢查'):
            self.assertIn(line, instruction)
        self.assertIn('ruleCheck', sent, '要把規則核對結果餵給模型當提示')
        self.assertIn('只是字串比對', sent['ruleCheck'], '要明說那只是字串比對，不是標準答案')
        # 批改不指定 temperature（預設 0，可重現），與生成變式題的高溫不同。
        self.assertIn(ai.call_args_list[0][1].get('temperature'), (None, 0))

    def test_concurrent_finalize_only_one_state(self):
        aid = self.assignment((1,))
        self.attempt(aid)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.finalize(aid), range(2)))
        self.assertEqual(results[0], results[1])

    def test_late_forbidden_and_allowed(self):
        aid = self.assignment((1,))
        self.attempt(aid)
        self.expire(aid)
        self.error(403, 'POST', f'/api/assignments/{aid}/submit')
        self.error(403, 'POST', '/api/attempts', {'assignmentId': aid, 'questionId': 1, 'answerText': '2'})
        allowed = self.assignment((1,), allowLate=True)
        self.expire(allowed)
        self.attempt(allowed)
        self.assertTrue(self.finalize(allowed)['mySubmission']['late'])
        self.assertTrue(next(s for s in self.results(allowed)['students'] if s['id'] == 1)['late'])

    def test_already_submitted_idempotent_after_deadline(self):
        aid = self.assignment((1,))
        self.attempt(aid)
        first = self.finalize(aid)
        self.expire(aid)
        self.assertEqual(self.finalize(aid), first)
        self.assertFalse(first['mySubmission']['late'])

    def test_latest_attempt_audit_and_topic_stats(self):
        aid = self.assignment()
        old = self.attempt(aid, answer='x=2')
        new = self.attempt(aid)
        self.attempt(aid, 2, 'x=3或4')
        # 教師批閱前，學生看不到分數；教師端統計仍只採每題最新作答。
        report = self.detail(aid)['report']
        self.assertIsNone(report['score'])
        self.assertEqual(report['pendingCount'], 2)
        teacher_stats = self.results(aid)['topicStats'][0]
        self.assertEqual(teacher_stats['scoredCount'], 2)
        self.assertEqual(teacher_stats['totalCount'], 4, '2 題 × 2 位收件學生')
        self.assertEqual(teacher_stats['maxScore'], 12)
        self.assertEqual(len(self.detail(aid)['attempts']), 3)
        # 被新作答取代的舊紀錄即使批閱了，也不改變學生看到的分數。
        self.review(old, 1)
        self.assertIsNone(self.detail(aid)['report']['score'])
        self.review(new, 5)
        self.assertEqual(self.detail(aid)['report']['score'], 5)
        self.assertEqual(self.detail(aid)['report']['confirmedCount'], 1)
        self.assertEqual(self.detail(aid)['report']['pendingCount'], 1)

    def test_pending_not_zero_and_empty_scores_null(self):
        aid = self.assignment()
        self.assertIsNone(self.detail(aid)['report']['score'])
        pending = self.attempt(aid, answer='', image=test_server.png_url())
        report = self.detail(aid)['report']
        self.assertIsNone(report['score'])
        self.assertEqual(report['pendingCount'], 1)
        self.assertIsNone(report['topicStats'][0]['percent'])
        self.assertTrue(report['awaitingReview'])
        self.assertIsNone(report['suggestion'], '教師批閱前不顯示學習建議')
        self.assertIn('待批阅', self.teacher_attempt(aid, pending['id'])['suggestion']['notice'])
        self.attempt(aid, 2, 'x=3或4')
        self.finalize(aid)
        report = self.detail(aid)['report']
        # 教師批閱前，即使題目已由規則評分，學生也看不到分數。
        self.assertIsNone(report['score'])
        self.assertEqual(report['totalScoredPoints'], 0)
        self.assertEqual(report['pendingCount'], 2)
        self.assertEqual(report['topicStats'][0]['percent'], None)
        self.assertIsNone(self.results(aid)['summary']['averageScore'])
        self.assertEqual(self.results(aid)['summary']['pendingReviewCount'], 1)
        # 教師批閱後才揭露分數（只計已批閱題目，待批不當零分）。
        text = self.teacher_attempt(aid, self.detail(aid, self.teacher)['attempts'][0]['id'])
        reviewed = self.review(text, 6)
        self.assertEqual(reviewed['attempt']['score'], 6)
        report = self.detail(aid)['report']
        self.assertEqual(report['score'], 6)
        self.assertEqual(report['totalScoredPoints'], 6)
        self.assertEqual(report['topicStats'][0]['percent'], 100)
        self.assertEqual(report['pendingCount'], 1)
        self.assertTrue(report['awaitingReview'])

    def test_averages_only_formal_complete_and_confirmed(self):
        aid = self.assignment()
        a = self.attempt(aid)
        b = self.attempt(aid, 2, 'x=3或4')
        self.assertIsNone(self.results(aid)['summary']['averageScore'])
        self.finalize(aid)
        self.attempt(aid, answer='x=2', user=self.other)
        results = self.results(aid)
        self.assertEqual(results['summary']['averageScore'], 12)
        self.assertIsNone(results['summary']['confirmedAverage'])
        self.assertEqual([s['name'] for s in results['students']], ['A学生', '演示學生'])
        self.review(a, 5)
        self.assertIsNone(self.results(aid)['summary']['confirmedAverage'])
        self.review(b, 4)
        summary = self.results(aid)['summary']
        self.assertEqual(summary['averageScore'], 9)
        self.assertEqual(summary['confirmedAverage'], 9)
        self.assertEqual(summary['submittedCount'], 1)
        self.assertEqual(summary['fullyGradedCount'], 1)

    def test_teacher_review_preserves_rule_score_and_updates_report(self):
        aid = self.assignment((1,))
        a = self.attempt(aid)
        self.finalize(aid)
        result = self.review(a, 4)
        self.assertEqual(result['attempt']['ruleScore'], 6)
        self.assertEqual(result['attempt']['confirmedScore'], 4)
        self.assertEqual(result['attempt']['score'], 4)
        self.assertEqual(result['report']['confirmedScore'], 4)
        self.assertEqual(result['attempt']['suggestion']['source'], 'rules')
        self.assertIn('过程正确', result['attempt']['suggestion']['focus'])
        self.review(a, 3)
        self.assertEqual(self.detail(aid)['report']['ruleScore'], 6)
        self.assertEqual(self.detail(aid)['report']['confirmedScore'], 3)

    def test_ai_suggestion_success_and_recommendation_validation(self):
        self.configure_ai()
        aid = self.ai_assignment((1,))
        suggestion = {'strength': '因式分解部分已获分', 'focus': '补充两根', 'nextStep': '检验两根', 'recommendedIds': [99999, 2, 2]}
        with patch.object(self.app.ai, 'call', side_effect=[self.ai_result(), suggestion]) as ai:
            a = self.attempt(aid, answer='x=2')
        self.assertEqual(ai.call_count, 2)
        stored = self.teacher_attempt(aid, a['id'])
        self.assertEqual(stored['suggestion']['source'], 'ai')
        self.assertEqual(stored['suggestion']['recommended'], [{'id': 2, 'title': '相似題：整數根', 'kind': 'similar'}])
        self.assertEqual(stored['aiScore'], 4)
        self.assertIsNone(stored['ruleScore'])
        # 學生端：教師批閱前看不到分數、AI 原分、步驟與學習建議。
        self.assertIsNone(a['score'])
        self.assertIsNone(a['aiScore'])
        self.assertIsNone(a['suggestion'])
        self.assertEqual(a['steps'], [])
        self.assertEqual(self.results(aid)['summary']['pendingReviewCount'], 1)
        reviewed = self.review(a, 5)['attempt']
        self.assertEqual(reviewed['aiScore'], 4)
        self.assertEqual(reviewed['confirmedScore'], 5)
        self.assertEqual(reviewed['suggestion']['source'], 'rules')
        self.assertEqual(self.results(aid)['summary']['pendingReviewCount'], 0)
        # 教師批閱後，學生才看到分數與教師確認分。
        own = self.student_attempt(aid, a['id'])
        self.assertEqual(own['score'], 5)
        self.assertEqual(own['confirmedScore'], 5)
        self.assertNotIn('awaitingReview', own)
        self.assertTrue(own['suggestion']['source'])

    def test_ai_suggestion_failure_saved_grade_and_old_mock_compatible(self):
        self.configure_ai()
        aid = self.ai_assignment((1,))
        for failure in (server.APIError(502, '测试模型异常'), {'score': 4, 'feedback': '旧 mock', 'steps': []},
                        {'strength': '已评分', 'focus': [], 'nextStep': '复查'}, RuntimeError('模型异常')):
            with patch.object(self.app.ai, 'call', side_effect=[self.ai_result(), failure]):
                a = self.attempt(aid)
            stored = self.teacher_attempt(aid, a['id'])
            self.assertEqual(stored['score'], 4)
            self.assertEqual(stored['aiScore'], 4)
            self.assertEqual(stored['suggestion']['source'], 'rules')
            self.assertIn('已保留批改成绩', stored['suggestion']['notice'])
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0], 4)

    def test_grade_saved_before_second_ai_call(self):
        self.configure_ai()
        aid = self.ai_assignment((1,))
        calls = []
        def model(*args, **kwargs):
            calls.append(args)
            if len(calls) == 1:
                return self.ai_result()
            with self.app.db() as db:
                saved = db.execute('SELECT * FROM attempts').fetchone()
                self.assertEqual(saved['score'], 4)
                self.assertEqual(saved['ai_score'], 4)
            raise server.APIError(502, '建议服务失败')
        with patch.object(self.app.ai, 'call', side_effect=model):
            a = self.attempt(aid)
        stored = self.teacher_attempt(aid, a['id'])
        self.assertEqual(stored['score'], 4)
        self.assertIn('失败', stored['suggestion']['notice'])

    def test_ai_history_only_own_graded_same_topic_five(self):
        for _ in range(7):
            self.attempt()
        self.attempt(user=self.other)
        self.attempt(qid=6, answer='7')
        self.attempt(answer='', image=test_server.png_url())
        self.configure_ai()
        aid = self.ai_assignment((1,))
        suggestion = {'strength': '已评分', 'focus': '补充结论', 'nextStep': '复查'}
        with patch.object(self.app.ai, 'call', side_effect=[self.ai_result(), suggestion]) as ai:
            self.attempt(aid)
        payload = ai.call_args_list[1].args[1]
        self.assertEqual(len(payload['recent']), 5)
        self.assertTrue(all(r['topic'] == '一元二次方程' and r['score'] == 6 for r in payload['recent']))
        self.assertNotIn('user_id', json.dumps(payload))
        self.assertNotIn('password', json.dumps(payload))

    def test_ai_failure_no_fake_grade_and_consent(self):
        self.configure_ai(external=True)
        aid = self.ai_assignment((1,))
        with patch.object(self.app.ai, 'call') as ai:
            self.error(403, 'POST', '/api/attempts', {'assignmentId': aid, 'questionId': 1, 'answerText': '2'})
            ai.assert_not_called()
        with patch.object(self.app.ai, 'call', side_effect=server.APIError(502, '失败')):
            attempt = self.call('POST', '/api/attempts',
                                {'assignmentId': aid, 'questionId': 1, 'answerText': '2',
                                 'consentExternal': True})['attempt']
        # 模型失敗時不偽造分數，但一定要保住學生的作答：改為等待教師批閱，不自動用規則給分。
        self.assertIsNone(attempt['score'])
        self.assertEqual(attempt['gradingMethod'], 'awaiting-review')
        stored = self.teacher_attempt(aid, attempt['id'])
        self.assertEqual(stored['gradingMethod'], 'pending-teacher')
        self.assertIsNone(stored['score'])
        self.assertIn('AI 建議評分暫時無法使用', stored['feedback'])
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0], 1)

    def test_rules_each_free_attempt_pending_and_recommendable_only(self):
        with self.app.db() as db:
            self.app.insert_question(db, {**server.seed_questions()[0], 'source': 'AI 生成 · 待核驗'})
        for answer in ('x=2或3', 'x=2'):
            a = self.attempt(answer=answer)
            self.assertEqual(a['suggestion']['source'], 'rules')
            self.assertNotIn(17, [r['id'] for r in a['suggestion']['recommended']])
            self.assertIn('未', a['suggestion']['focus'])
        pending = self.attempt(answer='', image=test_server.png_url())
        self.assertIsNone(pending['score'])
        self.assertIsNone(pending['ruleScore'])
        self.assertIn('不能判断具体错误', pending['suggestion']['focus'])
        self.assertEqual(pending['suggestion']['source'], 'rules')

    def test_privacy_state_attempts_images_and_reviews(self):
        aid = self.assignment((1,))
        a = self.attempt(aid, answer='', image=test_server.png_url())
        free = self.attempt(answer='', image=test_server.png_url())
        self.error(403, 'POST', f'/api/attempts/{a["id"]}/review', {'score': 4, 'feedback': '测试'}, self.teacher2)
        self.review(free, 4, self.teacher2)
        state = self.call('GET', '/api/state', user=self.teacher2)
        self.assertEqual([r['id'] for r in state['attempts']], [free['id']])
        self.assertEqual(self.detail(aid, self.other)['attempts'], [])
        self.assertIsNone(self.call('GET', '/api/homework', user=self.other)['assignments'][0]['submittedCount'])
        self.assertIsNone(self.call('GET', '/api/homework', user=self.other)['assignments'][0]['gradedCount'])
        with self.app.db() as db:
            row = db.execute('SELECT * FROM attempts WHERE id=?', (a['id'],)).fetchone()
            self.assertTrue(self.app.homework.can_access_attempt(db, row, self.student))
            self.assertTrue(self.app.homework.can_access_attempt(db, row, self.teacher))
            self.assertFalse(self.app.homework.can_access_attempt(db, row, self.teacher2))
            self.assertFalse(self.app.homework.can_access_attempt(db, row, self.other))
        # 不监听端口，直接运行原 Handler 图片路由验证实际权限。
        for user, expected in ((self.student, 200), (self.teacher, 200), (self.teacher2, 404), (self.other, 404)):
            handler = object.__new__(server.Handler)
            handler.headers = test_server.http.client.HTTPMessage()
            handler.headers['Host'] = 'localhost:8765'
            handler.command, handler.path = 'GET', a['image']
            handler.client_address = ('127.0.0.1', 0)
            handler.server = type('TestServer', (), {'hosts': {'localhost:8765'}, 'app': self.app})()
            captured = []
            handler.respond = lambda status, *args, **kwargs: captured.append(status)
            with patch.object(self.app, 'current_user', return_value=(user, None)):
                handler.handle_route()
            self.assertEqual(captured, [expected])

    def test_pending_review_uses_latest_assignment_only(self):
        aid = self.assignment((1,))
        old = self.attempt(aid, answer='', image=test_server.png_url())
        self.attempt(answer='', image=test_server.png_url())
        self.assertEqual(self.results(aid)['summary']['pendingReviewCount'], 1)
        self.attempt(aid)
        self.assertEqual(self.results(aid)['summary']['pendingReviewCount'], 0)
        self.review(old)
        self.assertEqual(self.results(aid)['summary']['pendingReviewCount'], 0)

    def test_submit_race_with_ai_attempt_rechecks_finalized(self):
        self.configure_ai()
        aid = self.ai_assignment((1,))
        with patch.object(self.app.ai, 'call', return_value=self.ai_result()):
            self.attempt(aid)
        def model(*args, **kwargs):
            self.finalize(aid)
            return self.ai_result()
        with patch.object(self.app.ai, 'call', side_effect=model):
            self.error(403, 'POST', '/api/attempts', {'assignmentId': aid, 'questionId': 1, 'answerText': 'x=2'})
        self.assertEqual(len(self.detail(aid)['attempts']), 1)

    def test_teacher_review_during_ai_suggestion_not_overwritten(self):
        self.configure_ai()
        aid = self.ai_assignment((1,))
        count = 0
        def model(*args, **kwargs):
            nonlocal count
            count += 1
            if count == 1:
                return self.ai_result()
            with self.app.db() as db:
                row = db.execute('SELECT id FROM attempts').fetchone()
            self.review({'id': row['id']}, 5)
            return {'strength': 'AI', 'focus': 'AI', 'nextStep': 'AI'}
        with patch.object(self.app.ai, 'call', side_effect=model):
            a = self.attempt(aid)
        self.assertEqual(a['score'], 5)
        self.assertEqual(a['aiScore'], 4)
        self.assertEqual(a['suggestion']['source'], 'rules')

    def test_two_complete_submissions_average_without_unsubmitted_zero(self):
        aid = self.assignment((1,))
        self.attempt(aid)
        self.finalize(aid)
        self.attempt(aid, answer='x=2', user=self.other)
        self.finalize(aid, self.other)
        summary = self.results(aid)['summary']
        self.assertEqual(summary['averageScore'], 3)
        self.assertEqual(summary['fullyGradedCount'], 2)
        self.assertIsNone(summary['confirmedAverage'])
        self.assertEqual(self.call('GET', '/api/homework', user=self.teacher)['assignments'][0]['gradedCount'], 2)

    def test_topic_stats_multiple_topics_and_unanswered_excluded(self):
        aid = self.assignment((1, 6))
        attempt = self.attempt(aid)
        # 教師批閱前學生看不到分數與百分比，但要看得到批閱進度。
        report = self.detail(aid)['report']
        self.assertIsNone(report['score'])
        self.assertEqual(report['pendingCount'], 1, '只有已作答但未批閱的題目才算待批閱')
        self.assertEqual({s['topic']: s['percent'] for s in report['topicStats']},
                         {'一元二次方程': None, '函數': None})
        # 教師端（含未批閱）統計只計已評題目，未作答不當零分。
        stats = {s['topic']: s for s in self.results(aid)['topicStats']}
        self.assertEqual(stats['一元二次方程']['score'], 6)
        self.assertEqual(stats['函數']['totalCount'], 2)
        self.assertEqual(stats['函數']['scoredCount'], 0)
        self.assertIsNone(stats['函數']['percent'])
        # 教師批閱後才揭露該題分數。
        self.review(attempt, 6)
        after = self.detail(aid)['report']
        self.assertEqual(after['score'], 6)
        self.assertEqual(after['pendingCount'], 0, '唯一已作答的題目已批閱')
        self.assertEqual({s['topic']: s['percent'] for s in after['topicStats']},
                         {'一元二次方程': 100.0, '函數': None})

    def test_ai_assignment_uses_snapshot_in_model_payload(self):
        self.configure_ai()
        aid = self.ai_assignment((1,))
        with self.app.db() as db:
            q = self.app.get_question(db, 1)
            q.update(answer='999', content='改题', points=100)
            db.execute('UPDATE questions SET payload=? WHERE id=1', (json.dumps(q),))
        with patch.object(self.app.ai, 'call', side_effect=[self.ai_result(),
                          {'strength': '已评分', 'focus': '补两根', 'nextStep': '复查'}]) as ai:
            a = self.attempt(aid)
        reference = ai.call_args_list[0].args[1]['question']
        self.assertEqual(reference['answer'], '$x=2$ 或 $x=3$')
        self.assertEqual(reference['points'], 6)
        self.assertEqual(a['maxScore'], 6)

    def test_full_pending_formal_submission_and_review_recalculates_average(self):
        aid = self.assignment((1,))
        a = self.attempt(aid, answer='', image=test_server.png_url())
        self.finalize(aid)
        self.assertIsNone(self.results(aid)['summary']['averageScore'])
        self.assertEqual(self.results(aid)['summary']['pendingReviewCount'], 1)
        self.review(a, 5)
        summary = self.results(aid)['summary']
        self.assertEqual(summary['averageScore'], 5)
        self.assertEqual(summary['confirmedAverage'], 5)
        self.assertEqual(summary['pendingReviewCount'], 0)
        self.assertEqual(self.detail(aid)['report']['pendingCount'], 0)

    def test_persistence_and_additive_legacy_migration(self):
        legacy_dir = Path(self.tmp.name) / 'legacy'
        legacy_dir.mkdir()
        legacy = sqlite3.connect(legacy_dir / 'mathpath.sqlite3')
        legacy.executescript('''
            CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            INSERT INTO meta VALUES('initialized','1');
            CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,
                role TEXT NOT NULL,password TEXT NOT NULL,demo INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE questions(id INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL);
            CREATE TABLE attempts(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id),
                question_id INTEGER NOT NULL REFERENCES questions(id),answer_text TEXT NOT NULL,image BLOB,image_mime TEXT,
                score REAL,max_score INTEGER NOT NULL,status TEXT NOT NULL,feedback TEXT NOT NULL,submitted_at TEXT NOT NULL,
                method TEXT NOT NULL,ai_steps TEXT NOT NULL DEFAULT '[]',teacher_reviewed INTEGER NOT NULL DEFAULT 0,
                reviewed_by INTEGER REFERENCES users(id),reviewed_at TEXT);
        ''')
        legacy.execute('INSERT INTO users VALUES(?,?,?,?,?,?)', (1, 'legacy', '原用户', 'student', self.student['password'], 0))
        # 舊題目 payload 沒有 qtype／subtopic（欄位是後來才加的），遷移時要依題面回填。
        legacy_q = {k: v for k, v in server.seed_questions()[0].items() if k not in ('qtype', 'subtopic')}
        legacy.execute('INSERT INTO questions(payload) VALUES(?)', (json.dumps(legacy_q),))
        for method, reviewed, score in [('ai-advisory', 0, 4), ('rule-final', 0, 6), ('teacher-reviewed', 1, 5), ('pending-teacher', 0, None)]:
            legacy.execute('INSERT INTO attempts(user_id,question_id,answer_text,score,max_score,status,feedback,submitted_at,method,teacher_reviewed) '
                           'VALUES(1,1,?,?,?,?,?,?,?,?)', ('2', score, 6, 'pending' if score is None else 'graded', '原评语', server.utc_now(), method, reviewed))
        legacy.commit()
        legacy.close()
        migrated = server.Application(legacy_dir)
        migrated.safe_initialize()
        server.Application(legacy_dir).safe_initialize()
        with migrated.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM users').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT count(*) FROM questions').fetchone()[0], 1)
            backfilled = json.loads(db.execute('SELECT payload FROM questions WHERE id=1').fetchone()['payload'])
            self.assertEqual(backfilled['qtype'], '解答題', '舊題目缺少 qtype 時應依題面回填')
            self.assertEqual(backfilled['subtopic'], '')
            rows = db.execute('SELECT * FROM attempts ORDER BY id').fetchall()
            self.assertEqual(len(rows), 4)
            self.assertEqual(rows[0]['ai_score'], 4)
            self.assertEqual(rows[1]['rule_score'], 6)
            self.assertEqual(rows[2]['teacher_confirmed_score'], 5)
            self.assertIsNone(rows[2]['ai_score'])
            self.assertIsNone(rows[2]['rule_score'])
            self.assertIsNone(rows[3]['score'])
            self.assertTrue(all(json.loads(r['suggestion'])['source'] == 'rules' for r in rows))
        aid = self.assignment((1,))
        self.attempt(aid)
        self.finalize(aid)
        again = server.Application(self.app.data_dir)
        again.safe_initialize()
        result = again.dispatch('GET', f'/api/assignments/{aid}', {}, self.student, None, '127.0.0.1')[0]
        self.assertEqual(result['mySubmission']['status'], 'submitted')
        # 教師批閱前，學生看不到分數（作業一律如此）。
        self.assertIsNone(result['report']['score'])
        self.assertEqual(result['report']['pendingCount'], 1)
        self.assertTrue(result['report']['awaitingReview'])


    def test_teacher_adjusts_ai_marks_positions(self):
        aid = self.assignment((1,))
        a = self.attempt(aid, answer='', image=test_server.png_url())
        path = f"/api/attempts/{a['id']}/ai-annotation"
        marks = {'issues': [{'x': 0.2, 'y': 0.4, 'label': '符號錯誤', 'comment': '這裡應為負號'},
                            {'x': 0.7, 'y': 0.8, 'label': '漏寫第二個根', 'comment': '應補上另一解'}],
                 'summary': '兩處需修正'}
        self.configure_ai()
        self.app.ai.vision = 'vision-model'
        with patch.object(self.app.ai, 'call', return_value=marks) as ai:
            self.call('POST', path, {}, self.teacher)
        self.assertEqual(ai.call_count, 1)
        # 教師移動標記：只更新座標，不再呼叫模型，也不改動分數。
        moved = {'issues': [{'x': 0.31, 'y': 0.52, 'label': '符號錯誤', 'comment': '這裡應為負號'},
                            {'x': 0.66, 'y': 0.73, 'label': '漏寫第二個根', 'comment': '應補上另一解'}],
                 'summary': '兩處需修正'}
        with patch.object(self.app.ai, 'call', return_value=marks) as ai:
            result = self.call('POST', path, {'marks': moved}, self.teacher)['attempt']
        self.assertEqual(ai.call_count, 0)
        self.assertTrue(result['aiAnnotation']['adjusted'])
        self.assertEqual([i['x'] for i in result['aiAnnotation']['issues']], [0.31, 0.66])
        self.assertEqual([i['y'] for i in result['aiAnnotation']['issues']], [0.52, 0.73])
        self.assertIsNone(result['score'])
        self.assertEqual(result['status'], 'pending')
        # AI 批註屬 AI 批閱結果：教師批閱前學生看不到；批閱後才揭露教師調整過的位置。
        own = self.student_attempt(aid, a['id'])
        self.assertNotIn('aiAnnotation', own)
        self.assertTrue(own['awaitingReview'])
        self.review(a, 5)
        after = self.student_attempt(aid, a['id'])
        self.assertTrue(after['aiAnnotation']['adjusted'])
        self.assertAlmostEqual(after['aiAnnotation']['issues'][0]['x'], 0.31)
        # 權限：其他教師與學生都不能移動標記。
        self.error(403, 'POST', path, {'marks': moved}, self.teacher2)
        self.error(403, 'POST', path, {'marks': moved}, self.student)
        # 調整後的座標仍須通過同一套驗證，不可放寬。
        self.error(400, 'POST', path, {'marks': 'nope'}, self.teacher)
        # 教師送來的壞座標是「用戶端資料錯誤」＝400，不再是上游模型失敗的 502。
        self.error(400, 'POST', path, {'marks': {'issues': [{'x': 1.4, 'y': 0.5, 'label': 'a', 'comment': 'b'}]}}, self.teacher)
        self.error(400, 'POST', path, {'marks': moved, 'unknown': 1}, self.teacher)
        # 教師也可以把批語框／印章搬到別的位置，並改寫 AI 的說明文字。
        placed = {**moved,
                  'issues': [dict(moved['issues'][0], comment='這裡應為負號，而且在移項之後。'), moved['issues'][1]],
                  'placements': {'issue:0': {'x': 0.62, 'y': 0.18}, 'stamp': {'x': 0.9, 'y': 0.1},
                                 'summary': {'x': 0.5, 'y': 0.9}}}
        saved = self.call('POST', path, {'marks': placed}, self.teacher)['attempt']
        self.assertEqual(saved['aiAnnotation']['placements']['issue:0'], {'x': 0.62, 'y': 0.18})
        self.assertEqual(saved['aiAnnotation']['placements']['stamp'], {'x': 0.9, 'y': 0.1})
        self.assertEqual(saved['aiAnnotation']['issues'][0]['comment'], '這裡應為負號，而且在移項之後。')
        self.assertEqual(saved['aiAnnotation']['issues'][0]['label'], '符號錯誤', '只改說明時標籤不變')
        # 位置鍵與座標一樣要嚴格檢查。
        self.error(400, 'POST', path, {'marks': {**moved, 'placements': {'note': {'x': 0.1, 'y': 0.1}}}}, self.teacher)
        self.error(400, 'POST', path, {'marks': {**moved, 'placements': {'issue:0': {'x': 1.4, 'y': 0.1}}}}, self.teacher)
        # 未經 AI 產生批註前，教師仍可保存自己修訂的位置（不呼叫模型）。
        other = self.attempt(aid, answer='', image=test_server.png_url())
        with patch.object(self.app.ai, 'call', return_value=marks) as ai:
            fresh = self.call('POST', f"/api/attempts/{other['id']}/ai-annotation",
                              {'marks': moved}, self.teacher)['attempt']
        self.assertEqual(ai.call_count, 0)
        self.assertTrue(fresh['aiAnnotation']['adjusted'])
        self.assertEqual(len(fresh['aiAnnotation']['issues']), 2)

    # ---------- 学生自助模拟测验 ----------
    def mock(self, **kwargs):
        body = {'count': 3, 'minutes': 30, **kwargs}
        return self.call('POST', '/api/mock', body)

    def mock_detail(self, eid, user=None):
        return self.call('GET', f'/api/mock/{eid}', user=user)

    def mock_submit(self, eid, user=None):
        return self.call('POST', f'/api/mock/{eid}/submit', user=user)

    def bank_answers(self):
        with self.app.db() as db:
            return {r['id']: json.loads(r['payload']) for r in db.execute('SELECT id,payload FROM questions')}

    def answer_mock(self, eid, questions, correct=True, user=None, only=None):
        bank = self.bank_answers()
        for q in questions:
            if only is not None and q['id'] != only:
                continue
            text = bank[q['id']]['answer'] if correct else 'x=0'
            self.call('POST', '/api/attempts',
                      {'questionId': q['id'], 'answerText': text, 'mockId': eid}, user)

    def test_calendar_notes_create_list_and_delete(self):
        today = datetime.now(timezone.utc).date().isoformat()
        created = self.call('POST', '/api/calendar/notes',
                            {'date': today, 'title': '收齊作業', 'note': '下午三點前'}, self.teacher)
        self.assertEqual(created['note']['title'], '收齊作業')
        self.assertEqual(created['note']['date'], today)
        self.assertEqual(created['note']['note'], '下午三點前')
        nid = created['note']['id']
        # 教師自己的日曆看得到這則提醒
        mine_cal = self.calendar(today, today, self.teacher)
        self.assertEqual([n['id'] for n in mine_cal['notes']], [nid])
        self.assertEqual(mine_cal['notes'][0]['title'], '收齊作業')
        # 學生看不到別人的提醒
        self.assertEqual(self.calendar(today, today)['notes'], [])
        # 學生可以新增並看到自己的提醒
        self.call('POST', '/api/calendar/notes', {'date': today, 'title': '溫習測驗'})
        student_cal = self.calendar(today, today)
        self.assertEqual(len(student_cal['notes']), 1)
        self.assertEqual(student_cal['notes'][0]['title'], '溫習測驗')
        self.assertEqual(self.calendar(today, today, self.teacher)['notes'][0]['id'], nid)
        # 不能刪除別人的提醒
        self.error(404, 'POST', f'/api/calendar/notes/{student_cal["notes"][0]["id"]}/delete', {}, self.teacher)
        # 刪除自己的提醒後不再出現
        deleted = self.call('POST', f'/api/calendar/notes/{nid}/delete', {}, self.teacher)
        self.assertEqual(deleted['deleted'], nid)
        self.assertEqual(self.calendar(today, today, self.teacher)['notes'], [])
        # 不存在的提醒
        self.error(404, 'POST', '/api/calendar/notes/999999/delete', {}, self.teacher)

    def test_calendar_notes_validation(self):
        today = datetime.now(timezone.utc).date().isoformat()
        self.error(400, 'POST', '/api/calendar/notes', {'date': '2026-13-01', 'title': 'x'}, self.teacher)
        self.error(400, 'POST', '/api/calendar/notes', {'date': '20260101', 'title': 'x'}, self.teacher)
        self.error(400, 'POST', '/api/calendar/notes', {'date': today}, self.teacher)
        self.error(400, 'POST', '/api/calendar/notes', {'date': today, 'title': ''}, self.teacher)
        self.error(400, 'POST', '/api/calendar/notes', {'date': today, 'title': 'x', 'unknown': 1}, self.teacher)
        self.error(400, 'POST', '/api/calendar/notes', {'date': today, 'title': 'x' * 121}, self.teacher)
        self.error(400, 'POST', '/api/calendar/notes', {'date': today, 'title': 'x', 'note': 'y' * 2001}, self.teacher)
        # 內容可留空
        ok = self.call('POST', '/api/calendar/notes', {'date': today, 'title': '只有標題'}, self.teacher)
        self.assertEqual(ok['note']['note'], '')

    def test_mock_exam_start_answer_submit_and_instant_scoring(self):
        started = self.mock(topic='一元二次方程', count=5, minutes=30)
        exam, questions = started['exam'], started['questions']
        self.assertEqual(exam['status'], 'in_progress')
        self.assertEqual(exam['minutes'], 30)
        self.assertEqual(len(questions), 5)
        self.assertEqual(exam['questionCount'], 5)
        self.assertGreater(exam['remainingSeconds'], 0)
        # 学生版题目不得泄露答案与步骤。
        for q in questions:
            self.assertNotIn('answer', q)
            self.assertNotIn('steps', q)
            self.assertIn('qtype', q)
        # 尚未作答不能提交。
        self.error(400, 'POST', f"/api/mock/{exam['id']}/submit")
        self.answer_mock(exam['id'], questions)
        result = self.mock_submit(exam['id'])
        report = result['report']
        total = sum(q['points'] for q in questions)
        self.assertEqual(report['score'], total, '全對應得滿分')
        self.assertEqual(report['maxScore'], total)
        self.assertEqual(report['percent'], 100.0)
        self.assertEqual(report['pendingCount'], 0)
        self.assertEqual(report['answeredCount'], 5)
        self.assertEqual(result['exam']['status'], 'submitted')
        self.assertEqual(result['exam']['remainingSeconds'], 0)
        self.assertFalse(result['exam']['expired'])
        for key in ('strength', 'focus', 'nextStep', 'notice'):
            self.assertTrue(report['suggestion'][key])
        # 重複提交必須冪等，不會重複計分。
        again = self.mock_submit(exam['id'])
        self.assertTrue(again.get('alreadySubmitted'))
        self.assertEqual(again['report']['score'], total)
        # 提交後不能再作答。
        self.error(403, 'POST', '/api/attempts',
                   {'questionId': questions[0]['id'], 'answerText': 'x=2或3', 'mockId': exam['id']})
        # 列表可看到成績。
        listing = self.call('GET', '/api/mock')
        item = next(e for e in listing['exams'] if e['id'] == exam['id'])
        self.assertEqual(item['status'], 'submitted')
        self.assertEqual(item['score'], total)
        self.assertEqual(item['percent'], 100.0)
        self.assertIn('一元二次方程', listing['options']['topics'])
        self.assertGreaterEqual(listing['options']['available'], 5)

    def test_mock_exam_time_limit_expiry_and_auto_submit(self):
        started = self.mock(topic='一元二次方程', count=3, minutes=15)
        eid, questions = started['exam']['id'], started['questions']
        # 逾時前先作答一题。
        self.answer_mock(eid, questions, only=questions[0]['id'], correct=False)
        with self.app.db() as db:
            db.execute('UPDATE mock_exams SET expires_at=? WHERE id=?', ('2000-01-01T00:00:00Z', eid))
        self.assertEqual(self.mock_detail(eid)['exam']['remainingSeconds'], 0)
        # 逾時後不可再作答，但仍可提交（自動提交）並標示逾時。
        self.error(403, 'POST', '/api/attempts',
                   {'questionId': questions[1]['id'], 'answerText': '70°', 'mockId': eid})
        result = self.mock_submit(eid)
        self.assertTrue(result['exam']['expired'])
        self.assertEqual(result['report']['answeredCount'], 1)
        self.assertIsNotNone(result['report']['suggestion']['nextStep'])

    def test_mock_exam_rbac_ownership_and_question_scope(self):
        started = self.mock(topic='集中趨勢與離差', count=2, minutes=10)
        eid, questions = started['exam']['id'], started['questions']
        # 教师不能开始或查看学生的模拟测验。
        self.error(403, 'POST', '/api/mock', {'count': 2, 'minutes': 10}, self.teacher)
        self.error(404, 'GET', f'/api/mock/{eid}', user=self.teacher)
        self.error(404, 'GET', f'/api/mock/{eid}', user=self.other)
        # 不能拿别人的测验编号作答。
        self.error(404, 'POST', '/api/attempts',
                   {'questionId': questions[0]['id'], 'answerText': '6', 'mockId': eid}, self.other)
        # 不属于本场测验的题目不能作答。
        other_qid = next(qid for qid in self.bank_answers() if qid not in [x['id'] for x in questions])
        self.error(403, 'POST', '/api/attempts',
                   {'questionId': other_qid, 'answerText': 'x', 'mockId': eid})
        # 不能同时属于作业与模拟测验。
        aid = self.assignment((1,))
        self.error(400, 'POST', '/api/attempts',
                   {'questionId': 1, 'answerText': 'x=2或3', 'assignmentId': aid, 'mockId': eid})

    def test_mock_exam_validation_and_pool_limits(self):
        self.error(400, 'POST', '/api/mock', {'count': 0, 'minutes': 10})
        self.error(400, 'POST', '/api/mock', {'count': 21, 'minutes': 10})
        self.error(400, 'POST', '/api/mock', {'count': 3, 'minutes': 0})
        self.error(400, 'POST', '/api/mock', {'count': 3, 'minutes': 181})
        self.error(400, 'POST', '/api/mock', {'count': 3, 'minutes': 10, 'unknown': 1})
        self.error(400, 'POST', '/api/mock', {'count': 3, 'minutes': 10, 'level': 9})
        # 题库只有 5 题一元二次方程，要求 6 题必须明确拒绝而不是少给。
        self.error(409, 'POST', '/api/mock', {'topic': '一元二次方程', 'count': 6, 'minutes': 10})
        self.error(409, 'POST', '/api/mock', {'topic': '不存在的知識點', 'count': 1, 'minutes': 10})

    def test_mock_exam_pending_not_counted_and_snapshot_immutable(self):
        started = self.mock(topic='一元二次方程', count=5, minutes=20)
        eid, questions = started['exam']['id'], started['questions']
        target = questions[0]
        # 手写图片未接 AI：待批阅，不计分也不当零分。
        self.call('POST', '/api/attempts',
                  {'questionId': target['id'], 'answerText': '', 'image': test_server.png_url(),
                   'mockId': eid})
        self.answer_mock(eid, questions, correct=True, only=questions[1]['id'])
        report = self.mock_submit(eid)['report']
        self.assertEqual(report['pendingCount'], 1)
        self.assertEqual(report['score'], questions[1]['points'], '只计已评分题目')
        self.assertEqual(report['scoredPoints'], questions[1]['points'])
        self.assertLess(report['score'], report['maxScore'], '待批题目不计分，已评得分应少于卷面满分')
        self.assertEqual(report['percent'], 100.0, 'percent 只覆盖已评分的题目')
        self.assertIn('待批阅', report['suggestion']['notice'])
        # 快照不可变：之后修改题库答案，不影响已开始的测验评分。
        started2 = self.mock(topic='集中趨勢與離差', count=2, minutes=20)
        eid2, questions2 = started2['exam']['id'], started2['questions']
        bank = self.bank_answers()
        target2 = questions2[0]
        original = bank[target2['id']]['answer']
        # 模拟题库被改动：参考解答换成 999。
        with self.app.db() as db:
            payload = dict(bank[target2['id']])
            payload['answer'] = '999'
            db.execute('UPDATE questions SET payload=? WHERE id=?',
                       (json.dumps(payload, ensure_ascii=False), target2['id']))
        # 用原本的答案作答仍应判对，证明评分采用开始时的快照。
        self.call('POST', '/api/attempts',
                  {'questionId': target2['id'], 'answerText': original, 'mockId': eid2})
        snapshot_score = self.mock_submit(eid2)['report']
        self.assertEqual(snapshot_score['score'], target2['points'], '应使用快照答案评分')
        self.assertEqual(snapshot_score['maxScore'], sum(q['points'] for q in questions2))

    def test_ai_annotation_coordinates_rbac_and_independence(self):
        aid = self.assignment((1,))
        a = self.attempt(aid, answer='', image=test_server.png_url())
        path = f"/api/attempts/{a['id']}/ai-annotation"
        marks = {'issues': [{'x': 0.25, 'y': 0.6, 'label': '符號錯誤', 'comment': '這裡應為負號'}],
                 'summary': '主要問題在符號處理'}
        # 未設定視覺模型時不產生任何批註。
        self.configure_ai()
        self.error(409, 'POST', path, {}, self.teacher)
        self.app.ai.vision = 'vision-model'
        self.error(403, 'POST', path, {}, self.student)
        self.error(403, 'POST', path, {}, self.teacher2)
        self.error(400, 'POST', path, {'clear': 'yes'}, self.teacher)
        self.error(400, 'POST', path, {'unknown': 1}, self.teacher)
        # 座標超出 0..1、欄位缺漏、型別錯誤、超過20項，一律拒絕且不保存。
        for payload in [
            {'issues': [{'x': 120, 'y': 0.5, 'label': 'a', 'comment': 'b'}]},
            {'issues': [{'x': 0.5, 'y': -0.1, 'label': 'a', 'comment': 'b'}]},
            {'issues': [{'x': 0.5, 'y': 0.5, 'label': 'a'}]},
            {'issues': [{'x': '0.5', 'y': 0.5, 'label': 'a', 'comment': 'b'}]},
            {'issues': [{'x': True, 'y': 0.5, 'label': 'a', 'comment': 'b'}]},
            {'issues': 'nope'},
            {'issues': [{'x': 0.5, 'y': 0.5, 'label': 'a', 'comment': 'b'}] * 21},
        ]:
            with self.subTest(payload=str(payload)[:40]):
                with patch.object(self.app.ai, 'call', return_value=payload):
                    self.error(502, 'POST', path, {}, self.teacher)
        own = next(x for x in self.detail(aid)['attempts'] if x['id'] == a['id'])
        self.assertNotIn('aiAnnotation', own)
        # 成功保存相對座標與說明，且不改動分數。
        with patch.object(self.app.ai, 'call', return_value=marks) as ai:
            result = self.call('POST', path, {}, self.teacher)['attempt']
        self.assertEqual(ai.call_count, 1)
        self.assertEqual(result['aiAnnotation']['issues'], marks['issues'])
        self.assertEqual(result['aiAnnotation']['summary'], marks['summary'])
        self.assertTrue(result['aiAnnotation']['at'])
        self.assertIsNone(result['score'])
        self.assertEqual(result['status'], 'pending')
        self.assertNotIn('annotation', result)
        # 沒有發現錯處時保存空清單，不假裝有錯處。
        with patch.object(self.app.ai, 'call', return_value={'issues': [], 'summary': '未發現可確認的錯誤'}):
            empty = self.call('POST', path, {}, self.teacher)['attempt']
        self.assertNotIn('aiAnnotation', empty)
        # 學生看得到 AI 批註（未經教師確認）。
        with patch.object(self.app.ai, 'call', return_value=marks):
            self.call('POST', path, {}, self.teacher)
        # AI 批註屬 AI 批閱結果：教師批閱前學生看不到。
        own = self.student_attempt(aid, a['id'])
        self.assertNotIn('aiAnnotation', own)
        self.assertTrue(own['awaitingReview'])
        self.assertEqual(self.teacher_attempt(aid, a['id'])['aiAnnotation']['issues'][0]['label'], '符號錯誤')
        # 教師批註與 AI 批註各自獨立保存，清除 AI 不影響教師批註。
        marked = self.call('POST', f"/api/attempts/{a['id']}/annotation", {'image': test_server.png_url()}, self.teacher)['attempt']
        self.assertIn('annotation', marked)
        self.assertIn('aiAnnotation', marked)
        cleared = self.call('POST', path, {'clear': True}, self.teacher)['attempt']
        self.assertNotIn('aiAnnotation', cleared)
        self.assertIn('annotation', cleared)
        # 沒有手寫圖片的作答不能產生 AI 批註。
        text_attempt = self.attempt(None, qid=2, answer='x=3或4')
        self.error(400, 'POST', f"/api/attempts/{text_attempt['id']}/ai-annotation", {}, self.teacher)
        # 外部模型必須明確同意後才可傳送學生手稿。
        self.app.ai.mode = 'external'
        with patch.object(self.app.ai, 'call', return_value=marks) as ai:
            self.error(403, 'POST', path, {}, self.teacher)
        self.assertEqual(ai.call_count, 0)

    def test_annotation_scoped_to_assignment_owner(self):
        aid = self.assignment((1,))
        attempt = self.attempt(aid, answer='', image=test_server.png_url())
        path = f"/api/attempts/{attempt['id']}/annotation"
        self.error(403, 'POST', path, {'image': test_server.png_url()}, self.student)
        # 另一位教師不屬於此作業，不能加批註。
        self.error(403, 'POST', path, {'image': test_server.png_url()}, self.teacher2)
        marked = self.call('POST', path, {'image': test_server.png_url()}, self.teacher)['attempt']
        self.assertEqual(marked['annotation'], path)
        self.assertTrue(marked['annotationAt'])
        self.assertIsNone(marked['score'])
        self.assertEqual(marked['status'], 'pending')
        # 學生在自己的作業詳情看到批註連結。
        detail = self.detail(aid)
        own = next(a for a in detail['attempts'] if a['id'] == attempt['id'])
        self.assertEqual(own['annotation'], path)
        # 批註可重複覆寫，並保留原始手稿。
        with self.app.db() as db:
            first = db.execute('SELECT annotation FROM attempts WHERE id=?', (attempt['id'],)).fetchone()[0]
            self.assertIsNotNone(db.execute('SELECT image FROM attempts WHERE id=?', (attempt['id'],)).fetchone()[0])
        self.call('POST', path, {'image': test_server.png_url()}, self.teacher)
        with self.app.db() as db:
            row = db.execute('SELECT annotation,annotation_mime FROM attempts WHERE id=?', (attempt['id'],)).fetchone()
            self.assertEqual(row['annotation_mime'], 'image/png')
            self.assertIsNotNone(row['annotation'])
            self.assertEqual(len(bytes(first)), len(bytes(row['annotation'])))

    def test_correction_round_return_resubmit_and_scoring(self):
        aid = self.assignment((1, 2))
        self.attempt(aid, qid=1, answer='x=2')
        self.attempt(aid, qid=2, answer='x=3或4')
        self.finalize(aid)
        detail = self.detail(aid)
        self.assertEqual(detail['mySubmission']['status'], 'submitted')
        self.assertEqual(detail['mySubmission']['submitCount'], 1)
        self.assertIsNone(detail['mySubmission']['correction'])
        # 只有作業所屬教師可退回訂正，且必須是已提交的收件學生。
        self.error(403, 'POST', f'/api/assignments/{aid}/return', {'studentId': 1, 'note': '重做'}, self.student)
        self.error(403, 'POST', f'/api/assignments/{aid}/return', {'studentId': 1, 'note': '重做'}, self.teacher2)
        self.error(404, 'POST', f'/api/assignments/{aid}/return', {'studentId': 999, 'note': '重做'}, self.teacher)
        self.error(400, 'POST', f'/api/assignments/{aid}/return', {'studentId': 3, 'note': '重做'}, self.teacher)
        self.error(400, 'POST', f'/api/assignments/{aid}/return', {'studentId': 1, 'note': '   '}, self.teacher)
        self.error(400, 'POST', f'/api/assignments/{aid}/return',
                   {'studentId': 1, 'note': '重做', 'questionIds': [999]}, self.teacher)
        # 已正式提交後不能再作答。
        self.error(403, 'POST', '/api/attempts',
                   {'questionId': 1, 'answerText': 'x=2或3', 'assignmentId': aid}, self.student)
        result = self.call('POST', f'/api/assignments/{aid}/return',
                           {'studentId': 1, 'note': '第1題漏了第二個根，請重新解一次。', 'questionIds': [1]}, self.teacher)
        self.assertEqual(result['correction']['round'], 1)
        self.assertEqual(result['correction']['questionIds'], [1])
        self.assertEqual(result['correction']['note'], '第1題漏了第二個根，請重新解一次。')
        self.assertTrue(result['correction']['requestedAt'])
        self.error(409, 'POST', f'/api/assignments/{aid}/return', {'studentId': 1, 'note': '再一次'}, self.teacher)
        detail = self.detail(aid)
        self.assertEqual(detail['mySubmission']['status'], 'correction')
        self.assertEqual(detail['mySubmission']['correction']['round'], 1)
        # 訂正範圍以外的題目不能重新作答。
        self.error(403, 'POST', '/api/attempts',
                   {'questionId': 2, 'answerText': 'x=3或4', 'assignmentId': aid}, self.student)
        # 未重新作答就提交會被拒；必須是教師要求之後的新作答。
        self.error(400, 'POST', f'/api/assignments/{aid}/submit', {}, self.student)
        fixed = self.attempt(aid, qid=1, answer='x=2或3')
        self.assertEqual(self.teacher_attempt(aid, fixed['id'])['score'], 6)
        submitted = self.call('POST', f'/api/assignments/{aid}/submit', {}, self.student)
        self.assertEqual(submitted['mySubmission']['status'], 'submitted')
        self.assertIsNone(submitted['mySubmission']['correction'])
        self.assertEqual(submitted['mySubmission']['submitCount'], 2)
        self.assertTrue(submitted['mySubmission']['submittedAt'])
        self.assertTrue(submitted['mySubmission']['resubmittedAt'])
        # 教師批閱前學生看不到分數；教師端統計仍是真實分數。
        self.assertIsNone(submitted['report']['score'])
        self.assertEqual(submitted['report']['pendingCount'], 2)
        # 舊作答保留在稽核紀錄，訂正回合已結案。
        with self.app.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM attempts WHERE assignment_id=?', (aid,)).fetchone()[0], 3)
            row = db.execute('SELECT * FROM corrections WHERE assignment_id=?', (aid,)).fetchone()
            self.assertIsNotNone(row['resolved_at'])
            self.assertEqual(row['round'], 1)
        results = self.results(aid)
        self.assertEqual(results['summary']['correctionCount'], 0)
        self.assertEqual(results['summary']['submittedCount'], 1)
        self.assertEqual(results['summary']['averageScore'], 12)
        # 可以再退回一次（第二回合），預設涵蓋全部題目。
        again = self.call('POST', f'/api/assignments/{aid}/return',
                          {'studentId': 1, 'note': '再看一次推導'}, self.teacher)
        self.assertEqual(again['correction']['round'], 2)
        self.assertEqual(sorted(again['correction']['questionIds']), [1, 2])
        results = self.results(aid)
        self.assertEqual(results['summary']['correctionCount'], 1)
        self.assertEqual(next(s for s in results['students'] if s['id'] == 1)['correction']['round'], 2)
        # 訂正中不計入平均，避免以未定稿分數代表學習成果。
        self.assertIsNone(results['summary']['averageScore'])
        # 教師要求的訂正不受截止時間限制。
        with self.app.db() as db:
            db.execute('UPDATE assignments SET due_at=?,allow_late=0 WHERE id=?',
                       ((datetime.now(timezone.utc) - timedelta(days=1)).isoformat(), aid))
        self.attempt(aid, qid=1, answer='x=2或3')
        self.attempt(aid, qid=2, answer='x=3或4')
        done = self.call('POST', f'/api/assignments/{aid}/submit', {}, self.student)
        self.assertEqual(done['mySubmission']['status'], 'submitted')
        self.assertEqual(done['mySubmission']['submitCount'], 3)
        self.assertEqual(done['mySubmission']['late'], False, '訂正不應被標記為遲交')

    def test_timed_quiz_start_expiry_and_review_before_score(self):
        # 建立限時模擬測驗
        aid = self.assignment((1,), kind='quiz', durationMinutes=30)
        detail = self.detail(aid)
        self.assertEqual(detail['assignment']['kind'], 'quiz')
        self.assertEqual(detail['assignment']['durationMinutes'], 30)
        self.assertIsNone(detail['mySubmission']['startedAt'])
        self.assertIsNone(detail['mySubmission']['remainingSeconds'])
        # 未開始前不能作答
        self.error(400, 'POST', '/api/attempts',
                   {'questionId': 1, 'answerText': 'x=2或3', 'assignmentId': aid})
        # 只有學生可以開始，教師被拒
        self.error(403, 'POST', f'/api/assignments/{aid}/start', {}, self.teacher)
        # 開始計時
        started = self.call('POST', f'/api/assignments/{aid}/start', {}, self.student)['mySubmission']
        self.assertIsNotNone(started['startedAt'])
        self.assertGreater(started['remainingSeconds'], 1700)
        self.assertLessEqual(started['remainingSeconds'], 1800)
        self.assertFalse(started['expired'])
        # 重複開始不會重置時間
        again = self.call('POST', f'/api/assignments/{aid}/start', {}, self.student)['mySubmission']
        self.assertEqual(again['startedAt'], started['startedAt'])
        self.assertLessEqual(again['remainingSeconds'], started['remainingSeconds'])
        # 開始後可以作答；提交後學生只看到「等待教師批閱」，不即時看到分數與 AI 結果
        self.attempt(aid, qid=1, answer='x=2或3')
        submitted = self.call('POST', f'/api/assignments/{aid}/submit', {}, self.student)
        report = submitted['report']
        self.assertIsNone(report['score'])
        self.assertEqual(report['pendingCount'], 1)
        self.assertTrue(report['awaitingReview'])
        self.assertIsNone(report['suggestion'])
        self.assertEqual(report['maxScore'], 6)
        self.assertEqual(report['questionCount'], 1)
        self.assertIsNotNone(submitted['mySubmission']['submittedAt'])
        self.assertGreaterEqual(submitted['mySubmission']['timeUsedSeconds'], 0)
        # 教師批閱後，學生才看到分數、百分比與學習建議。
        quiz_attempt = self.student_attempt(aid, self.detail(aid, self.teacher)['attempts'][0]['id'])
        self.review(quiz_attempt, 6)
        after = self.detail(aid)['report']
        self.assertEqual(after['score'], 6)
        self.assertEqual(after['percent'], 100.0)
        self.assertEqual(after['gradedCount'], 1)
        self.assertIn('suggestion', after)
        self.assertTrue(after['suggestion'].get('nextStep'))
        # 提交後不能重新開始
        self.error(403, 'POST', f'/api/assignments/{aid}/start', {}, self.student)
        # 逾時後不能再作答，但「封存已收到的作答」仍要成功（前端到期自動提交會走這條）。
        aid2 = self.assignment((1,), kind='quiz', durationMinutes=1)
        self.call('POST', f'/api/assignments/{aid2}/start', {}, self.student)
        with self.app.db() as db:
            db.execute('UPDATE assignment_recipients SET started_at=? WHERE assignment_id=? AND user_id=?',
                       ((datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(), aid2, self.student['id']))
        expired = self.detail(aid2)['mySubmission']
        self.assertTrue(expired['expired'])
        self.assertEqual(expired['remainingSeconds'], 0)
        self.error(403, 'POST', '/api/attempts',
                   {'questionId': 1, 'answerText': 'x=2或3', 'assignmentId': aid2})
        sealed = self.finalize(aid2)
        self.assertEqual(sealed['mySubmission']['status'], 'submitted', '到期自動提交要成功封存，不再回 403')
        self.error(403, 'POST', '/api/attempts',
                   {'questionId': 1, 'answerText': 'x=2或3', 'assignmentId': aid2})
        # 不限時的作業不受影響
        aid3 = self.assignment((1,))
        self.assertIsNone(self.detail(aid3)['assignment']['durationMinutes'])
        self.assertIsNone(self.detail(aid3)['mySubmission']['remainingSeconds'])
        self.attempt(aid3, qid=1, answer='x=2或3')
        # 時限參數驗證
        for bad in (0, 301, -5, 'thirty', True):
            with self.subTest(bad=bad):
                self.error(400, 'POST', '/api/assignments',
                           {'title': '限時測驗', 'classId': self.cid, 'questionIds': [1],
                            'dueAt': (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
                            'durationMinutes': bad}, self.teacher)
        self.error(400, 'POST', '/api/assignments',
                   {'title': '限時測驗', 'classId': self.cid, 'questionIds': [1],
                    'dueAt': (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
                    'durationMinutes': 30, 'unknown': 1}, self.teacher)

    def test_bulk_student_accounts_atomic_and_rbac(self):
        def bulk(students, user=None):
            return self.call('POST', '/api/users/bulk', {'students': students}, self.teacher if user is None else user)

        def students():
            with self.app.db() as db:
                return db.execute("SELECT count(*) FROM users WHERE role='student'").fetchone()[0]

        self.assertEqual(students(), 2)
        rows = [{'username': f's3a{i:02d}', 'name': f'三甲{i:02d}', 'password': 'BulkPass1234'} for i in range(1, 4)]
        result = bulk(rows)
        self.assertEqual(result['count'], 3)
        self.assertEqual([u['role'] for u in result['users']], ['student'] * 3)
        self.assertEqual(students(), 5)
        with self.app.db() as db:
            stored = db.execute("SELECT password FROM users WHERE username='s3a01'").fetchone()['password']
            ids = [r['id'] for r in db.execute("SELECT id FROM users WHERE username LIKE 's3a%' ORDER BY id")]
        self.assertNotIn('BulkPass1234', stored)
        self.assertTrue(server.password_matches('BulkPass1234', stored))
        self.assertFalse(server.password_matches('BulkPass12345', stored))
        self.assertEqual(len(ids), 3)
        self.assertEqual(self.call('POST', '/api/classes', {'name': '三甲', 'studentIds': ids},
                                   self.teacher)['class']['studentCount'], 3)
        # 只有教師可批次建立，且學生一律為 student 角色。
        self.error(403, 'POST', '/api/users/bulk', {'students': rows}, self.student)
        self.error(403, 'POST', '/api/users/bulk', {'students': rows}, self.other)
        # 任何一行有問題都不得建立部分帳戶。
        for status, payload in [
            (400, [{'username': 's3a09', 'name': '甲', 'password': 'BulkPass1234'},
                   {'username': 's3a10', 'name': '乙', 'password': 'short'}]),
            (400, [{'username': 's3a11', 'name': '丙', 'password': 'BulkPass1234'},
                   {'username': 's3a11', 'name': '丁', 'password': 'BulkPass1234'}]),
            (409, [{'username': 's3a12', 'name': '戊', 'password': 'BulkPass1234'},
                   {'username': 'student', 'name': '己', 'password': 'BulkPass1234'}]),
            (400, [{'username': 's3a13', 'name': '庚', 'password': 'BulkPass1234', 'role': 'teacher'}]),
            (400, [{'username': 'ab', 'name': '辛', 'password': 'BulkPass1234'}]),
            (400, [{'username': 's3a14', 'name': '壬', 'password': 'BulkPass1234', 'seat': '三號'}]),
            (400, [{'username': 's3a15', 'name': '癸', 'password': 'BulkPass1234', 'seat': 'x' * 21}]),
            (400, [{'username': 's3a16', 'password': 'BulkPass1234', 'unknown': 1}]),
            (400, []),
        ]:
            with self.subTest(payload=payload):
                self.error(status, 'POST', '/api/users/bulk', {'students': payload}, self.teacher)
                self.assertEqual(students(), 5)

    def test_bulk_import_without_names_keeps_seat_and_orders_roster(self):
        # 只有「學號、班內號、密碼」的名單：姓名省略時以學號作為顯示名稱。
        rows = [{'username': f'p6-{i:02d}', 'password': 'NoNamePass12', 'seat': str(i)} for i in (3, 1, 2)]
        result = self.call('POST', '/api/users/bulk', {'students': rows}, self.teacher)
        self.assertEqual(result['count'], 3)
        self.assertEqual([u['name'] for u in result['users']], ['p6-03', 'p6-01', 'p6-02'])
        self.assertEqual([u['seat'] for u in result['users']], ['3', '1', '2'])
        self.assertEqual([u['role'] for u in result['users']], ['student'] * 3)
        # 班內號依數字排序，沒有班內號的帳戶排在最後（舊資料相容）。
        listing = self.call('GET', '/api/homework', user=self.teacher)['students']
        self.assertEqual([s['seat'] for s in listing[:3]], ['1', '2', '3'])
        self.assertTrue(all(s['seat'] is None for s in listing[3:]))
        self.assertEqual([s['name'] for s in listing[:3]], ['p6-01', 'p6-02', 'p6-03'])
        # 沒帶班內號也能建立，而且可以正常登入。
        created = self.call('POST', '/api/users/bulk', {'students': [
            {'username': 'p6-09', 'password': 'NoNamePass12'}]}, self.teacher)
        self.assertIsNone(created['users'][0]['seat'])
        with self.app.db() as db:
            stored = db.execute("SELECT name,password FROM users WHERE username='p6-09'").fetchone()
        self.assertEqual(stored['name'], 'p6-09')
        self.assertTrue(server.password_matches('NoNamePass12', stored['password']))
        # 建立班級後，作業成績名單也帶上班內號。
        ids = [u['id'] for u in self.call('GET', '/api/users', user=self.teacher)['users']
               if u['username'].startswith('p6-')]
        cid = self.call('POST', '/api/classes', {'name': '六甲', 'studentIds': ids},
                        self.teacher)['class']['id']
        aid = self.assignment((1,), classId=cid)
        roster = self.call('GET', f'/api/assignments/{aid}/results', user=self.teacher)['students']
        self.assertEqual([s['seat'] for s in roster], ['1', '2', '3', None])
        self.assertEqual([s['name'] for s in roster][:3], ['p6-01', 'p6-02', 'p6-03'])

    def test_assignment_kind_validation_and_payload(self):
        base = {'title': '作業', 'classId': self.cid, 'questionIds': [1], 'dueAt': '2099-01-01T00:00:00Z'}
        for kind in ('exam', 'HOME', 'quiz ', 1, True, None, [], {}):
            with self.subTest(kind=kind):
                self.error(400, 'POST', '/api/assignments', {**base, 'kind': kind}, self.teacher)
        self.assertEqual(self.call('GET', '/api/homework', user=self.teacher)['assignments'], [])
        default_aid = self.assignment((1,))
        quiz_aid = self.assignment((1,), kind='quiz')
        self.assertEqual(self.detail(default_aid)['assignment']['kind'], 'homework')
        self.assertEqual(self.detail(quiz_aid)['assignment']['kind'], 'quiz')
        listing = {a['id']: a for a in self.call('GET', '/api/homework', user=self.teacher)['assignments']}
        self.assertEqual(listing[default_aid]['kind'], 'homework')
        self.assertEqual(listing[quiz_aid]['kind'], 'quiz')
        self.assertEqual(self.results(quiz_aid)['assignment']['kind'], 'quiz')
        self.assertEqual(self.results(default_aid)['assignment']['kind'], 'homework')

    def test_calendar_kind_events_and_role_visibility(self):
        hw = self.assignment((1,), kind='homework', dueAt='2099-03-05T00:00:00Z')
        quiz = self.assignment((1,), kind='quiz', dueAt='2099-03-20T00:00:00Z')
        with self.app.db() as db:
            rows = {r['id']: r for r in db.execute('SELECT * FROM assignments')}
        # 學生：只看到自己班級的作業，帶 myStatus，沒有統計欄位。
        data = self.calendar('2099-03-01', '2099-03-31')
        self.assertEqual((data['from'], data['to']), ('2099-03-01', '2099-03-31'))
        by_key = {(e['assignmentId'], e['event']): e for e in data['events']}
        self.assertEqual(sorted(by_key), [(hw, 'due'), (quiz, 'due')])
        self.assertEqual(by_key[(hw, 'due')]['date'], '2099-03-05')
        self.assertEqual(by_key[(hw, 'due')]['kind'], 'homework')
        self.assertEqual(by_key[(quiz, 'due')]['date'], '2099-03-20')
        self.assertEqual(by_key[(quiz, 'due')]['kind'], 'quiz')
        self.assertEqual(by_key[(hw, 'due')]['className'], '三年级')
        self.assertEqual(by_key[(hw, 'due')]['classId'], self.cid)
        self.assertEqual(by_key[(hw, 'due')]['title'], '课后练习')
        self.assertTrue(by_key[(hw, 'due')]['dueAt'].startswith('2099-03-05'))
        for event in data['events']:
            self.assertEqual(event['event'], 'due')
            self.assertIn('myStatus', event)
            self.assertNotIn('submittedCount', event)
            self.assertNotIn('studentCount', event)
        # 教師：只看到自己建立的作業，帶統計，沒有 myStatus。
        teacher_data = self.calendar('2099-03-01', '2099-03-31', self.teacher)
        self.assertEqual({(e['assignmentId'], e['event']) for e in teacher_data['events']},
                         {(hw, 'due'), (quiz, 'due')})
        for event in teacher_data['events']:
            self.assertIn('submittedCount', event)
            self.assertIn('studentCount', event)
            self.assertNotIn('myStatus', event)
        # 另一位教師看不到別人的作業；學生提交後教師統計會更新。
        self.assertEqual(self.calendar('2099-03-01', '2099-03-31', self.teacher2)['events'], [])
        self.attempt(hw)
        self.finalize(hw)
        submitted = next(e for e in self.calendar('2099-03-05', '2099-03-05', self.teacher)['events']
                         if e['assignmentId'] == hw)
        self.assertEqual(submitted['submittedCount'], 1)
        self.assertEqual(submitted['studentCount'], 2)
        # 範圍外被排除。
        narrow = self.calendar('2099-03-01', '2099-03-10')
        self.assertEqual([(e['assignmentId'], e['event']) for e in narrow['events']], [(hw, 'due')])
        # published 事件在建立當日；只涵蓋視窗內的日期。
        base = datetime.fromisoformat(rows[hw]['created_at'].replace('Z', '+00:00')).date()
        around = self.calendar((base - timedelta(days=1)).isoformat(), (base + timedelta(days=1)).isoformat())
        published = [e for e in around['events'] if e['event'] == 'published']
        self.assertEqual({e['assignmentId'] for e in published}, {hw, quiz})
        self.assertEqual({e['date'] for e in published},
                         {rows[hw]['created_at'][:10], rows[quiz]['created_at'][:10]})
        self.assertTrue(all(e['event'] == 'published' for e in around['events']))
        # 直接用 SQL 造一份同日建立、同日截止的作業，驗證 published 排在 due 之前。
        with self.app.db() as db:
            db.execute('INSERT INTO assignments(teacher_id,class_id,class_name,title,description,due_at,created_at,allow_late,kind) '
                       'VALUES(?,?,?,?,?,?,?,?,?)',
                       (self.teacher['id'], self.cid, '三年级', '同日作業', '',
                        '2099-04-15T00:00:00Z', '2099-04-15T06:00:00Z', 0, 'homework'))
        same_day = self.calendar('2099-04-15', '2099-04-15', self.teacher)
        self.assertEqual([e['event'] for e in same_day['events']], ['published', 'due'])

    def test_calendar_validation_and_auth(self):
        for frm, to in [('2099-3-1', '2099-03-31'), ('2099-03-01', 'garbage'), ('', '2099-03-31'),
                        ('2099-03-01', ''), ('2099-02-30', '2099-03-31'), ('2099-03-31', '2099-03-01'),
                        ('2099-01-01', '2099-03-05')]:
            with self.subTest(frm=frm, to=to):
                self.calendar_error(frm, to)
        # 62 天（含）可查，63 天回 400。
        self.calendar('2099-01-01', '2099-03-04')
        self.calendar_error('2099-01-01', '2099-03-05')
        # 缺少、重複或未知參數一律 400。
        for query in ('', 'from=2099-01-01', 'to=2099-01-02', 'from=2099-01-01&to=2099-01-02&extra=1',
                      'from=2099-01-01&from=2099-01-02&to=2099-01-03'):
            with self.subTest(query=query):
                with self.assertRaises(server.APIError) as context:
                    self.app.dispatch('GET', '/api/calendar', {}, self.student, None, '127.0.0.1', query)
                self.assertEqual(context.exception.status, 400)
        # 需登入。
        with self.assertRaises(server.APIError) as context:
            self.app.dispatch('GET', '/api/calendar', {}, None, None, '127.0.0.1', 'from=2099-01-01&to=2099-01-02')
        self.assertEqual(context.exception.status, 401)

    def test_kind_and_figure_additive_migration(self):
        legacy_dir = Path(self.tmp.name) / 'kindlegacy'
        legacy_dir.mkdir()
        legacy = sqlite3.connect(legacy_dir / 'mathpath.sqlite3')
        legacy.executescript('''
            CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            INSERT INTO meta VALUES('initialized','1');
            CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,
                role TEXT NOT NULL,password TEXT NOT NULL,demo INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE questions(id INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL);
            CREATE TABLE classes(id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER NOT NULL, name TEXT NOT NULL);
            CREATE TABLE class_students(class_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY(class_id,user_id));
            CREATE TABLE assignments(id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER NOT NULL,
                class_id INTEGER NOT NULL, class_name TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
                due_at TEXT NOT NULL, created_at TEXT NOT NULL, allow_late INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE assignment_questions(assignment_id INTEGER NOT NULL, question_id INTEGER NOT NULL,
                position INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(assignment_id,question_id));
            CREATE TABLE assignment_recipients(assignment_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
                submitted_at TEXT, late INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(assignment_id,user_id));
            CREATE TABLE attempts(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,
                question_id INTEGER NOT NULL,answer_text TEXT NOT NULL,image BLOB,image_mime TEXT,
                score REAL,max_score INTEGER NOT NULL,status TEXT NOT NULL,feedback TEXT NOT NULL,submitted_at TEXT NOT NULL,
                method TEXT NOT NULL,ai_steps TEXT NOT NULL DEFAULT '[]',teacher_reviewed INTEGER NOT NULL DEFAULT 0,
                reviewed_by INTEGER,reviewed_at TEXT);
        ''')
        legacy.execute('INSERT INTO users VALUES(1,?,?,?,?,0)', ('legacy', '原用户', 'student', self.student['password']))
        legacy.execute('INSERT INTO users VALUES(2,?,?,?,?,0)', ('legacyteacher', '原教师', 'teacher', self.teacher['password']))
        legacy.execute('INSERT INTO questions(payload) VALUES(?)', (json.dumps(server.seed_questions()[0]),))
        legacy.execute('INSERT INTO classes(teacher_id,name) VALUES(2,?)', ('三年級',))
        legacy.execute('INSERT INTO assignments(teacher_id,class_id,class_name,title,description,due_at,created_at,allow_late) '
                       "VALUES(2,1,'三年級','舊作業','','2099-01-01T00:00:00Z','2026-01-01T00:00:00Z',0)")
        legacy.commit()
        legacy.close()
        migrated = server.Application(legacy_dir)
        migrated.safe_initialize()
        server.Application(legacy_dir).safe_initialize()
        with migrated.db() as db:
            assignment_columns = {r['name'] for r in db.execute('PRAGMA table_info(assignments)')}
            self.assertIn('kind', assignment_columns)
            self.assertEqual(db.execute('SELECT kind FROM assignments WHERE id=1').fetchone()[0], 'homework')
            question_columns = {r['name'] for r in db.execute('PRAGMA table_info(questions)')}
            self.assertIn('figure', question_columns)
            self.assertIn('figure_mime', question_columns)
            self.assertEqual(db.execute('SELECT count(*) FROM assignments').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT count(*) FROM questions').fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)