#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
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

  async chatWithCerebras(prompt, appName, appPath) {
    console.log(`🤖 Generating ${appName}...`);
    const startTime = Date.now();

    const enhancedPrompt = `${prompt}. Use this syntax for each file: <file path="filename.js">file content here</file>. Make it a complete working application with proper structure. If database storage is needed, use SQLite instead of external databases like Redis or MongoDB. IMPORTANT: For SQLite databases, always use the path './data/database.db' or './data/[appname].db' to ensure persistence in Docker containers.`;

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
      const fileContent = match[2].trim();
      
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

  async buildAndRunDocker(appName, appPath, port) {
    try {
      // Security: Sanitize app name for Docker commands
      appName = this.sanitizeName(appName);
      
      console.log(`🐳 Building Docker image for ${appName}...`);
      
      // Create Dockerfile if it doesn't exist
      const dockerfilePath = path.join(appPath, 'Dockerfile');
      try {
        await fs.access(dockerfilePath);
      } catch {
        // Create basic Dockerfile with SQLite support
        const dockerfile = `FROM node:18-alpine

# Install SQLite for database support
RUN apk add --no-cache sqlite

WORKDIR /app

# Create data directory for persistent storage
RUN mkdir -p /app/data

COPY package.json ./
RUN npm install
COPY . .

# Create volume for database persistence
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["npm", "start"]`;
        await fs.writeFile(dockerfilePath, dockerfile);
      }

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

      // Run new container
      console.log(`🚀 Starting container on port ${port}...`);
      execSync(`docker run -d --name "${appName}" -p ${port}:3000 "${appName}"`, { stdio: 'inherit' });
      
      return { success: true, port };
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
      // Generate app with Cerebras
      const { output, latency, usage } = await this.chatWithCerebras(prompt, appName, appPath);
      
      // Parse and create files
      const createdFiles = await this.parseAndCreateFiles(appPath, output);
      
      // Assign port
      const port = db.data.nextPort++;
      
      // Build and run Docker container
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
      
      console.log(`✅ App ${appName} created successfully!`);
      if (dockerResult.success) {
        console.log(`🌐 Running at http://localhost:${port}`);
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
      // Stop and remove container
      execSync(`docker stop "${appName}"`, { stdio: 'ignore' });
      execSync(`docker rm "${appName}"`, { stdio: 'ignore' });
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