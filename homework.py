"""本地作業快照、權限、統計和逐次學習建議；不依賴外部服務。"""
from datetime import date, datetime, timedelta, timezone
import json
import re
from urllib.parse import parse_qsl


class Homework:
    def __init__(self, app, fail, fields, text, number, utc_now):
        self.app = app
        self.fail, self.fields, self.text = fail, fields, text
        self.number, self.utc_now = number, utc_now

    def migrate(self, db):
        db.executescript('''
            CREATE TABLE IF NOT EXISTS classes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                teacher_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS class_students (
                class_id INTEGER NOT NULL REFERENCES classes(id),
                user_id INTEGER NOT NULL REFERENCES users(id), PRIMARY KEY(class_id,user_id));
            CREATE TABLE IF NOT EXISTS assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER NOT NULL REFERENCES users(id),
                class_id INTEGER NOT NULL REFERENCES classes(id), class_name TEXT NOT NULL,
                title TEXT NOT NULL, description TEXT NOT NULL, due_at TEXT NOT NULL,
                created_at TEXT NOT NULL, allow_late INTEGER NOT NULL DEFAULT 0,
                kind TEXT NOT NULL DEFAULT 'homework');
            CREATE TABLE IF NOT EXISTS assignment_questions (
                assignment_id INTEGER NOT NULL REFERENCES assignments(id),
                question_id INTEGER NOT NULL REFERENCES questions(id), position INTEGER NOT NULL,
                payload TEXT NOT NULL, PRIMARY KEY(assignment_id,question_id));
            CREATE TABLE IF NOT EXISTS assignment_recipients (
                assignment_id INTEGER NOT NULL REFERENCES assignments(id),
                user_id INTEGER NOT NULL REFERENCES users(id), submitted_at TEXT,
                late INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(assignment_id,user_id));
            CREATE INDEX IF NOT EXISTS assignments_teacher ON assignments(teacher_id);
            CREATE INDEX IF NOT EXISTS recipients_user ON assignment_recipients(user_id,assignment_id);
            CREATE TABLE IF NOT EXISTS corrections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                assignment_id INTEGER NOT NULL REFERENCES assignments(id),
                user_id INTEGER NOT NULL REFERENCES users(id),
                requested_by INTEGER NOT NULL REFERENCES users(id),
                note TEXT NOT NULL, question_ids TEXT NOT NULL, min_attempt_id INTEGER NOT NULL,
                round INTEGER NOT NULL, requested_at TEXT NOT NULL, resolved_at TEXT);
            CREATE INDEX IF NOT EXISTS corrections_open ON corrections(assignment_id,user_id,resolved_at);
            CREATE TABLE IF NOT EXISTS calendar_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                date TEXT NOT NULL, title TEXT NOT NULL, note TEXT NOT NULL, kind TEXT NOT NULL,
                created_at TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS calendar_notes_user ON calendar_notes(user_id, date);
        ''')
        db.execute('BEGIN IMMEDIATE')
        columns = {r['name'] for r in db.execute('PRAGMA table_info(attempts)')}
        recipient_columns = {r['name'] for r in db.execute('PRAGMA table_info(assignment_recipients)')}
        assignment_columns = {r['name'] for r in db.execute('PRAGMA table_info(assignments)')}
        if 'kind' not in assignment_columns:
            # SQLite 不支援以 ALTER 加 CHECK；分類在程式碼驗證，舊資料一律視為 homework。
            db.execute("ALTER TABLE assignments ADD COLUMN kind TEXT NOT NULL DEFAULT 'homework'")
        if 'duration_minutes' not in assignment_columns:
            # 模擬測驗的作答時間上限；NULL 表示不限時。
            db.execute('ALTER TABLE assignments ADD COLUMN duration_minutes INTEGER')
        if 'ai_grading' not in assignment_columns:
            # 是否使用 AI 建議評分：由教師在佈置作業時決定，學生不可自行選擇。
            # 舊資料一律視為不啟用（0），避免未經教師同意的 AI 批改。
            db.execute('ALTER TABLE assignments ADD COLUMN ai_grading INTEGER NOT NULL DEFAULT 0')
        for name, sql in (
            ('resubmitted_at', 'ALTER TABLE assignment_recipients ADD COLUMN resubmitted_at TEXT'),
            ('submit_count', 'ALTER TABLE assignment_recipients ADD COLUMN submit_count INTEGER NOT NULL DEFAULT 0'),
            ('started_at', 'ALTER TABLE assignment_recipients ADD COLUMN started_at TEXT'),
        ):
            if name not in recipient_columns:
                db.execute(sql)
        db.execute('UPDATE assignment_recipients SET submit_count=1 WHERE submitted_at IS NOT NULL AND submit_count=0')
        # 固定 SQL 增量添加字段；不重建旧表、不删除历史数据。
        migrations = (
            ('assignment_id', 'ALTER TABLE attempts ADD COLUMN assignment_id INTEGER REFERENCES assignments(id)'),
            ('ai_score', 'ALTER TABLE attempts ADD COLUMN ai_score REAL'),
            ('rule_score', 'ALTER TABLE attempts ADD COLUMN rule_score REAL'),
            ('teacher_confirmed_score', 'ALTER TABLE attempts ADD COLUMN teacher_confirmed_score REAL'),
            ('suggestion', "ALTER TABLE attempts ADD COLUMN suggestion TEXT NOT NULL DEFAULT '{}'"),
            ('annotation', 'ALTER TABLE attempts ADD COLUMN annotation BLOB'),
            ('annotation_mime', 'ALTER TABLE attempts ADD COLUMN annotation_mime TEXT'),
            ('image_key', 'ALTER TABLE attempts ADD COLUMN image_key TEXT'),
            ('annotation_key', 'ALTER TABLE attempts ADD COLUMN annotation_key TEXT'),
            ('annotation_at', 'ALTER TABLE attempts ADD COLUMN annotation_at TEXT'),
            ('ai_annotation', "ALTER TABLE attempts ADD COLUMN ai_annotation TEXT NOT NULL DEFAULT '{}'"),
            ('ai_annotation_at', 'ALTER TABLE attempts ADD COLUMN ai_annotation_at TEXT'),
        )
        for name, sql in migrations:
            if name not in columns:
                db.execute(sql)
        db.execute('CREATE INDEX IF NOT EXISTS attempts_assignment ON attempts(assignment_id,user_id,question_id,id)')
        db.execute("UPDATE attempts SET ai_score=score WHERE method IN ('ai-advisory','ai-practice') AND ai_score IS NULL")
        db.execute("UPDATE attempts SET rule_score=score WHERE method='rule-final' AND rule_score IS NULL")
        db.execute('UPDATE attempts SET teacher_confirmed_score=score '
                   'WHERE teacher_reviewed=1 AND teacher_confirmed_score IS NULL')
        # 旧版已覆核记录的 AI/规则原分无法恢复，不拿覆核分冒充原分。
        for row in db.execute("SELECT * FROM attempts WHERE suggestion='{}'").fetchall():
            q = self.question_for_attempt(db, row)
            suggestion = self.rule_suggestion(db, q, row)
            db.execute('UPDATE attempts SET suggestion=? WHERE id=?',
                       (json.dumps(suggestion, ensure_ascii=False), row['id']))

    def ids(self, value, field, limit):
        if not isinstance(value, list) or not 1 <= len(value) <= limit:
            self.fail(400, f'{field}必須包含 1 至 {limit} 個編號。')
        return list(dict.fromkeys(self.number(v, field, 1, 2**63 - 1, True) for v in value))

    def deadline(self, value):
        value = self.text(value, '截止時間', 64)
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})', value):
            self.fail(400, '截止時間必須是帶時區的 ISO 日期時間。')
        offset = re.search(r'[+-](\d{2}):(\d{2})$', value)
        if offset and (int(offset[1]) > 23 or int(offset[2]) > 59):
            self.fail(400, '截止時間的時區偏移無效。')
        try:
            due = datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc)
        except (ValueError, OverflowError):
            self.fail(400, '截止時間無效。')
        if due <= datetime.now(timezone.utc):
            self.fail(400, '截止時間必須在未來。')
        return due.isoformat().replace('+00:00', 'Z')

    @staticmethod
    def recommendable(q):
        marker = q.get('source', '') + ' ' + ' '.join(q.get('tags', []))
        return bool(q.get('answer', '').strip()) and not re.search(r'待.*(?:核验|核驗|审核|審核|确认|確認)', marker)

    def get_assignment(self, db, aid, user):
        row = db.execute('SELECT * FROM assignments WHERE id=?', (aid,)).fetchone()
        if not row:
            self.fail(404, '找不到作业。')
        if user['role'] == 'teacher':
            allowed = row['teacher_id'] == user['id']
        else:
            allowed = db.execute('SELECT 1 FROM assignment_recipients WHERE assignment_id=? AND user_id=?',
                                 (aid, user['id'])).fetchone() is not None
        if not allowed:
            self.fail(403, '沒有這份作業的存取權限。')
        return row

    @staticmethod
    def ai_grading(row):
        """這份作業是否由教師啟用了 AI 建議評分（舊資料沒有此欄位時視為否）。"""
        return bool(row['ai_grading']) if 'ai_grading' in row.keys() else False

    def questions(self, db, aid):
        return [json.loads(r['payload']) for r in db.execute(
            'SELECT payload FROM assignment_questions WHERE assignment_id=? ORDER BY position', (aid,))]

    def question(self, db, aid, qid):
        row = db.execute('SELECT payload FROM assignment_questions WHERE assignment_id=? AND question_id=?',
                         (aid, qid)).fetchone()
        if not row:
            self.fail(403, '題目不屬於這份作業。')
        return json.loads(row['payload'])

    def question_for_attempt(self, db, row, cache=None):
        """取得這筆作答對應的題目。

        cache 是選用的字典：同一題常被整班重複作答（30 人 × 5 題 ＝ 150 筆作答，
        但只有 5 個不同題目），沒有快取時每一筆都要再查一次，載入一次 /api/state
        就會變成上百次查詢。key 要含來源——作業的題目是發布當下的快照，
        和題庫（或另一份作業）可能不同。
        """
        if row['assignment_id'] is not None:
            key = ('assignment', row['assignment_id'], row['question_id'])
            if cache is not None and key in cache:
                return cache[key]
            result = self.question(db, row['assignment_id'], row['question_id'])
        elif 'mock_id' in row.keys() and row['mock_id'] is not None:
            key = ('mock', row['mock_id'], row['question_id'])
            if cache is not None and key in cache:
                return cache[key]
            result = self.app.mock.question(db, row['mock_id'], row['question_id'])
        else:
            key = ('bank', row['question_id'])
            if cache is not None and key in cache:
                return cache[key]
            result = self.app.get_question(db, row['question_id'])
        if cache is not None:
            cache[key] = result
        return result

    def open_correction(self, db, aid, uid):
        return db.execute('SELECT * FROM corrections WHERE assignment_id=? AND user_id=? AND resolved_at IS NULL '
                          'ORDER BY id DESC LIMIT 1', (aid, uid)).fetchone()

    @staticmethod
    def correction_public(row):
        if not row:
            return None
        return {'round': row['round'], 'note': row['note'], 'requestedAt': row['requested_at'],
                'questionIds': json.loads(row['question_ids']), 'minAttemptId': row['min_attempt_id']}

    def assert_open(self, db, aid, user, qid=None):
        if user['role'] != 'student':
            self.fail(403, '教師不能以學生身分提交作業。')
        assignment = self.get_assignment(db, aid, user)
        recipient = db.execute('SELECT * FROM assignment_recipients WHERE assignment_id=? AND user_id=?',
                               (aid, user['id'])).fetchone()
        correction = self.open_correction(db, aid, user['id'])
        if recipient['submitted_at'] is not None and not correction:
            self.fail(403, '已正式提交的作业不能再次作答。')
        # 教師要求的訂正不受截止時間限制。
        if self.is_late(assignment) and not assignment['allow_late'] and not correction:
            self.fail(403, '作業已超過截止時間，不能遲交。')
        # 模擬測驗：計時結束即不能再作答（訂正由教師另行開放，不受此限）。
        if not correction:
            timing = self.timing(assignment, recipient)
            if timing['expired']:
                self.fail(403, '測驗時間已結束，無法再作答。')
            if timing['durationMinutes'] and not timing['startedAt']:
                self.fail(400, '請先按「開始測驗」，計時開始後才可作答。')
        if correction and qid is not None:
            allowed = json.loads(correction['question_ids'])
            if allowed and qid not in allowed:
                self.fail(403, '此題不在教師指定的訂正範圍內。')
        return assignment

    @staticmethod
    def is_late(assignment):
        return datetime.now(timezone.utc) > datetime.fromisoformat(assignment['due_at'].replace('Z', '+00:00'))

    @staticmethod
    def _parse_dt(value):
        return datetime.fromisoformat(value.replace('Z', '+00:00'))

    def timing(self, assignment, row):
        """模擬測驗的計時資訊。未設定時限時，remainingSeconds 為 None（不限時）。"""
        minutes = assignment['duration_minutes'] if 'duration_minutes' in assignment.keys() else None
        started = row['started_at'] if row is not None and 'started_at' in row.keys() else None
        if not minutes or not started:
            return {'durationMinutes': minutes, 'startedAt': started, 'expiresAt': None,
                    'remainingSeconds': None, 'timeUsedSeconds': None, 'expired': False}
        start_dt = self._parse_dt(started)
        expires = start_dt + timedelta(minutes=minutes)
        now = datetime.now(timezone.utc)
        remaining = (expires - now).total_seconds()
        return {'durationMinutes': minutes, 'startedAt': started,
                'expiresAt': expires.isoformat().replace('+00:00', 'Z'),
                'remainingSeconds': max(0, int(remaining)),
                'timeUsedSeconds': max(0, int((now - start_dt).total_seconds())),
                'expired': remaining <= 0}

    @staticmethod
    def can_access_attempt(db, row, user):
        if user['role'] != 'teacher':
            return row['user_id'] == user['id']
        if 'mock_id' in row.keys() and row['mock_id'] is not None:
            # 自助測驗只供本人查看，教師不能透過作答/圖片/批註接口繞過測驗權限。
            return False
        if row['assignment_id'] is None:
            return True
        owner = db.execute('SELECT teacher_id FROM assignments WHERE id=?', (row['assignment_id'],)).fetchone()
        return owner is not None and owner['teacher_id'] == user['id']

    def latest(self, db, aid, uid=None):
        sql = ('SELECT a.* FROM attempts a JOIN assignment_recipients r '
               'ON r.assignment_id=a.assignment_id AND r.user_id=a.user_id '
               'WHERE a.assignment_id=?')
        params = [aid]
        if uid is not None:
            sql += ' AND a.user_id=?'
            params.append(uid)
        rows = db.execute(sql + ' ORDER BY a.id', params).fetchall()
        result = {}
        for row in rows:
            result[(row['user_id'], row['question_id'])] = row
        return list(result.values())

    @staticmethod
    def topic_stats(questions, rows, recipients=1):
        result = {}
        by_id = {q['id']: q for q in questions}
        for q in questions:
            item = result.setdefault(q['topic'], dict(topic=q['topic'], scoredCount=0,
                                                     totalCount=0, score=0, maxScore=0, percent=None))
            item['totalCount'] += recipients
        for row in rows:
            if row['status'] == 'graded' and row['score'] is not None:
                item = result[by_id[row['question_id']]['topic']]
                item['scoredCount'] += 1
                item['score'] += row['score']
                item['maxScore'] += row['max_score']
        for item in result.values():
            if item['maxScore']:
                item['percent'] = round(item['score'] * 100 / item['maxScore'], 1)
        return list(result.values())

    def submission(self, db, aid, uid, rows=None):
        row = db.execute('SELECT * FROM assignment_recipients WHERE assignment_id=? AND user_id=?',
                         (aid, uid)).fetchone()
        attempts = self.latest(db, aid, uid) if rows is None else rows
        correction = self.open_correction(db, aid, uid)
        if correction:
            status = 'correction'
        elif row['submitted_at']:
            status = 'submitted'
        elif attempts:
            status = 'in_progress'
        else:
            status = 'not_started'
        assignment = db.execute('SELECT * FROM assignments WHERE id=?', (aid,)).fetchone()
        return {'status': status, 'submittedAt': row['submitted_at'],
                'resubmittedAt': row['resubmitted_at'] if 'resubmitted_at' in row.keys() else None,
                'submitCount': (row['submit_count'] if 'submit_count' in row.keys() else 0) or 0,
                'late': bool(row['late']), 'correction': self.correction_public(correction),
                **self.timing(assignment, row)}

    @staticmethod
    def sums(rows):
        graded = [r for r in rows if r['status'] == 'graded' and r['score'] is not None]
        confirmed = [r for r in graded if r['teacher_confirmed_score'] is not None]
        def source_sum(key):
            values = [r[key] for r in graded if r[key] is not None]
            return sum(values) if values else None
        return {'score': sum(r['score'] for r in graded) if graded else None,
                'totalScoredPoints': sum(r['max_score'] for r in graded),
                'pendingCount': sum(r['status'] == 'pending' for r in rows),
                'confirmedScore': source_sum('teacher_confirmed_score'), 'confirmedCount': len(confirmed),
                'aiScore': source_sum('ai_score'), 'ruleScore': source_sum('rule_score')}

    def aggregate_suggestion(self, db, questions, rows):
        if not questions:
            return {'source': 'rules', 'strength': '這份記錄沒有可讀取的題目快照。',
                    'focus': '請教師檢查歸檔還原結果。', 'nextStep': '補齊題目後再開始作答。',
                    'recommended': [], 'notice': '尚無可評分的題目，不產生分數。'}
        if not rows:
            q = questions[0]
            suggestion = self.rule_suggestion(db, q, {'score': None, 'max_score': q['points'],
                                                      'status': 'pending', 'feedback': '', 'method': 'not-started'})
            suggestion['strength'] = '尚未開始作答，暫無已評分證據。'
            suggestion['focus'] = f'先閱讀{q["topic"]}題目，獨立寫出解題過程。'
            suggestion['nextStep'] = '完成每道題後正式提交作業。'
            suggestion['notice'] = '規則學習建議；尚無成績，不判斷具體錯誤。'
            return suggestion
        pending = [r for r in rows if r['status'] == 'pending']
        graded = [r for r in rows if r['status'] == 'graded' and r['score'] is not None]
        # 从当前最新版本中选择最需关注的已评分题，不沿用被重做替代的诊断。
        chosen = min(graded, key=lambda r: (r['score'] / r['max_score'], -r['id'])) if graded else max(rows, key=lambda r: r['id'])
        suggestion = json.loads(chosen['suggestion'])
        if not suggestion:
            q = next(q for q in questions if q['id'] == chosen['question_id'])
            suggestion = self.rule_suggestion(db, q, chosen)
        if pending:
            suggestion['notice'] += f' 目前有 {len(pending)} 題待批閱，未將待批閱題計為零分。'
        return suggestion

    def report(self, db, assignment, uid, reviewed_only=False):
        """作業報告。

        reviewed_only=True 是學生版：教師批閱前不揭露分數與 AI 批閱結果，
        因此只計「教師已批閱」的題目，其餘列為待批閱。
        """
        questions = self.questions(db, assignment['id'])
        latest = self.latest(db, assignment['id'], uid)
        rows = [r for r in latest if r['teacher_reviewed']] if reviewed_only else latest
        sums = self.sums(rows)
        scored = sums['totalScoredPoints']
        result = {**sums, 'maxScore': sum(q['points'] for q in questions),
                  'questionCount': len(questions),
                  'gradedCount': sum(1 for r in rows if r['status'] == 'graded' and r['score'] is not None),
                  'topicStats': self.topic_stats(questions, rows),
                  'suggestion': self.aggregate_suggestion(db, questions, rows)}
        # 即時計分：只以已評分題目計算百分比，待批題目不當零分。
        result['percent'] = (round(sums['score'] * 100 / scored, 1)
                             if sums['score'] is not None and scored else None)
        if reviewed_only:
            # 學生版：待教師批閱 = 已作答但教師尚未批閱的題目數。
            result['pendingCount'] = len(latest) - len(rows)
            result['awaitingReview'] = result['pendingCount'] > 0
            if not rows:
                # 教師尚未批閱任何一題：不顯示學習建議，避免洩漏 AI 診斷。
                result['suggestion'] = None
        return result

    def results(self, db, assignment):
        aid = assignment['id']
        questions = self.questions(db, aid)
        rows = self.latest(db, aid)
        recipients = db.execute('SELECT u.id,u.name,u.username,u.seat,r.submitted_at,r.late '
                                'FROM assignment_recipients r JOIN users u ON u.id=r.user_id '
                                'WHERE r.assignment_id=? ORDER BY '
                                "CASE WHEN u.seat IS NULL OR trim(u.seat)='' THEN 1 ELSE 0 END, "
                                'CAST(u.seat AS INTEGER), u.seat, u.name, u.id', (aid,)).fetchall()
        students, complete, confirmed, corrections = [], [], [], 0
        for recipient in recipients:
            own = [r for r in rows if r['user_id'] == recipient['id']]
            sums = self.sums(own)
            submission = self.submission(db, aid, recipient['id'], own)
            if submission['correction']:
                corrections += 1
            # 訂正中或未提交者不計入平均，避免用未定稿的分數代表學習成果。
            fully = len(own) == len(questions) and all(r['status'] == 'graded' and r['score'] is not None for r in own)
            if submission['status'] == 'submitted' and fully:
                complete.append(sums['score'])
                if sums['confirmedCount'] == len(questions):
                    confirmed.append(sums['confirmedScore'])
            # 「建議覆核」：AI 建議分與規則核對衝突，或配分被歸一化過；
            # 教師覆核後旗標會被清掉，所以這個數字就是「還需要教師多看一題」的題數。
            flags = sum(1 for r in own if not r['teacher_reviewed'] and r['review_flags'] not in (None, '', '[]'))
            students.append({'id': recipient['id'], 'name': recipient['name'], 'username': recipient['username'],
                             'seat': recipient['seat'],
                             **submission, 'answeredCount': len(own), 'pendingCount': sums['pendingCount'],
                             'reviewFlagCount': flags,
                             'score': sums['score'], 'totalPoints': sum(q['points'] for q in questions),
                             'scoredPoints': sums['totalScoredPoints'], 'confirmedScore': sums['confirmedScore'],
                             'confirmedCount': sums['confirmedCount'], 'aiScore': sums['aiScore'],
                             'ruleScore': sums['ruleScore'], 'suggestion': self.aggregate_suggestion(db, questions, own)})
        summary = {'studentCount': len(recipients),
                   'submittedCount': sum(s['status'] in ('submitted', 'correction') for s in students),
                   'correctionCount': corrections,
                   'fullyGradedCount': len(complete),
                   'pendingReviewCount': sum(r['status'] == 'pending' or
                                             (r['ai_score'] is not None and not r['teacher_reviewed']) for r in rows),
                   'reviewFlagCount': sum(1 for r in rows if not r['teacher_reviewed']
                                          and r['review_flags'] not in (None, '', '[]')),
                   'averageScore': sum(complete) / len(complete) if complete else None,
                   'confirmedAverage': sum(confirmed) / len(confirmed) if confirmed else None}
        return {'students': students, 'summary': summary,
                'topicStats': self.topic_stats(questions, rows, len(recipients)),
                'questionStats': self.question_stats(questions, rows, len(recipients))}

    def question_stats(self, questions, rows, student_count):
        """逐題表現：得分率、待批、未作答。

        知識點層級看不出「哪一題要重教」——同一知識點裡可能有一題全班都錯、
        另一題大家都對，平均起來就看不見了。
        """
        by_question = {}
        for r in rows:
            by_question.setdefault(r['question_id'], []).append(r)
        stats = []
        for index, q in enumerate(questions, 1):
            own = by_question.get(q['id'], [])
            graded = [r for r in own if r['status'] == 'graded' and r['score'] is not None]
            skipped = sum(1 for r in own if r['skipped'])
            # 待批 = 有作答但還沒評分（不含標示「不會」的）。
            pending = len(own) - len(graded) - skipped
            average = round(sum(r['score'] for r in graded) / len(graded), 1) if graded else None
            rate = (round(100 * average / q['points'], 1)
                    if average is not None and q['points'] else None)
            stats.append({'id': q['id'], 'index': index, 'title': q['title'],
                          'topic': q['topic'], 'points': q['points'],
                          'answered': len(own), 'graded': len(graded), 'pending': pending,
                          'skipped': skipped,
                          'unanswered': max(0, student_count - len(own)),
                          'average': average, 'rate': rate})
        return stats

    def assignment_public(self, db, row, user, detail=False):
        questions = self.questions(db, row['id'])
        total = db.execute('SELECT count(*) FROM assignment_recipients WHERE assignment_id=?', (row['id'],)).fetchone()[0]
        item = {'id': row['id'], 'title': row['title'], 'kind': row['kind'], 'classId': row['class_id'],
                'className': row['class_name'], 'teacherId': row['teacher_id'],
                'durationMinutes': row['duration_minutes'] if 'duration_minutes' in row.keys() else None,
                'aiGrading': self.ai_grading(row),
                'dueAt': row['due_at'], 'createdAt': row['created_at'], 'questionCount': len(questions),
                'totalPoints': sum(q['points'] for q in questions), 'studentCount': total,
                'submittedCount': None, 'gradedCount': None, 'status': 'published',
                'myStatus': 'not_started', 'myScore': None, 'myConfirmedScore': None}
        if user['role'] == 'teacher':
            summary = self.results(db, row)['summary']
            item['submittedCount'], item['gradedCount'] = summary['submittedCount'], summary['fullyGradedCount']
        else:
            item['myStatus'] = self.submission(db, row['id'], user['id'])['status']
            latest = self.latest(db, row['id'], user['id'])
            sums = self.sums([r for r in latest if r['teacher_reviewed']])
            item['myScore'], item['myConfirmedScore'] = sums['score'], sums['confirmedScore']
            item['myScoredPoints'] = sums['totalScoredPoints']
            item['awaitingReview'] = any(not r['teacher_reviewed'] for r in latest)
        if detail:
            item.update(description=row['description'], allowLate=bool(row['allow_late']))
        return item

    def class_public(self, db, row, user):
        ids = [r[0] for r in db.execute('SELECT user_id FROM class_students WHERE class_id=? ORDER BY user_id', (row['id'],))]
        result = {'id': row['id'], 'name': row['name'], 'studentCount': len(ids),
                  'teacherId': row['teacher_id'],
                  'studentIds': ids if user['role'] == 'teacher' else []}
        return result

    def recommendations(self, db, q):
        candidates = [self.app.question_row(r) for r in db.execute('SELECT * FROM questions WHERE id<>? ORDER BY id', (q['id'],))]
        candidates = [v for v in candidates if self.recommendable(v) and v['topic'] == q['topic']]
        similar = sorted((v for v in candidates if v['level'] == q['level']),
                         key=lambda v: (-len(set(q.get('tags', [])) & set(v.get('tags', []))), v['id']))[:3]
        advanced = sorted((v for v in candidates if v['level'] > q['level']), key=lambda v: (v['level'], v['id']))[:3]
        return [{'id': v['id'], 'title': v['title'], 'kind': kind}
                for kind, items in [('similar', similar), ('advanced', advanced)] for v in items]

    def rule_suggestion(self, db, q, row):
        score, maximum = row['score'], row['max_score']
        notice = '規則學習建議，不是 AI 診斷。'
        if row['status'] != 'graded' or score is None:
            strength = '已提交作答；尚未批閱，無法判斷掌握情況。'
            focus = f'{q["topic"]}待教師批閱，目前不能判斷具體錯誤。'
            next_step = '保留完整解題過程，等待教師回饋後再訂正。'
            notice += ' 待批閱不等於零分。'
        else:
            strength = f'本次{q["topic"]}已評分：{score:g}/{maximum:g} 分。'
            if row['method'] == 'rule-final':
                focus = ('最終答案已通過嚴格等價檢查，推導步驟尚未批閱。' if score == maximum else
                         '最終答案未通過嚴格等價檢查；不能據此確定具體推導錯誤，請教師覆核。')
            else:
                focus = row['feedback'][:2000]
            next_step = (f'根據真實評語複查過程。提示：{q["hint"]}' if q.get('hint') else '根據真實評語複查過程，嘗試同主題練習。')
            if row['method'] == 'ai-practice':
                notice += ' 自主練習由 AI 即時評分並記錄分數，不需教師批閱。'
            elif row['method'] == 'ai-advisory':
                notice += ' AI 數學判斷和成績仍僅供教師覆核。'
            elif row['method'] == 'teacher-reviewed':
                notice += ' 依據教師覆核成績與評語更新。'
        return {'source': 'rules', 'strength': strength, 'focus': focus, 'nextStep': next_step,
                'recommended': self.recommendations(db, q), 'notice': notice}

    def ai_suggestion(self, q, row, consent):
        # 调用前成绩和规则建议已提交；第二次模型失败绝不丢弃已批成绩。
        fallback = json.loads(row['suggestion'])
        try:
            with self.app.db() as db:
                recommended = self.recommendations(db, q)
                candidate_questions = []
                for item in recommended:
                    candidate = self.app.get_question(db, item['id'])
                    candidate_questions.append({**item, **{k: candidate[k] for k in ('content', 'topic', 'level', 'hint')}})
                history = []
                for previous in db.execute('SELECT * FROM attempts WHERE user_id=? AND id<? '
                                           "AND status='graded' AND score IS NOT NULL ORDER BY id DESC",
                                           (row['user_id'], row['id'])):
                    previous_q = self.question_for_attempt(db, previous)
                    if previous_q['topic'] == q['topic']:
                        history.append({'score': previous['score'], 'maxScore': previous['max_score'],
                                        'feedback': previous['feedback'], 'topic': previous_q['topic']})
                    if len(history) == 5:
                        break
            self.app.ai.consent(consent)
            result = self.app.ai.call(
                '根據本次真實批改結果、本人最多 5 次同主題已評分記錄給出個別學習建議。'
                '返回 JSON {strength:str,focus:str,nextStep:str,recommendedIds:[int]}；前三项必填。'
                '推荐编号只能来自给定候选题，不虚构错误、进步或成绩；AI 数学判断仍供教师覆核。',
                {'question': {k: q[k] for k in ('id', 'title', 'content', 'topic', 'level', 'hint')},
                 'grading': {'score': row['score'], 'maxScore': row['max_score'], 'feedback': row['feedback'],
                             'steps': json.loads(row['ai_steps'])},
                 'recent': history, 'recommendable': candidate_questions})
            self.fields(result, ('strength', 'focus', 'nextStep', 'recommendedIds'), ('strength', 'focus', 'nextStep'))
            suggestion = {k: self.text(result[k], k, 2000) for k in ('strength', 'focus', 'nextStep')}
            ids = result.get('recommendedIds')
            selected = recommended
            if ids is not None:
                if not isinstance(ids, list) or len(ids) > 6 or any(type(v) is not int for v in ids):
                    raise ValueError('推薦編號無效')
                allowed = {v['id']: v for v in recommended}
                # 无效模型推荐不进入响应，回退到真实题库精选候选。
                selected = [allowed[v] for v in dict.fromkeys(ids) if v in allowed] or recommended
            notice = ('AI 即時評分與學習建議；自主練習分數只作個人練習紀錄，不需教師批閱。'
                      if row['method'] == 'ai-practice' else 'AI 學習建議和數學判斷僅供教師覆核。')
            suggestion.update(source='ai', recommended=selected, notice=notice)
        except Exception:
            suggestion = fallback
            suggestion['notice'] += ' AI 學習建議生成失敗，已保留批改成績並使用規則建議。'
        with self.app.db() as db:
            db.execute('UPDATE attempts SET suggestion=? WHERE id=? AND teacher_reviewed=0',
                       (json.dumps(suggestion, ensure_ascii=False), row['id']))

    def calendar(self, db, query, user):
        values = {}
        for key, value in parse_qsl(query, keep_blank_values=True):
            if key not in ('from', 'to') or key in values:
                self.fail(400, '日曆查詢只接受唯一的 from 與 to 參數。')
            values[key] = value
        if set(values) != {'from', 'to'}:
            self.fail(400, '必須提供 from 與 to 日期。')
        start, end = self._calendar_day('from', values['from']), self._calendar_day('to', values['to'])
        if start > end:
            self.fail(400, 'from 不可晚於 to。')
        if (end - start).days > 62:
            self.fail(400, '查詢範圍最多 62 天。')
        if user['role'] == 'teacher':
            rows = db.execute('SELECT * FROM assignments WHERE teacher_id=? ORDER BY id', (user['id'],)).fetchall()
        else:
            rows = db.execute('SELECT a.* FROM assignments a JOIN assignment_recipients r '
                              'ON r.assignment_id=a.id WHERE r.user_id=? ORDER BY a.id', (user['id'],)).fetchall()
        events = []
        for row in rows:
            common = {'kind': row['kind'], 'title': row['title'], 'assignmentId': row['id'],
                      'classId': row['class_id'], 'className': row['class_name'], 'dueAt': row['due_at']}
            if user['role'] == 'teacher':
                recipients = db.execute('SELECT user_id FROM assignment_recipients WHERE assignment_id=?',
                                        (row['id'],)).fetchall()
                common['studentCount'] = len(recipients)
                common['submittedCount'] = sum(
                    self.submission(db, row['id'], r['user_id'])['status'] in ('submitted', 'correction')
                    for r in recipients)
            else:
                common['myStatus'] = self.submission(db, row['id'], user['id'])['status']
            for event, day in (('published', self._calendar_date(row['created_at'])),
                               ('due', self._calendar_date(row['due_at']))):
                if day is not None and start.isoformat() <= day <= end.isoformat():
                    events.append({'date': day, 'event': event, **common})
        events.sort(key=lambda e: (e['date'], 0 if e['event'] == 'published' else 1, e['assignmentId']))
        # 提醒事項只屬於本人，教師與學生各自看到自己的。
        notes = [self.note_public(r) for r in db.execute(
            'SELECT * FROM calendar_notes WHERE user_id=? AND date>=? AND date<=? ORDER BY date,id',
            (user['id'], start.isoformat(), end.isoformat())).fetchall()]
        return {'events': events, 'notes': notes, 'from': values['from'], 'to': values['to']}

    @staticmethod
    def note_public(row):
        return {'id': row['id'], 'date': row['date'], 'title': row['title'], 'note': row['note'],
                'kind': row['kind'], 'createdAt': row['created_at']}

    def _calendar_day(self, field, value):
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            self.fail(400, f'{field} 必須是 YYYY-MM-DD 格式。')
        try:
            return date.fromisoformat(value)
        except ValueError:
            self.fail(400, f'{field} 不是有效日期。')

    @staticmethod
    def _calendar_date(value):
        try:
            return datetime.fromisoformat(value.replace('Z', '+00:00')).date().isoformat()
        except (ValueError, AttributeError, TypeError):
            return None

    def dispatch(self, method, path, body, user, query=''):
        if method == 'GET' and path == '/api/homework':
            with self.app.db() as db:
                if user['role'] == 'teacher':
                    classes = db.execute('SELECT * FROM classes WHERE teacher_id=? ORDER BY id', (user['id'],)).fetchall()
                    assignments = db.execute('SELECT * FROM assignments WHERE teacher_id=? ORDER BY id DESC', (user['id'],)).fetchall()
                else:
                    classes = db.execute('SELECT c.* FROM classes c WHERE EXISTS '
                                         '(SELECT 1 FROM class_students s WHERE s.class_id=c.id AND s.user_id=?) '
                                         'OR EXISTS (SELECT 1 FROM assignments a JOIN assignment_recipients r '
                                         'ON r.assignment_id=a.id WHERE a.class_id=c.id AND r.user_id=?) ORDER BY c.id',
                                         (user['id'], user['id'])).fetchall()
                    assignments = db.execute('SELECT a.* FROM assignments a JOIN assignment_recipients r '
                                             'ON r.assignment_id=a.id WHERE r.user_id=? ORDER BY a.id DESC', (user['id'],)).fetchall()
                result = {'classes': [self.class_public(db, r, user) for r in classes],
                          'assignments': [self.assignment_public(db, r, user) for r in assignments], 'ai': self.app.ai.public()}
                if user['role'] == 'teacher':
                    # 一併回「匯入老師」（created_by）與名字——管理班級時可按老師篩選。
                    result['students'] = [dict(r) for r in db.execute(
                        "SELECT s.id, s.name, s.username, s.seat, "
                        "       s.created_by AS createdBy, "
                        "       COALESCE(t.name, '') AS createdByName "
                        "FROM users s LEFT JOIN users t ON t.id = s.created_by "
                        "WHERE s.role='student' "
                        "ORDER BY CASE WHEN s.seat IS NULL OR trim(s.seat)='' THEN 1 ELSE 0 END, "
                        "CAST(s.seat AS INTEGER), s.seat, s.name, s.id")]
            return result
        if method == 'GET' and path == '/api/calendar':
            with self.app.db() as db:
                return self.calendar(db, query, user)
        if method == 'POST' and path == '/api/calendar/notes':
            self.fields(body, ('date', 'title', 'note'), ('date', 'title'))
            day = self._calendar_day('日期', body['date'])
            title = self.text(body['title'], '提醒標題', 120)
            note = self.text(body['note'], '提醒內容', 2000, empty=True) if 'note' in body else ''
            with self.app.db() as db:
                if db.execute('SELECT COUNT(*) FROM calendar_notes WHERE user_id=?', (user['id'],)).fetchone()[0] >= 500:
                    self.fail(409, '提醒事項最多 500 則。')
                cur = db.execute('INSERT INTO calendar_notes(user_id,date,title,note,kind,created_at) VALUES(?,?,?,?,?,?)',
                                 (user['id'], day.isoformat(), title, note, 'reminder', self.utc_now()))
                row = db.execute('SELECT * FROM calendar_notes WHERE id=?', (cur.lastrowid,)).fetchone()
            return {'note': self.note_public(row)}
        note_delete = re.fullmatch(r'/api/calendar/notes/([1-9]\d{0,17})/delete', path)
        if method == 'POST' and note_delete:
            self.fields(body, ())
            with self.app.db() as db:
                row = db.execute('SELECT * FROM calendar_notes WHERE id=?', (int(note_delete[1]),)).fetchone()
                if not row or row['user_id'] != user['id']:
                    self.fail(404, '找不到這則提醒。')
                db.execute('DELETE FROM calendar_notes WHERE id=?', (row['id'],))
            return {'deleted': row['id']}
        if method == 'POST' and path == '/api/classes':
            self.app.teacher(user)
            # 建立班級不必先選學生：studentIds 可省略或給空陣列。
            self.fields(body, ('name', 'studentIds'), ('name',))
            name = self.text(body['name'], '班級名稱', 200)
            raw_ids = body.get('studentIds') or []
            ids = self.ids(raw_ids, '學生編號', 1000) if raw_ids else []
            with self.app.db() as db:
                db.execute('BEGIN IMMEDIATE')
                for uid in ids:
                    row = db.execute('SELECT role FROM users WHERE id=?', (uid,)).fetchone()
                    if not row or row['role'] != 'student':
                        self.fail(400, '班級成員必須全部是已存在的學生。')
                cur = db.execute('INSERT INTO classes(teacher_id,name) VALUES(?,?)', (user['id'], name))
                db.executemany('INSERT INTO class_students(class_id,user_id) VALUES(?,?)', [(cur.lastrowid, uid) for uid in ids])
                result = self.class_public(db, db.execute('SELECT * FROM classes WHERE id=?', (cur.lastrowid,)).fetchone(), user)
            return {'class': result}
        assign_del = re.fullmatch(r'/api/assignments/([1-9]\d{0,17})/delete', path)
        if method == 'POST' and assign_del:
            # 刪除作業：只有佈置者或管理員可以。會一併刪除學生的作答與成績——
            # 這是不可逆的，前端要明確警告。
            self.app.teacher(user)
            aid = int(assign_del[1])
            with self.app.db() as db:
                row = db.execute('SELECT * FROM assignments WHERE id=?', (aid,)).fetchone()
                if row is None:
                    self.fail(404, '找不到這份作業。')
                if row['teacher_id'] != user['id'] and not self.app.is_owner(user, db):
                    self.fail(403, '只有佈置這份作業的教師或管理員可以刪除。')
                db.execute('BEGIN IMMEDIATE')
                # 作答（含分數、AI 建議、手寫圖）——作業沒了就沒有歸屬，一併刪。
                removed = db.execute('DELETE FROM attempts WHERE assignment_id=?', (aid,)).rowcount
                db.execute('DELETE FROM assignment_questions WHERE assignment_id=?', (aid,))
                db.execute('DELETE FROM assignment_recipients WHERE assignment_id=?', (aid,))
                db.execute('DELETE FROM assignments WHERE id=?', (aid,))
            return {'deleted': aid, 'attempts': removed}
        class_del = re.fullmatch(r'/api/classes/([1-9]\d{0,17})/delete', path)
        if method == 'POST' and class_del:
            # 刪除班級：只有建立者或管理員可以。有作業的班級先拒絕，避免作業變孤兒、
            # 學生成績無處可查。
            self.app.teacher(user)
            cid = int(class_del[1])
            with self.app.db() as db:
                row = db.execute('SELECT * FROM classes WHERE id=?', (cid,)).fetchone()
                if row is None:
                    self.fail(404, '找不到這個班級。')
                if row['teacher_id'] != user['id'] and not self.app.is_owner(user, db):
                    self.fail(403, '只有建立這個班級的教師或管理員可以刪除。')
                used = db.execute('SELECT count(*) AS n FROM assignments WHERE class_id=?',
                                  (cid,)).fetchone()['n']
                if used:
                    self.fail(400, f'這個班級還有 {used} 份作業；請先處理這些作業再刪除班級。')
                db.execute('BEGIN IMMEDIATE')
                db.execute('DELETE FROM class_students WHERE class_id=?', (cid,))
                db.execute('DELETE FROM classes WHERE id=?', (cid,))
            return {'deleted': cid}
        class_path = re.fullmatch(r'/api/classes/([1-9]\d{0,17})', path)
        if method == 'POST' and class_path:
            # 更新班級：名稱與學生名單。建立班級時不必先選學生，之後在這裡加。
            self.app.teacher(user)
            self.fields(body, ('name', 'studentIds'), ('name',))
            name = self.text(body['name'], '班級名稱', 200)
            raw_ids = body.get('studentIds') or []
            ids = self.ids(raw_ids, '學生編號', 1000) if raw_ids else []
            cid = int(class_path[1])
            with self.app.db() as db:
                row = db.execute('SELECT * FROM classes WHERE id=?', (cid,)).fetchone()
                if row is None:
                    self.fail(404, '找不到這個班級。')
                if row['teacher_id'] != user['id'] and not self.app.is_owner(user, db):
                    self.fail(403, '只能修改自己建立的班級。')
                db.execute('BEGIN IMMEDIATE')
                for uid in ids:
                    r = db.execute('SELECT role FROM users WHERE id=?', (uid,)).fetchone()
                    if not r or r['role'] != 'student':
                        self.fail(400, '班級成員必須全部是已存在的學生。')
                db.execute('UPDATE classes SET name=? WHERE id=?', (name, cid))
                db.execute('DELETE FROM class_students WHERE class_id=?', (cid,))
                db.executemany('INSERT INTO class_students(class_id,user_id) VALUES(?,?)',
                               [(cid, uid) for uid in ids])
                result = self.class_public(db, db.execute('SELECT * FROM classes WHERE id=?', (cid,)).fetchone(), user)
            return {'class': result}
        if method == 'POST' and path == '/api/assignments':
            self.app.teacher(user)
            self.fields(body, ('title', 'classId', 'questionIds', 'dueAt', 'description', 'allowLate', 'kind',
                               'durationMinutes', 'aiGrading'),
                        ('title', 'classId', 'questionIds', 'dueAt'))
            title = self.text(body['title'], '作業標題', 200)
            kind = body.get('kind', 'homework')
            if kind not in ('homework', 'quiz'):
                self.fail(400, 'kind 必須是 homework 或 quiz。')
            cid = self.number(body['classId'], '班級編號', 1, 2**63 - 1, True)
            ids = self.ids(body['questionIds'], '題目編號', 30)
            due = self.deadline(body['dueAt'])
            description = self.text(body.get('description', ''), '作业说明', 4000, empty=True)
            allow_late = body.get('allowLate', False)
            if type(allow_late) is not bool:
                self.fail(400, 'allowLate 必須是布林值。')
            # 是否使用 AI 建議評分：只有教師能決定，且 AI 未接入時不得啟用（避免出現假的 AI 成績）。
            ai_grading = body.get('aiGrading', False)
            if type(ai_grading) is not bool:
                self.fail(400, 'aiGrading 必須是布林值。')
            if ai_grading and not self.app.ai.configured:
                self.fail(409, '尚未接入 AI 模型，無法啟用 AI 建議評分。')
            duration = body.get('durationMinutes')
            if duration is not None:
                duration = self.number(duration, '作答時間（分鐘）', 1, 300, True)
            with self.app.db() as db:
                db.execute('BEGIN IMMEDIATE')
                classroom = db.execute('SELECT * FROM classes WHERE id=?', (cid,)).fetchone()
                if not classroom:
                    self.fail(404, '找不到班級。')
                if classroom['teacher_id'] != user['id']:
                    self.fail(403, '只能向自己的班級佈置作業。')
                recipients = db.execute('SELECT user_id FROM class_students WHERE class_id=?', (cid,)).fetchall()
                if not recipients:
                    self.fail(400, '班級至少需要一名學生。')
                questions = [self.app.get_question(db, qid) for qid in ids]
                if any(not self.recommendable(q) for q in questions):
                    self.fail(400, '作業題必須已有答案，且已完成教師核驗。')
                self.deadline(due)
                cur = db.execute('INSERT INTO assignments(teacher_id,class_id,class_name,title,description,due_at,created_at,allow_late,kind,duration_minutes,ai_grading) '
                                 'VALUES(?,?,?,?,?,?,?,?,?,?,?)', (user['id'], cid, classroom['name'], title, description, due, self.utc_now(), int(allow_late), kind, duration, int(ai_grading)))
                aid = cur.lastrowid
                db.executemany('INSERT INTO assignment_questions(assignment_id,question_id,position,payload) VALUES(?,?,?,?)',
                               [(aid, q['id'], i, json.dumps(q, ensure_ascii=False)) for i, q in enumerate(questions)])
                db.executemany('INSERT INTO assignment_recipients(assignment_id,user_id) VALUES(?,?)', [(aid, r['user_id']) for r in recipients])
                result = self.assignment_public(db, db.execute('SELECT * FROM assignments WHERE id=?', (aid,)).fetchone(), user, True)
            return {'assignment': result}
        match = re.fullmatch(r'/api/assignments/([1-9]\d{0,17})(?:/(submit|results|return|start))?', path)
        if not match:
            return None
        aid, action = int(match[1]), match[2]
        if method == 'POST' and action == 'start':
            # 模擬測驗開始計時：只在第一次記錄 started_at，之後重複呼叫不會重置時間。
            if user['role'] != 'student':
                self.fail(403, '只有學生可以開始測驗。')
            self.fields(body, ())
            with self.app.db() as db:
                db.execute('BEGIN IMMEDIATE')
                assignment = self.get_assignment(db, aid, user)
                row = db.execute('SELECT * FROM assignment_recipients WHERE assignment_id=? AND user_id=?',
                                 (aid, user['id'])).fetchone()
                if row['submitted_at']:
                    self.fail(403, '已正式提交的測驗不能重新開始。')
                if assignment['duration_minutes'] and not row['started_at']:
                    db.execute('UPDATE assignment_recipients SET started_at=? WHERE assignment_id=? AND user_id=?',
                               (self.utc_now(), aid, user['id']))
                return {'mySubmission': self.submission(db, aid, user['id'])}
        if method == 'POST' and action == 'submit':
            if user['role'] != 'student':
                self.fail(403, '只有學生可以正式提交作業。')
            self.fields(body, ())
            with self.app.db() as db:
                db.execute('BEGIN IMMEDIATE')
                assignment = self.get_assignment(db, aid, user)
                current = self.submission(db, aid, user['id'])
                if current['status'] != 'submitted':
                    correction = self.open_correction(db, aid, user['id'])
                    timed_out = bool(current['expired'] and current['startedAt'] and not correction)
                    if not timed_out:
                        self.assert_open(db, aid, user)
                    else:
                        # 到期只封存已接收作答，不再接受新答案；未答題明確留空待教師處理。
                        latest_ids = {r['question_id'] for r in self.latest(db, aid, user['id'])}
                        for q in self.questions(db, aid):
                            if q['id'] not in latest_ids:
                                db.execute('INSERT INTO attempts(user_id,question_id,answer_text,score,max_score,status,'
                                           'feedback,submitted_at,method,assignment_id,suggestion) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                                           (user['id'], q['id'], '', None, q['points'], 'pending',
                                            '測驗到期時此題未作答，等待教師處理；未自動記零分。', self.utc_now(),
                                            'pending-teacher', aid, '{}'))
                    if correction:
                        required = json.loads(correction['question_ids']) or [q['id'] for q in self.questions(db, aid)]
                        latest = {r['question_id']: r for r in self.latest(db, aid, user['id'])}
                        # 訂正必須是教師要求之後的新作答，不能沿用舊紀錄。
                        missing = [q for q in required
                                   if q not in latest or latest[q]['id'] <= correction['min_attempt_id']]
                        if missing:
                            self.fail(400, f'訂正範圍內還有 {len(missing)} 題尚未重新作答。')
                        db.execute('UPDATE corrections SET resolved_at=? WHERE id=?',
                                   (self.utc_now(), correction['id']))
                    else:
                        # 每題都要有交代：作答，或明確標示「不會」。不逼學生亂填，也不讓空白題悄悄消失。
                        ordered = self.questions(db, aid)
                        answered = {r['question_id'] for r in self.latest(db, aid, user['id'])}
                        missing = [i + 1 for i, q in enumerate(ordered) if q['id'] not in answered]
                        if missing:
                            shown = '、'.join(f'第 {n} 題' for n in missing[:8])
                            more = f'（另有 {len(missing) - 8} 題）' if len(missing) > 8 else ''
                            self.fail(400, f'還有 {len(missing)} 題沒有作答，也沒有標示「不會」：{shown}{more}。'
                                           '每題請選擇作答，或按「本題不會」讓老師知道。')
                    now = self.utc_now()
                    if current['submittedAt']:
                        db.execute('UPDATE assignment_recipients SET resubmitted_at=?,submit_count=submit_count+1 '
                                   'WHERE assignment_id=? AND user_id=?', (now, aid, user['id']))
                    else:
                        db.execute('UPDATE assignment_recipients SET submitted_at=?,late=?,submit_count=1 '
                                   'WHERE assignment_id=? AND user_id=?',
                                   (now, int(self.is_late(assignment)), aid, user['id']))
                return {'report': self.report(db, assignment, user['id'], reviewed_only=True),
                        'mySubmission': self.submission(db, aid, user['id'])}
        if method == 'POST' and action == 'return':
            self.app.teacher(user)
            self.fields(body, ('studentId', 'questionIds', 'note'), ('studentId', 'note'))
            student_id = self.number(body['studentId'], '學生編號', 1, 2**63 - 1, True)
            note = self.text(body['note'], '訂正說明', 2000)
            with self.app.db() as db:
                db.execute('BEGIN IMMEDIATE')
                assignment = self.get_assignment(db, aid, user)
                recipient = db.execute('SELECT * FROM assignment_recipients WHERE assignment_id=? AND user_id=?',
                                       (aid, student_id)).fetchone()
                if not recipient:
                    self.fail(404, '此學生不在這份作業的收件名單內。')
                if recipient['submitted_at'] is None:
                    self.fail(400, '此學生尚未正式提交，無需退回訂正。')
                if self.open_correction(db, aid, student_id):
                    self.fail(409, '此學生已有進行中的訂正要求。')
                all_ids = [q['id'] for q in self.questions(db, aid)]
                ids = self.ids(body['questionIds'], '訂正題目', 30) if 'questionIds' in body else list(all_ids)
                if any(q not in all_ids for q in ids):
                    self.fail(400, '訂正題目不屬於此作業。')
                marker = db.execute('SELECT COALESCE(MAX(id),0) FROM attempts WHERE assignment_id=? AND user_id=?',
                                    (aid, student_id)).fetchone()[0]
                round_no = db.execute('SELECT COALESCE(MAX(round),0)+1 FROM corrections '
                                      'WHERE assignment_id=? AND user_id=?', (aid, student_id)).fetchone()[0]
                db.execute('INSERT INTO corrections(assignment_id,user_id,requested_by,note,question_ids,'
                           'min_attempt_id,round,requested_at) VALUES(?,?,?,?,?,?,?,?)',
                           (aid, student_id, user['id'], note, json.dumps(ids), marker, round_no, self.utc_now()))
                correction = self.correction_public(self.open_correction(db, aid, student_id))
                report = self.report(db, assignment, student_id)
            return {'correction': correction, 'report': report}
        if method == 'GET' and action == 'results':
            self.app.teacher(user)
            with self.app.db() as db:
                assignment = self.get_assignment(db, aid, user)
                return {'assignment': self.assignment_public(db, assignment, user, True), **self.results(db, assignment)}
        if method == 'GET' and action is None:
            with self.app.db() as db:
                assignment = self.get_assignment(db, aid, user)
                questions = [self.app.question_public(q, user) for q in self.questions(db, aid)]
                if user['role'] == 'teacher':
                    rows = db.execute('SELECT a.*,u.name AS student_name,u.username AS student_username,'
                                      'u.seat AS student_seat FROM attempts a '
                                      'JOIN users u ON u.id=a.user_id WHERE a.assignment_id=? ORDER BY a.id DESC', (aid,)).fetchall()
                else:
                    rows = db.execute('SELECT * FROM attempts WHERE assignment_id=? AND user_id=? ORDER BY id DESC', (aid, user['id'])).fetchall()
                attempts = [self.app.attempt_public(db, r, user) for r in rows]
                if user['role'] == 'teacher':
                    for attempt, row in zip(attempts, rows):
                        attempt['student'] = {'id': row['user_id'], 'name': row['student_name'],
                                              'username': row['student_username'], 'seat': row['student_seat']}
                result = {'assignment': self.assignment_public(db, assignment, user, True), 'questions': questions,
                          'attempts': attempts, 'report': None}
                if user['role'] == 'student':
                    result.update(report=self.report(db, assignment, user['id'], reviewed_only=True),
                                  mySubmission=self.submission(db, aid, user['id']))
                return result
        return None
