const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const publicDirectory = path.resolve(__dirname, "public");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);

const contentTypes = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
	".webp": "image/webp",
};

function isWithinDirectory(directory, candidate) {
	const relativePath = path.relative(directory, candidate);
	return relativePath === "" ||
		(!relativePath.startsWith(`..${path.sep}`) &&
			relativePath !== ".." &&
			!path.isAbsolute(relativePath));
}

function sendError(response, statusCode, message) {
	response.writeHead(statusCode, {
		"Content-Type": "text/plain; charset=utf-8",
		"X-Content-Type-Options": "nosniff",
	});
	response.end(message);
}

function sendJson(response, statusCode, data) {
	response.writeHead(statusCode, {
		"Cache-Control": "no-store",
		"Content-Type": "application/json; charset=utf-8",
		"X-Content-Type-Options": "nosniff",
	});
	response.end(JSON.stringify(data));
}

function isLocalApiRequest(request) {
	const address = request.socket.remoteAddress || "";
	const normalizedAddress = address.startsWith("::ffff:") ? address.slice(7) : address;
	if (normalizedAddress !== "127.0.0.1" && normalizedAddress !== "::1") return false;

	let hostUrl;
	try {
		hostUrl = new URL(`http://${request.headers.host}`);
	} catch {
		return false;
	}
	if (hostUrl.hostname !== "localhost" && hostUrl.hostname !== "127.0.0.1") return false;

	if (!request.headers.origin) return true;
	try {
		const originUrl = new URL(request.headers.origin);
		return originUrl.protocol === "http:" && originUrl.origin === hostUrl.origin;
	} catch {
		return false;
	}
}

async function readJsonBody(request) {
	if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
		const error = new Error("Content-Type must be application/json.");
		error.statusCode = 415;
		throw error;
	}

	const chunks = [];
	let bodySize = 0;
	for await (const chunk of request) {
		bodySize += chunk.length;
		if (bodySize > 1024 * 1024) {
			const error = new Error("Request body is too large.");
			error.statusCode = 413;
			throw error;
		}
		chunks.push(chunk);
	}

	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		const error = new Error("Request body must contain valid JSON.");
		error.statusCode = 400;
		throw error;
	}
}

function getConfluenceSettings(body) {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new Error("Request body must be a JSON object.");
	}
	if (typeof body.baseUrl !== "string" || typeof body.token !== "string" || !body.token.trim()) {
		throw new Error("Confluence URL and API token are required.");
	}

	let baseUrl;
	try {
		baseUrl = new URL(body.baseUrl);
	} catch {
		throw new Error("Confluence URL is invalid.");
	}
	const localHttp = baseUrl.protocol === "http:" &&
		(baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1");
	if ((baseUrl.protocol !== "https:" && !localHttp) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
		throw new Error("Confluence URL must use HTTPS and cannot contain credentials, a query, or a fragment.");
	}

	if (body.authMode !== "cloud" && body.authMode !== "bearer") {
		throw new Error("Authentication mode must be cloud or bearer.");
	}
	const email = typeof body.email === "string" ? body.email.trim() : "";
	if (body.authMode === "cloud" && !email) {
		throw new Error("Account email is required for Cloud authentication.");
	}

	return {
		baseUrl: baseUrl.toString().replace(/\/$/, ""),
		authMode: body.authMode,
		email,
		token: body.token,
	};
}

function pageId(value, label) {
	if (typeof value !== "string" || !/^\d+$/.test(value)) {
		throw new Error(`${label} must be a numeric Confluence page ID.`);
	}
	return value;
}

function authorizationHeader(settings) {
	if (settings.authMode === "bearer") return `Bearer ${settings.token}`;
	return `Basic ${Buffer.from(`${settings.email}:${settings.token}`).toString("base64")}`;
}

async function confluenceRequest(settings, endpoint, options = {}) {
	let response;
	try {
		response = await fetch(`${settings.baseUrl}/${endpoint}`, {
			...options,
			redirect: "manual",
			headers: {
				Accept: "application/json",
				Authorization: authorizationHeader(settings),
				...(options.body ? { "Content-Type": "application/json" } : {}),
			},
		});
	} catch {
		throw new Error("Could not reach Confluence. Check the URL and network connection.");
	}

	if (!response.ok) {
		let detail = response.statusText;
		try {
			const body = await response.json();
			detail = body.message || body.errorMessage || detail;
		} catch {
			// Use the status text when Confluence does not return JSON.
		}
		throw new Error(`Confluence returned ${response.status}${detail ? `: ${String(detail).slice(0, 500)}` : ""}`);
	}

	try {
		return await response.json();
	} catch {
		throw new Error("Confluence returned an invalid JSON response.");
	}
}

async function handleConfluenceApi(request, response) {
	if (!isLocalApiRequest(request)) {
		sendJson(response, 403, { error: "Local API requests must come from this machine and origin." });
		return;
	}
	if (request.method !== "POST") {
		response.setHeader("Allow", "POST");
		sendJson(response, 405, { error: "Method not allowed." });
		return;
	}

	try {
		const body = await readJsonBody(request);
		const settings = getConfluenceSettings(body);
		if (body.action === "checkPages") {
			const sourceId = pageId(body.sourceId, "Source page ID");
			const destinationId = pageId(body.destinationId, "Destination page ID");
			const [sourcePage, destinationPage] = await Promise.all([
				confluenceRequest(settings, `rest/api/content/${sourceId}?expand=title`),
				confluenceRequest(settings, `rest/api/content/${destinationId}?expand=title`),
			]);
			if (!sourcePage.title || !destinationPage.title) {
				throw new Error("Confluence did not return both page titles.");
			}
			sendJson(response, 200, {
				sourceTitle: sourcePage.title,
				destinationTitle: destinationPage.title,
			});
			return;
		}

		if (body.action === "copyPage") {
			const sourceId = pageId(body.sourceId, "Source page ID");
			const destinationId = pageId(body.destinationId, "Destination page ID");
			const [sourcePage, destinationPage] = await Promise.all([
				confluenceRequest(settings, `rest/api/content/${sourceId}?expand=space,body.storage`),
				confluenceRequest(settings, `rest/api/content/${destinationId}?expand=space,title`),
			]);
			if (!sourcePage.title || typeof sourcePage.body?.storage?.value !== "string") {
				throw new Error("Confluence did not return source page storage-format content.");
			}
			if (!destinationPage.space?.key) {
				throw new Error("Confluence did not return the destination page's space.");
			}

			const replaceFrom = typeof body.replaceFrom === "string" ? body.replaceFrom : "";
			const replaceTo = typeof body.replaceTo === "string" ? body.replaceTo : "";
			const title = replaceFrom ? sourcePage.title.split(replaceFrom).join(replaceTo) : sourcePage.title;
			if (!title.trim()) throw new Error("The title replacement cannot leave the page title empty.");

			const copiedPage = await confluenceRequest(settings, "rest/api/content/", {
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
			const webui = copiedPage._links?.webui;
			const webUrl = typeof webui === "string"
				? webui.startsWith("http")
					? webui
					: `${settings.baseUrl}${webui.startsWith("/") ? webui : `/${webui}`}`
				: "";
			sendJson(response, 200, {
				id: copiedPage.id,
				title,
				sourceTitle: sourcePage.title,
				destinationTitle: destinationPage.title,
				webUrl,
			});
			return;
		}

		sendJson(response, 400, { error: "Unsupported Confluence action." });
	} catch (error) {
		sendJson(response, error.statusCode || 502, { error: error.message || "Confluence request failed." });
	}
}

async function findPublicFile(requestPath, realPublicDirectory) {
	let decodedPath;
	try {
		decodedPath = decodeURIComponent(requestPath);
	} catch {
		return { statusCode: 400 };
	}

	if (decodedPath.includes("\0") || decodedPath.includes("\\")) {
		return { statusCode: 400 };
	}

	const candidate = path.resolve(publicDirectory, `.${decodedPath}`);
	if (!isWithinDirectory(publicDirectory, candidate)) {
		return { statusCode: 403 };
	}

	try {
		let realPath = await fs.promises.realpath(candidate);
		if (!isWithinDirectory(realPublicDirectory, realPath)) {
			return { statusCode: 404 };
		}

		let fileInfo = await fs.promises.stat(realPath);
		if (fileInfo.isDirectory()) {
			realPath = await fs.promises.realpath(path.join(realPath, "index.html"));
			if (!isWithinDirectory(realPublicDirectory, realPath)) {
				return { statusCode: 404 };
			}
			fileInfo = await fs.promises.stat(realPath);
		}

		if (!fileInfo.isFile()) {
			return { statusCode: 404 };
		}

		return { fileInfo, realPath };
	} catch (error) {
		if (error.code === "ENOENT" || error.code === "ENOTDIR") {
			return { statusCode: 404 };
		}
		throw error;
	}
}

async function handleRequest(request, response, realPublicDirectory) {
	response.setHeader("X-Content-Type-Options", "nosniff");

	let requestPath;
	try {
		requestPath = new URL(request.url, "http://localhost").pathname;
	} catch {
		sendError(response, 400, "Bad request");
		return;
	}
	if (requestPath === "/api/confluence") {
		await handleConfluenceApi(request, response);
		return;
	}

	if (request.method !== "GET" && request.method !== "HEAD") {
		response.setHeader("Allow", "GET, HEAD");
		sendError(response, 405, "Method not allowed");
		return;
	}

	const result = await findPublicFile(requestPath, realPublicDirectory);
	if (result.statusCode) {
		sendError(response, result.statusCode, result.statusCode === 400 ? "Bad request" : "Not found");
		return;
	}

	response.writeHead(200, {
		"Content-Length": result.fileInfo.size,
		"Content-Type": contentTypes[path.extname(result.realPath).toLowerCase()] || "application/octet-stream",
	});

	if (request.method === "HEAD") {
		response.end();
		return;
	}

	const fileStream = fs.createReadStream(result.realPath);
	fileStream.on("error", () => {
		if (!response.headersSent) {
			sendError(response, 500, "Internal server error");
		} else {
			response.destroy();
		}
	});
	fileStream.pipe(response);
}

async function startServer() {
	const realPublicDirectory = await fs.promises.realpath(publicDirectory);
	const server = http.createServer((request, response) => {
		handleRequest(request, response, realPublicDirectory).catch(() => {
			if (!response.headersSent) {
				sendError(response, 500, "Internal server error");
			} else {
				response.destroy();
			}
		});
	});

	server.listen(port, host, () => {
		console.log(`Serving ${publicDirectory} at http://${host}:${port}`);
	});
}

startServer().catch((error) => {
	console.error(`Unable to start server: ${error.message}`);
	process.exitCode = 1;
});
