"""把新卷的內容套進範本的版式。

核心想法：**不重建排版，而是拿範本當容器**。
範本裡的頁面設定、頁眉頁腳、樣式、題號定位、答題橫線全部原封不動，
只把「題幹」與「配分」兩段文字換成新卷的內容——這樣才可能做到「完全一致」。

用法：
    python paper_format.py analyze 範本.docx
    python paper_format.py render 範本.docx 新卷.docx 輸出.docx
    python paper_format.py render-json 範本.docx 內容.json 輸出.docx
"""
from __future__ import annotations

import copy
import io
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

import omml

# ── 角色判定 ──────────────────────────────────────────────────────────
SECTION_RE = re.compile(r'^\s*(甲部|乙部|丙部|丁部|第[一二三四]部分|Part\s*[A-D]|[一二三四五六七八九十]+、)')
QUESTION_RE = re.compile(r'^\s*(\d{1,3})\s*[.、)．]')
OPTION_RE = re.compile(r'[(（]?([A-Da-d])\s*[.、)．]')
MARKS_RE = re.compile(r'[（(]\s*(\d+(?:\.\d+)?)\s*分\s*[)）]')
# 一行裡有多個選項（「A. … B. …」）時，要拆成獨立選項
OPTION_SPLIT_RE = re.compile(r'(?=\s*[(（]?[A-Da-d]\s*[.、)．])')


def split_options(text: str) -> list[str]:
    parts = [p.strip() for p in OPTION_SPLIT_RE.split(text) if p.strip()]
    return parts if len(parts) > 1 else [text.strip()]
# 一行裡有多個選項（「A. … B. …」）時，要拆成獨立選項
OPTION_SPLIT_RE = re.compile(r'(?=\s*[(（]?[A-Da-d]\s*[.、)．])')


def split_options(text: str) -> list[str]:
    parts = [p.strip() for p in OPTION_SPLIT_RE.split(text) if p.strip()]
    return parts if len(parts) > 1 else [text.strip()]


def has_bottom_border(p) -> bool:
    ppr = p._p.pPr
    if ppr is None:
        return False
    pbdr = ppr.find(qn('w:pBdr'))
    if pbdr is None:
        return False
    bottom = pbdr.find(qn('w:bottom'))
    return bottom is not None and bottom.get(qn('w:val')) not in (None, 'nil', 'none')


def classify(text: str, p) -> str:
    t = text.strip()
    if not t:
        return 'answer_line' if has_bottom_border(p) else 'blank'
    if SECTION_RE.match(t):
        return 'section'
    if QUESTION_RE.match(t):
        return 'question'
    if OPTION_RE.match(t):
        return 'option'
    return 'other'


def run_style(p) -> dict:
    for r in p.runs:
        if r.text.strip():
            return {'font': r.font.name,
                    'sizePt': r.font.size.pt if r.font.size else None,
                    'bold': bool(r.font.bold)}
    return {}


def alignment_name(p) -> str:
    a = p.paragraph_format.alignment
    return {WD_ALIGN_PARAGRAPH.CENTER: 'center', WD_ALIGN_PARAGRAPH.RIGHT: 'right',
            WD_ALIGN_PARAGRAPH.JUSTIFY: 'justify', WD_ALIGN_PARAGRAPH.LEFT: 'left',
            None: 'left'}.get(a, str(a))


@dataclass
class Block:
    role: str
    text: str
    style: dict = field(default_factory=dict)
    align: str = 'left'
    lines_after: int = 0


def read_blocks(doc) -> list[Block]:
    """把段落分成角色。空的框線段落在題目後面才算「答題橫線」，否則算「分隔線」。"""
    blocks: list[Block] = []
    last_role = None
    for p in doc.paragraphs:
        role = classify(p.text, p)
        if role == 'answer_line' and last_role not in ('question', 'answer_line'):
            role = 'rule'          # 卷頭那條橫線，不是答題空間
        blocks.append(Block(role=role, text=p.text, style=run_style(p), align=alignment_name(p)))
        if role != 'blank':
            last_role = role
    for i, b in enumerate(blocks):
        if b.role != 'question':
            continue
        n = 0
        for nxt in blocks[i + 1:]:
            if nxt.role != 'answer_line':
                break
            n += 1
        b.lines_after = n
    return blocks


def marks_position(question_text: str) -> str:
    """配分寫在題號後面（leading）、推到右邊（trailing），還是根本沒有。"""
    if MARKS_RE.search(question_text[:16]):
        return 'leading'
    if '\t' in question_text and MARKS_RE.search(question_text.split('\t')[-1]):
        return 'trailing'
    return 'none'


def _analyze_doc(doc, source_name: str) -> dict:
    sec = doc.sections[0]
    blocks = read_blocks(doc)

    prototypes = {}
    for role in ('section', 'question', 'option', 'answer_line', 'rule', 'other'):
        for b in blocks:
            if b.role == role:
                prototypes[role] = asdict(b)
                break

    question_text = prototypes.get('question', {}).get('text', '')
    option_text = prototypes.get('option', {}).get('text', '')

    lines_by_index: list[int | None] = []
    for b in blocks:
        if b.role == 'section':
            lines_by_index.append(None)
        elif b.role == 'question' and lines_by_index and lines_by_index[-1] is None:
            lines_by_index[-1] = b.lines_after

    return {
        'source': source_name,
        'page': {
            'widthCm': round(sec.page_width.cm, 2), 'heightCm': round(sec.page_height.cm, 2),
            'marginsCm': {'top': round(sec.top_margin.cm, 2), 'bottom': round(sec.bottom_margin.cm, 2),
                          'left': round(sec.left_margin.cm, 2), 'right': round(sec.right_margin.cm, 2)},
            'headerCm': round(sec.header_distance.cm, 2), 'footerCm': round(sec.footer_distance.cm, 2),
        },
        'header': [p.text for p in sec.header.paragraphs if p.text.strip()],
        'footer': [p.text for p in sec.footer.paragraphs if p.text.strip()],
        'marksPosition': marks_position(question_text),
        'optionsPerLine': max(1, len(OPTION_RE.findall(option_text))),
        'prototypes': prototypes,
        'answerLinesBySection': lines_by_index,
        'counts': {r: sum(1 for b in blocks if b.role == r) for r in
                   ('section', 'question', 'option', 'answer_line', 'rule', 'other')},
        'tables': [{'rows': len(t.rows), 'cols': len(t.columns),
                    'firstCell': t.cell(0, 0).text.strip()[:40]} for t in doc.tables],
        'warnings': (['範本含表格：表格內容目前不會被帶進輸出'] if doc.tables else []),
    }


def analyze(path: str) -> dict:
    return _analyze_doc(Document(path), Path(path).name)


def analyze_bytes(data: bytes) -> dict:
    """伺服器上傳用：直接分析記憶體裡的 docx。"""
    return _analyze_doc(Document(io.BytesIO(data)), 'uploaded.docx')


# ── 內容模型 ──────────────────────────────────────────────────────────
@dataclass
class Question:
    stem: str
    marks: float | None = None
    options: list[str] = field(default_factory=list)
    lines: list[str] = field(default_factory=list)      # 小題或續行


@dataclass
class Section:
    title: str | None
    questions: list[Question] = field(default_factory=list)


def sections_from_json(path: str) -> tuple[str | None, list[Section], str | None]:
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    sections = []
    for s in data.get('sections', []):
        sections.append(Section(title=s.get('title'), questions=[
            Question(stem=q['stem'], marks=q.get('marks'), options=q.get('options') or [],
                     lines=q.get('lines') or [])
            for q in s.get('questions', [])
        ]))
    return data.get('title'), sections, data.get('closing')


def parse_content(path: str) -> tuple[list[str], list[Section]]:
    doc = Document(path)
    preamble: list[str] = []
    sections: list[Section] = []
    current: Section | None = None
    for p in doc.paragraphs:
        text = omml.omml_latex_of_paragraph(p).strip() or p.text.strip()
        if not text:
            continue
        role = classify(text, p)
        if role == 'section':
            current = Section(title=text)
            sections.append(current)
        elif role == 'question':
            if current is None:
                current = Section(title=None)
                sections.append(current)
            m = MARKS_RE.search(text)
            marks = float(m.group(1)) if m else None
            stem = MARKS_RE.sub('', text)
            stem = QUESTION_RE.sub('', stem, count=1).strip()
            current.questions.append(Question(stem=stem, marks=marks))
        elif role == 'option' and current and current.questions:
            current.questions[-1].options.extend(split_options(text))
        elif current and current.questions:
            current.questions[-1].stem += text
        else:
            preamble.append(text)
    return preamble, [s for s in sections if s.questions]


# ── 套版 ──────────────────────────────────────────────────────────────
def _text_runs(p):
    """不含 tab 的文字 run（設 text='' 會連 <w:tab/> 一起刪掉）。"""
    return [r for r in p.runs if r.text.replace('\t', '').strip() != '']


def _fill_slots(p, texts: list[str]):
    """把 texts 依序填進段落既有的文字 run，保留 tab／框線／字體。"""
    slots = _text_runs(p)
    for r, t in zip(slots, texts):
        r.text = t
    for r in slots[len(texts):]:
        if r.text.strip():
            r.text = ''


MATH_RE = re.compile(r'\$([^$]+)\$')


def split_math(text: str):
    """把「文字 $公式$ 文字」切成 [('text', ...), ('math', ...)]。"""
    parts, pos = [], 0
    for m in MATH_RE.finditer(text):
        if m.start() > pos:
            parts.append(('text', text[pos:m.start()]))
        parts.append(('math', m.group(1)))
        pos = m.end()
    if pos < len(text):
        parts.append(('text', text[pos:]))
    return parts or [('text', text)]


def _fill_rich(slot_run, text: str):
    """在一個 run 的位置上，把文字與 $公式$ 混排成 run + m:oMath。"""
    anchor = slot_run._r
    first = True
    for kind, value in split_math(text):
        if kind == 'text':
            if first:
                slot_run.text = value
            else:
                run_el = copy.deepcopy(slot_run._r)
                for t in run_el.findall(qn('w:t')):
                    run_el.remove(t)
                t = OxmlElement('w:t')
                t.text = value
                t.set(qn('xml:space'), 'preserve')
                run_el.append(t)
                anchor.addnext(run_el)
                anchor = run_el
        else:
            om = omml.latex_to_omml(value)
            anchor.addnext(om)
            anchor = om
        first = False


def _fill_slots_rich(p, texts: list[str]):
    """_fill_slots 的加強版：支援 $...$ 公式，其餘行為相同。"""
    slots = _text_runs(p)
    for r, t in zip(slots, texts):
        _fill_rich(r, t)
    for r in slots[len(texts):]:
        if r.text.strip():
            r.text = ''


def _clone(doc, prototype_el, before):
    el = copy.deepcopy(prototype_el)
    before.addprevious(el)
    return Paragraph(el, doc)


def _marks_text(prototype_right: str, marks: float | None) -> str:
    if marks is None:
        return ''
    m = MARKS_RE.search(prototype_right or '')
    if not m:
        return f'（{marks:g} 分）'
    raw = m.group(0)
    space = ' ' if ' ' in raw else ''
    return f'{raw[0]}{marks:g}{space}分{raw[-1]}'


def _heading_text(template_title: str, new_title: str, questions) -> str:
    if not new_title or '（' in new_title or '(' in new_title:
        return new_title
    marks = [q.marks for q in questions if q.marks is not None]
    if not marks or not template_title:
        return new_title
    if template_title.strip()[:2] != new_title.strip()[:2] or '（' not in template_title:
        return new_title
    total = sum(marks)
    if len(set(marks)) == 1:
        return f'{new_title.strip()}（每題 {marks[0]:g} 分，共 {total:g} 分）'
    return f'{new_title.strip()}（共 {total:g} 分）'


def count_formulas(sections: list[Section]) -> int:
    total = 0
    for s in sections:
        for q in s.questions:
            for text in [q.stem, *q.lines, *q.options]:
                total += len(MATH_RE.findall(text))
    return total


def _render_into(tpl, sections: list[Section], title: str | None = None,
                 closing: str | None = None) -> dict:
    """把內容套進一個已開啟的 Document（不存檔，讓呼叫端決定存哪裡）。"""
    blocks = read_blocks(tpl)
    paragraphs = tpl.paragraphs

    proto: dict[str, Paragraph] = {}
    for i, b in enumerate(blocks):
        if b.role not in proto:
            proto[b.role] = paragraphs[i]
    if 'question' not in proto:
        raise SystemExit('範本裡找不到題目段落（長得像「1. …」）')

    q_proto = proto['question']
    pos = marks_position(q_proto.text)
    q_slots = len(_text_runs(q_proto))
    marks_proto = q_proto.text.split('\t')[-1] if pos == 'trailing' else ''

    # 卷頭：第一個分部之前的所有段落（標題、副標、資料行、橫線）
    first_section = next((i for i, b in enumerate(blocks) if b.role == 'section'), len(blocks))
    head_idx = [i for i in range(first_section) if blocks[i].role in ('other', 'rule', 'blank')]

    lines_by_index: list[int | None] = []
    for b in blocks:
        if b.role == 'section':
            lines_by_index.append(None)
        elif b.role == 'question' and lines_by_index and lines_by_index[-1] is None:
            lines_by_index[-1] = b.lines_after
    default_lines = next((n for n in lines_by_index if n), 0)

    body = tpl.element.body
    sectpr = body.find(qn('w:sectPr'))
    for child in list(body):
        if child is sectpr:
            continue
        body.remove(child)

    cloned_head = [_clone(tpl, paragraphs[i]._p, sectpr) for i in head_idx]
    if title:
        for p in cloned_head:
            if classify(p.text, p) == 'other' and p.runs:
                _fill_slots_rich(p, [title])
                break

    number = 1
    template_headings = [b.text for b in blocks if b.role == 'section']
    for index, s in enumerate(sections):
        if s.title and 'section' in proto:
            np = _clone(tpl, proto['section']._p, sectpr)
            tpl_title = template_headings[index] if index < len(template_headings) else ''
            _fill_slots_rich(np, [_heading_text(tpl_title, s.title, s.questions)])
        lines = lines_by_index[index] if index < len(lines_by_index) and lines_by_index[index] \
            else default_lines

        for q in s.questions:
            np = _clone(tpl, q_proto._p, sectpr)
            if pos == 'trailing':
                _fill_slots_rich(np, [f'{number}.　{q.stem}', _marks_text(marks_proto, q.marks)])
            elif q.marks is not None:
                _fill_slots_rich(np, [f'{number}.{_marks_text("（0 分）", q.marks)}　{q.stem}'])
            else:
                _fill_slots_rich(np, [f'{number}.　{q.stem}'])
            number += 1

            for extra in q.lines:
                ep = _clone(tpl, q_proto._p, sectpr)
                _fill_slots_rich(ep, [extra] + ([''] if q_slots >= 2 else []))

            if q.options and 'option' in proto:
                per_line = max(1, len(OPTION_RE.findall(proto['option'].text)))
                if per_line >= 2:
                    # 兩個選項太長時硬排同一行會擠在一起（tab 被推過定位點就失效），
                    # 這種情況改成一行一個，寧可多佔行也不要疊字。
                    def too_long(pair):
                        plain = [MATH_RE.sub(lambda m: 'x' * len(m.group(1)), o) for o in pair]
                        return sum(len(o) for o in plain) > 36

                    i = 0
                    while i < len(q.options):
                        pair = q.options[i:i + 2]
                        if len(pair) == 2 and not too_long(pair):
                            op = _clone(tpl, proto['option']._p, sectpr)
                            _fill_slots_rich(op, pair)
                            i += 2
                        else:
                            for single in pair:
                                op = _clone(tpl, proto['option']._p, sectpr)
                                _fill_slots_rich(op, [single, ''] if per_line >= 2 else [single])
                            i += len(pair)
                else:
                    for opt in q.options:
                        op = _clone(tpl, proto['option']._p, sectpr)
                        _fill_slots_rich(op, [opt])

            if 'answer_line' in proto and lines and not q.options:
                for _ in range(lines):
                    _clone(tpl, proto['answer_line']._p, sectpr)

    if closing and 'other' in proto:
        cp = _clone(tpl, proto['other']._p, sectpr)
        _fill_slots_rich(cp, [closing])

    if tpl.tables:
        print(f'⚠️ 範本有 {len(tpl.tables)} 個表格，內容未帶入輸出', file=sys.stderr)
    return {'title': title, 'sections': len(sections),
            'questions': sum(len(s.questions) for s in sections),
            'formulas': count_formulas(sections),
            'tables': len(tpl.tables)}


def render_sections(template_path: str, sections: list[Section], out_path: str,
                    title: str | None = None, closing: str | None = None) -> dict:
    tpl = Document(template_path)
    report = _render_into(tpl, sections, title, closing)
    tpl.save(out_path)
    report['out'] = str(Path(out_path).resolve())
    return report


def render(template_path: str, content_path: str, out_path: str) -> dict:
    preamble, sections = parse_content(content_path)
    return render_sections(template_path, sections, out_path,
                           title=preamble[0] if preamble else None)


def parse_content_bytes(data: bytes) -> tuple[list[str], list[Section]]:
    """跟 parse_content 一樣，但吃記憶體裡的 docx（伺服器上傳用）。"""
    doc = Document(io.BytesIO(data))
    preamble: list[str] = []
    sections: list[Section] = []
    current: Section | None = None
    for p in doc.paragraphs:
        text = omml.omml_latex_of_paragraph(p).strip() or p.text.strip()
        if not text:
            continue
        role = classify(text, p)
        if role == 'section':
            current = Section(title=text)
            sections.append(current)
        elif role == 'question':
            if current is None:
                current = Section(title=None)
                sections.append(current)
            m = MARKS_RE.search(text)
            marks = float(m.group(1)) if m else None
            stem = MARKS_RE.sub('', text)
            stem = QUESTION_RE.sub('', stem, count=1).strip()
            current.questions.append(Question(stem=stem, marks=marks))
        elif role == 'option' and current and current.questions:
            current.questions[-1].options.extend(split_options(text))
        elif current and current.questions:
            current.questions[-1].stem += text
        else:
            preamble.append(text)
    return preamble, [s for s in sections if s.questions]


def render_with_sections(template_bytes: bytes, sections: list[Section],
                         title: str | None = None) -> tuple[bytes, dict]:
    """已經有 Section 物件時用這個（例如 PDF 由 AI 轉寫出來的內容）。"""
    tpl = Document(io.BytesIO(template_bytes))
    report = _render_into(tpl, sections, title)
    buf = io.BytesIO()
    tpl.save(buf)
    return buf.getvalue(), report


def render_bytes(template_bytes: bytes, content_bytes: bytes) -> tuple[bytes, dict]:
    """伺服器用：兩份 docx 的 bytes 進，排好版的 docx bytes 出。"""
    tpl = Document(io.BytesIO(template_bytes))
    preamble, sections = parse_content_bytes(content_bytes)
    report = _render_into(tpl, sections, preamble[0] if preamble else None)
    buf = io.BytesIO()
    tpl.save(buf)
    return buf.getvalue(), report


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'analyze'
    if cmd == 'analyze':
        print(json.dumps(analyze(sys.argv[2]), ensure_ascii=False, indent=2))
    elif cmd == 'render':
        print(json.dumps(render(sys.argv[2], sys.argv[3], sys.argv[4]), ensure_ascii=False, indent=2))
    elif cmd == 'render-json':
        t, s, c = sections_from_json(sys.argv[3])
        print(json.dumps(render_sections(sys.argv[2], s, sys.argv[4], title=t, closing=c),
                         ensure_ascii=False, indent=2))
    else:
        raise SystemExit('用法：analyze <範本> | render <範本> <新卷.docx> <輸出> | '
                         'render-json <範本> <內容.json> <輸出>')
