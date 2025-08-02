export const createEnhancementPrompt = (prompt, analysis) => {
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

  return enhancementPrompt;
}; 