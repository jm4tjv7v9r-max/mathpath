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
\documentclass[11pt,a4paper]{ctexart}
\usepackage[margin=1.27cm]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{enumitem}
\setlength{\parindent}{0pt}
\pagestyle{plain}
% 大題標題靠左（ctex 預設置中，跟原卷不一致）
\ctexset{section/format=\Large\bfseries\raggedright}
"""

ESCAPES = {
    '\\': r'\textbackslash{}', '&': r'\&', '%': r'\%', '$': r'\$', '#': r'\#',
    '_': r'\_', '{': r'\{', '}': r'\}', '~': r'\textasciitilde{}',
    '^': r'\textasciicircum{}',
}

# 數學模式裡的全角標點：LaTeX 不認，`\left（` 更會直接炸 Missing delimiter
FULLWIDTH_IN_MATH = {
    '（': '(', '）': ')', '［': '[', '］': ']', '｛': r'\{', '｝': r'\}',
    '，': ',', '、': ',', '；': ';', '：': ':', '　': ' ', '％': r'\%',
}

FUNCTIONS = ('arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
             'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'ln', 'lg',
             'lim', 'max', 'min', 'det', 'gcd')
FUNC_RE = re.compile(r'(?<![\\\w])(' + '|'.join(FUNCTIONS) + r')(?![a-zA-Z])')

DEGREE_RE = re.compile(r'\\degree\b')
EMPTY_ROOT_RE = re.compile(r'\\sqrt\[(?:\s|\\text\{ *\}|\\mathrm\{ *\})*\]\{')
TEXT_RE = re.compile(r'\\text\{([^{}]*)\}')
PURE_MATH_TEXT_RE = re.compile(r'^[\s0-9A-Za-z+\-*/=<>^_{}().,\[\]|]+$')


def _fix_text_groups(tex: str) -> str:
    """`\text{4x+3y-3=0 }` 是 PDF 裡沒被當成公式的文字，拆掉 \\text 才排得像公式；
    `\text{或}` 這種中文要留著。"""
    def repl(m):
        inner = m.group(1)
        if PURE_MATH_TEXT_RE.match(inner) and re.search(r'[0-9=]', inner):
            return inner.strip()
        return m.group(0)
    return TEXT_RE.sub(repl, tex)


def normalize_math(tex: str) -> str:
    """把一段（$ 之間的）公式修成能編譯、排版正確的 LaTeX。"""
    # \sqrt[\text{ }]{3}：空根指數，先處理（它裡面就是 \text{ }）
    tex = EMPTY_ROOT_RE.sub(r'\\sqrt{', tex)

    # 保護 \text{...}：裡面的中文與文字不該被下面的規則改到
    groups: list[str] = []

    def stash(m):
        groups.append(m.group(0))
        return f'\x00{len(groups) - 1}\x00'

    protected = TEXT_RE.sub(stash, tex)
    protected = ''.join(FULLWIDTH_IN_MATH.get(ch, ch) for ch in protected)
    protected = DEGREE_RE.sub(r'^{\\circ}', protected)
    protected = FUNC_RE.sub(lambda m: '\\' + m.group(1), protected)
    return re.sub(r'\x00(\d+)\x00', lambda m: _fix_text_groups(groups[int(m.group(1))]), protected)


def escape_text(text: str) -> str:
    return ''.join(ESCAPES.get(ch, ch) for ch in text)


# 填空的底線：`\_\_\_\_` 連著寫，LaTeX 會在每個底線之間留空隙，看起來像斷掉的虛線。
# 換成一條實線（長度照原本的底線數）。
BLANK_RE = re.compile(r'[_＿]{3,}')
# 連續空白（姓名班別那一行靠它對齊）：LaTeX 會把多個空格併成一個，這裡還原成固定寬度
SPACE_RUN_RE = re.compile(r'[ \u3000]{2,}')


def _blank_rule(m) -> str:
    return r'\rule[-0.6pt]{%.2fem}{0.6pt}' % (len(m.group(0)) * 0.5)


def _space_run(m) -> str:
    return r'\hspace{%.2fem}' % (len(m.group(0)) * 0.5)


def text_of(text: str) -> str:
    out, pos = [], 0
    for m in SPACE_RUN_RE.finditer(text):
        out.append(_inline(text[pos:m.start()]))
        out.append(_space_run(m))
        pos = m.end()
    out.append(_inline(text[pos:]))
    return ''.join(out)


def _inline(text: str) -> str:
    out, pos = [], 0
    for m in BLANK_RE.finditer(text):
        out.append(escape_text(text[pos:m.start()]))
        out.append(_blank_rule(m))
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


def tex_of(text: str) -> str:
    """文字與 $公式$ 混排：公式修正後原樣，其餘轉義。"""
    out = []
    for kind, value in _merge_degree(_pieces(text)):
        if kind == 'math':
            body = normalize_math(value).strip()
            out.append(f'${body}$' if body else '')
        else:
            out.append(text_of(value))
    return ''.join(out)


# ── 選項排版 ──────────────────────────────────────────────────────────
def _units(text: str) -> float:
    """粗估寬度：全角字 2、半角字 1（公式用 LaTeX 長度折半估）。"""
    plain = MATH_RE.sub(lambda m: 'x' * max(1, len(m.group(1)) // 2), text)
    return sum(2 if ord(ch) > 0x2E80 else 1 for ch in plain)


# 一行 \linewidth 大約放得下多少「半角單位」（11pt、A4、1.27cm 邊界，留一點餘裕）
LINE_UNITS = 76


def fit_columns(options: list[str], per_line: int = 4) -> int:
    """一行放幾個：目標 4 個，選項太長就降成 3、2、1。"""
    widest = max((_units(o) for o in options), default=1)
    for n in range(max(1, min(4, per_line)), 0, -1):
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
            cleaned = re.sub(r'^\s*[(（]?[A-Da-d]\s*[.、)．]\s*', '', opt)
            label = 'ABCDEFGH'[(start + offset) % 8]
            cells.append(r'\makebox[%.3f\linewidth][l]{%s. %s}'
                         % (width, label, tex_of(cleaned)))
        lines.append(''.join(cells))
    return lines


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
        block += [r'{\small ' + tex_of(s) + '}' for s in subs]
        lines += [r'\begin{center}', ' \\\\ '.join(block), r'\end{center}', '']

    number = 0
    for section in sections:
        if section.title:
            lines += ['', r'\section*{' + tex_of(section.title) + '}', '']
        lines.append(r'\begin{enumerate}[leftmargin=*,itemsep=4pt,topsep=2pt,start=%d]'
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
