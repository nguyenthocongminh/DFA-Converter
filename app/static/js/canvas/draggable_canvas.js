import Renderer from './renderer.js'
import StraightLine from './drawables/straight_line.js'
import Drawable from './drawables/drawable.js'
import Location from './location.js'
import EventHandler from '../util/event_handler.js'

const GRID_CELL_SIZE = 40
const GRID_SIZE = 500
const GRID_LINE_WIDTH = 1
const GRID_LINE_COLOR = '#e6e6e6'

// How much below 1 can the canvas be zoomed?
const MIN_ZOOM_DELTA = -0.5

// How much above 1 can the canvas be zoomed?
const MAX_ZOOM_DELTA = 1

export default class DraggableCanvas extends EventHandler {
    /**
     * DraggableCanvas represents a canvas element with added functionality such as:
     *   - zooming and panning the canvas
     *   - adding and removing objects with custom draw functions
     *
     * @param {String} selector The query selector to get the canvas element
     */
    constructor (selector) {
        super()
        this.canvas = document.querySelector(selector)

        // Perform some sanity checks on the element
        if (this.canvas === null) { throw new Error(`cannot create canvas because the given selector ${selector} does not exist`) }

        this.ctx = this.canvas.getContext('2d')

        // Find optimal pixel ratio for the user's screen
        const dpr = window.devicePixelRatio || 1
        const bsr = this.ctx.webkitBackingStorePixelRatio ||
            this.ctx.mozBackingStorePixelRatio ||
            this.ctx.msBackingStorePixelRatio ||
            this.ctx.oBackingStorePixelRatio ||
            this.ctx.backingStorePixelRatio || 1
        this.pixelRatio = dpr / bsr

        // Initialize the canvas with the pixel ratio
        const width = this.canvas.clientWidth
        const height = this.canvas.clientHeight
        this.canvas.width = width * this.pixelRatio
        this.canvas.height = height * this.pixelRatio
        // this.canvas.style.width = `${width}px`
        // this.canvas.style.height = `${height}px`
        this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0)

        // Translating by 0.5 helps to make lines less sharp
        this.ctx.translate(0.5, 0.5)

        window.addEventListener('resize', function (e) {
            const width = this.canvas.clientWidth
            const height = this.canvas.clientHeight
            this.canvas.width = width * this.pixelRatio
            this.canvas.height = height * this.pixelRatio
            this.scale = 1
            this.zoomDelta = 0
            this.setZoom(1)
            this.translation = { x: 0, y: 0 }
            this.redrawCanvas = true
        }.bind(this))

        this.canvas.addEventListener('contextmenu', function (e) {
            const loc = this.normalizeLocation(new Location(e.offsetX, e.offsetY))

            e.preventDefault()

            const obj = this.getObjectAt(loc)
            if (obj) {
                obj.dispatchEvent('edit', {
                    clientX: e.clientX,
                    clientY: e.clientY
                })
            } else {
                this.dispatchEvent('rightclick', {
                    clientX: e.clientX,
                    clientY: e.clientY,
                    loc: loc
                })
            }
        }.bind(this))

        this.canvas.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return

            const loc = this.normalizeLocation(new Location(e.offsetX, e.offsetY))
            const obj = this.getObjectAt(loc)
            this.dispatchEvent('mousedown', { loc: loc, obj: obj })

            if (obj && typeof obj.move === 'function') {
                // If we found an object on the mousedown location, start dragging it
                this.draggingObject = obj
                document.body.style.cursor = 'grabbing'
            } else {
                // Otherwise, we want to pan the canvas
                this.panGrabLocation = loc
                document.body.style.cursor = 'grabbing'
            }
        }.bind(this))

        this.canvas.addEventListener('mousemove', function (e) {
            const loc = this.normalizeLocation(new Location(e.offsetX, e.offsetY))
            this.dispatchEvent('mousemove', { loc: loc })

            if (this.panGrabLocation) {
                // Pan the canvas by the difference between the mouse location and the grab location
                this.pan(loc.x - this.panGrabLocation.x, loc.y - this.panGrabLocation.y)
                this.redrawCanvas = true
            } else if (this.draggingObject) {
                // Move the object to the new mouse location
                this.draggingObject.move(loc)
                this.redrawCanvas = true
            }
        }.bind(this))

        this.canvas.addEventListener('mouseup', function (e) {
            const loc = this.normalizeLocation(new Location(e.offsetX, e.offsetY))

            if (this.panGrabLocation) {
                this.redrawCanvas = true
                this.panGrabLocation = undefined
                document.body.style.cursor = 'auto'
            } else if (this.draggingObject) {
                this.draggingObject.move(loc)
                this.redrawCanvas = true
                this.draggingObject = undefined
                document.body.style.cursor = 'auto'
            }
        }.bind(this))

        this.canvas.addEventListener('mousewheel', function (e) {
            e.preventDefault()

            // Keep zoom level between the min and max values
            this.zoomDelta = Math.min(Math.max(this.zoomDelta + (0.0008 * -e.deltaY), MIN_ZOOM_DELTA), MAX_ZOOM_DELTA)
            this.setZoom(1 + this.zoomDelta)

            this.redrawCanvas = true
        }.bind(this))

        this.renderer = new Renderer(this.canvas, this.ctx)
        this.redrawCanvas = true
        this.objects = []
        this.translation = { x: 0, y: 0 }
        this.scale = 1
        this.zoomDelta = 0
    }

    /**
     * Clear the canvas by removing all objects on it
     */
    clear () {
        this.objects = []
        this.redrawCanvas = true
    }

    /**
     * Add an object to the canvas to be drawn
     *
     * @param {Drawable} drawable The object to add to the canvas, which extends the Drawable class
     */
    addObject (drawable) {
        if (!(drawable instanceof Drawable)) { throw new Error('object is not an instance of Drawable') }

        this.objects.push(drawable)
        this.redrawCanvas = true
    }

    /**
     * Find the object, if it exists, at the given location
     *
     * @param {Location} loc The location to find an object at
     */
    getObjectAt (loc) {
        for (const obj of this.objects) {
            if (typeof obj.touches === 'function') {
                if (obj.touches(loc)) return obj
            }
        }
    }

    /**
     * Normalize a raw canvas location to a scaled and translated location, since the canvas can be panned and zoomed
     *
     * @param {Location} loc The location to normalize
     */
    normalizeLocation (loc) {
        return new Location(loc.x / this.scale - this.translation.x, loc.y / this.scale - this.translation.y)
    }

    /**
     * Pan the canvas by the given deltas
     *
     * @param {Number} x The amount to pan in the x direction
     * @param {Number} y The amount to pan in the y direction
     */
    pan (x, y) {
        if (Math.abs(this.translation.x + x) < GRID_SIZE) {
            this.translation.x += x
            this.ctx.translate(x, 0)
        }

        if (Math.abs(this.translation.y + y) < GRID_SIZE) {
            this.translation.y += y
            this.ctx.translate(0, y)
        }

        // console.log(this.translation)
    }

    /**
     * Adjust the zoom value of the canvas, with 1 being normal zoom
     *
     * @param {Number} amount The new scaling of the canvas (normal zoom = 1)
     */
    setZoom (amount) {
        // For some reason we have to untranslate canvas before zooming
        this.ctx.translate(-this.translation.x, -this.translation.y)

        // Scale back to normal by scaling the recriprocal of current
        this.ctx.scale(1 / this.scale, 1 / this.scale)
        this.scale = amount
        this.ctx.scale(this.scale, this.scale)

        // Return to previous translation
        this.ctx.translate(this.translation.x, this.translation.y)
    }

    /**
     * Draw the background grid of lines on the canvas
     */
    drawGrid () {
        // Change the size depending on the zoom level
        const width = this.canvas.width * Math.min(Math.abs(1 / this.zoomDelta), 2)
        const height = this.canvas.height * Math.min(Math.abs(1 / this.zoomDelta), 2)

        for (let x = -GRID_SIZE; x < width + GRID_SIZE; x += GRID_CELL_SIZE) {
            new StraightLine(new Location(x, -GRID_SIZE), new Location(x, height + GRID_SIZE), {
                width: GRID_LINE_WIDTH,
                color: GRID_LINE_COLOR
            }).draw(this.renderer)
        }

        for (let y = -GRID_SIZE; y < height + GRID_SIZE; y += GRID_CELL_SIZE) {
            new StraightLine(new Location(-GRID_SIZE, y), new Location(width + GRID_SIZE, y), {
                width: GRID_LINE_WIDTH,
                color: GRID_LINE_COLOR
            }).draw(this.renderer)
        }
    }

    /**
     * Draw all objects onto the canvas
     */
    draw () {
        if (!this.redrawCanvas) { return }
        this.redrawCanvas = false

        // Change the size depending on the zoom level
        const width = this.canvas.width * Math.min(Math.abs(1 / this.zoomDelta), 2)
        const height = this.canvas.height * Math.min(Math.abs(1 / this.zoomDelta), 2)
        this.ctx.clearRect(-this.translation.x, -this.translation.y - 1, width, height)

        this.drawGrid()
        this.objects.forEach(e => e.draw(this.renderer))
    }
}
