// Viewer JavaScript for Stream Lightning
// Handles receiving WebRTC stream and real-time communication

const socket = io();
let peerConnection = null;
let roomId = null;
let username = null;
let latencyInterval = null;
let latencyValues = [];

// ICE Server configuration
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
    // Get room ID from URL
    const pathParts = window.location.pathname.split('/');
    roomId = pathParts[pathParts.length - 1];
    
    // Get username from URL params
    const urlParams = new URLSearchParams(window.location.search);
    username = urlParams.get('name') || 'Viewer';
    
    document.getElementById('roomName').textContent = roomId;
    
    // Join room
    socket.emit('join_room', { 
        room_id: roomId,
        username: username
    });
    
    // Start latency monitoring
    startLatencyMonitoring();
});

// Socket event handlers
socket.on('room_joined', (data) => {
    console.log('Joined room:', data.room_id);
    document.getElementById('viewerCount').textContent = data.viewer_count;
    document.getElementById('streamStatus').textContent = 'WAITING';
});

socket.on('viewer_joined', (data) => {
    document.getElementById('viewerCount').textContent = data.viewer_count;
});

socket.on('viewer_left', (data) => {
    document.getElementById('viewerCount').textContent = data.viewer_count;
});

socket.on('stream_started', (data) => {
    console.log('Stream started');
    document.getElementById('streamStatus').textContent = 'LIVE';
});

socket.on('stream_stopped', (data) => {
    console.log('Stream stopped');
    document.getElementById('streamStatus').textContent = 'ENDED';
    document.getElementById('waitingMessage').style.display = 'flex';
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
});

socket.on('stream_ended', (data) => {
    alert(data.message);
    window.location.href = '/';
});

socket.on('offer', async (data) => {
    console.log('Received offer from host');
    await handleOffer(data.offer, data.sender_id);
});

socket.on('ice_candidate', async (data) => {
    if (peerConnection && data.candidate) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
});

socket.on('chat_message', (data) => {
    addChatMessage(data.username, data.message, false, data.timestamp);
});

socket.on('latency_pong', (data) => {
    const latency = Date.now() - data.timestamp;
    updateLatencyDisplay(latency);
});

socket.on('error', (data) => {
    alert(data.message);
    window.location.href = '/';
});

// Handle incoming offer
async function handleOffer(offer, hostId) {
    // Create peer connection
    peerConnection = new RTCPeerConnection(configuration);
    
    // Handle incoming stream
    peerConnection.ontrack = (event) => {
        console.log('Received remote stream');
        const remoteVideo = document.getElementById('remoteVideo');
        remoteVideo.srcObject = event.streams[0];
        document.getElementById('waitingMessage').style.display = 'none';
        document.getElementById('streamStatus').textContent = 'LIVE';
    };
    
    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice_candidate', {
                target_id: hostId,
                candidate: event.candidate
            });
        }
    };
    
    // Monitor connection state
    peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
        updateConnectionInfo();
        
        if (peerConnection.connectionState === 'disconnected' || 
            peerConnection.connectionState === 'failed') {
            document.getElementById('streamStatus').textContent = 'DISCONNECTED';
        }
    };
    
    // Set remote description and create answer
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    // Send answer back to host
    socket.emit('answer', {
        room_id: roomId,
        target_id: hostId,
        answer: answer
    });
    
    console.log('Answer sent to host');
}

// Chat functionality
function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (message) {
        socket.emit('chat_message', {
            room_id: roomId,
            username: username,
            message: message
        });
        input.value = '';
    }
}

function handleChatKeypress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

function addChatMessage(user, message, isSystem = false, timestamp = null) {
    const messagesDiv = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    if (isSystem) {
        messageDiv.style.background = 'rgba(102, 126, 234, 0.2)';
    }
    
    const time = timestamp || new Date().toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
    
    messageDiv.innerHTML = `
        <div class="message-user">${user}<span class="message-time">${time}</span></div>
        <div>${message}</div>
    `;
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Latency monitoring
function startLatencyMonitoring() {
    latencyInterval = setInterval(() => {
        socket.emit('latency_ping', { timestamp: Date.now() });
    }, 2000);
}

function updateLatencyDisplay(latency) {
    latencyValues.push(latency);
    if (latencyValues.length > 10) {
        latencyValues.shift();
    }
    
    const avgLatency = Math.round(latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length);
    
    const displayElement = document.getElementById('latencyDisplay');
    displayElement.textContent = `${avgLatency}`;
    
    const avgElement = document.getElementById('avgLatency');
    avgElement.textContent = `${avgLatency} ms`;
    
    // Color code based on latency
    if (avgLatency < 100) {
        avgElement.className = 'latency-good';
    } else if (avgLatency < 250) {
        avgElement.className = 'latency-medium';
    } else {
        avgElement.className = 'latency-bad';
    }
}

// Tab switching
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.style.display = 'none';
    });
    
    if (tabName === 'chat') {
        document.getElementById('chatTab').style.display = 'block';
    } else if (tabName === 'stats') {
        document.getElementById('statsTab').style.display = 'block';
        updateConnectionInfo();
    }
}

function updateConnectionInfo() {
    const infoDiv = document.getElementById('connectionInfo');
    
    if (!peerConnection) {
        infoDiv.innerHTML = 'Not connected';
        return;
    }
    
    const state = peerConnection.connectionState;
    const iceState = peerConnection.iceConnectionState;
    
    infoDiv.innerHTML = `
        Connection: ${state}<br>
        ICE State: ${iceState}<br>
        Room: ${roomId}<br>
        Username: ${username}
    `;
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (latencyInterval) {
        clearInterval(latencyInterval);
    }
    if (peerConnection) {
        peerConnection.close();
    }
});