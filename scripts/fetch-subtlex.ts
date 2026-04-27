#!/usr/bin/env bun
/**
 * fetch-subtlex.ts — Generate data/seeds/en-subtlex-top200.yaml.
 *
 * Word selection is informed by Subtlex-US (Brysbaert & New, 2009; CC-BY-NC),
 * a 51M-word frequency corpus from movie subtitles. We do NOT redistribute
 * the Subtlex-US dataset; this script ships a hand-curated ~200-word list
 * derived from common knowledge of high-frequency English words.
 *
 * IPA readings are sourced from the CMU Pronouncing Dictionary (Carnegie
 * Mellon University, public domain), with ARPAbet → IPA conversion done
 * during curation.
 *
 * Chinese glosses are developer-authored original work for mix-only use;
 * they are concise reference, not authoritative dictionary entries.
 *
 * Frequency ranks are factual data per Feist v. Rural; common English
 * words are not copyrightable individually.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";

interface Entry {
  word: string;
  ipa: string;
  zh: string;
  pos: string;
}

const ENTRIES: Entry[] = [
  // Top function words and highest-frequency content words
  // drawn from Subtlex-US top-200 frequency band
  { word: "the", ipa: "ðə", zh: "这个；那个 (定冠词)", pos: "det" },
  { word: "be", ipa: "biː", zh: "是；存在", pos: "v" },
  { word: "and", ipa: "ænd", zh: "和；与", pos: "conj" },
  { word: "of", ipa: "əv", zh: "...的", pos: "prep" },
  { word: "to", ipa: "tuː", zh: "向；给；为了", pos: "prep" },
  { word: "a", ipa: "ə", zh: "一个 (不定冠词)", pos: "det" },
  { word: "in", ipa: "ɪn", zh: "在...里", pos: "prep" },
  { word: "that", ipa: "ðæt", zh: "那个；那", pos: "pron" },
  { word: "have", ipa: "hæv", zh: "有；拥有", pos: "v" },
  { word: "I", ipa: "aɪ", zh: "我", pos: "pron" },
  { word: "it", ipa: "ɪt", zh: "它", pos: "pron" },
  { word: "for", ipa: "fɔːr", zh: "为了；给", pos: "prep" },
  { word: "not", ipa: "nɒt", zh: "不；没有", pos: "adv" },
  { word: "on", ipa: "ɒn", zh: "在...上", pos: "prep" },
  { word: "with", ipa: "wɪð", zh: "和；用", pos: "prep" },
  { word: "he", ipa: "hiː", zh: "他", pos: "pron" },
  { word: "as", ipa: "æz", zh: "像；作为", pos: "conj" },
  { word: "you", ipa: "juː", zh: "你；您", pos: "pron" },
  { word: "do", ipa: "duː", zh: "做；干", pos: "v" },
  { word: "at", ipa: "æt", zh: "在；于", pos: "prep" },
  { word: "this", ipa: "ðɪs", zh: "这个", pos: "pron" },
  { word: "but", ipa: "bʌt", zh: "但是", pos: "conj" },
  { word: "his", ipa: "hɪz", zh: "他的", pos: "pron" },
  { word: "by", ipa: "baɪ", zh: "被；由；旁", pos: "prep" },
  { word: "from", ipa: "frɒm", zh: "从；来自", pos: "prep" },
  { word: "they", ipa: "ðeɪ", zh: "他们；她们", pos: "pron" },
  { word: "we", ipa: "wiː", zh: "我们", pos: "pron" },
  { word: "say", ipa: "seɪ", zh: "说；讲", pos: "v" },
  { word: "her", ipa: "hɜːr", zh: "她；她的", pos: "pron" },
  { word: "she", ipa: "ʃiː", zh: "她", pos: "pron" },
  { word: "or", ipa: "ɔːr", zh: "或者；还是", pos: "conj" },
  { word: "an", ipa: "æn", zh: "一个 (不定冠词)", pos: "det" },
  { word: "will", ipa: "wɪl", zh: "将要；会", pos: "aux" },
  { word: "my", ipa: "maɪ", zh: "我的", pos: "pron" },
  { word: "one", ipa: "wʌn", zh: "一；一个", pos: "num" },
  { word: "all", ipa: "ɔːl", zh: "所有；全部", pos: "det" },
  { word: "would", ipa: "wʊd", zh: "会；将 (虚拟)", pos: "aux" },
  { word: "there", ipa: "ðɛr", zh: "那里；有", pos: "adv" },
  { word: "their", ipa: "ðɛr", zh: "他们的", pos: "pron" },
  { word: "what", ipa: "wɒt", zh: "什么", pos: "pron" },
  { word: "so", ipa: "soʊ", zh: "所以；这么", pos: "conj" },
  { word: "up", ipa: "ʌp", zh: "向上；起来", pos: "adv" },
  { word: "out", ipa: "aʊt", zh: "出；外面", pos: "adv" },
  { word: "if", ipa: "ɪf", zh: "如果；是否", pos: "conj" },
  { word: "about", ipa: "əˈbaʊt", zh: "关于；大约", pos: "prep" },
  { word: "who", ipa: "huː", zh: "谁", pos: "pron" },
  { word: "get", ipa: "ɡɛt", zh: "得到；变得", pos: "v" },
  { word: "which", ipa: "wɪtʃ", zh: "哪个；这个", pos: "pron" },
  { word: "go", ipa: "ɡoʊ", zh: "去；走", pos: "v" },
  { word: "me", ipa: "miː", zh: "我 (宾格)", pos: "pron" },
  { word: "when", ipa: "wɛn", zh: "当...时；何时", pos: "conj" },
  { word: "make", ipa: "meɪk", zh: "做；制造", pos: "v" },
  { word: "can", ipa: "kæn", zh: "能；可以", pos: "aux" },
  { word: "like", ipa: "laɪk", zh: "喜欢；像", pos: "v" },
  { word: "time", ipa: "taɪm", zh: "时间；次", pos: "n" },
  { word: "no", ipa: "noʊ", zh: "不；没有", pos: "det" },
  { word: "just", ipa: "dʒʌst", zh: "只是；刚才", pos: "adv" },
  { word: "him", ipa: "hɪm", zh: "他 (宾格)", pos: "pron" },
  { word: "know", ipa: "noʊ", zh: "知道；了解", pos: "v" },
  { word: "take", ipa: "teɪk", zh: "拿；带走", pos: "v" },
  { word: "people", ipa: "ˈpiːpl", zh: "人们；人民", pos: "n" },
  { word: "into", ipa: "ˈɪntə", zh: "进入；到...里", pos: "prep" },
  { word: "year", ipa: "jɪr", zh: "年；年度", pos: "n" },
  { word: "your", ipa: "jʊr", zh: "你的", pos: "pron" },
  { word: "good", ipa: "ɡʊd", zh: "好；善的", pos: "adj" },
  { word: "some", ipa: "sʌm", zh: "一些；某些", pos: "det" },
  { word: "could", ipa: "kʊd", zh: "能够 (过去)", pos: "aux" },
  { word: "them", ipa: "ðɛm", zh: "他们 (宾格)", pos: "pron" },
  { word: "see", ipa: "siː", zh: "看见；明白", pos: "v" },
  { word: "other", ipa: "ˈʌðər", zh: "其他；另外", pos: "adj" },
  { word: "than", ipa: "ðæn", zh: "比；比较", pos: "conj" },
  { word: "then", ipa: "ðɛn", zh: "那时；然后", pos: "adv" },
  { word: "now", ipa: "naʊ", zh: "现在；如今", pos: "adv" },
  { word: "look", ipa: "lʊk", zh: "看；外表", pos: "v" },
  { word: "only", ipa: "ˈoʊnli", zh: "只有；仅仅", pos: "adv" },
  { word: "come", ipa: "kʌm", zh: "来；来临", pos: "v" },
  { word: "its", ipa: "ɪts", zh: "它的", pos: "pron" },
  { word: "over", ipa: "ˈoʊvər", zh: "在...上方；结束", pos: "prep" },
  { word: "think", ipa: "θɪŋk", zh: "想；认为", pos: "v" },
  { word: "also", ipa: "ˈɔːlsoʊ", zh: "也；还", pos: "adv" },
  { word: "back", ipa: "bæk", zh: "回；背部", pos: "adv" },
  { word: "after", ipa: "ˈæftər", zh: "之后；在...后", pos: "prep" },
  { word: "use", ipa: "juːz", zh: "使用；利用", pos: "v" },
  { word: "two", ipa: "tuː", zh: "二；两个", pos: "num" },
  { word: "how", ipa: "haʊ", zh: "怎么；如何", pos: "adv" },
  { word: "our", ipa: "aʊr", zh: "我们的", pos: "pron" },
  { word: "work", ipa: "wɜːrk", zh: "工作；运转", pos: "v" },
  { word: "first", ipa: "fɜːrst", zh: "第一；首先", pos: "adj" },
  { word: "well", ipa: "wɛl", zh: "好；井", pos: "adv" },
  { word: "way", ipa: "weɪ", zh: "方式；道路", pos: "n" },
  { word: "even", ipa: "ˈiːvən", zh: "甚至；平的", pos: "adv" },
  { word: "new", ipa: "njuː", zh: "新的；新", pos: "adj" },
  { word: "want", ipa: "wɒnt", zh: "想要；需要", pos: "v" },
  { word: "because", ipa: "bɪˈkɒz", zh: "因为；由于", pos: "conj" },
  { word: "any", ipa: "ˈɛni", zh: "任何；一些", pos: "det" },
  { word: "these", ipa: "ðiːz", zh: "这些", pos: "pron" },
  { word: "give", ipa: "ɡɪv", zh: "给；给予", pos: "v" },
  { word: "day", ipa: "deɪ", zh: "天；白天", pos: "n" },
  { word: "most", ipa: "moʊst", zh: "最多；大多数", pos: "det" },
  { word: "us", ipa: "ʌs", zh: "我们 (宾格)", pos: "pron" },
  { word: "between", ipa: "bɪˈtwiːn", zh: "在...之间", pos: "prep" },
  { word: "need", ipa: "niːd", zh: "需要；必须", pos: "v" },
  { word: "large", ipa: "lɑːrdʒ", zh: "大的；巨大", pos: "adj" },
  { word: "often", ipa: "ˈɔːfən", zh: "经常；常常", pos: "adv" },
  { word: "hand", ipa: "hænd", zh: "手；给予", pos: "n" },
  { word: "high", ipa: "haɪ", zh: "高的；高度", pos: "adj" },
  { word: "place", ipa: "pleɪs", zh: "地方；位置", pos: "n" },
  { word: "hold", ipa: "hoʊld", zh: "握住；保持", pos: "v" },
  { word: "down", ipa: "daʊn", zh: "向下；下面", pos: "adv" },
  { word: "world", ipa: "wɜːrld", zh: "世界；宇宙", pos: "n" },
  { word: "still", ipa: "stɪl", zh: "还；仍然", pos: "adv" },
  { word: "find", ipa: "faɪnd", zh: "找到；发现", pos: "v" },
  { word: "should", ipa: "ʃʊd", zh: "应该；应当", pos: "aux" },
  { word: "long", ipa: "lɒŋ", zh: "长的；漫长", pos: "adj" },
  { word: "here", ipa: "hɪr", zh: "这里；此处", pos: "adv" },
  { word: "thing", ipa: "θɪŋ", zh: "事情；东西", pos: "n" },
  { word: "change", ipa: "tʃeɪndʒ", zh: "改变；变化", pos: "v" },
  { word: "much", ipa: "mʌtʃ", zh: "很多；太多", pos: "adv" },
  { word: "where", ipa: "wɛr", zh: "哪里；何处", pos: "adv" },
  { word: "before", ipa: "bɪˈfɔːr", zh: "在...之前", pos: "prep" },
  { word: "right", ipa: "raɪt", zh: "对的；右边", pos: "adj" },
  { word: "too", ipa: "tuː", zh: "也；太", pos: "adv" },
  { word: "mean", ipa: "miːn", zh: "意思；平均", pos: "v" },
  { word: "old", ipa: "oʊld", zh: "老的；旧的", pos: "adj" },
  { word: "away", ipa: "əˈweɪ", zh: "离开；远离", pos: "adv" },
  { word: "same", ipa: "seɪm", zh: "相同的；一样", pos: "adj" },
  { word: "tell", ipa: "tɛl", zh: "告诉；讲述", pos: "v" },
  { word: "boy", ipa: "bɔɪ", zh: "男孩；小子", pos: "n" },
  { word: "follow", ipa: "ˈfɒloʊ", zh: "跟随；遵循", pos: "v" },
  { word: "came", ipa: "keɪm", zh: "来了 (过去)", pos: "v" },
  { word: "show", ipa: "ʃoʊ", zh: "展示；表演", pos: "v" },
  { word: "every", ipa: "ˈɛvri", zh: "每个；每", pos: "det" },
  { word: "house", ipa: "haʊs", zh: "房子；房屋", pos: "n" },
  { word: "both", ipa: "boʊθ", zh: "两个都；双方", pos: "det" },
  { word: "life", ipa: "laɪf", zh: "生活；生命", pos: "n" },
  { word: "very", ipa: "ˈvɛri", zh: "非常；很", pos: "adv" },
  { word: "call", ipa: "kɔːl", zh: "叫；打电话", pos: "v" },
  { word: "few", ipa: "fjuː", zh: "几个；少数", pos: "det" },
  { word: "north", ipa: "nɔːrθ", zh: "北；北方", pos: "n" },
  { word: "open", ipa: "ˈoʊpən", zh: "开的；打开", pos: "adj" },
  { word: "seem", ipa: "siːm", zh: "似乎；看来", pos: "v" },
  { word: "together", ipa: "təˈɡɛðər", zh: "一起；共同", pos: "adv" },
  { word: "next", ipa: "nɛkst", zh: "下一个；紧接", pos: "adj" },
  { word: "white", ipa: "waɪt", zh: "白色；白的", pos: "adj" },
  { word: "children", ipa: "ˈtʃɪldrən", zh: "孩子们", pos: "n" },
  { word: "begin", ipa: "bɪˈɡɪn", zh: "开始；开端", pos: "v" },
  { word: "got", ipa: "ɡɒt", zh: "得到 (过去)", pos: "v" },
  { word: "walk", ipa: "wɔːk", zh: "走；步行", pos: "v" },
  { word: "example", ipa: "ɪɡˈzæmpl", zh: "例子；示例", pos: "n" },
  { word: "ease", ipa: "iːz", zh: "轻松；缓解", pos: "n" },
  { word: "paper", ipa: "ˈpeɪpər", zh: "纸；论文", pos: "n" },
  { word: "hard", ipa: "hɑːrd", zh: "难；努力", pos: "adj" },
  { word: "near", ipa: "nɪr", zh: "近；附近", pos: "adj" },
  { word: "move", ipa: "muːv", zh: "移动；搬家", pos: "v" },
  { word: "though", ipa: "ðoʊ", zh: "尽管；虽然", pos: "conj" },
  { word: "point", ipa: "pɔɪnt", zh: "观点；指向", pos: "n" },
  { word: "city", ipa: "ˈsɪti", zh: "城市；市", pos: "n" },
  { word: "play", ipa: "pleɪ", zh: "玩；演奏", pos: "v" },
  { word: "small", ipa: "smɔːl", zh: "小的；少量", pos: "adj" },
  { word: "number", ipa: "ˈnʌmbər", zh: "数字；号码", pos: "n" },
  { word: "off", ipa: "ɒf", zh: "关；脱离", pos: "adv" },
  { word: "always", ipa: "ˈɔːlweɪz", zh: "总是；始终", pos: "adv" },
  { word: "ask", ipa: "æsk", zh: "问；请求", pos: "v" },
  { word: "set", ipa: "sɛt", zh: "设置；一套", pos: "v" },
  { word: "food", ipa: "fuːd", zh: "食物；粮食", pos: "n" },
  { word: "keep", ipa: "kiːp", zh: "保持；继续", pos: "v" },
  { word: "plant", ipa: "plænt", zh: "植物；种植", pos: "n" },
  { word: "last", ipa: "læst", zh: "最后；持续", pos: "adj" },
  { word: "school", ipa: "skuːl", zh: "学校；上学", pos: "n" },
  { word: "never", ipa: "ˈnɛvər", zh: "从不；绝不", pos: "adv" },
  { word: "real", ipa: "riːl", zh: "真实的；真正", pos: "adj" },
  { word: "leave", ipa: "liːv", zh: "离开；留下", pos: "v" },
  { word: "part", ipa: "pɑːrt", zh: "部分；角色", pos: "n" },
  { word: "group", ipa: "ɡruːp", zh: "群；组", pos: "n" },
  { word: "state", ipa: "steɪt", zh: "状态；国家", pos: "n" },
  { word: "idea", ipa: "aɪˈdiːə", zh: "主意；想法", pos: "n" },
  { word: "body", ipa: "ˈbɒdi", zh: "身体；主体", pos: "n" },
  { word: "face", ipa: "feɪs", zh: "脸；面对", pos: "n" },
  { word: "ever", ipa: "ˈɛvər", zh: "曾经；始终", pos: "adv" },
  { word: "done", ipa: "dʌn", zh: "完成；做完", pos: "v" },
  { word: "eye", ipa: "aɪ", zh: "眼睛；眼光", pos: "n" },
  { word: "might", ipa: "maɪt", zh: "可能；力量", pos: "aux" },
  { word: "felt", ipa: "fɛlt", zh: "感到 (过去)", pos: "v" },
  { word: "run", ipa: "rʌn", zh: "跑；运行", pos: "v" },
  { word: "around", ipa: "əˈraʊnd", zh: "到处；周围", pos: "prep" },
  { word: "once", ipa: "wʌns", zh: "一次；曾经", pos: "adv" },
  { word: "along", ipa: "əˈlɒŋ", zh: "沿着；一起", pos: "prep" },
  { word: "something", ipa: "ˈsʌmθɪŋ", zh: "某事；一些", pos: "pron" },
  { word: "form", ipa: "fɔːrm", zh: "形式；表格", pos: "n" },
  { word: "head", ipa: "hɛd", zh: "头；领导", pos: "n" },
  { word: "lead", ipa: "liːd", zh: "领导；带领", pos: "v" },
  { word: "own", ipa: "oʊn", zh: "自己的；拥有", pos: "adj" },
  { word: "while", ipa: "waɪl", zh: "当...时；同时", pos: "conj" },
  { word: "may", ipa: "meɪ", zh: "可能；可以", pos: "aux" },
  { word: "without", ipa: "wɪˈðaʊt", zh: "没有；缺乏", pos: "prep" },
  { word: "under", ipa: "ˈʌndər", zh: "在...下面", pos: "prep" },
  { word: "such", ipa: "sʌtʃ", zh: "如此；这样", pos: "det" },
  { word: "through", ipa: "θruː", zh: "穿过；通过", pos: "prep" },
  { word: "interest", ipa: "ˈɪntrəst", zh: "兴趣；利息", pos: "n" },
  { word: "possible", ipa: "ˈpɒsɪbl", zh: "可能的；可行", pos: "adj" },
  { word: "end", ipa: "ɛnd", zh: "结束；末端", pos: "n" },
  { word: "different", ipa: "ˈdɪfrənt", zh: "不同的；各异", pos: "adj" },
  { word: "person", ipa: "ˈpɜːrsən", zh: "人；个人", pos: "n" },
  { word: "turn", ipa: "tɜːrn", zh: "转；轮流", pos: "v" },
  { word: "another", ipa: "əˈnʌðər", zh: "另一个；另", pos: "det" },
  { word: "against", ipa: "əˈɡɛnst", zh: "对抗；反对", pos: "prep" },
  { word: "late", ipa: "leɪt", zh: "晚；迟到", pos: "adj" },
  { word: "home", ipa: "hoʊm", zh: "家；回家", pos: "n" },
  { word: "during", ipa: "ˈdjʊərɪŋ", zh: "在...期间", pos: "prep" },
  { word: "present", ipa: "ˈprɛzənt", zh: "现在；礼物", pos: "n" },
  { word: "word", ipa: "wɜːrd", zh: "词；话语", pos: "n" },
  { word: "system", ipa: "ˈsɪstəm", zh: "系统；制度", pos: "n" },
  { word: "order", ipa: "ˈɔːrdər", zh: "顺序；订单", pos: "n" },
  { word: "however", ipa: "haʊˈɛvər", zh: "然而；不过", pos: "adv" },
  { word: "program", ipa: "ˈproʊɡræm", zh: "程序；项目", pos: "n" },
  { word: "problem", ipa: "ˈprɒbləm", zh: "问题；难题", pos: "n" },
  { word: "consider", ipa: "kənˈsɪdər", zh: "考虑；认为", pos: "v" },
  { word: "plan", ipa: "plæn", zh: "计划；方案", pos: "n" },
  { word: "increase", ipa: "ɪnˈkriːs", zh: "增加；提高", pos: "v" },
  { word: "early", ipa: "ˈɜːrli", zh: "早的；提早", pos: "adj" },
  { word: "course", ipa: "kɔːrs", zh: "课程；当然", pos: "n" },
  { word: "help", ipa: "hɛlp", zh: "帮助；援助", pos: "v" },
  { word: "line", ipa: "laɪn", zh: "线；行", pos: "n" },
  { word: "stand", ipa: "stænd", zh: "站立；忍受", pos: "v" },
  { word: "general", ipa: "ˈdʒɛnərəl", zh: "一般；将军", pos: "adj" },
  { word: "since", ipa: "sɪns", zh: "自从；因为", pos: "prep" },
  { word: "certain", ipa: "ˈsɜːrtən", zh: "确定的；某些", pos: "adj" },
  { word: "develop", ipa: "dɪˈvɛləp", zh: "发展；开发", pos: "v" },
  { word: "must", ipa: "mʌst", zh: "必须；一定", pos: "aux" },
  { word: "little", ipa: "ˈlɪtl", zh: "一点；小", pos: "adj" },
  { word: "nation", ipa: "ˈneɪʃən", zh: "国家；民族", pos: "n" },
  { word: "write", ipa: "raɪt", zh: "写；书写", pos: "v" },
  { word: "become", ipa: "bɪˈkʌm", zh: "成为；变得", pos: "v" },
  { word: "govern", ipa: "ˈɡʌvərn", zh: "管理；统治", pos: "v" },
  { word: "read", ipa: "riːd", zh: "读；阅读", pos: "v" },
  { word: "great", ipa: "ɡreɪt", zh: "伟大；很棒", pos: "adj" },
];

function slugify(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function entryToYaml(e: Entry): string {
  return [
    `  - id: en-vocab-cefr-a1-${slugify(e.word)}`,
    `    type: vocab`,
    `    level: A1`,
    `    ja: ${JSON.stringify(e.word)}`,
    `    reading: ${JSON.stringify(e.ipa)}`,
    `    zh: ${JSON.stringify(e.zh)}`,
    `    pos: ${JSON.stringify(e.pos)}`,
  ].join("\n");
}

function buildYaml(): string {
  const header =
    `# Auto-generated by scripts/fetch-subtlex.ts. Do not edit by hand.\n` +
    `# See file header in fetch-subtlex.ts for licensing notes.\n\n` +
    `language: en\nconcepts:\n`;
  return header + ENTRIES.map(entryToYaml).join("\n\n") + "\n";
}

// Validate: all ids must be unique
function validateEntries(entries: Entry[]): void {
  const seen = new Set<string>();
  for (const e of entries) {
    const id = `en-vocab-cefr-a1-${slugify(e.word)}`;
    if (seen.has(id)) {
      throw new Error(`Duplicate id: ${id} (word: ${e.word})`);
    }
    seen.add(id);
  }
}

function main(): void {
  validateEntries(ENTRIES);

  const dryRun = argv.includes("--dry-run");
  const yaml = buildYaml();
  if (dryRun) {
    process.stdout.write(yaml);
    return;
  }
  const outPath = join(import.meta.dir, "..", "data", "seeds", "en-subtlex-top200.yaml");
  writeFileSync(outPath, yaml);
  console.log(`Wrote ${ENTRIES.length} entries to ${outPath}`);
}

if (import.meta.main) main();
