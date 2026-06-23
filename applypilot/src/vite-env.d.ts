/// <reference types="vite/client" />

// pdfjs-dist's worker is imported with the `?url` suffix; vite/client provides
// the module declaration for `*?url` imports (default export: string).
