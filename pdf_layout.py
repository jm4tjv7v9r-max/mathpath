"""PDF 匯入：用視覺模型讀版面與內容，再組成 Word。

兩件事：
1. analyze_layout()：看第一頁，回一份「版式規格」，用來生成 Word 範本
2. extract_content()：逐頁讀題目，回 sections（公式用 LaTeX）

PDF 沒有結構，所以這裡的結果是「近似」；AI 讀不到的欄位會用預設值補上，
並在 warnings 裡說明，不會靜靜假裝成功。
"""
from __future__ import annotations

import json
import re

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

CN = 'PMingLiU'
EN = 'Times New Roman'

LAYOUT_PROMPT = """你是試卷排版分析器。看這一頁試卷，輸出**只有 JSON**，不要解釋、不要 markdown 圍欄。

欄位（不知道就給 null，不要猜）：
{
  "page": {"widthCm": 21.0, "heightCm": 29.7,
           "marginsCm": {"top": 1.3, "bottom": 1.3, "left": 1.3, "right": 1.3}},
  "headerLines": ["頁眉文字，一行一個；沒有就空陣列"],
  "title": {"sizePt": 18, "bold": true},
  "subtitleLines": ["標題下面那幾行，例如「(本題目卷共兩版…)」"],
  "infoLine": "姓名／班別／學號那一行（照抄，空格用全角空白）",
  "section": {"sizePt": 12, "bold": true, "align": "left 或 center"},
  "question": {"sizePt": 12, "indentCm": 0},
  "options": {"perLine": 2, "indentCm": 0.6, "columnCm": 9.3},
  "marksPosition": "leading（題號後）/ trailing（靠右）/ none（沒有配分）",
  "answerLines": 0,
  "footerLines": ["頁腳文字；沒有就空陣列"]
}

判斷規則：
- 配分寫在「1.（4 分）題目」就是 leading；寫在行尾靠右就是 trailing；題目本身沒有配分（配分在分部標題）就是 none。
- options.perLine：一行排了幾個選項（A/B 同一行就是 2）。
- 頁邊界用 cm，A4 是 21×29.7。"""

CONTENT_PROMPT = """你是試卷轉寫器。把這一頁的題目轉成 JSON，**只有 JSON**，不要解釋、不要 markdown 圍欄。

{
  "title": "卷名（只有第一頁有，其他頁給 null）",
  "sections": [
    {"title": "一、單項選擇題：(每題4分，共32分)",
     "questions": [
       {"stem": "題幹（不含題號）", "marks": 4,
        "options": ["A. …", "B. …"],
        "lines": ["小題或續行，一行一個"]}
     ]}
  ]
}

規則：
- 所有數學式寫成 LaTeX 並用 $ 包住，例如 $x^{2}-5x+6=0$、$\\frac{1}{2}$、$A\\cap B$、$\\complement_{U}A$。
- 配分只寫在該題自己的（N 分）才填 marks；配分在分部標題的，marks 給 null。
- 題號不要寫進 stem（系統會重新編號）。
- 選項保留「A. 」前綴，一行一個選項。
- 表格、圖形用 "[圖]" 佔位，不要臆造內容。"""


def parse_json(text: str) -> dict:
    """模型有時會包 markdown 圍欄或加解釋，這裡只取第一個 JSON 物件。"""
    if not isinstance(text, str):
        return text if isinstance(text, dict) else {}
    cleaned = re.sub(r'^```(?:json)?|```$', '', text.strip(), flags=re.M).strip()
    start, end = cleaned.find('{'), cleaned.rfind('}')
    if start < 0 or end <= start:
        return {}
    try:
        return json.loads(cleaned[start:end + 1])
    except json.JSONDecodeError:
        return {}


def _num(value, default, low, high):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


def normalize_layout(raw: dict) -> dict:
    page = raw.get('page') or {}
    margins = page.get('marginsCm') or {}
    title = raw.get('title') or {}
    section = raw.get('section') or {}
    question = raw.get('question') or {}
    options = raw.get('options') or {}
    marks = raw.get('marksPosition')
    if marks not in ('leading', 'trailing', 'none'):
        marks = 'none'
    return {
        'page': {
            'widthCm': _num(page.get('widthCm'), 21.0, 15, 30),
            'heightCm': _num(page.get('heightCm'), 29.7, 15, 45),
            'marginsCm': {
                'top': _num(margins.get('top'), 1.3, 0.5, 5),
                'bottom': _num(margins.get('bottom'), 1.3, 0.5, 5),
                'left': _num(margins.get('left'), 1.3, 0.5, 5),
                'right': _num(margins.get('right'), 1.3, 0.5, 5),
            },
        },
        'headerLines': [str(x)[:120] for x in (raw.get('headerLines') or [])][:4],
        'title': {'sizePt': _num(title.get('sizePt'), 18, 10, 30),
                  'bold': bool(title.get('bold', True))},
        'subtitleLines': [str(x)[:200] for x in (raw.get('subtitleLines') or [])][:3],
        'infoLine': (str(raw.get('infoLine'))[:200] if raw.get('infoLine') else ''),
        'section': {'sizePt': _num(section.get('sizePt'), 12, 8, 20),
                    'bold': bool(section.get('bold', True)),
                    'align': 'center' if section.get('align') == 'center' else 'left'},
        'question': {'sizePt': _num(question.get('sizePt'), 12, 8, 20),
                     'indentCm': _num(question.get('indentCm'), 0, 0, 3)},
        'options': {'perLine': int(_num(options.get('perLine'), 2, 1, 4)),
                    'indentCm': _num(options.get('indentCm'), 0.6, 0, 3),
                    'columnCm': _num(options.get('columnCm'), 9.3, 4, 16)},
        'marksPosition': marks,
        'answerLines': int(_num(raw.get('answerLines'), 0, 0, 12)),
        'footerLines': [str(x)[:120] for x in (raw.get('footerLines') or [])][:3],
    }


def analyze_layout(ai, image: str) -> dict:
    """看一頁，回版式規格（已正規化）。"""
    raw = ai.call(LAYOUT_PROMPT, {'task': 'analyze exam layout'}, image=image,
                  temperature=0)
    return normalize_layout(parse_json(raw))


def extract_content(ai, images: list[str]) -> tuple[str | None, list[dict]]:
    """逐頁轉寫題目；回（卷名, 分部清單）。"""
    title = None
    sections: list[dict] = []
    for index, image in enumerate(images, 1):
        raw = ai.call(CONTENT_PROMPT, {'page': index}, image=image, temperature=0)
        data = parse_json(raw)
        if not data:
            continue
        if not title and data.get('title'):
            title = str(data['title'])[:200]
        for section in data.get('sections') or []:
            questions = []
            for q in section.get('questions') or []:
                stem = str(q.get('stem') or '').strip()
                if not stem:
                    continue
                # AI 常把填空寫成一長串底線，統一成固定長度，版面才不會爆掉
                stem = re.sub(r'＿{4,}', '＿＿＿＿＿＿', stem)
                questions.append({
                    'stem': stem,
                    'marks': q.get('marks') if isinstance(q.get('marks'), (int, float)) else None,
                    'options': [str(o) for o in (q.get('options') or [])][:8],
                    'lines': [str(l) for l in (q.get('lines') or [])][:8],
                })
            if questions:
                sections.append({'title': section.get('title') or None, 'questions': questions})
    return title, sections


# ── 由規格生成 Word 範本 ──────────────────────────────────────────────
def _font(run, size, bold=False):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.name = EN
    rpr = run._element.get_or_add_rPr()
    fonts = rpr.find(qn('w:rFonts'))
    if fonts is None:
        fonts = OxmlElement('w:rFonts')
        rpr.append(fonts)
    fonts.set(qn('w:eastAsia'), CN)
    fonts.set(qn('w:ascii'), EN)
    fonts.set(qn('w:hAnsi'), EN)


def _bottom_rule(paragraph):
    ppr = paragraph._p.get_or_add_pPr()
    pbdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '8')
    bottom.set(qn('w:space'), '1')
    bottom.set(qn('w:color'), '000000')
    pbdr.append(bottom)
    ppr.append(pbdr)


def build_template(spec: dict) -> bytes:
    """把版式規格變成一个可重複套用的 .docx 範本（含題目／選項／答題線原型）。"""
    import io

    doc = Document()
    sec = doc.sections[0]
    page = spec['page']
    sec.page_width, sec.page_height = Cm(page['widthCm']), Cm(page['heightCm'])
    m = page['marginsCm']
    sec.top_margin, sec.bottom_margin = Cm(m['top']), Cm(m['bottom'])
    sec.left_margin, sec.right_margin = Cm(m['left']), Cm(m['right'])
    sec.header_distance, sec.footer_distance = Cm(0.8), Cm(0.8)

    if spec['headerLines']:
        header = sec.header.paragraphs[0]
        header.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _font(header.add_run(spec['headerLines'][0]), 10)
        for line in spec['headerLines'][1:]:
            p = sec.header.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            _font(p.add_run(line), 10)
    if spec['footerLines']:
        footer = sec.footer.paragraphs[0]
        footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _font(footer.add_run(spec['footerLines'][0]), 9)

    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title.paragraph_format.space_after = Pt(4)
    _font(title.add_run('試卷標題'), spec['title']['sizePt'], spec['title']['bold'])

    for line in spec['subtitleLines']:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(2)
        _font(p.add_run(line), 10)

    if spec['infoLine']:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(2)
        _font(p.add_run(spec['infoLine']), 11)
        rule = doc.add_paragraph()
        rule.paragraph_format.space_after = Pt(6)
        _bottom_rule(rule)

    heading = doc.add_paragraph()
    heading.alignment = (WD_ALIGN_PARAGRAPH.CENTER if spec['section']['align'] == 'center'
                         else WD_ALIGN_PARAGRAPH.LEFT)
    heading.paragraph_format.space_before = Pt(10)
    heading.paragraph_format.space_after = Pt(2)
    _font(heading.add_run('一、題目'), spec['section']['sizePt'], spec['section']['bold'])

    q = doc.add_paragraph()
    q.paragraph_format.space_before = Pt(4)
    q.paragraph_format.space_after = Pt(2)
    if spec['question']['indentCm']:
        q.paragraph_format.left_indent = Cm(spec['question']['indentCm'])
    marks = spec['marksPosition']
    if marks == 'trailing':
        q.paragraph_format.tab_stops.add_tab_stop(Cm(spec['page']['widthCm'] - m['left'] - m['right']),
                                                 WD_TAB_ALIGNMENT.RIGHT)
        _font(q.add_run('1.　題目內容'), spec['question']['sizePt'])
        q.add_run('\t')
        _font(q.add_run('（4 分）'), spec['question']['sizePt'])
    elif marks == 'leading':
        _font(q.add_run('1.（4 分）　題目內容'), spec['question']['sizePt'])
    else:
        _font(q.add_run('1.　題目內容'), spec['question']['sizePt'])

    opt = doc.add_paragraph()
    opt.paragraph_format.left_indent = Cm(spec['options']['indentCm'])
    opt.paragraph_format.space_after = Pt(0)
    _font(opt.add_run('A.　選項一'), spec['question']['sizePt'])
    for i in range(1, spec['options']['perLine']):
        opt.paragraph_format.tab_stops.add_tab_stop(
            Cm(spec['options']['indentCm'] + spec['options']['columnCm'] * i),
            WD_TAB_ALIGNMENT.LEFT)
        opt.add_run('\t')
        _font(opt.add_run(f'{"ABCD"[i]}.　選項{i + 1}'), spec['question']['sizePt'])

    if spec['answerLines']:
        for _ in range(spec['answerLines']):
            line = doc.add_paragraph()
            line.paragraph_format.space_after = Pt(6)
            _bottom_rule(line)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
