const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3002;
const clients = new Set();
const messages = [];

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
        }, i * 10);
    }

    setTimeout(() => {
        const endMessage = {
            type: 'message_end',
            messageId: messageId
        };
        sendToAllClients(endMessage);
    }, message.length * 10);
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