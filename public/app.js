const SETTINGS_KEY = "page-relay-settings";

const tabs = Array.from(document.querySelectorAll("[data-tab]"));
const panels = {
	copy: document.getElementById("copy-panel"),
	settings: document.getElementById("settings-panel"),
};
const copyForm = document.getElementById("copy-form");
const settingsForm = document.getElementById("settings-form");
const copyButton = document.getElementById("copy-button");
const statusMessage = document.getElementById("status-message");
const statusTitle = document.getElementById("status-title");
const statusDetail = document.getElementById("status-detail");
const authMode = document.getElementById("auth-mode");
const emailField = document.getElementById("email-field");
const settingsFeedback = document.getElementById("settings-feedback");

function readSettings() {
	try {
		return JSON.parse(sessionStorage.getItem(SETTINGS_KEY) || "null");
	} catch {
		return null;
	}
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

function showAuthFields() {
	const cloudAuth = authMode.value === "cloud";
	emailField.hidden = !cloudAuth;
	document.getElementById("account-email").required = cloudAuth;
}

function populateSettings() {
	const settings = readSettings();
	if (!settings) return;
	document.getElementById("base-url").value = settings.baseUrl || "";
	document.getElementById("auth-mode").value = settings.authMode || "cloud";
	document.getElementById("account-email").value = settings.email || "";
	document.getElementById("api-token").value = settings.token || "";
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

function makeAuthHeader(settings) {
	if (settings.authMode === "bearer") {
		return `Bearer ${settings.token}`;
	}
	return `Basic ${btoa(`${settings.email}:${settings.token}`)}`;
}

async function confluenceRequest(settings, endpoint, options = {}) {
	let response;
	try {
		response = await fetch(`${settings.baseUrl}${endpoint}`, {
			...options,
			headers: {
				Accept: "application/json",
				Authorization: makeAuthHeader(settings),
				...(options.body ? { "Content-Type": "application/json" } : {}),
				...options.headers,
			},
		});
	} catch (error) {
		if (error instanceof TypeError) {
			throw new Error("Could not reach Confluence. Check the URL and browser CORS settings for this site.");
		}
		throw error;
	}

	if (!response.ok) {
		let detail = "";
		try {
			const body = await response.json();
			detail = body.message || body.errorMessage || JSON.stringify(body);
		} catch {
			detail = response.statusText;
		}
		throw new Error(`Confluence returned ${response.status}${detail ? `: ${detail}` : ""}`);
	}
	return response;
}

tabs.forEach((tab) => tab.addEventListener("click", () => setActiveTab(tab.dataset.tab)));
authMode.addEventListener("change", showAuthFields);

settingsForm.addEventListener("submit", (event) => {
	event.preventDefault();
	const formData = new FormData(settingsForm);
	try {
		const settings = {
			baseUrl: normalizeBaseUrl(formData.get("baseUrl")),
			authMode: formData.get("authMode"),
			email: String(formData.get("email")).trim(),
			token: String(formData.get("token")).trim(),
		};
		if (!settings.token) throw new Error("Enter an API token.");
		if (settings.authMode === "cloud" && !settings.email) throw new Error("Enter the Atlassian account email for this token.");
		sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
		settingsFeedback.textContent = "Settings saved for this browser session.";
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
		const sourceResponse = await confluenceRequest(settings, `/rest/api/content/${encodeURIComponent(sourceId)}?expand=space,body.storage`);
		const sourcePage = await sourceResponse.json();
		if (!sourcePage.title || typeof sourcePage.body?.storage?.value !== "string") {
			throw new Error("Confluence did not return the source page title and storage-format content.");
		}
		const destinationResponse = await confluenceRequest(settings, `/rest/api/content/${encodeURIComponent(destinationId)}?expand=space`);
		const destinationPage = await destinationResponse.json();
		if (!destinationPage.space?.key) throw new Error("Confluence did not return the destination page's space.");

		const replaceFrom = String(formData.get("replaceFrom") || "");
		const replaceTo = String(formData.get("replaceTo") || "");
		const title = replaceFrom ? sourcePage.title.split(replaceFrom).join(replaceTo) : sourcePage.title;
		if (!title.trim()) throw new Error("The title replacement cannot leave the page title empty.");
		const copyResponse = await confluenceRequest(settings, "/rest/api/content/", {
			method: "POST",
			body: JSON.stringify({
				type: "page",
				title,
				space: { key: destinationPage.space.key },
				ancestors: [{ id: destinationId }],
				body: {
					storage: {
						value: sourcePage.body.storage.value,
						representation: "storage",
					},
				},
			}),
		});
		const copiedPage = await copyResponse.json();
		const copiedUrl = copiedPage._links?.webui
			? new URL(copiedPage._links.webui, settings.baseUrl).toString()
			: "";
		showStatus("success", "Page copied", copiedUrl ? `${title} · ${copiedUrl}` : `Created “${title}” beneath the selected parent.`);
	} catch (error) {
		showStatus("error", "Copy failed", error.message);
	} finally {
		copyButton.disabled = false;
		copyButton.querySelector("span:first-child").textContent = "Copy page";
	}
});

populateSettings();
showAuthFields();
