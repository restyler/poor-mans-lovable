# Cerebras App Generator

Generate complete applications using Cerebras AI with automatic Docker containerization and management.

## Setup

1. Create `.env` file with your Cerebras API key:
```bash
CEREBRAS_API_KEY=your_api_key_here
```

2. Install dependencies:
```bash
npm install
```

## Usage

### Generate a New App
```bash
node create-app.js "Build a todo list REST API with Express.js"
```

### List Running Apps
```bash
node create-app.js --list
```

### Stop an App
```bash
node create-app.js --stop simple-todo-rest
```

### Remove an App
```bash
node create-app.js --remove simple-todo-rest
```

## Features

- 🤖 **AI-Powered Generation**: Uses Cerebras AI to generate complete applications
- 📁 **Organized Structure**: Each app gets its own folder in `./tmp/`
- 🐳 **Docker Integration**: Automatic containerization and port management
- 📊 **Performance Tracking**: Displays API latency and token usage
- 🗂️ **App Management**: JSON-based storage to track all generated apps
- 🔒 **Safe Generation**: Generated files are isolated in tmp/ to protect your project

## Generated App Structure

```
./tmp/
├── simple-todo-rest/     # Auto-generated descriptive folder name
│   ├── package.json
│   ├── server.js
│   ├── routes/
│   ├── controllers/
│   └── models/
├── nodejs-weather-api/   # Each app gets its own container
│   ├── Dockerfile        # Auto-generated Docker setup
│   └── ...
└── apps.json            # Tracks all generated apps
```

## Examples

```bash
# Generate a REST API
node create-app.js "Create a blog REST API with user authentication"

# Generate a web scraper
node create-app.js "Build a Node.js web scraper for news articles"

# Generate a real-time chat app
node create-app.js "Create a Socket.io chat application with rooms"
```

## API Response Format

The tool expects Cerebras to return files in this format:
```xml
<file path="filename.js">
// file content here
</file>
```

## Management

All apps are tracked in `apps.json` with:
- App name and description
- Generated folder path
- Docker container info
- Port assignments (starting from 3100)
- Creation timestamp
- Performance metrics (latency, tokens)

## Performance

Recent generations:
- **Todo API**: 2.7s latency, 1757 tokens
- **Weather API**: 1.2s latency, 1390 tokens

Each generation shows:
```
⚡ Latency: 2703ms
📊 Tokens - Prompt: 48, Completion: 1709, Total: 1757
```

## Docker Integration

- Auto-builds Docker images for each app
- Manages port allocation (3100, 3101, 3102...)
- Names containers by app name for easy management
- Handles container start/stop/remove operations