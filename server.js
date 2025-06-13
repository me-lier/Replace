const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const archiver = require('archiver');
const admin = require('firebase-admin');

// Load service account key
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://replace-8af45-default-rtdb.firebaseio.com"
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

async function generateChatbotFiles(chatbotId) {
    try {
        console.log('Attempting to fetch chatbot data for ID:', chatbotId);
        // 1. Get chatbot data from Realtime Database
        const snapshot = await rtdb.ref(`chatbots/${chatbotId}`).once('value');
        const chatbotData = snapshot.val();

        if (!chatbotData) {
            console.error('Chatbot document not found for ID:', chatbotId);
            throw new Error('Chatbot not found');
        }
        console.log('Successfully fetched chatbot data:', chatbotData);

        // 2. Create output directory
        const outputDir = path.join(__dirname, 'output', chatbotId);
        await fs.mkdir(outputDir, { recursive: true });
        console.log('Created output directory:', outputDir);

        // 3. Copy template files
        const templatePath = path.join(__dirname, 'templates', chatbotData.template);
        await copyDir(templatePath, outputDir);
        console.log('Copied template files from:', templatePath);

        // 4. Copy main-content files
        const mainContentPath = path.join(__dirname, 'main-content');
        await copyDir(mainContentPath, outputDir);
        console.log('Copied main-content files from:', mainContentPath);

        // 5. Create .env file with API key
        const envContent = `GOOGLE_API_KEY=${chatbotData.apiKey}`;
        await fs.writeFile(path.join(outputDir, '.env'), envContent);
        console.log('Created .env file with API key');

        return {
            success: true,
            outputPath: outputDir
        };
    } catch (error) {
        console.error('Error in generateChatbotFiles:', error);
        throw error;
    }
}

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

// API endpoint to generate chatbot files
app.post('/api/generate-chatbot/:chatbotId', async (req, res) => {
    console.log('Received request to generate chatbot:', req.params.chatbotId);
    try {
        const { chatbotId } = req.params;
        const result = await generateChatbotFiles(chatbotId);
        if (result.success) {
            console.log('Successfully generated files for chatbot:', chatbotId);
            res.json({
                success: true,
                message: 'Chatbot files generated successfully',
                outputPath: result.outputPath
            });
        } else {
            console.error('Failed to generate files:', result.error);
            res.status(500).json({
                success: false,
                error: result.error
            });
        }
    } catch (error) {
        console.error('Error in generate-chatbot endpoint:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'An unexpected error occurred'
        });
    }
});

// Download endpoint
app.get('/api/download/:chatbotId', async (req, res) => {
    console.log('Received request to download chatbot:', req.params.chatbotId);
    try {
        const { chatbotId } = req.params;
        const outputDir = path.join(__dirname, 'output', chatbotId);
        // Check if directory exists
        try {
            await fs.access(outputDir);
        } catch {
            console.error('Chatbot files not found:', chatbotId);
            return res.status(404).json({ error: 'Chatbot files not found' });
        }
        // Create zip file
        const archive = archiver('zip', {
            zlib: { level: 9 } // Maximum compression
        });
        // Set response headers
        res.attachment(`chatbot-${chatbotId}.zip`);
        archive.pipe(res);
        // Add files to zip
        archive.directory(outputDir, false);
        // Finalize the archive
        await archive.finalize();
    } catch (error) {
        console.error('Error creating zip file:', error);
        res.status(500).json({ error: 'Failed to create zip file' });
    }
});

// Serve the main application
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Available endpoints:');
    console.log('- GET /api/test');
    console.log('- POST /api/generate-chatbot/:chatbotId');
    console.log('- GET /api/download/:chatbotId');
});

// INSTRUCTIONS: Place your serviceAccountKey.json file (downloaded from Firebase Console > Project Settings > Service Accounts) in the project root. 