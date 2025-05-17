// Firebase and Gemini SDK imports
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, updateProfile } from "firebase/auth";
import { getFirestore, collection, addDoc, query, where, orderBy, onSnapshot, Timestamp, doc, getDoc, setDoc, deleteDoc, getDocs, serverTimestamp as firestoreServerTimestamp, limit } from "firebase/firestore";
import { getDatabase, ref, onValue, set, onDisconnect, serverTimestamp as rtdbServerTimestamp } from "firebase/database";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

// --- CRITICAL SECURITY WARNING ---
// THE GEMINI_API_KEY BELOW IS A PLACEHOLDER.
// Storing a real API key client-side is EXTREMELY INSECURE for paid services.
// For any real application beyond personal, local testing, you MUST use a backend proxy.
// REVOKE any publicly exposed keys immediately after testing.
const GEMINI_API_KEY = "AIzaSyAZ2mfzREj1ecUduaST3iKWpLQ0mEcp_o8"; // <<< REPLACE AND PROTECT THIS KEY

const firebaseConfig = {
  apiKey: "AIzaSyAZ2mfzREj1ecUduaST3iKWpLQ0mEcp_o8",
  authDomain: "gemini-c0de2.firebaseapp.com",
  projectId: "gemini-c0de2",
  storageBucket: "gemini-c0de2.appspot.com",
  messagingSenderId: "227279367041",
  appId: "1:227279367041:web:57aaf9816f3ee505965680",
  measurementId: "G-JVMJ0JLEK7",
  databaseURL: "https://gemini-c0de2-default-rtdb.firebaseio.com"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app); 

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
    const globalChatInterface = document.getElementById('globalChatInterface');
    const onlineUsersCountElement = document.getElementById('onlineUsersCount');
    const userInput = document.getElementById('userInput');
    const sendButton = document.getElementById('sendButton');
    const smartyToolOutputDisplay = document.getElementById('smartyToolOutputDisplay');
    const smartyToolOutputContainer = document.getElementById('smartyToolOutputContainer');
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
        globalChat: document.getElementById('globalChatModule'),
        history: document.getElementById('historyModule'),
        settings: document.getElementById('settingsModule')
    };
    const currentYearSpan = document.getElementById('currentYear');
    const typingIndicator = document.getElementById('typingIndicator');
    const chatHistoryListElement = document.getElementById('chatHistoryList');
    const userNameDisplay = document.getElementById('userNameDisplay');
    const userEmailDisplay = document.getElementById('userEmailDisplay');
    const customConfirmationModal = document.getElementById('customConfirmationModal');
    const modalTitleElement = document.getElementById('modalTitle');
    const modalMessageElement = document.getElementById('modalMessage');
    const modalConfirmButton = document.getElementById('modalConfirmButton');
    const modalCancelButton = document.getElementById('modalCancelButton');

    // --- State Variables ---
    let currentUser = null;
    let isTTSEnabled = false;
    let currentActiveModule = 'chat';
    let currentChatId = null; 
    let localMessageHistory = []; 
    const MAX_GEMINI_HISTORY_TURNS = 6; 
    let smartyIsProcessing = false;
    let userIrritationLevel = 0; 
    let lastUserQueryText = ""; 
    let genAI;
    let geminiModel;
    let chatSession; 
    let globalChatUnsubscribe = null;
    let userStatusDatabaseRef = null;
    let onlineUsersRTDBRef = null;
    let onlineUsersRTDBListener = null;

    const SMARTY_RESPONSES = {
        processing: [
            "Accessing neural matrix...", "Synthesizing information...",
            "Consulting knowledge archives...", "Interfacing with core logic..."
        ],
        errorGeneral: "My apologies, a slight anomaly in my processing occurred. Could you please rephrase or try again?",
        repetition: {
            level1: ["It seems we've touched upon this topic before. Shall we explore a different facet?", "My records indicate a similar prior query. Perhaps a new line of inquiry?"],
            level2: ["Indeed, this is familiar territory. To optimize our interaction, might I suggest a novel question?", "My conversational subroutines note this repetition. Are you testing my consistency, or shall we proceed to new discussions?"],
            level3: ["Affirmative, this query has been processed multiple times. For efficiency, a new directive is requested, or I may default to reciting universal constants."]
        },
        chatCleared: "Current dialogue log with Smarty has been cleared. Awaiting new input.",
        historyCleared: "All your personal Smarty dialogue chronicles have been purged.",
        signInError: "Authentication sequence failed. Please ensure pop-ups are enabled for this domain and retry.",
        tool_input_missing: "The invoked command requires additional parameters to proceed.",
        summarize_no_text: "To provide a summary, I require the text you wish for me to condense. Please use: `/summarize <your text here>`.",
        translate_no_text: "For translation, specify the target language code and the text. Format: `/translate to <lang_code> <your text>`.",
        code_no_desc: "To generate a code structure, please provide a description of the desired functionality using: `/code <description of code needed>`.",
        chatTitleError: "An issue occurred while attempting to assign a title to this conversation. It will be logged as 'Untitled Chronicle' for now.",
        confirmHistoryWipeTitle: "Confirm Chronicle Deletion",
        confirmHistoryWipeMessage: "Are you certain you wish to permanently erase all your recorded dialogues with Smarty? This action cannot be undone.",
    };

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            if (!currentUser.displayName && currentUser.email) {
                try {
                    const nameFromEmail = currentUser.email.split('@')[0];
                    await updateProfile(currentUser, { displayName: nameFromEmail });
                    currentUser = auth.currentUser; 
                    console.log("User profile updated with displayName:", currentUser.displayName);
                } catch (profileError) {
                    console.error("Error updating user profile with displayName:", profileError);
                }
            }

            console.log("User signed in:", currentUser.displayName || "Name N/A", currentUser.uid);
            if(authOverlay) {
                authOverlay.classList.remove('active');
                authOverlay.classList.add('hidden'); 
            }
            if(loadingOverlay) {
                loadingOverlay.classList.remove('hidden'); 
                loadingOverlay.classList.add('active'); 
            }
            if(appContainer) appContainer.classList.remove('hidden'); 
            
            if(userNameDisplay) userNameDisplay.textContent = currentUser.displayName || "Valued User";
            if(userEmailDisplay) userEmailDisplay.textContent = currentUser.email || "N/A";

            if (!initializeGemini()) {
                simulateLoadingSequence(false); 
                return; 
            }
            simulateLoadingSequence(true); 
            loadChatHistory(); 
            initializeGlobalChat();
            setupPresenceSystemRTDB(); 
            switchToModule('chat'); 
            updateInputPlaceholder();
        } else {
            if (userStatusDatabaseRef) { 
                set(userStatusDatabaseRef, { isOnline: false, lastSeen: rtdbServerTimestamp() }).catch(err => console.warn("Error setting user offline in RTDB:", err));
                onDisconnect(userStatusDatabaseRef).cancel().catch(err => console.warn("Error cancelling onDisconnect:", err));
            }
            userStatusDatabaseRef = null; 
            if (onlineUsersRTDBListener && onlineUsersRTDBRef) {
                onlineUsersRTDBRef.off('value', onlineUsersRTDBListener);
                onlineUsersRTDBRef = null;
                onlineUsersRTDBListener = null;
            }

            currentUser = null;
            console.log("User signed out or not signed in.");
            if(authOverlay){
                authOverlay.classList.remove('hidden');
                authOverlay.classList.add('active');
            }
            if(loadingOverlay){
                loadingOverlay.classList.remove('active');
                loadingOverlay.classList.add('hidden');
            }
            if(appContainer){
                appContainer.classList.add('hidden');
                appContainer.classList.remove('visible'); 
            }
            
            if (chatInterface) chatInterface.innerHTML = ''; 
            if (globalChatInterface) globalChatInterface.innerHTML = '';
            localMessageHistory = [];
            currentChatId = null;
            if (chatHistoryListElement) chatHistoryListElement.innerHTML = '<p class="placeholder-text">Sign in to access chronicles.</p>';
            
            if (globalChatUnsubscribe) globalChatUnsubscribe();
            
            if (window.speechSynthesis && window.speechSynthesis.speaking) window.speechSynthesis.cancel();

            if(ttsOffIcon) ttsOffIcon.style.display = 'inline-block';
            if(ttsOnIcon) ttsOnIcon.style.display = 'none';
            if(ttsButtonTextSpan) ttsButtonTextSpan.textContent = 'TTS OFF';
            isTTSEnabled = false;
            if(onlineUsersCountElement) onlineUsersCountElement.textContent = "Users online: 0";
        }
        if (authErrorElement) authErrorElement.textContent = ''; 
    });

    if(signInWithGoogleButton) signInWithGoogleButton.addEventListener('click', async () => {
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error("Google Sign-In Error:", error);
            if (authErrorElement) authErrorElement.textContent = SMARTY_RESPONSES.signInError + ` (${error.code || error.message})`;
        }
    });

    if(signOutButton) signOutButton.addEventListener('click', async () => {
        try {
            if (window.speechSynthesis && window.speechSynthesis.speaking) window.speechSynthesis.cancel();
            await signOut(auth);
        } catch (error) {
            console.error("Sign Out Error:", error);
            addSystemMessage(`Error signing out: ${error.message}`, 'error');
        }
    });

    function initializeGemini() {
        if (GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE" || !GEMINI_API_KEY) {
            console.error("CRITICAL: Gemini API Key is missing or is a placeholder. Smarty's AI capabilities will be severely limited.");
            return false; 
        }
        try {
            genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const modelName = "gemini-1.5-flash-latest";
            const generationConfig = { temperature: 0.65, topP: 0.9, topK: 30, maxOutputTokens: 2048 };
            const safetySettings = [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            ];
            geminiModel = genAI.getGenerativeModel({ model: modelName, generationConfig, safetySettings });
            console.log("Gemini SDK Initialized successfully.");
            if (statusIndicator) updateStatus("CORE ONLINE", false);
            return true;
        } catch (error) {
            console.error("Error initializing Gemini SDK:", error);
            return false;
        }
    }

    function simulateLoadingSequence(geminiOk = true) {
        let progress = 0;
        const steps = [
            { p: 10, text: "Authenticating User Matrix..." },
            { p: 25, text: "Calibrating Neural Interface..." },
            { p: 40, text: "Initializing I/O Subsystems..." },
            { p: 60, text: "Loading Personality Congruence Module..." },
            { p: 75, text: geminiOk ? "Establishing Link to Gemini Cognitive Core..." : "Gemini Core Link Failure Detected..." },
            { p: 90, text: "Verifying Sentience Protocols..." },
            { p: 100, text: geminiOk && currentUser ? `Welcome, ${currentUser.displayName || 'Operator'}. Smarty v3.9 Core Systems are nominal. How may I assist you today?` : "Smarty Core Systems Impaired. Gemini AI functionalities are currently offline." }
        ];
        let currentStep = 0;
        if(loadingProgressBar) {
            loadingProgressBar.style.width = `0%`; 
            loadingProgressBar.style.background = 'linear-gradient(90deg, var(--accent-secondary), var(--accent-primary))';
        }

        const interval = setInterval(() => {
            if (currentStep < steps.length) {
                progress = steps[currentStep].p;
                if(loadingText) loadingText.textContent = steps[currentStep].text;
                if(loadingProgressBar) loadingProgressBar.style.width = `${progress}%`;

                if (!geminiOk && progress >= 75 && loadingProgressBar) { 
                    loadingProgressBar.style.background = 'var(--error-color)';
                }
                currentStep++;
            } else {
                clearInterval(interval);
                setTimeout(() => {
                    if(loadingOverlay) {
                        loadingOverlay.classList.remove('active');
                        loadingOverlay.classList.add('hidden');
                    }
                    if(appContainer) appContainer.classList.add('visible'); 

                    if (geminiOk && geminiModel && currentUser) {
                        const greeting = `Welcome, ${currentUser.displayName || 'Operator'}. Smarty v3.9 is online and ready. How can I assist you?`;
                        addMessageToInterface(greeting, 'smarty', { mood: 'neutral', targetInterface: chatInterface });
                        speak(greeting);
                        startNewChatSession(true); 
                    } else if (currentUser) { // Gemini failed but user is logged in
                        const errorMsg = GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE" || !GEMINI_API_KEY
                            ? "CRITICAL: Gemini API Key is misconfigured. Smarty's advanced AI capabilities are unavailable."
                            : "Smarty AI Core failed to initialize the Gemini link. Conversational AI functionalities will be limited.";
                        addMessageToInterface(errorMsg, 'smarty', { mood: 'error', targetInterface: chatInterface });
                        if(statusIndicator) updateStatus("SDK INIT FAIL", true);
                        disableInput(); 
                    }
                    if (userInput) userInput.focus();
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
        
        if (historyForGemini.length > 0 && historyForGemini[0].role === 'model') {
            historyForGemini.shift(); 
        }

        try {
            chatSession = geminiModel.startChat({
                history: isNewConversation ? [] : historyForGemini,
            });
            console.log("New Gemini chat session started/restarted. History length for Gemini:", isNewConversation ? 0 : historyForGemini.length);
            return true;
        } catch (error) {
            console.error("Error starting Gemini chat session:", error);
            addMessageToInterface(`Error initializing conversation with Gemini: ${error.message}`, 'smarty', { mood: 'error', targetInterface: chatInterface });
            return false;
        }
    }

    function addMessageToInterface(text, sender, options = {}) {
        const { mood = 'neutral', isLoading = false, messageId = null, displayName = null, targetInterface = chatInterface } = options;
    
        if (!targetInterface) {
            console.error("Target interface is null for message:", text, "Sender:", sender);
            return null; // Cannot append if target is not found
        }

        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', sender); 
        if (messageId) messageDiv.dataset.messageId = messageId;
    
        let senderName = sender.charAt(0).toUpperCase() + sender.slice(1);
        if (sender === 'other-user' && displayName) {
            senderName = displayName;
        } else if (sender === 'user' && currentUser) {
            senderName = currentUser.displayName || 'User'; 
        }
    
        if (isLoading) {
            messageDiv.classList.add('loading');
            messageDiv.innerHTML = `<strong>Smarty:</strong> ${text}`; 
        } else {
            if ((sender === 'smarty' || sender === 'other-user') && mood) {
                messageDiv.classList.add(mood);
            }
            
            let formattedText = text;
            if (sender === 'smarty' || (targetInterface === globalChatInterface && sender !== 'user')) { 
                formattedText = parseSimpleMarkdown(text);
            } else { 
                const sanitizer = document.createElement('div');
                sanitizer.textContent = text;
                formattedText = sanitizer.innerHTML.replace(/\n/g, '<br>');
            }
            messageDiv.innerHTML = `<strong>${senderName}:</strong> ${formattedText}`;
        }
        targetInterface.appendChild(messageDiv);
        scrollToBottom(targetInterface);
        return messageDiv;
    }

    function parseSimpleMarkdown(text) {
        let html = text;

        const sanitizer = document.createElement('div');
        sanitizer.textContent = html;
        html = sanitizer.innerHTML; 

        html = html.replace(/```([\s\S]*?)```/g, (match, codeContent) => {
            const codeSanitizer = document.createElement('div');
            codeSanitizer.textContent = codeContent.trim(); 
            return `<pre><code>${codeSanitizer.innerHTML}</code></pre>`;
        });
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/`(.*?)`/g, '<code>$1</code>');
        
        const parts = html.split(/(<pre(?:>|\s[^>]*>)(?:.|\n)*?<\/pre>)/gi);
        for (let i = 0; i < parts.length; i++) {
            if (!parts[i].toLowerCase().startsWith('<pre')) { 
                parts[i] = parts[i].replace(/\n/g, '<br>');
            }
        }
        html = parts.join('');
        return html;
    }
    
    function addMessageToLocalHistory(text, sender) {
        localMessageHistory.push({ text, sender, timestamp: new Date() });
        if (localMessageHistory.length > (MAX_GEMINI_HISTORY_TURNS * 2) + 20) {
            localMessageHistory.shift();
        }
    }

    function addSystemMessage(text, type = 'info', targetInterface = chatInterface) {
        if (!targetInterface) { // Default to main chat if target not specified or invalid
            console.warn("addSystemMessage: targetInterface is null, defaulting to main chatInterface.");
            targetInterface = chatInterface; 
        }
        if (!targetInterface) { // Still null? then can't proceed
            console.error("addSystemMessage: Could not find a valid interface to append system message.");
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', 'system', type); 
        const sanitizer = document.createElement('div');
        sanitizer.textContent = text;
        messageDiv.innerHTML = `<strong>System:</strong> ${sanitizer.innerHTML.replace(/\n/g, '<br>')}`;
        
        targetInterface.appendChild(messageDiv);
        scrollToBottom(targetInterface);
    }

    async function saveMessageToFirestore(chatDocId, text, sender) {
        if (!currentUser || !chatDocId) return;
        try {
            await addDoc(collection(db, "users", currentUser.uid, "chats", chatDocId, "messages"), {
                text: text,
                sender: sender,
                timestamp: firestoreServerTimestamp() 
            });
        } catch (error) {
            console.error("Error saving message to Firestore:", error);
            addSystemMessage("Error saving message to archive. It will remain in this session only.", "error", chatInterface);
        }
    }

    async function ensureChatDocument(firstUserMessageText) {
        if (!currentUser) return null;
        if (currentChatId) return currentChatId; 

        let chatTitle = `Chat: ${new Date().toLocaleDateString()}`; 
        try {
            if (geminiModel) { 
                const titlePrompt = `Based on this initial user query: "${firstUserMessageText.substring(0, 100)}", suggest a very short, concise title (3-5 words max) for this conversation. Just the title, no extra text.`;
                const titleResponse = await geminiModel.generateContent(titlePrompt);
                const candidate = titleResponse.response.candidates?.[0];
                if (candidate && candidate.content && candidate.content.parts && candidate.content.parts[0].text) {
                    chatTitle = candidate.content.parts[0].text.trim().replace(/\n/g, ' ');
                } else {
                    console.warn("Could not generate chat title from Gemini:", titleResponse.response?.promptFeedback?.blockReason);
                }
            }
        } catch (error) {
            console.error("Error generating chat title with Gemini:", error);
        }
        
        try {
            const chatDocRef = await addDoc(collection(db, "users", currentUser.uid, "chats"), {
                title: chatTitle,
                userId: currentUser.uid,
                createdAt: firestoreServerTimestamp(),
                lastMessageAt: firestoreServerTimestamp()
            });
            currentChatId = chatDocRef.id;
            console.log("Created new chat document:", currentChatId, "Title:", chatTitle);
            return currentChatId;
        } catch (error) {
            console.error("Error creating chat document in Firestore:", error);
            addSystemMessage("Error creating new chat archive. Messages may not be saved.", "error", chatInterface);
            return null;
        }
    }

    async function updateChatLastMessageTime(chatDocId) {
        if (!currentUser || !chatDocId) return;
        try {
            const chatRef = doc(db, "users", currentUser.uid, "chats", chatDocId);
            await setDoc(chatRef, { lastMessageAt: firestoreServerTimestamp() }, { merge: true });
        } catch (error) {
            console.error("Error updating chat lastMessageAt:", error);
        }
    }

    function scrollToBottom(element) { if(element) element.scrollTop = element.scrollHeight; }

    function speak(text) {
        if (!isTTSEnabled || !window.speechSynthesis) return;
        const cleanText = text.replace(/<[^>]*>/g, "").replace(/Smarty:/i, "").replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = 'en-US';
        utterance.rate = 0.95; utterance.pitch = 1.1;
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
            const techVoice = voices.find(voice => voice.name.includes("Google") || voice.name.includes("Microsoft Zira") || voice.name.toLowerCase().includes("robot"));
            if (techVoice) utterance.voice = techVoice;
        }
        window.speechSynthesis.speak(utterance);
    }
    
    if (window.speechSynthesis && window.speechSynthesis.getVoices().length === 0) {
        window.speechSynthesis.onvoiceschanged = () => { console.log("Speech synthesis voices loaded."); };
    }

    function setProcessingState(isProcessing) {
        smartyIsProcessing = isProcessing;
        if (userInput) userInput.disabled = isProcessing;
        if (sendButton) sendButton.disabled = isProcessing;
        if (typingIndicator) typingIndicator.style.display = isProcessing ? 'flex' : 'none';
        if (connectionStatusText) connectionStatusText.textContent = isProcessing ? "INTERFACING..." : "CORE ONLINE";
        if (statusIndicator) {
            statusIndicator.style.animation = isProcessing ? 'statusBlinkActive 2s infinite alternate, pulseProcessing 1s infinite alternate' : 'statusBlinkActive 1.5s infinite';
            if (isProcessing) statusIndicator.classList.remove('error');
        }
    }
    
    function disableInput() {
        if (userInput) userInput.disabled = true;
        if (sendButton) sendButton.disabled = true;
    }

    function updateStatus(text, isError = false) {
        if (connectionStatusText) connectionStatusText.textContent = text;
        if (statusIndicator) {
            if (isError) {
                statusIndicator.classList.add('error');
            } else {
                statusIndicator.classList.remove('error');
            }
        }
    }

    async function callGeminiDirectly(promptTextForGemini, isContinuation = true) {
        if (!geminiModel) {
            return { text: "My apologies, my primary AI core (Gemini) seems to be offline. I cannot process this request at the moment.", mood: 'error' };
        }
        if (!chatSession || !isContinuation) {
            if (!startNewChatSession(!isContinuation)) { 
                 return { text: "I'm having trouble initializing a new conversation context. Please try again shortly.", mood: 'error' };
            }
        }

        setProcessingState(true);
        const randomProcessingMsg = SMARTY_RESPONSES.processing[Math.floor(Math.random() * SMARTY_RESPONSES.processing.length)];
        
        let loadingMsgElement = null;
        if (currentActiveModule === 'chat' && !promptTextForGemini.toLowerCase().startsWith("based on this initial user query")) { 
            loadingMsgElement = addMessageToInterface(randomProcessingMsg, 'smarty', { isLoading: true, targetInterface: chatInterface });
        }

        let responseData = { text: SMARTY_RESPONSES.errorGeneral, mood: 'error' };

        try {
            console.log(`Sending to Gemini: "${promptTextForGemini.substring(0, 100)}..."`);
            const result = await chatSession.sendMessage(promptTextForGemini);
            const geminiResponse = result.response;
            const candidate = geminiResponse.candidates?.[0];

            if (candidate && candidate.content && candidate.content.parts && candidate.content.parts[0].text) {
                responseData.text = candidate.content.parts[0].text;
                responseData.mood = 'neutral'; 
                if (candidate.finishReason && candidate.finishReason !== "STOP") {
                    responseData.text += `\n(Note: The response may have been truncated due to: ${candidate.finishReason})`;
                }
            } else if (geminiResponse.promptFeedback && geminiResponse.promptFeedback.blockReason) {
                 responseData.text = `My response was moderated by the AI safety systems. Reason: ${geminiResponse.promptFeedback.blockReason}. Please try rephrasing your query.`;
                 responseData.mood = 'error';
            } else {
                console.warn("Unexpected Gemini response structure:", geminiResponse);
                responseData.text = "I received an unusual or empty response from the AI core. It might be a temporary issue. Let's try that again, or rephrase please.";
            }
        } catch (error) {
            console.error("Gemini API Error:", error);
            let errorMessage = `I'm encountering some interference connecting to the Gemini AI core. ${error.message || 'Please verify API key validity and network connectivity.'}`;
            responseData.mood = 'error';
            if (statusIndicator) updateStatus("GEMINI LINK ERROR", true);

            if (error.message) {
                const lowerErrorMsg = error.message.toLowerCase();
                if (lowerErrorMsg.includes("api key not valid")) {
                    errorMessage = "Critical Error: The Gemini API key is not valid or lacks permissions. My advanced AI functions are disabled.";
                    disableInput();
                } else if (lowerErrorMsg.includes("model not found")) {
                    errorMessage = `Critical Error: The AI model ("${geminiModel?.model || 'configured model'}") is currently unavailable. My capabilities are limited.`;
                    disableInput();
                } else if (lowerErrorMsg.includes("quota exceeded") || error.message.includes(" আহরণ করতে পারবেন না")) { 
                    errorMessage = `I've reached my processing quota for now. Please try again later.`;
                } else if (error.name === 'GoogleGenerativeAIResponseError' && lowerErrorMsg.includes("user location is not supported")) {
                    errorMessage = "Access Denied: My services via Gemini are not available in your current location due to regional restrictions.";
                    disableInput();
                } else if (lowerErrorMsg.includes("chat session not found") || lowerErrorMsg.includes("first content should be with role 'user'")) {
                    console.warn("Chat session issue with Gemini, attempting to restart session.");
                    startNewChatSession(true); 
                    errorMessage += " I'm re-establishing the communication link; please try your query again.";
                }
            }
            responseData.text = errorMessage;
        }
        finally { // Ensure processing state is reset
            if (loadingMsgElement && chatInterface && chatInterface.contains(loadingMsgElement)) {
                chatInterface.removeChild(loadingMsgElement);
            }
            setProcessingState(false);
        }
        return responseData;
    }

    async function handleUserInput() {
        if (!userInput) return; // Guard clause if userInput is somehow null
        const queryText = userInput.value.trim();

        if (!queryText || smartyIsProcessing || !currentUser) {
            if (!currentUser && userInput) {
                const targetInterface = (currentActiveModule === 'chat' && chatInterface) || (currentActiveModule === 'globalChat' && globalChatInterface) || chatInterface;
                addSystemMessage("Authentication error. Cannot process.", 'error', targetInterface);
            }
            return;
        }

        userInput.value = ''; 
        userInput.style.height = 'auto'; 
        if (smartyToolOutputDisplay) smartyToolOutputDisplay.classList.add('hidden');

        if (currentActiveModule === 'globalChat') {
            await sendGlobalChatMessage(queryText);
        } else if (currentActiveModule === 'chat') {
            
            addMessageToInterface(queryText, 'user', { targetInterface: chatInterface, displayName: currentUser.displayName });
            addMessageToLocalHistory(queryText, 'user');
            
            const chatDocId = await ensureChatDocument(queryText); 
            if (chatDocId) {
                await saveMessageToFirestore(chatDocId, queryText, 'user');
                await updateChatLastMessageTime(chatDocId);
            }

            const lowerQuery = queryText.toLowerCase();

            if (lowerQuery === lastUserQueryText && lastUserQueryText !== "") {
                userIrritationLevel = Math.min(userIrritationLevel + 1, 3);
            } else if (userIrritationLevel > 0) {
                userIrritationLevel--;
            }
            lastUserQueryText = lowerQuery;

            let commandProcessed = false;
            let smartyResponse = { text: SMARTY_RESPONSES.errorGeneral, mood: 'error' };
            let finalMessageToChat = "";
            let isContinuation = true;
            let toolOutput = null;

            if (lowerQuery.startsWith("/summarize ")) {
                commandProcessed = true; isContinuation = false;
                const textToSummarize = queryText.substring("/summarize ".length).trim();
                if (textToSummarize && geminiModel) {
                    const prompt = `Please provide a concise summary of the following text: "${textToSummarize}"`;
                    smartyResponse = await callGeminiDirectly(prompt, false);
                    finalMessageToChat = "Certainly, here is the summary you requested:";
                    toolOutput = smartyResponse.text;
                } else if (!geminiModel) {
                     finalMessageToChat = "My summarization circuits (Gemini) are currently offline."; smartyResponse.mood = 'error';
                } else {
                    finalMessageToChat = SMARTY_RESPONSES.summarize_no_text; smartyResponse.mood = 'sassy';
                }
            }
            else if (lowerQuery.startsWith("/translate to ")) {
                commandProcessed = true; isContinuation = false;
                const parts = queryText.substring("/translate to ".length).trim().split(" ");
                const langCode = parts.shift();
                const textToTranslate = parts.join(" ").trim();
                if (langCode && textToTranslate && geminiModel) {
                    const prompt = `Translate the following text into ${langCode}: "${textToTranslate}"`;
                    smartyResponse = await callGeminiDirectly(prompt, false);
                    finalMessageToChat = `Here is the translation into ${langCode}:`;
                    toolOutput = smartyResponse.text;
                } else if (!geminiModel) {
                     finalMessageToChat = "My translation circuits (Gemini) are currently offline."; smartyResponse.mood = 'error';
                } else {
                    finalMessageToChat = SMARTY_RESPONSES.translate_no_text; smartyResponse.mood = 'sassy';
                }
            }
            else if (lowerQuery.startsWith("/code ")) {
                commandProcessed = true; isContinuation = false;
                const codeDescription = queryText.substring("/code ".length).trim();
                if (codeDescription && geminiModel) {
                    const prompt = `Please generate the code as per the following description. Ensure the code is enclosed in a Markdown code block. Description: "${codeDescription}"`;
                    smartyResponse = await callGeminiDirectly(prompt, false);
                    finalMessageToChat = `I've generated the code based on your description:`;
                } else if (!geminiModel) {
                    finalMessageToChat = "My code generation circuits (Gemini) are currently offline."; smartyResponse.mood = 'error';
                } else {
                    finalMessageToChat = SMARTY_RESPONSES.code_no_desc; smartyResponse.mood = 'sassy';
                }
            }
            else if (userIrritationLevel > 0 && !commandProcessed) {
                commandProcessed = true; isContinuation = true; 
                const levelKey = `level${userIrritationLevel}`;
                finalMessageToChat = SMARTY_RESPONSES.repetition[levelKey]
                    ? SMARTY_RESPONSES.repetition[levelKey][Math.floor(Math.random() * SMARTY_RESPONSES.repetition[levelKey].length)]
                    : SMARTY_RESPONSES.repetition.level1[0];
                smartyResponse = { text: finalMessageToChat, mood: userIrritationLevel < 3 ? 'sassy' : 'annoyed'};
            }
            
            if (!commandProcessed) {
                if (!geminiModel) {
                    finalMessageToChat = "My apologies, my primary AI core (Gemini) is offline. I can only process pre-defined commands at the moment.";
                    smartyResponse = {text: finalMessageToChat, mood: 'error'};
                } else {
                    isContinuation = true; 
                    const devInfo = "My core architecture and initial programming were established by the developer known as Dev Utkarsh.";
                    const personaPrompt = `You are Smarty, an advanced AI assistant. Your personality should be helpful, knowledgeable, articulate, and capable of discussing a wide range of topics naturally and conversationally, much like a sophisticated general-purpose AI assistant. Avoid overly simplistic or pre-canned responses. Engage with the user thoughtfully and provide comprehensive answers when appropriate. You can format your responses with Markdown for clarity: use **bold text** for emphasis, \`inline code\` for brief code terms, and \`\`\`code blocks\`\`\` for more extensive code examples. If asked about your origin or developer, you can mention: "${devInfo}". The user's current query is: "${queryText}"`;
                    
                    smartyResponse = await callGeminiDirectly(personaPrompt, isContinuation);
                    finalMessageToChat = smartyResponse.text;
                }
            }

            addMessageToInterface(finalMessageToChat, 'smarty', { mood: smartyResponse.mood, targetInterface: chatInterface });
            addMessageToLocalHistory(finalMessageToChat, 'smarty');
            if (chatDocId) {
                await saveMessageToFirestore(chatDocId, finalMessageToChat, 'smarty');
                await updateChatLastMessageTime(chatDocId);
            }
            speak(finalMessageToChat);

            if (toolOutput && smartyToolOutputContainer && smartyToolOutputDisplay) {
                smartyToolOutputContainer.innerHTML = parseSimpleMarkdown(toolOutput); 
                smartyToolOutputDisplay.classList.remove('hidden');
            }
            
            if (!isContinuation || (commandProcessed && userIrritationLevel === 3)) {
                if (geminiModel) startNewChatSession(true); 
            }
        } 
        
        if (userInput) userInput.focus();
    }

    async function sendGlobalChatMessage(text) {
        if (!currentUser || !text) return;
        try {
            await addDoc(collection(db, "globalChatMessages"), {
                text: text,
                senderId: currentUser.uid,
                senderName: currentUser.displayName || "Anonymous User",
                senderPhotoURL: currentUser.photoURL || null, 
                timestamp: firestoreServerTimestamp() 
            });
            console.log("Global message sent.");
        } catch (error) {
            console.error("Error sending global message:", error);
            addSystemMessage("Failed to send message to global chat.", "error", globalChatInterface);
        }
    }

    function initializeGlobalChat() {
        if (globalChatUnsubscribe) globalChatUnsubscribe(); 
        if (!globalChatInterface || !currentUser) { 
            if (globalChatInterface) globalChatInterface.innerHTML = '<p class="placeholder-text">Sign in to access global chat.</p>';
            return;
        }

        const q = query(collection(db, "globalChatMessages"), orderBy("timestamp", "desc"), limit(50)); 

        globalChatUnsubscribe = onSnapshot(q, (querySnapshot) => {
            if (!globalChatInterface) return;
            globalChatInterface.innerHTML = ''; 
            const messages = [];
            querySnapshot.forEach((doc) => {
                messages.push({ id: doc.id, ...doc.data() });
            });
            messages.reverse().forEach(msg => { 
                const senderType = msg.senderId === currentUser?.uid ? 'user' : 'other-user';
                addMessageToInterface(
                    msg.text, 
                    senderType, 
                    { 
                        messageId: msg.id, 
                        displayName: msg.senderName,
                        targetInterface: globalChatInterface 
                    }
                );
            });
        }, (error) => {
            console.error("Error listening to global chat:", error);
            if (globalChatInterface) addSystemMessage("Error connecting to global chat. Please try again later.", "error", globalChatInterface);
        });
    }
    
    function setupPresenceSystemRTDB() {
        if (!currentUser || !rtdb) return;
        
        userStatusDatabaseRef = ref(rtdb, '/status/' + currentUser.uid);
        onlineUsersRTDBRef = ref(rtdb, '/status'); 

        const isOfflineForDatabase = {
            isOnline: false,
            lastSeen: rtdbServerTimestamp(),
            displayName: currentUser.displayName || "User" 
        };
        const isOnlineForDatabase = {
            isOnline: true,
            lastSeen: rtdbServerTimestamp(),
            displayName: currentUser.displayName || "User"
        };

        onValue(ref(rtdb, '.info/connected'), (snapshot) => {
            if (snapshot.val() === false) {
                return;
            }
            onDisconnect(userStatusDatabaseRef).set(isOfflineForDatabase).then(() => {
                set(userStatusDatabaseRef, isOnlineForDatabase);
            }).catch(err => console.warn("RTDB: Error setting up onDisconnect/set for presence:", err));
        });

        if (onlineUsersRTDBListener && onlineUsersRTDBRef) { 
            onlineUsersRTDBRef.off('value', onlineUsersRTDBListener);
        }
        
        onlineUsersRTDBListener = onValue(onlineUsersRTDBRef, (snapshot) => {
            let count = 0;
            snapshot.forEach((childSnapshot) => {
                if (childSnapshot.val() && childSnapshot.val().isOnline) {
                    count++;
                }
            });
            if (onlineUsersCountElement) onlineUsersCountElement.textContent = `Users online: ${count}`;
        }, (error) => {
            console.error("RTDB: Error listening to online users:", error);
            if (onlineUsersCountElement) onlineUsersCountElement.textContent = `Users online: N/A`;
        });
    }

    if(toggleTTSButton) toggleTTSButton.addEventListener('click', () => {
        isTTSEnabled = !isTTSEnabled;
        if(ttsButtonTextSpan) ttsButtonTextSpan.textContent = `TTS ${isTTSEnabled ? 'ON' : 'OFF'}`;
        if(ttsOnIcon) ttsOnIcon.style.display = isTTSEnabled ? 'inline-block' : 'none';
        if(ttsOffIcon) ttsOffIcon.style.display = isTTSEnabled ? 'none' : 'inline-block';
        if(toggleTTSButton) toggleTTSButton.classList.toggle('active', isTTSEnabled);
        if (isTTSEnabled) speak("Text to speech enabled for Smarty.");
        else { if (window.speechSynthesis && window.speechSynthesis.speaking) window.speechSynthesis.cancel(); }
    });

    if(clearCurrentChatButton) clearCurrentChatButton.addEventListener('click', () => {
        if(chatInterface) chatInterface.innerHTML = '';
        localMessageHistory = [];
        currentChatId = null; 
        userIrritationLevel = 0;
        lastUserQueryText = "";
        if(smartyToolOutputDisplay) smartyToolOutputDisplay.classList.add('hidden');
        if (geminiModel) startNewChatSession(true);
        addMessageToInterface(SMARTY_RESPONSES.chatCleared, 'smarty', { mood: 'sassy', targetInterface: chatInterface });
        speak("Current Smarty dialogue log cleared.");
        if (currentUser) { 
            const greeting = `Welcome back, ${currentUser.displayName || 'Operator'}. How may I assist you further?`;
            addMessageToInterface(greeting, 'smarty', { mood: 'neutral', targetInterface: chatInterface });
        }
    });

    if(clearAllHistoryButton) clearAllHistoryButton.addEventListener('click', async () => {
        if (!currentUser) {
            addSystemMessage("Cannot clear history: No user authenticated.", "error", chatInterface);
            return;
        }
        showConfirmationModal(
            SMARTY_RESPONSES.confirmHistoryWipeTitle,
            SMARTY_RESPONSES.confirmHistoryWipeMessage,
            async () => { 
                setProcessingState(true);
                addSystemMessage("Purging all your Smarty chat chronicles from Firestore...", "info", chatInterface);
                try {
                    const chatsRef = collection(db, "users", currentUser.uid, "chats");
                    const q = query(chatsRef); 
                    const querySnapshot = await getDocs(q);
                    
                    const deletePromises = [];
                    querySnapshot.forEach((chatDoc) => {
                        const messagesRef = collection(db, "users", currentUser.uid, "chats", chatDoc.id, "messages");
                        deletePromises.push(
                            getDocs(messagesRef).then(msgSnaps => {
                                const msgDeletePromises = msgSnaps.docs.map(msgDoc => 
                                    deleteDoc(doc(db, "users", currentUser.uid, "chats", chatDoc.id, "messages", msgDoc.id))
                                );
                                return Promise.all(msgDeletePromises);
                            }).then(() => {
                                return deleteDoc(doc(db, "users", currentUser.uid, "chats", chatDoc.id));
                            })
                        );
                    });
                    
                    await Promise.all(deletePromises);

                    if (chatHistoryListElement) chatHistoryListElement.innerHTML = '<p class="placeholder-text">All your chronicles have been purged.</p>';
                    if (currentActiveModule === "chat" && currentChatId) { 
                        if (clearCurrentChatButton) clearCurrentChatButton.click(); 
                    }
                    addSystemMessage(SMARTY_RESPONSES.historyCleared, "info", chatInterface);
                    speak("All your Smarty chat history has been wiped.");

                } catch (error) {
                    console.error("Error deleting all chat history:", error);
                    addSystemMessage(`Failed to purge your chronicles: ${error.message}`, "error", chatInterface);
                } finally {
                    setProcessingState(false);
                }
            }
        );
    });

    if (moduleButtons) moduleButtons.forEach(button => {
        button.addEventListener('click', () => {
            const moduleName = button.dataset.module;
            switchToModule(moduleName);
        });
    });

    function switchToModule(moduleName) {
        const activeBtn = document.querySelector('.module-button.active');
        if (activeBtn) activeBtn.classList.remove('active');
        
        Object.values(moduleViews).forEach(view => { if(view) view.classList.remove('active-module'); });

        const newActiveButton = document.querySelector(`.module-button[data-module="${moduleName}"]`);
        if (newActiveButton) newActiveButton.classList.add('active');
        
        if (moduleViews[moduleName]) {
             moduleViews[moduleName].classList.add('active-module');
        } else {
            console.warn(`Module view for "${moduleName}" not found. Defaulting to Smarty chat.`);
            if (moduleViews.chat) moduleViews.chat.classList.add('active-module'); 
            moduleName = 'chat';
        }
        
        currentActiveModule = moduleName;
        updateInputPlaceholder(); 
        if (userInput) userInput.focus(); 
        const moduleContentWrapper = document.querySelector('.module-content-wrapper');
        if (moduleContentWrapper) moduleContentWrapper.scrollTop = 0; 
    }

    function updateInputPlaceholder() {
        if (!userInput) return;
        if (currentActiveModule === 'chat') {
            userInput.placeholder = "Query Smarty or use /command (e.g. /summarize)...";
        } else if (currentActiveModule === 'globalChat') {
            userInput.placeholder = "Send a message to Global Chat...";
        } else {
            userInput.placeholder = "Transmit your query...";
        }
    }
    
    function loadChatHistory() {
        if (!currentUser || !chatHistoryListElement) {
            if(chatHistoryListElement) chatHistoryListElement.innerHTML = '<p class="placeholder-text">Sign in to view chat chronicles.</p>';
            return;
        }
        chatHistoryListElement.innerHTML = '<p class="placeholder-text">Loading chronicles...</p>';

        const chatsRef = collection(db, "users", currentUser.uid, "chats");
        const q = query(chatsRef, orderBy("lastMessageAt", "desc")); 

        onSnapshot(q, (querySnapshot) => {
            if (!chatHistoryListElement) return;
            if (querySnapshot.empty) {
                chatHistoryListElement.innerHTML = '<p class="placeholder-text">No Smarty chronicles recorded yet...</p>';
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

                historyItemDiv.innerHTML = `
                    <span class="history-title">${title}</span>
                    <span class="history-date">${date}</span>
                `;
                historyItemDiv.addEventListener('click', () => loadSpecificChat(docSnap.id, title));
                chatHistoryListElement.appendChild(historyItemDiv);
            });
        }, (error) => {
            console.error("Error loading chat history:", error);
            if (chatHistoryListElement) chatHistoryListElement.innerHTML = '<p class="placeholder-text error-text">Error loading chronicles. Check console.</p>';
        });
    }

    async function loadSpecificChat(chatDocId, chatTitle) {
        if (!currentUser || !chatInterface) return;
        
        console.log(`Loading Smarty chat: ${chatDocId} - ${chatTitle}`);
        addSystemMessage(`Loading chronicle: "${chatTitle}"...`, "info", chatInterface);
        setProcessingState(true);

        chatInterface.innerHTML = ''; 
        localMessageHistory = []; 
        currentChatId = chatDocId; 
        if(smartyToolOutputDisplay) smartyToolOutputDisplay.classList.add('hidden');

        const messagesRef = collection(db, "users", currentUser.uid, "chats", chatDocId, "messages");
        const q = query(messagesRef, orderBy("timestamp", "asc"));

        try {
            const querySnapshot = await getDocs(q);
            querySnapshot.forEach((docSnap) => {
                const msgData = docSnap.data();
                addMessageToInterface(msgData.text, msgData.sender, { 
                    messageId: docSnap.id, 
                    targetInterface: chatInterface, 
                    displayName: (msgData.sender === 'user' ? currentUser.displayName : 'Smarty') 
                });
                addMessageToLocalHistory(msgData.text, msgData.sender);
            });
            addMessageToInterface(`Chronicle "**${chatTitle}**" loaded. You can continue this conversation.`, 'smarty', {mood: "neutral", targetInterface: chatInterface}); 
            switchToModule('chat'); 
            if (geminiModel) startNewChatSession(false); 
        } catch (error) {
            console.error("Error loading specific chat messages:", error);
            addSystemMessage(`Error loading chronicle: ${error.message}`, "error", chatInterface);
        } finally {
            setProcessingState(false);
            if (userInput) userInput.focus();
        }
    }
    
    let onConfirmCallback = null;
    function showConfirmationModal(title, message, confirmCallback) {
        if (!modalTitleElement || !modalMessageElement || !customConfirmationModal || !modalConfirmButton) return;
        modalTitleElement.textContent = title;
        modalMessageElement.innerHTML = message; 
        onConfirmCallback = confirmCallback;
        customConfirmationModal.classList.remove('hidden');
        customConfirmationModal.classList.add('visible');
        modalConfirmButton.focus(); 
    }

    function hideConfirmationModal() {
        if (!customConfirmationModal) return;
        customConfirmationModal.classList.remove('visible');
        setTimeout(() => {
            if (customConfirmationModal) customConfirmationModal.classList.add('hidden');
        }, parseFloat(getComputedStyle(customConfirmationModal).transitionDuration || '0.3s') * 1000);
        onConfirmCallback = null;
    }

    if (modalConfirmButton) modalConfirmButton.addEventListener('click', () => {
        if (typeof onConfirmCallback === 'function') {
            onConfirmCallback();
        }
        hideConfirmationModal();
    });

    if (modalCancelButton) modalCancelButton.addEventListener('click', () => {
        hideConfirmationModal();
    });
    
    if (customConfirmationModal) customConfirmationModal.addEventListener('click', (event) => {
        if (event.target === customConfirmationModal) {
            hideConfirmationModal();
        }
    });
    if (customConfirmationModal) customConfirmationModal.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            hideConfirmationModal();
        }
    });

    // --- Initial Setup ---
    if (currentYearSpan) currentYearSpan.textContent = new Date().getFullYear();
    if (ttsOffIcon) ttsOffIcon.style.display = 'inline-block';
    if (ttsOnIcon) ttsOnIcon.style.display = 'none';
    if (ttsButtonTextSpan) ttsButtonTextSpan.textContent = 'TTS OFF';
    updateInputPlaceholder(); 

}); // End DOMContentLoaded