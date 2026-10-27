"""Word 方程式（OMML）↔ LaTeX 互轉。

只支援中學卷常見的結構：分數、上下標、根號、括號、求和／積分、文字、
以及常見符號。遇到不認得的結構，會退回純文字並記錄警告，不會靜靜吃掉內容。
"""
from __future__ import annotations

import re
from lxml import etree

M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
XML_SPACE = '{http://www.w3.org/XML/1998/namespace}space'

SYMBOLS = {
    'alpha': 'α', 'beta': 'β', 'gamma': 'γ', 'delta': 'δ', 'epsilon': 'ε',
    'theta': 'θ', 'lambda': 'λ', 'mu': 'μ', 'pi': 'π', 'rho': 'ρ',
    'sigma': 'σ', 'tau': 'τ', 'phi': 'φ', 'omega': 'ω', 'Delta': 'Δ',
    'le': '≤', 'leq': '≤', 'ge': '≥', 'geq': '≥', 'ne': '≠', 'neq': '≠',
    'approx': '≈', 'pm': '±', 'mp': '∓', 'times': '×', 'div': '÷', 'cdot': '·',
    'in': '∈', 'notin': '∉', 'subset': '⊂', 'subseteq': '⊆',
    'supset': '⊃', 'supseteq': '⊇', 'cup': '∪', 'cap': '∩',
    'varnothing': '∅', 'emptyset': '∅', 'infty': '∞',
    'angle': '∠', 'triangle': '△', 'parallel': '∥', 'perp': '⊥',
    'Rightarrow': '⇒', 'Leftrightarrow': '⇔', 'rightarrow': '→',
    'complement': '∁', 'therefore': '∴', 'because': '∵',
    'mid': '|', 'vert': '|', 'lvert': '|', 'rvert': '|',
    'langle': '⟨', 'rangle': '⟩', 'prime': '′', 'circ': '°', 'degree': '°',
}
BLACKBOARD = {'R': 'ℝ', 'N': 'ℕ', 'Z': 'ℤ', 'Q': 'ℚ', 'C': 'ℂ'}
NARY = {'sum': '∑', 'prod': '∏', 'int': '∫', 'iint': '∬', 'oint': '∮'}
FUNCS = {'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'ln', 'lg',
         'arcsin', 'arccos', 'arctan', 'max', 'min', 'lim'}

# LaTeX 輸出時，把 Unicode 符號換回指令
UNICODE_TO_CMD = {v: k for k, v in SYMBOLS.items() if k not in ('leq', 'geq', 'neq')}
UNICODE_TO_CMD['|'] = 'mid'          # 反查時優先用 \mid，不要變成 \rvert
UNICODE_TO_CMD.update({'ℝ': r'\mathbb{R}', 'ℕ': r'\mathbb{N}', 'ℤ': r'\mathbb{Z}',
                       'ℚ': r'\mathbb{Q}', 'ℂ': r'\mathbb{C}'})


def _m(tag):
    return f'{{{M_NS}}}{tag}'


def _el(tag, *children, **attrs):
    e = etree.Element(_m(tag))
    for k, v in attrs.items():
        e.set(_m(k), v)
    for c in children:
        e.append(c)
    return e


def _run(text: str, plain: bool = False, upright: bool = False):
    r = _el('r')
    if plain or upright:
        rpr = _el('rPr')
        if plain:
            rpr.append(_el('nor'))
        else:
            rpr.append(_el('sty', val='p'))
        r.append(rpr)
    t = _el('t')
    t.text = text
    t.set(XML_SPACE, 'preserve')
    r.append(t)
    return r


# ── LaTeX → OMML ──────────────────────────────────────────────────────
class _Parser:
    def __init__(self, src: str):
        self.s = src
        self.i = 0
        self.warnings: list[str] = []

    def peek(self):
        return self.s[self.i] if self.i < len(self.s) else ''

    def take(self):
        ch = self.peek()
        self.i += 1
        return ch

    def skip_spaces(self):
        while self.peek().isspace():
            self.i += 1

    def parse(self):
        nodes = self.seq(stop='')
        return nodes

    def seq(self, stop: str):
        nodes = []
        while self.i < len(self.s):
            ch = self.peek()
            if stop and ch == stop:
                break
            if ch.isspace():
                self.i += 1
                continue
            atom = self.atom()
            atom = self.scripts(atom)
            nodes.extend(atom)
        return nodes

    def group(self):
        """讀取一個參數：{...} 或單一 token。"""
        self.skip_spaces()
        if self.peek() == '{':
            self.take()
            nodes = self.seq(stop='}')
            if self.peek() == '}':
                self.take()
            return nodes
        atom = self.atom()
        return self.scripts(atom)

    def atom(self):
        ch = self.peek()
        if ch == '{':
            self.take()
            nodes = self.seq(stop='}')
            if self.peek() == '}':
                self.take()
            return nodes
        if ch == '\\':
            return self.command()
        self.take()
        return [_run(ch)]

    def command(self):
        self.take()  # backslash
        name = ''
        while self.peek().isalpha():
            name += self.take()
        if not name:                      # \{ \} \% 這類轉義字元
            ch = self.take()
            return [_run(ch)] if ch else []

        if name == 'frac':
            num = self.group()
            den = self.group()
            return [_el('f', _el('num', *num), _el('den', *den))]
        if name == 'sqrt':
            deg = []
            if self.peek() == '[':
                self.take()
                deg = self.seq(stop=']')
                if self.peek() == ']':
                    self.take()
            body = self.group()
            rad = _el('rad')
            if deg:
                rad.append(_el('radPr'))
                rad.append(_el('deg', *deg))
            else:
                rad.append(_el('radPr', _el('degHide', val='1')))
                rad.append(_el('deg'))
            rad.append(_el('e', *body))
            return [rad]
        if name == 'left':
            beg = self.take()
            body = self.seq_until_right()
            end = '('
            if self.s[self.i:self.i + 6] == '\\right':
                self.i += 6
                end = self.take()
            return [_el('d',
                        _el('dPr', _el('begChr', val=beg), _el('endChr', val=end)),
                        _el('e', *body))]
        if name == 'text' or name == 'mathrm':
            self.skip_spaces()
            if self.peek() == '{':
                self.take()
                start = self.i
                while self.peek() and self.peek() != '}':
                    self.take()
                text = self.s[start:self.i]
                if self.peek() == '}':
                    self.take()
                return [_run(text, plain=True)]
            return []
        if name == 'mathbb':
            self.skip_spaces()
            if self.peek() == '{':
                self.take()
                letter = self.take()
                if self.peek() == '}':
                    self.take()
                return [_run(BLACKBOARD.get(letter, letter))]
            return []
        if name in NARY:
            sub = sup = []
            while self.peek() in ('_', '^'):
                mark = self.take()
                arg = self.group()
                if mark == '_':
                    sub = arg
                else:
                    sup = arg
            self.skip_spaces()
            body = self.atom()
            return [_el('nary',
                        _el('naryPr', _el('chr', val=NARY[name]),
                            _el('limLoc', val='undOvr')),
                        _el('sub', *sub), _el('sup', *sup), _el('e', *body))]
        if name in FUNCS:
            return [_run(name, upright=True)]
        if name in SYMBOLS:
            return [_run(SYMBOLS[name])]
        if name in ('quad', 'qquad', ',', ';', ':'):
            return [_run(' ')]
        self.warnings.append(f'未知指令 \\{name}，當作文字處理')
        return [_run(name)]

    def seq_until_right(self):
        nodes = []
        while self.i < len(self.s):
            if self.s[self.i:self.i + 6] == '\\right':
                break
            if self.peek().isspace():
                self.i += 1
                continue
            atom = self.atom()
            nodes.extend(self.scripts(atom))
        return nodes

    def scripts(self, base):
        sub = sup = None
        self.skip_spaces()
        while self.peek() in ('_', '^'):
            mark = self.take()
            arg = self.group()
            self.skip_spaces() if hasattr(self, 'skip_spaces') else self.skip()
            if mark == '_':
                sub = arg
            else:
                sup = arg
        if sub is None and sup is None:
            return base
        e = _el('e', *base)
        if sub is not None and sup is not None:
            return [_el('sSubSup', e, _el('sub', *sub), _el('sup', *sup))]
        if sub is not None:
            return [_el('sSub', e, _el('sub', *sub))]
        return [_el('sSup', e, _el('sup', *sup))]


def latex_to_omml(latex: str, warnings: list[str] | None = None):
    """回傳一個 <m:oMath> 元素（可直接插進段落）。"""
    src = latex.strip()
    if src.startswith('$') and src.endswith('$'):
        src = src[1:-1]
    parser = _Parser(src)
    nodes = parser.parse()
    om = _el('oMath')
    for n in nodes:
        om.append(n)
    if warnings is not None:
        warnings.extend(parser.warnings)
    return om


# ── OMML → LaTeX ──────────────────────────────────────────────────────
def _text_of(el) -> str:
    return ''.join(t.text or '' for t in el.iter(_m('t')))


def _escape(text: str) -> str:
    out = []
    for ch in text:
        if ch in UNICODE_TO_CMD:
            cmd = UNICODE_TO_CMD[ch]
            out.append((cmd if cmd.startswith('\\') else '\\' + cmd) + ' ')
        elif ch in '{}%$#&_':
            out.append('\\' + ch)
        else:
            out.append(ch)
    return ''.join(out)


def _is_cjk(text: str) -> bool:
    return any('\u3400' <= ch <= '\u9fff' for ch in text)


def _wrap(node, out: str) -> str:
    """需要時加括號：單一 token、已帶括號、\text{...} 都不加。"""
    stripped = out.strip()
    if len(stripped) <= 1:
        return out
    if re.fullmatch(r'\\[a-zA-Z]+', stripped):
        return out
    if out.startswith('\\left') or (out.startswith('{') and out.endswith('}')):
        return out
    if re.fullmatch(r'\\text\{[^}]*\}', out):
        return out
    return '{' + out + '}'


def _node_to_latex(el) -> str:
    tag = etree.QName(el).localname

    if tag in ('oMath', 'oMathPara', 'e', 'num', 'den', 'sub', 'sup', 'deg'):
        return ''.join(_node_to_latex(c) for c in el)
    if tag == 'r':
        text = _text_of(el)
        if not text:
            return ''
        if _is_cjk(text) or re.search(r'\s', text):
            return r'\text{' + text + '}'
        return _escape(text)
    if tag == 'f':
        num = ''.join(_node_to_latex(c) for c in el.findall(_m('num')))
        den = ''.join(_node_to_latex(c) for c in el.findall(_m('den')))
        return r'\frac{' + num + '}{' + den + '}'
    if tag == 'sSup':
        base = ''.join(_node_to_latex(c) for c in el.findall(_m('e')))
        sup = ''.join(_node_to_latex(c) for c in el.findall(_m('sup')))
        return _wrap(el, base) + '^{' + sup + '}'
    if tag == 'sSub':
        base = ''.join(_node_to_latex(c) for c in el.findall(_m('e')))
        sub = ''.join(_node_to_latex(c) for c in el.findall(_m('sub')))
        return _wrap(el, base) + '_{' + sub + '}'
    if tag == 'sSubSup':
        base = ''.join(_node_to_latex(c) for c in el.findall(_m('e')))
        sub = ''.join(_node_to_latex(c) for c in el.findall(_m('sub')))
        sup = ''.join(_node_to_latex(c) for c in el.findall(_m('sup')))
        return _wrap(el, base) + '_{' + sub + '}^{' + sup + '}'
    if tag == 'rad':
        body = ''.join(_node_to_latex(c) for c in el.findall(_m('e')))
        deg = ''.join(_node_to_latex(c) for c in el.findall(_m('deg')))
        return r'\sqrt[' + deg + ']{' + body + '}' if deg else r'\sqrt{' + body + '}'
    if tag == 'd':
        pr = el.find(_m('dPr'))
        beg = pr.find(_m('begChr')).get(_m('val')) if pr is not None and pr.find(_m('begChr')) is not None else '('
        end = pr.find(_m('endChr')).get(_m('val')) if pr is not None and pr.find(_m('endChr')) is not None else ')'
        body = ''.join(_node_to_latex(c) for c in el.findall(_m('e')))
        return r'\left' + beg + ' ' + body + r' \right' + end
    if tag == 'nary':
        pr = el.find(_m('naryPr'))
        chr_el = pr.find(_m('chr')) if pr is not None else None
        char = chr_el.get(_m('val')) if chr_el is not None else '∑'
        name = {v: k for k, v in NARY.items()}.get(char, 'sum')
        sub = ''.join(_node_to_latex(c) for c in el.findall(_m('sub')))
        sup = ''.join(_node_to_latex(c) for c in el.findall(_m('sup')))
        body = ''.join(_node_to_latex(c) for c in el.findall(_m('e')))
        out = '\\' + name
        if sub:
            out += '_{' + sub + '}'
        if sup:
            out += '^{' + sup + '}'
        return out + ' ' + body
    if tag in ('acc',):
        body = ''.join(_node_to_latex(c) for c in el.findall(_m('e')))
        return r'\bar{' + body + '}'
    if tag == 'func':
        name = ''.join(_node_to_latex(c) for c in el.findall(_m('fName')))
        body = ''.join(_node_to_latex(c) for c in el.findall(_m('e')))
        return name + ' ' + body
    # 不認得的結構：把文字抽出來，不要靜靜消失
    text = _text_of(el)
    return _escape(text) if text else ''


def omml_to_latex(el) -> str:
    """<m:oMath> → LaTeX（不含 $ 符號）。"""
    return ''.join(_node_to_latex(c) for c in el).strip()


def omml_latex_of_paragraph(p) -> str:
    """把段落內的方程式抽成 LaTeX，其餘文字照原樣，方程式用 $...$ 包住。"""
    out = []
    for child in p._p:
        local = etree.QName(child).localname
        if local == 'r':
            texts = child.findall(f'{{{W_NS}}}t')
            out.append(''.join(t.text or '' for t in texts))
        elif local in ('oMath', 'oMathPara'):
            latex = omml_to_latex(child)
            if latex:
                out.append(f'${latex}$')
    return ''.join(out)
