// A measured navigation already publishes its owned arrival. Suppress only its
// matching later native scroll settlement; input or displacement ends ownership.
export class FixedScrollOwnership {
    #position = null
    own(left, top) { this.#position = { left, top } }
    interrupt() { this.#position = null }
    settle(left, top) {
        const owned = this.#position
        this.#position = null
        return !!owned && owned.left === left && owned.top === top
    }
}
