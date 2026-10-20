#!/usr/bin/env python3
"""AI 批改準確度基準測試。

三個模式：

    python grade_bench.py --rule-only     # 只量「規則核對」這一層（確定性，不需要 AI）
    python grade_bench.py --ai            # 量 AI 批改（需要先設定模型端點）
    python grade_bench.py --self-test     # 用固定假模型驗證整條管線可跑（不是準確度）

為甚麼要分開量：批改其實是兩層，準確度的來源完全不同。

  · 規則核對（rule_verdict）＝確定性的字串／等價比對，同一份輸入永遠同一個答案，
    可以離線量到準確率；它只判斷「最終答案」，不判斷過程。
  · AI 建議分＝模型判斷，準確度取決於模型、題型、作答形式（尤其手寫），
    必須用真實模型跑真實案例才量得到。這個工具就是拿來量第二層的。

`bench/grading_cases.json` 的 expect 是「教師認定分數」。要量自己學校的準確度，
請把 expect 換成你們真實批過的卷 —— 用別人的標記只反映別人的標準。
"""
import argparse
import base64
import json
import statistics
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import server  # noqa: E402

BENCH = ROOT / 'bench'


def load(name):
    path = BENCH / name
    if not path.exists():
        print(f'找不到 {path}', file=sys.stderr)
        sys.exit(2)
    return json.loads(path.read_text(encoding='utf-8'))


def load_cases(value):
    """讀取案例檔：預設 bench/grading_cases.json，也可以指定校內自己的檔案。

    絕對路徑、相對 bench/ 的路徑都可以；用校內真卷時把 expect 換成教師給的分數。
    """
    if not value:
        return load('grading_cases.json')
    path = Path(value)
    if not path.is_absolute():
        path = BENCH / path
    if not path.exists():
        print(f'找不到 {path}', file=sys.stderr)
        sys.exit(2)
    return json.loads(path.read_text(encoding='utf-8'))


def case_image(case):
    """把案例的 image 轉成 data URL：可寫 'data:...'、或相對於 bench/ 的檔名。"""
    value = case.get('image')
    if not value:
        return None
    if value.startswith('data:'):
        return value
    path = Path(value)
    if not path.is_absolute():
        path = BENCH / path
    if not path.exists():
        print(f'找不到圖片 {path}（案例 {case.get("id")}）', file=sys.stderr)
        sys.exit(2)
    mime = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.webp': 'image/webp'}.get(path.suffix.lower())
    if not mime:
        print(f'{path.name}：只收 PNG／JPEG／WebP（HEIC 請先轉檔）', file=sys.stderr)
        sys.exit(2)
    return f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode()


# ── 第一層：規則核對（確定性）────────────────────────────────────────────
def run_rule_bench():
    data = load('rule_cases.json')
    cases = data['cases']
    expect_map = {'correct': True, 'wrong': False, 'unknown': None}
    rows, wrong = [], []
    for case in cases:
        q = {'answer': case['answer']}
        image = 'data:image/webp;base64,x' if case.get('image') else None
        got = server.rule_verdict(q, case['answerText'], image)
        want = expect_map[case['expect']]
        ok = got is want
        rows.append({'id': case['id'], 'group': case['group'], 'expect': case['expect'],
                     'got': {True: 'correct', False: 'wrong', None: 'unknown'}[got], 'ok': ok,
                     'note': case['note']})
        if not ok:
            wrong.append(rows[-1])
    groups = {}
    for row in rows:
        item = groups.setdefault(row['group'], [0, 0])
        item[0] += 1
        item[1] += 1 if row['ok'] else 0
    return {'total': len(rows), 'hit': sum(1 for r in rows if r['ok']), 'rows': rows,
            'groups': groups, 'misses': wrong}


def print_rule_report(report):
    print('═' * 66)
    print('第一層：規則核對（確定性，不需要 AI）')
    print('═' * 66)
    print(f'案例 {report["total"]} 個，正確 {report["hit"]} 個，'
          f'準確率 {report["hit"] / report["total"] * 100:.1f}%')
    print()
    print(f'{"分組":<14}{"正確/總數":<12}準確率')
    for name, (total, hit) in sorted(report['groups'].items()):
        print(f'{name:<14}{f"{hit}/{total}":<12}{hit / total * 100:.0f}%')
    if report['misses']:
        print()
        print('未命中（要當成已知限制或修正案例）：')
        for row in report['misses']:
            print(f'  [{row["id"]}] {row["note"]}｜預期 {row["expect"]}，實得 {row["got"]}')
    else:
        print()
        print('全部命中：規則層在這些案例上沒有誤判，也沒有「該說不知道卻硬判」。')
    print()


# ── 第二層：AI 批改（需要真實模型）───────────────────────────────────────
def build_benchmark_app():
    tmp = tempfile.TemporaryDirectory(prefix='mathpath-bench-')
    app = server.Application(Path(tmp.name) / 'data')
    app.safe_initialize()
    app.reload_ai()
    with app.db() as db:
        teacher = dict(next(r for r in db.execute('SELECT * FROM users') if r['role'] == 'teacher'))
        student = dict(next(r for r in db.execute('SELECT * FROM users') if r['role'] == 'student'))
    return tmp, app, teacher, student


def import_question(app, teacher, question):
    payload = {**question}
    payload.setdefault('options', [])
    payload.setdefault('tags', [])
    payload.setdefault('hint', '')
    payload.setdefault('analysis', '')
    payload.setdefault('steps', [])
    payload.setdefault('rubric', [])
    result = app.dispatch('POST', '/api/questions/import', {'questions': [payload]},
                          teacher, None, '127.0.0.1', None)[0]
    return result['questions'][0]['id']


def run_ai_bench(data=None):
    data = data or load('grading_cases.json')
    tmp, app, teacher, student = build_benchmark_app()
    try:
        if not app.ai.configured:
            print('尚未設定 AI 模型，無法量 AI 批改的準確度。', file=sys.stderr)
            print('兩種設定方式（任選一種）：', file=sys.stderr)
            print('  1) 環境變數：MATH_AI_BASE_URL / MATH_AI_MODEL / MATH_AI_API_KEY'
                  '（手寫作答另需 MATH_AI_VISION_MODEL）', file=sys.stderr)
            print('  2) 用教師帳號登入網站 →「模型端點」頁填寫並儲存', file=sys.stderr)
            return None
        print(f'模型：{app.ai.model}（{app.ai.mode}）'
              f'{"／視覺：" + app.ai.vision if app.ai.vision else ""}')
        print()

        calls = []
        original = app.ai.call

        def counted(instruction, payload, image=None, model=None, temperature=None):
            calls.append(instruction[:60])
            return original(instruction, payload, image=image, model=model, temperature=temperature)

        rows = []
        with patch.object(app.ai, 'call', side_effect=counted):
            for case in data['cases']:
                qid = import_question(app, teacher, case['question'])
                calls.clear()
                try:
                    # 基準測試是維護者在自己的機器上跑自己的題目，等同已同意外部傳送；
                    # 同意機制是後來才加的，這裡要明確帶上，否則一律 403 跑不動。
                    body = {'questionId': qid, 'answerText': case['answerText'],
                            'consentExternal': True}
                    # 手寫作答：image 是 data URL 或相對於 bench/ 的檔名。
                    image = case_image(case)
                    if image:
                        body['image'] = image
                    attempt = app.dispatch('POST', '/api/attempts', body,
                                           student, None, '127.0.0.1', None)[0]['attempt']
                    score = attempt['score']
                    method = attempt['gradingMethod']
                    feedback = attempt['feedback']
                    flags = attempt.get('reviewFlags') or []
                    steps = attempt['steps']
                except server.APIError as exc:
                    score, method, feedback, flags, steps = None, f'錯誤：{exc.message}', exc.message, [], []
                points = case['question']['points']
                tolerance = case.get('tolerance', round(points * 0.1, 2))
                diff = None if score is None else round(score - case['expect'], 2)
                rows.append({'id': case['id'], 'group': case['group'], 'expect': case['expect'],
                             'score': score, 'points': points, 'tolerance': tolerance, 'diff': diff,
                             'method': method, 'flags': [f['code'] for f in flags],
                             'gradingCalls': sum(1 for c in calls if '評分政策' in c),
                             'steps': steps, 'feedback': feedback, 'note': case['note']})
            # 系統層：標示「不會」不可以丟給模型
            system_rows = []
            for case in data.get('system_cases', []):
                qid = import_question(app, teacher, case['question'])
                calls.clear()
                attempt = app.dispatch('POST', '/api/attempts',
                                       {'questionId': qid, 'skipped': True, 'consentExternal': True},
                                       student, None, '127.0.0.1', None)[0]['attempt']
                system_rows.append({'id': case['id'], 'note': case['note'],
                                    'method': attempt['gradingMethod'], 'score': attempt['score'],
                                    'expectMethod': case['expectMethod'],
                                    'ok': attempt['gradingMethod'] == case['expectMethod']
                                          and attempt['score'] is None,
                                    'modelCalls': len(calls)})
        return {'rows': rows, 'system': system_rows,
                'model': app.ai.model, 'mode': app.ai.mode, 'vision': app.ai.vision}
    finally:
        tmp.cleanup()


def summarize(rows):
    scored = [r for r in rows if r['score'] is not None]
    diffs = [abs(r['diff']) for r in scored]
    signed = [r['diff'] for r in scored]
    return {
        'n': len(rows), 'graded': len(scored),
        'exact': sum(1 for r in scored if abs(r['diff']) <= 0.01),
        'within': sum(1 for r in scored if abs(r['diff']) <= r['tolerance']),
        'severe': sum(1 for r in scored if abs(r['diff']) > r['points'] * 0.25),
        'mae': statistics.fmean(diffs) if diffs else None,
        'maePercent': (statistics.fmean(diffs) / statistics.fmean([r['points'] for r in scored]) * 100
                       if diffs else None),
        'bias': statistics.fmean(signed) if signed else None,
        'flagged': sum(1 for r in scored if r['flags']),
    }


def print_ai_report(report):
    rows = report['rows']
    stats = summarize(rows)
    print('═' * 66)
    print(f'第二層：AI 批改（模型 {report["model"]}，{report["mode"]}）')
    print('═' * 66)
    if not stats['graded']:
        print('沒有任何案例取得分數，請看下方每一列的錯誤訊息。')
    else:
        print(f'案例 {stats["n"]} 個（成功評分 {stats["graded"]} 個）')
        print(f'  完全命中（分數完全一致）：{stats["exact"]}/{stats["graded"]}'
              f'（{stats["exact"] / stats["graded"] * 100:.0f}%）')
        print(f'  容忍命中（誤差在題目總分 10% 內）：{stats["within"]}/{stats["graded"]}'
              f'（{stats["within"] / stats["graded"] * 100:.0f}%）')
        print(f'  嚴重偏差（誤差超過題目總分 25%）：{stats["severe"]}/{stats["graded"]}'
              f'（{stats["severe"] / stats["graded"] * 100:.0f}%）')
        print(f'  平均絕對誤差：{stats["mae"]:.2f} 分（約 {stats["maePercent"]:.1f}% 的題目總分）')
        print(f'  偏向：{stats["bias"]:+.2f} 分'
              f'（正數＝AI 比教師寬鬆，負數＝AI 比教師嚴苛）')
        print(f'  建議覆核旗標：{stats["flagged"]}/{stats["graded"]} 題')
    print()
    print(f'{"案例":<6}{"分組":<16}{"教師":>6}{"AI":>7}{"誤差":>7}  備註')
    for row in rows:
        score = '—' if row['score'] is None else f'{row["score"]:g}'
        diff = '—' if row['diff'] is None else f'{row["diff"]:+g}'
        mark = ''
        if row['diff'] is not None and abs(row['diff']) > row['tolerance']:
            mark = '  ← 超出容忍'
        print(f'{row["id"]:<6}{row["group"]:<16}{row["expect"]:>6g}{score:>7}{diff:>7}{mark}')
        if row['flags']:
            print(f'      └ 旗標：{", ".join(row["flags"])}')
        if row['method'].startswith('錯誤'):
            print(f'      └ {row["method"]}')
    print()
    if report['system']:
        print('系統層檢查：')
        for row in report['system']:
            print(f'  [{row["id"]}] {"通過" if row["ok"] else "未通過"}｜'
                  f'method={row["method"]}、score={row["score"]}、模型呼叫 {row["modelCalls"]} 次')
            print(f'      {row["note"]}')
        print()
    print('注意：每次作答會呼叫模型兩次（批改一次、學習建議一次）；'
          '上方「模型呼叫」只計算批改那一次。')


def write_ai_report(report, rule_report, source='bench/grading_cases.json'):
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    stats = summarize(report['rows'])
    lines = [f'# AI 批改準確度基準測試（{stamp} UTC）', '',
             f'- 模型：`{report["model"]}`（{report["mode"]}）'
             + (f'，視覺模型 `{report["vision"]}`' if report.get('vision') else ''),
             f'- 案例來源：`{source}`（expect 為教師認定分數）', '']
    if stats['graded']:
        lines += ['## 結果', '',
                  f'| 指標 | 數值 |', '|---|---|',
                  f'| 成功評分 | {stats["graded"]}/{stats["n"]} |',
                  f'| 完全命中 | {stats["exact"]}/{stats["graded"]}'
                  f'（{stats["exact"] / stats["graded"] * 100:.0f}%） |',
                  f'| 容忍命中（±10% 題分） | {stats["within"]}/{stats["graded"]}'
                  f'（{stats["within"] / stats["graded"] * 100:.0f}%） |',
                  f'| 嚴重偏差（>25% 題分） | {stats["severe"]}/{stats["graded"]} |',
                  f'| 平均絕對誤差 | {stats["mae"]:.2f} 分（{stats["maePercent"]:.1f}%） |',
                  f'| 偏向 | {stats["bias"]:+.2f} 分 |',
                  f'| 建議覆核旗標 | {stats["flagged"]}/{stats["graded"]} |', '']
    lines += ['## 逐題', '', '| 案例 | 分組 | 教師 | AI | 誤差 | 旗標 |', '|---|---|---|---|---|---|']
    for row in report['rows']:
        score = '—' if row['score'] is None else f'{row["score"]:g}'
        diff = '—' if row['diff'] is None else f'{row["diff"]:+g}'
        flags = ', '.join(row['flags']) or '—'
        lines.append(f'| {row["id"]} | {row["group"]} | {row["expect"]:g} | {score} | {diff} | {flags} |')
    if report['system']:
        lines += ['', '## 系統層檢查', '']
        for row in report['system']:
            lines.append(f'- [{"通過" if row["ok"] else "未通過"}] {row["id"]}：{row["note"]}'
                         f'（method={row["method"]}、score={row["score"]}、模型呼叫 {row["modelCalls"]} 次）')
    if rule_report:
        lines += ['', '## 第一層：規則核對（確定性）', '',
                  f'準確率 {rule_report["hit"]}/{rule_report["total"]}'
                  f'（{rule_report["hit"] / rule_report["total"] * 100:.1f}%）', '']
        for row in rule_report['rows']:
            lines.append(f'- [{"O" if row["ok"] else "X"}] {row["id"]}（{row["group"]}）'
                         f'預期 {row["expect"]}，實得 {row["got"]}｜{row["note"]}')
    path = BENCH / f'results-{stamp}.md'
    path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return path


# ── 自我測試：驗證整條管線可跑（不是準確度）──────────────────────────────
def run_self_test():
    data = load('grading_cases.json')
    tmp, app, teacher, student = build_benchmark_app()
    try:
        app.ai.configured, app.ai.mode = True, 'local'
        ok = True
        # 假模型：固定回傳「一半分數」，並刻意把步驟配分加總寫錯，順便驗證歸一化。
        # 有評分標準的題目走另一條路徑（逐項百分比），要回對應的形狀。
        def fake(instruction, payload, image=None, model=None, temperature=None):
            if '評分政策' not in instruction:
                return {'strength': 's', 'focus': 'f', 'nextStep': 'n', 'recommendedIds': []}
            points = payload['question']['points']
            if payload.get('rubric'):
                return {'feedback': '自我測試用回覆。',
                        'items': [{'percent': 50, 'comment': ''} for _ in payload['rubric']]}
            return {'score': points / 2, 'feedback': '自我測試用回覆。',
                    'steps': [{'label': '步驟一', 'earned': points / 2, 'max': points * 2, 'comment': ''}]}

        with patch.object(app.ai, 'call', side_effect=fake):
            for case in data['cases']:
                qid = import_question(app, teacher, case['question'])
                attempt = app.dispatch('POST', '/api/attempts',
                                       {'questionId': qid, 'answerText': case['answerText']},
                                       student, None, '127.0.0.1', None)[0]['attempt']
                points = case['question']['points']
                want = points / 2
                # 客觀題（選擇題／填空題）由規則層定分、沒有過程分：
                # 假模型的「一半分數」不該被採用，步驟也必須是空的。
                if case['question'].get('qtype') in ('選擇題', '填空題'):
                    steps_ok = attempt['steps'] == []
                    scored = attempt['score'] in (0, points)
                else:
                    steps_ok = (abs(sum(s['max'] for s in attempt['steps']) - points) < 0.01
                                and abs(sum(s['earned'] for s in attempt['steps']) - want) < 0.01)
                    scored = attempt['score'] is not None and abs(attempt['score'] - want) < 0.01
                good = attempt['gradingMethod'] == 'ai-practice' and scored and steps_ok
                ok = ok and good
                shown = '—' if attempt['score'] is None else f'{attempt["score"]:g}'
                total = sum(s['max'] for s in attempt['steps'])
                print(f'  [{case["id"]}] {"OK" if good else "失敗"}'
                      f' 分數 {shown}/{points:g}，步驟配分總和 {total:g}')
            for case in data.get('system_cases', []):
                qid = import_question(app, teacher, case['question'])
                attempt = app.dispatch('POST', '/api/attempts', {'questionId': qid, 'skipped': True},
                                       student, None, '127.0.0.1', None)[0]['attempt']
                good = attempt['gradingMethod'] == case['expectMethod'] and attempt['score'] is None
                ok = ok and good
                print(f'  [{case["id"]}] {"OK" if good else "失敗"}'
                      f' method={attempt["gradingMethod"]}、score={attempt["score"]}')
        print()
        print('管線自我測試：' + ('全部通過' if ok else '有失敗，請檢查'))
        print('⚠️ 這不是準確度 —— 假模型回傳的是固定分數，只證明管線與歸一化正常運作。')
        return 0 if ok else 1
    finally:
        tmp.cleanup()


def main():
    parser = argparse.ArgumentParser(description='AI 批改準確度基準測試')
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--rule-only', action='store_true', help='只量規則核對（不需要 AI）')
    group.add_argument('--ai', action='store_true', help='量 AI 批改（需要已設定的模型端點）')
    group.add_argument('--self-test', action='store_true', help='用假模型驗證管線（不是準確度）')
    parser.add_argument('--cases', help='案例檔（預設 bench/grading_cases.json；可指向校內自己的檔案）')
    args = parser.parse_args()

    if args.self_test:
        print('管線自我測試（假模型，非準確度）')
        print()
        return run_self_test()

    rule_report = run_rule_bench()
    print_rule_report(rule_report)

    if args.rule_only:
        return 0

    report = run_ai_bench(load_cases(args.cases))
    if report is None:
        return 2
    print_ai_report(report)
    path = write_ai_report(report, rule_report, source=args.cases or 'bench/grading_cases.json')
    print()
    print(f'完整報告已寫入：{path.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
