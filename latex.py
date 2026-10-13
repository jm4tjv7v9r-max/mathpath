"""把題庫題目輸出成可用 XeLaTeX 編譯的 LaTeX 原始碼。

設計原則：
- 題目文字是「中文＋$數學式$」混排，只轉義數學式以外的特殊字元，$...$ 內原樣保留，
  因為題庫的數學語法本來就是 LaTeX（KaTeX 相容），不必也不應改寫。
- 圖形以 \\includegraphics 引用同一個 zip 內的 figures/ 圖片（點陣圖，XeLaTeX 可編譯）。
- 產出的檔案以 ctexart 為預設（自動偵測 macOS / Windows / Linux 中文字體），
  若環境沒有 ctex，檔案開頭的註解也提供了 article + xeCJK 的替代寫法。
"""
import re

# 只處理「數學式以外」的文字；數學式內的 \ { } ^ _ 等是語法，不可轉義。
ESCAPES = {'\\': r'\textbackslash{}', '{': r'\{', '}': r'\}', '$': r'\$', '&': r'\&',
           '#': r'\#', '%': r'\%', '_': r'\_', '~': r'\textasciitilde{}',
           '^': r'\textasciicircum{}'}
MATH = re.compile(r'\$\$(.+?)\$\$|\$(.+?)\$', re.S)

PREAMBLE = r"""% !TEX program = xelatex
% 由 MathPath 題庫匯出；請用 XeLaTeX 編譯（xelatex questions.tex）。
% 若系統沒有 ctex 套件，可把下一行改成：
%   \documentclass[11pt,a4paper]{article}
%   \usepackage{xeCJK}\setCJKmainfont{PingFang TC}   % Windows: Microsoft JhengHei
\documentclass[11pt,a4paper,UTF8]{ctexart}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{geometry}
\usepackage{enumitem}
\usepackage{xcolor}
\geometry{margin=2.2cm}
\setlist{nosep}
\newenvironment{mpfigure}{\begin{center}}{\end{center}}
\newcommand{\mppoints}[1]{\hfill\textbf{(#1 分)}}
\title{__TITLE__}
\date{__DATE__}
\begin{document}
\maketitle
"""


def escape_segment(value):
    """轉義數學式以外的文字。"""
    return ''.join(ESCAPES.get(ch, ch) for ch in value or '')


def latex_text(value):
    """中文與數學混排 → LaTeX：$...$／$$...$$ 內原樣保留，其餘轉義。"""
    text = value if isinstance(value, str) else ('' if value is None else str(value))
    out, pos = [], 0
    for match in MATH.finditer(text):
        out.append(escape_segment(text[pos:match.start()]))
        out.append(match.group(0))
        pos = match.end()
    out.append(escape_segment(text[pos:]))
    return ''.join(out)


def _list(items, env='enumerate', label=None, raw=False):
    rows = [row for row in (items or []) if str(row).strip()]
    if not rows:
        return ''
    option = f'[label={label},leftmargin=*]' if label else '[leftmargin=*]'
    body = '\n'.join('  \\item ' + (row if raw else latex_text(row)) for row in rows)
    return f'\\begin{{{env}}}{option}\n{body}\n\\end{{{env}}}\n'


def question_block(question, index, figure_path=None):
    """單題的題目卷內容（不含答案）。"""
    meta = [question.get('grade') or '', question.get('topic') or '',
            question.get('subtopic') or '', question.get('qtype') or '解答題',
            f"難度 {question.get('level') or 1}", f"{question.get('points') or 0} 分"]
    heading = ' · '.join(part for part in meta if part)
    lines = [f'\\section*{{第 {index} 題\\quad\\small\\mdseries {escape_segment(heading)}}}',
             f'\\textbf{{{latex_text(question.get("title") or "")}}}', '',
             latex_text(question.get('content') or '')]
    if figure_path:
        lines += ['', '\\begin{mpfigure}',
                  f'\\includegraphics[width=0.5\\linewidth,keepaspectratio]{{{figure_path}}}',
                  '\\end{mpfigure}']
    options = [opt for opt in (question.get('options') or []) if str(opt).strip()]
    if options:
        lines += ['', _list(options, label='(\\Alph*)').rstrip()]
    hint = question.get('hint')
    if hint:
        lines += ['', f'\\emph{{提示：}}{latex_text(hint)}']
    tags = [tag for tag in (question.get('tags') or []) if str(tag).strip()]
    note = ' · '.join([question.get('source') or ''] + tags).strip(' ·')
    if note:
        lines += ['', f'{{\\footnotesize\\color{{gray}}{escape_segment(note)}}}']
    return '\n'.join(lines) + '\n'


def answer_block(question, index):
    """單題的答案、詳解、詳細解釋與評分標準（教師版）。"""
    lines = [f'\\subsection*{{第 {index} 題}}']
    answer = question.get('answer')
    lines.append(f'\\textbf{{參考答案：}}{latex_text(answer) if answer else "（未填）"}')
    steps = [step for step in (question.get('steps') or []) if str(step).strip()]
    if steps:
        lines += ['', '\\textbf{解法步驟：}', _list(steps, label='步驟 \\arabic*.', env='enumerate').rstrip()]
    analysis = question.get('analysis')
    if analysis:
        lines += ['', f'\\textbf{{詳細解釋：}}{latex_text(analysis)}']
    rubric = [row for row in (question.get('rubric') or []) if isinstance(row, dict)]
    if rubric:
        rows = []
        for row in rubric:
            label = latex_text(row.get('label') or '')
            percent = row.get('percent')
            suffix = f'（{percent:g}\\%）' if isinstance(percent, (int, float)) else ''
            rows.append(f'{label}{suffix}')
        lines += ['', '\\textbf{評分標準：}', _list(rows, env='itemize', raw=True).rstrip()]
    return '\n'.join(lines) + '\n'


def document(questions, title='MathPath 題庫匯出', date=None, include_answers=True,
             figures=None):
    """組出完整 .tex。

    figures：{question_id: 'figures/q12.png'}，只有真的帶到圖片的題目才會有項目。
    """
    figures = figures or {}
    parts = [PREAMBLE.replace('__TITLE__', latex_text(title)).replace('__DATE__', escape_segment(date or ''))]
    parts.append('\\section*{題目}\n')
    for index, question in enumerate(questions, 1):
        parts.append(question_block(question, index, figures.get(question.get('id'))))
    if include_answers:
        parts.append('\\clearpage\n\\section*{參考答案與詳解}\n')
        for index, question in enumerate(questions, 1):
            parts.append(answer_block(question, index))
    parts.append('\\end{document}\n')
    return '\n'.join(parts)
