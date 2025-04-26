// ==UserScript==
// @name         Gemini Chat History Manager
// @namespace    https://github.com/InvictusNavarchus/gemini-chat-history
// @downloadURL  https:///raw.githubusercontent.com/InvictusNavarchus/gemini-chat-history/master/gemini-chat-history.user.js
// @updateURL    https:///raw.githubusercontent.com/InvictusNavarchus/gemini-chat-history/master/gemini-chat-history.user.js
// @version      0.2.5
// @description  Tracks Gemini chat history (Timestamp, URL, Title, Model) and allows exporting to JSON.
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
        sidebarObserver: null, // Main MutationObserver instance
        titleObserver: null    // Secondary MutationObserver for title
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
        addHistoryEntry: function (timestamp, url, title, model) {
            Logger.log("Attempting to add history entry:", { timestamp, url, title, model });

            // Basic validation
            if (!timestamp || !url || !title || !model) {
                Logger.warn("Attempted to add entry with missing data. Skipping.", { timestamp, url, title, model });
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

            history.unshift({ timestamp, url, title, model }); // Add to beginning
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
        }
    };

    /**
     * ==========================================
     * DOM OBSERVATION MODULE
     * ==========================================
     */
    const DomObserver = {
        /**
         * Extracts the title from a sidebar conversation item
         */
        extractTitleFromSidebarItem: function (conversationItem) {
            Logger.log("Attempting to extract title from sidebar item:", conversationItem);
            // Updated selector to match both active and inactive conversation titles
            const titleElement = conversationItem.querySelector('.conversation-title');
            if (titleElement) {
                Logger.log("Found title container element:", titleElement);
                try {
                    // Directly access the first child node, assuming it's the text node containing the title.
                    if (titleElement.firstChild && titleElement.firstChild.nodeType === Node.TEXT_NODE) {
                        // nodeType 3 is Text node
                        const title = titleElement.firstChild.textContent.trim();
                        Logger.log(`Extracted title directly from firstChild text node: "${title}"`);

                        // Return the title only if it's not just whitespace
                        return title ? title : null;
                    } else {
                        // Log if the assumption is wrong
                        Logger.warn("First child of title element is not a text node or is missing.");
                        if (titleElement.firstChild) {
                            Logger.warn(`First child nodeType is: ${titleElement.firstChild.nodeType}`);
                        }
                        // As a less reliable fallback, log the full textContent
                        Logger.warn(`Logging full textContent as fallback diagnostic: "${titleElement.textContent.trim()}"`);
                        return null; // Indicate failure to find the specific title text node
                    }
                } catch (e) {
                    Logger.error("Error during direct title extraction:", e);
                    return null;
                }
            }
            Logger.warn("Could not find title element (.conversation-title) within conversation item.");
            return null;
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
                return;
            }

            Logger.log("Found conversation list element. Setting up MAIN sidebar observer...");

            // Disconnect previous observers if they exist
            if (STATE.sidebarObserver) {
                Logger.log("Disconnecting previous MAIN sidebar observer.");
                STATE.sidebarObserver.disconnect();
                STATE.sidebarObserver = null;
            }
            if (STATE.titleObserver) {
                Logger.warn("Disconnecting lingering TITLE observer from previous attempt.");
                STATE.titleObserver.disconnect();
                STATE.titleObserver = null;
            }

            STATE.sidebarObserver = new MutationObserver((mutationsList, mainObserver) => {
                Logger.log(`MAIN Sidebar Observer Callback Triggered. ${mutationsList.length} mutations.`);
                const currentUrl = window.location.href;
                Logger.log(`Current URL inside MAIN observer: ${currentUrl}`);

                if (!Utils.isValidChatUrl(currentUrl)) {
                    Logger.log(`URL "${currentUrl}" does not match the expected chat pattern. Waiting...`);
                    return; // URL still not a valid chat URL
                }

                Logger.log("URL check passed (matches chat pattern). Processing mutations to find NEW conversation item...");
                for (const mutation of mutationsList) {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('conversation-items-container')) {
                                const conversationItem = node.querySelector('div[data-test-id="conversation"]');
                                if (conversationItem && STATE.isNewChatPending) {
                                    Logger.log("Found NEW conversation item container. Preparing to wait for title...");

                                    // Stage 1 Complete: Found the Item - Disconnect the MAIN observer
                                    Logger.log("Disconnecting MAIN sidebar observer.");
                                    mainObserver.disconnect();
                                    STATE.sidebarObserver = null;

                                    // Stage 2: Wait for the Title (Context Capture)
                                    Logger.log(`Starting TITLE observation process for specific item:`, conversationItem);
                                    const timestampCaptured = Utils.getCurrentJakartaTimestamp();
                                    const urlCaptured = currentUrl; // Capture the URL for this chat item
                                    const modelCaptured = STATE.pendingModelName;

                                    // Clear pending flags
                                    STATE.isNewChatPending = false;
                                    STATE.pendingModelName = null;
                                    Logger.log(`Cleared isNewChatPending flag. Waiting for title associated with URL: ${urlCaptured}`);

                                    this.observeTitleForItem(conversationItem, urlCaptured, timestampCaptured, modelCaptured);
                                    return; // Stop processing further mutations in the main observer callback
                                }
                            }
                        }
                    }
                }
            });

            STATE.sidebarObserver.observe(conversationListElement, {
                childList: true,
                subtree: true
            });
            Logger.log("MAIN sidebar observer is now active.");
        },

        /**
         * Sets up observation of a specific conversation item to capture its title once available
         */
        observeTitleForItem: function (conversationItem, expectedUrl, timestamp, model) {
            // Initial check right away
            if (this.attemptTitleCaptureAndSave(conversationItem, expectedUrl, timestamp, model)) {
                Logger.log("Title capture process concluded on initial check (found title or URL changed).");
                return; // Already done or aborted
            }

            // Set up a more comprehensive observer that watches EVERYTHING
            STATE.titleObserver = new MutationObserver((mutations) => {
                Logger.log(`TITLE Observer Callback Triggered. ${mutations.length} mutations.`);
                
                // First, check if URL still matches
                if (window.location.href !== expectedUrl) {
                    Logger.warn(`URL changed from "${expectedUrl}" to "${window.location.href}". Disconnecting TITLE observer.`);
                    STATE.titleObserver.disconnect();
                    STATE.titleObserver = null;
                    return;
                }
                
                // Directly look for and extract the title text from anywhere inside the conversation item
                const titleElements = conversationItem.querySelectorAll('.conversation-title');
                Logger.log(`Found ${titleElements.length} potential title elements in the conversation item.`);
                
                for (const titleElement of titleElements) {
                    // Check if this title element has direct text content
                    if (titleElement.childNodes) {
                        for (const node of titleElement.childNodes) {
                            if (node.nodeType === Node.TEXT_NODE) {
                                const text = node.textContent.trim();
                                if (text) {
                                    Logger.log(`Found text node with content: "${text}"`);
                                    // We found a non-empty text node - use it as the title
                                    Logger.log(`Title found for ${expectedUrl}: "${text}". Adding history entry.`);
                                    STATE.titleObserver.disconnect();
                                    STATE.titleObserver = null;
                                    HistoryManager.addHistoryEntry(timestamp, expectedUrl, text, model);
                                    return;
                                }
                            }
                        }
                    }
                    
                    // If we couldn't find direct text node but the element has textContent, use that as fallback
                    const fullText = titleElement.textContent.trim();
                    if (fullText) {
                        Logger.log(`Using textContent as fallback: "${fullText}"`);
                        STATE.titleObserver.disconnect();
                        STATE.titleObserver = null;
                        HistoryManager.addHistoryEntry(timestamp, expectedUrl, fullText, model);
                        return;
                    }
                }
                
                Logger.log("No title with text found yet. Continuing to observe...");
            });

            // Observe EVERYTHING about the conversation item
            STATE.titleObserver.observe(conversationItem, {
                childList: true,      // Watch for added/removed nodes
                attributes: true,     // Watch for attribute changes (style, display, etc)
                characterData: true,  // Watch for text content changes
                subtree: true,        // Watch the entire subtree
                attributeOldValue: true  // Track old attribute values
            });
            
            Logger.log(`Enhanced TITLE observer is now active for URL: ${expectedUrl}`);
        },

        /**
         * Attempts to capture the title and save the history entry if successful
         */
        attemptTitleCaptureAndSave: function (item, expectedUrl, timestamp, model) {
            // Check if we are still on the page this observer was created for
            if (window.location.href !== expectedUrl) {
                Logger.warn(`URL changed from "${expectedUrl}" to "${window.location.href}" while waiting for title. Disconnecting TITLE observer.`);
                if (STATE.titleObserver) {
                    STATE.titleObserver.disconnect();
                    STATE.titleObserver = null;
                }
                return true; // Return true to indicate we should stop trying (observer is disconnected)
            }

            const title = this.extractTitleFromSidebarItem(item);
            Logger.log(`TITLE Check (URL: ${expectedUrl}): Extracted title: "${title}"`);

            if (title) { // Title is present and non-empty
                Logger.log(`Title found for ${expectedUrl}! Attempting to add history entry.`);
                if (STATE.titleObserver) {
                    Logger.log("Disconnecting TITLE observer after successful capture.");
                    STATE.titleObserver.disconnect();
                    STATE.titleObserver = null;
                }
                HistoryManager.addHistoryEntry(timestamp, expectedUrl, title, model);
                return true; // Indicate success, stop trying
            }
            return false; // Title not ready yet, continue trying
        }
    };

    /**
     * ==========================================
     * EVENT HANDLERS
     * ==========================================
     */
    const EventHandlers = {
        /**
         * Handles clicks on the send button to detect new chats
         */
        handleSendClick: function (event) {
            Logger.log("Click detected on body (capture phase). Target:", event.target);
            const sendButton = event.target.closest('button:has(mat-icon[data-mat-icon-name="send"]), button.send-button, button[aria-label*="Send"], button[data-test-id="send-button"]');

            if (sendButton) {
                Logger.log("Click target is (or is inside) a potential send button.");
                if (sendButton.getAttribute('aria-disabled') === 'true') {
                    Logger.log("Send button is disabled. Ignoring click.");
                    return;
                }
                Logger.log("Send button identified and is enabled.");
                const currentUrl = window.location.href;
                Logger.log(`Current URL at time of click: ${currentUrl}`);

                // Check if we are on the main app page (starting a NEW chat)
                if (currentUrl === CONFIG.BASE_URL) {
                    Logger.log("URL matches GEMINI_APP_URL. This is potentially a new chat.");
                    STATE.isNewChatPending = true;
                    Logger.log("Set isNewChatPending = true");
                    STATE.pendingModelName = ModelDetector.getCurrentModelName(); // Capture model before navigating
                    Logger.log(`Captured pending model name: "${STATE.pendingModelName}"`);

                    // Use setTimeout to ensure observation starts after the click event potentially triggers initial DOM changes
                    setTimeout(() => {
                        Logger.log("Initiating sidebar observation via setTimeout.");
                        DomObserver.observeSidebarForNewChat();
                    }, 50); // Small delay
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
        document.body.addEventListener('click', EventHandlers.handleSendClick, true); // Use capture phase

        // Register menu command for export
        Logger.log("Registering export menu command...");
        GM_registerMenuCommand("Export Gemini Chat History to JSON", HistoryManager.exportToJson.bind(HistoryManager));

        Logger.log("Gemini History Manager initialization complete.");
    }

    // Start the script
    init();
})();