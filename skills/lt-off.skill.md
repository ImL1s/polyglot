---
name: lt-off
description: "关闭沉浸 (lt mix 0)"
prompt_version: v2
prompt_max_tokens: 250
trigger:
  - "/lt-off"
  - "/jp-off"
---

# /lt-off — 沉浸全关

## 行为

执行 `lt mix 0` → 写 `profile.immersion_level=0` + 删 `immersion.flag`。`user-prompt-submit` hook 不再注入沉浸/混入 prompt。stop-hook 仍按 `profile.inject_rate` 概率注题。

简短回复：「沉浸关（mix=0）。回到普通节奏，hook 仍按 inject_rate 概率注题。`/lt-on` 全开 / `lt mix 25` 偶尔混入。」

## fallback

如果 `lt mix --help` 报「unknown command」，回 `lt immersion off`。

## 不要做的事

- 不要顺带禁 hook（用户要彻底静音得跑 `lt uninstall-hooks`，不在这个 skill 范畴）
- 不要超 250 tokens
