#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

dotenv.config();

// Initialize database
const adapter = new JSONFile('apps.json');
const defaultData = { apps: [], nextPort: 3100 };
const db = new Low(adapter, defaultData);

// Initialize default data
await db.read();

class CerebrasAppGenerator {
  constructor() {
    this.apiKey = process.env.CEREBRAS_API_KEY;
    if (!this.apiKey) {
      console.error('❌ CEREBRAS_API_KEY environment variable is required');
      process.exit(1);
    }
  }

  generateAppName(prompt) {
    // Extract key words and create descriptive name
    const words = prompt.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => !['a', 'an', 'the', 'with', 'and', 'or', 'but', 'build', 'create', 'make'].includes(word))
      .slice(0, 3);
    
    const appName = words.join('-') || 'generated-app';
    
    // Security: Sanitize app name for safe use in shell commands and paths
    return this.sanitizeName(appName);
  }

  sanitizeName(name) {
    // Only allow alphanumeric characters, hyphens, and underscores
    // Remove any path separators or shell injection characters
    return name.replace(/[^a-zA-Z0-9\-_]/g, '').toLowerCase();
  }

  validateFilePath(filePath) {
    // Security: Prevent path traversal attacks
    const normalizedPath = path.normalize(filePath);
    
    // Check for directory traversal attempts
    if (normalizedPath.includes('..') || normalizedPath.startsWith('/') || normalizedPath.includes('\\')) {
      throw new Error(`Unsafe file path detected: ${filePath}`);
    }
    
    // Ensure path doesn't escape the tmp directory structure
    if (!normalizedPath.startsWith('tmp/')) {
      throw new Error(`File path must be within tmp directory: ${filePath}`);
    }
    
    return normalizedPath;
  }

  async analyzeAppStructure(prompt) {
    console.log(`🔍 Analyzing app structure for: "${prompt}"`);
    
    const analysisPrompt = `Analyze this app request and determine the optimal structure:

REQUEST: "${prompt}"

Please respond with ONLY a JSON object containing:
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
    
    try {
      const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: "qwen-3-coder-480b",
          stream: false,
          max_tokens: 1000,
          temperature: 0.3,
          top_p: 0.8,
          messages: [{ role: "user", content: analysisPrompt }]
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const analysis = JSON.parse(data.choices[0].message.content);
      
      console.log(`📊 Analysis: ${analysis.appType} app with ${analysis.framework} + ${analysis.buildTool}`);
      console.log(`🎨 Styling: ${analysis.styling}, 🗄️ DB: ${analysis.database}, 🔐 Auth: ${analysis.authentication}`);
      
      return analysis;
    } catch (error) {
      console.log(`⚠️  Analysis failed, using fallback detection: ${error.message}`);
      return this.fallbackAppAnalysis(prompt);
    }
  }

  fallbackAppAnalysis(prompt) {
    // Fallback to simple keyword detection if LLM analysis fails
    const frontendKeywords = ['react', 'vue', 'svelte', 'frontend', 'spa', 'vite', 'component', 'ui', 'interface'];
    const backendKeywords = ['api', 'rest', 'server', 'backend', 'express', 'database', 'auth', 'sqlite', 'postgres'];
    const fullstackKeywords = ['full-stack', 'fullstack', 'full stack', 'frontend and backend', 'track', 'store', 'save'];
    
    const promptLower = prompt.toLowerCase();
    const frontendScore = frontendKeywords.filter(keyword => promptLower.includes(keyword)).length;
    const backendScore = backendKeywords.filter(keyword => promptLower.includes(keyword)).length;
    const fullstackScore = fullstackKeywords.filter(keyword => promptLower.includes(keyword)).length;
    
    // Enhanced full-stack detection
    const hasBothFrontendAndBackend = (frontendScore > 0 && backendScore > 0) || 
                                    (promptLower.includes('track') && promptLower.includes('ui')) ||
                                    (promptLower.includes('spa') && promptLower.includes('api'));
    
    const appType = hasBothFrontendAndBackend || fullstackScore > 0 ? 'fullstack' : 
                   (frontendScore > backendScore ? 'frontend' : 'backend');
    
    return {
      appType,
      framework: promptLower.includes('react') ? 'react' : 'vanilla',
      buildTool: promptLower.includes('vite') ? 'vite' : 'none',
      styling: promptLower.includes('tailwind') ? 'tailwind' : 'css',
      database: promptLower.includes('sqlite') ? 'sqlite' : 'none',
      authentication: promptLower.includes('auth') || promptLower.includes('login') ? 'true' : 'false',
      serverFile: appType === 'fullstack' || appType === 'backend' ? 'server.js' : 'none',
      staticBuild: appType === 'fullstack' ? 'true' : 'false',
      deployment: 'docker',
      missingFiles: [],
      recommendations: []
    };
  }

  async scaffoldWithVite(appName, appPath) {
    console.log(`🚀 Scaffolding with Vite for ${appName}...`);
    
    try {
      // Create Vite project in a temporary location
      const tempDir = path.join(path.dirname(appPath), `temp-${appName}`);
      
      // Ensure temp directory exists
      await fs.mkdir(tempDir, { recursive: true });
      
      // Try different approaches for creating Vite project
      let success = false;
      
      // Approach 1: Try npm create vite@latest
      try {
        console.log(`📦 Trying npm create vite@latest...`);
        execSync(`npm create vite@latest ${appName} -- --template vanilla --yes`, { 
          cwd: tempDir,
          stdio: 'inherit',
          timeout: 60000 // 60 second timeout
        });
        success = true;
      } catch (error) {
        console.log(`⚠️  npm create vite@latest failed: ${error.message}`);
        
        // Approach 2: Try npx create-vite
        try {
          console.log(`📦 Trying npx create-vite...`);
          execSync(`npx create-vite@latest ${appName} --template vanilla --yes`, { 
            cwd: tempDir,
            stdio: 'inherit',
            timeout: 60000
          });
          success = true;
        } catch (error2) {
          console.log(`⚠️  npx create-vite failed: ${error2.message}`);
          
          // Approach 3: Manual Vite setup
          console.log(`📦 Creating manual Vite setup...`);
          await this.createManualViteSetup(appName, tempDir);
          success = true;
        }
      }
      
      if (!success) {
        throw new Error('All Vite scaffolding approaches failed');
      }
      
      // Move files from scaffolded directory to our app directory
      const scaffoldPath = path.join(tempDir, appName);
      const files = await fs.readdir(scaffoldPath);
      
      for (const file of files) {
        const sourcePath = path.join(scaffoldPath, file);
        const destPath = path.join(appPath, file);
        
        if ((await fs.stat(sourcePath)).isDirectory()) {
          await fs.cp(sourcePath, destPath, { recursive: true });
        } else {
          await fs.copyFile(sourcePath, destPath);
        }
      }
      
      // Clean up temporary directory
      await fs.rm(tempDir, { recursive: true, force: true });
      
      // Install dependencies
      try {
        execSync('npm install', { cwd: appPath, stdio: 'inherit', timeout: 120000 });
      } catch (installError) {
        console.log(`⚠️  npm install failed, continuing without dependencies: ${installError.message}`);
      }
      
      console.log(`✅ Vite scaffolding completed for ${appName}`);
      return true;
    } catch (error) {
      console.error(`❌ Vite scaffolding failed: ${error.message}`);
      return false;
    }
  }

  async createManualViteSetup(appName, tempDir) {
    const appPath = path.join(tempDir, appName);
    await fs.mkdir(appPath, { recursive: true });
    
    // Create basic Vite files manually
    const packageJson = {
      name: appName,
      private: true,
      version: "0.0.0",
      type: "module",
      scripts: {
        dev: "vite",
        build: "vite build",
        preview: "vite preview"
      },
      dependencies: {
        "react": "^18.2.0",
        "react-dom": "^18.2.0"
      },
      devDependencies: {
        "@types/react": "^18.2.43",
        "@types/react-dom": "^18.2.17",
        "@vitejs/plugin-react": "^4.2.1",
        "vite": "^5.0.8"
      }
    };
    
    const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${appName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`;
    
    const viteConfig = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})`;
    
    const mainJsx = `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)`;
    
    const appJsx = `import { useState } from 'react'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div>
        <a href="https://vitejs.dev" target="_blank">
          <img src="/vite.svg" className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src="/react.svg" className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.jsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  )
}

export default App`;
    
    const indexCss = `:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;

  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;
}

a {
  font-weight: 500;
  color: #646cff;
  text-decoration: inherit;
}
a:hover {
  color: #535bf2;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

h1 {
  font-size: 3.2em;
  line-height: 1.1;
}

button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  background-color: #1a1a1a;
  color: white;
  cursor: pointer;
  transition: border-color 0.25s;
}
button:hover {
  border-color: #646cff;
}
button:focus,
button:focus-visible {
  outline: 4px auto -webkit-focus-ring-color;
}

.card {
  padding: 2em;
}

.read-the-docs {
  color: #888;
}`;
    
    const appCss = `#root {
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}

.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}
.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}
.logo.react:hover {
  filter: drop-shadow(0 0 2em #61dafbaa);
}

@keyframes logo-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: no-preference) {
  a:nth-of-type(2) .logo {
    animation: logo-spin infinite 20s linear;
  }
}

.card {
  padding: 2em;
}

.read-the-docs {
  color: #888;
}`;
    
    // Create directory structure
    await fs.mkdir(path.join(appPath, 'src'), { recursive: true });
    await fs.mkdir(path.join(appPath, 'public'), { recursive: true });
    
    // Write files
    await fs.writeFile(path.join(appPath, 'package.json'), JSON.stringify(packageJson, null, 2));
    await fs.writeFile(path.join(appPath, 'index.html'), indexHtml);
    await fs.writeFile(path.join(appPath, 'vite.config.js'), viteConfig);
    await fs.writeFile(path.join(appPath, 'src/main.jsx'), mainJsx);
    await fs.writeFile(path.join(appPath, 'src/App.jsx'), appJsx);
    await fs.writeFile(path.join(appPath, 'src/index.css'), indexCss);
    await fs.writeFile(path.join(appPath, 'src/App.css'), appCss);
  }

  async enhanceWithLLM(prompt, appName, appPath, analysis) {
    console.log(`🤖 Enhancing ${appName} with LLM customization...`);
    
    let enhancementPrompt = `${prompt}. 

ANALYSIS RESULTS:
- App Type: ${analysis.appType}
- Framework: ${analysis.framework}
- Build Tool: ${analysis.buildTool}
- Styling: ${analysis.styling}
- Database: ${analysis.database}
- Authentication: ${analysis.authentication}

REQUIREMENTS:`;

    if (analysis.appType === 'frontend') {
      enhancementPrompt += `
- Modern frontend with ${analysis.framework} and ${analysis.buildTool}
- ${analysis.styling} styling
- Interactive features and responsive design
- IMPORTANT: In main.jsx, import the CSS file: import './index.css'
- CRITICAL: Always create src/index.css with @import "tailwindcss";
- CRITICAL: For Tailwind CSS v4, create postcss.config.js with proper PostCSS plugin
- CRITICAL: Always create index.html in the root directory for Vite apps`;
    } else if (analysis.appType === 'backend') {
      enhancementPrompt += `
- ${analysis.framework} server setup
- API routes and controllers
- ${analysis.database} database integration
- ${analysis.authentication === 'true' ? 'Authentication and security' : 'Basic API endpoints'}
- Proper error handling`;
    } else if (analysis.appType === 'fullstack') {
      enhancementPrompt += `
- CRITICAL: Create a full-stack application with both frontend and backend
- Frontend: ${analysis.framework} + ${analysis.buildTool} + ${analysis.styling}
- Backend: Express.js server with API routes
- Database: ${analysis.database} integration
- IMPORTANT: Create server.js that serves both API and built frontend
- CRITICAL: API routes must come BEFORE the catch-all route that serves index.html
- CRITICAL: Include express in dependencies and fs import in server.js
- CRITICAL: For full-stack apps, build frontend and serve via Express
- CRITICAL: Always create index.html in the root directory for Vite apps with proper HTML content
- CRITICAL: Always create src/main.jsx and src/App.jsx for React apps
- CRITICAL: Always create src/index.css with @import "tailwindcss"; for Tailwind v4
- CRITICAL: For Tailwind CSS v4, create postcss.config.js with proper PostCSS plugin
- CRITICAL: index.html must contain proper HTML structure with <!DOCTYPE html>, <html>, <head>, <body>, and <div id="root"></div>
- ${analysis.authentication === 'true' ? 'Authentication system' : 'Basic functionality'}`;
    }

    if (analysis.missingFiles.length > 0) {
      enhancementPrompt += `\n\nCRITICAL: Ensure these files are created: ${analysis.missingFiles.join(', ')}`;
    } else {
      // Always ensure index.html exists for Vite apps
      if (analysis.buildTool === 'vite') {
        enhancementPrompt += `\n\nCRITICAL: Always create index.html in the root directory for Vite apps`;
      }
    }

    if (analysis.missingDependencies && analysis.missingDependencies.length > 0) {
      enhancementPrompt += `\n\nCRITICAL: Ensure these dependencies are included in package.json: ${analysis.missingDependencies.join(', ')}`;
    }

    if (analysis.recommendations.length > 0) {
      enhancementPrompt += `\n\nRECOMMENDATIONS: ${analysis.recommendations.join(', ')}`;
    }

    enhancementPrompt += `

IMPORTANT: All JSON files (like package.json) must be valid JSON - no template literals, JavaScript expressions, or markdown code blocks. Just write the raw JSON content.
Use this syntax for each file: <file path="filename.js">file content here</file>.`;
    
    return await this.chatWithCerebras(enhancementPrompt, appName, appPath);
  }

  async chatWithCerebras(prompt, appName, appPath) {
    console.log(`🤖 Generating ${appName}...`);
    const startTime = Date.now();

    const enhancedPrompt = `${prompt}. Use this syntax for each file: <file path="filename.js">file content here</file>. Make it a complete working application with proper structure. 

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

    const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: "qwen-3-coder-480b",
        stream: false,
        max_tokens: 40000,
        temperature: 0.7,
        top_p: 0.8,
        messages: [{ role: "user", content: enhancedPrompt }]
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const endTime = Date.now();
    const latency = endTime - startTime;
    
    const output = data.choices[0].message.content;
    const usage = data.usage;
    
    console.log(`⚡ Latency: ${latency}ms`);
    console.log(`📊 Tokens - Prompt: ${usage.prompt_tokens}, Completion: ${usage.completion_tokens}, Total: ${usage.total_tokens}`);
    
    // Save response for parsing
    await fs.writeFile(path.join(appPath, 'response.txt'), output);
    
    return { output, latency, usage };
  }

  async parseAndCreateFiles(appPath, output) {
    const fileRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g;
    let match;
    const createdFiles = [];

    while ((match = fileRegex.exec(output)) !== null) {
      const originalPath = match[1];
      let fileContent = match[2].trim();
      
      // Security: Validate file path before creating
      try {
        // Check the relative path within the app directory
        const relativePath = path.normalize(originalPath);
        if (relativePath.includes('..') || relativePath.startsWith('/') || relativePath.includes('\\')) {
          console.log(`⚠️  Skipping unsafe file path: ${originalPath}`);
          continue;
        }
        
        const filePath = path.join(appPath, relativePath);
        
        // Ensure the resolved path is still within the app directory
        if (!filePath.startsWith(appPath)) {
          console.log(`⚠️  Skipping file outside app directory: ${originalPath}`);
          continue;
        }
        
        // Clean up files that might have markdown code blocks
        if (originalPath.endsWith('.json')) {
          fileContent = this.cleanJsonContent(fileContent);
        } else if (originalPath.endsWith('.css')) {
          fileContent = this.cleanCssContent(fileContent);
        } else if (originalPath.endsWith('.js') || originalPath.endsWith('.jsx') || originalPath.endsWith('.ts') || originalPath.endsWith('.tsx')) {
          fileContent = this.cleanJsContent(fileContent);
        } else if (originalPath.endsWith('.html')) {
          fileContent = this.cleanHtmlContent(fileContent);
        }
        
        console.log(`📄 Creating file: ${relativePath}`);
        
        // Create directory if it doesn't exist
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        
        await fs.writeFile(filePath, fileContent);
        createdFiles.push(relativePath);
        
      } catch (error) {
        console.log(`⚠️  Skipping invalid file: ${originalPath} - ${error.message}`);
      }
    }
    
    return createdFiles;
  }

  cleanJsonContent(content) {
    // Remove markdown code block syntax
    content = content.replace(/^```json\s*\n/, '');
    content = content.replace(/\n```$/, '');
    content = content.replace(/^```\s*\n/, '');
    content = content.replace(/\n```$/, '');
    
    // Remove any leading/trailing whitespace
    content = content.trim();
    
    return content;
  }

  cleanCssContent(content) {
    // Remove markdown code block syntax from CSS files
    content = content.replace(/^```css\s*\n/, '');
    content = content.replace(/\n```$/, '');
    content = content.replace(/^```\s*\n/, '');
    content = content.replace(/\n```$/, '');
    
    // Remove any leading/trailing whitespace
    content = content.trim();
    
    return content;
  }

  cleanJsContent(content) {
    // Remove markdown code block syntax from JS/JSX files
    content = content.replace(/^```javascript\s*\n/, '');
    content = content.replace(/^```js\s*\n/, '');
    content = content.replace(/^```jsx\s*\n/, '');
    content = content.replace(/\n```$/, '');
    content = content.replace(/^```\s*\n/, '');
    content = content.replace(/\n```$/, '');
    
    // Remove any leading/trailing whitespace
    content = content.trim();
    
    return content;
  }

  cleanHtmlContent(content) {
    // Remove markdown code block syntax from HTML files
    content = content.replace(/^```html\s*\n/, '');
    content = content.replace(/\n```$/, '');
    content = content.replace(/^```\s*\n/, '');
    content = content.replace(/\n```$/, '');
    
    // Remove any leading/trailing whitespace
    content = content.trim();
    
    return content;
  }

  async checkPortAvailability(port) {
    try {
      // Check if port is already in use by checking if we can bind to it
      const { spawn } = await import('child_process');
      return new Promise((resolve) => {
        const testProcess = spawn('lsof', ['-i', `:${port}`], { stdio: 'ignore' });
        testProcess.on('close', (code) => {
          // If lsof returns 0, port is in use; if 1, port is free
          resolve(code === 1);
        });
        testProcess.on('error', () => {
          // If lsof fails, assume port is available
          resolve(true);
        });
      });
    } catch (error) {
      // Fallback: assume port is available if we can't check
      return true;
    }
  }

  async findAvailablePort(startPort) {
    let port = startPort;
    const maxAttempts = 100; // Prevent infinite loop
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      const isAvailable = await this.checkPortAvailability(port);
      if (isAvailable) {
        return port;
      }
      port++;
      attempts++;
    }
    
    throw new Error(`Could not find available port starting from ${startPort}`);
  }

  async applyPostGenerationFixes(appPath, analysis) {
    try {
      const packageJsonPath = path.join(appPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      let modified = false;

      // Fix 1: Add "type": "module" for ES modules
      if (!packageJson.type) {
        packageJson.type = 'module';
        modified = true;
        console.log(`🔧 Fixed: Added "type": "module" to package.json`);
      }

      // Fix 2: Ensure React dependencies are present for React apps
      if (analysis.framework === 'react' && (!packageJson.dependencies?.react || !packageJson.dependencies?.['react-dom'])) {
        if (!packageJson.dependencies) packageJson.dependencies = {};
        if (!packageJson.dependencies.react) packageJson.dependencies.react = '^18.2.0';
        if (!packageJson.dependencies['react-dom']) packageJson.dependencies['react-dom'] = '^18.2.0';
        modified = true;
        console.log(`🔧 Fixed: Added React dependencies to package.json`);
      }

      // Fix 3: Ensure Express is present for backend/fullstack apps
      if ((analysis.appType === 'backend' || analysis.appType === 'fullstack') && !packageJson.dependencies?.express) {
        if (!packageJson.dependencies) packageJson.dependencies = {};
        packageJson.dependencies.express = '^4.18.2';
        modified = true;
        console.log(`🔧 Fixed: Added Express dependency to package.json`);
      }

      // Fix 4: Ensure SQLite is present for database apps
      if (analysis.database === 'sqlite' && !packageJson.dependencies?.sqlite3) {
        if (!packageJson.dependencies) packageJson.dependencies = {};
        packageJson.dependencies.sqlite3 = '^5.1.7';
        modified = true;
        console.log(`🔧 Fixed: Added SQLite dependency to package.json`);
      }

      // Fix 5: Ensure Tailwind CSS v4 PostCSS plugin is present
      if (analysis.styling === 'tailwind' && packageJson.devDependencies?.tailwindcss && !packageJson.devDependencies?.['@tailwindcss/postcss']) {
        if (!packageJson.devDependencies) packageJson.devDependencies = {};
        packageJson.devDependencies['@tailwindcss/postcss'] = '^4.1.11';
        modified = true;
        console.log(`🔧 Fixed: Added @tailwindcss/postcss dependency to package.json`);
      }

      // Write back if modified
      if (modified) {
        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
      }

      // Fix 5: Ensure index.html exists and has proper content
      const indexPath = path.join(appPath, 'index.html');
      try {
        const indexContent = await fs.readFile(indexPath, 'utf8');
        if (!indexContent.trim()) {
          // Generate proper index.html for Vite apps
          const htmlContent = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${packageJson.name || 'App'}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`;
          await fs.writeFile(indexPath, htmlContent);
          console.log(`🔧 Fixed: Generated proper index.html content`);
        }
      } catch (error) {
        // index.html doesn't exist, create it
        const htmlContent = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${packageJson.name || 'App'}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`;
        await fs.writeFile(indexPath, htmlContent);
        console.log(`🔧 Fixed: Created missing index.html file`);
      }

      // Fix 6: Ensure PostCSS config exists for Tailwind CSS v4
      if (analysis.styling === 'tailwind' && packageJson.devDependencies?.tailwindcss) {
        const postcssConfigPath = path.join(appPath, 'postcss.config.js');
        try {
          await fs.access(postcssConfigPath);
        } catch (error) {
          // PostCSS config doesn't exist, create it
          const postcssConfig = `import tailwindcss from "@tailwindcss/postcss";

export default {
  plugins: [tailwindcss]
}`;
          await fs.writeFile(postcssConfigPath, postcssConfig);
          console.log(`🔧 Fixed: Created missing postcss.config.js for Tailwind CSS v4`);
        }

        // Fix 7: Ensure CSS file uses correct Tailwind v4 import syntax
        const cssPath = path.join(appPath, 'src/index.css');
        try {
          const cssContent = await fs.readFile(cssPath, 'utf8');
          if (cssContent.includes('@tailwind') && !cssContent.includes('@import "tailwindcss"')) {
            // Replace old @tailwind directives with new @import syntax
            const updatedCss = cssContent.replace(/@tailwind\s+[^;]+;/g, '@import "tailwindcss";');
            await fs.writeFile(cssPath, updatedCss);
            console.log(`🔧 Fixed: Updated CSS file to use Tailwind CSS v4 @import syntax`);
          }
        } catch (error) {
          // CSS file doesn't exist or can't be read, that's okay
        }
      }
    } catch (error) {
      console.log(`⚠️  Could not apply post-generation fixes: ${error.message}`);
    }
  }

  async buildAndRunDocker(appName, appPath, port) {
    try {
      // Security: Sanitize app name for Docker commands
      appName = this.sanitizeName(appName);
      
      console.log(`🐳 Building Docker image for ${appName}...`);
      
      // Create or regenerate Dockerfile
      const dockerfilePath = path.join(appPath, 'Dockerfile');
      
      // Enhanced app type detection
      const packageJsonPath = path.join(appPath, 'package.json');
      let appType = 'backend-only';
      
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
        const hasVite = packageJson.devDependencies?.vite || packageJson.dependencies?.vite;
        const hasExpress = packageJson.dependencies?.express;
        const hasServerFile = await fs.access(path.join(appPath, 'server.js')).then(() => true).catch(() => false);
        
        if (hasVite && hasExpress && hasServerFile) {
          appType = 'fullstack';
          console.log(`🔍 Detected full-stack app: Vite frontend + Express backend`);
        } else if (hasVite) {
          appType = 'frontend-only';
          console.log(`🔍 Detected frontend-only app: Vite build`);
        } else if (hasExpress || hasServerFile) {
          appType = 'backend-only';
          console.log(`🔍 Detected backend-only app: Express server`);
        }
      } catch (error) {
        console.log(`⚠️  Could not analyze package.json, using backend-only template: ${error.message}`);
      }
      
             // Select appropriate Dockerfile template
       let templatePath;
       const currentDir = path.dirname(fileURLToPath(import.meta.url));
       switch (appType) {
         case 'fullstack':
           templatePath = path.join(currentDir, 'templates/Dockerfile.fullstack');
           break;
         case 'frontend-only':
           templatePath = path.join(currentDir, 'templates/Dockerfile.frontend-only');
           break;
         case 'backend-only':
         default:
           templatePath = path.join(currentDir, 'templates/Dockerfile.backend-only');
           break;
       }
      
      // Copy template to app directory
      const dockerfile = await fs.readFile(templatePath, 'utf8');
      await fs.writeFile(dockerfilePath, dockerfile);

      // Security: Use absolute paths and validate port number
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error(`Invalid port number: ${port}`);
      }

      // Build Docker image
      execSync(`docker build -t "${appName}" "${appPath}"`, { stdio: 'inherit' });
      
      // Stop existing container if it exists
      try {
        execSync(`docker stop "${appName}"`, { stdio: 'ignore' });
        execSync(`docker rm "${appName}"`, { stdio: 'ignore' });
      } catch {}

      // Check if container name is already in use
      try {
        const containerExists = execSync(`docker ps -a --filter "name=${appName}" --format "{{.Names}}"`, { encoding: 'utf8' }).trim();
        if (containerExists) {
          console.log(`⚠️  Container name ${appName} already exists, using unique name`);
          const uniqueName = `${appName}-${Date.now()}`;
          appName = uniqueName;
        }
      } catch {}

      // Run new container
      console.log(`🚀 Starting container on port ${port}...`);
      execSync(`docker run -d --name "${appName}" -p ${port}:3000 "${appName}"`, { stdio: 'inherit' });
      
      return { success: true, port, appType };
    } catch (error) {
      console.error(`❌ Docker error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async createApp(prompt) {
    const appName = this.generateAppName(prompt);
    const appPath = path.join('./tmp', appName);
    
    // Check if app already exists
    const existingApp = db.data.apps.find(app => app.name === appName);
    if (existingApp) {
      console.log(`⚠️  App ${appName} already exists. Use --remove to delete it first.`);
      return;
    }

    // Create app directory
    await fs.mkdir(appPath, { recursive: true });
    
    try {
      // Analyze app structure intelligently
      const analysis = await this.analyzeAppStructure(prompt);
      const appType = analysis.appType;
      
      let output, latency, usage;
      
      // Use intelligent approach based on analysis
      if (appType === 'frontend' && analysis.buildTool === 'vite') {
        console.log(`🔄 Using hybrid approach: Vite scaffolding + LLM enhancement`);
        
        // Scaffold with Vite first
        const scaffoldSuccess = await this.scaffoldWithVite(appName, appPath);
        
        if (scaffoldSuccess) {
          // Then enhance with LLM using analysis
          const result = await this.enhanceWithLLM(prompt, appName, appPath, analysis);
          output = result.output;
          latency = result.latency;
          usage = result.usage;
        } else {
          // Fallback to pure LLM generation
          console.log(`⚠️  Vite scaffolding failed, falling back to pure LLM generation`);
          const result = await this.chatWithCerebras(prompt, appName, appPath);
          output = result.output;
          latency = result.latency;
          usage = result.usage;
        }
      } else {
        // Use pure LLM generation with analysis context
        const result = await this.chatWithCerebras(prompt, appName, appPath);
        output = result.output;
        latency = result.latency;
        usage = result.usage;
      }
      
      // Parse and create files
      const createdFiles = await this.parseAndCreateFiles(appPath, output);
      
      // Post-generation fixes for common issues
      await this.applyPostGenerationFixes(appPath, analysis);
      
      // Validate critical files for Vite apps
      if (analysis.buildTool === 'vite') {
        const criticalFiles = ['index.html', 'src/main.jsx', 'src/App.jsx', 'src/index.css'];
        const missingFiles = [];
        
        for (const file of criticalFiles) {
          try {
            await fs.access(path.join(appPath, file));
          } catch {
            missingFiles.push(file);
          }
        }
        
        if (missingFiles.length > 0) {
          console.log(`⚠️  Missing critical files: ${missingFiles.join(', ')}`);
          console.log(`⚠️  This may cause build failures. Consider regenerating the app.`);
        }
      }
      
      // Find available port
      const port = await this.findAvailablePort(db.data.nextPort);
      console.log(`🔌 Using port ${port} for ${appName}`);
      
      // Update next port for future apps
      db.data.nextPort = port + 1;
      
      // Build and run Docker container (after files are created)
      const dockerResult = await this.buildAndRunDocker(appName, appPath, port);
      
      // Save app info to database
      const appInfo = {
        name: appName,
        prompt,
        path: appPath,
        port: dockerResult.success ? port : null,
        createdAt: new Date().toISOString(),
        files: createdFiles,
        performance: { latency, tokens: usage },
        dockerStatus: dockerResult.success ? 'running' : 'failed',
        dockerError: dockerResult.error || null
      };
      
      db.data.apps.push(appInfo);
      await db.write();
      
      if (dockerResult.success) {
        console.log(`✅ App ${appName} created and running successfully!`);
        console.log(`🌐 Running at http://localhost:${port}`);
      } else {
        console.log(`⚠️  App ${appName} files created but Docker build failed!`);
        console.log(`❌ Docker error: ${dockerResult.error}`);
      }
      console.log(`📁 Files created in: ${appPath}`);
      
    } catch (error) {
      console.error(`❌ Error creating app: ${error.message}`);
      // Clean up on error
      try {
        await fs.rm(appPath, { recursive: true, force: true });
      } catch {}
    }
  }

  async listApps() {
    if (db.data.apps.length === 0) {
      console.log('📭 No apps created yet.');
      return;
    }

    console.log('\n📱 Generated Apps:');
    console.log('─'.repeat(80));
    
    for (const app of db.data.apps) {
      const status = app.dockerStatus === 'running' ? '🟢 Running' : '🔴 Stopped';
      const port = app.port ? `:${app.port}` : '';
      console.log(`${status} ${app.name}${port}`);
      console.log(`   📝 ${app.prompt}`);
      console.log(`   📁 ${app.path}`);
      
      // Get volume info if container is running
      if (app.dockerStatus === 'running') {
        try {
          const inspectResult = execSync(`docker inspect "${app.name}" --format='{{json .Mounts}}'`, { encoding: 'utf8' });
          const mounts = JSON.parse(inspectResult);
          const volumes = mounts.filter(mount => mount.Type === 'volume');
          
          for (const volume of volumes) {
            try {
              // Get volume size
              const sizeResult = execSync(`docker exec "${app.name}" du -sh /app/data 2>/dev/null || echo "N/A"`, { encoding: 'utf8' });
              const size = sizeResult.trim().split('\t')[0] || 'N/A';
              console.log(`   💾 Volume: ${volume.Name.substring(0, 12)}... (${size})`);
            } catch {
              console.log(`   💾 Volume: ${volume.Name.substring(0, 12)}... (N/A)`);
            }
          }
        } catch {}
      }
      
      console.log(`   🕐 ${new Date(app.createdAt).toLocaleString()}`);
      console.log();
    }
  }

  async stopApp(appName) {
    // Security: Sanitize app name
    appName = this.sanitizeName(appName);
    
    const app = db.data.apps.find(a => a.name === appName);
    if (!app) {
      console.log(`❌ App ${appName} not found.`);
      return;
    }

    try {
      execSync(`docker stop "${appName}"`, { stdio: 'ignore' });
      app.dockerStatus = 'stopped';
      await db.write();
      console.log(`🛑 Stopped ${appName}`);
    } catch (error) {
      console.log(`❌ Error stopping ${appName}: ${error.message}`);
    }
  }

  async removeApp(appName) {
    // Security: Sanitize app name
    appName = this.sanitizeName(appName);
    
    const appIndex = db.data.apps.findIndex(a => a.name === appName);
    if (appIndex === -1) {
      console.log(`❌ App ${appName} not found.`);
      return;
    }

    const app = db.data.apps[appIndex];

    try {
      // Get volume names before removing container
      let volumeNames = [];
      try {
        const inspectResult = execSync(`docker inspect "${appName}" --format='{{json .Mounts}}'`, { encoding: 'utf8' });
        const mounts = JSON.parse(inspectResult);
        volumeNames = mounts.filter(mount => mount.Type === 'volume').map(mount => mount.Name);
      } catch {}

      // Stop and remove container
      execSync(`docker stop "${appName}"`, { stdio: 'ignore' });
      execSync(`docker rm "${appName}"`, { stdio: 'ignore' });
      
      // Remove associated volumes
      for (const volumeName of volumeNames) {
        try {
          execSync(`docker volume rm "${volumeName}"`, { stdio: 'ignore' });
          console.log(`🗂️  Removed volume: ${volumeName}`);
        } catch {}
      }
      
      execSync(`docker rmi "${appName}"`, { stdio: 'ignore' });
    } catch {}

    try {
      // Remove files - ensure path is within tmp directory
      if (app.path && app.path.startsWith('./tmp/')) {
        await fs.rm(app.path, { recursive: true, force: true });
      }
    } catch {}

    // Remove from database
    db.data.apps.splice(appIndex, 1);
    await db.write();
    
    console.log(`🗑️  Removed ${appName} completely`);
  }
}

// CLI setup
const generator = new CerebrasAppGenerator();

const argv = await yargs(hideBin(process.argv))
  .usage('Usage: $0 [prompt] [options]')
  .command('$0 [prompt]', 'Generate a new app', {
    prompt: {
      describe: 'Prompt for app generation',
      type: 'string'
    }
  }, async (argv) => {
    if (argv.prompt) {
      await generator.createApp(argv.prompt);
    } else if (!argv.list && !argv.stop && !argv.remove) {
      console.log('❌ Please provide a prompt or use --help for options');
    }
  })
  .option('list', {
    alias: 'l',
    describe: 'List all generated apps',
    type: 'boolean'
  })
  .option('stop', {
    alias: 's',
    describe: 'Stop a running app',
    type: 'string'
  })
  .option('remove', {
    alias: 'r',
    describe: 'Remove an app completely',
    type: 'string'
  })
  .help()
  .parse();

// Handle options
if (argv.list) {
  await generator.listApps();
} else if (argv.stop) {
  await generator.stopApp(argv.stop);
} else if (argv.remove) {
  await generator.removeApp(argv.remove);
}