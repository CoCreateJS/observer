/**
 * A highly optimized MutationObserver wrapper that allows for targeted observation
 * based on CSS selectors, specific attribute filters, and mutation types.
 *
 * It maintains internal maps for tags, IDs, classes, and attributes to minimize
 * the performance overhead of checking mutations against selectors.
 *
 * @class
 * @param {Document|Element} doc - The root DOM element to observe.
 */
function observer(doc) {
    /** @type {number} Unique index counter for callback IDs. */
    this.index = 0;

    /** @type {number} Unique index counter for native mutation records. */
    this.mutationIndex = 0;

    /** @type {Map<string, object>} Map of configuration objects by their generated ID. */
    this.configs = new Map();

    /** @type {Map<string, object>} Map of configuration objects by their user-provided name. */
    this.configByName = new Map();

    /**
     * Storage structure for 'childList' mutations.
     * Separates listeners by selector type (id, class, tagName, etc.) for O(1) lookup.
     */
    this.childList = {
        undefined: [],
        complexSelectors: new Map(),
        tagName: new Map(),
        id: new Map(),
        class: new Map(),
        attribute: new Map()
    };

    /** Storage structure for 'addedNodes' specific logic. */
    this.addedNodes = {
        undefined: [],
        complexSelectors: new Map(),
        tagName: new Map(),
        id: new Map(),
        class: new Map(),
        attribute: new Map()
    };

    /** Storage structure for 'removedNodes' specific logic. */
    this.removedNodes = {
        undefined: [],
        complexSelectors: new Map(),
        tagName: new Map(),
        id: new Map(),
        class: new Map(),
        attribute: new Map()
    };

    /**
     * Storage structure for 'attributes' mutations.
     * Includes an additional 'attributeFilter' map for specific attribute names.
     */
    this.attributes = {
        undefined: [],
        complexSelectors: new Map(),
        tagName: new Map(),
        id: new Map(),
        class: new Map(),
        attribute: new Map(),
        attributeFilter: new Map()
    };

    /** Storage structure for 'characterData' mutations. */
    this.characterData = {
        undefined: [],
        complexSelectors: new Map(),
        tagName: new Map(),
        id: new Map(),
        class: new Map(),
        attribute: new Map()
    };

    /** @type {Set<string>} Set of observer names scheduled for un-initialization. */
    this.unInintNames = new Set();

    // Initialize the native MutationObserver
    const observer = new MutationObserver((mutationsList) => {
        requestAnimationFrame(() => {
            this.processMutations(mutationsList);
        });
    });

    // Start observing the target document/element
    observer.observe(doc, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeOldValue: true,
        characterData: true,
        characterDataOldValue: true
    });
}

/**
 * Initializes the observer with the provided configuration(s).
 * Parses selectors and distributes configurations into the internal optimized maps.
 *
 * @param {object|object[]} config - The configuration object or an array of configuration objects.
 * @param {string} [config.name] - The unique name of the observer (used for un-init).
 * @param {string|string[]} config.types - The MutationObserver type(s) to observe (e.g., 'childList', 'attributes', 'addedNodes', 'removedNodes').
 * @param {string[]} [config.attributeFilter] - The attributes to observe (only used for 'attributes' mutations).
 * @param {string} [config.selector] - The CSS selector to target elements.
 * @param {function} config.callback - The callback function to execute when mutations occur.
 * @returns {void}
 * @public
 * @environment client
 */
observer.prototype.init = function (config) {
    if (!Array.isArray(config)) {
        config = [config];
    }

    for (const conf of config) {
        if (!conf.types || !conf.types.length || !conf.callback) {
            console.error(
                "Invalid observer configuration: Missing types or callback."
            );
            return;
        }

        // Generate a unique internal ID for this configuration
        conf.id = "cbId" + ++this.index;

        if (!Array.isArray(conf.types)) {
            conf.types = [conf.types];
        }

        this.configs.set(conf.id, conf);
        if (conf.name) {
            this.configByName.set(conf.name, conf);
        }

        if (conf.selector) {
            conf.generatedIds = [];
            this.parseSelector(conf);
        } else {
            // If no selector is provided, add to the 'undefined' bucket (global listener)
            conf.types.forEach((type) => {
                this[type].undefined.push(conf);
            });
        }

        // Handle specific attribute filters if applicable
        if (conf.types.includes("attributes")) {
            let attributeFilter = conf.attributeFilter;
            if (!attributeFilter || !attributeFilter.length) {
                attributeFilter = [""];
            }

            let targetMap = this.attributes.attributeFilter;
            for (let i = 0; i < attributeFilter.length; i++) {
                const attributeName = attributeFilter[i];
                if (!targetMap.has(attributeName)) {
                    targetMap.set(attributeName, [conf.id]);
                } else {
                    targetMap.get(attributeName).push(conf.id);
                }
            }
        }
    }
};

/**
 * Parses a CSS selector string into optimized buckets (ID, Class, Tag, Attribute).
 * Complex selectors that cannot be easily bucketed are marked for slower `matches()` execution.
 *
 * @param {object} config - The configuration object containing the selector string.
 * @returns {void}
 * @public
 * @environment client
 */
observer.prototype.parseSelector = function (config) {
    const complexSelectors = [];
    const compoundSelectors = [];

    for (const selector of splitSelectorList(config.selector)) {
        const parts = parseSimpleSelector(selector);
        if (!parts) {
            complexSelectors.push(selector);
            continue;
        }

        const generatedId = `${compoundSelectors.length}-${config.id}-${parts.length}`;
        config.generatedIds.push(generatedId);
        compoundSelectors.push({ generatedId, parts });
    }

    for (const observerType of config.types) {
        const targetMap = this[observerType];

        for (const selector of complexSelectors) {
            if (!targetMap.complexSelectors.has(selector)) {
                targetMap.complexSelectors.set(selector, [config.id]);
            } else {
                targetMap.complexSelectors.get(selector).push(config.id);
            }
        }

        for (const { generatedId, parts } of compoundSelectors) {
            for (const part of parts) {
                if (!targetMap[part.type].has(part.name)) {
                    targetMap[part.type].set(part.name, [generatedId]);
                } else {
                    targetMap[part.type].get(part.name).push(generatedId);
                }
            }
        }
    }
};

function splitSelectorList(selector) {
    const selectors = [];
    let start = 0;
    let brackets = 0;
    let parentheses = 0;
    let quote = "";

    for (let i = 0; i < selector.length; i++) {
        const char = selector[i];
        if (char === "\\") {
            i++;
        } else if (quote) {
            if (char === quote) quote = "";
        } else if (char === "'" || char === '"') {
            quote = char;
        } else if (char === "[") {
            brackets++;
        } else if (char === "]") {
            brackets--;
        } else if (char === "(") {
            parentheses++;
        } else if (char === ")") {
            parentheses--;
        } else if (char === "," && !brackets && !parentheses) {
            selectors.push(selector.slice(start, i).trim());
            start = i + 1;
        }
    }

    selectors.push(selector.slice(start).trim());
    return selectors;
}

function parseSimpleSelector(selector) {
    const match = /^([a-zA-Z][\w-]*)?(#[\w-]+)?((?:\.[\w-]+)*)(\[[^\]]+\])?$/.exec(selector);
    if (!match) return;

    const parts = [];
    if (match[1]) parts.push({ type: "tagName", name: match[1].toLowerCase() });
    if (match[2]) parts.push({ type: "id", name: match[2].slice(1) });
    if (match[3]) {
        for (const name of match[3].slice(1).split(".")) {
            parts.push({ type: "class", name });
        }
    }
    if (match[4]) {
        const attribute = /^([\w-]+)(?:\s*=\s*(?:"([^"\\]*)"|'([^'\\]*)'|([^\s"'\\=]+)))?$/.exec(match[4].slice(1, -1));
        if (!attribute) return;
        const value = attribute[2] ?? attribute[3] ?? attribute[4];
        parts.push({
            type: "attribute",
            name: value === undefined ? attribute[1] : `${attribute[1]}="${value}"`
        });
    }

    return parts.length ? parts : undefined;
}

/**
 * Processes the list of mutations received from the native MutationObserver.
 * Normalizes mutation objects and delegates processing to specific handlers
 * (childList, attributes, etc.).
 *
 * @param {MutationRecord[]} mutationsList - Array of MutationRecords.
 * @returns {void}
 * @public
 * @environment client
 */
observer.prototype.processMutations = function (mutationsList) {
    /**
     * Creates a normalized mutation object tailored for the callback.
     * @param {Node} node - The target node.
     * @param {MutationRecord} mutation - The original mutation record.
     * @param {string} type - The type of mutation (e.g., 'addedNodes').
     * @returns {object} The normalized mutation object.
 * @private
 * @environment client
 */
    const createMutation = (node, mutation, type, mutationId) => {
        return {
            mutationId: mutationId,
            type: type,
            target: node,
            mutationOrigin: mutation.target,
            parentElement: node.parentElement,
            previousSibling: node.previousSibling,
            nextSibling: node.nextSibling,
            attributeName: mutation.attributeName,
            oldValue: mutation.oldValue,
            addedNodes: mutation.addedNodes,
            removedNodes: mutation.removedNodes
        };
    };

    /**
     * Reconstructs a node's position within a child-list mutation. Native
     * previous/next sibling values describe the mutation boundaries, so nodes
     * inside a multi-node mutation use their adjacent mutation nodes.
 * @private
 * @environment client
 */
    const createPosition = (node, nodes, mutation) => {
        const index = Array.prototype.indexOf.call(nodes, node);
        return {
            parentElement: mutation.target,
            previousSibling:
                index > 0 ? nodes[index - 1] : mutation.previousSibling,
            nextSibling:
                index > -1 && index < nodes.length - 1
                    ? nodes[index + 1]
                    : mutation.nextSibling
        };
    };

    const removedMoves = new WeakMap();
    const addedMoves = new WeakMap();
    const pendingRemovals = new Map();

    const setRecordMove = (recordMoves, mutation, node, move) => {
        let moves = recordMoves.get(mutation);
        if (!moves) {
            moves = new Map();
            recordMoves.set(mutation, moves);
        }
        moves.set(node, move);
    };

    const getRecordMove = (recordMoves, mutation, node) => {
        return recordMoves.get(mutation)?.get(node);
    };

    // Pair only nodes removed and subsequently added in this native batch.
    for (const mutation of mutationsList) {
        if (mutation.type !== "childList") continue;

        for (const removedNode of mutation.removedNodes) {
            if (!(removedNode instanceof Element)) continue;

            let removals = pendingRemovals.get(removedNode);
            if (!removals) {
                removals = [];
                pendingRemovals.set(removedNode, removals);
            }
            removals.push({
                mutation,
                from: createPosition(
                    removedNode,
                    mutation.removedNodes,
                    mutation
                )
            });
        }

        for (const addedNode of mutation.addedNodes) {
            if (!(addedNode instanceof Element)) continue;

            const removals = pendingRemovals.get(addedNode);
            if (!removals?.length) continue;

            const removal = removals.shift();
            if (!removals.length) pendingRemovals.delete(addedNode);

            const move = {
                movedElement: addedNode,
                from: removal.from,
                to: createPosition(
                    addedNode,
                    mutation.addedNodes,
                    mutation
                )
            };

            setRecordMove(
                removedMoves,
                removal.mutation,
                addedNode,
                move
            );
            setRecordMove(addedMoves, mutation, addedNode, move);
        }
    }

    for (const mutation of mutationsList) {
        const mutationId = `mutation-${++this.mutationIndex}`;

        switch (mutation.type) {
            case "childList":
                this.executeCallbacks(
                    createMutation(
                        mutation.target,
                        mutation,
                        mutation.type,
                        mutationId
                    )
                );
                
                // Handle Added Nodes
                if (mutation.addedNodes.length > 0) {
                    for (const addedNode of mutation.addedNodes) {
                        if (addedNode instanceof Element) {
                            const move = getRecordMove(
                                addedMoves,
                                mutation,
                                addedNode
                            );

                            // Recursively check added node and its children
                            this.everyElement(addedNode, (el) => {
                                const mutationObject = createMutation(
                                    el,
                                    mutation,
                                    "addedNodes",
                                    mutationId
                                );

                                if (move) {
                                    mutationObject.move = {
                                        ...move,
                                        isDescendant: el !== move.movedElement
                                    };
                                }

                                this.executeCallbacks(mutationObject);
                            });
                        }
                    }
                }
                
                // Handle Removed Nodes
                if (mutation.removedNodes.length > 0) {
                    for (const removedNode of mutation.removedNodes) {
                        if (removedNode instanceof Element) {
                            const move = getRecordMove(
                                removedMoves,
                                mutation,
                                removedNode
                            );

                            // Recursively check removed node and its children
                            this.everyElement(removedNode, (el) => {
                                const mutationObject = createMutation(
                                    el,
                                    mutation,
                                    "removedNodes",
                                    mutationId
                                );

                                if (move) {
                                    mutationObject.move = {
                                        ...move,
                                        isDescendant: el !== move.movedElement
                                    };
                                }

                                this.executeCallbacks(mutationObject);
                            });
                        }
                    }
                }
                break;
            case "attributes":
                this.executeCallbacks(
                    createMutation(
                        mutation.target,
                        mutation,
                        mutation.type,
                        mutationId
                    )
                );
                break;

            case "characterData":
                if (mutation.target.isConnected) {
                    this.executeCallbacks(
                        createMutation(
                            mutation.target,
                            mutation,
                            mutation.type,
                            mutationId
                        )
                    );
                }
                break;
        }
    }
};

/**
 * Traverses an element and all its descendants (depth-first), executing a callback for each.
 *
 * @param {Element} el - The root element to traverse.
 * @param {function} callback - The function to execute for each element.
 * @returns {void}
 * @public
 * @environment client
 */
observer.prototype.everyElement = function everyElement(el, callback) {
    const stack = [el];

    while (stack.length > 0) {
        const currentNode = stack.pop();

        callback(currentNode);

        if (currentNode.children.length) {
            const children = currentNode.children;
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push(children[i]);
            }
        }
    }
};

/**
 * Executes the registered callbacks for a specific mutation.
 * Uses the optimized maps (tag, id, class) to quickly identify which configs match the target.
 *
 * @param {object} mutation - The mutation object (normalized or native).
 * @returns {void}
 * @public
 * @environment client
 */
observer.prototype.executeCallbacks = function (mutation) {
    try {
        let target = mutation.target; 
        // Ensure we are dealing with an Element node
        if (target && target.nodeType !== Node.ELEMENT_NODE) {
            target = target.parentElement;
            if (target && target.nodeType !== Node.ELEMENT_NODE) {
                return;
            }
        }

        const targetMap = this[mutation.type];
        const tag = target.tagName && target.tagName.toLowerCase();
        const id = target.id;
        const classes = target.classList;
        const attributes = target.attributes;
        const attributeCallbackIds = [];

        // For attribute mutations, filter based on the specific attribute name
        if (mutation.type === "attributes") {
            attributeCallbackIds.push(
                ...new Set([
                    ...(targetMap.attributeFilter.get(mutation.attributeName) ||
                        []),
                    ...(targetMap.attributeFilter.get("") || [])
                ])
            );
            if (!attributeCallbackIds.length) {
                return;
            }
        }

        const matchingCallbackIds = [];

        // 1. Collect potential matches from Tag Name map
        if (tag && targetMap.tagName.has(tag)) {
            matchingCallbackIds.push(...targetMap.tagName.get(tag));
        }
        
        // 2. Collect potential matches from ID map
        if (id && targetMap.id.has(id)) {
            matchingCallbackIds.push(...targetMap.id.get(id));
        }

        // 3. Collect potential matches from Class map
        if (classes) {
            for (const className of classes) {
                if (targetMap.class.has(className)) {
                    matchingCallbackIds.push(...targetMap.class.get(className));
                }
            }
        }

        // 4. Collect potential matches from Attribute presence/value map
        if (attributes) {
            for (const attr of Array.from(attributes)) {
                const attrStringName = attr.name;
                const attrStringNameValue = `${attr.name}="${attr.value}"`;

                if (targetMap.attribute.has(attrStringName)) {
                    matchingCallbackIds.push(
                        ...targetMap.attribute.get(attrStringName)
                    );
                }
                if (targetMap.attribute.has(attrStringNameValue)) {
                    matchingCallbackIds.push(
                        ...targetMap.attribute.get(attrStringNameValue)
                    );
                }
            }
        }

        const executedConfigIds = new Set(); // Track executed config IDs to prevent duplicates

        // A. Execute callbacks for 'undefined' selectors (Global listeners) - Fastest
        const undefinedConfigs = targetMap.undefined;
        if (undefinedConfigs) {
            for (const config of undefinedConfigs) {
                if (
                    mutation.type === "attributes" &&
                    !attributeCallbackIds.includes(config.id)
                )
                    continue;

                executedConfigIds.add(config.id);
                config.callback(mutation);
            }
        }

        const callbackCounts = {};

        // Count callback occurrences to match compound selectors (e.g., div.class#id)
        for (const matchingCallbackId of matchingCallbackIds) {
            callbackCounts[matchingCallbackId] =
                (callbackCounts[matchingCallbackId] || 0) + 1;
        }

        // B. Execute callbacks for selector-based matches - Medium
        for (const id in callbackCounts) {
            const idParts = id.split("-");
            if (
                executedConfigIds.has(idParts[1]) ||
                (mutation.type === "attributes" &&
                    !attributeCallbackIds.includes(idParts[1]))
            ) {
                continue;
            }

            // Verify if all parts of the compound selector matched
            const partsCount = parseInt(idParts[2]);
            if (callbackCounts[id] === partsCount) {
                const config = this.configs.get(idParts[1]);
                if (config) {
                    executedConfigIds.add(config.id);
                    config.callback(mutation);
                }
            }
        }

        // C. Execute callbacks for complex selectors (using matches()) - Slowest
        const complexSelectors = targetMap.complexSelectors;
        if (complexSelectors) {
            for (const [selector, configIds] of complexSelectors) {
                for (const configId of configIds) {
                    if (
                        executedConfigIds.has(configId) ||
                        (mutation.type === "attributes" &&
                            !attributeCallbackIds.includes(configId))
                    ) {
                        continue;
                    }

                    if (target.matches(selector)) {
                        const config = this.configs.get(configId);
                        if (config) {
                            config.callback(mutation);
                        }
                    }
                }
            }
        }
    } catch(error) {
        // Fail silently or log error as needed
    }
};

/**
 * Uninitializes a specific observer configuration by its name.
 * Schedules a cleanup (debounced) to remove unused internal map entries.
 *
 * @param {string} name - The name of the observer configuration to remove.
 * @returns {void}
 * @public
 * @environment client
 */
observer.prototype.uninit = function (name) {
    const config = this.configByName.get(name);
    if (!config) {
        return;
    }

    this.unInintNames.add(name);
    this.configs.delete(config.id);

    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.removeObserver();
    }, 1000);
};

/**
 * Cleans up internal data structures by removing references to uninitialized observers.
 * Iterates through all maps (tagName, id, class, etc.) and splices out the removed IDs.
 *
 * @returns {void}
 * @public
 * @environment client
 */
observer.prototype.removeObserver = function () {
    const namesToRemove = Array.from(this.unInintNames);
    this.unInintNames.clear();

    for (let observerName of namesToRemove) {
        let config = this.configByName.get(observerName);

        for (let type of config.types) {
            let targetMap = this[type];
            for (let partType of Object.keys(targetMap)) {
                let selectorMap = targetMap[partType];
                if (Array.isArray(selectorMap)) {
                    const index = selectorMap.findIndex(
                        (obj) => obj.id === config.id
                    );
                    if (index !== -1) {
                        selectorMap.splice(index, 1);
                    }
                } else {
                    for (const [key, value] of selectorMap.entries()) {
                        if (
                            partType === "complexSelectors" ||
                            partType === "attributeFilter"
                        ) {
                            const index = value.indexOf(config.id);
                            if (index !== -1) {
                                value.splice(index, 1);
                                if (value.length === 0) {
                                    selectorMap.delete(key);
                                }
                            }
                        } else {
                            for (const generatedId of config.generatedIds ||
                                []) {
                                const index = value.indexOf(generatedId);
                                if (index !== -1) {
                                    value.splice(index, 1);
                                    if (value.length === 0) {
                                        selectorMap.delete(key);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        this.configByName.delete(observerName);
    }
};

export default new observer(document);

/**
 * Register a components init function & observe selector. The init function will be fired immedietly after detection of selector.
 *
 * @module observer
 * @environment client
 */
