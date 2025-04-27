// ==UserScript==
// @name         Gemini Chat History Manager
// @namespace    https://github.com/InvictusNavarchus/gemini-chat-history
// @downloadURL  https:///raw.githubusercontent.com/InvictusNavarchus/gemini-chat-history/master/gemini-chat-history.user.js
// @updateURL    https:///raw.githubusercontent.com/InvictusNavarchus/gemini-chat-history/master/gemini-chat-history.user.js
// @version      0.7.0
// @description  Tracks Gemini chat history (Timestamp, URL, Title, Model, Prompt, Files) and allows exporting to JSON
// @author       Invictus
// @match        https://gemini.google.com/*
// @icon         https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @require      https://cdn.jsdelivr.net/npm/@violentmonkey/dom@2 // For VM.observe
// ==/UserScript==

(function () {
    'use strict';

    /**
     * ==========================================
     * CONFIGURATION AND CONSTANTS
     * ==========================================
     */
    const CONFIG = {
        STORAGE_KEY: 'geminiChatHistory',
        TIMEZONE: 'Asia/Jakarta',
        BASE_URL: 'https://gemini.google.com/app',
        LOG_PREFIX: "[Gemini History]"
    };

    // Known model names that might appear in the UI
    const MODEL_NAMES = {
        '2.0 Flash': '2.0 Flash',
        '2.5 Flash': '2.5 Flash',
        '2.5 Pro': '2.5 Pro',
        'Deep Research': 'Deep Research',
        // Add more specific model names as they appear in the UI
    };

    /**
     * ==========================================
     * STATE VARIABLES
     * ==========================================
     */
    const STATE = {
        isNewChatPending: false,
        pendingModelName: null,
        pendingPrompt: null,
        pendingAttachedFiles: [],
        pendingAccountName: null,
        pendingAccountEmail: null,
        sidebarObserver: null,
        titleObserver: null
    };

    /**
     * ==========================================
     * LOGGING MODULE
     * ==========================================
     */
    const Logger = {
        log: (...args) => console.log(CONFIG.LOG_PREFIX, ...args),
        warn: (...args) => console.warn(CONFIG.LOG_PREFIX, ...args),
        error: (...args) => console.error(CONFIG.LOG_PREFIX, ...args)
    };

    /**
     * ==========================================
     * UTILITY FUNCTIONS
     * ==========================================
     */
    const Utils = {
        /**
         * Gets current timestamp in Jakarta timezone
         */
        getCurrentJakartaTimestamp: function () {
            try {
                const now = new Date();
                const options = {
                    timeZone: CONFIG.TIMEZONE,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                };
                const formatter = new Intl.DateTimeFormat('en-CA', options);
                const parts = formatter.formatToParts(now).reduce((acc, part) => {
                    acc[part.type] = part.value;
                    return acc;
                }, {});

                const yyyy = parts.year;
                const mm = String(parts.month).padStart(2, '0');
                const dd = String(parts.day).padStart(2, '0');
                const hh = String(parts.hour).padStart(2, '0');
                const MM = String(parts.minute).padStart(2, '0');
                const ss = String(parts.second).padStart(2, '0');

                return `${yyyy}-${mm}-${dd}T${hh}:${MM}:${ss}`;
            } catch (e) {
                Logger.error("Error getting Jakarta Time timestamp:", e);
                return new Date().toISOString(); // Fallback
            }
        },

        /**
         * Determines if a URL is a valid Gemini chat URL
         */
        isValidChatUrl: function (url) {
            const chatUrlPattern = /^https:\/\/gemini\.google\.com\/app\/[a-f0-9]+$/;
            return chatUrlPattern.test(url);
        }
    };

    /**
     * ==========================================
     * MODEL DETECTION MODULE
     * ==========================================
     */
    const ModelDetector = {
        /**
         * Attempts to detect the currently selected Gemini model
         */
        getCurrentModelName: function () {
            Logger.log("Attempting to get current model name...");
            let rawText = null;
            let foundVia = null;

            // Try #1: New button structure
            const modelButton = document.querySelector('button.gds-mode-switch-button.mat-mdc-button-base .logo-pill-label-container span');
            if (modelButton && modelButton.textContent) {
                rawText = modelButton.textContent.trim();
                foundVia = "New Button Structure";
                Logger.log(`Model raw text found via ${foundVia}: "${rawText}"`);
            } else {
                Logger.log("Model not found via New Button Structure.");
                // Try #2: data-test-id
                const modelElement = document.querySelector('bard-mode-switcher [data-test-id="attribution-text"] span');
                if (modelElement && modelElement.textContent) {
                    rawText = modelElement.textContent.trim();
                    foundVia = "Data-Test-ID";
                    Logger.log(`Model raw text found via ${foundVia}: "${rawText}"`);
                } else {
                    Logger.log("Model not found via Data-Test-ID.");
                    // Try #3: Fallback selector
                    const fallbackElement = document.querySelector('.current-mode-title span');
                    if (fallbackElement && fallbackElement.textContent) {
                        rawText = fallbackElement.textContent.trim();
                        foundVia = "Fallback Selector (.current-mode-title)";
                        Logger.log(`Model raw text found via ${foundVia}: "${rawText}"`);
                    } else {
                        Logger.log("Model not found via Fallback Selector.");
                    }
                }
            }

            if (rawText) {
                const sortedKeys = Object.keys(MODEL_NAMES).sort((a, b) => b.length - a.length);
                for (const key of sortedKeys) {
                    if (rawText.startsWith(key)) {
                        const model = MODEL_NAMES[key];
                        Logger.log(`Matched known model: "${model}" from raw text "${rawText}"`);
                        return model;
                    }
                }
                Logger.log(`Raw text "${rawText}" didn't match known prefixes, using raw text as model name.`);
                return rawText; // Return raw text if no prefix matches
            }

            Logger.warn("Could not determine current model name from any known selector.");
            return 'Unknown';
        }
    };

    /**
     * ==========================================
     * PROMPT/FILE EXTRACTION MODULE
     * ==========================================
     */
    const InputExtractor = {
        /**
         * Extracts the prompt text from the input area.
         * If the prompt contains code blocks delimited by triple backticks,
         * it will be truncated and a placeholder will be added.
         */
        getPromptText: function () {
            const promptElement = document.querySelector('rich-textarea .ql-editor');
            if (promptElement) {
                const text = promptElement.innerText.trim();

                // Check for triple backticks and truncate if found
                const backtickIndex = text.indexOf('```');
                if (backtickIndex !== -1) {
                    const truncatedText = text.substring(0, backtickIndex).trim();
                    Logger.log(`Found code block in prompt. Truncating at index ${backtickIndex}`);
                    Logger.log(`Extracted prompt text (truncated): "${truncatedText} [attached blockcode]"`);
                    return `${truncatedText} [attached blockcode]`;
                }

                Logger.log(`Extracted prompt text: "${text}"`);
                return text;
            } else {
                Logger.warn("Could not find prompt input element ('rich-textarea .ql-editor').");
                return ''; // Return empty string if not found
            }
        },

        /**
         * Extracts the filenames of attached files.
         * Returns an array of filenames (strings).
         */
        getAttachedFiles: function () {
            const fileElements = document.querySelectorAll('uploader-file-preview-container .file-preview [data-test-id="file-name"]');
            if (fileElements.length > 0) {
                const filenames = Array.from(fileElements).map(el => {
                    // Prefer the 'title' attribute as it usually contains the full name
                    return el.getAttribute('title') || el.innerText.trim();
                });
                Logger.log(`Extracted attached filenames:`, filenames);
                return filenames;
            } else {
                Logger.log("No attached file elements found.");
                return []; // Return empty array if none found
            }
        },

        /**
         * Extracts the user account name and email from the UI.
         * Returns an object with name and email properties.
         */
        getAccountInfo: function () {
            Logger.log("Attempting to extract account information...");
            const accountElement = document.querySelector('.gb_B[aria-label^="Google Account:"]');

            if (!accountElement) {
                Logger.warn("Could not find account element. Returning unknown values.");
                return { name: 'Unknown', email: 'Unknown' };
            }

            try {
                const ariaLabel = accountElement.getAttribute('aria-label');
                Logger.log(`Found aria-label: ${ariaLabel}`);

                // Extract name and email using regex
                // Format: "Google Account: [Name] ([Email])"
                const match = ariaLabel.match(/Google Account: (.*?)\s+\((.*?)\)/);

                if (match && match.length === 3) {
                    const name = match[1].trim();
                    const email = match[2].trim();
                    Logger.log(`Extracted account info - Name: "${name}", Email: "${email}"`);
                    return { name, email };
                } else {
                    Logger.warn(`Could not parse account information from: "${ariaLabel}"`);
                    return { name: 'Unknown', email: 'Unknown' };
                }
            } catch (e) {
                Logger.error("Error extracting account information:", e);
                return { name: 'Unknown', email: 'Unknown' };
            }
        }
    };

    /**
     * ==========================================
     * HISTORY MANAGEMENT MODULE
     * ==========================================
     */
    const HistoryManager = {
        /**
         * Loads chat history from storage
         */
        loadHistory: function () {
            Logger.log("Loading history from storage...");
            const storedData = GM_getValue(CONFIG.STORAGE_KEY, '[]');
            try {
                const history = JSON.parse(storedData);
                if (Array.isArray(history)) {
                    Logger.log(`History loaded successfully. Found ${history.length} entries.`);
                    return history;
                } else {
                    Logger.warn("Stored history data is not an array. Returning empty history.");
                    return [];
                }
            } catch (e) {
                Logger.error("Error parsing stored history:", e, "Stored data was:", storedData);
                return []; // Return empty array on error
            }
        },

        /**
         * Saves chat history to storage
         */
        saveHistory: function (history) {
            Logger.log(`Attempting to save history with ${history.length} entries...`);
            if (!Array.isArray(history)) {
                Logger.error("Attempted to save non-array data. Aborting save.");
                return;
            }
            try {
                GM_setValue(CONFIG.STORAGE_KEY, JSON.stringify(history));
                Logger.log("History saved successfully.");
            } catch (e) {
                Logger.error("Error saving history:", e);
            }
        },

        /**
         * Adds a new entry to the chat history
         */
        addHistoryEntry: function (timestamp, url, title, model, prompt, attachedFiles, accountName, accountEmail) {
            const entryData = {
                timestamp,
                url,
                title,
                model,
                prompt,
                attachedFiles,
                accountName,
                accountEmail
            };
            Logger.log("Attempting to add history entry:", entryData);

            // Basic validation (Title, URL, Timestamp, Model are still required)
            if (!timestamp || !url || !title || !model) {
                Logger.warn("Attempted to add entry with missing essential data. Skipping.", entryData);
                return false; // Indicate failure
            }

            // Prevent adding entry if URL is invalid
            if (!Utils.isValidChatUrl(url)) {
                Logger.warn(`Attempted to add entry with invalid chat URL pattern "${url}". Skipping.`);
                return false; // Indicate failure
            }

            const history = this.loadHistory();

            // Prevent duplicates based on URL
            if (history.some(entry => entry.url === url)) {
                Logger.log("Duplicate URL detected, skipping entry:", url);
                return false; // Indicate failure (or already added)
            }

            history.unshift(entryData); // Add to beginning
            this.saveHistory(history);
            Logger.log("Successfully added history entry.");
            return true; // Indicate success
        },

        /**
         * Exports history to JSON file for download
         */
        exportToJson: function () {
            Logger.log("Export command triggered.");
            const history = this.loadHistory();
            if (history.length === 0) {
                Logger.warn("No history found to export.");
                alert("Gemini History: No history found to export.");
                return;
            }

            Logger.log(`Exporting ${history.length} history entries.`);
            try {
                const jsonString = JSON.stringify(history, null, 2); // Pretty print
                const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
                const url = URL.createObjectURL(blob);

                const link = document.createElement("a");
                link.setAttribute("href", url);
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const filename = `gemini_chat_history_${timestamp}.json`;
                link.setAttribute("download", filename);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                Logger.log(`Download initiated for file: ${filename}`);

                // Revoke the Blob URL after a short delay
                setTimeout(() => {
                    URL.revokeObjectURL(url);
                    Logger.log("Blob URL revoked.");
                }, 1000);
            } catch (e) {
                Logger.error("Error during JSON export process:", e);
                alert("Gemini History: An error occurred during export. Check the console (F12).");
            }
        },

        /**
         * Views history as JSON in a new browser tab
         */
        viewHistoryJson: function () {
            Logger.log("View JSON command triggered.");
            const history = this.loadHistory();
            if (history.length === 0) {
                Logger.warn("No history found to view.");
                alert("Gemini History: No history found to view.");
                return;
            }

            Logger.log(`Viewing ${history.length} history entries.`);
            try {
                const jsonString = JSON.stringify(history, null, 2); // Pretty print
                const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
                const url = URL.createObjectURL(blob);

                // Open in new tab instead of downloading
                window.open(url, '_blank');

                // Revoke the Blob URL after a longer delay (user might need time to view)
                setTimeout(() => {
                    URL.revokeObjectURL(url);
                    Logger.log("Blob URL revoked.");
                }, 60000); // 1 minute delay to ensure user has time to view
            } catch (e) {
                Logger.error("Error during JSON view process:", e);
                alert("Gemini History: An error occurred while viewing JSON. Check the console (F12).");
            }
        }
    };

    /**
     * ==========================================
     * DOM OBSERVATION MODULE
     * ==========================================
     */
    const DomObserver = {
        /**
         * Helper function to disconnect an observer and set its reference to null
         */
        cleanupObserver: function (observer) {
            if (observer) {
                observer.disconnect();
                return null;
            }
            return observer;
        },

        /**
         * Extracts the title from a sidebar conversation item
         */
        extractTitleFromSidebarItem: function (conversationItem) {
            Logger.log("Attempting to extract title from sidebar item:", conversationItem);
            // Skip if the item is still hidden (display:none) — will become visible once the title settles
            // it turned out that Gemini set the user's prompt as the placeholder value before the real title is created
            if (conversationItem.offsetParent === null) {
                Logger.log("Conversation item not visible (hidden). Skipping title extraction.");
                return null;
            }
            const titleElement = conversationItem.querySelector('.conversation-title');
            if (!titleElement) {
                Logger.warn("Could not find title element (.conversation-title).");
                return null;
            }
            Logger.log("Found title container element:", titleElement);
            try {
                // Try direct text node
                const first = titleElement.firstChild;
                if (first && first.nodeType === Node.TEXT_NODE) {
                    const t = first.textContent.trim();
                    if (t) {
                        Logger.log(`Extracted via text node: "${t}"`);
                        return t;
                    }
                    Logger.warn("Text node was empty, falling back.");
                }
                // FALLBACK: full textContent
                const full = titleElement.textContent.trim();
                if (full) {
                    Logger.log(`Fallback textContent: "${full}"`);
                    return full;
                }
                Logger.warn("titleElement.textContent was empty or whitespace.");
            } catch (e) {
                Logger.error("Error during title extraction:", e);
            }
            return null;
        },

        /**
         * Finds a conversation item in a mutation list
         */
        findConversationItemInMutations: function (mutationsList) {
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('conversation-items-container')) {
                            const conversationItem = node.querySelector('div[data-test-id="conversation"]');
                            if (conversationItem) {
                                return conversationItem;
                            }
                        }
                    }
                }
            }
            return null;
        },

        /**
         * Captures context information for a new conversation
         */
        captureConversationContext: function () {
            const accountInfo = InputExtractor.getAccountInfo();

            return {
                timestamp: Utils.getCurrentJakartaTimestamp(),
                url: window.location.href,
                model: STATE.pendingModelName,
                prompt: STATE.pendingPrompt,
                attachedFiles: STATE.pendingAttachedFiles,
                accountName: accountInfo.name,
                accountEmail: accountInfo.email
            };
        },

        /**
         * Handles the processing of mutations for the sidebar observer
         */
        processSidebarMutations: function (mutationsList) {
            Logger.log(`MAIN Sidebar Observer Callback Triggered. ${mutationsList.length} mutations.`);
            const currentUrl = window.location.href;
            Logger.log(`Current URL inside MAIN observer: ${currentUrl}`);

            if (!Utils.isValidChatUrl(currentUrl)) {
                Logger.log(`URL "${currentUrl}" does not match the expected chat pattern. Waiting...`);
                return false; // URL still not a valid chat URL
            }

            Logger.log("URL check passed (matches chat pattern). Processing mutations to find NEW conversation item...");

            if (!STATE.isNewChatPending) {
                Logger.log("No new chat is pending. Ignoring mutations.");
                return false;
            }

            const conversationItem = this.findConversationItemInMutations(mutationsList);
            if (conversationItem) {
                Logger.log("Found NEW conversation item container. Preparing to wait for title...");

                // Capture context before disconnecting observer
                const context = this.captureConversationContext();

                // Stage 1 Complete: Found the Item - Disconnect the MAIN observer
                STATE.sidebarObserver = this.cleanupObserver(STATE.sidebarObserver);

                // Clear pending flags
                STATE.isNewChatPending = false;
                STATE.pendingModelName = null;
                STATE.pendingPrompt = null;
                STATE.pendingAttachedFiles = [];
                STATE.pendingAccountName = null;
                STATE.pendingAccountEmail = null;
                Logger.log(`Cleared pending flags. Waiting for title associated with URL: ${context.url}`);

                // Stage 2: Wait for the Title
                this.observeTitleForItem(conversationItem, context.url, context.timestamp, context.model, context.prompt, context.attachedFiles, context.accountName, context.accountEmail);
                return true;
            }

            return false;
        },

        /**
         * Sets up observation of the sidebar to detect new chats
         */
        observeSidebarForNewChat: function () {
            const targetSelector = 'conversations-list[data-test-id="all-conversations"]';
            const conversationListElement = document.querySelector(targetSelector);

            if (!conversationListElement) {
                Logger.warn(`Could not find conversation list element ("${targetSelector}") to observe. Aborting observation setup.`);
                STATE.isNewChatPending = false; // Reset flag
                STATE.pendingModelName = null;
                STATE.pendingPrompt = null;
                STATE.pendingAttachedFiles = [];
                STATE.pendingAccountName = null;
                STATE.pendingAccountEmail = null;
                return;
            }

            Logger.log("Found conversation list element. Setting up MAIN sidebar observer...");

            // Disconnect previous observers if they exist
            STATE.sidebarObserver = this.cleanupObserver(STATE.sidebarObserver);
            STATE.titleObserver = this.cleanupObserver(STATE.titleObserver);

            STATE.sidebarObserver = new MutationObserver((mutationsList) => {
                this.processSidebarMutations(mutationsList);
            });

            STATE.sidebarObserver.observe(conversationListElement, {
                childList: true,
                subtree: true
            });
            Logger.log("MAIN sidebar observer is now active.");
        },

        /**
         * Helper function to process title and add history entry
         */
        processTitleAndAddHistory: function (title, expectedUrl, timestamp, model, prompt, attachedFiles, accountName, accountEmail) {
            if (title) {
                Logger.log(`Title found for ${expectedUrl}! Attempting to add history entry.`);
                STATE.titleObserver = this.cleanupObserver(STATE.titleObserver);
                HistoryManager.addHistoryEntry(timestamp, expectedUrl, title, model, prompt, attachedFiles, accountName, accountEmail);
                return true;
            }
            return false;
        },

        /**
         * Process mutations for title changes
         */
        processTitleMutations: function (conversationItem, expectedUrl, timestamp, model, prompt, attachedFiles, accountName, accountEmail) {
            // Abort if URL changed
            if (window.location.href !== expectedUrl) {
                Logger.warn("URL changed; disconnecting TITLE observer.");
                STATE.titleObserver = this.cleanupObserver(STATE.titleObserver);
                return true;
            }

            // Extract title and process if found
            const title = this.extractTitleFromSidebarItem(conversationItem);
            if (this.processTitleAndAddHistory(title, expectedUrl, timestamp, model, prompt, attachedFiles, accountName, accountEmail)) {
                return true;
            }

            Logger.log("No title yet; continuing to observe...");
            return false;
        },

        /**
         * Sets up observation of a specific conversation item to capture its title once available
         */
        observeTitleForItem: function (conversationItem, expectedUrl, timestamp, model, prompt, attachedFiles, accountName, accountEmail) {
            // Initial check
            if (this.attemptTitleCaptureAndSave(conversationItem, expectedUrl, timestamp, model, prompt, attachedFiles, accountName, accountEmail)) {
                return;
            }

            STATE.titleObserver = new MutationObserver(() => {
                this.processTitleMutations(conversationItem, expectedUrl, timestamp, model, prompt, attachedFiles, accountName, accountEmail);
            });

            STATE.titleObserver.observe(conversationItem, {
                childList: true, attributes: true,
                characterData: true, subtree: true,
                attributeOldValue: true
            });
            Logger.log(`TITLE observer active for URL: ${expectedUrl}`);
        },

        /**
         * Attempts to capture the title and save the history entry if successful
         */
        attemptTitleCaptureAndSave: function (item, expectedUrl, timestamp, model, prompt, attachedFiles, accountName, accountEmail) {
            // Check if we are still on the page this observer was created for
            if (window.location.href !== expectedUrl) {
                Logger.warn(`URL changed from "${expectedUrl}" to "${window.location.href}" while waiting for title. Disconnecting TITLE observer.`);
                STATE.titleObserver = this.cleanupObserver(STATE.titleObserver);
                return true; // Return true to indicate we should stop trying (observer is disconnected)
            }

            const title = this.extractTitleFromSidebarItem(item);
            Logger.log(`TITLE Check (URL: ${expectedUrl}): Extracted title: "${title}"`);

            return this.processTitleAndAddHistory(title, expectedUrl, timestamp, model, prompt, attachedFiles, accountName, accountEmail);
        }
    };

    /**
     * ==========================================
     * EVENT HANDLERS
     * ==========================================
     */
    const EventHandlers = {
        /**
         * Checks if the target is a valid send button
         */
        isSendButton: function (target) {
            const sendButton = target.closest('button:has(mat-icon[data-mat-icon-name="send"]), button.send-button, button[aria-label*="Send"], button[data-test-id="send-button"]');

            if (!sendButton) {
                return false;
            }

            if (sendButton.getAttribute('aria-disabled') === 'true') {
                Logger.log("Send button is disabled. Ignoring click.");
                return false;
            }

            return sendButton;
        },

        /**
         * Prepares for tracking a new chat
         */
        prepareNewChatTracking: function () {
            Logger.log("URL matches GEMINI_APP_URL. This is potentially a new chat.");
            STATE.isNewChatPending = true;
            Logger.log("Set isNewChatPending = true");

            // Capture model, prompt, and files BEFORE navigating or starting observation
            STATE.pendingModelName = ModelDetector.getCurrentModelName();
            STATE.pendingPrompt = InputExtractor.getPromptText();
            STATE.pendingAttachedFiles = InputExtractor.getAttachedFiles();

            // Capture account information
            const accountInfo = InputExtractor.getAccountInfo();
            STATE.pendingAccountName = accountInfo.name;
            STATE.pendingAccountEmail = accountInfo.email;

            Logger.log(`Captured pending model name: "${STATE.pendingModelName}"`);
            Logger.log(`Captured pending prompt: "${STATE.pendingPrompt}"`);
            Logger.log(`Captured pending files:`, STATE.pendingAttachedFiles);
            Logger.log(`Captured account name: "${STATE.pendingAccountName}"`);
            Logger.log(`Captured account email: "${STATE.pendingAccountEmail}"`);

            // Use setTimeout to ensure observation starts after the click event potentially triggers initial DOM changes
            setTimeout(() => {
                Logger.log("Initiating sidebar observation via setTimeout.");
                DomObserver.observeSidebarForNewChat();
            }, 50); // Small delay
        },

        /**
         * Handles clicks on the send button to detect new chats
         */
        handleSendClick: function (event) {
            Logger.log("Click detected on body (capture phase). Target:", event.target);
            const sendButton = this.isSendButton(event.target);

            if (sendButton) {
                Logger.log("Click target is (or is inside) a potential send button.");
                const currentUrl = window.location.href;
                Logger.log(`Current URL at time of click: ${currentUrl}`);

                // Check if we are on the main app page (starting a NEW chat)
                if (currentUrl === CONFIG.BASE_URL) {
                    this.prepareNewChatTracking();
                } else {
                    Logger.log("URL does not match GEMINI_APP_URL. Ignoring click for history tracking.");
                }
            }
        }
    };

    /**
     * ==========================================
     * INITIALIZATION
     * ==========================================
     */
    function init() {
        Logger.log("Gemini History Manager initializing...");

        // Attach main click listener
        Logger.log("Attaching main click listener to document body...");
        document.body.addEventListener('click', EventHandlers.handleSendClick.bind(EventHandlers), true); // Use capture phase

        // Register menu commands
        Logger.log("Registering menu commands...");
        GM_registerMenuCommand("View Gemini Chat History JSON", HistoryManager.viewHistoryJson.bind(HistoryManager));
        GM_registerMenuCommand("Export Gemini Chat History to JSON", HistoryManager.exportToJson.bind(HistoryManager));

        Logger.log("Gemini History Manager initialization complete.");
    }

    // Start the script
    init();
})();