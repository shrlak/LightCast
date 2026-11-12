// Where the recognition pipeline (ported from shrlak/ppt) reaches the church Worker.
//
// The site calls the Worker straight from the browser; LightCast goes through its own local server
// (server/recognition.mjs), which adds the Worker's allowed origin — or, with the operator's own
// GEMINI_API_KEY / OPENROUTER_API_KEY, calls Google / OpenRouter itself. No key is ever in the app.
export const RECOGNITION_PROXY = '/api/recognition';
