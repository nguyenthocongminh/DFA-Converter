import FSA from './fsa.js'

export default class NFAConverter {
    /**
     * NFAConverter provides the ability to convert the given NFA to a DFA in incremental steps
     *
     * @param {FSA} nfa The NFA to convert to a DFA
     */
    constructor (nfa) {
        this.nfa = nfa

        // dfa is the FSA that NFAConverter performs each step upon
        this.dfa = undefined

        // steps is the list of steps that have occurred thus far
        this.steps = []

        // state_index holds which state will have a transition generated next
        this.state_index = 0

        // alphabet_index holds which symbol will be used to generate the next transition
        this.alphabet_index = 0

        // unreachableStates is the array of states that are unreachable
        // This is generated after all transitions are generated
        this.unreachableStates = undefined

        // redundantStates is the array of states that can be combined into a single state
        this.redundantStates = undefined
    }

    /**
     * Get the ID of the next step in the conversion process
     *
     * @returns {String} The ID of the next step to be performed
     */
    getNextStep () {
        if (this.dfa === undefined) return 'initialize'
        if (this.state_index < this.dfa.states.length) return 'add_transition'

        if (!this.unreachableStates) { this.unreachableStates = this.getUnreachableStates() }
        if (this.unreachableStates.length > 0) return 'delete_state'

        if (!this.redundantStates) { this.redundantStates = this.getRedundantStates() }
        if (this.redundantStates.length > 0) return 'merge_states'
    }

    /**
     * Get all the unreachable states of the converted DFA
     *
     * @param {FSA} tempDFA A temporary DFA to work off of
     * @param {Array} list The accumulating list of unreachable nodes. It is appended to recursively.
     * @returns {Array} The list of states without any incoming transitions
     */
    getUnreachableStates (tempDFA = undefined, list = []) {
        if (!tempDFA) {
            tempDFA = this.dfa.clone()
        }

        const nodesWithIncomingEdges = []

        // Iterate through all transitions and add the end nodes to the nodesWithIncomingEdges array
        for (const state of tempDFA.states) {
            for (const symbol of tempDFA.alphabet) {
                const node = tempDFA.transitions[state][symbol].join(',')

                // Don't consider nodes that have a transition back to themselves
                if (node !== state) nodesWithIncomingEdges.push(node)
            }
        }

        // The list of unreachable states are those that don't exist in the nodesWithIncomingEdges array
        // Make sure the start state is always in the final DFA by filtering it out of the resulting array
        const nodesWithoutIncomingEdges = tempDFA.states.filter(s => !nodesWithIncomingEdges.includes(s) && s !== tempDFA.startState)

        // If there were unreachable nodes, delete them and then recursively search for more
        if (nodesWithoutIncomingEdges.length > 0) {
            // Remove the nodes from the temporary DFA
            nodesWithoutIncomingEdges.forEach(n => tempDFA.removeState(n))

            // Recursively search for more unreachable nodes after deletion
            // Concat the unreachable nodes to the running list
            list = this.getUnreachableStates(tempDFA, list.concat(nodesWithoutIncomingEdges))
        }

        // Remove duplicates from the list by spreading it as a Set
        return [...new Set(list)]
    }

    /**
     * Get all pairs of states that are redundant (i.e. can be combined into a single state with a loopback)
     * An example of such a pair is {2,3} and {1,2,3} in the Preset #3 resulting DFA
     *
     * @param {FSA} tempDFA A temporary DFA to work off of
     * @param {Array} list The accumulating list of redundant state pairs. It is appended to recursively.
     * @returns {Array} The list of state pairs that are redundant
     */
    getRedundantStates (tempDFA = undefined, list = []) {
        if (!tempDFA) {
            tempDFA = this.dfa.clone()
        }

        /**
         * To be redundant:
         *
         * 1. Both states must be accept states or non-accept states
         * 2. Every symbol in the alphabet must have a transition within the two states
         */

        for (const s1 of tempDFA.states) {
            for (const s2 of tempDFA.states.filter(e => e !== s1)) {
                // 1. Both states must be accept states or non-accept states
                if ((tempDFA.acceptStates.includes(s1) && tempDFA.acceptStates.includes(s2)) ||
                    (!tempDFA.acceptStates.includes(s1) && !tempDFA.acceptStates.includes(s2))) {
                    let redundant = true

                    // 2. Every symbol in the alphabet must have a transition within the two states
                    for (const symbol of tempDFA.alphabet) {
                        if ((tempDFA.transitions[s1][symbol][0] !== s1 && tempDFA.transitions[s1][symbol][0] !== s2) ||
                            (tempDFA.transitions[s2][symbol][0] !== s2 && tempDFA.transitions[s2][symbol][0] !== s1)) {
                            redundant = false
                        }
                    }

                    if (redundant) {
                        tempDFA.mergeStates(s1, s2)

                        // Add the pair of redundant states to the list and recursively search for more
                        list.push([s1, s2])
                        return this.getRedundantStates(tempDFA, list)
                    }
                }
            }
        }

        return list
    }

    /**
     * The first step in the conversion process is to generate the initial DFA as the powerset
     * of states in the NFA
     *
     * @returns {Array} The DFA after this step and the step that was performed
     */
    initializeDFA () {
        const powerset = this.nfa.getPowersetOfStates()

        // The new list of states is the powerset of the original states
        const states = powerset.map(e => e.join(','))

        // Build an empty map of transitions
        // e.g. {1: {a: undefined, b: undefined}, 2: {a: undefined, b: undefined}}
        const transitions = {}
        for (const s of states) {
            transitions[s] = {}
            for (const e of this.nfa.alphabet) {
                transitions[s][e] = undefined
            }
        }

        // The new start state is the states that are reachable from the original start state
        // e.g. '1' has an ε-transition to '3'; therefore, the new start state is '1,3'
        const startState = [...new Set(this.nfa.getEpsilonClosureStates(this.nfa.startState))].sort().join(',')

        // The new list of accept states are any states from the powerset with the original accept state in them
        // e.g. '1' is the accept state; therefore, '1', '1,2', '1,3', and '1,2,3' are accept states
        const acceptStates = powerset.filter(e => {
            for (const s of this.nfa.acceptStates) { if (e.includes(s)) return true }

            return false
        }).map(e => e.join(','))

        // For sanity, let's make sure the new start state is actually a member of the list of states
        if (!states.includes(startState)) { throw new Error(`startState ${startState} is not a member of state powerset [${states}]`) }

        this.dfa = new FSA(states, this.nfa.alphabet, transitions, startState, acceptStates)

        const step = [this.dfa.clone(), {
            type: 'initialize',
            desc: 'Initialize the DFA'
        }]
        this.steps.push(step)
        return step
    }

    /**
     * Generate the next transition in the DFA by following the state_index and alphabet_index
     *
     * @param {Number} prevStateIndex The state_index prior to this step
     * @param {Number} prevAlphabetIndex The alphabet_index prior to this step
     *
     * @returns {Array} The DFA after this step and the step that was performed
     */
    addNextTransition (prevStateIndex, prevAlphabetIndex) {
        const state = this.dfa.states[this.state_index]
        const symbol = this.dfa.alphabet[this.alphabet_index]

        if (this.state_index === 0) {
            // If we're at state index 0, we're at Ø. We need an infinite loopback on Ø.
            this.dfa.transitions['Ø'][symbol] = ['Ø']
        } else {
            let reachableStates = []

            // Get all reachable states for every individual state
            // e.g. '1,2' is the current state; therefore, we need to concatenate the reachable
            //      states from '1' with the reachable states from '2'
            state.split(',').forEach(s => {
                reachableStates = reachableStates.concat(this.nfa.getReachableStates(s, symbol))
            })

            // Remove any duplicates and sort the states alphabetically
            reachableStates = [...new Set(reachableStates)].sort()

            // Remove Ø if the state has other possibilites
            if (reachableStates.some(e => e !== 'Ø')) {
                reachableStates = reachableStates.filter(e => e !== 'Ø')
            } else {
                reachableStates = ['Ø']
            }

            // Update the transition
            this.dfa.transitions[state][symbol] = [reachableStates.join(',')]
        }

        this.alphabet_index++

        const toState = this.dfa.transitions[state][symbol].join(',')
        const step = [this.dfa.clone(), {
            type: 'add_transition',
            desc: `Add a transition from {${state}} on input ${symbol} to {${toState}}`,
            fromState: state,
            toState: toState,
            symbol: symbol,
            prevStateIndex: prevStateIndex,
            prevAlphabetIndex: prevAlphabetIndex
        }]
        this.steps.push(step)
        return step
    }

    /**
     * Delete the next unreachable state at the beginning of the unreachableStates array
     *
     * @returns {Array} The DFA after this step and the step that was performed
     */
    deleteNextUnreachableState () {
        // Pop the first state from unreachableStates
        const stateToDelete = this.unreachableStates.shift()

        const step = [this.dfa.clone(), {
            type: 'delete_state',
            desc: `Delete unreachable state {${stateToDelete}}`,
            state: stateToDelete,
            transitions: this.dfa.transitions[stateToDelete] !== undefined ? Object.assign({}, this.dfa.transitions[stateToDelete]) : undefined
        }]
        this.steps.push(step)

        this.dfa.removeState(stateToDelete)
        return step
    }

    /**
     * Merge the next redundant states at the beginning of the redundantStates array
     *
     * @returns {Array} The DFA after this step and the step that was performed
     */
    mergeNextRedundantStates () {
        // Pop the first state from redundantStates
        const pairToMerge = this.redundantStates.shift()

        const step = [this.dfa.clone(), {
            type: 'merge_states',
            desc: `Merge redundant states {${pairToMerge[0]}} and {${pairToMerge[1]}}`,
            states: pairToMerge
        }]
        this.steps.push(step)

        this.dfa.mergeStates(pairToMerge[0], pairToMerge[1])
        return step
    }

    /**
     * Perform a single step in the conversion from NFA to DFA
     *
     * @returns {Array} The new DFA and the step that was performed
     */
    stepForward () {
        // Adjust alphabet and state indices for adding transitions
        const prevStateIndex = this.state_index
        const prevAlphabetIndex = this.alphabet_index
        if (this.dfa && this.alphabet_index === this.dfa.alphabet.length) {
            this.state_index++
            this.alphabet_index = 0
        }

        switch (this.getNextStep()) {
        case 'initialize':
            return this.initializeDFA()

        case 'add_transition':
            return this.addNextTransition(prevStateIndex, prevAlphabetIndex)

        case 'delete_state':
            return this.deleteNextUnreachableState()

        case 'merge_states':
            return this.mergeNextRedundantStates()
        }

        return [undefined, undefined]
    }

    /**
     * Undo the previous step in the conversion process
     *
     * @returns {Array} The new DFA and the step that was performed
     */
    stepBackward () {
        if (this.steps.length === 0) { return }
        const [prevDFA, prevStep] = this.steps.pop()

        switch (prevStep.type) {
        case 'initialize': {
            this.dfa = undefined
            this.steps = []
            this.state_index = 0
            this.alphabet_index = 0
            this.unreachableStates = undefined

            return [prevDFA, prevStep]
        }

        case 'add_transition': {
            this.state_index = prevStep.prevStateIndex
            this.alphabet_index = prevStep.prevAlphabetIndex
            break
        }

        case 'delete_state': {
            this.unreachableStates.unshift(prevStep.state)
            break
        }

        case 'merge_states': {
            this.redundantStates.unshift(prevStep.states)
            break
        }
        }

        this.dfa = prevDFA

        return [prevDFA, prevStep]
    }

    /**
     * Perform a specific number of steps in the conversion from NFA to DFA
     *
     * @param {number} n The number of steps to perform
     * @returns {FSA} The new DFA after all of the steps have been performed
     */
    step (n) {
        for (let i = 0; i < n; i++) { this.stepForward() }

        return this.dfa
    }

    /**
     * Complete the entire conversion process
     *
     * @returns {Array} Every step that was performed
     */
    complete () {
        const allSteps = []

        while (true) {
            const [newDFA, step] = this.stepForward()
            if (newDFA === undefined || step === undefined) break
            allSteps.push([Object.assign({}, newDFA), step])
        }

        return allSteps
    }
}
