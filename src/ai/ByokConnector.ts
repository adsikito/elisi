/**
 * MyBrain — BYOK AI 连接器
 *
 * BYOK = Bring Your Own Key，用户自带 API Key
 * 从 MMKV 加密存储读取 key，直连 LLM 服务商 API
 *
 * 支持的 Provider：
 *   - OpenAI (gpt-4o-mini)
 *   - Claude (claude-haiku-4-5-20251001)
 *
 * 所有方法返回结构化 JSON，由调用方负责类型断言
 */

import { getApiKey, getPreference } from '@/store/mmkv';

// ============================================================
// 类型定义
// ============================================================

/** AI 分解任务返回的子任务结构 */
export interface SubTask {
  title: string;
  description?: string;
  priority?: number;
}

/** streamTaskBreakdown 的返回结构 */
export interface TaskBreakdownResult {
  sub_tasks: SubTask[];
}

/** 支持的 AI 服务商 */
type Provider = 'openai' | 'claude';

// ============================================================
// 常量
// ============================================================

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `你是一个任务分解助手。用户会给你一个任务标题，你需要把它拆解为 2-5 个可执行的子任务。

严格以 JSON 格式返回，不要包含任何其他文字：
{
  "sub_tasks": [
    { "title": "子任务标题", "description": "简要说明", "priority": 1 }
  ]
}

规则：
- priority: 0=低, 1=中, 2=高
- 子任务应按执行顺序排列
- 每个子任务应该是独立可完成的最小单元`;

// ============================================================
// 内部工具
// ============================================================

/** 检测当前配置的 provider */
function detectProvider(): Provider | null {
  if (getApiKey('claude_api_key')) return 'claude';
  if (getApiKey('openai_api_key')) return 'openai';
  return null;
}

/** 从 AI 响应中提取 JSON */
function extractJSON(text: string): TaskBreakdownResult {
  // 尝试直接解析
  try {
    return JSON.parse(text);
  } catch {
    // 尝试提取 ```json ... ``` 代码块
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match?.[1]) {
      return JSON.parse(match[1].trim());
    }
    // 尝试提取第一个 { ... } 块
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      return JSON.parse(braceMatch[0]);
    }
    throw new Error('无法从 AI 响应中提取有效 JSON');
  }
}

// ============================================================
// 核心 API
// ============================================================

/**
 * 调用 OpenAI API 分解任务
 */
async function callOpenAI(
  title: string,
  apiKey: string,
  baseUrl?: string,
): Promise<TaskBreakdownResult> {
  const url = baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`
    : OPENAI_API_URL;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `请分解这个任务：${title}` },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API 错误 (${res.status}): ${err}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI 返回空内容');

  return extractJSON(content);
}

/**
 * 调用 Claude API 分解任务
 */
async function callClaude(
  title: string,
  apiKey: string,
  baseUrl?: string,
): Promise<TaskBreakdownResult> {
  const url = baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/v1/messages`
    : CLAUDE_API_URL;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `请分解这个任务：${title}` },
      ],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API 错误 (${res.status}): ${err}`);
  }

  const data = await res.json();
  const content = data.content?.[0]?.text;
  if (!content) throw new Error('Claude 返回空内容');

  return extractJSON(content);
}

// ============================================================
// 导出 API
// ============================================================

/**
 * 流式任务分解（名称保留 stream 前缀以兼容上层调用）
 *
 * 根据用户配置的 BYOK API Key 自动选择 provider，
 * 调用 LLM 将任务标题拆解为子任务列表。
 *
 * @param taskTitle 任务标题
 * @returns 结构化子任务列表
 * @throws 未配置 API Key 或调用失败时抛出错误
 */
export async function streamTaskBreakdown(
  taskTitle: string,
): Promise<TaskBreakdownResult> {
  const provider = detectProvider();

  if (!provider) {
    throw new Error(
      '未配置 AI API Key，请在设置中添加 OpenAI 或 Claude 的 API Key',
    );
  }

  const customBase = getPreference('custom_api_base' as any, '') as string;

  switch (provider) {
    case 'openai': {
      const key = getApiKey('openai_api_key');
      if (!key) throw new Error('OpenAI API Key 无效');
      return callOpenAI(taskTitle, key, customBase || undefined);
    }
    case 'claude': {
      const key = getApiKey('claude_api_key');
      if (!key) throw new Error('Claude API Key 无效');
      return callClaude(taskTitle, key, customBase || undefined);
    }
  }
}

/**
 * 检查是否已配置可用的 AI 服务
 */
export function isAIConfigured(): boolean {
  return detectProvider() !== null;
}
