// ==UserScript==
// @name         Gemini Chat History Manager
// @namespace    https://github.com/InvictusNavarchus/gemini-chat-history
// @downloadURL  https://raw.githubusercontent.com/InvictusNavarchus/gemini-chat-history/master/gemini-chat-history.user.js
// @updateURL    https://raw.githubusercontent.com/InvictusNavarchus/gemini-chat-history/master/gemini-chat-history.user.js
// @version      0.9.1
// @description  Tracks Gemini chat history (Timestamp, URL, Title, Model, Prompt, Files) and allows exporting to JSON
// @author       Invictus
// @match        https://gemini.google.com/*
// @icon         https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @require      https://cdn.jsdelivr.net/npm/@violentmonkey/dom@2 // For VM.observe
// ==/UserScript==

/**
 * Main script function that contains all the logic for the Gemini Chat History Manager.
 * Uses IIFE pattern to avoid polluting the global namespace.
 */
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
     * STATUS INDICATOR MODULE
     * ==========================================
     */
    const StatusIndicator = {
        element: null,
        timeout: null,
        DEFAULT_AUTO_HIDE: 3000, // Auto-hide after 3 seconds by default

        /**
         * Initializes the status indicator element in the DOM.
         * Creates the HTML structure and applies styles for the indicator.
         */
        init: function () {
            // Add CSS styles
            this.addStyles();

            // Create the indicator element
            const indicator = document.createElement('div');
            indicator.id = 'gemini-history-status';
            indicator.className = 'gemini-history-status hidden';

            // Create inner elements for icon and message
            const iconContainer = document.createElement('div');
            iconContainer.className = 'status-icon';

            const messageContainer = document.createElement('div');
            messageContainer.className = 'status-message';

            // Append elements
            indicator.appendChild(iconContainer);
            indicator.appendChild(messageContainer);
            document.body.appendChild(indicator);

            this.element = indicator;
            Logger.log("Status indicator initialized");
        },

        /**
         * Adds CSS styles for the status indicator to the document.
         * Includes animations, colors, and responsive styling.
         */
        addStyles: function () {
            GM_addStyle(`
                .gemini-history-status {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    display: flex;
                    align-items: center;
                    background: #1a1c25;
                    color: white;
                    padding: 10px 15px;
                    border-radius: 4px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.1);
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    font-size: 14px;
                    z-index: 10000;
                    transition: opacity 0.3s, transform 0.3s;
                    opacity: 1;
                    transform: translateY(0);
                }

                .gemini-history-status.hidden {
                    opacity: 0;
                    transform: translateY(10px);
                    pointer-events: none;
                }

                .status-icon {
                    width: 20px;
                    height: 20px;
                    margin-right: 10px;
                    position: relative;
                }

                .status-icon::before,
                .status-icon::after {
                    content: '';
                    position: absolute;
                }

                /* Info icon */
                .info .status-icon::before {
                    width: 20px;
                    height: 20px;
                    background: #3498db;
                    border-radius: 50%;
                }

                .info .status-icon::after {
                    content: 'i';
                    color: white;
                    font-style: italic;
                    font-weight: bold;
                    font-family: serif;
                    font-size: 14px;
                    left: 8px;
                    top: 0px;
                }

                /* Success icon */
                .success .status-icon::before {
                    width: 20px;
                    height: 20px;
                    background: #2ecc71;
                    border-radius: 50%;
                }

                .success .status-icon::after {
                    width: 6px;
                    height: 12px;
                    border-right: 2px solid white;
                    border-bottom: 2px solid white;
                    transform: rotate(45deg);
                    left: 7px;
                    top: 2px;
                }

                /* Warning icon */
                .warning .status-icon::before {
                    width: 0;
                    height: 0;
                    border-left: 10px solid transparent;
                    border-right: 10px solid transparent;
                    border-bottom: 18px solid #f39c12;
                    top: 1px;
                }

                .warning .status-icon::after {
                    content: '!';
                    color: white;
                    font-weight: bold;
                    font-size: 14px;
                    left: 8px;
                    top: 4px;
                }

                /* Error icon */
                .error .status-icon::before {
                    width: 20px;
                    height: 20px;
                    background: #e74c3c;
                    border-radius: 50%;
                }

                .error .status-icon::after {
                    content: '✕';
                    color: white;
                    font-size: 14px;
                    left: 5px;
                    top: 0px;
                }

                /* Loading icon */
                .loading .status-icon::before {
                    width: 16px;
                    height: 16px;
                    border: 2px solid #ccc;
                    border-top-color: #6e41e2;
                    border-radius: 50%;
                    left: 1px;
                    top: 1px;
                    animation: gemini-history-spin 0.8s linear infinite;
                }

                @keyframes gemini-history-spin {
                    to { transform: rotate(360deg); }
                }
            `);
        },

        /**
         * Shows the status indicator with a message.
         * 
         * @param {string} message - The message to display in the indicator
         * @param {string} type - Type of status: 'info', 'success', 'warning', 'error', or 'loading'
         * @param {number} autoHide - Time in ms after which to hide the indicator, or 0 to stay visible
         * @returns {Object} - Returns the StatusIndicator instance for chaining
         */
        show: function (message, type = 'info', autoHide = this.DEFAULT_AUTO_HIDE) {
            if (!this.element) {
                this.init();
            }

            // Clear any existing timeout
            if (this.timeout) {
                clearTimeout(this.timeout);
                this.timeout = null;
            }

            // Remove hidden class and set message
            this.element.classList.remove('hidden', 'info', 'success', 'warning', 'error', 'loading');
            this.element.classList.add(type);

            const messageEl = this.element.querySelector('.status-message');
            if (messageEl) {
                messageEl.textContent = message;
            }

            // Auto-hide after specified delay if greater than 0
            if (autoHide > 0) {
                this.timeout = setTimeout(() => {
                    this.hide();
                }, autoHide);
            }

            return this;
        },

        /**
         * Updates the message and type of an existing indicator.
         * Resets auto-hide timeout if specified.
         * 
         * @param {string} message - The new message to display
         * @param {string|null} type - New type of status, or null to keep current type
         * @param {number} autoHide - Time in ms after which to hide the indicator, or 0 to stay visible
         * @returns {Object} - Returns the StatusIndicator instance for chaining
         */
        update: function (message, type = null, autoHide = this.DEFAULT_AUTO_HIDE) {
            if (!this.element) return this;

            // Update message
            const messageEl = this.element.querySelector('.status-message');
            if (messageEl) {
                messageEl.textContent = message;
            }

            // Update type if specified
            if (type) {
                this.element.classList.remove('info', 'success', 'warning', 'error', 'loading');
                this.element.classList.add(type);
            }

            // Reset auto-hide timeout
            if (this.timeout) {
                clearTimeout(this.timeout);
                this.timeout = null;
            }

            if (autoHide > 0) {
                this.timeout = setTimeout(() => {
                    this.hide();
                }, autoHide);
            }

            return this;
        },

        /**
         * Hides the status indicator by adding the 'hidden' class.
         * Clears any existing timeout.
         */
        hide: function () {
            if (!this.element) return;

            this.element.classList.add('hidden');

            if (this.timeout) {
                clearTimeout(this.timeout);
                this.timeout = null;
            }
        }
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
        /**
         * Logs a standard message to the console with the script's prefix.
         * 
         * @param {...*} args - Arguments to log
         */
        log: (...args) => console.log(CONFIG.LOG_PREFIX, ...args),

        /**
         * Logs a warning message to the console with the script's prefix.
         * 
         * @param {...*} args - Arguments to log as warning
         */
        warn: (...args) => console.warn(CONFIG.LOG_PREFIX, ...args),

        /**
         * Logs an error message to the console with the script's prefix.
         * 
         * @param {...*} args - Arguments to log as error
         */
        error: (...args) => console.error(CONFIG.LOG_PREFIX, ...args)
    };

    /**
     * ==========================================
     * UTILITY FUNCTIONS
     * ==========================================
     */
    const Utils = {
        /**
         * Gets the current timestamp formatted according to the configured timezone.
         * Uses Intl.DateTimeFormat for proper timezone handling.
         * 
         * @returns {string} - Formatted timestamp string in ISO-like format (YYYY-MM-DDTHH:MM:SS)
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
         * Determines if a URL is a valid Gemini chat URL.
         * Valid URLs follow the pattern: https://gemini.google.com/app/[hexadecimal-id]
         * 
         * @param {string} url - The URL to check
         * @returns {boolean} - True if the URL matches the expected pattern for a Gemini chat
         */
        isValidChatUrl: function (url) {
            const chatUrlPattern = /^https:\/\/gemini\.google\.com\/app\/[a-f0-9]+$/;
            return chatUrlPattern.test(url);
        },

        /**
         * Determines if a URL is the base Gemini app URL (with potential parameters).
         * The base URL is used for starting new chats.
         * 
         * @param {string} url - The URL to check
         * @returns {boolean} - True if the URL is the base app URL (with or without parameters)
         */
        isBaseAppUrl: function (url) {
            // Check if URL starts with base URL, followed by end of string or a question mark (for parameters)
            return url === CONFIG.BASE_URL || url.startsWith(CONFIG.BASE_URL + '?');
        }
    };

    /**
     * ==========================================
     * MODEL DETECTION MODULE
     * ==========================================
     */
    const ModelDetector = {
        /**
         * Attempts to detect the currently selected Gemini model from the UI.
         * Tries multiple selector strategies to find the model name.
         * 
         * @returns {string} - The detected model name or 'Unknown' if not found
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
         * 
         * @returns {string} - The extracted prompt text or empty string if not found
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
         * Extracts the filenames of attached files from the UI.
         * 
         * @returns {string[]} - Array of filenames (strings) or empty array if none found
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
         * 
         * @returns {Object} - Object with name and email properties
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
         * Loads chat history from GM storage.
         * 
         * @returns {Array} - Array of history entries or empty array if none found or on error
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
                StatusIndicator.show("Error loading chat history", "error");
                return []; // Return empty array on error
            }
        },

        /**
         * Saves chat history to GM storage.
         * 
         * @param {Array} history - Array of history entries to save
         */
        saveHistory: function (history) {
            Logger.log(`Attempting to save history with ${history.length} entries...`);
            if (!Array.isArray(history)) {
                Logger.error("Attempted to save non-array data. Aborting save.");
                StatusIndicator.show("Error saving history data", "error");
                return;
            }
            try {
                GM_setValue(CONFIG.STORAGE_KEY, JSON.stringify(history));
                Logger.log("History saved successfully.");
            } catch (e) {
                Logger.error("Error saving history:", e);
                StatusIndicator.show("Error saving chat history", "error");
            }
        },

        /**
         * Adds a new entry to the chat history.
         * Validates input data and prevents duplicates based on URL.
         * 
         * @param {string} timestamp - ISO-formatted timestamp for the chat
         * @param {string} url - URL of the chat
         * @param {string} title - Title of the chat
         * @param {string} model - Model name used for the chat
         * @param {string} prompt - User prompt text
         * @param {Array} attachedFiles - Array of attached filenames
         * @param {string} accountName - Name of the user account
         * @param {string} accountEmail - Email of the user account
         * @returns {boolean} - True if entry was added, false if validation failed or duplicate detected
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
                StatusIndicator.show("Chat history entry incomplete", "warning");
                return false; // Indicate failure
            }

            // Prevent adding entry if URL is invalid
            if (!Utils.isValidChatUrl(url)) {
                Logger.warn(`Attempted to add entry with invalid chat URL pattern "${url}". Skipping.`);
                StatusIndicator.show("Invalid chat URL", "warning");
                return false; // Indicate failure
            }

            const history = this.loadHistory();

            // Prevent duplicates based on URL
            if (history.some(entry => entry.url === url)) {
                Logger.log("Duplicate URL detected, skipping entry:", url);
                StatusIndicator.show("Chat already in history", "info");
                return false; // Indicate failure (or already added)
            }

            history.unshift(entryData); // Add to beginning
            this.saveHistory(history);
            Logger.log("Successfully added history entry.");
            StatusIndicator.show(`Chat "${title}" saved to history`, "success");
            return true; // Indicate success
        },

        /**
         * Exports history to JSON file for download.
         * Creates a downloadable file with the history data.
         */
        exportToJson: function () {
            Logger.log("Export command triggered.");
            StatusIndicator.show("Preparing history export...", "loading", 0);

            const history = this.loadHistory();
            if (history.length === 0) {
                Logger.warn("No history found to export.");
                StatusIndicator.show("No history found to export", "warning");
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

                StatusIndicator.update(`Exporting ${history.length} chat entries...`, "loading");
                link.click();

                document.body.removeChild(link);
                Logger.log(`Download initiated for file: ${filename}`);
                StatusIndicator.update(`${history.length} chats exported successfully`, "success");

                // Revoke the Blob URL after a short delay
                setTimeout(() => {
                    URL.revokeObjectURL(url);
                    Logger.log("Blob URL revoked.");
                }, 1000);
            } catch (e) {
                Logger.error("Error during JSON export process:", e);
                StatusIndicator.show("Export failed", "error");
                alert("Gemini History: An error occurred during export. Check the console (F12).");
            }
        },

        /**
         * Views history as JSON in a new browser tab.
         * Opens a new tab with the JSON data for viewing.
         */
        viewHistoryJson: function () {
            Logger.log("View JSON command triggered.");
            StatusIndicator.show("Opening history view...", "loading", 0);

            const history = this.loadHistory();
            if (history.length === 0) {
                Logger.warn("No history found to view.");
                StatusIndicator.show("No history found to view", "warning");
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
                StatusIndicator.update(`Viewing ${history.length} chat entries`, "success");

                // Revoke the Blob URL after a longer delay (user might need time to view)
                setTimeout(() => {
                    URL.revokeObjectURL(url);
                    Logger.log("Blob URL revoked.");
                }, 60000); // 1 minute delay to ensure user has time to view
            } catch (e) {
                Logger.error("Error during JSON view process:", e);
                StatusIndicator.show("Failed to view history", "error");
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
         * Helper function to disconnect an observer and set its reference to null.
         * 
         * @param {MutationObserver} observer - The observer to disconnect
         * @returns {null} - Always returns null to clear the reference
         */
        cleanupObserver: function (observer) {
            if (observer) {
                observer.disconnect();
                return null;
            }
            return observer;
        },

        /**
         * Watches for the sidebar element to appear in the DOM.
         * Calls the provided callback once the sidebar is found.
         * 
         * @param {function} callback - Function to call once the sidebar is found
         */
        watchForSidebar: function (callback) {
            Logger.log("Starting to watch for sidebar element...");
            // Show immediate loading status at the beginning
            StatusIndicator.show("Looking for Gemini sidebar...", "loading", 0);

            // First check if the sidebar already exists
            const sidebarSelector = 'conversations-list[data-test-id="all-conversations"]';
            const existingSidebar = document.querySelector(sidebarSelector);

            if (existingSidebar) {
                Logger.log("Sidebar already exists in DOM");
                callback(existingSidebar);
                return;
            }

            // If not, set up an observer to watch for it
            Logger.log("Sidebar not found. Setting up observer to watch for it...");

            const observer = new MutationObserver((mutations, obs) => {
                const sidebar = document.querySelector(sidebarSelector);
                if (sidebar) {
                    Logger.log("Sidebar element found in DOM");
                    obs.disconnect(); // Stop observing once found
                    callback(sidebar);
                }
            });

            // Start observing document body for the sidebar element
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            // Set a timeout for the case when the sidebar doesn't appear
            setTimeout(() => {
                if (observer) {
                    const sidebar = document.querySelector(sidebarSelector);
                    if (!sidebar) {
                        Logger.warn("Sidebar element not found after timeout");
                        StatusIndicator.show("Warning: Gemini sidebar not detected", "warning", 0);
                    }
                    observer.disconnect();
                }
            }, 10000); // 10 second timeout
        },

        /**
         * Extracts the title from a sidebar conversation item.
         * 
         * @param {Element} conversationItem - The DOM element representing a conversation item
         * @returns {string|null} - The extracted title or null if not found
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
         * Finds a conversation item in a mutation list.
         * 
         * @param {MutationRecord[]} mutationsList - List of mutation records from MutationObserver
         * @returns {Element|null} - The found conversation item element or null if not found
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
         * Captures context information for a new conversation.
         * Retrieves current state information to associate with a new chat.
         * 
         * @returns {Object} - Object containing context details for the conversation
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
         * Handles the processing of mutations for the sidebar observer.
         * 
         * @param {MutationRecord[]} mutationsList - List of mutation records from MutationObserver
         * @returns {boolean} - True if processing was completed, false otherwise
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
                StatusIndicator.show("New chat detected, capturing details...", "loading", 0);

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
         * Sets up observation of the sidebar to detect new chats.
         */
        observeSidebarForNewChat: function () {
            const targetSelector = 'conversations-list[data-test-id="all-conversations"]';
            const conversationListElement = document.querySelector(targetSelector);

            if (!conversationListElement) {
                Logger.warn(`Could not find conversation list element ("${targetSelector}") to observe. Aborting observation setup.`);
                StatusIndicator.show("Could not track chat (UI element not found)", "warning");
                STATE.isNewChatPending = false; // Reset flag
                STATE.pendingModelName = null;
                STATE.pendingPrompt = null;
                STATE.pendingAttachedFiles = [];
                STATE.pendingAccountName = null;
                STATE.pendingAccountEmail = null;
                return;
            }

            Logger.log("Found conversation list element. Setting up MAIN sidebar observer...");
            StatusIndicator.show("Tracking new chat...", "info");

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
         * Helper function to process title and add history entry.
         * 
         * @param {string} title - The extracted title
         * @param {string} expectedUrl - The URL associated with this conversation
         * @param {string} timestamp - ISO-formatted timestamp for the chat
         * @param {string} model - Model name used for the chat
         * @param {string} prompt - User prompt text
         * @param {Array} attachedFiles - Array of attached filenames
         * @param {string} accountName - Name of the user account
         * @param {string} accountEmail - Email of the user account
         * @returns {boolean} - True if title was found and entry was added, false otherwise
         */
        processTitleAndAddHistory: function (title, expectedUrl, timestamp, model, prompt, attachedFiles, accountName, accountEmail) {
            if (title) {
                Logger.log(`Title found for ${expectedUrl}! Attempting to add history entry.`);
                StatusIndicator.update(`Found chat title: "${title}"`, "success", 0);
                STATE.titleObserver = this.cleanupObserver(STATE.titleObserver);

                const success = HistoryManager.addHistoryEntry(
                    timestamp, expectedUrl, title, model, prompt,
                    attachedFiles, accountName, accountEmail
                );

                if (!success) {
                    StatusIndicator.update("Chat not saved (already exists or invalid)", "info");
                }

                return true;
            }
            return false;
        },

        /**
         * Process mutations for title changes.
         * 
         * @param {Element} conversationItem - The conversation item DOM element
         * @param {string} expectedUrl - The URL associated with this conversation
         * @param {string} timestamp - ISO-formatted timestamp for the chat
         * @param {string} model - Model name used for the chat
         * @param {string} prompt - User prompt text
         * @param {Array} attachedFiles - Array of attached filenames
         * @param {string} accountName - Name of the user account
         * @param {string} accountEmail - Email of the user account
         * @returns {boolean} - True if processing completed (URL changed or title found), false otherwise
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
         * Sets up observation of a specific conversation item to capture its title once available.
         * 
         * @param {Element} conversationItem - The conversation item DOM element
         * @param {string} expectedUrl - The URL associated with this conversation
         * @param {string} timestamp - ISO-formatted timestamp for the chat
         * @param {string} model - Model name used for the chat
         * @param {string} prompt - User prompt text
         * @param {Array} attachedFiles - Array of attached filenames
         * @param {string} accountName - Name of the user account
         * @param {string} accountEmail - Email of the user account
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
         * Attempts to capture the title and save the history entry if successful.
         * 
         * @param {Element} item - The conversation item DOM element
         * @param {string} expectedUrl - The URL associated with this conversation
         * @param {string} timestamp - ISO-formatted timestamp for the chat
         * @param {string} model - Model name used for the chat
         * @param {string} prompt - User prompt text
         * @param {Array} attachedFiles - Array of attached filenames
         * @param {string} accountName - Name of the user account
         * @param {string} accountEmail - Email of the user account
         * @returns {boolean} - True if title was found and entry was added, false otherwise
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
         * Checks if the target is a valid send button.
         * 
         * @param {Element} target - The DOM element that was clicked
         * @returns {Element|false} - The send button element if found and valid, false otherwise
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
         * Prepares for tracking a new chat.
         * Captures necessary information before the chat is created.
         */
        prepareNewChatTracking: function () {
            Logger.log("URL matches GEMINI_APP_URL. This is potentially a new chat.");
            STATE.isNewChatPending = true;
            Logger.log("Set isNewChatPending = true");

            StatusIndicator.show("Preparing to track new chat...", "loading", 0);

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

            StatusIndicator.update(`Capturing chat with ${STATE.pendingModelName}...`, "info");

            // Use setTimeout to ensure observation starts after the click event potentially triggers initial DOM changes
            setTimeout(() => {
                Logger.log("Initiating sidebar observation via setTimeout.");
                DomObserver.observeSidebarForNewChat();
            }, 50); // Small delay
        },

        /**
         * Handles clicks on the send button to detect new chats.
         * Uses capture phase to intercept clicks before they're processed.
         * 
         * @param {Event} event - The click event
         */
        handleSendClick: function (event) {
            Logger.log("Click detected on body (capture phase). Target:", event.target);
            const sendButton = this.isSendButton(event.target);

            if (sendButton) {
                Logger.log("Click target is (or is inside) a potential send button.");
                const currentUrl = window.location.href;
                Logger.log(`Current URL at time of click: ${currentUrl}`);

                // Check if we are on the main app page (starting a NEW chat)
                if (Utils.isBaseAppUrl(currentUrl)) {
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

    /**
     * Initializes the script.
     * Sets up observers, event listeners, and menu commands.
     */
    function init() {
        Logger.log("Gemini History Manager initializing...");

        // Initialize status indicator
        StatusIndicator.init();

        // Show immediate status message that persists until sidebar is found (or timeout)
        StatusIndicator.show("Waiting for Gemini sidebar to appear...", "loading", 0);

        // Watch for sidebar to appear before showing ready status
        DomObserver.watchForSidebar((sidebar) => {
            Logger.log("Sidebar confirmed available. Manager fully active.");
            StatusIndicator.show("Gemini History Manager active", "success");
        });

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