class ChatClient {
    constructor() {
        this.eventSource = null;
        this.username = null;
        this.chatContainer = document.getElementById('chat-container');
        this.messageForm = document.getElementById('message-form');
        this.messageInput = document.getElementById('message-input');
        this.connectionStatus = document.getElementById('connection-status');
        
        this.init();
    }

    init() {
        this.username = this.getUsername();
        this.setupEventListeners();
        this.connect();
    }

    getUsername() {
        let username = localStorage.getItem('chat-username');
        if (!username) {
            username = prompt('Enter your username:');
            if (!username || username.trim() === '') {
                username = 'Anonymous';
            }
            localStorage.setItem('chat-username', username);
        }
        return username;
    }

    setupEventListeners() {
        this.messageForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.sendMessage();
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && (!this.eventSource || this.eventSource.readyState === EventSource.CLOSED)) {
                this.connect();
            }
        });
    }

    connect() {
        if (this.eventSource) {
            this.eventSource.close();
        }

        this.updateConnectionStatus('Connecting...', 'disconnected');

        this.eventSource = new EventSource('/events');

        this.eventSource.onopen = () => {
            console.log('SSE connection opened');
            this.updateConnectionStatus('Connected', 'connected');
        };

        this.eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.displayMessage(data);
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        };

        this.eventSource.onerror = (error) => {
            console.error('SSE error:', error);
            this.updateConnectionStatus('Connection Error - Retrying...', 'disconnected');
            
            setTimeout(() => {
                if (this.eventSource.readyState === EventSource.CLOSED) {
                    this.connect();
                }
            }, 3000);
        };
    }

    updateConnectionStatus(message, className) {
        this.connectionStatus.textContent = message;
        this.connectionStatus.className = className;
    }

    async sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message) return;

        try {
            const response = await fetch('/send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    username: this.username
                })
            });

            if (response.ok) {
                this.messageInput.value = '';
            } else {
                console.error('Failed to send message');
                alert('Failed to send message. Please try again.');
            }
        } catch (error) {
            console.error('Error sending message:', error);
            alert('Error sending message. Please check your connection.');
        }
    }

    displayMessage(data) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message';

        const timestamp = new Date(data.timestamp).toLocaleTimeString();

        switch (data.type) {
            case 'system':
                messageDiv.className += ' system-message';
                messageDiv.innerHTML = `<em>${data.message}</em> <small>(${timestamp})</small>`;
                break;
            case 'message':
                const isOwnMessage = data.username === this.username;
                messageDiv.className += isOwnMessage ? ' user-message' : ' other-message';
                messageDiv.innerHTML = `
                    <strong>${this.escapeHtml(data.username)}:</strong> 
                    ${this.escapeHtml(data.message)} 
                    <small>(${timestamp})</small>
                `;
                break;
            default:
                console.warn('Unknown message type:', data.type);
                return;
        }

        this.chatContainer.appendChild(messageDiv);
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    disconnect() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        this.updateConnectionStatus('Disconnected', 'disconnected');
    }
}

window.addEventListener('load', () => {
    window.chatClient = new ChatClient();
});

window.addEventListener('beforeunload', () => {
    if (window.chatClient) {
        window.chatClient.disconnect();
    }
});