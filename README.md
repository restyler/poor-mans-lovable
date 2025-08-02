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

### Benchmark Results

We generated 10 different applications to benchmark Cerebras API performance:

| App Type | Complexity | Latency | Tokens | Files | Speed (tok/s) |
|----------|------------|---------|--------|-------|---------------|
| Todo REST API | Simple | 2.7s | 1,757 | 5 | 650 |
| Weather API | Medium | 1.2s | 1,390 | 7 | 1,116 |
| File Upload API | Simple | 1.8s | 2,200 | 6 | 1,248 |
| URL Shortener | Complex | 2.8s | 3,627 | 8 | 1,283 |
| GraphQL API | Complex | 1.9s | 3,109 | 6 | 1,646 |
| HTML Landing | Frontend | 1.8s | 2,815 | 3 | 1,587 |
| Blog API | Complex | 2.5s | 4,950 | 4 | 1,946 |
| Full-Stack Blog | Full-Stack | 3.1s | 6,167 | 8 | 1,984 |

### Key Findings

**🚀 Consistent Speed**: 1.2-3.1 second latency across all app types  
**📈 High Throughput**: 650-1,984 tokens/second generation speed  
**🎯 Quality Output**: All apps generated with proper file structure and working code  
**📁 Multi-file Support**: Successfully creates 3-8 files per application  
**🧠 Complex Logic**: Handles GraphQL schemas, SQLite databases, authentication, full-stack applications  

### Performance Characteristics

- **Simple APIs**: ~1.5s average, ~1000 tok/s
- **Complex Apps**: ~2.5s average, ~1400 tok/s  
- **Full-Stack Apps**: ~3.0s average, ~1900 tok/s
- **Frontend Apps**: ~1.8s average, ~1400 tok/s

Each generation shows:
```
⚡ Latency: 1889ms
📊 Tokens - Prompt: 51, Completion: 3058, Total: 3109
```

## Database Integration

**🗄️ SQLite Support**: All generated apps use SQLite for database needs instead of external dependencies like Redis or MongoDB. This ensures:

- **Zero External Dependencies**: No need to run separate database containers
- **Persistent Storage**: Database files are stored in Docker volumes
- **Production Ready**: Full SQL support with foreign keys and relationships
- **Easy Development**: Works out of the box without configuration

### Database Features

- User authentication with bcrypt password hashing
- Blog posts with author relationships
- Comments system with foreign keys
- Automatic schema creation on startup
- Data persistence across container restarts

## Docker Integration

- Auto-builds Docker images for each app
- Includes SQLite support in all containers
- Manages port allocation (3100, 3101, 3102...)
- Names containers by app name for easy management
- Creates persistent volumes for database storage
- Handles container start/stop/remove operations