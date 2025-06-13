// Import required libraries
import dotenv from 'dotenv';
dotenv.config();

import fs from "fs";
import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { PromptTemplate } from "@langchain/core/prompts";
import { RetrievalQAChain } from "langchain/chains";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore } from "langchain/vectorstores/memory";

// Add debug logging
console.log('Environment variables loaded:', {
    API_KEY: process.env.API_KEY ? 'Present' : 'Missing',
    MODEL: process.env.MODEL,
    PURPOSE: process.env.PURPOSE,
    DOCUMENT_CONTENT: process.env.DOCUMENT_CONTENT ? 'Present' : 'Missing'
    // embedding_model: process.env.EMBEDDING_MODEL ? process.env.EMBEDDING_MODEL.replace('models/', '') : 'Default (embedding-001)'
});

// Initialize with environment variables
const GOOGLE_API_KEY = process.env.API_KEY;
if (!GOOGLE_API_KEY) {
    throw new Error("API_KEY environment variable is required");
}

// Get text content from environment
const text = process.env.DOCUMENT_CONTENT || "No content provided";
const purpose = process.env.PURPOSE ? `You are acting as a ${process.env.PURPOSE}. ` : "You are a helpful assistant. ";
const model = process.env.MODEL || "gemini-pro";
const embedding_model = process.env.EMBEDDING_MODEL

// Initialize chat system
let chain;
let initialized = false;

async function initializeChat() {
    if (initialized) return;

    // Validate content
    if (text === "No content provided") {
        throw new Error("DOCUMENT_CONTENT environment variable is required");
    }

    try {
        const splitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
            separators: ["\n\n", "\n", " ", ""],
        });
        
        const docs = await splitter.createDocuments([text.replace(/'''/g, '')]); // Clean text and pass as array

        // Step 2: Embed and Store in VectorStore
        const embeddings = new GoogleGenerativeAIEmbeddings({
            modelName: embedding_model,
            apiKey: GOOGLE_API_KEY,
        });

        const vectorStore = await MemoryVectorStore.fromDocuments(docs, embeddings);
        const retriever = vectorStore.asRetriever();

        // Step 3: Define LLM
        const llm = new ChatGoogleGenerativeAI({
            modelName: model,
            apiKey: GOOGLE_API_KEY,
        });

        // Step 4: Define Bot Prompt
        const template =  purpose + `

    

    Context:
    {context}

    Visitor's Question:
    {question}

    Response:
    `;

    const prompt = PromptTemplate.fromTemplate(template);

    // Step 5: Create Retrieval QA Chain
    chain = await RetrievalQAChain.fromLLM(llm, retriever, {
        returnSourceDocuments: false,
        prompt,
    });

        initialized = true;
    } catch (error) {
        console.error('Error initializing chat:', error);
        initialized = false;
        throw error;
    }
}

// Function to process user messages
export async function processUserMessage(message) {
    if (!initialized) {
        await initializeChat();
    }

    try {
        const response = await chain.invoke({ query: message });
        return response.text;
    } catch (error) {
        console.error('Error processing message:', error);
        return "I apologize, but I encountered an error processing your request. Please try again.";
    }
}
