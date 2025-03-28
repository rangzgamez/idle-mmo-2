// frontend/src/EventBus.ts
class SimpleEventBus {
    private listeners: { [key: string]: Function[] } = {};

    on(event: string, callback: Function) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    off(event: string, callback: Function) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(listener => listener !== callback);
    }

    emit(event: string, ...args: any[]) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(listener => listener(...args));
    }

    // Helper for listening only once
    once(event: string, callback: Function) {
        const handler = (...args: any[]) => {
            this.off(event, handler);
            callback(...args);
        };
        this.on(event, handler);
    }
}
export const EventBus = new SimpleEventBus();