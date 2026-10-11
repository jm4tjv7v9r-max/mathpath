"""學生自助模擬測驗：自選知識點、題數與時限，限時作答，提交後即時計分與學習建議。

設計原則：
- 題目只從題庫中「答案已核驗」的題目抽選，不使用待核驗的 AI 生成題。
- 題目以快照保存，之後題庫改動不影響已開始的測驗。
- 計時以伺服器時間為準；逾時後不可再作答，但提交永遠允許（自動提交）。
- 待批閱題目不當零分，只從已評分的題目計分，並明確標示涵蓋範圍。
"""
import json
import random
from datetime import datetime, timedelta, timezone

MAX_QUESTIONS = 20
MAX_MINUTES = 180


def parse_iso(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None


class MockExams:
    def __init__(self, app, homework, fail, fields, text, number, utc_now, topic_tree=None):
        self.app = app
        self.homework = homework
        self.fail, self.fields, self.text = fail, fields, text
        self.number, self.utc_now = number, utc_now
        self.topic_tree = topic_tree or {}

    # ---------- 資料庫 ----------
    def migrate(self, db):
        db.executescript('''
            CREATE TABLE IF NOT EXISTS mock_exams (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                topic TEXT, level INTEGER, qtype TEXT,
                minutes INTEGER NOT NULL, question_count INTEGER NOT NULL,
                created_at TEXT NOT NULL, started_at TEXT NOT NULL, expires_at TEXT NOT NULL,
                submitted_at TEXT, expired INTEGER NOT NULL DEFAULT 0,
                score REAL, max_score INTEGER NOT NULL DEFAULT 0,
                report TEXT NOT NULL DEFAULT '{}', suggestion TEXT NOT NULL DEFAULT '{}');
            CREATE INDEX IF NOT EXISTS mock_exams_user ON mock_exams(user_id, id DESC);
            CREATE TABLE IF NOT EXISTS mock_questions (
                exam_id INTEGER NOT NULL REFERENCES mock_exams(id),
                question_id INTEGER NOT NULL, position INTEGER NOT NULL, payload TEXT NOT NULL,
                PRIMARY KEY(exam_id, question_id));
        ''')
        columns = {r['name'] for r in db.execute('PRAGMA table_info(attempts)')}
        if 'mock_id' not in columns:
            db.execute('ALTER TABLE attempts ADD COLUMN mock_id INTEGER REFERENCES mock_exams(id)')
        # 兩層分類：模擬測驗可再依子分類挑題（增量加欄，不動舊資料）。
        exam_columns = {r['name'] for r in db.execute('PRAGMA table_info(mock_exams)')}
        if 'subtopic' not in exam_columns:
            db.execute('ALTER TABLE mock_exams ADD COLUMN subtopic TEXT')

    # ---------- 工具 ----------
    def _exam(self, db, eid, user):
        row = db.execute('SELECT * FROM mock_exams WHERE id=?', (eid,)).fetchone()
        if not row or row['user_id'] != user['id']:
            self.fail(404, '找不到這場模擬測驗。')
        return row

    def questions(self, db, eid):
        rows = db.execute('SELECT * FROM mock_questions WHERE exam_id=? ORDER BY position', (eid,)).fetchall()
        return [json.loads(r['payload']) for r in rows]

    def latest(self, db, eid, uid):
        rows = db.execute('SELECT * FROM attempts WHERE mock_id=? AND user_id=? ORDER BY id', (eid, uid)).fetchall()
        result = {}
        for row in rows:
            result[row['question_id']] = row
        return list(result.values())

    def remaining(self, row):
        if row['submitted_at']:
            return 0
        expires = parse_iso(row['expires_at'])
        if expires is None:
            return None
        return max(0, int((expires - datetime.now(timezone.utc)).total_seconds()))

    def public(self, row):
        keys = row.keys()
        return {'id': row['id'], 'topic': row['topic'] or '全部題目',
                'subtopic': (row['subtopic'] if 'subtopic' in keys else None) or '',
                'level': row['level'],
                'qtype': row['qtype'] or '全部題型', 'minutes': row['minutes'],
                'questionCount': row['question_count'], 'createdAt': row['created_at'],
                'startedAt': row['started_at'], 'expiresAt': row['expires_at'],
                'submittedAt': row['submitted_at'], 'expired': bool(row['expired']),
                'status': 'submitted' if row['submitted_at'] else 'in_progress',
                'remainingSeconds': self.remaining(row)}

    def report(self, db, row):
        questions = self.questions(db, row['id'])
        rows = self.latest(db, row['id'], row['user_id'])
        sums = self.homework.sums(rows)
        total = sum(q['points'] for q in questions)
        scored = sums['totalScoredPoints']
        return {**sums, 'maxScore': total, 'scoredPoints': scored,
                'topicStats': self.homework.topic_stats(questions, rows),
                'suggestion': self.homework.aggregate_suggestion(db, questions, rows),
                'answeredCount': len(rows),
                'percent': round(sums['score'] * 100 / scored, 1) if sums['score'] is not None and scored else None}

    def question_public(self, q):
        item = {k: q[k] for k in ('id', 'title', 'content', 'topic', 'level', 'grade', 'points',
                                  'qtype', 'hint', 'source', 'tags') if k in q}
        if q.get('figure'):
            item['figure'] = f'/api/questions/{q["id"]}/figure'
        return item

    # ---------- 挑題 ----------
    def pool(self, db, topic, subtopic, level, qtype):
        rows = db.execute('SELECT * FROM questions ORDER BY id').fetchall()
        items = []
        for r in rows:
            q = self.app.question_row(r)
            if not self.homework.recommendable(q):
                continue
            if topic and q['topic'] != topic:
                continue
            if subtopic and q.get('subtopic') != subtopic:
                continue
            if level and q['level'] != level:
                continue
            if qtype and q.get('qtype') != qtype:
                continue
            items.append(q)
        return items

    # ---------- 路由 ----------
    def dispatch(self, method, path, body, user, query=''):
        if path == '/api/mock' and method == 'GET':
            with self.app.db() as db:
                rows = db.execute('SELECT * FROM mock_exams WHERE user_id=? ORDER BY id DESC LIMIT 50',
                                  (user['id'],)).fetchall()
                exams = []
                for row in rows:
                    item = self.public(row)
                    report = json.loads(row['report']) if row['submitted_at'] else {}
                    item['score'] = report.get('score')
                    item['maxScore'] = report.get('maxScore', row['max_score'])
                    item['percent'] = report.get('percent')
                    item['pendingCount'] = report.get('pendingCount')
                    exams.append(item)
                options = self.options(db)
            return {'exams': exams, 'options': options, 'ai': self.app.ai.public()}

        if path == '/api/mock' and method == 'POST':
            if user['role'] != 'student':
                self.fail(403, '只有學生可以開始模擬測驗。')
            self.fields(body, ('topic', 'subtopic', 'level', 'qtype', 'count', 'minutes'),
                        ('count', 'minutes'))
            count = self.number(body['count'], '題數', 1, MAX_QUESTIONS, True)
            minutes = self.number(body['minutes'], '時限（分鐘）', 1, MAX_MINUTES, True)
            topic = self.text(body['topic'], '知識點', 30, empty=True) if 'topic' in body else ''
            subtopic = self.text(body['subtopic'], '子分類', 60, empty=True) if 'subtopic' in body else ''
            qtype = self.text(body['qtype'], '題型', 20, empty=True) if 'qtype' in body else ''
            level = self.number(body['level'], '難度', 1, 3, True) if body.get('level') else None
            if subtopic and subtopic not in self.topic_tree.get(topic, ()):
                self.fail(400, f'「{subtopic}」不是「{topic}」的子分類。')
            with self.app.db() as db:
                items = self.pool(db, topic, subtopic, level, qtype)
                if not items:
                    self.fail(409, '符合條件的題目不足，請放寬知識點、難度或題型。')
                if len(items) < count:
                    self.fail(409, f'符合條件的題目只有 {len(items)} 題，請把題數調低至 {len(items)} 題或放寬條件。')
                chosen = random.sample(items, count)
                chosen.sort(key=lambda q: (q['level'], q['id']))
                now = datetime.now(timezone.utc)
                expires = now + timedelta(minutes=minutes)
                cur = db.execute(
                    'INSERT INTO mock_exams(user_id,topic,subtopic,level,qtype,minutes,question_count,created_at,started_at,expires_at) '
                    'VALUES(?,?,?,?,?,?,?,?,?,?)',
                    (user['id'], topic or None, subtopic or None, level, qtype or None, minutes, count,
                     self.utc_now(), now.isoformat(timespec='seconds').replace('+00:00', 'Z'),
                     expires.isoformat(timespec='seconds').replace('+00:00', 'Z')))
                eid = cur.lastrowid
                for position, q in enumerate(chosen):
                    db.execute('INSERT INTO mock_questions(exam_id,question_id,position,payload) VALUES(?,?,?,?)',
                               (eid, q['id'], position, json.dumps(q, ensure_ascii=False)))
                row = db.execute('SELECT * FROM mock_exams WHERE id=?', (eid,)).fetchone()
            return {'exam': self.public(row),
                    'questions': [self.question_public(q) for q in chosen],
                    'notice': '模擬測驗已開始計時。逾時會自動提交；提交後即時計分並給出學習建議。'}

        match = self._match(path)
        if not match:
            return None
        eid, action = match
        if method == 'GET' and action is None:
            with self.app.db() as db:
                row = self._exam(db, eid, user)
                questions = self.questions(db, eid)
                rows = self.latest(db, eid, user['id'])
                attempts = [self.app.attempt_public(db, r, user) for r in rows]
                report = self.report(db, row) if row['submitted_at'] else None
            return {'exam': self.public(row), 'questions': [self.question_public(q) for q in questions],
                    'attempts': attempts, 'report': report,
                    'notice': '模擬測驗作答紀錄只供你本人查看；教師不會用於正式評分。'}

        if method == 'POST' and action == 'submit':
            self.fields(body, ())
            with self.app.db() as db:
                db.execute('BEGIN IMMEDIATE')
                row = self._exam(db, eid, user)
                if row['submitted_at']:
                    return {'exam': self.public(row), 'report': self.report(db, row), 'alreadySubmitted': True}
                questions = self.questions(db, eid)
                rows = self.latest(db, eid, user['id'])
                if not rows:
                    self.fail(400, '尚未作答任何題目，不能提交。')
                expired = int(self.remaining(row) == 0)
                sums = self.homework.sums(rows)
                suggestion = self.homework.aggregate_suggestion(db, questions, rows)
                report = {**sums, 'maxScore': sum(q['points'] for q in questions),
                          'scoredPoints': sums['totalScoredPoints'],
                          'topicStats': self.homework.topic_stats(questions, rows),
                          'suggestion': suggestion, 'answeredCount': len(rows)}
                scored = report['scoredPoints']
                report['percent'] = round(sums['score'] * 100 / scored, 1) if sums['score'] is not None and scored else None
                db.execute('UPDATE mock_exams SET submitted_at=?,expired=?,score=?,max_score=?,report=?,suggestion=? WHERE id=?',
                           (self.utc_now(), expired, sums['score'], report['maxScore'],
                            json.dumps(report, ensure_ascii=False), json.dumps(suggestion, ensure_ascii=False), eid))
                row = db.execute('SELECT * FROM mock_exams WHERE id=?', (eid,)).fetchone()
            return {'exam': self.public(row), 'report': json.loads(row['report']),
                    'notice': '已提交並即時計分。待批閱題目不計入總分；學習建議只供你參考，不是正式評分。'}

        return None

    @staticmethod
    def _match(path):
        import re
        m = re.fullmatch(r'/api/mock/([1-9]\d{0,17})(?:/(submit))?', path)
        return (int(m[1]), m[2]) if m else None

    def options(self, db):
        rows = db.execute('SELECT * FROM questions ORDER BY id').fetchall()
        pool = [self.app.question_row(r) for r in rows]
        usable = [q for q in pool if self.homework.recommendable(q)]
        topics = []
        subtopics = {}
        for q in usable:
            if q['topic'] not in topics:
                topics.append(q['topic'])
            sub = q.get('subtopic') or ''
            if sub and sub not in subtopics.setdefault(q['topic'], []):
                subtopics[q['topic']].append(sub)
        return {'topics': sorted(topics), 'subtopics': subtopics,
                'counts': [5, 10, 15, 20], 'minutes': [5, 10, 15, 20, 30, 45, 60],
                'maxQuestions': MAX_QUESTIONS, 'maxMinutes': MAX_MINUTES,
                'available': len(usable), 'qtypes': sorted({q.get('qtype', '解答題') for q in usable})}

    # ---------- 作答 ----------
    def assert_open(self, db, eid, user, qid=None):
        """學生只能在未提交、未逾時，且題目屬於本場測驗時作答。"""
        if user['role'] != 'student':
            self.fail(403, '只有學生可以作答模擬測驗。')
        row = self._exam(db, eid, user)
        if row['submitted_at']:
            self.fail(403, '這場模擬測驗已提交，不能再次作答。')
        if self.remaining(row) == 0:
            self.fail(403, '模擬測驗已逾時，請提交後重新開始一場。')
        if qid is not None:
            exists = db.execute('SELECT 1 FROM mock_questions WHERE exam_id=? AND question_id=?', (eid, qid)).fetchone()
            if not exists:
                self.fail(403, '題目不屬於這場模擬測驗。')
        return row

    def question(self, db, eid, qid):
        row = db.execute('SELECT payload FROM mock_questions WHERE exam_id=? AND question_id=?', (eid, qid)).fetchone()
        if not row:
            self.fail(403, '題目不屬於這場模擬測驗。')
        return json.loads(row['payload'])
