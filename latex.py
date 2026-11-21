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

# 中文文本裡的裸希臘字母／數學符號：ctex 的中文字體（PingFang TC 等）沒有這些字形，
# 直接印成空白。包進數學模式交給 LaTeX 字體（λ → $\lambda$）。
GREEK = {
    '\u0391': r'\Alpha', '\u0392': r'\Beta', '\u0393': r'\Gamma', '\u0394': r'\Delta',
    '\u0395': r'\Epsilon', '\u0396': r'\Zeta', '\u0397': r'\Eta', '\u0398': r'\Theta',
    '\u0399': r'\Iota', '\u039a': r'\Kappa', '\u039b': r'\Lambda', '\u039c': r'\Mu',
    '\u039d': r'\Nu', '\u039e': r'\Xi', '\u039f': r'\Omicron', '\u03a0': r'\Pi',
    '\u03a1': r'\Rho', '\u03a3': r'\Sigma', '\u03a4': r'\Tau', '\u03a5': r'\Upsilon',
    '\u03a6': r'\Phi', '\u03a7': r'\Chi', '\u03a8': r'\Psi', '\u03a9': r'\Omega',
    '\u03b1': r'\alpha', '\u03b2': r'\beta', '\u03b3': r'\gamma', '\u03b4': r'\delta',
    '\u03b5': r'\epsilon', '\u03b6': r'\zeta', '\u03b7': r'\eta', '\u03b8': r'\theta',
    '\u03b9': r'\iota', '\u03ba': r'\kappa', '\u03bb': r'\lambda', '\u03bc': r'\mu',
    '\u03bd': r'\nu', '\u03be': r'\xi', '\u03bf': r'\omicron', '\u03c0': r'\pi',
    '\u03c1': r'\rho', '\u03c2': r'\varsigma', '\u03c3': r'\sigma',
    '\u03c4': r'\tau', '\u03c5': r'\upsilon', '\u03c6': r'\varphi',
    '\u03c7': r'\chi', '\u03c8': r'\psi', '\u03c9': r'\omega',
    '\u2202': r'\partial', '\u2206': r'\nabla', '\u221a': r'\surd',
    '\u2211': r'\sum', '\u220f': r'\prod', '\u222b': r'\int',
    '\u221e': r'\infty', '\u2205': r'\emptyset', '\u2229': r'\cap',
    '\u222a': r'\cup', '\u2208': r'\in', '\u2282': r'\subset', '\u2286': r'\subseteq',
    '\u2288': r'\notin', '\u2203': r'\exists', '\u2200': r'\forall',
    '\u2204': r'\neg', '\u21d2': r'\Rightarrow', '\u21d4': r'\Leftrightarrow',
    '\u21d0': r'\Leftarrow', '\u2192': r'\rightarrow', '\u2190': r'\leftarrow',
    '\u2261': r'\equiv', '\u2260': r'\neq', '\u2264': r'\leq', '\u2265': r'\geq',
    '\u2248': r'\approx', '\u22c5': r'\cdot', '\u2217': r'\ast',
    '\u00b1': r'\pm', '\u00d7': r'\times', '\u2020': r'\dagger',
    '\u2021': r'\ddagger', '\u2218': r'\circ', '\u25b3': r'\triangle',
}

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
    """轉義數學式以外的文字；裸希臘字母／數學符號包進數學模式。"""
    out, i = [], 0
    text = value or ''
    n = len(text)
    while i < n:
        ch = text[i]
        cmd = GREEK.get(ch)
        if cmd:
            out.append('$' + cmd + '$')
            i += 1
            continue
        out.append(ESCAPES.get(ch, ch))
        i += 1
    return ''.join(out)


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
