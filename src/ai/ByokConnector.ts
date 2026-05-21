/**
 * BYOK AI connector for task breakdown and scheduling.
 */

import { getApiKey, getPreference, storage } from '@/store/mmkv';
import { useSettingsStore } from '@/store/settingsStore';
import type {
  ScheduledSubTask,
  TaskBreakdownResult,
} from './ByokConnector.types';

type Provider = 'openai' | 'claude';

const OPENAI_API_BASE_URL = 'https://api.openai.com';
const CLAUDE_API_BASE_URL = 'https://api.anthropic.com';
const OPENAI_API_URL = `${OPENAI_API_BASE_URL}/v1/chat/completions`;
const CLAUDE_API_URL = `${CLAUDE_API_BASE_URL}/v1/messages`;
const DEFAULT_DURATION_MINUTES = 45;
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_OPENAI_VISION_MODEL = 'gpt-4o';
const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

interface OpenAIVisionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

const SYSTEM_PROMPT = [
  'You are a top-tier time management expert.',
  'Break the task into 3-5 sub-tasks.',
  'Use the provided "free slots map" to assign a suitable date and period to each sub-task.',
  'Return JSON only, with this exact structure:',
  '{"sub_tasks":[{"title":"task name","duration_minutes":45,"target_date":"YYYY-MM-DD","start_period":3}]}',
  'If no suitable free slot exists for a sub-task, omit target_date and start_period so it degrades to a normal task.',
  'Do not output markdown, commentary, or extra keys.',
].join('\n');

function detectProvider(): Provider | null {
  if (getOpenAICompatibleApiKey()) return 'openai';
  if (getClaudeApiKey()) return 'claude';
  return null;
}

function getTrimmedValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeApiBaseUrl(baseUrl: string | null | undefined): string | undefined {
  const trimmed = baseUrl?.trim().replace(/^['"]+|['"]+$/g, '');
  if (!trimmed) return undefined;

  const normalized = trimmed
    .replace(/\/+$/g, '')
    .replace(/\/v1\/(?:chat\/completions|messages)$/i, '')
    .replace(/\/v1$/i, '');

  return normalized || undefined;
}

function getOpenAICompatibleApiKey(): string | null {
  return (
    getTrimmedValue(storage.getString('byok_api_key')) ??
    getTrimmedValue(getApiKey('openai_api_key'))
  );
}

function getClaudeApiKey(): string | null {
  return getTrimmedValue(getApiKey('claude_api_key'));
}

function getConfiguredApiBaseUrl(): string | undefined {
  return normalizeApiBaseUrl(
    getApiKey('custom_api_base') ??
      useSettingsStore.getState().byokBaseUrl ??
      storage.getString('byok_base_url'),
  );
}

function getProviderApiBaseUrl(provider: Provider): string | undefined {
  const baseUrl = getConfiguredApiBaseUrl();
  if (provider === 'claude' && baseUrl === OPENAI_API_BASE_URL) {
    return undefined;
  }
  return baseUrl;
}

function buildOpenAIChatCompletionsUrl(baseUrl?: string): string {
  const normalizedBaseUrl = normalizeApiBaseUrl(baseUrl);
  return normalizedBaseUrl
    ? `${normalizedBaseUrl}/v1/chat/completions`
    : OPENAI_API_URL;
}

function buildClaudeMessagesUrl(baseUrl?: string): string {
  const normalizedBaseUrl = normalizeApiBaseUrl(baseUrl);
  return normalizedBaseUrl ? `${normalizedBaseUrl}/v1/messages` : CLAUDE_API_URL;
}

function buildUserPrompt(parentTaskTitle: string, freeSlotsMap?: string): string {
  const trimmedMap = freeSlotsMap?.trim();
  if (!trimmedMap) {
    return `Parent task: ${parentTaskTitle}`;
  }

  return [
    `Parent task: ${parentTaskTitle}`,
    '',
    'This is the free slots map for the current week:',
    trimmedMap,
  ].join('\n');
}

function extractJSON(text: string): TaskBreakdownResult {
  const parsed =
    tryParseJSON(text) ??
    tryParseCodeBlockJSON(text) ??
    tryParseBraceJSON(text);

  if (!parsed) {
    throw new Error('AI response did not contain valid JSON.');
  }

  return normalizeTaskBreakdown(parsed);
}

function tryParseJSON(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function tryParseCodeBlockJSON(text: string): unknown | null {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!match?.[1]) return null;
  return tryParseJSON(match[1].trim());
}

function tryParseBraceJSON(text: string): unknown | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return tryParseJSON(match[0]);
}

function normalizeTaskBreakdown(raw: unknown): TaskBreakdownResult {
  if (!isRecord(raw)) {
    throw new Error('AI response must be a JSON object.');
  }

  const subTasks = raw.sub_tasks;
  if (!Array.isArray(subTasks)) {
    throw new Error('AI response must include a sub_tasks array.');
  }

  return {
    sub_tasks: subTasks
      .map((item) => normalizeSubTask(item))
      .filter((item): item is ScheduledSubTask => item !== null),
  };
}

function normalizeSubTask(raw: unknown): ScheduledSubTask | null {
  if (!isRecord(raw)) return null;

  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) return null;

  const duration = normalizeDuration(raw.duration_minutes) ?? DEFAULT_DURATION_MINUTES;
  const subTask: ScheduledSubTask = {
    title,
    duration_minutes: duration,
  };

  const targetDate = normalizeDate(raw.target_date);
  if (targetDate) {
    subTask.target_date = targetDate;
  }

  const startPeriod = normalizePeriod(raw.start_period);
  if (startPeriod !== null) {
    subTask.start_period = startPeriod;
  }

  return subTask;
}

function normalizeDuration(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed);
    }
  }

  return null;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function normalizePeriod(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 12) {
      return parsed;
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function callOpenAI(
  parentTaskTitle: string,
  freeSlotsMap: string | undefined,
  apiKey: string,
  baseUrl?: string,
): Promise<TaskBreakdownResult> {
  const customModel = getPreference('byok_model', '').trim();
  const url = buildOpenAIChatCompletionsUrl(baseUrl);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: customModel || DEFAULT_OPENAI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(parentTaskTitle, freeSlotsMap) },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI response did not include content.');
  }

  return extractJSON(content);
}

export async function extractScheduleFromImage(base64Image: string): Promise<any> {
  const apiKey = storage.getString('byok_api_key')?.trim();
  if (!apiKey) {
    throw new Error('请先在设置页配置 AI 密钥！');
  }

  const baseUrl = useSettingsStore.getState().byokBaseUrl?.trim();
  const url = baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`
    : OPENAI_API_URL;
  const customModel = getPreference('byok_model', '').trim();
  const imageUrl = base64Image.startsWith('data:image/')
    ? base64Image
    : `data:image/jpeg;base64,${base64Image}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: customModel || DEFAULT_OPENAI_VISION_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '你是一个极其精准的课表视觉解析器。请从用户提供的课表图片中提取所有课程。必须输出 JSON 格式：{"courses": [{"title": "课程名", "dayOfWeek": 1到7的数字, "startPeriod": 起始节次数字, "endPeriod": 结束节次数字, "location": "上课地点"}]}',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: '请解析这张课表图片。' },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI Vision API error (${res.status}): ${err}`);
    }

    const data = (await res.json()) as OpenAIVisionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI Vision response did not include content.');
    }

    const parsed =
      tryParseJSON(content) ??
      tryParseCodeBlockJSON(content) ??
      tryParseBraceJSON(content);

    if (!parsed) {
      throw new Error('OpenAI Vision response did not contain valid JSON.');
    }

    return parsed;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to extract schedule from image.');
  }
}

async function callClaude(
  parentTaskTitle: string,
  freeSlotsMap: string | undefined,
  apiKey: string,
  baseUrl?: string,
): Promise<TaskBreakdownResult> {
  const customModel = getPreference('byok_model', '').trim();
  const url = buildClaudeMessagesUrl(baseUrl);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: customModel || DEFAULT_CLAUDE_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildUserPrompt(parentTaskTitle, freeSlotsMap),
        },
      ],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  const content = data.content?.[0]?.text;
  if (!content) {
    throw new Error('Claude response did not include content.');
  }

  return extractJSON(content);
}

export async function streamTaskBreakdown(
  parentTaskTitle: string,
  freeSlotsMap?: string,
): Promise<TaskBreakdownResult> {
  const provider = detectProvider();

  if (!provider) {
    throw new Error('No AI API key found. Configure either OpenAI or Claude.');
  }

  const customBase = getProviderApiBaseUrl(provider);

  switch (provider) {
    case 'openai': {
      const key = getOpenAICompatibleApiKey();
      if (!key) throw new Error('OpenAI API key is missing.');
      return callOpenAI(parentTaskTitle, freeSlotsMap, key, customBase);
    }
    case 'claude': {
      const key = getClaudeApiKey();
      if (!key) throw new Error('Claude API key is missing.');
      return callClaude(parentTaskTitle, freeSlotsMap, key, customBase);
    }
  }
}

export function isAIConfigured(): boolean {
  return detectProvider() !== null;
}

export type { ScheduledSubTask, TaskBreakdownResult } from './ByokConnector.types';
