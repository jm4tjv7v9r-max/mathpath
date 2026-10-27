"""卷面排版（範本 → 新卷）的後端測試。

獨立成一個檔案：只依賴 server.Application 的公開介面（dispatch），
不碰 test_server 的測試夾具。
"""
import base64
import io
import json
import tempfile
import unittest

from docx import Document
from docx.shared import Pt

import omml
import server

DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'


def make_docx(blocks):
    """blocks: [(文字, 字級, 粗體)]，回傳 docx bytes。"""
    doc = Document()
    for text, size, bold in blocks:
        p = doc.add_paragraph()
        run = p.add_run(text)
        run.font.size = Pt(size)
        run.font.bold = bold
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def data_url(data):
    return 'data:' + DOCX_MIME + ';base64,' + base64.b64encode(data).decode()


TEMPLATE = [
    ('某某中學 數學測驗', 16, True),
    ('一、選擇題：(每題 4 分)', 12, True),
    ('1.　下列哪一個是質數？（　　）', 12, False),
    ('A.　4\tB.　6', 12, False),
]


def content_docx():
    doc = Document()
    doc.add_paragraph('中三數學 小測')
    p = doc.add_paragraph('一、計算題')
    q = doc.add_paragraph('1.　解方程 ')
    q._p.append(omml.latex_to_omml('x^{2}-5x+6=0'))
    q.add_run('。')
    q2 = doc.add_paragraph('2.　計算 ')
    q2._p.append(omml.latex_to_omml(r'\frac{1}{2}+\frac{1}{3}'))
    q2.add_run('。')
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


class PaperTemplateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = server.Application(self.tmp.name, server.ROOT)
        self.app.initialize()
        with self.app.db() as db:
            teacher = db.execute("SELECT * FROM users WHERE role='teacher' ORDER BY id LIMIT 1").fetchone()
            student = db.execute("SELECT * FROM users WHERE role='student' ORDER BY id LIMIT 1").fetchone()
        self.teacher = dict(teacher) if teacher else None
        self.student = dict(student) if student else None
        if not self.teacher:
            self.skipTest('沒有教師帳號')

    def tearDown(self):
        self.tmp.cleanup()

    def call(self, method, path, body=None, user=None, expect=200):
        try:
            payload, _ = self.app.dispatch(method, path, body or {}, user or self.teacher,
                                           None, '127.0.0.1')
        except server.APIError as exc:
            self.assertEqual(exc.status, expect, exc.message)
            return {'error': exc.message}
        self.assertEqual(expect, 200)
        return payload

    def upload(self, name='培華範本'):
        return self.call('POST', '/api/paper-templates',
                         {'name': name, 'file': data_url(make_docx(TEMPLATE))})

    def test_upload_list_and_spec(self):
        created = self.upload()
        template = created['template']
        self.assertEqual(template['name'], '培華範本')
        self.assertEqual(template['spec']['marksPosition'], 'none')
        self.assertEqual(template['spec']['optionsPerLine'], 2)

        listed = self.call('GET', '/api/paper-templates')
        self.assertIn(template['id'], [t['id'] for t in listed['templates']])

    def test_apply_returns_docx_with_formulas(self):
        template = self.upload()['template']
        out = self.call('POST', f"/api/paper-templates/{template['id']}/apply",
                        {'file': data_url(content_docx())})
        self.assertEqual(out['stats']['questions'], 2)
        self.assertEqual(out['stats']['formulas'], 2)
        self.assertTrue(out['docx'].startswith('data:' + DOCX_MIME))
        raw = base64.b64decode(out['docx'].split(',', 1)[1])
        doc = Document(io.BytesIO(raw))
        equations = sum(1 for p in doc.paragraphs for c in p._p if c.tag.endswith('}oMath'))
        self.assertEqual(equations, 2, '公式要原樣帶進輸出')
        self.assertEqual(doc.paragraphs[0].text, '中三數學 小測', '卷名要換成新卷的')

    def test_rejects_non_docx(self):
        self.call('POST', '/api/paper-templates',
                  {'name': '壞檔', 'file': data_url(b'not a zip')}, expect=400)

    def test_student_cannot_use_templates(self):
        if not self.student:
            self.skipTest('沒有學生帳號')
        self.call('GET', '/api/paper-templates', user=self.student, expect=403)

    def test_delete_removes_template(self):
        template = self.upload()['template']
        self.call('DELETE', f"/api/paper-templates/{template['id']}")
        listed = self.call('GET', '/api/paper-templates')
        self.assertNotIn(template['id'], [t['id'] for t in listed['templates']])


    def test_to_tex_keeps_math_and_structure(self):
        out = self.call('POST', '/api/papers/to-tex', {'file': data_url(content_docx())})
        tex = out['tex']
        self.assertIn(r'\documentclass', tex)
        self.assertIn(r'\begin{enumerate}', tex)
        self.assertIn('$x^{2}-5x+6=0$', tex, '公式要原樣輸出，不能再轉義')
        self.assertIn(r'\frac{1}{2}+\frac{1}{3}', tex)
        self.assertEqual(out['stats']['questions'], 2)
        self.assertTrue(out['filename'].endswith('.tex'))

    def test_to_tex_uses_custom_preamble(self):
        preamble = '\\documentclass{article}\n\\usepackage{amsmath}'
        out = self.call('POST', '/api/papers/to-tex',
                        {'file': data_url(content_docx()), 'preamble': preamble})
        self.assertTrue(out['tex'].startswith(preamble), out['tex'][:60])

    def test_to_tex_rejects_document_begin_in_preamble(self):
        self.call('POST', '/api/papers/to-tex',
                  {'file': data_url(content_docx()),
                   'preamble': '\\documentclass{article}\n\\begin{document}'}, expect=400)

    def test_student_cannot_export_tex(self):
        if not self.student:
            self.skipTest('沒有學生帳號')
        self.call('POST', '/api/papers/to-tex',
                  {'file': data_url(content_docx())}, user=self.student, expect=403)


if __name__ == '__main__':
    unittest.main()
