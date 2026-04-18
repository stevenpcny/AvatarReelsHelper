// On Cloud Run, all Gemini calls go through the Python backend via /api/generate.
// Only OpenRouter (user-supplied key) is still accessed directly from the frontend.

export const getOpenRouterApiKey = (): string => {
  if (import.meta.env.VITE_OPENROUTER_API_KEY) return import.meta.env.VITE_OPENROUTER_API_KEY;
  if (import.meta.env.OPENROUTER_API_KEY) return import.meta.env.OPENROUTER_API_KEY;
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.VITE_OPENROUTER_API_KEY) return process.env.VITE_OPENROUTER_API_KEY;
    if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  }
  return '';
};
