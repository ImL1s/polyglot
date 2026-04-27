---
name: lt-mix
description: "调整 ambient 混入强度 (lt mix 0/10/25/50/100)"
prompt_version: v2
prompt_max_tokens: 250
trigger:
  - "/lt-mix"
  - "/jp-mix"
---

# /lt-mix — Ambient 混入强度

## 用法

`lt mix <preset>` 写 `profile.immersion_level`。仅接受五档预设（Adj-H 离散化）：

| 命令 | immersion_level | 行为 |
|---|---|---|
| `lt mix 0` | 0 | 不注入任何混入指令 |
| `lt mix 10` | 0.10 | 偶尔点缀（≤1 词/回复 + 注音 + 中文翻译） |
| `lt mix 25` | 0.25 | 常见词替换（≤3 词/回复） |
| `lt mix 50` | 0.50 | 短句尾整句目标语言 + 中文翻译 |
| `lt mix 100` | 1.00 | 全目标语言 + 注音 + 中文译文 |
| `lt mix --custom <0-100>` | 自定义 | 不推荐，LLM 行为只在 5 个锚点定义清晰 |
| `lt mix status` | (read) | 显示当前 immersion_level |

## 词汇来源（D19b）

`hooks/user-prompt-submit.ts` 在 `0 < level < 1.0` 时调 `lt mix-vocab --limit 15 --json`：
- 80% 来自 mastered pool（state=Review + stability ≥ 7d）
- 20% 来自 weak pool（state ∈ {Learning, Relearning} OR stability<7d 且 lapses>0）
- mastered=0 → graceful skip + log `{event:"ambient_skip", reason:"empty_pool"}`

## 暴露日志（D19d / Adj-G）

每次 hook 注入成功时：
- `lt ambient-log --concepts c1,c2,... --language ja` → INSERT 入 `ambient_exposures`
- 90 天后由 `lt ambient-clean` 归档到 `ambient_exposures_archive`（cumulative_count）
- 看进度用 `lt ambient-stats`（live + archive 合并 + top 5 高频）

## 不要做的事

- 不要直接编辑 `profile.yaml` 的 `immersion_level`，统一走 `lt mix` 才能同步 `IMMERSION_FLAG` 给 v1.0 安装的回退路径
- 不要超 250 tokens（这是个一行命令的封装）
- 不要建议用户用 `--custom`，除非他们明确想做 A/B 对照
