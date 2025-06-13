const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const archiver = require('archiver');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');

const app = express();
app.use(express.json());

// Add CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({ message: 'File generation server is working!' });
});

// Firebase configuration
const firebaseConfig = {
    // Your Firebase config here
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function generateChatbotFiles(chatbotId) {
    try {
        // 1. Get chatbot data from database
        const chatbotDoc = await getDoc(doc(db, 'chatbots', chatbotId));
        if (!chatbotDoc.exists()) {
            throw new Error('Chatbot not found');
        }
        const chatbotData = chatbotDoc.data();

        // 2. Create output directory
        const outputDir = path.join(__dirname, 'output', chatbotId);
        await fs.mkdir(outputDir, { recursive: true });

        // 3. Copy template files
        const templatePath = path.join(__dirname, 'templates', chatbotData.template);
        await copyDir(templatePath, outputDir);

        // 4. Copy main-content files
        const mainContentPath = path.join(__dirname, 'main-content');
        await copyDir(mainContentPath, outputDir);

        // 5. Create .env file with API key
        const envContent = `GOOGLE_API_KEY=${chatbotData.apiKey}`;
        await fs.writeFile(path.join(outputDir, '.env'), envContent);

        return {
            success: true,
            outputPath: outputDir
        };
    } catch (error) {
        console.error('Error generating chatbot files:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Helper function to copy directory
async function copyDir(src, dest) {
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
            error: error.message
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

const PORT = 3000; // Use a different port than your main application
app.listen(PORT, () => {
    console.log(`File generation server running on port ${PORT}`);
    console.log('Available endpoints:');
    console.log('- GET /api/test');
    console.log('- POST /api/generate-chatbot/:chatbotId');
    console.log('- GET /api/download/:chatbotId');
}); 