"""資料管理：用量統計、資料庫備份、題庫／學生作業歸檔、VACUUM 與學年重置。

設計原則
- 匯出（備份與歸檔）一律**串流下載**，不在伺服器留下暫存檔，避免佔用容器空間。
  （唯一的例外是資料庫快照：SQLite 的線上備份 API 需要一個檔案目標，會在系統暫存目錄產生後即刪。）
- **題庫歸檔與學生作業歸檔分開**：題庫跨學年保留，學生資料每學年重新設定。
- 只有教師可以使用；學年重置需要明確的確認字串，且一律保留題庫與教師帳號。
- 歸檔**不含密碼雜湊**：學生帳號在新學年重建，舊密碼無法也無需還原。
"""
import base64
import json
import os
import pathlib
import re
import secrets
import shutil
import sqlite3
import tempfile
import time

ARCHIVE_VERSION = 1
QUESTION_FORMAT = 'mathpath-question-archive'
STUDENT_FORMAT = 'mathpath-student-archive'
RESET_PHRASE = 'RESET'
# 還原：資料庫與學生歸檔用串流寫入暫存檔，題庫歸檔需整份載入記憶體，上限較嚴。
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
MAX_QUESTION_ARCHIVE_BYTES = 500 * 1024 * 1024
MAX_RESTORE_QUESTIONS = 20000
RESTORE_COMMIT_EVERY = 400
RESTORE_REQUIRED_TABLES = ('users', 'questions', 'attempts', 'meta')
QUESTION_ID_MAP_KEY = 'question_id_map'
PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
RESTORE_NOTICE = (
    '還原會新增資料，不會覆蓋同名的學生帳號；題庫還原預設只補上缺少的題目。'
    '歸檔不含密碼，還原後的學生需要新密碼。'
)

# 學年重置會清空的表（子表在前，符合外鍵刪除順序）。
# questions（題庫）、users 的教師帳號、meta 與 calendar_notes 都不在其中。
STUDENT_TABLES = ('corrections', 'attempts', 'assignment_recipients', 'assignment_questions',
                  'assignments', 'class_students', 'classes', 'mock_questions', 'mock_exams')

STAT_TABLES = ('questions', 'attempts', 'users', 'classes', 'assignments', 'mock_exams',
               'calendar_notes', 'sessions')

STUDENT_ARCHIVE_NOTICE = (
    '學生作業歸檔：帳號、班級、作業、作答、模擬測驗與訂正紀錄。'
    '不含密碼雜湊——新學年請重新匯入名單並發新密碼。'
)


class DataAdmin:
    def __init__(self, app, fail, text, utc_now, password_hash=None, seat_value=None,
                 student_name=None, question_valid=None, decode_figure=None, validate_image=None):
        self.app = app
        self.fail = fail
        self.text = text
        self.utc_now = utc_now
        # 由 server.py 注入的驗證／雜湊函式，避免模組互相 import。
        self.password_hash = password_hash
        self.seat_value = seat_value
        self.student_name = student_name
        self.question_valid = question_valid
        self.decode_figure = decode_figure
        self.validate_image = validate_image

    # ---------- 小工具 ----------
    def db_size(self):
        try:
            return os.path.getsize(self.app.db_path)
        except OSError:
            return 0

    def meta_value(self, db, key):
        row = db.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
        return row[0] if row else None

    @staticmethod
    def line(kind, payload):
        """歸檔用的單行 JSON（JSONL）：一行一筆，可逐行串流、也可用文字工具檢視。"""
        return (json.dumps({'type': kind, **payload}, ensure_ascii=False, default=str) + '\n').encode()

    @staticmethod
    def data_url(data, mime):
        return 'data:%s;base64,%s' % (mime, base64.b64encode(data).decode())

    def object_bytes(self, row, blob_key, mime_key, key_name):
        """讀取圖片位元組：優先物件儲存（R2），否則讀資料庫 BLOB。

        匯出過程中單張圖片讀取失敗（例如物件已被刪除）不應中斷整份歸檔，因此吞掉例外並回 (None, None)。
        """
        keys = row.keys()
        if key_name in keys and row[key_name]:
            try:
                return self.app.storage.get(row[key_name])
            except Exception:
                return None, None
        if row[blob_key] is None:
            return None, None
        return row[blob_key], row[mime_key] or 'image/png'

    # ---------- 用量統計 ----------
    def stats(self, db):
        page_size = db.execute('PRAGMA page_size').fetchone()[0]
        freelist = db.execute('PRAGMA freelist_count').fetchone()[0]
        counts = {t: db.execute('SELECT count(*) FROM "%s"' % t).fetchone()[0] for t in STAT_TABLES}
        figure = db.execute('SELECT coalesce(sum(length(figure)),0), count(figure_key) '
                            'FROM questions').fetchone()
        blobs = db.execute('SELECT count(image), count(annotation), coalesce(sum(length(image)),0), '
                           'coalesce(sum(length(annotation)),0), count(image_key), '
                           'count(annotation_key) FROM attempts').fetchone()
        return {
            'database': {'bytes': self.db_size(),
                         'reclaimableBytes': freelist * page_size,
                         'walBytes': self.wal_size()},
            'counts': counts,
            'images': {'handwriting': blobs[0], 'annotation': blobs[1], 'questionFigure': figure[1],
                       'inDatabaseBytes': blobs[2] + blobs[3] + figure[0],
                       'inObjectStorage': blobs[4] + blobs[5] + figure[1],
                       'storageMode': self.app.storage.mode},
            'lastStudentReset': self.meta_value(db, 'last_student_reset'),
            'questionBankKeptAcrossYears': True,
        }

    def wal_size(self):
        total = 0
        for suffix in ('-wal', '-shm'):
            try:
                total += os.path.getsize(str(self.app.db_path) + suffix)
            except OSError:
                pass
        return total

    # ---------- 題庫歸檔 ----------
    def question_archive(self, db, stamp):
        """題庫歸檔：題庫跨學年保留，這份檔案是備份與搬遷用，格式與題庫匯入相容。"""
        source_ids = [row[0] for row in db.execute('SELECT id FROM questions ORDER BY id')]
        total = len(source_ids)
        # sourceIds 與 questions 一一對應：還原時可保留原編號，讓學生歸檔的題號仍然對得上。
        head = {'format': QUESTION_FORMAT, 'version': ARCHIVE_VERSION, 'exportedAt': stamp,
                'count': total, 'images': True, 'sourceIds': source_ids,
                'notice': '題庫歸檔（不含學生資料）。題目依原編號順序排列，'
                          'questions 陣列可直接餵給題庫匯入（每批最多 100 題）。'}
        yield (json.dumps(head, ensure_ascii=False)[:-1] + ',"questions":[').encode()
        first = True
        # 刻意只輸出題目本身的欄位（不加 id 等額外欄位），這樣整份檔案可直接重新匯入。
        for row in db.execute('SELECT payload,figure,figure_mime,figure_key FROM questions ORDER BY id'):
            item = json.loads(row['payload'])
            data, mime = self.object_bytes(row, 'figure', 'figure_mime', 'figure_key')
            if data:
                item['figure'] = self.data_url(data, mime)
            yield ((',' if not first else '') + json.dumps(item, ensure_ascii=False)).encode()
            first = False
        yield b']}'

    # ---------- 學生作業歸檔 ----------
    def student_archive(self, db, stamp, with_images=True):
        """學生作業歸檔（JSONL）：帳號、班級、作業、作答、模擬測驗、訂正。不含密碼雜湊。"""
        counts = {t: db.execute('SELECT count(*) FROM "%s"' % t).fetchone()[0]
                  for t in ('users', 'classes', 'assignments', 'attempts', 'mock_exams', 'corrections')}
        head = {'format': STUDENT_FORMAT, 'version': ARCHIVE_VERSION, 'exportedAt': stamp,
                'images': with_images, 'counts': counts, 'notice': STUDENT_ARCHIVE_NOTICE}
        yield (json.dumps(head, ensure_ascii=False) + '\n').encode()
        # 帳號：只留識別資訊，不含 password 欄位（雜湊不外流）。
        for row in db.execute('SELECT id,username,name,role,seat,demo FROM users ORDER BY id'):
            yield self.line('student', dict(row))
        for table, kind in (('classes', 'class'), ('class_students', 'classStudent'),
                            ('assignments', 'assignment'), ('assignment_questions', 'assignmentQuestion'),
                            ('assignment_recipients', 'assignmentRecipient'),
                            ('corrections', 'correction'), ('mock_exams', 'mockExam'),
                            ('mock_questions', 'mockQuestion')):
            for row in db.execute('SELECT * FROM "%s"' % table):
                yield self.line(kind, dict(row))
        for row in db.execute('SELECT * FROM attempts ORDER BY id'):
            item = {k: row[k] for k in row.keys() if k not in ('image', 'annotation')}
            if with_images:
                data, mime = self.object_bytes(row, 'image', 'image_mime', 'image_key')
                if data:
                    item['image'] = self.data_url(data, mime)
                data, mime = self.object_bytes(row, 'annotation', 'annotation_mime', 'annotation_key')
                if data:
                    item['annotation'] = self.data_url(data, mime)
            yield self.line('attempt', item)

    # ---------- 資料庫快照 ----------
    def backup_to_temp(self, stamp):
        """用 SQLite 線上備份 API 產生一致的快照；回傳 (暫存目錄, 檔案路徑)。

        直接複製 .sqlite3 檔在 WAL 模式下可能拿到不一致的狀態，因此必須用 backup()。
        """
        directory = tempfile.mkdtemp(prefix='mathpath-backup-')
        target = os.path.join(directory, 'mathpath-%s.sqlite3' % stamp)
        source = sqlite3.connect(self.app.db_path, timeout=60)
        destination = sqlite3.connect(target)
        try:
            source.backup(destination)
        finally:
            destination.close()
            source.close()
        return directory, target

    # ---------- VACUUM ----------
    def vacuum(self):
        """壓實資料庫並清空 WAL。刪除作答或圖片後檔案不會自己縮小，要 VACUUM 才會還給系統。"""
        before = self.db_size()
        connection = sqlite3.connect(self.app.db_path, timeout=120)
        try:
            connection.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            connection.execute('VACUUM')
            connection.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        finally:
            connection.close()
        after = self.db_size()
        return {'beforeBytes': before, 'afterBytes': after,
                'savedBytes': max(0, before - after), 'at': self.utc_now()}

    # ---------- 學年重置 ----------
    def reset_students(self, db, confirm):
        """學年重置：清空學生作答、作業、班級、模擬測驗與學生帳號；題庫與教師帳號保留。

        需要明確的確認字串（RESET，不分大小寫），避免誤按造成不可逆的資料損失。
        """
        if not isinstance(confirm, str) or confirm.strip().upper() != RESET_PHRASE:
            self.fail(400, '請在確認欄輸入 %s 才能執行學年重置。' % RESET_PHRASE)
        removed, kept_questions = {}, db.execute('SELECT count(*) FROM questions').fetchone()[0]
        teachers = db.execute("SELECT count(*) FROM users WHERE role='teacher'").fetchone()[0]
        # 作答、作業、班級、模擬測驗與訂正全部清空（這些都屬於這一學年的紀錄）。
        for table in STUDENT_TABLES:
            removed[table] = db.execute('DELETE FROM "%s"' % table).rowcount
        # 先刪學生的工作階段，再刪帳號（順序反了會找不到對象）。
        # 內建演示帳號（demo=1）保留，方便教師重置後仍能查看學生端畫面。
        removed['sessions'] = db.execute(
            "DELETE FROM sessions WHERE user_id IN "
            "(SELECT id FROM users WHERE role='student' AND demo=0)").rowcount
        removed['students'] = db.execute(
            "DELETE FROM users WHERE role='student' AND demo=0").rowcount
        stamp = self.utc_now()
        db.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('last_student_reset',?)", (stamp,))
        return {'removed': removed, 'at': stamp,
                'kept': {'questions': kept_questions, 'teachers': teachers,
                         'notice': '題庫、教師帳號、內建演示帳號與日曆提醒都保留。'}}

    # ---------- 編輯學生 ----------
    def update_student(self, db, uid, body):
        """修改學生的學號、姓名、班內號或重設密碼；只填要改的欄位。

        重設密碼時會一併刪除該生所有登入工作階段，避免舊密碼仍然有效。
        """
        allowed = {'username', 'name', 'seat', 'password'}
        if not isinstance(body, dict) or not body or set(body) - allowed:
            self.fail(400, '只接受學號、姓名、班內號或新密碼，且至少要填一項。')
        row = db.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
        if row is None or row['role'] != 'student':
            self.fail(404, '找不到這位學生。')
        username = row['username']
        if 'username' in body:
            candidate = self.text(body['username'], '學號', 40, strip=False)
            if not re.fullmatch(r'[A-Za-z0-9_.-]{3,40}', candidate):
                self.fail(400, '學號須為 3 至 40 個 ASCII 字母、數字或 _ . -。')
            if candidate != username and db.execute('SELECT 1 FROM users WHERE username=?',
                                                    (candidate,)).fetchone():
                self.fail(409, '這個學號已經有人使用。')
            username = candidate
        assignments, values, changed = [], [], []
        if 'username' in body:
            assignments.append('username=?')
            values.append(username)
            changed.append('學號')
        if 'name' in body:
            # 姓名留空時自動回到學號，不會出現空白姓名。
            assignments.append('name=?')
            values.append(self.student_name(body['name'], username))
            changed.append('姓名')
        if 'seat' in body:
            assignments.append('seat=?')
            values.append(self.seat_value(body['seat']))
            changed.append('班內號')
        revoked = 0
        if 'password' in body and str(body['password']).strip():
            fresh = self.text(body['password'], '新密碼', 256, strip=False)
            if len(fresh) < 10:
                self.fail(400, '新密碼必須至少 10 字。')
            assignments.append('password=?')
            values.append(self.password_hash(fresh))
            revoked = db.execute('DELETE FROM sessions WHERE user_id=?', (uid,)).rowcount
            changed.append('密碼')
        if not assignments:
            self.fail(400, '沒有要修改的欄位。')
        db.execute('UPDATE users SET %s WHERE id=?' % ','.join(assignments), (*values, uid))
        updated = db.execute('SELECT id,username,name,role,seat FROM users WHERE id=?', (uid,)).fetchone()
        return {'user': dict(updated), 'changed': changed,
                'passwordReset': bool(revoked), 'sessionsRevoked': revoked}

    # ---------- 還原：共用 ----------
    @staticmethod
    def random_password(length=12):
        return ''.join(secrets.choice(PASSWORD_ALPHABET) for _ in range(length))

    @staticmethod
    def iter_jsonl(path):
        """逐行讀 JSONL；空行與壞行直接略過，不讓單一壞行中斷整份還原。"""
        with open(path, 'r', encoding='utf-8') as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except ValueError:
                    continue
                if isinstance(record, dict):
                    yield record

    def question_id_map(self):
        """讀取上次題庫還原留下的新舊編號對照；沒有就回空字典（代表題號沿用原值）。"""
        with self.app.db() as db:
            row = db.execute('SELECT value FROM meta WHERE key=?', (QUESTION_ID_MAP_KEY,)).fetchone()
        if not row:
            return {}
        try:
            return {int(k): int(v) for k, v in json.loads(row[0]).items()}
        except (ValueError, TypeError, AttributeError):
            return {}

    def decode_optional_image(self, value):
        """歸檔裡的圖片是 data URL；壞掉或空的就當作沒有圖片，不讓整份還原失敗。"""
        if not value or not isinstance(value, str):
            return None, None
        try:
            return self.validate_image(value)
        except Exception:
            return None, None

    def put_blob(self, folder, data, mime):
        """R2 模式時把二進位搬到物件儲存，資料庫只留 key；否則回 (data, None)。"""
        if data is not None and self.app.storage.mode == 'r2':
            return None, self.app.storage.put(folder, data, mime)
        return data, None

    def insert_question_row(self, db, question, figure, figure_mime, preferred_id=None):
        """寫入題目。preferred_id 可用時就保留原編號，讓還原後的題號與歸檔一致。"""
        if preferred_id is not None and not db.execute('SELECT 1 FROM questions WHERE id=?',
                                                       (preferred_id,)).fetchone():
            figure, figure_key = self.put_blob('figures', figure, figure_mime)
            db.execute('INSERT INTO questions(id,payload,figure,figure_mime,figure_key) VALUES(?,?,?,?,?)',
                       (preferred_id, json.dumps(question, ensure_ascii=False), figure, figure_mime, figure_key))
            return preferred_id
        return self.app.insert_question(db, question, figure, figure_mime)['id']

    # ---------- 還原：資料庫備份 ----------
    def restore_database(self, path):
        """用備份檔取代目前的資料庫，完整還原題庫、學生、作答與圖片。

        安全檢查：必須是 SQLite、含必要資料表、通過 integrity_check；
        通過後先把現有資料庫改名保留（mathpath.replaced-<時間>.sqlite3），再換上新檔並重跑遷移。
        """
        probe = sqlite3.connect(path)
        try:
            tables = {row[0] for row in probe.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            integrity = probe.execute('PRAGMA integrity_check').fetchone()[0]
        except sqlite3.Error as exc:
            self.fail(400, '檔案不是有效的 SQLite 資料庫：%s' % exc)
        finally:
            probe.close()
        missing = [name for name in RESTORE_REQUIRED_TABLES if name not in tables]
        if missing:
            self.fail(400, '這個資料庫缺少必要資料表（%s），不是 MathPath 的備份。' % '、'.join(missing))
        if integrity != 'ok':
            self.fail(400, '資料庫完整性檢查未通過（%s）；為避免損壞現有資料已中止。' % integrity)
        database = pathlib.Path(self.app.db_path)
        kept = database.with_name('mathpath.replaced-%s.sqlite3' % time.strftime('%Y%m%d-%H%M%S'))
        # 換檔前必須先移除舊的 WAL／SHM，否則 SQLite 會把舊交易日誌套到新檔案上。
        for suffix in ('-wal', '-shm'):
            sidecar = pathlib.Path(str(database) + suffix)
            if sidecar.exists():
                sidecar.unlink()
        os.replace(database, kept)
        shutil.copyfile(path, database)
        os.chmod(database, 0o600)
        self.app.initialize()
        with self.app.db() as db:
            counts = {name: db.execute('SELECT count(*) FROM "%s"' % name).fetchone()[0]
                      for name in ('questions', 'attempts', 'users')}
        return {'restored': True, 'keptPreviousAs': kept.name, 'counts': counts,
                'notice': '已用備份取代資料庫；被取代的舊資料庫保留在 data/%s，確認無誤後可自行刪除。' % kept.name}

    # ---------- 還原：題庫歸檔 ----------
    def restore_questions(self, path, replace=False):
        """從題庫歸檔還原題目，並記錄新舊編號對照（學生歸檔的題號靠它換算）。"""
        size = os.path.getsize(path)
        if size > MAX_QUESTION_ARCHIVE_BYTES:
            self.fail(413, '題庫歸檔不可超過 %d MB；更大的題庫請改用「資料庫備份還原」。'
                      % (MAX_QUESTION_ARCHIVE_BYTES // (1024 * 1024)))
        with open(path, 'rb') as handle:
            try:
                document = json.load(handle)
            except (ValueError, UnicodeDecodeError):
                self.fail(400, '檔案不是有效的 JSON。')
        if (not isinstance(document, dict) or document.get('format') != QUESTION_FORMAT
                or not isinstance(document.get('questions'), list)):
            self.fail(400, '這不是 MathPath 的題庫歸檔（缺少 format 或 questions）。')
        items = document['questions']
        if not 1 <= len(items) <= MAX_RESTORE_QUESTIONS:
            self.fail(400, '歸檔中的題目數量必須介於 1 與 %d 之間。' % MAX_RESTORE_QUESTIONS)
        raw_ids = document.get('sourceIds')
        source_ids = raw_ids if isinstance(raw_ids, list) and len(raw_ids) == len(items) else []
        inserted = skipped = 0
        mapping = {}
        with self.app.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if replace:
                referenced = db.execute('SELECT count(*) FROM attempts').fetchone()[0]
                if referenced:
                    self.fail(409, '題庫已被 %d 筆作答引用，無法整批取代；請先做學年重置，或改用「合併匯入」。'
                              % referenced)
                db.execute('DELETE FROM questions')
            # 標題存在 payload JSON 內（questions 表只有 payload 與圖形欄位）。
            known = {row[0] for row in db.execute("SELECT json_extract(payload,'$.title') FROM questions")
                     if row[0]}
            for index, raw in enumerate(items):
                if not isinstance(raw, dict):
                    self.fail(400, '第 %d 題的內容格式不正確。' % (index + 1))
                question = self.question_valid(raw)
                old_id = source_ids[index] if source_ids else None
                if not replace and question['title'] in known:
                    # 合併模式：標題已存在就沿用現有那題，只記錄編號對照。
                    if old_id is not None:
                        existing = db.execute(
                            "SELECT id FROM questions WHERE json_extract(payload,'$.title')=? ORDER BY id LIMIT 1",
                            (question['title'],)).fetchone()
                        if existing:
                            mapping[old_id] = existing[0]
                    skipped += 1
                    continue
                figure, figure_mime = self.decode_figure(raw.get('figure'))
                new_id = self.insert_question_row(db, question, figure, figure_mime, old_id)
                if old_id is not None:
                    mapping[old_id] = new_id
                known.add(question['title'])
                inserted += 1
            if mapping:
                db.execute('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)',
                           (QUESTION_ID_MAP_KEY, json.dumps({str(k): v for k, v in mapping.items()})))
        return {'inserted': inserted, 'skipped': skipped, 'mapped': len(mapping), 'total': len(items),
                'replaced': bool(replace),
                'notice': ('已保留原編號' if mapping and source_ids else
                           '歸檔沒有原編號資訊，題號可能與學生歸檔不一致；請用新版歸檔重新匯出')}

    # ---------- 還原：學生作業歸檔 ----------
    def restore_students(self, path, teacher_id, password=None):
        """從學生作業歸檔（JSONL）還原學生帳號、班級、作業與作答。

        歸檔不含密碼，因此每位學生都會配一組新密碼（可用參數指定共用密碼，否則自動產生）。
        題號會用題庫還原留下的對照表換算；對不上的紀錄會跳過並計數，不中斷整份還原。
        """
        initial = None
        if password is not None and str(password).strip():
            initial = self.text(password, '還原用初始密碼', 256, strip=False)
            if len(initial) < 10:
                self.fail(400, '還原用初始密碼必須至少 10 字。')
        first = next(self.iter_jsonl(path), None)
        if not first or first.get('format') != STUDENT_FORMAT:
            self.fail(400, '這不是 MathPath 的學生作業歸檔（缺少 format 標記）。')
        question_map = self.question_id_map()
        users, classes, assignments, exams = {}, {}, {}, {}
        written, skipped, credentials, bad_images = {}, {}, [], 0
        def bump(bucket, key):
            bucket[key] = bucket.get(key, 0) + 1
        def question_exists(db, old_id):
            new_id = question_map.get(old_id, old_id)
            if db.execute('SELECT 1 FROM questions WHERE id=?', (new_id,)).fetchone():
                return new_id
            return None
        processed = 0
        with self.app.db() as db:
            for record in self.iter_jsonl(path):
                processed += 1
                if processed % RESTORE_COMMIT_EVERY == 0:
                    db.commit()
                kind = record.get('type')
                if kind is None and record.get('format'):
                    continue          # 檔頭那一行
                if kind == 'student':
                    if record.get('role') not in (None, 'student'):
                        # 歸檔裡也含教師帳號；教師不由學生歸檔還原，避免角色錯亂。
                        bump(skipped, 'teacherRecord')
                        continue
                    username = record.get('username') if isinstance(record.get('username'), str) else ''
                    if not re.fullmatch(r'[A-Za-z0-9_.-]{3,40}', username):
                        bump(skipped, 'student')
                        continue
                    existing = db.execute('SELECT id FROM users WHERE username=?', (username,)).fetchone()
                    if existing:
                        users[record.get('id')] = existing[0]
                        bump(skipped, 'student')
                        continue
                    seat = self.seat_value(record.get('seat'))
                    name = self.student_name(record.get('name') if isinstance(record.get('name'), str) else None,
                                             username)
                    fresh = initial or self.random_password()
                    cur = db.execute('INSERT INTO users(username,name,role,password,demo,seat) VALUES(?,?,?,?,?,?)',
                                     (username, name, 'student', self.password_hash(fresh), 0, seat))
                    users[record.get('id')] = cur.lastrowid
                    credentials.append({'username': username, 'name': name, 'seat': seat or '',
                                        'password': fresh, 'generated': initial is None})
                    bump(written, 'student')
                elif kind == 'class':
                    name = record.get('name')
                    cur = db.execute('INSERT INTO classes(teacher_id,name) VALUES(?,?)',
                                     (teacher_id, str(name if isinstance(name, str) else '還原班級')[:200]))
                    classes[record.get('id')] = cur.lastrowid
                    bump(written, 'class')
                elif kind == 'classStudent':
                    cid, uid = classes.get(record.get('class_id')), users.get(record.get('user_id'))
                    if not cid or not uid:
                        bump(skipped, 'classStudent')
                        continue
                    db.execute('INSERT OR IGNORE INTO class_students(class_id,user_id) VALUES(?,?)', (cid, uid))
                    bump(written, 'classStudent')
                elif kind == 'assignment':
                    cid = classes.get(record.get('class_id'))
                    if not cid:
                        bump(skipped, 'assignment')
                        continue
                    cur = db.execute(
                        'INSERT INTO assignments(teacher_id,class_id,class_name,title,description,due_at,'
                        'created_at,allow_late,kind,duration_minutes,ai_grading) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                        (teacher_id, cid, str(record.get('class_name') or '')[:200],
                         str(record.get('title') or '還原作業')[:200],
                         str(record.get('description') or '')[:4000],
                         str(record.get('due_at') or self.utc_now()), str(record.get('created_at') or self.utc_now()),
                         int(record.get('allow_late') or 0),
                         record.get('kind') if record.get('kind') in ('homework', 'quiz') else 'homework',
                         record.get('duration_minutes'), int(record.get('ai_grading') or 0)))
                    assignments[record.get('id')] = cur.lastrowid
                    bump(written, 'assignment')
                elif kind == 'assignmentQuestion':
                    aid = assignments.get(record.get('assignment_id'))
                    qid = question_exists(db, record.get('question_id'))
                    if not aid or not qid:
                        bump(skipped, 'assignmentQuestion')
                        continue
                    db.execute('INSERT OR IGNORE INTO assignment_questions(assignment_id,question_id,position,payload)'
                               ' VALUES(?,?,?,?)',
                               (aid, qid, record.get('position') or 0, record.get('payload') or '{}'))
                    bump(written, 'assignmentQuestion')
                elif kind == 'assignmentRecipient':
                    aid, uid = assignments.get(record.get('assignment_id')), users.get(record.get('user_id'))
                    if not aid or not uid:
                        bump(skipped, 'assignmentRecipient')
                        continue
                    db.execute('INSERT OR IGNORE INTO assignment_recipients(assignment_id,user_id,submitted_at,late,'
                               'resubmitted_at,submit_count,started_at) VALUES(?,?,?,?,?,?,?)',
                               (aid, uid, record.get('submitted_at'), int(record.get('late') or 0),
                                record.get('resubmitted_at'), int(record.get('submit_count') or 0),
                                record.get('started_at')))
                    bump(written, 'assignmentRecipient')
                elif kind == 'correction':
                    aid, uid = assignments.get(record.get('assignment_id')), users.get(record.get('user_id'))
                    if not aid or not uid:
                        bump(skipped, 'correction')
                        continue
                    db.execute('INSERT INTO corrections(assignment_id,user_id,requested_by,note,question_ids,'
                               'min_attempt_id,round,requested_at,resolved_at) VALUES(?,?,?,?,?,?,?,?,?)',
                               (aid, uid, teacher_id, str(record.get('note') or ''), str(record.get('question_ids') or '[]'),
                                int(record.get('min_attempt_id') or 0), int(record.get('round') or 1),
                                str(record.get('requested_at') or self.utc_now()), record.get('resolved_at')))
                    bump(written, 'correction')
                elif kind == 'mockExam':
                    uid = users.get(record.get('user_id'))
                    if not uid:
                        bump(skipped, 'mockExam')
                        continue
                    cur = db.execute(
                        'INSERT INTO mock_exams(user_id,topic,level,qtype,minutes,question_count,created_at,'
                        'started_at,expires_at,submitted_at,expired,score,max_score,report,suggestion,subtopic)'
                        ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                        (uid, record.get('topic'), record.get('level'), record.get('qtype'),
                         int(record.get('minutes') or 0), int(record.get('question_count') or 0),
                         str(record.get('created_at') or self.utc_now()),
                         str(record.get('started_at') or self.utc_now()),
                         str(record.get('expires_at') or self.utc_now()), record.get('submitted_at'),
                         int(record.get('expired') or 0), record.get('score'), int(record.get('max_score') or 0),
                         record.get('report') or '{}', record.get('suggestion') or '{}', record.get('subtopic')))
                    exams[record.get('id')] = cur.lastrowid
                    bump(written, 'mockExam')
                elif kind == 'mockQuestion':
                    eid = exams.get(record.get('exam_id'))
                    qid = question_exists(db, record.get('question_id'))
                    if not eid or not qid:
                        bump(skipped, 'mockQuestion')
                        continue
                    db.execute('INSERT OR IGNORE INTO mock_questions(exam_id,question_id,position,payload)'
                               ' VALUES(?,?,?,?)', (eid, qid, record.get('position') or 0, record.get('payload') or '{}'))
                    bump(written, 'mockQuestion')
                elif kind == 'attempt':
                    uid = users.get(record.get('user_id'))
                    qid = question_exists(db, record.get('question_id'))
                    if not uid or not qid:
                        bump(skipped, 'attempt')
                        continue
                    image, image_mime = self.decode_optional_image(record.get('image'))
                    annotation, annotation_mime = self.decode_optional_image(record.get('annotation'))
                    if record.get('image') and image is None:
                        bad_images += 1
                    image, image_key = self.put_blob('attempts', image, image_mime)
                    annotation, annotation_key = self.put_blob('attempts', annotation, annotation_mime)
                    reviewed = int(record.get('teacher_reviewed') or 0)
                    db.execute(
                        'INSERT INTO attempts(user_id,question_id,answer_text,image,image_mime,score,max_score,status,'
                        'feedback,submitted_at,method,ai_steps,teacher_reviewed,reviewed_by,reviewed_at,assignment_id,'
                        'ai_score,rule_score,teacher_confirmed_score,suggestion,annotation,annotation_mime,image_key,'
                        'annotation_key,annotation_at,ai_annotation,ai_annotation_at,mock_id)'
                        ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                        (uid, qid, str(record.get('answer_text') or ''), image, image_mime, record.get('score'),
                         int(record.get('max_score') or 0),
                         record.get('status') if record.get('status') in ('graded', 'pending') else 'pending',
                         str(record.get('feedback') or ''), str(record.get('submitted_at') or self.utc_now()),
                         str(record.get('method') or 'pending-teacher'), record.get('ai_steps') or '[]',
                         reviewed, teacher_id if reviewed else None, record.get('reviewed_at'),
                         assignments.get(record.get('assignment_id')) if record.get('assignment_id') else None,
                         record.get('ai_score'), record.get('rule_score'), record.get('teacher_confirmed_score'),
                         record.get('suggestion') or '{}', annotation, annotation_mime, image_key, annotation_key,
                         record.get('annotation_at'), record.get('ai_annotation') or '{}',
                         record.get('ai_annotation_at'),
                         exams.get(record.get('mock_id')) if record.get('mock_id') else None))
                    bump(written, 'attempt')
                else:
                    bump(skipped, 'unknown')
        return {'written': written, 'skipped': skipped, 'credentials': credentials,
                'usedSharedPassword': initial is not None, 'unreadableImages': bad_images,
                'questionMapApplied': bool(question_map), 'notice': RESTORE_NOTICE}
