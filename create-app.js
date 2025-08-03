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
import { analysisPrompt, generationPrompt, createEnhancementPrompt } from './prompts/index.js';
import nunjucks from 'nunjucks';

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
    const words = prompt.trim().toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 0 && !['a', 'an', 'the', 'with', 'and', 'or', 'but', 'build', 'create', 'make'].includes(word))
      .slice(0, 3);
    
    const appName = words.join('-') || 'generated-app';
    
    // Security: Sanitize app name for safe use in shell commands and paths
    return this.sanitizeName(appName);
  }

  sanitizeName(name) {
    // Only allow alphanumeric characters, hyphens, and underscores
    // Remove any path separators or shell injection characters
    let sanitized = name.replace(/[^a-zA-Z0-9\-_]/g, '').toLowerCase();
    
    // Docker tag requirements: cannot start or end with hyphens or underscores
    sanitized = sanitized.replace(/^[-_]+/, '').replace(/[-_]+$/, '');
    
    // Ensure we still have a valid name
    if (!sanitized) {
      sanitized = 'generated-app';
    }
    
    return sanitized;
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
    
    const promptContent = analysisPrompt(prompt);
    
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
          messages: [{ role: "user", content: promptContent }]
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const content = this.cleanJsonContent(data.choices[0].message.content);
      const analysis = JSON.parse(content);
      
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

  async enhanceWithLLM(prompt, appName, appPath, analysis, isImprovement = false) {
    console.log(`🤖 Enhancing ${appName} with LLM customization...`);
    
    const enhancementPrompt = createEnhancementPrompt(prompt, analysis, isImprovement);
    
    return await this.chatWithCerebras(enhancementPrompt, appName, appPath);
  }

  async chatWithCerebras(prompt, appName, appPath) {
    console.log(`🤖 Generating ${appName}...`);
    const startTime = Date.now();

    const enhancedPrompt = generationPrompt(prompt);

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
    const changesRegex = /<changes>([\s\S]*?)<\/changes>/g;
    let match;
    const createdFiles = [];
    let changesExplanation = '';

    // Extract changes explanation
    const changesMatch = changesRegex.exec(output);
    if (changesMatch) {
      changesExplanation = changesMatch[1].trim();
      console.log(`📝 Changes explanation: ${changesExplanation}`);
    }

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
        
        // Check if file already exists
        const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
        const action = fileExists ? 'Updating' : 'Creating';
        console.log(`📄 ${action} file: ${relativePath}`);
        
        // Create directory if it doesn't exist
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        
        await fs.writeFile(filePath, fileContent);
        createdFiles.push(relativePath);
        
      } catch (error) {
        console.log(`⚠️  Skipping invalid file: ${originalPath} - ${error.message}`);
      }
    }
    
    return { createdFiles, changesExplanation };
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

  async detectAppFolders(appPath) {
    console.log(`🔍 Detecting app folders in ${appPath}...`);
    
    const folders = [];
    const excludeDirs = ['node_modules', '.git', '.backups', 'dist', 'build', '.vscode'];
    
    try {
      const entries = await fs.readdir(appPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && !excludeDirs.includes(entry.name)) {
          // Check if folder contains files (not empty)
          try {
            const folderPath = path.join(appPath, entry.name);
            const folderEntries = await fs.readdir(folderPath, { withFileTypes: true });
            const hasFiles = folderEntries.some(item => item.isFile());
            
            if (hasFiles) {
              folders.push(entry.name);
              console.log(`📁 Found app folder: ${entry.name}`);
            }
          } catch (error) {
            console.log(`⚠️  Could not read folder ${entry.name}: ${error.message}`);
          }
        }
      }
      
      console.log(`📊 Detected ${folders.length} app folders: ${folders.join(', ')}`);
      return folders;
    } catch (error) {
      console.log(`⚠️  Could not detect app folders: ${error.message}`);
      return [];
    }
  }

  generateDockerCopyCommands(folders) {
    if (!folders || folders.length === 0) {
      return '';
    }
    
    const copyCommands = folders.map(folder => `COPY ${folder}/ ./${folder}/`).join('\n');
    return copyCommands;
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

      // Fix 8: Ensure Vue files have proper closing tags
      if (analysis.framework === 'vue') {
        const vueFiles = await this.findVueFiles(appPath);
        for (const vueFile of vueFiles) {
          await this.fixVueSyntax(vueFile);
        }
      }
    } catch (error) {
      console.log(`⚠️  Could not apply post-generation fixes: ${error.message}`);
    }
  }

  async findVueFiles(appPath) {
    const vueFiles = [];
    
    async function searchDir(dir) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
            await searchDir(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.vue')) {
            vueFiles.push(fullPath);
          }
        }
      } catch (error) {
        // Directory doesn't exist or can't be read
      }
    }
    
    await searchDir(appPath);
    return vueFiles;
  }

  async fixVueSyntax(vueFilePath) {
    try {
      let content = await fs.readFile(vueFilePath, 'utf8');
      let fixed = false;

      // Check if <script> tag is opened but not closed
      const scriptOpenMatch = content.match(/<script[^>]*>/);
      const scriptCloseMatch = content.match(/<\/script>/);
      
      if (scriptOpenMatch && !scriptCloseMatch) {
        // Add missing </script> tag
        content += '\n</script>';
        fixed = true;
      }

      // Check if <style> section is missing (common in Vue files)
      if (!content.includes('<style') && content.includes('<script>')) {
        content += '\n\n<style scoped>\n/* Add your styles here */\n</style>';
        fixed = true;
      }

      if (fixed) {
        await fs.writeFile(vueFilePath, content);
        console.log(`🔧 Fixed: Vue syntax issues in ${path.basename(vueFilePath)}`);
      }
    } catch (error) {
      console.log(`⚠️  Could not fix Vue syntax in ${vueFilePath}: ${error.message}`);
    }
  }

  async buildAndRunDocker(appName, appPath, port, maxRetries = 3) {
    let attempt = 0;
    let lastError = null;
    let dockerLogs = '';
    
    while (attempt < maxRetries) {
      attempt++;
      console.log(`🐳 Docker build attempt ${attempt}/${maxRetries} for ${appName}...`);
      
      try {
        // Security: Sanitize app name for Docker commands
        appName = this.sanitizeName(appName);
        
        const buildStartTime = Date.now();
        
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
        
        // Smart build strategy: Use optimized Dockerfiles
        const currentDir = path.dirname(fileURLToPath(import.meta.url));
        const useOptimized = process.env.DOCKER_OPTIMIZED !== 'false'; // Default to optimized
        
        let templatePath;
        if (useOptimized) {
          console.log(`⚡ Using optimized Docker build strategy`);
          switch (appType) {
            case 'fullstack':
              templatePath = path.join(currentDir, 'templates/Dockerfile.fullstack.optimized');
              break;
            case 'frontend-only':
              templatePath = path.join(currentDir, 'templates/Dockerfile.frontend-only.optimized');
              break;
            case 'backend-only':
            default:
              templatePath = path.join(currentDir, 'templates/Dockerfile.backend-only.optimized');
              break;
          }
        } else {
          console.log(`🐌 Using legacy Docker build strategy`);
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
        }
        
        // Detect app folders for dynamic Dockerfile generation
        const appFolders = await this.detectAppFolders(appPath);
        
        // Read template and render with nunjucks
        const templateContent = await fs.readFile(templatePath, 'utf8');
        const dockerfile = nunjucks.renderString(templateContent, {
          appFolders: appFolders
        });
        
        // Write rendered Dockerfile to app directory
        await fs.writeFile(dockerfilePath, dockerfile);

        // Security: Use absolute paths and validate port number
        if (!Number.isInteger(port) || port < 1024 || port > 65535) {
          throw new Error(`Invalid port number: ${port}`);
        }

        // Advanced Docker build with BuildKit and caching
        const buildCommand = this.createOptimizedBuildCommand(appName, appPath, useOptimized);
        console.log(`🔨 Build command: ${buildCommand}`);
        
        const dockerBuildStart = Date.now();
        execSync(buildCommand, { stdio: 'inherit' });
        const dockerBuildTime = Date.now() - dockerBuildStart;
        
        console.log(`⚡ Docker build completed in ${dockerBuildTime}ms`);
        
        // Stop existing container if it exists
        try {
          execSync(`docker stop "${appName}"`, { stdio: 'ignore' });
          execSync(`docker rm "${appName}"`, { stdio: 'ignore' });
        } catch {}

        // Check if container name is already in use
        let containerName = appName;
        try {
          const containerExists = execSync(`docker ps -a --filter "name=${appName}" --format "{{.Names}}"`, { encoding: 'utf8' }).trim();
          if (containerExists) {
            console.log(`⚠️  Container name ${appName} already exists, using unique name`);
            containerName = `${appName}-${Date.now()}`;
          }
        } catch {}

        // Run new container (use original appName for image, containerName for container)
        console.log(`🚀 Starting container on port ${port}...`);
        execSync(`docker run -d --name "${containerName}" -p ${port}:3000 "${appName}"`, { stdio: 'inherit' });
        
        // Wait a moment and check if container is running
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check container status
        try {
          const containerStatus = execSync(`docker ps --filter "name=${containerName}" --format "{{.Status}}"`, { encoding: 'utf8' }).trim();
          if (!containerStatus) {
            throw new Error('Container failed to start');
          }
        } catch (error) {
          // Get container logs for debugging
          try {
            dockerLogs = execSync(`docker logs "${containerName}"`, { encoding: 'utf8' });
            console.log(`📋 Container logs: ${dockerLogs}`);
          } catch {}
          throw new Error(`Container failed to start: ${error.message}`);
        }
        
        const totalBuildTime = Date.now() - buildStartTime;
        console.log(`📊 Total build time: ${totalBuildTime}ms (Docker: ${dockerBuildTime}ms)`);
        
        return { 
          success: true, 
          port, 
          appType,
          buildMetrics: {
            totalBuildTime,
            dockerBuildTime,
            optimized: useOptimized
          }
        };
      } catch (error) {
        lastError = error;
        console.error(`❌ Docker error (attempt ${attempt}/${maxRetries}): ${error.message}`);
        
        // Extract Docker logs for error analysis
        try {
          if (attempt < maxRetries) {
            console.log(`🔍 Analyzing Docker error for automatic fix...`);
            
            // Get Docker build logs
            try {
              const buildLogs = execSync(`docker build --no-cache -t "${appName}-debug" "${appPath}" 2>&1`, { encoding: 'utf8' });
              dockerLogs = buildLogs;
            } catch (buildError) {
              dockerLogs = buildError.stdout || buildError.stderr || error.message;
            }
            
            // Get container logs if container was created
            try {
              const containerLogs = execSync(`docker logs "${appName}-${Date.now()}" 2>&1`, { encoding: 'utf8' });
              dockerLogs += '\n\nContainer logs:\n' + containerLogs;
            } catch {}
            
            // Analyze error and generate fix
            const fixResult = await this.analyzeDockerErrorAndFix(appName, appPath, dockerLogs, error.message);
            
            if (fixResult.success) {
              console.log(`🔧 Applied automatic fix: ${fixResult.fixDescription}`);
              console.log(`🔄 Retrying build with fixes...`);
              continue; // Retry with fixes
            } else {
              console.log(`⚠️  Could not automatically fix Docker error: ${fixResult.error}`);
            }
          }
        } catch (analysisError) {
          console.log(`⚠️  Error analysis failed: ${analysisError.message}`);
        }
        
        // Clean up failed containers
        try {
          execSync(`docker stop "${appName}"`, { stdio: 'ignore' });
          execSync(`docker rm "${appName}"`, { stdio: 'ignore' });
        } catch {}
      }
    }
    
    // All retries failed
    console.error(`❌ Docker build failed after ${maxRetries} attempts`);
    return { 
      success: false, 
      error: lastError?.message || 'Unknown Docker error',
      dockerLogs,
      attempts: maxRetries
    };
  }

  // Security: Validate file paths to prevent directory traversal
  validateFilePath(filePath, appPath) {
    const normalizedFilePath = path.normalize(filePath);
    const normalizedAppPath = path.normalize(appPath);
    
    // Prevent directory traversal
    if (normalizedFilePath.includes('..') || normalizedFilePath.startsWith('/')) {
      throw new Error(`Invalid file path: ${filePath}`);
    }
    
    const fullPath = path.join(normalizedAppPath, normalizedFilePath);
    const resolvedPath = path.resolve(fullPath);
    const resolvedAppPath = path.resolve(normalizedAppPath);
    
    // Ensure the resolved path is within the app directory
    if (!resolvedPath.startsWith(resolvedAppPath + path.sep) && resolvedPath !== resolvedAppPath) {
      throw new Error(`File path outside app directory: ${filePath}`);
    }
    
    return resolvedPath;
  }

  // Security: File allowlist for LLM modifications
  isAllowedFile(filePath) {
    const allowedPatterns = [
      /^package\.json$/,
      /^src\/.*\.(js|ts|jsx|tsx|css|html|json)$/,
      /^public\/.*\.(js|css|html|json|png|jpg|svg|ico)$/,
      /^components\/.*\.(js|ts|jsx|tsx|css)$/,
      /^pages\/.*\.(js|ts|jsx|tsx|css)$/,
      /^styles\/.*\.(css|scss|less)$/,
      /^.*\.env\.example$/,
      /^README\.md$/,
      /^index\.(js|ts|html)$/,
      /^server\.(js|ts)$/,
      /^app\.(js|ts|jsx|tsx)$/,
      /^main\.(js|ts|jsx|tsx)$/
    ];
    
    return allowedPatterns.some(pattern => pattern.test(filePath));
  }

  // Security: Sanitize LLM response content
  sanitizeLLMContent(content) {
    if (typeof content !== 'string') {
      throw new Error('Content must be a string');
    }
    
    // Check for dangerous patterns
    const dangerousPatterns = [
      /require\s*\(\s*['"]child_process['"]/,
      /import.*child_process/,
      /exec\s*\(/,
      /spawn\s*\(/,
      /process\.env\./,
      /fs\.writeFile.*\/\.\./,
      /\.\.\/\.\./,
      /\/etc\/passwd/,
      /\/root\//,
      /sudo/,
      /rm -rf/,
      /curl.*http/,
      /wget/,
      /eval\s*\(/,
      /new Function\s*\(/
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(content)) {
        throw new Error(`Dangerous pattern detected in LLM response: ${pattern.source}`);
      }
    }
    
    // Limit content size
    if (content.length > 50000) {
      throw new Error('Content too large');
    }
    
    return content;
  }

  // Security: Sanitize logs to prevent sensitive data leakage
  sanitizeLogs(logs) {
    if (typeof logs !== 'string') {
      return String(logs || '');
    }
    
    // Remove potential API keys and sensitive information
    return logs
      .replace(/Bearer\s+[A-Za-z0-9\-_]+/g, 'Bearer [REDACTED]')
      .replace(/Authorization:\s*Bearer\s+[A-Za-z0-9\-_]+/gi, 'Authorization: Bearer [REDACTED]')
      .replace(/api[_-]?key['":\s]*[A-Za-z0-9\-_]+/gi, 'api_key: [REDACTED]')
      .replace(/CEREBRAS_API_KEY['":\s]*[A-Za-z0-9\-_]+/gi, 'CEREBRAS_API_KEY: [REDACTED]')
      .replace(/token['":\s]*[A-Za-z0-9\-_]{20,}/gi, 'token: [REDACTED]')
      .replace(/password['":\s]*[^\s'"]+/gi, 'password: [REDACTED]')
      .replace(/secret['":\s]*[^\s'"]+/gi, 'secret: [REDACTED]')
      .replace(/\/[a-z0-9]{32,}/g, '/[HASH_REDACTED]'); // Redact long hash-like strings in paths
  }

  async analyzeDockerErrorAndFix(appName, appPath, dockerLogs, errorMessage) {
    try {
      console.log(`🤖 Using LLM to analyze Docker error and generate fixes...`);
      
      // Security: Sanitize logs to prevent API key leakage
      const sanitizedDockerLogs = this.sanitizeLogs(dockerLogs);
      const sanitizedErrorMessage = this.sanitizeLogs(errorMessage);
      
      // Create a comprehensive error analysis prompt
      const errorAnalysisPrompt = `You are a Docker and Node.js expert. Analyze the following Docker build/run error and provide specific fixes.

ERROR MESSAGE: ${sanitizedErrorMessage}

DOCKER LOGS:
${sanitizedDockerLogs}

APP CONTEXT:
- App name: ${appName}
- App path: ${appPath}

TASK:
1. Analyze the error and identify the root cause
2. Provide specific file changes needed to fix the issue
3. Focus on common issues like:
   - Missing dependencies in package.json
   - Incorrect import statements
   - Missing files or directories
   - Port conflicts
   - File permission issues
   - Build tool configuration problems

RESPONSE FORMAT:
Return a JSON object with this structure:
{
  "success": true/false,
  "fixDescription": "Brief description of the fix",
  "changes": [
    {
      "file": "path/to/file",
      "action": "create|modify|delete",
      "content": "file content or null for delete"
    }
  ],
  "error": "error message if no fix possible"
}

IMPORTANT:
- Only suggest changes that are safe and necessary
- If the error cannot be automatically fixed, set success to false
- Provide specific, actionable fixes
- Focus on the most common Docker/Node.js issues`;

      const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: "qwen-3-coder-480b",
          stream: false,
          max_tokens: 2000,
          temperature: 0.1,
          top_p: 0.9,
          messages: [{ role: "user", content: errorAnalysisPrompt }]
        })
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      const analysis = data.choices[0].message.content;
      
      // Parse the JSON response
      let fixResult;
      try {
        fixResult = JSON.parse(analysis);
      } catch (parseError) {
        console.log(`⚠️  Failed to parse LLM response: ${parseError.message}`);
        return { success: false, error: 'Failed to parse LLM response' };
      }

      if (fixResult.success && fixResult.changes) {
        // Apply the suggested fixes
        console.log(`🔧 Applying ${fixResult.changes.length} fixes...`);
        
        for (const change of fixResult.changes) {
          try {
            // Security: Validate file path and check allowlist
            this.validateFilePath(change.file, appPath);
            
            if (!this.isAllowedFile(change.file)) {
              console.log(`🚫 Blocked modification to restricted file: ${change.file}`);
              continue;
            }
            
            const filePath = path.join(appPath, change.file);
            
            switch (change.action) {
              case 'create':
              case 'modify':
                // Security: Sanitize content before writing
                const sanitizedContent = this.sanitizeLLMContent(change.content);
                
                // Ensure directory exists
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                await fs.writeFile(filePath, sanitizedContent);
                console.log(`✅ ${change.action === 'create' ? 'Created' : 'Modified'}: ${change.file}`);
                break;
                
              case 'delete':
                await fs.unlink(filePath);
                console.log(`✅ Deleted: ${change.file}`);
                break;
            }
          } catch (fileError) {
            console.log(`⚠️  Failed to apply change to ${change.file}: ${fileError.message}`);
          }
        }
        
        return {
          success: true,
          fixDescription: fixResult.fixDescription || 'Applied automatic fixes'
        };
      } else {
        return {
          success: false,
          error: fixResult.error || 'LLM could not determine a fix'
        };
      }
    } catch (error) {
      console.log(`⚠️  Error analysis failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  createOptimizedBuildCommand(appName, appPath, useOptimized) {
    // Security: Sanitize inputs for shell commands
    const sanitizedAppName = this.sanitizeName(appName);
    const sanitizedPath = appPath.replace(/"/g, '\\"');
    
    if (useOptimized) {
      // Use BuildKit with advanced caching for optimized builds
      return `DOCKER_BUILDKIT=1 docker build \\
        --cache-from "${sanitizedAppName}:latest" \\
        --cache-from "${sanitizedAppName}:deps" \\
        --cache-from "${sanitizedAppName}:builder" \\
        --target runtime \\
        -t "${sanitizedAppName}:latest" \\
        -t "${sanitizedAppName}" \\
        "${sanitizedPath}"`;
    } else {
      // Legacy build command
      return `docker build -t "${sanitizedAppName}" "${sanitizedPath}"`;
    }
  }

  async benchmarkBuilds(prompt) {
    console.log(`🏁 Benchmarking optimized vs legacy builds for: "${prompt}"`);
    console.log('━'.repeat(80));
    
    const baseAppName = this.generateAppName(prompt);
    
    // Test 1: Legacy build
    console.log('\n🐌 Testing Legacy Build...');
    process.env.DOCKER_OPTIMIZED = 'false';
    const legacyAppName = `${baseAppName}-legacy`;
    const legacyResult = await this.createAppForBenchmark(prompt, legacyAppName);
    
    // Test 2: Optimized build  
    console.log('\n⚡ Testing Optimized Build...');
    process.env.DOCKER_OPTIMIZED = 'true';
    const optimizedAppName = `${baseAppName}-optimized`;
    const optimizedResult = await this.createAppForBenchmark(prompt, optimizedAppName);
    
    // Test 3: Second optimized build (to test caching)
    console.log('\n🚀 Testing Optimized Build with Cache...');
    const cachedAppName = `${baseAppName}-cached`;
    const cachedResult = await this.createAppForBenchmark(prompt, cachedAppName);
    
    // Display comparison
    this.displayBenchmarkResults(legacyResult, optimizedResult, cachedResult);
  }

  async createAppForBenchmark(prompt, appName) {
    const startTime = Date.now();
    
    try {
      const appPath = path.join('./tmp', appName);
      
      // Check if app already exists and remove it
      const existingApp = db.data.apps.find(app => app.name === appName);
      if (existingApp) {
        await this.removeApp(appName);
      }
      
      // Create app directory
      await fs.mkdir(appPath, { recursive: true });
      
      // Analyze and generate app (same as normal flow but with custom name)
      const analysis = await this.analyzeAppStructure(prompt);
      
      let result;
      if (analysis.appType === 'frontend' && analysis.buildTool === 'vite') {
        const scaffoldSuccess = await this.scaffoldWithVite(appName, appPath);
        if (scaffoldSuccess) {
          result = await this.enhanceWithLLM(prompt, appName, appPath, analysis, false);
        } else {
          result = await this.chatWithCerebras(prompt, appName, appPath);
        }
      } else {
        result = await this.chatWithCerebras(prompt, appName, appPath);
      }
      
      // Parse and create files
      const { createdFiles, changesExplanation } = await this.parseAndCreateFiles(appPath, result.output);
      
      // Display changes and files information (for benchmark mode, keep it minimal)
      if (changesExplanation) {
        console.log(`   📋 Changes: ${changesExplanation.split('\n')[0]}`); // Show first line only
      }
      console.log(`   📁 Files: ${createdFiles.length} created`);
      
      await this.applyPostGenerationFixes(appPath, analysis);
      
      // Find available port
      const port = await this.findAvailablePort(db.data.nextPort);
      db.data.nextPort = port + 1;
      
      // Build and run Docker container (this is what we're benchmarking)
      const dockerResult = await this.buildAndRunDocker(appName, appPath, port);
      
      const totalTime = Date.now() - startTime;
      
      return {
        appName,
        totalTime,
        dockerBuildTime: dockerResult.buildMetrics?.dockerBuildTime || 0,
        success: dockerResult.success,
        optimized: dockerResult.buildMetrics?.optimized || false,
        appType: analysis.appType
      };
      
    } catch (error) {
      console.error(`❌ Benchmark failed for ${appName}: ${error.message}`);
      return {
        appName,
        totalTime: Date.now() - startTime,
        dockerBuildTime: 0,
        success: false,
        error: error.message
      };
    }
  }

  // =================== VERSION MANAGEMENT FUNCTIONS ===================
  
  findApp(appName) {
    return db.data.apps.find(app => app.name === appName);
  }

  getCurrentVersion(appName) {
    const app = this.findApp(appName);
    if (!app) return null;
    
    return app.versions.find(v => v.version === app.currentVersion);
  }

  async generateFileHashes(appPath, files) {
    const hashes = {};
    const crypto = await import('crypto');
    
    for (const file of files) {
      try {
        const filePath = path.join(appPath, file);
        const content = await fs.readFile(filePath, 'utf8');
        hashes[file] = crypto.createHash('sha256').update(content).digest('hex');
      } catch (error) {
        console.log(`⚠️  Could not hash ${file}: ${error.message}`);
        hashes[file] = 'unknown';
      }
    }
    
    return hashes;
  }

  detectChangedFiles(oldHashes, newHashes) {
    const changedFiles = [];
    const addedFiles = [];
    const removedFiles = [];
    
    // Find changed and added files
    for (const [file, hash] of Object.entries(newHashes)) {
      if (!oldHashes[file]) {
        addedFiles.push(file);
      } else if (oldHashes[file] !== hash) {
        changedFiles.push(file);
      }
    }
    
    // Find removed files
    for (const file of Object.keys(oldHashes)) {
      if (!newHashes[file]) {
        removedFiles.push(file);
      }
    }
    
    return { changedFiles, addedFiles, removedFiles };
  }

  calculateSemanticVersion(currentVersion, changeType, changedFiles) {
    const [major, minor, patch] = currentVersion.replace('v', '').split('.').map(Number);
    
    // Determine version bump based on changes
    if (changeType === 'major' || changedFiles.includes('package.json')) {
      return `v${major}.${minor + 1}.0`; // Minor bump for package.json changes
    } else if (changeType === 'minor' || changedFiles.some(f => f.endsWith('.jsx') || f.endsWith('.js'))) {
      return `v${major}.${minor}.${patch + 1}`; // Patch bump for code changes
    } else {
      return `v${major}.${minor}.${patch + 1}`; // Default patch bump
    }
  }

  async createBackup(appName, version) {
    const app = this.findApp(appName);
    if (!app) throw new Error(`App ${appName} not found`);
    
    const appPath = path.join('./tmp', appName);
    const backupPath = path.join(appPath, '.backups', version);
    
    try {
      await fs.mkdir(backupPath, { recursive: true });
      
      // Copy all current files to backup
      const currentVersion = this.getCurrentVersion(appName);
      if (currentVersion && currentVersion.files) {
        for (const file of currentVersion.files) {
          const sourcePath = path.join(appPath, file);
          const destPath = path.join(backupPath, file);
          
          try {
            // Create directory structure in backup
            await fs.mkdir(path.dirname(destPath), { recursive: true });
            await fs.copyFile(sourcePath, destPath);
          } catch (error) {
            console.log(`⚠️  Could not backup ${file}: ${error.message}`);
          }
        }
      }
      
      console.log(`💾 Created backup at ${backupPath}`);
      return backupPath;
    } catch (error) {
      console.error(`❌ Backup failed: ${error.message}`);
      return null;
    }
  }

  async restoreFromBackup(appName, version) {
    const app = this.findApp(appName);
    if (!app) throw new Error(`App ${appName} not found`);
    
    const appPath = path.join('./tmp', appName);
    const backupPath = path.join(appPath, '.backups', version);
    
    try {
      // Check if backup exists
      await fs.access(backupPath);
      
      // Get backup version info
      const backupVersion = app.versions.find(v => v.version === version);
      if (!backupVersion) {
        throw new Error(`Version ${version} not found in database`);
      }
      
      // Restore files from backup
      for (const file of backupVersion.files) {
        const sourcePath = path.join(backupPath, file);
        const destPath = path.join(appPath, file);
        
        try {
          await fs.mkdir(path.dirname(destPath), { recursive: true });
          await fs.copyFile(sourcePath, destPath);
        } catch (error) {
          console.log(`⚠️  Could not restore ${file}: ${error.message}`);
        }
      }
      
      console.log(`🔄 Restored from backup: ${backupPath}`);
      return true;
    } catch (error) {
      console.error(`❌ Restore failed: ${error.message}`);
      return false;
    }
  }

  async listVersions(appName) {
    const app = this.findApp(appName);
    if (!app) {
      console.log(`❌ App ${appName} not found.`);
      return;
    }

    console.log(`\n📋 Versions for ${appName}:`);
    console.log('─'.repeat(80));
    
    for (const version of app.versions.reverse()) { // Show newest first
      const status = version.isActive ? '🟢 Active' : '⚪ Inactive';
      const improvements = version.improvements.length > 0 ? 
        `\n   🔧 ${version.improvements.join(', ')}` : '';
      
      console.log(`${status} ${version.version} (${version.dockerStatus})`);
      console.log(`   📝 ${version.prompt}${improvements}`);
      
      if (version.changesExplanation && version.changesExplanation.trim()) {
        console.log(`   📋 Changes: ${version.changesExplanation}`);
      }
      
      console.log(`   📊 ${version.changedFiles.length} changed, ${version.addedFiles.length} added, ${version.removedFiles.length} removed`);
      console.log(`   🕐 ${new Date(version.createdAt).toLocaleString()}`);
      
      if (version.performance?.buildMetrics) {
        const buildTime = version.performance.buildMetrics.dockerBuildTime;
        const optimized = version.performance.buildMetrics.optimized ? '⚡' : '🐌';
        console.log(`   ⏱️  Build: ${(buildTime / 1000).toFixed(1)}s ${optimized}`);
      }
      
      console.log();
    }
  }

  async showDiff(appName, fromVersion, toVersion) {
    const app = this.findApp(appName);
    if (!app) {
      console.log(`❌ App ${appName} not found.`);
      return;
    }

    const fromVer = app.versions.find(v => v.version === fromVersion);
    const toVer = app.versions.find(v => v.version === toVersion);
    
    if (!fromVer || !toVer) {
      console.log(`❌ Version not found. Available: ${app.versions.map(v => v.version).join(', ')}`);
      return;
    }

    console.log(`\n🔍 Diff from ${fromVersion} to ${toVersion}:`);
    console.log('─'.repeat(80));
    
    // Show improvements
    if (toVer.improvements.length > 0) {
      console.log(`🔧 Improvements: ${toVer.improvements.join(', ')}`);
    }
    
    // Show changes explanation
    if (toVer.changesExplanation && toVer.changesExplanation.trim()) {
      console.log(`📋 Changes: ${toVer.changesExplanation}`);
    }
    
    // Show file changes
    if (toVer.changedFiles.length > 0) {
      console.log(`📝 Modified: ${toVer.changedFiles.join(', ')}`);
    }
    
    if (toVer.addedFiles.length > 0) {
      console.log(`➕ Added: ${toVer.addedFiles.join(', ')}`);
    }
    
    if (toVer.removedFiles.length > 0) {
      console.log(`➖ Removed: ${toVer.removedFiles.join(', ')}`);
    }
    
    // Show performance comparison
    const fromPerf = fromVer.performance?.buildMetrics?.dockerBuildTime || 0;
    const toPerf = toVer.performance?.buildMetrics?.dockerBuildTime || 0;
    
    if (fromPerf > 0 && toPerf > 0) {
      const diff = toPerf - fromPerf;
      const symbol = diff > 0 ? '📈' : '📉';
      console.log(`${symbol} Build time: ${(fromPerf/1000).toFixed(1)}s → ${(toPerf/1000).toFixed(1)}s (${diff > 0 ? '+' : ''}${(diff/1000).toFixed(1)}s)`);
    }
    
    console.log(`\n🕐 Created: ${new Date(toVer.createdAt).toLocaleString()}`);
  }

  async improveApp(appName, improvementPrompt) {
    console.log(`🔧 Improving ${appName}: "${improvementPrompt}"`);
    
    const app = this.findApp(appName);
    if (!app) {
      console.log(`❌ App ${appName} not found. Use --list to see available apps.`);
      return;
    }
    
    const currentVersion = this.getCurrentVersion(appName);
    if (!currentVersion) {
      console.log(`❌ No current version found for ${appName}`);
      return;
    }
    
    const appPath = path.join('./tmp', appName);
    
    try {
      // 1. Create backup of current version
      console.log(`💾 Creating backup of ${currentVersion.version}...`);
      const backupPath = await this.createBackup(appName, currentVersion.version);
      if (!backupPath) {
        throw new Error('Backup creation failed');
      }
      
      // 2. Read current file contents for intelligent editing
      console.log(`📖 Reading current file contents...`);
      const currentFileContents = await this.readCurrentFileContents(appPath, currentVersion.files);
      
      // 3. Generate improvement using LLM with full context
      console.log(`🤖 Generating improvements with file context...`);
      const improvementContext = this.createImprovementContext(
        currentVersion.prompt,
        improvementPrompt,
        currentVersion.files,
        currentFileContents
      );
      
      const result = await this.chatWithCerebras(improvementContext, appName, appPath);
      
      // 3. Parse and apply file changes
      console.log(`📝 Applying file changes...`);
      const { createdFiles, changesExplanation } = await this.parseAndCreateFiles(appPath, result.output);
      
      // Display changes and files information
      if (changesExplanation) {
        console.log(`\n📋 Changes Summary:`);
        console.log(`   ${changesExplanation}`);
      }
      
      console.log(`\n📁 Files Modified:`);
      createdFiles.forEach(file => {
        console.log(`   📄 ${file}`);
      });
      console.log(`   Total: ${createdFiles.length} files\n`);
      
      // 4. Generate new file hashes and detect changes
      const allFiles = [...new Set([...currentVersion.files, ...createdFiles])];
      const newFileHashes = await this.generateFileHashes(appPath, allFiles);
      const { changedFiles, addedFiles, removedFiles } = this.detectChangedFiles(
        currentVersion.fileHashes, 
        newFileHashes
      );
      
      if (changedFiles.length === 0 && addedFiles.length === 0 && removedFiles.length === 0) {
        console.log(`⚠️  No changes detected. The improvement may not have been applied.`);
        return;
      }
      
      console.log(`📊 Changes: ${changedFiles.length} modified, ${addedFiles.length} added, ${removedFiles.length} removed`);
      if (changedFiles.length > 0) console.log(`   📝 Modified: ${changedFiles.join(', ')}`);
      if (addedFiles.length > 0) console.log(`   ➕ Added: ${addedFiles.join(', ')}`);
      if (removedFiles.length > 0) console.log(`   ➖ Removed: ${removedFiles.join(', ')}`);
      
      // 5. Calculate new version number
      const newVersion = this.calculateSemanticVersion(
        currentVersion.version, 
        'minor', 
        [...changedFiles, ...addedFiles]
      );
      
      console.log(`🏷️  New version: ${newVersion}`);
      
      // 6. Build new Docker container with versioned name
      const containerName = `${appName}-${newVersion.replace(/\./g, '-')}`;
      console.log(`🐳 Building container: ${containerName}`);
      
      const dockerResult = await this.buildVersionedContainer(appName, newVersion, containerName, appPath);
      
      if (!dockerResult.success) {
        console.log(`❌ Docker build failed. Rolling back...`);
        await this.restoreFromBackup(appName, currentVersion.version);
        throw new Error(`Docker build failed: ${dockerResult.error}`);
      }
      
      // 7. Deploy with blue-green strategy
      const deployResult = await this.deployWithBlueGreen(appName, newVersion, containerName, app.port);
      
      if (!deployResult.success) {
        console.log(`❌ Deployment failed. Rolling back...`);
        await this.restoreFromBackup(appName, currentVersion.version);
        throw new Error(`Deployment failed: ${deployResult.error}`);
      }
      
      // 8. Update database with new version
      const newVersionData = {
        version: newVersion,
        prompt: currentVersion.prompt,
        improvements: [...currentVersion.improvements, improvementPrompt],
        changesExplanation: changesExplanation,
        containerName,
        files: allFiles,
        fileHashes: newFileHashes,
        performance: {
          latency: result.latency,
          tokens: result.usage,
          buildMetrics: dockerResult.buildMetrics
        },
        createdAt: new Date().toISOString(),
        isActive: true,
        dockerStatus: 'running',
        dockerError: null,
        parentVersion: currentVersion.version,
        changedFiles,
        addedFiles,
        removedFiles,
        backupPath
      };
      
      // Mark old version as inactive
      currentVersion.isActive = false;
      
      // Add new version
      app.versions.push(newVersionData);
      app.currentVersion = newVersion;
      
      await db.write();
      
      console.log(`✅ Successfully improved ${appName} to ${newVersion}!`);
      console.log(`🌐 Running at http://localhost:${app.port}`);
      console.log(`📊 Build time: ${(dockerResult.buildMetrics?.dockerBuildTime || 0) / 1000}s`);
      
    } catch (error) {
      console.error(`❌ Improvement failed: ${error.message}`);
      
      // Attempt automatic rollback
      console.log(`🔄 Attempting automatic rollback...`);
      try {
        await this.restoreFromBackup(appName, currentVersion.version);
        console.log(`✅ Rollback successful`);
      } catch (rollbackError) {
        console.error(`❌ Rollback also failed: ${rollbackError.message}`);
      }
    }
  }

  async buildVersionedContainer(appName, version, containerName, appPath) {
    // Use the same optimized build strategy, but with versioned container name
    const buildStartTime = Date.now();
    
    try {
      // Detect app type for appropriate Dockerfile
      const packageJsonPath = path.join(appPath, 'package.json');
      let appType = 'backend-only';
      
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
        const hasVite = packageJson.devDependencies?.vite || packageJson.dependencies?.vite;
        const hasExpress = packageJson.dependencies?.express;
        const hasServerFile = await fs.access(path.join(appPath, 'server.js')).then(() => true).catch(() => false);
        
        if (hasVite && hasExpress && hasServerFile) {
          appType = 'fullstack';
        } else if (hasVite) {
          appType = 'frontend-only';
        } else if (hasExpress || hasServerFile) {
          appType = 'backend-only';
        }
      } catch (error) {
        console.log(`⚠️  Could not analyze package.json, using backend-only template`);
      }
      
      // Use optimized Dockerfile
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const templatePath = path.join(currentDir, `templates/Dockerfile.${appType}.optimized`);
      const dockerfilePath = path.join(appPath, 'Dockerfile');
      
      // Detect app folders for dynamic Dockerfile generation
      const appFolders = await this.detectAppFolders(appPath);
      
      // Read template and render with nunjucks
      const templateContent = await fs.readFile(templatePath, 'utf8');
      const dockerfile = nunjucks.renderString(templateContent, {
        appFolders: appFolders
      });
      
      // Write rendered Dockerfile to app directory
      await fs.writeFile(dockerfilePath, dockerfile);
      
      // Build with versioned name and caching
      const buildCommand = `DOCKER_BUILDKIT=1 docker build \\
        --cache-from "${appName}:latest" \\
        --cache-from "${appName}:deps" \\
        --cache-from "${appName}:builder" \\
        --target runtime \\
        -t "${containerName}" \\
        -t "${appName}:${version}" \\
        -t "${appName}:latest" \\
        "${appPath}"`;
      
      console.log(`🔨 Building: ${containerName}`);
      
      const dockerBuildStart = Date.now();
      let dockerBuildTime;
      
      try {
        execSync(buildCommand, { 
          stdio: 'inherit',
          timeout: 300000 // 5 minute timeout
        });
        dockerBuildTime = Date.now() - dockerBuildStart;
      } catch (error) {
        console.log(`⚠️  Optimized build failed, trying fallback without cache...`);
        
        // Fallback: build without cache
        const fallbackCommand = `docker build -t "${containerName}" -t "${appName}:${version}" -t "${appName}:latest" "${appPath}"`;
        
        const fallbackStart = Date.now();
        execSync(fallbackCommand, { 
          stdio: 'inherit',
          timeout: 300000
        });
        dockerBuildTime = Date.now() - fallbackStart;
        
        console.log(`⚠️  Fallback build succeeded`);
      }
      
      console.log(`⚡ Build completed in ${dockerBuildTime}ms`);
      
      return {
        success: true,
        buildMetrics: {
          totalBuildTime: Date.now() - buildStartTime,
          dockerBuildTime,
          optimized: true
        }
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async deployWithBlueGreen(appName, newVersion, newContainerName, port) {
    try {
      // 1. Check if port is already in use and stop any existing containers
      console.log(`🔍 Checking port ${port} availability...`);
      try {
        const portCheck = execSync(`lsof -i :${port}`, { encoding: 'utf8' });
        if (portCheck.trim()) {
          console.log(`⚠️  Port ${port} is in use. Stopping existing containers...`);
          // Stop any containers using this port
          execSync(`docker ps --filter "publish=${port}" --format "{{.Names}}" | xargs -r docker stop`, { stdio: 'ignore' });
          execSync(`docker ps -a --filter "publish=${port}" --format "{{.Names}}" | xargs -r docker rm`, { stdio: 'ignore' });
        }
      } catch (error) {
        // Port is free, continue
      }
      
      // 2. Start new container on temporary port for testing
      const tempPort = port + 1000; // Use port + 1000 for testing
      
      console.log(`🚀 Starting new container on port ${tempPort} for testing...`);
      execSync(`docker run -d --name "${newContainerName}" -p ${tempPort}:3000 "${newContainerName}"`, { stdio: 'inherit' });
      
      // 3. Health check the new container
      console.log(`🏥 Running health checks on temporary port ${tempPort}...`);
      const healthOk = await this.healthCheckContainer(newContainerName, tempPort);
      
      if (!healthOk) {
        throw new Error('Health check failed');
      }
      
      // 4. Stop old container
      const app = this.findApp(appName);
      const currentVersion = this.getCurrentVersion(appName);
      
      if (currentVersion && currentVersion.containerName) {
        console.log(`🛑 Stopping old container: ${currentVersion.containerName}`);
        try {
          execSync(`docker stop "${currentVersion.containerName}"`, { stdio: 'ignore' });
          execSync(`docker rm "${currentVersion.containerName}"`, { stdio: 'ignore' });
        } catch (error) {
          console.log(`⚠️  Could not stop old container: ${error.message}`);
        }
      }
      
      // 5. Switch new container to production port
      console.log(`🔄 Switching to production port ${port}...`);
      execSync(`docker stop "${newContainerName}"`, { stdio: 'ignore' });
      execSync(`docker rm "${newContainerName}"`, { stdio: 'ignore' });
      execSync(`docker run -d --name "${newContainerName}" -p ${port}:3000 "${newContainerName}"`, { stdio: 'inherit' });
      
      // 6. Final health check on production port
      console.log(`🏥 Running final health check on production port ${port}...`);
      const finalHealthOk = await this.healthCheckContainer(newContainerName, port);
      
      if (!finalHealthOk) {
        throw new Error('Final health check failed');
      }
      
      console.log(`✅ Blue-green deployment successful`);
      return { success: true };
      
    } catch (error) {
      // Cleanup failed container
      try {
        execSync(`docker stop "${newContainerName}"`, { stdio: 'ignore' });
        execSync(`docker rm "${newContainerName}"`, { stdio: 'ignore' });
      } catch {}
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  async healthCheckContainer(containerName, port, timeoutMs = 15000) {
    // Comprehensive health check - verify container is running and responding
    try {
      // Check if container is running
      const runningContainers = execSync(`docker ps --filter "name=${containerName}" --format "{{.Names}}"`, { encoding: 'utf8' });
      if (!runningContainers.includes(containerName)) {
        console.log(`❌ Container ${containerName} is not running`);
        return false;
      }
      
      // Wait a moment for startup
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Try HTTP health check with timeout
      return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          console.log(`❌ Health check timeout for ${containerName} after ${timeoutMs}ms`);
          resolve(false);
        }, timeoutMs);

        // Use fetch for HTTP health check
        fetch(`http://localhost:${port}`, {
          method: 'HEAD',
          signal: AbortSignal.timeout(timeoutMs - 1000) // Leave 1s buffer for cleanup
        })
        .then(response => {
          clearTimeout(timeoutId);
          if (response.ok) {
            console.log(`✅ Health check passed for ${containerName} (HTTP ${response.status})`);
            resolve(true);
          } else {
            console.log(`❌ Health check failed for ${containerName} (HTTP ${response.status})`);
            resolve(false);
          }
        })
        .catch(error => {
          clearTimeout(timeoutId);
          console.log(`❌ Health check failed for ${containerName}: ${error.message}`);
          resolve(false);
        });
      });
      
    } catch (error) {
      console.log(`❌ Health check error: ${error.message}`);
      return false;
    }
  }

  async readCurrentFileContents(appPath, files) {
    const fileContents = {};
    
    for (const file of files) {
      try {
        const filePath = path.join(appPath, file);
        const content = await fs.readFile(filePath, 'utf8');
        fileContents[file] = content;
      } catch (error) {
        console.log(`⚠️  Could not read ${file}: ${error.message}`);
        fileContents[file] = null;
      }
    }
    
    return fileContents;
  }

  createImprovementContext(originalPrompt, improvementPrompt, files, fileContents) {
    let context = `IMPROVEMENT REQUEST: ${improvementPrompt}

ORIGINAL APP PROMPT: ${originalPrompt}

CURRENT APP STRUCTURE:
Files: ${files.join(', ')}

CURRENT FILE CONTENTS:
`;

    // Add file contents in a structured way
    for (const [filename, content] of Object.entries(fileContents)) {
      if (content !== null) {
        context += `\n<current_file path="${filename}">
${content}
</current_file>`;
      }
    }

    context += `

INSTRUCTIONS:
1. Analyze the current app structure and functionality
2. Understand what the app currently does based on the file contents
3. Make targeted improvements based on the improvement request
4. Only modify files that actually need changes
5. Preserve existing functionality while adding new features
6. Use the exact file format: <file path="filename.js">content</file>
7. Only include files that need modifications - don't recreate unchanged files
8. Ensure all changes are compatible with the existing codebase

CRITICAL OUTPUT FORMAT:
You must respond with the following structure:

<changes>
Brief explanation of what changes were made and why
</changes>

<file path="filename.js">
// Updated file content here
</file>

<file path="another-file.js">
// Another updated file content here
</file>

The <changes> section should briefly explain:
- What functionality was added/modified
- Which files were changed and why
- Any important implementation details

Only include files that actually need to be modified for the improvement.

IMPORTANT: This is an improvement to an existing app, not a new app creation. Make surgical changes rather than recreating everything.`;
    
    return context;
  }

  async rollbackToVersion(appName, targetVersion) {
    console.log(`🔄 Rolling back ${appName} to ${targetVersion}...`);
    
    const app = this.findApp(appName);
    if (!app) {
      console.log(`❌ App ${appName} not found.`);
      return;
    }
    
    const targetVersionData = app.versions.find(v => v.version === targetVersion);
    if (!targetVersionData) {
      console.log(`❌ Version ${targetVersion} not found. Available: ${app.versions.map(v => v.version).join(', ')}`);
      return;
    }
    
    if (targetVersionData.version === app.currentVersion) {
      console.log(`⚠️  ${targetVersion} is already the current version`);
      return;
    }
    
    try {
      // 1. Create backup of current state
      const currentVersion = this.getCurrentVersion(appName);
      console.log(`💾 Creating backup of current state...`);
      await this.createBackup(appName, currentVersion.version);
      
      // 2. Restore files from target version backup
      console.log(`📁 Restoring files from ${targetVersion}...`);
      const restoreSuccess = await this.restoreFromBackup(appName, targetVersion);
      
      if (!restoreSuccess) {
        throw new Error(`Could not restore files from backup`);
      }
      
      // 3. Build container for target version
      const containerName = `${appName}-${targetVersion.replace(/\./g, '-')}`;
      console.log(`🐳 Building container: ${containerName}`);
      
      const appPath = path.join('./tmp', appName);
      const dockerResult = await this.buildVersionedContainer(appName, targetVersion, containerName, appPath);
      
      if (!dockerResult.success) {
        throw new Error(`Docker build failed: ${dockerResult.error}`);
      }
      
      // 4. Deploy with blue-green strategy
      const deployResult = await this.deployWithBlueGreen(appName, targetVersion, containerName, app.port);
      
      if (!deployResult.success) {
        throw new Error(`Deployment failed: ${deployResult.error}`);
      }
      
      // 5. Update database - mark target version as active
      // Mark current version as inactive
      if (currentVersion) {
        currentVersion.isActive = false;
      }
      
      // Mark target version as active
      targetVersionData.isActive = true;
      targetVersionData.dockerStatus = 'running';
      targetVersionData.dockerError = null;
      targetVersionData.containerName = containerName;
      
      // Update current version pointer
      app.currentVersion = targetVersion;
      
      await db.write();
      
      console.log(`✅ Successfully rolled back ${appName} to ${targetVersion}!`);
      console.log(`🌐 Running at http://localhost:${app.port}`);
      
    } catch (error) {
      console.error(`❌ Rollback failed: ${error.message}`);
      
      // Try to restore current state
      console.log(`🔄 Attempting to restore current state...`);
      try {
        const currentVersion = this.getCurrentVersion(appName);
        await this.restoreFromBackup(appName, currentVersion.version);
        console.log(`✅ Current state restored`);
      } catch (restoreError) {
        console.error(`❌ Could not restore current state: ${restoreError.message}`);
      }
    }
  }

  // =================== END VERSION MANAGEMENT ===================

  displayBenchmarkResults(legacyResult, optimizedResult, cachedResult) {
    console.log('\n📊 BENCHMARK RESULTS');
    console.log('━'.repeat(80));
    
    const formatTime = (ms) => `${(ms / 1000).toFixed(1)}s`;
    const calculateSpeedup = (baseline, optimized) => {
      if (baseline === 0) return 'N/A';
      return `${(baseline / optimized).toFixed(1)}x`;
    };
    
    console.log(`
📝 App Type: ${optimizedResult.appType || 'unknown'}

🐌 Legacy Build:
   Total Time:  ${formatTime(legacyResult.totalTime)}
   Docker Time: ${formatTime(legacyResult.dockerBuildTime)}
   Success:     ${legacyResult.success ? '✅' : '❌'}

⚡ Optimized Build (First Run):
   Total Time:  ${formatTime(optimizedResult.totalTime)}
   Docker Time: ${formatTime(optimizedResult.dockerBuildTime)}
   Success:     ${optimizedResult.success ? '✅' : '❌'}
   Speedup:     ${calculateSpeedup(legacyResult.dockerBuildTime, optimizedResult.dockerBuildTime)}

🚀 Optimized Build (With Cache):
   Total Time:  ${formatTime(cachedResult.totalTime)}
   Docker Time: ${formatTime(cachedResult.dockerBuildTime)}
   Success:     ${cachedResult.success ? '✅' : '❌'}
   Speedup:     ${calculateSpeedup(legacyResult.dockerBuildTime, cachedResult.dockerBuildTime)}

💡 Performance Improvement:
   First run: ${formatTime(legacyResult.dockerBuildTime - optimizedResult.dockerBuildTime)} faster
   With cache: ${formatTime(legacyResult.dockerBuildTime - cachedResult.dockerBuildTime)} faster
`);
    
    if (cachedResult.dockerBuildTime > 0 && legacyResult.dockerBuildTime > 0) {
      const cacheSpeedup = legacyResult.dockerBuildTime / cachedResult.dockerBuildTime;
      if (cacheSpeedup > 2) {
        console.log(`🎉 Excellent! Optimized builds are ${cacheSpeedup.toFixed(1)}x faster!`);
      } else if (cacheSpeedup > 1.5) {
        console.log(`👍 Good improvement! Optimized builds are ${cacheSpeedup.toFixed(1)}x faster.`);
      } else {
        console.log(`⚠️  Modest improvement. Consider further optimizations.`);
      }
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
          const result = await this.enhanceWithLLM(prompt, appName, appPath, analysis, false);
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
      const { createdFiles, changesExplanation } = await this.parseAndCreateFiles(appPath, output);
      
      // Display changes and files information
      if (changesExplanation) {
        console.log(`\n📋 Changes Summary:`);
        console.log(`   ${changesExplanation}`);
      }
      
      console.log(`\n📁 Files Created/Modified:`);
      createdFiles.forEach(file => {
        console.log(`   📄 ${file}`);
      });
      console.log(`   Total: ${createdFiles.length} files\n`);
      
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
      
      // Save app info to database using new versioned schema
      const fileHashes = await this.generateFileHashes(appPath, createdFiles);
      const appInfo = {
        name: appName,
        currentVersion: 'v1.0.0',
        port: dockerResult.success ? port : null,
        createdAt: new Date().toISOString(),
        versions: [{
          version: 'v1.0.0',
          prompt,
          improvements: [],
          containerName: appName,
          files: createdFiles,
          fileHashes,
          performance: { 
            latency, 
            tokens: usage,
            buildMetrics: dockerResult.buildMetrics || null
          },
          createdAt: new Date().toISOString(),
          isActive: dockerResult.success,
          dockerStatus: dockerResult.success ? 'running' : 'failed',
          dockerError: dockerResult.error || null,
          dockerLogs: dockerResult.dockerLogs || null,
          attempts: dockerResult.attempts || 1,
          parentVersion: null,
          changedFiles: [],
          addedFiles: createdFiles,
          removedFiles: [],
          backupPath: null
        }]
      };
      
      db.data.apps.push(appInfo);
      await db.write();
      
      if (dockerResult.success) {
        console.log(`✅ App ${appName} created and running successfully!`);
        console.log(`🌐 Running at http://localhost:${port}`);
        
        // Check if README.md exists in the generated app
        const readmePath = path.join(appPath, 'README.md');
        try {
          await fs.access(readmePath);
          console.log(`📖 App documentation: ${readmePath}`);
        } catch {
          // README.md doesn't exist, that's okay
        }
      } else {
        console.log(`⚠️  App ${appName} files created but Docker build failed!`);
        console.log(`❌ Docker error: ${dockerResult.error}`);
        
        if (dockerResult.dockerLogs) {
          console.log(`📋 Docker logs (last ${Math.min(500, dockerResult.dockerLogs.length)} chars):`);
          console.log(dockerResult.dockerLogs.slice(-500));
        }
        
        if (dockerResult.attempts > 1) {
          console.log(`🔄 Build attempted ${dockerResult.attempts} times with automatic fixes`);
        }
        
        console.log(`💡 You can manually fix the issues and run: docker build -t ${appName} ${appPath}`);
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
      // Handle both old and new schema formats
      let prompt, path, dockerStatus;
      
      if (app.versions) {
        // New versioned schema
        const currentVersion = app.versions.find(v => v.version === app.currentVersion) || app.versions[app.versions.length - 1];
        prompt = currentVersion.prompt;
        path = `tmp/${app.name}`;
        dockerStatus = currentVersion.dockerStatus;
      } else {
        // Old flat schema
        prompt = app.prompt;
        path = app.path;
        dockerStatus = app.dockerStatus;
      }
      
      const status = dockerStatus === 'running' ? '🟢 Running' : '🔴 Stopped';
      const port = app.port ? `:${app.port}` : '';
      console.log(`${status} ${app.name}${port}`);
      console.log(`   📝 ${prompt}`);
      console.log(`   📁 ${path}`);
      
      // Get volume info if container is running
      if (dockerStatus === 'running') {
        try {
          // First check if container actually exists
          const containerExists = execSync(`docker ps -a --filter "name=${app.name}" --format "{{.Names}}"`, { encoding: 'utf8' }).trim();
          
          if (containerExists && containerExists.includes(app.name)) {
            // Use a safer approach to get volume info
            try {
              // Get all container info and extract volumes manually
              const fullInspect = execSync(`docker inspect "${app.name}"`, { encoding: 'utf8' });
              const containerInfo = JSON.parse(fullInspect);
              
              if (containerInfo && containerInfo[0] && containerInfo[0].Mounts) {
                const volumes = containerInfo[0].Mounts.filter(mount => mount && mount.Type === 'volume');
                
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
              } else {
                console.log(`   💾 No volumes found`);
              }
            } catch (inspectError) {
              // Docker inspect failed, skip volume info
              console.log(`   💾 Volume info unavailable (container may not exist)`);
            }
          } else {
            console.log(`   💾 Container not found`);
          }
        } catch (inspectError) {
          // Docker inspect failed, skip volume info
          console.log(`   💾 Volume info unavailable (container may not exist)`);
        }
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
        // First check if container actually exists
        const containerExists = execSync(`docker ps -a --filter "name=${appName}" --format "{{.Names}}"`, { encoding: 'utf8' }).trim();
        
        if (containerExists && containerExists.includes(appName)) {
          // Use a safer approach to get volume info
          try {
            // Get all container info and extract volumes manually
            const fullInspect = execSync(`docker inspect "${appName}"`, { encoding: 'utf8' });
            const containerInfo = JSON.parse(fullInspect);
            
            if (containerInfo && containerInfo[0] && containerInfo[0].Mounts) {
              volumeNames = containerInfo[0].Mounts.filter(mount => mount && mount.Type === 'volume').map(mount => mount.Name);
            }
          } catch (inspectError) {
            // Docker inspect failed, skip volume cleanup
            console.log(`⚠️  Could not inspect container for volume cleanup`);
          }
        }
      } catch (inspectError) {
        // Docker inspect failed, skip volume cleanup
        console.log(`⚠️  Could not inspect container for volume cleanup`);
      }

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

  async retryDockerBuild(appName) {
    const app = this.findApp(appName);
    if (!app) {
      console.log(`❌ App ${appName} not found`);
      return;
    }

    const appPath = path.join('./tmp', appName);
    
    // Check if app directory exists
    try {
      await fs.access(appPath);
    } catch {
      console.log(`❌ App directory not found: ${appPath}`);
      return;
    }

    console.log(`🔄 Retrying Docker build for ${appName}...`);
    
    // Find available port
    const port = await this.findAvailablePort(db.data.nextPort);
    db.data.nextPort = port + 1;
    
    // Retry Docker build with enhanced error handling
    const dockerResult = await this.buildAndRunDocker(appName, appPath, port, 3);
    
    // Update app info
    const currentVersion = app.versions[app.versions.length - 1];
    currentVersion.dockerStatus = dockerResult.success ? 'running' : 'failed';
    currentVersion.dockerError = dockerResult.error || null;
    currentVersion.dockerLogs = dockerResult.dockerLogs || null;
    currentVersion.attempts = (currentVersion.attempts || 1) + (dockerResult.attempts || 1);
    currentVersion.port = dockerResult.success ? port : currentVersion.port;
    
    await db.write();
    
    if (dockerResult.success) {
      console.log(`✅ Docker build retry successful for ${appName}!`);
      console.log(`🌐 Running at http://localhost:${port}`);
    } else {
      console.log(`❌ Docker build retry failed for ${appName}`);
      console.log(`❌ Error: ${dockerResult.error}`);
      
      if (dockerResult.dockerLogs) {
        console.log(`📋 Docker logs (last ${Math.min(500, dockerResult.dockerLogs.length)} chars):`);
        console.log(dockerResult.dockerLogs.slice(-500));
      }
    }
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
      // Set Docker optimization mode based on flags
      if (argv['legacy-build']) {
        process.env.DOCKER_OPTIMIZED = 'false';
        console.log('🐌 Legacy build mode enabled');
      } else {
        process.env.DOCKER_OPTIMIZED = 'true';
        console.log('⚡ Optimized build mode enabled');
      }
      
      if (argv.benchmark) {
        await generator.benchmarkBuilds(argv.prompt);
      } else {
        await generator.createApp(argv.prompt);
      }
    } else if (!argv.list && !argv.stop && !argv.remove && !argv.benchmark && !argv.improve && !argv.retry && !argv.versions && !argv.rollback && !argv.diff && !argv['clear-cache']) {
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
  .option('retry', {
    alias: 't',
    describe: 'Retry Docker build for an app with automatic error fixes',
    type: 'string'
  })
  .option('legacy-build', {
    describe: 'Use legacy Docker build (disable optimizations)',
    type: 'boolean',
    default: false
  })
  .option('benchmark', {
    describe: 'Run both optimized and legacy builds for comparison',
    type: 'boolean',
    default: false
  })
  .option('improve', {
    describe: 'Improve an existing app',
    type: 'string'
  })
  .option('app', {
    describe: 'Target app name (used with --improve, --versions, --rollback, --diff)',
    type: 'string'
  })
  .option('versions', {
    describe: 'List versions of the specified app (use with --app)',
    type: 'boolean'
  })
  .option('rollback', {
    describe: 'Rollback to a specific version',
    type: 'string'
  })
  .option('diff', {
    describe: 'Show diff between two versions: --diff "from-version to-version"',
    type: 'string'
  })
  .option('clear-cache', {
    describe: 'Clear Docker build cache (use when builds hang)',
    type: 'boolean'
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
} else if (argv.retry) {
  await generator.retryDockerBuild(argv.retry);
} else if (argv.improve) {
  if (!argv.app) {
    console.log('❌ Usage: --improve "improvement description" --app "app-name"');
    console.log('   Example: --improve "Add user authentication" --app "todo-app"');
  } else {
    await generator.improveApp(argv.app, argv.improve);
  }
} else if (argv.versions) {
  if (!argv.app) {
    console.log('❌ Usage: --versions --app "app-name"');
    console.log('   Example: --versions --app "todo-app"');
  } else {
    await generator.listVersions(argv.app);
  }
} else if (argv.rollback) {
  if (!argv.app) {
    console.log('❌ Usage: --rollback "version" --app "app-name"');
    console.log('   Example: --rollback "v1.0.0" --app "todo-app"');
  } else {
    await generator.rollbackToVersion(argv.app, argv.rollback);
  }
} else if (argv.diff) {
  if (!argv.app) {
    console.log('❌ Usage: --diff "from-version to-version" --app "app-name"');
    console.log('   Example: --diff "v1.0.0 v1.1.0" --app "todo-app"');
  } else {
    // Parse diff command: "from-version to-version"
    const parts = argv.diff.split(' ');
    if (parts.length !== 2) {
      console.log('❌ Usage: --diff "from-version to-version" --app "app-name"');
      console.log('   Example: --diff "v1.0.0 v1.1.0" --app "todo-app"');
    } else {
      const [fromVersion, toVersion] = parts;
      await generator.showDiff(argv.app, fromVersion, toVersion);
    }
  }
} else if (argv['clear-cache']) {
  console.log('🧹 Clearing Docker build cache...');
  try {
    execSync('docker system prune -af --volumes', { stdio: 'inherit' });
    execSync('docker builder prune -af', { stdio: 'inherit' });
    console.log('✅ Docker cache cleared successfully!');
    console.log('ℹ️  Next builds will be slower but should not hang');
  } catch (error) {
    console.error('❌ Failed to clear cache:', error.message);
  }
}