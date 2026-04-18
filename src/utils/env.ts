export const getGeminiApiKey = (): string => {
  // 1. Vite env prefixed
  if (import.meta.env.VITE_GEMINI_API_KEY) return import.meta.env.VITE_GEMINI_API_KEY;
  
  // 2. AI Studio unstructured inject / build-time generic key
  if (import.meta.env.GEMINI_API_KEY) return import.meta.env.GEMINI_API_KEY;
  if (import.meta.env.API_KEY) return import.meta.env.API_KEY;
  
  // 3. Fallback to process.env safely for Node contexts (e.g. backend / build process)
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.VITE_GEMINI_API_KEY) return process.env.VITE_GEMINI_API_KEY;
    if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
    if (process.env.API_KEY) return process.env.API_KEY;
  }
  
  return '';
};

export const getOpenRouterApiKey = (): string => {
  // 1. Vite env prefixed
  if (import.meta.env.VITE_OPENROUTER_API_KEY) return import.meta.env.VITE_OPENROUTER_API_KEY;
  
  // 2. AI Studio unstructured inject
  if (import.meta.env.OPENROUTER_API_KEY) return import.meta.env.OPENROUTER_API_KEY;

  // 3. Fallback to process.env
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.VITE_OPENROUTER_API_KEY) return process.env.VITE_OPENROUTER_API_KEY;
    if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  }
  
  return '';
};

export const getVertexProjectId = (): string => {
  if (import.meta.env.VITE_VERTEX_PROJECT_ID) return import.meta.env.VITE_VERTEX_PROJECT_ID;
  if (typeof process !== 'undefined' && process.env?.VITE_VERTEX_PROJECT_ID) return process.env.VITE_VERTEX_PROJECT_ID;
  return '';
};

export const getVertexLocation = (): string => {
  if (import.meta.env.VITE_VERTEX_LOCATION) return import.meta.env.VITE_VERTEX_LOCATION;
  if (typeof process !== 'undefined' && process.env?.VITE_VERTEX_LOCATION) return process.env.VITE_VERTEX_LOCATION;
  return 'us-central1'; // Default Fallback location
};

export const getVertexAccessToken = (): string => {
  if (import.meta.env.VITE_VERTEX_ACCESS_TOKEN) return import.meta.env.VITE_VERTEX_ACCESS_TOKEN;
  if (typeof process !== 'undefined' && process.env?.VITE_VERTEX_ACCESS_TOKEN) return process.env.VITE_VERTEX_ACCESS_TOKEN;
  return '';
};
