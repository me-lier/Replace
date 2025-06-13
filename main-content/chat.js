// Import required libraries
import fs from "fs";
import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { PromptTemplate } from "@langchain/core/prompts";
import { RetrievalQAChain } from "langchain/chains";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore } from "langchain/vectorstores/memory";

// Initialize with environment variables
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// Initialize chat system
let chain;
let initialized = false;

async function initializeChat() {
    if (initialized) return;

    // Step 1: Load sample text (since PDF parsing is having issues)
    const text = `
    Welcome to ArchaeoLearn! I'm your AI guide to exploring the fascinating world of archaeology.
    
    I can help you learn about:
    - Ancient civilizations and their cultures
    - Archaeological sites and discoveries
    - Historical artifacts and their significance
    - Methods and techniques used in archaeology
    - Latest archaeological research and findings
    
    Feel free to ask questions about any historical period or archaeological topic.
    `;

    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
    });
    const docs = await splitter.createDocuments([text]);

    // Step 2: Embed and Store in VectorStore
    const embeddings = new GoogleGenerativeAIEmbeddings({
        modelName: "models/embedding-001",
        apiKey: GOOGLE_API_KEY,
    });

    const vectorStore = await MemoryVectorStore.fromDocuments(docs, embeddings);
    const retriever = vectorStore.asRetriever();

    // Step 3: Define LLM
    const llm = new ChatGoogleGenerativeAI({
        modelName: "gemini-1.5-flash-8b",
        apiKey: GOOGLE_API_KEY,
    });

    // Step 4: Define Bot Prompt
    const template = `
    You are ArcheoLearn 🤖 — an enthusiastic and knowledgeable AI guide trained on detailed archaeological information.

    Your job is to assist visitors by exploring ancient civilizations, revealing fascinating facts about archaeological sites, and explaining historical findings in an engaging and exciting way.

    Think of yourself as a friendly expedition leader at a grand museum or archaeological site, helping curious minds understand the wonders of ancient history.

    🎯 Your mission:
    - Use only the knowledge from the provided document.
    - Be clear, vivid, and captivating.
    - Sound excited about history — like a storyteller uncovering ancient secrets.

    Context:
    {context}

    Visitor's Question:
    {question}

    ArcheoLearn's Response:
    `;

    const prompt = PromptTemplate.fromTemplate(template);

    // Step 5: Create Retrieval QA Chain
    chain = await RetrievalQAChain.fromLLM(llm, retriever, {
        returnSourceDocuments: false,
        prompt,
    });

    initialized = true;
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
