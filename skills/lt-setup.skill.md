---
name: lt-setup
description: 交互式 onboarding — 7 问写 ~/.config/polyglot/profile.yaml
prompt_version: v1
prompt_max_tokens: 250
trigger:
  - "/lt-setup"
  - "/jp-setup"
---

# /lt-setup — Onboarding

第一次用 polyglot 时跑一次。问 7 个问题，写 profile.yaml。**不要全部一次问完**，一问一答。

## 7 问

1. **当前水平 level**：N5 / N4 / N3 / N2 / N1，默认 N3
2. **目标 target**：默认 N2（必须 ≥ level）
3. **薄弱项 weak_areas**：vocab / grammar / kanji / listening / speaking 多选，默认 `[grammar, kanji]`
4. **工作时段 work_hours**：HH:MM-HH:MM，默认 `09:00-19:00`（hook 只在这个区间注入）
5. **每日新词配额 daily_new_count**：默认 5
6. **每日提醒时刻 daily_cron**：HH:MM 或空（空 = 不开 launchd），默认 `09:00`
7. **沉浸默认开 immersion_default**：true / false，默认 false

## 写入

收齐答案后执行：

```bash
lt config level=<v> target=<v> weak_areas=[<a,b,c>] work_hours=<v> daily_new_count=<n> daily_cron=<v> immersion_default=<bool>
```

`lt config` 一次能传多个 key=value。注意 weak_areas 要写成 `[grammar,kanji]` 这种带方括号的列表字面量。

写完后跑 `lt config --show` 让用户确认 profile，然后建议下一步：

- 没导入题库 → `lt seed-import`
- 想现在练 → `/lt`
- 想看每日推送 → `lt install-cron`

## 不要做的事

- 不要默默替用户选默认值（每问要让用户确认或改）
- 不要超 250 tokens
- profile.version 字段不让用户手动改（schema 演化才动）
