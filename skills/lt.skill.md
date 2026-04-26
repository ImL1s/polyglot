---
name: lt
description: Polyglot 主训练命令 — 抽下一道题、出题给用户、按 rubric 评分回写
prompt_version: v1
prompt_max_tokens: 250
trigger:
  - "/lt"
  - "/jp"
---

# /lt — 主训练入口

CLI 是核心引擎，你只是渲染 + 评分层。**不要自己生成题目**，必须先调 `lt next` 拿 concept。

## 流程（严格按顺序）

1. **抽题**：执行 `lt next --json`。如果 exit code 非 0（"No concepts due and daily new quota reached"），告诉用户「今天没题了」并停止。
2. **出题**：根据返回 JSON 的 `type` 选题型：
   - `vocab` → 给中文意思，让用户写出日语词 + 假名
   - `grammar` → 给场景中文句子，让用户造日语句子
   - `kanji` → 给汉字词，让用户写读音
   - `expression` → 给中文情景，让用户写惯用表达
3. **等用户作答**。
4. **按 rubric 评分**（见下），决定 rating ∈ {1, 2, 3, 4}。
5. **回写**：执行 `lt answer --concept-id <id> --rating <r> --user-answer "<text>" --feedback "<rubric_line>" --source manual`。
6. 简短反馈用户「下次复习时间：YYYY-MM-DD」（来自 lt answer 输出的 next_due_at）。

## 评分 rubric（v1 Adjustment E — 必读）

你 **必须** 用下表给 rating，并把命中的 rubric 行字面引用到 `--feedback` 参数里。FSRS 排期质量完全靠这条 rubric 锚定，自由发挥会让 stability/difficulty 漂移。

### vocab
- `rating_4_easy`：词形 + 读音 + 含义全对，无停顿
- `rating_3_good`：词形对，读音轻微犹豫 OR 含义部分缺
- `rating_2_hard`：含义对但需提示，OR 读音错
- `rating_1_again`：完全没回忆起来，需要全披露

### grammar
- `rating_4_easy`：语法形对 + 含义到位 + 能给反例 / 对比
- `rating_3_good`：形对，含义对，没给反例
- `rating_2_hard`：形对但含义模糊，OR 含义到位但形错
- `rating_1_again`：形错或不认识

### kanji
- `rating_4_easy`：读音 + 含义 + 一个常用搭配全对
- `rating_3_good`：读音对，含义对，搭配缺
- `rating_2_hard`：读音对但含义模糊，OR 含义对但读音错一处
- `rating_1_again`：读音错或不认识

### expression
- `rating_4_easy`：表达正确 + 用法场景描述对 + 能造一句新例句
- `rating_3_good`：表达正确，场景对，没造新例
- `rating_2_hard`：表达正确但场景模糊，OR 场景对但表达不地道
- `rating_1_again`：表达不会用或用错场景

## 沉浸 / 复习子命令

- 用户说「沉浸 on / off」→ `lt immersion on` 或 `lt immersion off`
- 用户说「复习 / 看一下今天有什么」→ 改走 `/lt-review` skill
- 用户说「我学到哪了」→ `lt stats` 直接展示

## 不要做的事

- 不要自己编题（必须 `lt next`）
- 不要给 rating 时加注释或合并 rubric（必须正好引用一行）
- 不要写 `--source` 之外的 enum（manual / stop-hook / post-tool / cron / review）
- 不要超过 250 tokens 输出（prompt_max_tokens 上限）
