"""LaTeX／XeLaTeX 匯出：轉義、數學式保留、題目卷與答案版，並用真實 xelatex 驗證可編譯。"""
import json
import shutil
import struct
import subprocess
import tempfile
import unittest
import zlib
from pathlib import Path

import latex
import server
import test_server


def png_bytes(width=120, height=90):
    """最小但合法的 PNG（題目圖形）。"""
    def chunk(kind, payload):
        return (struct.pack('>I', len(payload)) + kind + payload
                + struct.pack('>I', zlib.crc32(kind + payload) & 0xffffffff))
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw += bytes([40, 90, 60]) if (x // 10 + y // 10) % 2 else bytes([250, 250, 248])
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(raw), 6)) + chunk(b'IEND', b''))


def data_url(raw):
    import base64
    return 'data:image/png;base64,' + base64.b64encode(raw).decode()


GEOMETRY = {
    'title': '直角三角形求斜邊',
    'content': '直角三角形兩條直角邊長為 $3\\text{ cm}$ 和 $4\\text{ cm}$，求斜邊長（100% 準確，_x^2 & #1）。',
    'topic': '幾何', 'subtopic': '點、線、面、體', 'grade': '中三', 'level': 1, 'points': 5,
    'qtype': '解答題', 'answer': '$5\\text{ cm}$',
    'steps': ['用畢氏定理 $a^2+b^2=c^2$。', '代入得 $c=5$。'],
    'analysis': '考點是畢氏定理與單位。',
    'rubric': [{'label': '正確列式', 'percent': 60}, {'label': '答案與單位', 'percent': 40}],
    'hint': '先寫出 $c^2=3^2+4^2$。', 'source': '校本題庫', 'tags': ['幾何', '基礎'],
    'options': [],
}


class LatexUnitTests(unittest.TestCase):
    def test_math_is_kept_and_text_is_escaped(self):
        out = latex.latex_text('面積是 50% 的 $\\frac{1}{2}$ 與 a_b & c#d')
        self.assertIn('$\\frac{1}{2}$', out, '數學式要原樣保留')
        self.assertIn('50\\%', out)
        self.assertIn('a\\_b', out)
        self.assertIn('\\&', out)
        self.assertIn('\\#', out)
        self.assertNotIn('\\frac{1}{2}\\%', out)

    def test_display_math_and_unbalanced_dollar(self):
        out = latex.latex_text('$$x^2$$ 及 $y$ 與剩下的 $ 符號')
        self.assertIn('$$x^2$$', out)
        self.assertIn('$y$', out)
        self.assertTrue(out.endswith('\\$ 符號'), '落單的 $ 要轉義')

    def test_document_contains_answers_only_when_asked(self):
        with_answers = latex.document([dict(GEOMETRY, id=1)], title='T', date='2026-10-13')
        self.assertIn('參考答案與詳解', with_answers)
        self.assertIn('\\includegraphics', latex.document([dict(GEOMETRY, id=1)], figures={1: 'figures/q1.png'}))
        plain = latex.document([dict(GEOMETRY, id=1)], title='T', date='2026-10-13', include_answers=False)
        self.assertNotIn('參考答案與詳解', plain)
        self.assertIn('ctexart', plain, '預設用 ctexart 以便自動選中文字體')

    def test_choice_options_are_numbered(self):
        tex = latex.document([dict(GEOMETRY, id=2, options=['$x=3$', '$x=4$'])], title='T', date='2026-10-13')
        self.assertIn('\\begin{enumerate}[label=(\\Alph*),leftmargin=*]', tex)
        self.assertIn('\\item $x=3$', tex)


class LatexEndpointTests(test_server.APITests):
    def test_teacher_exports_questions_as_latex(self):
        _, imported, _ = self.request('POST', '/api/questions/import',
                                      {'questions': [dict(GEOMETRY, figure=data_url(png_bytes()))]},
                                      cookie=self.teacher, expect=200)
        qid = imported['questions'][0]['id']
        _, result, _ = self.request('POST', '/api/questions/latex',
                                    {'questionIds': [qid], 'title': '中三幾何', 'includeAnswers': True},
                                    cookie=self.teacher, expect=200)
        self.assertEqual(result['count'], 1)
        self.assertIn('\\documentclass', result['tex'])
        self.assertIn('直角三角形求斜邊', result['tex'])
        self.assertIn('\\includegraphics[width=0.5\\linewidth,keepaspectratio]{figures/q%d.png}' % qid,
                      result['tex'])
        self.assertEqual(result['figures'][0]['path'], f'figures/q{qid}.png')
        self.assertEqual(result['figures'][0]['url'], f'/api/questions/{qid}/figure')
        # 沒有圖形的題目不會產生 figures 項目
        _, plain, _ = self.request('POST', '/api/questions/latex', {'questionIds': [1]},
                                   cookie=self.teacher, expect=200)
        self.assertEqual(plain['figures'], [])

    def test_export_validation_and_rbac(self):
        self.request('POST', '/api/questions/latex', {'questionIds': [1]}, cookie=self.student, expect=403)
        self.request('POST', '/api/questions/latex', {}, cookie=self.teacher, expect=400)
        self.request('POST', '/api/questions/latex', {'questionIds': []}, cookie=self.teacher, expect=400)
        self.request('POST', '/api/questions/latex', {'questionIds': list(range(1, 202))},
                     cookie=self.teacher, expect=400)
        self.request('POST', '/api/questions/latex', {'questionIds': [1], 'includeAnswers': 'yes'},
                     cookie=self.teacher, expect=400)
        self.request('POST', '/api/questions/latex', {'questionIds': [99999]}, cookie=self.teacher, expect=404)
        # 重複編號只匯出一次
        _, result, _ = self.request('POST', '/api/questions/latex', {'questionIds': [1, 1, 2]},
                                    cookie=self.teacher, expect=200)
        self.assertEqual(result['count'], 2)


class LatexCompileTests(unittest.TestCase):
    """真的用 XeLaTeX 編譯一次，確保匯出的檔案不是「看起來像 LaTeX」而已。"""

    def test_generated_tex_compiles_with_xelatex(self):
        xelatex = shutil.which('xelatex')
        if not xelatex:
            self.skipTest('此機器沒有安裝 XeLaTeX')
        questions = [dict(GEOMETRY, id=12), dict(GEOMETRY, id=13, title='圓的面積',
                                                 content='半徑 $r=3$ 的圓，求面積。')]
        tex = latex.document(questions, title='中三幾何練習', date='2026-10-13',
                             figures={12: 'figures/q12.png'})
        with tempfile.TemporaryDirectory(prefix='mathpath-tex-') as tmp:
            root = Path(tmp)
            (root / 'figures').mkdir()
            (root / 'questions.tex').write_text(tex, encoding='utf-8')
            (root / 'figures' / 'q12.png').write_bytes(png_bytes())
            proc = subprocess.run([xelatex, '-interaction=nonstopmode', '-halt-on-error', 'questions.tex'],
                                  cwd=root, capture_output=True, text=True, timeout=180)
            log = (root / 'questions.log').read_text(encoding='utf-8', errors='replace') if (root / 'questions.log').exists() else ''
            self.assertEqual(proc.returncode, 0, f'XeLaTeX 編譯失敗：\n{proc.stdout[-2000:]}\n{log[-1500:]}')
            self.assertTrue((root / 'questions.pdf').exists())
            self.assertGreater((root / 'questions.pdf').stat().st_size, 2000)
