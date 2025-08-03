export const analysisPrompt = (prompt) => `Analyze this app request and determine the optimal structure:

REQUEST: "${prompt}"

IMPORTANT: Respond with ONLY raw JSON - NO markdown, NO code blocks, NO explanations. Just the JSON object:
{
  "appType": "frontend|backend|fullstack",
  "framework": "react|vue|svelte|express|fastify|koa|vanilla",
  "buildTool": "vite|webpack|parcel|none",
  "styling": "tailwind|css|sass|styled-components|none",
  "database": "sqlite|postgres|mongodb|none",
  "authentication": "true|false",
  "serverFile": "server.js|app.js|index.js|none",
  "staticBuild": "true|false",
  "missingFiles": ["index.html", "package.json", "src/main.jsx", "src/App.jsx", "src/index.css"],
  "missingDependencies": ["react", "react-dom", "express", "sqlite3"],
  "recommendations": ["Use Vite for fast builds", "Add authentication", "Use SQLite for simplicity"]
}

CRITICAL RULES:
- If the prompt mentions both UI/frontend AND API/database, classify as "fullstack"
- If using Vite + Express + Database, set staticBuild to "true"
- If using Vite + Express, always include "express" in missingDependencies
- If using React, always include "react" and "react-dom" in missingDependencies
- If using database, always include appropriate database driver in missingDependencies
- For full-stack apps, ensure both frontend build and backend server are configured
- For full-stack apps, set serverFile to "server.js" and staticBuild to "true"

Be specific and practical. Consider the user's exact requirements. For Vite React apps, always include "react" and "react-dom" in missingDependencies.`; 