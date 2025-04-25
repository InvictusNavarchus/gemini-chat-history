// ==UserScript==
// @name         Gemini Chat History Manager
// @namespace    https://github.com/InvictusNavarchus/gemini-chat-history
// @downloadURL  https:///raw.githubusercontent.com/InvictusNavarchus/gemini-chat-history/master/gemini-chat-history.user.js
// @updateURL    https:///raw.githubusercontent.com/InvictusNavarchus/gemini-chat-history/master/gemini-chat-history.user.js
// @version      0.2.0
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

    const HISTORY_STORAGE_KEY = 'geminiChatHistory';
    const JAKARTA_TIMEZONE = 'Asia/Jakarta';
    const GEMINI_APP_URL = 'https://gemini.google.com/app';
    const LOG_PREFIX = "[Gemini History]"; // Consistent prefix for logs

    let isNewChatPending = false;
    let pendingModelName = null;
    let sidebarObserver = null; // To hold the MutationObserver instance

    // --- Logging Helpers ---
    function log(...args) {
        console.log(LOG_PREFIX, ...args);
    }
    function warn(...args) {
        console.warn(LOG_PREFIX, ...args);
    }
    function error(...args) {
        console.error(LOG_PREFIX, ...args);
    }

    log("Script loading...");

    // --- Model Definitions ---
    const modelNames = {
        '2.0 Flash': '2.0 Flash',
        '2.5 Flash': '2.5 Flash',
        '2.5 Pro': '2.5 Pro',
        'Deep Research': 'Deep Research',
        // Add more specific model names as they appear in the UI
    };

    // --- Helper Functions ---

    function getCurrentJakartaTimestamp() {
        try {
            const now = new Date();
            const options = {
                timeZone: JAKARTA_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
            };
            const formatter = new Intl.DateTimeFormat('en-CA', options);
            const parts = formatter.formatToParts(now).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
            const yyyy = parts.year; const mm = String(parts.month).padStart(2, '0'); const dd = String(parts.day).padStart(2, '0');
            const hh = String(parts.hour).padStart(2, '0'); const MM = String(parts.minute).padStart(2, '0'); const ss = String(parts.second).padStart(2, '0');
            const timestamp = `${yyyy}-${mm}-${dd}T${hh}:${MM}:${ss}`;
            // log("Generated Timestamp:", timestamp); // Uncomment for very detailed logging
            return timestamp;
        } catch (e) {
            error("Error getting Jakarta Time timestamp:", e);
            return new Date().toISOString(); // Fallback
        }
    }

    function getCurrentModelName() {
        log("Attempting to get current model name...");
        let rawText = null;
        let foundVia = null;

        // Try #1: New button structure
        const modelButton = document.querySelector('button.gds-mode-switch-button.mat-mdc-button-base .logo-pill-label-container span');
        if (modelButton && modelButton.textContent) {
            rawText = modelButton.textContent.trim();
            foundVia = "New Button Structure";
            log(`Model raw text found via ${foundVia}: "${rawText}"`);
        } else {
            log("Model not found via New Button Structure.");
            // Try #2: data-test-id
            const modelElement = document.querySelector('bard-mode-switcher [data-test-id="attribution-text"] span');
            if (modelElement && modelElement.textContent) {
                rawText = modelElement.textContent.trim();
                foundVia = "Data-Test-ID";
                log(`Model raw text found via ${foundVia}: "${rawText}"`);
            } else {
                log("Model not found via Data-Test-ID.");
                // Try #3: Fallback selector
                const fallbackElement = document.querySelector('.current-mode-title span');
                if (fallbackElement && fallbackElement.textContent) {
                    rawText = fallbackElement.textContent.trim();
                    foundVia = "Fallback Selector (.current-mode-title)";
                    log(`Model raw text found via ${foundVia}: "${rawText}"`);
                } else {
                    log("Model not found via Fallback Selector.");
                }
            }
        }

        if (rawText) {
            const sortedKeys = Object.keys(modelNames).sort((a, b) => b.length - a.length);
            for (const key of sortedKeys) {
                if (rawText.startsWith(key)) {
                    const model = modelNames[key];
                    log(`Matched known model: "${model}" from raw text "${rawText}"`);
                    return model;
                }
            }
            log(`Raw text "${rawText}" didn't match known prefixes, using raw text as model name.`);
            return rawText; // Return raw text if no prefix matches
        }

        warn("Could not determine current model name from any known selector.");
        return 'Unknown';
    }

    function loadHistory() {
        log("Loading history from storage...");
        const storedData = GM_getValue(HISTORY_STORAGE_KEY, '[]');
        try {
            const history = JSON.parse(storedData);
            if (Array.isArray(history)) {
                log(`History loaded successfully. Found ${history.length} entries.`);
                return history;
            } else {
                warn("Stored history data is not an array. Returning empty history.");
                return [];
            }
        } catch (e) {
            error("Error parsing stored history:", e, "Stored data was:", storedData);
            return []; // Return empty array on error
        }
    }

    function saveHistory(history) {
        log(`Attempting to save history with ${history.length} entries...`);
        if (!Array.isArray(history)) {
            error("Attempted to save non-array data. Aborting save.");
            return;
        }
        try {
            GM_setValue(HISTORY_STORAGE_KEY, JSON.stringify(history));
            log("History saved successfully.");
        } catch (e) {
            error("Error saving history:", e);
        }
    }

    function addHistoryEntry(timestamp, url, title, model) {
        log("Attempting to add history entry:", { timestamp, url, title, model });

        // Basic validation
        if (!timestamp || !url || !title || !model) {
            warn("Attempted to add entry with missing data. Skipping.", { timestamp, url, title, model });
            return false; // Indicate failure
        }
        // Prevent adding entry if URL is still the base app URL or invalid
        if (url === GEMINI_APP_URL || !url.includes('/app/c_')) {
            warn("Attempted to add entry with base app URL or invalid chat URL. Skipping.", url);
            return false; // Indicate failure
        }

        const history = loadHistory();

        // Prevent duplicates based on URL
        if (history.some(entry => entry.url === url)) {
            log("Duplicate URL detected, skipping entry:", url);
            return false; // Indicate failure (or already added)
        }

        history.unshift({ timestamp, url, title, model }); // Add to beginning
        saveHistory(history);
        log("Successfully added history entry.");
        return true; // Indicate success
    }

    function extractTitleFromSidebarItem(conversationItem) {
        log("Attempting to extract title from sidebar item:", conversationItem);
        const titleElement = conversationItem.querySelector('.conversation-title.gds-body-m');
        if (titleElement) {
            log("Found title element:", titleElement);
            try {
                // Clone the node to avoid modifying the live DOM while getting text
                const titleClone = titleElement.cloneNode(true);
                const coverElement = titleClone.querySelector('.conversation-title-cover');
                if (coverElement) {
                    log("Found and removing title cover element.");
                    coverElement.remove();
                } else {
                    log("No title cover element found inside title element.");
                }
                const title = titleClone.textContent.trim();
                log(`Extracted title: "${title}"`);
                return title;
            } catch (e) {
                error("Error during title extraction:", e);
                return null;
            }
        }
        warn("Could not find title element (.conversation-title.gds-body-m) within conversation item.");
        return null;
    }

    function observeSidebarForNewChat() {
        const targetSelector = 'conversations-list[data-test-id="all-conversations"]';
        const conversationListElement = document.querySelector(targetSelector);

        if (!conversationListElement) {
            warn(`Could not find conversation list element ("${targetSelector}") to observe. Aborting observation setup.`);
            isNewChatPending = false; // Reset flag if we can't observe
            pendingModelName = null;
            return;
        }

        log("Found conversation list element. Setting up sidebar observer...");

        // Disconnect previous observer if exists
        if (sidebarObserver) {
            log("Disconnecting previous sidebar observer.");
            sidebarObserver.disconnect();
            sidebarObserver = null;
        }

        sidebarObserver = new MutationObserver((mutationsList, observer) => {
            log(`Sidebar Observer Callback Triggered. ${mutationsList.length} mutations.`);
            const currentUrl = window.location.href;
            log(`Current URL inside observer: ${currentUrl}`);

            // Check if the URL has changed from /app to a specific chat URL
            if (currentUrl === GEMINI_APP_URL || !currentUrl.includes('/app/c_')) {
                log("URL is still base or invalid. Waiting for URL change before processing sidebar mutations.");
                return; // Ignore sidebar changes until URL is correct
            }

            log("URL check passed. Processing mutations...");
            for (const mutation of mutationsList) {
                //log("Mutation details:", mutation); // Uncomment for extreme detail
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    log(`Mutation type is childList with ${mutation.addedNodes.length} added node(s).`);
                    for (const node of mutation.addedNodes) {
                        //log("Checking added node:", node); // Uncomment for extreme detail
                        if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('conversation-items-container')) {
                            log("Found added node matching 'conversation-items-container'. Searching for conversation item inside...");
                            const conversationItem = node.querySelector('div[data-test-id="conversation"]');
                            if (conversationItem) {
                                log("Found conversation item (div[data-test-id='conversation']) inside container.");
                                const title = extractTitleFromSidebarItem(conversationItem);
                                const timestamp = getCurrentJakartaTimestamp();
                                const url = window.location.href; // Re-check URL just in case

                                log("Checking conditions for adding history entry:", { title, pendingModelName, url });

                                if (title && pendingModelName && url !== GEMINI_APP_URL) {
                                    log("All conditions met. Attempting to add history entry...");
                                    const added = addHistoryEntry(timestamp, url, title, pendingModelName);

                                    if (added) {
                                        // --- Cleanup ---
                                        log("History entry added successfully. Cleaning up.");
                                        isNewChatPending = false;
                                        pendingModelName = null;
                                        observer.disconnect(); // Stop observing
                                        sidebarObserver = null; // Clear the observer instance variable
                                        log("Observer disconnected. Stopped watching sidebar for this new chat.");
                                        return; // Exit after handling the first new chat item
                                    } else {
                                        warn("addHistoryEntry indicated failure (e.g., duplicate or validation). Not disconnecting observer yet.");
                                        // Might need more complex logic here if partial saves are possible, but for now we assume addHistoryEntry handles skips cleanly.
                                        // Resetting flags might be risky if addHistoryEntry fails unexpectedly.
                                        // isNewChatPending = false; // Consider if resetting flags here is safe
                                        // pendingModelName = null;
                                    }
                                } else {
                                    warn("Sidebar item added, but failed condition check (missing title, pending model, or wrong URL).", { titleExists: !!title, modelPending: !!pendingModelName, urlValid: url !== GEMINI_APP_URL });
                                }
                            } else {
                                log("Did not find conversation item (div[data-test-id='conversation']) inside the added container.");
                            }
                        }
                    }
                }
            }
        });

        sidebarObserver.observe(conversationListElement, {
            childList: true, // Watch for direct children being added/removed
            subtree: true    // Watch deeper descendants as well
        });
        log("Sidebar observer is now active.");
    }


    function handleSendClick(event) {
        log("Click detected on body (capture phase). Target:", event.target);
        const sendButton = event.target.closest('button:has(mat-icon[data-mat-icon-name="send"]), button.send-button, button[aria-label*="Send"], button[data-test-id="send-button"]');

        if (sendButton) {
            log("Click target is (or is inside) a potential send button.");
            if (sendButton.getAttribute('aria-disabled') === 'true') {
                log("Send button is disabled. Ignoring click.");
                return;
            }
            log("Send button identified and is enabled.");
            const currentUrl = window.location.href;
            log(`Current URL at time of click: ${currentUrl}`);

            // Check if we are on the main app page (starting a NEW chat)
            if (currentUrl === GEMINI_APP_URL) {
                log("URL matches GEMINI_APP_URL. This is potentially a new chat.");
                isNewChatPending = true;
                log("Set isNewChatPending = true");
                pendingModelName = getCurrentModelName(); // Capture model *before* navigating
                log(`Captured pending model name: "${pendingModelName}"`);

                // Use setTimeout to ensure observation starts after the click event potentially triggers initial DOM changes
                setTimeout(() => {
                    log("Initiating sidebar observation via setTimeout.");
                    observeSidebarForNewChat();
                }, 50); // Small delay
            } else {
                log("URL does not match GEMINI_APP_URL. Ignoring click for history tracking.");
            }
        } else {
            // This will log for *every* click not on the send button, potentially noisy.
            // log("Click target was not the send button.");
        }
    }


    function exportHistoryToJson() {
        log("Export command triggered.");
        const history = loadHistory();
        if (history.length === 0) {
            warn("No history found to export.");
            alert("Gemini History: No history found to export.");
            return;
        }

        log(`Exporting ${history.length} history entries.`);
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
            log(`Download initiated for file: ${filename}`);

            // Revoke the Blob URL after a short delay
            setTimeout(() => {
                URL.revokeObjectURL(url);
                log("Blob URL revoked.");
            }, 1000);

        } catch (e) {
            error("Error during JSON export process:", e);
            alert("Gemini History: An error occurred during export. Check the console (F12).");
        }
    }

    // --- Initialization ---
    log("Attaching main click listener to document body...");
    document.body.addEventListener('click', handleSendClick, true); // Use capture phase

    log("Registering export menu command...");
    GM_registerMenuCommand("Export Gemini Chat History to JSON", exportHistoryToJson);

    log("Gemini History Manager initialization complete.");

})();