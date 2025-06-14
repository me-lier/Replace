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
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI || 'http://localhost:3000/api/github/callback'; // Default for local testing

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

// GitHub OAuth login initiation
app.get('/api/github/login', (req, res) => {
    const scopes = 'repo workflow'; // Permissions your app needs
    res.redirect(`https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${GITHUB_REDIRECT_URI}&scope=${scopes}`);
});

// GitHub OAuth callback handler
app.get('/api/github/callback', async (req, res) => {
    const code = req.query.code;
    const userId = req.query.state; // We'll pass userId as state to identify the user after callback

    if (!code) {
        console.error('No code received from GitHub');
        return res.status(400).send('GitHub authorization failed: No code received.');
    }
    if (!userId) {
        console.error('No userId received in OAuth state');
        return res.status(400).send('GitHub authorization failed: User ID missing.');
    }

    try {
        // Exchange code for an access token
        const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: GITHUB_CLIENT_ID,
            client_secret: GITHUB_CLIENT_SECRET,
            code: code,
            redirect_uri: GITHUB_REDIRECT_URI,
        }, {
            headers: { Accept: 'application/json' }
        });

        const accessToken = tokenResponse.data.access_token;

        if (!accessToken) {
            console.error('No access token received from GitHub', tokenResponse.data);
            return res.status(500).send('GitHub authorization failed: Could not retrieve access token.');
        }

        // Save the access token to Firebase under the user's profile
        await rtdb.ref(`users/${userId}/githubAccessToken`).set(accessToken);

        // Redirect back to the dashboard or a success page
        res.redirect('/dashboard.html?githubAuth=success');

    } catch (error) {
        console.error('Error during GitHub OAuth callback:', error);
        res.status(500).send('Error during GitHub authorization.');
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
            description: `A chatbot generated from ${chatbotData.templateName} template.`, // Use templateName for description
            main: 'server.js',
            scripts: {
                start: 'node server.js'
            },
            dependencies: {
                express: '^4.18.2',
                'firebase-admin': '^12.0.0',
                axios: '^1.6.0',
                '@octokit/rest': '^20.0.2'
                // Add any other core dependencies your server.js might implicitly use from main-content
            }
        }, null, 2);
        await fs.writeFile(path.join(appRootDir, 'package.json'), packageJsonContent);

        // Add a simple .gitignore
        await fs.writeFile(path.join(appRootDir, '.gitignore'), 'node_modules/\n.env\n');

        // Read all files from the prepared app directory into a structure for Git tree
        const filesToUpload = await getFileTreeForGithub(appRootDir, 'app'); // Get files from 'app' relative to repo root

        // Get the latest commit SHA and tree SHA of the default branch (usually 'main')
        let latestCommitSha = null;
        let latestTreeSha = null;

        try {
            const { data: refData } = await octokit.rest.git.getRef({
                owner: repoOwner,
                repo: repoName,
                ref: 'heads/main',
            });
            const { data: commitData } = await octokit.rest.git.getCommit({
                owner: repoOwner,
                repo: repoName,
                commit_sha: refData.object.sha,
            });
            latestCommitSha = commitData.sha;
            latestTreeSha = commitData.tree.sha;
        } catch (err) {
            // This is expected for a brand new repository
            console.log(`Repository ${repoName} is new, creating first commit.`);
        }

        // Create blobs for each file
        const tree = [];
        for (const file of filesToUpload) {
            const blobResponse = await octokit.rest.git.createBlob({
                owner: repoOwner,
                repo: repoName,
                content: file.content,
                encoding: 'utf-8',
            });
            tree.push({
                path: file.path,
                mode: '100644', // File mode
                type: 'blob',
                sha: blobResponse.data.sha,
            });
        }

        // Create a new tree with the updated files
        const { data: newTree } = await octokit.rest.git.createTree({
            owner: repoOwner,
            repo: repoName,
            tree,
            base_tree: latestTreeSha || undefined,
        });

        // Create a new commit
        const { data: newCommit } = await octokit.rest.git.createCommit({
            owner: repoOwner,
            repo: repoName,
            message: 'Initial chatbot deployment generated by app',
            tree: newTree.sha,
            parents: latestCommitSha ? [latestCommitSha] : [],
        });

        // Update the branch reference (create it if it's the first commit)
        if (latestCommitSha) {
            await octokit.rest.git.updateRef({
                owner: repoOwner,
                repo: repoName,
                ref: 'heads/main',
                sha: newCommit.sha,
                force: true,
            });
        } else {
            await octokit.rest.git.createRef({
                owner: repoOwner,
                repo: repoName,
                ref: 'refs/heads/main',
                sha: newCommit.sha,
            });
        }

        // --- Render Deployment Logic --- 
        // Parse envContent into Render API compatible envVars array
        const renderEnvVars = [];
        const envLines = envContent.split('\\n'); 
        envLines.forEach(line => {
            if (line.trim() && !line.startsWith('#')) { 
                const [key, value] = line.split('=');
                if (key && value) {
                    renderEnvVars.push({ key: key.trim(), value: value.trim().replace(/^"|"$/g, '') }); 
                }
            }
        });

        const renderApiUrl = 'https://api.render.com/v1/services';
        const renderServiceName = repoName; 

        const renderResponse = await axios.post(renderApiUrl, {
            ownerId: RENDER_OWNER_ID,
            type: 'web_service',
            serviceDetails: {
                name: renderServiceName,
                repo: repoUrl,
                branch: 'main',
                buildCommand: 'npm install',
                startCommand: 'npm start',
                autoDeploy: 'yes',
                pullRequestPreviewsEnabled: 'no',
                envVars: renderEnvVars,
                planId: 'starter', // Or 'free' if applicable
                region: RENDER_REGION, 
                rootDirectory: 'app' // Crucial: tell Render that the app is in the 'app' sub-directory
            },
            // Optionally add more details like healthCheckPath, customDomains etc.
        }, {
            headers: {
                'Authorization': `Bearer ${renderApiKey}`,
                'Content-Type': 'application/json'
            }
        });

        const renderServiceUrl = renderResponse.data.url; // URL of the deployed Render service
        
        res.status(200).json({
            message: 'Chatbot deployed to GitHub and Render successfully!',
            repoUrl: repoUrl,
            renderServiceUrl: renderServiceUrl
        });

    } catch (error) {
        console.error('Error during chatbot deployment to GitHub/Render:', error.response ? error.response.data : error.message);
        let errorMessage = 'Failed to deploy chatbot.';
        if (error.response && error.response.data && error.response.data.message) {
            errorMessage = error.response.data.message;
        } else if (error.message) {
            errorMessage = error.message;
        }
        res.status(500).json({ error: errorMessage });
    } finally {
        // Clean up temporary directory after all operations
        if (tempDir) {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    }
});

// Helper function to recursively read directory contents for GitHub upload
async function getFileTreeForGithub(directoryPath, baseRepoPath) {
    let files = [];
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(directoryPath, entry.name);
        const repoPath = path.join(baseRepoPath, entry.name);
        if (entry.isDirectory()) {
            files = files.concat(await getFileTreeForGithub(fullPath, repoPath));
        } else {
            const content = await fs.readFile(fullPath, 'utf8');
            files.push({ path: repoPath, content: content });
        }
    }
    return files;
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