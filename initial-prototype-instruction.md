Help me build a history manager for gemini AI chat. 

## Pre-requisites:
1. needed data:
- timestamp (gmt+7 Asia/Jakarta)
- chat url (can be taken from current url)
- chat title (can be taken from conversation list sidebar, I'll give you the full html)
- type of model (can take inspiration from my another script: gemini usage tracker that tracks the usage for each model. But no need to do go as far as adding separate listener for start research button. Just use the model dropdown menu selector like non-deep research model)

## Feature
1. able to efficienctly export it to json the user can view in the browser using blob url. 

## User Workflow

All gemini users first go to gemini homepage: https://gemini.google.com/app
In there, there is a large input box at the center for the user to type prompt, with a send button next to it. 
to the left, there is a sidebar recent chat history, with a title (this sidebar html will be given). 

At this point, the observer should've been placed. Why? because once the user send a prompt, two things will change dynamically:
1. the url. from https://gemini.google.com/app to https://gemini.google.com/app/4eae90d42108ee11 (sample id). 
2. a new chat entry in the sidebar will appear. 

## source code

### gemini usage tracker
```js
// ==UserScript==
// @name         Gemini Model Usage Tracker (Daily/Calendar)
// @namespace    http://tampermonkey.net/
// @version      0.5.1
// @description  Tracks usage count for different Gemini AI models per day (US Pacific Time) with a calendar selector, modern UI, and editing capabilities (locked by Developer Mode).
// @author       InvictusNavarchus
// @match        https://gemini.google.com/*
// @icon         https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_getResourceText
// @require      https://cdn.jsdelivr.net/npm/@violentmonkey/dom@2
// @require      https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.js
// @resource     flatpickrCSS https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.css
// @resource     flatpickrTheme https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/themes/dark.css
// @downloadURL  https://raw.githubusercontent.com/InvictusNavarchus/gemini-usage-tracker/master/gemini-usage-tracker.user.js
// @updateURL    https://raw.githubusercontent.com/InvictusNavarchus/gemini-usage-tracker/master/gemini-usage-tracker.user.js
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY_DAILY = 'geminiModelUsageCountsDaily'; // Changed key for new structure
    const UI_VISIBLE_KEY = 'geminiModelUsageUIVisible';
    const DEV_MODE_KEY = 'geminiTrackerDevModeEnabled';
    const PACIFIC_TIMEZONE = 'America/Los_Angeles';

    let selectedDate = getCurrentPacificDateString(); // Initialize with today's PT date

    // --- Model Definitions ---
    const modelNames = {
        '2.5 Pro': '2.5 Pro',
        'Deep Research': 'Deep Research',
        '2.0 Flash Thinking': '2.0 Flash Thinking',
        '2.0 Flash': '2.0 Flash',
        // Add more specific model names as they appear in the UI
    };

    // --- Helper Functions ---

    /**
     * Gets the current date string (YYYY-MM-DD) in US Pacific Time.
     * @returns {string} Date string or throws error if formatting fails.
     */
    function getCurrentPacificDateString() {
        try {
            const now = new Date();
            const formatter = new Intl.DateTimeFormat('en-CA', { // 'en-CA' gives YYYY-MM-DD
                timeZone: PACIFIC_TIMEZONE,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
            return formatter.format(now);
        } catch (e) {
            console.error("Gemini Tracker: Error getting Pacific Time date.", e);
            // Fallback to local date (less ideal but prevents complete failure)
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            console.warn("Gemini Tracker: Falling back to local date string.");
            return `${yyyy}-${mm}-${dd}`;
        }
    }

    // Add specific function to track Deep Research confirmations
    function trackDeepResearchConfirmation() {
        document.body.addEventListener('click', function (event) {
            // Look for the "Start research" button using the data-test-id attribute
            const confirmButton = event.target.closest('button[data-test-id="confirm-button"]');
            if (confirmButton) {
                // When the button is clicked, increment the count for Deep Research model
                console.log("Gemini Tracker: Deep Research confirmation detected. Incrementing count for 'Deep Research'");
                incrementCount('Deep Research'); // This handles date logic internally
            }
        }, true); // Use capture phase
        console.log("Gemini Tracker: Deep Research confirmation listener attached to body.");
    }

    function loadAllCounts() {
        const storedData = GM_getValue(STORAGE_KEY_DAILY, '{}');
        try {
            const allCounts = JSON.parse(storedData);
            // Basic validation (ensure it's an object)
            if (typeof allCounts !== 'object' || allCounts === null) {
                console.warn("Gemini Tracker: Stored data is not an object, resetting.");
                return {};
            }
            // Optional: Deeper validation per date entry if needed
            Object.keys(allCounts).forEach(dateKey => {
                if (typeof allCounts[dateKey] !== 'object' || allCounts[dateKey] === null) {
                    console.warn(`Gemini Tracker: Invalid data for date ${dateKey}, removing.`);
                    delete allCounts[dateKey];
                    return;
                }
                Object.keys(allCounts[dateKey]).forEach(modelKey => {
                    if (typeof allCounts[dateKey][modelKey] !== 'number' || isNaN(allCounts[dateKey][modelKey])) {
                        console.warn(`Gemini Tracker: Invalid count for ${modelKey} on ${dateKey}, resetting to 0.`);
                        allCounts[dateKey][modelKey] = 0;
                    }
                });
            });

            return allCounts;
        } catch (e) {
            console.error("Gemini Tracker: Error parsing stored daily counts.", e);
            return {}; // Return empty object on error
        }
    }

    function getCountsForDate(dateString) {
        const allCounts = loadAllCounts();
        const dailyCounts = allCounts[dateString] || {};
        // Ensure all defined models have a 0 entry for the requested day if not present
        Object.values(modelNames).forEach(name => {
            if (!(name in dailyCounts)) {
                dailyCounts[name] = 0;
            }
        });
        return dailyCounts;
    }

    function saveAllCounts(allCounts) {
        // Add validation before saving if desired (e.g., ensure counts are numbers)
        try {
            GM_setValue(STORAGE_KEY_DAILY, JSON.stringify(allCounts));
        } catch (e) {
            console.error("Gemini Tracker: Error saving daily counts.", e);
        }
    }

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
            console.log(`Gemini Tracker: Model text "${rawText}" didn't match known prefixes, using raw text.`);
            return rawText; // Return the raw text as a potential new model name
        }

        console.warn("Gemini Tracker: Could not determine current model name.");
        return null; // Indicate failure to find the model
    }

    function incrementCount(modelName) {
        if (!modelName) return;

        const currentPTDate = getCurrentPacificDateString();
        const allCounts = loadAllCounts();

        // Ensure the object for the current date exists
        if (!allCounts[currentPTDate]) {
            allCounts[currentPTDate] = {};
        }

        const dailyCounts = allCounts[currentPTDate];

        if (dailyCounts.hasOwnProperty(modelName)) {
            dailyCounts[modelName] = (dailyCounts[modelName] || 0) + 1;
        } else {
            // If it's a newly detected model name (returned as rawText), add it
            console.log(`Gemini Tracker: Detected new model '${modelName}' on ${currentPTDate}, adding to tracker.`);
            dailyCounts[modelName] = 1;
            // Manually add to `modelNames` constant if it becomes permanent
        }

        saveAllCounts(allCounts);

        // Only update UI if it's visible AND showing the current PT date
        if (uiPanel && uiPanel.style.display === 'block' && selectedDate === currentPTDate) {
            updateUI(selectedDate);
        }
    }

    function manuallySetCount(modelName, newCount, dateStringToModify) {
        const parsedCount = parseInt(newCount, 10);
        if (modelName && !isNaN(parsedCount) && parsedCount >= 0 && dateStringToModify) {
            console.log(`Gemini Tracker: Manually setting count for ${modelName} on ${dateStringToModify} to ${parsedCount}`);
            const allCounts = loadAllCounts();

            // Ensure the object for the target date exists
            if (!allCounts[dateStringToModify]) {
                allCounts[dateStringToModify] = {};
            }

            allCounts[dateStringToModify][modelName] = parsedCount;
            saveAllCounts(allCounts);
            updateUI(dateStringToModify); // Update UI for the date that was modified
            return true; // Indicate success
        } else {
            console.warn(`Gemini Tracker: Invalid count value "${newCount}" or missing data for model ${modelName} on date ${dateStringToModify}. Must be a non-negative number.`);
            // Revert the input field by re-rendering the UI for the selected date
            updateUI(selectedDate);
            return false; // Indicate failure
        }
    }

    // Reset counts ONLY for the currently selected date
    function resetCountsForSelectedDate() {
        if (confirm(`Are you sure you want to reset all Gemini model usage counts for ${selectedDate}?`)) {
            const allCounts = loadAllCounts();
            if (allCounts[selectedDate]) {
                console.log(`Gemini Tracker: Resetting counts for ${selectedDate}.`);
                // Clear the counts for the selected date by assigning an empty object
                allCounts[selectedDate] = {};
                // Or optionally, set all known models to 0 for that date:
                // allCounts[selectedDate] = {};
                // Object.values(modelNames).forEach(name => { allCounts[selectedDate][name] = 0; });

                saveAllCounts(allCounts);
                updateUI(selectedDate); // Refresh UI for the cleared date
            } else {
                console.log(`Gemini Tracker: No counts found for ${selectedDate} to reset.`);
            }
        }
    }

    // --- UI Creation and Management ---

    let uiPanel = null;
    let toggleButton = null;
    let devModeCheckbox = null;
    let datePickerInput = null;
    let flatpickrInstance = null;

    function createUI() {
        // Inject flatpickr CSS
        const flatpickrStyles = GM_getResourceText("flatpickrCSS");
        const flatpickrThemeStyles = GM_getResourceText("flatpickrTheme");
        GM_addStyle(flatpickrStyles);
        GM_addStyle(flatpickrThemeStyles);

        // Toggle Button
        toggleButton = document.createElement('div');
        toggleButton.id = 'gemini-tracker-toggle';
        // SVG icon remains the same
        toggleButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="#FFFFFF">
                <path d="M0 0h24v24H0V0z" fill="none"/>
                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
            </svg>
        `;
        toggleButton.title = "Show/Hide Gemini Usage Stats";
        document.body.appendChild(toggleButton);

        // Stats Panel Structure
        uiPanel = document.createElement('div');
        uiPanel.id = 'gemini-tracker-panel';
        uiPanel.innerHTML = `
            <div class="tracker-header">
                <h3>Model Usage</h3>
                 <div class="tracker-date-selector-container">
                    <input type="text" id="tracker-date-selector" placeholder="Select Date">
                 </div>
                <button id="tracker-close-btn" title="Close">&times;</button>
            </div>
            <ul id="tracker-list"></ul>
            <div class="tracker-separator"></div>
            <div class="tracker-separator"></div>
             <button id="tracker-reset-btn" title="Reset counts for selected date">Reset Counts for Day</button>
        `;
        document.body.appendChild(uiPanel);

        // --- Date Picker Initialization ---
        datePickerInput = uiPanel.querySelector('#tracker-date-selector');
        flatpickrInstance = flatpickr(datePickerInput, {
            dateFormat: "Y-m-d",
            defaultDate: selectedDate, // Set initial date
            maxDate: getCurrentPacificDateString(), // Optional: prevent future dates?
            altInput: true, // Show user-friendly format, submit standard format
            altFormat: "M j, Y", // Example: Mar 31, 2025
            onChange: function (selectedDates, dateStr, instance) {
                console.log("Selected date:", dateStr);
                selectedDate = dateStr; // Update global selected date
                updateUI(selectedDate); // Refresh the list for the new date
            },
        });


        // --- Create and Insert Developer Mode Toggle ---
        const devModeContainer = document.createElement('div');
        devModeContainer.className = 'tracker-setting';
        // ... (rest of dev mode element creation is the same as before) ...
        const devModeLabel = document.createElement('label');
        devModeLabel.htmlFor = 'dev-mode-checkbox';
        devModeLabel.textContent = 'Developer Mode';

        const devModeToggle = document.createElement('label');
        devModeToggle.className = 'switch';

        devModeCheckbox = document.createElement('input'); // Assign to global ref
        devModeCheckbox.type = 'checkbox';
        devModeCheckbox.id = 'dev-mode-checkbox';

        const slider = document.createElement('span');
        slider.className = 'slider round';

        devModeToggle.appendChild(devModeCheckbox);
        devModeToggle.appendChild(slider);

        devModeContainer.appendChild(devModeLabel);
        devModeContainer.appendChild(devModeToggle);

        // Insert Dev Mode *before* the second separator
        const resetButton = uiPanel.querySelector('#tracker-reset-btn');
        const secondSeparator = resetButton.previousElementSibling; // The separator before reset
        secondSeparator.parentNode.insertBefore(devModeContainer, secondSeparator);


        // --- Event Listeners ---
        toggleButton.addEventListener('click', toggleUIVisibility);
        uiPanel.querySelector('#tracker-close-btn').addEventListener('click', () => setUIVisibility(false));
        // Reset button now resets for the selected date
        uiPanel.querySelector('#tracker-reset-btn').addEventListener('click', resetCountsForSelectedDate);
        devModeCheckbox.addEventListener('change', handleDevModeToggle);

        // Edit listener remains largely the same, but passes selectedDate to save function
        uiPanel.querySelector('#tracker-list').addEventListener('click', (event) => {
            const isDevModeEnabled = GM_getValue(DEV_MODE_KEY, false);
            if (isDevModeEnabled && event.target.classList.contains('model-count') && !event.target.isEditing) {
                makeCountEditable(event.target);
            } else if (!isDevModeEnabled && event.target.classList.contains('model-count')) {
                console.log("Gemini Tracker: Editing disabled. Enable Developer Mode to edit counts.");
            }
        });

        // --- Initial State ---
        const isVisible = GM_getValue(UI_VISIBLE_KEY, false);
        setUIVisibility(isVisible); // Set initial panel visibility

        const initialDevMode = GM_getValue(DEV_MODE_KEY, false);
        updateDevModeVisuals(initialDevMode); // Set initial dev mode visuals

        // Populate with counts for the initially selected date
        updateUI(selectedDate);
    }

    function setUIVisibility(visible) {
        if (!uiPanel || !toggleButton) return;
        uiPanel.style.display = visible ? 'block' : 'none';
        toggleButton.classList.toggle('active', visible);
        document.body.classList.toggle('gemini-tracker-panel-open', visible);
        GM_setValue(UI_VISIBLE_KEY, visible);
    }

    function toggleUIVisibility() {
        if (!uiPanel) return;
        const currentlyVisible = uiPanel.style.display === 'block';
        setUIVisibility(!currentlyVisible);
        if (!currentlyVisible) {
            // When opening, refresh UI for the currently selected date
            selectedDate = flatpickrInstance ? flatpickrInstance.selectedDates[0] ? flatpickrInstance.formatDate(flatpickrInstance.selectedDates[0], "Y-m-d") : getCurrentPacificDateString() : getCurrentPacificDateString(); // Ensure selectedDate is current
            if (flatpickrInstance && !flatpickrInstance.selectedDates[0]) {
                flatpickrInstance.setDate(selectedDate, false); // Update calendar if it lost selection
            }
            const currentDevMode = GM_getValue(DEV_MODE_KEY, false);
            updateDevModeVisuals(currentDevMode); // Ensure dev mode visuals are correct
            updateUI(selectedDate); // Refresh content for the selected date
        }
    }

    // --- Handle Developer Mode Toggle Change ---
    function handleDevModeToggle() {
        const isEnabled = devModeCheckbox.checked;
        GM_setValue(DEV_MODE_KEY, isEnabled);
        console.log(`Gemini Tracker: Developer Mode ${isEnabled ? 'Enabled' : 'Disabled'}`);
        updateDevModeVisuals(isEnabled);
        // Re-render the list for the selected date to apply/remove tooltips etc.
        updateUI(selectedDate);
    }

    // --- Update Visuals Based on Dev Mode State ---
    function updateDevModeVisuals(isEnabled) {
        if (devModeCheckbox) {
            devModeCheckbox.checked = isEnabled;
        }
        if (uiPanel) {
            uiPanel.classList.toggle('dev-mode-active', isEnabled);
        }
        // Styling changes handled by CSS based on 'dev-mode-active' class
    }


    function updateUI(dateString) {
        if (!uiPanel) return;
        const listElement = uiPanel.querySelector('#tracker-list');
        if (!listElement) return;

        // Ensure the calendar input reflects the date being displayed
        if (flatpickrInstance && datePickerInput.value !== dateString) {
            // Update flatpickr's internal date without triggering onChange
            flatpickrInstance.setDate(dateString, false);
        }

        const countsForDay = getCountsForDate(dateString);

        // Clear previous entries
        listElement.innerHTML = '';

        const isDevModeEnabled = GM_getValue(DEV_MODE_KEY, false);

        // Get potentially new models detected on this day + defined models
        let modelsToDisplay = [...Object.values(modelNames)];
        Object.keys(countsForDay).forEach(model => {
            if (!modelsToDisplay.includes(model)) {
                modelsToDisplay.push(model);
            }
        });
        // Sort: Defined models first alphabetically, then new models alphabetically
        modelsToDisplay.sort((a, b) => {
            const aIsKnown = Object.values(modelNames).includes(a);
            const bIsKnown = Object.values(modelNames).includes(b);
            if (aIsKnown && !bIsKnown) return -1;
            if (!aIsKnown && bIsKnown) return 1;
            return a.localeCompare(b);
        });


        let hasUsage = false;
        for (const modelName of modelsToDisplay) {
            const count = countsForDay[modelName] || 0; // Get count, default to 0 if not present
            if (count > 0) hasUsage = true;

            const listItem = document.createElement('li');

            const nameSpan = document.createElement('span');
            nameSpan.className = 'model-name';
            nameSpan.textContent = modelName;
            nameSpan.title = modelName;

            const countSpan = document.createElement('span');
            countSpan.className = 'model-count';
            countSpan.textContent = count;
            countSpan.dataset.modelName = modelName; // Store model name for editing

            if (isDevModeEnabled) {
                countSpan.title = 'Click to edit';
            } else {
                countSpan.title = ''; // No tooltip when not editable
            }

            listItem.appendChild(nameSpan);
            listItem.appendChild(countSpan);
            listElement.appendChild(listItem);
        }

        // Add a message if the list is empty or all counts are zero for the day
        if (modelsToDisplay.length === 0 || !hasUsage) {
            const emptyItem = document.createElement('li');
            emptyItem.textContent = `No usage tracked for ${dateString}.`;
            emptyItem.style.fontStyle = 'italic';
            emptyItem.style.opacity = '0.7';
            emptyItem.style.justifyContent = 'center'; // Center the empty message
            listElement.appendChild(emptyItem);
        }
    }

    // --- Editing Input Field Logic ---
    function makeCountEditable(countSpan) {
        countSpan.isEditing = true; // Prevent re-clicks
        const currentCount = countSpan.textContent;
        const modelName = countSpan.dataset.modelName;

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'edit-count-input';
        input.value = currentCount;
        input.min = "0";
        input.setAttribute('aria-label', `Edit count for ${modelName} on ${selectedDate}`);

        countSpan.style.display = 'none';
        countSpan.parentNode.insertBefore(input, countSpan.nextSibling);
        input.focus();
        input.select();

        const removeInput = (saveValue) => {
            if (!document.body.contains(input)) return; // Already removed

            // Find the parent li in case we need to restore the span manually
            const parentListItem = input.closest('li');

            if (saveValue) {
                // Pass the currently selectedDate to the save function
                manuallySetCount(modelName, input.value, selectedDate);
                // manuallySetCount calls updateUI, so no need to restore span locally
            } else {
                // Cancel: Remove input, show original span
                input.remove();
                if (parentListItem) {
                    // Find the original span within this specific list item
                    const originalSpan = parentListItem.querySelector(`.model-count[data-model-name="${modelName}"]`);
                    if (originalSpan) {
                        originalSpan.style.display = ''; // Restore visibility
                        originalSpan.isEditing = false; // Reset editing flag
                    }
                }
            }
            // Reset flag in case of cancel/blur without save
            // (It's implicitly reset by updateUI on successful save)
            if (!saveValue && countSpan) countSpan.isEditing = false;
        };

        input.addEventListener('blur', () => {
            if (!input.enterPressed) { // Avoid double save on Enter + Blur
                // Slight delay allows Enter keydown to process first if needed
                setTimeout(() => removeInput(true), 50);
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.enterPressed = true; // Flag to prevent blur event saving again
                removeInput(true); // Save on Enter
            } else if (e.key === 'Escape') {
                input.enterPressed = false; // Ensure blur doesn't save if Escape is hit
                removeInput(false); // Cancel on Escape
            }
        });
    }

    // --- Event Listener for Prompt Submission ---
    function attachSendListener() {
        document.body.addEventListener('click', function (event) {
            const sendButton = event.target.closest('button:has(mat-icon[data-mat-icon-name="send"]), button.send-button');
            if (sendButton && sendButton.getAttribute('aria-disabled') !== 'true') {
                setTimeout(() => {
                    const modelName = getCurrentModelName();

                    // Skip Deep Research model in general tracking - it's handled by trackDeepResearchConfirmation()
                    if (modelName === 'Deep Research') {
                        console.log(`Gemini Tracker: Deep Research detected but not incrementing via send button.`);
                        return;
                    }

                    console.log(`Gemini Tracker: Send clicked. Current model: ${modelName || 'Unknown'}. Incrementing for PT Date: ${getCurrentPacificDateString()}`);
                    incrementCount(modelName); // This now handles date logic internally
                }, 50);
            }
        }, true); // Use capture phase
        console.log("Gemini Tracker: Send button listener attached to body.");
    }

    // --- Initialization ---
    VM.observe(document.body, () => {
        const chatContainer = document.querySelector('chat-window');
        const inputArea = document.querySelector('input-area-v2');

        if (chatContainer && inputArea && !document.getElementById('gemini-tracker-toggle')) {
            console.log("Gemini Tracker: Initializing UI, listeners, and calendar.");
            // Ensure selectedDate is the current PT date before creating UI
            selectedDate = getCurrentPacificDateString();
            createUI(); // Creates panel, toggle, calendar, loads initial states
            attachSendListener();
            trackDeepResearchConfirmation(); // Add Deep Research tracking
            // Add menu commands (Reset now targets selected date)
            GM_registerMenuCommand("Reset Gemini Counts for Selected Day", resetCountsForSelectedDate);
            GM_registerMenuCommand("Toggle Gemini Usage UI", toggleUIVisibility);
            return true; // Stop observing
        }
        return false; // Continue observing
    });

})();
```

### <conversation-list> element

```html
<conversations-list _ngcontent-ng-c1131231951="" data-test-id="all-conversations" class="sidenav-style-updates ng-tns-c2789934040-17 ng-star-inserted" _nghost-ng-c2789934040=""><div _ngcontent-ng-c2789934040="" class="title-container ng-tns-c2789934040-17 ng-trigger ng-trigger-conversationListTitleVisibilityAnimation" style="visibility: visible;"><h1 _ngcontent-ng-c2789934040="" class="title gds-label-l ng-tns-c2789934040-17 ng-star-inserted" style=""> Recent </h1><!----></div><div _ngcontent-ng-c2789934040="" role="region" class="conversations-container ng-tns-c2789934040-17 ng-star-inserted" id="conversations-list-4"><div _ngcontent-ng-c2789934040="" class="conversation-items-container ng-tns-c2789934040-17 ng-star-inserted side-nav-opened"><!----><div _ngcontent-ng-c2789934040="" role="button" tabindex="0" data-test-id="conversation" mattooltipposition="right" mattooltipshowdelay="300" class="mat-mdc-tooltip-trigger conversation ng-tns-c2789934040-17 ng-trigger ng-trigger-conversationListRevealAnimation" jslog="186014;track:generic_click;BardVeMetadataKey:[null,null,null,null,null,null,null,[&quot;c_4eae90d42108ee11&quot;,null,0]];mutable:true" aria-describedby="cdk-describedby-message-ng-1-97" cdk-describedby-host="ng-1"><!----><!----><div _ngcontent-ng-c2789934040="" class="conversation-icon with-mat-icon ng-tns-c2789934040-17 ng-star-inserted" style=""><mat-icon _ngcontent-ng-c2789934040="" role="img" matlistitemicon="" fonticon="notes" class="mat-icon notranslate title-mat-icon ng-tns-c2789934040-17 gds-icon-s google-symbols mat-ligature-font mat-icon-no-color ng-star-inserted" aria-hidden="true" data-mat-icon-type="font" data-mat-icon-name="notes"></mat-icon><!----><!----></div><!----><!----><!----><!----><!----><div _ngcontent-ng-c2789934040="" class="conversation-title ng-tns-c2789934040-17 gds-body-m"> Research Plan: Prolonged Ejaculation Risks
 <div _ngcontent-ng-c2789934040="" class="conversation-title-cover ng-tns-c2789934040-17"></div></div><div _ngcontent-ng-c2789934040="" class="options-icon with-mat-icon ng-tns-c2789934040-17"><!----><!----></div></div><!----><div _ngcontent-ng-c2789934040="" class="conversation-actions-container ng-tns-c2789934040-17 side-nav-opened ng-star-inserted"><button _ngcontent-ng-c2789934040="" aria-label="Open menu for conversation actions." data-test-id="actions-menu-button" class="conversation-actions-menu-button ng-tns-c2789934040-17"><mat-icon _ngcontent-ng-c2789934040="" role="img" data-test-id="actions-menu-icon gds-icon-l" class="mat-icon notranslate gds-icon-l ng-tns-c2789934040-17 google-symbols mat-ligature-font mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font" data-mat-icon-name="more_vert" fonticon="more_vert"></mat-icon><div _ngcontent-ng-c2789934040="" class="mat-mdc-menu-trigger ng-tns-c2789934040-17" aria-haspopup="menu" aria-expanded="false"></div><!----></button><!----><mat-menu _ngcontent-ng-c2789934040="" class=""><!----></mat-menu></div><!----></div><!----><div _ngcontent-ng-c2789934040="" class="conversation-items-container ng-tns-c2789934040-17 ng-star-inserted side-nav-opened"><!----><div _ngcontent-ng-c2789934040="" role="button" tabindex="0" data-test-id="conversation" mattooltipposition="right" mattooltipshowdelay="300" class="mat-mdc-tooltip-trigger conversation ng-tns-c2789934040-17 ng-trigger ng-trigger-conversationListRevealAnimation" jslog="186014;track:generic_click;BardVeMetadataKey:[null,null,null,null,null,null,null,[&quot;c_f7ab822ca97bd420&quot;,null,0,1]];mutable:true" aria-describedby="cdk-describedby-message-ng-1-98" cdk-describedby-host="ng-1"><!----><!----><div _ngcontent-ng-c2789934040="" class="conversation-icon with-mat-icon ng-tns-c2789934040-17 ng-star-inserted" style=""><mat-icon _ngcontent-ng-c2789934040="" role="img" matlistitemicon="" fonticon="notes" class="mat-icon notranslate title-mat-icon ng-tns-c2789934040-17 gds-icon-s google-symbols mat-ligature-font mat-icon-no-color ng-star-inserted" aria-hidden="true" data-mat-icon-type="font" data-mat-icon-name="notes"></mat-icon><!----><!----></div><!----><!----><!----><!----><!----><div _ngcontent-ng-c2789934040="" class="conversation-title ng-tns-c2789934040-17 gds-body-m"> Greeting and Assistance Offered
 <div _ngcontent-ng-c2789934040="" class="conversation-title-cover ng-tns-c2789934040-17"></div></div><div _ngcontent-ng-c2789934040="" class="options-icon with-mat-icon ng-tns-c2789934040-17"><!----><!----></div></div><!----><div _ngcontent-ng-c2789934040="" class="conversation-actions-container ng-tns-c2789934040-17 side-nav-opened ng-star-inserted"><button _ngcontent-ng-c2789934040="" aria-label="Open menu for conversation actions." data-test-id="actions-menu-button" class="conversation-actions-menu-button ng-tns-c2789934040-17"><mat-icon _ngcontent-ng-c2789934040="" role="img" data-test-id="actions-menu-icon gds-icon-l" class="mat-icon notranslate gds-icon-l ng-tns-c2789934040-17 google-symbols mat-ligature-font mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font" data-mat-icon-name="more_vert" fonticon="more_vert"></mat-icon><div _ngcontent-ng-c2789934040="" class="mat-mdc-menu-trigger ng-tns-c2789934040-17" aria-haspopup="menu" aria-expanded="false"></div><!----></button><!----><mat-menu _ngcontent-ng-c2789934040="" class=""><!----></mat-menu></div><!----></div><!----><div _ngcontent-ng-c2789934040="" class="conversation-items-container ng-tns-c2789934040-17 ng-star-inserted side-nav-opened"><!----><div _ngcontent-ng-c2789934040="" role="button" tabindex="0" data-test-id="conversation" mattooltipposition="right" mattooltipshowdelay="300" class="mat-mdc-tooltip-trigger conversation ng-tns-c2789934040-17 ng-trigger ng-trigger-conversationListRevealAnimation" jslog="186014;track:generic_click;BardVeMetadataKey:[null,null,null,null,null,null,null,[&quot;c_0484e6cbce71ee27&quot;,null,0,2]];mutable:true" aria-describedby="cdk-describedby-message-ng-1-99" cdk-describedby-host="ng-1"><!----><!----><div _ngcontent-ng-c2789934040="" class="conversation-icon with-mat-icon ng-tns-c2789934040-17 ng-star-inserted" style=""><mat-icon _ngcontent-ng-c2789934040="" role="img" matlistitemicon="" fonticon="notes" class="mat-icon notranslate title-mat-icon ng-tns-c2789934040-17 gds-icon-s google-symbols mat-ligature-font mat-icon-no-color ng-star-inserted" aria-hidden="true" data-mat-icon-type="font" data-mat-icon-name="notes"></mat-icon><!----><!----></div><!----><!----><!----><!----><!----><div _ngcontent-ng-c2789934040="" class="conversation-title ng-tns-c2789934040-17 gds-body-m"> CSS for Latin Library Readability
 <div _ngcontent-ng-c2789934040="" class="conversation-title-cover ng-tns-c2789934040-17"></div></div><div _ngcontent-ng-c2789934040="" class="options-icon with-mat-icon ng-tns-c2789934040-17"><!----><!----></div></div><!----><div _ngcontent-ng-c2789934040="" class="conversation-actions-container ng-tns-c2789934040-17 side-nav-opened ng-star-inserted"><button _ngcontent-ng-c2789934040="" aria-label="Open menu for conversation actions." data-test-id="actions-menu-button" class="conversation-actions-menu-button ng-tns-c2789934040-17"><mat-icon _ngcontent-ng-c2789934040="" role="img" data-test-id="actions-menu-icon gds-icon-l" class="mat-icon notranslate gds-icon-l ng-tns-c2789934040-17 google-symbols mat-ligature-font mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font" data-mat-icon-name="more_vert" fonticon="more_vert"></mat-icon><div _ngcontent-ng-c2789934040="" class="mat-mdc-menu-trigger ng-tns-c2789934040-17" aria-haspopup="menu" aria-expanded="false"></div><!----></button><!----><mat-menu _ngcontent-ng-c2789934040="" class=""><!----></mat-menu></div><!----></div><!----><div _ngcontent-ng-c2789934040="" class="conversation-items-container ng-tns-c2789934040-17 ng-star-inserted side-nav-opened"><!----><div _ngcontent-ng-c2789934040="" role="button" tabindex="0" data-test-id="conversation" mattooltipposition="right" mattooltipshowdelay="300" class="mat-mdc-tooltip-trigger conversation ng-tns-c2789934040-17 ng-trigger ng-trigger-conversationListRevealAnimation" jslog="186014;track:generic_click;BardVeMetadataKey:[null,null,null,null,null,null,null,[&quot;c_17011fae0ae78d79&quot;,null,0,3]];mutable:true" aria-describedby="cdk-describedby-message-ng-1-100" cdk-describedby-host="ng-1"><!----><!----><div _ngcontent-ng-c2789934040="" class="conversation-icon with-mat-icon ng-tns-c2789934040-17 ng-star-inserted" style=""><mat-icon _ngcontent-ng-c2789934040="" role="img" matlistitemicon="" fonticon="notes" class="mat-icon notranslate title-mat-icon ng-tns-c2789934040-17 gds-icon-s google-symbols mat-ligature-font mat-icon-no-color ng-star-inserted" aria-hidden="true" data-mat-icon-type="font" data-mat-icon-name="notes"></mat-icon><!----><!----></div><!----><!----><!----><!----><!----><div _ngcontent-ng-c2789934040="" class="conversation-title ng-tns-c2789934040-17 gds-body-m"> here is an html page. Write a complete css overwrite I can apply with stylus extension to make the page much more modern and beautifully designed with best UI/UX principle so the user can read at highest level of comfort. Use important! to enforce rules. 
```
jajaja
``` <div _ngcontent-ng-c2789934040="" class="conversation-title-cover ng-tns-c2789934040-17"></div></div><div _ngcontent-ng-c2789934040="" class="options-icon with-mat-icon ng-tns-c2789934040-17"><!----><!----></div></div><!----><div _ngcontent-ng-c2789934040="" class="conversation-actions-container ng-tns-c2789934040-17 side-nav-opened ng-star-inserted"><button _ngcontent-ng-c2789934040="" aria-label="Open menu for conversation actions." data-test-id="actions-menu-button" class="conversation-actions-menu-button ng-tns-c2789934040-17"><mat-icon _ngcontent-ng-c2789934040="" role="img" data-test-id="actions-menu-icon gds-icon-l" class="mat-icon notranslate gds-icon-l ng-tns-c2789934040-17 google-symbols mat-ligature-font mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font" data-mat-icon-name="more_vert" fonticon="more_vert"></mat-icon><div _ngcontent-ng-c2789934040="" class="mat-mdc-menu-trigger ng-tns-c2789934040-17" aria-haspopup="menu" aria-expanded="false"></div><!----></button><!----><mat-menu _ngcontent-ng-c2789934040="" class=""><!----></mat-menu></div><!----></div><!----><div _ngcontent-ng-c2789934040="" class="conversation-items-container ng-tns-c2789934040-17 ng-star-inserted side-nav-opened"><!----><div _ngcontent-ng-c2789934040="" role="button" tabindex="0" data-test-id="conversation" mattooltipposition="right" mattooltipshowdelay="300" class="mat-mdc-tooltip-trigger conversation ng-tns-c2789934040-17 ng-trigger ng-trigger-conversationListRevealAnimation" jslog="186014;track:generic_click;BardVeMetadataKey:[null,null,null,null,null,null,null,[&quot;c_5bda2577da85d24e&quot;,null,0,4]];mutable:true" aria-describedby="cdk-describedby-message-ng-1-101" cdk-describedby-host="ng-1"><!----><!----><div _ngcontent-ng-c2789934040="" class="conversation-icon with-mat-icon ng-tns-c2789934040-17 ng-star-inserted" style=""><mat-icon _ngcontent-ng-c2789934040="" role="img" matlistitemicon="" fonticon="notes" class="mat-icon notranslate title-mat-icon ng-tns-c2789934040-17 gds-icon-s google-symbols mat-ligature-font mat-icon-no-color ng-star-inserted" aria-hidden="true" data-mat-icon-type="font" data-mat-icon-name="notes"></mat-icon><!----><!----></div><!----><!----><!----><!----><!----><div _ngcontent-ng-c2789934040="" class="conversation-title ng-tns-c2789934040-17 gds-body-m"> CSS with !important Enforcement.
 <div _ngcontent-ng-c2789934040="" class="conversation-title-cover ng-tns-c2789934040-17"></div></div><div _ngcontent-ng-c2789934040="" class="options-icon with-mat-icon ng-tns-c2789934040-17"><!----><!----></div></div><!----><div _ngcontent-ng-c2789934040="" class="conversation-actions-container ng-tns-c2789934040-17 side-nav-opened ng-star-inserted"><button _ngcontent-ng-c2789934040="" aria-label="Open menu for conversation actions." data-test-id="actions-menu-button" class="conversation-actions-menu-button ng-tns-c2789934040-17"><mat-icon _ngcontent-ng-c2789934040="" role="img" data-test-id="actions-menu-icon gds-icon-l" class="mat-icon notranslate gds-icon-l ng-tns-c2789934040-17 google-symbols mat-ligature-font mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font" data-mat-icon-name="more_vert" fonticon="more_vert"></mat-icon><div _ngcontent-ng-c2789934040="" class="mat-mdc-menu-trigger ng-tns-c2789934040-17" aria-haspopup="menu" aria-expanded="false"></div><!----></button><!----><mat-menu _ngcontent-ng-c2789934040="" class=""><!----></mat-menu></div><!----></div><!----><!----><button _ngcontent-ng-c2789934040="" mat-button="" data-test-id="show-more-button" class="mdc-button mat-mdc-button-base show-more-button mat-mdc-button ng-tns-c2789934040-17 mat-unthemed ng-star-inserted side-nav-opened" mat-ripple-loader-uninitialized="" mat-ripple-loader-class-name="mat-mdc-button-ripple" aria-controls="conversations-list-4" jslog="186006;track:generic_click,impression;mutable:true"><span class="mat-mdc-button-persistent-ripple mdc-button__ripple"></span><mat-icon _ngcontent-ng-c2789934040="" role="img" matlistitemicon="" class="mat-icon notranslate gds-icon-l ng-tns-c2789934040-17 google-symbols mat-ligature-font mat-icon-no-color ng-star-inserted" aria-hidden="true" data-mat-icon-type="font" data-mat-icon-name="expand_more" fonticon="expand_more"></mat-icon><!----><span class="mdc-button__label"><!----><!----><!----><span _ngcontent-ng-c2789934040="" class="gds-body-m show-more-button-text ng-tns-c2789934040-17 ng-star-inserted">More</span><!----></span><!----><span class="mat-focus-indicator"></span><span class="mat-mdc-button-touch-target"></span></button><!----><!----></div><!----><!----></conversations-list>
 ```
