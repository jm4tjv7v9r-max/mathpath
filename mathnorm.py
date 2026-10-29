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
