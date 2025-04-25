// ==UserScript==
// @name         Gemini Chat History Manager
// @namespace    https://github.com/InvictusNavarchus/gemini-chat-history
// @downloadURL  https:///raw.githubusercontent.com/InvictusNavarchus/gemini-chat-history/master/gemini-chat-history.user.js
// @updateURL    https:///raw.githubusercontent.com/InvictusNavarchus/gemini-chat-history/master/gemini-chat-history.user.js
// @version      0.1.0
// @description  Tracks Gemini chat history (Timestamp, URL, Title, Model) and allows exporting to JSON.
// @author       Invictus
// @match        https://gemini.google.com/*
// @icon         https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @require      https://cdn.jsdelivr.net/npm/@violentmonkey/dom@2 // For VM.observe
// ==/UserScript==

(function() {
    'use strict';

    const HISTORY_STORAGE_KEY = 'geminiChatHistory';
    const JAKARTA_TIMEZONE = 'Asia/Jakarta';
    const GEMINI_APP_URL = 'https://gemini.google.com/app';

    let isNewChatPending = false;
    let pendingModelName = null;
    let sidebarObserver = null; // To hold the MutationObserver instance

    // --- Model Definitions ---
    const modelNames = {
        '2.0 Flash': '2.0 Flash',
        '2.5 Flash': '2.5 Flash',
        '2.5 Pro': '2.5 Pro',
        'Deep Research': 'Deep Research',
        // Add more specific model names as they appear in the UI
    };

    // --- Helper Functions ---

    /**
     * Gets the current timestamp formatted for Asia/Jakarta timezone (ISO 8601 format).
     * @returns {string} Formatted timestamp string.
     */
    function getCurrentJakartaTimestamp() {
        try {
            const now = new Date();
            // Using options that generally lead to an ISO-like format suitable for sorting
            const options = {
                timeZone: JAKARTA_TIMEZONE,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false // Use 24-hour format
            };
            // Intl.DateTimeFormat can have locale-specific separators, manually assemble
            const formatter = new Intl.DateTimeFormat('en-CA', options); // en-CA gives YYYY-MM-DD
            const parts = formatter.formatToParts(now).reduce((acc, part) => {
                acc[part.type] = part.value;
                return acc;
            }, {});

            // Ensure leading zeros where needed (though '2-digit' usually handles this)
             const yyyy = parts.year;
             const mm = parts.month.padStart(2, '0');
             const dd = parts.day.padStart(2, '0');
             const hh = parts.hour.padStart(2, '0');
             const MM = parts.minute.padStart(2, '0');
             const ss = parts.second.padStart(2, '0');

            // Construct ISO-like format (close enough for sorting and readability)
            return `${yyyy}-${mm}-${dd}T${hh}:${MM}:${ss}`;

        } catch (e) {
            console.error("Gemini History: Error getting Jakarta Time timestamp.", e);
            // Fallback to local ISO string (less ideal but better than nothing)
            return new Date().toISOString();
        }
    }

    /**
     * Gets the current model name from the UI.
     * Adapted from your gemini usage tracker script.
     * @returns {string | null} Standardized model name or null if not found.
     */
    function getCurrentModelName() {
        // Try finding the model name using the new mat-flat-button structure first
        const modelButton = document.querySelector('button.gds-mode-switch-button.mat-mdc-button-base .logo-pill-label-container span');
        let rawText = null;

        if (modelButton && modelButton.textContent) {
            rawText = modelButton.textContent.trim();
        } else {
            // Try the previous selector (data-test-id)
            const modelElement = document.querySelector('bard-mode-switcher [data-test-id="attribution-text"] span');

            if (modelElement && modelElement.textContent) {
                rawText = modelElement.textContent.trim();
            } else {
                // Fallback selector (less reliable, might change)
                const fallbackElement = document.querySelector('.current-mode-title span');
                if (fallbackElement && fallbackElement.textContent) {
                    rawText = fallbackElement.textContent.trim();
                }
            }
        }

        if (rawText) {
            // Sort keys by length descending to match longest first
            const sortedKeys = Object.keys(modelNames).sort((a, b) => b.length - a.length);

            for (const key of sortedKeys) {
                if (rawText.startsWith(key)) {
                    return modelNames[key]; // Return the standardized name for the longest match
                }
            }
            // Fallback if no specific match startsWith, maybe it's a new model
            console.log(`Gemini History: Model text "${rawText}" didn't match known prefixes, using raw text.`);
            return rawText; // Return the raw text as a potential new model name
        }

        console.warn("Gemini History: Could not determine current model name.");
        return 'Unknown'; // Indicate failure to find the model but provide a default
    }

    /**
     * Loads chat history from storage.
     * @returns {Array<Object>} Array of history entries.
     */
    function loadHistory() {
        const storedData = GM_getValue(HISTORY_STORAGE_KEY, '[]');
        try {
            const history = JSON.parse(storedData);
            return Array.isArray(history) ? history : [];
        } catch (e) {
            console.error("Gemini History: Error parsing stored history.", e);
            return []; // Return empty array on error
        }
    }

    /**
     * Saves chat history to storage.
     * @param {Array<Object>} history Array of history entries.
     */
    function saveHistory(history) {
        if (!Array.isArray(history)) {
            console.error("Gemini History: Attempted to save non-array data.");
            return;
        }
        try {
            GM_setValue(HISTORY_STORAGE_KEY, JSON.stringify(history));
        } catch (e) {
            console.error("Gemini History: Error saving history.", e);
        }
    }

    /**
     * Adds a new entry to the chat history.
     * @param {string} timestamp
     * @param {string} url
     * @param {string} title
     * @param {string} model
     */
    function addHistoryEntry(timestamp, url, title, model) {
        // Basic validation
        if (!timestamp || !url || !title || !model) {
            console.warn("Gemini History: Attempted to add entry with missing data.", { timestamp, url, title, model });
            return;
        }
        // Prevent adding entry if URL is still the base app URL
         if (url === GEMINI_APP_URL || !url.includes('/app/c_')) {
             console.warn("Gemini History: Attempted to add entry with base app URL or invalid chat URL.", url);
             return;
         }


        const history = loadHistory();

        // Optional: Prevent duplicates based on URL (might happen with rapid clicks/updates)
        if (history.some(entry => entry.url === url)) {
            console.log("Gemini History: Duplicate URL detected, skipping entry:", url);
            return;
        }

        history.unshift({ // Add to the beginning for recent first
            timestamp: timestamp,
            url: url,
            title: title,
            model: model
        });
        saveHistory(history);
        console.log("Gemini History: Added entry -", { timestamp, url, title, model });
    }


    /**
     * Extracts the title from a conversation list item element.
     * @param {Element} conversationItem The DIV element with data-test-id="conversation".
     * @returns {string | null} The trimmed title or null if not found.
     */
    function extractTitleFromSidebarItem(conversationItem) {
        const titleElement = conversationItem.querySelector('.conversation-title.gds-body-m');
        if (titleElement) {
             // Clone the node to avoid modifying the live DOM while getting text
            const titleClone = titleElement.cloneNode(true);
            const coverElement = titleClone.querySelector('.conversation-title-cover');
            if (coverElement) {
                coverElement.remove(); // Remove the cover div if it exists
            }
            return titleClone.textContent.trim();
        }
        console.warn("Gemini History: Could not find title element within conversation item.");
        return null;
    }

    /**
    * Sets up the MutationObserver to watch the sidebar for new chat entries.
    */
    function observeSidebarForNewChat() {
        const conversationListElement = document.querySelector('conversations-list[data-test-id="all-conversations"]');
        if (!conversationListElement) {
            console.warn("Gemini History: Could not find conversation list element to observe.");
            isNewChatPending = false; // Reset flag if we can't observe
            pendingModelName = null;
            return;
        }

        console.log("Gemini History: Observing sidebar for new chat entry...");

        // Disconnect previous observer if exists
        if (sidebarObserver) {
             sidebarObserver.disconnect();
             console.log("Gemini History: Disconnected previous sidebar observer.");
        }


        sidebarObserver = new MutationObserver((mutationsList, observer) => {
            // Check if the URL has changed from /app to a specific chat URL
             const currentUrl = window.location.href;
             if (currentUrl === GEMINI_APP_URL || !currentUrl.includes('/app/c_')) {
                 //console.log("Gemini History: Sidebar mutation detected, but URL is still base or invalid. Waiting.");
                 return; // URL hasn't changed to a chat URL yet, ignore sidebar changes
             }


            for (const mutation of mutationsList) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        // Check if the added node is the container for a conversation item
                        // The structure is often <div class="conversation-items-container ..."><div data-test-id="conversation" ...></div></div>
                        if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('conversation-items-container')) {
                             const conversationItem = node.querySelector('div[data-test-id="conversation"]');
                             if (conversationItem) {
                                console.log("Gemini History: New conversation item container added to sidebar.");
                                const title = extractTitleFromSidebarItem(conversationItem);
                                const timestamp = getCurrentJakartaTimestamp();
                                const url = window.location.href; // Get the URL *after* it has changed


                                if (title && pendingModelName && url !== GEMINI_APP_URL) {
                                    console.log("Gemini History: Found title and pending model. Adding history entry.");
                                    addHistoryEntry(timestamp, url, title, pendingModelName);

                                    // --- Cleanup ---
                                    isNewChatPending = false;
                                    pendingModelName = null;
                                    observer.disconnect(); // Stop observing once we've captured the new chat
                                    sidebarObserver = null; // Clear the observer instance variable
                                    console.log("Gemini History: Successfully captured new chat. Stopped observing sidebar.");
                                    return; // Exit after handling the first new chat item
                                } else {
                                     console.warn("Gemini History: Sidebar item added, but missing data or still on base URL.", { title, pendingModelName, url});
                                }
                            }
                        }
                    }
                }
            }
        });

        sidebarObserver.observe(conversationListElement, {
            childList: true, // Watch for direct children being added/removed
            subtree: true    // Watch deeper descendants as well (like the item inside the container)
        });
    }


    /**
     * Handles the click on the send button to initiate tracking if it's a new chat.
     */
    function handleSendClick(event) {
         // More specific selectors for the send button might be needed if the UI changes
         // Check for button containing the send icon or having a specific class/attribute
        const sendButton = event.target.closest('button:has(mat-icon[data-mat-icon-name="send"]), button.send-button, button[aria-label*="Send"], button[data-test-id="send-button"]');

        if (sendButton && sendButton.getAttribute('aria-disabled') !== 'true') {
            // Check if we are on the main app page (starting a NEW chat)
            if (window.location.href === GEMINI_APP_URL) {
                console.log("Gemini History: Send button clicked on main app page. Preparing to capture new chat.");
                isNewChatPending = true;
                pendingModelName = getCurrentModelName(); // Capture model *before* navigating

                // Start observing the sidebar *after* the click, expecting changes soon
                // Use setTimeout to ensure observation starts after the click event potentially triggers DOM changes
                 setTimeout(observeSidebarForNewChat, 50);
            } else {
                 // console.log("Gemini History: Send button clicked, but not on main app page. Ignoring.");
            }
        }
    }


    /**
     * Exports the chat history to a JSON file.
     */
    function exportHistoryToJson() {
        const history = loadHistory();
        if (history.length === 0) {
            alert("Gemini History: No history found to export.");
            return;
        }

        const jsonString = JSON.stringify(history, null, 2); // Pretty print JSON
        const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.setAttribute("href", url);
        // Generate filename with current date
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        link.setAttribute("download", `gemini_chat_history_${timestamp}.json`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Revoke the Blob URL after a short delay
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        console.log("Gemini History: Export initiated.");
    }

    // --- Initialization ---

    console.log("Gemini History Manager: Script loaded.");

    // Attach the primary event listener for the send button click
    // Use event delegation on the body
    document.body.addEventListener('click', handleSendClick, true); // Use capture phase to catch early

    // Add the export command to the Tampermonkey/Violentmonkey menu
    GM_registerMenuCommand("Export Gemini Chat History to JSON", exportHistoryToJson);

    // Initial check in case the script loads *after* a chat page is already open
    // This part is less critical for the *new chat* detection but good practice.
    // VM.observe(document.body, () => {
    //     const chatContainer = document.querySelector('chat-window');
    //     if (chatContainer) {
    //         console.log("Gemini History Manager: Chat UI detected.");
    //         // Potentially add logic here if needed when loading on an existing chat page
    //         return true; // Stop observing once UI is found
    //     }
    //     return false; // Continue observing
    // });

})();