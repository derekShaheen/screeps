var debug = require('utils.debug');

var DEFAULT_INPUT_TARGET = 1000;
var DEFAULT_INPUT_REFILL_BELOW = 500;
var DEFAULT_OUTPUT_DRAIN_AT = 1500;
var DEFAULT_PRODUCT_TARGET = 3000;
var DEFAULT_MIN_REAGENT_STOCK = 250;
var DEFAULT_STORAGE_TO_TERMINAL_MINERAL = 3000;

function formatPos(pos) {
    return pos.roomName + ':' + pos.x + ',' + pos.y;
}

function getLabMemory(room) {
    if(!room.memory.lab) {
        room.memory.lab = {};
    }

    if(room.memory.lab.enabled === undefined) {
        room.memory.lab.enabled = true;
    }

    if(room.memory.lab.inputTarget === undefined) {
        room.memory.lab.inputTarget = DEFAULT_INPUT_TARGET;
    }

    if(room.memory.lab.inputRefillBelow === undefined) {
        room.memory.lab.inputRefillBelow = DEFAULT_INPUT_REFILL_BELOW;
    }

    if(room.memory.lab.outputDrainAt === undefined) {
        room.memory.lab.outputDrainAt = DEFAULT_OUTPUT_DRAIN_AT;
    }

    if(room.memory.lab.productTarget === undefined) {
        room.memory.lab.productTarget = DEFAULT_PRODUCT_TARGET;
    }

    if(room.memory.lab.minReagentStock === undefined) {
        room.memory.lab.minReagentStock = DEFAULT_MIN_REAGENT_STOCK;
    }

    if(room.memory.lab.storageToTerminalMineral === undefined) {
        room.memory.lab.storageToTerminalMineral = DEFAULT_STORAGE_TO_TERMINAL_MINERAL;
    }

    return room.memory.lab;
}

function getLabs(room) {
    return room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_LAB;
        }
    });
}

function getTerminal(room) {
    if(room.terminal && room.terminal.my) {
        return room.terminal;
    }

    return null;
}

function getStorage(room) {
    if(room.storage && room.storage.my) {
        return room.storage;
    }

    return null;
}

function getStores(room) {
    var stores = [];
    var terminal = getTerminal(room);
    var storage = getStorage(room);

    if(terminal) {
        stores.push(terminal);
    }

    if(storage) {
        stores.push(storage);
    }

    return stores;
}

function getLabById(labs, id) {
    for(var i = 0; i < labs.length; i++) {
        if(labs[i].id == id) {
            return labs[i];
        }
    }

    return null;
}

function getStoredAmount(room, resourceType, includeLabs) {
    var amount = 0;
    var stores = getStores(room);
    for(var i = 0; i < stores.length; i++) {
        amount += stores[i].store[resourceType] || 0;
    }

    if(includeLabs) {
        var labs = getLabs(room);
        for(var j = 0; j < labs.length; j++) {
            amount += labs[j].store[resourceType] || 0;
        }
    }

    return amount;
}

function getStoreResourceTypes(room) {
    var seen = {};
    var resources = [];
    var stores = getStores(room);

    for(var i = 0; i < stores.length; i++) {
        for(var resourceType in stores[i].store) {
            if(resourceType == RESOURCE_ENERGY ||
                seen[resourceType] ||
                stores[i].store[resourceType] <= 0) {
                continue;
            }

            seen[resourceType] = true;
            resources.push(resourceType);
        }
    }

    resources.sort();
    return resources;
}

function getReactionProduct(first, second) {
    if(typeof REACTIONS === 'undefined' ||
        !first ||
        !second ||
        !REACTIONS[first] ||
        !REACTIONS[first][second]) {
        return null;
    }

    return REACTIONS[first][second];
}

function getReactionPairForProduct(product, room, minStock) {
    if(typeof REACTIONS === 'undefined' || !product) {
        return null;
    }

    for(var first in REACTIONS) {
        for(var second in REACTIONS[first]) {
            if(REACTIONS[first][second] != product) {
                continue;
            }

            if(room &&
                (getStoredAmount(room, first, false) < minStock ||
                getStoredAmount(room, second, false) < minStock)) {
                continue;
            }

            return {
                first: first,
                second: second,
                product: product
            };
        }
    }

    return null;
}

function getConfiguredReaction(room, memory) {
    var reagentA = memory.reagentA || memory.firstReagent;
    var reagentB = memory.reagentB || memory.secondReagent;
    var product = null;

    if(reagentA && reagentB) {
        product = getReactionProduct(reagentA, reagentB);
        if(product) {
            return {
                first: reagentA,
                second: reagentB,
                product: product
            };
        }
    }

    product = memory.product || memory.targetProduct;
    if(product) {
        return getReactionPairForProduct(product, room, memory.minReagentStock);
    }

    return null;
}

function chooseAutoReaction(room, memory) {
    if(typeof REACTIONS === 'undefined') {
        return null;
    }

    var resources = getStoreResourceTypes(room);
    var best = null;
    var bestScore = -1;

    for(var i = 0; i < resources.length; i++) {
        for(var j = 0; j < resources.length; j++) {
            if(i == j) {
                continue;
            }

            var product = getReactionProduct(resources[i], resources[j]);
            if(!product) {
                continue;
            }

            var firstStock = getStoredAmount(room, resources[i], false);
            var secondStock = getStoredAmount(room, resources[j], false);
            var productStock = getStoredAmount(room, product, true);
            if(firstStock < memory.minReagentStock ||
                secondStock < memory.minReagentStock ||
                productStock >= memory.productTarget) {
                continue;
            }

            var score = Math.min(firstStock, secondStock) - productStock;
            if(score > bestScore) {
                bestScore = score;
                best = {
                    first: resources[i],
                    second: resources[j],
                    product: product
                };
            }
        }
    }

    return best;
}

function getReaction(room, memory) {
    return getConfiguredReaction(room, memory) || chooseAutoReaction(room, memory);
}

function getOutputLabs(labs, first, second) {
    var outputs = [];
    for(var i = 0; i < labs.length; i++) {
        if(labs[i].id == first.id || labs[i].id == second.id) {
            continue;
        }

        if(labs[i].pos.getRangeTo(first) <= 2 &&
            labs[i].pos.getRangeTo(second) <= 2) {
            outputs.push(labs[i]);
        }
    }

    outputs.sort(function(a, b) {
        return a.id.localeCompare(b.id);
    });

    return outputs;
}

function chooseLabLayout(room, labs, memory) {
    var first = getLabById(labs, memory.inputLabIds && memory.inputLabIds[0]);
    var second = getLabById(labs, memory.inputLabIds && memory.inputLabIds[1]);
    if(first && second && getOutputLabs(labs, first, second).length > 0) {
        return {
            first: first,
            second: second,
            outputs: getOutputLabs(labs, first, second)
        };
    }

    labs.sort(function(a, b) {
        return a.id.localeCompare(b.id);
    });

    var best = null;
    var bestScore = -1;
    var anchor = getTerminal(room) || getStorage(room);
    for(var i = 0; i < labs.length; i++) {
        for(var j = i + 1; j < labs.length; j++) {
            var outputs = getOutputLabs(labs, labs[i], labs[j]);
            if(!outputs.length) {
                continue;
            }

            var score = outputs.length * 100;
            if(anchor) {
                score -= labs[i].pos.getRangeTo(anchor) + labs[j].pos.getRangeTo(anchor);
            }

            if(score > bestScore) {
                bestScore = score;
                best = {
                    first: labs[i],
                    second: labs[j],
                    outputs: outputs
                };
            }
        }
    }

    if(best) {
        memory.inputLabIds = [best.first.id, best.second.id];
        memory.outputLabIds = best.outputs.map(function(lab) {
            return lab.id;
        });
    }

    return best;
}

function getActivePlan(room) {
    var memory = getLabMemory(room);
    if(memory.enabled === false ||
        !room.controller ||
        !room.controller.my ||
        room.controller.level < 6) {
        return null;
    }

    var labs = getLabs(room);
    if(labs.length < 3) {
        return null;
    }

    var stores = getStores(room);
    if(!stores.length) {
        return null;
    }

    var layout = chooseLabLayout(room, labs, memory);
    var reaction = getReaction(room, memory);
    if(!layout || !reaction) {
        return null;
    }

    memory.activeReagentA = reaction.first;
    memory.activeReagentB = reaction.second;
    memory.activeProduct = reaction.product;
    memory.lastPlanTick = Game.time;

    return {
        first: layout.first,
        second: layout.second,
        outputs: layout.outputs,
        reagentA: reaction.first,
        reagentB: reaction.second,
        product: reaction.product,
        memory: memory
    };
}

function runOutputLabs(room, plan) {
    var reactionAmount = typeof LAB_REACTION_AMOUNT === 'undefined' ? 5 : LAB_REACTION_AMOUNT;
    if((plan.first.store[plan.reagentA] || 0) < reactionAmount ||
        (plan.second.store[plan.reagentB] || 0) < reactionAmount) {
        debug.log('debugRoles', room.name + ' labs waiting for reagents ' + plan.reagentA + '+' + plan.reagentB, 50);
        return 0;
    }

    var ran = 0;
    for(var i = 0; i < plan.outputs.length; i++) {
        var lab = plan.outputs[i];
        if(lab.cooldown > 0) {
            continue;
        }

        if(lab.mineralType && lab.mineralType != plan.product) {
            continue;
        }

        if(lab.store.getFreeCapacity(plan.product) <= 0) {
            continue;
        }

        var result = lab.runReaction(plan.first, plan.second);
        if(result == OK) {
            ran++;
            debug.log(
                'debugRoles',
                room.name + ' lab reaction ' + plan.reagentA + '+' +
                    plan.reagentB + ' -> ' + plan.product +
                    ' at ' + formatPos(lab.pos),
                5
            );
        }
        else if(result != ERR_TIRED && result != ERR_NOT_ENOUGH_RESOURCES) {
            debug.log('debugRoles', room.name + ' lab reaction failed: ' + result, 10);
        }
    }

    return ran;
}

function getAmountToMove(creep, source, target, resourceType, amount) {
    return Math.max(0, Math.min(
        amount || creep.store.getFreeCapacity(),
        creep.store.getFreeCapacity(),
        source.store[resourceType] || 0,
        target.store.getFreeCapacity(resourceType)
    ));
}

function makeTask(creep, source, target, resourceType, amount, label) {
    if(!source ||
        !target ||
        !resourceType ||
        !source.store ||
        !target.store ||
        (source.store[resourceType] || 0) <= 0 ||
        target.store.getFreeCapacity(resourceType) <= 0 ||
        !creep.room ||
        !source.pos ||
        !target.pos ||
        source.room.name != creep.room.name ||
        target.room.name != creep.room.name) {
        return null;
    }

    var moveAmount = getAmountToMove(creep, source, target, resourceType, amount);
    if(moveAmount <= 0) {
        return null;
    }

    return {
        sourceId: source.id,
        targetId: target.id,
        resourceType: resourceType,
        amount: moveAmount,
        label: label || 'lab'
    };
}

function getSourceStore(room, resourceType) {
    var stores = getStores(room);
    stores.sort(function(a, b) {
        return (b.store[resourceType] || 0) - (a.store[resourceType] || 0);
    });

    for(var i = 0; i < stores.length; i++) {
        if((stores[i].store[resourceType] || 0) > 0) {
            return stores[i];
        }
    }

    return null;
}

function getSinkStore(room, resourceType) {
    var terminal = getTerminal(room);
    if(terminal && terminal.store.getFreeCapacity(resourceType) > 0) {
        return terminal;
    }

    var storage = getStorage(room);
    if(storage && storage.store.getFreeCapacity(resourceType) > 0) {
        return storage;
    }

    return null;
}

function getInputLabTask(creep, plan, lab, resourceType) {
    if(lab.mineralType && lab.mineralType != resourceType) {
        return makeTask(
            creep,
            lab,
            getSinkStore(creep.room, lab.mineralType),
            lab.mineralType,
            creep.store.getFreeCapacity(),
            'clean lab'
        );
    }

    var current = lab.store[resourceType] || 0;
    if(current >= plan.memory.inputRefillBelow) {
        return null;
    }

    return makeTask(
        creep,
        getSourceStore(creep.room, resourceType),
        lab,
        resourceType,
        plan.memory.inputTarget - current,
        'load lab'
    );
}

function getOutputLabTask(creep, plan, lab) {
    if(!lab.mineralType) {
        return null;
    }

    if(lab.mineralType != plan.product ||
        (lab.store[lab.mineralType] || 0) >= plan.memory.outputDrainAt ||
        lab.store.getFreeCapacity(plan.product) <= (typeof LAB_REACTION_AMOUNT === 'undefined' ? 5 : LAB_REACTION_AMOUNT)) {
        return makeTask(
            creep,
            lab,
            getSinkStore(creep.room, lab.mineralType),
            lab.mineralType,
            creep.store.getFreeCapacity(),
            'empty lab'
        );
    }

    return null;
}

function getTerminalConsolidationTask(creep, memory) {
    var terminal = getTerminal(creep.room);
    var storage = getStorage(creep.room);
    if(!terminal || !storage) {
        return null;
    }

    for(var resourceType in storage.store) {
        if(resourceType == RESOURCE_ENERGY ||
            storage.store[resourceType] <= 0 ||
            (terminal.store[resourceType] || 0) >= memory.storageToTerminalMineral) {
            continue;
        }

        return makeTask(
            creep,
            storage,
            terminal,
            resourceType,
            memory.storageToTerminalMineral - (terminal.store[resourceType] || 0),
            'terminal'
        );
    }

    return null;
}

function getLogisticsTask(creep) {
    if(!creep ||
        !creep.room ||
        creep.store.getFreeCapacity() <= 0 ||
        creep.store.getUsedCapacity() > 0) {
        return null;
    }

    var plan = getActivePlan(creep.room);
    if(plan) {
        var firstTask = getInputLabTask(creep, plan, plan.first, plan.reagentA);
        if(firstTask) {
            return firstTask;
        }

        var secondTask = getInputLabTask(creep, plan, plan.second, plan.reagentB);
        if(secondTask) {
            return secondTask;
        }

        for(var i = 0; i < plan.outputs.length; i++) {
            var outputTask = getOutputLabTask(creep, plan, plan.outputs[i]);
            if(outputTask) {
                return outputTask;
            }
        }
    }

    return getTerminalConsolidationTask(creep, getLabMemory(creep.room));
}

function getDeliveryTarget(creep, resourceType) {
    var remembered = creep.memory.labLogisticsTargetId ?
        Game.getObjectById(creep.memory.labLogisticsTargetId) :
        null;

    if(remembered &&
        remembered.store &&
        remembered.room.name == creep.room.name &&
        remembered.store.getFreeCapacity(resourceType) > 0) {
        return remembered;
    }

    return getSinkStore(creep.room, resourceType);
}

var labManager = {
    getDeliveryTarget: getDeliveryTarget,
    getLogisticsTask: getLogisticsTask,
    run: function(room) {
        var plan = getActivePlan(room);
        if(!plan) {
            debug.log('debugRoles', room.name + ' labs idle; no reaction plan', 50);
            return;
        }

        runOutputLabs(room, plan);
    }
};

module.exports = labManager;
