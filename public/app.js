const SETTINGS_KEY = "page-relay-settings";
const CONNECTION_DETAILS_KEY = "page-relay-connection-details";
const FONT_SIZE_KEY = "page-relay-font-size";
const COPY_INPUTS_KEY = "page-relay-copy-inputs";

const tabs = Array.from(document.querySelectorAll("[data-tab]"));
const panels = {
	copy: document.getElementById("copy-panel"),
	settings: document.getElementById("settings-panel"),
};
const copyForm = document.getElementById("copy-form");
const settingsForm = document.getElementById("settings-form");
const copyButton = document.getElementById("copy-button");
const checkPagesButton = document.getElementById("check-pages-button");
const copyChildrenCheckbox = document.getElementById("copy-children");
const replacementPairsContainer = document.getElementById("replacement-pairs");
const addReplacementButton = document.getElementById("add-replacement-button");
const childTitlePreview = document.getElementById("child-title-preview");
const childTitleFeedback = document.getElementById("child-title-feedback");
const childTitleTree = document.getElementById("child-title-tree");
const statusMessage = document.getElementById("status-message");
const statusTitle = document.getElementById("status-title");
const statusDetail = document.getElementById("status-detail");
const authMode = document.getElementById("auth-mode");
const emailField = document.getElementById("email-field");
const saveTokenCheckbox = document.getElementById("save-token-between-sessions");
const securityNoteText = document.getElementById("security-note-text");
const settingsFeedback = document.getElementById("settings-feedback");
const testConnectionButton = document.getElementById("test-connection-button");
const fontSizeRange = document.getElementById("font-size-range");
const fontSizeValue = document.getElementById("font-size-value");
const sourcePageTitle = document.getElementById("source-page-title");
const destinationPageTitle = document.getElementById("destination-page-title");
const pageCheckFeedback = document.getElementById("page-check-feedback");
const copiedTitle = document.getElementById("copied-title");
let currentSourceTitle = "";
let currentChildPages = [];
let childPagesLoaded = false;
let replacementPairSequence = 0;

function saveCopyInputs() {
	const inputValues = {
		sourceUrl: copyForm.elements.namedItem("sourceUrl").value,
		destinationUrl: copyForm.elements.namedItem("destinationUrl").value,
		replacements: getReplacementPairs(),
		copyChildren: copyChildrenCheckbox.checked,
	};
	try {
		localStorage.setItem(COPY_INPUTS_KEY, JSON.stringify(inputValues));
	} catch {
		return;
	}
}

function restoreCopyInputs() {
	try {
		const inputValues = JSON.parse(localStorage.getItem(COPY_INPUTS_KEY) || "null");
		if (!inputValues || typeof inputValues !== "object") return;
		for (const name of ["sourceUrl", "destinationUrl"]) {
			const field = copyForm.elements.namedItem(name);
			if (typeof inputValues[name] === "string") field.value = inputValues[name];
		}
		const replacements = Array.isArray(inputValues.replacements)
			? inputValues.replacements
			: [{ from: inputValues.replaceFrom, to: inputValues.replaceTo, enabled: true }];
		renderReplacementPairs(replacements);
		if (typeof inputValues.copyChildren === "boolean") {
			copyChildrenCheckbox.checked = inputValues.copyChildren;
		}
	} catch {
		return;
	}
}

function setFontSize(value) {
	const fontSize = Math.min(16, Math.max(12, Number(value) || 13));
	document.documentElement.style.setProperty("--ui-font-size", `${fontSize}px`);
	fontSizeRange.value = String(fontSize);
	fontSizeValue.value = `${fontSize} px`;
	fontSizeValue.textContent = `${fontSize} px`;
	try {
		sessionStorage.setItem(FONT_SIZE_KEY, String(fontSize));
	} catch {
		return;
	}
}

function readSettings() {
	try {
		return JSON.parse(sessionStorage.getItem(SETTINGS_KEY) || "null");
	} catch {
		return null;
	}
}

function readConnectionDetails() {
	try {
		return JSON.parse(localStorage.getItem(CONNECTION_DETAILS_KEY) || "null");
	} catch {
		return null;
	}
}

function saveConnectionDetails(settings) {
	try {
		const connectionDetails = {
			baseUrl: settings.baseUrl,
			email: settings.email,
			saveTokenBetweenSessions: settings.saveTokenBetweenSessions,
		};
		if (settings.saveTokenBetweenSessions) connectionDetails.token = settings.token;
		localStorage.setItem(CONNECTION_DETAILS_KEY, JSON.stringify(connectionDetails));
		return true;
	} catch {
		return false;
	}
}

function updateSecurityNote() {
	securityNoteText.textContent = saveTokenCheckbox.checked
		? "When saved, your API token and connection details are stored in this browser's local storage between sessions. The token is sent to the local Node server for each request; the server does not store it."
		: "Your API token stays in this browser tab's session storage and is sent to the local Node server for each request. The server forwards it to Confluence without storing it. The Confluence URL and account email are saved in local storage.";
}

function updateConnectionLabel() {
	const settings = readSettings();
	const label = document.getElementById("connection-label");
	const dot = document.querySelector(".connection-dot");
	const connected = Boolean(settings?.baseUrl && settings?.token);
	label.textContent = connected ? new URL(settings.baseUrl).host : "Not connected";
	dot.classList.toggle("is-connected", connected);
}

function setActiveTab(tabName) {
	for (const tab of tabs) {
		const isActive = tab.dataset.tab === tabName;
		tab.classList.toggle("is-active", isActive);
		tab.setAttribute("aria-selected", String(isActive));
		tab.tabIndex = isActive ? 0 : -1;
	}
	for (const [name, panel] of Object.entries(panels)) {
		panel.hidden = name !== tabName;
		panel.classList.toggle("is-visible", name === tabName);
	}
}

function showStatus(type, title, detail) {
	statusMessage.hidden = false;
	statusMessage.classList.toggle("is-error", type === "error");
	statusTitle.textContent = title;
	statusDetail.textContent = detail;
}

function getReplacementPairs() {
	return Array.from(replacementPairsContainer.querySelectorAll(".replacement-pair"), (pair) => ({
		from: pair.querySelector(".replacement-from").value,
		to: pair.querySelector(".replacement-to").value,
		enabled: pair.querySelector(".replacement-enabled").checked,
	}));
}

function renderReplacementPairs(replacements) {
	replacementPairsContainer.replaceChildren();
	const validRules = Array.isArray(replacements)
		? replacements.filter((replacement) => replacement && typeof replacement === "object")
		: [];
	const rules = validRules.length ? validRules : [{ from: "", to: "", enabled: true }];
	for (const replacement of rules) {
		replacementPairsContainer.append(createReplacementPair(replacement));
	}
	updateReplacementPairControls();
}

function createReplacementPair(replacement = {}) {
	const pairId = ++replacementPairSequence;
	const pair = document.createElement("div");
	pair.className = "replacement-pair";

	const toolbar = document.createElement("div");
	toolbar.className = "replacement-pair-toolbar";
	const order = document.createElement("span");
	order.className = "replacement-order";
	toolbar.append(order);

	const controls = document.createElement("div");
	controls.className = "replacement-pair-controls";
	const toggle = document.createElement("label");
	toggle.className = "replacement-toggle";
	const enabled = document.createElement("input");
	enabled.type = "checkbox";
	enabled.className = "replacement-enabled";
	enabled.checked = replacement.enabled !== false;
	enabled.setAttribute("role", "switch");
	enabled.setAttribute("aria-label", "Enable replacement rule");
	const switchTrack = document.createElement("span");
	switchTrack.className = "replacement-switch";
	switchTrack.setAttribute("aria-hidden", "true");
	const toggleLabel = document.createElement("span");
	toggleLabel.className = "replacement-toggle-label";
	toggle.append(enabled, switchTrack, toggleLabel);
	controls.append(toggle);

	const moveUp = createReplacementControl("\u2191", "Move replacement rule up", "replacement-up");
	const moveDown = createReplacementControl("\u2193", "Move replacement rule down", "replacement-down");
	const remove = createReplacementControl("\u00d7", "Remove replacement rule", "replacement-remove");
	controls.append(moveUp, moveDown, remove);
	toolbar.append(controls);
	pair.append(toolbar);

	const fields = document.createElement("div");
	fields.className = "field-grid replace-grid";
	pair.append(fields);
	fields.append(createReplacementField("Replace from", "Draft", `replacement-from-${pairId}`, "replacement-from", replacement.from));
	const arrow = document.createElement("div");
	arrow.className = "replace-arrow";
	arrow.setAttribute("aria-hidden", "true");
	arrow.textContent = "\u2192";
	fields.append(arrow);
	fields.append(createReplacementField("Replace with", "Published", `replacement-to-${pairId}`, "replacement-to", replacement.to));

	enabled.addEventListener("change", () => {
		updateReplacementPairControls();
		updateCopiedTitle();
		saveCopyInputs();
	});
	for (const input of pair.querySelectorAll(".replacement-from, .replacement-to")) {
		input.addEventListener("input", () => {
			updateCopiedTitle();
			saveCopyInputs();
		});
	}
	moveUp.addEventListener("click", () => moveReplacementPair(pair, -1));
	moveDown.addEventListener("click", () => moveReplacementPair(pair, 1));
	remove.addEventListener("click", () => {
		if (replacementPairsContainer.children.length <= 1) return;
		pair.remove();
		updateReplacementPairControls();
		updateCopiedTitle();
		saveCopyInputs();
	});
	return pair;
}

function createReplacementField(labelText, placeholder, id, className, value) {
	const label = document.createElement("label");
	label.className = "field";
	label.htmlFor = id;
	const fieldLabel = document.createElement("span");
	fieldLabel.className = "field-label";
	fieldLabel.textContent = labelText;
	const input = document.createElement("input");
	input.id = id;
	input.type = "text";
	input.placeholder = placeholder;
	input.autocomplete = "off";
	input.className = className;
	input.value = typeof value === "string" ? value : "";
	label.append(fieldLabel, input);
	return label;
}

function createReplacementControl(symbol, label, className) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = className;
	button.setAttribute("aria-label", label);
	button.title = label;
	button.textContent = symbol;
	return button;
}

function updateReplacementPairControls() {
	const pairs = Array.from(replacementPairsContainer.querySelectorAll(".replacement-pair"));
	pairs.forEach((pair, index) => {
		const enabled = pair.querySelector(".replacement-enabled").checked;
		pair.classList.toggle("is-disabled", !enabled);
		pair.querySelector(".replacement-order").textContent = `Rule ${index + 1}`;
		pair.querySelector(".replacement-toggle-label").textContent = enabled ? "On" : "Off";
		pair.querySelector(".replacement-from").disabled = !enabled;
		pair.querySelector(".replacement-to").disabled = !enabled;
		pair.querySelector(".replacement-up").disabled = index === 0;
		pair.querySelector(".replacement-down").disabled = index === pairs.length - 1;
		pair.querySelector(".replacement-remove").disabled = pairs.length === 1;
		pair.querySelector(".replacement-enabled").setAttribute("aria-label", `Enable rule ${index + 1}`);
		pair.querySelector(".replacement-up").setAttribute("aria-label", `Move rule ${index + 1} up`);
		pair.querySelector(".replacement-down").setAttribute("aria-label", `Move rule ${index + 1} down`);
		pair.querySelector(".replacement-remove").setAttribute("aria-label", `Remove rule ${index + 1}`);
	});
}

function moveReplacementPair(pair, direction) {
	const sibling = direction < 0 ? pair.previousElementSibling : pair.nextElementSibling;
	if (!sibling) return;
	if (direction < 0) {
		replacementPairsContainer.insertBefore(pair, sibling);
	} else {
		replacementPairsContainer.insertBefore(sibling, pair);
	}
	updateReplacementPairControls();
	updateCopiedTitle();
	saveCopyInputs();
}

function applyTitleReplacements(title, replacements = getReplacementPairs()) {
	for (const replacement of replacements) {
		if (replacement.enabled && replacement.from) {
			title = title.split(replacement.from).join(replacement.to);
		}
	}
	return title;
}

function updateCopiedTitle() {
	const title = applyTitleReplacements(currentSourceTitle);
	copiedTitle.textContent = currentSourceTitle
		? title || "Replacement would leave the title empty."
		: "Check pages to calculate title.";
	renderChildTitlePreview();
}

function renderChildPageList(pages, replacements) {
	const list = document.createElement("ul");
	list.className = "child-title-tree";
	for (const page of pages) {
		const item = document.createElement("li");
		const row = document.createElement("div");
		row.className = "child-title-row";
		const original = document.createElement("span");
		original.className = "child-title-original";
		original.textContent = page.title;
		const arrow = document.createElement("span");
		arrow.className = "child-title-arrow";
		arrow.setAttribute("aria-hidden", "true");
		arrow.textContent = "→";
		const replaced = document.createElement("strong");
		replaced.className = "child-title-replaced";
		replaced.textContent = applyTitleReplacements(page.title, replacements);
		row.append(original, arrow, replaced);
		item.append(row);
		if (page.children.length) item.append(renderChildPageList(page.children, replacements));
		list.append(item);
	}
	return list;
}

function renderChildTitlePreview() {
	childTitlePreview.hidden = !copyChildrenCheckbox.checked;
	childTitleTree.replaceChildren();
	if (!copyChildrenCheckbox.checked) return;
	if (!childPagesLoaded) {
		childTitleFeedback.textContent = "Check pages to load child page titles.";
		return;
	}
	if (!currentChildPages.length) {
		childTitleFeedback.textContent = "No child pages found.";
		return;
	}
	childTitleFeedback.textContent = "";
	childTitleTree.append(renderChildPageList(currentChildPages, getReplacementPairs()));
}

function clearCheckedPages() {
	currentSourceTitle = "";
	currentChildPages = [];
	childPagesLoaded = false;
	sourcePageTitle.textContent = "Not checked";
	destinationPageTitle.textContent = "Not checked";
	pageCheckFeedback.textContent = "Fetch page titles before copying.";
	updateCopiedTitle();
}

async function checkPages() {
	saveCopyInputs();
	const settings = readSettings();
	if (!settings?.baseUrl || !settings?.token) {
		pageCheckFeedback.textContent = "Add Confluence connection details in Settings first.";
		setActiveTab("settings");
		return;
	}

	const formData = new FormData(copyForm);
	let sourceId;
	let destinationId;
	try {
		sourceId = extractPageId(formData.get("sourceUrl"), new URL(settings.baseUrl));
		destinationId = extractPageId(formData.get("destinationUrl"), new URL(settings.baseUrl));
	} catch (error) {
		pageCheckFeedback.textContent = error.message;
		return;
	}

	checkPagesButton.disabled = true;
	checkPagesButton.textContent = "Checking...";
	pageCheckFeedback.textContent = copyChildrenCheckbox.checked
		? "Fetching page and child page titles..."
		: "Fetching page titles...";
	try {
		const pages = await localApiRequest("checkPages", settings, {
			sourceId,
			destinationId,
			includeChildren: copyChildrenCheckbox.checked,
		});
		if (!pages.sourceTitle || !pages.destinationTitle) {
			throw new Error("Confluence did not return both page titles.");
		}
		currentSourceTitle = pages.sourceTitle;
		currentChildPages = Array.isArray(pages.childPages) ? pages.childPages : [];
		childPagesLoaded = copyChildrenCheckbox.checked;
		sourcePageTitle.textContent = pages.sourceTitle;
		destinationPageTitle.textContent = pages.destinationTitle;
		const childCount = countChildPages(currentChildPages);
		pageCheckFeedback.textContent = childPagesLoaded
			? `Both pages found. ${childCount} child page${childCount === 1 ? "" : "s"} found.`
			: "Both pages found.";
		updateCopiedTitle();
	} catch (error) {
		clearCheckedPages();
		pageCheckFeedback.textContent = error.message;
	} finally {
		checkPagesButton.disabled = false;
		checkPagesButton.textContent = "Check pages";
	}
}

function countChildPages(pages) {
	return pages.reduce((count, page) => count + 1 + countChildPages(page.children), 0);
}

function showAuthFields() {
	const cloudAuth = authMode.value === "cloud";
	emailField.hidden = !cloudAuth;
	document.getElementById("account-email").required = cloudAuth;
}

function populateSettings() {
	const settings = readSettings();
	const connectionDetails = readConnectionDetails();
	document.getElementById("base-url").value = settings?.baseUrl || connectionDetails?.baseUrl || "";
	document.getElementById("auth-mode").value = settings?.authMode || "cloud";
	document.getElementById("account-email").value = settings?.email || connectionDetails?.email || "";
	saveTokenCheckbox.checked = settings?.saveTokenBetweenSessions ?? connectionDetails?.saveTokenBetweenSessions === true;
	document.getElementById("api-token").value = settings?.token || (saveTokenCheckbox.checked ? connectionDetails?.token : "") || "";
	document.getElementById("allow-self-signed-cert").checked = settings?.allowSelfSignedCert === true;
	updateSecurityNote();
	showAuthFields();
	updateConnectionLabel();
}

function normalizeBaseUrl(value) {
	const baseUrl = new URL(value.trim());
	if (baseUrl.protocol !== "https:" && baseUrl.hostname !== "localhost" && baseUrl.hostname !== "127.0.0.1") {
		throw new Error("Use HTTPS for the Confluence connection.");
	}
	baseUrl.search = "";
	baseUrl.hash = "";
	return baseUrl.toString().replace(/\/$/, "");
}

function extractPageId(value, baseUrl) {
	let pageUrl;
	try {
		pageUrl = new URL(value.trim());
	} catch {
		throw new Error("Enter a complete source and destination page URL.");
	}

	if (pageUrl.origin !== baseUrl.origin) {
		throw new Error("Source and destination URLs must be from the configured Confluence site.");
	}

	const pageId = pageUrl.searchParams.get("pageId") ||
		pageUrl.searchParams.get("contentId") ||
		pageUrl.pathname.match(/\/pages\/(\d+)(?:\/|$)/)?.[1];
	if (!pageId || !/^\d+$/.test(pageId)) {
		throw new Error("Could not find a page ID in one of the URLs. Use a /pages/{id} or pageId URL.");
	}
	return pageId;
}

async function localApiRequest(action, settings, parameters = {}) {
	let response;
	try {
		response = await fetch("/api/confluence", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				action,
				baseUrl: settings.baseUrl,
				authMode: settings.authMode,
				email: settings.email,
				token: settings.token,
				allowSelfSignedCert: settings.allowSelfSignedCert === true,
				...parameters,
			}),
		});
	} catch (error) {
		if (error instanceof TypeError) {
			throw new Error("Could not reach the local API. Restart the Node.js server and try again.");
		}
		throw error;
	}

	let result;
	try {
		result = await response.json();
	} catch {
		throw new Error("The local API returned an invalid response.");
	}
	if (!response.ok) {
		throw new Error(result.error || `Local API returned ${response.status}.`);
	}
	return result;
}

async function testConnection() {
	const formData = new FormData(settingsForm);
	let settings;
	try {
		settings = {
			baseUrl: normalizeBaseUrl(formData.get("baseUrl")),
			authMode: formData.get("authMode"),
			email: String(formData.get("email") || "").trim(),
			token: String(formData.get("token") || "").trim(),
			allowSelfSignedCert: formData.get("allowSelfSignedCert") === "on",
		};
		if (!settings.token) throw new Error("Enter an API token before testing the connection.");
		if (settings.authMode === "cloud" && !settings.email) throw new Error("Enter the Atlassian account email before testing.");
	} catch (error) {
		settingsFeedback.textContent = error.message;
		return;
	}

	testConnectionButton.disabled = true;
	testConnectionButton.textContent = "Testing...";
	settingsFeedback.textContent = "Testing Confluence connection...";
	try {
		const result = await localApiRequest("testConnection", settings);
		settingsFeedback.textContent = `Connected to Confluence as ${result.displayName}.`;
	} catch (error) {
		settingsFeedback.textContent = error.message;
	} finally {
		testConnectionButton.disabled = false;
		testConnectionButton.textContent = "Test Connection";
	}
}

tabs.forEach((tab) => tab.addEventListener("click", () => setActiveTab(tab.dataset.tab)));
authMode.addEventListener("change", showAuthFields);
fontSizeRange.addEventListener("input", () => setFontSize(fontSizeRange.value));
testConnectionButton.addEventListener("click", testConnection);
checkPagesButton.addEventListener("click", checkPages);
document.getElementById("source-url").addEventListener("input", clearCheckedPages);
document.getElementById("destination-url").addEventListener("input", clearCheckedPages);
addReplacementButton.addEventListener("click", () => {
	replacementPairsContainer.append(createReplacementPair());
	updateReplacementPairControls();
	updateCopiedTitle();
	saveCopyInputs();
	replacementPairsContainer.lastElementChild.querySelector(".replacement-from").focus();
});
copyChildrenCheckbox.addEventListener("change", () => {
	saveCopyInputs();
	renderChildTitlePreview();
	if (copyChildrenCheckbox.checked && currentSourceTitle && !childPagesLoaded) checkPages();
});
saveTokenCheckbox.addEventListener("change", updateSecurityNote);

settingsForm.addEventListener("submit", (event) => {
	event.preventDefault();
	const formData = new FormData(settingsForm);
	try {
		const settings = {
			baseUrl: normalizeBaseUrl(formData.get("baseUrl")),
			authMode: formData.get("authMode"),
			email: String(formData.get("email")).trim(),
			token: String(formData.get("token")).trim(),
			saveTokenBetweenSessions: saveTokenCheckbox.checked,
			allowSelfSignedCert: formData.get("allowSelfSignedCert") === "on",
		};
		if (!settings.token) throw new Error("Enter an API token.");
		if (settings.authMode === "cloud" && !settings.email) throw new Error("Enter the Atlassian account email for this token.");
		sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
		const connectionDetailsSaved = saveConnectionDetails(settings);
		settingsFeedback.textContent = settings.saveTokenBetweenSessions && !connectionDetailsSaved
			? "Settings saved for this browser session, but local storage is unavailable so the token will not persist."
			: settings.saveTokenBetweenSessions
				? "Settings and API token saved between sessions."
				: "Settings saved for this browser session.";
		updateConnectionLabel();
	} catch (error) {
		settingsFeedback.textContent = error.message;
	}
});

copyForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	statusMessage.hidden = true;
	const settings = readSettings();
	if (!settings?.baseUrl || !settings?.token) {
		showStatus("error", "Connection settings needed", "Open Settings and add your Confluence URL and credentials first.");
		setActiveTab("settings");
		return;
	}

	const formData = new FormData(copyForm);
	let sourceId;
	let destinationId;
	try {
		sourceId = extractPageId(formData.get("sourceUrl"), new URL(settings.baseUrl));
		destinationId = extractPageId(formData.get("destinationUrl"), new URL(settings.baseUrl));
	} catch (error) {
		showStatus("error", "Check the page URLs", error.message);
		return;
	}

	copyButton.disabled = true;
	copyButton.querySelector("span:first-child").textContent = "Copying...";
	try {
		const result = await localApiRequest("copyPage", settings, {
			sourceId,
			destinationId,
			replacements: getReplacementPairs(),
			copyChildren: formData.get("copyChildren") === "on",
		});
		currentSourceTitle = result.sourceTitle || currentSourceTitle;
		sourcePageTitle.textContent = currentSourceTitle || "Page found";
		destinationPageTitle.textContent = result.destinationTitle || "Page found";
		pageCheckFeedback.textContent = "Both pages found.";
		updateCopiedTitle();
		const childSummary = result.copiedChildCount ? ` Included ${result.copiedChildCount} child pages.` : "";
		showStatus("success", "Page copied", result.webUrl ? `${result.title} · ${result.webUrl}${childSummary}` : `Created “${result.title}” beneath the selected parent.${childSummary}`);
	} catch (error) {
		showStatus("error", "Copy failed", error.message);
	} finally {
		copyButton.disabled = false;
		copyButton.querySelector("span:first-child").textContent = "Copy page";
	}
});

populateSettings();
renderReplacementPairs([]);
restoreCopyInputs();
showAuthFields();
setFontSize(sessionStorage.getItem(FONT_SIZE_KEY) || fontSizeRange.value);
