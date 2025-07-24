const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3002;
const clients = new Set();
const messages = [];

// Keep-alive configuration
const KEEP_ALIVE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const KEEP_ALIVE_INTERVAL = 14 * 60 * 1000; // 14 minutes in milliseconds

function keepAlive() {
    const urlObj = new URL(KEEP_ALIVE_URL);
    const isHttps = urlObj.protocol === 'https:';
    const requestModule = isHttps ? https : http;
    
    const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: '/',
        method: 'GET',
        timeout: 30000
    };

    const req = requestModule.request(options, (res) => {
        console.log(`Keep-alive ping successful: ${res.statusCode}`);
        res.on('data', () => {}); // Consume response data
    });

    req.on('error', (error) => {
        console.error('Keep-alive ping failed:', error.message);
    });

    req.on('timeout', () => {
        console.error('Keep-alive ping timed out');
        req.destroy();
    });

    req.end();
}

// Start keep-alive only in production (when RENDER_EXTERNAL_URL is set)
if (process.env.RENDER_EXTERNAL_URL) {
    setInterval(keepAlive, KEEP_ALIVE_INTERVAL);
    console.log(`Keep-alive enabled: pinging ${KEEP_ALIVE_URL} every ${KEEP_ALIVE_INTERVAL / 1000 / 60} minutes`);
}

function sendToAllClients(data) {
    const eventData = `data: ${JSON.stringify(data)}\n\n`;
    clients.forEach(client => {
        try {
            client.write(eventData);
        } catch (error) {
            console.error('Error sending to client:', error);
            clients.delete(client);
        }
    });
}

function sendCharacterByCharacter(chatMessage) {
    const messageId = Date.now().toString();
    const username = chatMessage.username;
    const timestamp = chatMessage.timestamp;
    const message = chatMessage.message;
    
    const headerMessage = {
        type: 'message_start',
        messageId: messageId,
        username: username,
        timestamp: timestamp
    };
    
    sendToAllClients(headerMessage);
    
    for (let i = 0; i < message.length; i++) {
        setTimeout(() => {
            const charMessage = {
                type: 'message_char',
                messageId: messageId,
                char: message[i]
            };
            sendToAllClients(charMessage);
        }, i * 20);
    }

    setTimeout(() => {
        const endMessage = {
            type: 'message_end',
            messageId: messageId
        };
        sendToAllClients(endMessage);
    }, message.length * 20);
}

function serveFile(res, filePath) {
    const ext = path.extname(filePath);
    const contentType = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css'
    }[ext] || 'text/plain';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('File not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    if (req.method === 'GET') {
        if (pathname === '/') {
            serveFile(res, path.join(__dirname, 'index.html'));
        } else if (pathname === '/chat.js') {
            serveFile(res, path.join(__dirname, 'chat.js'));
        } else if (pathname === '/events') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Cache-Control'
            });

            clients.add(res);
            console.log(`Client connected. Total clients: ${clients.size}`);

            res.write(`data: ${JSON.stringify({
                type: 'system',
                message: 'Connected to chat',
                timestamp: new Date().toISOString()
            })}\n\n`);

            messages.forEach(msg => {
                res.write(`data: ${JSON.stringify(msg)}\n\n`);
            });

            req.on('close', () => {
                clients.delete(res);
                console.log(`Client disconnected. Total clients: ${clients.size}`);
            });
        } else {
            res.writeHead(404);
            res.end('Not found');
        }
    } else if (req.method === 'POST' && pathname === '/send') {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
        });
        
        req.on('end', () => {
            try {
                const { message, username } = JSON.parse(body);
                
                if (!message || !username) {
                    res.writeHead(400);
                    res.end('Missing message or username');
                    return;
                }

                const chatMessage = {
                    type: 'message',
                    message: message.trim(),
                    username: username.trim(),
                    timestamp: new Date().toISOString()
                };

                messages.push(chatMessage);
                if (messages.length > 100) {
                    messages.shift();
                }

                sendCharacterByCharacter(chatMessage);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error('Error processing message:', error);
                res.writeHead(400);
                res.end('Invalid JSON');
            }
        });
    } else {
        res.writeHead(405);
        res.end('Method not allowed');
    }
});

server.listen(PORT, () => {
    console.log(`Chat server running on http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    clients.forEach(client => {
        try {
            client.end();
        } catch (error) {
            console.error('Error closing client connection:', error);
        }
    });
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});