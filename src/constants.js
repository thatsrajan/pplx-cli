export const BASE_URL = 'https://www.perplexity.ai';

export const HEADERS = {
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'max-age=0',
  'dnt': '1',
  'sec-ch-ua': '"Not;A=Brand";v="24", "Chromium";v="128"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
};

export const MODEL_MAP = {
  auto: { default: 'turbo' },
  pro: {
    default: 'pplx_pro',
    'sonar': 'experimental',
    'gpt-5.2': 'gpt52',
    'claude-4.5-sonnet': 'claude45sonnet',
    'grok-4.1': 'grok41nonreasoning',
  },
  reasoning: {
    default: 'pplx_reasoning',
    'gpt-5.2-thinking': 'gpt52_thinking',
    'claude-4.5-sonnet-thinking': 'claude45sonnetthinking',
    'gemini-3.0-pro': 'gemini30pro',
    'kimi-k2-thinking': 'kimik2thinking',
    'grok-4.1-reasoning': 'grok41reasoning',
  },
  'deep-research': { default: 'pplx_alpha' },
};

export const LABS_MODELS = ['r1-1776', 'sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning'];

export const CONFIG_DIR = `${process.env.HOME}/.config/pplx`;
export const COOKIES_FILE = `${CONFIG_DIR}/cookies.json`;
