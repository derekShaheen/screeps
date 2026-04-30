var creepUtils = require('utils.creep');
var debug = require('utils.debug');

function formatPos(pos) {
    return pos.roomName + ':' + pos.x + ',' + pos.y;
}

function getCarriedResource(creep) {
    for(var resourceType in creep.store) {
        if(creep.store[resourceType] > 0) {
            return resourceType;
        }
    }

    return null;
}

function updateWorkingState(creep) {
    if(creep.memory.working && creep.store.getUsedCapacity() === 0) {
        creep.memory.working = false;
        debug.roleState(creep, 'gathering');
        creepUtils.announceIntent(creep, 'state:mineral', 'mineral');
    }

    if(!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
        debug.roleState(creep, 'working');
        creepUtils.announceIntent(creep, 'state:deliver', 'deliver');
    }

    if(creep.memory.working === undefined) {
        creep.memory.working = false;
    }
}

function findMineral(creep) {
    var minerals = creep.room.find(FIND_MINERALS, {
        filter: function(mineral) {
            return mineral.mineralAmount > 0 &&
                creepUtils.isSafeTarget(creep, mineral) &&
                creepUtils.canReachBeforeDecay(creep, mineral, 1);
        }
    });

    return minerals[0] || null;
}

function hasExtractor(mineral) {
    var structures = mineral.pos.lookFor(LOOK_STRUCTURES);
    for(var i = 0; i < structures.length; i++) {
        if(structures[i].structureType == STRUCTURE_EXTRACTOR) {
            return true;
        }
    }

    return false;
}

function findDepositTarget(creep, resourceType) {
    if(!resourceType) {
        return null;
    }

    return creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return (structure.structureType == STRUCTURE_TERMINAL ||
                structure.structureType == STRUCTURE_STORAGE) &&
                structure.store.getFreeCapacity(resourceType) > 0 &&
                creepUtils.isSafeTarget(creep, structure) &&
                creepUtils.canReachBeforeDecay(creep, structure, 1);
        }
    });
}

function harvestMineral(creep) {
    var mineral = findMineral(creep);
    if(!mineral) {
        debug.log('debugRoles', creep.name + ' found no available mineral in ' + creep.room.name, 20);
        return false;
    }

    if(!hasExtractor(mineral)) {
        debug.log('debugRoles', creep.name + ' waiting for extractor at ' + formatPos(mineral.pos), 20);
        return false;
    }

    var result = creep.harvest(mineral);
    if(result == ERR_NOT_IN_RANGE) {
        creepUtils.moveTo(creep, mineral, '#cc66ff', 'go mine', 'move:mineral');
        return true;
    }

    if(result == OK) {
        creepUtils.announceIntent(creep, 'action:mineral', 'mine');
        return true;
    }

    debug.log('debugRoles', creep.name + ' mineral harvest failed: ' + result, 10);
    return false;
}

function deliverMineral(creep) {
    var resourceType = getCarriedResource(creep);
    var target = findDepositTarget(creep, resourceType);
    if(!target) {
        debug.log('debugRoles', creep.name + ' has no mineral deposit target', 10);
        return false;
    }

    var result = creep.transfer(target, resourceType);
    if(result == ERR_NOT_IN_RANGE) {
        creepUtils.moveTo(creep, target, '#cc66ff', 'go store', 'move:mineralStore');
        return true;
    }

    if(result == OK) {
        creepUtils.announceIntent(creep, 'action:mineralStore', 'store');
        debug.log('debugRoles', creep.name + ' stored ' + resourceType + ' at ' + formatPos(target.pos), 5);
        return true;
    }

    debug.log('debugRoles', creep.name + ' mineral transfer failed: ' + result, 10);
    return false;
}

var roleMineralHarvester = {
    run: function(creep) {
        updateWorkingState(creep);

        if(creep.memory.working) {
            deliverMineral(creep);
            return;
        }

        harvestMineral(creep);
    }
};

module.exports = roleMineralHarvester;
