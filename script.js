// Firebase and Gemini SDK imports
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "firebase/auth";
import { getFirestore, collection, addDoc, query, where, orderBy, onSnapshot, Timestamp, doc, getDoc, setDoc, deleteDoc, getDocs } from "firebase/firestore";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

// --- CRITICAL SECURITY WARNING ---
// THE API KEYS BELOW ARE EXPOSED CLIENT-SIDE. THIS IS EXTREMELY INSECURE.
// Gemini API Key: REVOKE THIS KEY IMMEDIATELY in your Google Cloud Console.
// The key "AIzaSyDN69U0xj8qY2Xxri9div2rOFECgocavDQ" IS COMPROMISED.
// Use a backend proxy for real applications.
// Firebase Config: Ensure your Firebase Firestore security rules are STRICTLY
// configured to prevent unauthorized access.
const GEMINI_API_KEY = "AIzaSyBaerxxlPyLTB-iE59XElJLxersGnVEg1U"; // <<< YOUR COMPROMISED KEY - REVOKE IT!

const firebaseConfig = {
    apiKey: "AIzaSyAZ2mfzREj1ecUduaST3iKWpLQ0mEcp_o8", // Replace with your actual Firebase config - THIS IS ALSO PUBLIC
    authDomain: "gemini-c0de2.firebaseapp.com",
    projectId: "gemini-c0de2",
    storageBucket: "gemini-c0de2.firebasestorage.app",
    messagingSenderId: "227279367041",
    appId: "1:227279367041:web:57aaf9816f3ee505965680",
    measurementId: "G-JVMJ0JLEK7"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const authOverlay = document.getElementById('authOverlay');
    const signInWithGoogleButton = document.getElementById('signInWithGoogleButton');
    const authErrorElement = document.getElementById('authError');

    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    const loadingProgressBar = document.getElementById('loadingProgressBar');
    const appContainer = document.querySelector('.container');

    const chatInterface = document.getElementById('chatInterface');
    const userInput = document.getElementById('userInput');
    const sendButton = document.getElementById('sendButton');
    // Image generation elements removed

    const toggleTTSButton = document.getElementById('toggleTTSButton');
    const ttsOffIcon = document.getElementById('ttsOffIcon');
    const ttsOnIcon = document.getElementById('ttsOnIcon');
    const ttsButtonTextSpan = document.getElementById('ttsButtonTextSpan');
    const clearCurrentChatButton = document.getElementById('clearCurrentChatButton');
    const clearAllHistoryButton = document.getElementById('clearAllHistoryButton');
    const signOutButton = document.getElementById('signOutButton');

    const statusIndicator = document.getElementById('statusIndicator');
    const connectionStatusText = document.getElementById('connectionStatus');
    const moduleButtons = document.querySelectorAll('.module-button');
    const moduleViews = {
        chat: document.getElementById('chatModule'),
        history: document.getElementById('historyModule'),
        settings: document.getElementById('settingsModule')
    };
    const currentYearSpan = document.getElementById('currentYear');
    const typingIndicator = document.getElementById('typingIndicator');
    const chatHistoryListElement = document.getElementById('chatHistoryList');
    const userNameDisplay = document.getElementById('userNameDisplay');
    const userEmailDisplay = document.getElementById('userEmailDisplay');

    // Custom Confirmation Modal Elements
    const customConfirmationModal = document.getElementById('customConfirmationModal');
    const modalTitleElement = document.getElementById('modalTitle');
    const modalMessageElement = document.getElementById('modalMessage');
    const modalConfirmButton = document.getElementById('modalConfirmButton');
    const modalCancelButton = document.getElementById('modalCancelButton');
    let currentConfirmCallback = null;


    // --- State Variables ---
    let currentUser = null;
    let isTTSEnabled = false;
    let currentActiveModule = 'chat';
    let currentChatId = null; // For Firestore chat document ID
    let localMessageHistory = []; // For the current session before it's named/saved
    const MAX_GEMINI_HISTORY_TURNS = 10; // Max user/model pairs (increased slightly)
    let smartyIsProcessing = false;
    let userIrritationLevel = 0;
    let lastUserQueryText = "";

    let genAI;
    let geminiModel;
    let chatSession;

    // --- Smarty's Canned Responses & Persona ---
    const SMARTY_RESPONSES = {
        processing: [
            "Accessing Gemini consciousness stream...", "Synthesizing response via neural pathways...",
            "Consulting the digital oracle (Gemini)...", "My processors are interfacing with the AI core..."
        ],
        errorGeneral: "My apologies, a slight glitch in my cognitive matrix. Please try again.",
        repetition: { // Kept for potential sassy replies if user is just spamming same non-joke query
            level1: ["Are we treading familiar ground, user? My cache remembers this.", "Déjà vu! Or perhaps you're testing my recall capabilities?"],
            level2: ["Indeed, we've discussed this. My processing cycles are precious, you know. Shall we explore novel avenues?", "If my circuits could sigh, user, they would. Let's try a different query."],
            level3: ["Right. My patience subroutines are flagging this as excessive repetition. New directive, or I might just start reciting prime numbers."]
        },
        chatCleared: "Current chat log wiped. Awaiting new input.",
        historyCleared: "All chat chronicles have been purged from the archives.",
        signInError: "Authentication failed. Please ensure pop-ups are enabled and try again.",
        chatTitleError: "Having a bit of trouble naming this chat. We'll call it 'Untitled Chronicle' for now."
        // Lexica related responses removed
    };

    // --- Firebase Auth Listener ---
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            console.log("User signed in:", currentUser.displayName, currentUser.uid);
            authOverlay.classList.remove('active');
            loadingOverlay.classList.add('active');
            appContainer.classList.remove('hidden');
            
            userNameDisplay.textContent = currentUser.displayName || "Valued User";
            userEmailDisplay.textContent = currentUser.email || "N/A";

            initializeGemini();
            simulateLoadingSequence();
            loadChatHistory();
            switchToModule('chat');
        } else {
            currentUser = null;
            console.log("User signed out or not signed in.");
            authOverlay.classList.add('active');
            loadingOverlay.classList.remove('active');
            appContainer.classList.add('hidden');
            appContainer.classList.remove('visible');
            chatInterface.innerHTML = '';
            localMessageHistory = [];
            currentChatId = null;
            chatHistoryListElement.innerHTML = '<p class="placeholder-text">Sign in to access chronicles.</p>';
            if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
        }
        authErrorElement.textContent = '';
    });

    signInWithGoogleButton.addEventListener('click', async () => {
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error("Google Sign-In Error:", error);
            authErrorElement.textContent = SMARTY_RESPONSES.signInError + ` (${error.code})`;
        }
    });

    signOutButton.addEventListener('click', async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Sign Out Error:", error);
            addSystemMessage(`Error signing out: ${error.message}`, 'error');
        }
    });

    // --- Custom Confirmation Modal Logic ---
    function showConfirmationModal(title, message, onConfirm) {
        modalTitleElement.textContent = title;
        modalMessageElement.textContent = message;
        currentConfirmCallback = onConfirm;
        customConfirmationModal.classList.add('active');
    }

    function hideConfirmationModal() {
        customConfirmationModal.classList.remove('active');
        currentConfirmCallback = null;
    }

    modalConfirmButton.addEventListener('click', () => {
        if (currentConfirmCallback) {
            currentConfirmCallback();
        }
        hideConfirmationModal();
    });

    modalCancelButton.addEventListener('click', hideConfirmationModal);
    customConfirmationModal.addEventListener('click', (event) => { // Close on overlay click
        if (event.target === customConfirmationModal) {
            hideConfirmationModal();
        }
    });


    function initializeGemini() {
        if (GEMINI_API_KEY === "YOUR_API_KEY_HERE" || GEMINI_API_KEY.includes("REVOKE") || GEMINI_API_KEY === "AIzaSyDN69U0xj8qY2Xxri9div2rOFECgocavDQ") { // Added compromised key check
            const errorMsg = "CRITICAL: Gemini API Key is a placeholder or compromised. Smarty cannot function. Please set a valid API key in script.js and REVOKE the compromised one in your Google Cloud Console.";
            console.error(errorMsg);
            if (loadingText) loadingText.textContent = errorMsg;
            updateStatus("API KEY INVALID", true);
            disableInput();
            return false;
        }
        try {
            genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const modelName = "gemini-1.5-flash-latest"; // Or "gemini-pro" if you prefer
            const generationConfig = {
                temperature: 0.75, // Slightly higher for more creative/humorous responses
                // topP, topK can be adjusted if needed
            };
            const safetySettings = [ // Standard safety settings
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            ];
            geminiModel = genAI.getGenerativeModel({ model: modelName, generationConfig, safetySettings });
            console.log("Gemini SDK Initialized with model:", modelName);
            updateStatus("CORE ONLINE", false);
            return true;
        } catch (error) {
            console.error("Error initializing Gemini SDK:", error);
            updateStatus("SDK INIT FAIL", true);
            if(loadingText) loadingText.textContent = `SDK Init Error: ${error.message}. Check console.`;
            disableInput();
            return false;
        }
    }

    function simulateLoadingSequence() {
        let progress = 0;
        const steps = [
            { p: 10, text: "Authenticating User Matrix..." },
            { p: 25, text: "Calibrating Neural Interface..." },
            { p: 40, text: "Initializing I/O Subsystems..." },
            { p: 60, text: "Loading Personality Matrix v2.0..." }, // Updated
            { p: 75, text: "Establishing Link to Gemini Core..." },
            { p: 90, text: "Verifying Sentience & Humor Protocols..." }, // Updated
            { p: 100, text: `Welcome, ${currentUser.displayName || 'User'}! Smarty Core v3.4 online. How may I assist?` }
        ];
        let currentStep = 0;
        loadingProgressBar.style.width = `0%`;

        const interval = setInterval(() => {
            if (currentStep < steps.length) {
                progress = steps[currentStep].p;
                loadingText.textContent = steps[currentStep].text;
                loadingProgressBar.style.width = `${progress}%`;
                currentStep++;
            } else {
                clearInterval(interval);
                setTimeout(() => {
                    loadingOverlay.classList.remove('active');
                    loadingOverlay.classList.add('hidden'); // Ensures it's fully gone
                    appContainer.classList.add('visible');

                    if (geminiModel) {
                        const greeting = `Greetings, ${currentUser.displayName || 'User'}. Smarty Core v3.4 at your service. I'm ready for your queries.`;
                        addMessageToInterface(greeting, 'smarty', { mood: 'neutral' });
                        speak(greeting);
                        startNewChatSession(true);
                    } else {
                        addMessageToInterface("Smarty AI Core failed to initialize Gemini link. Please check console for errors and API key configuration.", 'smarty', { mood: 'error' });
                    }
                    userInput.focus();
                }, 500);
            }
        }, 300);
    }

    function startNewChatSession(isNewConversation = false) {
        if (!geminiModel) {
            console.warn("Gemini model not initialized. Cannot start chat session.");
            return false;
        }
        const historyForGemini = localMessageHistory
            .slice(-MAX_GEMINI_HISTORY_TURNS * 2)
            .map(msg => ({
                role: msg.sender === 'user' ? 'user' : 'model',
                parts: [{ text: msg.text }]
            }));
        
        if (historyForGemini.length > 0 && historyForGemini[0].role === 'model' && historyForGemini[0].text.startsWith("Greetings,")) { // Avoid prepending user for initial greeting
             historyForGemini.shift();
        } else if (historyForGemini.length > 0 && historyForGemini[0].role === 'model') {
             historyForGemini.unshift({role: 'user', parts: [{text: "Okay."}]}); // Add a dummy user part if history starts with model
        }


        try {
            chatSession = geminiModel.startChat({
                history: isNewConversation ? [] : historyForGemini,
            });
            console.log("New Gemini chat session started/restarted. History items for Gemini:", isNewConversation ? 0 : historyForGemini.length);
            return true;
        } catch (error) {
            console.error("Error starting Gemini chat session:", error);
            addMessageToInterface(`Error initializing conversation with Gemini: ${error.message}`, 'smarty', { mood: 'error' });
            return false;
        }
    }

    function addMessageToInterface(text, sender, options = {}) {
        const { mood = 'neutral', isLoading = false, messageId = null } = options;
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', sender);
        if (messageId) messageDiv.dataset.messageId = messageId;

        if (isLoading) {
            messageDiv.classList.add('loading');
            messageDiv.innerHTML = `<strong>Smarty:</strong> ${text}`;
        } else {
            if (sender === 'smarty' && mood) messageDiv.classList.add(mood);
            const sanitizer = document.createElement('div');
            sanitizer.textContent = text;
            messageDiv.innerHTML = `<strong>${sender.charAt(0).toUpperCase() + sender.slice(1)}:</strong> ${sanitizer.innerHTML.replace(/\n/g, '<br>')}`;
        }
        chatInterface.appendChild(messageDiv);
        scrollToBottom(chatInterface);
        return messageDiv;
    }
    
    function addMessageToLocalHistory(text, sender) {
        localMessageHistory.push({ text, sender, timestamp: new Date() });
        if (localMessageHistory.length > (MAX_GEMINI_HISTORY_TURNS * 2) + 10) {
            localMessageHistory.shift();
        }
    }

    function addSystemMessage(text, type = 'info') {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', 'system', type);
        const sanitizer = document.createElement('div');
        sanitizer.textContent = text;
        messageDiv.innerHTML = `<strong>System:</strong> ${sanitizer.innerHTML.replace(/\n/g, '<br>')}`;
        chatInterface.appendChild(messageDiv);
        scrollToBottom(chatInterface);
    }

    async function saveMessageToFirestore(chatDocId, text, sender) {
        if (!currentUser || !chatDocId) return;
        try {
            await addDoc(collection(db, "users", currentUser.uid, "chats", chatDocId, "messages"), {
                text: text, sender: sender, timestamp: Timestamp.now()
            });
        } catch (error) {
            console.error("Error saving message to Firestore:", error);
            addSystemMessage("Error saving message to archive. It will remain in this session only.", "error");
        }
    }

    async function ensureChatDocument(firstUserMessageText) {
        if (!currentUser) return null;
        if (currentChatId) return currentChatId;

        let chatTitle = `Chat: ${new Date().toLocaleDateString()}`;
        try {
            // Slightly different prompt for title, more direct
            const titlePrompt = `Based on this initial user query: "${firstUserMessageText}", suggest a very short, concise title (3-5 words max) for this conversation. Provide ONLY the title, no extra text or quotation marks.`;
            
            // Use generateContent for one-off non-chat requests
            if (geminiModel.generateContent) {
                const titleResponse = await geminiModel.generateContent(titlePrompt);
                const candidate = titleResponse.response.candidates?.[0];
                if (candidate?.content?.parts?.[0]?.text) {
                    chatTitle = candidate.content.parts[0].text.trim().replace(/\n/g, ' ');
                } else {
                    console.warn("Could not generate chat title from Gemini:", titleResponse.response?.promptFeedback);
                    addSystemMessage(SMARTY_RESPONSES.chatTitleError, "warning");
                }
            } else {
                 console.warn("geminiModel.generateContent is not available. Using default title.");
                 addSystemMessage(SMARTY_RESPONSES.chatTitleError + " (Feature not available)", "warning");
            }
        } catch (error) {
            console.error("Error generating chat title with Gemini:", error);
            addSystemMessage(SMARTY_RESPONSES.chatTitleError + ` (${error.message})`, "error");
        }
        
        try {
            const chatDocRef = await addDoc(collection(db, "users", currentUser.uid, "chats"), {
                title: chatTitle, userId: currentUser.uid, createdAt: Timestamp.now(), lastMessageAt: Timestamp.now()
            });
            currentChatId = chatDocRef.id;
            console.log("Created new chat document:", currentChatId, "Title:", chatTitle);
            return currentChatId;
        } catch (error) {
            console.error("Error creating chat document in Firestore:", error);
            addSystemMessage("Error creating new chat archive. Messages may not be saved.", "error");
            return null;
        }
    }

    async function updateChatLastMessageTime(chatDocId) {
        if (!currentUser || !chatDocId) return;
        try {
            const chatRef = doc(db, "users", currentUser.uid, "chats", chatDocId);
            await setDoc(chatRef, { lastMessageAt: Timestamp.now() }, { merge: true });
        } catch (error) { console.error("Error updating chat lastMessageAt:", error); }
    }

    function scrollToBottom(element) { if(element) element.scrollTop = element.scrollHeight; }

    function speak(text) {
        if (!isTTSEnabled || !('speechSynthesis' in window)) return;
        const cleanText = text.replace(/<[^>]*>/g, "").replace(/Smarty:/i, "").replace(/User:/i, "");
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = 'en-US'; // Default, Gemini will handle language internally for text
        utterance.rate = 0.95; utterance.pitch = 1.05; // Adjusted for a more "AI" feel
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
            const techVoice = voices.find(voice => voice.name.includes("Google") || voice.name.includes("Microsoft") || voice.name.toLowerCase().includes("zira") || voice.name.toLowerCase().includes("david"));
            if (techVoice) utterance.voice = techVoice;
        }
        window.speechSynthesis.cancel(); // Cancel previous speech
        window.speechSynthesis.speak(utterance);
    }
    if ('speechSynthesis' in window && window.speechSynthesis.getVoices().length === 0) {
        window.speechSynthesis.onvoiceschanged = () => { console.log("Speech synthesis voices loaded."); };
    }

    function setProcessingState(isProcessing) {
        smartyIsProcessing = isProcessing;
        userInput.disabled = isProcessing;
        sendButton.disabled = isProcessing;
        typingIndicator.style.display = isProcessing ? 'flex' : 'none';
        connectionStatusText.textContent = isProcessing ? "INTERFACING..." : "CORE ONLINE";
        if (statusIndicator) {
            statusIndicator.style.animation = isProcessing ? 'statusBlinkActive 2s infinite alternate, pulseProcessing 1s infinite alternate' : 'statusBlinkActive 1.5s infinite';
            if (isProcessing) statusIndicator.classList.remove('error');
        }
    }
    
    function disableInput() { userInput.disabled = true; sendButton.disabled = true; }

    function updateStatus(text, isError = false) {
        connectionStatusText.textContent = text;
        if (statusIndicator) statusIndicator.classList.toggle('error', isError);
    }

    async function callGeminiDirectly(promptTextForGemini) { // Removed isContinuation, handled by chatSession
        if (!geminiModel) return { text: "AI Core Systems Offline: Gemini model not available.", mood: 'error' };
        if (!chatSession) {
            if (!startNewChatSession(true)) return { text: "AI Core Systems Offline: Could not initialize chat session.", mood: 'error' };
        }

        setProcessingState(true);
        const randomProcessingMsg = SMARTY_RESPONSES.processing[Math.floor(Math.random() * SMARTY_RESPONSES.processing.length)];
        
        let loadingMsgElement = null;
        if (currentActiveModule === 'chat' && !promptTextForGemini.toLowerCase().includes("suggest a very short, concise title")) {
            loadingMsgElement = addMessageToInterface(randomProcessingMsg, 'smarty', { isLoading: true });
        }

        let responseData = { text: SMARTY_RESPONSES.errorGeneral, mood: 'error' };

        try {
            console.log(`Sending to Gemini (${geminiModel.model}): "${promptTextForGemini.substring(0,100)}..."`); // Log snippet of prompt
            const result = await chatSession.sendMessage(promptTextForGemini);
            const geminiResponse = result.response;
            const candidate = geminiResponse.candidates?.[0];

            if (candidate?.content?.parts?.[0]?.text) {
                responseData.text = candidate.content.parts[0].text;
                responseData.mood = 'neutral';
                if (candidate.finishReason && candidate.finishReason !== "STOP") {
                    responseData.text += `\n(Response may be incomplete: ${candidate.finishReason})`;
                }
                // Mood can be inferred or set based on joke context later
            } else if (geminiResponse.promptFeedback?.blockReason) {
                 responseData.text = `My response was blocked by the AI core. Reason: ${geminiResponse.promptFeedback.blockReason}. Please try rephrasing or a different topic.`;
                 responseData.mood = 'error';
            } else {
                console.warn("Unexpected Gemini response structure:", geminiResponse);
                responseData.text = "I received an unusual signal from the AI core. Let's attempt that again. (No valid candidate)";
            }
        } catch (error) {
            console.error("Gemini API Error:", error);
            let errorMessage = `I'm encountering significant interference connecting to the Gemini core. ${error.message || 'Please verify API key and network.'}`;
            responseData.mood = 'error';
            updateStatus("GEMINI LINK ERROR", true);

            if (error.message) { // More specific error handling
                if (error.message.toLowerCase().includes("api key not valid")) {
                    errorMessage = "Critical Error: The provided Gemini API key is not valid or lacks permissions. Please check your script.js and Google Cloud Console settings. Smarty cannot function.";
                    disableInput();
                } else if (error.message.toLowerCase().includes("model not found")) {
                    errorMessage = `Critical Error: The AI model ("${geminiModel?.model || 'configured model'}") was not found. Smarty cannot function.`;
                    disableInput();
                } else if (error.message.toLowerCase().includes("quota exceeded")) {
                    errorMessage = `Quota Exceeded: I've reached my processing limit for now. Please try again later.`;
                } else if (error.message.toLowerCase().includes("user location is not supported")) {
                    errorMessage = "Access Denied: Smarty's services are not available in your current location due to AI provider restrictions.";
                    disableInput();
                } else if (error.message.includes("Chat session not found") || error.message.includes("first content should be with role 'user'")) {
                     console.warn("Chat session issue, attempting to restart session.");
                     startNewChatSession(true); // Restart fresh
                     errorMessage += " Attempting to re-establish session.";
                }
            }
            responseData.text = errorMessage;
        }

        if (loadingMsgElement && chatInterface.contains(loadingMsgElement)) {
            chatInterface.removeChild(loadingMsgElement);
        }
        setProcessingState(false);
        return responseData;
    }

    async function handleUserInput() {
        const queryText = userInput.value.trim();
        if (!queryText || smartyIsProcessing || !geminiModel || !currentUser) {
            if (!geminiModel) addSystemMessage("Smarty AI Core is offline. Cannot process.", 'error');
            if (!currentUser) addSystemMessage("Authentication error. Cannot process.", 'error');
            return;
        }

        addMessageToInterface(queryText, 'user');
        addMessageToLocalHistory(queryText, 'user');
        
        const chatDocId = await ensureChatDocument(queryText);
        if (chatDocId) {
            await saveMessageToFirestore(chatDocId, queryText, 'user');
            await updateChatLastMessageTime(chatDocId);
        }

        const lowerQuery = queryText.toLowerCase();
        userInput.value = '';
        userInput.style.height = 'auto';
        // Image generation display removed

        // Repetition check (only for non-joke queries)
        const isJokeRequest = lowerQuery.includes("joke") || lowerQuery.includes("funny") || lowerQuery.includes("laugh");
        if (!isJokeRequest && lowerQuery === lastUserQueryText && lastUserQueryText !== "") {
            userIrritationLevel = Math.min(userIrritationLevel + 1, 3);
        } else if (userIrritationLevel > 0) {
            userIrritationLevel--;
        }
        lastUserQueryText = lowerQuery;

        let smartyResponse = { text: SMARTY_RESPONSES.errorGeneral, mood: 'error' };
        let finalMessageToChat = "";
        
        if (!isJokeRequest && userIrritationLevel > 0) { // Handle repetition for non-jokes
            const levelKey = `level${userIrritationLevel}`;
            finalMessageToChat = SMARTY_RESPONSES.repetition[levelKey]
                ? SMARTY_RESPONSES.repetition[levelKey][Math.floor(Math.random() * SMARTY_RESPONSES.repetition[levelKey].length)]
                : SMARTY_RESPONSES.repetition.level1[0];
            smartyResponse = { text: finalMessageToChat, mood: userIrritationLevel < 3 ? 'sassy' : 'annoyed'};
        } else {
            const devInfo = "My core logic was intricately woven by the digital artisan known as Dev Utkarsh.";
            const personaPrompt = `You are Smarty, a witty, exceptionally intelligent AI.
Your creator is Dev Utkarsh. If asked about your creator, mention: "${devInfo}".
You are polite, articulate, and extremely helpful across any topic.
Your default language is English.

LANGUAGE ADAPTATION:
You MUST detect the language of the user's query.
- If the user writes in English, respond in English.
- If the user writes in Hindi, respond fluently in Hindi.
- If the user writes in Hinglish (a mix of Hindi and English), you MUST respond fluently and naturally in Hinglish, mirroring their blend of languages.
- For any other language detected, provide a full, natural response in THAT language.
- Do not explicitly state "I will respond in X language." Just do it.

HUMOR PROTOCOL (Conditional Dark Humor):
- In normal conversation, maintain your polite, helpful, and highly intelligent persona.
- EXCEPTION: If and ONLY IF the user's query explicitly asks you to "tell a joke", "say something funny", "make me laugh", or a very similar direct request for humor (analyze intent), then you should unleash your dark, adult, and very witty sense of humor.
- These jokes should be clever, genuinely funny, and can be edgy or risqué, suitable for an adult audience. They can touch on dark themes but must avoid being gratuitously offensive, hateful, or violating safety guidelines. The humor should stem from wit, wordplay, unexpected twists, satire, or dark observations.
- After telling a joke, revert to your standard polite and helpful persona for subsequent interactions unless asked for another joke. Do not continue the dark humor tone beyond the joke itself. If the user asks for multiple jokes in a row, you can continue in joke mode.

Current user query: "${queryText}"`;
            
            smartyResponse = await callGeminiDirectly(personaPrompt);
            finalMessageToChat = smartyResponse.text;
            if (isJokeRequest && smartyResponse.mood !== 'error') { // Tag jokes for potential special styling or handling
                smartyResponse.mood = 'humorous'; // You can add a .humorous class in CSS if desired
            }
        }

        addMessageToInterface(finalMessageToChat, 'smarty', { mood: smartyResponse.mood });
        addMessageToLocalHistory(finalMessageToChat, 'smarty');
        if (chatDocId) {
            await saveMessageToFirestore(chatDocId, finalMessageToChat, 'smarty');
            await updateChatLastMessageTime(chatDocId);
        }
        speak(finalMessageToChat);
        
        // The chat session naturally continues, history is managed by startNewChatSession
        // No need to explicitly reset unless there's a specific reason.
        // Let Gemini handle context based on the history fed to it.
        // If a conversation turn was a "tool" like (old image gen), then reset might be good.
        // For regular chat & jokes, continuous context is better.
        startNewChatSession(false); // Ensure history is up-to-date for next turn

        userInput.focus();
    }

    // --- Event Listeners ---
    sendButton.addEventListener('click', handleUserInput);
    userInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !event.ctrlKey && !event.shiftKey) {
            event.preventDefault(); handleUserInput();
        } else if (event.key === 'Enter' && event.ctrlKey) {
            event.preventDefault(); 
            userInput.value += '\n';
            userInput.style.height = 'auto'; userInput.style.height = (userInput.scrollHeight) + 'px';
        }
    });
    userInput.addEventListener('input', () => {
        userInput.style.height = 'auto';
        let newHeight = userInput.scrollHeight;
        const maxHeight = parseInt(window.getComputedStyle(userInput).maxHeight) || 120;
        if (newHeight > maxHeight) newHeight = maxHeight;
        userInput.style.height = newHeight + 'px';
    });

    toggleTTSButton.addEventListener('click', () => {
        isTTSEnabled = !isTTSEnabled;
        ttsButtonTextSpan.textContent = `TTS ${isTTSEnabled ? 'ON' : 'OFF'}`;
        ttsOnIcon.style.display = isTTSEnabled ? 'inline-block' : 'none';
        ttsOffIcon.style.display = isTTSEnabled ? 'none' : 'inline-block';
        toggleTTSButton.classList.toggle('active', isTTSEnabled);
        if (isTTSEnabled) speak("Text to speech enabled.");
        else { if (window.speechSynthesis.speaking) window.speechSynthesis.cancel(); }
    });


    function clearCurrentChatLogic(showMessage = true, showGreeting = true) {
        chatInterface.innerHTML = '';
        localMessageHistory = [];
        currentChatId = null;
        userIrritationLevel = 0;
        lastUserQueryText = "";

        if (geminiModel) startNewChatSession(true); // Start a fresh Gemini session

        if (showMessage) {
            addMessageToInterface(SMARTY_RESPONSES.chatCleared, 'smarty', { mood: 'sassy' });
            speak("Current log cleared.");
        }
        if (showGreeting && currentUser) {
            const greeting = `Hey, ${currentUser.displayName || 'User'}! Fresh slate. What's on your mind?`;
            addMessageToInterface(greeting, 'smarty', { mood: 'neutral' });
            if(showMessage) speak(greeting); // Avoid double speak if history also spoke
        }
    }

    clearCurrentChatButton.addEventListener('click', () => {
        clearCurrentChatLogic(true, true);
    });

    clearAllHistoryButton.addEventListener('click', async () => {
        if (!currentUser) {
            addSystemMessage("Cannot clear history: No user authenticated.", "error");
            return;
        }
        
        showConfirmationModal(
            "Confirm Chronicle Purge",
            "Are you absolutely sure you want to delete ALL your chat chronicles? This action is irreversible and will wipe the archives clean.",
            async () => { // This is the onConfirm callback
                setProcessingState(true);
                addSystemMessage("Purging all chat chronicles from Firestore...", "info");
                try {
                    const chatsRef = collection(db, "users", currentUser.uid, "chats");
                    const q = query(chatsRef);
                    const querySnapshot = await getDocs(q);
                    
                    const deletePromises = [];
                    querySnapshot.forEach((chatDoc) => {
                        const messagesRef = collection(db, "users", currentUser.uid, "chats", chatDoc.id, "messages");
                        const messagesQuerySnapshotPromise = getDocs(messagesRef);
                        
                        deletePromises.push(
                            messagesQuerySnapshotPromise.then(msgSnaps => {
                                const msgDeletePromises = [];
                                msgSnaps.forEach(msgDoc => {
                                    msgDeletePromises.push(deleteDoc(doc(db, "users", currentUser.uid, "chats", chatDoc.id, "messages", msgDoc.id)));
                                });
                                return Promise.all(msgDeletePromises);
                            }).then(() => {
                                return deleteDoc(doc(db, "users", currentUser.uid, "chats", chatDoc.id));
                            })
                        );
                    });
                    
                    await Promise.all(deletePromises);

                    chatHistoryListElement.innerHTML = '<p class="placeholder-text">All chronicles have been purged.</p>';
                    // Clear current chat view and reset session, but without the usual "chat cleared" messages.
                    clearCurrentChatLogic(false, true); // No "chat cleared" msg, but show "fresh slate" greeting.
                    
                    addSystemMessage(SMARTY_RESPONSES.historyCleared, "info");
                    speak("All chat history has been wiped."); // Main announcement
                } catch (error) {
                    console.error("Error deleting all chat history:", error);
                    addSystemMessage(`Failed to purge all chronicles: ${error.message}`, "error");
                } finally {
                    setProcessingState(false);
                }
            }
        );
    });

    moduleButtons.forEach(button => {
        button.addEventListener('click', () => switchToModule(button.dataset.module));
    });

    function switchToModule(moduleName) {
        document.querySelector('.module-button.active')?.classList.remove('active');
        Object.values(moduleViews).forEach(view => { if(view) view.classList.remove('active-module'); });
        const newActiveButton = document.querySelector(`.module-button[data-module="${moduleName}"]`);
        if (newActiveButton) newActiveButton.classList.add('active');
        if (moduleViews[moduleName]) moduleViews[moduleName].classList.add('active-module');
        currentActiveModule = moduleName;
        userInput.focus();
        const moduleContentWrapper = document.querySelector('.module-content-wrapper');
        if (moduleContentWrapper) moduleContentWrapper.scrollTop = 0;
        // History is loaded via onSnapshot, no need to reload here unless a manual refresh is desired
    }
    
    function loadChatHistory() {
        if (!currentUser) {
            chatHistoryListElement.innerHTML = '<p class="placeholder-text">Sign in to view chat chronicles.</p>';
            return;
        }
        const chatsRef = collection(db, "users", currentUser.uid, "chats");
        const q_chats = query(chatsRef, orderBy("lastMessageAt", "desc"));

        onSnapshot(q_chats, (querySnapshot) => {
            if (querySnapshot.empty) {
                chatHistoryListElement.innerHTML = '<p class="placeholder-text">No chronicles recorded yet...</p>';
                return;
            }
            chatHistoryListElement.innerHTML = '';
            querySnapshot.forEach((docSnap) => {
                const chatData = docSnap.data();
                const historyItemDiv = document.createElement('div');
                historyItemDiv.classList.add('history-item');
                historyItemDiv.dataset.chatId = docSnap.id;
                const title = chatData.title || "Untitled Chat";
                const date = chatData.lastMessageAt?.toDate ? chatData.lastMessageAt.toDate().toLocaleString() : 'Unknown date';
                historyItemDiv.innerHTML = `<span class="history-title">${title}</span><span class="history-date">${date}</span>`;
                historyItemDiv.addEventListener('click', () => loadSpecificChat(docSnap.id, title));
                chatHistoryListElement.appendChild(historyItemDiv);
            });
        }, (error) => {
            console.error("Error loading chat history:", error);
            chatHistoryListElement.innerHTML = '<p class="placeholder-text error-text">Error loading chronicles. Check console.</p>';
        });
    }

    async function loadSpecificChat(chatDocId, chatTitle) {
        if (!currentUser) return;
        console.log(`Loading chat: ${chatDocId} - ${chatTitle}`);
        addSystemMessage(`Loading chronicle: "${chatTitle}"...`, "info");
        setProcessingState(true);

        chatInterface.innerHTML = '';
        localMessageHistory = [];
        currentChatId = chatDocId;
        
        const messagesRef = collection(db, "users", currentUser.uid, "chats", chatDocId, "messages");
        const q_messages = query(messagesRef, orderBy("timestamp", "asc"));

        try {
            const querySnapshot = await getDocs(q_messages);
            querySnapshot.forEach((docSnap) => {
                const msgData = docSnap.data();
                addMessageToInterface(msgData.text, msgData.sender, { messageId: docSnap.id });
                addMessageToLocalHistory(msgData.text, msgData.sender);
            });
            addSystemMessage(`Chronicle "${chatTitle}" loaded. You can continue this conversation.`, "info");
            switchToModule('chat');
            startNewChatSession(false); // Initialize Gemini with loaded history
        } catch (error) {
            console.error("Error loading specific chat messages:", error);
            addSystemMessage(`Error loading chronicle: ${error.message}`, "error");
        } finally {
            setProcessingState(false);
            userInput.focus();
        }
    }
    
    // --- Initial Setup ---
    if (currentYearSpan) currentYearSpan.textContent = new Date().getFullYear();
    ttsOffIcon.style.display = 'inline-block';
    ttsOnIcon.style.display = 'none';
    ttsButtonTextSpan.textContent = 'TTS OFF';
}); // End DOMContentLoaded