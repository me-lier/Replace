const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const archiver = require('archiver');
const admin = require('firebase-admin');
const axios = require('axios'); // Import axios
const { Octokit } = require('@octokit/rest'); // Import Octokit
require('dotenv').config(); // Load environment variables from .env file

// GitHub OAuth Credentials
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI || 'https://replace-pkbd.onrender.com/api/github/callback'; // Default to production URL

// Render API Credentials
const RENDER_OWNER_ID = process.env.RENDER_OWNER_ID;
const RENDER_REGION = process.env.RENDER_REGION || 'oregon'; // Default Render region

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    console.error('GitHub Client ID or Client Secret not set in environment variables.');
    // Do not exit, allow other features to work, but deployment will fail.
}

if (!RENDER_OWNER_ID) {
    console.error('Render Owner ID not set in environment variables. Render deployment will fail.');
}

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

// GitHub OAuth login endpoint
app.get('/api/github/login', (req, res) => {
    const userId = req.query.userId; // Get userId from query parameter
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    // Store userId in state parameter
    const state = Buffer.from(JSON.stringify({ userId })).toString('base64');
    
    // Define the scopes needed for GitHub API access
    const scopes = 'repo,workflow';
    
    // Redirect to GitHub OAuth page
    res.redirect(`https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${GITHUB_REDIRECT_URI}&scope=${scopes}&state=${state}`);
});

// GitHub OAuth callback endpoint
app.get('/api/github/callback', async (req, res) => {
    const { code, state } = req.query;
    
    if (!code) {
        return res.status(400).json({ error: 'Authorization code is required' });
    }

    try {
        // Decode state to get userId
        const decodedState = JSON.parse(Buffer.from(state, 'base64').toString());
        const userId = decodedState.userId;

        if (!userId) {
            return res.status(400).json({ error: 'User ID missing from state' });
        }

        // Exchange code for access token
        const response = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: GITHUB_CLIENT_ID,
            client_secret: GITHUB_CLIENT_SECRET,
            code: code,
            redirect_uri: GITHUB_REDIRECT_URI
        }, {
            headers: {
                Accept: 'application/json'
            }
        });

        const accessToken = response.data.access_token;
        
        if (!accessToken) {
            return res.status(400).json({ error: 'Failed to get access token' });
        }

        // Save the access token to Firebase
        await rtdb.ref(`users/${userId}`).update({
            githubAccessToken: accessToken
        });

        // Redirect back to the dashboard
        res.redirect('/dashboard.html');
    } catch (error) {
        console.error('GitHub OAuth error:', error);
        res.status(500).json({ error: 'GitHub authorization failed: ' + error.message });
    }
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

// New endpoint to deploy chatbot files to GitHub/Render
app.post('/api/deploy-chatbot/:chatbotId', async (req, res) => {
    try {
        const { chatbotId } = req.params;
        const { userId } = req.body; // Get userId from request body

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        // Get GitHub Access Token and Render API Key from Firebase
        const userSnapshot = await rtdb.ref(`users/${userId}`).once('value');
        const userData = userSnapshot.val();
        const githubAccessToken = userData ? userData.githubAccessToken : null;
        const renderApiKey = userData ? userData.renderApiKey : null;

        if (!githubAccessToken) {
            return res.status(401).json({ error: 'GitHub authorization required. Please authorize your GitHub account first.' });
        }
        if (!renderApiKey) {
            return res.status(401).json({ error: 'Render API Key required for deployment. Please add it in chatbot settings.' });
        }
        if (!RENDER_OWNER_ID) {
            return res.status(500).json({ error: 'Server configuration error: Render Owner ID not set.' });
        }

        // Initialize Octokit with the user's access token
        const octokit = new Octokit({ auth: githubAccessToken });

        // Get chatbot data from Firebase
        const snapshot = await rtdb.ref(`users/${userId}/chatbots/${chatbotId}`).once('value');
        const chatbotData = snapshot.val();

        if (!chatbotData) {
            return res.status(404).json({ error: 'Chatbot not found' });
        }

        // Generate a unique repository name
        const repoName = `chatbot-${chatbotData.purpose.replace(/\s/g, '-')}-${chatbotId.substring(0, 8).toLowerCase()}`;

        let repoResponse;
        try {
            repoResponse = await octokit.rest.repos.createForAuthenticatedUser({
                name: repoName,
                private: false, // Set to true if you want private repos by default
                description: `Chatbot generated by your app: ${chatbotData.purpose} (ID: ${chatbotId})`,
            });
        } catch (githubCreateRepoError) {
            if (githubCreateRepoError.status === 422 && githubCreateRepoError.response.data.errors[0].message === 'name already exists on this account') {
                return res.status(409).json({ message: `Repository "${repoName}" already exists. Please delete it or choose a new purpose.` });
            }
            console.error('Error creating GitHub repository:', githubCreateRepoError);
            throw new Error(`Failed to create GitHub repository: ${githubCreateRepoError.message}`);
        }
        
        const repoOwner = repoResponse.data.owner.login;
        const repoUrl = repoResponse.data.html_url;

        // Create a temporary directory for file preparation
        const tempDir = path.join(__dirname, 'temp', chatbotId);
        await fs.mkdir(tempDir, { recursive: true });

        // Define the root directory for the app within the GitHub repo
        const appRootDir = path.join(tempDir, 'app'); 
        await fs.mkdir(appRootDir, { recursive: true });

        // Copy main-content files to the app root
        await copyDir(path.join(__dirname, 'main-content'), appRootDir);

        // Copy template files to a public/templates sub-directory within the app root
        const appPublicTemplatesDir = path.join(appRootDir, 'public', 'templates', chatbotData.template);
        await fs.mkdir(appPublicTemplatesDir, { recursive: true });
        await copyDir(path.join(__dirname, 'templates', chatbotData.template), appPublicTemplatesDir);

        // Generate .env file content
        let documentContentFormatted = '';
        if (chatbotData.documentType === 'custom' && chatbotData.documentContent) {
            const escapedContent = chatbotData.documentContent.replace(/"/g, '\"').replace(/\n/g, '\\n');
            documentContentFormatted = `DOCUMENT_CONTENT="${escapedContent}"`;
        }

        const envContent = `# Chatbot Configuration\nAPI_KEY="${chatbotData.apiKey}"\nMODEL="${chatbotData.modelDetails.name}"\nMODEL_PROVIDER="${chatbotData.modelDetails.provider}"\nPURPOSE="${chatbotData.purpose}"\nDOCUMENT_TYPE="${chatbotData.documentType}"\n${documentContentFormatted}\nEMBEDDING_MODEL="models/embedding-001" # Optional, can be configured later\n`;
        await fs.writeFile(path.join(appRootDir, '.env'), envContent); // Save .env inside the app root

        // Add a basic package.json for Node.js deployment on Render
        const packageJsonContent = JSON.stringify({
            name: repoName,
            version: '1.0.0',
            description: `A chatbot generated from ${chatbotData.templateName} template.`,
            main: 'server.js',
            scripts: {
                start: 'node server.js'
            },
            dependencies: {
                express: '^4.18.2',
                'firebase-admin': '^12.0.0',
                axios: '^1.6.0',
                '@octokit/rest': '^20.0.2'
            }
        }, null, 2);
        await fs.writeFile(path.join(appRootDir, 'package.json'), packageJsonContent);

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

// Serve the main application
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Available endpoints:');
    console.log('- GET /api/test');
    console.log('- GET /api/download-chatbot/:chatbotId');
});

// INSTRUCTIONS: Place your serviceAccountKey.json file (downloaded from Firebase Console > Project Settings > Service Accounts) in the project root.
