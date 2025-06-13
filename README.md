# Chatbot Platform

A platform for creating and managing AI chatbots with file generation capabilities.

## Deployment on Render

1. Create a new Web Service on Render
2. Connect your GitHub repository
3. Configure the following settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment Variables:
     - `PORT`: 3000
     - Add your Firebase configuration variables

## Project Structure

```
/
├── public/           # Static files
├── templates/        # Chatbot templates
├── main-content/     # Common files
├── server.js         # Main server file
├── package.json      # Dependencies
└── .gitignore       # Git ignore file
```

## API Endpoints

- `GET /api/test` - Test server connection
- `POST /api/generate-chatbot/:chatbotId` - Generate chatbot files
- `GET /api/download/:chatbotId` - Download generated files

## Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Access the application at `http://localhost:3000`