// ==UserScript==
// @name         Gemini Chat History Manager
// @namespace    https://github.com/InvictusNavarchus/gemini-chat-history
// @downloadURL  https:///raw.githubusercontent.com/InvictusNavarchus/gemini-chat-history/master/gemini-chat-history.user.js
// @updateURL    https:///raw.githubusercontent.com/InvictusNavarchus/gemini-chat-history/master/gemini-chat-history.user.js
// @version      0.2.2
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
        const chatUrlPattern = /^https:\/\/gemini\.google\.com\/app\/[a-f0-9]+$/;
        if (!chatUrlPattern.test(url)) {
            warn(`Attempted to add entry with invalid chat URL pattern "${url}". Skipping.`);
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
            log("Found title container element:", titleElement);
            try {
                // Directly access the first child node, assuming it's the text node containing the title.
                if (titleElement.firstChild && titleElement.firstChild.nodeType === Node.TEXT_NODE) {
                    // nodeType 3 is Text node
                    const title = titleElement.firstChild.textContent.trim();
                    log(`Extracted title directly from firstChild text node: "${title}"`);

                    // Return the title only if it's not just whitespace
                    return title ? title : null;
                } else {
                    // Log if the assumption is wrong
                    warn("First child of title element is not a text node or is missing.");
                    if (titleElement.firstChild) {
                        warn(`First child nodeType is: ${titleElement.firstChild.nodeType}`);
                    }
                    // As a less reliable fallback, log the full textContent, but don't return it
                    // as it might contain the cover text or other unwanted content.
                    warn(`Logging full textContent as fallback diagnostic: "${titleElement.textContent.trim()}"`);
                    return null; // Indicate failure to find the specific title text node
                }

            } catch (e) {
                error("Error during direct title extraction:", e);
                return null;
            }
        }
        warn("Could not find title element (.conversation-title.gds-body-m) within conversation item.");
        return null;
    }

    // --- Global scope variable to hold the secondary observer ---
    let titleObserver = null;

    // --- observeSidebarForNewChat ---
    function observeSidebarForNewChat() {
        const targetSelector = 'conversations-list[data-test-id="all-conversations"]';
        const conversationListElement = document.querySelector(targetSelector);

        if (!conversationListElement) {
            warn(`Could not find conversation list element ("${targetSelector}") to observe. Aborting observation setup.`);
            isNewChatPending = false; // Reset flag
            pendingModelName = null;
            return;
        }

        log("Found conversation list element. Setting up MAIN sidebar observer...");

        // Disconnect previous observers if they exist
        if (sidebarObserver) {
            log("Disconnecting previous MAIN sidebar observer.");
            sidebarObserver.disconnect();
            sidebarObserver = null;
        }
        if (titleObserver) {
            // If a title observer is somehow still active when we start a new chat observation,
            // disconnect it to prevent multiple lingering observers.
            warn("Disconnecting lingering TITLE observer from previous attempt.");
            titleObserver.disconnect();
            titleObserver = null;
        }


        sidebarObserver = new MutationObserver((mutationsList, mainObserver) => {
            log(`MAIN Sidebar Observer Callback Triggered. ${mutationsList.length} mutations.`);
            const currentUrl = window.location.href;
            log(`Current URL inside MAIN observer: ${currentUrl}`);

            const chatUrlPattern = /^https:\/\/gemini\.google\.com\/app\/[a-f0-9]+$/;
            if (!chatUrlPattern.test(currentUrl)) {
                log(`URL "${currentUrl}" does not match the expected chat pattern. Waiting...`);
                return; // URL still not a valid chat URL
            }

            log("URL check passed (matches chat pattern). Processing mutations to find NEW conversation item...");
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('conversation-items-container')) {
                            const conversationItem = node.querySelector('div[data-test-id="conversation"]');
                            if (conversationItem && isNewChatPending) {
                                log("Found NEW conversation item container. Preparing to wait for title...");

                                // --- Stage 1 Complete: Found the Item ---
                                // Disconnect the MAIN observer
                                log("Disconnecting MAIN sidebar observer.");
                                mainObserver.disconnect();
                                sidebarObserver = null;

                                // --- Stage 2: Wait for the Title (Context Capture) ---
                                log(`Starting TITLE observation process for specific item:`, conversationItem);
                                const timestampCaptured = getCurrentJakartaTimestamp();
                                const urlCaptured = currentUrl; // Capture the specific URL for this chat item
                                const modelCaptured = pendingModelName;

                                // Clear pending flags
                                isNewChatPending = false;
                                pendingModelName = null;
                                log(`Cleared isNewChatPending flag. Waiting for title associated with URL: ${urlCaptured}`);

                                // --- Function to attempt capture, including URL check ---
                                function attemptTitleCaptureAndSave(item, expectedUrl, timestamp, model) {
                                    // *** ADDED URL CHECK ***
                                    // Check if we are still on the page this observer was created for.
                                    if (window.location.href !== expectedUrl) {
                                        warn(`URL changed from "${expectedUrl}" to "${window.location.href}" while waiting for title. Disconnecting TITLE observer.`);
                                        if (titleObserver) {
                                            titleObserver.disconnect();
                                            titleObserver = null;
                                        }
                                        return true; // Return true to indicate we should stop trying (observer is disconnected)
                                    }
                                    // *** END ADDED URL CHECK ***

                                    const title = extractTitleFromSidebarItem(item);
                                    log(`TITLE Check (URL: ${expectedUrl}): Extracted title: "${title}"`);
                                    if (title) { // Title is present and non-empty
                                        log(`Title found for ${expectedUrl}! Attempting to add history entry.`);
                                        if (titleObserver) {
                                            log("Disconnecting TITLE observer after successful capture.");
                                            titleObserver.disconnect();
                                            titleObserver = null;
                                        }
                                        addHistoryEntry(timestamp, expectedUrl, title, model); // Use expectedUrl
                                        return true; // Indicate success, stop trying
                                    }
                                    return false; // Title not ready yet, continue trying
                                }

                                // Initial check right away
                                if (attemptTitleCaptureAndSave(conversationItem, urlCaptured, timestampCaptured, modelCaptured)) {
                                    log("Title capture process concluded on initial check (found title or URL changed).");
                                    return; // Already done or aborted
                                }

                                // Set up the title observer if title not present initially AND URL still matches
                                titleObserver = new MutationObserver((titleMutations, obs) => {
                                    log("TITLE Observer Callback Triggered.");
                                    // Re-check the title AND the URL on any mutation within the item
                                    if (attemptTitleCaptureAndSave(conversationItem, urlCaptured, timestampCaptured, modelCaptured)) {
                                        log("Title capture process concluded via TITLE observer callback (found title or URL changed).");
                                        // Disconnect happens within the function
                                    } else {
                                        log("Title observer triggered, but title still not found/empty or URL mismatch.");
                                    }
                                });

                                titleObserver.observe(conversationItem, {
                                    childList: true,
                                    subtree: true,
                                    characterData: true
                                });
                                log(`TITLE observer is now active, watching specific item associated with URL: ${urlCaptured} (no timeout).`);

                                return; // Stop processing further mutations in the *main* observer callback
                            }
                        }
                    }
                }
            }
        });

        sidebarObserver.observe(conversationListElement, {
            childList: true,
            subtree: true
        });
        log("MAIN sidebar observer is now active.");
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