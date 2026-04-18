/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY?: string;
  readonly GEMINI_API_KEY?: string;
  readonly API_KEY?: string;
  readonly VITE_OPENROUTER_API_KEY?: string;
  readonly OPENROUTER_API_KEY?: string;
  
  // Vertex AI specific variables
  readonly VITE_VERTEX_PROJECT_ID?: string;
  readonly VITE_VERTEX_LOCATION?: string;
  readonly VITE_VERTEX_ACCESS_TOKEN?: string; // Requires standard OAuth token for frontend browser access
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
