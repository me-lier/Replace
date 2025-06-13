// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    sendPasswordResetEmail,
    signOut,
    RecaptchaVerifier,
    signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { firebaseConfig } from './config.js';

console.log('Initializing Firebase with config:', firebaseConfig);

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Initialize reCAPTCHA verifier
const setupRecaptcha = (phoneNumber) => {
    const recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        'size': 'normal',
        'callback': (response) => {
            // reCAPTCHA solved, allow signInWithPhoneNumber.
            console.log('reCAPTCHA verified');
        }
    });
    return recaptchaVerifier;
};

console.log('Firebase initialized successfully');

// Export auth functions
export {
    auth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    googleProvider,
    sendPasswordResetEmail,
    signOut,
    setupRecaptcha,
    signInWithPhoneNumber
};

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyBHepnJbS30yYzZkR1ZyQ1yF1eVKOEDbZo",
    authDomain: "replace-8af45.firebaseapp.com",
    databaseURL: "https://replace-8af45-default-rtdb.firebaseio.com",
    projectId: "replace-8af45",
    storageBucket: "replace-8af45.firebasestorage.app",
    messagingSenderId: "228567518315",
    appId: "1:228567518315:web:9b620686bd70d5afb4f52e",
    measurementId: "G-7K6W5KETK2"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Function to save chatbot data
async function saveChatbotData(data) {
    try {
        const user = firebase.auth().currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }

        // Save to Firebase under user's UID
        const chatbotRef = firebase.database().ref(`users/${user.uid}/chatbots`).push();
        await chatbotRef.set({
            ...data,
            createdAt: firebase.database.ServerValue.TIMESTAMP
        });

        return chatbotRef.key;
    } catch (error) {
        console.error('Error saving chatbot data:', error);
        throw error;
    }
}

// Make function available globally
window.saveChatbotData = saveChatbotData; 