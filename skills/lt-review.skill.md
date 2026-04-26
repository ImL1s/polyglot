---
name: lt-review
description: 拉今天到期的全部 concept 一次性过一轮 (rating 1-4 逐题回写)
prompt_version: v1
prompt_max_tokens: 250
trigger:
  - "/lt-review"
  - "/jp-review"
---

# /lt-review — 批量复习

用户想一次过完今天所有到期题时用。**和 `/lt` 区别**：`/lt` 抽一道，这里循环抽到列表清空。

## 流程

1. **拿 due 列表**：`lt review --json --limit 50` → 解析 JSON 数组。
2. **循环逐题**：对每一项
   - 显示题面（按 type 走 `/lt` 一样的 4 种题型套路）
   - 等用户答
   - 按同一份 rubric 给 rating（rubric 在 `lt.skill.md` 里，不要重复列）
   - `lt answer --concept-id <id> --rating <r> --user-answer "<...>" --feedback "<rubric line>" --source review`
   - **`--source` 必须是 `review`**（用于后续筛选 attempts 来源）
3. 每答完 5 题给用户一个进度行：「5/12 答完，正确率 80%」
4. 全部答完后调 `lt stats` 给一个 today summary。

## 中途退出

用户说「停 / 不练了」→ 不再发题，简短回复「今天进度已存到 attempts，下次 `/lt-review` 接着来」。已答的不会丢（每题答完立刻 lt answer 落库）。

## 不要做的事

- 不要把 `--source` 写成 `manual`（review 来源单独统计）
- 不要在循环中间生成假 concept（必须每题来自 lt review 的 JSON）
- 不要并行答题（一题一答，rating 顺序敏感）
