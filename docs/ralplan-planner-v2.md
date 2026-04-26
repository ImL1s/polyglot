# jp-trainer → polyglot RALPLAN-DR — Planner v2

> Date: 2026-04-27
> Mode: **DELIBERATE** (high-risk dev-first tool + 新增 3 项重大需求：TTS / 讲解 / 多语言)
> Scope: 在 v1 + Architect v1 5 adjustments 基础上 fold-in 三项新需求
> 前置：`docs/ralplan-planner-v1.md` + `docs/ralplan-architect-v1.md` + 已实现代码 src/{cli,db,srs,concepts,profile,seeds,paths,work-hours}.ts
> Owner: Planner phase（不写代码，只规划）

---

## 0. v2 增量摘要（一段）

v1 + Architect 共识架构正确（CLI 引擎 + Skills + Hooks + SQLite single-source-of-truth），需 5 adjustments（A schema-aware install / B honest cross-tool / C 数据完整性事务化 / D shell pre-gate / E rubric-anchored 评分）。**v2 在此基础上 fold-in**：(1) TTS 发话（macOS `say` 默认 + 多 backend 抽象）(2) 讲解（rating ≤ 2 自动 verbose + `/lt explain <id>` 命令）(3) 多语言（schema 加 `language` 字段 + per-language level 体系 + active_language 隔离 FSRS 排期）。**项目重命名为 polyglot / lt CLI**，`jp` 保留为 alias 直到 v0.2.0。所有 v2 改动是**增量 patch**：profile.ts 加字段不重写、db.ts 加 migration v2、cli.ts 重命名命令但保留 jp 兼容。**4 phase 串行**：1.0 基础（v1 任务 6-13）→ 1.1 多语言（D9-D12 + D17-D18）→ 1.2 TTS（D13-D15）→ 1.3 讲解（D16）。

---

## 1. Updated Principles（v1 5 条 + 修订 + 新增）

1. **依附工作流不打断（v1，未变）**：训练寄生在 user 已有间隙；Stop hook 限流 + DND 是硬保险。
2. **错题本 = 单一真相，但「自动注入」只有 Claude Code（v1 Adjustment B 修订）**：`reviews.db` 跨 tool 共享读写，但只有 Claude Code 有 hook 自动塞题；Codex/Gemini 走 manual `/lt`。多语言下 db 仍是单一文件，按 `language` 字段过滤（D11-B）。
3. **CLI 是核心引擎，LLM 是渲染 + 评分层但评分要 rubric-anchored（v1 + Adjustment E 修订）**：LLM 出题/评分必须按 skill prompt 里的 rubric 给 rating 1-4；rubric 文档化、版本化。多语言下 rubric 按 `(language, type)` 二维查表。
4. **概率触发 + 工作时间感知 + 限流（v1 + Adjustment F 修订）**：profile 加 `inject_max_per_hour=3` / `inject_max_per_session=10` / `do_not_disturb_until` 硬上限。
5. **失败安全 + 可一键关闭 + 可观测（v1 + Adjustment C 修订）**：所有 hook silent fail（exit 0），但**必须**记录 NDJSON 到 `~/.config/polyglot/logs/lt.log`；`lt logs --hook stop` 可查；`lt uninstall-hooks` 一键卸载。
6. **【v2 新增】跨语言可扩展但单 active**：profile.active_language 控制当下学哪门；切换零成本（一行 `lt config active_language=ko`）；FSRS 排期按 active_language 隔离不混（D11-B），跨语言 stats 是聚合视图不是同一队列。
7. **【v2 新增】TTS 多 backend 抽象 + 默认零依赖**：默认 macOS `say`（内置全语言），profile 可切 `tts_engine=edge|elevenlabs`；Linux/Windows fallback 到 `edge-tts` 或纯静默（不挂掉）。
8. **【v2 新增】讲解是 second-pass 教学不是 first-pass 评分**：rating ≤ 2 自动 verbose feedback（写入 `attempts.llm_feedback`），`/lt explain <id>` 显式命令拉历史 + concept + 出 5 段教学。讲解 token 预算硬上限避免爆 context window。

---

## 2. Updated Decision Drivers（top 4）

1. **零摩擦（v1，最高）**：Stop hook 烦人 = 项目失败；多语言切换增加摩擦也算违反；TTS 阻塞性播放（用户在打 commit 时被吵）也算违反。
2. **Cross-tool 一致性（v1）**：reviews.db 仍是 single source；语言字段不能让 Codex 看不到 Claude 的进度。
3. **跨语言可扩展性（v2 新增）**：schema/CLI/skill prompt 必须能加韩/英/西/中而不重写。`jp-` 前缀消失改成 `lt-`/`polyglot-`。
4. **目标语言通过率（v1 driver 3 泛化）**：原 N2 通过率 → 任意 active_language 的目标 level（N2 / TOPIK 6 / CEFR C1 / HSK 6 / DELE B2 等）。题库覆盖 + FSRS 间隔 + rubric 校准三者决定。

> 次优 driver（ties 时）：可调试性（NDJSON log）> 安装鲁棒性（多 schema settings.json + 多 OS）> 性能（hook 冷启动 < 50ms）。

---

## 3. D1-D8 沿用结论（一段引用）

**D1（题库形态）→ C 混合（concept 静态 + 题面 LLM）已实现**。**D2（inject_rate）→ 0.10 默认（Architect Q3 推荐）+ 限流 inject_max_per_hour=3**。**D3（UserPromptSubmit 三职责）→ B 合 1 dispatch**。**D4（种子量级）→ 3000 双 phase（jonchang 2400 vocab + LLM 100-150 grammar）**。**D5（install）→ Adjustment A schema-aware node script**。**D6（沉浸 + 代码白名单）→ B 启发式正则**。**D7（WAL + busy_timeout=5000 + 事务 recordAnswer）→ Adjustment C 落地**。**D8（N2 语法来源）→ C LLM 一次性生成 + user 抽样 review**。Architect 5 adjustments（A-E）+ 可选 F profile 字段补全**全部纳入 v2 任务**，不再重新决策。

---

## 4. New Decisions D9-D18（each ≥2 options + tradeoffs + 推荐 + alternative invalidation）

### D9. 项目重命名策略

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| A. `jp-trainer` 保留为日语版，多语言用单独 repo `lang-trainer` | 不动现有代码、风险最低 | 重复实现 SRS/CLI/hook、两个 db 不互通、用户切语言切 repo | 否 |
| **B. 重命名为 `polyglot`（项目名）+ `lt` CLI（lang-trainer 缩写）+ `jp` alias 兼容到 v0.2.0** | 一次性痛、品牌干净、jp alias 给现有用户过渡期 | 改文档/install/skill 名字、用户重装 hook | **是** |
| C. `jp-trainer` 保留为伞 + CLI `jp` 是 `lt` 的 alias | 不打破任何东西 | 名字误导（jp 暗示日语）、品牌混乱 | 否 |

**推荐 B**。具体执行：
- 项目目录 `jp-trainer` 不强制改名（git 历史保留），**package.json `name` 改 `polyglot`**
- 编译 binary 名 `lt`（2 字母最快敲）+ install.sh 同时创建 `jp` symlink → `lt`，输出 deprecation banner（`[deprecated] 'jp' will be removed in v0.2.0, please use 'lt'`）
- skill 名 `/lt` `/lt-setup` `/lt-review`，旧 `/jp` skill 在 v0.1.x 期保留 stub 转发
- 文档/README 全改 polyglot/lt
- v0.2.0 移除 jp alias

**Alternative invalidation**：A 重复实现违反 driver 3（跨语言可扩展），需要维护两套；C `jp` 字面意思是日语，用户学韩语时 `jp answer` 命令名误导认知，违反 driver 3 + 1（每次记忆切换 = 摩擦）。

### D10. CLI 名字（D9 选 B 后的二级决策）

候选：
- **`lt`（language trainer）**：2 字母最快敲、namespace 不与已知 CLI 冲突（实测 `which lt` 空）
- `lang`：4 字母语义清晰但 `lang` 是某些 shell 内置环境变量名（`LANG=zh_CN.UTF-8`）容易混淆
- `polyglot`：8 字母太长，hook 调用频繁敲死手

**推荐 `lt`**。`/lt` skill 命令同样 2 字符。

**Alternative invalidation**：`lang` 与 `LANG` env var 重名风险（`echo $LANG` vs `lang stats`）；`polyglot` 8 字母在 hook shell wrapper 里多打 6 字符 × 100 调用/天 = 摩擦。

### D11. 多语言数据模型

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| A. 单 SQLite + concepts 加 `language` 字段 + FSRS 跨语言混排（一题日一题韩轮） | 多样性最强 | rating 跨语言 calibration 失败（你日语 N3 + 韩语 TOPIK 1 难度天差地远） + 用户认知负担大（一秒切大脑语言） | 否 |
| **B. 单 SQLite + concepts 加 `language` 字段 + FSRS 按 `active_language` 隔离（一次只学一种）** | schema 简单单文件好备份 / 切语言一行 config / cross-language stats 是聚合 view 容易做 / 与 v1 single-source 原则一致 | active_language 切换时 hook 注入要带语言上下文（D17） | **是** |
| C. 多 SQLite per language（reviews-ja.db / reviews-ko.db） | 完全隔离最干净 | 跨语言 stats 要合并多文件、备份脚本复杂、d11-b 已经够干净不必再分 | 否 |

**推荐 B**。schema migration v2：
```sql
ALTER TABLE concepts ADD COLUMN language TEXT NOT NULL DEFAULT 'ja';
CREATE INDEX idx_concepts_language_level_type ON concepts(language, level, type);
-- reviews 表通过 concept_id 间接绑定 language；查询统一加 JOIN concepts 过滤
-- attempts 表同理
```
所有 `getNextDue / dueCount / getStats / listDueConcepts` 加 `language = profile.active_language` 过滤；现有 N3-N2 数据 default `language='ja'` 自动归位。

**Alternative invalidation**：A FSRS 难度信号跨语言不可比、用户大脑切换成本高；C 文件碎片化违反 single source 原则。

### D12. Level 体系

各语言考试体系不同：

| Language | Levels | 来源 |
|---|---|---|
| ja (Japanese) | N5 / N4 / N3 / N2 / N1（已有） | JLPT |
| ko (Korean) | TOPIK1 / TOPIK2 / TOPIK3 / TOPIK4 / TOPIK5 / TOPIK6 | TOPIK |
| en (English) | A1 / A2 / B1 / B2 / C1 / C2 | CEFR |
| zh (Chinese) | HSK1 / HSK2 / HSK3 / HSK4 / HSK5 / HSK6（HSK 9 暂不支持） | HSK |
| es (Spanish) | A1 / A2 / B1 / B2 / C1 / C2 | DELE / CEFR |

**选项**：
- A. profile.level 继续是 `JlptLevel` 枚举写死 → 多语言不可行
- **B. profile.level 改 `string`，profile 加 `language: string`；CLI 内部维护 `LEVEL_RANK_BY_LANG` 映射表**
- C. profile 嵌套 per-language `progress: { ja: {level, target}, ko: {...} }` → 切语言不丢进度

**推荐 B + C 组合**：
```typescript
interface Profile {
  version: 2;                                  // bumped
  active_language: 'ja' | 'ko' | 'en' | 'zh' | 'es';
  per_language: Record<string, {
    level: string;       // 'N3' | 'TOPIK3' | 'B1' | 'HSK4' | 'A2'...
    target: string;
    weak_areas: string[];
    daily_new_count: number;
  }>;
  // 全局字段不变：work_hours / inject_rate / cn_probe_rate / ...
}

// LEVEL_RANK_BY_LANG 在代码侧维护
const LEVEL_RANKS: Record<Language, Record<string, number>> = {
  ja: { N5:1, N4:2, N3:3, N2:4, N1:5 },
  ko: { TOPIK1:1, TOPIK2:2, TOPIK3:3, TOPIK4:4, TOPIK5:5, TOPIK6:6 },
  en: { A1:1, A2:2, B1:3, B2:4, C1:5, C2:6 },
  zh: { HSK1:1, HSK2:2, HSK3:3, HSK4:4, HSK5:5, HSK6:6 },
  es: { A1:1, A2:2, B1:3, B2:4, C1:5, C2:6 },
};

function levelsInLearningRange(p: Profile): string[] {
  const lang = p.active_language;
  const ranks = LEVEL_RANKS[lang];
  const cur = p.per_language[lang];
  // ... reuse v1 logic but lang-scoped
}
```

**migration**: 老 profile 自动转换（v1: `{level: 'N3', target: 'N2'}` → v2: `{active_language: 'ja', per_language: {ja: {level: 'N3', target: 'N2', ...}}}`）。

**Alternative invalidation**：A 写死违反 driver 3；纯 B（不带 per_language nested）切语言会丢进度（用户切回韩语想起之前学到 TOPIK3 但 profile 已被覆盖）。

### D13. TTS 引擎选型

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| **A. macOS `say`（默认）** | 零依赖、内置全 5 语言（Kyoko ja / Yuna ko / Samantha en / Tingting zh / Mónica es）、命令简洁 `say -v Kyoko -r 180 "..."` 或 `say -o file.aiff` 落盘 | 声音机械、Linux/Windows 不支持 | **是（默认）** |
| B. edge-tts（Microsoft Neural TTS） | 声音自然 + 跨平台（python `pip install edge-tts`）+ 免费 | 需 python + 网络、首次安装阻力 | 是（备选） |
| C. ElevenLabs / OpenAI TTS API | 最好声音 | 付费 + API key 配置 + token 成本 | 否（v0.1.x 不做） |
| D. 多 backend abstraction（profile.tts_engine） | 用户自由 + 跨平台兼容 | 多代码路径 | **是（架构层面）** |

**推荐 A + D 组合**：默认 `tts_engine=macos`；profile 可切 `edge` / `none`；`none` 时 `lt say` 静默 exit 0（不报错），所有依赖 TTS 的 hook 自动跳过 TTS 段但仍出题。

**实现要点**：
- `src/tts.ts` 新文件：`speak(text, language, opts)` dispatch 到 backend
- `LANG_TO_VOICE` 映射：`ja→Kyoko, ko→Yuna, en→Samantha, zh→Tingting, es→Mónica`（macOS）
- macOS backend：`Bun.spawn(['say', '-v', voice, '-r', String(rate), text])`，**默认非阻塞 fire-and-forget**；`--blocking` 选项给测试用
- edge-tts backend：`Bun.spawn(['edge-tts', '--voice', voiceName, '--text', text])`，python 不存在则降级
- 失败 silent skip（与 hook silent-fail 原则一致）

**Alternative invalidation**：纯 B 跨平台但首次装 python 阻力大；纯 C 付费违反「个人工具」定位；不做 D 抽象将来切换困难。

### D14. TTS 触发集成

哪些时机自动念，哪些命令显式：

| 触发点 | 默认 on/off | 念什么 | 阻塞？ |
|---|---|---|---|
| 答题对（rating ≥ 3）后自动念正确读法 + 例句 1 | on | concept.ja + reading + examples[0].ja | 非阻塞（fire-and-forget） |
| 答题错（rating ≤ 2）后只念正确读法 + 慢速重复 1 次 | on | concept.ja 慢速 rate=140 | 非阻塞 |
| `/lt listen`（独立听力模式） | 显式命令 | concept.ja + examples，**不显示文字**直到用户答 | 阻塞（同步等播完） |
| Stop hook 注入题面时附音频 cue | off（默认） | 概率 0.3 念例句一遍 | 非阻塞 |
| `/lt say <id>` / `lt say --text "..."` | 显式命令 | 任意 | 阻塞 |

**推荐选 A + B + C + E 全部组合，但每个 profile 可单独关**：
```yaml
tts_on_answer_correct: true
tts_on_answer_wrong: true
tts_on_stop_hook: false  # 先关，避免炸耳朵
tts_listen_mode: true    # /lt listen 永远 on
```

**Alternative invalidation**：单选 A（嵌入答题流）则 N2 听力训练量不够；单选 C（独立命令）则用户主动度不够依附原则违反；全 on 默认会吵到关掉，所以默认有些 off。

### D15. 听力题型设计

新增题型还是复用？

| 选项 | 实现 | 推荐？ |
|---|---|---|
| A. 新增 `concepts.type='listening'` | 单独 seed 文件、独立题库 | 否（题库工作量翻倍） |
| **B. 现有 vocab/grammar 加 `audio_drill: true` flag**（其实不需要 schema 字段，运行时由 skill 决定题型） | skill prompt 里随机抽 30% 已有 concept 走「只听音 → 用户写假名 → 比对 reading 字段」 | **是** |
| C. profile 开关 `listening_drill_rate=0.3` | 全局比例控制 | 是（叠加到 B） |

**推荐 B + C**：复用现有 concept，skill 出题时按 `listening_drill_rate` 概率走「听力 drill」题型：
- 题面：`<TTS 念 concept.ja>` 不显示文字
- 用户答：写假名 / 中文翻译 / 听写汉字
- 评分：用户答 vs `concept.reading`（假名匹配）/ `concept.zh`（语义匹配）
- 评分仍用 rating 1-4 rubric（D11 rubric anchor），**听力 drill 评 rating 时把 reading mismatch 当 rating 2 起跳**

**Alternative invalidation**：A 题库工作量翻倍且 N2 听力题型千变万化（短对话/长独白/快读）静态 seed 覆盖不到；B 复用 concept 加题型变化对齐 D1 混合模式。

### D16. 讲解机制

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| **A. `/lt explain <concept_id>` 独立命令 → 拉 concept + attempts 历史 → LLM 现场出 5 段讲解（词源/近义对比/语法变形/典型错误/JLPT 出题套路）** | 显式触发零摩擦、用户想深入时一行 | 需要写 skill prompt 模板 | **是** |
| **B. rating ≤ 2 自动 verbose（LLM feedback 字数从 1 句扩到 5-10 倍）写入 `attempts.llm_feedback`** | 答错时正好需要、零额外操作 | LLM token 翻倍 | **是（叠加 A）** |
| C. 用户后续 prompt 检测「讲解 / 再展开 / why」 → hook 注入扩展指令 | 自然语言触发零学习成本 | 误判率高（用户可能在讨论代码 why） | 否 |
| D. 讲解结果缓存到 `attempts.llm_feedback` 供未来复习引用 | 历史可查 | schema 已支持 | **是（叠加 A+B）** |

**推荐 A + B + D 组合**，C 暂不做（误判风险高）：
- A：`lt explain <id> --json` CLI 命令拉 concept + 该 concept 最近 5 次 attempts → 输出 JSON 给 LLM；skill `/lt explain` 调它，LLM 按模板出 5 段教学
- B：skill prompt 里 rating ≤ 2 时附加 `verbose=true` flag，instruction 让 LLM 输出 5-10 倍详情
- D：所有讲解结果（A + B）写 `attempts.llm_feedback`，下次同 concept 来时 LLM 可读历史避免重复
- **token 预算硬上限**：单次讲解 input 含 history 不超 3K token、output 不超 2K token（skill prompt 里硬约束「≤ 1500 字」）

**Alternative invalidation**：纯 B 没显式入口，用户想深入但当下 rating=3 的 concept 无法触发；纯 A 无自动触发，rating ≤ 2 当下用户最需要解释时反而不给；C 误判率太高（用户讨论代码 why 不想被注入日语讲解）。

### D17. Hook 在多语言下的策略

| 问题 | 决策 |
|---|---|
| Stop hook 抽题用 active_language 还是混合 | active_language only（D11-B 一致） |
| 沉浸模式注入语言 | profile.active_language（用日语沉浸 vs 用韩语沉浸） |
| 关键词反问的检测语言 | profile.active_language ↔ 用户母语（profile.native_language，默认 zh）单向反问 |
| `lt detect-cn` 命令 | 重命名 `lt detect-native --native zh|en|ja|...`（按用户母语） |
| TTS 在 hook 里默认 | 默认 off（避免吵），用户显式开 `tts_on_stop_hook=true` |

**新增 profile 字段**：
```yaml
active_language: ja
native_language: zh    # 用于关键词反问 + 翻译练习方向
```

**Alternative invalidation**：混合多语言违反 D11-B；不带 native_language 假设所有用户都是中文母语会让英语母语用户用本工具学日语时反问检测全失效。

### D18. 已实现代码迁移路径（具体 patch list）

| 文件 | 行号 | 改动 | Why |
|---|---|---|---|
| `src/profile.ts` | 6-7 | `JlptLevel` 改 `Level = string`；`WeakArea` 保持 enum 但跨语言 | D12 |
| `src/profile.ts` | 9-25 | Profile 接口加 `active_language` / `native_language` / `per_language` / `inject_max_per_hour` / `inject_max_per_session` / `do_not_disturb_until` / `tts_engine` / `tts_voice_overrides` / `tts_on_*` 字段；`version: 1 → 2` | D11/D12/D13/D14/Adjustment F |
| `src/profile.ts` | 27-43 | DEFAULT_PROFILE 用 v2 schema（active_language='ja' 默认） | D11/D12 |
| `src/profile.ts` | 49-58 | `readProfile()` 加 v1→v2 自动 migration（{level, target} → per_language.ja.{level, target}） | D18（不重写） |
| `src/profile.ts` | 73-87 | `levelsInLearningRange` 改 lang-scoped（看 active_language 选 LEVEL_RANKS） | D12 |
| `src/db.ts` | 13-15 | 加 `PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL; PRAGMA wal_autocheckpoint = 1000;` | Architect Adjustment C |
| `src/db.ts` | 19-61 | migrate 加 schema v2: `ALTER TABLE concepts ADD COLUMN language TEXT NOT NULL DEFAULT 'ja'`（用 user_version pragma 区分 v1/v2） | D11 |
| `src/db.ts` | 63-99 | ConceptOut 加 `language` 字段 | D11 |
| `src/srs.ts` | 69-93 | `recordAnswer` 包 `db.transaction(() => {...})()` | Architect Adjustment C |
| `src/concepts.ts` | 10-40 | `getNextDue` SQL 加 `c.language = ?` 过滤 | D11 |
| `src/concepts.ts` | 73-93 | `pickNewConcept` 同样加 `c.language = ?` 过滤 | D11 |
| `src/concepts.ts` | 95-101 | `dueCount` SQL 加 JOIN concepts 过滤 language | D11 |
| `src/concepts.ts` | 103-135 | `getStats` 加 `--all-languages` 选项 vs 默认 active；新加 `getStatsAllLanguages()` 给 cross-language 聚合 view | D11 |
| `src/cli.ts` | 14-18 | program.name 改 `lt`、`description` 改 polyglot、保留 `jp` symlink 由 install.sh 创建 | D9/D10 |
| `src/cli.ts` | 213-227 | `detect-cn` 重命名 `detect-native`，参数 `--native <lang>` | D17 |
| `src/cli.ts` | 全文件 | 新增命令 `say` / `explain` / `listen` / `dnd` / `logs` / `uninstall-hooks` / `mock-test` | D13/D14/D16/Adjustment C+F+E |
| **新增** `src/tts.ts` | - | TTS abstraction + macOS/edge backend | D13 |
| **新增** `src/explain.ts` | - | 拉 concept + 历史 attempts → JSON for LLM 讲解 | D16 |
| **新增** `src/lang.ts` | - | LEVEL_RANKS + LANG_TO_VOICE + active_language helper | D12/D13 |
| **新增** `src/logs.ts` | - | NDJSON write/read 工具 + `lt logs --tail --hook --event` 实现 | Adjustment C |
| **新增** `data/seeds/ko/`, `en/`, `zh/`, `es/` 子目录 | - | 多语言 seeds（Phase 1.1 至少 ko 一门， N2 主线不动） | D11/D12 |
| `tests/` | - | 全面增 lang-scoped 测试 + TTS mock 测试 + explain 测试 | T 5 |

**关键约束**：所有 v2 改动是 ALTER TABLE / interface 加字段 / 新文件 / 命令重命名带 alias，**不删除已有代码或表**。任务 1-5 已实施代码 100% 保留。

---

## 5. Updated Pre-mortem（5 scenarios，扩 v1 3 + v2 新增 2）

### Scenario 1: Stop hook 烦人到关闭（v1，likelihood=H, impact=H，未变）

参见 v1 §4.1 + Adjustment D shell pre-gate + Adjustment F 限流字段。**v2 增量**：TTS 默认在 stop hook off（避免吵到关），`tts_on_stop_hook` 默认 false。

### Scenario 2: Cross-tool 写冲突丢数据（v1，likelihood=L, impact=H，已 Adjustment C 解决）

参见 v1 §4.2 + Adjustment C transaction wrap + busy_timeout=5000 + 每日 backup。

### Scenario 3: 设计复杂用户跑不起来（v1，likelihood=M, impact=M，已 v1 §4.3 解决）

参见 v1 §4.3。**v2 增量**：install.sh 多一步检测 macOS `say` 是否可用（必然有，但 future Linux fallback 用 edge-tts 检测 + python）；rename 期间 `jp` alias 必须工作否则现有用户晋升 v0.1.x 时全断。

### Scenario 4：【v2 新增】TTS 在 Linux/CI 没 say 命令所有 hook 哑火（likelihood=M, impact=M）

**症状**：用户从 macOS 切到 Linux 工作机，所有依赖 TTS 的 hook/skill 报错或卡住。
**根因**：
- `Bun.spawn(['say', ...])` Linux 上 ENOENT
- TTS hook 不 silent fail 导致整个 hook 退出非 0 → Claude Code 视为 hook 失败
- 用户看不到任何提示，只觉得「日语训练失效了」

**Mitigation**：
1. `src/tts.ts:speak()` 内 try-catch，spawn 失败 silent skip + log NDJSON `{event:"tts_skip", reason:"command not found"}`
2. install.sh 检测 platform：macOS 时 `say -v Kyoko 测试` 跑一遍验证；Linux 时 prompt user 安装 `pip install edge-tts` 或 `tts_engine=none`
3. `lt doctor` 命令打印当前 TTS backend + 各语言 voice 是否可用 + 跑一段 1 秒测试
4. profile 默认 platform-aware：macOS → `say`，Linux → `none`（用户显式开 edge）

### Scenario 5：【v2 新增】多语言切换 + 讲解 token 预算导致 context window 爆 + active_language 状态不同步（likelihood=M, impact=M）

**症状**：
- A 用户 `/lt explain <id>` 时拉了 5 个 attempts 历史 + concept + 跨语言 stats，Claude context 已满，回答被截断或失去上文
- B 用户改了 `active_language=ko` 但 hook 缓存 profile 5 分钟没刷新，Stop hook 仍出日语题
- C 沉浸模式 flag 文件没区分语言（v1 实现 immersion.flag 单文件），切语言后沉浸语言混乱

**Mitigation**：
1. **token 预算硬上限**：`lt explain <id> --json` 输出 attempts 限 5 条 + 每条 user_answer 截 200 字 + llm_feedback 截 500 字。skill prompt 里硬约束「output ≤ 1500 字」
2. **profile 不缓存**：所有 hook 每次 spawn 时重新 readFileSync(profile.yaml)（YAML 解析 1ms 可忽略），不做 5 分钟缓存
3. **沉浸 flag 改 per-language**：`~/.config/polyglot/state/immersion-{ja|ko|en|...}.flag`；`lt immersion on` 默认作用于 active_language；`lt immersion on --language ko` 显式
4. **active_language 切换原子**：`lt config active_language=ko` 内部 transaction：写 profile + 切 immersion flag + log NDJSON `{event:"language_switched"}`
5. **lt doctor**: 检测 active_language vs immersion flag 是否一致

---

## 6. Updated Test Plan

### 6.1 Unit（v1 + 新增）

新增（除 v1 §5.1 之外）：

| 测试 | 文件 | 关键 case |
|---|---|---|
| `tests/lang.test.ts` | LEVEL_RANKS 完整性、levelsInLearningRange 跨语言隔离、LANG_TO_VOICE 全 5 门 | D12 |
| `tests/profile-migration.test.ts` | v1 schema → v2 自动 migration、不丢数据 | D18 |
| `tests/tts.test.ts` | mock spawn → 验证 macOS / edge / none 三 backend dispatch、silent skip on ENOENT、language → voice 映射 | D13 |
| `tests/explain.test.ts` | 拉 concept + 5 attempts → JSON 不超 token 预算（粗算字符 < 8K） | D16 |
| `tests/multi-language-due.test.ts` | concepts 表混 ja/ko 数据、active_language=ja 时 getNextDue 不返回 ko 的、切 active_language 立即生效 | D11 |
| `tests/recordAnswer-transaction.test.ts` | mock 中途抛错 → 验证 reviews + attempts 都 rollback | Adjustment C |
| `tests/hooks-shell-pre-gate.test.ts` | bash 测试 hooks/stop.sh 在 rate=0 时不 spawn bun（time 命令验证 < 10ms） | Adjustment D |

**目标覆盖率**：CLI + lang/tts/explain 核心路径 90%+。

### 6.2 Integration（v1 + 新增）

| 测试 | 流程 |
|---|---|
| stop-hook full path（v1） | hook → CLI → JSON 含 concept |
| stop-hook with active_language=ko | 切韩语后 hook 拿到 ko concept | D11 |
| concurrent answer cross-language | 3 个并发 spawn `lt answer`（含跨语言混合） → db row 完整 | Adjustment C |
| /lt explain → token 预算 | 抽 concept + 历史 → `lt explain <id> --json` 输出 < 8000 chars | D16 |
| /lt say + listen mode | TTS 命令产生有效 audio output（macOS 落盘到 /tmp/lt-test.aiff 验证 size > 0） | D13 |
| install with mixed schema settings.json | 用户已有 flat-form Stop hook + nested-form UserPromptSubmit → install 检测 + 正确合并 | Adjustment A |
| jp → lt alias 兼容 | `jp next` 等价 `lt next` 输出，但 stderr 含 deprecation banner | D9 |

### 6.3 E2E（手动 + 自动）

**手动 E2E（README）**：
1. `bash install.sh` → 装 lt + jp alias
2. Claude Code 新会话 `/lt-setup` → 选语言（默认 ja）→ 答 6 问 → profile.v2 写入
3. `/lt` → Claude 出 N3 vocab 题 → 答错 rating=2 → 自动 verbose 讲解（D16-B）
4. `/lt explain <id>` → 5 段教学输出
5. `/lt listen` → 只听音不显示文字 → 用户写假名 → 评分（D15）
6. `lt config active_language=ko` → `/lt` 出韩语题（**前提**：phase 1.1 已落韩语 seeds）
7. `lt stats --all-languages` → 看跨语言聚合
8. 切 Codex 跑 `lt stats` → 同样数据

**自动 E2E**：`scripts/e2e.sh` 跑 1-7 步（不走 LLM 部分）+ 校验 db state。

### 6.4 Observability（v1 + 新增 v2 事件）

NDJSON 事件类型扩充：

```jsonc
{"ts":"...", "event":"language_switched", "from":"ja", "to":"ko"}
{"ts":"...", "event":"tts_invoked", "engine":"macos", "voice":"Kyoko", "text_len":42, "duration_ms":850}
{"ts":"...", "event":"tts_skip", "reason":"command not found", "engine":"edge"}
{"ts":"...", "event":"explain_called", "concept_id":"...", "attempts_count":5, "input_chars":3200, "output_chars":1450}
{"ts":"...", "event":"hook_silent_fail", "hook":"stop", "reason":"db locked after 3 retries"}
{"ts":"...", "event":"inject_throttled", "hook":"stop", "reason":"per_hour_max", "current_count":3}
```

`lt logs --tail 50 --event tts_invoked` / `lt logs --hook stop --since 1h`。

### 6.5 Mock 测验（v1 Architect Risk #7 mitigation）

`/lt mock-test`（v2 改名 from `/jp mock-n2`，target 自适应）：
- 拉 30 题 hold-out pool（`data/seeds/{lang}/mock-pool.yaml` 排除在 default seed-import）
- 形式贴近真实考试（JLPT N2 / TOPIK 6 / CEFR C1 等）
- 完成后 `lt mock-test --report` 输出预测分数 + 弱项分析
- Phase 1.1 落 ja 一门 mock（200 题 hold-out），phase 1.4 扩其他

---

## 7. 任务重排 + 新增任务（13 → 22）

**任务 1-5 已完成（不动）**。**任务 14-22 是 v2 新增**：

| Task | 内容 | Phase | 优先级 | 依赖 |
|---|---|---|---|---|
| 5.5 (NEW) | 数据完整性 hardening：recordAnswer 事务化 + db.ts pragmas | 1.0 | P0 | 任务 5 |
| 6 | 种子题库 import（v1 任务，N2 主线 ja） | 1.0 | P0 | 5.5 |
| 7 | 5 个 skill markdown（v1 任务，含 rubric Adjustment E）+ **`/lt-setup` 改 v2 多语言 onboarding** | 1.0 | P0 | 6 |
| 8 | 3 个 hook 脚本（v1 任务，含 Adjustment D shell pre-gate + Adjustment F profile 字段使用） | 1.0 | P0 | 6, 7 |
| 9 | 沉浸模式 + 关键词反问接线（v1 任务） | 1.0 | P1 | 8 |
| 10 | launchd plist 模板（v1 任务） | 1.0 | P2 | 8 |
| 11 | Codex/Gemini snippet（v1 任务，含 Adjustment B honest framing） | 1.0 | P1 | 7 |
| 12 | install.sh + bun build（v1 任务，含 Adjustment A schema-aware） | 1.0 | P0 | 6-11 |
| 13 | README + e2e demo（v1 任务） | 1.0 | P0 | 12 |
| **14 (NEW)** | **项目重命名 polyglot/lt + jp alias 过渡**（D9/D10）：package.json + binary name + skill 名 + symlink + deprecation banner | 1.0（与 12 并入） | P0 | 12 |
| **15 (NEW)** | **多语言 schema migration + lang.ts**（D11/D12/D18）：profile v1→v2 migration、db user_version v1→v2、LEVEL_RANKS 表、levelsInLearningRange 改 lang-scoped、所有 SQL 加 language 过滤 | 1.1 | P0 | 13 |
| **16 (NEW)** | **多语言 seeds（韩语 TOPIK 优先）**：jonchang 韩语 1500 词 + LLM 生成 TOPIK grammar 80 条 + reading 字段对韩语必填（hangul 无假名但保留 reading 用于 romanization 可选） | 1.1 | P1 | 15 |
| **17 (NEW)** | **多语言 hook 适配**（D17）：UserPromptSubmit 注入沉浸 prompt 带 active_language 标识、`lt detect-native --native zh|en|ja` 重命名、Stop hook 依然 active_language only | 1.1 | P1 | 15 |
| **18 (NEW)** | **TTS abstraction + macOS backend**（D13/D14）：src/tts.ts、`lt say` 命令、profile.tts_engine + tts_voice_overrides + tts_on_* 字段、答题流嵌入 TTS 自动念 | 1.2 | P1 | 15 |
| **19 (NEW)** | **听力模式 `/lt listen`**（D15）：skill prompt 模板 + listening_drill_rate profile 字段 + reading 字段评分逻辑 | 1.2 | P1 | 18 |
| **20 (NEW)** | **讲解 `/lt explain` + verbose feedback**（D16）：src/explain.ts、`lt explain <id> --json` 命令、skill prompt 5 段教学模板、rating ≤ 2 自动 verbose 模式、token 预算硬约束 | 1.3 | P1 | 19 |
| **21 (NEW)** | **TTS edge-tts backend + Linux fallback**（D13）：edge-tts 安装检测、`lt doctor` 跨平台诊断 | 1.3 | P2 | 20 |
| **22 (NEW)** | **mock-test 模块**（Architect Risk #7）：mock pool seed + `/lt mock-test` 命令 + 报告生成 | 1.3 | P2 | 16 |

### 任务依赖图（v2）

```
[Phase 1.0 v1 + Adjustments]
Task 5.5 (data integrity) ─→ Task 6 (seeds) ─┬─→ Task 7 (skills + rubric)
                                              │     │
                                              └─→ Task 8 (hooks + shell pre-gate)
                                                    │
                                                    ├─→ Task 9 (immersion wire)
                                                    ├─→ Task 10 (cron)
                                                    └─→ Task 11 (codex/gemini)
                                                         │
                                                         └─→ Task 12 (install schema-aware)
                                                              │
                                                              └─→ Task 13 (README e2e)
                                                                   │
                                                                   └─→ Task 14 (rename polyglot/lt)
                                                                        │
[Phase 1.1 多语言]                                                       │
                                                                        ├─→ Task 15 (schema migration)
                                                                        │     │
                                                                        │     ├─→ Task 16 (ko seeds)
                                                                        │     └─→ Task 17 (multi-lang hooks)
                                                                        │
[Phase 1.2 TTS]                                                          │
                                                                        ├─→ Task 18 (TTS macOS)
                                                                        │     │
                                                                        │     └─→ Task 19 (listen mode)
                                                                        │
[Phase 1.3 讲解 + Linux + mock]                                          │
                                                                        └─→ Task 20 (explain)
                                                                              ├─→ Task 21 (edge-tts Linux)
                                                                              └─→ Task 22 (mock-test)
```

**总估时**：v1（18-26 小时）+ Task 14（2-3）+ Task 15（4-6 含 migration test）+ Task 16（4-6 含 LLM 韩语 seed review）+ Task 17（2-3）+ Task 18（3-4）+ Task 19（2-3）+ Task 20（3-4）+ Task 21（2-3）+ Task 22（2-3）= **42-61 小时 dev work**。

---

## 8. Phase 划分 + 推荐

| Phase | 范围 | 目标 | 准入 |
|---|---|---|---|
| **1.0** | Task 5.5-14（v1 完整 + 5 Adjustments + 项目重命名） | jp 单语言 + 5 个 hook + skill + cron + install + lt 改名 | bun test 全绿 + e2e ja N3-N2 跑通 + jp alias 工作 |
| **1.1** | Task 15-17 | profile v2 + 韩语第二门语言落地 + 多语言 hook 适配 | 切 active_language=ko 后 `/lt` 出 TOPIK 题 + cross-language stats 工作 |
| **1.2** | Task 18-19 | TTS macOS + listening mode | `/lt say` 念 ja/ko 都能听到声音 + `/lt listen` 题型工作 |
| **1.3** | Task 20-22 | 讲解 + Linux + mock-test | `/lt explain <id>` 5 段教学 + edge-tts Linux fallback + `/lt mock-test` 30 题 |

### 为什么 4 phase 而不是一次性？

**用户说"全都要"，但工程上必须 phase 排序**，理由：

1. **风险递降**：1.0 是 dogfood 阶段，单语言跑稳后再扩多语言；多语言跑稳后再加 TTS（依赖 multi-lang voice 映射）；TTS 跑稳后再加讲解（最不影响核心流的 enhancement）。**反过来**先做讲解发现 schema 不支持多语言要重写，浪费工作。
2. **学习反馈闭环**：1.0 落地后用户实测 1 周收集 inject_rate/throttle/rubric 数据，再进 1.1。如果 1.0 的 hook 烦人率超阈值，先调 1.0 再开新 phase。
3. **token 预算 / 维护负担**：每 phase 是一个可发布的 minor version（v0.1, v0.2, v0.3, v0.4），单 phase commit 范围可控、PR review 可控、回滚单位清晰。
4. **依赖正确性**：D11 多语言 schema 必须先于 D13 TTS（因为 LANG_TO_VOICE 映射依赖 active_language）；D15 listening 必须在 D13 之后（依赖 TTS spawn）；D16 讲解的 token 预算依赖多语言下 attempts 已落地（统计跨语言 attempts 历史）。

**推荐**：4 phase 顺序串行，每 phase 落地后 dogfood ≥ 3 天再开下 phase。

**Alternative invalidation（不分 phase）**：一次性写完后跑 e2e 失败时调试范围 = 整个 v2 而不是单 phase 模块，定位成本指数级；一次性 PR 也违反 dev process（v1 + Architect 都说 deliberate mode 必须可回滚单位）。

---

## 9. v2 风险清单（v1 风险 + 新增）

### v1 风险沿用

参见 v1 §7（Stop hook 烦人 / cross-tool 写冲突 / install 失败 / bun codesign / N2 语法 LLM 质量 / 题面随机性 / jonchang schema 变 / 沉浸 leak / FSRS 参数 / launchd 警告）。

### v2 新增

| Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|
| **R-V1：项目重命名引发现有用户 hook 全断** | M | H | jp → lt symlink 永远工作 + install.sh 检测旧 jp-trainer-hooks 目录自动迁移到 polyglot-hooks + deprecation banner 持续 6 个月 + CHANGELOG 红字醒目提示 | Task 14 |
| **R-V2：profile v1 → v2 migration 丢数据** | M | H | readProfile 自动转换 + 写 v2 前先 backup `profile.yaml.v1.bak.<ts>` + 单测覆盖各种 v1 残缺 schema（缺 weak_areas / 缺 daily_cron 等） | Task 15 |
| **R-V3：language 字段 default 'ja' 误标其他语言**（如 phase 1.1 落韩语 seeds 时遗漏 language='ko' field） | M | M | seed schema 加 `language` 必填 + import 时 grep `language:` 强制存在 + tests/seeds 跑 `SELECT DISTINCT language FROM concepts` 确认值集合 | Task 16 |
| **R-V4：TTS 在 hook 阻塞 Claude 回话** | L | H | tts.ts 默认 fire-and-forget（spawn 不 await）+ profile.tts_blocking_max_ms = 100 超时强 kill | Task 18 |
| **R-V5：edge-tts python 依赖在用户机器没装** | M | M | install.sh 检测 + 不在 macOS 上不要求；用户切到 Linux 时 `lt doctor` 报 + profile 默认 tts_engine=none on Linux | Task 21 |
| **R-V6：讲解 token 预算爆 context window** | M | M | explain.ts 硬截断 attempts ≤ 5 条 + 字段长度限制 + skill prompt 强制「output ≤ 1500 字」+ 单测验证 input chars < 8K | Task 20 |
| **R-V7：active_language 切换不同步**（hook 缓存 / immersion flag 旧文件 / db pragma 残留） | M | M | profile 不缓存（每次重读）+ immersion flag per-language + lt config active_language 命令是 transaction（写 profile + 切 flag + log） | Task 15/17 |
| **R-V8：N5/N4/N3 老 user 升级到 v2 后 active_language 丢失** | L | M | migrate v1→v2 时 active_language='ja' 默认 + per_language.ja 自动填 v1 level/target 字段；单测覆盖 | Task 15 |
| **R-V9：TTS 念错语言**（concept.language=ja 但 voice 选了 Yuna 韩语） | L | M | LANG_TO_VOICE 单一来源 + tts.ts 内部 assert(language === concept.language) + 单测覆盖 5 语言 | Task 18 |
| **R-V10：mock-test pool 被误导入到 default seed-import** | L | M | mock pool 文件 `data/seeds/{lang}/mock-pool.yaml` 文件名以 `mock-` 前缀 + seeds.ts 默认 skip 该前缀 + 单测覆盖 | Task 22 |

---

## 10. Updated ADR Draft（v2，待 Architect/Critic 共识后定稿）

### ADR-001（v2）：polyglot 整体架构

**Decision**: 在 v1 「CLI 引擎 + Skills + Hooks + SQLite single-source」基础上 fold-in：(1) 重命名 polyglot/lt 兼容 jp alias；(2) profile v2 schema 加 active_language + per_language + tts_* 字段；(3) concepts 表加 language 字段、FSRS 排期 lang-scoped；(4) macOS `say` 默认 TTS + edge-tts 备选 + multi-backend abstraction；(5) `/lt explain` 命令 + rating ≤ 2 自动 verbose feedback；(6) listening mode 复用 vocab/grammar concept 加题型变化；(7) 4 phase 串行落地。

**Drivers**:
1. 零摩擦
2. Cross-tool 一致性（reviews.db single source）
3. **跨语言可扩展性（v2 新增）**
4. 目标 level 通过率（v1 driver 3 泛化）

**Alternatives considered**:
- v1 已 invalidate：纯 LLM / 纯静态 / daemon / 覆盖 settings.json
- **v2 新 invalidate**：
  - **Anki + AnkiConnect MCP** → 拒（要求 Anki 启动违反 driver 1 + HTML rendering 杀 D1 混合优势）
  - **多 SQLite per language**（D11-C） → 拒（违反 single source + 备份脚本复杂）
  - **FSRS 跨语言混排**（D11-A） → 拒（rating calibration 跨语言不可比 + 用户大脑切换成本）
  - **`jp` 保留为伞 + lt alias**（D9-C） → 拒（品牌混乱）
  - **新 type=listening**（D15-A） → 拒（题库工作量翻倍）
  - **关键词触发讲解**（D16-C） → 拒（误判风险高）
  - **一次性落 v2**（不分 phase） → 拒（依赖正确性 + 回滚单位 + dogfood 闭环）

**Why chosen**:
- CLI 引擎保证离线确定性（review/stats/say/explain 不依赖 LLM）
- Skill + Hook 入口覆盖主动 + 被动训练
- SQLite WAL + busy_timeout + transaction（Adjustment C）解决 cross-process 写并发
- 题面 LLM 生成保留 D1 混合优势，rubric anchor（Adjustment E）保证 FSRS 信号
- 单 db + language 字段保留 single source 同时支持多语言
- macOS `say` 零依赖默认 + edge-tts 备选满足跨平台
- 多 backend abstraction 让 TTS 失败 silent skip 不挂掉 hook
- 讲解显式命令 + 自动 verbose 双触发覆盖主动 + 被动场景
- 4 phase 串行 dogfood 反馈闭环

**Consequences**:
- ✓ Bun 单二进制 + 5 语言 voice 映射
- ✓ 切语言一行 config，FSRS 排期不混
- ✓ 错题本删 ~/.config/polyglot 完全卸载
- ✓ 讲解 token 预算硬约束避免 context 爆
- ✓ jp alias 给现有用户 6 个月过渡期
- ✗ TTS 自动注入 hook 默认 off（避免吵到关），用户需显式开
- ✗ Linux 用户首次需装 edge-tts（pip）或接受 tts_engine=none
- ✗ 多语言 onboarding 比 v1 单语言长 2-3 步
- ✗ Phase 1.1+ 落地前用户只有日语
- ✗ macOS `say` 声音机械（v0.2 可加 elevenlabs）

**Follow-ups**:
- Phase 1.1：韩语 TOPIK 落地（先于英语，因东亚用户基数）
- Phase 1.2：TTS 答题流嵌入 + listen mode
- Phase 1.3：讲解 + Linux fallback + mock-test
- Phase 2.0：英/西/中扩展 + ElevenLabs/OpenAI TTS 付费 backend + 移动端 / iCloud 同步
- 持续：log 分析 + inject_rate / TTS / 讲解 token 预算调优 + rubric 校准

### ADR-002（v2 新增）：多语言 schema 决策

**Decision**: 单 SQLite + concepts.language 字段 + FSRS 按 active_language 隔离。
**Drivers**: cross-tool single source / FSRS rating calibration / 备份简单。
**Alternatives invalidated**: 多 db (碎片化) / FSRS 混排 (calibration 失败)。
**Consequences**: 切语言原子；cross-language stats 是聚合 view；profile.active_language 是单一开关。

### ADR-003（v2 新增）：TTS multi-backend abstraction

**Decision**: macOS `say` 默认 + edge-tts 备选 + tts_engine=none fallback；fire-and-forget 非阻塞。
**Drivers**: 零依赖默认 / 跨平台 / 失败 silent skip。
**Alternatives invalidated**: ElevenLabs (付费) / 单 backend 写死 (跨平台失败)。
**Consequences**: hook 嵌入 TTS 默认 off 避免吵；Linux 用户需显式装 edge 或接受静默。

### ADR-004（v2 新增）：讲解 token 预算

**Decision**: `/lt explain <id>` 拉 attempts ≤ 5 条截断 + skill prompt output ≤ 1500 字硬约束 + rating ≤ 2 自动 verbose 双触发。
**Drivers**: context window 不爆 / 答错时主动给详情 / 用户主动深入零摩擦。
**Alternatives invalidated**: 关键词触发 (误判) / 不限制 token (爆 window)。
**Consequences**: 讲解 input ≤ 8K char output ≤ 4K char；attempts.llm_feedback 缓存历史。

---

## 11. 下一步交接 + Open Questions

### 交接

1. Planner v2 输出本文件 → **Architect v2 review**（关注：D9 重命名风险 / D11 schema migration 正确性 / D13 TTS abstraction layer 设计 / D16 token 预算实施）
2. Architect v2 修订 → **Critic v2 review**（关注：4 phase 划分合理性 / 风险清单完整性 / pre-mortem v2 scenarios 实际性 / 与 v1 Architect 5 adjustments 是否冲突）
3. Critic 修订 → Executor 按 §7 任务表落地（Phase 1.0 → 1.1 → 1.2 → 1.3）
4. 每 phase 完工 dogfood ≥ 3 天 + log 分析 + 用户实测反馈才开下 phase

### Open Questions（v2 新增 + 留给后续）

> 已写入 `.omc/plans/open-questions.md`（如果 worktree 有 .omc）。本文件记录待 Architect / Critic / Executor 决议项：

- [ ] **韩语 reading 字段语义**：日语 reading=假名（汉字注音），韩语 hangul 已是表音文字 reading 不需要；schema 上 reading nullable 但韩语 seed 是否填 romanization？还是干脆韩语 concept reading=null？影响 D15 listening drill 评分逻辑（韩语听写直接对 ja 字段，日语对 reading 字段）
- [ ] **TTS rate 默认值**：macOS `say -r` 默认 ~180 wpm，N5 用户可能跟不上；profile 加 `tts_rate_per_language: { ja: 160, ko: 170, ...}` 还是单一 `tts_rate=180`？
- [ ] **讲解的 LLM model 偏好**：Claude Code 当前模型由 user 选；skill prompt 是否建议 explain 走 opus（深度）vs answer 评分走 sonnet（速度）？
- [ ] **mock-test pool 来源**：phase 1.4 各语言 200 题 hold-out，是 LLM 生成 + user review 还是抓取真题（license 问题）？
- [ ] **重命名 timeline**：jp alias 保留 6 个月（v0.1.0 → v0.2.0）合理还是 3 个月？取决于现有用户数（个人工具暂时只有 setsuna 一人）
- [ ] **edge-tts 离线缓存**：edge-tts 每次请求都要网络；是否在 ~/.config/polyglot/tts-cache/ 缓存常用 concept.ja 的 mp3，避免重复请求？影响 disk usage（500 concept × 50KB ≈ 25MB）
- [ ] **listen mode 评分严格度**：用户写假名时一个字错算 rating 几？bunpro 标准是「错 1 字 = rating 2，错 2+ = rating 1」是否照搬？
- [ ] **跨语言 stats 聚合 view 在 phase 1.1 还是 1.4**：phase 1.1 只有 ja + ko，cross-language stats view 价值低；phase 1.4 全语言再做？
- [ ] **D17 mother tongue 检测能否双向**：英语母语用户学日语时，沉浸模式是「英→日翻译」；中文母语用户学英语时是「中→英翻译」。一套代码能否参数化？

---

## 12. Final Checklist

- [x] Principles 更新（v1 5 + v2 新增 3 = 8 条）
- [x] Decision Drivers 更新（v1 3 + v2 新增 1 = 4 条）
- [x] D1-D8 沿用 v1 + Architect 结论引用
- [x] D9-D18 详细决策（每个 ≥2 选项 + tradeoffs + 推荐 + alternative invalidation）
- [x] Pre-mortem 5 scenarios（v1 3 + v2 新增 2）
- [x] Test plan 扩展（unit + integration + e2e + observability + mock-test）
- [x] 任务重排（v1 13 + v2 新增 9 = 22 任务，含 5.5 数据完整性）
- [x] Phase 划分（4 phase 串行 + 推荐 + alternative invalidation）
- [x] 风险清单（v1 + v2 新增 10 条）
- [x] ADR 草稿（ADR-001 v2 更新 + 新增 ADR-002/003/004）
- [x] 已实现代码迁移路径（D18 具体 patch list）
- [x] Open Questions 记录给 Architect / Critic
- [x] 不丢任何 v1 + Architect 5 adjustments 工作量
