---
name: lt-on
description: "打开沉浸模式 (Phase 1.0: lt immersion on; Phase 1.1b 后改 lt mix 100)"
prompt_version: v1
prompt_max_tokens: 250
trigger:
  - "/lt-on"
  - "/jp-on"
---

# /lt-on — 沉浸开

## Phase 1.0 行为

执行 `lt immersion on` → 写 `~/.config/polyglot/immersion.flag`。stop-hook 看到这个 flag 时会更激进地注题/反问。

简短回复：「沉浸已开。Claude 会更主动塞题 / 反问中文输入。`lt-off` 关掉。」

## Phase 1.1b 之后（Task 23 落地后）

`lt immersion` 被 `lt mix <0..100>` 取代，`/lt-on` 改调 `lt mix 100`（全沉浸 mix）。如果 `lt mix --help` 报「unknown command」就还在 1.0 阶段，继续走 `lt immersion on`。

## 不要做的事

- 不要改 inject_rate / cn_probe_rate（那是 `/lt-setup` 范畴）
- 不要超 250 tokens（这是个一行命令的封装）
