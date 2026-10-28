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

	if (request.method !== "GET" && request.method !== "HEAD") {
		response.setHeader("Allow", "GET, HEAD");
		sendError(response, 405, "Method not allowed");
		return;
	}

	let requestPath;
	try {
		requestPath = new URL(request.url, "http://localhost").pathname;
	} catch {
		sendError(response, 400, "Bad request");
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
