/**
 * Copix Core dev server — OpenAI-compatible placeholder until your trained model is ready.
 * Replace the /chat/completions handler with your real inference stack.
 *
 * Usage: node copix-core/dev-server.mjs
 */
import http from 'node:http';

const PORT = 8765;
const MODEL = 'copix-core';

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

	if (req.method === 'GET' && url.pathname === '/v1/models') {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ data: [{ id: MODEL }] }));
		return;
	}

	if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
		let body = '';
		for await (const chunk of req) body += chunk;
		let parsed;
		try { parsed = JSON.parse(body); } catch {
			res.writeHead(400); res.end('bad json'); return;
		}

		const userMsg = [...(parsed.messages ?? [])].reverse().find(m => m.role === 'user');
		const text = userMsg?.content ?? '';

		res.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
		});

		const reply = parsed.tools?.length
			? `I'm Copix Core (dev placeholder). Wire your trained weights here. For now I can't call tools — train and deploy your model, or extend dev-server.mjs.\n\nYou said: ${text.slice(0, 200)}`
			: `Copix Core dev server is running. Train your model and point inference here.\n\nYou said: ${text.slice(0, 300)}`;

		const chunk = {
			choices: [{ delta: { content: reply }, finish_reason: null }],
		};
		res.write(`data: ${JSON.stringify(chunk)}\n\n`);
		res.write('data: [DONE]\n\n');
		res.end();
		return;
	}

	res.writeHead(404);
	res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
	console.log(`Copix Core dev server http://127.0.0.1:${PORT}/v1`);
});
