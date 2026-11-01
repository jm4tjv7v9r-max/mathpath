r"""公式正規化：把 AI／Word 轉出來的 LaTeX 修成「能編譯、能渲染」的樣子。

同一份規則同時給兩個地方用：
- `latex_export`：匯出 .tex（LaTeX 端）
- 題庫入庫（`server.paper_bank_payload`）：KaTeX 端

兩邊的脾氣不一樣，但「\left（ 全角括號」「\degree 未定義」這類問題兩邊都會炸，
所以在這裡統一修。規則刻意保守——只動確定會壞的寫法，不改數學語意。
"""
from __future__ import annotations

import re

MATH_SPAN_RE = re.compile(r'\$([^$]+)\$')

# 數學模式裡的全角標點：LaTeX 不認，`\left（` 會炸 Missing delimiter；
# KaTeX 更直接報 `Invalid delimiter '（' after '\left'`。
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


def normalize_text(text: str) -> str:
    """一段「文字 + $公式$」混排：只正規化公式，文字原樣。"""
    if not isinstance(text, str) or '$' not in text:
        return text if isinstance(text, str) else ''
    return MATH_SPAN_RE.sub(lambda m: '$' + normalize_math(m.group(1)) + '$', text)


# ── 填空底線 ──────────────────────────────────────────────────────────
# 題目裡的「空白」有好多種寫法：`\underline{\hspace{2cm}}`、`\hspace{2cm}`、
# `\rule{2cm}{0.4pt}`、`\phantom{2cm}`、`\blank`，還有直接打一排底線。
#
# 轉成 Word 方程式時，這些指令 Word 一個都不認，最後會在卷面上留下
# 「underline_hspace2cm」這種字（老師看到的亂碼）。所以先換成一個帶寬度的
# 記號，由 paper_format 畫成一條真正的底線。
BLANK_OPEN = '\ue000'
BLANK_CLOSE = '\ue001'
BLANK_MARK_RE = re.compile(BLANK_OPEN + r'(\d*)' + BLANK_CLOSE)

_UNIT_CM = {'cm': 1.0, 'mm': 0.1, 'in': 2.54, 'pt': 2.54 / 72, 'bp': 2.54 / 72,
            'em': 0.42, 'ex': 0.21}

BLANK_PATTERNS = [
    # \underline{\hspace{2cm}} / \underline{\hspace*{2cm}}
    (re.compile(r'\\underline\s*\{\s*\\hspace\*?\s*\{([^{}]*)\}\s*\}'), 'cm'),
    (re.compile(r'\\underline\s*\{\s*\\phantom\s*\{([^{}]*)\}\s*\}'), 'cm'),
    # \underline{\quad} / \underline{\ \ } / \underline{~~~~}
    (re.compile(r'\\underline\s*\{\s*(?:\\quad|\\qquad|\\;|\\:|\\,|\\!|\\ |~|\s)+\s*\}'), 'fixed'),
    # \underline{文字}：Word 那邊不支援底線格式，至少把文字留下，不要變成亂碼
    (re.compile(r'\\underline\s*\{([^{}]*)\}'), 'unwrap'),
    (re.compile(r'\\hspace\*?\s*\{([^{}]*)\}'), 'cm'),
    # \rule{2cm}{0.4pt} / \rule[2pt]{2cm}{0.4pt}
    (re.compile(r'\\rule\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}\s*\{[^{}]*\}'), 'cm'),
    (re.compile(r'\\phantom\s*\{([^{}]*)\}'), 'cm'),
    (re.compile(r'\\(?:blank|fillin|answerblank|underlineblank|blankline)\b\s*(?:\{([^{}]*)\})?'), 'cm'),
    (re.compile(r'(?:\\_){3,}'), 'fixed'),
    (re.compile(r'[_＿]{3,}'), 'fixed'),
]


def blank_cm(spec: str) -> float:
    """把 `2cm`、`20mm`、`1in`、`12pt` 換算成公分；看不懂就當 2 公分。"""
    m = re.search(r'([\d.]+)\s*(cm|mm|in|pt|bp|em|ex)?', spec or '')
    if not m:
        return 2.0
    try:
        value = float(m.group(1))
    except ValueError:
        return 2.0
    cm = value * _UNIT_CM.get((m.group(2) or 'cm').lower(), 1.0)
    return max(0.4, min(10.0, cm))


def _blank_repl(kind: str):
    def repl(m):
        if kind == 'unwrap':
            return m.group(1) or ''
        spec = m.group(1) if m.groups() else ''
        # 一排底線（`\_\_\_`）沒有寫長度：用 2.6cm，跟一般試卷的答題空位差不多
        cm = blank_cm(spec) if kind == 'cm' else 2.6
        return f'{BLANK_OPEN}{int(round(cm * 10)):02d}{BLANK_CLOSE}'
    return repl


def normalize_blanks(text: str) -> str:
    """把所有「空白」寫法換成帶寬度的記號（給 Word 排版用）。"""
    if not isinstance(text, str) or not text:
        return text if isinstance(text, str) else ''
    out = text
    for pattern, kind in BLANK_PATTERNS:
        out = pattern.sub(_blank_repl(kind), out)
    if BLANK_OPEN not in out:
        return out
    # 只包住空白記號的 $...$：拆掉錢號，別讓它進公式轉換器
    return MATH_SPAN_RE.sub(lambda m: m.group(1) if BLANK_OPEN in m.group(1) else m.group(0), out)
