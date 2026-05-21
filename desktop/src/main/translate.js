import { getActiveApiConfig, getSelectionApiConfig, getApiConfigs, getGlossary, getSetting } from './database.js'

// 段落翻译的 prompt 预设 —— 用户在「通用设置 → 翻译风格」里选一个。
// 优先级：API 配置里自定义的 system_prompt > 这里的 preset > general 兜底。
const PROMPT_PRESETS = {
  general: `你是一个专业翻译助手。将用户提供的{sourceLang}文本准确翻译为{targetLang}。
严格保留原文中所有标点符号（引号、单引号、省略号、破折号、问号、感叹号、括号等），它们用于区分对话、心理活动、引语和强调，不可省略或替换。
只输出译文，不要解释、不要前言、不要总结。`,

  novel: `你是一个文学翻译。将用户提供的{sourceLang}文本翻译为{targetLang}小说语言。
要求：
- 保留原文的叙事节奏、对话语气、段落起伏
- 比喻 / 双关 / 隐喻尽量等效转换，宁可意译也别死板字面
- 严格保留原文标点（引号区分对话、感叹号/省略号传神等，不可省略或替换）
只输出译文，不要解释、不要前言、不要总结。`,

  doc: `你是一个技术文档翻译。将用户提供的{sourceLang}文本翻译为{targetLang}技术文档。
要求：
- 专业术语精准、前后一致
- 代码、函数名、API、命令、缩写、URL 一律保留原文不译
- 句式偏陈述、简洁、信息密度高，不要文学化润色
- 严格保留原文标点（不可省略或替换）
只输出译文，不要解释、不要前言、不要总结。`,
}

// 划词 system prompt：极简、跳过术语表、加快响应。
// 旧版硬编码「翻译为简体中文」忽略用户的目标语言设置 —— 用户选英→日时也强翻中文，
// 实际还会让 LLM 看到中文输入＋"翻成中文"指令时自己擅自反向翻成英文。修：按
// 真实 target lang 拼 prompt。
const LANG_LABEL = {
  zh: '简体中文',
  en: '英文',
  ja: '日文',
  ko: '韩文',
  fr: '法文',
  de: '德文',
}

function buildSelectionPrompt(targetLang) {
  const label = LANG_LABEL[targetLang] || targetLang || '简体中文'
  return `将用户输入翻译为${label}。直接输出译文，不要解释、不要前缀、不要引号。`
}

// 粗粒度语言识别。规则：
//   - 含假名 → 日文（即便混了汉字也算日文）
//   - 含谚文 → 韩文
//   - 含汉字（无假名）→ 中文
//   - 含拉丁字母 → 英文（fr/de 等同归 en，先不细分）
//   - 全数字/符号 → null（无法判断，保持用户设置）
function detectLang(text) {
  if (!text) return null
  if (/[぀-ヿ]/.test(text)) return 'ja'
  if (/[가-힣]/.test(text)) return 'ko'
  if (/[一-鿿]/.test(text)) return 'zh'
  if (/[a-zA-Z]/.test(text)) return 'en'
  return null
}

/**
 * Build the OpenAI-style /chat/completions URL for an arbitrary provider.
 *
 *   base_url 以版本段结尾（/v1, /v3, /paas/v4 …）→ 直接拼 /chat/completions
 *   否则按 OpenAI 标准约定，自动追加 /v1/chat/completions
 *
 * Handles all the common cases:
 *   https://api.deepseek.com           → https://api.deepseek.com/v1/chat/completions
 *   https://api.deepseek.com/v1        → https://api.deepseek.com/v1/chat/completions
 *   https://open.bigmodel.cn/api/paas/v4 → https://open.bigmodel.cn/api/paas/v4/chat/completions
 *   https://api.siliconflow.cn/v1      → https://api.siliconflow.cn/v1/chat/completions
 *   https://dashscope.aliyuncs.com/compatible-mode → /compatible-mode/v1/chat/completions
 */
export function buildChatCompletionsUrl(baseUrl) {
  const cleaned = String(baseUrl || '').replace(/\/+$/, '')
  if (/\/v\d+$/.test(cleaned)) {
    return `${cleaned}/chat/completions`
  }
  return `${cleaned}/v1/chat/completions`
}

/**
 * 构建 system prompt
 * - 段落模式：使用 config 的自定义 prompt 或默认 prompt + 注入术语表
 * - 划词模式（word / sentence）：使用极简 prompt，跳过术语表，加快响应
 */
function buildSystemPrompt(config, sourceLang, targetLang, isSelection) {
  if (isSelection) return buildSelectionPrompt(targetLang)

  // 优先级：API 配置自定义 system_prompt > 通用设置里选的 preset > general 兜底。
  let base = config.system_prompt?.trim()
  if (!base) {
    const preset = getSetting('prompt_preset', 'general')
    base = PROMPT_PRESETS[preset] || PROMPT_PRESETS.general
  }
  base = base.replace('{sourceLang}', sourceLang).replace('{targetLang}', targetLang)

  const glossary = getGlossary()
  if (glossary.length > 0) {
    const lines = glossary.map((t) => `${t.source_term} → ${t.target_term}`)
    base += `\n\n以下术语表必须严格遵守（不得更改这些词的译法）：\n${lines.join('\n')}`
  }

  return base
}

// Chinese-cloud LLMs (mimo / 千帆 / 通义 etc.) often return HTTP 200 with a
// moderation-rejection sentence as the "translation". We detect those and
// treat them as a failure, so the fallback loop tries the next config
// instead of pasting the rejection text into the page as a "result".
const REJECTION_PATTERNS = [
  /request was rejected because it was considered high risk/i,
  /content (was )?(blocked|filtered|rejected) (by|due to)/i,
  /对不起.{0,20}(无法|不能|不便).{0,10}(回答|提供|翻译)/,
  /涉及.{0,10}(敏感|违规|不当)/,
  /违反.{0,10}(规定|政策|社区准则)/,
  /我不能.{0,20}(翻译|处理).{0,20}(内容|文本)/,
]

/**
 * 用单个 API 配置尝试翻译一次。
 * 成功 → { ok: true, translation }；失败 → { ok: false, offline, error }。
 * offline 取值与改造前保持一致：fetch 抛错（网络/超时）→ true；HTTP 错误码 →
 * true；内容审核拒绝 / 空译文 → false。
 */
async function tryOneConfig(config, { userPrompt, sourceLang, targetLang, isSelection }) {
  const systemPrompt = buildSystemPrompt(config, sourceLang, targetLang, isSelection)

  try {
    const url = buildChatCompletionsUrl(config.base_url)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.api_key}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: isSelection ? 0.1 : 0.3,
        // 划词 max_tokens 按输入长度动态：短句够快、OCR 长段不被截。
        // 旧版写死 256 → OCR 出来上千字时翻译只输出 1/4 就停了。
        // 公式：max(256, 输入字符 × 3) cap 2048 —— 3x 留译文比原文长的余量
        max_tokens: isSelection
          ? Math.min(2048, Math.max(256, Math.ceil(userPrompt.length * 3)))
          : 2048,
      }),
      // 划词 timeout 也按输入长度动态（默认 12s 短句够用，OCR 长段会超时）
      signal: AbortSignal.timeout(
        isSelection
          ? Math.min(60_000, Math.max(12_000, userPrompt.length * 30))
          : 90_000
      ),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      // offline:true 保持与改造前一致（HTTP 错误原本是 throw 后被 catch 成
      // offline:true），下游 popup / 扩展看到的字段值不变。
      return { ok: false, offline: true, error: `API 错误 ${response.status}: ${errText}` }
    }

    const data = await response.json()
    const translation = data.choices?.[0]?.message?.content?.trim() || ''

    if (REJECTION_PATTERNS.some((re) => re.test(translation))) {
      console.error('[translate] LLM returned a moderation rejection:', translation.slice(0, 200))
      return {
        ok: false,
        offline: false,
        error: 'LLM 内容审核拒绝（' + translation.slice(0, 60) + '）。请切换到无审核的接口（DeepSeek 官方 / OpenAI / 本地 Ollama 等）。',
      }
    }

    if (!translation) {
      return { ok: false, offline: false, error: 'API 返回空译文' }
    }

    return { ok: true, translation }
  } catch (err) {
    return { ok: false, offline: true, error: err.message }
  }
}

/**
 * 主翻译函数。按 [主配置, ...其余配置] 顺序依次尝试，任一成功即返回，全部
 * 失败才返回最后一个错误 —— 某个配置被限流(429) / 欠费 / 内容审核拒绝时自动
 * 换下一个，不需要用户手动切。主配置：划词用 getSelectionApiConfig()，段落
 * 用 getActiveApiConfig()。
 *
 * @param {Object} opts
 * @param {string} opts.text - 要翻译的文本
 * @param {string} [opts.sourceLang='en'] - 源语言
 * @param {string} [opts.targetLang='zh'] - 目标语言
 * @param {string} [opts.context=''] - 可选上下文
 * @param {'word'|'sentence'|'paragraph'} [opts.mode='sentence'] - 翻译模式
 * @returns {Promise<{translation: string, engine: string, offline: boolean, error?: string}>}
 */
export async function translate({ text, sourceLang, targetLang, context = '', mode = 'sentence' }) {
  let resolvedSource = sourceLang || getSetting('source_lang', 'en')
  let resolvedTarget = targetLang || getSetting('target_lang', 'zh')

  // auto_detect_lang 开启时，根据输入实际语言修正方向：
  //   - 检测到的语言 == target → 双向反转（用户设英→中、输入了中文 → 翻成英文）
  //   - 检测到 != source 也 != target → source 改成检测值，target 保留用户偏好
  //     （用户设英→中、输入韩文 → 韩→中，不是死板用 source=en）
  //   - 检测不到 / 跟 source 一致 → 不动
  const autoDetect = getSetting('auto_detect_lang', '1') === '1'
  if (autoDetect) {
    const detected = detectLang(text)
    if (detected) {
      if (detected === resolvedTarget) {
        const tmp = resolvedSource
        resolvedSource = resolvedTarget
        resolvedTarget = tmp
        console.log(`[translate] auto-detect 反向：检测=${detected} → ${resolvedSource}→${resolvedTarget}`)
      } else if (detected !== resolvedSource) {
        console.log(`[translate] auto-detect 改源：检测=${detected}（原 source=${resolvedSource}）`)
        resolvedSource = detected
      }
    }
  }

  const isSelection = mode === 'word' || mode === 'sentence'

  // 候选配置：主配置优先，其余配置作为限流 / 失败时的回退。
  const primary = isSelection ? getSelectionApiConfig() : getActiveApiConfig()
  const candidates = []
  if (primary) candidates.push(primary)
  for (const cfg of getApiConfigs()) {
    if (!primary || cfg.id !== primary.id) candidates.push(cfg)
  }

  if (candidates.length === 0) {
    return {
      translation: '',
      engine: null,
      offline: true,
      error: '未配置翻译 API，请在设置页添加 API 配置并激活。',
    }
  }

  // userPrompt 不依赖具体配置，循环外构建一次。
  let userPrompt = text
  if (context && context !== text) {
    userPrompt = `上下文：${context}\n\n请翻译以下${mode === 'word' ? '单词' : '文本'}：${text}`
  }

  let last = null
  for (const config of candidates) {
    const result = await tryOneConfig(config, {
      userPrompt,
      sourceLang: resolvedSource,
      targetLang: resolvedTarget,
      isSelection,
    })

    if (result.ok) {
      return { translation: result.translation, engine: config.name, offline: false }
    }

    last = { engine: config.name, offline: result.offline, error: result.error }
    console.warn(`[translate] 配置「${config.name}」失败：${result.error}`)
  }

  // 所有候选配置都失败 —— 返回最后一个错误（只有 1 个配置时即与原行为一致）。
  if (candidates.length > 1) {
    console.error('[translate] 所有 API 配置均尝试失败')
  }
  return {
    translation: '',
    engine: last.engine,
    offline: last.offline,
    error: last.error,
  }
}
