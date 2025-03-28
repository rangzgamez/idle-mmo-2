// frontend/src/EventBus.ts
class SimpleEventBus {
    private listeners: { [key: string]: { callback: Function, context: any }[] } = {};

    on(event: string, callback: Function, context: any = null) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push({ callback, context});
    }

    off(event: string, callback: Function, context: any = null) { // Add context parameter
        if (!this.listeners[event]) return;
        // Filter based on callback AND context
        this.listeners[event] = this.listeners[event].filter(listener =>
            !(listener.callback === callback && listener.context === context)
        );
    }

    emit(event: string, ...args: any[]) {
        if (!this.listeners[event]) return;
        // Use .call or .apply to set the 'this' context when calling the callback
        this.listeners[event].forEach(listener => listener.callback.apply(listener.context, args));
    }

     // Helper for listening only once (needs context too)
     once(event: string, callback: Function, context: any = null) {
        const handler = (...args: any[]) => {
            this.off(event, handler, context); // Use context in off
            callback.apply(context, args);     // Use context in apply
        };
        this.on(event, handler, context);       // Pass context to on
    }
}
export const EventBus = new SimpleEventBus();