import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
    apiKey: "AIzaSyBbp-TZkyrCibI6rzh1zN1cAbyQbV464-M",
    authDomain: "hell-nah-68e1c.firebaseapp.com",
    projectId: "hell-nah-68e1c",
    storageBucket: "hell-nah-68e1c.firebasestorage.app",
    messagingSenderId: "164835581476",
    appId: "1:164835581476:web:e0445b346348449293c2b1",
    measurementId: "G-P2K90TB93B"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export default app;
