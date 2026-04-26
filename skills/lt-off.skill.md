---
name: lt-off
description: "关闭沉浸模式 (Phase 1.0: lt immersion off; Phase 1.1b 后改 lt mix 0)"
prompt_version: v1
prompt_max_tokens: 250
trigger:
  - "/lt-off"
  - "/jp-off"
---

# /lt-off — 沉浸关

## Phase 1.0 行为

执行 `lt immersion off` → 删 `immersion.flag`。stop-hook 回到默认 inject_rate（profile.inject_rate, 默认 0.10）。

简短回复：「沉浸关。回到普通节奏，hook 仍按 inject_rate 概率注题。`/lt-on` 重开。」

## Phase 1.1b 之后

改调 `lt mix 0`（mix=0 表示无沉浸）。fallback 同 `/lt-on`：unknown command 时回 `lt immersion off`。

## 不要做的事

- 不要顺带禁 hook（用户要彻底静音得跑 `lt uninstall-hooks`，不在这个 skill 范畴）
- 不要超 250 tokens
