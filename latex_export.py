"""把卷的內容輸出成 LaTeX（給 Overleaf 用）。

設計原則：
- 中文用 ctexart + XeLaTeX（Overleaf 開新專案就能編）
- 題號連續、分部用 \\section*、選擇題的選項**打橫排**（一行 2～4 個，靠 \\hfill 撐開）
- 公式本來就是 LaTeX，原樣輸出；只做「會讓編譯失敗或走樣」的修正：
  \\degree → ^{\\circ}、全角括號 → 半角、\\sqrt[\\text{ }]{x} → \\sqrt{x}、
  sin/cos/tan 補反斜線、\\text{4x+3y-3=0} 這種純公式的 \\text 拆掉
- 文字裡的 & % $ # _ { } 會轉義，`$...$` 內的公式不動
"""
from __future__ import annotations

import re

MATH_RE = re.compile(r'\$([^$]+)\$')

DEFAULT_PREAMBLE = r"""% !TEX program = xelatex
\documentclass[12pt,a4paper]{ctexart}
\usepackage[margin=1.27cm]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{enumitem}
\usepackage{needspace}
\setlength{\parindent}{0pt}
\pagestyle{plain}
% 大題標題靠左（ctex 預設置中，跟原卷不一致）
\ctexset{section/format=\normalsize\bfseries\raggedright,section/aftertitle=\smallskip,section/beforeskip=14pt}
"""

ESCAPES = {
    '\\': r'\textbackslash{}', '&': r'\&', '%': r'\%', '$': r'\$', '#': r'\#',
    '_': r'\_', '{': r'\{', '}': r'\}', '~': r'\textasciitilde{}',
    '^': r'\textasciicircum{}',
}

# 公式正規化（\degree、全角括號、\sqrt[\text{ }]…）放在 mathnorm，題庫入庫也用同一套
from mathnorm import MATH_SPAN_RE, normalize_math, normalize_text  # noqa: E402


def escape_text(text: str) -> str:
    return ''.join(ESCAPES.get(ch, ch) for ch in text)


# 填空的底線：`\_\_\_\_` 連著寫，LaTeX 會在每個底線之間留空隙，看起來像斷掉的虛線。
# 換成一條實線（長度照原本的底線數）。Word 卷常常是「\_\_\_\_」這種帶反斜線的寫法。
BLANK_RE = re.compile(r'(?:\\_){2,}|[_＿]{2,}')
# 連續空白（姓名班別那一行靠它對齊）：LaTeX 會把多個空格併成一個，這裡還原成固定寬度
SPACE_RUN_RE = re.compile(r'[ \u3000]{2,}')


# 題目裡的答題空位 6.1em ≈ 2.6cm（12pt）；卷頭「姓名：____」那一行位置不夠，用短一點
BLANK_EM_QUESTION = 7.1
BLANK_EM_HEADER = 3.4


def _blank_rule(m, min_em: float = BLANK_EM_QUESTION) -> str:
    """底線長度：全角「＿」算 1em、半角「_」算 0.5em；題目再套一個下限。

    卷頭那一行（姓名／學號／日期）用原長就好（min_em=0），否則幾條 3cm 的線
    會把整行擠到換行。
    """
    body = m.group(0).replace('\\', '')
    natural = sum(1.0 if ch == '＿' else 0.5 for ch in body)
    return r'\rule[-0.6pt]{%.2fem}{0.6pt}' % max(natural, min_em, 1.0)


def _space_run(m, factor: float = 0.5) -> str:
    return r'\hspace{%.2fem}' % (len(m.group(0)) * factor)


def text_of(text: str, min_em: float = BLANK_EM_QUESTION,
            space_factor: float = 0.5) -> str:
    out, pos = [], 0
    for m in SPACE_RUN_RE.finditer(text):
        out.append(_inline(text[pos:m.start()], min_em))
        out.append(_space_run(m, space_factor))
        pos = m.end()
    out.append(_inline(text[pos:], min_em))
    return ''.join(out)


def _inline(text: str, min_em: float = BLANK_EM_QUESTION) -> str:
    out, pos = [], 0
    for m in BLANK_RE.finditer(text):
        out.append(escape_text(text[pos:m.start()]))
        out.append(_blank_rule(m, min_em))
        pos = m.end()
    out.append(escape_text(text[pos:]))
    return ''.join(out)


def _pieces(text: str) -> list[list[str]]:
    out, pos = [], 0
    for m in MATH_RE.finditer(text):
        if m.start() > pos:
            out.append(['text', text[pos:m.start()]])
        out.append(['math', m.group(1)])
        pos = m.end()
    if pos < len(text):
        out.append(['text', text[pos:]])
    return out


def _merge_degree(pieces: list[list[str]]) -> list[list[str]]:
    """「90」+「$\\degree$」這種拆開寫的，合成一條公式，數字才不會留在公式外面。"""
    merged: list[list[str]] = []
    for kind, value in pieces:
        if kind == 'math' and merged and merged[-1][0] == 'text':
            tail = re.search(r'([\d.]+)\s*$', merged[-1][1])
            if tail and re.match(r'\s*\^?\{?\\?(?:circ|degree)\b', value):
                merged[-1][1] = merged[-1][1][:tail.start()]
                value = tail.group(1) + value.lstrip()
                if not merged[-1][1]:
                    merged.pop()
        merged.append([kind, value])
    return merged


def tex_of(text: str, min_em: float = BLANK_EM_QUESTION,
           space_factor: float = 0.5) -> str:
    """文字與 $公式$ 混排：公式修正後原樣，其餘轉義。"""
    out = []
    for kind, value in _merge_degree(_pieces(text)):
        if kind == 'math':
            body = normalize_math(value).strip()
            out.append(f'${body}$' if body else '')
        else:
            out.append(text_of(value, min_em, space_factor))
    return ''.join(out)


# ── 選項排版 ──────────────────────────────────────────────────────────
def _units(text: str) -> float:
    """粗估寬度：全角字 2、半角字 1（公式用 LaTeX 長度折半估）。"""
    plain = MATH_RE.sub(lambda m: 'x' * max(1, len(m.group(1)) // 2), text)
    return sum(2 if ord(ch) > 0x2E80 else 1 for ch in plain)


# 一行 \linewidth 大約放得下多少「半角單位」（11pt、A4、1.27cm 邊界，留一點餘裕）
LINE_UNITS = 76


def fit_columns(options: list[str], per_line: int = 4) -> int:
    """一行放幾個：先試「全部塞一行」（5 個選項就 5 個一行），真的不夠寬才降成 2 個一行。

    5 個選項用「4 + 1」排會有一行只剩一個，看起來很怪；2、2、1 才是老師要的樣子。
    """
    widest = max((_units(o) for o in options), default=1)
    count = len(options)
    if count and widest * count <= LINE_UNITS:
        return count
    for n in (per_line, 3, 2):
        if widest <= LINE_UNITS / n:
            return n
    return 1


def option_lines(options: list[str], per_line: int = 4) -> list[str]:
    """把選項排成「打橫」的幾行 LaTeX：等寬欄位，一行 2～4 個。"""
    columns = fit_columns(options, per_line)
    width = 1 / columns
    lines = []
    for start in range(0, len(options), columns):
        cells = []
        for offset, opt in enumerate(options[start:start + columns]):
            # 選項字母 A–H 都要認得（5 個選項的卷很常見），否則會變成「E. E. 5」
            cleaned = re.sub(r'^\s*[(（]?[A-Ha-h]\s*[.、)．]\s*', '', opt)
            index = start + offset
            label = chr(65 + index) if index < 26 else str(index + 1)
            cells.append(r'\makebox[%.3f\linewidth][l]{%s. %s}'
                         % (width, label, tex_of(cleaned)))
        lines.append(''.join(cells))
    return lines


def to_tex_plan(plan: dict, preamble: str | None = None,
                options_per_line: int = 4) -> str:
    """用 paper_format.layout_plan() 的結果出 .tex。

    卷頭、分部標題、逐題配分、卷尾全部照 plan（也就是照 Word 檔那一份判斷），
    這樣「下載 Word」和「下載 .tex」排出來才會是同一份卷。
    """
    lines = [(preamble or DEFAULT_PREAMBLE).rstrip(), '', r'\begin{document}', '']
    head = [str(h) for h in (plan.get('head') or []) if str(h).strip()]
    if head:
        block = [r'{\Large\bfseries ' + tex_of(head[0]) + '}']
        block += [r'{\small\bfseries ' + tex_of(h, 0, 0.3) + '}' for h in head[1:]]
        lines += [r'\begin{center}', ' \\\\ '.join(block), r'\end{center}', '']

    for section in plan.get('sections') or []:
        heading = section.get('heading')
        if heading:
            lines += ['', r'\Needspace{3\baselineskip}',
                      r'\section*{' + tex_of(heading) + '}', '']
        questions = section.get('questions') or []
        if not questions:
            continue
        lines.append(r'\begin{enumerate}[leftmargin=*,itemsep=3pt,topsep=2pt,start=%d]'
                     % int(questions[0].get('number') or 1))
        pos = section.get('marksPos') or 'none'
        for q in questions:
            stem = tex_of(q.get('stem') or '')
            marks = '' if q.get('marks') is None else f'（{q["marks"]:g} 分）'
            if marks and pos == 'leading':
                body = r'\textbf{' + marks + '}　' + stem
            elif marks and pos == 'trailing':
                body = stem + r'\hfill ' + marks
            else:
                body = stem
            lines.append(r'\item ' + body)
            for extra in q.get('lines') or []:
                lines += ['', tex_of(extra)]
            if q.get('options'):
                lines.append(r'\par ' + '\\\\\n'.join(option_lines(q['options'], options_per_line)))
        lines.append(r'\end{enumerate}')

    for extra in plan.get('closing') or []:
        lines += ['', r'\begin{center}' + tex_of(extra) + r'\end{center}']

    lines += ['', r'\end{document}', '']
    return '\n'.join(lines)


def to_tex(title: str | None, sections, marks_position: str = 'none',
           preamble: str | None = None, options_per_line: int = 4,
           subtitle_lines: list[str] | None = None) -> str:
    lines = [(preamble or DEFAULT_PREAMBLE).rstrip(), '', r'\begin{document}', '']
    # 卷頭整塊置中：卷名、副標題、姓名班別行
    subs = [str(s) for s in (subtitle_lines or []) if str(s).strip()]
    if title or subs:
        block = []
        if title:
            block.append(r'{\Large\bfseries ' + tex_of(title) + '}')
        block += [r'{\small\bfseries ' + tex_of(s, 0, 0.3) + '}' for s in subs]
        lines += [r'\begin{center}', ' \\\\ '.join(block), r'\end{center}', '']

    number = 0
    for section in sections:
        if section.title:
            lines += ['', r'\Needspace{3\baselineskip}',
                      r'\section*{' + tex_of(section.title) + '}', '']
        lines.append(r'\begin{enumerate}[leftmargin=*,itemsep=3pt,topsep=2pt,start=%d]'
                     % (number + 1))
        for q in section.questions:
            number += 1
            stem = tex_of(q.stem)
            marks = '' if q.marks is None else f'（{q.marks:g} 分）'
            if marks and marks_position == 'leading':
                body = r'\textbf{' + marks + '}　' + stem
            elif marks:
                body = stem + r'\hfill ' + marks
            else:
                body = stem
            lines.append(r'\item ' + body)
            for extra in q.lines:
                lines.append('')
                lines.append(tex_of(extra))
            if q.options:
                # 選擇題的選項打橫放，一行 2～4 個（太長會自動降）；\par 讓它另起一行
                lines.append(r'\par ' + '\\\\\n'.join(option_lines(q.options, options_per_line)))
        lines.append(r'\end{enumerate}')

    lines += ['', r'\end{document}', '']
    return '\n'.join(lines)


def to_tex_bytes(title, sections, marks_position='none', preamble=None,
                 options_per_line: int = 4, subtitle_lines=None) -> bytes:
    return to_tex(title, sections, marks_position, preamble,
                  options_per_line, subtitle_lines).encode('utf-8')
