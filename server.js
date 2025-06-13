const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const archiver = require('archiver');
const admin = require('firebase-admin');
require('dotenv').config(); // Load environment variables from .env file

// Load service account key from file path specified in environment variable
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_FILE_PATH;

if (!serviceAccountPath) {
  console.error('FIREBASE_SERVICE_ACCOUNT_FILE_PATH environment variable is not set.');
  process.exit(1);
}

let serviceAccount;
try {
  const rawServiceAccount = require(serviceAccountPath);
  serviceAccount = rawServiceAccount;
} catch (error) {
  console.error(`Failed to load service account file from ${serviceAccountPath}:`, error);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL_SERVER || "https://replace-8af45-default-rtdb.firebaseio.com"
});

// Change db to rtdb for Realtime Database
const rtdb = admin.database();

const app = express();
app.use(express.json());

// Add CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Serve static files
app.use(express.static('public'));
app.use('/templates', express.static('templates'));

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({ message: 'Server is working!' });
});

// Download chatbot files endpoint
app.get('/api/download-chatbot/:chatbotId', async (req, res) => {
    try {
        const { chatbotId } = req.params;
        const userId = req.query.userId; // Get userId from query parameter

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        // Get chatbot data from Firebase
        const snapshot = await rtdb.ref(`users/${userId}/chatbots/${chatbotId}`).once('value');
        const chatbotData = snapshot.val();

        if (!chatbotData) {
            return res.status(404).json({ error: 'Chatbot not found' });
        }

        // Create a temporary directory for the files
        const tempDir = path.join(__dirname, 'temp', chatbotId);
        await fs.mkdir(tempDir, { recursive: true });

        // Copy main-content files
        const mainContentDir = path.join(__dirname, 'main-content');
        await copyDir(mainContentDir, tempDir);

        // Copy template files
        const templateDir = path.join(__dirname, 'templates', chatbotData.template);
        await copyDir(templateDir, tempDir);

        // Create .env file
        let documentContentFormatted = '';
        if (chatbotData.documentType === 'custom' && chatbotData.documentContent) {
            // Escape double quotes and newlines for .env file
            const escapedContent = chatbotData.documentContent.replace(/"/g, '\"').replace(/\n/g, '\\n');
            documentContentFormatted = `DOCUMENT_CONTENT="${escapedContent}"`;
        }

        const envContent = `# Chatbot Configuration
API_KEY="${chatbotData.apiKey}"
MODEL="${chatbotData.modelDetails.name}"
MODEL_PROVIDER="${chatbotData.modelDetails.provider}"
PURPOSE="${chatbotData.purpose}"
DOCUMENT_TYPE="${chatbotData.documentType}"
${documentContentFormatted}
EMBEDDING_MODEL="models/embedding-001" # Optional, can be configured later
`;
        await fs.writeFile(path.join(tempDir, '.env'), envContent);

        // Create a zip file
        const archive = archiver('zip', {
            zlib: { level: 9 } // Maximum compression
        });

        // Set response headers
        res.attachment(`chatbot-${chatbotId}.zip`);
        archive.pipe(res);

        // Add files to zip
        archive.directory(tempDir, false);

        // Finalize the archive
        await archive.finalize();

        // Clean up temporary directory
        await fs.rm(tempDir, { recursive: true, force: true });

    } catch (error) {
        console.error('Error creating chatbot files:', error);
        res.status(500).json({ error: 'Failed to create chatbot files' });
    }
});

// Helper function to copy directory
async function copyDir(src, dest) {
    try {
        const entries = await fs.readdir(src, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                await fs.mkdir(destPath, { recursive: true });
                await copyDir(srcPath, destPath);
            } else {
                await fs.copyFile(srcPath, destPath);
            }
        }
    } catch (error) {
        console.error('Error copying directory:', error);
        throw new Error(`Failed to copy directory: ${error.message}`);
    }
}

// Serve the main application
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Available endpoints:');
    console.log('- GET /api/test');
    console.log('- GET /api/download-chatbot/:chatbotId');
});

// INSTRUCTIONS: Place your serviceAccountKey.json file (downloaded from Firebase Console > Project Settings > Service Accounts) in the project root. 