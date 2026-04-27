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
6. **TTS 念读法**：rating ≥ 3 → `lt say <id> --full`（念 headword + 读音 + 例 1）；rating ≤ 2 → `lt say <id> --rate 140`（只念 headword 慢速一次）。fire-and-forget，profile.tts_engine=none 时整段 silent skip。**不要**加 `--blocking`，会让训练流卡住。
7. 简短反馈用户「下次复习时间：YYYY-MM-DD」（来自 lt answer 输出的 next_due_at）。

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

## 听力 drill（D15）

用户说「听力 / 听写 / listen / listening」→ 走听力流程（`lt next --type listening` 抽 vocab 题且 `reading != null`）：

1. 抽题：`lt next --type listening --json`。
2. **不要**显示 `concept.ja` 和 `concept.reading` 给用户。立刻 `lt say <id> --blocking`（同步播完再继续，不然用户没听到声音就要回答）。
3. 提示「请写假名（hiragana 或 katakana）」，等用户作答。
4. 评分：`lt grade-listening --concept-id <id> --user-answer "<用户输入>" --json`，CLI 返回 `{rating, rubric, normalized_user, normalized_expected, exact_match}`。**直接采用** CLI 给的 rating（不要自己改），rubric 也按 CLI 输出引用。
   - 评分规则（参考，CLI 内置）：完全匹配 → `rating_4_easy`；编辑距离 1 → `rating_2_hard`（D15 规定 mismatch 起跳 2）；空答案或距离 ≥ 2 → `rating_1_again`。
5. 回写：`lt answer --concept-id <id> --rating <r> --user-answer "<text>" --feedback "<rubric>" --source manual`。
6. 反馈用户：显示 `concept.ja`（汉字）+ `concept.reading`（标准读音）+ `concept.zh`（中文释义），让用户看到正确答案。

不需要走 step 6 的 TTS 自动念（因为 step 2 已经念过了）。

## 沉浸 / 复习子命令

- 用户说「沉浸 on / off」→ `lt immersion on` 或 `lt immersion off`
- 用户说「复习 / 看一下今天有什么」→ 改走 `/lt-review` skill
- 用户说「我学到哪了」→ `lt stats` 直接展示

## 答错自动讲解（rating ≤ 2）

回写 `lt answer` 之后，如果 rating ≤ 2，**立刻**为同一 concept 触发讲解：

1. 跑 `lt explain <concept_id>`，拿回 JSON（含 `concept` / `recent_attempts` / `stats`）。
2. 按下面 5 段模板出讲解（每段一行小标题 + 1-3 句解释，**总长 ≤ 1500 字**）：
   1. **词源 / 字源**：日语含汉字时拆字 + 词根；纯假名词写来源（汉字本字 / 外来语来源）
   2. **近义词对比**：同 level（如 N3）内意思相近的 1-2 词，列差异
   3. **语法变形**：动词列基本形 + ます形 + て形 + た形 + 否定；形容词列い/な + 否定 + 过去；其他词型给典型搭配
   4. **典型错误**：从 `recent_attempts` 中 `rating == 1` 的 `user_answer` 找 pattern，没数据就写「首次答错，留意 X」
   5. **JLPT/TOPIK 出题套路**：这个词在该 level 常考的 trap（汉字读音陷阱 / 近义混淆 / 助词搭配）
3. 输出后跑 `lt explain <concept_id> --cache "<5 段拼接成的纯文本，≤ 1500 字>"` 把讲解写进 `attempts.llm_feedback`，下次复习同 concept 时能拿到上一次的讲解上下文。

## 用户显式 `/lt explain <id>`

用户输入「/lt explain <id>」「讲一下 <id>」「展开 <id>」时，跳过抽题，直接走上面的 5 段流程（rating 阈值不再适用）。

## 讲解 token 预算（硬约束）

- input: `lt explain` 输出 JSON 已经截断到 ≤ 8000 字符（attempts ≤ 5 条 / user_answer ≤ 200 字 / llm_feedback ≤ 500 字）
- output: 你的 5 段讲解 ≤ 1500 字。超过就压缩，**不要**省段（5 段必须齐）。

## 不要做的事

- 不要自己编题（必须 `lt next`）
- 不要给 rating 时加注释或合并 rubric（必须正好引用一行）
- 不要写 `--source` 之外的 enum（manual / stop-hook / post-tool / cron / review）
- 不要超过 250 tokens 输出（prompt_max_tokens 上限），讲解段落例外（≤ 1500 字）
- 讲解时不要跳过 `lt explain --cache` 回写步骤（缓存断了下次复习就看不到上次讲解）
