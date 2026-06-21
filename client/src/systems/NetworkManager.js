// Token Wars: 算力征途 - Network Manager
// Singleton class managing Socket.IO connection with auto-reconnect
class NetworkManager {
  constructor() {
    this.socket = null;
    this.listeners = new Map();
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 30000;
    this.baseDelay = 1000;
  }

  connect(url) {
    if (url === undefined) {
      url = '';
    }

    if (this.socket) {
      this.socket.disconnect();
    }

    var self = this;
    this.socket = window.io(url, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: this.baseDelay,
      reconnectionDelayMax: this.maxReconnectDelay,
      randomizationFactor: 0.5
    });

    this.socket.on('connect', function() {
      console.log('[Network] Connected:', self.socket.id);
      self.connected = true;
      self.reconnectAttempts = 0;
      // Listeners are already registered via on() — no re-registration needed.
      // Socket.IO preserves event listeners across reconnections on the same socket object.
    });

    this.socket.on('disconnect', function(reason) {
      console.log('[Network] Disconnected:', reason);
      self.connected = false;
    });

    this.socket.on('connect_error', function(error) {
      console.warn('[Network] Connection error:', error.message);
      self.reconnectAttempts++;
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);

    if (this.socket) {
      this.socket.on(event, callback);
    }
  }

  off(event, callback) {
    if (!callback) {
      // Remove all listeners for this event
      this.listeners.delete(event);
      if (this.socket) {
        this.socket.off(event);
      }
      return;
    }

    if (this.listeners.has(event)) {
      var cbs = this.listeners.get(event);
      var idx = cbs.indexOf(callback);
      if (idx !== -1) {
        cbs.splice(idx, 1);
      }
      if (cbs.length === 0) {
        this.listeners.delete(event);
      }
    }

    if (this.socket) {
      this.socket.off(event, callback);
    }
  }

  emit(event, data) {
    if (this.socket && this.socket.connected) {
      this.socket.emit(event, data);
    } else {
      console.warn('[Network] Cannot emit, not connected:', event);
    }
  }

  isConnected() {
    return this.connected && this.socket && this.socket.connected;
  }
}

// Export singleton instance
window.NetworkManager = new NetworkManager();
