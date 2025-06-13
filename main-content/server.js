import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { processUserMessage } from './chat.js';

// Load environment variables
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// API endpoint for chat
app.post('/query', async (req, res) => {
    try {
        const { question } = req.body;
        if (!question) {
            return res.status(400).json({ error: 'Question is required' });
        }
        const response = await processUserMessage(question);
        return res.json({ response });
    } catch (error) {
        console.error('Error processing query:', error);
        return res.status(500).json({ error: error.message || 'Internal server error' });
        res.status(500).json({ error: 'Failed to process query' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
