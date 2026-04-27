---
name: lt-on
description: "打开全沉浸 (lt mix 100)"
prompt_version: v2
prompt_max_tokens: 250
trigger:
  - "/lt-on"
  - "/jp-on"
---

# /lt-on — 全沉浸开

## 行为

执行 `lt mix 100` → 写 `profile.immersion_level=1.0`，同时写 `~/.config/polyglot/immersion.flag`（保留给 1.0 老安装的 fallback）。下一个 user prompt 进来时 `user-prompt-submit` hook 会注入「全 ${active_language} + 注音 + 中文译文」prompt。

简短回复：「全沉浸已开（mix=100）。Claude 之后回复会全 ${active_language}。`/lt-off` 关，或 `lt mix 25` 换偶尔混入。」

## 五档预设

`lt mix` 只接受预设档位。其他值用 `--custom` 强制写入（不推荐，LLM 行为只在以下 5 个锚点定义清晰）：

| 命令 | immersion_level | 行为 |
|---|---|---|
| `lt mix 0` | 0 | 不注入 |
| `lt mix 10` | 0.10 | 偶尔点缀（≤1 词/回复 + 注音 + 中文） |
| `lt mix 25` | 0.25 | 常见词替换（≤3 词/回复） |
| `lt mix 50` | 0.50 | 短句尾整句目标语言 + 中文翻译 |
| `lt mix 100` | 1.00 | 全目标语言 + 注音 + 中文译文 |

## fallback

如果 `lt mix --help` 报「unknown command」（极老安装），回 `lt immersion on`。

## 不要做的事

- 不要改 inject_rate / cn_probe_rate（那是 `/lt-setup` 范畴）
- 不要超 250 tokens（这是个一行命令的封装）
