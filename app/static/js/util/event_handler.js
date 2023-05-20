export default class EventHandler {
    /**
     * EventHandler provides the ability to listen and dispatch events from a class
     */
    constructor () {
        this.eventListeners = []
    }

    /**
     * Update an event if it exists, otherwise register a new one
     *
     * @param {String} name The name of the event
     * @param {Function} fn The function to execute upon the event occurring
     */
    updateEventListener (name, fn) {
        const index = this.eventListeners.findIndex(e => e.name === name)
        if (index > -1) { this.eventListeners.splice(index, 1) }
        this.addEventListener(name, fn)
    }

    /**
     * Register a new event
     *
     * @param {String} name The name of the event
     * @param {Function} fn The function to execute upon the event occurring
     */
    addEventListener (name, fn) {
        this.eventListeners.push({ name: name, fn: fn })
    }

    /**
     * Dispatch an event to all its listeners
     *
     * @param {String} name The name of the event
     * @param {Object} event The parameters to pass to the function
     */
    dispatchEvent (name, event) {
        if (this.eventListeners) { this.eventListeners.filter(e => e.name === name).forEach(e => e.fn(event)) }
    }
}
