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
import sqlite3
import tempfile

ARCHIVE_VERSION = 1
QUESTION_FORMAT = 'mathpath-question-archive'
STUDENT_FORMAT = 'mathpath-student-archive'
RESET_PHRASE = 'RESET'

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
    def __init__(self, app, fail, text, utc_now):
        self.app = app
        self.fail = fail
        self.text = text
        self.utc_now = utc_now

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
        total = db.execute('SELECT count(*) FROM questions').fetchone()[0]
        head = {'format': QUESTION_FORMAT, 'version': ARCHIVE_VERSION, 'exportedAt': stamp,
                'count': total, 'images': True,
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
