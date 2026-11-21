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

import base64
import io
import re
import zipfile

MATH_RE = re.compile(r'\$([^$]+)\$')

DEFAULT_PREAMBLE = r"""% !TEX program = xelatex
\documentclass[12pt,a4paper]{ctexart}
\usepackage[margin=1.27cm]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{enumitem}
\usepackage{needspace}
% 有題目圖形時：\includegraphics{figures/q1.png}；圖檔跟 .tex 一起打包上傳 Overleaf
\usepackage{graphicx}
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
    """文字轉義；`\\$`、`\\%` 這種「已經寫好的轉義」原樣保留。

    卷面很常出現「每本 $\\$ 12」這種金額寫法：這裡若把反斜線也轉義，
    整行就會變成「\\textbackslash{}\\$ 12」，XeLaTeX 直接報 Missing $。
    """
    out, i = [], 0
    while i < len(text):
        ch = text[i]
        if ch == '\\' and i + 1 < len(text) and text[i + 1] in '&%$#_{}':
            out.append(text[i:i + 2])
            i += 2
            continue
        out.append(ESCAPES.get(ch, ch))
        i += 1
    return ''.join(out)


def _math_spans(text: str) -> list[tuple[int, int, str]]:
    """找出真正的 $...$（被反斜線跳過的 \\$ 不算），回（起點、終點、內容）。

    用 regex 抓會把「$\\$ 12」的半個金額符號當成公式開頭，整行就編不過。
    """
    spans, i, n = [], 0, len(text)
    while i < n:
        if text[i] == '$' and (i == 0 or text[i - 1] != '\\'):
            j = i + 1
            while j < n and not (text[j] == '$' and text[j - 1] != '\\'):
                j += 1
            if j < n:
                spans.append((i, j, text[i + 1:j]))
                i = j + 1
                continue
        i += 1
    return spans


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
    for start, end, body in _math_spans(text):
        if start > pos:
            out.append(['text', text[pos:start]])
        out.append(['math', body])
        pos = end + 1          # end 是收尾的 $，要跳過它
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


def _brace_delta(body: str) -> int:
    """公式裡沒轉義的大括號差額（`\\{`、`\\}` 不算）。"""
    delta, i = 0, 0
    while i < len(body):
        ch = body[i]
        if ch == '\\':
            i += 2
            continue
        if ch == '{':
            delta += 1
        elif ch == '}':
            delta -= 1
        i += 1
    return delta


def _safe_math(body: str) -> str | None:
    """把 AI 寫壞的公式收成編得過的版本；收不了就回 None（呼叫端改印原文）。

    只修「一定會讓 XeLaTeX 報錯」的寫法：
    - 公式裡的 % # &（會變成註解／巨集參數／對齊字符）
    - \\left( 沒有對應的 \\right
    - 大括號數量不對
    """
    body = body.strip()
    if not body:
        return ''
    body = re.sub(r'(?<!\\)([%#&])', r'\\\1', body)
    lefts = len(re.findall(r'\\left(?![a-zA-Z])', body))
    rights = len(re.findall(r'\\right(?![a-zA-Z])', body))
    if lefts > rights:
        body += r' \right.' * (lefts - rights)
    delta = _brace_delta(body)
    if delta > 0:
        body += '}' * delta
    elif delta < 0:
        return None       # 多出來的 } 不知道該刪哪一個，退回原文比較安全
    return body


def tex_of(text: str, min_em: float = BLANK_EM_QUESTION,
           space_factor: float = 0.5) -> str:
    """文字與 $公式$ 混排：公式修正後原樣，其餘轉義。"""
    out = []
    for kind, value in _merge_degree(_pieces(text)):
        if kind == 'math':
            body = _safe_math(normalize_math(value))
            if body is None:
                # 修不好的公式當普通文字印（含 $），至少整份卷編得出來
                out.append(text_of('$' + value + '$', min_em, space_factor))
            else:
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
OPTION_GAP = 1.06   # 選項之間留一點空隙，不然兩個選項會黏在一起


def fit_columns(options: list[str], per_line: int = 4) -> int:
    """一行放幾個：能全部打橫就全部，不夠寬才把最後的選項放到下一行。

    跟 Word 那一份用同一條規則：4 個長選項排成「3＋1」，不是「2＋2」；
    5 個塞得下就是 5 個一行，塞不下就由前往後填滿（4＋1、3＋2）。
    """
    count = len(options)
    if count <= 1:
        return 1
    widest = max((_units(o) for o in options), default=1)
    if widest <= 0:
        return count
    fits = int(LINE_UNITS / (widest * OPTION_GAP))
    return max(1, min(count, fits))


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


def _pt(value, fallback=None):
    """把 plan 帶過來的字級收斂成合理 pt（8–36）；不合理就當沒有。"""
    try:
        size = float(value)
    except (TypeError, ValueError):
        return fallback
    return size if 8 <= size <= 36 else fallback


def _styled(text: str, size, bold=True) -> str:
    """照範本的字級／粗細包一層（LaTeX 才不會自己用 \\Large、\\small 猜）。"""
    size = _pt(size)
    if not size:
        return r'{\bfseries ' + text + '}' if bold else text
    return r'{\fontsize{%g}{%g}\selectfont%s %s}' % (
        size, round(size * 1.2, 1), r'\bfseries' if bold else '', text)


def preamble_from_plan(plan: dict) -> str:
    """用範本的紙張、邊界、字級組 preamble：.tex 跟 Word 排出來才是同一份卷。

    plan 沒有版面資料（舊存檔）時退回原本的 A4 + 1.27cm。
    """
    page = plan.get('page') or {}
    body = _pt(plan.get('bodySize'), 12) or 12
    base = int(round(body))
    if base not in (10, 11, 12):
        base = 12
    if page.get('w') and page.get('h'):
        geometry = ('[paperwidth=%.2fcm,paperheight=%.2fcm,left=%.2fcm,right=%.2fcm,'
                    'top=%.2fcm,bottom=%.2fcm]'
                    % (page['w'], page['h'], page.get('left') or 0, page.get('right') or 0,
                       page.get('top') or 0, page.get('bottom') or 0))
    else:
        geometry = '[margin=1.27cm]'
    heading_size = None
    for section in plan.get('sections') or []:
        heading_size = _pt(section.get('headingSize'))
        if heading_size:
            break
    if heading_size:
        fmt = r'\fontsize{%g}{%g}\selectfont\bfseries\raggedright' % (
            heading_size, round(heading_size * 1.2, 1))
    else:
        fmt = r'\normalsize\bfseries\raggedright'
    return (
        '% !TEX program = xelatex\n'
        '\\documentclass[' + str(base) + 'pt]{ctexart}\n'
        '\\usepackage' + geometry + '{geometry}\n'
        '\\usepackage{amsmath,amssymb}\n'
        '\\usepackage{enumitem}\n'
        '\\usepackage{needspace}\n'
        '% 有題目圖形時：\\includegraphics{figures/q1.png}；圖檔跟 .tex 一起打包上傳 Overleaf\n'
        '\\usepackage{graphicx}\n'
        '\\setlength{\\parindent}{0pt}\n'
        '\\pagestyle{plain}\n'
        '% 大題標題的字級、粗細、靠左都照範本（ctex 預設置中）\n'
        '\\ctexset{section/format={' + fmt + '},section/aftertitle=\\smallskip,'
        'section/beforeskip=14pt}\n')


def to_tex_plan(plan: dict, preamble: str | None = None,
                options_per_line: int = 4,
                figs_out: list | None = None) -> str:
    """用 paper_format.layout_plan() 的結果出 .tex。

    卷頭、分部標題、逐題配分、卷尾全部照 plan（也就是照 Word 檔那一份判斷），
    紙張、邊界、字級也照範本，這樣「下載 Word」和「下載 .tex」才是同一份卷。
    """
    lines = [(preamble or preamble_from_plan(plan)).rstrip(), '', r'\begin{document}', '']
    centered: list[str] = []
    head_lines: list[str] = []

    def flush_center():
        if centered:
            head_lines.extend([r'\begin{center}', ' \\\\ '.join(centered), r'\end{center}'])
            centered.clear()

    for item in plan.get('head') or []:
        text = (item.get('text') if isinstance(item, dict) else str(item)) or ''
        if text.strip():
            size = item.get('size') if isinstance(item, dict) else None
            bold = item.get('bold') if isinstance(item, dict) else True
            align = (item.get('align') if isinstance(item, dict) else None) or 'center'
            piece = _styled(tex_of(text, 0, 0.3), size, bold)
            if align == 'left':
                # 「姓名：＿ 學號：＿」那一行在 Word 是靠左的，不要跟著卷名置中
                flush_center()
                head_lines.append(r'\noindent ' + piece + r'\par')
            else:
                centered.append(piece)
        if isinstance(item, dict) and item.get('rule'):
            flush_center()
            head_lines.append(r'\noindent\rule{\linewidth}{0.4pt}\par')
    flush_center()
    if head_lines:
        lines += head_lines + ['']

    for section in plan.get('sections') or []:
        heading = section.get('heading')
        if heading:
            lines += ['', r'\Needspace{3\baselineskip}',
                      r'\section*{' + tex_of(heading) + '}', '']
        questions = section.get('questions') or []
        if not questions:
            continue
        lines.append(r'\begin{enumerate}[leftmargin=*,itemsep=3pt,topsep=2pt,labelsep=0.35em,start=%d]'
                     % int(questions[0].get('number') or 1))
        pos = section.get('marksPos') or 'none'
        for q in questions:
            stem = tex_of(q.get('stem') or '')
            marks = '' if q.get('marks') is None else f'（{q["marks"]:g} 分）'
            if marks and pos == 'leading':
                # 配分後面只留一個普通空格：全角空白在 LaTeX 會拉出一大段縫，
                # 看起來像「12.（11 分）　　　已知…」
                body = marks + ' ' + stem
            elif marks and pos == 'trailing':
                body = stem + r'\hfill ' + marks
            else:
                body = stem
            lines.append(r'\item ' + body)
            if figs_out is not None:
                lines.append(collect_figures(q.get('figures'), figs_out))
            for extra in q.get('lines') or []:
                lines += ['', tex_of(extra)]
            if q.get('options'):
                lines.append(r'\par ' + '\\\\\n'.join(option_lines(q['options'], options_per_line)))
            elif q.get('answerLines'):
                # 解答題的作答空間：Word 會複製 answer_line 段落，這裡留一樣的高度
                # （範本那一行有底線的就畫線），兩份卷看起來才一致。
                space = r'\par\vspace{2.2\baselineskip}'
                if plan.get('answerRule'):
                    space += r'\noindent\rule{\linewidth}{0.4pt}'
                lines.append(space * int(q['answerLines']))
        lines.append(r'\end{enumerate}')

    for extra in plan.get('closing') or []:
        lines += ['', r'\begin{center}' + tex_of(extra) + r'\end{center}']

    lines += ['', r'\end{document}', '']
    return '\n'.join(lines)


def to_tex(title: str | None, sections, marks_position: str = 'none',
           preamble: str | None = None, options_per_line: int = 4,
           subtitle_lines: list[str] | None = None,
           figs_out: list | None = None) -> str:
    """出整份卷的 .tex；有題目圖就插進來，圖檔清單寫進 figs_out（供 zip 打包）。"""
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
        lines.append(r'\begin{enumerate}[leftmargin=*,itemsep=3pt,topsep=2pt,labelsep=0.35em,start=%d]'
                     % (number + 1))
        for q in section.questions:
            number += 1
            stem = tex_of(q.stem)
            marks = '' if q.marks is None else f'（{q.marks:g} 分）'
            if marks and marks_position == 'leading':
                body = marks + ' ' + stem
            elif marks:
                body = stem + r'\hfill ' + marks
            else:
                body = stem
            lines.append(r'\item ' + body)
            if figs_out is not None:
                lines.append(collect_figures(getattr(q, 'figures', None), figs_out))
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


# ── 題目圖形 ──────────────────────────────────────────────────────────
# 圖檔放 figures/ 目錄，.tex 用相對路徑 \includegraphics 引用。
# 有圖時伺服器把 .tex + figures/ 一起打包成 zip（Overleaf 上傳整包就能編譯）；
# 沒圖時只回 .tex，行為跟以前一樣。
FIGURE_DIR = 'figures'


def figure_bytes_of(fig) -> bytes | None:
    """一張題目圖 → 原始 bytes（blob 或 data URL 都吃）。"""
    if not isinstance(fig, dict):
        return None
    blob = fig.get('blob')
    if isinstance(blob, (bytes, bytearray)) and blob:
        return bytes(blob)
    data = fig.get('data')
    if isinstance(data, str) and data.startswith('data:') and ',' in data:
        try:
            return base64.b64decode(data.split(',', 1)[1], validate=True)
        except (ValueError, TypeError):
            return None
    return None


def figure_tex(fig: dict, index: int) -> str:
    """一張題目圖 → LaTeX 圖形塊（figures/qN.png，寬度照存檔的 cx）。"""
    try:
        width_cm = int(fig.get('cx') or 0) / 360000.0
    except (TypeError, ValueError):
        width_cm = 0
    width = 'width=%.2fcm' % width_cm if 0.5 <= width_cm <= 18 else 'width=6cm'
    return ('\\par\\begin{center}\n'
            '\\includegraphics[%s]{%s/q%d.png}\n'
            '\\end{center}\n' % (width, FIGURE_DIR, index))


def collect_figures(figs, figs_out: list) -> str:
    """把一題的圖換成 \\includegraphics 片段；圖檔 bytes 追加進 figs_out。

    figs_out 由呼叫端持有（全卷共用），檔名用 figures/q{序號}.png，序號＝加入後的
    長度，保證各題不重複。回該題的 LaTeX 片段（沒圖回空字串）。
    """
    if not figs:
        return ''
    blocks = []
    for fig in figs:
        blob = figure_bytes_of(fig)
        if not blob:
            continue
        n = len(figs_out) + 1
        figs_out.append((f'{FIGURE_DIR}/q{n}.png', blob))
        blocks.append(figure_tex({'cx': fig.get('cx')} if isinstance(fig, dict) else {}, n))
    return ''.join(blocks)


def tex_zip_payload(tex: str, figs_out: list, tex_name: str = '試卷.tex') -> str | None:
    """把 .tex + figures/ 打包成 zip，回 base64（含 data: 前綴）；沒圖回 None。

    有圖時前端下載 zip（Overleaf 上傳整包就能編譯）；沒圖維持單一 .tex。
    """
    if not figs_out:
        return None
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(tex_name, tex)
        for name, blob in figs_out:
            zf.writestr(name, blob)
    return 'data:application/zip;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')
