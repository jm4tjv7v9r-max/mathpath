#!/usr/bin/env python3
"""配色對比度檢查（WCAG）。

為甚麼需要這支腳本：兩套配色（晨光／墨夜）意味著每個顏色都要維護兩份，
之前出現過三輪「墨夜漏網」——白底綠字對比只有 1.68、次要文字 2.49，
都是人工掃出來的。這支腳本把「可自動判斷的部分」固定下來。

檢查兩件事：

1. **變數配對的對比度**：把前景變數（--ink／--muted／--green…）放到背景變數
   （--bg／--paper／--surface…）上，算 WCAG 對比，低於 4.5 就失敗。
2. **寫死的顏色**：變數區塊以外直接寫 `color:#xxx` 的地方列出來（只警告）。
   這些就是墨夜模式下最可能「看不見」的地方——顏色不會跟著主題換。

用法：
    python check_contrast.py            # 印出表格；有不合格就 exit 1
    python check_contrast.py --strict   # 連寫死的前景顏色也當失敗（給 CI 用）
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CSS = ROOT / 'styles.css'

# 會被當成「文字」的前景變數；背景變數則是元素可能出現的底色。
FOREGROUNDS = ('--ink', '--muted', '--muted-2', '--green', '--green-dark')
BACKGROUNDS = ('--bg', '--paper', '--surface', '--surface-soft', '--surface-green', '--mint')
MIN_RATIO = 4.5          # WCAG AA 一般文字
LARGE_TEXT_RATIO = 3.0   # 大字（>=18.66px 粗體或 24px）可放寬到 3.0


def parse_declarations(block):
    """把 `--a:#fff;--b:#111` 這種宣告解析成 dict。"""
    return {name: value.strip() for name, value in re.findall(r'(--[\w-]+)\s*:\s*([^;}]+)', block)}


def block_of(css, selector):
    """取出某個選擇器的宣告區塊內容（只取第一個）。"""
    match = re.search(re.escape(selector) + r'\s*\{([^}]*)\}', css)
    return match.group(1) if match else ''


def palettes(css):
    """回傳 {主題: {變數: 顏色}}；墨夜＝根變數再覆蓋一層。"""
    base = parse_declarations(block_of(css, ':root'))
    night = dict(base)
    night.update(parse_declarations(block_of(css, 'html[data-theme=night]')))
    return {'晨光': base, '墨夜': night}


def to_rgb(value):
    """支援 #rgb、#rrggbb、rgb()/rgba()；解析不了回 None。"""
    value = value.strip().lower()
    if value.startswith('#'):
        body = value[1:]
        if len(body) == 3:
            body = ''.join(c * 2 for c in body)
        if len(body) != 6:
            return None
        try:
            return tuple(int(body[i:i + 2], 16) for i in (0, 2, 4))
        except ValueError:
            return None
    match = re.fullmatch(r'rgba?\(([^)]+)\)', value)
    if match:
        parts = [p.strip() for p in match.group(1).split(',')]
        if len(parts) < 3:
            return None
        try:
            return tuple(int(float(p)) for p in parts[:3])
        except ValueError:
            return None
    return None


def luminance(rgb):
    channels = []
    for value in rgb:
        c = value / 255
        channels.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    high, low = max(la, lb), min(la, lb)
    return (high + 0.05) / (low + 0.05)


def audit(css_text=None):
    """回傳 (rows, hardcoded)；rows 是每一組配對的對比結果。"""
    css = CSS.read_text(encoding='utf-8') if css_text is None else css_text
    rows = []
    for theme, palette in palettes(css).items():
        for fg in FOREGROUNDS:
            for bg in BACKGROUNDS:
                fg_value, bg_value = palette.get(fg), palette.get(bg)
                if not fg_value or not bg_value:
                    continue
                fg_rgb, bg_rgb = to_rgb(fg_value), to_rgb(bg_value)
                if not fg_rgb or not bg_rgb:
                    continue
                rows.append({'theme': theme, 'fg': fg, 'bg': bg,
                             'ratio': round(contrast(fg_rgb, bg_rgb), 2)})
    return rows, hardcoded_colors(css)


def hardcoded_colors(css):
    """找出變數區塊以外、直接寫死的前景顏色（`color:#…`）。"""
    stripped = css
    for selector in (':root', 'html[data-theme=night]'):
        match = re.search(re.escape(selector) + r'\s*\{[^}]*\}', stripped)
        if match:
            stripped = stripped[:match.start()] + ' ' * (match.end() - match.start()) + stripped[match.end():]
    found = []
    for match in re.finditer(r'(?<![\w-])color\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))', stripped):
        line = stripped[:match.start()].count('\n') + 1
        found.append({'line': line, 'value': match.group(1)})
    return found


def main():
    parser = argparse.ArgumentParser(description='配色對比度檢查（WCAG AA）')
    parser.add_argument('--strict', action='store_true', help='連寫死的前景顏色也當失敗')
    args = parser.parse_args()

    rows, hardcoded = audit()
    failures = [r for r in rows if r['ratio'] < MIN_RATIO]

    print('═' * 66)
    print('配色對比度（WCAG AA：一般文字 4.5、大字 3.0）')
    print('═' * 66)
    for theme in ('晨光', '墨夜'):
        print(f'\n【{theme}】')
        print(f"{'前景':<14}{'背景':<16}{'對比':>7}   ")
        for row in [r for r in rows if r['theme'] == theme]:
            mark = '✗' if row['ratio'] < MIN_RATIO else ('△' if row['ratio'] < 7 else '✓')
            print(f"{row['fg']:<14}{row['bg']:<16}{row['ratio']:>7.2f}  {mark}")

    print()
    if failures:
        print(f'✗ {len(failures)} 組低於 {MIN_RATIO}：')
        for row in failures:
            print(f"  {row['theme']}：{row['fg']} on {row['bg']} = {row['ratio']:.2f}")
    else:
        print(f'✓ 全部 {len(rows)} 組都達到 {MIN_RATIO}')

    print()
    print(f'寫死的前景顏色：{len(hardcoded)} 處（不會跟著主題換，墨夜模式要特別看）')
    for item in hardcoded[:12]:
        print(f"  styles.css:{item['line']}  color: {item['value']}")
    if len(hardcoded) > 12:
        print(f'  …其餘 {len(hardcoded) - 12} 處')

    if failures or (args.strict and hardcoded):
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
