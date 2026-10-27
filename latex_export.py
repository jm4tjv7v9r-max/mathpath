"""把卷的內容輸出成 LaTeX（給 Overleaf 用）。

設計原則：
- 中文用 ctexart + XeLaTeX（Overleaf 開新專案就能編）
- 題號連續、分部用 \\section*、選項用 enumitem 的 A/B/C/D
- 公式本來就是 LaTeX，原樣輸出，不再轉來轉去
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
"""

ESCAPES = {
    '\\': r'\textbackslash{}', '&': r'\&', '%': r'\%', '$': r'\$', '#': r'\#',
    '_': r'\_', '{': r'\{', '}': r'\}', '~': r'\textasciitilde{}',
    '^': r'\textasciicircum{}',
}


def escape_text(text: str) -> str:
    return ''.join(ESCAPES.get(ch, ch) for ch in text)


def tex_of(text: str) -> str:
    """文字與 $公式$ 混排：公式原樣，其餘轉義。"""
    out, pos = [], 0
    for m in MATH_RE.finditer(text):
        out.append(escape_text(text[pos:m.start()]))
        out.append('$' + m.group(1) + '$')
        pos = m.end()
    out.append(escape_text(text[pos:]))
    return ''.join(out)


def to_tex(title: str | None, sections, marks_position: str = 'none',
           preamble: str | None = None) -> str:
    lines = [(preamble or DEFAULT_PREAMBLE).rstrip(), '', r'\begin{document}', '']
    if title:
        lines += [r'\begin{center}', r'{\Large\bfseries ' + tex_of(title) + '}', r'\end{center}', '']

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
                lines.append(r'\begin{enumerate}[label=\Alph*.,itemsep=2pt,topsep=2pt,'
                             r'leftmargin=1.6em]')
                for opt in q.options:
                    # 選項若已帶「A.」就拆掉，交給 LaTeX 編號
                    cleaned = re.sub(r'^\s*[(（]?[A-Da-d]\s*[.、)．]\s*', '', opt)
                    lines.append(r'\item ' + tex_of(cleaned))
                lines.append(r'\end{enumerate}')
        lines.append(r'\end{enumerate}')

    lines += ['', r'\end{document}', '']
    return '\n'.join(lines)


def to_tex_bytes(title, sections, marks_position='none', preamble=None) -> bytes:
    return to_tex(title, sections, marks_position, preamble).encode('utf-8')
