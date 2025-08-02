export const generationPrompt = (prompt) => `${prompt}. Use this syntax for each file: <file path="filename.js">file content here</file>. Make it a complete working application with proper structure. 

CRITICAL REQUIREMENTS:
- If using Tailwind CSS v4, include "tailwindcss": "^4.1.11" AND "@tailwindcss/postcss": "^4.1.11" in devDependencies
- CRITICAL: For Tailwind CSS v4, create postcss.config.js with: import tailwindcss from "@tailwindcss/postcss"; export default { plugins: [tailwindcss] }
- CRITICAL: For Tailwind CSS v4, use @import "tailwindcss"; in CSS files instead of old @tailwind directives
- If using any build tools (webpack, vite, etc.), include them in devDependencies
- If using any CSS preprocessors (Sass, Less), include them in devDependencies
- If using EJS templates, include "ejs": "^3.1.10" in dependencies
- If using any template engines (Handlebars, Pug, etc.), include them in dependencies
- If using bcrypt for password hashing, include "bcrypt": "^6.0.0" in dependencies
- If using sessions, include "express-session": "^1.18.2" in dependencies
- If using SQLite database, include "sqlite3": "^5.1.7" in dependencies
- If using body parsing, include "body-parser": "^2.2.0" in dependencies
- If using Express.js, ALWAYS include "express": "^4.18.2" in dependencies
- If using React, ALWAYS include "react": "^18.2.0" and "react-dom": "^18.2.0" in dependencies
- Always include ALL required dependencies in package.json
- For SQLite databases, use path './data/database.db' or './data/[appname].db'
- Ensure all npm scripts reference installed packages only
- Double-check that every require() or import statement has a corresponding dependency in package.json
- IMPORTANT: Review your code and ensure EVERY module you import or require is listed in package.json

FULL-STACK APP REQUIREMENTS:
- For full-stack apps with Vite + Express:
  * Include "express": "^4.18.2" in dependencies
  * Include "fs" import in server.js: import fs from 'fs'
  * Create server.js that serves both API routes AND built frontend
  * API routes MUST come BEFORE the catch-all route that serves index.html
  * Use express.static('dist') to serve built frontend
  * Use res.sendFile(path.join(__dirname, 'dist/index.html')) for catch-all route
  * Ensure proper error handling and database initialization
  * CRITICAL: Always create index.html in the root directory for Vite apps with proper HTML content
  * CRITICAL: Always create src/main.jsx and src/App.jsx for React apps
  * CRITICAL: Always create src/index.css for styling
  * CRITICAL: index.html must contain: <!DOCTYPE html>, <html>, <head>, <body>, <div id="root"></div>, and <script type="module" src="/src/main.jsx"></script>

FRONTEND STACK RECOMMENDATIONS:
- For modern frontend apps, prefer Vite + Tailwind CSS v4 stack:
  * Install: "vite": "^5.0.0", "tailwindcss": "^4.1.11", and "@tailwindcss/postcss": "^4.1.11" in devDependencies
  * Install: "@vitejs/plugin-react": "^4.2.1" in devDependencies
  * Create vite.config.js with: import react from '@vitejs/plugin-react'; export default { plugins: [react()] }
  * CRITICAL: Create postcss.config.js with: import tailwindcss from "@tailwindcss/postcss"; export default { plugins: [tailwindcss] }
  * Use @import "tailwindcss"; in CSS instead of old @tailwind directives
  * Add build script: "build": "vite build" and dev script: "dev": "vite"
- For simple Express apps with Tailwind v4, use the PostCSS approach:
  * Install: "tailwindcss": "^4.1.11" and "@tailwindcss/postcss": "^4.1.11" in devDependencies
  * Create postcss.config.js with: import tailwindcss from "@tailwindcss/postcss"; export default { plugins: [tailwindcss] }
  * Use @import "tailwindcss"; in CSS files

If database storage is needed, use SQLite instead of external databases like Redis or MongoDB.`; 