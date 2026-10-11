/** Synchronous registration; preparation completes before the existing load reveals a page. */
export const dispatchPreparedLoad = async (target, detail) => {
    const pending = []
    let accepting = true
    const waitUntil = promise => {
        if (!accepting) throw new DOMException('Load preparation has already been registered', 'InvalidStateError')
        pending.push(Promise.resolve(promise))
    }
    try { target.dispatchEvent(new CustomEvent('load', { detail: { ...detail, waitUntil } })) }
    finally { accepting = false }
    await Promise.all(pending)
}

/** Settle promptly on retirement, even if the iframe never emits its load event. */
export const ownedDocumentLoad = (signal, setup) => new Promise((resolve, reject) => {
    if (signal.aborted) return resolve()
    const cancel = () => resolve()
    const finish = () => {
        signal.removeEventListener('abort', cancel)
        resolve()
    }
    const fail = error => {
        signal.removeEventListener('abort', cancel)
        reject(error)
    }
    signal.addEventListener('abort', cancel, { once: true })
    try { setup(finish, fail) }
    catch (error) { fail(error) }
})

/** A reused view may have started a newer load while an earlier one settled. */
export const waitForDocumentLoad = async view => {
    let ready
    do { ready = view.ready; await ready } while (ready !== view.ready)
}
