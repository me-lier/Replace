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
    signInWithPhoneNumber,
    updateProfile
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// Get firebaseConfig from global window object
const firebaseConfig = window.firebaseConfig;

console.log('Initializing Firebase with config:', firebaseConfig);

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const googleProvider = new firebase.auth.GoogleAuthProvider();

// Initialize reCAPTCHA verifier
const setupRecaptcha = (phoneNumber) => {
    const recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
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
    signInWithPhoneNumber,
    updateProfile
};

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
