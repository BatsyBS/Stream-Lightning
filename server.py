"""
STREAM LIGHTNING - Live Video Streaming Server
A high-performance streaming server with screen sharing, chat, and latency monitoring
Supports 20+ concurrent viewers with low latency
"""

from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
import json
import time
from datetime import datetime
import threading
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = 'stream-lighting-secret-key-2025'
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading', ping_timeout=60, ping_interval=25)

# Store active rooms and users
active_rooms = {}
user_connections = {}
stream_stats = {}

class StreamRoom:
    def __init__(self, room_id, host_id):
        self.room_id = room_id
        self.host_id = host_id
        self.viewers = set()
        self.chat_history = []
        self.created_at = datetime.now()
        self.stream_active = False
        
    def add_viewer(self, viewer_id):
        self.viewers.add(viewer_id)
        
    def remove_viewer(self, viewer_id):
        self.viewers.discard(viewer_id)
        
    def get_viewer_count(self):
        return len(self.viewers)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/stream/<room_id>')
def stream_page(room_id):
    return render_template('stream.html', room_id=room_id)

@app.route('/watch/<room_id>')
def watch_page(room_id):
    return render_template('watch.html', room_id=room_id)

@socketio.on('connect')
def handle_connect():
    logger.info(f"Client connected: {request.sid}")
    emit('connected', {'sid': request.sid})

@socketio.on('disconnect')
def handle_disconnect():
    logger.info(f"Client disconnected: {request.sid}")
    
    # Clean up user from all rooms
    for room_id, room in list(active_rooms.items()):
        if request.sid == room.host_id:
            # Host disconnected, notify all viewers
            emit('stream_ended', {'message': 'Host disconnected'}, room=room_id)
            del active_rooms[room_id]
        elif request.sid in room.viewers:
            room.remove_viewer(request.sid)
            emit('viewer_left', {
                'viewer_id': request.sid,
                'viewer_count': room.get_viewer_count()
            }, room=room_id)

@socketio.on('create_room')
def handle_create_room(data):
    room_id = data.get('room_id')
    join_room(room_id)
    
    room = StreamRoom(room_id, request.sid)
    active_rooms[room_id] = room
    
    logger.info(f"Room created: {room_id} by {request.sid}")
    emit('room_created', {
        'room_id': room_id,
        'host_id': request.sid
    })

@socketio.on('join_room')
def handle_join_room(data):
    room_id = data.get('room_id')
    username = data.get('username', 'Anonymous')
    
    if room_id not in active_rooms:
        emit('error', {'message': 'Room not found'})
        return
    
    room = active_rooms[room_id]
    join_room(room_id)
    room.add_viewer(request.sid)
    
    logger.info(f"User {username} ({request.sid}) joined room {room_id}")
    
    # Notify user
    emit('room_joined', {
        'room_id': room_id,
        'viewer_count': room.get_viewer_count(),
        'username': username
    })
    
    # Notify host and other viewers
    emit('viewer_joined', {
        'viewer_id': request.sid,
        'username': username,
        'viewer_count': room.get_viewer_count()
    }, room=room_id, include_self=False)

@socketio.on('start_stream')
def handle_start_stream(data):
    room_id = data.get('room_id')
    if room_id in active_rooms:
        room = active_rooms[room_id]
        room.stream_active = True
        emit('stream_started', {'room_id': room_id}, room=room_id)
        logger.info(f"Stream started in room {room_id}")

@socketio.on('stop_stream')
def handle_stop_stream(data):
    room_id = data.get('room_id')
    if room_id in active_rooms:
        room = active_rooms[room_id]
        room.stream_active = False
        emit('stream_stopped', {'room_id': room_id}, room=room_id)
        logger.info(f"Stream stopped in room {room_id}")

# WebRTC Signaling
@socketio.on('offer')
def handle_offer(data):
    room_id = data.get('room_id')
    target_id = data.get('target_id')
    offer = data.get('offer')
    
    emit('offer', {
        'offer': offer,
        'sender_id': request.sid
    }, room=target_id)

@socketio.on('answer')
def handle_answer(data):
    room_id = data.get('room_id')
    target_id = data.get('target_id')
    answer = data.get('answer')
    
    emit('answer', {
        'answer': answer,
        'sender_id': request.sid
    }, room=target_id)

@socketio.on('ice_candidate')
def handle_ice_candidate(data):
    target_id = data.get('target_id')
    candidate = data.get('candidate')
    
    emit('ice_candidate', {
        'candidate': candidate,
        'sender_id': request.sid
    }, room=target_id)

# Chat functionality
@socketio.on('chat_message')
def handle_chat_message(data):
    room_id = data.get('room_id')
    message = data.get('message')
    username = data.get('username', 'Anonymous')
    
    if room_id in active_rooms:
        room = active_rooms[room_id]
        chat_data = {
            'username': username,
            'message': message,
            'timestamp': datetime.now().strftime('%H:%M:%S')
        }
        room.chat_history.append(chat_data)
        
        emit('chat_message', chat_data, room=room_id)

# Latency monitoring
@socketio.on('latency_ping')
def handle_latency_ping(data):
    emit('latency_pong', {
        'timestamp': data.get('timestamp'),
        'server_time': time.time() * 1000
    })

# Stream stats
@socketio.on('stream_stats')
def handle_stream_stats(data):
    room_id = data.get('room_id')
    stats = data.get('stats')
    
    if room_id not in stream_stats:
        stream_stats[room_id] = []
    
    stream_stats[room_id].append({
        'timestamp': datetime.now().isoformat(),
        'stats': stats
    })
    
    # Keep only last 100 stats entries
    if len(stream_stats[room_id]) > 100:
        stream_stats[room_id] = stream_stats[room_id][-100:]

@app.route('/api/rooms')
def get_rooms():
    rooms_data = []
    for room_id, room in active_rooms.items():
        rooms_data.append({
            'room_id': room_id,
            'viewer_count': room.get_viewer_count(),
            'stream_active': room.stream_active,
            'created_at': room.created_at.isoformat()
        })
    return jsonify(rooms_data)

@app.route('/api/stats/<room_id>')
def get_stats(room_id):
    if room_id in stream_stats:
        return jsonify(stream_stats[room_id])
    return jsonify([])

if __name__ == '__main__':
    print("="*60)
    print("🌟 STREAM LIGHTNING SERVER STARTING 🌟")
    print("="*60)
    print("📡 Server running on: http://localhost:5000")
    print("📺 Create stream: http://localhost:5000/stream/<room_name>")
    print("👀 Watch stream: http://localhost:5000/watch/<room_name>")
    print("⚡ Max viewers: 20+ concurrent connections")
    print("="*60)
    
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)