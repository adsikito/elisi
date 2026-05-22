/**
 * BYOK AI connector for task breakdown and timetable image extraction.
 */

import { getApiKey, storage } from '@/store/mmkv';
import {
  DEFAULT_BYOK_BASE_URL,
  DEFAULT_BYOK_PROVIDER,
  DEEPSEEK_BYOK_BASE_URL,
  DEEPSEEK_BYOK_MODEL,
  type ByokProvider,
  useSettingsStore,
} from '@/store/settingsStore';
import type {
  CopilotAction,
  CopilotCommandContext,
  CopilotPlanResult,
  CopilotTaskStatus,
  ScheduledSubTask,
  TaskBreakdownResult,
} from './ByokConnector.types';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_API_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_DURATION_MINUTES = 45;
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_OPENAI_VISION_MODEL = 'gpt-4o';
const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

interface OpenAICompatibleResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

interface ClaudeResponse {
  content?: Array<{
    type?: string;
    text?: string | null;
  }>;
}

interface ScheduleCourse {
  title: string;
  dayOfWeek: number;
  startPeriod: number;
  endPeriod: number;
  location?: string;
  teacher?: string;
}

interface ScheduleExtractionResult {
  courses: ScheduleCourse[];
}

type ModelPurpose = 'text' | 'vision';

const SYSTEM_PROMPT = [
  'You are a top-tier time management expert.',
  'Break the task into 3-5 sub-tasks.',
  'Use the provided "free slots map" to assign a suitable date and period to each sub-task.',
  'Return JSON only, with this exact structure:',
  '{"sub_tasks":[{"title":"task name","duration_minutes":45,"target_date":"YYYY-MM-DD","start_period":3}]}',
  'If no suitable free slot exists for a sub-task, omit target_date and start_period so it degrades to a normal task.',
  'Do not output markdown, commentary, or extra keys.',
].join('\n');

const SCHEDULE_SYSTEM_PROMPT = [
  'You are a precise timetable vision parser.',
  'Extract all courses from the supplied timetable image.',
  'Return JSON only, with this exact structure:',
  '{"courses":[{"title":"course name","dayOfWeek":1,"startPeriod":1,"endPeriod":2,"location":"classroom"}]}',
  'dayOfWeek must be 1 for Monday through 7 for Sunday.',
  'startPeriod and endPeriod must be numbers.',
].join('\n');

const COPILOT_SYSTEM_PROMPT = [
  'You are MyBrain Copilot, a precise task planning assistant.',
  'Convert the user command into a short suggestion and executable actions.',
  'Return JSON only, with this exact structure:',
  '{"summary":"short Chinese suggestion","actions":[{"type":"move_tasks_by_date","from_date":"YYYY-MM-DD","to_date":"YYYY-MM-DD"},{"type":"create_task","title":"task name","due_date":"YYYY-MM-DD","description":"optional","start_period":3,"duration_minutes":45}]}',
  'Supported action types are only create_task and move_tasks_by_date.',
  'Use move_tasks_by_date for commands like postponing, moving, delaying, or rescheduling tasks from one day to another.',
  'Use create_task when the user asks to add or schedule a new task.',
  'Use the supplied context dates for relative words like today, tomorrow, and this week.',
  'Omit fields that are unknown. Do not output markdown, commentary, or extra keys.',
].join('\n');

function getTrimmedValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeProvider(value: string | null | undefined): ByokProvider {
  return value === 'openai' ||
    value === 'claude' ||
    value === 'deepseek' ||
    value === 'custom'
    ? value
    : DEFAULT_BYOK_PROVIDER;
}

function getConfiguredProvider(): ByokProvider {
  return normalizeProvider(
    storage.getString('byok_provider') ?? useSettingsStore.getState().byokProvider,
  );
}

function getProviderLabel(provider: ByokProvider): string {
  switch (provider) {
    case 'claude':
      return 'Claude';
    case 'deepseek':
      return 'DeepSeek';
    case 'custom':
      return 'Custom BYOK';
    case 'openai':
    default:
      return 'OpenAI';
  }
}

function getByokApiKey(provider: ByokProvider): string | null {
  const byokApiKey = getTrimmedValue(storage.getString('byok_api_key'));
  if (byokApiKey) return byokApiKey;

  if (provider === 'claude') {
    return getTrimmedValue(getApiKey('claude_api_key'));
  }

  if (provider === 'openai' || provider === 'custom') {
    return getTrimmedValue(getApiKey('openai_api_key'));
  }

  return null;
}

function getConfiguredBaseUrl(provider: ByokProvider): string | null {
  const baseUrl =
    getTrimmedValue(storage.getString('byok_base_url')) ??
    getTrimmedValue(useSettingsStore.getState().byokBaseUrl);

  if (provider === 'deepseek' && (!baseUrl || baseUrl === DEFAULT_BYOK_BASE_URL)) {
    return DEEPSEEK_BYOK_BASE_URL;
  }

  if (provider === 'claude' && (!baseUrl || baseUrl === DEFAULT_BYOK_BASE_URL)) {
    return CLAUDE_API_BASE_URL;
  }

  return baseUrl;
}

function sanitizeBaseUrl(
  baseUrl: string | null | undefined,
  terminalPathPattern: RegExp,
): string | null {
  const trimmed = baseUrl?.trim().replace(/^['"]+|['"]+$/g, '');
  if (!trimmed) return null;

  return trimmed
    .replace(/\/+$/g, '')
    .replace(terminalPathPattern, '');
}

function buildChatCompletionsUrl(provider: ByokProvider): string {
  const baseUrl = sanitizeBaseUrl(
    getConfiguredBaseUrl(provider),
    /\/v1(?:\/chat\/completions)?$/i,
  );
  const url = baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`
    : OPENAI_API_URL;

  return url;
}

function buildClaudeMessagesUrl(): string {
  const baseUrl = sanitizeBaseUrl(
    getConfiguredBaseUrl('claude'),
    /\/v1(?:\/messages)?$/i,
  );
  return baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/v1/messages`
    : DEFAULT_CLAUDE_URL;
}

function getConfiguredModel(provider: ByokProvider, purpose: ModelPurpose): string {
  const configuredModel =
    getTrimmedValue(storage.getString('byok_model')) ??
    getTrimmedValue(useSettingsStore.getState().byokModel);

  if (configuredModel) return configuredModel;

  switch (provider) {
    case 'claude':
      return DEFAULT_CLAUDE_MODEL;
    case 'deepseek':
      return DEEPSEEK_BYOK_MODEL;
    case 'custom':
    case 'openai':
    default:
      return purpose === 'vision' ? DEFAULT_OPENAI_VISION_MODEL : DEFAULT_OPENAI_MODEL;
  }
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

function buildCopilotPrompt(
  command: string,
  context: CopilotCommandContext,
): string {
  return [
    `User command: ${command}`,
    '',
    'Context:',
    JSON.stringify(context),
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

function extractCopilotPlanJSON(text: string): CopilotPlanResult {
  const parsed =
    tryParseJSON(text) ??
    tryParseCodeBlockJSON(text) ??
    tryParseBraceJSON(text);

  if (!parsed) {
    throw new Error('AI response did not contain valid JSON.');
  }

  return normalizeCopilotPlan(parsed);
}

function normalizeCopilotPlan(raw: unknown): CopilotPlanResult {
  if (!isRecord(raw)) {
    throw new Error('AI response must be a JSON object.');
  }

  const summary =
    typeof raw.summary === 'string' && raw.summary.trim()
      ? raw.summary.trim()
      : '我整理好了建议。';

  const actions = Array.isArray(raw.actions)
    ? raw.actions
        .map((item) => normalizeCopilotAction(item))
        .filter((item): item is CopilotAction => item !== null)
    : [];

  return { summary, actions };
}

function normalizeCopilotAction(raw: unknown): CopilotAction | null {
  if (!isRecord(raw)) return null;

  if (raw.type === 'create_task') {
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!title) return null;

    const action: Extract<CopilotAction, { type: 'create_task' }> = {
      type: 'create_task',
      title,
    };
    const dueDate = normalizeDate(raw.due_date ?? raw.target_date);
    if (dueDate) {
      action.due_date = dueDate;
    }

    if (typeof raw.description === 'string' && raw.description.trim()) {
      action.description = raw.description.trim();
    }

    const startPeriod = normalizePeriod(raw.start_period);
    if (startPeriod !== null) {
      action.start_period = startPeriod;
    }

    const duration = normalizeDuration(raw.duration_minutes);
    if (duration !== null) {
      action.duration_minutes = duration;
    }

    const priority = normalizePriority(raw.priority);
    if (priority !== null) {
      action.priority = priority;
    }

    return action;
  }

  if (raw.type === 'move_tasks_by_date') {
    const fromDate = normalizeDate(raw.from_date);
    const toDate = normalizeDate(raw.to_date);
    if (!fromDate || !toDate) return null;

    const action: Extract<CopilotAction, { type: 'move_tasks_by_date' }> = {
      type: 'move_tasks_by_date',
      from_date: fromDate,
      to_date: toDate,
    };
    const status = normalizeCopilotStatus(raw.status);
    if (status) {
      action.status = status;
    }

    return action;
  }

  return null;
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

function normalizePriority(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.round(value));
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.round(parsed));
    }
  }

  return null;
}

function normalizeCopilotStatus(value: unknown): CopilotTaskStatus | null {
  if (
    value === 'pending' ||
    value === 'in_progress' ||
    value === 'done' ||
    value === 'cancelled' ||
    value === 'all'
  ) {
    return value;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function postOpenAICompatible(
  provider: ByokProvider,
  apiKey: string,
  body: Record<string, unknown>,
  purposeLabel: string,
): Promise<OpenAICompatibleResponse> {
  const url = buildChatCompletionsUrl(provider);
  const providerLabel = getProviderLabel(provider);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${providerLabel} ${purposeLabel} API error (${res.status}): ${err}`);
  }

  return (await res.json()) as OpenAICompatibleResponse;
}

async function postClaude(
  apiKey: string,
  body: Record<string, unknown>,
  purposeLabel: string,
): Promise<ClaudeResponse> {
  const res = await fetch(buildClaudeMessagesUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude ${purposeLabel} API error (${res.status}): ${err}`);
  }

  return (await res.json()) as ClaudeResponse;
}

async function callOpenAICompatible(
  parentTaskTitle: string,
  freeSlotsMap: string | undefined,
  apiKey: string,
  provider: ByokProvider,
): Promise<TaskBreakdownResult> {
  const providerLabel = getProviderLabel(provider);
  const data = await postOpenAICompatible(
    provider,
    apiKey,
    {
      model: getConfiguredModel(provider, 'text'),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(parentTaskTitle, freeSlotsMap) },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    },
    'text',
  );

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`${providerLabel} response did not include content.`);
  }

  return extractJSON(content);
}

async function callClaude(
  parentTaskTitle: string,
  freeSlotsMap: string | undefined,
  apiKey: string,
): Promise<TaskBreakdownResult> {
  const data = await postClaude(
    apiKey,
    {
      model: getConfiguredModel('claude', 'text'),
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildUserPrompt(parentTaskTitle, freeSlotsMap),
        },
      ],
      temperature: 0.3,
    },
    'text',
  );

  const content = data.content?.find((item) => item.text)?.text;
  if (!content) {
    throw new Error('Claude response did not include content.');
  }

  return extractJSON(content);
}

async function callCopilotPlanOpenAICompatible(
  command: string,
  context: CopilotCommandContext,
  apiKey: string,
  provider: ByokProvider,
): Promise<CopilotPlanResult> {
  const providerLabel = getProviderLabel(provider);
  const data = await postOpenAICompatible(
    provider,
    apiKey,
    {
      model: getConfiguredModel(provider, 'text'),
      messages: [
        { role: 'system', content: COPILOT_SYSTEM_PROMPT },
        { role: 'user', content: buildCopilotPrompt(command, context) },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    },
    'copilot',
  );

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`${providerLabel} response did not include content.`);
  }

  return extractCopilotPlanJSON(content);
}

async function callCopilotPlanClaude(
  command: string,
  context: CopilotCommandContext,
  apiKey: string,
): Promise<CopilotPlanResult> {
  const data = await postClaude(
    apiKey,
    {
      model: getConfiguredModel('claude', 'text'),
      max_tokens: 1024,
      system: COPILOT_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildCopilotPrompt(command, context),
        },
      ],
      temperature: 0.2,
    },
    'copilot',
  );

  const content = data.content?.find((item) => item.text)?.text;
  if (!content) {
    throw new Error('Claude response did not include content.');
  }

  return extractCopilotPlanJSON(content);
}

function normalizeImageDataUrl(base64Image: string): string {
  return base64Image.startsWith('data:image/')
    ? base64Image
    : `data:image/jpeg;base64,${base64Image}`;
}

function toClaudeImageSource(base64Image: string): {
  mediaType: string;
  data: string;
} {
  const dataUrlMatch = base64Image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  if (dataUrlMatch?.[1] && dataUrlMatch[2]) {
    return {
      mediaType: dataUrlMatch[1],
      data: dataUrlMatch[2],
    };
  }

  return {
    mediaType: 'image/jpeg',
    data: base64Image,
  };
}

function parseScheduleJSON(content: string, providerLabel: string): ScheduleExtractionResult {
  const parsed =
    tryParseJSON(content) ??
    tryParseCodeBlockJSON(content) ??
    tryParseBraceJSON(content);

  if (!parsed) {
    throw new Error(`${providerLabel} vision response did not contain valid JSON.`);
  }

  return normalizeScheduleExtraction(parsed, providerLabel);
}

function normalizeScheduleExtraction(
  raw: unknown,
  providerLabel: string,
): ScheduleExtractionResult {
  if (!isRecord(raw) || !Array.isArray(raw.courses)) {
    throw new Error(`${providerLabel} vision response must include a courses array.`);
  }

  return {
    courses: raw.courses
      .map((item) => normalizeScheduleCourse(item))
      .filter((item): item is ScheduleCourse => item !== null),
  };
}

function normalizeScheduleCourse(raw: unknown): ScheduleCourse | null {
  if (!isRecord(raw)) return null;

  const title = getOptionalString(raw.title) ?? getOptionalString(raw.name);
  const dayOfWeek = normalizeDayOfWeek(raw.dayOfWeek ?? raw.day_of_week);
  const startPeriod = normalizePeriod(raw.startPeriod ?? raw.start_period);
  const endPeriod = normalizePeriod(raw.endPeriod ?? raw.end_period);

  if (!title || dayOfWeek === null || startPeriod === null || endPeriod === null) {
    return null;
  }

  const location = getOptionalString(raw.location);
  const teacher = getOptionalString(raw.teacher);

  return {
    title,
    dayOfWeek,
    startPeriod: Math.min(startPeriod, endPeriod),
    endPeriod: Math.max(startPeriod, endPeriod),
    ...(location ? { location } : {}),
    ...(teacher ? { teacher } : {}),
  };
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeDayOfWeek(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 7) {
      return parsed;
    }
  }

  return null;
}

async function extractScheduleWithOpenAICompatible(
  base64Image: string,
  apiKey: string,
  provider: ByokProvider,
): Promise<ScheduleExtractionResult> {
  const providerLabel = getProviderLabel(provider);
  const imageUrl = normalizeImageDataUrl(base64Image);
  const data = await postOpenAICompatible(
    provider,
    apiKey,
    {
      model: getConfiguredModel(provider, 'vision'),
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: SCHEDULE_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Parse this timetable image.' },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
    },
    'vision',
  );

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`${providerLabel} vision response did not include content.`);
  }

  return parseScheduleJSON(content, providerLabel);
}

async function extractScheduleWithClaude(
  base64Image: string,
  apiKey: string,
): Promise<ScheduleExtractionResult> {
  const image = toClaudeImageSource(base64Image);
  const data = await postClaude(
    apiKey,
    {
      model: getConfiguredModel('claude', 'vision'),
      max_tokens: 2048,
      system: SCHEDULE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Parse this timetable image.' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: image.mediaType,
                data: image.data,
              },
            },
          ],
        },
      ],
      temperature: 0.1,
    },
    'vision',
  );

  const content = data.content?.find((item) => item.text)?.text;
  if (!content) {
    throw new Error('Claude vision response did not include content.');
  }

  return parseScheduleJSON(content, 'Claude');
}

export async function extractScheduleFromImage(
  base64Image: string,
): Promise<ScheduleExtractionResult> {
  const provider = getConfiguredProvider();
  const apiKey = getByokApiKey(provider);

  if (!apiKey) {
    throw new Error('Configure a BYOK API key in Settings first.');
  }

  if (provider === 'claude') {
    return extractScheduleWithClaude(base64Image, apiKey);
  }

  return extractScheduleWithOpenAICompatible(base64Image, apiKey, provider);
}

export async function streamTaskBreakdown(
  parentTaskTitle: string,
  freeSlotsMap?: string,
): Promise<TaskBreakdownResult> {
  const provider = getConfiguredProvider();
  const apiKey = getByokApiKey(provider);

  if (!apiKey) {
    throw new Error(`No ${getProviderLabel(provider)} API key found. Configure BYOK in Settings.`);
  }

  if (provider === 'claude') {
    return callClaude(parentTaskTitle, freeSlotsMap, apiKey);
  }

  return callOpenAICompatible(parentTaskTitle, freeSlotsMap, apiKey, provider);
}

export async function planCopilotCommand(
  command: string,
  context: CopilotCommandContext,
): Promise<CopilotPlanResult> {
  const provider = getConfiguredProvider();
  const apiKey = getByokApiKey(provider);

  if (!apiKey) {
    throw new Error(`No ${getProviderLabel(provider)} API key found. Configure BYOK in Settings.`);
  }

  if (provider === 'claude') {
    return callCopilotPlanClaude(command, context, apiKey);
  }

  return callCopilotPlanOpenAICompatible(command, context, apiKey, provider);
}

export function isAIConfigured(): boolean {
  return getByokApiKey(getConfiguredProvider()) !== null;
}

export type {
  CopilotAction,
  CopilotCommandContext,
  CopilotPlanResult,
  ScheduledSubTask,
  TaskBreakdownResult,
} from './ByokConnector.types';
